# Phase 4B.4 — inventory theme result

Workspace: Omar worktree only. Branch `feat/omar-fahim-setup`; HEAD remains `80716b903f2c3cc6640840f5128866458e8b4f85`. Earlier uncommitted theme work is preserved. No commit, install, migration, database connection or operational submission was performed.

## Exact files changed in this phase

- `local/omar/mini.vite.config.mjs`: add the inventory plugin after existing approved plugins, before React.
- `local/omar/mini-inventory-theme.mjs`: Omar-mode-only attribute hooks, reviewed paint digests, RGB generator, dev fixture middleware registration.
- `local/omar/mini-inventory-theme.css`: generated inventory-only screen-media color rules.
- `local/omar/mini-inventory-theme.test.mjs`: scope, semantics, alpha/effect form, canonical isolation, fixture safety and optional captured-fidelity tests.
- `local/omar/mini-inventory-fidelity.mjs`: compare standard computed properties, rectangles, scrolling, body and viewport; retain alpha when normalizing RGB.
- `local/omar/mini-inventory-visual-fixture.mjs`: explicit offline visual harness using actual inventory components, fictional data, denied mutations and unknown reads, no authentication/storage access. Uses already installed esbuild. Generated bundle/HTML and enable flag are ignored, outside application build inputs.
- `local/omar/MINI_INVENTORY_THEME_RESULT.md`: this report.

No canonical Mini, Admin, backend, receipt, logo or print source was edited. The previously untracked logo in the workspace was left untouched.

## Coverage and colors

The overlay covers BranchInventoryScreen (through StorageScreen), InventoryOnlyApp, product cards, batches, supply composers, request/detail sheets, incoming shipments, shipment history, consumption, return composers/details, product activity and stock feedback.

Page uses petrol; panels/surfaces/cards use existing slate tokens. Existing champagne actions/selection and dark on-accent labels preserve action hierarchy. Available/healthy/received remain green; low/expiring/pending amber; depleted/expired/rejected/error red; shipment/supplier information blue. Existing purple consumption/request identity remains distinct, unchanged. Images are unchanged.

Only existing paint is recolored: original gradient stop positions/forms, shadow offsets/blur/spread, source alpha, borders, opacity, geometry, text metrics, transforms, state behavior, navigation and safe-area CSS remain intact. Base inventory CSS is hash-guarded. State rules include nested `disabled:hover`, rather than overriding it with a generic hover rule.

Source opacity utilities `/6`, `/8`, `/12`, `/14` do not emit paint in the checkpoint Tailwind runtime. They deliberately remain untouched: generating their colors would add alpha/backgrounds absent from the original. Neutral white image washes at 0.005/0.015/0.025 also retain their source paint to preserve legacy browser alpha serialization exactly. There is no blanket flattening or new effect.

## Desktop/mobile evidence

Evidence directory (ignored): `.local/omar/inventory-theme-1793137208290/`.

Real Omar desktop inventory was opened read-only: its one existing product still showed quantity **47**. `desktop-before.png` / `desktop-after.png` record that live view. Its first computed baseline selector matched no node; those live screenshots are not used as computed-fidelity proof. `desktop-comparison.json` explicitly records this limitation.

Paired fidelity evidence instead uses the actual original components and canonical `mini/index.css` / HTML head in an **offline synthetic fixture**. Theme off/on uses identical viewport, data and actions. This does not enroll a device, change its access mode, authenticate an Inventory-only device or call the backend. The fixture has `connect-src 'none'`, `form-action 'none'`, rejects every write and unknown mock GET, does not read browser credentials, and is not in the production bundle. Its temporary enable flag was removed after QA; the fixture URL now returns 404.

| Comparison | Viewport | Evidence prefix |
|---|---|---|
| Desktop cards/default | 1470 × 779 | `fixture-desktop` |
| Card hover | 1470 × 779 | `desktop-hover` |
| Consumption / all batch statuses | 1470 × 779 | `fixture-desktop-consume` |
| Focused supply composer / disabled submit | 1470 × 779 | `desktop-supply` |
| Return composer | 1470 × 779 | `desktop-return` |
| Incoming list / shipment detail | 1470 × 779 | `desktop-incoming`, `desktop-shipment` |
| Mobile home / product details / consumption / return | 390 × 844 | `mobile390-home`, `-details`, `-consume`, `-return` |
| Supply list / focused composer | 390 × 844 | `mobile390-supply-list`, `-supply-form` |
| Incoming / shipment details / history | 390 × 844 | `mobile390-incoming`, `-shipment`, `-history` |
| Empty / error / loading | 390 × 844 | `mobile390-empty`, `-error`, `-loading` |
| Second mobile viewport | 414 × 896 | `mobile414-home` |

