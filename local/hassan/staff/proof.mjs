// Existing Staff proof protocol. Private keys never leave WebCrypto/IndexedDB.
const encoder = new TextEncoder();
export const bytes = value => encoder.encode(value);
export const b64 = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
export const hex = value => [...new Uint8Array(value)].map(v => v.toString(16).padStart(2, '0')).join('');
export const digest = async (value, crypto = globalThis.crypto) => crypto.subtle.digest('SHA-256', bytes(value));
export const identifier = (crypto = globalThis.crypto) => hex(crypto.getRandomValues(new Uint8Array(16)));
export function requireSecure(environment = globalThis) {
  if (!environment.isSecureContext || environment.location.protocol !== 'https:' || !environment.crypto?.subtle) {
    throw new Error('SECURE_CONTEXT_REQUIRED');
  }
}
export function validateDevice(device) {
  const key = device?.privateKey;
  if (!key || key.type !== 'private' || key.extractable !== false || key.algorithm?.name !== 'ECDSA' ||
      key.algorithm.namedCurve !== 'P-256' || key.usages.length !== 1 || key.usages[0] !== 'sign' ||
      device.publicJwk?.kty !== 'EC' || device.publicJwk?.crv !== 'P-256' || 'd' in device.publicJwk) {
    throw new Error('DEVICE_KEY_UNAVAILABLE');
  }
  if (device.deviceId && !/^[0-9a-f]{32}$/.test(device.deviceId)) throw new Error('DEVICE_KEY_UNAVAILABLE');
  return device;
}
export async function createDevice(crypto = globalThis.crypto) {
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return validateDevice({privateKey: pair.privateKey, publicJwk: {crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y}, state: 'prepared'});
}
export async function signedProof(device, challenge, {purpose, method, target, raw, token, origin, now = Date.now()}, crypto = globalThis.crypto) {
  validateDevice(device);
  const hash = hex(await digest(raw, crypto));
  const ath = token ? b64(await digest(token, crypto)) : null;
  const cookieProof = purpose === 'refresh' || purpose === 'logout';
  if (!challenge || !/^[0-9a-f]{32}$/.test(challenge.challenge_id) ||
      typeof challenge.challenge !== 'string' || challenge.challenge.length < 32 || challenge.challenge.length > 128 ||
      challenge.device_id !== device.deviceId || challenge.purpose !== purpose || challenge.htm !== method ||
      challenge.htu !== origin + target || challenge.body_hash !== hash ||
      (cookieProof ? !/^[A-Za-z0-9_-]{43}$/.test(challenge.ath) : challenge.ath !== ath) ||
      !Number.isFinite(Date.parse(challenge.expires_at)) || Date.parse(challenge.expires_at) <= now) {
    throw new Error('INVALID_DEVICE_CHALLENGE');
  }
  const header = b64(bytes(JSON.stringify({alg: 'ES256', typ: 'staff-device-proof+jwt', jwk: device.publicJwk})));
  const payload = b64(bytes(JSON.stringify({challenge_id: challenge.challenge_id, challenge: challenge.challenge,
    device_id: device.deviceId, purpose, htm: method, htu: origin + target, body_hash: hash, ath: challenge.ath,
    iat: Math.floor(now / 1000), jti: identifier(crypto)})));
  const signature = await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, device.privateKey, bytes(header + '.' + payload));
  if (signature.byteLength !== 64) throw new Error('DEVICE_SIGNATURE_UNSUPPORTED');
  return header + '.' + payload + '.' + b64(signature);
}
