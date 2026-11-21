import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {DeviceVault} from '../vault.mjs';
import {StaffClient, StaffError} from '../client.mjs';
import {createDevice, identifier, requireSecure, signedProof, digest, hex} from '../proof.mjs';
import {AttendanceAction, freshLocation, bindHold} from '../attendance.mjs';
import {MemoryVault, Backend, environment, receipt} from './support.mjs';
const input = () => ({idempotency_key: identifier(webcrypto), location: {latitude: 0, longitude: 0, accuracy_m: 5, captured_at: new Date().toISOString()}});
async function setup(active = true) {
  const env = environment(), vault = new MemoryVault(), backend = new Backend(env);
  if (active) await backend.active(vault);
  const client = new StaffClient({vault, environment: env, fetch: backend.fetch.bind(backend)});
  await client.initialize(); return {env, vault, backend, client};
}
const rejects = (promise, code) => assert.rejects(promise, error => (error.code || error.message) === code);

test('nonextractable P-256 keys survive structured clone; private export fails', async () => {
  const vault = new MemoryVault(), device = await createDevice(webcrypto); await vault.saveDevice('current', device);
  const stored = await vault.device(); assert.equal(stored.privateKey.extractable, false); assert.equal('d' in stored.publicJwk, false);
  await assert.rejects(webcrypto.subtle.exportKey('jwk', stored.privateKey));
  await rejects(vault.saveDevice('current', {...device, privateKey: {type: 'private', extractable: true}}), 'DEVICE_KEY_UNAVAILABLE');
});

test('HTTP/unsupported storage/unsupported lifecycle locks fail before any request', async () => {
  const {env, client, backend} = await setup(); env.location.protocol = 'http:';
  await rejects(client.login('fixture-user', 'fixture-password'), 'SECURE_CONTEXT_REQUIRED'); assert.equal(backend.calls.length, 0);
  await rejects(new DeviceVault(null).device(), 'DEVICE_STORAGE_UNAVAILABLE');
  env.location.protocol = 'https:'; env.navigator.locks = null;
  await rejects(client.initialize(), 'DEVICE_LOCK_UNAVAILABLE'); assert.equal(backend.calls.length, 0);
});

test('login, actual safe profile and shifts use real ES256 proofs; tokens never enter vault', async () => {
  const {client, backend, vault} = await setup(); await client.login('fixture-user', 'fixture-password');
  assert.equal((await client.profile()).identity.user_id, 4); await client.shifts('2026-10-29', '2026-11-05');
  assert.equal(backend.proofs.length, 3); assert.equal(backend.proofs[1].htm, 'GET'); assert.match(backend.proofs[2].htu, /\/shifts\?from=2026-10-29&to=2026-11-05$/);
  assert.equal(JSON.stringify([...vault.entries]).includes(client.access), false); assert.equal([...vault.entries.keys()].includes('password'), false);
});

test('activation enrolls public key, pending approval cannot finalize/login, manager approval is required', async () => {
  const {client, backend, vault} = await setup(false);
  await client.provision('activate', 'fixture-user', 'fixture-code', 'fixture-new-password');
  assert.equal(client.binding, null); assert.equal(client.candidate.state, 'pending');
  await rejects(client.finalize(), 'DEVICE_PENDING'); await rejects(client.login('fixture-user', 'fixture-new-password'), 'DEVICE_INACTIVE');
  assert.equal(await vault.device(), null); // No current binding is created from a pending device.
});

test('approved finalization promotes only after backend ACTIVE confirmation; recovery retains original key meanwhile', async () => {
  const {client, backend, vault} = await setup(); const old = client.binding.deviceId;
  await client.provision('recover', 'fixture-user', 'fixture-code', 'fixture-new-password');
  assert.equal((await vault.device()).deviceId, old); assert.notEqual(client.candidate.publicJwk.x, client.binding.publicJwk.x);
  backend.devices.get(client.candidate.deviceId).state = 'APPROVED';
  await client.finalize(); assert.notEqual(client.binding.deviceId, old); assert.equal(client.candidate, null);
  await client.login('fixture-user', 'fixture-new-password'); assert.ok(client.access);
  assert.equal((await vault.device('candidate')), null);
});

