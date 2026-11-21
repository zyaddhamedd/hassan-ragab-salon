"""add_cash_in_cash_out_previous_day_to_business_days

Extends the business_days table with three new columns:

  cash_in         NUMERIC(12,2) NOT NULL DEFAULT 0
      Immutable ledger snapshot of total CASH revenue collected during the
      business day. Populated at close time; zero for OPEN days.

  cash_out        NUMERIC(12,2) NOT NULL DEFAULT 0
      Immutable ledger snapshot of total cash that physically left the
      register during the business day. Populated at close time; zero for
      OPEN days.

  previous_day_id INTEGER NULL → FK → business_days.id ON DELETE SET NULL
      Self-referential chain link to the immediately preceding BusinessDay
      for the same branch. NULL on the very first day a branch ever opens.
      Together with the unique-per-chain constraint this forms a singly-
      linked auditable list of business days per branch.

This migration:
  - Adds the three columns to business_days with safe defaults so that all
    existing rows receive valid non-null values immediately.
  - Creates a FK index on previous_day_id for efficient backward traversal.
  - Does NOT modify any existing column, index, trigger, or constraint.
  - Does NOT touch any other table.

Production-safe:
  - Fully additive — no data is moved or deleted.
  - Fully reversible — downgrade drops all three columns cleanly.
  - Existing OPEN/CLOSED status logic is unaffected (columns are optional
    at write time; defaults prevent constraint violations on old rows).

Revision ID: e1f3a5c7b9d2
Revises:     5989ee3d5a82
Create Date: 2026-03-03 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text

# ---------------------------------------------------------------------------
# Revision identifiers — DO NOT change these
# ---------------------------------------------------------------------------
revision      = 'e1f3a5c7b9d2'
down_revision = '5989ee3d5a82'
branch_labels = None
depends_on    = None


# ---------------------------------------------------------------------------
# upgrade
# ---------------------------------------------------------------------------

def upgrade():
    conn = op.get_bind()

    # ── 1. cash_in ──────────────────────────────────────────────────────────
    # Check before adding so re-running the migration on a partially-applied
    # state does not raise a duplicate-column error.
    has_cash_in = conn.execute(text("""
        SELECT 1
        FROM   information_schema.columns
        WHERE  table_name   = 'business_days'
          AND  column_name  = 'cash_in'
    """)).fetchone()

    if not has_cash_in:
        op.add_column(
            'business_days',
            sa.Column(
                'cash_in',
                sa.Numeric(precision=12, scale=2),
                nullable=False,
                server_default='0'
            )
        )

    # ── 2. cash_out ─────────────────────────────────────────────────────────
    has_cash_out = conn.execute(text("""
        SELECT 1
        FROM   information_schema.columns
        WHERE  table_name   = 'business_days'
          AND  column_name  = 'cash_out'
    """)).fetchone()

    if not has_cash_out:
        op.add_column(
            'business_days',
            sa.Column(
                'cash_out',
                sa.Numeric(precision=12, scale=2),
                nullable=False,
                server_default='0'
            )
        )

    # ── 3. previous_day_id ──────────────────────────────────────────────────
    has_prev = conn.execute(text("""
        SELECT 1
        FROM   information_schema.columns
        WHERE  table_name   = 'business_days'
          AND  column_name  = 'previous_day_id'
    """)).fetchone()

    if not has_prev:
        op.add_column(
            'business_days',
            sa.Column(
                'previous_day_id',
                sa.Integer(),
                nullable=True
            )
        )

        # Foreign key constraint: references the same table.
        # ON DELETE SET NULL — if a parent row is deleted the chain is
        # severed gracefully rather than cascading deletes.
        op.create_foreign_key(
            'fk_business_days_previous_day_id',   # constraint name
            'business_days',                       # source table
            'business_days',                       # referent table
            ['previous_day_id'],                   # local cols
            ['id'],                                # remote cols
            ondelete='SET NULL'
        )

        # Index to make ancestor-traversal queries efficient.
        op.create_index(
            'idx_business_days_previous_day_id',
            'business_days',
            ['previous_day_id'],
            unique=False
        )


# ---------------------------------------------------------------------------
# downgrade
# ---------------------------------------------------------------------------

def downgrade():
    conn = op.get_bind()

    # Drop in reverse order of creation (FK must go before column).

    # ── previous_day_id ─────────────────────────────────────────────────────
    has_prev = conn.execute(text("""
        SELECT 1
        FROM   information_schema.columns
        WHERE  table_name   = 'business_days'
          AND  column_name  = 'previous_day_id'
    """)).fetchone()

    if has_prev:
        # Drop index first (Postgres requires this before the FK in some cases)
        op.drop_index(
            'idx_business_days_previous_day_id',
            table_name='business_days'
        )
        op.drop_constraint(
            'fk_business_days_previous_day_id',
            'business_days',
            type_='foreignkey'
        )
        op.drop_column('business_days', 'previous_day_id')

    # ── cash_out ─────────────────────────────────────────────────────────────
    has_cash_out = conn.execute(text("""
        SELECT 1
        FROM   information_schema.columns
        WHERE  table_name   = 'business_days'
          AND  column_name  = 'cash_out'
    """)).fetchone()

    if has_cash_out:
        op.drop_column('business_days', 'cash_out')

    # ── cash_in ──────────────────────────────────────────────────────────────
    has_cash_in = conn.execute(text("""
        SELECT 1
        FROM   information_schema.columns
        WHERE  table_name   = 'business_days'
          AND  column_name  = 'cash_in'
    """)).fetchone()

    if has_cash_in:
        op.drop_column('business_days', 'cash_in')
