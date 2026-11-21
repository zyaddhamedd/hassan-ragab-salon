"""add_is_cash_event_to_expenses

Phase 2.1 — Treasury preparation: extend the Expense model with a boolean
flag that distinguishes real cash outflows from non-cash accounting entries.

This migration:
  - Adds column `is_cash_event BOOLEAN NOT NULL DEFAULT TRUE` to `expenses`
  - Backfills all existing rows with TRUE (server_default handles it inline)
  - Creates no new tables, enums, or constraints
  - Drops nothing

Backward-compatible:
  - Default TRUE means all existing expenses remain treated as cash events.
  - No application code that reads from `expenses` breaks; the column is
    additive and optional from the caller's perspective.

Revision ID: c5f7a9b3e4d2
Revises:     b4e6f8a0c2d1
Create Date: 2026-02-28 21:13:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text

# ---------------------------------------------------------------------------
# Revision identifiers — DO NOT change these
# ---------------------------------------------------------------------------
revision = 'c5f7a9b3e4d2'
down_revision = 'b4e6f8a0c2d1'
branch_labels = None
depends_on = None


# ---------------------------------------------------------------------------
# Upgrade
# ---------------------------------------------------------------------------

def upgrade():
    conn = op.get_bind()

    # ── Step 1: Add the column (IF NOT EXISTS guard for idempotency) ─────────
    conn.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name  = 'expenses'
                  AND column_name = 'is_cash_event'
                  AND table_schema = 'public'
            ) THEN
                ALTER TABLE expenses
                    ADD COLUMN is_cash_event BOOLEAN NOT NULL DEFAULT TRUE;
            END IF;
        END$$;
    """))
    print("  [1/2] Column 'is_cash_event' added to 'expenses' (default TRUE)")

    # ── Step 2: Verify ───────────────────────────────────────────────────────
    result = conn.execute(text("""
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_name  = 'expenses'
          AND column_name = 'is_cash_event'
          AND table_schema = 'public'
    """)).scalar()

    if result == 1:
        print("  [2/2] ✅ Verification passed: column exists in public.expenses")
    else:
        raise RuntimeError("Migration verification failed: 'is_cash_event' not found after ALTER")

    print("  ✅ upgrade complete: expenses.is_cash_event is ready")


# ---------------------------------------------------------------------------
# Downgrade — fully reversible
# ---------------------------------------------------------------------------

def downgrade():
    conn = op.get_bind()

    conn.execute(text("""
        ALTER TABLE expenses
            DROP COLUMN IF EXISTS is_cash_event;
    """))
    print("  ✅ downgrade complete: 'is_cash_event' removed from expenses")
