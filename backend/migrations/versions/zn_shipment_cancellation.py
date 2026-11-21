"""Add shipment cancellation evidence and unique movement reversals."""
from alembic import op
import sqlalchemy as sa

revision = 'zn_shipment_cancellation'
down_revision = 'zm_return_cost_snapshots'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('stock_shipments') as batch:
        batch.add_column(sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('cancelled_by_user_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('cancellation_reason', sa.Text(), nullable=True))
        batch.create_foreign_key('fk_shipment_cancelled_by_user', 'users', ['cancelled_by_user_id'], ['id'])
    with op.batch_alter_table('stock_movements') as batch:
        batch.add_column(sa.Column('reversal_of_movement_id', sa.Integer(), nullable=True))
        batch.create_foreign_key('fk_stock_movement_reversal', 'stock_movements', ['reversal_of_movement_id'], ['id'], ondelete='RESTRICT')
        batch.create_unique_constraint('uq_stock_movement_reversal', ['reversal_of_movement_id'])
        batch.create_check_constraint('ck_stock_movement_reversal_not_self', 'reversal_of_movement_id IS NULL OR reversal_of_movement_id <> id')


def downgrade():
    # Application rollback must not erase already recorded cancellation evidence.
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT 1 FROM stock_shipments WHERE cancelled_at IS NOT NULL OR cancelled_by_user_id IS NOT NULL OR cancellation_reason IS NOT NULL OR status = 'CANCELLED' LIMIT 1")).first() or connection.execute(sa.text('SELECT 1 FROM stock_movements WHERE reversal_of_movement_id IS NOT NULL LIMIT 1')).first():
        raise RuntimeError('Cancellation evidence exists; retain the additive schema when rolling back application code.')
    with op.batch_alter_table('stock_movements') as batch:
        batch.drop_constraint('ck_stock_movement_reversal_not_self', type_='check')
        batch.drop_constraint('uq_stock_movement_reversal', type_='unique')
        batch.drop_constraint('fk_stock_movement_reversal', type_='foreignkey')
        batch.drop_column('reversal_of_movement_id')
    with op.batch_alter_table('stock_shipments') as batch:
        batch.drop_constraint('fk_shipment_cancelled_by_user', type_='foreignkey')
        batch.drop_column('cancellation_reason')
        batch.drop_column('cancelled_by_user_id')
        batch.drop_column('cancelled_at')
