# Omar temporary Admin/Mini identity

Completed in `<OMAR_SOURCE_ROOT>`, branch
`feat/omar-fahim-setup`. Omar now selects the two-line text wordmark:

**OMAR FAHIM**<br>
**SALON**

## Implementation and scope

The approved Omar Vite configuration adds one local-only branding plugin. Shared
Admin/Mini source files, original SVGs and original Vite configurations remain
unchanged, preserving Nady's canonical/default variant. No original Nady worktree
or production resource was accessed.

A shared text-only React component renders the primary marks at the existing
Logo component locations. It uses heavy Arial typography, responsive container
units, existing gold/inherited text colors and existing logo frame sizes. Login,
sidebar and Header text marks are covered. Sidebar branding width adapts to the
collapsed/expanded rail; a small Header mark gets a 12px readable baseline and
full existing red contrast. Light login/black report contexts use ink text.
No overall UI, navigation, theme palette or feature was redesigned.

A centralized, reviewed per-file caption registry covers the remaining visible
brand signatures in UI headers/footers, placeholders, employee cards, waiting
and queue UI, and frontend document brand captions. It does not globally replace
business strings. Expected missing captions fail closed. Browser tab titles are
also Omar-specific. Primary logo modules are selected only inside the Omar
config, so canonical imports and assets are preserved.

Existing receipt logo imports select a text-only ink SVG. Its viewBox exactly
matches the existing receipt asset (2050 × 1208), retaining the same image frame
and aspect ratio. ReceiptPrintLayout's brand tagline is replaced in its existing
single-line slot. Financial markup, totals, data, CSS, QR destinations and
WhatsApp wording are untouched. No backend report was edited. The only legacy
brand phrase remaining in built JS is the explicitly excluded WhatsApp thank-you
wording; original default source/assets intentionally retain Nady branding.

## Validation

- Admin approved Omar production build: **passed**.
- Mini approved Omar production build: **passed**.
- Existing frontend isolation tests: **11 passed**.
- New scoped branding tests: **4 passed**.
- Existing receipt/retry/financial-semantics tests: **12 passed**.
- `git diff --check`: passed.
- Source/asset audit: all prior work preserved; no canonical application source
  or asset changed in this task. Existing isolation/source-drift gates remain.

Browser inspection used real components in isolated visual fixtures with every
backend API intercepted. No real login, authentication/security write, DB query,
account provisioning or operational action was performed. It inspected:

- Admin login, sidebar and Header at 1440px desktop and 390px mobile.
- Mini login and sidebar at both sizes.
- Admin light-mode mobile login in addition to the dark views.

All 11 screenshots rendered the Omar wordmark without visible Nady names/logos,
horizontal overflow, application exceptions or console errors. Main login,
mobile sidebar, mobile Header, light-mode login and Mini sidebar screenshots
were also visually inspected. Existing dimensions and navigation were retained.
The first review exposed a dev-only CJS React import issue in the new virtual
module; it was corrected to a normal bare React import and covered by a test.
Both production and development rendering now pass.

Final screenshots and visual results are ignored/private in:
`.local/omar/branding-review-1793105353590/`.
The temporary review script `/tmp/omar-brand-visual.cjs` does not change the
application database and did not read credentials.

## Runtime state

The existing owned Vite processes automatically reloaded their Omar configuration.
No foreign process was stopped or reconfigured. Backend process was unchanged.
All three Omar services remain running for manual testing:

- Backend: http://127.0.0.1:5104
- Admin: http://127.0.0.1:3100
- Mini: http://127.0.0.1:5176

No migration, provisioning, database modification, business/auth/device change,
commit, push, merge or deploy occurred. All existing work remains uncommitted.

## Exact files changed

1. `local/omar/frontend-config.mjs` — activates Omar-only branding after isolation checks.
2. `local/omar/branding.mjs` — scoped source/asset selection, captions, titles and brand styling.
3. `local/omar/wordmark.mjs` — shared responsive text-only wordmark.
4. `local/omar/wordmark-ink.svg` — text-only receipt mark preserving its original frame.
5. `local/omar/branding.test.mjs` — four regression checks for scope, drift, assets and dev import.
6. `local/omar/TEMPORARY_IDENTITY_RESULT.md` — this report.

Ignored frontend build artifacts, Vite caches, runtime logs and visual evidence
were updated normally. Stop here after the temporary identity task.
