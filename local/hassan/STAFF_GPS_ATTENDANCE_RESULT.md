# Phase 5D.2B — real Staff GPS attendance backend

Implemented in standalone source on `feat/omar-fahim-setup`. Staff remains OFF in
both Config and the dedicated Omar launcher. No operational database connection,
migration, stamp, account/device change, server restart, frontend change, commit,
push or deployment was performed. Nady and the old Omar worktree were not inspected
or modified. Existing uncommitted 5D.2A work is retained.

## Endpoints and authority

- `POST /api/staff/attendance/check-in`
- `POST /api/staff/attendance/check-out`

Both return HTTP 200 with a confirmed event receipt on success/retry, and require
the existing Omar/Staff feature guards, a valid Staff access token, an active linked
employee, an ACTIVE manager-approved personal device bound to the session, trusted
HTTPS Origin, and signed P-256 request proof. They accept no employee/branch ID or
attendance timestamp from the client.

Use existing `POST /api/staff/auth/device-challenges` with `purpose=request`,
`method=POST`, the exact attendance endpoint as `target` (no query), the device ID,
SHA-256 of the exact JSON request bytes, and the Staff Bearer token. Submit the
existing DPoP proof format with Bearer authorization and `X-Staff-Device` to the
attendance endpoint. Existing signature/nonce, body, method, target, token hash,
origin, expiry, device state and unique proof-JTI checks are reused.

Check-in JSON has exactly:

- `idempotency_key`: client-generated 32-character lowercase hexadecimal key.
- `location`: exactly `latitude`, `longitude`, `accuracy_m`, and timezone-aware
  ISO `captured_at`.

Checkout adds exactly `attendance_id`, the ID returned by that employee's confirmed
check-in. This is validated against the authenticated employee, origin, branch and
locked open state; it never selects another employee. An old checkout request
cannot close a newer attendance row.

One-time proof consumption commits before the mutation and remains consumed even
if geofence/business validation fails. Before writing, the service re-locks and
refreshes session/user/device state, then Employee and Attendance, and rechecks
eligibility. A tested revocation between proof consumption and the write is rejected.
Attendance/shift/proof receipt mutations commit together or roll back together.

## Geofence and privacy

Every new check-in AND checkout validates the authenticated employee's current
operating branch and latest immutable geofence version through the existing
geofence evaluator. A Branch lock serializes against configuration changes; server
time is sampled after acquiring it. Missing/disabled/incomplete configuration,
stale/future/malformed readings, poor accuracy or an uncertainty disk extending
outside the radius fail closed. No radius is guessed or activated, and no offline
attendance timestamp is accepted.

Raw GPS coordinates, accuracy and capture time are not persisted in attendance
receipts, logged by the implementation or included in responses. Receipts store
only a keyed request digest and references to the device, consumed challenge,
geofence version, frozen shift, authenticated user and Attendance row, plus action,
idempotency key and server timestamp. Existing device challenges retain their
already established request-body hash, not the request body.

Responses use an explicit allowlist: attendance ID, confirmed action/time,
business date, check-in/out event time and the existing employee-safe frozen shift
projection. No salary, commission, payroll, device/proof audit or GPS information
is exposed. Response timestamps are normalized to UTC so first responses and
PostgreSQL-loaded retries are identical even when the DB timezone is Cairo.

## Existing engine, shifts and concurrency

The original Attendance table and `uq_employee_present` index remain authoritative.
New rows have `attendance_origin=STAFF_GPS` and `business_day_id=NULL`. Successful
Staff checkout sets `checkout_verification=STAFF_GPS_VERIFIED` only after proof,
state and geofence validation. It uses existing `checkout_source=MANUAL` without
extending the legacy enum. Administrative `ADMIN_UNVERIFIED` closures cannot be
overwritten or represented as GPS checkout. Legacy rows cannot be claimed by Staff.

Lock order is User/Session/Device -> Employee -> Attendance -> Branch. Transfer
and scheduling already serialize on Employee; attendance refreshes state after
locking. Concurrent Mini insertion is still bounded by the existing unique-open
index. Failed constraint/race writes return a sanitized conflict and roll back.
Existing Admin/Mini attendance paths were not changed in this phase.

Under the Employee lock, check-in resolves Cairo's current date, or the previous
START date when a previous overnight scheduled interval is still running. It uses
the existing expectation resolver and freezes only that applicable snapshot in the
same transaction as Attendance and its receipt. REST/UNASSIGNED remain explicit,
with no fabricated scheduled interval; attendance is allowed and those states are
reported as-is. A historical/frozen expectation from another branch fails closed
for manager scheduling review. Cairo autumn ambiguity uses the existing fold rule;
nonexistent spring times fail closed. Checkout reuses the original check-in's
snapshot across midnight rather than freezing/reinterpreting another date.

No financial BusinessDay, cashier session, deduction, payroll mutation, automatic
forgotten checkout or review-resolution workflow is created.

## Retry contract and immutable evidence

A successful event has one immutable `staff_attendance_receipts` row, not another
attendance record. Uniqueness covers user/key, attendance/action and challenge.
The receipt links to existing Attendance; it does not store an independent open
state or attendance timeline engine.

