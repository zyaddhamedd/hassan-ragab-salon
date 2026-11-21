# FICTIONAL DEVELOPMENT DATA — NOT CLIENT DATA

Omar Fahim Salon — Phase 3C.1A, 27 October 2026.

All staff names, classifications, commissions and prices below are fictional
local QA fixtures. They are not confirmed Omar Fahim employees, payroll policies,
official services or client pricing. No contacts, passwords or tax identifiers
are included.

**GO for the separately authorized first invoice QA on the current working Mini
session. No customer, invoice, invoice draft, payment or financial transaction was
created during this phase.** All three development servers remain running.

## Verified local environment and actual starting state

Workspace `<OMAR_SOURCE_ROOT>`, branch
`feat/omar-fahim-setup`, HEAD `adf9fe6b11034bd1848681e005be6ac920ddc1f0`.
Private runtime validation, exact PostgreSQL cluster path/PID/start time,
SCRAM HBA, database/current/session role, owner and migration head were checked
before writes. Only `127.0.0.1:55432/omar_fahim_local`, role `omar_fahim_local`,
was accessed. All database inspection connections were read-only. All mutations
used canonical application APIs. No application factory, bootstrap or migration
was invoked by the setup/verification tools.

Owned launcher PIDs/process groups and loopback listeners matched the existing
Omar backend 5104, Admin 3100 and Mini 5176. They were not restarted or stopped.
No original Nady workspace, 5432/5433 database or production service was accessed.

The stated empty-catalog starting state had changed through manual testing:

- Employee id 2 `barber one`, active BARBER on operating branch id 2.
- Category id 1 `lolo`, BARBER_ONLY.
- Service id 1 `شعر`, EGP 200, zero commission.
- Business day id 1 already OPEN, branch 2, opened by cashier employee 1,
  opening balance 0.00.
- Attendance id 1 already PRESENT for employee 2 on that business day.
- One existing employee transfer and two enrollment/device rows.
- Existing dedicated uploads; these were preserved byte-for-byte.
- Customers, invoices, payments and all financial transaction tables: zero.

The reviewed generic local test records were reused instead of duplicating staff,
services or days. Their IDs/history were preserved. No existing record was
deleted. This is why fewer new records were created than the requested final
catalog size.

## Exact staff records

All three belong only to **branch id 2 — Omar Fahim Salon / Giza**, are active,
status ACTIVE and not deleted. Existing cashier employee id 1/account is unchanged.

| Employee id | Fictional name | Canonical type | QA description | Action | Availability |
| --- | --- | --- | --- | --- | --- |
| 2 | أحمد محمود | BARBER | Senior Barber, descriptive only | Renamed existing `barber one` through Admin PUT | PRESENT; original attendance retained |
| 3 | يوسف إبراهيم | BARBER | Barber | Created through Admin POST | Active, ABSENT; reserve barber |
| 4 | كريم حسن | ASSISTANT | Assistant | Created through Admin POST | PRESENT; checked in through actual Mini UI |

There is no SENIOR_BARBER enum; no unsupported role or extra field was added.
No login accounts were created for these staff. Employee base salary and
commission wallet remain zero, using existing defaults; no payroll/financial
policy or wage was invented. No new contact details, photographs or documents
were supplied. Existing uploads were preserved.

Employee commissions are not stored as a new per-employee rule. This application
snapshots each service's barber/assistant commission fields onto invoice items
when a service is added; existing commission behavior remains unchanged.

## Exact service catalog

| Category id / name | Service id | Fictional service | QA price (EGP) | Barber % | Assistant % | Action |
| --- | ---: | --- | ---: | ---: | ---: | --- |
| 1 / الشعر (HAIR) | 1 | قص شعر رجالي | 250 | 20 | 0 | Updated existing `شعر` service (formerly 200) |
| 1 / الشعر (HAIR) | 2 | تدريج فيد | 300 | 20 | 0 | Created |
| 1 / الشعر (HAIR) | 3 | غسيل وتصفيف شعر | 120 | 20 | 0 | Created |
| 2 / الدقن (BEARD) | 4 | تحديد دقن | 120 | 20 | 0 | Created |
| 2 / الدقن (BEARD) | 5 | حلاقة دقن كاملة | 180 | 20 | 0 | Created |
| 3 / العناية (CARE) | 6 | تنظيف بشرة | 400 | 10 | 10 | Created |

