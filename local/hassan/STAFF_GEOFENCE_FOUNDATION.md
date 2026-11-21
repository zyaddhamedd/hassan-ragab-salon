# Phase 5D.1 — Staff geofence foundation

Owner reference: latitude 30.032083486995774, longitude 30.987334731699523.
Source supplied by owner: https://maps.app.goo.gl/WEXisLjSK2jCRmVn7
The reference is stored explicitly in staff_geofence_service.OWNER_REFERENCE.
It is NOT automatically assigned to a branch or activated. No radius, accuracy
threshold or reading age has been selected for the salon.

## Configuration
GET/POST `/api/admin/branches/{branch_id}/staff-geofence` uses existing Admin auth,
SUPER_ADMIN/EXEC_ADMIN only, plus the existing Omar Staff feature guard. Other
manager/cashier roles cannot change the security-sensitive site boundary. Only
active operating branches are allowed. Staff remains OFF by default.

GET returns the owner reference and current configuration (null when absent).
POST requires exactly: expected_version (0 initially), latitude, longitude,
radius_m, max_accuracy_m, max_age_seconds, enabled, reason (3–200 chars).
JSON numeric coordinates/thresholds only; booleans, NaN, Infinity and invalid
geographic ranges are rejected. Disabled drafts may leave thresholds null.
Enabling requires explicit positive radius/accuracy, accuracy <= radius, and an
explicit capture age of 1–300 seconds (300 is a safety ceiling, not a default).
No settings become active merely by reading the reference or applying migration.

Each write locks the branch and appends the next version with actor/reason/time.
Stale expected_version returns 409; branch/version is unique. PG triggers prohibit
UPDATE/DELETE of configuration history. A new disabled version overrides previous
active versions; there is no fallback to an older enabled configuration.

## Server validation contract
`validate_employee_location(user, reading)` is an INTERNAL future integration helper,
not a public endpoint. The caller must first verify the Staff session and approved
device proof. Branch identity comes from the linked eligible employee, never client
employee/branch/config IDs. The helper locks the branch, reads its latest version,
and leaves transaction ownership to the caller so the future attendance confirmation
and config validation can share one transaction. No attendance action exists here.

Reading fields: latitude, longitude, accuracy_m, captured_at (timezone-aware ISO).
The trusted server clock rejects future samples and samples older than the chosen
age. Invalid/nonpositive accuracy is rejected; accuracy above the configured maximum
is rejected. Great-circle Haversine distance uses unrounded coordinates. Acceptance
requires distance + reported accuracy <= radius, so uncertainty crossing the boundary
fails closed. Missing, disabled or invalid configuration rejects validation.

No raw reading is persisted, logged or echoed in results. Result contains config
version, computed distance and evaluation timestamp only. No polling, GPS call,
continuous tracking or Staff App connection is added. Browser coordinates, accuracy
and timestamps are client claims: this is NOT proof against GPS spoofing, timestamp
forgery or physical-device impersonation. Future integration needs device-signed,
one-time request binding and confirmed backend attendance processing.

## Validation and migration
10 focused offline tests cover references, disabled/incomplete configuration,
uncertainty boundaries, freshness/timezone edges, invalid coordinates and NaN/Infinity,
antimeridian/poles, versioning/stale edits, roles/cross-app tokens, warehouse rejection,
feature isolation, own-employee linkage and absence of location storage fields.
New migration upgrade SQL is compiled offline for PostgreSQL; no DB is accessed.

`zx_staff_geofence_versions` follows `zw_employee_shift_supersession` (63 revisions,
one head). Additive configuration table only, default disabled, no seed rows/backfill.
Populated downgrade refuses deleting history. No live Omar migration was performed.
Before activation: owner must choose radius, required accuracy and maximum age;
separately approve local migrations and future attendance/Staff integration.

## Files
New: backend/app/models/staff_geofence.py,
backend/app/services/staff_geofence_service.py,
backend/app/api/admin_staff_geofence.py,
backend/migrations/versions/zx_staff_geofence_versions.py,
backend/tests/test_staff_geofence.py, this document.
Modified: backend/app/models/__init__.py, backend/app/__init__.py,
backend/tests/test_omar_readiness.py. No Mini, Staff prototype, shift, payroll or
attendance source behavior changed. Existing uncommitted work remains in place.
