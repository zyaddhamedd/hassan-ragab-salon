# Omar local runtime — pre-branding checkpoint

The isolated local Backend, Admin and Mini are working and running on the
approved loopback ports. Super Admin login, cashier authentication/device proof,
receipt regressions, frontend isolation and temporary text branding have passed
their recorded checks. The owner has also manually verified invoicing,
appointments and inventory workflows. This checkpoint does not repeat those
business actions or inspect/change current application data.

Current code/configuration and validation scope are recorded in
[CHECKPOINT.md](CHECKPOINT.md). Private runtime configuration, credentials,
uploads, database files, browser profiles, dependencies and generated builds are
not part of the Git checkpoint. Preserve them separately in their existing
private local locations; no backup/export is created by this task.

**The phase reports below and later sections of this README are historical
execution records, not a live database inventory.** The database now contains
local QA activity. Do not assume it is empty, rerun migrations/initializers,
replace accounts or reset devices based on an earlier snapshot.
[FICTIONAL_QA_DATASET.md](FICTIONAL_QA_DATASET.md) describes fictional development
fixtures, not official client staff/pricing or current financial records.

Use only the dedicated Omar launchers and origins. Local services remain running
through this checkpoint. No new branding redesign, feature work, provisioning,
migration, database cleanup, commit to another branch or deployment is implied.
The historical result documents remain preserved:

- [Backend smoke test](BACKEND_SMOKE_RESULT.md)
- [Admin/Mini live integration](LIVE_INTEGRATION_RESULT.md)
- [Cashier/device integration](CASHIER_DEVICE_RESULT.md)
- [Mini auth UI fix and retest](MINI_AUTH_FIX_RESULT.md)
- [Temporary text identity](TEMPORARY_IDENTITY_RESULT.md)
- [Frontend diagnostic classification](FRONTEND_BLOCKER_TRIAGE.md)

## Current configuration

| Setting | Omar-only value |
| --- | --- |
| PostgreSQL host/port | `127.0.0.1:55432` |
| Database and application role | `omar_fahim_local` |
| Backend bind | `127.0.0.1:5104` |
| Admin origin | `http://127.0.0.1:3100` |
| Mini origin | `http://127.0.0.1:5176` |
| Uploads | `<OMAR_SOURCE_ROOT>/.local/omar/uploads` |
| Python environment | `.local/omar/venv` (Python 3.12.15) |
| Private backend config | `.local/omar/backend.json` (0600) |

The private config contains independent fresh database, application and JWT
secrets. Never print it, copy it into tracked files, or reuse Nady environment
files. The checked-in `backend.example.json` has placeholders and intentionally
fails validation. `.local/` is Git-ignored. The validator checks secret shape and
separation; it cannot prove a secret has never been used elsewhere.

## Dedicated PostgreSQL cluster

PostgreSQL 16.15 uses the existing Homebrew PostgreSQL 16 binaries with its own
private data directory outside the repository:

`<OMAR_LOCAL_CLUSTER_ROOT>/data`

The cluster root and data directories are mode 0700. Sibling `credentials.json`
is mode 0600 and contains dedicated cluster/application credentials; sibling
`server.log` is its private server log. Do not copy credentials into Git.

The cluster listens only on `127.0.0.1:55432`; Unix sockets are disabled. HBA uses
SCRAM-SHA-256 for the application role on its own database and the dedicated
`omar_cluster_admin` on this cluster's maintenance database. Other connection
paths are rejected. There are no trust rules. The application role owns its
own database/schema and can perform later reviewed migrations, but has no
superuser, create-database, create-role, replication, bypass-RLS or inherited-role
privileges. Its connection limit is 10. PUBLIC application-database access was
removed; application access to maintenance/template databases is denied.

Phase 2B.1 verified correct-password success, wrong-password rejection, admin
impersonation rejection and maintenance-database rejection. Phase 2B.2A verified
connection identity, version and zero application tables using read-only system
catalog queries only. Phase 2B.2B then verified the migrated schema and exact seed
state after commit. No existing 5432/5433 cluster was connected to or modified.

