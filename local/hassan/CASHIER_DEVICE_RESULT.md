# Phase 3B.2 — cashier and official device integration verified, defects remain

**NO-GO for Phase 3C financial QA.** Authorized provisioning, legitimate device
approval/proof, cashier login, read-only UI, negative security tests and session
checks completed. Two existing Mini authentication UI defects prevent a clean
pass. Their shared source was not changed under this phase's restrictions.
All owned test servers are stopped.

## Exact target and provisioning

Worktree `<OMAR_SOURCE_ROOT>`, branch
`feat/omar-fahim-setup`, HEAD `adf9fe6b11034bd1848681e005be6ac920ddc1f0`.
Previous uncommitted work was preserved. No original Nady worktree was read.

Before application imports, the test supervisor validated private config and
permissions, strict runtime values, cluster data path/PID/start time/listener,
SCRAM-only HBA and database owner/current/session role. The only database target
was `127.0.0.1:55432/omar_fahim_local`, role `omar_fahim_local`, PostgreSQL 16.
The migration head, original Admin, one operating Omar branch and unchanged
internal warehouse were verified. Application ports were free before each run.

Provisioning command:

```sh
.local/omar/venv/bin/python local/omar/provision-cashier.py
```

The tool checks exact cluster/head/branch, zero employees, original Admin and no
prior cashier credential file. It logs in through existing Admin authentication
and calls canonical `POST /api/admin/users` once. That handler creates the User
and matching CASHIER Employee in one transaction using existing secure hashing.
Matching uses exact `full_name + branch_id + CASHIER`, as Mini login requires;
no new linkage mechanism or model rules were introduced.

| Created record | Verified values |
| --- | --- |
| User id 2 | CASHIER, active, branch id 2 |
| Employee id 1 | Omar Local Cashier QA, CASHIER, ACTIVE, not deleted, branch id 2 |
| Branch | Existing Omar Fahim Salon / Giza, operating, active |
| Employee financial defaults | Salary 0, commission wallet 0; no transactions |

A generated local reserved `.invalid` login and strong random password are stored
in ignored owner-only `.local/omar/cashier-qa.json`. No credentials appear here.
Correct/incorrect scrypt password checks passed. The original Admin row and xmin
are unchanged. The existing warehouse was never modified.

Second provisioning invocation returned exit 2 before HTTP provisioning, with
identical row/sequence fingerprints. Existing credentials are never overwritten,
accounts never reset, and duplicate records never automatically created.

## Omar-only startup and official enrollment

Shared default legacy compatibility can automatically authorize the first device
on an empty branch. Omar's launcher now explicitly sets
`MINI_LEGACY_DEVICE_COMPATIBILITY_ENABLED=False` and
`MINI_PROOF_ENROLLMENT_REQUIRED=True` before factory initialization. This uses
existing configuration to require the official flow; shared production defaults,
models, business rules and device-security implementation are unchanged.

Only approved launchers were used:

```sh
.local/omar/venv/bin/python backend/omar_local.py --config .local/omar/backend.json --start
node local/omar/frontend-dev.mjs admin
node local/omar/frontend-dev.mjs mini
```

Backend bound 127.0.0.1:5104, Admin 127.0.0.1:3100 and Mini 127.0.0.1:5176.
Owned listener/process groups were checked. Debugger, reloader, implicit dotenv,
legacy bootstrap and developer routes remained disabled. No migrations ran.

A fresh dedicated Omar Chrome profile imported no cookies, storage, IndexedDB or
service workers. After an initial negative-password test exposed the stuck-login
UI, a second fresh profile performed enrollment. Later checks resumed only that
Omar-owned profile, preserving its legitimate enrollment cookie and proof key.

Official sequence and evidence:

1. Valid cashier credentials on the unapproved device returned **403
   DEVICE_ENROLLMENT_REQUIRED**, pairing code and private enrollment proof cookie.
2. Existing Super Admin approved pending enrollment **id 1** using canonical
   `POST /api/admin/branches/2/device-enrollments/1/approve`: **200**.
3. Login still returned **403 DEVICE_FINALIZATION_REQUIRED** until Mini's existing
   **إكمال تفعيل الجهاز** button was clicked.
