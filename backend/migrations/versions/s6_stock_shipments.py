"""add stock shipments tables

Revision ID: s6_stock_shipments
Revises: n2_main_warehouse_setup
Create Date: 2026-06-21 22:15:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 's6_stock_shipments'
down_revision = 'n2_main_warehouse_setup'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'stock_shipments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('shipment_ref', sa.String(length=50), nullable=False),
        sa.Column('source_branch_id', sa.Integer(), nullable=False),
        sa.Column('destination_branch_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_by_user_id', sa.Integer(), nullable=False),
        sa.Column('received_by_employee_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['destination_branch_id'], ['branches.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['received_by_employee_id'], ['employees.id']),
        sa.ForeignKeyConstraint(['source_branch_id'], ['branches.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_stock_shipments_shipment_ref'), 'stock_shipments', ['shipment_ref'], unique=True)
    op.create_index(op.f('ix_stock_shipments_status'), 'stock_shipments', ['status'], unique=False)

    op.create_table(
        'stock_shipment_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('shipment_id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['shipment_id'], ['stock_shipments.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('shipment_id', 'product_id', name='uq_stock_shipment_item_product')
    )
    op.create_index(op.f('ix_stock_shipment_items_shipment_id'), 'stock_shipment_items', ['shipment_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_stock_shipment_items_shipment_id'), table_name='stock_shipment_items')
    op.drop_table('stock_shipment_items')
    op.drop_index(op.f('ix_stock_shipments_status'), table_name='stock_shipments')
    op.drop_index(op.f('ix_stock_shipments_shipment_ref'), table_name='stock_shipments')
    op.drop_table('stock_shipments')
