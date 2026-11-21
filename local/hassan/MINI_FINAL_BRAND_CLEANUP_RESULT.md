# Phase 4B.5D — final Mini brand cleanup

Target: Omar Mini only, branch `feat/omar-fahim-setup`, HEAD `80716b903f2c3cc6640840f5128866458e8b4f85`. No database access, authentication actions, WhatsApp sends, provisioning or migrations.

## Files changed in this phase

- `local/omar/mini.vite.config.mjs`: register the Mini-only cleanup plugin after existing presentation overlays.
- `local/omar/mini-brand-cleanup.mjs`: exact, fail-closed presentation substitutions and favicon; opt-in offline preview middleware.
- `local/omar/mini-brand-cleanup.test.mjs`: six targeted tests.
- `local/omar/mini-brand-cleanup-fixture.cjs`: render real invoice/deposit receipt components with fictional data; compare authorized content substitutions only; render Sidebar brand fixtures. No HTTP/API/database calls in fixture generation.
- `local/omar/assets/mini-print-logo.svg`: dark `#121212` version of approved alpha-mask logo, preserving shapes and the previous print asset's 2050:1208 intrinsic ratio.
- `local/omar/assets/mini-favicon.svg`: approved white logo derivative, no legacy icon.
- `local/omar/assets/receipt-qr-unavailable.svg`: local 150×150 non-scannable placeholder.
- This report.

Existing uncommitted Phase 4 work remains intact. Canonical Mini, Admin, backend, shared branding/config, receipt CSS and approved Cashier logo modules/assets were not edited.

## Content corrections

- WhatsApp: `شكرًا لزيارتك Omar Fahim Salon 🤍`. All other generated text, amounts and link/phone handling remain byte-identical in the offline example.
- Thermal branch fallback: `الفرع`.
- Sidebar: white approved image, original wordmark retained invisibly as an intrinsic sizing gauge; image out of flow, proportional contain sizing.
- Invoice, deposit and Waiting print branding: dark exact alpha-mask derivative, selected only by Mini overlay imports.
- Cashier staff-modal footer: `Omar Fahim Salon`.
- Favicon: Mini dev middleware and emitted production SVG, no PWA changes.

## QR decision

The previous Omar isolation transform encoded `http://127.0.0.1:5176` in an external qrserver image. Both customer receipt renderers now use a local non-QR placeholder and explicit unavailable labeling; no external QR generation request is made. Original QR image classes and square intrinsic ratio remain intact. A functioning public salon QR is pending an owner-approved public destination; none was fabricated.

## Evidence and fidelity

Ignored evidence: `.local/omar/brand-cleanup/`.

- `receipt-before.png` / `receipt-after.png`: real thermal component, fictional invoice subtotal250, discount20, total230, previous deposit50, new cash180.
- `deposit-before.png` / `deposit-after.png`: real fictional 50 EGP booking deposit receipt.
- `sidebar-before.png` / `sidebar-after.png`: isolated actual Sidebar with its original style dependencies, same viewport and state.
- `receipt-fidelity.json`: all 76 DOM elements have identical computed styles and bounding boxes; wrapper270px, logo254×149.671875px, QR area85×85px.
- `deposit-fidelity.json`: all52 elements identical computed styles and bounding boxes; original80mm print wrapper retained.
- `sidebar-geometry.json`: brand slot128×128px at same coordinates; aside/navigation/buttons/fonts unchanged. Brand fixture isolates the original Sidebar styles rather than mounting the operational app.
- Before-preview external QR image is replaced with an offline blank square of the original150×150 intrinsic size solely to prevent external requests during evidence collection.
- Actual Mini tab was logged out and was not submitted or reset. No live Cashier/login session was created for screenshots. Cashier header CSS/module hashes remain exactly the approved values, providing source-level protection; no new live authenticated header comparison was performed.
- Print previews map original print media to screen only inside ignored fixture HTML. Production print CSS is untouched. No physical printer test.
- Full Mini built JS contains none of the reviewed Arabic Nady thank-you, Mansoura fallback, Character Selection caption, qrserver URL or legacy Linktree URL.

Offline fixture generation: `node local/omar/mini-brand-cleanup-fixture.cjs`. Preview middleware requires an explicit `.local/omar/brand-cleanup/enable` file. The flag was removed after QA; ordinary serving never exposes the fixtures. Evidence HTML/JSON uses fictional data only.

## Validation

- 84/84 existing and new theme/isolation/branding/auth/receipt/blocker tests passed.
- Real invoice and deposit rendered markup matches before/after outside authorized image/label substitutions; financial values and print CSS unchanged.
- Mini production build passed; existing >500kB JS warning remains. Exact-logo SVG assets are about502kB each, a size tradeoff of retaining the approved embedded alpha source.
- `git diff --check` passed.
- No TypeScript compiler settings or diagnostics were suppressed; full tsc not rerun in this presentation-only phase.
- Existing processes remain: backend84296, Admin84314, Mini84323, loopback5104/3100/5176 respectively. No process was stopped or manually restarted.

GO for Phase4B.6 QA. Public functional QR remains blocked pending approved URL; current receipts safely display unavailability. No commit, push or deploy.