Each prefix has `-before.png`, `-after.png`, and paired JSON snapshots. Complete standard computed styles were recorded in bounded groups to avoid the inspector's 200-object-key serialization limit, then combined outside the browser: **480 standard properties per element**. CSS custom paint variables are not compared; their rendered properties are.

**19 comparisons have no static non-RGB differences**, including rectangles, scroll dimensions/positions, body state, viewport, effect forms/alpha, typography and state geometry. Existing desktop pulse opacity differs by sample time (unchanged `pulse` declaration, duration and 0.5–1 range). Loading records one different instantaneous spin transform and two rotated bounding rectangles (spinner SVG and child). These temporal differences are preserved in `fidelity-results.json`, not erased or claimed to be pixel-identical. Its width/height, transform origin and animation declarations match. No animations were paused or modified to force a pass.

At 414px the nav remains at viewport bottom, width 414px, height 82.5px; canonical page bottom clearance is 112px. Document width remains 414px. Source safe-area calculations and minimum navigation reservation remain unchanged. Browser safe-area insets are zero; this does not establish physical iPhone notch/keyboard behavior.

Before / after desktop:

![Original inventory fixture](../../.local/omar/inventory-theme-1793137208290/fixture-desktop-before.png)
![Omar inventory fixture](../../.local/omar/inventory-theme-1793137208290/fixture-desktop-after.png)

Before / after mobile:

![Original Inventory-only fixture](../../.local/omar/inventory-theme-1793137208290/mobile390-home-before.png)
![Omar Inventory-only fixture](../../.local/omar/inventory-theme-1793137208290/mobile390-home-after.png)

## Contrast

Representative token checks (sRGB, opaque unless specified), not a whole-interface accessibility certification:

| Foreground/background | Ratio |
|---|---:|
| Primary text / card | 11.15:1 |
| Secondary text / card | 6.50:1 |
| Dark text / champagne action | 8.49:1 |
| Success / card | 5.26:1 |
| Warning / card | 6.29:1 |
| Error / card | 5.07:1 |
| Info / card | 5.77:1 |
| Existing text at 40% / card | 3.15:1 |
| Existing text at 35% / page | 3.01:1 |

Several small source labels/placeholders with fixed low alpha do not meet 4.5:1. Original disabled/out-of-stock opacity can further reduce contrast. Their opacity was not silently changed. Actual compositing varies by source surface and preserved gradient.

## Validation and isolation

- **82 / 82 tests passed**: existing foundation/cashier/operational/attendance/isolation/branding/auth/receipt/retry tests, seven inventory checks and twenty captured-state checks (including the documented live-spinner timing case).
- Mini production build passed: Vite 6.4.1, 1753 modules. Existing >500 KB JS chunk warning remains; no compiler/build options were relaxed.
- `git diff --check` passed; newly created source files checked for whitespace separately.
- Canonical `mini/`, `admin/`, `backend/` and default/Admin configuration have no diff from the committed checkpoint. Existing cashier/attendance overlays were not edited.
- CSS only activates for Omar Mini, inventory-marked ancestors and `@media screen`. No print rules or receipt inheritance paths were changed; no CSS rule targets other operational screens or Admin.
- Dependencies were not installed. No source auth/device APIs or business logic were changed. No stock movement/financial form was submitted, even inside the fixture.
- Backend/Admin/Mini remain running on loopback; no owned or unrelated process was stopped. Browser viewport reset and tab returned to normal Omar Mini.

Reproduce checks:

```sh
OMAR_INVENTORY_EVIDENCE="$PWD/.local/omar/inventory-theme-1793137208290" node --test local/omar/mini-inventory-theme.test.mjs local/omar/mini-theme.test.mjs local/omar/mini-cashier-theme.test.mjs local/omar/mini-theme-fidelity.test.mjs local/omar/mini-operational-theme.test.mjs local/omar/mini-attendance-theme.test.mjs local/omar/frontend.test.mjs local/omar/branding.test.mjs local/omar/auth-ui.test.cjs local/omar/blockers.test.cjs
node mini/node_modules/vite/bin/vite.js build --config local/omar/mini.vite.config.mjs --mode omar
git diff --check
```

The offline harness can be explicitly regenerated with `node local/omar/mini-inventory-visual-fixture.mjs` while the approved Omar Vite server runs. Remove its ignored `enabled` flag after use. It is disabled at task completion.

## Remaining coverage / decision

Uncovered live states: an officially authorized Inventory-only device session; physical mobile safe-area/keyboard behavior; pagination and every request resolution/cancellation combination; every product-activity/detail-sheet variant; post-submit success/validation feedback and receiving/consumption/return execution. Those paths are color-mapped from reviewed source but were not executed or all screenshot-tested. The mobile 414px pass covers home/navigation, not every sheet.

**GO for Phase 4B.5 theme work**, subject to owner visual review and the documented fixed-alpha contrast limits. This is not authorization or evidence for stock/financial transaction QA. Phase 4B.4 stops here; no later phase started.
