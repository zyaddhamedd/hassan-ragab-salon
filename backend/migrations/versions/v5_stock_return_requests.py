"""add stock return requests

Revision ID: v5_stock_return_requests
Revises: u4_shipment_cost_snapshots
Create Date: 2026-07-02 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = 'v5_stock_return_requests'
down_revision = 'u4_shipment_cost_snapshots'
branch_labels = None
depends_on = None


NEW_STOCK_MOVEMENT_ENUM = sa.Enum(
    'PRODUCT_SALE',
    'INTERNAL_CONSUMPTION',
    'SUPPLY_IN',
    'TRANSFER_OUT',
    'TRANSFER_IN',
    'RETURN_TO_SUPPLIER',
    'STOCK_ADJUSTMENT',
    name='stockmovementtype',
    native_enum=False,
)

OLD_STOCK_MOVEMENT_ENUM = sa.Enum(
    'PRODUCT_SALE',
    'INTERNAL_CONSUMPTION',
    'SUPPLY_IN',
    'TRANSFER_OUT',
    'TRANSFER_IN',
    'STOCK_ADJUSTMENT',
    name='stockmovementtype',
    native_enum=False,
)


def upgrade():
    op.create_table(
        'stock_return_requests',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('return_ref', sa.String(length=50), nullable=False),
        sa.Column('branch_id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('requested_quantity', sa.Integer(), nullable=False),
        sa.Column('branch_stock_snapshot', sa.Integer(), nullable=False),
        sa.Column('reason', sa.String(length=40), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=30), nullable=False),
        sa.Column('created_by_employee_id', sa.Integer(), nullable=False),
        sa.Column('resolved_by_user_id', sa.Integer(), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolution_note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint('requested_quantity > 0', name='ck_stock_return_requests_requested_quantity_positive'),
        sa.CheckConstraint('branch_stock_snapshot >= 0', name='ck_stock_return_requests_stock_snapshot_non_negative'),
        sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_employee_id'], ['employees.id']),
        sa.ForeignKeyConstraint(['resolved_by_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_stock_return_requests_return_ref'), 'stock_return_requests', ['return_ref'], unique=True)
    op.create_index(op.f('ix_stock_return_requests_branch_id'), 'stock_return_requests', ['branch_id'], unique=False)
    op.create_index(op.f('ix_stock_return_requests_product_id'), 'stock_return_requests', ['product_id'], unique=False)
    op.create_index(op.f('ix_stock_return_requests_reason'), 'stock_return_requests', ['reason'], unique=False)
    op.create_index(op.f('ix_stock_return_requests_status'), 'stock_return_requests', ['status'], unique=False)
    op.create_index('ix_stock_return_requests_branch_status_created_at', 'stock_return_requests', ['branch_id', 'status', 'created_at'], unique=False)

    with op.batch_alter_table('stock_movements', schema=None) as batch_op:
        batch_op.alter_column(
            'movement_type',
            existing_type=OLD_STOCK_MOVEMENT_ENUM,
            type_=NEW_STOCK_MOVEMENT_ENUM,
            existing_nullable=False,
        )


def downgrade():
    with op.batch_alter_table('stock_movements', schema=None) as batch_op:
        batch_op.alter_column(
            'movement_type',
            existing_type=NEW_STOCK_MOVEMENT_ENUM,
            type_=OLD_STOCK_MOVEMENT_ENUM,
            existing_nullable=False,
        )

    op.drop_index('ix_stock_return_requests_branch_status_created_at', table_name='stock_return_requests')
    op.drop_index(op.f('ix_stock_return_requests_status'), table_name='stock_return_requests')
    op.drop_index(op.f('ix_stock_return_requests_reason'), table_name='stock_return_requests')
    op.drop_index(op.f('ix_stock_return_requests_product_id'), table_name='stock_return_requests')
    op.drop_index(op.f('ix_stock_return_requests_branch_id'), table_name='stock_return_requests')
    op.drop_index(op.f('ix_stock_return_requests_return_ref'), table_name='stock_return_requests')
    op.drop_table('stock_return_requests')
