# Phase 3B.2A — Mini authentication UI fixes and controlled retest

**GO for separately authorized Phase 3C local financial QA.** Both confirmed
blockers are fixed; the complete controlled browser retest passed without page
exceptions. No financial QA or operational writes were performed here.

## Target and preserved state

Workspace `<OMAR_SOURCE_ROOT>`, branch
`feat/omar-fahim-setup`, HEAD `adf9fe6b11034bd1848681e005be6ac920ddc1f0`.
Existing uncommitted work was preserved. No original Nady worktree was inspected.

Before application imports, the supervisor checked exact private configuration,
owner-only paths, dedicated cluster data path/PID/start time/listener, SCRAM HBA,
current/session database role, owner, schema inventory and Alembic head.
The only database target was `127.0.0.1:55432/omar_fahim_local`, role
`omar_fahim_local`. Existing users 2, employees 1, branches 2 (one operating Omar
branch and one internal warehouse), enrolled device 1 and enrollment 1 remained
unchanged. All operational tables were empty before and after.

## Root causes and minimal changes

### Login 401 was incorrectly treated as an expired session

`mini/src/api/client.ts` previously routed `/auth/login` 401 through session
refresh. With no refresh token, `forceLogout` returned a never-settling promise;
`LoginScreen` never reached its catch and left submit disabled.

`fetchWithRefresh` now accepts an explicit `refreshSession` flag, default true.
Only the existing `/auth/login` POST passes false. That request omits a stale
session bearer/DPoP header and returns its original rejected response to the
normal API error parser; it retains the existing explicit login proof in its
body and its device id/credential cookie. The post handler does not force logout
for this login 401, allowing the existing LoginScreen catch to display the error
and stop loading. No LoginScreen rewrite was needed.

All authenticated requests retain existing single-refresh, retry, queue and
forced-logout behavior. Device-related 403 handling and every proof/enrollment
implementation remain unchanged.

### Logout synchronously re-entered session cleanup

`clearMiniSession -> setStoredDeviceContext(null) -> mini:device-context ->
handleDeviceContextChange -> clearMiniSession` recursed while React still exposed
`isLoggedIn=true` to the event listener.

`mini/App.tsx` now uses a stable ref to guard cleanup. Cleanup enters the guard,
performs the existing token/context/UI reset, and releases it in finally. Both a
nested cleanup call and its own synchronous context notification are ignored
while cleanup is in progress. External context loss still logs out normally.
Session cleanup remains safe on repeated invocation. No device cookie, private
key, IndexedDB record or persistent device id is removed on ordinary logout.

## Offline validation and builds

**53 tests passed:**

- 4 new auth/UI regression tests in `local/omar/auth-ui.test.cjs`.
- 26 existing backend safety/provisioning-guard tests.
- 11 frontend isolation tests, also repeated against the newly built bundles.
- 12 existing receipt/retry/financial-semantics tests.

New tests execute the actual client, LoginScreen and App control paths with
mock fetch and React hook lifecycle/state transitions; no server or DB access.
They cover visible 401 error, pending/loading transition, submit recovery,
successful retry, omission of stale session headers while retaining login proof,
expired-session refresh/retry, unusable-refresh logout, repeated/reentrant logout,
external context-loss logout and correct storage cleanup/device-id preservation.
Real browser checks below cover nonextractable key/cookie persistence.

Both approved Omar Admin and Mini production builds passed. Existing warnings
about large chunks remain. No isolation transform, compiler options, source-drift
manifest, device-proof implementation or business/financial source was changed.

Full TypeScript checks still fail with **19 Admin and 2 Mini diagnostics**, matching
previously documented debt; none were suppressed. No new auth diagnostics:

- Admin: existing missing chart fixture exports, Header never/replace,
  numeric Object.entries typing, SettlementErrorBoundary props/setState typing,
  and useVisiblePolling timer typing (19 diagnostics).
- Mini: `App.tsx(688,9)` Expense does not declare customerId; and
  `InventoryOnlyApp.tsx(496,16)` existing CSS custom-property typing.

Full build/typecheck outputs are retained privately under
`.local/omar/live-3b2a/validation/`; prior classifications remain in
`FRONTEND_BLOCKER_TRIAGE.md`.

## Controlled live retest

Only approved loopback launchers were used:

```sh
.local/omar/venv/bin/python backend/omar_local.py --config .local/omar/backend.json --start
node local/omar/frontend-dev.mjs admin
node local/omar/frontend-dev.mjs mini
```

Backend 127.0.0.1:5104, Admin 127.0.0.1:3100, Mini 127.0.0.1:5176. Ports were
free before startup, and listener ownership/loopback binding was verified.
Debugger/reloader/dotenv, legacy bootstrap, developer routes and automatic
migrations remained disabled. No provisioning command was invoked.