test('uncertain enrollment never regenerates key or registers a second device; reviewed ID can be attached', async () => {
  const {client, backend, vault} = await setup(false); backend.loseEnrollment = true;
  await rejects(client.provision('activate', 'fixture-user', 'fixture-code', 'fixture-password'), 'NETWORK_FAILURE');
  assert.equal((await vault.device('candidate')).state, 'enrolling');
  await rejects(client.provision('recover', 'fixture-user', 'fixture-code', 'fixture-password'), 'ENROLLMENT_REVIEW_REQUIRED');
  assert.equal(backend.devices.size, 1);
  await client.attachReviewedDevice(backend.enrolled); backend.devices.get(backend.enrolled).state = 'APPROVED';
  await client.finalize(); assert.equal(client.binding.deviceId, backend.enrolled);
});

test('lost finalization response recovers through a real key-bound login, not a local ACTIVE assumption', async () => {
  const {client, backend} = await setup(false);
  await client.provision('activate', 'fixture-user', 'fixture-code', 'fixture-password');
  backend.devices.get(client.candidate.deviceId).state = 'APPROVED'; backend.loseFinalize = true;
  await rejects(client.finalize(), 'NETWORK_FAILURE'); assert.equal(client.binding, null);
  await client.login('fixture-user', 'fixture-password'); assert.equal(client.binding.state, 'active');
});

test('key persistence failure prevents activation/enrollment request', async () => {
  const {client, vault, backend} = await setup(false);
  vault.saveDevice = async () => { throw new Error('DEVICE_STORAGE_UNAVAILABLE'); };
  await rejects(client.provision('activate', 'fixture-user', 'fixture-code', 'fixture-password'), 'DEVICE_STORAGE_UNAVAILABLE');
  assert.equal(backend.calls.length, 0);
});

test('reload restores through secure-cookie refresh; concurrent refresh is serialized and never stores refresh/access tokens', async () => {
  const {client, env, vault, backend} = await setup(); await client.login('fixture-user', 'fixture-password');
  const reloaded = new StaffClient({vault, environment: env, fetch: backend.fetch.bind(backend)}); await reloaded.initialize(); assert.equal(reloaded.access, null);
  await Promise.all([reloaded.refresh(), reloaded.refresh()]);
  assert.equal(backend.calls.filter(v => v.path === '/api/staff/auth/refresh').length, 1);
  assert.ok((await reloaded.profile()).identity); assert.equal(JSON.stringify([...vault.entries]).includes(reloaded.access), false);
  const refresh = backend.proofs.find(v => v.purpose === 'refresh'); assert.equal(refresh.body_hash, hex(await digest('{}', webcrypto)));
  assert.equal(Object.hasOwn(reloaded, 'refreshToken'), false);
});

test('logout uses signed cookie/CSRF contract and preserves the approved device key', async () => {
  const {client, backend, vault} = await setup(); await client.login('fixture-user', 'fixture-password');
  await client.logout(); assert.equal(client.access, null); assert.equal(backend.proofs.at(-1).purpose, 'logout'); assert.ok((await vault.device()).privateKey);
});

test('expired session reauthenticates once, with fresh proof and exact attendance bytes', async () => {
  const {client, backend} = await setup(); await client.login('fixture-user', 'fixture-password');
  const raw = JSON.stringify(input()); let once = true;
  backend.fail = async path => { if (once && path === '/api/staff/attendance/check-in') { once = false; return {ok: false, status: 401, json: async () => ({message: 'Invalid Staff session.'})}; } };
  await client.attendance('CHECK_IN', raw);
  const requests = backend.calls.filter(v => v.path === '/api/staff/attendance/check-in');
  assert.equal(requests.length, 2); assert.equal(requests[0].body, requests[1].body); assert.notEqual(requests[0].headers.DPoP, requests[1].headers.DPoP);
});

test('untrusted/malformed challenge cannot be signed or submitted', async () => {
  const {client, backend} = await setup(); await client.login('fixture-user', 'fixture-password');
  backend.fail = async path => path === '/api/staff/auth/device-challenges' ? {ok: true, status: 200, json: async () => ({htu: 'https://other.example/api/staff/me'})} : null;
  await rejects(client.profile(), 'INVALID_DEVICE_CHALLENGE'); assert.equal(backend.calls.filter(v => v.path === '/api/staff/me').length, 0);
});

