# Omar migration and startup readiness — Phase 2B.2A

Historical preparation assessment: the separately authorized Phase 2B.2B migration
step has now completed. See [MIGRATION_RESULT.md](MIGRATION_RESULT.md) for the
current committed state and GO decision for explicit initialization. The empty-DB
and migration-untested statements below describe the Phase 2B.2A snapshot.

Decision: **NO-GO for direct first backend startup in Phase 2B.2B**. The database
is still empty. Preparation is complete, but a separately authorized schema step
must establish the schema before application use. Before that step, approve the
warehouse seed described below and prepare a controlled Omar migration entry
point that validates the private target and bypasses legacy bootstrap. Neither
`run.py`, the Flask CLI through `run.py`, Procfile nor Docker is an approved Omar
migration/startup path. No historical migration was edited in this phase.

## Scope and method

All 57 Python files in the active `backend/migrations/versions/` directory were
parsed without importing or executing them. Parent/dependency references,
upgrade bodies, helper SQL, downgrade risks and startup imports were reviewed.
`migration-graph.json` records every revision, filename, parent/dependency and
SHA-256. `audit_migrations.py` reproduces the graph using only the standard library.
No Alembic command, migration function, SQL emission mode, application import or
application-data query was used. The only database verification used read-only
system catalogs and connection identity on Omar's dedicated 55432 target.

## Graph

- 57 unique revisions; one root: `9a1b321acf1c`.
- One head: `zr_payroll_settlement_ledger`.
- No missing parent or `depends_on` references, duplicates, cycles or detached
  components. Every revision is reachable from the root and leads to the head.
- All explicit `depends_on` and `branch_labels` values are `None`.
- Four merge revisions: `5989ee3d5a82`, `11581aac8182`,
  `20230621_merge_branches`, `m1_product_commission`. Tuple parent edges are real
  dependencies; filename dates and lexical filename order are not execution order.
- Historical backup migrations are outside this active graph; sparse checkout
  was not expanded and no active revision is missing from the worktree.

## Dependencies and extensions

The migration modules require Alembic, SQLAlchemy (including its PostgreSQL
dialect), standard-library modules and a PostgreSQL driver. The environment file
requires an initialized Flask-Migrate application context and accesses its engine;
its online path explicitly connects. Even its offline path first obtains the
Flask application's engine URL. Do not run it as a supposedly safe offline check.

PostgreSQL-specific features include named enums/enum alterations, UUID, JSON,
TIMESTAMPTZ, partial/expression indexes, catalog inspection, DO blocks and PL/pgSQL
trigger functions (`zf` and `zm`). There are no `CREATE EXTENSION` statements or
references requiring pgcrypto, uuid-ossp, citext, unaccent or btree_gist. UUID
columns do not call extension UUID generators. Standard PL/pgSQL is required;
its availability/permissions should be checked as metadata in the future schema
step before executing DDL. No superuser extension installation is indicated.
The application role needs ownership/CREATE privileges for its own schema, enums,
functions, triggers and indexes; it does not need cluster administration rights.

The isolated Python 3.12.15 environment has the shared requirements plus an
Omar-only PDF dependency overlay. Exact installed versions are recorded in
`requirements.lock.txt`; this is a local resolved snapshot, not a hash-verified
or cross-platform lock. `pip check` passes. A static import scan found no missing
third-party roots after installing reportlab, arabic-reshaper and python-bidi.
`backports.zoneinfo` is an unused fallback under Python 3.12, which supplies
`zoneinfo`. Arabic PDF font quality still depends on a suitable font; it does not
block first startup. No application import or server smoke test was performed.

## Writes, assumptions and destructive behavior

`n2_main_warehouse_setup` inserts a generic internal `Main Warehouse` branch in
`Cairo`, active with discounts disabled, if absent; otherwise it updates that
branch. It clears the main-warehouse flag on every other branch and creates a
partial unique index. This is an unconditional seed path on a fresh database,
not merely schema DDL. It creates no admin or operating branch. Its effect must
be explicitly accepted as Omar's internal warehouse or replaced by a reviewed
Omar-specific schema plan; do not silently skip/stamp revisions or change shared
historical behavior. The later `780e5ce2c51c` drops that uniqueness index without
restoring it. Explicit initialization must verify exactly one warehouse under a
transaction/lock; any restored invariant needs separately reviewed additive DDL.

Data updates/backfills exist in `a3d5e7f9b1c2`, `c4790ff492ef`, `e9d48d4ed194`,
`i5j7k9l1m3n2`, `l9m1n3o5p7q6`, `t1_inventory_batches_phase1`,
`p3q5r7s9t1u2`, `u4_shipment_cost_snapshots`, `w6_inbound_shipments` and
`zb_m4b_registered_devices`. On a genuinely fresh database their source business
rows should be absent, so no business-row backfill is expected; this has not been
established by executing migrations. `t1` can create legacy opening inventory
batches and `zb` can copy legacy device bindings when source rows exist.

