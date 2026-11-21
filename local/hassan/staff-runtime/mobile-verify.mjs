// Actual frontend WebCrypto/client against real isolated TLS APIs. Not an iPhone.
// Trust is added only to this Node process via NODE_EXTRA_CA_CERTS, never bypassed.
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';
import assert from 'node:assert/strict';
import {StaffClient} from '../staff/client.mjs';
import {MemoryVault, locks} from '../staff/tests/support.mjs';
const privateRoot = fileURLToPath(new URL('../../../.local/omar/staff-integration/', import.meta.url));
const cfg = JSON.parse(await fs.readFile(privateRoot + 'config.json', 'utf8'));
assert.equal(cfg.environment, 'omar-disposable-staff-integration');
assert.match(cfg.mobile.origin, /^https:\/\/[a-z0-9-]+\.local:54444$/);
const origin = cfg.mobile.origin, nativeFetch = globalThis.fetch;
const health = await nativeFetch(origin + '/health').then(r => r.json()); assert.equal(health.integration_id, cfg.integration_id);
const accounts = JSON.parse(await fs.readFile(privateRoot + 'accounts.json', 'utf8'));
const account = accounts.staff.find(a => a.purpose === 'field_probe');
assert.ok(account && !account.mobile_client_verified_at, 'Refuse duplicate fixture activation');
const jar = new Map();
async function mobileFetch(path, options) {
  assert.ok(path.startsWith('/api/staff/'));
  const cookies = [...jar.values()].filter(c => path.split('?')[0].startsWith(c.path)).map(c => c.name + '=' + c.value).join('; ');
  const response = await nativeFetch(origin + path, {...options, headers: {...options.headers, Origin: origin, ...(cookies ? {Cookie: cookies} : {})}});
  for (const value of response.headers.getSetCookie()) {
    const parts = value.split(';').map(p => p.trim()), at = parts[0].indexOf('=');
    const cookie = {name: parts[0].slice(0, at), value: parts[0].slice(at + 1), path: '/', secure: parts.includes('Secure'), httpOnly: parts.includes('HttpOnly')};
    for (const part of parts) if (part.toLowerCase().startsWith('path=')) cookie.path = part.slice(5);
    if (parts.some(p => p.toLowerCase() === 'max-age=0')) jar.delete(cookie.name); else jar.set(cookie.name, cookie);
  }
  return response;
}
const document = {get cookie() { return [...jar.values()].filter(c => !c.httpOnly && c.path === '/').map(c => c.name + '=' + c.value).join('; '); }};
const environment = {isSecureContext: true, crypto: webcrypto, location: {protocol: 'https:', origin}, document, navigator: {onLine: true, locks: locks()}};
const vault = new MemoryVault(); const client = new StaffClient({vault, environment, fetch: mobileFetch}); await client.initialize();
await client.provision('activate', account.username, account.activation_code, account.password);
assert.equal(client.binding, null); assert.equal(client.candidate.privateKey.extractable, false);
await assert.rejects(client.finalize(), e => e.code === 'DEVICE_PENDING');
const managerLogin = await nativeFetch('https://localhost:54443/api/admin/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://localhost:54443'}, body: JSON.stringify(accounts.manager)});
assert.equal(managerLogin.status, 200); const token = (await managerLogin.json()).access_token;
const id = client.candidate.deviceId;
async function managerAction(action, body) {
  const response = await nativeFetch(`https://localhost:54443/api/admin/employees/${account.employee_id}/staff-devices/${id}/${action}`, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://localhost:54443', Authorization: 'Bearer ' + token}, body: JSON.stringify(body)});
  assert.equal(response.status, 200);
}
await managerAction('approve', {replace_device_id: null, reason: 'Synthetic field WebCrypto readiness approval'});
await client.finalize(); await client.login(account.username, account.password);
const profile = await client.profile(); assert.equal(profile.identity.employee_id, account.employee_id);
assert.equal((await client.current()).state, 'NONE');
assert.ok(Array.isArray((await client.shifts(new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10))).shifts));
assert.equal(jar.get('omar_staff_refresh').secure, true); assert.equal(jar.get('omar_staff_refresh').httpOnly, true);
client.access = null; client.expiry = 0; await client.refresh(); assert.equal((await client.profile()).identity.user_id, account.user_id);
const reloaded = new StaffClient({vault, environment, fetch: mobileFetch}); await reloaded.initialize(); await reloaded.refresh(); assert.equal((await reloaded.current()).state, 'NONE');
for (const path of ['/api/admin/auth/login', '/api/admin/employees/2/staff-devices', '/api/admin/invoices', '/ca-key.pem', '/config.json', '/accounts.json']) {
  const response = await nativeFetch(origin + path, {method: path.endsWith('login') ? 'POST' : 'GET', headers: {Origin: origin, 'Content-Type': 'application/json'}, ...(path.endsWith('login') ? {body: '{}'} : {})});
  assert.equal(response.status, 404, path);
}
const spoofed = await nativeFetch(origin + '/api/admin/auth/login', {method: 'POST', headers: {Host: 'localhost:54443', 'Content-Type': 'application/json'}, body: '{}'}); assert.equal(spoofed.status, 404);
for (const path of ['/', '/app.mjs', '/field-check', '/field-check.mjs']) {
  const response = await nativeFetch(origin + path); assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-security-policy').includes("connect-src 'self'"));
  if (path.endsWith('.mjs')) assert.ok(response.headers.get('content-type').startsWith('text/javascript'));
}
const ipResponse = await nativeFetch(`https://${cfg.mobile.bind_ip}:54444/health`); assert.equal(ipResponse.status, 200);
assert.equal((await ipResponse.json()).integration_id, cfg.integration_id);
await reloaded.logout(); await managerAction('revoke', {reason: 'Synthetic WebCrypto readiness completed'});
account.mobile_client_verified_at = new Date().toISOString(); account.mobile_probe_device_id = id; account.mobile_probe_device_state = 'REVOKED';
await fs.writeFile(privateRoot + 'accounts.json', JSON.stringify(accounts, null, 2) + '\n', {mode: 0o600});
await fs.writeFile(privateRoot + 'mobile-readiness.json', JSON.stringify({origin, bind: cfg.mobile.bind_ip, tls: 'CA_AND_HOSTNAME_VERIFIED',
  webcrypto: 'REAL_NONEXTRACTABLE_NODE_WEBCRYPTO_AND_PRODUCTION_FRONTEND_CLIENT', session_restore: 'VERIFIED_REAL_TLS_API',
  storage: 'IN_MEMORY_STRUCTURED_CLONE_NOT_NATIVE_IPHONE_INDEXEDDB', admin_on_mobile: 'BLOCKED', secrets: 'NOT_SERVED',
  phone_trust: 'UNVERIFIED', physical_GPS: 'NOT_TESTED', attendance_writes: 0, probe_device: 'REVOKED'}, null, 2) + '\n', {mode: 0o600});
console.log('Mobile origin TLS/SAN, actual frontend WebCrypto/proofs/login/refresh/state, LAN binding and admin/secret blocking verified. Actual iPhone trust/GPS remain unverified.');
