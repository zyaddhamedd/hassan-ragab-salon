"""harden phase 1 inventory batch indexes

Revision ID: t2_inventory_batch_h1
Revises: t1_inventory_batches_phase1
Create Date: 2026-06-26 18:20:00.000000
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = 't2_inventory_batch_h1'
down_revision = 't1_inventory_batches_phase1'
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        'ix_inventory_batches_created_branch_id',
        'inventory_batches',
        ['created_branch_id'],
        unique=False,
    )
    op.create_index(
        'ix_branch_inventory_batches_branch_id',
        'branch_inventory_batches',
        ['branch_id'],
        unique=False,
    )
    op.create_index(
        'ix_branch_inventory_batches_branch_product_status',
        'branch_inventory_batches',
        ['branch_id', 'product_id', 'status'],
        unique=False,
    )
    op.create_index(
        'ix_branch_inventory_batches_product_status_first_received_at',
        'branch_inventory_batches',
        ['product_id', 'status', 'first_received_at'],
        unique=False,
    )


def downgrade():
    op.drop_index(
        'ix_branch_inventory_batches_product_status_first_received_at',
        table_name='branch_inventory_batches',
    )
    op.drop_index(
        'ix_branch_inventory_batches_branch_product_status',
        table_name='branch_inventory_batches',
    )
    op.drop_index(
        'ix_branch_inventory_batches_branch_id',
        table_name='branch_inventory_batches',
    )
    op.drop_index(
        'ix_inventory_batches_created_branch_id',
        table_name='inventory_batches',
    )
