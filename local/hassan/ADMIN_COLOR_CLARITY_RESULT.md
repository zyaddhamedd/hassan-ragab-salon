# Phase 4C.2C — Admin color clarity and Header cleanup

Implemented the two explicitly authorized targeted changes. Live acceptance remains incomplete because browser inspection is unavailable; NO-GO for starting the next Admin page group until that verification is completed.

## Exact files changed

- `local/omar/admin-theme.mjs`: Header subtitle attribute hook; vivid Logout semantic variable; screen-only subtitle visibility rule.
- `local/omar/admin-theme.css`: deterministic generated output.
- `local/omar/admin-theme.test.mjs`: exact hook reversibility, subtitle visibility/layout-property guards, Logout scope/color/behavior tests.
- `local/omar/ADMIN_COLOR_CLARITY_RESULT.md`: this report.

Branch `feat/omar-fahim-setup`. All previous work preserved. SHA-256 comparison against the pre-task manifest confirms only the three above pre-existing files changed. Admin config touched to refresh its existing watcher, with contents unchanged. No canonical Admin, Mini or backend diff. No DB operations, auth actions, commits or deployments.

## Findings and corrections

1. **Logout**: source and overlay audit proves `text-[#E53935]` resolved through the Logout-local navigation accent to the muted shell error token #DF9290. The corrected Dark Sidebar-only variable is #EF3434. This affects the existing inherited text/icon and existing hover background RGB; original hover alpha 10%, SVG shape, focus outline geometry and event handler are preserved. This is a verified source/served-CSS mapping, NOT a newly measured before/after browser computed color.
2. **Centered Header subtitle**: new attribute-only hook identifies exactly the existing paragraph containing the Omar wordmark. `visibility:hidden` removes its rendered/accessibility presentation in Omar Header in both modes, while retaining the original line box. The Arabic h1, subtitle wrapper, original classes, Header variable height, dimensions, margins and all neighboring controls remain unchanged. No replacement text or decoration. Right/profile branding untouched.
3. **Other elements**: no additional RGB/alpha changes made without new rendered evidence. Collapsed Sidebar label opacity 0/visibility hidden and expanded opacity 1 are intentional navigation behavior and untouched. The Header role caption is deliberately small/muted; branch-selector chevron has source text-white/40. Existing Dashboard decorative effects/disabled/loading states are untouched. Their live contrast/interaction audit remains pending, rather than assuming every low-alpha element is incorrect.
4. Existing Dashboard vivid mappings and its four documented opacity exceptions are unchanged. Tooltip payload-order bug unchanged.

## Geometry, Light, print and isolation

The subtitle uses visibility, not display:none, so its box remains in the existing flex layout. No Header height, alignment, padding, typography, breakpoint or control geometry declarations were added/changed. Expected original Header height remains 80px; actual new rectangles and title position are NOT remeasured while browser tooling is unavailable.

All theme color changes remain Dark/screen/Omar-only. The owner-authorized subtitle hiding is the only new rule shared with Light mode, and is still Omar Admin Header and screen-only. It does not hide Sidebar logos or other wordmarks. No receipt/print rule changes. Canonical/default Admin and Mini plugin configuration/source remain unchanged. The attribute-only transformation reverses byte-for-byte back to the existing branded Header source.

## Validation

- **61/61 passed**: Admin shell/Dashboard theme tests, isolation/branding, auth UI and receipt/supply regressions, including existing recorded visual-fidelity cases. Those historical snapshots are not new evidence for this change.
- New tests require the one exact subtitle visibility selector/value, prohibit shell layout/opacity declarations, and verify exact Dark Sidebar Logout color with its original onClick handler intact.
- Omar Admin production build passed: 4202 modules; existing ~2.12 MB JS bundle warning remains.
- `git diff --check` passed.
- Live asset checks returned HTTP200 for Omar Admin HTML, transformed Header module and theme CSS. New Header attribute and exact Logout/visibility rules are being served. No data endpoints were requested by these checks.
- Original loopback listeners preserved: Backend PID84296:5104, Admin PID84314:3100, Mini PID84323:5176. Admin cwd verified `<OMAR_SOURCE_ROOT>/admin`; only its normal config watcher was refreshed, no process restart.

Ignored logs/manifests: `.local/omar/admin-clarity/`.

## Still-unverified live states / acceptance blocker

The browser access host was unavailable on the attempted connection. No auth/logout action was attempted and no user browser tab was modified in this phase. Consequently no new collapsed/expanded/Logout-hover screenshots, no before/after Header screenshots, no real computed-style/contrast measurement, and no new same-viewport rectangle comparison can honestly be supplied. Live Light-mode, keyboard focus and disabled-state inspection also remain pending.

Implementation/build/isolation checks pass, but **NO-GO for final visual acceptance or next Admin page group** until browser inspection is restored and the requested real-state screenshots/measurements are completed. No unrelated page theming started.
