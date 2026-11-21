"""Add location balance snapshots without reconstructing historical movements."""
from alembic import op
import sqlalchemy as sa

revision = 'zk_stock_balance_snapshots'
down_revision = 'zj_mini_device_proof'
branch_labels = None
depends_on = None

SNAPSHOT_CHECK = (
    '(balance_before IS NULL AND quantity_delta IS NULL AND balance_after IS NULL) OR '
    '(balance_before IS NOT NULL AND quantity_delta IS NOT NULL AND balance_after IS NOT NULL '
    'AND balance_after = balance_before + quantity_delta AND quantity = abs(quantity_delta))'
)


def upgrade():
    with op.batch_alter_table('stock_movements') as batch:
        batch.add_column(sa.Column('balance_before', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('quantity_delta', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('balance_after', sa.Integer(), nullable=True))
        batch.create_check_constraint('ck_stock_movement_balance_snapshot', SNAPSHOT_CHECK)
    op.create_index('ix_stock_movements_product_created_id', 'stock_movements', ['product_id', sa.text('created_at DESC'), sa.text('id DESC')])
    op.create_index('ix_stock_movements_product_branch_created_id', 'stock_movements', ['product_id', 'branch_id', sa.text('created_at DESC'), sa.text('id DESC')])


def downgrade():
    if op.get_bind().execute(sa.text(
        'SELECT 1 FROM stock_movements WHERE balance_before IS NOT NULL '
        'OR quantity_delta IS NOT NULL OR balance_after IS NOT NULL LIMIT 1'
    )).first():
        raise RuntimeError('Captured stock evidence exists; retain the additive schema when rolling back application code.')
    op.drop_index('ix_stock_movements_product_branch_created_id', table_name='stock_movements')
    op.drop_index('ix_stock_movements_product_created_id', table_name='stock_movements')
    with op.batch_alter_table('stock_movements') as batch:
        batch.drop_constraint('ck_stock_movement_balance_snapshot', type_='check')
        batch.drop_column('balance_after')
        batch.drop_column('quantity_delta')
        batch.drop_column('balance_before')
