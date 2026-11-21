# Omar first live Admin/Mini integration — Phase 3B.1

Result: **PASS for the read-only integration scope. GO for separately authorized
local cashier/device provisioning.** Nothing was provisioned here. Backend,
Admin, Mini and the test browser were closed after evidence collection. The three
application ports are free. Existing operational/financial source was unchanged.

## Exact launch commands and targets

Run from `<OMAR_SOURCE_ROOT>` on `feat/omar-fahim-setup`, HEAD
`adf9fe6b11034bd1848681e005be6ac920ddc1f0`:

```sh
.local/omar/venv/bin/python backend/omar_local.py --config .local/omar/backend.json --start
node local/omar/frontend-dev.mjs admin
node local/omar/frontend-dev.mjs mini
```

URLs: backend `http://127.0.0.1:5104`, Admin `http://127.0.0.1:3100`, Mini
`http://127.0.0.1:5176`. PostgreSQL remained the dedicated Omar cluster at
`127.0.0.1:55432`, database/session role/owner `omar_fahim_local`.

Preflight verified exact workspace/branch/status, private configuration, cluster
PID/path/start time, SCRAM rules and connection, migration head, full initialized
row/sequence fingerprint, origin contract, private directories and uploads. All
application ports were free before each attempt. No other project process was
stopped. These checks ran before Flask application imports in the supervisor.
The backend used only the existing Omar entry point with dotenv/debug/reloader
and legacy bootstrap disabled. No migration or provisioning tool was executed.

A minimal `frontend-dev.mjs` was added because the existing runner was intentionally
build/typecheck-only. It accepts only admin or mini, verifies the branch, reviewed
Omar config and source inventory, refuses occupied ports, and starts only the
separate Omar Vite configuration in a clean environment with explicit loopback,
port, strictPort and mode. It forwards shutdown to its own Vite child only.

## Browser environment and reviewed traffic

Installed Chrome was driven headlessly with Playwright Core 1.64.1, installed only
under ignored `.local/omar/browser-tools`. The successful run used a new, unused
persistent profile at `.local/omar/browser-profile-3b1-verified`, with no profile
import, sync, extensions, cookies, tokens, IndexedDB databases or service workers
copied from any existing browser. Initial cookies and per-origin storage were
empty. Normal TLS verification remained enabled. The browser was closed normally.

The test allowed only reviewed backend paths: Admin login/refresh, branches,
dashboard overview, revenue and branch-performance analytics, and unauthenticated
Mini auth/me. Actual business requests were GETs except the normal Admin login
POST. No cashier login, proof challenge, enrollment, finalize, record creation,
settings save or other mutation request was made. Static public CDNs were allowed
separately; no wildcard business-API permission was used. Final unexpected or
unreviewed-request list was empty.

The successful pass observed these statuses:

| Endpoint/action | Result |
| --- | --- |
| Backend `/health` | 200 |
| Admin document and login interface | Rendered in real Chrome |
| `POST /api/admin/auth/login` | 200; actual private Omar credentials, SUPER_ADMIN/global scope |
| `GET /api/admin/dashboard-v2/overview` | 200; dashboard rendered without fatal error |
| `GET /api/admin/analytics/revenue` | 200 |
| `GET /api/admin/analytics/branch-performance` | 200 |
| `GET /api/admin/branches` | 200 |
| `GET /api/admin/branches?exclude_main_warehouse=true` | 200; only Omar Fahim Salon, Giza, internal=false |
| Admin reload | Session persisted and authenticated dashboard reads succeeded |
| Admin UI logout | Login interface returned; token, refresh token and user storage removed |
| Mini document/login interface | Rendered normally; no login or enrollment attempt |
| Mini same-origin `GET /api/mini/auth/me` | 401 as expected; backend log confirms proxy reached Omar |

Admin's existing service, promo, employee, attendance, customer, invoice,
treasury, inventory, expense, report and settings navigation controls remain
present. They were inspected, not clicked to trigger unreviewed work. This does
not certify every screen or financial workflow.

The Super Admin's unfiltered selector and global branch-performance cards include
both active locations, including Main Warehouse; that is existing checkpoint
behavior. It was not hidden or rewritten. The explicit operating-only filter
returned only Omar Fahim Salon, and the database warehouse classification remained
internal. Do not interpret the general global selector as an operating-only list.
If all global views must visually distinguish/exclude warehouses, that needs a
separate approved UI/business-rule task, not an auth workaround.

## Isolation and device security

Admin business API origins were exclusively `http://127.0.0.1:5104`. Mini's
unauthenticated API URL was `http://127.0.0.1:5176/api/mini/auth/me`, proxied to
5104 and verified in backend logs. WebSockets were only Vite HMR on the two
approved loopback frontend ports. No Nady backend, production, socket or storage
request was made. Existing 5432/5433 PostgreSQL services were not connected to or
modified. Original Nady workspace files were not accessed.

Admin stored only Omar-prefixed local keys: admin access/refresh/user and selected
branch/tab. Reload tested newly issued Omar auth, not a copied token. Logout
cleared all three auth entries. Mini started with empty storage and created only
its normal namespaced local `omar:mini_device_id`; this is browser-side identity,
not server enrollment. No Mini token, cashier, device context, proof database or
key was present. WebCrypto/IndexedDB secure-context primitives were available.
There were zero service workers and zero cookies in the final cookie inventory.
No proof/cashier gate was bypassed. Device cookies/keys are intentionally not
issued until a later legitimate authorized enrollment flow.