test('signed attendance validates before success, preserves checkout ID and exact bytes on uncertain retry', async () => {
  const {client, backend, vault, env} = await setup(); await client.login('fixture-user', 'fixture-password'); backend.loseAttendance = true;
  const phases = []; let located = 0;
  const controller = new AttendanceAction({client, vault, environment: env, locate: async () => { located++; return input().location; }, notify: value => phases.push(value.phase)});
  controller.current = {state: 'OPEN', checkout_eligible: true, attendance: {attendance_id: 17}};
  await rejects(controller.perform('CHECK_OUT', 17, 4), 'NETWORK_FAILURE'); assert.equal(controller.phase, 'uncertain'); assert.equal(phases.includes('confirmed'), false);
  const original = controller.pending.raw; assert.equal(JSON.parse(original).attendance_id, 17);
  await rejects(controller.perform('CHECK_IN', null, 4), 'PENDING_ACTION'); await rejects(controller.retry(99), 'ATTENDANCE_STATE_UNKNOWN');
  const result = await controller.retry(4); assert.equal(result.confirmed, true); assert.equal(controller.pending, null); assert.equal(located, 1);
  assert.equal(backend.actionCalls[1].raw, original); assert.notEqual(backend.actionCalls[0].payload.jti, backend.actionCalls[1].payload.jti);
  assert.notEqual(backend.actionCalls[0].payload.challenge_id, backend.actionCalls[1].payload.challenge_id);
  const saved = JSON.stringify([...vault.entries]); assert.equal(saved.includes('latitude'), false); assert.equal(saved.includes('longitude'), false); assert.equal(saved.includes('captured_at'), false);
});

test('GPS denied or offline never writes, never confirms, and geolocation is explicit with no cached reading', async () => {
  const env = environment(); let calls = 0;
  env.navigator.geolocation = {getCurrentPosition(_ok, bad, options) { calls++; assert.deepEqual(options, {enableHighAccuracy: true, maximumAge: 0, timeout: 15000}); bad({code: 1}); }};
  const action = new AttendanceAction({client: {attendance() { throw new Error('No writes allowed'); }}, vault: new MemoryVault(), environment: env});
  assert.equal(calls, 0); await rejects(action.perform('CHECK_IN', null, 4), 'GPS_PERMISSION_DENIED'); assert.equal(action.phase, 'failure'); assert.equal(action.pending, null);
  env.navigator.onLine = false; await rejects(action.perform('CHECK_IN', null, 4), 'OFFLINE'); assert.equal(calls, 1);
});

test('fresh geolocation maps browser capture time but server confirmation is authoritative', async () => {
  const env = environment(); env.navigator.geolocation = {getCurrentPosition(ok) { ok({coords: {latitude: 0, longitude: 0, accuracy: 7}, timestamp: 1000}); }};
  assert.deepEqual(await freshLocation(env), {latitude: 0, longitude: 0, accuracy_m: 7, captured_at: '1970-01-01T00:00:01.000Z'});
});

test('GPS rejection/config missing never animates success and permits deliberate new location only after known rejection', async () => {
  const {client, backend, vault, env} = await setup(); await client.login('fixture-user', 'fixture-password');
  const action = new AttendanceAction({client, vault, environment: env, locate: async () => input().location});
  backend.rejectAttendance = {message: 'Location uncertainty extends outside the configured geofence.', status: 403};
  await rejects(action.perform('CHECK_IN', null, 4), 'GPS_OUTSIDE'); const old = action.pending.raw; await action.discardRejected();
  backend.rejectAttendance = {message: 'Geofence is not enabled or configured.', status: 409};
  await rejects(action.perform('CHECK_IN', null, 4), 'GEOFENCE_UNCONFIGURED'); assert.notEqual(action.pending.raw, old); assert.equal(action.receipt, null);
});

test('malformed success cannot ignite and uncertain payload cannot be discarded or persisted', async () => {
  const env = environment(), vault = new MemoryVault();
  const action = new AttendanceAction({client: {attendance: async () => ({...receipt(), confirmed: false})}, vault, environment: env, locate: async () => input().location});
  await rejects(action.perform('CHECK_IN', null, 4), 'UNCONFIRMED_RESPONSE'); assert.equal(action.phase, 'uncertain');
  await assert.rejects(action.discardRejected()); assert.equal(JSON.stringify([...vault.entries]).includes('latitude'), false);
  const reloaded = new AttendanceAction({client: {}, vault, environment: env}); assert.equal(reloaded.pending, null); assert.equal(reloaded.phase, 'idle');
});

test('confirmation persistence allowlist excludes injected GPS/security fields', async () => {
  const vault = new MemoryVault(); await vault.saveConfirmation(4, {...receipt(), location: input().location, access_token: 'fixture-access', request_hash: 'fixture-secret', shift: {...receipt().shift, salary: 50}});
  const saved = JSON.stringify(await vault.confirmation());
  for (const field of ['latitude', 'longitude', 'accuracy_m', 'captured_at', 'access_token', 'request_hash', 'salary']) assert.equal(saved.includes(field), false);
});

