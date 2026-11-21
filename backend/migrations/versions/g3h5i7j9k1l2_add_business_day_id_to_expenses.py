"""add_business_day_id_to_expenses

Adds business_day_id to the expenses table, anchoring each expense record
to the operational BusinessDay during which it was recorded.

This migration:
  - Adds column  business_day_id  INTEGER NULL  →  FK → business_days.id
                 ON DELETE RESTRICT
  - Creates FK constraint  fk_expenses_business_day_id
  - Creates index          idx_expenses_business_day_id  (non-unique)

This migration does NOT:
  - Backfill existing rows  (column is nullable; legacy expense rows remain
    with business_day_id = NULL and continue to function without change).
  - Modify expense_date, is_cash_event, or any other existing column.
  - Add a cascade delete — ondelete='RESTRICT' prevents accidental removal
    of a BusinessDay that still has attributed expenses.
  - Touch any other table.

Production-safe:
  - Fully additive — no data is moved or deleted.
  - Fully reversible — downgrade drops index, FK, and column cleanly.
  - All existing read/write paths remain valid because the column is nullable.

Revision ID: g3h5i7j9k1l2
Revises:     f2g4h6i8j0k1
Create Date: 2026-03-03 00:02:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text

# ---------------------------------------------------------------------------
# Revision identifiers — DO NOT change these
# ---------------------------------------------------------------------------
revision      = 'g3h5i7j9k1l2'
down_revision = 'f2g4h6i8j0k1'
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
          AND  column_name = 'business_day_id'
    """)).fetchone()

    if has_col:
        return

    # 1. Add the nullable FK column.
    op.add_column(
        'expenses',
        sa.Column(
            'business_day_id',
            sa.Integer(),
            nullable=True
        )
    )

    # 2. FK constraint — RESTRICT prevents deleting a BusinessDay that still
    #    owns expense records.  Named explicitly for clean downgrade targeting.
    op.create_foreign_key(
        'fk_expenses_business_day_id',  # constraint name
        'expenses',                      # source table
        'business_days',                 # referent table
        ['business_day_id'],             # local cols
        ['id'],                          # remote cols
        ondelete='RESTRICT'
    )

    # 3. Index — supports efficient lookup of all expenses for a given day.
    op.create_index(
        'idx_expenses_business_day_id',
        'expenses',
        ['business_day_id'],
        unique=False
    )


# ---------------------------------------------------------------------------
# downgrade
# ---------------------------------------------------------------------------

def downgrade():
    conn = op.get_bind()

    has_col = conn.execute(text("""
        SELECT 1
        FROM   information_schema.columns
        WHERE  table_name  = 'expenses'
          AND  column_name = 'business_day_id'
    """)).fetchone()

    if not has_col:
        return

    op.drop_index('idx_expenses_business_day_id', table_name='expenses')
    op.drop_constraint('fk_expenses_business_day_id', 'expenses', type_='foreignkey')
    op.drop_column('expenses', 'business_day_id')
