# Phase 4B.6B — final Mini quality fixes

GO for a separately authorized local branding checkpoint. No commit was created.
Branch `feat/omar-fahim-setup`; baseline `80716b903f2c3cc6640840f5128866458e8b4f85`.

## TypeScript contracts

1. `mini/App.tsx`: the expense POST still sends precisely category, amount, notes and date. Backend `Expense.to_dict()` returns expense fields, not appointment/customer fields. The old response mapper also retained four appointment-shaped optional properties, which are not consumed by Expense UI. An explicit fresh-object `Expense` annotation triggered excess-property checking. Removed that redundant local annotation; the existing `setExpenses` state setter still verifies structural compatibility with `Expense[]`. The response object, including those old extra properties, remains exactly unchanged at runtime. No broad interface widening or payload changes.
2. `mini/components/InventoryOnlyApp.tsx`: React's closed CSSProperties type does not declare `--inventory-mobile-nav-height`. `satisfies React.CSSProperties & { '--inventory-mobile-nav-height': string }` now verifies the exact custom property/value along with standard CSS fields. The already-checked object is safely upcast to CSSProperties for JSX contextual typing. This is not an unchecked assertion, `as any`, ignore directive or compiler-option relaxation.

`canonical-runtime-guard.mjs` allows exactly these two canonical paths, compiles each against the baseline with identical esbuild options, and requires **byte-identical emitted JavaScript**. Every other protected canonical/default/Admin/backend change is rejected. Existing six isolation suites now use this stricter runtime comparison instead of a blanket textual no-diff assertion that would reject authorized type-only edits.

Full Mini `tsc --noEmit -p mini/tsconfig.json`: PASS, zero diagnostics.

## Contrast changes

Omar-only `mini-text-contrast.css`, imported last by an explicitly Mini/omar-mode plugin, inside screen media:

- Attendance role paragraph: secondary text, opacity1 instead of0.3; the paragraph contains only role text.
- Login form labels: secondary text, opacity1 instead of0.6; notice and placeholders use opaque secondary text.
- Inventory leaf text using reviewed20/30/35/40% classes, plus observed failing45% header/search labels: color-mix of75% existing secondary and25% primary. Only p/label/span/div with no child elements match, so icons do not inherit a new treatment from these nodes.
- Attendance/Login/Inventory enabled field placeholders: existing secondary text color with sufficient alpha.
- Disabled descendants and print/logo descendants are excluded from inventory text overrides; disabled placeholders remain untouched. No container opacity, semantic badge colors, button fill, input surface, border, layout or effects changed.

Measured computed sRGB foregrounds are alpha-composited over their actual computed background chain; gradients use conservative stop-color bounds, not only palette-token pairs. This is not a pixel-by-pixel whole-screen accessibility certification; sibling glows/backdrop sampling and native autofill can vary.

| Readable text | Before minimum | After minimum |
|---|---:|---:|
| Attendance role, present/absent/assistant |2.47|6.05|
| Attendance search placeholder |1.87|6.54|
| Login email/password labels |3.86|8.08|
| Login bottom notice |2.49|8.08|
| Login email/password placeholders |1.55|8.04|
| Inventory header device label |3.01|5.42|
| Inventory incoming-shipment hint |2.59|5.00|
| Inventory search label |3.59|7.52|
| Inventory category/unit/empty-state descriptions |3.15|7.52|
| Inventory tap-for-details hint |2.76|7.52|
| Inventory search placeholder |1.78|5.97|
| Inventory unknown-status badge, unchanged |4.64|4.64|

Ratios are rounded for display; assertions use unrounded values. Focused Login and inventory inputs were also tested. Source shadows, gradients, dimensions and focus behavior remain unchanged.

## Visual evidence and limits

Ignored evidence `.local/omar/quality-visual/`: attendance/login/inventory before/after PNGs and complete computed-property JSON, plus login-focus/inventory-focus JSON and verification.json.

- Attendance:76 elements, representative present/absent barbers and assistant.
- Compact Login:33 elements, blank form (no credentials entered or submitted).
- Inventory-only:177 elements at390×844; four fictional stock-status cards and empty activity state.
- All captured element boxes, document dimensions, typography, shadows, gradients, filters, visibility, scrolling, transforms and non-text opacity match. The only exceptions are authorized text color and the two specifically scoped text-opacity changes.
- Actual components rendered with fictional data and a denied network/mutation boundary. This does not establish a real approved-device session, physical mobile keyboard/notch behavior or all server/error/success states.
- Disabled/decorative text, ancestor-opacity dimming, every inventory sheet/state, native autofill and every device/auth feedback state are not claimed AA-compliant. No broad opacity increase was made.
- No live user tab was reset, authenticated or logged out. Only the owned offline QA tab was closed; viewport override reset. All fixture flags removed afterward.

Cashier, logos, existing theme overlays and receipt/print markup/assets remain unchanged. QR handling and placeholder asset were not edited. Default Mini and Admin have the same runtime JS/presentation as before this task.

## Exact files changed this phase

Canonical type-only edits:
- `mini/App.tsx`
- `mini/components/InventoryOnlyApp.tsx`

Omar activation/new quality code:
- `local/omar/mini.vite.config.mjs`
- `local/omar/mini-text-contrast.css`
- `local/omar/mini-text-contrast.mjs`
- `local/omar/mini-text-contrast.test.mjs`
- `local/omar/text-contrast-audit.mjs`
- `local/omar/mini-quality-visual-fixture.mjs`
- `local/omar/canonical-runtime-guard.mjs`

Existing isolation tests adapted to accept only runtime-identical authorized type corrections:
- `local/omar/mini-theme.test.mjs`
- `local/omar/mini-cashier-theme.test.mjs`
- `local/omar/mini-operational-theme.test.mjs`
- `local/omar/mini-inventory-theme.test.mjs`
- `local/omar/mini-auth-theme.test.mjs`
- `local/omar/cashier-header-logo.test.mjs`

Documentation: this file.

## Validation

-93/93 tests pass: existing theme/isolation/branding/auth/device-session/receipt/supply-retry regressions plus9 targeted quality checks, including5 recorded rendered-state checks.
- Full Mini TypeScript passes.
- Omar Mini production build passes; existing main-JS >500kB warning remains.
- `git diff --check` passes.
- No QR or existing logo source/asset changes. Cashier header CSS/module hashes remain the approved values.
- Backend84296, Admin84314, Mini84323 still listen only on127.0.0.1 ports5104/3100/5176. No server was deliberately stopped or restarted.
- No database access, financial/attendance/stock operation, auth/device provisioning, migrations, dependency installs, commit, push or deployment.

Reproduce quality evidence: `node local/omar/mini-quality-visual-fixture.mjs`; then offline routes `/__omar_quality/attendance`, `/__omar_quality/auth?theme=1&layout=compact`, `/__omar_quality/inventory?theme=1`. Append `quality=1` for corrected text colors. Remove `.local/omar/quality-visual/enabled` after QA. Fixture generation uses only fictional data.
