# Phase 5D.4B — authoritative Staff attendance and recovery

Implemented in standalone source on `feat/omar-fahim-setup`. Staff remains OFF.
No operational database query/migration/write, server restart, deployment, commit
or push. No Admin/Mini or prototype modification. The old Omar worktree and Nady
were not accessed. Prior uncommitted phase work is retained.

## Endpoint contract

`GET /api/staff/attendance/current`

Optional: `?operation=<32 lowercase hex idempotency key>` for the caller's own
interrupted operation. No employee/branch selector, other query fields, duplicate
operation parameters or GET body is accepted.

Existing Staff Bearer session, ACTIVE approved personal device, HTTPS, trusted
proof origin, one-time request challenge, ES256 signature and both feature guards
are mandatory. The existing `purpose=request` proof allowlist now accepts this GET.
The full target, including optional operation query, is signed with the existing
protocol. There is no alternative authentication/proof scheme.

Response fields:

- `state`: `NONE`, `OPEN`, `CLOSED`, `REVIEW_REQUIRED` or `BLOCKED_LEGACY`.
- `check_in_eligible`, `checkout_eligible`: row-state eligibility, not a promise of
  GPS/configuration acceptance. All write validations still execute on a new action.
- `attendance`: null, or the employee's own Staff attendance ID, business date,
  UTC check-in/out timestamps, closure category and safe frozen shift projection.
- `closure`: null, `GPS_VERIFIED` or `ADMIN_UNVERIFIED`. No administrative actor,
  private reason, proof details or GPS information is returned.
- `observed_at`: UTC server observation time.
- `recovery`: null, or `{action, attendance_id, committed:true}` for the supplied
  own operation reference. It is a logical operation correlation, not a new event
  confirmation or disclosure of internal proof evidence.

`NONE` means no open attendance and no relevant Staff row. `CLOSED` means no open
row with the latest own Staff row closed (possibly from a previous business date).
`OPEN` requires a consistent open STAFF_GPS row in the employee's current branch,
with the existing own check-in receipt and matching frozen snapshot. Only that
state can enable checkout. Legacy open rows block Staff actions without exposing
legacy details. Branch mismatch, missing evidence or inconsistent/ambiguous open
state fails closed for review. Own historical closure remains readable after a
transfer; it never authorizes checkout in the old branch.

The data service rechecks current identity/session/device/employee/operating-branch
eligibility together with Attendance, receipt and shift in ONE MVCC SELECT. No
Employee/Attendance FOR UPDATE is added and no shift is frozen. Existing auth
locking and one-time proof-consumption writes remain unchanged. Attendance and
planning data are not mutated. Responses retain no-store headers.

This is a point-in-time read, not a lease: a later transfer/checkout may change
state. Existing write locks/rechecks remain authoritative.

## Frontend behavior

The real Staff app reads authoritative state after login/session restoration/reload,
on explicit refresh, before any new attendance action, and after successful writes.
Checkout is enabled only for the returned eligible OPEN ID. Historical IndexedDB
confirmations never supply checkout authority. Open overnight attendance uses the
backend's frozen shift and business date in the home card. Read/authorization
failures clear current authority and disable new actions until a successful read.

Before writing, only a non-GPS pending marker is persisted: owner, action,
idempotency key, original checkout ID and conservative outcome flags. Exact JSON
bytes/GPS remain in volatile memory only. The optional signed operation reference
lets the server identify a committed interrupted action even when another Staff
attendance is now the latest row.

A matching committed reference reconciles the UI and clears pending work. A closed
original checkout target also resolves checkout without attributing an administrative
closure to GPS or the employee. Reconciliation uses its own UI phase: no new success
receipt is created and no ignition/success animation is replayed.

If a read does not resolve the operation, its original bytes/key/ID remain intact
for a fresh-proof retry. Merely observing some other open row is not evidence that
this interrupted check-in committed. A rejection received after an uncertain result
never automatically permits replacement; the original may still be in flight.
Known definitive rejections remain deliberately replaceable, including after reload.

After reload, the pending marker survives but GPS/request bytes do not. If the
server has no committed result yet, the app offers state refresh/manager review and
blocks a guessed replacement or a retry with reconstructed GPS bytes. This is the
necessary conservative boundary for an unresolved potentially in-flight request;
a read cannot prove cancellation or reconstruct deliberately unpersisted location.