Upgrade operations that remove or reinterpret information/invariants include:

- `9b2c431bdf2d`: naive timestamps are interpreted as UTC, including conversion
  of the legacy transfer date column.
- `j6k8l0m2n4o3`: replaces a broad attendance unique constraint with a partial
  index. Its broad exception handling has no savepoint; a failed PostgreSQL DDL
  statement would still abort the transaction despite the printed skip message.
- `e9d48d4ed194`: drops `products.product_type`, changes the movement enum to a
  non-native representation and rewrites legacy movement labels.
- `780e5ce2c51c`: drops five indexes, including warehouse uniqueness and employee
  assignment indexes; rewires `stock_movements.created_by` from users to employees.
  Mixed actor IDs in existing data are a compatibility hazard; empty Omar data
  avoids that data conflict but future code semantics still deserve review.
- `zp_booking_deposit_settlement`: changes integer amounts/balances to numeric;
  refuses existing unlinked deposit applications. `za` refuses duplicate active
  attendances. Empty source tables should satisfy both preconditions.

Downgrades commonly drop tables, columns, enums, functions and indexes; some
rewrite values or cannot restore historical state (`i5`, `l9`, `n2`, `x7`). `zk`
and `zl` also refuse rollback when protected historical records exist. Do not
use downgrade as an automatic recovery procedure. Schema planning must include
failure recovery without deleting reviewed data.

No Nady service URLs, credentials, named accounts or fixed application-user seeds
were found in active migrations. Generic `Cairo`/UTC assumptions, `TIP_PAYOUT`
category codes and legacy English/Arabic tip-note matching remain. The inherited
fixed-password admin exists in `app/utils/bootstrap.py`, not in the migration
graph, and is bypassed by Omar's `create_app(bootstrap=False)`.

No definite fresh-database execution failure was proven by this static audit.
Known previously destructive compatibility revisions `86d10b763ffc` and
`c4790ff492ef` are now guarded/additive in the existing source. Graph correctness
alone does not prove successful DDL execution, model/schema parity, or working
application behavior; these remain validation steps in the authorized schema
phase. A normal first startup on today's empty database is not an accepted
functional validation, even though the health route may not need tables.

## Secure explicit initialization plan (not executed)

1. After separately approved migrations, validate the exact private target again
   and require the expected single migration head. Inspect only the Omar schema.
2. Obtain the owner's chosen admin name/email, operating-branch name/city and a
   fresh password through an interactive hidden prompt or an owner-only input
   file. No default password, command-line password, copied account or logged
   credential is allowed. Do not generate/provision an account during readiness.
3. Use a dedicated, explicitly invoked Omar initialization command, never a
   startup hook or legacy bootstrap helper. Use one transaction with a lock and
   fail closed on existing/unexpected users, branches or conflicting names.
4. Reuse only the exact migration-created generic internal warehouse after
   verifying its identity/settings, if that seed was approved. Otherwise use the
   explicitly approved alternative schema/seed plan. Never create a duplicate.
5. Create exactly one operating branch (active, not a warehouse) and one fresh
   active SUPER_ADMIN (global `branch_id=None`), with password hashed using the
   existing `User.set_password`/Werkzeug mechanism. Preserve the internal
   warehouse's `Main Warehouse` name where existing service code requires it.
6. Assert the exact intended users/branches, single internal warehouse, no
   inherited default admin and no employee/customer/inventory seed data. Commit
   only after all checks pass; rollback on conflict without replacing records.
   A second invocation must stop for review, not reset passwords or duplicate rows.

No provisioning executable was added: the schema and warehouse decision must
be settled first. Treasury accounts/categories and other operational catalogs
need a later feature-specific review; this minimum plan does not silently seed
business data or claim cashier readiness.

## Revision inventory

The table below covers upgrade intent; the complete edges and file hashes are in
`migration-graph.json`. These summaries do not authorize execution.

