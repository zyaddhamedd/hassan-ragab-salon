"""add_is_business_expense_to_expenses

Adds is_business_expense boolean flag to the expenses table to separate
cash movements (like TIP payouts) from actual business expenses in reporting.

This migration:
  - Adds column  is_business_expense  BOOLEAN DEFAULT TRUE
  - All existing expenses default to True (business expenses)
  - TIP_PAYOUT expenses are manually set to False by invoice_engine.py
  - Allows admin profit to exclude TIP while treasury cash_out includes it

This migration does NOT:
  - Backfill any existing TIP records  (they remain True; only new TIP_PAYOUT
    expenses created by invoice_engine will have is_business_expense=False)
  - Modify is_cash_event or any other existing column.
  - Touch any other table.
  - Change API behavior — mini treasury is unchanged (uses is_cash_event)

Production-safe:
  - Fully additive — no data is moved or deleted
  - Fully reversible — downgrade drops column cleanly
  - All existing read/write paths remain valid due to DEFAULT TRUE
  - Query filters added to admin.py and financial_service.py

Revision ID: k8l0m2n4o6p5
Revises:     j6k8l0m2n4o3
Create Date: 2026-03-04 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text

# ---------------------------------------------------------------------------
# Revision identifiers — DO NOT change these
# ---------------------------------------------------------------------------
revision      = 'k8l0m2n4o6p5'
down_revision = 'j6k8l0m2n4o3'
branch_labels = None
depends_on    = None


# ---------------------------------------------------------------------------
# upgrade
# ---------------------------------------------------------------------------

def upgrade():
    conn = op.get_bind()

    # Guard: skip if the column already exists (idempotent re-run safety).
    has_col = conn.execute(text("""
        SELECT 1
        FROM   information_schema.columns
        WHERE  table_name  = 'expenses'
          AND  column_name = 'is_business_expense'
    """)).fetchone()

    if has_col:
        return

    # Add the boolean flag column with default True.
    # This ensures all existing expenses are treated as business expenses
    # unless explicitly marked otherwise by application logic.
    op.add_column(
        'expenses',
        sa.Column(
            'is_business_expense',
            sa.Boolean(),
            nullable=False,
            server_default='true'
        )
    )


# ---------------------------------------------------------------------------
# downgrade
# ---------------------------------------------------------------------------

def downgrade():
    # Remove the column — instantly reverts to no expense filtering
    # ability. Admin queries will then return all non-payroll expenses
    # (including TIP if any exist).
    op.drop_column('expenses', 'is_business_expense')
