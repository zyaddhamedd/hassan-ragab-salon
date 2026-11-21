"""add_entered_amount_to_invoice_payments

Adds entered_amount to invoice_payments so the raw cashier-entered tender is
preserved alongside the existing trimmed revenue allocation amount.

This migration:
  - Adds column entered_amount NUMERIC(10,2) NULL to invoice_payments
  - Backfills legacy rows with entered_amount = amount
  - Leaves the column nullable for maximum production safety

The existing amount column remains unchanged and continues to represent the
trimmed / net revenue allocation used by treasury and revenue reporting.

Revision ID: p3q5r7s9t1u2
Revises: 780e5ce2c51c
Create Date: 2026-06-28 22:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text


revision = "p3q5r7s9t1u2"
down_revision = "780e5ce2c51c"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    has_col = conn.execute(text("""
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'invoice_payments'
          AND column_name = 'entered_amount'
    """)).fetchone()

    if not has_col:
        op.add_column(
            'invoice_payments',
            sa.Column('entered_amount', sa.Numeric(precision=10, scale=2), nullable=True)
        )

    conn.execute(text("""
        UPDATE invoice_payments
        SET entered_amount = amount
        WHERE entered_amount IS NULL
    """))


def downgrade():
    conn = op.get_bind()

    has_col = conn.execute(text("""
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'invoice_payments'
          AND column_name = 'entered_amount'
    """)).fetchone()

    if has_col:
        op.drop_column('invoice_payments', 'entered_amount')
