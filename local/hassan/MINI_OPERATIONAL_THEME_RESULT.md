# Phase 4B.3 — remaining operational Mini screens

Branch: `feat/omar-fahim-setup`. HEAD/checkpoint:
`80716b903f2c3cc6640840f5128866458e8b4f85`.

**GO for a separately authorized inventory theme phase.** No inventory theme
work was performed. The original design and behavior remain the reference.

## Exact files changed in this phase

1. `local/omar/mini.vite.config.mjs`: activates the operational plugin after
   the existing approved themes, before React, only in Omar Mini configuration.
2. `local/omar/mini-operational-theme.mjs`: attribute-only hooks for seven
   screen roots, including all four Treasury render branches; two assistant
   accent-context hooks; deterministic color-rule generation and fail-closed
   reviewed paint inventories.
3. `local/omar/mini-operational-theme.css`: generated screen-scoped RGB paint
   mappings using existing palette tokens and original alpha/effect forms.
4. `local/omar/mini-operational-theme.test.mjs`: isolation, source/print
   protection, effect/alpha, state precedence, semantic and live fidelity tests.
5. `local/omar/MINI_OPERATIONAL_THEME_RESULT.md`: this report.

All earlier uncommitted work is retained. The approved `mini-theme.css`,
foundation plugin and cashier plugin retain their pre-phase SHA-256 hashes.
Canonical Mini, Admin, backend, shared isolation and branding source have no
diff from the checkpoint. No source component files were edited.

## Successfully themed

- WaitingScreen: existing counter/buttons and decorative effects; no ticket draw/reset.
- CustomersScreen: existing populated list and empty add-customer modal.
- BarbersScreen: staff list, finance menu and unsaved advance form.
- AppointmentsScreen: existing booking list, unsaved booking form and date picker.
- AttendanceScreen: present/absent staff, plus original card hover effects.
- ExpensesScreen: empty list and unsaved expense form.
- MiniTreasuryPage: open-day dashboard, unsaved reconciliation modal and input focus.

Local shared components receive color rules only while descendants of these
authorized screen roots. No additional wrappers, layout changes, state,
handlers, API calls or calculation changes were introduced.

RGB mappings retain original alpha, gradient direction/layers/stops, shadow
offsets/blur/spread/inset, filters, radii, border widths/styles, focus geometry,
transforms and transitions. Rules are tied to original source paint classes;
there are no blanket hover/disabled fills or effect resets. State ordering
retains focus-within → hover → focus and group-focus-within → group-hover.

Destructive/error red, success green and warning amber remain distinct.
Treasury cash remains green, Visa blue, and the original violet Instapay
identity is deliberately retained. Decorative assistant identity uses champagne
without changing the red deduction/cancel/delete treatment.

## Desktop evidence and full fidelity

All final pairs use **1470 × 779 CSS pixels, DPR 2**. Initial Waiting/Customers
captures had a different browser content height; those pairs were recaptured
at the matching size before acceptance. Baseline is the same unchanged screen
source without the new operational overlay, not another client's runtime.
The existing approved shell/cashier theme stayed enabled during comparison.

Ignored local evidence directory:
`.local/omar/mini-operational-1793118569287/`.

For each state below, `before-<state>.png` and `after-<state>.png` form the pair.

| State/file suffix | Elements compared | Raw differences outside RGB |
|---|---:|---:|
| waiting | 56 | 0 |
| customers | 193 | 0 |
| customer-modal | 222 | 0 |
| barbers | 75 | 0 |
| finance-menu | 128 | 0 |
| finance-form | 101 | 0 |
| appointments | 99 | 0 |
| booking-modal | 178 | 0 |
| booking-calendar | 235 | 0 |
| attendance | 76 | 0 |
| attendance-hover | 76 | 0 |
| expenses | 34 | 0 |
| expense-modal | 74 | 0 |
| treasury | 96 | 1 temporal pulse-opacity sample |
| treasury-modal | 137 | 1 temporal pulse-opacity sample |
| treasury-focus | 137 | 1 temporal pulse-opacity sample |

Comparisons cover boxes, scroll positions/dimensions, background-image form,
shadow/text-shadow forms, blur/backdrop filters, outlines, all four border
widths/styles/radii/colors, font properties, spacing/alignment, opacity,
visibility/overflow, transforms/origins, transition and animation names/durations,
and SVG fill/stroke/stroke width. Only RGB channels are normalized; color alpha
is preserved and compared.