Category 1 was renamed from `lolo`; categories 2 and 3 were created. All categories
and services are active. HAIR and BEARD use canonical BARBER_ONLY. CARE uses
BARBER_AND_ASSISTANT. The supplied total commission input was 20%; existing
`Service.derive_commissions` assigns all 20% to the barber for BARBER_ONLY and
splits 20% equally into 10%/10% for BARBER_AND_ASSISTANT. No independent formula,
new commission behavior or official client policy was introduced.

Only CARE returns `has_assistant=true` through the existing Mini service contract.
No unsupported duration, role, salary rule or other extra field was supplied.

The canonical service-create endpoint automatically links a new service to every
active branch, including the existing internal warehouse. Five new services
therefore created ten BranchService links; with the two existing links, there
are twelve total (six per active branch). This is existing source behavior, not
a new branch or an operational reclassification of Main Warehouse. Warehouse
and branch rows remained unchanged. Mini's service endpoint reads the global
active catalog; no custom branch propagation or filtering was invented.

## Canonical workflow used and reviewed

- Existing Super Admin authentication, credentials kept in memory only.
- `PUT /api/admin/employees/2`: only full_name changed.
- `POST /api/admin/employees`: Yusuf and Karim, supported types, branch 2,
  is_active=true and base_salary=0.
- `PUT /api/admin/service-categories/1`: only the name changed.
- `POST /api/admin/service-categories`: BEARD and CARE with supported modes.
- `PUT /api/admin/services/1`: desired name, price 250 and canonical commission
  input 20; no prior invoice existed to be affected.
- `POST /api/admin/services`: five remaining services, category and commission
  input 20. Existing active-branch auto-links occurred as described above.
- Canonical authenticated Admin GET employees/services verified final values and
  commission fields. Update requests returned 200; create requests returned 201.

The old isolated automation browser device returned 403
DEVICE_FINALIZATION_REQUIRED, reflecting a pre-existing pending-finalization
state. It was not reset, repaired, enrolled again or bypassed. The already
signed-in user-owned Omar Mini tab was available and used through browser UI.
Its legitimate existing device proof/session continued to enforce security.
No new device, enrollment, account or credential was created.

In that current session:

1. Read-only reload fetched the prepared catalog and staff through existing Mini
   APIs. The POS showed 3 HAIR, 2 BEARD and 1 CARE services.
2. Attendance screen showed Ahmad PRESENT, Yusuf ABSENT, Karim ABSENT.
3. Only Karim's **تسجيل حضور** button was clicked. This invoked canonical
   `POST /api/mini/attendance/check-in`, validating role, branch, current open
   day and duplicate attendance through the existing service.
4. Attendance screen confirmed Karim PRESENT and one assistant present.
5. Only category-navigation buttons were used to read all six service prices;
   no individual service, customer, invoice or payment button was clicked.
6. Read-only Treasury screen fetched `/api/mini/business-day/summary`, showed the
   existing open day and zero balances/collections. No opening/closing action was
   performed. The tab was returned to the empty POS category screen and left open.

## Business day, attendance and invoice readiness

Business day **id 1 remains OPEN**, with opening balance **0.00**, branch 2,
opened_by cashier employee 1. Its entire row/xmin fingerprint is unchanged.
No business day was opened or closed by this phase. No cashier shift or treasury
transaction was created.

Ahmad's existing attendance **id 1** is unchanged, including row version and
check-in details. New attendance **id 2** checks Karim (employee 4) into the same
day and branch with status PRESENT. No check-out was recorded. The original
employee transfer remains unchanged.

Ahmad is available for all six services; Karim is available where the existing
assistant workflow is used. Yusuf remains active but is intentionally not
selectable as a present barber until a legitimate attendance check-in. Attendance
and availability gates were not bypassed.

