"""add_composite_performance_indexes

Adds 6 composite and partial indexes to address performance bottlenecks
identified in the concurrency audit (2026-03-21).

Indexes added:
  1. idx_invoices_branch_date_status    — Admin invoice list filters
  2. idx_invoices_customer_status       — Customer visit count aggregation
  3. idx_invoices_bday_status_pm        — Business day cash-in/out aggregation
  4. idx_invoices_paid_at               — Partial index for dashboard revenue queries
  5. idx_expenses_branch_date           — Expense aggregation by branch/date
  6. idx_attendance_branch_date         — Attendance hours query on dashboard

Production-safe:
  - Uses plain CREATE INDEX IF NOT EXISTS inside the Alembic transaction.
  - Every CREATE/DROP is guarded with IF NOT EXISTS / IF EXISTS.
  - Fully additive — no column, constraint, or data changes.
  - Fully reversible via downgrade().

NOTE: We intentionally do NOT use CONCURRENTLY here.
  CONCURRENTLY waits for all existing DB transactions (including idle
  Gunicorn pool connections) to finish before each table scan, which
  causes indefinite blocking against a live app. A plain CREATE INDEX
  takes an ACCESS SHARE lock only for the duration of the build
  (seconds on typical table sizes) and is the correct choice for a
  one-time migration run at deploy time.

Revision ID: h4i6j8k0l2m1
Revises:     g3h5i7j9k1l2
Create Date: 2026-03-21 04:40:00.000000
"""

from alembic import op
from sqlalchemy.sql import text

# ---------------------------------------------------------------------------
# Revision identifiers — DO NOT change these
# ---------------------------------------------------------------------------
revision      = 'h4i6j8k0l2m1'
down_revision = 'g3h5i7j9k1l2'
branch_labels = None
depends_on    = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _index_exists(conn, index_name: str) -> bool:
    """Return True if the named index already exists in the database."""
    row = conn.execute(
        text("SELECT 1 FROM pg_indexes WHERE indexname = :name"),
        {"name": index_name}
    ).fetchone()
    return row is not None


# ---------------------------------------------------------------------------
# upgrade
# ---------------------------------------------------------------------------

def upgrade():
    conn = op.get_bind()

    indexes = [
        # 1 — Admin invoices list: branch + date + status composite
        #     Covers GET /api/admin/invoices multi-filter queries
        (
            "idx_invoices_branch_date_status",
            "CREATE INDEX IF NOT EXISTS idx_invoices_branch_date_status "
            "ON invoices (branch_id, invoice_date, status)",
        ),

        # 2 — Customer visit counts: GROUP BY aggregation in mini/customers
        #     Eliminates sequential scan on customer_id + status filter
        (
            "idx_invoices_customer_status",
            "CREATE INDEX IF NOT EXISTS idx_invoices_customer_status "
            "ON invoices (customer_id, status)",
        ),

        # 3 — Business day cash-in/out summary aggregations
        #     Covers SUM(total_amount) WHERE business_day_id=X AND status=PAID AND payment_method=Y
        (
            "idx_invoices_bday_status_pm",
            "CREATE INDEX IF NOT EXISTS idx_invoices_bday_status_pm "
            "ON invoices (business_day_id, status, payment_method)",
        ),

        # 4 — Dashboard revenue queries: partial index — only PAID rows
        #     Smaller index footprint; covers paid_at range scans in financial_service
        (
            "idx_invoices_paid_at",
            "CREATE INDEX IF NOT EXISTS idx_invoices_paid_at "
            "ON invoices (paid_at) WHERE status = 'PAID'",
        ),

        # 5 — Expense aggregation by branch/date/cash-event
        #     Covers financial_service.calculate_expenses() and cash-out summaries
        (
            "idx_expenses_branch_date",
            "CREATE INDEX IF NOT EXISTS idx_expenses_branch_date "
            "ON expenses (branch_id, expense_date, is_cash_event)",
        ),

        # 6 — Attendance hours query on dashboard
        #     Covers Attendance filter by branch_id + date + employee_id
        (
            "idx_attendance_branch_date",
            "CREATE INDEX IF NOT EXISTS idx_attendance_branch_date "
            "ON attendances (branch_id, date, employee_id)",
        ),
    ]

    for index_name, sql in indexes:
        if _index_exists(conn, index_name):
            print(f"[SKIP]   Index '{index_name}' already exists.")
        else:
            print(f"[CREATE] Building index '{index_name}' ...")
            conn.execute(text(sql))
            print(f"[OK]     Index '{index_name}' created.")


# ---------------------------------------------------------------------------
# downgrade
# ---------------------------------------------------------------------------

def downgrade():
    conn = op.get_bind()

    indexes = [
        ("idx_attendance_branch_date",     "attendance"),
        ("idx_expenses_branch_date",        "expenses"),
        ("idx_invoices_paid_at",            "invoices"),
        ("idx_invoices_bday_status_pm",     "invoices"),
        ("idx_invoices_customer_status",    "invoices"),
        ("idx_invoices_branch_date_status", "invoices"),
    ]

    for index_name, table_name in indexes:
        if _index_exists(conn, index_name):
            print(f"[DROP] Dropping index '{index_name}' ...")
            conn.execute(text(f"DROP INDEX IF EXISTS {index_name}"))
            print(f"[OK]   Index '{index_name}' dropped.")
        else:
            print(f"[SKIP] Index '{index_name}' does not exist.")
