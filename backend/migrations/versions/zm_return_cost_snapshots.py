"""Add immutable return-item cost evidence; no historical writes."""
from alembic import op
import sqlalchemy as sa

revision = 'zm_return_cost_snapshots'
down_revision = 'zl_stock_recovery_read_model'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('return_item_valuations',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('source_type', sa.String(32), nullable=False),
        sa.Column('return_request_id', sa.Integer(), sa.ForeignKey('stock_return_requests.id', ondelete='CASCADE')),
        sa.Column('stock_movement_id', sa.Integer(), sa.ForeignKey('stock_movements.id', ondelete='CASCADE')),
        sa.Column('item_key', sa.String(80), nullable=False),
        sa.Column('product_id', sa.Integer(), sa.ForeignKey('products.id', ondelete='CASCADE'), nullable=False),
        sa.Column('quantity_snapshot', sa.Integer(), nullable=False),
        sa.Column('unit_cost_snapshot', sa.Numeric(18, 2)),
        sa.Column('valuation_source', sa.String(32), nullable=False),
        sa.Column('snapshot_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('return_request_id', 'item_key', name='uq_return_valuation_request_item'),
        sa.UniqueConstraint('stock_movement_id', 'item_key', name='uq_return_valuation_movement_item'),
        sa.CheckConstraint("(source_type = 'BRANCH_REQUEST' AND return_request_id IS NOT NULL AND stock_movement_id IS NULL) OR (source_type IN ('DIRECT_SUPPLIER_RETURN','MANUAL_SUPPLIER_RETURN') AND stock_movement_id IS NOT NULL AND return_request_id IS NULL)", name='ck_return_valuation_identity'),
        sa.CheckConstraint('quantity_snapshot > 0', name='ck_return_valuation_quantity'),
        sa.CheckConstraint("(valuation_source = 'RECORDED_AT_CREATION' AND unit_cost_snapshot IS NOT NULL AND unit_cost_snapshot >= 0 AND unit_cost_snapshot <= 9999999999999999.99) OR (valuation_source = 'UNAVAILABLE' AND unit_cost_snapshot IS NULL)", name='ck_return_valuation_cost'),
    )
    if op.get_bind().dialect.name == 'postgresql':
        op.execute("""CREATE FUNCTION prevent_return_valuation_update() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Return cost snapshots cannot be updated'; END $$""")
        op.execute('CREATE TRIGGER return_valuation_immutable BEFORE UPDATE ON return_item_valuations FOR EACH ROW EXECUTE FUNCTION prevent_return_valuation_update()')


def downgrade():
    # Explicit operator downgrade only; never invoked automatically.
    op.drop_table('return_item_valuations')
    if op.get_bind().dialect.name == 'postgresql':
        op.execute('DROP FUNCTION prevent_return_valuation_update()')
