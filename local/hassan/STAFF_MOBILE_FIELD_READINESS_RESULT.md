# Phase 5D.5B — mobile HTTPS and geofence field readiness

All safe local preparation is complete. The REAL Staff app is served on a private
Wi-Fi HTTPS listener. **Actual iPhone trust, Bonjour/Wi-Fi reachability from the
phone and physical on-site GPS acceptance remain UNVERIFIED.** Operational Staff
remains OFF; operational services/database, Admin/Mini, Nady and the old Omar
worktree were not modified or accessed for business data. No operational signals,
migration, commit, push, public deployment, tunnel or certificate installation.

## Exact mobile URL and TLS

**Staff app:** https://zyads-macbook-air.local:54444/

**Readiness/calibration only:** https://zyads-macbook-air.local:54444/field-check

Current Wi-Fi listener: **192.168.100.39:54444**, plus a loopback test listener on
54444. The Bonjour origin stays the same when the Wi-Fi IP changes; the isolated
listener/certificate must be refreshed at the salon if the interface address changes.
Use the printed canonical `.local` URL throughout enrollment/login/reload so the
browser's origin-bound CryptoKey/IndexedDB identity remains consistent. IP is for
TLS/health diagnostics only; it is not a separately authorized Staff login origin.

No approved publicly trusted hostname/certificate was configured in this runtime,
and no tunnel/deployment was created. The existing private test CA was reused,
without rotating trust or exposing its key. A new leaf contains the exact Bonjour
DNS SAN, localhost and current LAN/loopback IP SANs. CA/hostname/IP verification
passed with normal TLS verification (no insecure SSL flags).

A public-certificate-only iPhone trust profile was generated at:
`.local/omar/staff-integration/iphone-test-ca.mobileconfig`

It contains one root-certificate payload, no private key, credentials, network
management settings or MDM enrollment. Nothing was installed automatically.
Subject: `Omar disposable Staff QA CA`.
SHA-256: `8a6b35c5e0aefc6815ee8422166c980a764c512989a655f48926fc0dcd85ac4a`.