No raw password, login identifier, JWT, response body or auth header was logged.
Screenshots mask inputs and private login text. Evidence and profiles are private
under ignored `.local/omar`; they must not be copied to tracked files or reused as
another client's browser profile.

## Blockers found and bounded corrections

The first live attempt revealed a dev-only configuration collision: Admin's
`/api/*.ts` source modules shared the broad `/api` proxy prefix. The initial browser
safety classifier also mistook those module fetches for business APIs. The first
proxy narrowing was incomplete because `/api/admin` still matched
`/api/adminFetch.ts`; the next attempt confirmed a backend 404 for that module.

The final proxy key is the namespace-boundary regex
`^/api/(?:admin|mini)(?:/|$)` plus `/uploads`, for both dev and preview. All Admin
API source modules now remain Vite-served; actual Admin/Mini API paths still
proxy only to Omar. A regression covers every current Admin API source filename
and representative real API/upload paths. Only Omar config/tests changed; no
business logic or authentication permission was changed to make the UI load.

A separate supervisor invocation selected a previous probe script and was refused
by the existing-profile guard before browser reuse. It was corrected in temporary
test automation only. Another pass discovered two child-dashboard analytics GETs
not yet reviewed by the test allowlist; they were blocked, then their handlers and
query-only financial helpers were reviewed before being permitted in the final
pass. No test guard was disabled. Earlier stopped attempts all had unchanged
before/after fingerprints and clean server shutdowns.

## Console/runtime findings

- **No unhandled JavaScript exceptions** and no failed business API calls in the
  successful pass, apart from the deliberately unauthenticated Mini 401.
- **Expected** console resource error for that 401, not a cashier-auth bypass or
  server failure.
- **Nonfatal UI warning:** Recharts briefly reported negative container dimensions
  during initial measurement; the dashboard rendered. No sizing rewrite was made.
- **Nonfatal asset issue:** Chrome blocked Mini's inherited public Phosphor CSS
  request from jsDelivr with `ERR_BLOCKED_BY_ORB`. Mini's login UI still rendered;
  this public asset issue is left for a separate asset/branding review.
- **Expected local notices:** Tailwind CDN production-use warning, Flask dev-server
  notice and missing Cloudinary credentials. No Cloudinary connection occurred.

Inherited Arabic branding/logos, receipt wording/contact text and explicitly
user-triggered WhatsApp behavior remain for Phase 4. The Omar-only receipt QR
build overlay still encodes Mini's local origin rather than the old client link.
No receipt was issued/rendered from new business data or sent externally here.

## Database comparison and shutdown

Before and after SHA-256 row/row-version/sequence fingerprint:

`78c4b50492e1f6c1e90068e78d77e1aad5c7bed003c000477f4179b49357711a`

Both snapshots are identical. Head remains `zr_payroll_settlement_ledger`; schema
remains 59 application tables plus `alembic_version`; one active global Super
Admin, one operating Omar Fahim Salon branch and one unchanged Main Warehouse.
All other application tables remain empty. No cashier, enrollment, customer,
invoice, service, stock, treasury or other operational record was created.
Uploads remain empty and unchanged.

SIGINT was sent only to each owned Omar launcher/backend. Backend, Admin and Mini
all exited with code **0**. Ports 5104, 3100 and 5176 were confirmed free afterward.
PostgreSQL listener PIDs/bindings remained 23687 on 5432, 54405 on 5433 and Omar
74970 on 55432. The dedicated database itself remains running as before.

## Evidence, tests and files

Successful private evidence: `.local/omar/live-3b1-verified/` contains sanitized
browser results, server logs, listener ownership, before/after database snapshots,
summary result and masked Admin login/dashboard and Mini login screenshots.
Directory permissions are 0700 and evidence files 0600. Earlier attempts remain
under their separate `.local/omar/live-3b1*` directories; the unsuccessful profile-
reuse probe overwrote its prior probe's browser summary, but backend 404 logs and
supervisor state/shutdown records remain. The successful evidence is separate.

Tests run: **12 targeted receipt/retry tests**, **11 isolation/config tests**,
**24 backend safety tests** passed; new launcher syntax check passed. Both previous
Phase 3A.1 builds passed; no new production build or full tsc cleanup was needed
for this dev-proxy-only correction. The documented 19 Admin/2 Mini TypeScript
technical-debt diagnostics remain unresolved and were not suppressed.

Files changed in this phase: `local/omar/frontend-dev.mjs` (new),
`frontend-config.mjs`, `frontend.test.mjs`, this report (new), and `README.md`.
Private browser-tool dependencies, profiles and evidence are ignored. Existing
application code, lockfiles, database schema/history, financial formulas and
Phase 2/3 fixes were preserved. No commit, push, merge or deploy occurred.

Next authorization may provision a local cashier on the **operating Omar branch**
and test legitimate device enrollment/proof/cookie flows. This GO decision does
not authorize that action now or certify flows deliberately not exercised here.
Stop after Phase 3B.1.
