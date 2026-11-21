# Phase 5B.1A — Staff identity metadata only

Feature remains OFF. No Staff login/session/password/device/attendance APIs or UI.

## Identity
Existing User.email is already the canonical login-name storage. Staff usernames
are 3–64 ASCII letters/digits/underscore/dot/hyphen, normalized lowercase; no
employee email or synthetic email address is required. New accounts start inactive
with an unusable password marker. Explicit linking accepts only inactive, unlinked
EMPLOYEE users; it never matches names or converts Admin/Cashier accounts.

User.employee_id is a unique, optional restricted FK. A DB check requires EMPLOYEE
role for linked users. staff_auth_version starts at 1 and increases on link or an
actual activation/deactivation change. PATCH requires expected_version.

New metadata is deferred and omitted from legacy INSERTs. Full-User count projects
only its primary key so default-disabled legacy CRUD can work before the additive
migration. Staff functionality itself requires the migration before enablement.

## Administration
Both boolean flags STAFF_IDENTITY_ENABLED and STAFF_IDENTITY_OMAR_RUNTIME must be
True. Config defaults both False and does not read them from ambient environment.
The validated Omar entry point marks its runtime but leaves feature False.
Routes return 404 before authentication/database work when disabled. Enabled
administration requires existing Admin JWT + live SUPER_ADMIN or EXEC_ADMIN role;
the service repeats authorization checks. Employee IDs here are authorized Admin
selection, never a Staff authorization mechanism.

- GET /api/admin/employees/{id}/staff-identity
- POST same path: {"username":"staff_example"}
- POST /api/admin/employees/{id}/staff-identity/link: {"user_id":123}
- PATCH identity path: {"is_active":true,"expected_version":1}

Unknown fields, password payloads and financial fields are rejected. Activation is
identity metadata only, not password activation or permission to log in. The safe
serializer uses an explicit allowlist and never calls Employee.to_dict(). Every
successful create/link/state change writes an actor-attributed identity event in
the same transaction. Repeated state with current version is a no-op.

## Validation / migration status
38 backend tests passed, including offline PostgreSQL SQL compilation and
in-memory database constraints/API/decorator/legacy-schema compatibility tests.
New revision zs_staff_identity_foundation extends zr_payroll_settlement_ledger;
active source graph has 58 revisions and one head. Historical migrations unchanged.

The isolated local checker defaults to SET TRANSACTION READ ONLY, verifies Omar
cluster PID/address/port, PostgreSQL 16, role/owner and exact parent revision, then
returns before any DDL. This read-only check passed against 127.0.0.1:55432 /
omar_fahim_local. Migration is NOT applied; Alembic revision unchanged.

Automatic approval review rejected the transactional upgrade/downgrade rehearsal.
No DDL ran. --rehearse exists as a concrete reviewable optional operation but must
not be executed without separate explicit approval. Its transaction always rolls
back, never stamps, creates accounts or persists schema changes.

Do not run old empty-database provisioning/initialization commands: their frozen
57-revision safety manifest intentionally rejects the newly extended source graph.
Do not enable feature or deploy Staff metadata consumers before a separately
approved migration. Running Omar servers were not restarted.

Future 5B.1B must add controlled activation/recovery and separate sessions; there
is deliberately no Staff authorization decorator accepting client employee IDs.
Default rollback is keep feature OFF; migration downgrade refuses to delete any
linked identities or identity history.

## Existing frontend regression result
Admin/Mini auth UI + frontend suite: 14/15 passed. The built-bundle static
isolation assertion finds the pre-existing localhost:5001 fallback text in the
Admin build after the earlier same-origin mobile configuration. No frontend file
or build output was changed by this phase; all 61 pre-existing changed files
were verified byte-identical. This failure is reported, not suppressed or fixed
outside scope. All 38 backend tests, including real Admin/Mini rejection
decorators, passed. The new migration's 58-revision graph expectation is updated
only in the readiness test; historical migration files remain unchanged.
