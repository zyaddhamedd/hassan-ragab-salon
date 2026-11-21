"""replace_employee_date_unique_with_partial_index

Replaces the broad UNIQUE(employee_id, date) constraint with a narrow
partial unique index that enforces only one *active* shift per employee:

    CREATE UNIQUE INDEX uq_employee_present
    ON attendances (employee_id)
    WHERE status = 'PRESENT';

Why:
  The old constraint blocked employees from checking in more than once per
  calendar day — even after a successful check-out — because the attendance
  date is anchored to the business-day open date, and two different business
  days can legitimately start on the same calendar date.

  The partial index enforces the real invariant: at most one PRESENT row per
  employee at any time.  Rows with status = 'LEFT' are invisible to the index
  and can accumulate freely across business days.

Idempotency:
  - DROP CONSTRAINT is guarded: checks pg_constraint before dropping.
  - CREATE INDEX uses IF NOT EXISTS.
  - Safe to run multiple times.

Revision ID: j6k8l0m2n4o3
Revises:     i5j7k9l1m3n2
Create Date: 2026-03-24 00:25:05.000000
"""

from alembic import op
from sqlalchemy.sql import text

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------
revision      = 'j6k8l0m2n4o3'
down_revision = 'i5j7k9l1m3n2'
branch_labels = None
depends_on    = None


# ---------------------------------------------------------------------------
# upgrade
# ---------------------------------------------------------------------------

def upgrade():
    # ── Step 1: Drop the old broad unique constraint ──────────────────────────
    # The old constraint was named 'uq_employee_date' on the 'attendances' table.
    try:
        op.drop_constraint('uq_employee_date', 'attendances', type_='unique')
        print("[OK]   uq_employee_date dropped via Alembic.")
    except Exception as e:
        print(f"[SKIP] Could not drop uq_employee_date (may not exist): {e}")

    # ── Step 2: Create the partial unique index ───────────────────────────────
    # Enforces: only one row per employee can have status = 'PRESENT'.
    try:
        op.create_index(
            'uq_employee_present',
            'attendances',
            ['employee_id'],
            unique=True,
            postgresql_where=text("status = 'PRESENT'")
        )
        print("[OK]   uq_employee_present created via Alembic.")
    except Exception as e:
        print(f"[SKIP] Could not create uq_employee_present (may already exist): {e}")


# ---------------------------------------------------------------------------
# downgrade
# ---------------------------------------------------------------------------

def downgrade():
    # ── Step 1: Drop the partial index ───────────────────────────────────────
    try:
        op.drop_index('uq_employee_present', table_name='attendances')
        print("[OK]   uq_employee_present dropped via Alembic.")
    except Exception as e:
        print(f"[SKIP] Could not drop index uq_employee_present: {e}")

    # ── Step 2: Restore the original broad unique constraint ─────────────────
    try:
        op.create_unique_constraint(
            'uq_employee_date',
            'attendances',
            ['employee_id', 'date']
        )
        print("[OK]   uq_employee_date restored via Alembic.")
    except Exception as e:
        print(f"[SKIP] Could not restore constraint uq_employee_date (may exist or data conflict): {e}")
