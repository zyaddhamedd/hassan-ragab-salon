"""add_product_commission_columns

Adds:
  - products.sales_commission_percent       (FLOAT NOT NULL DEFAULT 0.0)
  - invoice_items.assigned_employee_id      (INTEGER FK -> employees.id, nullable)
  - invoice_items.sales_commission_percent  (FLOAT nullable DEFAULT 0.0)
  - invoice_items.sales_commission_amount   (FLOAT nullable DEFAULT 0.0)

Production-safe:
  - All new columns have defaults so no backfill is needed.
  - assigned_employee_id is nullable so existing PRODUCT_ITEM rows (without an employee) are not broken.
  - SERVICE_ITEM rows leave all three new columns NULL — no impact on service commission.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'm1_product_commission'
down_revision = ('123456789abc', '20230621_merge_branches')
branch_labels = None
depends_on = None


def upgrade():
    # 1. products table: add sales_commission_percent
    op.add_column(
        'products',
        sa.Column('sales_commission_percent', sa.Float(), nullable=False, server_default='0.0')
    )

    # 2. invoice_items: add product commission columns
    op.add_column(
        'invoice_items',
        sa.Column('assigned_employee_id', sa.Integer(), sa.ForeignKey('employees.id'), nullable=True)
    )
    op.add_column(
        'invoice_items',
        sa.Column('sales_commission_percent', sa.Float(), nullable=True, server_default='0.0')
    )
    op.add_column(
        'invoice_items',
        sa.Column('sales_commission_amount', sa.Float(), nullable=True, server_default='0.0')
    )

    # Index for audit queries: "show all products sold by employee X"
    op.create_index(
        'idx_invoice_items_assigned_employee',
        'invoice_items',
        ['assigned_employee_id'],
        unique=False,
        postgresql_where=sa.text("assigned_employee_id IS NOT NULL")
    )


def downgrade():
    op.drop_index('idx_invoice_items_assigned_employee', table_name='invoice_items')
    op.drop_column('invoice_items', 'sales_commission_amount')
    op.drop_column('invoice_items', 'sales_commission_percent')
    op.drop_column('invoice_items', 'assigned_employee_id')
    op.drop_column('products', 'sales_commission_percent')
