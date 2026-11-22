"""Add VISA_1 and VISA_2 to payment_method_enum and actual machine closing columns to business_days

Revision ID: aaa_dual_visa_terminals
Revises: zz_staff_gps_attendance
Create Date: 2026-11-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'aaa_dual_visa_terminals'
down_revision = 'zz_staff_gps_attendance'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Additive enum extension for dual Visa terminals
    op.execute("ALTER TYPE payment_method_enum ADD VALUE IF NOT EXISTS 'VISA_1'")
    op.execute("ALTER TYPE payment_method_enum ADD VALUE IF NOT EXISTS 'VISA_2'")

    # 2. Additive close-time machine reconciliation columns on business_days
    op.add_column('business_days', sa.Column('actual_visa_1', sa.Numeric(12, 2), nullable=True))
    op.add_column('business_days', sa.Column('actual_visa_2', sa.Numeric(12, 2), nullable=True))
    op.add_column('business_days', sa.Column('actual_instapay', sa.Numeric(12, 2), nullable=True))


def downgrade():
    op.drop_column('business_days', 'actual_instapay')
    op.drop_column('business_days', 'actual_visa_2')
    op.drop_column('business_days', 'actual_visa_1')
    # Note: PostgreSQL enum values are preserved on downgrade for safety.