Retry an uncertain result with a FRESH signed challenge and exactly the SAME
request bytes/key (including original location and checkout ID). The endpoint
returns the original successful confirmation without another mutation. That
historical confirmation is allowed after the original reading becomes stale or
the geofence changes; it does not assert a new/live location or create offline
attendance. A different body/action under the same key conflicts. A failed request
that never committed a receipt can use a new fresh reading/proof; all validation
runs again. New logical actions need new keys. Reused signatures/challenges fail,
even when the logical action itself would otherwise be an idempotent retry.

PostgreSQL enforces immutable receipts and validates their device/challenge,
Attendance, branch/geofence and snapshot bindings at insertion. A new trigger
preserves an evidenced check-in's employee/branch/date/time/business-day anchor
while allowing the existing reviewed administrative closure path. 5D.2A's closed
Staff row immutability remains in force. A downgrade refuses to discard receipts.

## Files changed in this phase

- `backend/app/api/staff.py` — two protected attendance endpoints.
- `backend/app/services/staff_attendance_service.py` — transaction, GPS/shift,
  ownership, state, idempotency and safe response handling (new).
- `backend/app/models/staff_attendance.py` — coordinate-free proof receipt (new).
- `backend/app/models/__init__.py` — model registration.
- `backend/app/services/staff_device_service.py` — exact POST attendance proof
  targets and server-side verified challenge reference.
- `backend/app/services/staff_auth_service.py` — refresh locked session/user state
  and pass verified auth context to the attendance transaction.
- `backend/migrations/versions/zz_staff_gps_attendance.py` — single additive
  receipt table and integrity/immutability triggers (new).
- `backend/tests/test_staff_attendance.py` — 14 signed API/shift/security tests (new).
- `backend/tests/test_staff_attendance_postgres.py` — nine real endpoint/migration/
  concurrency tests (new); reuses the 5D.2A private-cluster lifecycle.
- `backend/tests/test_omar_readiness.py`, `local/omar/migration-graph.json` —
  reviewed graph now 65 revisions, one head `zz_staff_gps_attendance`.
- This report.

No existing migration was modified, including the uncommitted 5D.2A migration
`zy_staff_attendance_evidence`. The new migration's parent is that revision.
All 63 committed revision hashes/metadata are unchanged.

## Verification

Final command:

```sh
OMAR_ATTENDANCE_DISPOSABLE_PG=1 .local/omar/venv/bin/python -m unittest discover -s backend/tests -v
```

**133 tests passed; zero failures/skips** (119 offline + 14 isolated PostgreSQL).
This includes all previous Staff auth/device/geofence/shift and legacy attendance
compatibility tests, 14 new signed API tests and nine new real PostgreSQL tests.

Coverage includes:

- Successful check-in/checkout without a cashier day; safe receipts/responses.
- Signature, token, device, body, method, target, origin and expiry binding;
  replay rejection, query/ID injection and feature guards.
- Proof remains consumed after a transaction rollback; fresh-proof retry works.
- Latest disabled/unconfigured geofence and both action boundaries; bad accuracy,
  stale/future/malformed samples; no coordinate fields in receipt/response.
- REST/UNASSIGNED, Cairo overnight dates, spring/autumn elapsed durations,
  nonexistent DST times and checkout retaining its original frozen expectation.
- Real PostgreSQL lock waits for concurrent check-ins, repeated checkout with fresh
  proofs, concurrent identical-proof replay and BOTH actual transfer/checkout orders.
- Device/session revocation after committed proof but before mutation.
- Immutable check-in anchor/receipt/closure and guarded downgrade.
- Actual unchanged Staff migration upgrade functions from `zs` through `zz` applied
  to a modeled legacy PostgreSQL fixture; sentinel legacy attendance preserved.
  This is integration validation of the relevant chain, not certification against
  a clone of the full operational database.

Each PostgreSQL suite initializes a new cluster under `/private/tmp`, disables TCP,
uses an owner-only Unix socket directory, verifies its data-directory/server
identity and accepts no external DSN. Only that disposable cluster is migrated;
registered cleanup stops it and removes its temporary directory. Tests use bounded
lock/statement waits. The operational database was never queried by this phase.

`git diff --check` passed. Private test log:
`.local/omar/r5c/5d2b-all-tests.log`.

## Remaining activation prerequisites

1. Separately review an incremental migration/backup/rollback procedure from the
   reported operational revision `zr_payroll_settlement_ledger` through all pending
   Staff foundations, 5D.2A and this revision. No such migration is run here. The old
   empty-database migration runner remains unchanged/fail-closed; do not use it as
   an incremental upgrade shortcut or stamp the live database.
2. Do not restart the changed ORM against the unmigrated live schema. Deployment,
   restart and Staff enablement require separate authorization/acceptance.
3. Configure an explicit trusted HTTPS Staff origin, owner-approved geofence
   radius/accuracy/freshness values, eligible Staff identity, manager-approved
   personal device and reviewed shift plan. No operational configuration is
   invented or enabled by this phase.
4. Integrate the Staff frontend in a later phase using the exact-body/fresh-proof
   retry contract, online location acquisition, confirmed attendance ID and safe
   shift response; then perform real browser/device acceptance.
5. Review resolution for administrative unverified closures remains future work;
   retain immutable evidence and pending review. No payroll or deductions follow
   automatically from REST, UNASSIGNED, lateness or any closure in this phase.

Staff remains OFF. This is backend source/test completion, not live activation.