test('physical hold cancels on release/hidden/repeat and completes only at 1400ms', () => {
  class Button extends EventTarget { disabled = false; focus() {} setPointerCapture() {} }
  const button = new Button(), document = new EventTarget(); let tick, completed = 0, released = 0, now = 0;
  const send = (target, name, values = {}) => { const event = new Event(name, {cancelable: true}); Object.assign(event, values); target.dispatchEvent(event); };
  const unbind = bindHold(button, {begin: () => true, progress() {}, release: () => released++, complete: () => completed++, frame: fn => { tick = fn; return 1; }, cancel() {}, clock: () => now, document});
  send(button, 'pointerdown', {button: 0, isPrimary: true, pointerId: 1}); tick(500); send(button, 'pointercancel', {pointerId: 1}); tick(1500); assert.equal(completed, 0);
  send(button, 'keydown', {key: 'Enter', repeat: true}); assert.equal(completed, 0);
  now = 2000; send(button, 'keydown', {key: ' ', repeat: false}); tick(3399); assert.equal(completed, 0); tick(3400); assert.equal(completed, 1);
  now = 4000; send(button, 'pointerdown', {button: 0, isPrimary: true, pointerId: 2}); document.hidden = true; send(document, 'visibilitychange'); tick(6000); assert.equal(completed, 1);
  assert.ok(released >= 2); unbind();
});

test('real entry keeps approved structures and contains no simulator or fictitious identity', async () => {
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8'); const app = await fs.readFile(new URL('../app.mjs', import.meta.url), 'utf8');
  for (const name of ['signature-home', 'signature-shift', 'mechanical-control', 'progress-ring', 'orb', 'profile-identity']) assert.ok(html.includes(name));
  assert.equal(html.includes('data-result='), false); assert.equal(html.includes('أحمد محمود'), false); assert.ok(html.includes("connect-src 'self'"));
  assert.ok(html.includes('../prototypes/staff/style.css')); assert.equal(app.includes('getCurrentPosition'), false); assert.equal(app.includes('/api/admin/'), false);
  assert.ok(app.includes("action.phase === 'confirmed' && action.receipt")); assert.ok(app.includes('await refreshAttendance()'));
});

test('frontend ES256 signature is accepted by the actual isolated backend verifier (no DB/factory)', async () => {
  const {spawnSync} = await import('node:child_process'); const {fileURLToPath} = await import('node:url'); const path = await import('node:path');
  const {client, backend} = await setup(); await client.login('fixture-user', 'fixture-password');
  const call = backend.calls.find(item => item.path === '/api/staff/auth/login');
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const result = spawnSync(path.join(root, '.local/omar/venv/bin/python'), ['-c',
    "import json,sys;sys.path.insert(0,sys.argv[1]);from app.services.mini_device_proof_service import _decode_and_verify_jws;item=json.load(sys.stdin);payload=_decode_and_verify_jws(item['proof'],item['jwk'],'staff-device-proof+jwt');assert payload['purpose']=='login';print('verified')", path.join(root, 'backend')],
  {input: JSON.stringify({proof: call.headers.DPoP, jwk: client.binding.publicJwk}), encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), 'verified');
});

test('two tabs serialize refresh-cookie rotation using the shared Web Lock', async () => {
  const {client, env, vault, backend} = await setup(); await client.login('fixture-user', 'fixture-password');
  const other = new StaffClient({vault, environment: env, fetch: backend.fetch.bind(backend)}); await other.initialize();
  await Promise.all([client.refresh(), other.refresh()]);
  assert.equal(backend.calls.filter(item => item.path === '/api/staff/auth/refresh').length, 2);
  assert.equal(backend.proofs.filter(item => item.purpose === 'refresh').length, 2);
});

test('attendance stays non-successful until the backend response settles', async () => {
  let confirm; const waiting = new Promise(resolve => { confirm = resolve; });
  const action = new AttendanceAction({client: {attendance: () => waiting}, vault: new MemoryVault(), environment: environment(), locate: async () => input().location});
  const task = action.perform('CHECK_IN', null, 4); await new Promise(resolve => setImmediate(resolve));
  assert.equal(action.phase, 'verifying'); assert.equal(action.receipt, null); assert.equal(action.busy, true);
  confirm(receipt()); await task; assert.equal(action.phase, 'confirmed'); assert.equal(action.busy, false);
});