**No unexplained non-RGB differences were found.** The Treasury dot is an
existing running pulse captured at different times. Its original and themed
keyframes are byte-identical (`50% { opacity: .5 }`), with the same 2s infinite
timeline, easing, delay, direction, fill mode and running state. All other
sampled properties match. The three instantaneous opacity differences are
retained in the raw evidence; they are not silently normalized away. The live
test verifies the unchanged timeline and its 0.5–1 opacity range. No animation
was paused, removed or rewritten to manufacture a matching frame.

Evidence files include `before-computed.json`, `after-computed.json`,
`pulse-definition.json` and `verification.json`. They contain no credentials.

Representative image pairs:

- [Waiting before](<OMAR_SOURCE_ROOT>/.local/omar/mini-operational-1793118569287/before-waiting.png) / [after](<OMAR_SOURCE_ROOT>/.local/omar/mini-operational-1793118569287/after-waiting.png)
- [Customer modal before](<OMAR_SOURCE_ROOT>/.local/omar/mini-operational-1793118569287/before-customer-modal.png) / [after](<OMAR_SOURCE_ROOT>/.local/omar/mini-operational-1793118569287/after-customer-modal.png)
- [Finance form before](<OMAR_SOURCE_ROOT>/.local/omar/mini-operational-1793118569287/before-finance-form.png) / [after](<OMAR_SOURCE_ROOT>/.local/omar/mini-operational-1793118569287/after-finance-form.png)
- [Calendar before](<OMAR_SOURCE_ROOT>/.local/omar/mini-operational-1793118569287/before-booking-calendar.png) / [after](<OMAR_SOURCE_ROOT>/.local/omar/mini-operational-1793118569287/after-booking-calendar.png)
- [Attendance hover before](<OMAR_SOURCE_ROOT>/.local/omar/mini-operational-1793118569287/before-attendance-hover.png) / [after](<OMAR_SOURCE_ROOT>/.local/omar/mini-operational-1793118569287/after-attendance-hover.png)
- [Expense modal before](<OMAR_SOURCE_ROOT>/.local/omar/mini-operational-1793118569287/before-expense-modal.png) / [after](<OMAR_SOURCE_ROOT>/.local/omar/mini-operational-1793118569287/after-expense-modal.png)
- [Treasury before](<OMAR_SOURCE_ROOT>/.local/omar/mini-operational-1793118569287/before-treasury.png) / [after](<OMAR_SOURCE_ROOT>/.local/omar/mini-operational-1793118569287/after-treasury.png)

## Isolation and print protection

- Every new rule is inside screen media and requires the Omar HTML marker,
  existing shell marker, and a named authorized screen marker.
- Receipt/print-template/no-print/wordmark descendants are excluded. Screen
  root foreground is deliberately not overridden, protecting canonical
  inherited receipt colors. Neutral inherited foreground/embedded scrollbar
  styling may therefore retain original neutral values; these are intentional
  protection choices, not layout or effect changes.
- Waiting print JSX and styles, Barbers receipt HTML and Treasury print
  templates remain unchanged. Tests reverse every presentation hook to obtain
  byte-identical source and separately compare all template literals.
- No print actions were executed. Print protection is source/media isolation
  evidence, not a claim that a physical printer was tested.
- Cashier/Invoice, inventory/mobile inventory, auth/device screens, receipts,
  wordmark and Admin are not dispatched by the new plugin. It is absent from
  default/non-Omar and Admin configuration.

## Validation

- **73/73 tests passed**: 50 offline isolation/theme/auth/receipt/retry/fidelity
  checks, 7 saved prior Cashier fidelity regressions, and 16 new operational
  state comparisons (with explicit unchanged-timeline handling above).
- Mini production build passed through the approved Omar Vite config.
- Existing main-JS chunk-size warning remains (>500 kB). No compiler options
  or TypeScript diagnostics were suppressed; production build is not `tsc`.
- `git diff --check` passed. Evidence and generated builds remain ignored.

## Coverage limits and remaining work

Not captured live: transient loading/forced API failures, customer edit/gallery
variants, all finance-action forms, populated expense rows, every booking drawer,
and Treasury closed-day/success/printed reports. Their source/style inventories
are covered statically; no operational writes were made solely for screenshots.
The expense form currently has no available categories; none were provisioned.

Original violet financial identity, embedded neutral scrollbar colors and
protected inherited neutral foreground remain deliberately unchanged. No known
unexplained design mismatch remains in the inspected operational states.

No database commands, migrations, financial transactions, save/submit actions,
ticket draw/reset, attendance changes, business-day opening/closing, Nady
workspace/runtime access, commits, pushes, merges or deployments were performed.
Backend/Admin/Mini remain running at 127.0.0.1 ports 5104/3100/5176; Vite reloaded
its own configuration in place. No owned server process was stopped.

Stop point: Phase 4B.3 complete. Inventory remains unchanged and out of scope.
