# Phase 5B.1C — Personal Staff device binding

Implementation only: Staff remains OFF. No live Omar migration, frontend, server
restart, attendance, GPS, payroll or Mini changes.

## Protocol
Activation/recovery now returns a 15-minute, single-use opaque enrollment grant,
stored only as an HMAC digest and bound to the explicit User link/auth version.
No operational token is issued by these flows.

1. POST /api/staff/device-enrollments: enrollment_grant + public_jwk (ES256/P-256).
   Server mints the device ID. Private JWK material is rejected, and only canonical
   public coordinates are stored. New device is PENDING without a session.
2. GET /api/admin/employees/{id}/staff-devices: manager inventory.
3. POST .../staff-devices/{device_id}/approve: reason + replace_device_id (null for
   first device, exact current ACTIVE ID for replacement). SUPER_ADMIN/EXEC_ADMIN
   only. Approval is not activation.
4. POST /api/staff/auth/device-challenges: device_id/purpose/method/target/body_hash.
5. POST /api/staff/device-enrollments/{device_id}/finalize: {} + signed DPoP.
6. POST .../staff-devices/{device_id}/revoke: mandatory manager reason.

Request P-256 keys through WebCrypto with extractable:false in the future Staff
client, persisted as CryptoKey objects rather than raw private-key exports.
No client UI is implemented here. Server cannot attest physical phone identity or
prove a custom client's private key is nonextractable. Clearing browser storage,
changing browser/profile/origin can require recovery and manager-approved replacement.
Device IDs/localStorage/user-agent values alone are never trusted.

## Proof contract
JWT JWS header: alg=ES256, typ=staff-device-proof+jwt, jwk=public key.
POST challenge returns challenge_id, challenge nonce, device_id, purpose, htm,
htu, body_hash, ath and expires_at. Sign these plus integer iat and fresh random
jti (16–128 characters). Nonce expires after 60 seconds and is stored hashed.

body_hash is lowercase SHA-256 hex of exact target HTTP body bytes (empty for GET).
htu includes the approved HTTPS origin, exact path and query. ath is SHA-256
base64url of the access/refresh token for authenticated requests; null for login
and finalization. Request DPoP and X-Staff-Device headers are required for operational
calls. Challenge issuance for refresh/logout uses existing Staff cookie + CSRF;
protected request challenges use Staff access bearer. Session/caller/device owners
must match. All validation is server-side.

Grant consumption, device changes and proof checks serialize on the User row,
then reload locked device/grant/challenge rows to avoid stale identity-map values.
A PostgreSQL partial UNIQUE index enforces one ACTIVE device per employee. Concurrent
approvals can remain APPROVED, but only the first matching finalization activates;
a stale approval cannot silently replace the winner without explicit manager review.
Replacement marks old device REPLACED and revokes its sessions atomically before
activating the new key. Revocation works even if the employee/account is inactive.
Audit history records device, manager/employee actor, action, reason and timestamps.

Login, refresh, protected reads and active-session logout verify real signatures,
nonce/jti reuse, expiry, auth version, method, URI/query, body and token hash.
Access/refresh JWTs include device_id and cnf.jkt; sessions have a device FK.
Legacy unbound sessions are not backfilled and cannot authenticate. Refresh replay
is evaluated only after device proof, so a stolen old token alone cannot revoke a
session. Successful protected reads commit one-time proof consumption. Normal logout
revokes session/cookies but preserves registered key/device. Already revoked sessions
may clear cookies using valid CSRF without reactivating the device.

## Validation and migration
66 backend tests and 4 existing Admin/Mini Auth UI tests passed. Auth tests now use
real ES256 signatures instead of mocking the device gate. Coverage includes pending
rejection, single-use enrollment, manager roles, cross-owner selection, key/body/
method/URI/token mismatches, expired/replayed challenges, repeated jti, durable GET
proof consumption, recovery invalidation, replacement, revocation, logout and refresh.

New additive revision: zu_staff_personal_devices, parent zt_staff_auth_sessions;
60 source revisions, one head. New tables: staff_enrollment_grants, staff_devices,
staff_device_challenges, staff_device_audit; nullable device FK on staff_sessions.
Populated downgrade refuses loss of device/grant/audit history.

Disposable PostgreSQL 16 on verified Omar 127.0.0.1:55432 checks the actual migration
round trip, concurrent grant use (201/401), concurrent approvals/finalization (200/409),
atomic replacement/session revocation, raw partial-index race (23505), preserved
historical fixture fingerprints and nonempty downgrade rejection. One exact temporary
SCRAM HBA rule is backed up, parsed, reloaded and restored; only the owned disposable
DB is dropped. The live omar_fahim_local database is never connected to by this test.

## Before enabling
- Separate approval to migrate the LIVE isolated Omar database through zs/zt/zu.
- A stable HTTPS Staff origin, trusted TLS/same-origin deployment and explicitly
  configured STAFF_TRUSTED_ORIGINS; defaults remain empty/disabled.
- Future Staff client must implement nonextractable key storage, this exact proof
  contract, CSRF and serialized refresh; validate real browser/PWA behavior.
- Employee-details device UI remains a separate phase. No physical-phone/GPS
  anti-spoofing or real mobile testing is claimed here.

## Exact files
Modified: backend/app/models/__init__.py, backend/app/models/staff_auth.py,
backend/app/services/staff_auth_service.py, backend/app/api/staff.py,
backend/app/api/admin_staff_identity.py, backend/tests/test_staff_auth.py,
backend/tests/test_omar_readiness.py.
New: backend/app/models/staff_device.py, backend/app/services/staff_device_service.py,
backend/migrations/versions/zu_staff_personal_devices.py,
backend/tests/staff_device_support.py, backend/tests/test_staff_device.py,
local/omar/STAFF_DEVICE_BINDING.md.