The cluster is manually running; no Homebrew service or launch agent was added.
A future authorized maintenance task must use PostgreSQL 16 `pg_ctl` with this
exact data directory and sibling log. Do not re-run `initdb`, change shared
services, or target another cluster.

## Offline checks

From the Omar workspace root:

```sh
.local/omar/venv/bin/python backend/omar_local.py --config .local/omar/backend.json
.local/omar/venv/bin/python -m unittest discover -s backend/tests -p 'test_omar*.py' -v
.local/omar/venv/bin/python local/omar/audit_migrations.py
.local/omar/venv/bin/python -m pip --isolated --disable-pip-version-check --no-cache-dir check
```

These checks do not construct a Flask app, start servers, connect to a database,
or execute migrations. The startup-contract unit test replaces the application,
config class, factory and server with stubs and blocks real runtime imports and
socket connections. The graph audit only parses source with AST.

`migration-graph.json` records all 57 active revisions and their hashes. Regenerate
it with the graph-audit command redirected to that file after an authorized
migration-source change; review differences rather than stamping the database.

Dependencies are installed only in the workspace environment, without system
site packages. `requirements.in` adds the missing optional PDF packages to the
shared backend requirements without changing deployment requirements.
`requirements.lock.txt` records all installed versions for Python 3.12/macOS ARM.
For a future clean environment, install that snapshot into the new isolated
environment, then run `pip check`; it does not include wheel hashes or promise
compatibility on other platforms. Existing model construction and password
hashing are verified. Omar now explicitly selects the installed psycopg2 driver
after strict target validation, without changing private config or dependencies.
All 24 backend offline tests and the minimal live backend HTTP smoke test pass. This is
not full business-workflow validation; Admin/Mini remain unstarted.

## Guarded migration record

The approved migration invocation was:

```sh
.local/omar/venv/bin/python backend/omar_migrate.py --config .local/omar/backend.json --apply
```

This is a historical record, **not an instruction to rerun**. The runner requires
an empty database and refuses existing execution evidence. Its `--check` mode
performs read-only preflight for an empty database and will now reject Omar's
migrated schema. Both modes revalidate exact target, cluster identity, SCRAM
authentication, ownership, private configuration and canonical graph hashes.

The separate Omar Alembic environment imports no Flask/application factory and
runs only the unchanged canonical revision directory, using the guard's explicit
connection inside one transaction. Private redacted logs and the committed result
are in `.local/omar/migration-*.log` and `.local/omar/migration-*.json`.

Uploads is an empty, real directory with mode 0700; every parent under `.local`
resolves within this worktree and there are no upload symlinks. A temporary
exclusive write probe succeeded in Omar's directory and was removed. The runtime
validator rejects a redirected upload root. Upload helpers use this validated
absolute path, so no Nady uploads fallback is selected. Do not introduce symlinks
or share this directory with another application.

## Controlled startup contract

`backend/omar_local.py` validates the explicit JSON file before importing Flask
or application code. Default invocation is offline validation only. Unknown keys,
unexpected hosts/ports/database/user names, URL options, weak/matching secrets,
redirected uploads and enabled developer routes fail closed. No Cloudinary
settings or developer master token are accepted.

The future `--start` path discards inherited environment settings, applies only
the validated config, configures Omar-only CORS/proof origins and calls
`create_app(bootstrap=False)`. It disables Flask's own dotenv loading, debug and
reloader, binds loopback and limits its single-process pool to five connections
with zero overflow. Do not increase process count without reviewing the role's
connection limit. Startup performs no migration, schema creation or provisioning.
The legacy fixed-password admin and warehouse bootstrap block is skipped.
The runtime SQLAlchemy URL is derived from the unchanged strict validator's
result, changing only its driver to `postgresql+psycopg2` before factory setup.
The stored `postgresql://` URL and all target checks remain unchanged.

