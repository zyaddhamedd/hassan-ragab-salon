# Phase 4C.2A — Omar Admin shell foundation

Branch: `feat/omar-fahim-setup`; baseline `19fe031b52dbdb43d3004575e7dda66473a57aae`.
Implementation and offline visual acceptance pass. **Live activation is not accepted yet**: existing Admin Vite PID84314 still serves the previous configuration; it was deliberately not stopped/restarted. Verify activation on3100 before starting the Dashboard theme slice.

## Exact files changed

1. `local/omar/admin.vite.config.mjs`: insert explicit Admin/omar-only pre-plugin after isolation/branding and before React.
2. `local/omar/admin-theme.mjs`: seventeen approved tokens, exact attribute-only hooks, reviewed paint digests, deterministic CSS generation and scoped dev-fixture middleware.
3. `local/omar/admin-theme.css`: screen/Dark-mode-only color rules for shell background, SideNav, Header, BottomNav and native branch options.
4. `local/omar/admin-theme.test.mjs`: activation, source reversal, drift failure, CSS/alpha/geometry constraints and seven optional saved visual-state checks.
5. `local/omar/admin-shell-fidelity.mjs`: full standard-computed-style comparison normalizing RGB channels only, preserving alpha/effect forms.
6. `local/omar/admin-shell-visual-fixture.mjs`: opt-in actual Header/SideNav/BottomNav, exact App shell JSX, fictional branch/user and denied real API/auth mutation boundary.
7. This report.

No canonical Admin/Mini/backend/shared branding source or approved Mini assets/config was edited.

## Paint scope

- Dedicated `html[data-omar-admin-theme="foundation"]` marker, independent of Mini.
- Shell root only changes its existing Dark background. No inherited shell foreground rule.
- SideNav portal root carries its own region and Dark/Light attribute, without modifying React portal ownership or handlers.
- Header and BottomNav carry independent region/Dark-mode attributes.
- Existing class paints are mapped one-for-one. Source18% active fill,10% hover fill,15% mobile selection,90% BottomNav surface and source white/border alpha remain exact.
- Existing2px keyboard outline and-2px offset remain; only outline color changes.
- Existing mobile indicator shadow remains0 0 4px; only its RGB changes.
- Sidebar scrollbar alpha remains0.25/0.55; dimensions/geometry unchanged.
- Logout uses the semantic error token rather than navigation champagne.
- Existing logo containers/wordmarks and their ancestor text colors are excluded. Header red Omar text and Sidebar gold wordmark intentionally remain unchanged under the protected-brand requirement.
- No new disabled treatment: these shell components have no source disabled control state to invent. Existing Tailwind classes/handlers/conditions remain exact.
- Dark/Light toggle is not removed or changed. Theme CSS does not match Light roots.

## Desktop/mobile evidence

Ignored evidence: `.local/omar/admin-shell-visual/`.
Each state has `-before.png`, `-after.png`, `-before.json`, `-after.json`; `verification.json` contains full comparison outcomes.

| State | Elements | Differences outside RGB |
|---|---:|---:|
| Desktop collapsed |235|0|
| Keyboard expanded/focus-visible |235|0|
| Pointer hover expanded |235|0|
| Light desktop, including RGB |227|0|
| Mobile BottomNav/drawer closed |235|0|
| Mobile drawer open/close-button focus |236|0|
| Header native branch-select focus/options |235|0|

Desktop1470×835; mobile390×844. Original collapsed capture sampled an in-progress viewport min-height transition, so it was recaptured after stabilization rather than accepting transient differences.

- Collapsed rail72px; expanded rail256px. Reserved Header/desktop content offset remains72px.
- Header desktop height80px; Header rectangles unchanged.
- Same document sizes, boxes, scroll dimensions/recorded positions, fonts, borders, radii, alpha, shadows/gradients, blur/filter, visibility, z-index, transitions and transforms.
- True pointer-hover was confirmed with `:hover`, `data-expanded=true` and BODY focus; keyboard expansion separately confirmed on the Services item. Expanded snapshots show256px in both versions.
- Header branch option backgrounds/text recolor without changing select structure. Native OS-popup pixel rendering is not certified across platforms.
- Actual fixture navigation switched the header to Services; fake branch selection reached9001. No real branch data was fetched. Standalone interactive theme-toggle transition was not accepted as separate live evidence; Dark/Light static parity and unchanged source handler are proven.
- Sentinel chart/financial/receipt region and existing brand nodes are compared without even RGB normalization. This is scope-leak evidence, not screenshots of a real Dashboard or actual receipt document.
- Scroll ranges/overflow and positions match. A PageDown attempt did not advance the fixture; physical wheel/trackpad scrolling was not independently exercised.

## Live-server limitation and QA isolation

The first request to the intended dev-fixture route on3100 fell through to the real Admin application because the running server had not loaded the new plugin. The owned tab was closed immediately. It may have issued normal application read-only GETs; there was no login/logout, provisioning, save, business transaction or database command. Do not interpret this task as proof of zero application reads.

A temporary static server on an OS-selected loopback port60487 then served only the bundled fictional fixture HTML/JS, with `connect-src 'none'` and `form-action 'none'`. The fixture mocks only the branches GET and a fictional SUPER_ADMIN; other API writes/auth operations throw. It does not read real browser credentials/storage. All visual comparisons above use that isolated fixture, not the live application. The temporary server and owned QA tab were closed afterward; viewport reset, fixture enable flag removed.

The current3100 HTML was explicitly checked and contained neither the new theme marker nor fixture script. Existing process command points to the approved Omar Admin config. No manual reload/restart workaround was forced; live dev-server activation remains outstanding under the instruction to preserve existing servers.

## Validation

-43/43 tests pass:12 new Admin/static+saved-state checks and31 existing frontend isolation/branding/auth UI/receipt/supply-retry checks.
- Omar Admin production build passes,4201 modules. Existing >500kB chunk warning remains (main JS about2.12MB).
- `git diff --check` passes.
- Default/canonical Admin, all Mini source/branding/config/assets and backend diff against baseline is empty. No dependency install or compiler suppression.
- Existing servers retained: backend84296 on5104, Admin84314 on3100, Mini84323 on5176, all loopback.
- No migrations, account/device actions, commit, push, merge or deployment.

Reproduce:

```
OMAR_ADMIN_SHELL_EVIDENCE="$PWD/.local/omar/admin-shell-visual" node --test local/omar/admin-theme.test.mjs local/omar/frontend.test.mjs local/omar/branding.test.mjs local/omar/auth-ui.test.cjs local/omar/blockers.test.cjs
node admin/node_modules/vite/bin/vite.js build --config local/omar/admin.vite.config.mjs --mode omar
git diff --check
```

Fixture generation: `node local/omar/admin-shell-visual-fixture.mjs`; remove its ignored `enabled` flag after QA. Until the Admin server loads the new config, its fixture middleware is unavailable there. No fixture output belongs in a future commit.

## Decision

Foundation code/build/offline fidelity: PASS. **NO-GO for moving into Dashboard theming until approved live Admin configuration activation and a shell-only smoke verification.** Current work is preserved uncommitted. Native popup variations, physical scrolling/mobile safe areas and live role-specific shell states remain unverified. Low-alpha source labels remain limited in contrast; alpha was not changed and no AA certification is claimed.
