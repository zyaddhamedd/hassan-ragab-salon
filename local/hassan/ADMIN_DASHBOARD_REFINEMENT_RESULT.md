# Phase 4C.2B.1 — Dashboard RGB hierarchy refinement

Scope: Omar Admin Dark Dashboard only. Workspace branch `feat/omar-fahim-setup`; HEAD remains `19fe031b52dbdb43d3004575e7dda66473a57aae`. No commit, database command, financial write, auth action, or server shutdown.

## Files changed in this task

- `local/omar/admin-dashboard-theme.mjs`: Dashboard-local paint aliases and mappings.
- `local/omar/admin-dashboard-theme.css`: deterministically generated scoped screen CSS.
- `local/omar/admin-dashboard-theme.test.mjs`: hierarchy, isolation, recorded fidelity and composited-contrast checks.
- `local/omar/ADMIN_DASHBOARD_REFINEMENT_RESULT.md`: this report.

All pre-existing work preserved. SHA-256 comparison against the pre-task 13-file manifest confirms only the first three pre-existing files changed. The Admin Vite configuration was touched to refresh its watcher; its content is unchanged. Canonical Admin, Mini and backend source have no diff against HEAD.

## Paint mapping

| Dashboard area | Previous | Refined |
|---|---|---|
| Page | #162127 | unchanged |
| Stat card base | #273740 | #293B45 |
| Revenue panel base | #1E2C33 | #1B2931 |
| Secondary labels / chart axes | #B4BEC3 / #96A5AE | #C5D0D3 |
| Muted icons | #96A5AE | #B8C5CC |
| Revenue plot | #D8B887 | unchanged champagne |
| Profit plot and gradient stop RGB | #79B69B | #91C5AC |
| Filter subtitle foreground | #B4BEC3 | #F3F4F2, original 60% opacity retained |

Existing alpha, original effects and gradient forms remain intact. Financial red/green distinctions, branch score colors, negative values and status classifications remain intact. New variables are local to the Dashboard marker, not shell-wide token changes. Tooltip variables explicitly retain prior colors; tooltip formatting, values and payload handling are untouched.

## Actual desktop evidence

Ignored local evidence: `.local/omar/dashboard-refinement/`.

- `real-before.png`, `real-after.png`: REAL Admin Dashboard at identical 1470×835 viewport, all branches, same date range and metrics.
- `filter-before.png`, `filter-after.png`: REAL custom-date filter, opened without applying changes.
- `fixture-before.png`, `fixture-after.png`: fictional populated chart; not evidence of additional live financial activity.
- Paired complete computed-style JSON: real, filter, fixture, tooltip and Light-mode states.
- `fidelity-results.json`, `contrast.json`, `tests.log`, `build.log`.

Screenshot bytes returned by the browser are JPEG despite the original `.png` capture names. `*-decoded.png` are lossless format conversions used only to read background pixels; original captures remain unchanged.

All five paired states have zero static non-RGB computed-style differences, including geometry, text properties, shadow/gradient form, alpha, borders, transitions and transforms. Unchanged original continuous animations were sampled at different times; their raw differences are retained and classified only against unchanged named timelines. Complete chart SVG paths are byte-identical in real/default, populated fixture, tooltip and Light states. In the real filter state only, original Recharts coordinate serialization differed by at most 0.001; command structure and every other SVG attribute remain identical. This sampling discrepancy is documented rather than claimed as byte-identical.

Live stat metrics remained revenue 300, profit 240, invoices 1, services 2; all captured displayed text unchanged. Chart source/data/domains/calculations/API handling unchanged. The live test tab had no browser console errors. No filters were applied. Original Reports tab was left untouched; the owned comparison tab was returned to Reports before cleanup.

## Contrast evidence and limitation

Approximate WCAG contrast from actual computed foreground RGB and ancestor opacity composited over median 3×3 adjacent-background pixels in real screenshots (not token-only comparisons). JPEG compression and animated surfaces introduce small sampling variation; this is representative-state evidence, not whole-page accessibility certification.

