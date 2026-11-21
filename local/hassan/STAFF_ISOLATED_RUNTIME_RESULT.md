# Phase 5D.5A — isolated Staff runtime preparation

A separate local Staff-enabled backend and real Staff frontend are running. The
operational runtime remains unchanged and Staff remains OFF there. **Trusted
browser/mobile HTTPS is still a blocker**: the new private CA is not installed in
OS/device trust stores, and the listener is deliberately loopback-only. No browser
certificate warning was bypassed and no physical GPS acceptance is claimed.

## Runtime URLs and identity

- Real Staff frontend: **https://localhost:54443/**
- Isolated backend health: **https://localhost:54443/health**
- Isolated Staff API base: **https://localhost:54443/api/staff/**
- TLS listener: `127.0.0.1:54443`, PID **3448**, owned by `zyad`.
- Backend cwd: `/Users/zyad/Projects/omar-fahim-standalone`.
- PostgreSQL PID **3318**, owned by `zyad`, separate private data directory.
- Database **omar_staff_integration**, application role **omar_staff_test**.
- PostgreSQL is **socket-only**, logical port **55440**, socket directory:
  `/Users/zyad/Projects/omar-fahim-standalone/.local/omar/staff-integration/socket`.
- Data: same private root's `data/`; UTF-8, SCRAM-SHA-256 authentication.
- App role: no superuser/create-db/create-role/replication/bypass-RLS privileges.

The HTTPS leaf certificate has localhost/127.0.0.1 SANs and a new independent private
CA. Actual hostname/certificate verification passed using that explicit CA; no
unverified SSL context or browser/security bypass was used. This proves API-client
TLS readiness, **not OS/browser trust**. The origin is not yet certified ready for
normal browser/mobile use. Trust-store changes were not performed. Mobile also
needs a reviewed reachable hostname/interface/certificate SAN/origin; localhost on
a phone refers to the phone. No tunnel or public deployment was created.

## Isolation and operational safety

Verified official independent workspace and branch `feat/omar-fahim-setup`.
Operational process owners/commands/cwds were checked before preparation and the
same listeners remained afterward:

| Service | PID | Bind |
| --- | ---: | --- |
| Operational Backend | 95192 | 127.0.0.1:5104 |
| Operational Admin | 95216 | 127.0.0.1:3100 |
| Operational Mini | 95241 | 127.0.0.1:5176 |
| Operational PostgreSQL | 74970 | 127.0.0.1:55432 |
| Existing simulated prototype | 95693 | 127.0.0.1:5182 |

Backend/Admin/Mini still returned HTTP 200; operational `/api/staff/me` returned 404
and the guarded launcher's Staff-OFF configuration is unchanged. Operational DB
revision remains the previously reported `zr_payroll_settlement_ledger`; it was NOT
requeried or migrated. No operational database connection, private credential/config read,
customer data copy, account/device modification or service signal was made.
Nady and the old Omar worktree were not accessed.

Fresh independent database/app/JWT secrets, CA/server keys, synthetic users and
private uploads were generated only in ignored owner-only local artifacts. No
operational session/device was reused. Runtime guards reject operational targets,
noncanonical/private path redirects and missing/reused secrets. Startup clears
ambient environment and uses the existing application with `bootstrap=False`;
there is no migration, initialization or seeding during server startup.

## Schema and synthetic readiness

The complete unchanged canonical migration chain was applied to the new database:

1. Empty database -> `zr_payroll_settlement_ledger`: **60 tables**.
2. Pending Staff revisions -> `zz_staff_gps_attendance`: **75 tables**.

Actual Alembic execution and committed revision checks passed. No existing migration
was edited, no schema was stamped, and no operational migration ran.

Synthetic identities:

- `staff_qa_manager`: dedicated QA Super Admin for actual manager endpoints.
- `staff_qa_api`: synthetic employee ID **1**, used for the scripted real API check.
- `staff_qa_browser`: synthetic employee ID **2**, unused and ready for browser
  activation once trusted HTTPS is established.

Passwords and activation codes are only in
`.local/omar/staff-integration/accounts.json` (0600, ignored). Codes expire in 15
minutes; generate a fresh one with the documented manager utility. No credentials
are embedded in Staff source or this report.

