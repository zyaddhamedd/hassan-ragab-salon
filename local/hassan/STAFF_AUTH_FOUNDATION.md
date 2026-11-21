# Phase 5B.1B — Staff authentication/session foundation

Source preparation only. STAFF_IDENTITY_ENABLED remains False; no live migrations,
accounts, passwords, auth requests or application restarts were performed.

## Operational boundary
`require_device_binding()` deliberately always refuses login/session renewal and
protected Staff access until Phase 5B.1C implements real personal-device proof.
There is no boolean/configuration bypass. Tests mock this function locally only
to exercise the session core; their success is not a live device/login claim.
Activation/recovery do not issue sessions. Logout remains usable for revocation.
Default Config and the validated Omar runtime retain the feature OFF.

## Contracts
Admin (existing Admin JWT, live SUPER_ADMIN/EXEC_ADMIN, identity/Omar guards):
- POST /api/admin/employees/{id}/staff-identity/codes, {"purpose":"activation"}
  or {"purpose":"recovery"}. Returns a fresh code once for personal management
  delivery. No email/SMS integration; no plaintext codes stored in the database.
- POST /api/admin/employees/{id}/staff-identity/revoke-sessions, {}.

Staff, under /api/staff:
- POST /auth/activate and /auth/recover: username/code/password only.
- POST /auth/login: username/password only (device gate closed).
- POST /auth/refresh and /auth/logout: dedicated refresh cookie + CSRF proof.
- GET /me: Staff access bearer + current session/account/employee checks + device
  gate; explicit foundation serializer, never Employee.to_dict().

Account must first be administratively active and employee/branch eligible.
Password activation and administrative account activation are distinct. Existing
linked account passwords do not grant Staff access until code activation completes.
Passwords: 12–128 characters, existing Werkzeug hashing. Codes: 256-bit random,
15-minute expiry, HMAC digests, bound to user/purpose/auth version, single-use,
prior pending codes revoked on reissue. Code consumption locks the user/code,
updates password/version and revokes existing sessions atomically.

## Sessions and cookies
Existing Flask-JWT-Extended signing is reused; global Admin/Mini JWT settings are
unchanged. Staff validates token_type=staff, aud=omar-staff, role=EMPLOYEE, JWT type,
subject, session ID and auth version explicitly, then checks current database state.
Access lifetime <=15 minutes; session/refresh absolute lifetime <=7 days.
Refresh rotation is serialized by user/session row locks; old signed refresh reuse
revokes the session family. Concurrent refresh callers must be serialized by the
future client; no replay grace window is introduced. Refresh/CSRF credentials are
stored as digests; refresh values never returned in JSON.

`omar_staff_refresh`: Secure, HttpOnly, SameSite=Strict, host-only,
Path=/api/staff/auth. `omar_staff_csrf`: Secure, SameSite=Strict, host-only,
readable at / so a future app can send X-Staff-CSRF; it is not authentication.
Refresh/logout require matching CSRF cookie/header, server digest and exact trusted
HTTPS Origin. No trust in arbitrary forwarded headers. Responses are no-store.
STAFF_TRUSTED_ORIGINS defaults empty; no new public origin was enabled.

Atomic database rate limits: five attempts/account/purpose/15min and 30/IP/purpose/
15min (refresh 30/IP). IP limit is checked before adding username keys. Counters
survive auth transaction failures. X-Forwarded-For is not trusted. Deployment behind
proxies requires an explicitly trusted proxy configuration, not spoofable headers.

Staff account mutations through legacy Omar Admin user edit/delete endpoints are
blocked even while Staff is paused, after existing authorization, to avoid bypassing
password-reset/session revocation. Default non-Omar behavior and Admin/Cashier targets
remain unchanged. Mini source and its auth behavior are untouched.

## Additive migration and validation
New head `zt_staff_auth_sessions` follows `zs_staff_identity_foundation` (59 source
revisions, one head). Adds deferred users.staff_password_initialized default false,
staff_auth_codes, staff_sessions and staff_auth_rates. No account backfill or data
matching. Downgrade refuses to delete initialized passwords, codes or sessions.
Real Omar DB remains at its previous revision; neither new migration was applied.

55 backend tests passed (17 new auth tests); 4 existing Admin/Mini Auth UI tests
passed. Tests use in-memory SQLite and offline PostgreSQL SQL compilation only;
PostgreSQL concurrency for these NEW session tables is not claimed verified.
Existing legacy pre-migration User CRUD compatibility tests still pass. No new
frameworks/dependencies, frontend, device enrollment or business logic.

## Before 5B.1C/public use
- Separately approve migrations zs + zt on the live isolated Omar database.
- Implement actual one-active-personal-device approval/proof, bind sessions/tokens
  to that device and replace the closed gate. No test mock may enter runtime config.
- Choose stable HTTPS Staff origin and secure same-origin proxy/TLS deployment;
  retain strict cookies/CSRF and explicit trusted origin. Cross-origin deployment
  requires deliberate Omar-only CORS/header approval.
- Verify PostgreSQL concurrent code consumption/refresh and real browser cookie,
  reload, expiry/logout and device behavior before enabling Staff.

Existing application servers remain running without restarts; no commit/push/deploy.

## Exact phase file manifest
Modified integration points:
- backend/app/__init__.py
- backend/app/config.py
- backend/app/models/__init__.py
- backend/app/models/user.py
- backend/app/api/admin_staff_identity.py
- backend/tests/test_omar_readiness.py
New files:
- backend/app/api/staff.py
- backend/app/models/staff_auth.py
- backend/app/services/staff_auth_service.py
- backend/migrations/versions/zt_staff_auth_sessions.py
- backend/tests/test_staff_auth.py
- local/omar/STAFF_AUTH_FOUNDATION.md
