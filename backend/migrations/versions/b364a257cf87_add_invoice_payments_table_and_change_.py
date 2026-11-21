"""add invoice_payments table and change_amount

Revision ID: b364a257cf87
Revises: j6k8l0m2n4o3
Create Date: 2026-03-29 18:39:40.234383

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'b364a257cf87'
down_revision = 'j6k8l0m2n4o3'
branch_labels = None
depends_on = None


def upgrade():
    # Create invoice_payments table.
    # NOTE: payment_method_enum already exists in the DB — use create_type=False
    # to avoid DuplicateObject errors when Alembic tries to CREATE TYPE.
    existing_pm_enum = postgresql.ENUM(
        'CASH', 'VISA', 'INSTAPAY',
        name='payment_method_enum',
        create_type=False
    )

    op.create_table(
        'invoice_payments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('invoice_id', sa.Integer(), nullable=False),
        sa.Column('method', existing_pm_enum, nullable=False),
        sa.Column('amount', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['invoice_id'], ['invoices.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(
        'ix_invoice_payments_invoice_id',
        'invoice_payments',
        ['invoice_id'],
        unique=False
    )

    # Add change_amount column to invoices table
    with op.batch_alter_table('invoices', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('change_amount', sa.Float(), nullable=True)
        )


def downgrade():
    # Remove change_amount column from invoices
    with op.batch_alter_table('invoices', schema=None) as batch_op:
        batch_op.drop_column('change_amount')

    # Drop invoice_payments table (enum type is shared, do not drop it)
    op.drop_index('ix_invoice_payments_invoice_id', table_name='invoice_payments')
    op.drop_table('invoice_payments')
