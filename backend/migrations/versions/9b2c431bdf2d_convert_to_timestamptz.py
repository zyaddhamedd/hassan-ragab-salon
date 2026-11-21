"""convert_to_timestamptz

Revision ID: 9b2c431bdf2d
Revises: 9a1b321acf1c
Create Date: 2026-02-17 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '9b2c431bdf2d'
down_revision = '9a1b321acf1c'
branch_labels = None
depends_on = None

COLUMNS = [
    ('appointments', 'created_at'), ('appointments', 'updated_at'),
    ('attendances', 'check_in_time'), ('attendances', 'check_out_time'), ('attendances', 'created_at'), ('attendances', 'updated_at'),
    ('branches', 'created_at'), ('branches', 'updated_at'),
    ('branch_services', 'created_at'), ('branch_services', 'updated_at'),
    ('cashier_shifts', 'opened_at'), ('cashier_shifts', 'closed_at'), ('cashier_shifts', 'created_at'),
    ('customers', 'created_at'), ('customers', 'updated_at'),
    ('customer_balances', 'created_at'), ('customer_balances', 'updated_at'),
    ('customer_images', 'created_at'),
    ('daily_branch_closings', 'closed_at'), ('daily_branch_closings', 'created_at'),
    ('employees', 'created_at'), ('employees', 'updated_at'),
    ('employee_documents', 'uploaded_at'),
    ('employee_overtime', 'created_at'),
    ('employee_transfers', 'transfer_date'),
    ('expenses', 'created_at'),
    ('expense_categories', 'created_at'),
    ('invoices', 'paid_at'), ('invoices', 'created_at'), ('invoices', 'updated_at'),
    ('invoice_items', 'created_at'),
    ('services', 'created_at'), ('services', 'updated_at'),
    ('service_categories', 'created_at'), ('service_categories', 'updated_at'),
    ('treasury_accounts', 'created_at'),
    ('treasury_transactions', 'created_at'),
    ('users', 'created_at'), ('users', 'updated_at'),
    ('waiting_tickets', 'created_at')
]

def upgrade():
    for table, col in COLUMNS:
        # TIMESTAMPTZ = TIMESTAMP WITH TIME ZONE
        # We explicitly assume existing naive values are UTC
        op.execute(f"ALTER TABLE {table} ALTER COLUMN {col} TYPE TIMESTAMPTZ USING {col} AT TIME ZONE 'UTC'")

def downgrade():
    for table, col in COLUMNS:
        # Revert to Naive, assuming stored values are UTC
        op.execute(f"ALTER TABLE {table} ALTER COLUMN {col} TYPE TIMESTAMP WITHOUT TIME ZONE USING {col} AT TIME ZONE 'UTC'")
