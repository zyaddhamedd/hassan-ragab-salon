"""add inventory batch tables for phase 1

Revision ID: t1_inventory_batches_phase1
Revises: s7_stock_supply_requests
Create Date: 2026-06-26 12:30:00.000000
"""

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 't1_inventory_batches_phase1'
down_revision = 's7_stock_supply_requests'
branch_labels = None
depends_on = None


inventory_batch_source_type = sa.Enum(
    'OPENING_BALANCE',
    'SUPPLY_RECEIPT',
    name='inventorybatchsourcetype',
    native_enum=False,
)
inventory_batch_status = sa.Enum(
    'ACTIVE',
    'DEPLETED',
    'ARCHIVED',
    name='inventorybatchstatus',
    native_enum=False,
)


def upgrade():
    op.create_table(
        'inventory_batches',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('batch_number', sa.String(length=50), nullable=False),
        sa.Column('expiration_date', sa.Date(), nullable=True),
        sa.Column('supplier_name_snapshot', sa.String(length=150), nullable=True),
        sa.Column('initial_quantity', sa.Integer(), nullable=False),
        sa.Column('source_type', inventory_batch_source_type, nullable=False),
        sa.Column('source_ref', sa.String(length=50), nullable=True),
        sa.Column('created_branch_id', sa.Integer(), nullable=False),
        sa.Column('created_by_user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('status', inventory_batch_status, nullable=False),
        sa.CheckConstraint('initial_quantity >= 0', name='ck_inventory_batches_initial_quantity_non_negative'),
        sa.ForeignKeyConstraint(['created_branch_id'], ['branches.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_inventory_batches_batch_number'), 'inventory_batches', ['batch_number'], unique=True)
    op.create_index(op.f('ix_inventory_batches_created_by_user_id'), 'inventory_batches', ['created_by_user_id'], unique=False)
    op.create_index(op.f('ix_inventory_batches_product_id'), 'inventory_batches', ['product_id'], unique=False)
    op.create_index(op.f('ix_inventory_batches_source_ref'), 'inventory_batches', ['source_ref'], unique=False)
    op.create_index(op.f('ix_inventory_batches_status'), 'inventory_batches', ['status'], unique=False)

    op.create_table(
        'branch_inventory_batches',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('batch_id', sa.Integer(), nullable=False),
        sa.Column('branch_id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('remaining_quantity', sa.Integer(), nullable=False),
        sa.Column('first_received_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_moved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', inventory_batch_status, nullable=False),
        sa.CheckConstraint('remaining_quantity >= 0', name='ck_branch_inventory_batches_remaining_quantity_non_negative'),
        sa.ForeignKeyConstraint(['batch_id'], ['inventory_batches.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('branch_id', 'batch_id', name='uq_branch_inventory_batch_branch_batch'),
    )
    op.create_index(op.f('ix_branch_inventory_batches_batch_id'), 'branch_inventory_batches', ['batch_id'], unique=False)
    op.create_index(op.f('ix_branch_inventory_batches_product_id'), 'branch_inventory_batches', ['product_id'], unique=False)
    op.create_index(op.f('ix_branch_inventory_batches_status'), 'branch_inventory_batches', ['status'], unique=False)

    bind = op.get_bind()
    metadata = sa.MetaData()
    product_branch_stocks = sa.Table('product_branch_stocks', metadata, autoload_with=bind)
    products = sa.Table('products', metadata, autoload_with=bind)
    inventory_batches = sa.Table('inventory_batches', metadata, autoload_with=bind)
    branch_inventory_batches = sa.Table('branch_inventory_batches', metadata, autoload_with=bind)

    backfill_rows = bind.execute(
        sa.select(
            product_branch_stocks.c.product_id,
            product_branch_stocks.c.branch_id,
            product_branch_stocks.c.stock_quantity,
            products.c.expiry_date,
            products.c.supplier_name,
        )
        .select_from(
            product_branch_stocks.join(products, products.c.id == product_branch_stocks.c.product_id)
        )
        .where(product_branch_stocks.c.stock_quantity > 0)
        .order_by(product_branch_stocks.c.branch_id.asc(), product_branch_stocks.c.product_id.asc())
    ).fetchall()

    for row in backfill_rows:
        now = datetime.now(timezone.utc)
        batch_insert = bind.execute(
            inventory_batches.insert().values(
                product_id=row.product_id,
                batch_number=f"LEGACY-{row.branch_id}-{row.product_id}-001",
                expiration_date=row.expiry_date,
                supplier_name_snapshot=row.supplier_name,
                initial_quantity=int(row.stock_quantity or 0),
                source_type='OPENING_BALANCE',
                source_ref=None,
                created_branch_id=row.branch_id,
                created_by_user_id=None,
                created_at=now,
                status='ACTIVE',
            )
        )
        batch_id = batch_insert.inserted_primary_key[0]
        bind.execute(
            branch_inventory_batches.insert().values(
                batch_id=batch_id,
                branch_id=row.branch_id,
                product_id=row.product_id,
                remaining_quantity=int(row.stock_quantity or 0),
                first_received_at=now,
                last_moved_at=None,
                status='ACTIVE',
            )
        )


def downgrade():
    op.drop_index(op.f('ix_branch_inventory_batches_status'), table_name='branch_inventory_batches')
    op.drop_index(op.f('ix_branch_inventory_batches_product_id'), table_name='branch_inventory_batches')
    op.drop_index(op.f('ix_branch_inventory_batches_batch_id'), table_name='branch_inventory_batches')
    op.drop_table('branch_inventory_batches')

    op.drop_index(op.f('ix_inventory_batches_status'), table_name='inventory_batches')
    op.drop_index(op.f('ix_inventory_batches_source_ref'), table_name='inventory_batches')
    op.drop_index(op.f('ix_inventory_batches_product_id'), table_name='inventory_batches')
    op.drop_index(op.f('ix_inventory_batches_created_by_user_id'), table_name='inventory_batches')
    op.drop_index(op.f('ix_inventory_batches_batch_number'), table_name='inventory_batches')
    op.drop_table('inventory_batches')
