# Phase 4C.2B — Omar Admin Dashboard theme

Baseline `19fe031b52dbdb43d3004575e7dda66473a57aae`, branch `feat/omar-fahim-setup`. Dashboard theme is active on the real Omar Admin at127.0.0.1:3100. Existing uncommitted shell work is preserved.

## Exact changes in this phase

1. `local/omar/admin.vite.config.mjs`: register Dashboard plugin after existing shell/isolation/branding and before React.
2. `local/omar/admin-dashboard-theme.mjs`: three-component attribute-only overlay, reviewed class/hex inventories, deterministic scoped RGB CSS and SVG presentation mappings.
3. `local/omar/admin-dashboard-theme.css`: Dark/screen Dashboard-only paints.
4. `local/omar/admin-dashboard-theme.test.mjs`: source reversal, drift, isolation, color semantics, effect forms, saved live/fictional fidelity and chart-data checks.
5. `local/omar/admin-dashboard-fidelity.mjs`: RGB-only normalization plus separately recorded, narrowly classified original animation-time differences.
6. `local/omar/admin-dashboard-visual-fixture.mjs`: actual Dashboard/RevenueChart/BranchPerformance with fictional datasets and rejected real API/auth/storage operations.
7. This report.

Canonical Admin, Mini, backend, shared branding, approved logos/assets and existing shell theme sources/docs/tooling remain byte-identical. Only Omar Admin config is extended. No Attendance/Expenses/UI-logo changes.

## Component and color map

- Dashboard page#162127; stat-card surfaces#273740; chart/branch/leaderboard panels#1E2C33; date controls/drawer use existing input/surface tokens.
- Explicit source brand reds#E53935/#FF5252/#D32F2F/#C62828 become champagne/hover/pressed/darker champagne. Original gradient stop count, direction, positions, alpha and effect geometry remain intact.
- Positive/negative Tailwind status families remain distinct green/red with differentiated lighter/darker stops. Source mathematical sign/threshold conditions remain untouched.
- Revenue SVG series: source#ef4444 paints#D8B887. Profit series: source#10b981 paints#79B69B. Both lines/fills/glows/active-dot colors remain consistent with their series; axes and original formatting/data/domains are unchanged.
- Branch score rings: high#79B69B, warning#D6B576, low#DF9290; track#3A4C56. Fictional85/65/45 cases verify all three.
- Chart axes use the secondary text token; source8-bit grid/cursor alpha03/08 is preserved exactly.
- Existing inline StatCard auras retain their source semantic hues/alpha/form. They were not flattened or removed.
- Light mode is excluded by the Dashboard Dark marker. No generic body/global Tailwind replacement, broad inherited shell foreground or print rule.

## Real Dashboard evidence

Ignored `.local/omar/admin-dashboard/`:
- `real-before.png` / `real-after.png`: real application,1470×835, Dark, All branches, same visible values300 revenue/240 net profit/1 invoice/2 services.
- `real-final.png`: final original Admin tab on Dashboard.
- `real-filter-before.png` / `real-filter-after.png`: actual custom-date drawer, no filter applied and no dates changed.
- Matching JSON snapshots include all standard computed properties, SVG path/point/stroke-width/radius data, visible text, boxes and scrolling.

The original tab moved to Inventory during implementation. It was left alone while availability was requested; a separate real Admin tab was used for the after smoke. After owner confirmation, the original tab was returned to Dashboard and left in Dark mode. Only owned QA tabs were closed; no login/logout/account/device action or operational write.

Read-only real application loading performs its existing normal GETs. No database commands, migrations, provisioning or financial/stock/attendance/customer writes occurred.

## Fidelity results

Only RGB is normalized in standard properties. Alpha, fonts, effect forms, outlines, dimensions, spacing, transitions and animation declarations are compared. Raw differences are retained in `fidelity-results.json`.

| Case | Elements | Static differences outside RGB | Original temporal samples |
|---|---:|---:|---:|
| Real Dashboard |419|0|49|
| Real date drawer |490|0|49|
| Fictional populated Dashboard |384|0|47|
| Revenue tooltip |408|0|45|
| Light Dashboard, including RGB parity |384|0|45|
| Loading |3|0|3|
| Error |15|0|0|
| Empty |220|0|47|
| Custom date field keyboard focus |455|0|55|

