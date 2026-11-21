# Hassan Ragab Salon (صالون حسن رجب) — Standalone Architecture

Independent salon operating system for Hassan Ragab Salon, prepared in Phase 0 as a fully isolated standalone system.

## 1. System Identity
- **Application Name**: Hassan Ragab Salon
- **Arabic Name**: صالون حسن رجب
- **Theme Direction**: Premium Black & Gold
- **Storage Namespace**: `hr:`
- **Device & Session Scope**:
  - `hr_session`
  - `hr_mini_device_credential`
  - `hr_mini_enrollment_proof`
  - `hr_staff_refresh`
  - `hr_staff_csrf`
  - Token audience: `hr-staff`

## 2. Dedicated Local Service Ports & Zero-Collision Architecture
This project is configured with dedicated ports to run concurrently alongside Omar Fahim and Nady without conflict:
- **Backend API**: `5204` (Omar: 5104)
- **Admin Dashboard**: `3200` (Omar: 3100)
- **Mini Cashier**: `5276` (Omar: 5176)
- **Local PostgreSQL**: `55433` (Omar: 55432)
- **Local Database**: `hassan_ragab_local`
- **Upload Root**: `.local/hassan/uploads`

## 3. Database Isolation Policy
- **No Shared Databases**: This project never connects to, alters, or migrates Omar Fahim (`omar_fahim_local`) or Nady El Regal databases.
- **Local Cluster**: Dedicated PostgreSQL cluster path:
  `~/Library/Application Support/Hassan Ragab Salon/postgresql16/data`
- **Guarded Migrations**: `backend/hr_migrate.py` enforces target identity and checks that the database is completely empty before schema creation.
- **Initial Setup**: `backend/hr_initialize.py` sets up the primary operating branch (`Hassan Ragab Salon`) and initial administrator credentials.

## 4. Build & Development Commands
- **Install & Build Both Frontends**:
  ```bash
  npm run build
  ```
- **Admin Build**:
  ```bash
  cd admin && npm run build
  ```
- **Mini Cashier Build**:
  ```bash
  cd mini && npm run build
  ```
- **Run Backend Unit Tests**:
  ```bash
  .local/hassan/venv/bin/python -m unittest discover -s backend/tests
  ```
- **Offline Backend Preflight**:
  ```bash
  .local/hassan/venv/bin/python backend/hr_local.py --config .local/hassan/backend.json
  ```
- **Serve Production Frontend**:
  ```bash
  PORT=3200 node frontend/server.mjs
  ```

## 5. Future Backlog (Phase 1+)
See [docs/FUTURE_BACKLOG.md](docs/FUTURE_BACKLOG.md) for requirements:
- **HR-01**: Manual Attendance Time
- **HR-02**: Booking Notifications (30min & 0min)
- **HR-03**: Dual Visa Terminals (Visa 1 & Visa 2)
- **HR-04**: Deposit Lock
- **HR-05**: Target Tiers (Deferred)
- **HR-06**: Black & Gold Visual Identity
