# Phase 4C.3D — Inventory and Supply Dark theme

Implemented using the existing Omar-only paint infrastructure. No later phase started.

## Files changed

- `local/omar/admin.vite.config.mjs` — activate the Omar Admin-only stock theme before React.
- `local/omar/admin-stock-theme.mjs` — reviewed active import graph, two attribute hooks, scoped paint rules.
- `local/omar/admin-stock-theme.css` — deterministic generated overlay.
- `local/omar/admin-stock-theme.test.mjs` — eight focused isolation/graph/source/semantic/paint checks.
- `local/omar/ADMIN_STOCK_THEME_RESULT.md` — this report.

Only the pre-existing Omar Vite configuration changed. All other prior uncommitted files match the pre-task SHA-256 manifest. Canonical Admin, Mini and Backend have no diff. **Promo Codes was not modified, transformed, included in the paint inventory or themed.**

## Active coverage and protection

InventoryPage navigation/workspace controls, overview/comparison/pipeline/activity, catalog and product forms, product workspace/batches/distribution/history, receiving/product receiving panel, transfer/cart/summary, branch requests, shipment history/details, returns/direct supplier returns/cost views, drawers, stock/movement badges, pagination and existing loading/empty/error states.

The reviewed import graph excludes unused ActionCard, OverviewHeader, HeartbeatIndicator and EmptyState components. The old files remain unchanged.

ShipmentDetailsModal is the one body portal. Its existing root receives a presentation attribute; CSS can match it only while its owning Inventory page is mounted in Dark mode. Other body portals are not themed. No prop drilling, new state or effects.

Every selector requires Omar Admin plus the owned Dark inventory root/portal. Print media, protected document roots/descendants/ancestors, other page groups and Light mode are excluded. No printable/exported document code, API, stock quantity, movement logic, status calculation, financial/payment code or source class was modified. Reversing the two attribute hooks restores their source exactly.

## Colors and fidelity

Petrol/slate surfaces, white primary and readable secondary text, champagne brand actions/navigation. Vivid red/green/blue/amber retained by existing meaning. Violet product sales, teal internal consumption, green supply, amber transfer-out, blue transfer-in, red supplier returns and neutral adjustments/unknown types stay distinct. No direction/sign is inferred from a movement type.

Solid dark semantic badges retain dark hue-specific surfaces rather than mapping background and text to the same bright RGB. Existing solid light badge treatments inside Dark inventory are mapped to corresponding dark tones. Positive action controls receive dark foreground where needed. Original dimensions, shapes, spacing, typography, alpha/effect forms, animations and important utility behavior are preserved by source/property checks.

One narrow text-only alpha exception: enabled input/textarea product-workspace `placeholder:text-white/40` -> 75% white. Disabled/aria-disabled controls, decorative image captions and all other alpha remain unchanged. Nonstandard numeric opacity utilities keep their canonical fallback rather than receiving invented paint.

## Results / genuine gaps

- **90/90 passed**: eight new tests plus existing Admin theme/isolation/branding/auth/receipt regressions. No new fixtures or QA framework; no fake records or data writes.
- Admin production build passed, 4206 modules; existing ~2.12 MB JS bundle warning remains.
- `git diff --check` and explicit new-file whitespace checks passed.
- Asset-only live Vite checks returned HTTP200 for the owned page/portal markers; served CSS matches the generated file exactly. No inventory APIs requested.
- Backend PID84296:5104, Admin PID84314:3100 and Mini PID84323:5176 remain on loopback, without process restarts.
- Browser access host remains unavailable, so live populated/portal/modal screenshots, computed geometry, hover/focus/disabled behavior and final rendered contrast remain for owner review. Static checks are not claimed as live visual proof.
- No technical build/isolation blocker. No commit, push, deploy or stock operation performed.
