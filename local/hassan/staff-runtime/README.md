# Current mobile field-test setup — 5D.5B

Use **https://zyads-macbook-air.local:54444/** for the phone, always the same
origin. The LAN listener is Staff-only; manager endpoints stay on
https://localhost:54443/ and are blocked on mobile. The test CA profile for manual
iPhone installation is `.local/omar/staff-integration/iphone-test-ca.mobileconfig`.
No trust store was modified. Phone trust and physical GPS remain UNVERIFIED.

The owner approved and enabled **TEST ONLY 100 m / 25 m accuracy / 30 s freshness**
at the supplied reference. This supersedes the initial unconfigured status in the
historical notes below; operational geofence/Staff remain untouched/OFF. Today is
frozen UNASSIGNED (no current-day assignment bypass); a synthetic assigned shift
exists for tomorrow. The browser test account is still unused.

Read the current [Arabic checklist](../STAFF_FIELD_CHECKLIST_AR.md) and
[result report](../STAFF_MOBILE_FIELD_READINESS_RESULT.md). `/field-check` measures
only volatile distance/accuracy; it does not record attendance or transmit GPS.

After joining salon Wi-Fi, update the private interface/certificate binding if
needed with `mobile.py refresh-network`. It restarts only the verified test backend,
not PostgreSQL or operational services. CA and data are retained. The standard
`control.py status/stop` guards still apply to this one test process and cluster.
Do not rerun account activation verification or schema preparation.

---

# Isolated Staff QA runtime — local only

The prepared runtime is separate from operational Omar. It uses one loopback-only
HTTPS process for the REAL Staff build + same-origin APIs, and one private,
SCRAM-authenticated, socket-only PostgreSQL cluster. No extra framework, proxy,
service manager, tunnel or trust-store modification is installed.

- Frontend: `https://localhost:54443/`
- Backend health: `https://localhost:54443/health`
- Staff API base: `https://localhost:54443/api/staff/`
- Browser/OS CA trust: **not installed**. Do not bypass a certificate warning.
- Mobile reachability/trust: **pending**. A phone's localhost is the phone, not
  this computer. The listener is intentionally not exposed on the LAN.

The origin/certificate is valid for localhost and verified by the QA tool against
its fresh private CA. It is not yet a browser-trusted/mobile testing environment.
The CA certificate is `.local/omar/staff-integration/ca.pem`; CA/server private keys
must remain private. System/device trust installation and a reviewed mobile hostname,
interface, certificate SAN and exact trusted origin require a later authorized step.

## Private artifacts

Everything below is ignored by Git under `.local/omar/staff-integration/`:

- `config.json`: fresh test-only database/app/JWT secrets and exact isolation target.
- `accounts.json`: synthetic manager and API/browser Staff credentials/code expiry.
- `data/`, `socket/`: independent PostgreSQL cluster; TCP is disabled.
- `ca.pem`, `server.pem`, private `*-key.pem`: fresh test PKI, never installed automatically.
- `backend.log`, `postgres.log`, `preparation.json`, `readiness.json`,
  `final-checks.json`, `server.json`: private readiness/ownership evidence.

Application database/role: `omar_staff_integration` / `omar_staff_test`, UTF-8,
Unix socket `.local/omar/staff-integration/socket`, logical PostgreSQL port 55440.
This is NOT 127.0.0.1:55432 and uses no operational credentials or data. Test role
has no superuser/create-database/create-role/replication/bypass-RLS privileges.

The unchanged canonical chain was run from empty to `zr_payroll_settlement_ledger`
(60 tables), then to `zz_staff_gps_attendance` (75 tables). No stamping or migration
source edits. Never rerun `prepare`/`resume` against this populated environment.
Operational Staff remains OFF; only this app instance opts in after test DB checks.

## Browser test account and real manager approval

1. First establish trusted HTTPS for the target browser through a reviewed trust
   setup; never click through certificate warnings. Do not use operational accounts.
2. Use `staff_qa_browser` (synthetic employee ID 2). Read its activation code and
   test password privately from `accounts.json`. Codes expire after 15 minutes.
   Refresh an unused account's activation code if necessary:

   ```sh
   .local/omar/venv/bin/python local/omar/staff-runtime/qa.py code --employee-id 2 --purpose activation
   ```

3. In the REAL Staff app's activation tab, enter that synthetic username/code and
   the test password (or another test-only 12+ character password). Browser WebCrypto
   generates its nonextractable key. Do not clear browser storage or enroll again
   if a response is uncertain; retain/recover the existing record.
4. The UI displays a pending device ID. Explicitly approve that exact synthetic
   employee/device through the actual manager endpoint:

   ```sh
   .local/omar/venv/bin/python local/omar/staff-runtime/qa.py approve --employee-id 2 --device-id <32-hex-ID-from-app>
   ```

   This logs in as the synthetic manager using the private credential file, verifies
   the HTTPS server identity, and permits only configured synthetic employee IDs.
   It does not access operational Admin. Replacements require explicit
   `--replace-device-id <old-active-device-ID>`; they are never inferred.
5. Click the app's approval check to finalize the signed device proof. Then login,
   reload/restore the session and inspect profile, shifts and authoritative NONE.

`staff_qa_api` was used for real HTTP readiness, not browser acceptance. Its device
was legitimately enrolled/approved/finalized, then signed out and manager-revoked;
its private signing key existed only in verification-process memory. Use the unused
browser account for subsequent browser QA. Recovery codes are available through
`qa.py code --employee-id 2 --purpose recovery` when the identity state warrants it.

Geofence is deliberately UNCONFIGURED (zero versions). No radius, center or real
salon GPS is activated. Current shifts are UNASSIGNED projections, not invented
assigned hours. Physical attendance acceptance must wait for owner-reviewed test
configuration and an actual authorized device/site test.

## Inspection and stopping

Run from the official standalone workspace:

```sh
.local/omar/venv/bin/python local/omar/staff-runtime/control.py status
```

To stop ONLY the verified test listener and cluster, retaining private artifacts:

```sh
.local/omar/venv/bin/python local/omar/staff-runtime/control.py stop
```

The tool verifies UID, PID, command, cwd and exclusive port ownership before signals,
then uses pg_ctl with only this exact private data directory. It never stops an
operational service or deletes a database/directory. PID changes cause refusal.
No restart or destruction command is part of preparation.

`runtime.py serve` is the explicit test launcher, but the prepared server is already
running; do not start duplicate listeners. Startup validates the exact test target,
private paths, separate SCRAM identity and postmaster identity. It clears inherited
environment, uses `create_app(bootstrap=False)`, and performs no startup migration,
bootstrap or seed. Financial/Admin/Mini/upload routes are not exposed: only Staff,
static assets and a minimal synthetic manager identity/device surface are allowed.

## Validation

```sh
.local/omar/venv/bin/python -m unittest discover -s local/omar/staff-runtime -p test_guards.py -v
npm --prefix local/omar/staff run build
npm --prefix local/omar/staff run verify-build
```

The real `qa.py verify` already ran once; it refuses repeat activation of its consumed
API fixture. Its persisted readiness report covers TLS certificate+hostname checking,
real activation/approval/proofs/login/refresh/logout, safe profile/shifts/NONE state,
MIME/CSP/static routing, blocked financial surfaces, and zero attendance/financial/
customer/geofence rows. It does NOT certify browser CryptoKey persistence, OS/mobile
trust, physical GPS or mobile networking. See `../STAFF_ISOLATED_RUNTIME_RESULT.md`.
