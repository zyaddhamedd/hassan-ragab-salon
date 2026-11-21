import {createDevice, digest, hex, requireSecure, signedProof} from './proof.mjs';
export class StaffError extends Error {
  constructor(code, status = 0) { super(code); this.code = code; this.status = status; }
}
export class StaffClient {
  constructor({vault, environment = globalThis, fetch = (...args) => globalThis.fetch(...args), now = () => Date.now()} = {}) {
    this.vault = vault; this.environment = environment; this.fetch = fetch; this.now = now;
    this.access = null; this.expiry = 0; this.binding = null; this.candidate = null;
  }
  secure() { requireSecure(this.environment); }
  async initialize() {
    this.secure();
    if (!this.environment.navigator.locks?.request) throw new StaffError('DEVICE_LOCK_UNAVAILABLE');
    [this.binding, this.candidate] = await Promise.all([this.vault.device(), this.vault.device('candidate')]);
    return {device: this.binding, candidate: this.candidate};
  }
  csrf() {
    const item = this.environment.document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith('omar_staff_csrf='));
    return item ? decodeURIComponent(item.slice('omar_staff_csrf='.length)) : null;
  }
  async http(path, raw = '', headers = {}, method = 'POST') {
    this.secure();
    if (!path.startsWith('/api/staff/') || path.startsWith('//')) throw new StaffError('INVALID_API_TARGET');
    if (this.environment.navigator.onLine === false) throw new StaffError('OFFLINE');
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await this.fetch(path, {method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: {...(method === 'POST' ? {'Content-Type': 'application/json'} : {}), ...headers},
        ...(method === 'POST' ? {body: raw} : {}), signal: abort.signal});
      if (!response.ok) {
        let message = ''; try { message = (await response.json()).message || ''; } catch { /* No body is trusted as UI markup. */ }
        const codes = {
          'Geofence is not enabled or configured.': 'GEOFENCE_UNCONFIGURED',
          'Geofence configuration is incomplete or invalid.': 'GEOFENCE_UNCONFIGURED',
          'Location reading is stale or future-dated.': 'GPS_STALE',
          'Location reading is too inaccurate.': 'GPS_INACCURATE',
          'Location uncertainty extends outside the configured geofence.': 'GPS_OUTSIDE',
          'Device not approved.': 'DEVICE_PENDING', 'Device is not active.': 'DEVICE_INACTIVE',
          'This Staff attendance is not open in the authenticated employee branch.': 'ATTENDANCE_CHANGED',
          'An attendance row is already open; check out or request manager review.': 'ATTENDANCE_ALREADY_OPEN',
          'Applicable shift belongs to another branch; manager scheduling review required.': 'SHIFT_REVIEW_REQUIRED',
        };
        throw new StaffError(response.status === 404 ? 'STAFF_UNAVAILABLE' : response.status === 401 ? 'SESSION_EXPIRED' : codes[message] || 'SERVER_REJECTED', response.status);
      }
      try { return await response.json(); } catch { throw new StaffError('UNCONFIRMED_RESPONSE'); }
    } catch (error) {
      if (error instanceof StaffError) throw error;
      throw new StaffError('NETWORK_FAILURE');
    } finally { clearTimeout(timer); }
  }
  async signed(path, raw, {purpose = 'request', method = 'POST', device = this.binding, token = null, csrf = null} = {}) {
    if (!device?.deviceId) throw new StaffError('DEVICE_REQUIRED');
    const headers = {...(token ? {Authorization: 'Bearer ' + token} : {}), ...(csrf ? {'X-Staff-CSRF': csrf} : {})};
    const challenge = await this.http('/api/staff/auth/device-challenges', JSON.stringify({device_id: device.deviceId,
      purpose, method, target: path, body_hash: hex(await digest(raw, this.environment.crypto))}), headers);
    const proof = await signedProof(device, challenge, {purpose, method, target: path, raw, token,
      origin: this.environment.location.origin, now: this.now()}, this.environment.crypto);
    return this.http(path, raw, {...headers, 'X-Staff-Device': device.deviceId, DPoP: proof}, method);
  }
  tokens(result) {
    if (typeof result?.access_token !== 'string' || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new StaffError('UNCONFIRMED_RESPONSE');
    this.access = result.access_token; this.expiry = this.now() + result.expires_in * 1000;
  }
  sessionLock(task) {
    if (!this.environment.navigator.locks?.request) throw new StaffError('DEVICE_LOCK_UNAVAILABLE');
    return this.environment.navigator.locks.request('omar-staff-session', task);
  }
  async login(username, password) {
    return this.sessionLock(async () => {
      const candidate = this.candidate?.deviceId ? this.candidate : null;
      const device = candidate || this.binding;
      if (!device || (!candidate && device.state !== 'active')) throw new StaffError('DEVICE_REQUIRED');
      const result = await this.signed('/api/staff/auth/login', JSON.stringify({username, password}), {purpose: 'login', device});
      this.tokens(result);
      if (candidate) { await this.vault.promote(candidate); this.binding = {...candidate, state: 'active'}; this.candidate = null; }
    });
  }
  async provision(kind, username, code, password) {
    return this.sessionLock(() => this.provisionLocked(kind, username, code, password));
  }
  async provisionLocked(kind, username, code, password) {
    if (!['activate', 'recover'].includes(kind)) throw new StaffError('INVALID_AUTH_ACTION');
    this.secure();
    this.candidate = await this.vault.device('candidate');
    if (this.candidate?.state === 'enrolling' || this.candidate?.deviceId) throw new StaffError('ENROLLMENT_REVIEW_REQUIRED');
    const candidate = this.candidate || await createDevice(this.environment.crypto);
    await this.vault.saveDevice('candidate', candidate); // Durable nonextractable key BEFORE any account action.
    this.candidate = candidate;
    const result = await this.http('/api/staff/auth/' + kind, JSON.stringify({username, code, password}));
    this.access = null; this.expiry = 0;
    if (typeof result.enrollment_grant !== 'string') throw new StaffError('UNCONFIRMED_RESPONSE');
    this.candidate = {...candidate, state: 'enrolling'};
    await this.vault.saveDevice('candidate', this.candidate);
    // Enrollment grant is request-scoped memory; never persisted or shown.
    const enrolled = await this.http('/api/staff/device-enrollments', JSON.stringify({enrollment_grant: result.enrollment_grant, public_jwk: candidate.publicJwk}));
    if (!/^[0-9a-f]{32}$/.test(enrolled.device_id) || enrolled.state !== 'PENDING') throw new StaffError('UNCONFIRMED_RESPONSE');
    this.candidate = {...candidate, deviceId: enrolled.device_id, state: 'pending'};
    await this.vault.saveDevice('candidate', this.candidate);
  }
  async attachReviewedDevice(deviceId) {
    if (!this.candidate || !/^[0-9a-f]{32}$/.test(deviceId)) throw new StaffError('ENROLLMENT_REVIEW_REQUIRED');
    this.candidate = {...this.candidate, deviceId, state: 'pending'};
    await this.vault.saveDevice('candidate', this.candidate);
  }
  async finalize() {
    return this.sessionLock(async () => {
      const device = await this.vault.device('candidate');
      this.candidate = device;
      if (!device?.deviceId) throw new StaffError('ENROLLMENT_REVIEW_REQUIRED');
      const result = await this.signed('/api/staff/device-enrollments/' + device.deviceId + '/finalize', '{}', {purpose: 'finalize', device});
      if (result.device_id !== device.deviceId || result.state !== 'ACTIVE') throw new StaffError('UNCONFIRMED_RESPONSE');
      await this.vault.promote(device); this.binding = {...device, state: 'active'}; this.candidate = null;
    });
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    const rotate = async () => {
      const csrf = this.csrf();
      if (!csrf) throw new StaffError('SESSION_EXPIRED', 401);
      const result = await this.signed('/api/staff/auth/refresh', '{}', {purpose: 'refresh', csrf});
      this.tokens(result);
    };
    this.refreshing = this.sessionLock(rotate).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async authorized(path, raw = '', method = 'GET') {
    if (!this.access || this.expiry <= this.now() + 30000) await this.refresh();
    try { return await this.signed(path, raw, {token: this.access, method}); }
    catch (error) {
      if (error.status !== 401) throw error;
      this.access = null; await this.refresh();
      return this.signed(path, raw, {token: this.access, method});
    }
  }
  async profile() {
    const result = await this.authorized('/api/staff/me');
    const source = result?.identity;
    if (!source) throw new StaffError('UNCONFIRMED_RESPONSE');
    return {identity: Object.fromEntries(['user_id', 'employee_id', 'username', 'full_name', 'employee_type', 'branch_id', 'is_active', 'staff_auth_version', 'employee_eligible'].map(key => [key, source[key]]))};
  }
  shifts(from, to) { return this.authorized('/api/staff/shifts?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)); }
  current(operation = null) {
    if (operation !== null && !/^[0-9a-f]{32}$/.test(operation)) throw new StaffError('INVALID_ATTENDANCE_ACTION');
    return this.authorized('/api/staff/attendance/current' + (operation ? '?operation=' + operation : ''));
  }
  attendance(action, raw) {
    if (!['CHECK_IN', 'CHECK_OUT'].includes(action)) throw new StaffError('INVALID_ATTENDANCE_ACTION');
    return this.authorized('/api/staff/attendance/' + (action === 'CHECK_IN' ? 'check-in' : 'check-out'), raw, 'POST');
  }
  async logout() {
    return this.sessionLock(async () => {
      try { await this.signed('/api/staff/auth/logout', '{}', {purpose: 'logout', csrf: this.csrf()}); }
      finally { this.access = null; this.expiry = 0; }
    });
  }

}
