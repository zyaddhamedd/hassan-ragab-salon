# Phase 4B.2 — Omar Mini cashier and invoice theme

Branch: `feat/omar-fahim-setup`; HEAD/checkpoint:
`80716b903f2c3cc6640840f5128866458e8b4f85`.

**GO for Phase 4B.3 visual work**, with the uncovered visual states below
retained as follow-up QA. This is not financial-workflow certification.

## Exact changes in this phase

1. `local/omar/mini-theme.css`: appended the Phase 4B.2 screen-only overlay.
2. `local/omar/mini.vite.config.mjs`: adds the cashier plugin after the existing
   foundation plugin and before React.
3. `local/omar/mini-cashier-theme.mjs`: explicit, fail-closed presentation hooks.
4. `local/omar/mini-cashier-theme.test.mjs`: five targeted tests and optional
   static fixture generation into an existing ignored `.local/omar` directory.
5. `local/omar/MINI_CASHIER_THEME_RESULT.md`: this report.

The Phase 4B.1 CSS prefix remains byte-identical (apart from the separating
newline). Its plugin, tests and report remain byte-identical. Canonical Mini,
Admin, shared frontend isolation and branding source remain unchanged from HEAD.
All work remains uncommitted.

## Paint by component/state

| Area | Paint |
|---|---|
| Cashier main | Page petrol; neutral foreground |
| Invoice rail, header, payment footer, staff modal | Surface blue-gray; subtle border; no shadow or blur |
| Categories, services/products, draft rows | Card blue-gray; every category has the same base background |
| Customer lookup and form/editor surfaces | Input/surface tokens; muted placeholders |
| Selected services/products/staff, selected tender | Selected surface and champagne border/accent |
| Selected tabs and primary actions | Champagne fill with on-accent foreground |
| Hover/pressed/focus | Hover/pressed tokens, scoped focus outline; original transforms retained |
| Disabled controls | Muted foreground; existing disabled attributes and opacity retained |
| Success/deposit credit/change | Success token |
| Deposit/promo warnings | Warning token |
| Promo error/remaining amount | Error token, separate from decorative champagne accents |

Existing gradients, decorative blurred layers, glass effects and shadows are
neutralized only inside the three marked regions: Cashier main, invoice rail,
and Cashier's staff picker. Spinners retain a contrasting border segment and
their existing animation. Staff-name overlays use a flat surface for contrast.

The selected customer lookup's existing inline 3px edge keeps its dimensions;
only its colors use token variables, with the original colors as fallbacks.
All other hooks add data attributes derived from existing state. No layout,
font, radius, overflow, visibility, transform, handler, calculation or API code
was changed. No blanket `!important` rules or global Tailwind replacements.

## Before/after evidence

Ignored local directory:
`.local/omar/mini-cashier-theme-1793116015906/`.

Matched image pairs:

- `before-empty.png` / `after-empty.png`
- `before-services.png` / `after-services.png`
- `before-promo.png` / `after-promo.png`
- `before-staff.png` / `after-staff.png`
- `before-sidebar.png` / `after-sidebar.png`
- `before-draft.png` / `after-draft.png`
- `before-mobile-draft.png` / `after-mobile-draft.png`

`before-geometry.json`, `after-geometry.json` and `verification.json` retain
the comparison evidence. Desktop: 1470 × 779, DPR 2. Mobile: 390 × 844, DPR 1.
Baseline captures use the Phase 4B.1 CSS prefix; final captures use the complete
overlay, in the same live state. The full CSS was restored after comparison.

| State | Elements compared | Geometry/type/scroll differences |
|---|---:|---:|
| Empty/categories | 178 | 0 |
| Virtualized service list | 204 | 0 |
| Promo editor, no submission | 204 | 0 |
| Staff picker, no selection | 233 | 0 |
| Sidebar open, cashier region | 178 | 0 |
| Existing draft with staff and disabled selected service | 236 | 0 |
| Existing draft on mobile | 234 | 0 |

Compared properties include element boxes, scroll positions/dimensions, font
family/size/weight/line height/letter spacing, padding/margins, border widths,
radii, positioning, display/visibility, overflow and transforms. Hover states
were matched before accepting comparisons. Virtualized sizing source is
byte-identical. The original narrow mobile layout remains: the minimum-width
invoice rail consumes most of a 390px viewport. No responsive redesign was made.

## Isolation and print safety

- Plugin gated to Mini + explicit `omar` mode; absent from Admin/default configs.
- All new CSS requires the Omar HTML marker, shell marker and one POS region,
  inside `@media screen`. No print media rules changed.
- Receipt is outside all three painted regions. Its component and caller
  markup remain unchanged; the tests compare the ReceiptModal source exactly.
- No painted wrapper enclosing the receipt was added. Only the original
  foundation theme defines the tokens, in screen media.
- No CSS leakage found in the captured states. Shared widgets receive the
  overlay only when rendered inside these Cashier-owned regions.
- Login, device proof, backend, wordmark and WhatsApp source remain unchanged.

## Validation

- **40/40 frontend tests passed**: foundation/cashier theme, isolation,
  branding, auth UI, receipt and supply-retry regression tests.
- **26/26 offline Omar backend safety tests passed**.
- Real InvoiceSection static rendering matches canonical markup after removing
  presentation attributes for empty, draft, discount, promo, deposit and
  payment-verifying fixtures. All three tender inputs and locking remain.
- Mini production build passed:
  `node mini/node_modules/vite/bin/vite.js build --config local/omar/mini.vite.config.mjs --mode omar`.
- Existing main-bundle warning remains (>500 kB). Existing TypeScript debt was
  not suppressed; no compiler options changed. Build does not run `tsc`.
- `git diff --check` passed; generated evidence/builds/fixtures remain ignored.

## Uncovered states and browser notes

Live screenshots do not cover nonzero tender/change/remaining/error feedback,
deposit-booking selection, applied promo/discount, retail product cards, or
customer-lookup results. Relevant rules and invoice fixture contracts were
tested offline, but these visual branches still need manual QA with approved
existing data. No invoices, payments or prerequisite records were created to
reach them. Static fixture HTML was generated locally; browser policy denied
`file:` preview, so those fixture screenshots were not claimed or bypassed.

Browser validation paused when the user was actively testing. After explicit
handoff, the user's existing draft was inspected without editing any field.
A separate empty test tab was used for other captures and then closed. One
whole-Chrome accessibility inspection surfaced another project's foreground
tab while resolving focus; that path was stopped, and subsequent checks used
the verified Omar tab. No filesystem or database access to that project occurred.

No database commands, migrations, provisioning, commits or deployments were
performed. No invoice/payment/business writes were intentionally invoked by the
agent. The user's concurrent manual testing means a globally unchanged database
inventory is not asserted. The user's draft was left intact, viewport restored,
and the approved local servers remain running.
