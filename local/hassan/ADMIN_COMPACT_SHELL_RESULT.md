# Phase 4C.4A — Compact Admin Header & Sidebar Brand

Omar-only Vite presentation extension. No canonical source or logo bytes edited.

## Changes
- Desktop (>=1024px) shared `--app-header-height`: 80px -> 64px. Existing content padding, overlay/dialog limits and workspace insets inherit the variable.
- Below 640px the existing 64px height remains; 640–1023px retains 80px.
- Remove the whole centered subtitle row from transformed Header JSX. Preserve Arabic page title.
- At >=640px use three equal, shrinkable header columns, keeping the title centered in the available header region (already excludes the 72px desktop rail). Constrain long profile names and branch selectors using ellipsis; retain original handlers, fonts, gaps and icons.
- Sidebar remains 72px/256px with its original 180ms transition and input handlers. Replace only the Sidebar Logo invocation with the existing approved full official white asset in Dark mode and existing ink derivative in Light mode.
- Resolve collapsed logo width conflict: previous 64px wrapper in 50px available width -> 50x48px slot. Expanded/mobile slot: previous 112x48px -> 140x84px, within the unchanged 88px brand row. Logo uses proportional object-fit:contain; no new/cropped symbol.
- Only logo slot dimensions animate over 180ms; reduced-motion disables this added slot transition. Existing Sidebar animation is unmodified.

## Validation
- 102 tests passed, including four focused compact-shell tests and existing theme/isolation/auth/receipt regressions.
- Omar Admin production build passed (4211 modules). Existing large JavaScript bundle warning remains.
- Live Vite asset requests confirmed the new CSS import, Header hooks/subtitle removal and Sidebar logo substitution are active on port 3100.
- Canonical Admin, Mini and Backend have no source diff. No database or auth operations performed.
- Backend 5104, Admin 3100 and Mini 5176 retain their existing listener PIDs.
- Browser access host is unavailable. No new screenshot or live DOM measurements were obtained. Dimensions above are source/CSS specifications, not measured screenshots. Desktop/tablet/mobile overlap, exact visual title alignment, and hover/keyboard/touch presentation still require manual live acceptance.
- Full official logo is intentionally small in the collapsed 50px slot; no standalone official compact symbol is available. Asset bytes and Mini/print asset selections remain unchanged.

## Files for this phase
- local/omar/admin-compact-shell.mjs
- local/omar/admin-compact-shell.css
- local/omar/admin-compact-shell.test.mjs
- local/omar/admin.vite.config.mjs (additional import and plugin only; prior phases preserved)
- local/omar/ADMIN_COMPACT_SHELL_RESULT.md

No commit, push, deployment or server shutdown.