| Revision | Upgrade review |
| --- | --- |
| `9a1b321acf1c` | Base schema: 24 application tables, FKs, enums and indexes; no accounts/branch seeds. |
| `9b2c431bdf2d` | Convert listed date/time columns to TIMESTAMPTZ using UTC. |
| `a3d5e7f9b1c2` | Guarded expense category code column, row backfill and unique constraint/index. |
| `b4e6f8a0c2d1` | Employee financial-action enum/table/indexes; verifies table existence. |
| `1c4b15b9c465` | Guarded performance indexes; branch later merged at 5989. |
| `c5f7a9b3e4d2` | Guarded expenses is_cash_event column and verification. |
| `d6g8h0i2j4k3` | Business-day enum/table, constraints and indexes; verifies creation. |
| `5989ee3d5a82` | Merge performance-index and business-day branches; no schema operations. |
| `e1f3a5c7b9d2` | Guarded business-day cash-in/cash-out/previous-day FK fields. |
| `f2g4h6i8j0k1` | Nullable invoices business-day FK/index. |
| `g3h5i7j9k1l2` | Nullable expenses business-day FK/index. |
| `h4i6j8k0l2m1` | Guarded composite invoice/expense performance indexes. |
| `i5j7k9l1m3n2` | Close orphaned PRESENT attendance rows; implicit data update. |
| `j6k8l0m2n4o3` | Drop broad attendance unique constraint; create active-only uniqueness; swallowed DDL errors risk. |
| `b364a257cf87` | Invoice payment table/index; reuse existing payment enum; change_amount column. |
| `a6b7c8d9e0f1` | Branch device-binding columns. |
| `k8l0m2n4o6p5` | Expense business-expense flag; parallel branch from j6. |
| `l9m1n3o5p7q6` | Backfill tip-related expenses as non-business by category/notes. |
| `11581aac8182` | Merge device-binding and tip-backfill branches; no operations. |
| `86d10b763ffc` | Guarded additive invoice is_fully_discounted flag; legacy drops removed in existing source. |
| `c4790ff492ef` | Guarded additive product/stocks/movements tables and invoice item fields/backfill. |
| `e9d48d4ed194` | Drop product_type; add supply fields; change movement representation and rewrite labels. |
| `123456789abc` | Intentional no-op FK compatibility branch. |
| `20230620_add_is_main_warehouse` | Add non-null branch warehouse flag with temporary server default. |
| `20230621_merge_branches` | Merge warehouse-flag and unified-product branches; no operations. |
| `m1_product_commission` | Merge both product branches; add commission fields/assigned-employee FK/index. |
| `n2_main_warehouse_setup` | Insert/update Main Warehouse in Cairo; clear other warehouse flags; unique partial index. |
| `s6_stock_shipments` | Shipment and item tables/indexes. |
| `s7_stock_supply_requests` | Supply request and item tables/indexes. |
| `t1_inventory_batches_phase1` | Inventory batch tables/indexes; backfill opening batches from legacy positive stocks. |
| `t2_inventory_batch_h1` | Inventory batch lookup/composite indexes. |
| `780e5ce2c51c` | Adjustment/supply/transfer tables; purchase_date; drop five indexes; actor FK rewrite. |
| `p3q5r7s9t1u2` | Guarded invoice payment entered_amount field/backfill. |
| `u4_shipment_cost_snapshots` | Guarded shipment-item cost snapshot/backfill. |
| `v5_stock_return_requests` | Return request table/indexes. |
| `w6_inbound_shipments` | Inbound shipment fields; backfill shipment totals/type; relax source branch nullability. |
| `x7_store_manager_role` | Add STORE_MANAGER enum value; no account creation. |
| `y8_appointment_deposit_phase1` | Guarded appointment-deposit transaction table/enums/indexes. |
| `z9_att_bd_p1a` | Guarded attendance business-day/checkout-source fields, FKs and partial indexes. |
| `za_fix_uq_employee_present` | Check duplicate PRESENT rows; ensure equivalent unique partial index. |
| `zb_m4b_registered_devices` | Registered-device table; backfill legacy branch binding records. |
| `zc_m4c_device_enrollments` | Device-enrollment table/indexes. |
| `zd_promo_domain_foundation` | Promo domain tables/enums/checks/FKs; no promotional seeds. |
| `ze_payment_confirmation_attempts` | Confirmation-attempt table/indexes. |
| `zf_invoice_audit_events` | Audit event table/checks/indexes plus PL/pgSQL append-only trigger. |
| `zg_mini_device_credentials` | Registered-device credential fields/check. |
| `zh_mini_device_finalization` | Credential-required/finalization/enrollment link fields. |
| `zi_mini_device_strict_binding` | Device repair authorization fields/FK. |
| `zj_mini_device_proof` | Proof challenges/replay tables and device public-key fields/checks. |
| `zk_stock_balance_snapshots` | Balance snapshot columns/check and expression indexes; guarded downgrade. |
| `zl_stock_recovery_read_model` | Recovery provenance/read-model tables; no recovery import; guarded downgrade. |
| `zm_return_cost_snapshots` | Return valuation table and PL/pgSQL update-blocking trigger. |
| `zn_shipment_cancellation` | Shipment cancellation fields and movement reversal uniqueness/check/FK. |
| `zo_promo_discount_scope` | Promo discount-scope field/check with default. |
| `zp_booking_deposit_settlement` | Reject unreconciled applications; numeric amounts/balances and application links/checks. |
| `zq_booking_cashier_handoff` | Booking invoice links/flags/uniqueness. |
| `zr_payroll_settlement_ledger` | Settlement enum and four ledger tables/indexes; no payroll/account seeds. |
