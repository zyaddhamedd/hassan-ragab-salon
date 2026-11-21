# Omar Admin/Mini isolation — Phase 3A

Historical Phase 3A snapshot: Phase 3A.1 has since triaged these diagnostics,
fixed the confirmed receipt/retry failures and added a source-drift guard.
See [FRONTEND_BLOCKER_TRIAGE.md](FRONTEND_BLOCKER_TRIAGE.md) for the current
GO decision for controlled Phase 3B, passing targeted tests and remaining debt.
The original NO-GO and 21/3 diagnostic counts below describe the prior snapshot.

Result: **configuration/build isolation PASS; NO-GO for general Phase 3B local
integration until checkpoint type/runtime blockers are reviewed.** No application
server, browser, authenticated action, migration or provisioning was run.

## Workspace and source parity

Workspace `<OMAR_SOURCE_ROOT>`, branch
`feat/omar-fahim-setup`, HEAD `adf9fe6b11034bd1848681e005be6ac920ddc1f0` verified.
All **221 present tracked Admin/Mini files**, including package/lock files, match
that approved checkpoint byte-for-byte. No Admin/Mini application or original
Vite source was modified. The original Nady worktree was not read or changed.
No business/financial logic, routes, screens, security protocol or branch feature
was removed or simplified. Branch expansion remains deferred; existing branch
interfaces remain in the canonical source.

Sparse checkout was not expanded. There are **no missing required runtime/build
source files or assets**. Exclusions are production environment files, tests and
test scripts, documentation, historical backups/rewriters and an archive. All
active imports/assets resolved in both builds, including Admin's shared imports
of Mini receipt components. Existing unresolved exports/names reported by tsc
are checkpoint defects, not source files missing due to sparse checkout.

## Effective Omar configuration

| Application | Browser origin | API destination | Upload destination |
| --- | --- | --- | --- |
| Admin | `http://127.0.0.1:3100` | Explicit `http://127.0.0.1:5104/api/admin` | `http://127.0.0.1:5104/uploads/…` |
| Mini | `http://127.0.0.1:5176` | Same-origin `/api/mini` proxied only to `http://127.0.0.1:5104` | Same-origin `/uploads/…`, same fixed proxy |

Ports **3100 and 5176 were free** when checked; no alternate was needed and no
other project's server was stopped or reconfigured. Both configurations use
loopback, `strictPort: true`, explicit HMR host/port and matching preview proxies.
A future port conflict must stop; do not allow automatic rollover. Backend CORS,
Mini finalization/proof origins and allowed API bases match these exact origins
plus the backend base. An offline test checks the shared public contract against
Omar's effective backend settings.

`frontend-contract.json` is a public contract, not a secret/env file. The separate
`admin.vite.config.mjs` and `mini.vite.config.mjs` use `frontend-config.mjs`; original
Vite configs and their fallback behavior are never loaded in the Omar flow.
Wrong mode, workspace, target/origin/storage contract or a nonempty/redirected
isolated env directory fails closed. The build runner supplies a clean environment;
Vite reads only the empty `.local/omar/frontend-env`, with a separate public prefix.
API values are explicitly defined, not inherited. Gemini key placeholders are
empty. No backend secrets are supplied to Vite. Existing env examples are
reference templates, not files to copy into canonical application directories.

The resulting JavaScript was checked: no `localhost:5001`, `127.0.0.1:5004`,
Railway, secretmen-crm or old receipt Linktree destination remains. A runtime
origin guard refuses another browser origin before mounting. HTML and dev/preview
headers use CSP `connect-src` allowing only self, Omar's backend and the app's
loopback HMR socket. This prevents unexpected fetch/XHR/WebSocket API destinations
without changing POS/CRM calculations or workflow code. Use these local builds
only; they intentionally refuse other deployment origins.

## Browser credentials, cookies and Mini security

A build-only transform namespaces the known browser storage keys with `omar:`:
Admin access/refresh/user, selected branch/tab and invoice export preferences;
Mini access/refresh/cashier, device ID/context, payment-attempt and booking-handoff
session state, queue state, and the `mini-device-proof` IndexedDB database.
Template prefixes and cleanup checks are transformed consistently. No old browser
credentials, proof keys or device IDs are copied or read. Tokens remain in their
existing storage mechanisms; refresh behavior and expiration rules are unchanged.

Cookies are host-scoped rather than port-scoped, so Omar's backend entry point
now overrides only the local cookie names: `omar_session`,
`omar_mini_device_credential` and `omar_mini_enrollment_proof`. Shared Config
production defaults are unchanged. Mini's backend helpers read these config keys;
no cookie/device authentication bypass was introduced. These cookie names apply
on the next authorized backend startup; no backend was started to test them here.

Mini retains cashier-only authentication, challenge/proof signing, enrollment,
strict session binding, replay protection and all existing device gates. An offline
regression proves its proof implementation changes only the IndexedDB namespace.
The browser's loopback secure-context requirement and nonextractable key handling
remain. No cashier or device was provisioned. A later Mini integration test needs
an explicitly authorized real local enrollment/account flow; a Super Admin token
must not be substituted to bypass it.

