# Phase 4B.1 — Omar Mini theme foundation

Baseline: `80716b903f2c3cc6640840f5128866458e8b4f85`, branch
`feat/omar-fahim-setup`. Result: **GO for Phase 4B.2**.

## Exact files changed

- `local/omar/mini.vite.config.mjs`: installs the Omar Mini theme plugin.
- `local/omar/mini-theme.mjs`: mode/app-gated CSS injection and fail-closed,
  attribute-only presentation hooks for App and Sidebar.
- `local/omar/mini-theme.css`: all 17 approved tokens; screen-only shell,
  sidebar/navigation colors and states; removes scoped shell glow/blur/shadows.
- `local/omar/mini-theme.test.mjs`: four targeted isolation and scope tests.
- `local/omar/MINI_THEME_FOUNDATION_RESULT.md`: this report.

## Visual evidence and geometry

Local, ignored evidence directory:
`.local/omar/mini-theme-foundation-1793115334828/`.

- `before-open.png` / `after-open.png`: sidebar open.
- `before-closed.png` / `after-closed-matched.png`: sidebar closed.
- Corresponding JSON snapshots and `verification.json` retain comparison evidence.

Both captures use 1470 × 779 CSS pixels, DPR 2, with fonts loaded. Sidebar
remains at x=1182, y=0, width=288, height=779. All 95 sidebar elements retain
their measured geometry, scrolling, typography, radii, spacing, display,
visibility, overflow and transforms. All 178 captured cashier/invoice elements
retain the same measured geometry and selected computed styles. An initial
closed-view comparison differed because of an existing hovered category;
matching the hover state removed those differences without selecting services.

Keyboard focus remains visible; sidebar navigation scrolls to its existing
62px maximum. Attendance navigation and return to Cashier succeeded. The
inactive Cashier remains mounted and hidden (`display:none`). Normal logout
and a subsequent legitimate approved-device cashier login both succeeded.

## Isolation and protected behavior

The plugin runs only for app `mini`, mode `omar`, through the dedicated Mini
config. Canonical Mini, Admin and existing branding source remain identical
to baseline. Tests prove the plugin is absent from Admin/default modes; no
default server with legacy environment fallbacks was started.

Every CSS selector is rooted at the Omar HTML marker and every rule is inside
screen media. No geometry, typography, visibility, transform, overflow, print,
receipt or cashier-control rules were added. Main shell foreground is not
overridden, preventing inherited color leakage into POS. Existing wordmark
selection stays unchanged. No CSS leakage was found in the captured states.
Cashier's existing gradients/glass/colors intentionally remain for later work.

## Validation

- 35/35 tests passed: theme foundation, frontend isolation, branding,
  authentication UI, receipt and supply-retry regression suites.
- Omar Mini production build passed using:
  `node mini/node_modules/vite/bin/vite.js build --config local/omar/mini.vite.config.mjs --mode omar`.
- Existing bundle-size warning remains (main chunk over 500 kB); no compiler
  options or existing TypeScript debt were changed. A production build is not
  a TypeScript type check.
- `git diff --check` passed. Evidence/build outputs remain ignored.

Backend PID 84296 at 127.0.0.1:5104, Admin PID 84314 at 127.0.0.1:3100 and
Mini PID 84323 at 127.0.0.1:5176 remain listening. Mini Vite reloaded its config
in place; no owned server process was stopped. No database inspection,
migrations, provisioning or business-data actions were performed. Normal
login/logout may update existing authentication/security records.

Next slice may theme cashier controls under a separate approval. Receipt and
print appearance remain outside that authorization unless explicitly included.
No commit, push or deployment was performed.
