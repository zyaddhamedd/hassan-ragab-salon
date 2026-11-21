# Phase 5E.0 — shifts and employee requests

Status: inspection and plan complete. No application source, schema, financial records, shift assignments, attendance or geofence settings changed in this phase. No services restarted. Only this report was added; the existing Staff production build was regenerated and verified locally.

## Verified shifts

The isolated connection was verified in a read-only transaction: database `omar_staff_integration`, role `omar_staff_test`, Unix socket port `55440`, no TCP listener, revision `zz_staff_gps_attendance`. The runtime identity helper also checked the cluster start epoch against its private data directory.

Employee 2 belongs to synthetic branch **2**. Existing fixture data, not newly invented salon hours:

| Cairo date | Existing authoritative planning projection |
|---|---|
| 2026-10-30 | UNASSIGNED, explicitly frozen |
| 2026-10-31 | SCHEDULED, SYNTHETIC QA ONLY 12:00–20:00, weekly source, not frozen |
| 2026-11-01 through 2026-11-06 | UNASSIGNED |

The actual `employee_shift_service.read_shifts` against this migrated PostgreSQL database returned 10:00–18:00 UTC for the scheduled day, correctly corresponding to 12:00–20:00 Africa/Cairo. The Staff client uses that timezone for display and requests yesterday through seven days ahead. REST and UNASSIGNED remain distinct. Reads do not freeze projections or create attendance. No shift data correction was needed.

Reusable implementation:

- `backend/app/models/employee_shift.py`: templates, bounded weekly schedules, daily overrides/REST, frozen expectations and versioned change audit.
- `backend/app/services/employee_shift_service.py`: manager/branch authority, Employee lock, future-only edits, overlap/frozen protection, Cairo/DST/overnight projection.
- `backend/app/api/admin_employee_shifts.py`: template and assignment/edit APIs, shifts and shift-plans readback.
- `backend/app/api/staff.py`: signed, authenticated own-employee `GET /api/staff/shifts?from=...&to=...`.
- `local/omar/admin-shift-planner.tsx`: existing Admin attendance-area weekly planner, template creation, weekly assignment, override/REST, versioned replacement/cancellation. It reads templates, active employees, shifts and shift-plans through existing Admin API contracts.
- `local/omar/staff/app.mjs` and `client.mjs`: real own-shift readback, Arabic state labels and Cairo clock display.

Verification limits: the isolated HTTPS health endpoint returned 200, but its restricted loopback allowlist returned 404 for `/api/admin/employee-shifts/templates?branch_id=2`. No isolated Admin UI is served by this Staff-only runtime. The existing planner component/contracts passed offline tests; **an authenticated browser planner assignment against this isolated database was not performed**. No claim of a fresh signed iPhone shift read or visual inspection is made in this phase; the phone's nonextractable device key was left untouched.

Smallest follow-up for interactive planner QA: serve a separate isolated Admin build with same-origin test API routing, restrict it to loopback, and permit only the existing manager-authenticated planner dependencies in the test runtime. Keep the mobile listener's Admin denial. Do not redirect operational Admin or its API. Exercise a clearly labelled future synthetic assignment and verify readback on the approved phone. This is runtime preparation, not a missing scheduling engine; no scheduling migration is needed. Staff's shifts list currently shows overnight end clock without an explicit next-day label; consider a small display-only label when adding overnight visual QA, without changing attendance screens or logic.

## Financial rules already present

`EmployeeFinancialAction.ADVANCE` means **already disbursed money**, not a request. `backend/app/api/mini.py:create_financial_action` requires cashier authority, checks employee branch/activity, resolves the cashier User, creates a cash-event Expense and an ADVANCE financial action in the same session, then commits together. It attaches an existing open BusinessDay if present; the handler does not create one. The endpoint has no request-level idempotency or explicit request-to-Expense/action linkage. It must not be called automatically on approval or retried blindly.

`payroll_calculation_service.py` immediately counts ADVANCE financial actions in its date window and subtracts them from payable salary. Thus even an allegedly "pending" ADVANCE inserted there would affect payroll. The current financial model has no pending/approved request status.

Existing Admin employee details show advance history and totals (`GET /api/admin/employees/<id>/advances`). Settlement Studio uses draft/review/approval/cancellation contracts in `admin.py` and `payroll_settlement_service.py`; approval locks Employee and revalidates live financial source allocations. It settles existing sources; it is not an advance-request approval inbox. Its serializers expose financial/internal fields and must not be reused for Staff.

No existing HR leave/request model or Staff request endpoint was found in the registered models and application routes. Shift REST is a planning state, not a leave application. Employee transfer and inventory requests are unrelated.

## Minimal proposed implementation — not implemented

