# Phase 4B.2A — strict original-design fidelity

Branch/HEAD: `feat/omar-fahim-setup` /
`80716b903f2c3cc6640840f5128866458e8b4f85`.

Result: original visual treatment restored in the inspected desktop states;
only RGB color channels differ. This supersedes the geometry-only visual
acceptance in the earlier Phase 4B.1/4B.2 reports. Phase 4B.3 was not started.

## Causes and corrections

| Previous deviation | Correction |
|---|---|
| `box-shadow:none`, `text-shadow:none`, ring suppression | Removed all suppression. Original per-component shadows and rings remain. Recolored arbitrary-shadow variables retain exactly the original inset/offset/blur/spread and alpha. |
| `background-image:none`, flattened category/input/product surfaces | Restored original linear/radial gradient forms. Only existing stop colors change; direction, positions, layers and alpha remain. |
| `filter:none`, `backdrop-filter:none`, transparent decorative layers | Removed these resets. Original blur, backdrop blur, disabled grayscale and decorative layers remain. |
| Added 2px focus outlines and 2px outline offsets | Removed. Existing outline/focus design remains, including original input glow forms. |
| Opaque border/foreground/fill substitutions for translucent utilities | Replaced with one-for-one source paint-class rules preserving each original alpha value. Original border widths/styles/radii remain. |
| Flat background added behind the staff-card name | Removed; original image/info overlay is restored. No card or modal structure changes. |
| Generic hover/pressed/selected/disabled fills and icon inheritance | Removed. Recolor only the state classes already present in the original source, preserving their original effects and opacity hierarchy. |
| Focus color overriding hover color | Matched original Tailwind order: focus-within, hover, focus; group-focus-within precedes group-hover within each region. Hover/focus intersections now retain original alpha/intensity. |
| Customer lookup active result became an opaque selected surface | Corrected the hook to use an 8% neutral color, matching original `rgba(...,0.08)`. The existing 3px selected edge remains unchanged. |
| Generic spinner border recoloring | Removed; original segment colors/transparent segment, border widths and animations remain. |

## Exact files changed in this phase

- `local/omar/mini-theme.css`: replaced flattening rules with scoped original
  paint-class color mappings. The 17 approved Omar palette tokens remain.
- `local/omar/mini-cashier-theme.mjs`: corrected only the lookup background
  variable; remaining hooks still add presentation attributes, without changing
  classes, structure, handlers, state or measurements.
- `local/omar/mini-theme.test.mjs`: replaced the obsolete effect-removal
  expectations with color-only scope checks.
- `local/omar/mini-cashier-theme.test.mjs`: updated the same scope contract;
  original source/markup/auth/isolation assertions remain.
- `local/omar/mini-theme-fidelity.test.mjs`: new strict effect-form, alpha,
  state-precedence tests and optional acceptance tests for saved live snapshots.
- `local/omar/MINI_VISUAL_FIDELITY_RESULT.md`: this report.

The existing foundation plugin and Vite activation were not changed. All
pre-existing uncommitted work remains. Canonical Mini, Admin, shared isolation
and branding source are still byte-identical to the checkpoint.

## Desktop evidence

Ignored local directory:
`.local/omar/mini-fidelity-1793117732226/`.

All compared states use **1470 × 779 CSS pixels, DPR 2**. Original captures use
the unchanged canonical Mini code with the Omar CSS temporarily disabled;
corrected captures use the color-only overlay. The existing Omar wordmark is
preserved in both. No other project's workspace or runtime was used as a
reference. Full corrected CSS was restored after baseline capture.

| View | Rejected overlay | Original design baseline | Corrected Omar |
|---|---|---|---|
| Barber modal | `rejected-barber.png` | `original-barber.png` | `corrected-barber.png` |
| Empty cashier | `rejected-empty.png` | `original-empty.png` | `corrected-empty.png` |
| Assistant modal | — | `original-assistant.png` | `corrected-assistant.png` |
| Services | — | `original-services.png` | `corrected-services.png` |

Raw evidence: `original-computed.json`, `corrected-computed.json`,
`rejected-computed.json`, `verification.json`. No credentials are recorded.

## Computed visual fidelity

Comparison ignores RGB channels only. **Alpha is retained**, including alpha
inside shadows, gradients and borders. It compares geometry and scroll state,
all four border widths/styles/radii/colors, background-image form, shadow
forms, filters/backdrop filters, outlines and offsets, opacity, font properties,
alignment/spacing, visibility/overflow, transforms, transition/animation
properties and SVG fill/stroke/stroke width. Matching hover and scroll states
were established before accepting the comparisons.

| State | Element snapshots | Differences outside RGB channels |
|---|---:|---:|
| Barber modal | 304 | 0 |
| Assistant modal | 303 | 0 |
| Empty cashier/categories and invoice rail | 275 | 0 |
| Customer input hover + focus | 275 | 0 |
| Payment input hover + focus | 275 | 0 |
| Promo editor, no code submitted | 275 | 0 |
| Virtualized service list | 301 | 0 |

The source-class audit covers original state colors without introducing generic
new hover/disabled fills. Two arbitrary product background images and all
recolored arbitrary shadow values are checked against their original source
forms, with only RGB replacement allowed. Other original effects are inherited
directly from their unchanged canonical classes.

## Tests and build

- **50/50 passed**: existing Omar theme/isolation/branding/auth/receipt/retry
  regression tests, three new strict static fidelity tests, and seven live
  computed-style acceptance tests.
- Mini production build passed with the approved Omar Vite configuration.
  Existing >500 kB main-chunk warning remains; no compiler options changed.
- `git diff --check` passed. Generated evidence and builds remain ignored.
- No print media or receipt component/caller changes. Every new rule remains
  under the Omar HTML marker and screen media, scoped to the existing shell,
  sidebar or Cashier-owned regions. No Admin/default configuration activation.

## Remaining coverage limits and runtime

No remaining non-color mismatch was found in the seven desktop states above.
Populated invoice rows, applied promo/discount/deposit, nonzero tender/status
states, customer-result rows and populated product cards were not recreated
live. Original invoice markup fixtures and static paint-form checks remain in
the test suite; these are not a claim of complete visual coverage of those
states. No business writes were used to reach a screenshot state.

Mobile layout was not redesigned or optimized. Existing responsive rules and
virtualized measurements are unchanged; mobile Inventory theming is deferred.

Backend PID 84296 at 127.0.0.1:5104, Admin PID 84314 at 127.0.0.1:3100 and Mini
PID 84323 at 127.0.0.1:5176 remain running. Vite reloaded the Omar overlay in
place. No servers were deliberately stopped, no database commands or financial
actions were executed, and no commit, push, merge or deployment occurred.
