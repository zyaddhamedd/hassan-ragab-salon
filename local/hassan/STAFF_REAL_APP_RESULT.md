# Phase 5D.4A — real Staff frontend integration

Real client implemented in `local/omar/staff/`; one backend contract gap prevents
full current-attendance-state integration. Staff remains OFF, and the operational
Omar database remains unmigrated. No runtime service, backend source, Admin/Mini
or existing prototype was modified. Backend contracts and prototype assets were
read for integration; the old Omar worktree and Nady were not accessed. No migration,
operational API write, server restart, deployment, commit or push.
Prior uncommitted backend phases remain intact.

## Working client flows (validated against mocked responses)

- Login, activation/recovery code forms, public-key enrollment, pending manager
  approval, signed finalization, session refresh/restore and signed logout.
- Approval is never performed by the employee client. The existing backend must
  confirm ACTIVE, or accept an actual key-bound login, before the local candidate
  becomes the current binding. Original keys remain until approved replacement.
- Uncertain enrollment retains the candidate key and refuses automatic duplicate
  enrollment/key generation. A manager-reviewed device ID can reconnect that key
  to the existing record; backend proof/approval remains mandatory. Lost finalize
  responses can recover through actual login, not a local ACTIVE assumption.
- Actual employee-safe `/me` profile and `/shifts` data populate home/profile/shifts.
  No fictional names, schedule times, request records or financial amounts are
  displayed. Requests/leave/advance areas are explicitly unavailable.
- The approved RTL visual identity, dark/light themes, signature home card,
  profile, navigation and mechanical 1400ms pointer/keyboard hold remain. The
  simulator's CSS is reused byte-for-byte; only integration controls are added.
- Explicit attendance hold acquires one fresh browser reading (`maximumAge=0`,
  high accuracy, bounded timeout), then calls the existing signed check-in/out
  endpoint. No startup/background location collection or offline queue exists.
- The original checkout attendance ID and exact JSON bytes are held in memory
  through uncertain outcomes. Retry uses a fresh nonce/challenge/signature with
  those unchanged bytes. Uncertain operations block replacement operations;
  known server rejections permit a deliberate new action/location. Retry also
  checks the original authenticated user. Page unload warns when work is pending.
- Ignition/success animation begins only after a structurally validated, backend-
  confirmed receipt for the expected action/checkout ID. Timers only animate that
  already confirmed result. Restored history does not trigger success animation.
- Clear Arabic states cover permission denial, GPS timeout/staleness/accuracy/
  range, unconfigured geofence, disabled Staff, pending/revoked device, expired
  session, rejected requests and uncertain network/server responses.

## Security and storage

The existing Staff ES256 proof protocol is reused: method, exact target/body hash,
access-token hash (or server-provided HttpOnly-cookie hash), trusted origin, device,
nonce, challenge ID, time and fresh JTI are bound to every protected request.

P-256 private keys are generated nonextractable and stored as CryptoKey objects in
IndexedDB; only the public JWK is exported. Unsupported HTTPS/key storage/Web Locks
fail closed. There are no credentials or real secrets in source. Access tokens,
password/code inputs and enrollment grants are not persisted; refresh cookies
remain HttpOnly/Secure under the existing backend contract. CSRF and same-origin
credentials are used for cookie operations; session/device lifecycle actions are
serialized across tabs with Web Locks.

There is no persistent raw GPS history. Only the volatile unresolved request retains
its one location sample; it is released on confirmed completion or deliberate
replacement after a known rejection. IndexedDB keeps device records and one
allowlisted, user-scoped historical confirmation containing no GPS/security/
financial fields. Profile and confirmation response projections exclude unexpected
financial/security fields. Strict same-origin CSP, external modules only and text
insertion for server data are used. No HTTP/localhost or proof bypass is present.

## Unresolved backend contracts

1. **No Staff current-attendance read endpoint exists.** `/me` has identity only;
   `/shifts` is planning data; attendance exposes check-in/out writes only. The app
   labels current state **unavailable** and local confirmations **historical**,
   never infers PRESENT from a stored success. After an uncertain committed
   check-in followed by tab loss, the client cannot recover the attendance ID or
   authoritative state. Checkout cannot safely be offered without a known own
   check-in ID. Smallest future correction: a protected, employee-derived current-
   attendance read under existing Staff proof, returning safe state/open ID and
   shift context. No new/replacement endpoint or backend change was made here.