4. Existing browser code generated/persisted its P-256 key, signed the enrollment
   challenge, finalized through the official endpoint and received its credential
   cookie. Login challenge/assertion then succeeded: **200**.
5. Registered device **id 1**, Omar branch id 2, DESKTOP / FULL_MINI, active,
   credential-required and proof-required. Enrollment remains APPROVED with its
   finalization proof consumed. Server recorded verified ES256 proof.

No token injection, manual device insertion, proof bypass or legacy auto-binding.
The entire branches table, including legacy binding fields, remained unchanged.
The harness was corrected twice without changing application source: Fetch
`status` is a property, and the sidebar must be opened before clicking logout.
Those interrupted attempts and their database snapshots remain preserved.

## Live security, UI and session results

| Test | Result |
| --- | --- |
| Wrong cashier password | **401 rejected**; UI recovery defect below |
| Unapproved device | **403 DEVICE_ENROLLMENT_REQUIRED** |
| Admin approval | **200**, existing Super Admin authorization |
| Finalization required before proof | **403 DEVICE_FINALIZATION_REQUIRED** |
| Enrollment challenge / finalize | **200 / 200**, official browser signing |
| Cashier login / subsequent proof-enabled login | **200 / 200**, existing cashier id 1, Omar branch id 2 |
| Private key | One ECDSA signing key, `extractable=false`; export rejected |
| Missing DPoP | **403 DEVICE_PROOF_MISSING** |
| Invalid device id | **403 DEVICE_NOT_AUTHORIZED** |
| Replay of already-used signed request | **403 DEVICE_PROOF_REPLAYED** |
| Cashier token used for Admin branches API | **403**, denied |
| Reload with valid session | **200 auth/me**, cashier screen restored |
| Logout | Session keys removed; login screen remained after reload; exception below |

Authenticated read-only Mini services, products, attendance/today, appointments,
expenses/today and auth/me returned 200. Cashier screen rendered for Omar Fahim
Salon, with all nine existing navigation entries present: waiting, cashier,
attendance, customers, barbers, appointments, expenses, treasury and storage.
No feature/business logic was removed or simplified. No invoice draft is created
on screen load; the existing draft path is lazy until a service is added, and no
such action was performed. A reviewed request allowlist blocked operational
writes; no operational request was attempted or blocked during these tests.

Mini localStorage used only `omar:` keys; proof DB was
`omar:mini-device-proof`; no service workers. Logout left only the device id in
localStorage, retaining the trusted device's nonextractable key and HttpOnly
`omar_mini_device_credential` cookie as designed. Cookie path `/api/mini`,
SameSite=Lax, loopback-only HTTP (`Secure=false` locally). User access/refresh
session tokens and cashier/context entries were removed. Device binding was never
shared with Nady or another client.

All observed business API calls targeted Omar backend directly or through Omar's
Mini proxy. HMR stayed on Omar loopback origins. Existing static CDN requests
remain documented: Tailwind notice, transient Admin Recharts sizing warnings and
Phosphor jsDelivr CSS ORB failure. No Nady API, production token or external
business-data request was observed. Receipt/QR/WhatsApp branding remains deferred;
no receipt or external messaging action was triggered.

## Confirmed defects and decision

**1. Wrong-password login does not recover.** In
`mini/src/api/client.ts`, `fetchWithRefresh` treats the login 401 as a refreshable
session failure. With no refresh token, its catch calls `forceLogout` then returns
`new Promise(() => {})`. `LoginScreen.tsx` awaits `apiClient.post`, so neither
success nor catch completes; `isLoading` remains true and submit stays disabled.
The HTTP password rejection is correct. A normal clean-profile reload recovered
the UI without altering authentication, allowing the legitimate flow above.

**2. Logout synchronously recurses.** `App.tsx` `clearMiniSession` calls
`setStoredDeviceContext(null)`. That function synchronously emits
`mini:device-context`. The active `handleDeviceContextChange` listener still sees
`isLoggedIn=true` and calls `clearMiniSession` again before React state updates.
The captured stack repeats `emitDeviceContextChange -> setStoredDeviceContext ->
clearMiniSession -> handleDeviceContextChange` until **RangeError: Maximum call
stack size exceeded**. It reproduced after a valid session and normal sidebar
logout. Session tokens were removed and the login screen persisted after reload,
but the uncaught runtime exception fails the clean integration criterion.

