# Phase 4B.5B — Login and device visual branding

Completed the Omar-only RGB overlay for Login and existing device/authentication presentations. The branch remains `feat/omar-fahim-setup`, baseline/HEAD `80716b903f2c3cc6640840f5128866458e8b4f85`; prior uncommitted work is preserved. No later phase was started.

## Exact files changed in this phase

1. `local/omar/mini.vite.config.mjs` — register the auth presentation plugin after existing Omar plugins, before React.
2. `local/omar/mini-auth-theme.mjs` — reviewed paint inventory, attribute-only hooks and deterministic RGB stylesheet generation.
3. `local/omar/mini-auth-theme.css` — generated, screen-only rules scoped to auth roots.
4. `local/omar/mini-auth-theme.test.mjs` — scope, original-source restoration, alpha/effect/state precedence, protected asset hashes and captured fidelity checks.
5. `local/omar/mini-auth-visual-fixture.mjs` — gated offline visual harness, using the actual Login component and verbatim App auth-panel JSX.
6. `local/omar/MINI_AUTH_THEME_RESULT.md` — this report.

No canonical Mini, Admin, backend, API/client/security, shared Logo/branding, receipt or print file changed. Existing cashier/header, operational, attendance and inventory theme modules/stylesheets remain untouched.

## Presentation map

`LoginScreen` contains the actual enrollment/pairing, approval-required, finalization and proof-repair feedback; they are conditional content inside the login form, not separate application screens. Pending approval reuses the enrollment-required presentation. No new screen or independent enrollment state machine was invented.

Three existing `App` return branches are also covered: stored-session bootstrap, device-context checking, and denied/unknown access mode. Their conditions and handlers are unchanged.

- Page: petrol; card/inputs: existing slate tokens with original alpha.
- Login and return-to-login actions: champagne with dark on-accent foreground.
- Invalid credentials / unauthorized / generic errors: error color.
- Enrollment/pairing/pending and proof repair: warning color.
- Approved device awaiting finalization: success color, existing champagne finalize action.
- Loading and disabled states preserve original opacity, spinner, conditions and event handlers.
- Existing Login Omar text wordmark is retained, recolored to the approved champagne. The approved **white Cashier PNG-alpha logo, 125px display sizing and 101px header geometry remain unchanged**.

Original Login glows, blur, focus shadow, text shadow, border forms, radii, typography, spacing, transitions and responsive behavior are preserved. Only their RGB paint changes. The focus shadow remains `0 0 10px … / 0.3`, CTA shadow `0 0 20px … / 0.4`, title shadow `0 0 8px … / 0.5`. No effect was flattened or removed.

A spinner-specific cascade issue discovered during QA was corrected inside the new auth generator: side-specific border color utilities follow shorthand border color, preserving the original opaque top segment and translucent remaining border. No width or spinner behavior changed.

## Offline safety and state coverage

Evidence: `.local/omar/auth-theme-1793154486917/` (ignored).

The harness bundles the real Login component with its actual `handleSubmit` / `handleFinalize` handlers. Only its imported client is replaced inside the fixture bundle. The fake boundary accepts a deliberately fictional form identity, returns predetermined errors or a pending promise, blocks all other calls, and cannot authenticate a user or enroll/approve/repair a device. No actual App is instantiated: its three standalone auth panels are extracted verbatim from reviewed JSX and supplied an inert blocked logout callback.

The fixture has `connect-src 'none'` and `form-action 'none'`. It does not read cookies, localStorage, sessionStorage, IndexedDB, credentials or device keys. Chrome initially attempted native saved-login autofill; fixture-only autocomplete hints were added and blank inputs verified, and the initial default screenshot/measurement replaced. Real Login autocomplete and validation were not changed. All subsequent form actions used explicit fictional values. No real credential was submitted.

Routes are dev-only, loopback-only, GET/HEAD-only and require an ignored enable flag. The generated harness/data are absent from production browser bundles. The flag was removed after QA and `/__omar_auth_visual` returns 404. The normal Omar tab and viewport were restored; no logout or device reset was performed.

22 original/themed comparisons:

| Evidence prefix | State / verification |
|---|---|
| `login` | Empty Login, normal form |
| `focus` | Email focus, focus shadow and group icon color |
| `hover` | Submit hover; original transition retained |
| `invalid` | Wrong credentials, visible settled error and available submit |
| `loading` | Pending login and disabled submit |
| `enrollment` | Pairing code, approval instructions and device-limit notice |
| `pending` | Approval-required variant without limit notice |
| `unauthorized` | Unapproved/unauthorized device feedback and fictional device ID |
| `finalization` | Approved-device message and enabled explicit finalize action |
| `finalization-disabled` | Missing enrollment ID keeps action disabled |
| `finalization-loading` | Pending finalize keeps original loading/disabled behavior |
| `repair-missing` | Missing key |
| `repair-mismatch` | Mismatched key |
| `repair-storage` | Unavailable proof storage |
| `repair` | Explicit proof-repair-required |
| `generic` | Generic authentication failure |
| `expired` | External session-expiration message |
| `external-device-error` | External device-context validation message |
| `bootstrap` | Stored-session checking panel |
| `device-check` | Device-context checking panel |
| `access-denied` | Unknown/denied access-mode panel |
| `mobile-login` | Original/themed Login at 390 × 844 |