No automatic location collection, queue, forgotten checkout, requests, payroll,
financial change or manager review-resolution flow was added. Approved styling,
physical 1400ms hold, simulation separation and existing signature infrastructure
remain intact.

## Files changed in this phase

Backend:

- `backend/app/api/staff.py` — protected GET route.
- `backend/app/services/staff_device_service.py` — existing signed GET target extension.
- `backend/app/services/staff_attendance_service.py` — scoped consistent read projection.
- `backend/tests/test_staff_attendance_current.py` — six isolated signed read tests.
- `backend/tests/test_staff_attendance_postgres.py` — real checkout/read concurrency test.

Staff frontend under `local/omar/staff/`:

- `client.mjs` — signed current-state request with optional operation reference.
- `vault.mjs` — allowlisted, coordinate-free pending marker.
- `attendance.mjs` — response validation, checkout gating, recovery/reconciliation,
  conservative retry/rejection handling.
- `app.mjs`, `index.html` — restored authoritative state, eligible ID, explicit refresh,
  recovered status without success animation, frozen overnight shift display.
- `tests/integration.test.mjs`, `tests/support.mjs` — current/recovery fixtures and regressions.
- `README.md` — current integration/recovery instructions.
- This report.

**No migration added or changed.** The existing reported operational revision
`zr_payroll_settlement_ledger` was not queried or altered.

## Tests and build

- Full backend regression command with disposable PostgreSQL enabled: **140 passed,
  zero failures/skips**. Six new signed read tests cover employee isolation,
  optional operation lookup, parameter rejection, NONE/OPEN/CLOSED/admin-unverified,
  branch mismatch, missing evidence, legacy blocking, revoked devices, feature guards,
  privacy, no attendance mutation or implicit freeze. Final focused read tests also pass.
- Real concurrent checkout/state-read test: reader safely serializes through existing
  auth, then observes consistent CLOSED fields after commit. SQL capture confirms
  exactly one Attendance SELECT, no Attendance FOR UPDATE and no Attendance writes
  from the read. Previous write-race/security/DST/geofence regressions still pass.
- **35 frontend tests passed**, including all prior 27 tests and eight recovery cases:
  cached history cannot authorize checkout; reload resolves committed check-in;
  closed/admin-unverified checkout reconciles without animation; unresolved reads
  retain exact bytes; unrelated open records do not resolve an operation; revoked
  state reads remove authority; uncertain-then-rejected remains blocked; definitive
  rejection survives reload without GPS persistence.
- Production build and verification passed: 12 runtime files plus manifest in
  `.local/omar/staff-build/`; asset hashes/imports, local references, CSP, approved CSS
  identity and simulation separation verified.
- `git diff --check` and unchanged prototype diff check passed.

All attendance writes in tests are synthetic isolated fixtures or mocked responses.
PostgreSQL tests initialize owner-only temporary clusters with TCP disabled and a
private Unix socket, verify identity, and stop/remove those clusters on cleanup.
No operational endpoint was called. No real browser/device acceptance is claimed.

Private logs: `.local/omar/r5c/5d4b-backend.log`, `5d4b-current.log`,
`5d4b-frontend.log`.

## Remaining mobile QA prerequisites

The missing authoritative state-read contract is now implemented. Live acceptance
still requires a separately authorized migration/runtime plan for the pending Staff
schema chain, trusted same-origin HTTPS, reviewed geofence configuration and an
approved test identity/personal device. Do not restart changed ORM source against
the unmigrated operational schema.

Use an isolated migrated test backend for browser/mobile acceptance: CryptoKey
IndexedDB persistence, Web Locks/cookie rotation, actual GPS permissions, reload
following lost responses, admin closure, transfer, exact retry and touch/keyboard/
visibility behavior. No operational attendance writes are authorized by this phase.
Pending enrollment ID recovery still uses the manager-reviewed flow described in
5D.4A; no new enrollment/status API was introduced. If an interrupted action has no
receipt after reload and its original bytes are lost, retain the conservative
refresh/review path rather than inventing failure or cancellation.

Staff remains OFF. No operational cutover was performed.
