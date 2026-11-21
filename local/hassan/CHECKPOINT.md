# Pre-branding local safety checkpoint

Review date: 27 October 2026. Workspace:
`<OMAR_SOURCE_ROOT>`, branch `feat/omar-fahim-setup`.
Parent/base commit: `adf9fe6b11034bd1848681e005be6ac920ddc1f0`.
Requested single local commit title:
`chore(omar): checkpoint isolated working salon`.
The resulting SHA is reported after committing; this file avoids a self-referential SHA.

## Scope and current state

This checkpoints the isolated working source, safe templates, local tooling,
regressions, existing temporary text identity and phase documentation before any
new visual redesign. The owner reports successful manual invoicing, appointments
and inventory checks. Those business workflows are not executed again here.

The live Omar Backend/Admin/Mini remain on 127.0.0.1 ports 5104/3100/5176;
PostgreSQL target is fixed to 127.0.0.1:55432 / omar_fahim_local. No process was
stopped/restarted and no DB connection, migration, provisioning, reset or cleanup
was performed in this checkpoint. Existing private config/credentials and local
services are preserved. Historical phase reports are snapshots, not current DB
inventories. Fictional QA specifications are explicitly NOT CLIENT DATA; no
customer or financial row export is included.

README's obsolete current-state introduction was corrected as documentation
only. One Markdown hard break in the temporary-identity report was expressed
with an explicit `<br>` to pass staged whitespace checking without changing
rendered content. No application behavior was changed during this checkpoint.

## Security and sparse-checkout review

All intended changed/new file contents were scanned, and the application diffs,
new runtime/setup/config code, test fixtures, manifests and documentation were
reviewed. Checks cover known private Omar credential values (without printing
those values), JWT patterns, private-key blocks, provider-token patterns, dump
signatures, symlinks, file types and suspicious paths. Flagged literals are inert
offline fixtures or explicit placeholders, not credentials for running services.

No actual passwords, logins from private credential files, JWTs, private keys,
production environment files, uploaded images, operational data files, database
dumps/backups, browser profiles, PostgreSQL data/logs or private runtime config
are in the commit delta. The SVG addition contains text only, with no embedded
image/external reference. Dependency files contain package/version specifications,
not registry credentials or private URLs.

`/.local/` remains Git-ignored and has no tracked files. Private backend.json,
initial-admin.json, cashier-qa.json, uploads, browser profiles, database/logs and
generated dependency/build caches are excluded. Templates deliberately use only
local origins and placeholder/empty secrets; backend.example.json fails real
runtime validation until separately prepared privately.

Sparse checkout was not expanded. There are 450 excluded tracked paths in the
shared base. No tracked deletion is present. Explicit reviewed filenames are
staged; their set must not intersect excluded paths. `git add --sparse` is used
only with this exact filename manifest so new Omar paths outside the original
file-level sparse patterns can be indexed without expanding checkout rules. Staged blobs are checked
against the reviewed working files before the commit. Existing shared history
and sensitive historical files remain untouched: this is a clean change-set
review, not a claim that repository history is secret-free. No history rewriting,
push, merge, rebase, cherry-pick or deployment is performed.

Existing Git author/committer configuration is used without changing identity
settings. No active executable Git hooks were found.

## Machine-specific assumptions and defaults

The local tools intentionally require this absolute workspace, branch, approved
loopback ports/origins, private uploads/config directory, isolated venv and
specific Omar PostgreSQL cluster path. Homebrew Node/PostgreSQL paths and the
machine's home path are explicit. These are fail-closed local scope restrictions,
not portable deployment defaults. Moving machines/paths requires a separate
review of guards/manifests; this checkpoint does not generalize or relax them.

Omar startup disables dotenv inheritance, legacy bootstrap, debugger/reloader,
developer routes and legacy first-device authorization. It explicitly selects
psycopg2, loopback binding, Omar cookie/storage namespaces and existing proof
requirements. Shared factory behavior stays compatible through its default
bootstrap argument; the dedicated Omar caller passes bootstrap=False.
Migration/initialization/provisioning helpers require explicit invocation and
reviewed first-time state, refuse existing conflicting data and are not called
during ordinary startup. None was executed in this checkpoint.

## Validation

- Backend safety tests: **26 passed**.
- Frontend isolation, targeted receipt/retry/auth and temporary-branding tests:
  **31 passed** (11 isolation, 12 receipt/retry, 4 auth, 4 branding).