Transfer ONLY that profile (or the public `iphone-ca.cer`) privately to the owner's
phone, inspect the fingerprint/name, install through the downloaded-profile UI,
then explicitly enable SSL trust in General/About/Certificate Trust Settings.
Safari must open the canonical URL without a certificate warning. Do not bypass a
warning or disable device security protections. See the short Arabic checklist and
[Apple profile instructions](https://support.apple.com/en-sg/102400),
[Apple certificate trust instructions](https://support.apple.com/en-ca/102390).
After testing, remove this temporary profile when no longer needed.

The Mac's firewall was already disabled on inspection; no firewall rule/state was
changed. Actual phone network access is not inferred from a same-computer TLS test.
Guest-network/client isolation or mDNS restrictions may still block the phone.

## Isolation and access surface

- Isolated backend PID **4994**, owned by `zyad`, cwd official standalone workspace.
- Isolated PostgreSQL PID **3318**, database **omar_staff_integration**, role
  **omar_staff_test**, private Unix socket on logical port **55440**, no TCP DB bind.
- Schema unchanged at **zz_staff_gps_attendance**; no migration this phase.
- Loopback manager API remains **https://localhost:54443/** only.
- Manager/Admin routes require actual loopback server port, loopback peer and exact
  host; the mobile listener returns 404 even with spoofed manager Host headers.
- Only Staff, approved static files, health and the read-only calibration page are
  reachable on mobile. Financial/Admin/Mini/backend/config/key/account file paths
  are blocked. Public trust files are NOT served as a bootstrap website.
- Operational listeners remained the same: Backend **95192/5104**, Admin
  **95216/3100**, Mini **95241/5176**, DB **74970/55432**. No operational restart.
- Only the verified disposable test backend was restarted to add TLS/LAN bindings.
  The test PostgreSQL process was not restarted. No operational private config,
  credential, session, customer or device record was reused.

## Owner-approved TEST-ONLY geofence

The owner explicitly approved in this session:

| Parameter | Isolated test value |
| --- | --- |
| Reference latitude | 30.032083486995774 |
| Reference longitude | 30.987334731699523 |
| Radius | 100 m |
| Maximum reported accuracy | 25 m |
| Maximum capture age | 30 s |
| Status | ENABLED, version 1, isolated synthetic branch only |

Applied through the existing guarded geofence service with the synthetic manager
actor and an explicit TEST ONLY audit reason. The preparation command requires an
owner-approval flag; no startup default activates parameters. Existing immutable
configuration/version rules remain intact. Operational geofence was not queried
or changed. These are not production policy or surveyed building boundaries.

The radius is deliberately broad for first calibration; it does not prove someone
is inside the physical salon. Existing acceptance requires the entire accuracy disk
to fit (`distance + accuracy <= 100 m`), accuracy <=25 m, and age <=30 s. A sidewalk
outside the door may still be well inside the circle. Do not expect physical-wall
rejection from this provisional circle, or silently relax thresholds for bad GPS.

The separate `/field-check` page acquires a fresh location only on explicit press,
shows distance/accuracy/age without displaying raw phone coordinates, and keeps
only transient non-coordinate measurement rows. It never posts GPS, stores location
history, calls attendance APIs or produces attendance-success responses. Take five
samples at center/door/safe exterior points; compare consistency and uncertainty
before asking the owner to approve any revised limits. Use a safely reachable point
truly outside the provisional circle for the negative backend test.

## Synthetic account and shift

Owner's account: **staff_qa_browser**, synthetic employee ID **2**, not activated or
enrolled by the agent. Password and short-lived activation code remain only in
ignored 0600 `.local/omar/staff-integration/accounts.json`, not source/reports.
Manager approval remains explicit through `qa.py approve`, followed by the browser's
signed finalization. No approval, binding, signature or session check was bypassed.

The existing scheduling contract forbids new assignments starting on today's Cairo
date. This invariant was preserved. Today's **2026-10-30** expectation is frozen
**UNASSIGNED**, which the existing Staff attendance engine intentionally supports.
A clearly labeled synthetic assigned shift **12:00–20:00 on 2026-10-31** was created
through existing planning services. It is not an assertion of real salon hours.
No financial business day, cashier shift or payroll effect is created.

A separate disposable API probe account used real frontend WebCrypto and real
backend approvals, then logged out and had its device manager-revoked. It did not
consume or enroll the owner's account. Credentials and signing material were not
printed; its nonextractable CryptoKey existed only in verification-process memory.

## Verification performed

- Actual production Staff frontend client/proof modules ran against real TLS APIs
  on the mobile origin, using real nonextractable Node WebCrypto keys and fresh
  challenges: pending-device rejection, manager approval (loopback), finalization,
  login, safe profile, shifts, authoritative NONE, cookie/CSRF refresh and reload-like
  key/session restoration all passed; signed logout and device revocation passed.
- Verification uses in-memory structured clone/Web Locks scaffolding, not native
  iPhone IndexedDB or a claim of browser trust. The field-check page lets the owner
  exercise native secure context/signing, followed by actual app enrollment/reload.
- LAN IP and Bonjour-name TLS SAN/chain, CSP, JS MIME, real-app/static routing,
  private-file blocking and manager-surface blocking passed, including spoofed Host.
- Six isolated runtime guard tests passed, including rejection of public/wildcard/
  unrelated origins and activation without explicit owner approval.
- All **35 Staff frontend regression tests passed**. Production build and 12-asset
  import/hash/CSP checks passed. `git diff --check` passed.
- Read-only test DB checks show **zero attendance rows/receipts, customers, invoices,
  financial business days, cashier shifts and payroll settlements**. Geofence and
  synthetic planning rows are the only new functional configuration/fixtures.
- No GPS attendance write endpoint was invoked, and no physical GPS acceptance was
  simulated. Previous backend source/security contracts were not redesigned.

Private evidence: `field-configuration.json`, `mobile-readiness.json`,
`field-final-checks.json`, current `server.json` and logs under the private test root.
The real runtime remains running for the owner's authorized field test.

## Files changed/added in this phase

`local/omar/staff-runtime/`:
- `runtime.py`: optional private mobile origin/TLS listeners, strict local-only
  manager surface and calibration static files; existing test DB guards preserved.
- `qa.py`: exact configured-origin validation for certificate-verified tools.
- `mobile.py`: private Wi-Fi/SAN/profile preparation and verified test-only rebind.
- `field.py`: explicitly approved test geofence, policy-respecting synthetic shift,
  and read-only synthetic employee attendance results.
- `mobile-verify.mjs`: actual frontend WebCrypto/real TLS readiness verification.
- `field-check.html`, `field-check.mjs`: isolated read-only calibration/security tool.
- `test_guards.py`, `README.md`: focused guard coverage and current procedure.
- `local/omar/STAFF_FIELD_CHECKLIST_AR.md`: short owner checklist.
- This result report.

No operational backend/Admin/Mini source, Staff app design/business code, migration,
old worktree or unrelated project was changed. No commit/push/deployment.

## On-site commands and remaining blockers

After connecting the computer to salon Wi-Fi, if its address changed:

```sh
.local/omar/venv/bin/python local/omar/staff-runtime/mobile.py refresh-network
```

This verifies process ownership and rebinds only the test backend to the new private
address, retaining the CA, database, sessions and origin-bound device identities.
Use its printed canonical URL. The computer must remain present and awake; no
remote/public tunnel exists. Do not use a different origin for enrollment.

Refresh the unused browser account's 15-minute code immediately before activation:

```sh
.local/omar/venv/bin/python local/omar/staff-runtime/qa.py code --employee-id 2 --purpose activation
.local/omar/venv/bin/python local/omar/staff-runtime/qa.py approve --employee-id 2 --device-id <ID-from-phone>
.local/omar/venv/bin/python local/omar/staff-runtime/field.py results
```

Actual device CA trust/reachability, native browser key persistence, location
permissions, measured inside/outside accuracy and real isolated check-in/checkout
remain manual acceptance items. If trust/networking fails, stop rather than bypass
security. If uncertainty is unresolved, refresh authoritative state or retry the
original operation; do not invent a new attendance or reset enrollment.
