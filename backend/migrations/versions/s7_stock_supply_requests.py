"""add stock supply requests tables

Revision ID: s7_stock_supply_requests
Revises: s6_stock_shipments
Create Date: 2026-06-25 18:55:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 's7_stock_supply_requests'
down_revision = 's6_stock_shipments'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'stock_supply_requests',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('request_ref', sa.String(length=50), nullable=False),
        sa.Column('branch_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_by_employee_id', sa.Integer(), nullable=False),
        sa.Column('shipment_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_employee_id'], ['employees.id']),
        sa.ForeignKeyConstraint(['shipment_id'], ['stock_shipments.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_stock_supply_requests_request_ref'), 'stock_supply_requests', ['request_ref'], unique=True)
    op.create_index(op.f('ix_stock_supply_requests_status'), 'stock_supply_requests', ['status'], unique=False)

    op.create_table(
        'stock_supply_request_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('request_id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('requested_quantity', sa.Integer(), nullable=False),
        sa.Column('final_quantity', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['request_id'], ['stock_supply_requests.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('request_id', 'product_id', name='uq_stock_supply_request_item_product')
    )
    op.create_index(op.f('ix_stock_supply_request_items_request_id'), 'stock_supply_request_items', ['request_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_stock_supply_request_items_request_id'), table_name='stock_supply_request_items')
    op.drop_table('stock_supply_request_items')
    op.drop_index(op.f('ix_stock_supply_requests_status'), table_name='stock_supply_requests')
    op.drop_index(op.f('ix_stock_supply_requests_request_ref'), table_name='stock_supply_requests')
    op.drop_table('stock_supply_requests')