Desktop comparisons use 1470 × 1000 and identical source/data/actions/scroll state. Each prefix has `-before.png`, `-after.png` and paired JSON files. Viewport images can omit the bottom of a naturally scrollable long state; the full DOM is measured. Mobile coverage is Login only, not every device state.

Before / after Login:

![Original Login paint](../../.local/omar/auth-theme-1793154486917/login-before.png)
![Omar Login paint](../../.local/omar/auth-theme-1793154486917/login-after.png)

Before / after enrollment/pairing:

![Original enrollment paint](../../.local/omar/auth-theme-1793154486917/enrollment-before.png)
![Omar enrollment paint](../../.local/omar/auth-theme-1793154486917/enrollment-after.png)

Device access-denied:

![Omar denied panel](../../.local/omar/auth-theme-1793154486917/access-denied-after.png)

## Non-RGB fidelity

All **480 standard computed properties per element** were recorded in bounded groups, alongside original classes/tags, rectangles, scrolling, body/document and viewport. Property serialization is not truncated at 200 keys. Source attributes are reversible to the canonical source byte-for-byte, including every handler and condition.

**No static non-RGB mismatch across all 22 comparisons.** Four running-spinner states show different instantaneous transform matrices and rotating bounding rectangles because they were sampled at different times. These values remain recorded in `fidelity-results.json`; they are not erased. Their original animation name, duration, iteration/timing, CSS width/height and transform origin match. No animation was paused to force a match. Other geometry, shadows, blur, borders, alpha, opacity, fonts and state precedence match.

## Auth/security regressions and build

- **97 / 97 tests passed**: existing Login/refresh/expired-session/logout, isolation/branding, cashier/receipt/retry, existing themes, new auth checks and 22 computed comparisons.
- Existing auth tests verify wrong login settles and can retry; correct login callback still succeeds; valid refresh retries once; unusable refresh clears session; logout is reentrancy-safe and preserves device identity/proof storage.
- Actual client/deviceProof source remains unchanged. No live proof challenge, enrollment, approval, repair, cookie/JWT/storage change or account action was used for screenshots. These are UI/security-boundary regressions, not a new live end-to-end cryptographic enrollment test.
- Mini production build passed: Vite 6.4.1, 1756 modules. Existing >500 KB JS chunk warning remains; no compiler option or diagnostic was suppressed.
- The built JS contains no fixture routes, pairing codes, fictional login values or mock-auth scenario markers.
- `git diff --check` passed and new files were checked for trailing whitespace.
- Protected hashes verify the approved cashier white logo module/asset/sizing and existing foundation/operational styles remain byte-identical.

Reproduce:

```sh
OMAR_AUTH_EVIDENCE="$PWD/.local/omar/auth-theme-1793154486917" node --test local/omar/mini-auth-theme.test.mjs local/omar/cashier-header-logo.test.mjs local/omar/mini-theme.test.mjs local/omar/mini-cashier-theme.test.mjs local/omar/mini-theme-fidelity.test.mjs local/omar/mini-operational-theme.test.mjs local/omar/mini-attendance-theme.test.mjs local/omar/mini-inventory-theme.test.mjs local/omar/frontend.test.mjs local/omar/branding.test.mjs local/omar/auth-ui.test.cjs local/omar/blockers.test.cjs
node mini/node_modules/vite/bin/vite.js build --config local/omar/mini.vite.config.mjs --mode omar
git diff --check
```

The fixture can be explicitly regenerated with `node local/omar/mini-auth-visual-fixture.mjs` while the approved Omar Vite server runs. Its enable flag is absent at task completion.

## Remaining visual/verification limits

- No real login, expired-session rotation, device enrollment/approval/finalization or repair was executed. Those live transitions/records were deliberately not changed.
- Native browser autofill, password-manager overlays, browser-generated validation bubbles, physical mobile keyboards/notches, every responsive viewport and all server message lengths are not visually certified. Real autofill remains governed by the unchanged source/browser behavior.
- Legacy low-alpha labels/placeholders remain limited in contrast because opacity/alpha must stay exact. Representative values over the intended composited Login surfaces: primary text 13.38:1; dark CTA text/champagne 8.49:1; 60%-opacity secondary labels ~3.78:1; 20%-alpha placeholders ~1.55:1. Glows/backdrop compositing vary by location. This is not a whole-screen WCAG certification, and alpha was not increased to conceal that limitation.
- Existing source effects remain intentionally present under the strict fidelity requirement.

**GO for Phase 4B.5C visual work**, with owner visual review and the stated legacy contrast/native-browser limits. No release or live security provisioning approval is implied. Backend/Admin/Mini remain running on loopback; no server was stopped. No database operation, migration, dependency install, commit, push, merge or deployment occurred. Stop after Phase 4B.5B.