1. Add one request model/table for ADVANCE and LEAVE, plus one append-only request-event table in one additive migration. Do not alter existing migrations or financial/attendance models. Request fields: employee FK, submitting branch FK snapshot, type, status PENDING/APPROVED/REJECTED, creation timestamp, version, bounded reason, client operation UUID and canonical-body digest. ADVANCE has a positive fixed-precision requested amount; LEAVE has inclusive Cairo DATE start/end. Database checks enforce mutually exclusive payload shapes, valid dates/amount, valid status and unique `(employee_id, client_operation_id)`. Events record submission and decision, actor FK, server timestamp and bounded decision reason. Protect event history from update/delete. No automatic backfill.
2. Add protected signed Staff `POST /api/staff/requests` and own-only paginated `GET /api/staff/requests` (optional own detail GET). Extend the existing exact-target proof allowlist, not its protocol. Derive employee and current branch from the authenticated linked identity; reject client employee/branch IDs. Require approved device, fresh proof and existing feature guard. Store/reuse the operation UUID and body hash atomically: identical retry returns the same request; changed payload with the same UUID conflicts. Do not reuse attendance receipts for requests. Return only request type, requested amount or dates, safe reason/status and server dates; no salary, balances, financial sources or security evidence.
3. Add manager-authenticated branch-scoped list/detail and `POST /api/admin/employee-requests/<id>/decision` with expected_version, APPROVE/REJECT and decision reason. Use Employee → Request lock order, recheck current employee branch, saved submitting branch, pending status and version. Fail closed for transferred employees pending an explicit handling policy. A repeated identical terminal decision is safe; conflicting or stale decisions fail. Write state and event atomically. Do not hold locks for list reads. Reject non-manager and cross-branch access.
4. Add a small Admin request inbox and replace Staff unavailable request panels with amount/date/reason forms plus own status list. Keep exact existing design and device proof. No financial summaries, offline acceptance, simulated approvals or optimistic success. Render reasons as text and keep them out of logs. Define a bounded retention/access policy for potentially sensitive leave reasons.
5. Approval is review only. It must create **zero** EmployeeFinancialAction, Expense, settlement, deduction, payment, shift override, Attendance, cashier session or BusinessDay records. Leave approval is informational until a separately authorized scheduling policy is agreed. Keep this stage's advance status as APPROVED, not PAID/DISBURSED; clearly tell both employee and manager that approval does not confirm payment.
6. Defer actual advance disbursement integration to a separate approved phase. Reuse the existing cashier authority, branch, cash-event Expense and financial-action rules. The current Mini endpoint cannot safely provide request-level exactly-once disbursement. The smallest prerequisite is a locked approved request plus a unique request→disbursement association linking **both** Expense and financial action, committed atomically with the existing paired writes; replay must return the existing association. Never insert an ADVANCE as an approval shortcut, never issue a second unlinked Mini request, never retroactively match by amount/notes alone. Revalidate payroll settlement interactions before adding this path. No Staff financial mutation permission is needed.

One additive request/event migration is sufficient for submission/review/status. Unique disbursement linkage is deliberately excluded until the actual payment phase is authorized. Apply future migrations only to a proven disposable database during development.

## Tests required for the proposed phase

- Staff feature OFF; unauthenticated, revoked/pending device, invalid/replayed proof, query/body tampering and employee-ID injection rejection.
- Own-only lists/detail and manager branch isolation, including transferred/deactivated employee races.
- Decimal amount validation (no float arithmetic), invalid/overflow amount, valid inclusive date range, Cairo/DST dates, bounded inputs and output allowlists.
- Exact-body request retries, UUID collision/body mismatch, parallel duplicate submissions, competing approve/reject, stale version and repeated terminal decisions; verify one durable event per actual transition.
- Assert that submit/approve/reject leaves financial actions, Expenses, payroll inputs, shifts, attendance and business days unchanged.
- Verify append-only event constraints on isolated PostgreSQL and migration upgrade from current head without historical changes.
- Frontend mocked submission/status/error/retry and safe Arabic rendering. No operational writes.
- Future disbursement tests: concurrent payment retries create exactly one Expense/action/link, rollback of any failed paired write, cross-branch rejection, settlement source revalidation and unchanged legacy Mini behavior.
- Shift regressions: branch authority, future/frozen rules, REST, weekly/override precedence, Cairo overnight/DST and read-only Staff projection. Browser QA still needs the separate isolated Admin interface described above.

## Business decisions needed before request implementation

- Who may approve (existing scheduling managers are a proposed default, not a confirmed financial policy)? Can the requester approve their own request, and how are transferred employees handled?
- Advance currency convention, minimum/maximum, eligibility, partial approval and outstanding-request limits; who pays and through which existing cashier workflow? Default proposal is approve/reject the requested amount, no partial approval until specified.
- Leave date inclusivity, past/same-day requests, overlapping requests, full-day versus partial-day support, leave types and whether any leave is paid. No payroll/entitlement interpretation is implied.
- Withdrawal/cancellation after submission or approval, required rejection reasons, employee visibility of manager notes, reason retention/privacy and any notifications. Do not implement notifications or new lifecycle states without these decisions.
- Real branch working hours and shifts must be supplied by the owner/manager; synthetic QA hours are not salon policy.

## Validation performed in this phase

- 21 backend shift tests passed (offline SQLite/contract tests; not claimed as new PostgreSQL concurrency tests).
- 7 existing Admin planner tests passed.
- 35 existing Staff frontend tests passed.
- Existing migrated isolated PostgreSQL data and real shift service checked under read-only transactions. Counts: Attendance 0, EmployeeFinancialAction 0, Expense 0, PayrollSettlement 0.
- Staff production build and verification passed: 12 assets, imports/hashes, MIME manifest, CSP and simulation separation checks.
- `git diff --check` passed.

Operational database/configuration, operational services, Staff activation, owner device/session, GPS and attendance logic were not changed. No commit, push or deployment was performed. Stop at this plan before request schema or financial implementation.
