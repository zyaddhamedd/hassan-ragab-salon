# Omar targeted frontend blocker triage — Phase 3A.1

Decision: **GO for separately authorized, controlled Phase 3B local integration**.
The confirmed undefined-symbol failures are fixed and targeted tests pass.
TypeScript is **not green**: 19 Admin and 2 Mini diagnostics remain. They were not
suppressed, excluded or repaired as incidental cleanup. This decision is for
local integration testing, not complete financial-workflow acceptance.

## Scope and provenance

Workspace `<OMAR_SOURCE_ROOT>`, branch
`feat/omar-fahim-setup`, HEAD `adf9fe6b11034bd1848681e005be6ac920ddc1f0` verified.
Only this Omar worktree was used. Approved-checkpoint source was read through this
worktree's Git objects for comparison; the original Nady worktree was not accessed.
No server, real business action, database connection/change, migration,
provisioning, branding, employee PWA or branch-management work occurred.

## Classification of every original diagnostic

A = confirmed runtime/financial blocker. B = plausible runtime defect requiring a
targeted test. C = type-only or presently nonblocking debt. Original diagnostic
positions are listed to correlate with Phase 3A logs. Receipt is reported twice
because Admin's program includes the shared Mini source. No unresolved B remains
among these diagnostics after targeted testing.

| # | Original source location | Class | Call-site evidence / disposition |
| --- | --- | --- | --- |
| 1 | `admin/components/ChartsSection.tsx:7:10`, REVENUE_CHART_DATA | C | No active module imports ChartsSection; missing legacy fixture export is dormant, not a current App route. Unchanged. |
| 2 | `admin/components/ChartsSection.tsx:7:30`, BRANCH_DATA | C | Same unreferenced component; no current runtime evaluation. Unchanged. |
| 3 | `admin/components/ClientCharts.tsx:7:10`, TOP_CLIENTS_DATA | C | ClientCharts has no external import/call site in current source. Unchanged. |
| 4 | `admin/components/ClientCharts.tsx:7:28`, CLIENT_RETENTION_DATA | C | Same dormant module, not the active client screen. Unchanged. |
| 5 | `admin/components/EmployeeCharts.tsx:6:10`, EMPLOYEE_PERFORMANCE_DATA | C | EmployeeCharts has no active importer. Existing employee/report workflows use other components. Unchanged. |
| 6 | `admin/components/Header.tsx:40:28`, replace on never | C | `admin/App.tsx` mounts Header. All declared AdminUser roles are covered by switch cases; TS narrows the default to never. Runtime optional chaining handles absent user and string fallback handles legacy string roles. No undefined function. Unchanged. |
| 7 | `admin/components/InvoiceCharts.tsx:7:10`, COLLECTIONS_DAILY_DATA | C | InvoiceCharts has no active importer, not the current invoice screen. Unchanged. |
| 8 | `admin/components/InvoiceCharts.tsx:7:34`, PAYMENT_METHODS_DATA | C | Same dormant legacy chart module. Unchanged. |
| 9 | `admin/components/reports/EmployeesReport.tsx:301:246`, unknown amount | B → C | ReportsPage mounts EmployeesReport; cashier drawer iterates payments.methods. `reports/types.ts:688` declares numeric method values. Real report formatters accept numeric fixtures; no undefined symbol or recalculation. Unchanged. |
| 10 | `admin/components/reports/FinanceReport.tsx:252:149`, unknown value | B → C | Active finance view iterates cash_out.breakdown, numeric Record at `types.ts:524`; formatter tested with numeric values. Unchanged. |
| 11 | `admin/components/reports/FinanceReport.tsx:285:259`, unknown value | B → C | Finance business-day drawer uses the same numeric contract through `types.ts:548`; formatting only, not ledger mutation. Unchanged. |
| 12 | `admin/components/reports/OperationsReport.tsx:185:243`, unknown count | B → C | ReportsPage -> OperationsReport -> ControlView; `types.ts:1039` declares numeric checkout-source counts. Real numeric formatter tested. Unchanged. |
| 13 | `admin/components/ServicesCharts.tsx:7:10`, SERVICE_CHART_DATA | C | No external importer of ServicesCharts in current source. Unchanged. |
| 14 | `admin/components/settlement/SettlementErrorBoundary.tsx:33:10`, setState | B → C | SettlementStudio:541 wraps SettlementDocument. Class extends real React.Component; targeted test proves inherited setState exists and reset works. Admin lacks installed @types/react declarations; no runtime method is missing. Unchanged. |
| 15 | `admin/components/settlement/SettlementErrorBoundary.tsx:34:14`, props | B → C | Real React constructor supplies props; tested onReset callback path. Unchanged. |
| 16 | `admin/components/settlement/SettlementErrorBoundary.tsx:35:12`, props | B → C | Same reset callback path verified, not an undefined handler. Unchanged. |
| 17 | `admin/components/settlement/SettlementErrorBoundary.tsx:51:21`, props | B → C | Error-state render builds fallback UI from real props; targeted class test covers error state. Unchanged. |
| 18 | `admin/components/settlement/SettlementErrorBoundary.tsx:72:17`, props | B → C | Normal render returns supplied child; targeted test verifies it. Unchanged. |
| 19 | `admin/components/supply/ReceiveSupplyModal.tsx:403:26`, loadProducts | A | InventoryPage:201 mounts modal. Failed initial GET leaves error with no products; rendering retry button dereferenced nonexistent loadProducts before a click. Reproduced, fixed and tested. |
| 20 | `admin/hooks/useVisiblePolling.ts:92:38`, number vs Timeout | C | Consumers use browserPollingEnvironment; window.setTimeout returns a number and paired window.clearTimeout accepts it. Node ambient ReturnType in interface is the mismatch; no object-only timer operations. Unchanged. |
| 21 | `mini/components/Receipt.tsx:78:83` in Admin program, calculateGrossTotal | B → A (conditional) | Admin AuthenticReceiptViewer imports ReceiptContent/PrintLayout and supplies numeric subtotal; it does not invoke the default wrapper. Diagnostic is shared source. A missing-subtotal grouped default-wrapper render nevertheless reproducibly throws; same fix as #24. |
| 22 | `mini/App.tsx:679:9`, Expense.customerId | C | addExpense maps response after its existing request; ExpensesScreen renders type/amount/date/time/cashier/notes. Extra response metadata on the JS object is unused there; excess-property typing does not throw or change expense arithmetic. Unchanged. |
| 23 | `mini/components/InventoryOnlyApp.tsx:496:16`, CSS custom property | C | Active inventory shell emits valid `--inventory-mobile-nav-height` style; React/browser support it. Narrow CSSProperties key typing is the diagnostic. Unchanged. |
| 24 | `mini/components/Receipt.tsx:78:83` in Mini program, calculateGrossTotal | B → A (conditional) | CashierScreen ReceiptModal:464-508 supplies persisted gross/discount/net as numbers in normal flows, so valid receipts did not fail. Targeted missing-subtotal/grouped render proves the latent fallback ReferenceError. Fixed without changing normal financial output. |