Shared `run.py` still loads `.env`, then `.env.<FLASK_ENV>` with override enabled;
its claim that system variables cannot be overwritten is inaccurate. Procfile
and Docker still migrate before Gunicorn. Their existing Nady-compatible behavior
is preserved; none is an approved Omar local entry point. Migration initialization
in the factory registers Flask-Migrate but does not itself execute migrations.

Admin/Mini env examples are public templates for later authorized frontend work.
Use the listed `127.0.0.1` origins and explicit Omar API/proxy values; never put
backend secrets in Vite configuration. Phase 3A uses separate Omar Vite configs,
not these env files or the original Vite fallback paths. Build/check commands,
namespaced credentials/cookies, proof origins and third-party assets are recorded
in `FRONTEND_ISOLATION.md`. Phase 3A.1 changes only three application files for the
confirmed receipt/retry defects; `FRONTEND_BLOCKER_TRIAGE.md` records the evidence.
All other present frontend files and both lockfiles retain checkpoint content.
Isolation builds now fail on unreviewed storage/env/URL source-pattern drift;
never blindly refresh `frontend-source-inventory.json` to bypass that review.

For a separately authorized live session, `node local/omar/frontend-dev.mjs admin`
and `node local/omar/frontend-dev.mjs mini` use only the reviewed Omar configs,
strict loopback ports and a clean environment. The original npm dev scripts are
not Omar launchers. Actual API namespaces are proxied with
`^/api/(?:admin|mini)(?:/|$)` so Admin's `/api/*.ts` modules remain Vite-served.
No servers are currently left running. Use a dedicated fresh Omar browser profile.

## Explicit initialization record

`backend/omar_initialize.py` created exactly one active operating branch,
`Omar Fahim Salon` in `Giza`, and one active global Super Admin using the existing
models and secure password hasher. The existing `Main Warehouse` row and row
version are unchanged. The generated local-only login and fresh password are
stored only in `.local/omar/initial-admin.json` (0600, ignored). Do not print or
copy that file into Git. No real person's identity or client contact details were
invented. The operating branch retains the model's default discount setting.

The explicitly authorized `--apply` completed once. Its second invocation refused
with exit code 3; every table row, sequence value and private artifact remained
unchanged. The command locks users/branches, checks first-time state and uses one
transaction. It never calls the app factory or legacy bootstrap and never runs
migrations. It refuses existing users, operating branches, credential paths or
conflicting state rather than modifying/replacing them. Do not rerun it to reset
credentials. Its `--check` mode is for pre-initialization and now refuses; its
`--verify` mode checks the initialized state read-only against the private
credential file. No account credentials are printed by any mode.

The canonical warehouse uniqueness index remains absent. The initializer enforced
the expected single warehouse under a table lock; it did not add DDL or alter
production business rules. Private sanitized result/repeat evidence lives in
`.local/omar/initialization-result.json` and
`.local/omar/initialization-repeat-check.json`.

## After the successful backend smoke retest

Health, unauthenticated rejection, disabled developer routes, private Super Admin
login and authenticated read-only branch/warehouse filtering passed. Database
rows/sequences, revision, users/branches and uploads were unchanged. The server
exited cleanly on SIGINT and port 5104 is free. Evidence is in ignored
`.local/omar/smoke-2b2d-retest/`; the original failed evidence is preserved.
Future startups must revalidate identity/config, uploads and port 5104 and retain
the same guarded settings. Phase 3A has since added Omar-only cookie names to
prevent host-cookie reuse. Phase 3B.1 verified fresh browser storage, Admin
persistence/logout and unauthenticated Mini isolation; device cookies/keys
were provisioned through legitimate Phase 3B.2 enrollment; signed login, replay
rejection, persistence and token clearing on logout were verified.
Phase 3B.2 explicitly created one synthetic cashier/employee through the existing
Super Admin user endpoint. No services or operational records were created.
Omar-only startup now disables legacy first-device compatibility and explicitly
requires proof enrollment; shared production defaults are unchanged.

Sparse checkout was not expanded. Active application source, all active
migrations and the required existing build/dependency inputs remain present.
