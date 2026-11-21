# Hassan Ragab Salon — Future Feature Backlog (Phase 1+)

> **STATUS**: Documented for future implementation. **DO NOT IMPLEMENT IN PHASE 0.**

---

### HR-01: Manual Attendance Time
- **Description**: Enable the Cashier / Receptionist to manually choose the exact employee check-in and check-out time rather than relying strictly on the instant wall-clock timestamp.
- **Admin Visibility**: Admin dashboard, employee reports, shift histories, and attendance monitoring pages must immediately reflect the manual attendance time chosen by the Cashier.
- **Audit Requirement**: To preserve accounting and operational integrity, an immutable audit trail (`created_at`, `recorded_by_user_id`, `actual_recording_timestamp`, `client_ip`) must be retained in the backend database alongside the manually selected attendance time (`attended_at`).
- **Target Modules**:
  - `backend/app/models/` (`Attendance`, `StaffAttendanceRecord`, audit event log)
  - `backend/app/api/admin.py`, `backend/app/api/mini.py`, `backend/app/services/staff_attendance_service.py`
  - `mini/components/AttendanceScreen.tsx`
  - `admin/components/AdminAttendanceDashboard.tsx`, `admin/components/EmployeeReport.tsx`

---

### HR-02: Booking Notifications
- **Description**: Proactive appointment notifications delivered to the Cashier Terminal:
  1. **30 minutes prior** to scheduled appointment time.
  2. **Exactly at** appointment time.
- **Lifecycle & Edge Cases**:
  - Rescheduling/Updates: Update notification schedules automatically when an appointment is modified.
  - Cancellations: Clear pending notification triggers when an appointment is canceled or marked as no-show.
  - Duplicate Prevention: Implement idempotency keys per appointment per alert threshold (e.g., `notif:{appointment_id}:30m`, `notif:{appointment_id}:0m`) to prevent multiple visual or audio alerts.
- **Target Modules**:
  - `backend/app/services/notification_service.py`
  - `mini/components/AppointmentsScreen.tsx`, notification drawer / toast manager
  - Audio alert dispatch in Cashier Studio

---

### HR-03: Dual Visa Terminals
- **Description**: Split POS card processing to support two independent card terminals:
  - **Visa Terminal 1** (e.g. Bank 1 / Device A)
  - **Visa Terminal 2** (e.g. Bank 2 / Device B)
  alongside existing payment methods: **Cash** (`cash`) and **InstaPay** (`instapay`).
- **Financial & Operational Integrity**:
  - Support split payments across Cash, Visa 1, Visa 2, and InstaPay on a single ticket.
  - Daily drawer closing (`MiniTreasuryPage`, `AdminTreasuryPage`) must break down settlement totals per terminal.
  - Export reports (`FinanceReport`, Excel/PDF daily closing) must clearly isolate receipts and bank commissions for each terminal separately.
- **Target Modules**:
  - `backend/app/models/invoice.py` (`payment_method`, payment breakdown columns/tables)
  - `backend/app/services/financial_service.py`, `backend/app/services/payroll_settlement_service.py`
  - `mini/components/CashierScreen.tsx`, `mini/pages/MiniTreasuryPage.tsx`
  - `admin/components/AdminTreasuryPage.tsx`, `admin/components/reports/FinanceReport.tsx`

---

### HR-04: Deposit Lock
- **Description**: When a booking is secured with an upfront customer deposit (`appointment_deposit_transactions`), lock the reserved time slot and resource to prevent conflicting bookings.
- **Conflict Policy**:
  - Define explicit collision boundaries (Barber availability, Chair/Station availability, overlapping service durations).
  - Prevent double-booking across both Admin and Mini scheduling screens.
  - Retain current deposit settlement and refund behavior (`AppointmentDepositReceipt.tsx`, deduction on invoice finalization).
- **Target Modules**:
  - `backend/app/services/booking_deposit_service.py`
  - `backend/app/models/appointment.py`
  - `mini/components/AppointmentsScreen.tsx`, `admin/components/ServiceModal.tsx`

---

### HR-05: Target Tiers (Deferred)
- **Status**: **DEFERRED**.
- **Action**: Do not design or implement before explicit business clarification and commission rule sign-off from salon leadership.

---

### HR-06: Black & Gold Branding (Full Redesign)
- **Description**: Complete visual identity transformation into a luxury Black & Gold theme across Admin and Mini cashier interfaces.
- **Palette Direction**:
  - Deep Onyx / Obsidian background (`#0D0D0D`, `#121212`, `#181818`)
  - Warm Champagne & Imperial Gold accents (`#D4AF37`, `#F3E5AB`, `#C5A059`)
  - Crisp high-contrast typographic hierarchy maintaining effortless readability in salon lighting conditions.
- **Preservation Principle**: High usability; existing cashier flows, barcode scanning, quick-add modals, and thermal receipt printing layouts must retain their exact speed and operational ergonomics.