The eight missing chart exports remain genuine debt: activating those dormant
modules later requires repair. None was deleted to hide diagnostics. The numeric
report tests validate the documented JSON contract, not arbitrary malformed API
payloads; full live report integration remains Phase 3B work. No auth/device-proof
diagnostic or new defect in those protocols was identified.

## Receipt trace and exact fix

`mini/components/CashierScreen.tsx` ReceiptModal takes gross from persisted
`currentInvoice.total_amount`, discount from promo/discount fields and net from
`net_amount` when available. It passes those numeric values to Receipt. Group
subtotal is often **net**, so summing group.subtotal would be an unsafe substitute
for gross. Admin's AuthenticReceiptViewer similarly passes invoice.amount,
discountAmount and netAmount into the shared content/print components.

The only existing item-price gross fallback was already implemented inside
`buildInvoiceWhatsAppMessage` in `mini/src/utils/whatsappUtil.ts`. It was extracted
unchanged into `resolveInvoiceGrossSubtotal`; that message function now calls the
helper. Receipt calls the same helper instead of the nonexistent function and
passes the resolved subtotal to both screen and print views. Explicit numeric
subtotal, including zero, still wins. No discount, net-total, deposit, payment,
change, rounding, quantity, commission or ledger formula was changed or invented.
No backend invoice data is recomputed or written.

Real React static-render tests compare complete markup with the approved
checkpoint for paid, discounted, deposit, promo, fully discounted, authoritative
zero, split-payment and grouped receipts. The corresponding WhatsApp messages
match checkpoint output exactly. Dates are frozen for reproducibility; assets are
handled without network requests. The failing missing-subtotal grouped path now
matches the same receipt supplied explicitly with the gross value produced by
the pre-existing utility fallback. Its fixture deliberately has a net group
subtotal different from gross item prices, guarding against the wrong fallback.
These tests exercise screen and embedded print output, not just a copied formula.