- Admin approved Omar production build: **passed**.
- Mini approved Omar production build: **passed**.
- Whitespace/error and staged file/security checks are required before commit.

Only approved build/check launchers were used. No frontend/backend server was
started by validation and no live business action was performed. Existing Vite
large-chunk warnings remain; no bundling redesign was attempted.

Full TypeScript checks were also run and still report **19 Admin + 2 Mini**
known diagnostics; compiler settings and errors were not suppressed:

| Existing debt | Count |
| --- | ---: |
| Admin missing chart fixture exports | 8 |
| Admin Header never/replace typing | 1 |
| Admin report numeric Object.entries values | 4 |
| Admin SettlementErrorBoundary props/setState typing | 5 |
| Admin visible-polling timer type | 1 |
| Mini Expense.customerId type contract | 1 |
| Mini InventoryOnlyApp CSS custom-property typing | 1 |

The prior classification remains in FRONTEND_BLOCKER_TRIAGE.md. These known
nonblocking type diagnostics do not invalidate successful production builds or
the required runtime/isolation regressions. No unrelated repair was made.

## Exact reviewed file manifest

### Local runtime and guarded setup tools (14)

- `.gitignore`
- `backend/app/__init__.py`
- `backend/omar_initialize.py`
- `backend/omar_local.py`
- `backend/omar_migrate.py`
- `local/omar/admin.env.example`
- `local/omar/alembic/env.py`
- `local/omar/audit_migrations.py`
- `local/omar/backend.example.json`
- `local/omar/migration-graph.json`
- `local/omar/mini.env.example`
- `local/omar/provision-cashier.py`
- `local/omar/requirements.in`
- `local/omar/requirements.lock.txt`

### Frontend isolation and temporary identity (11)

- `local/omar/admin.vite.config.mjs`
- `local/omar/branding.mjs`
- `local/omar/frontend-config.mjs`
- `local/omar/frontend-contract.json`
- `local/omar/frontend-dev.mjs`
- `local/omar/frontend-source-inventory.json`
- `local/omar/frontend.mjs`
- `local/omar/isolation-source-guard.mjs`
- `local/omar/mini.vite.config.mjs`
- `local/omar/wordmark-ink.svg`
- `local/omar/wordmark.mjs`

### Reviewed application corrections (5)

- `admin/components/supply/ReceiveSupplyModal.tsx`
- `mini/App.tsx`
- `mini/components/Receipt.tsx`
- `mini/src/api/client.ts`
- `mini/src/utils/whatsappUtil.ts`

### Offline regression and safety tests (10)

- `backend/tests/test_omar_cashier.py`
- `backend/tests/test_omar_driver.py`
- `backend/tests/test_omar_initialize.py`
- `backend/tests/test_omar_local.py`
- `backend/tests/test_omar_migrate.py`
- `backend/tests/test_omar_readiness.py`
- `local/omar/auth-ui.test.cjs`
- `local/omar/blockers.test.cjs`
- `local/omar/branding.test.mjs`
- `local/omar/frontend.test.mjs`

### Documentation and historical QA specifications (13)

- `local/omar/BACKEND_SMOKE_RESULT.md`
- `local/omar/CASHIER_DEVICE_RESULT.md`
- `local/omar/FICTIONAL_QA_DATASET.md`
- `local/omar/FRONTEND_BLOCKER_TRIAGE.md`
- `local/omar/FRONTEND_ISOLATION.md`
- `local/omar/INITIALIZATION_RESULT.md`
- `local/omar/LIVE_INTEGRATION_RESULT.md`
- `local/omar/MIGRATION_READINESS.md`
- `local/omar/MIGRATION_RESULT.md`
- `local/omar/MINI_AUTH_FIX_RESULT.md`
- `local/omar/README.md`
- `local/omar/TEMPORARY_IDENTITY_RESULT.md`
- `local/omar/CHECKPOINT.md`

## Boundaries before the next branding phase

No checkpoint safety blocker remains when the staged checks above pass. Full
branding is not implemented here. Existing temporary text identity is retained;
current functional behavior and documented TypeScript debt form the checkpoint.

The Git checkpoint does not capture ignored installed environments, runtime
credentials, browser device keys, uploads or PostgreSQL contents. Those remain
in their existing private local locations; no backup/export was created.
Do not rerun historical setup/migration instructions against current QA data.
The next visual task must preserve auth/device security, existing business and
financial workflows, and original canonical/default brand selection.
