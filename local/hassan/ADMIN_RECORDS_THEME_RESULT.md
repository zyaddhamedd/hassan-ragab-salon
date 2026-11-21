# Phase 4C.3A — Services, Customers and Invoices Dark theme

Implementation and offline checks pass. Real same-viewport visual acceptance remains pending because the browser access host is unavailable. **NO-GO for Phase 4C.3B until the requested live visual review is completed or the owner explicitly approves these screens.** No later page group started.

## Exact changed files

1. `local/omar/admin.vite.config.mjs`: add the explicit Omar Admin-only records plugin after existing isolation/branding/shell/Dashboard plugins, before React.
2. `local/omar/admin-records-theme.mjs`: reviewed source hashes, attribute-only hooks, protected document boundaries and deterministic scoped paint generation.
3. `local/omar/admin-records-theme.css`: generated color overlay.
4. `local/omar/admin-records-theme.test.mjs`: isolation, reversibility, alpha/effect safety, semantic/color/contrast rules and 24 SSR-state comparisons.
5. `local/omar/admin-records-visual-fixture.mjs`: standalone fictional SSR evidence tool, never imported into the application/plugin. API methods and message writes throw; effects are not executed.
6. `local/omar/ADMIN_RECORDS_THEME_RESULT.md`: this report.

Workspace branch `feat/omar-fahim-setup`; HEAD remains `19fe031b52dbdb43d3004575e7dda66473a57aae`. Pre-task SHA-256 manifest confirms the only pre-existing file changed is the Omar Admin Vite configuration. All previous uncommitted Shell/Dashboard/branding work is preserved byte-for-byte. No canonical Admin, Mini or backend source changes; no sparse expansion, database operations, business writes, auth/device actions, commits or deployments.

## Surfaces configured

- **Services:** ServicesPage root/category tabs/card-table switch/empty state, ServiceCard and ServicesTable, action menus, ServiceModal, CategoryManagementModal, existing form/error/save/disabled/focus/hover classes.
- **Customers:** ClientsPage normal/error/loading roots, ClientTable desktop/mobile variants, ClientDetailsModal and its photo-lightbox root, search/pagination/feedback states.
- **Invoices:** InvoicesPage normal/error/loading roots, filters/summary/pagination/feedback, full-screen details portal, InvoiceTable desktop/mobile ledger, InvoiceDetailsModal workspace/header/line-item/payment/status sections and InvoiceActivityTimeline content.
- Modals have their own Dark markers; no arbitrary body-portal styling or application-wide recoloring.

## Palette and meaning

Page #162127, inputs #1A282F, surfaces #1E2C33, cards #273740, selected #35434A; pure white primary text; secondary #E1EBEF. Champagne #D8B887 remains the brand accent. Semantic red #EF3434, green #16C784, blue #3291FF and amber #F5A623 stay vivid.

Payment meanings remain distinct: CASH green, VISA blue, INSTAPAY purple (#A78BFA). Existing sky/cyan classifications also remain separate rather than collapsing every status into brand colors. Source text, labels, calculations, data ordering, financial amounts and handlers are unchanged.

Reviewed destructive service/category buttons reuse a brand hex in canonical code. Attribute-only semantic hooks keep those delete actions red while preserving their original default-vs-hover treatment and alpha. Opaque champagne-filled controls get #17232A foreground for readable brand-button contrast; translucent selected chips keep their existing text treatment. No typography changes. These are RGB-only changes, not opacity adjustments.

## Print/export/shared-component protection

- AuthenticReceiptViewer and all shared Mini Receipt/ReceiptPrintLayout source are NOT transformed or included in the paint inventory.
- The existing wrapper immediately around AuthenticReceiptViewer is marked protected by an attribute only. Every generated selector excludes protected roots, descendants and ancestors containing them. Receipt-adjacent shared ancestor surfaces may deliberately retain canonical paint rather than risk altering the protected viewer's transparent background context.
- Client and invoice export modals receive only a protected root attribute. Their UI and exported-document logic are excluded from recoloring; payloads/download routines are unchanged.
- CSS exists only under `@media screen`, the Omar Admin HTML marker and a Dark owned-area root. No print rules, receipt HTML, thermal widths, document CSS or assets changed.
- Light mode receives inert attributes only; no matching theme selectors. Canonical/default Admin has no plugin activation. Mini configuration/source untouched.

## Fidelity and evidence

No layout, dimensions, spacing, font, border width/radius/style, animation, transform, overflow, visibility, focus geometry or alpha declarations are introduced. Existing effect RGB is recolored while its original alpha/coordinates/form remain unchanged. Unsupported checkpoint Tailwind alpha utilities are intentionally not given new paint. Original black backdrops/image washes and inline customer-avatar colors are preserved.

Attribute reversal restores every reviewed transformed file byte-for-byte, including all API/state/financial code. Full source hashes fail closed on drift; transforms accept only the reviewed canonical source or the existing approved namespaced/branded equivalent.

Ignored evidence in `.local/omar/admin-records/fixtures/`:

- `before.json` / `after.json` contain **24** fictional real-component SSR states (12 states in each mode): service card, populated/empty service table, service form, category manager empty state, populated/empty customers, customer-details initial loading, populated/empty invoice table, paid invoice-details workspace including authentic receipt, and payment activity details.
- Corresponding `*-before.html` / `*-after.html` files provide offline presentation previews. They are HTML artifacts, NOT screenshots. Remote images and all API connections/form actions are blocked by fixture CSP; QR/receipt markup is retained unchanged.
- After removing the new inert presentation attributes, all 24 HTML outputs match exactly, including invoice/receipt values, classes, document markup and Light content.
- SSR does not exercise effects, interactive menus, save/delete behavior or real device/browser layout. It is not proof of computed-style or pixel fidelity.

The live browser connection failed before a real before/after audit could be captured. Therefore new screenshots, rendered contrast measurements, actual geometry rectangles, hover/focus/disabled interactions, populated category manager, loaded customer history, activity timeline loading/error/expanded interactions and real invoice-workspace transition states remain **unverified**. No operational writes were made to manufacture these states.

## Validation results

- **69/69 passed**: new records tests plus existing Shell/Dashboard isolation/branding, auth UI and receipt/supply regressions, including historical recorded fidelity cases. Historical snapshots do not prove new records visual fidelity.
- Omar Admin production build passed: 4203 modules; main JS ~2.12 MB. Existing >500 KB bundle warning remains.
- `git diff --check` passed; canonical Admin/Mini/backend diff empty.
- Real Vite asset-only checks: HTTP200 and new markers in seven page/modal modules; served HMR CSS decoded and matched the generated stylesheet byte-for-byte. A transient 403 during config watcher reload disappeared; subsequent checks passed. No data endpoints requested.
- Existing loopback servers preserved: Backend PID84296:5104, Admin PID84314:3100, Mini PID84323:5176. No process stopped/restarted.

## Remaining issues / handoff

1. Complete live desktop screenshots and same-state computed-style comparison when browser tooling returns, then obtain visual approval before Phase 4C.3B.
2. Existing low-alpha readable elements (for example customer phone opacity 40% and neutral service edit/delete controls at text-white/40) are preserved pending actual rendered contrast assessment. No unsupported blanket alpha correction.
3. Existing per-customer inline avatar RGB and certain neutral/divider/decorative paints remain canonical intentionally.
4. Previously documented Dashboard tooltip payload-order correctness bug is unchanged and remains a separate financial acceptance blocker.
5. No financial values, APIs, print/export documents or authentication behavior changed.
