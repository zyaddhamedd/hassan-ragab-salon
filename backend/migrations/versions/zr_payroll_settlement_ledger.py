"""zr_payroll_settlement_ledger

Phase 2: Additive Settlement Ledger Foundation.
Creates:
  - settlement_status_enum
  - payroll_settlements
  - settlement_allocated_items
  - settlement_adjustments
  - settlement_payments

Additive only:
  - Does NOT modify any legacy tables.
  - Zero disruption to existing billing, cashier, or inventory.
  - Reversible downgrade.

Revision ID: zr_payroll_settlement_ledger
Revises: zq_booking_cashier_handoff
Create Date: 2026-10-26 07:25:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text

revision = 'zr_payroll_settlement_ledger'
down_revision = 'zq_booking_cashier_handoff'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    is_postgres = bind.dialect.name == 'postgresql'

    if is_postgres:
        bind.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'settlement_status_enum') THEN
                    CREATE TYPE settlement_status_enum AS ENUM (
                        'DRAFT', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'
                    );
                END IF;
            END$$;
        """))

    from sqlalchemy.dialects import postgresql

    # 1. payroll_settlements
    status_col_type = (
        postgresql.ENUM(
            'DRAFT', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED',
            name='settlement_status_enum',
            create_type=False,
        )
        if is_postgres else sa.String(20)
    )

    op.create_table(
        'payroll_settlements',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('settlement_number', sa.String(64), nullable=False),
        sa.Column('employee_id', sa.Integer(), sa.ForeignKey('employees.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('branch_id', sa.Integer(), sa.ForeignKey('branches.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('date_from', sa.Date(), nullable=False),
        sa.Column('date_to', sa.Date(), nullable=False),
        sa.Column('status', status_col_type, nullable=False, server_default='DRAFT'),

        sa.Column('total_barber_commission', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('total_assistant_commission', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('total_product_commission', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('total_commissions_earned', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('total_overtime', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('base_salary_allocated', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('total_gross_earnings', sa.Numeric(10, 2), nullable=False, server_default='0.00'),

        sa.Column('total_advances', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('total_commission_withdrawals', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('total_money_already_received', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('total_administrative_deductions', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('total_manual_deductions', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('total_manual_additions', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('total_deductions', sa.Numeric(10, 2), nullable=False, server_default='0.00'),

        sa.Column('carried_balance_applied', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('absorbed_settlement_id', sa.Integer(), sa.ForeignKey('payroll_settlements.id', ondelete='SET NULL'), nullable=True),

        sa.Column('net_payable', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('total_paid', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('remaining_balance', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('is_negative_balance', sa.Boolean(), nullable=False, server_default=sa.false()),

        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('approved_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('cancelled_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('cancellation_reason', sa.Text(), nullable=True),

        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('settlement_number', name='uq_settlement_number')
    )
    op.create_index('ix_payroll_settlements_employee', 'payroll_settlements', ['employee_id'])
    op.create_index('ix_payroll_settlements_branch', 'payroll_settlements', ['branch_id'])
    op.create_index('ix_payroll_settlements_status', 'payroll_settlements', ['status'])
    op.create_index('ix_payroll_settlements_date_from', 'payroll_settlements', ['date_from'])
    op.create_index('ix_payroll_settlements_date_to', 'payroll_settlements', ['date_to'])

    # 2. settlement_allocated_items
    op.create_table(
        'settlement_allocated_items',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('settlement_id', sa.Integer(), sa.ForeignKey('payroll_settlements.id', ondelete='CASCADE'), nullable=False),
        sa.Column('item_type', sa.String(32), nullable=False),
        sa.Column('source_item_id', sa.Integer(), nullable=False),
        sa.Column('earning_role', sa.String(20), nullable=True),
        sa.Column('allocated_amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('source_reference', sa.String(64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('settlement_id', 'item_type', 'source_item_id', name='uq_settlement_allocated_item')
    )
    op.create_index('idx_allocated_item_lookup', 'settlement_allocated_items', ['item_type', 'source_item_id'])
    op.create_index('ix_settlement_allocated_items_settlement', 'settlement_allocated_items', ['settlement_id'])

    # 3. settlement_adjustments
    op.create_table(
        'settlement_adjustments',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('settlement_id', sa.Integer(), sa.ForeignKey('payroll_settlements.id', ondelete='CASCADE'), nullable=False),
        sa.Column('category', sa.String(32), nullable=False),
        sa.Column('is_addition', sa.Boolean(), nullable=False),
        sa.Column('amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('reason', sa.String(500), nullable=False),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint('amount > 0', name='chk_settlement_adjustment_positive_amount')
    )
    op.create_index('ix_settlement_adjustments_settlement', 'settlement_adjustments', ['settlement_id'])

    # 4. settlement_payments
    op.create_table(
        'settlement_payments',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('settlement_id', sa.Integer(), sa.ForeignKey('payroll_settlements.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('payment_method', sa.String(32), nullable=False),
        sa.Column('treasury_expense_id', sa.Integer(), sa.ForeignKey('expenses.id', ondelete='SET NULL'), nullable=True),
        sa.Column('idempotency_key', sa.String(64), nullable=False),
        sa.Column('is_reversed', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('reversal_reason', sa.Text(), nullable=True),
        sa.Column('reversed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reversed_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('paid_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('paid_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.UniqueConstraint('idempotency_key', name='uq_settlement_payment_idempotency'),
        sa.CheckConstraint('amount > 0', name='chk_settlement_payment_positive_amount')
    )
    op.create_index('ix_settlement_payments_settlement', 'settlement_payments', ['settlement_id'])


def downgrade():
    op.drop_table('settlement_payments')
    op.drop_table('settlement_adjustments')
    op.drop_table('settlement_allocated_items')
    op.drop_table('payroll_settlements')

    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        bind.execute(text("DROP TYPE IF EXISTS settlement_status_enum;"))