The reviewed `POST /api/mini/invoice/draft` uses cashier/branch IDs from the JWT,
not caller-selected identity. `InvoiceEngine.create_draft_invoice` writes a real
invoice plus audit event, so it was never invoked. The POS's displayed `# DRAFT`
is only the empty UI state; SQL confirms **zero persisted invoices and audit
events**. The existing UI creates a draft lazily only when a service is added.
Invoice confirmation requires an OPEN BusinessDay; that prerequisite already
exists. No invoice calculations were changed or tested by creating an invoice.

**GO for first invoice QA in the working current Mini session**, with Ahmad
selected through the normal UI and Karim available for the supported assistant
case. The next phase must explicitly authorize any customer/invoice/payment
operation. Automated testing through the old private profile would first need
its official finalization to be resolved separately; that is not needed for the
current working manual session and was not altered here.

## Database before/after inventory

| Table / inventory | Actual before | Final |
| --- | ---: | ---: |
| users | 2 | 2 |
| employees (cashier included) | 2 | 4 |
| BARBER / ASSISTANT / CASHIER | 1 / 0 / 1 | 2 / 1 / 1 |
| service_categories | 1 | 3 |
| services | 1 | 6 |
| branch_services | 2 | 12 |
| branches (operating / internal) | 2 (1 / 1) | 2 (1 / 1) |
| business_days | 1 OPEN | 1 OPEN, unchanged |
| attendances | 1 | 2 |
| employee_transfers | 1 | 1, unchanged |
| enrollment rows / registered-device rows | 2 / 2 | 2 / 2 |
| proof challenges | 8 | 8 |
| active proof replay rows | 11 | 14 at final snapshot |
| customers / invoices / invoice items / payments / audit events | 0 | 0 |
| treasury, expenses, stock, payroll, deposits, balances and other operational tables | 0 | 0 |

Changed tables: employees, service_categories, services, branch_services,
attendances, branch_registered_devices (normal security timestamps), and
mini_device_proof_replays (normal signed-request insert/expiry cleanup).
All other table hashes stayed identical, including users, branches/warehouse,
business day, employee transfer and enrollments. No unexpected writes.

Sequences changed only for the authorized new rows: employees 2→4,
service_categories 1→3, services 1→6, branch_services 2→12, attendances 1→2;
proof replay sequence 150→164 reflects legitimate signed read/check-in requests.

Schema remains 59 application tables plus alembic_version, head
`zr_payroll_settlement_ledger`. Full row/xmin/sequence fingerprints:

- Before: `8df08899a0b882dbaf81aec7ff543fcfa10d9c87a50887fe6cd6dd6bde944abe`
- Final: `e6057617bbaea6e9186535dd8687a6cf1b30e3f4911e52c66f68d7c75d0855f2`

Private ignored evidence: `.local/omar/qa-3c1a/` contains before/after hashes,
created/reused IDs, sanitized Admin readback, verification and cropped proof of
Karim's attendance. Existing uploads' paths/content hashes were compared and
remained unchanged. No passwords, tokens or real contact details are in this
tracked document. Failed old-profile login attempts are retained privately as
security evidence; no security guard was weakened.

## Files and completion

Only repository file added in this phase:
`local/omar/FICTIONAL_QA_DATASET.md` (this document).

Temporary execution/verification helpers are `/tmp/omar-qa-3c1a.py` and
`/tmp/omar-qa-3c1a-mini.cjs`. They contain no actual credentials, do not import the
Flask app, and perform database inspection read-only. Catalog writes went through
canonical Admin APIs; the successful attendance write went through actual Mini
UI, not SQL. The attempted automated Mini helper stopped at the device guard
before any attendance or other operational write.

Setup is deliberately one-shot: existing phase markers and exact initial-state
checks refuse duplicate execution. Do not delete evidence to rerun it or reset
existing records. No source code, feature, commission calculation, payroll,
attendance logic, device implementation, branding, PWA or branch management was
changed. No migration, bootstrap, Nady access, commit, push, merge or deploy.
Existing uncommitted work was preserved. Servers are running; Phase 3C.1A stops
here without creating the first invoice.
