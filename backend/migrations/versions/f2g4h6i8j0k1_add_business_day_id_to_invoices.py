"""add_business_day_id_to_invoices

Adds business_day_id to the invoices table, anchoring each invoice record
to the operational BusinessDay during which it was confirmed (PAID).

This migration:
  - Adds column  business_day_id  INTEGER NULL  →  FK → business_days.id
                 ON DELETE RESTRICT
  - Creates FK constraint  fk_invoices_business_day_id
  - Creates index          idx_invoices_business_day_id  (non-unique)

This migration does NOT:
  - Backfill existing rows  (column is nullable; legacy PAID invoices remain
    with business_day_id = NULL and continue to function without change).
  - Modify invoice_number, paid_at, invoice_date, or any other column.
  - Add a cascade delete — ondelete='RESTRICT' prevents accidental removal
    of a BusinessDay that still owns invoices.
  - Touch any other table.

Production-safe:
  - Fully additive — no data is moved or deleted.
  - Fully reversible — downgrade drops index, FK, and column cleanly.
  - All existing read/write paths remain valid because the column is nullable.

Revision ID: f2g4h6i8j0k1
Revises:     e1f3a5c7b9d2
Create Date: 2026-03-03 00:01:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text

# ---------------------------------------------------------------------------
# Revision identifiers — DO NOT change these
# ---------------------------------------------------------------------------
revision      = 'f2g4h6i8j0k1'
down_revision = 'e1f3a5c7b9d2'
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
        WHERE  table_name  = 'invoices'
          AND  column_name = 'business_day_id'
    """)).fetchone()

    if has_col:
        return

    # 1. Add the nullable FK column.
    op.add_column(
        'invoices',
        sa.Column(
            'business_day_id',
            sa.Integer(),
            nullable=True
        )
    )

    # 2. FK constraint — RESTRICT prevents deleting a BusinessDay that still
    #    owns invoices.  Named explicitly for clean downgrade targeting.
    op.create_foreign_key(
        'fk_invoices_business_day_id',  # constraint name
        'invoices',                      # source table
        'business_days',                 # referent table
        ['business_day_id'],             # local cols
        ['id'],                          # remote cols
        ondelete='RESTRICT'
    )

    # 3. Index — supports efficient lookup of all invoices for a given day.
    op.create_index(
        'idx_invoices_business_day_id',
        'invoices',
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
        WHERE  table_name  = 'invoices'
          AND  column_name = 'business_day_id'
    """)).fetchone()

    if not has_col:
        return

    op.drop_index('idx_invoices_business_day_id', table_name='invoices')
    op.drop_constraint('fk_invoices_business_day_id', 'invoices', type_='foreignkey')
    op.drop_column('invoices', 'business_day_id')
