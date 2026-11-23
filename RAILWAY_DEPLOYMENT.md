# Hassan Ragab Salon — Railway Production Deployment Guide

This guide provides the complete, step-by-step procedure for deploying Hassan Ragab Salon on [Railway](https://railway.app) in an isolated, production-ready environment.

---

## 1. Target Production Architecture

The deployment consists of three services within a single Railway project:

```
[ Client Browser ]
        │
        ▼ (HTTPS)
┌────────────────────────────────────────────────────────┐
│  Service 1: Frontend (Node.js 22.x Reverse Proxy)      │
│  - Serves Admin at /admin/                             │
│  - Serves Mini Cashier at /mini/                       │
│  - Proxies /api/*, /uploads/*, /health to Backend      │
└────────────────────────────────────────────────────────┘
        │
        ▼ (Railway Private Network HTTP)
┌────────────────────────────────────────────────────────┐
│  Service 2: Backend (Flask + Gunicorn Python 3.12)     │
│  - Runs hr_production:app                              │
│  - Automated migration via railway_predeploy.sh        │
│  - Safe idempotent bootstrap (SUPER_ADMIN & Branch)    │
│  - Persistent Volume at /app/uploads                   │
└────────────────────────────────────────────────────────┘
        │
        ▼ (Internal PostgreSQL Connection)
┌────────────────────────────────────────────────────────┐
│  Service 3: Database (Railway PostgreSQL 16 Plugin)    │
│  - Fully isolated salon database                       │
└────────────────────────────────────────────────────────┘
```

---

## 2. Step-by-Step Deployment Instructions for Saeed

### Step A: Create Railway Project and Database
1. Log in to [Railway](https://railway.app).
2. Click **New Project** → **Provision PostgreSQL**.
3. Once provisioned, rename the database service to `hassan-ragab-db` (or keep default `Postgres`).

---

### Step B: Deploy the Backend Service
1. In the same Railway project, click **Create** → **GitHub Repo** → Select `hassan-ragab-salon`.
2. Rename the created service to `hassan-ragab-backend`.
3. Go to **Settings**:
   - **Root Directory**: `backend` *(CRITICAL: do not leave empty)*.
   - The pre-deploy and start commands are automatically picked up from `backend/railway.json` (`sh railway_predeploy.sh` and `sh railway_start.sh`).
4. Go to **Variables** and add:
   ```env
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   SECRET_KEY=<generate with openssl rand -hex 32>
   JWT_SECRET_KEY=<generate with openssl rand -hex 32>
   FLASK_ENV=production
   INITIAL_ADMIN_EMAIL=admin@hassanragab.com
   INITIAL_ADMIN_PASSWORD=<choose a strong password>
   INITIAL_ADMIN_NAME=Hassan Ragab Administrator
   INITIAL_BRANCH_NAME=Hassan Ragab Salon
   INITIAL_BRANCH_CITY=Giza
   MINI_LEGACY_DEVICE_COMPATIBILITY_ENABLED=true
   MINI_PROOF_ENROLLMENT_REQUIRED=true
   UPLOAD_FOLDER=/app/uploads
   ```
   *(Note: You will also set `FRONTEND_URL` once the frontend domain is generated in Step C)*.
5. Go to **Volumes** (optional, recommended for media files):
   - Click **Add Volume**.
   - Mount path: `/app/uploads`.
6. Go to **Settings** → **Networking**:
   - Ensure the private domain is enabled (e.g. `hassan-ragab-backend.railway.internal`).

---

### Step C: Deploy the Frontend Service
1. In the same project, click **Create** → **GitHub Repo** → Select `hassan-ragab-salon`.
2. Rename this service to `hassan-ragab-frontend`.
3. Go to **Settings**:
   - **Root Directory**: `/` *(monorepo root)*.
   - Build and start commands are automatically picked up from `railway.json` (`npm run build` and `npm start`).
4. Go to **Variables** and add:
   ```env
   NODE_ENV=production
   BACKEND_URL=http://${{hassan-ragab-backend.RAILWAY_PRIVATE_DOMAIN}}:${{hassan-ragab-backend.PORT}}
   ```
5. Go to **Settings** → **Networking**:
   - Click **Generate Domain** (e.g., `https://hassan-ragab-frontend.up.railway.app` or configure custom domain).

---

### Step D: Link Frontend URL to Backend
1. Copy the generated frontend domain (e.g., `https://hassan-ragab-frontend.up.railway.app`).
2. Go back to `hassan-ragab-backend` → **Variables**:
   - Add / Update:
     ```env
     FRONTEND_URL=https://hassan-ragab-frontend.up.railway.app
     ```
3. Railway will redeploy the backend with the updated CORS and trusted device origins.

---

## 3. Git Staging & Pre-Deployment Checklist

Before pushing commits to trigger Railway builds:

- [ ] Ensure the booking alert component and audio files are tracked in Git:
  ```bash
  git add mini/components/BookingAlertsNotification.tsx
  git add mini/public/audio/30min.mp3 mini/public/audio/elgom.mp3
  git add backend/tests/test_deposit_lock.py
  ```
- [ ] Verify that no secrets or private tokens exist in tracked files.
- [ ] Confirm that `railway.json` and `backend/railway.json` are committed.

---

## 4. Post-Deployment Smoke-Test Checklist

Perform these tests immediately after the services report **Active**:

### 1. Healthcheck & Routing
- [ ] Open `https://<frontend-domain>/` → Must redirect automatically to `https://<frontend-domain>/admin/`.
- [ ] Open `https://<frontend-domain>/health` → Must return `{"status": "ok"}` with HTTP 200.

### 2. Admin Authentication
- [ ] Navigate to `/admin/`.
- [ ] Log in using the `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`.
- [ ] Verify that the dashboard loads with zero console errors.
- [ ] Confirm that the initial branch "Hassan Ragab Salon" is visible.

### 3. Mini Cashier Onboarding
- [ ] Navigate to `/mini/`.
- [ ] Enter cashier credentials / device pairing.
- [ ] Verify that the cashier screen loads and the business day can be managed.

### 4. Appointment Booking & Audio Alerts
- [ ] Create a new test appointment for today in Mini.
- [ ] Verify that the booking modal customer search, date, and service selection function smoothly.
- [ ] Confirm that the notification banner appears at the designated time and plays the audio alert (`elgom.mp3` or `30min.mp3`).
- [ ] Test mute/unmute toggle on the alert banner and ensure audio stops.

### 5. Deposit Lock Verification
- [ ] Create an appointment with a paid deposit.
- [ ] Attempt to book another appointment at the exact same branch, date, and time.
- [ ] Verify that the system blocks the duplicate slot and displays:
  `"هذا الموعد محجوز ومؤكد بعربون. يرجى اختيار موعد آخر."`

### 6. Invoicing & Receipt
- [ ] Complete a test transaction in Mini and print receipt.
- [ ] Confirm that `window.print()` triggers without errors and invoice shows as PAID.

---

## 5. Rollback and Database Backup Procedure

### Automated Railway Database Backups
Railway provides automated daily backups of managed PostgreSQL databases:
1. In the Railway dashboard, click `hassan-ragab-db` → **Backups**.
2. To restore to a prior snapshot, select the snapshot and click **Restore**.

### Manual On-Demand Backup
To create an explicit backup before any major update:
```bash
# Using Railway CLI:
railway connect hassan-ragab-db
# Or dump directly:
pg_dump -Fc --no-owner --no-privileges "$DATABASE_URL" > hassan_ragab_backup_$(date +%Y%m%d_%H%M%S).dump
```

### Rollback Strategy
1. **Frontend / Backend Code Rollback:**
   - In Railway, click the service → **Deployments**.
   - Find the previous passing deployment.
   - Click the three dots `...` → **Rollback to this deployment**.
2. **Database Rollback:**
   - If an applied migration needs rollback, run:
     ```bash
     flask --app hr_production db downgrade -1
     ```
   - Or restore the database snapshot from the Backups tab.
