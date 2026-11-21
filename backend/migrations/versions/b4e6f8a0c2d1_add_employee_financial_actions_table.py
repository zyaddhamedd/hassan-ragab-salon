"""add_employee_financial_actions_table

Stage 1: Additive architectural separation.

Creates the `employee_financial_actions` table to hold a clean, typed
ledger of per-employee payroll transactions (advances, deductions,
commission withdrawals, overtime, adjustments).

This migration:
  - Creates the new ENUM type `employee_action_type_enum`
  - Creates the new table `employee_financial_actions`
  - Creates all foreign key constraints and indexes

This migration does NOT:
  - Modify any existing table
  - Migrate any existing data from `expenses`
  - Touch any existing Enum types or constraints

Production-safe:
  - Fully idempotent (IF NOT EXISTS guards throughout)
  - Fully reversible (downgrade drops table then enum)

Revision ID: b4e6f8a0c2d1
Revises:     a3d5e7f9b1c2
Create Date: 2026-02-25 19:40:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text
from sqlalchemy.dialects import postgresql

# ---------------------------------------------------------------------------
# Revision identifiers — DO NOT change these
# ---------------------------------------------------------------------------
revision = 'b4e6f8a0c2d1'
down_revision = 'a3d5e7f9b1c2'
branch_labels = None
depends_on = None


# ---------------------------------------------------------------------------
# Upgrade
# ---------------------------------------------------------------------------

def upgrade():
    conn = op.get_bind()

    # ── Step 1: Create ENUM type ────────────────────────────────────────────
    # Use IF NOT EXISTS so re-running the migration on a partially applied DB
    # does not raise a "type already exists" error.
    conn.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_type WHERE typname = 'employee_action_type_enum'
            ) THEN
                CREATE TYPE employee_action_type_enum AS ENUM (
                    'ADVANCE',
                    'DEDUCTION',
                    'COMMISSION_WITHDRAWAL',
                    'OVERTIME',
                    'MANUAL_ADJUSTMENT'
                );
            END IF;
        END$$;
    """))
    print("  [1/4] ENUM type 'employee_action_type_enum' ready")

    # ── Step 2: Create table ────────────────────────────────────────────────
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS employee_financial_actions (
            id                  SERIAL          PRIMARY KEY,

            -- Core FKs
            employee_id         INTEGER         NOT NULL
                                REFERENCES employees(id) ON DELETE RESTRICT,
            branch_id           INTEGER         NOT NULL
                                REFERENCES branches(id) ON DELETE RESTRICT,

            -- Action classification
            action_type         employee_action_type_enum   NOT NULL,

            -- Financial fields
            amount              NUMERIC(12, 2)  NOT NULL,
            is_cash_event       BOOLEAN         NOT NULL DEFAULT FALSE,

            -- Optional context
            related_invoice_id  INTEGER
                                REFERENCES invoices(id) ON DELETE SET NULL,
            notes               TEXT,

            -- Audit
            created_by          INTEGER
                                REFERENCES users(id) ON DELETE SET NULL,
            created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

            -- Inline check constraint
            CONSTRAINT chk_efa_positive_amount CHECK (amount > 0)
        );
    """))
    print("  [2/4] Table 'employee_financial_actions' created")

    # ── Step 3: Create indexes ──────────────────────────────────────────────
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_efa_employee_id
        ON employee_financial_actions (employee_id);
    """))

    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_efa_branch_id
        ON employee_financial_actions (branch_id);
    """))

    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_efa_branch_created
        ON employee_financial_actions (branch_id, created_at);
    """))

    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_efa_employee_created
        ON employee_financial_actions (employee_id, created_at);
    """))
    print("  [3/4] All indexes created")

    # ── Step 4: Verify ───────────────────────────────────────────────────────
    result = conn.execute(text("""
        SELECT COUNT(*) FROM information_schema.tables
        WHERE table_name = 'employee_financial_actions'
          AND table_schema = 'public'
    """)).scalar()

    if result == 1:
        print("  [4/4] ✅ Verification passed: table exists in public schema")
    else:
        raise RuntimeError("Migration verification failed: table not found after creation")

    print("  ✅ upgrade complete: employee_financial_actions is ready")


# ---------------------------------------------------------------------------
# Downgrade — fully reversible
# ---------------------------------------------------------------------------

def downgrade():
    conn = op.get_bind()

    # ── Drop indexes first ───────────────────────────────────────────────────
    for idx in [
        'idx_efa_employee_created',
        'idx_efa_branch_created',
        'idx_efa_branch_id',
        'idx_efa_employee_id',
    ]:
        conn.execute(text(f"DROP INDEX IF EXISTS {idx}"))
    print("  [1/3] Indexes dropped")

    # ── Drop the table ───────────────────────────────────────────────────────
    conn.execute(text("DROP TABLE IF EXISTS employee_financial_actions"))
    print("  [2/3] Table 'employee_financial_actions' dropped")

    # ── Drop the ENUM type ───────────────────────────────────────────────────
    # Only drop after table is gone (type is referenced by the table column)
    conn.execute(text("DROP TYPE IF EXISTS employee_action_type_enum"))
    print("  [3/3] ENUM type 'employee_action_type_enum' dropped")

    print("  ✅ downgrade complete: employee_financial_actions fully removed")
