# Employee shift planning foundation — Phase 5C.1

Implementation only. Staff stays OFF. No live Omar database migration or connection,
server restart, attendance/GPS/POS shift change or payroll calculation occurred.

## Contract
Manager routes use existing Admin auth and the Omar Staff feature guard.
SUPER_ADMIN/EXEC_ADMIN have global scope; BRANCH_MANAGER is limited to their branch.
STORE_MANAGER, CASHIER and EMPLOYEE cannot schedule. Operating branches only.

- GET/POST `/api/admin/employee-shifts/templates`: list by `branch_id`; create with
  branch_id, name, start_time/end_time (HH:MM), grace_minutes (0–120).
- PATCH `.../templates/{id}`: is_active only. Disabling prevents NEW assignments;
  existing expectations remain intact. Time/grace/name changes require a new template.
- POST `/api/admin/employees/{id}/shift-schedules`: template_id, weekday (Monday=0),
  effective_from/effective_to (inclusive ISO dates, bounded period up to 366 days).
- POST `.../{id}/shift-overrides`: shift_date, is_rest, template_id; rest requires null
  template. One immutable override per date. Override takes precedence over recurrence.
- GET `.../{id}/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD`: read-only projection, up to 31 days.
- POST `.../{id}/shift-instances`: from/to, up to 31 days. Explicitly freeze the planning
  expectations, including REST/UNASSIGNED. Idempotent; NOT an attendance operation.
- GET `/api/staff/shifts?from=...&to=...`: same safe read projection, employee identity
  derived exclusively from the authenticated linked user. Approved device proof signs
  the exact target/query. No employee_id parameter; no financial data or implicit writes.

All planning additions and changes must start AFTER the current Cairo calendar day.
Phase 5C.1B adds explicit future supersession:
- PATCH `.../{id}/shift-schedules/{row_id}`: operation (`replace`/`cancel`),
  expected_version, reason (3–200 characters), effective_from. Replacement also
  requires template_id. A replacement changes only the future suffix, retaining
  the original weekday and effective_to. A started plan can get a FUTURE suffix
  correction; earlier expectations remain intact.
- PATCH `.../{id}/shift-overrides/{row_id}`: operation, expected_version, reason;
  replacement also supplies is_rest/template_id. Date remains the same. Cancelling
  an override reveals the weekly plan, or UNASSIGNED when no weekly plan exists.
- GET `.../{id}/shift-plans?from=...&to=...`: bounded version inventory for managers.
  Existing POST/read contracts remain compatible; creation now also returns version.
Original dates/template/employee fields are never rewritten. One-time retirement
metadata advances version 1 to 2, and a replacement is a new version-1 row linked
by supersedes_id. Append-only employee_shift_changes records actor, reason, cutoff
and operation. Repeated/stale version edits return 409. Frozen affected dates block
changes, including future frozen expectations. No bulk scheduling or date-moving UI.

## Time and history
Cairo local start date identifies a shift. End earlier than start means next day;
equal times are rejected. UTC instants, grace, name and branch are frozen in instances.
DST spring gaps fail closed and require a valid alternate/rest override. Autumn
ambiguous clocks use the first occurrence (fold=0). Overnight elapsed hours reflect
actual Cairo UTC offset changes. Intervals are half-open: touching shifts are allowed.

No assignment means UNASSIGNED, never inferred absence. REST is explicit. No attendance
or penalty evaluation is implemented. Unfrozen projections carry frozen=false; the
future attendance integration must explicitly freeze expectations before relying on them.
Branch transfers must be reviewed against future plans; this phase does not rescope them.

Employee row locks serialize weekly/override/snapshot API writes, followed by adjacent
calendar-day overlap checks (including overnight boundaries). PostgreSQL native-range
GiST exclusion constraints prevent overlapping weekday effective periods and frozen
UTC intervals without requiring btree_gist. Unique employee/date constraints prevent
multiple overrides/instances. Raw SQL outside these APIs is unsupported for planning.
Database triggers prohibit plan body rewrites/deletes and all snapshot changes;
only valid future retirement metadata is allowed, with a deferred matching audit
and successor check at commit. Templates permit only is_active changes. No historical backfill or seed rows.

## Validation and rollout
87 offline backend tests (21 shift-specific) and 4 existing Auth UI tests passed.
Phase 5C.1B tests include replacement/cancellation, preserved earlier expectations,
rest/weekly fallback, frozen dates, overnight overlap rollback, stale versions,
branch authorization, signed Staff reads and cross-app isolation.

Real PostgreSQL 16 verification PASSED on owned disposable
`omar_staff_verify_ff4146af7fb42dd94452` at 127.0.0.1:55432 (omar_cluster_admin).
Both shift migrations upgraded/downgraded/re-upgraded; manager edit race returned
200/409; native weekly exclusion race returned commit/23P01; unique frozen instances,
UTC interval exclusion, immutable history/template/delete triggers and deferred audit
checks rejected forbidden SQL. Historical/business fixture fingerprints were unchanged.
The disposable DB was dropped, original HBA restored byte-for-byte and reloaded, and
its temporary access rejected again. No live Omar database was connected to.

New revision `zw_employee_shift_supersession` follows `zv_employee_shift_planning`;
source graph has 62 revisions, one head. Populated downgrade refuses deletion of
supersession history. Live Omar migrations remain unapplied; Staff remains OFF.
UI rollout still requires explicit live migration/activation authorization and existing
HTTPS/device prerequisites. No new scheduling UI has been implemented.

## Files for this phase
New: backend/app/models/employee_shift.py,
backend/app/services/employee_shift_service.py,
backend/app/api/admin_employee_shifts.py,
backend/migrations/versions/zv_employee_shift_planning.py,
backend/tests/test_employee_shifts.py, this document.
Modified integration points: backend/app/models/__init__.py, backend/app/__init__.py,
backend/app/api/staff.py, backend/app/services/staff_device_service.py,
backend/tests/test_omar_readiness.py. Existing uncommitted work is retained.

## Phase 5C.1B files
New: backend/migrations/versions/zw_employee_shift_supersession.py.
Modified: backend/app/models/employee_shift.py,
backend/app/services/employee_shift_service.py,
backend/app/api/admin_employee_shifts.py, backend/app/models/__init__.py,
backend/tests/test_employee_shifts.py, backend/tests/test_omar_readiness.py,
this document. Test harnesses stay in /tmp; no private credentials are included here.