- The temporal entries are existing auraMove/energyFlow/pulseStatus/ping/pulse/spin transforms/opacity/rotated rectangles and clipped decorative-overflow measurements. Their original timelines/declarations and static layout boxes match; no animation was paused, removed or modified.
- Real drawer also samples4 Recharts JS-interpolated path properties at different times. These remain explicitly recorded. Complete-state SVG paths/points/radii/stroke widths are separately byte-identical before/after for real and fictional default states.
- Visible text/value arrays match for all9 paired cases. This proves unchanged presentation inputs/output for captured data, not complete financial correctness of every legacy formatter.
- Initial tooltip auto-margin samples returned unresolved0px vs56px despite identical rectangles. Parent layout was resolved before recapture; valid comparison has no remaining static discrepancy. Superseded raw sample remains locally available. Tooltip/loading/error/focus recaptures use the fixture1470×779 viewport. Initial default fixture images used the same835px clip over that779px CSS viewport; their JSON viewport is the geometry reference. Real before/after comparisons use1470×835.
- Light RGB values remain unchanged apart from time-varying original effects. No source opacity/alpha increase was authorized or applied.

## Important pre-existing financial tooltip defect

The original `RevenueChart.tsx` custom tooltip reads `payload[0].value` and `payload[1].value` as revenue/profit. Its four Area elements include duplicate revenue glow/main series, so those positions can both be revenue.

Observed in the fictional ORIGINAL and themed view at2026-10-22: dataset revenue900, net_profit-30, but tooltip displays revenue900, profit900, margin100.0%. Theme does not introduce or fix this. Chart point data and the actual profit curve remain unchanged. This is a separate high-priority financial-display defect requiring authorization and targeted correction before client financial acceptance. Do not interpret the visual tests as financial validation of that tooltip.

## Tests and runtime

-57/57 tests pass:14 Dashboard checks (5 static and9 captured-state checks) plus43 prior shell/isolation/branding/auth/receipt/retry checks.
- Omar Admin production build passes,4202 modules. Existing >500kB JS warning remains; main JS about2.12MB.
- git diff --check passes. Canonical/default Admin, Mini/backend and approved Mini assets/config have no diff.
- Real browser console: Tailwind CDN production warning and two transient Recharts initial width/height warnings; no captured error entries. These were not modified in this styling phase.
- Approved config change was picked up by Vite after a content-preserving config mtime notification. All existing process IDs remain: Backend84296 on5104, Admin84314 on3100, Mini84323 on5176, loopback only.
- Temporary offline-only static QA server64275 was shut down. It served only fictional HTML/JS/CSS with connect-src none/form-action none. Existing development servers remain running.
- No dependency installs, code refactors, commit, push, merge, deploy or Nady workspace/runtime access.

## Remaining limits and decision

**GO for the next separately authorized Admin visual page group. NO-GO for client financial acceptance until the pre-existing tooltip defect is resolved.** No later page group was started.

Unverified: every responsive/mobile Dashboard state, physical input-device scroll/drag combinations, actual API failure/loading injection, every live tooltip datapoint, and all live hover/tilt paths. Fictional loading/error/empty/focus/tooltip fixtures use the real components but are not a real device/session or operational transaction test. Existing low-alpha subtitles/unit text remain limited in contrast under the strict alpha contract. Not a whole-interface WCAG certification.

Reproduce tests:

```
OMAR_ADMIN_SHELL_EVIDENCE="$PWD/.local/omar/admin-shell-visual" OMAR_DASHBOARD_EVIDENCE="$PWD/.local/omar/admin-dashboard" node --test local/omar/admin-dashboard-theme.test.mjs local/omar/admin-theme.test.mjs local/omar/frontend.test.mjs local/omar/branding.test.mjs local/omar/auth-ui.test.cjs local/omar/blockers.test.cjs
node admin/node_modules/vite/bin/vite.js build --config local/omar/admin.vite.config.mjs --mode omar
git diff --check
```

Fixture generation: `node local/omar/admin-dashboard-visual-fixture.mjs`. Generated files remain under ignored `.local`; no production API or credentials are included.