## Supply loader and exact fix

The retry handler now calls the existing `loadInitialProducts`; that loader still
uses `fetchSupplyProducts('')`, maps the same response, populates the same cache
and manages the same loading/error state. No second loader or stock operation
was added. A targeted test first reproduced the render ReferenceError. After
connecting the handler, it exposed an automatic debounced search retry behind the
initial error view. The search effect is now paused only for an error with zero
products, exactly matching that view, and resumes normally otherwise. Submission
errors with products present do not disable ordinary product search.

The real component's effects/state are exercised with a small offline hook
harness and a stubbed adminFetch: one failed initial GET, no automatic retry on
timer drain, one user retry, one successful GET, populated picker/cache and no
extra request afterward. No stock submit, POST, real fetch, database or server is
used. This is not a full browser/StrictMode/concurrent-render test.

## Isolation transform review

Existing literal transformations were deterministic and idempotent across all
reviewed source files, including Admin's shared Mini receipt imports. Known
storage/URL coverage and device-proof preservation tests still pass. The review
found a real gap: a new storage key not in the whitelist could previously pass
through silently. No unknown current key was found, but a synthetic new-key test
proved that failure mode.

A narrow source-pattern inventory was added for **48** storage/IndexedDB,
key-declaration, env-reference and URL-bearing files. Config creation compares
the complete inventory, and each transformed source is checked again for HMR/
load-time drift. New/removed matching files, changed expected lines, new direct
storage calls, renamed known keys and new URL references fail closed pending
explicit review. The manifest is never automatically regenerated by a build.
This is a conservative pattern guard, not a replacement JavaScript security
sandbox or a redesign of the isolation layer. Harmless relevant-line edits may
also require review. Keep the reviewed manifest updated only after examining the
actual storage/env/URL changes; do not rebaseline blindly to make a build pass.

No cashier signing, key extractability, challenge, enrollment, cookie rules,
registration, session binding, replay checks or backend origins were changed.
The proof module still transforms only its IndexedDB database name. Unknown-key,
changed-pattern, removed/new-file and URL drift tests pass; raw source and device
security behavior were not bypassed to satisfy the guard.

## Final validation

| Check | Result |
| --- | --- |
| Targeted real receipt/retry and debt-triage tests | **12 PASS** |
| Isolation/config/bundle/drift tests | **10 PASS** |
| Backend safety tests | **24 PASS** |
| Admin Omar build | PASS |
| Mini Omar build | PASS |
| Admin full tsc --noEmit | FAIL, **19 remaining diagnostics**, down from 21 |
| Mini full tsc --noEmit | FAIL, **2 remaining diagnostics**, down from 3 |

Builds retain existing large-chunk warnings. Compiler options, application routes,
unused components, dependencies and lockfiles were not changed. Remaining
full-check diagnostics are saved in ignored `.local/omar/blocker-triage/`.

Reproduce from the Omar workspace root:

```sh
node --test local/omar/blockers.test.cjs
node local/omar/frontend.mjs admin build
node local/omar/frontend.mjs mini build
node --test local/omar/frontend.test.mjs
.local/omar/venv/bin/python -m unittest discover -s backend/tests -p 'test_omar*.py' -q
node local/omar/frontend.mjs admin typecheck
node local/omar/frontend.mjs mini typecheck
```

## Files changed and next step

Application fixes: `admin/components/supply/ReceiveSupplyModal.tsx`,
`mini/components/Receipt.tsx`, `mini/src/utils/whatsappUtil.ts`.
Isolation/tests: `local/omar/frontend-config.mjs`, `frontend.test.mjs`,
`isolation-source-guard.mjs`, `frontend-source-inventory.json`, `blockers.test.cjs`.
Documentation: this report, `FRONTEND_ISOLATION.md`, `README.md`.
All other prior work was preserved. No Git commit/push/merge/deploy occurred.

Proceed only with a separately authorized Phase 3B using the prepared Omar
configurations and a fresh browser profile. Preserve device authentication and
use legitimate separately authorized cashier/device setup when needed; no such
account/device exists or was provisioned by this task. Remaining category-C debt
is visible and deferred, not a claim that every financial workflow is certified.
