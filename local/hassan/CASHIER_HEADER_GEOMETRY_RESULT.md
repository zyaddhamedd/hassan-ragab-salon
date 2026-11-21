# Phase 4B.5A.2 — original cashier header restored

The root cause was the Omar brand container's fixed **220 × 108px**, left over from the enlargement request. Flex layout respected that 108px height, producing a 141px header even after the image itself was reduced to 120px. Transparent image padding was not the cause of the layout expansion.

The unchanged source PNG is 1792 × 878. Its decoded nonzero-alpha bounds are `[193,25,1628,869)` (1435 × 844); its byte identity was rechecked against SHA-256 `91c5f63f0a2527091d6182488b82cea8cb45c1086706a2880cd3814553764616`. The approved white SVG uses that exact PNG alpha and remains unchanged. No crop or new derivative was necessary, and no visible pixel, alpha, design or typography was modified.

## Small fix

- Removed brand `width:220px; height:108px`.
- The retained original text nodes again determine the original intrinsic slot dimensions.
- White image is absolutely contained at `width:100%; height:100%; inset:0; object-fit:contain` inside that slot.
- Removed the fixed 120px image sizing/automatic margin. No header padding, margin, minimum height or layout override was added.

Only the Omar header stylesheet and its tests changed, with this report and a superseding note in the historical report. Canonical Mini, Admin, other themes, shared Logo, source asset and print rules remain untouched.

## Exact comparison

Viewport: **1470 × 779**. The original pre-logo text was temporarily displayed through the Omar-only stylesheet to record a complete current reference, then the final white-image stylesheet was applied. The fresh reference header/brand/button rectangles also match the independently saved actual pre-logo evidence from Phase 4B.5A. No application source or business state was changed to construct the reference.

| Region | Original pre-logo | Corrected |
|---|---|---|
| Header `[x,y,w,h]` | `[368.5,0,1101.5,101]` | Exact match |
| Brand slot | `[1347.8828125,31.25,106.1171875,37.5]` | Exact match |
| All header buttons, including barber/assistant | Original rectangles | Exact match |
| Customer lookup | `[927.75,134,509.25,52]` | Exact match |
| Customer name | `[404.5,134,509.25,52]` | Exact match |
| Invoice rail | `[0,0,367.5,779]` | Exact match |
| Invoice header/list/payment children | Original rectangles | Exact match |
| Document dimensions | `1470 × 779` | Exact match; no horizontal/vertical page overflow |

The same strict comparison passes with sidebar **open and closed**. Existing internal list scrolling remains unchanged. These measurements cover the tested desktop viewport and empty cashier, not every possible responsive/data state.

The visible logo is necessarily smaller inside the restored original slot. It is proportional, white, centered and not clipped; the original tall emblem is retained.

Evidence (ignored): `.local/omar/cashier-logo-geometry-1793147547183/`. Paired `original-{closed,open}` / `corrected-{closed,open}` PNG/JSON files record the comparisons; `oversized.json` records the problem state.

![Corrected desktop](../../.local/omar/cashier-logo-geometry-1793147547183/corrected-closed.png)

## Validation

- **71/71 tests passed**, including branding/isolation, existing themes, auth/receipt regressions, and three exact geometry checks using the captured evidence.
- Mini production build passed; existing >500 KB JS chunk warning remains.
- `git diff --check` passed.
- No database actions, API/business changes, provisioning, dependency install, commit, push or deployment.
- Backend/Admin/Mini keep running on their original loopback ports. No server process was stopped.

Files changed this phase:

1. `local/omar/cashier-header-logo.css`
2. `local/omar/cashier-header-logo.test.mjs`
3. `local/omar/CASHIER_HEADER_GEOMETRY_RESULT.md`
4. `local/omar/CASHIER_HEADER_LOGO_RESULT.md` — current-state pointer; older measurements retained as history.

Stop after this geometry fix.