Phase 3B must use a **fresh dedicated Omar browser profile** to exclude old
service workers, extensions and host cookies from unrelated local projects.
Do not import an existing profile or copy its storage. LocalStorage is origin
scoped; added namespaces and cookie names also defend against port reuse/shared
loopback hosts. Live browser cookie/storage/proof behavior has not yet been tested.

## WebSockets, notifications and external URLs

No WebSocket, EventSource or Socket.IO client invocation was found in application
source. Mini declares socket.io-client as a dependency but does not use it.
Existing notifications use application polling and Admin's public Mixkit sound;
no Nady socket URL is configured. Vite HMR remains loopback-only.

Existing public resources remain for feature parity: Tailwind CDN, Google fonts,
esm.sh import-map entries, Mini Phosphor icon CSS and the Mixkit sound. They are
public assets, not Omar backend API targets. Receipt QR images still use
`api.qrserver.com`; only the encoded former-client Linktree URL is replaced in the
Omar build with Mini's local origin. This preserves QR rendering without inventing
official client URLs. Both Mini receipts and Admin's shared receipt imports receive
this overlay. WhatsApp remains an explicit user-triggered
`web.whatsapp.com/send` action using the selected customer's phone/message; it is
not a silent backend fallback. Future third-party/browser requests must be checked
in Phase 3B; no resource URL was fetched during this phase's browser testing,
because no browser/server testing took place.

Relative upload writes/read paths route to Omar only. Existing components can
still display explicitly supplied external image URLs; no Nady records or upload
URLs were imported. Backend missing-image responses may use public UI Avatars,
which is not shared Nady upload storage. No Cloudinary credentials were supplied.

Inherited names/logos, Arabic branding, metadata, receipt labels/contact text and
WhatsApp message wording remain in canonical source for Phase 4 review. Examples
include Admin Header/Login/Logo and Mini Logo/receipts/queue/waiting screens.
No branding redesign or official Omar contact information was invented.

## Dependency and validation results

Node 22.23.3/npm 10.9.9. Separate local `admin/node_modules` and `mini/node_modules`
were installed with **npm ci using unchanged lockfiles**, public npm registry,
empty private npm config files, no lifecycle scripts, no audit/funding calls and
workspace-local caches. No global packages or system PostgreSQL were modified.

From the workspace root, safe offline commands are:

```sh
node local/omar/frontend.mjs admin build
node local/omar/frontend.mjs mini build
node local/omar/frontend.mjs admin typecheck
node local/omar/frontend.mjs mini typecheck
node --test local/omar/frontend.test.mjs
.local/omar/venv/bin/python -m unittest discover -s backend/tests -p 'test_omar*.py' -q
```

The runner supports build/typecheck only; it cannot start a server. Build outputs
are ignored under `.local/omar/frontend-build/{admin,mini}`. Use the separate Omar
configs in a later authorized dev-server task, never the original npm dev script
or a generic Vite command that would load legacy dotenv/defaults.

| Check | Result |
| --- | --- |
| Admin Omar build | PASS; all active imports/assets resolved |
| Mini Omar build | PASS; all active imports/assets resolved |
| Node isolation/config/bundle tests | **8 PASS** |
| Existing Python safety/contract tests | **24 PASS** |
| Admin full tsc --noEmit | **FAIL: 21 diagnostics** |
| Mini full tsc --noEmit | **FAIL: 3 diagnostics** |

Both builds report existing large-chunk/asset warnings; no code splitting,
feature removal or bundle redesign was done. Full diagnostics and checkpoint
inventory are preserved in ignored `.local/omar/frontend-validation/`.

Typecheck defects are present in checkpoint-identical source and were not hidden
with exclusions, relaxed compiler options or removed components. Admin diagnostics
include absent legacy chart-data exports, Header inference, report values typed as
unknown, SettlementErrorBoundary React typing, undefined `loadProducts` in
ReceiveSupplyModal, polling timeout typing and the shared Mini receipt issue.
Mini diagnostics are `Expense.customerId` mismatch, an inventory CSS custom-property
type and **undefined `calculateGrossTotal` in Receipt.tsx:78**. The latter is a
potential receipt runtime failure when subtotal is absent and groups are present;
Admin imports that same component. Undefined `loadProducts` can also fail in the
supply error/retry render path. Do not rewrite financial calculations or disable
these paths in this configuration phase.

## Decision and next phase

Isolation/build preparation is complete. **NO-GO for general Phase 3B integration**
until the checkpoint type/runtime defects are triaged and any repairs separately
authorized, especially receipt and supply retry blockers. No claim is made that
all existing POS/CRM workflows are safe solely because Vite transpilation passed.
Cookie/storage namespaces and device proof need later live integration checks in
a fresh profile, with no authentication shortcuts. No branch-management feature,
employee PWA, zsbranches work, migrations, provisioning, production access, server
startup, Git commit/push/merge or deployment occurred.
