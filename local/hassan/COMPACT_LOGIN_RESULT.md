# Owner-requested compact Login and white logo

The Omar Mini Login now uses the approved white, tightly bounded logo instead of the temporary text wordmark. The “نظام الإدارة الموحد” heading is removed from the Omar render. The logo is approximately 240px wide, proportionally contained in a viewport-aware frame.

Only Login presentation is adjusted: smaller vertical gaps, card padding and input/button vertical padding. Existing fonts, field types, required validation, handlers, loading/error behavior, APIs, device proof and storage are unchanged. There is no forced overflow hiding: long device messages or exceptionally short windows remain scrollable rather than being clipped. The default form and wrong-password feedback fit completely at the tested desktop sizes.

Canonical Mini/Admin source, Cashier logo sizing/header, other screens, print assets and the approved SVG bytes are untouched. The new plugin is Omar Mini only and runs after the existing auth color overlay.

## Verified sizes

| Viewport | Document size | Result |
|---|---|---|
| 1470 × 779 | 1470 × 779 | Entire default form visible, no page scroll |
| 1366 × 650 | 1366 × 650 | Entire default form visible, no page scroll |
| 390 × 844 | 390 × 844 | Entire default form visible, no page scroll |

The subtitle is absent, the white image loads at its original 1435 × 844 natural dimensions, and inputs, submit button and lower notice are inside each viewport. Wrong-password rendering was also exercised in the offline fixture at 1470 × 779: no scroll, visible error, submit available again. No live login was submitted.

Evidence (ignored): `.local/omar/compact-login-1793156014693/`, including `desktop.png`, `laptop.png`, `mobile.png`, `invalid.png`, and `measurements.json`.

![Compact desktop Login](../../.local/omar/compact-login-1793156014693/desktop.png)

The initial real Omar tab was inspected successfully; its default form fit at 1470 × 835. Browser automation subsequently detached from that user tab, so responsive QA used a fresh owned tab and the existing network-denied offline fixture. Only that test tab was closed; viewport overrides were reset. The original tab was not logged out or closed.

## Checks

- 81/81 tests passed: existing auth/isolation/branding/theme/cashier/receipt tests plus compact source-restoration/scope and three viewport measurements.
- Mini production build passed (1757 modules); existing >500 KB chunk warning remains.
- `git diff --check` and new-file whitespace checks passed.
- Offline fixture supports an explicit `layout=compact` variant while preserving the original color-only fixtures. Fixture-only autocomplete protections and network/mutation restrictions remain.
- Temporary fixture enable flag removed after QA.
- Development servers remain running on 127.0.0.1:5104 / 3100 / 5176. No database action, dependency install, commit, push or deployment.

Changed files:

1. `local/omar/mini-login-layout.mjs`
2. `local/omar/mini-login-layout.css`
3. `local/omar/mini-login-layout.test.mjs`
4. `local/omar/mini.vite.config.mjs`
5. `local/omar/mini-auth-visual-fixture.mjs`
6. `local/omar/COMPACT_LOGIN_RESULT.md`

This owner-authorized Login layout follow-up supersedes the prior color-only restriction for these specifically requested presentation changes. No broader UI work was performed.
