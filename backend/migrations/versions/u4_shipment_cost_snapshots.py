"""add unit cost snapshot to stock shipment items

Stores the product cost at shipment creation time so shipment history and
details can show stable, auditable cost totals even if the product cost
changes later.

For existing shipment rows, this migration backfills the snapshot from the
current product cost once, so older data remains stable after deployment.

Revision ID: u4_shipment_cost_snapshots
Revises: p3q5r7s9t1u2
Create Date: 2026-06-29 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text


revision = 'u4_shipment_cost_snapshots'
down_revision = 'p3q5r7s9t1u2'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    has_col = conn.execute(text("""
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'stock_shipment_items'
          AND column_name = 'unit_cost_snapshot'
    """)).fetchone()

    if not has_col:
        op.add_column(
            'stock_shipment_items',
            sa.Column('unit_cost_snapshot', sa.Float(), nullable=True)
        )

    conn.execute(text("""
        UPDATE stock_shipment_items AS ssi
        SET unit_cost_snapshot = COALESCE(p.cost_price, 0)
        FROM products AS p
        WHERE p.id = ssi.product_id
          AND ssi.unit_cost_snapshot IS NULL
    """))


def downgrade():
    conn = op.get_bind()

    has_col = conn.execute(text("""
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'stock_shipment_items'
          AND column_name = 'unit_cost_snapshot'
    """)).fetchone()

    if has_col:
        op.drop_column('stock_shipment_items', 'unit_cost_snapshot')
