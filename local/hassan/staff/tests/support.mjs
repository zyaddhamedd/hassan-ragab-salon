import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {DeviceVault} from '../vault.mjs';
import {createDevice, identifier, digest, hex, b64, bytes} from '../proof.mjs';
export class MemoryVault extends DeviceVault {
  constructor() { super(null); this.entries = new Map(); }
  async operation(key, value, remove = false) {
    if (remove) { this.entries.delete(key); return null; }
    if (value !== undefined) this.entries.set(key, structuredClone(value));
    return structuredClone(this.entries.get(key) ?? null);
  }
}
export function locks() {
  const tails = new Map();
  return {request(name, work) {
    const task = (tails.get(name) || Promise.resolve()).catch(() => {}).then(work);
    tails.set(name, task); return task;
  }};
}
export function environment() {
  return {isSecureContext: true, crypto: webcrypto, location: {protocol: 'https:', origin: 'https://staff.example.test'},
    navigator: {onLine: true, locks: locks()}, document: {cookie: ''}};
}
export function receipt(action = 'CHECK_IN', attendanceId = 17) {
  return {attendance_id: attendanceId, action, confirmed: true, confirmed_at: '2026-10-30T12:00:00+00:00',
    business_date: '2026-10-30', check_in_time: '2026-10-30T12:00:00+00:00',
    check_out_time: action === 'CHECK_OUT' ? '2026-10-30T13:00:00+00:00' : null,
    shift: {shift_date: '2026-10-30', state: 'UNASSIGNED', start_at: null, end_at: null, timezone: 'Africa/Cairo', frozen: true}};
}
const json = (value, status = 200) => ({ok: status >= 200 && status < 300, status, json: async () => value});
const reject = (message, status = 403) => json({message}, status);
export class Backend {
  constructor(env) { this.env = env; this.devices = new Map(); this.challenges = new Map(); this.calls = []; this.proofs = []; this.access = 'fixture-access-1'; this.refreshToken = 'fixture-cookie-1'; this.fail = null; this.actionCalls = []; this.keys = new Map(); }
  async active(vault) {
    const device = {...await createDevice(webcrypto), deviceId: identifier(webcrypto), state: 'active'};
    this.devices.set(device.deviceId, {jwk: device.publicJwk, state: 'ACTIVE'});
    await vault.saveDevice('current', device); return device;
  }
  async fetch(path, options) {
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
    assert.ok(path.startsWith('/api/staff/'), 'Only the existing Staff namespace may be called');
    this.calls.push({path, ...options});
    if (this.fail) { const result = await this.fail(path, options); if (result) return result; }
    const raw = options.body || '', data = raw ? JSON.parse(raw) : null;
    if (path === '/api/staff/auth/activate' || path === '/api/staff/auth/recover') return json({enrollment_grant: 'fixture-only-enrollment-grant'});
    if (path === '/api/staff/device-enrollments') {
      assert.equal(data.enrollment_grant, 'fixture-only-enrollment-grant'); assert.equal('d' in data.public_jwk, false);
      const id = identifier(webcrypto); this.devices.set(id, {jwk: data.public_jwk, state: 'PENDING'}); this.enrolled = id;
      if (this.loseEnrollment) throw new Error('Fixture lost enrollment response');
      return json({device_id: id, state: 'PENDING'}, 201);
    }
    if (path === '/api/staff/auth/device-challenges') {
      const device = this.devices.get(data.device_id);
      if (!device) return reject('Device is not active.');
      if (data.purpose === 'finalize' ? device.state !== 'APPROVED' : device.state !== 'ACTIVE') return reject(data.purpose === 'finalize' ? 'Device not approved.' : 'Device is not active.');
      if (data.purpose === 'request' && options.headers.Authorization !== 'Bearer ' + this.access) return reject('Invalid Staff session.', 401);
      if (['refresh', 'logout'].includes(data.purpose) && options.headers['X-Staff-CSRF'] !== this.env.document.cookie.split('=')[1]) return reject('Invalid Staff CSRF proof.');
      const item = {challenge_id: identifier(webcrypto), challenge: identifier(webcrypto) + identifier(webcrypto), device_id: data.device_id,
        purpose: data.purpose, htm: data.method, htu: this.env.location.origin + data.target, body_hash: data.body_hash,
        ath: data.purpose === 'request' ? b64(await digest(this.access, webcrypto)) : ['refresh', 'logout'].includes(data.purpose) ? b64(await digest(this.refreshToken, webcrypto)) : null,
        expires_at: new Date(Date.now() + 60000).toISOString()};
      this.challenges.set(item.challenge_id, item); return json(item);
    }
    const proof = options.headers.DPoP; assert.equal(typeof proof, 'string', 'Every protected request must carry a real proof');
    const [head, body, sig] = proof.split('.');
    const header = JSON.parse(Buffer.from(head, 'base64url')), payload = JSON.parse(Buffer.from(body, 'base64url'));
    const challenge = this.challenges.get(payload.challenge_id), device = this.devices.get(options.headers['X-Staff-Device']);
    assert.ok(challenge && !challenge.used, 'Challenge must be fresh');
    assert.deepEqual(header, {alg: 'ES256', typ: 'staff-device-proof+jwt', jwk: device.jwk});
    const publicKey = await webcrypto.subtle.importKey('jwk', device.jwk, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
    assert.equal(await webcrypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, publicKey, Buffer.from(sig, 'base64url'), bytes(head + '.' + body)), true);
    for (const key of ['device_id', 'purpose', 'htm', 'htu', 'body_hash', 'ath', 'challenge_id', 'challenge']) assert.equal(payload[key], challenge[key]);
    assert.equal(payload.htm, options.method); assert.equal(payload.htu, this.env.location.origin + path); assert.equal(payload.body_hash, hex(await digest(raw, webcrypto)));
    assert.match(payload.jti, /^[0-9a-f]{32}$/); assert.ok(Math.abs(payload.iat - Date.now() / 1000) < 60);
    challenge.used = true; this.proofs.push(payload);
    if (path.endsWith('/finalize')) { device.state = 'ACTIVE'; if (this.loseFinalize) throw new Error('Fixture lost finalize response'); return json({device_id: options.headers['X-Staff-Device'], state: 'ACTIVE'}); }
    if (path === '/api/staff/auth/login' || path === '/api/staff/auth/refresh') {
      this.access = 'fixture-access-' + identifier(webcrypto); this.refreshToken = 'fixture-cookie-' + identifier(webcrypto);
      this.env.document.cookie = 'omar_staff_csrf=fixture-csrf-' + identifier(webcrypto);
      return json({access_token: this.access, expires_in: 900, csrf: this.env.document.cookie.split('=')[1]});
    }
    if (path === '/api/staff/auth/logout') { this.env.document.cookie = ''; return json({success: true}); }
    if (path.startsWith('/api/staff/attendance/current')) {
      const operation = new URL(path, this.env.location.origin).searchParams.get('operation');
      const recovered = this.keys.get(operation);
      const latest = [...this.keys.values()].at(-1);
      const state = this.currentState || (latest ? {state: latest.action === 'CHECK_IN' ? 'OPEN' : 'CLOSED',
        check_in_eligible: latest.action !== 'CHECK_IN', checkout_eligible: latest.action === 'CHECK_IN',
        attendance: {attendance_id: latest.attendance_id, business_date: latest.business_date, check_in_time: latest.check_in_time,
          check_out_time: latest.check_out_time, closure: latest.action === 'CHECK_OUT' ? 'GPS_VERIFIED' : null, shift: latest.shift}} : {state: 'NONE', check_in_eligible: true, checkout_eligible: false, attendance: null});
      return json({...state, observed_at: new Date().toISOString(), recovery: recovered ? {action: recovered.action, attendance_id: recovered.attendance_id, committed: true} : null});
    }
    if (path === '/api/staff/me') return json({identity: {user_id: 4, employee_id: 8, full_name: 'Fixture Employee', employee_type: 'BARBER', branch_id: 1, employee_eligible: true}});
    if (path.startsWith('/api/staff/shifts?')) return json({shifts: []});
    if (path === '/api/staff/attendance/check-in' || path === '/api/staff/attendance/check-out') {
      assert.deepEqual(Object.keys(data).sort(), (path.endsWith('check-out') ? ['attendance_id', 'idempotency_key', 'location'] : ['idempotency_key', 'location']).sort());
      this.actionCalls.push({path, raw, payload});
      if (this.rejectAttendance) return reject(this.rejectAttendance.message, this.rejectAttendance.status);
      if (!this.keys.has(data.idempotency_key)) this.keys.set(data.idempotency_key, receipt(path.endsWith('check-out') ? 'CHECK_OUT' : 'CHECK_IN', data.attendance_id || 17));
      if (this.loseAttendance) { this.loseAttendance = false; throw new Error('Fixture lost committed response'); }
      return json(this.keys.get(data.idempotency_key));
    }
    throw new Error('Unexpected mocked endpoint: ' + path);
  }
}