The existing legitimate `.local/omar/browser-profile-3b2-enrollment` was required
to retain its enrolled nonextractable key. Its exact real path, filesystem owner
and mode 0700 were verified; browser device id matched the existing Omar device
record, its key matched the server thumbprint, and its HttpOnly cookie remained
present. No other client profile, cookie or credential was imported. Admin used
a separate fresh browser context. Only reviewed read-only APIs and normal
login/proof/security POSTs were allowed.

| Live check | Result |
| --- | --- |
| Admin login / dashboard | 200 / 200 |
| Wrong cashier password | 401, visible error, submit re-enabled |
| Correct password retry on same screen | 200, cashier id 1 / Omar branch id 2 |
| Read-only cashier UI | Rendered, all nine navigation entries present |
| Missing proof | 403 DEVICE_PROOF_MISSING |
| Unapproved/unrecognized device id | 403 DEVICE_NOT_AUTHORIZED; no new enrollment |
| Invalid proof | 403 DEVICE_PROOF_INVALID |
| Missing device credential | 403 DEVICE_CREDENTIAL_MISSING |
| Replay of an already-used signed request | 403 DEVICE_PROOF_REPLAYED |
| Authenticated reload | 200 auth/me, session restored |
| Normal logout | Tokens/context removed, no RangeError or recursive event failure |
| Reload after logout | Login screen, session remains cleared |
| Existing device credential after logout | Same cookie value, HttpOnly |
| Existing proof key after logout | Same thumbprint, one ECDSA signing key, nonextractable; export rejected |
| Subsequent login on approved device | 200, no re-enrollment |
| Second logout and reload | Logged out, no page exceptions |

All observed API traffic targeted Omar directly or through Omar's Mini proxy.
Mini storage remained `omar:` namespaced, proof DB `omar:mini-device-proof`;
no service workers. No Nady/production API calls, operational requests or
unreviewed/blocked destinations. All pageErrors arrays were empty. Existing
public static CDN references and their previous nonfatal notices remain; no
branding or external messaging operation was performed.

## Database and process evidence

Only these three tables changed:

- branch_registered_devices: normal last-seen/proof verification timestamps.
- mini_device_proof_challenges: 3 to 6 rows (ordinary login challenges).
- mini_device_proof_replays: 17 to 23 active rows (normal insert/expiry cleanup).

Only `mini_device_proof_replays_id_seq` changed, 46 to 70. Security replay expiry
cleanup explains why active row growth is smaller than sequence growth. Every
other table's full row/xmin hash and sequence state remained identical, including
users, employees, branches, warehouse, enrollment and alembic_version. No new
cashier, employee, branch, enrollment, device or operational record was created.
No schema changes. Alembic head remains `zr_payroll_settlement_ledger`, 59
application tables plus alembic_version. Uploads remained private and empty.

Full row/xmin/sequence fingerprints:

- Before: `5c490f323a043e179119816af341a931f78cc6c63a485d2ff85b2bff0cd0dc99`
- After: `09e744a470a0a7af152ec71c13a2a2ac89b60e3a43e506498836dc65b92c91b2`

All three owned servers exited 0 after graceful shutdown. Ports 5104/3100/5176
are free. Existing PostgreSQL listeners 5432/5433/55432 were unchanged; no
connection was made to 5432/5433 databases. No original Nady access, migration,
bootstrap, provisioning, invoice/payment or other financial operation occurred.

Private sanitized evidence is in `.local/omar/live-3b2a/`: browser-result.json,
before.json, after.json, result.json, listeners and server logs. Secrets were
redacted; profile ownership contract and browser data must remain private.
Temporary supervisor/browser harnesses are `/tmp/omar-live-supervisor-3b2a.py`
and `/tmp/omar-live-browser-3b2a.cjs`.

## Exact files changed in this phase

1. `mini/src/api/client.ts` — login-specific error propagation; session refresh unchanged.
2. `mini/App.tsx` — reentrancy guard and own-notification suppression during cleanup.
3. `local/omar/auth-ui.test.cjs` — four targeted offline regression tests.
4. `local/omar/README.md` — actual fixed/retested state and current decision.
5. `local/omar/MINI_AUTH_FIX_RESULT.md` — this report.

Private ignored browser/evidence/build artifacts also changed as expected.
Previous uncommitted Phase 2/3 work remains preserved; nothing was committed,
pushed, merged or deployed. No blocker remains from the two auth UI defects.
Existing TypeScript debt remains documented; Phase 3C requires its own explicit
financial QA authorization. Stop here after this successful retest.
