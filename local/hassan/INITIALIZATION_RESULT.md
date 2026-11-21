# Omar explicit local initialization — Phase 2B.2C

Historical initialization result: the Phase 2B.2D runtime driver blocker was
subsequently fixed in Omar's runtime and the smoke retest passed. See
[BACKEND_SMOKE_RESULT.md](BACKEND_SMOKE_RESULT.md) for the current GO decision for
Phase 3 preparation. The initialized database remains unchanged.

Result: **PASS. GO for a separately authorized first local backend startup using
the Omar entry point only.** No server or frontend was started in this phase.

## Target and guards

Workspace `<OMAR_SOURCE_ROOT>`, branch
`feat/omar-fahim-setup`, HEAD `adf9fe6b11034bd1848681e005be6ac920ddc1f0`.
Only `127.0.0.1:55432`, database/role/owner `omar_fahim_local`, PostgreSQL 16.15,
was connected to. Runtime validation, private-file permissions, cluster PID/path
and start time, exact SCRAM rules and authentication, canonical graph hashes,
current head and complete migrated seed inventory passed before writes.

The initializer is `backend/omar_initialize.py`. It is never imported or called by
ordinary startup. It reuses the guarded identity checks without running migration
commands. It loads only the explicit validated private config and discards the
inherited environment. It uses an independent SQLAlchemy session bound to the
verified target and the existing `User`, `UserRole` and `Branch` models. Model
modules are imported after preflight; no Flask factory, context, HTTP routes,
legacy bootstrap, Cloudinary or server is initialized.

## Explicit execution

Historical invocation, not an instruction to repeat initialization:

```sh
.local/omar/venv/bin/python backend/omar_initialize.py --config .local/omar/backend.json --apply
```

The command locks users/branches within one transaction, checks first-time state,
creates one operating branch and one Super Admin, verifies the state, commits
once and verifies it again in a new read-only transaction. The existing warehouse
is never added to an ORM session or updated. Its full row, including timestamps,
device-binding fields and PostgreSQL row version, was fingerprinted before and
after and is unchanged. No schema or migration-history changes occurred.

## Inventory

| Record | Verified state |
| --- | --- |
| Operating branch | `Omar Fahim Salon`, `Giza`, active, not internal, discounts enabled per existing model default |
| Internal warehouse | Existing `Main Warehouse`, `Cairo`, active, internal, discounts disabled; unchanged |
| Super Admin | One active `Omar Local Administrator`, existing `UserRole.SUPER_ADMIN`, global `branch_id=None` |
| Login identity | Fresh random local-only identity under reserved `.invalid` domain; stored privately, not reproduced here |

No invented contacts, addresses or tax identifiers were added. Optional branch
device-binding fields remain NULL. The admin role is the role already accepted
by the existing admin authorization code; no permission rules were changed.

The strong fresh password was generated with `secrets.token_urlsafe(36)` and
hashed by the existing `User.set_password` method using Werkzeug's default scrypt
hashing. Correct-password verification succeeded and an incorrect password was
rejected, before and after commit. The plaintext password appears only in the
ignored owner-only `.local/omar/initial-admin.json`, mode 0600. No password, login
or stored password hash was printed in reports, logs or Git output.

## Database and repeat verification

- Alembic head remains `zr_payroll_settlement_ledger`.
- Schema remains 59 application tables plus `alembic_version`.
- Users: 1 Super Admin; no cashier or other users.
- Branches: 1 operating branch and 1 existing internal warehouse.
- All other application tables have zero rows, including employees, customers,
  invoices, services, categories, devices, treasury accounts and operational data.
- A second exact `--apply` invocation refused cleanly with exit code **3** before
  generating credentials, inserting records or touching existing private files.
- Read-only verification compared every table row and sequence value with the
  first committed state: unchanged. Credentials/result file hashes also matched.
- Existing 5432/5433 listener PIDs and bindings remained unchanged. No Nady
  workspace/database/production access, service changes or external storage use
  occurred. All previous uncommitted source changes were preserved.

Private evidence: `.local/omar/initialization-result.json` and
`.local/omar/initialization-repeat-check.json`. Neither contains login/password
values. They and the credential file are Git-ignored and mode 0600. If a future
failure leaves a credential file without a successful result, stop for review;
never overwrite the file or reset existing accounts to recover automatically.

## Tests and next step

All **22 offline tests passed**, including six initializer tests covering existing
state refusal, migration/seed mismatch, existing model settings and secure
hashing, exclusive 0600 credential writes and symlink rejection, transaction
failure/refusal before writes, and credential-safe CLI errors. No live database
was used by the unit tests. Live checks were restricted to the approved Omar
target for initialization and read-only verification.

The next authorized phase may start the backend with `backend/omar_local.py` and
the private config. Keep `bootstrap=False`, disabled developer routes, disabled
dotenv loading and loopback binding. Recheck config, uploads and port 5104 first.
Server/HTTP behavior and full runtime model/schema compatibility remain untested;
this GO decision permits a controlled first smoke test, not a claim of complete
operational readiness. No employees, cashier setup, services or frontend work is
authorized by this initialization result.
