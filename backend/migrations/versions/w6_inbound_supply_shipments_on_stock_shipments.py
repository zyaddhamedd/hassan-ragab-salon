"""extend stock shipments for inbound supplies

Revision ID: w6_inbound_shipments
Revises: v5_stock_return_requests
Create Date: 2026-07-02 14:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'w6_inbound_shipments'
down_revision = 'v5_stock_return_requests'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('stock_shipments', schema=None) as batch_op:
        batch_op.add_column(sa.Column('shipment_type', sa.String(length=30), nullable=True))
        batch_op.add_column(sa.Column('supplier_name_snapshot', sa.String(length=150), nullable=True))
        batch_op.add_column(sa.Column('products_count', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('pieces_count', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('total_cost_snapshot', sa.Float(), nullable=True))
        batch_op.alter_column('source_branch_id', existing_type=sa.Integer(), nullable=True)

    op.execute("""
        UPDATE stock_shipments
        SET shipment_type = 'OUTBOUND_TRANSFER'
        WHERE shipment_type IS NULL
    """)

    op.execute("""
        UPDATE stock_shipments ss
        SET
            products_count = item_totals.products_count,
            pieces_count = item_totals.pieces_count,
            total_cost_snapshot = item_totals.total_cost_snapshot
        FROM (
            SELECT
                ssi.shipment_id,
                COUNT(*)::integer AS products_count,
                COALESCE(SUM(ssi.quantity), 0)::integer AS pieces_count,
                COALESCE(
                    ROUND(SUM(ssi.quantity * COALESCE(ssi.unit_cost_snapshot, p.cost_price, 0))::numeric, 2),
                    0
                )::float AS total_cost_snapshot
            FROM stock_shipment_items ssi
            LEFT JOIN products p ON p.id = ssi.product_id
            GROUP BY ssi.shipment_id
        ) AS item_totals
        WHERE ss.id = item_totals.shipment_id
    """)

    op.execute("""
        UPDATE stock_shipments
        SET
            products_count = COALESCE(products_count, 0),
            pieces_count = COALESCE(pieces_count, 0),
            total_cost_snapshot = COALESCE(total_cost_snapshot, 0)
    """)

    with op.batch_alter_table('stock_shipments', schema=None) as batch_op:
        batch_op.alter_column('shipment_type', existing_type=sa.String(length=30), nullable=False)
        batch_op.alter_column('products_count', existing_type=sa.Integer(), nullable=False)
        batch_op.alter_column('pieces_count', existing_type=sa.Integer(), nullable=False)
        batch_op.alter_column('total_cost_snapshot', existing_type=sa.Float(), nullable=False)
        batch_op.create_index(batch_op.f('ix_stock_shipments_shipment_type'), ['shipment_type'], unique=False)


def downgrade():
    op.execute("""
        UPDATE stock_shipments
        SET source_branch_id = destination_branch_id
        WHERE source_branch_id IS NULL
    """)

    with op.batch_alter_table('stock_shipments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_stock_shipments_shipment_type'))
        batch_op.alter_column('source_branch_id', existing_type=sa.Integer(), nullable=False)
        batch_op.drop_column('total_cost_snapshot')
        batch_op.drop_column('pieces_count')
        batch_op.drop_column('products_count')
        batch_op.drop_column('supplier_name_snapshot')
        batch_op.drop_column('shipment_type')