2. Staff has no own pending-enrollment status/lookup endpoint. The app reuses
   finalize challenges for the explicit approval check. If enrollment commits but
   its ID response is lost, manager-assisted lookup of the existing device record
   is needed. The app does not generate another key or approve/re-enroll itself.

These are visible limitations; this phase does not certify full live/mobile
attendance readiness or authoritative current-day state after reload.

## Files added

All application files are isolated under `local/omar/staff/`:

- `index.html`, `style.css`, `icons.mjs` — preserved visual structure + auth/status UI.
- `app.mjs` — screen/session orchestration and confirmed-only animation wiring.
- `proof.mjs`, `vault.mjs` — WebCrypto proof and private IndexedDB storage.
- `client.mjs` — existing Staff contracts, cookie refresh, approval and error states.
- `attendance.mjs` — explicit GPS action, exact-body retry and physical hold control.
- `tests/integration.test.mjs`, `tests/support.mjs` — offline mocked integration tests.
- `package.json`, `build.mjs`, `verify-build.mjs`, `README.md` — dependency-free build
  and validation instructions.
- This phase report at `local/omar/STAFF_REAL_APP_RESULT.md`.

No existing source file was modified in this phase. The original prototype remains
at `local/omar/prototypes/staff/`, including its separate simulation and running
preview. The real app is not published or served as an activated HTTPS application.

## Validation

- **27 tests passed; zero failures/skips.** All HTTP/geolocation are mocked; no
  operational attendance writes. Real Node WebCrypto signs/verifies ES256, and
  an independent test passes the frontend proof to the actual pure Python backend
  verifier without app construction or database access.
- Login, activation, approved/pending devices, recovery key retention, lost
  enrollment/finalize responses, persistence failures, session restore/logout,
  expired access retry, single-/cross-tab refresh serialization, challenge rejection,
  signed checkout ID/body stability, fresh proofs, GPS rejection/offline/config
  errors, malformed successes, delayed confirmations, response allowlists and
  pointer/keyboard/visibility cancellation are covered.
- Production build passed: `.local/omar/staff-build/`, 12 runtime files + hash
  manifest, no external dependencies/assets, tests or backend/config files.
- Build verification passed for every file hash, module import, referenced asset,
  approved CSS identity, CSP and simulation separation.
- `git diff --check` and unchanged-prototype diff check passed.
- Test log: `.local/omar/r5c/5d4a-tests.log` (ignored/private).

Tests use an in-memory vault with actual CryptoKey structured clone and mocked Web
Locks/browser events; they are not real-browser IndexedDB, layout, cookie, GPS or
physical-device acceptance. No such live acceptance is claimed.

## Remaining requirements for mobile/device acceptance

1. Resolve the state-read contract above before certifying current attendance or
   interrupted-request recovery across reloads.
2. Separately authorize and validate the pending schema chain/runtime activation.
   Do not restart the changed ORM against the unmigrated operational database.
3. Use an isolated migrated test backend with a trusted HTTPS Staff origin and
   same-origin `/api/staff/*` routes/cookie paths. Configure an explicitly reviewed
   geofence and real manager-approved test identity/device; no guessed radius.
4. Test target iOS/Android browsers: CryptoKey persistence/nonextractability across
   reload, Web Locks across tabs, secure cookie refresh/CSRF, enrollment approval,
   intentional recovery/replacement, keyboard/touch/cancel, safe-area layout and
   reduced motion. Confirm the production artifact's MIME/CSP/HTTPS hosting.
5. On authorized test data only, exercise permission denial, disabled/stale/outside
   GPS, network loss before/after confirmation, exact retry, admin closure and a
   real confirmed check-in/out. Verify no animation precedes backend confirmation.
   Operational attendance writes require a later explicit acceptance task.

Staff remains OFF. No publication or operational cutover was performed.
