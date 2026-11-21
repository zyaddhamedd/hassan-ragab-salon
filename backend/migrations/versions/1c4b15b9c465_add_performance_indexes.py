"""add_performance_indexes

Revision ID: 1c4b15b9c465
Revises: b4e6f8a0c2d1
Create Date: 2026-02-28 01:02:02.881784

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine import reflection

# revision identifiers, used by Alembic.
revision = '1c4b15b9c465'
down_revision = 'b4e6f8a0c2d1'
branch_labels = None
depends_on = None


def _index_exists(index_name, table_name):
    bind = op.get_bind()
    insp = sa.inspect(bind)
    indexes = insp.get_indexes(table_name)
    return any(index['name'] == index_name for index in indexes)


def upgrade():
    # Performance Optimization for LIVE Production
    # These indexes target slow sequential scans detected in recent audit.
    # [EMERGENCY FIX] Removed concurrent creation to ensure transactional boot.
    
    index_configs = [
        ('invoice_items', 'idx_invoice_items_invoice_id', ['invoice_id']),
        ('invoice_items', 'idx_invoice_items_barber_id', ['barber_id']),
        ('invoice_items', 'idx_invoice_items_assistant_id', ['assistant_id']),
        ('employees', 'idx_employees_branch_type', ['branch_id', 'employee_type']),
        ('invoices', 'idx_invoices_branch_status_date', ['branch_id', 'status', 'created_at']),
    ]

    for table_name, index_name, columns in index_configs:
        if not _index_exists(index_name, table_name):
            print(f"Adding index {index_name} on {table_name}...")
            op.create_index(
                index_name,
                table_name,
                columns,
                unique=False
            )
        else:
            print(f"Index {index_name} already exists. Skipping.")


def downgrade():
    index_configs = [
        ('invoice_items', 'idx_invoice_items_invoice_id'),
        ('invoice_items', 'idx_invoice_items_barber_id'),
        ('invoice_items', 'idx_invoice_items_assistant_id'),
        ('employees', 'idx_employees_branch_type'),
        ('invoices', 'idx_invoices_branch_status_date'),
    ]

    for table_name, index_name in index_configs:
        if _index_exists(index_name, table_name):
            print(f"Dropping index {index_name} from {table_name}...")
            op.drop_index(index_name, table_name=table_name)
