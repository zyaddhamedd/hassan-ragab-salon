# Phase 4B.3B — Attendance contrast refinement

Workspace/branch: Omar Fahim Salon / `feat/omar-fahim-setup`.
HEAD remains `80716b903f2c3cc6640840f5128866458e8b4f85`.

**GO for a separately authorized inventory theme phase**, with the fixed-alpha
accessibility limitations below explicitly retained. This is not a full WCAG
conformance sign-off. No inventory work was performed.

## Exact files changed in this phase

- `local/omar/mini-operational-theme.mjs`: Attendance-local RGB palette and
  stronger card, action, badge, counter and avatar-border colors.
- `local/omar/mini-operational-theme.css`: deterministic regenerated output.
- `local/omar/mini-attendance-theme.test.mjs`: stronger contrast expectations,
  threshold tests and acceptance tests of the current live evidence.
- `local/omar/ATTENDANCE_CONTRAST_REFINEMENT_RESULT.md`: this report.

No new presentation hooks were needed. All earlier uncommitted work remains.
Canonical Mini, Admin, backend, branding and shared isolation source remain
unchanged. The six other operational screens' CSS rules remain byte-identical
to the approved Phase 4B.3 output; approved Cashier/foundation files retain their
hashes. No image file, image source selection or filter was changed.

## Color choices and visual hierarchy

| Area | Updated RGB treatment |
|---|---|
| Page | Existing `#162127`, unchanged |
| Employee cards | Neutral `#2B3C45` at the first original gradient stop, fading to existing page color at the second; identical for present/absent |
| Semantic base colors | Present `#69AD91`, absent `#C78287` |
| Action gradients | 50% semantic base mixed with card at the first stop; 40% semantic mixed with existing surface at the second |
| Badge text | Lighter semantic RGB mixes, retaining hue distinction and original alpha |
| Badge background | Existing 3% alpha retained; RGB changed to page color for subtle darker separation |
| Status bars/dots/borders | Stronger semantic RGB mix, confined to existing small indicators |
| Avatar frame | `#B8C5CB` RGB at the original 40% alpha; champagne fallback initials |
| Section counters | White RGB at the original 50% alpha |
| Role description | Maximum white RGB at the original 30% opacity |

The cyan EM PNG remains unchanged as previously approved. Cards are not green
or red. No backgrounds, borders, outlines, shadows or decorative elements were
added; only the RGB values of existing paint were changed.

## Real desktop before/after evidence

Ignored directory:
`.local/omar/attendance-contrast-1793135084675/`.

All pairs use **1470 × 779 CSS pixels, DPR 2**, with the same existing present
barber, absent barber and present assistant. For each suffix below, the pair is
`before-<suffix>.png` / `after-<suffix>.png`.

| State/suffix | Elements | Non-RGB differences |
|---|---:|---:|
| default | 76 | 0 |
| card-hover | 76 | 0 |
| search-focus | 76 | 0 |
| button-focus | 76 | 0 |
| button-hover | 76 | 0 |
| assistant | 76 | 0 |

Keyboard Tab focused the action button without activating it. Non-activating
scrolling established button hover. Only employee/headings were clicked to
inspect cards and scroll to the assistant. No attendance action was invoked.

Evidence includes `before-computed.json`, `after-computed.json`,
`rendered-colors.json`, `contrast-audit.json` and `verification.json`.

The comparison ignores RGB channels only. Alpha, opacity, gradient forms/stops,
shadow forms, blur/filter, outlines, border widths/styles/radii, typography/SVG
geometry, layout/spacing, transforms, transitions, scrolling and overflow all
match. The original source classes, handlers and component structure are intact.

## Contrast measurements and honest limitations

Measurements use effective foreground alpha/opacity composited over sampled
rendered backgrounds, with conservative gradient-endpoint comparisons. Normal
text uses the 4.5:1 minimum from
[W3C Understanding WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
Threshold tests use unrounded ratios.

| Measurement | Before | After | Interpretation |
|---|---:|---:|---|
| Brightest card/page separation | 1.14 | 1.43 | Clearer card surfaces; this is a hierarchy measure, not a text threshold |
| Section counters | 3.19 | 5.07 | Improved; meets normal-text minimum |
| Check-in action text | 8.91 | 4.73 | Stronger fill; still above normal-text minimum |
| Check-out action text | 9.15 | 5.23 | Stronger fill; still above normal-text minimum |
| Status labels, minimum across cards | 5.44 | 5.32 | Brighter visible RGB; still above normal-text minimum |
| Employee names, minimum | 10.81 | 8.75 | Remain high contrast |
| Role description, conservative minimum | 2.51 | 2.47 | Still fails; original 30% opacity retained |
| Search placeholder | 1.91 | 1.87 | Still fails; original white at 20% alpha retained |

Stronger colored surfaces do not mean every foreground ratio increases. The
chosen action/background and badge colors retain passing critical-label
contrast while making the controls less washed out. The lighter card/input
surfaces slightly reduce the already insufficient role/placeholder ratios.
Those text colors are already at maximum white RGB; meeting 4.5:1 would require
an alpha or broader design change prohibited in this phase. No full-AA claim
is made and no alpha constraint was bypassed.

## Validation and isolation

- **85/85 tests passed**, including theme/isolation, auth/receipt regressions,
  strict alpha/effect tests, prior saved fidelity evidence, six current desktop
  fidelity states and live contrast assertions documenting the known failures.
- Mini production build passed through the approved Omar config. Existing
  >500 kB main-JS chunk warning remains; no compiler options were changed.
- `git diff --check` passed.
- No CSS rule changes outside Attendance. No Admin/default Mini activation,
  print media, receipt templates, image assets or Cashier changes.
- Loading/disabled attendance actions were not triggered; their original
  source alpha/behavior remains protected by the tests.

No DB commands/writes, attendance actions, migrations, provisioning, commits,
pushes, merges or deployments were performed. Existing Backend/Admin/Mini
processes remain running on 127.0.0.1:5104/3100/5176. Stop point: Phase 4B.3B.