test('a confirmed server operation remains confirmed when saving the safe reference fails', async () => {
  const vault = new MemoryVault(); vault.saveConfirmation = async () => { throw new Error('Fixture storage failure'); };
  const action = new AttendanceAction({client: {attendance: async () => receipt()}, vault, environment: environment(), locate: async () => input().location});
  await action.perform('CHECK_IN', null, 4); assert.equal(action.phase, 'confirmed'); assert.equal(action.pending, null); assert.equal(action.error.code, 'CONFIRMATION_STORAGE_FAILED');
});

test('profile projection discards unexpected financial fields from a mocked response', async () => {
  const {client, backend} = await setup(); await client.login('fixture-user', 'fixture-password');
  backend.fail = async path => path === '/api/staff/me' ? {ok: true, status: 200, json: async () => ({identity: {user_id: 4, full_name: 'Fixture', salary: 100, commission: 50, payroll: 'private'}})} : null;
  const result = await client.profile(); for (const field of ['salary', 'commission', 'payroll']) assert.equal(Object.hasOwn(result.identity, field), false);
});

test('a server failure keeps volatile original bytes and never enters success', async () => {
  const action = new AttendanceAction({client: {attendance: async () => { throw new StaffError('SERVER_REJECTED', 500); }}, vault: new MemoryVault(), environment: environment(), locate: async () => input().location});
  await rejects(action.perform('CHECK_IN', null, 4), 'SERVER_REJECTED'); assert.equal(action.phase, 'uncertain'); assert.ok(action.pending.raw); assert.equal(action.receipt, null); await assert.rejects(action.discardRejected());
});

test('unexpected response GPS/security fields never enter confirmation state', async () => {
  const action = new AttendanceAction({client: {attendance: async () => ({...receipt(), location: input().location, challenge_id: 'private', shift: {...receipt().shift, salary: 50}})}, vault: new MemoryVault(), environment: environment(), locate: async () => input().location});
  await action.perform('CHECK_IN', null, 4);
  const confirmed = JSON.stringify(action.receipt); for (const key of ['latitude', 'challenge_id', 'salary']) assert.equal(confirmed.includes(key), false);
});

test('authoritative NONE defeats cached historical check-in; checkout cannot use it', async () => {
  const {client, backend, vault, env} = await setup(); await client.login('fixture-user', 'fixture-password');
  await vault.saveConfirmation(4, receipt());
  const action = new AttendanceAction({client, vault, environment: env, locate: async () => { throw new Error('No GPS expected'); }});
  assert.equal((await action.recover(4)).state, 'NONE');
  await rejects(action.perform('CHECK_OUT', 17, 4), 'ATTENDANCE_STATE_UNKNOWN');
  assert.equal(backend.actionCalls.length, 0);
});

test('interrupted check-in is recovered after reload without raw GPS or a success event', async () => {
  const {client, backend, vault, env} = await setup(); await client.login('fixture-user', 'fixture-password'); backend.loseAttendance = true;
  const first = new AttendanceAction({client, vault, environment: env, locate: async () => input().location});
  await rejects(first.perform('CHECK_IN', null, 4), 'NETWORK_FAILURE');
  const saved = await vault.pending(); assert.match(saved.operation, /^[0-9a-f]{32}$/); assert.equal(Object.hasOwn(saved, 'raw'), false);
  const phases = []; const reloaded = new AttendanceAction({client, vault, environment: env, notify: value => phases.push(value.phase)});
  const state = await reloaded.recover(4); assert.equal(state.state, 'OPEN'); assert.equal(state.checkout_eligible, true);
  assert.equal(reloaded.pending, null); assert.equal(await vault.pending(), null); assert.equal(reloaded.receipt, null);
  assert.equal(phases.includes('confirmed'), false); assert.equal(reloaded.phase, 'reconciled');
  assert.equal(backend.actionCalls.length, 1);
});

