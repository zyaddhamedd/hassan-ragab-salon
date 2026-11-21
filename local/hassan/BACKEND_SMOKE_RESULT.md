# Omar PostgreSQL driver fix and smoke retest — Phase 2B.2D

Result: **PASS. GO for Phase 3 Admin/Mini preparation.** This is a minimal backend
smoke-test result, not full POS/CRM feature acceptance. No frontend was started.
The Omar backend was gracefully stopped after verification and port 5104 is free.

## Minimal Omar-only fix

`backend/omar_local.py` derives a SQLAlchemy URL from the result of the unchanged
strict `validate` function and changes only its `drivername` to
`postgresql+psycopg2`. It assigns that URL to Omar's Config before the factory
initializes its engine. Database, role, host, port and password are preserved;
unknown targets and driver-qualified input URLs are still rejected. The private
config remains unchanged with its strictly validated `postgresql://` input.

No package was installed or changed. The existing psycopg2-binary 2.9.13 is used
with SQLAlchemy 2.1.6. No shared business logic, canonical migration, production
configuration, source feature, branding or employee app was changed. Omar's
migration/initializer engines already select this same driver explicitly.

The original attempt failed before binding because SQLAlchemy 2.1 selected the
uninstalled psycopg 3 driver for a generic PostgreSQL URL. Its private evidence
remains untouched in `.local/omar/smoke-2b2d/`. Only the approved driver fix was
made before this one successful retest; no unrelated runtime repair was needed.

## Preflight and startup

Verified workspace `<OMAR_SOURCE_ROOT>`, branch
`feat/omar-fahim-setup`, HEAD `adf9fe6b11034bd1848681e005be6ac920ddc1f0` and Git
status. Before Flask imports, the supervisor verified the exact private config,
cluster data path/PID/start time, authentication rules, SCRAM login, database and
role/owner `omar_fahim_local` on `127.0.0.1:55432`, expected revision and complete
initialized data fingerprint. It verified port 5104 was free and uploads/private
paths had correct permissions and no symlink redirection. No Nady environment
files or credentials participated.

Only this entry point was started, in a clean child environment:

```sh
.local/omar/venv/bin/python backend/omar_local.py --config .local/omar/backend.json --start
```

It retained `create_app(bootstrap=False)`, disabled developer routes, disabled
dotenv loading, debug and reloader, and loopback-only port 5104. No migration,
provisioning command, legacy startup path or frontend was invoked.

## HTTP results

| Method | Endpoint | Status | Verified behavior |
| --- | --- | --- | --- |
| GET | `/health` | 200 | JSON status is ok |
| GET | `/api/admin/branches` without token | 401 | Unauthenticated access rejected |
| GET | `/api/dev/branches` | 404 | Developer routes unavailable |
| POST | `/api/admin/auth/login` | 200 | Private Omar credentials accepted; SUPER_ADMIN with global scope; tokens held only in memory |
| GET | `/api/admin/branches` with token | 200 | Exactly one operating Omar branch and one internal warehouse |
| GET | `/api/admin/branches?exclude_main_warehouse=true` with token | 200 | Only Omar Fahim Salon, Giza; warehouse excluded |

The private login/password and returned JWTs were not printed or persisted in
smoke evidence. Login was the only POST and its reviewed handler performs no
writes. All other requests were read-only. No customer, employee, invoice,
service, cashier or branch creation/update endpoint was exercised.

## Runtime and state verification

No traceback, missing import, schema error or HTTP failure occurred in the retest.
The expected messages were a Cloudinary-credentials-missing warning (credentials
are deliberately absent) and Flask's local development-server notice. No external
storage call was made. Runtime socket snapshots showed only loopback port 5104
and the approved loopback PostgreSQL connection to port 55432.

Before/after snapshots compare every table row, PostgreSQL row version and
sequence value: identical. Alembic remains `zr_payroll_settlement_ledger`, with
59 application tables plus its version table. Inventory remains one active global
Super Admin, one operating `Omar Fahim Salon` branch in Giza and one unchanged
internal `Main Warehouse` in Cairo. All other application tables remain empty.
Uploads remained empty, with their resolved private root unchanged.

Only the Omar child process was sent SIGINT. It exited cleanly with code 0;
port 5104 was confirmed released. Existing PostgreSQL listener PIDs and bindings
on 5432, 5433 and 55432 were unchanged. No Nady database or production connection
occurred. Shared Git worktree metadata confirms the original Nady HEAD remains
`adf9fe6b11034bd1848681e005be6ac920ddc1f0` on `hotfix/client-support`.
Original Nady files were neither read nor changed. Its working-tree status was
not re-read because the task also explicitly forbids Nady workspace access.

## Tests and evidence

All **24 offline tests passed**. The two added driver tests construct a real
SQLAlchemy engine, confirm its DBAPI is importable psycopg2 and prohibit both
socket and psycopg2 connection attempts. Invalid host/port/database/role, URL
options and driver-qualified input still fail validation. The startup-contract
regression verifies explicit driver assignment before factory initialization;
existing tests retain validation-before-application-import checks.

Private mode-0600 evidence is under ignored `.local/omar/smoke-2b2d-retest/`:
`before.json`, `after.json`, `result.json`, `server.log`, `source-before.json`
and `socket-observations.txt`; directory mode is 0700. All evidence was checked for
private database/application/JWT secrets and admin credentials. Original failed
attempt evidence is preserved. No source/dependency files were changed by the
smoke execution itself.

Phase 3 may prepare the existing Admin/Mini applications without simplifying or
removing the approved POS/CRM functionality. This test did not exercise those
frontends, all business workflows or future branch expansion; none was implemented
or disabled here. No Git commit, push, merge or deploy occurred. Stop after retest.
