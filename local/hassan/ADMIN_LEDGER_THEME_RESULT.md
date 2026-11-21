# Phase 4C.3C — Expenses, Treasury and Reports Dark theme

Implemented using existing Omar paint helpers. No later phase started.

## Files changed

- `local/omar/admin.vite.config.mjs` — activate the Omar Admin-only ledger plugin before React.
- `local/omar/admin-ledger-theme.mjs` — reviewed page roots, paint-only chart substitutions and scoped color rules.
- `local/omar/admin-ledger-theme.css` — deterministic generated overlay.
- `local/omar/admin-ledger-theme.test.mjs` — seven focused isolation/financial-source/paint/contrast checks.
- `local/omar/ADMIN_LEDGER_THEME_RESULT.md` — this report.

Only the pre-existing Omar Vite configuration changed; all other prior uncommitted files match the pre-task SHA-256 manifest. Canonical Admin, Mini and Backend have no diff. No database/authentication actions, records, dependency installs, commits or deployments.

## Active areas

ExpensesPage normal/loading/error views, cards, ledger table, filters, expense form and category modal. AdminTreasuryPage balances, business-day transaction table, close-summary modal and feedback. ReportsPage and its nine active tabs: Overview, Services, Products, Sales, Finance, Branches, Employees analytics, Customers and Operations; shared ReportPrimitives filters/cards/tables/drawers and active charts.

`reports/EmployeesReport.tsx` is analytics UI, distinct from protected printable `EmployeeReport.tsx`. Printable employee reports, SettlementDocument, receipts, PDF/document templates, report utilities and download/export routines are excluded. No print CSS changes or exported-content changes.

## Colors and fidelity

Petrol/slate surfaces, #FFFFFF primary text, existing readable secondary palette and champagne brand controls. Functional red #EF3434, green #16C784, blue #3291FF, amber #F5A623; purple retained for InstaPay. Cash/Visa/InstaPay remain green/blue/purple in the main Treasury table and close-summary fields. Current/previous and service/product visual series remain distinct rather than becoming the same champagne color.

Report SVG props/stops/points use reviewed Dark-only RGB substitutions; tooltip panel backgrounds use #1E2C33. Finance sales and expense series remain distinct red/amber; Light literals are preserved. No data key, chart order, domain, amount, formatter, path, dimension or event code changed. Reversing the exact attributes/paint substitutions restores each reviewed source byte-for-byte. No financial or accounting logic edits.

Original gradients/shadows/stop alpha, layout, typography, borders, transforms, scrolling and animations remain unchanged. Only narrowly justified readable-text alpha exceptions:

- ReportPrimitives secondary `text-white/45`: 45% -> 75%, only within the Dark Reports workspace; disabled/aria-disabled elements and descendants excluded. Token-based compositing tests show the original pair below 4.5:1 and the corrected pair above 4.5:1 on the selected opaque slate surfaces.
- SVG axis text fills #ffffff55/#ffffff65/#ffffff66: approximately 33%/40%/40% -> 80% white. Grid/reference strokes, area-fill stops and other SVG alpha are untouched.
- Nonstandard numeric opacity utilities such as /42, /48 and /52 do not receive invented theme paint; their checkpoint fallback is preserved. No global opacity override.

Contrast tests are mathematical checks of specified surface/foreground pairs, not measured certification of all live/composited states.

## Validation / remaining gaps

- **82/82 passed**: seven new focused checks plus existing Admin isolation/theme, branding/auth and receipt regressions. No new fixtures or visual-testing framework.
- Admin production build passed, 4205 modules; existing ~2.12 MB JS bundle warning remains.
- `git diff --check` and explicit new-file whitespace checks pass.
- Asset-only live Vite checks returned HTTP200 for the three roots and representative chart modules; final served HMR CSS matches the generated stylesheet exactly. No business-data API calls made.
- Existing Backend PID84296:5104, Admin PID84314:3100 and Mini PID84323:5176 remain running on loopback, without process restarts.
- Browser access host remains unavailable. Real populated/modals/hover/focus screenshots, computed geometry and final rendered contrast need owner review; source/property checks are not presented as live visual proof. No technical build/isolation blocker identified.
- The separately documented Dashboard tooltip payload-order bug is unchanged.