| Element | Before | After |
|---|---:|---:|
| Four stat labels | 4.10–4.24 | 6.73–6.99 |
| Four stat icons | 3.58–3.72 | 4.99–5.07 |
| Sample chart axis label | 6.42 | 8.14 |
| Filter date labels | 5.77 / 5.94 | 9.28 / 9.58 |
| Filter subtitle, original alpha 0.6 | 3.71 | 5.72 |
| Revenue line vs sampled chart surface | 5.97 | 6.16 |
| Profit line vs sampled chart surface | 4.82 | 5.97 |
| Chart subtitle, original alpha 0.4 | 2.24 | 2.50 |

The chart subtitle remains below normal-text 4.5:1 because its original 40% opacity must remain unchanged. Low-alpha currency units and other inherited decorative/secondary treatments are not certified AA by this task. No opacity override was introduced.

## Validation and isolation

64/64 targeted tests passed, including existing Admin foundation/Dashboard, frontend isolation/branding, auth UI and receipt/supply regressions, plus refinement fidelity/contrast checks. Command:

```sh
OMAR_ADMIN_SHELL_EVIDENCE="$PWD/.local/omar/admin-shell-visual" \
OMAR_DASHBOARD_EVIDENCE="$PWD/.local/omar/admin-dashboard" \
OMAR_DASHBOARD_REFINEMENT_EVIDENCE="$PWD/.local/omar/dashboard-refinement" \
node --test local/omar/admin-dashboard-theme.test.mjs local/omar/admin-theme.test.mjs \
  local/omar/frontend.test.mjs local/omar/branding.test.mjs \
  local/omar/auth-ui.test.cjs local/omar/blockers.test.cjs
```

Omar Admin production build passed (4202 modules). Existing large bundle warning remains (main JS approximately 2.12 MB). `git diff --check` passed.

Light-mode paired snapshots preserve paint as well as non-RGB design. All selectors require the Omar Admin HTML marker, Dark Dashboard root and screen media. Other Admin pages, receipts/print, shell foundation, Mini and canonical/default Admin are excluded. No new presentation hooks or shared-source changes.

Original Omar listeners remain unchanged: Backend PID84296 on 127.0.0.1:5104, Admin PID84314 on 127.0.0.1:3100, Mini PID84323 on 127.0.0.1:5176. Only the owned temporary fictional-fixture HTTP server is stopped after QA.

## Separate financial blocker — NOT FIXED

`admin/components/RevenueChart.tsx` CustomTooltip reads `payload[0].value` as revenue and `payload[1].value` as profit. Duplicate glow/main Area series can make the second entry another revenue value. The fictional October22 example still displays 900 revenue, 900 profit and 100% margin despite source fixture profit -30. This predates the theme and is deliberately unchanged. It requires a separately authorized financial correctness fix before relying on tooltip financial figures.

GO for this visual refinement and the next visual-only page group. NO-GO for financial acceptance/client delivery based on current tooltip figures until that separate blocker is resolved. No further phase started.

## Owner follow-up — stronger RGB palette

The owner subsequently rejected the above palette as too muted. Latest Dashboard-local values supersede the earlier palette table: card `#304B58`, chart `#11242D`, secondary `#E1EBEF`, muted icon `#C9DCE5`, profit plot `#36DFA0`, champagne accent `#F0BF70`. Page, opacity, geometry and all source effects remain unchanged. Tooltip local accent is explicitly reset to its previous champagne color, preserving tooltip paint and logic. No canonical component or foundation stylesheet edits.

Updated files remain the Dashboard module, generated stylesheet, matching tests and this report. 58/58 core/existing recorded regression tests passed; Omar Admin production build passed. Existing bundle-size warning remains. New real screenshot: `.local/omar/dashboard-refinement/stronger/after.jpg`. No live console errors. New full-tree before/after comparison is inconclusive: the initial capture sampled Recharts during mount/interpolation with different node counts; the prior five-state numerical contrast/fidelity results above describe the previous revision, not this stronger palette. They must not be represented as new full-tree computed evidence. Current paint-only property/alpha restrictions remain tested. No financial/data changes, commits or server shutdowns.
