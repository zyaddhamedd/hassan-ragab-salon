# Omar Staff — real client

Isolated vanilla ES-module application. The approved simulator stays unchanged at
`../prototypes/staff/`; this application contains no simulated attendance success.
It reuses that prototype's exact stylesheet and existing Omar brand assets.

```sh
npm --prefix local/omar/staff test
npm --prefix local/omar/staff run build
npm --prefix local/omar/staff run verify-build
```

No install is required: runtime/build use browser APIs and Node built-ins. One
cryptographic interoperability test uses the workspace's existing private Python
venv to call the pure backend proof verifier; it does not construct an app or
connect to a database. All HTTP responses and geolocation in tests are mocked.

Build output: `.local/omar/staff-build/` (self-contained static HTML/CSS/ES modules,
brand assets and hash manifest). It excludes tests, source credentials and backend
files. No server is started or published by these commands.

Real usage requires a trusted HTTPS origin serving this artifact and the EXISTING
`/api/staff/*` routes on the same origin, including secure cookie paths. Staff must
be enabled through a separately authorized backend/schema activation procedure.
HTTP localhost/file previews intentionally cannot authenticate, sign requests or
collect location. There is no development HTTPS/security bypass.

Browser requirements: WebCrypto ECDSA P-256, IndexedDB CryptoKey structured-clone
support, Web Locks, secure cookies and geolocation. The app fails closed if secure
key storage/lifecycle locking is unavailable. Private keys are nonextractable;
access tokens are in memory, refresh tokens remain in backend HttpOnly cookies.
Enrollment/recovery requires an actual manager approval through the existing
administrative flow. Refresh/login/logout/enrollment operations share an origin-wide
Web Lock; refresh reads the latest secure CSRF cookie after acquiring that lock.

For uncertain attendance responses, keep the page open and retry. Pending bytes
(including one location sample and the original checkout ID) stay only in memory.
Each retry signs a new challenge over exactly those bytes. No background queue,
location history, offline acceptance or automatic replacement request exists.
Do not reload or clear browser data to troubleshoot a pending attendance action.

Authoritative state is restored through signed `GET /api/staff/attendance/current`
after login/refresh/reload and before new attendance. Checkout uses only its eligible
OPEN ID; cached confirmations never authorize checkout. Open overnight attendance
uses the backend's frozen shift/date projection.

An unresolved write persists only a non-GPS operation marker (owner, action, original
checkout ID and idempotency key). An optional signed `operation` query resolves its
own committed receipt without exposing security evidence. Reconciliation updates
state without generating a new confirmation event/animation. If the server cannot
resolve it, the original in-memory bytes remain available for fresh-proof retry.
After reload those GPS bytes are deliberately unavailable: if no committed receipt
is found, keep refreshing the state or seek manager review; do not guess failure or
create a replacement attendance. No background queue exists.

Enrollment response loss before the device ID still requires a manager-reviewed
device reference; a lost finalization response can be resolved by actual key-bound
login, which succeeds only for an ACTIVE backend device.

See `../STAFF_ATTENDANCE_STATE_RESULT.md` for validation and remaining acceptance work.