**NO-GO for Phase 3C** until these two narrowly scoped auth/UI error paths receive
an explicitly authorized fix and regression retest. No shared authentication or
business source was changed to conceal either failure. No financial QA started.

## Final database comparison

| Inventory | Before phase | Final |
| --- | ---: | ---: |
| Super Admin | 1 | 1 |
| CASHIER User / Employee | 0 / 0 | 1 / 1 |
| Operating Omar branch / internal warehouse | 1 / 1 | 1 / 1 |
| Enrollment / registered device | 0 / 0 | 1 / 1 |
| Proof challenges / active replay records | 0 / 0 | 3 / 17 |
| Every other application table | 0 | 0 |

Only six tables changed: users, employees, branch_device_enrollments,
branch_registered_devices, mini_device_proof_challenges and
mini_device_proof_replays. The first two are deliberate provisioning; the other
four are legitimate enrollment/proof/session security writes, including normal
expiry cleanup of replay records. No unexpected writes. No attendance, business
days, shifts, invoices, customers, services, stock, expenses or financial records.

Only their associated integer sequences changed:
users_id_seq, employees_id_seq, branch_device_enrollments_id_seq,
branch_registered_devices_id_seq and mini_device_proof_replays_id_seq.
Schema remains 59 application tables plus alembic_version, head
`zr_payroll_settlement_ledger`. Admin row/xmin and complete branches/warehouse
fingerprints remained unchanged. Upload directory stayed private and empty.

Full row/xmin/sequence fingerprints:

- Before: `78c4b50492e1f6c1e90068e78d77e1aad5c7bed003c000477f4179b49357711a`
- Final: `5c490f323a043e179119816af341a931f78cc6c63a485d2ff85b2bff0cd0dc99`

All owned application processes exited 0 on graceful shutdown; application ports
were released. PostgreSQL listeners 5432, 5433 and 55432 remained unchanged. No
connection was made to existing 5432/5433 databases. Original Nady HEAD/status
was not inspected, as explicitly forbidden; no action targeted its workspace.

## Tests, artifacts and exact changed files

**49 offline tests passed:** 26 backend safety/duplicate-guard tests, 11 frontend
isolation tests and 12 existing receipt/retry tests. Live security assertions
above passed; the complete browser run remains **failed** due to the observed
logout exception, and the initial negative-password UI check also failed.
Frontend builds/full tsc were not rerun because frontend source/config did not
change; previously documented TypeScript debt remains unsuppressed.

Files changed in this phase only:

1. `backend/omar_local.py` — explicit Omar approval/proof flags.
2. `backend/tests/test_omar_readiness.py` — offline startup flag assertions.
3. `backend/tests/test_omar_cashier.py` — new duplicate-provisioning guard tests.
4. `local/omar/provision-cashier.py` — guarded one-time canonical HTTP provisioning.
5. `local/omar/README.md` — current state and remaining blockers.
6. `local/omar/CASHIER_DEVICE_RESULT.md` — this report.

Private ignored additions include cashier-qa.json, browser-profile-3b2* and
live-3b2* evidence directories under `.local/omar/`. Final sanitized browser stack,
security results, row counts and inventory verification are in
`.local/omar/live-3b2-final-check/`; earlier attempts are preserved. Never share
credentials or browser profiles. Temporary supervisors/browser harnesses in
`/tmp/omar-live-*-3b2*.{py,cjs}` were used only for this phase.

Git status remains uncommitted on the expected branch:

```text
 M .gitignore
 M admin/components/supply/ReceiveSupplyModal.tsx
 M backend/app/__init__.py
 M mini/components/Receipt.tsx
 M mini/src/utils/whatsappUtil.ts
?? backend/omar_initialize.py
?? backend/omar_local.py
?? backend/omar_migrate.py
?? backend/tests/
?? local/
```

No commit, push, merge, deploy, migration, bootstrap, branding, employee PWA,
branch-management implementation or Nady access occurred. Phase 3B.2 stops here.