test('interrupted checkout reconciles closed state; admin closure never becomes GPS success', async () => {
  const {client, backend, vault, env} = await setup(); await client.login('fixture-user', 'fixture-password');
  const action = new AttendanceAction({client, vault, environment: env, locate: async () => input().location});
  await action.perform('CHECK_IN', null, 4); await action.recover(4); backend.loseAttendance = true;
  await rejects(action.perform('CHECK_OUT', 17, 4), 'NETWORK_FAILURE');
  const state = await action.recover(4); assert.equal(state.state, 'CLOSED'); assert.equal(action.phase, 'reconciled'); assert.equal(action.receipt, null);
  const pending = {action: 'CHECK_OUT', attendanceId: 17, ownerUserId: 4, operation: identifier(webcrypto)}; await vault.savePending(pending);
  backend.currentState = {...state, attendance: {...state.attendance, closure: 'ADMIN_UNVERIFIED'}};
  const restored = new AttendanceAction({client, vault, environment: env}); const admin = await restored.recover(4);
  assert.equal(admin.attendance.closure, 'ADMIN_UNVERIFIED'); assert.equal(restored.phase, 'reconciled'); assert.equal(restored.receipt, null);
});

test('unresolved read retains original bytes for a real fresh-proof retry', async () => {
  const {client, backend, vault, env} = await setup(); await client.login('fixture-user', 'fixture-password');
  let fail = true; backend.fail = async path => { if (fail && path === '/api/staff/attendance/check-in') throw new Error('Fixture request did not reach server'); };
  const action = new AttendanceAction({client, vault, environment: env, locate: async () => input().location});
  await rejects(action.perform('CHECK_IN', null, 4), 'NETWORK_FAILURE'); const raw = action.pending.raw;
  const state = await action.recover(4); assert.equal(state.state, 'NONE'); assert.equal(action.pending.raw, raw);
  fail = false; await action.retry(4); assert.equal(backend.actionCalls[0].raw, raw); assert.equal(action.phase, 'confirmed');
});

test('unrelated open row cannot falsely resolve an uncertain check-in reference', async () => {
  const {client, backend, vault, env} = await setup(); await client.login('fixture-user', 'fixture-password');
  await vault.savePending({action: 'CHECK_IN', attendanceId: null, ownerUserId: 4, operation: identifier(webcrypto)});
  const row = receipt(); backend.currentState = {state: 'OPEN', check_in_eligible: false, checkout_eligible: true,
    attendance: {...row, closure: null}};
  const action = new AttendanceAction({client, vault, environment: env}); await action.recover(4);
  assert.ok(action.pending); assert.equal(action.phase, 'uncertain'); await rejects(action.retry(4), 'RETRY_BODY_UNAVAILABLE');
});

test('failed state authorization invalidates checkout authority and retains unresolved marker', async () => {
  const {client, backend, vault, env} = await setup(); await client.login('fixture-user', 'fixture-password');
  await vault.savePending({action: 'CHECK_IN', attendanceId: null, ownerUserId: 4, operation: identifier(webcrypto)});
  const action = new AttendanceAction({client, vault, environment: env});
  backend.fail = async path => path.startsWith('/api/staff/attendance/current') ? {ok: false, status: 403, json: async () => ({message: 'Invalid device'})} : null;
  await rejects(action.recover(4), 'SERVER_REJECTED'); assert.equal(action.current, null); assert.ok(action.pending);
});

test('a rejection after an uncertain request never authorizes a replacement operation', async () => {
  let uncertain = true;
  const action = new AttendanceAction({client: {attendance: async () => { if (uncertain) throw new StaffError('NETWORK_FAILURE'); throw new StaffError('GPS_STALE', 403); }}, vault: new MemoryVault(), environment: environment(), locate: async () => input().location});
  await rejects(action.perform('CHECK_IN', null, 4), 'NETWORK_FAILURE'); const raw = action.pending.raw; uncertain = false;
  await rejects(action.retry(4), 'GPS_STALE'); assert.equal(action.phase, 'uncertain'); assert.equal(action.pending.raw, raw); await assert.rejects(action.discardRejected());
});

test('a definitive rejection remains safely replaceable after reload without storing GPS', async () => {
  const {client, backend, vault, env} = await setup(); await client.login('fixture-user', 'fixture-password');
  backend.rejectAttendance = {message: 'Location reading is too inaccurate.', status: 403};
  const first = new AttendanceAction({client, vault, environment: env, locate: async () => input().location});
  await rejects(first.perform('CHECK_IN', null, 4), 'GPS_INACCURATE');
  const reloaded = new AttendanceAction({client, vault, environment: env}); await reloaded.recover(4);
  assert.equal(reloaded.phase, 'failure'); await reloaded.discardRejected(); assert.equal(reloaded.pending, null);
  assert.equal(JSON.stringify([...vault.entries]).includes('latitude'), false);
});