Real HTTPS/API checks passed against this runtime:

- Staff activation and public-key enrollment.
- Unapproved device login rejected (403).
- Real synthetic manager approval, signed finalization and Staff login.
- Employee-safe profile; three UNASSIGNED shift projections; authoritative NONE.
- Secure/HttpOnly refresh-cookie contract and signed refresh/session restoration.
- Signed logout and manager revocation of the scripted QA device afterward.
- Real production Staff build, static MIME, no-store/CSP and same-origin API routing.
- Financial, unrelated Admin/Mini, upload and backend-file routes blocked (404).

The scripted check used a fresh process-memory signing key through the actual
security protocol, not a fake device-success response. Browser nonextractable-key
storage is a separate pending acceptance check. The browser account was not enrolled
or automatically approved. Only test Staff is enabled in the separate process.

Verified counts are zero for attendances, Staff attendance receipts, geofence
versions, frozen shift instances, financial business days, cashier shifts,
customers, invoices and payroll settlements. **No geofence was configured**;
no radius was guessed and real salon GPS was not activated. No attendance write
endpoint was called during this preparation.

## Files and validation

New isolated tooling under `local/omar/staff-runtime/`:

- `runtime.py`: private cluster/schema preparation and separate guarded TLS launcher.
- `qa.py`: certificate-verified real API readiness, synthetic code issuance/approval.
- `control.py`: ownership-verified status/stop of only the test processes.
- `test_guards.py`: offline isolation guard tests.
- `README.md`: credentials handling, browser/manager procedure, trust/stop instructions.
- This report.

No existing backend, Admin, Mini or Staff application source was changed in this
phase. No commit, push, deployment or operational restart.

Three new offline guard tests passed; real TLS/API readiness and canonical migration
execution passed. Staff production build and all asset/import/hash/CSP checks passed.
`git diff --check` passed. Prior source validation (140 backend/35 frontend tests)
was not unnecessarily rerun for this isolated launcher-only phase.

Private evidence: `.local/omar/staff-integration/preparation.json`, `readiness.json`,
`final-checks.json`, `backend.log`, `postgres.log`, `server.json`. The isolated
services are intentionally left running for subsequent authorized QA. The status/
stop utility verifies current PID, UID, cwd, command and exclusive port ownership;
it never signals unrelated processes or deletes artifacts.

## Browser/device approval procedure

After a separately reviewed browser trust setup, open the real Staff HTTPS URL.
Use `staff_qa_browser`, its private code/password, and the activation tab. Refresh
an expired activation code using:

```sh
.local/omar/venv/bin/python local/omar/staff-runtime/qa.py code --employee-id 2 --purpose activation
```

After the browser generates and enrolls its nonextractable key, approve its displayed
pending device ID explicitly:

```sh
.local/omar/venv/bin/python local/omar/staff-runtime/qa.py approve --employee-id 2 --device-id <32-hex-ID-from-app>
```

The utility authenticates as the dedicated synthetic manager over CA-verified TLS,
permits only known synthetic employee IDs and requires explicit replacement IDs
when applicable. Then use the app's approval check to finalize proof, login and test
reload/session restoration/profile/shifts/current state. Do not clear browser
storage or create replacement enrollments to handle uncertainty.

## Remaining mobile QA

1. Establish trusted browser/device HTTPS through an explicitly reviewed trust and
   network setup. Never click through certificate warnings. Mobile needs more than
   the current loopback hostname/binding; no LAN credential exposure was enabled.
2. Test actual browser CryptoKey/IndexedDB persistence, Web Locks, secure cookies,
   approval/recovery and current-state restoration using only the synthetic account.
3. Owner-reviewed geofence parameters/site access are still required before actual
   GPS attendance acceptance. No physical test has occurred; unconfigured GPS fails
   closed. No automatic radius/real-salon activation is authorized here.
4. Perform authorized real device/site checks and network/reload/idempotency tests
   only in this isolated environment. Manager review-resolution/payroll remain out
   of scope. Operational Staff activation needs a later separate task.

To inspect or stop only this test environment, use the commands in
`local/omar/staff-runtime/README.md`. Preparation is complete to API/TLS level;
trusted browser/mobile and physical GPS acceptance remain pending.
