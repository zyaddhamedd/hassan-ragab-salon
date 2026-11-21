# Phase 5D.2A — Staff attendance compatibility guard

Implemented in standalone source on `feat/omar-fahim-setup`. Staff remains OFF.
No live database connection/migration, server restart, UI change, commit or deployment
was performed. The old Omar worktree and Nady were not inspected or modified.

## Behavior and evidence

The existing `attendances` table and `uq_employee_present` constraint are retained.
Nullable `attendance_origin` distinguishes historical cashier rows (NULL, or explicit
`LEGACY_CASHIER`) from future `STAFF_GPS` rows. No historical backfill/default or
parallel attendance engine is introduced.

Six additive nullable fields store origin, checkout verification, administrative
actor ID, reason, recorded timestamp and pending-review flag. A Staff administrative
closure is explicitly `ADMIN_UNVERIFIED`, never `STAFF_GPS_VERIFIED`, and retains
existing `checkout_source=ADMIN_CORRECTION`. SQL constraints require complete audit
evidence and `closure_review_required=true`. Foreign-key RESTRICT retains actor
references. A PostgreSQL trigger makes origin immutable, prevents Staff attendance
deletion, and prevents rewriting a closed Staff row. The original attendance row
is the retained immutable closure history; there is no duplicated attendance row.
Review resolution/corrections are deliberately not implemented in this phase and
must not overwrite that evidence.

Employee transfer locks and refreshes Employee first, authorizes both source and
destination branches, then locks and refreshes open Attendance. It rechecks status,
checkout time and source branch before staging the transfer and branch mutation.
An inconsistent source or ambiguous open state fails closed. All mutations commit
once or roll back together. HTTP authorization/conflict errors retain their status.

For Staff-origin rows only, transfer also requires both Omar/Staff flags, an active
SUPER_ADMIN or EXEC_ADMIN, and explicit manager review in the request:

```json
{
  "branch_id": 2,
  "attendance_closure_review": {
    "attendance_id": 123,
    "reason": "Manager's explicit closure reason",
    "acknowledge_unverified": true
  }
}
```

IDs above are illustrative, not live data. Missing/mismatched acknowledgement or a
stale attendance ID is rejected. The actor and closure timestamp are recorded by
the server; further manager review remains required. With Staff OFF, this Staff
closure path is unavailable. Legacy transfer requires no new fields/feature flag.

Mini checkout and cashier business-day close preserve legacy responses and
checkout sources, but reject open Staff rows instead of manufacturing a GPS
checkout. These protective checks remain effective when Staff is switched OFF.
Attendance queries refresh their locked ORM state. Business-day closure locks only
Attendance in its Employee join, avoiding an Employee/Attendance reverse lock order
with transfer; financial calculations are unchanged. No GPS endpoint was added.

Existing Attendance/Admin workspace/Mini feed serializers retain their explicit
allowlists and do not expose any new provenance/audit fields or closure reason.

## Files

- `backend/app/models/attendance.py` — nullable evidence and constraints.
- `backend/app/services/attendance_compatibility.py` — locked transfer closure boundary.
- `backend/app/api/admin.py` — atomic transfer locking, review and HTTP error handling.
- `backend/app/api/mini.py` — protect Staff rows in cashier checkout/day close.
- `backend/migrations/versions/zy_staff_attendance_evidence.py` — additive migration;
  parent `zx_staff_geofence_versions`. No existing migration modified.
- `backend/tests/test_attendance_compatibility.py` — eight offline compatibility tests.
- `backend/tests/test_attendance_postgres.py` — five opt-in isolated PostgreSQL tests.
- `backend/tests/test_omar_readiness.py` and `local/omar/migration-graph.json` —
  reviewed graph head/count updated to 64 revisions.
- This report.

## Validation

- Backend discovery: **110 tests, 105 passed, 5 opt-in PostgreSQL tests skipped**.
- Opt-in PostgreSQL run: **5/5 passed**, including both transfer/checkout race orders,
  actual lock-wait observation through `pg_stat_activity`, refreshed-state rejection,
  real legacy cashier checkout, additive migration preservation, unique-open index,
  required audit evidence, immutable history and guarded downgrade.
- Eight offline tests cover legacy check-in/out and duplicate attempts, transfer,
  day close, Staff rejection/review, role/branch/feature restrictions, stale review,
  source mismatch and Admin/Mini serializer regression checks. Financial collection
  totals are stubbed for the day-close test; no financial implementation changed.
- The checkout race counterpart is a test-only contract probe, not an implemented
  or certified GPS endpoint. Future checkout must follow that locking contract.
- PostgreSQL tests initialize a fresh cluster under `/private/tmp`, disable TCP,
  use an owner-only Unix socket directory and verify cluster data-directory identity.
  No external DSN is accepted. Only this disposable schema is migrated and its
  cluster is stopped/removed on cleanup. Tests use bounded lock/statement timeouts.
- `git diff --check` passed. Live Omar was not queried or migrated in this phase.

Reproduce offline suite:

```sh
.local/omar/venv/bin/python -m unittest discover -s backend/tests -v
```

Opt-in disposable PostgreSQL tests (requires installed PostgreSQL 16 binaries):

```sh
OMAR_ATTENDANCE_DISPOSABLE_PG=1 .local/omar/venv/bin/python -m unittest discover -s backend/tests -p test_attendance_postgres.py -v
```

## Prerequisites for 5D.2B

1. Separately review the incremental upgrade from the live reported revision
   `zr_payroll_settlement_ledger` through the pending Staff foundation chain and
   this migration. Nothing here applies that chain, stamps the database, refreshes
   the historical canonical source baseline, or relaxes the old empty-database
   migration runner. That runner retains its previous head/count and fails closed
   against the new graph; it is not an incremental live upgrade tool.
2. Do not restart the changed ORM source against the unmigrated live schema. The
   existing running process retains its loaded code; schema/runtime activation
   requires a separately authorized migration and restart plan.
3. Implement actual Staff GPS validation/checkout, binding device, employee and
   source branch to the same locked Attendance row. Refresh/recheck PRESENT and
   absent checkout after acquiring the lock; never cache then overwrite closure.
   Respect the documented Employee → Attendance / BusinessDay → Attendance lock
   order and do not acquire Employee after Attendance.
4. Define the manager review-resolution workflow as retained audit evidence rather
   than editing the immutable closure record. The pending-review flag is not an
   automatic payroll adjustment or a completed review-resolution flow.
5. Keep Staff OFF until that integration and separate activation acceptance pass.
