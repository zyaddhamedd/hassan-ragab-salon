"""add appointment deposit transactions phase 1

Revision ID: y8_appointment_deposit_phase1
Revises: x7_store_manager_role
Create Date: 2026-07-19 11:20:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'y8_appointment_deposit_phase1'
down_revision = 'x7_store_manager_role'
branch_labels = None
depends_on = None


appointment_deposit_transaction_type_enum = postgresql.ENUM(
    'DEPOSIT_COLLECTION',
    'DEPOSIT_APPLIED',
    'DEPOSIT_REFUND',
    'DEPOSIT_ADJUSTMENT',
    name='appointment_deposit_transaction_type_enum',
    create_type=False,
)
payment_method_enum = postgresql.ENUM(
    'CASH',
    'VISA',
    'INSTAPAY',
    name='payment_method_enum',
    create_type=False,
)


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)

    # Handle partial-state retries safely:
    # - enum may already exist from a failed prior run
    # - table may still be absent
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_type
                WHERE typname = 'appointment_deposit_transaction_type_enum'
            ) THEN
                CREATE TYPE appointment_deposit_transaction_type_enum AS ENUM (
                    'DEPOSIT_COLLECTION',
                    'DEPOSIT_APPLIED',
                    'DEPOSIT_REFUND',
                    'DEPOSIT_ADJUSTMENT'
                );
            END IF;
        END
        $$;
        """
    )

    if not inspector.has_table('appointment_deposit_transactions'):
        op.create_table(
            'appointment_deposit_transactions',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('appointment_id', sa.Integer(), nullable=False),
            sa.Column('customer_id', sa.Integer(), nullable=False),
            sa.Column('branch_id', sa.Integer(), nullable=False),
            sa.Column('business_day_id', sa.Integer(), nullable=False),
            sa.Column('cashier_id', sa.Integer(), nullable=False),
            sa.Column('collected_by_user_id', sa.Integer(), nullable=False),
            sa.Column('amount', sa.Integer(), nullable=False),
            sa.Column('payment_method', payment_method_enum, nullable=False),
            sa.Column(
                'transaction_type',
                appointment_deposit_transaction_type_enum,
                nullable=False,
                server_default='DEPOSIT_COLLECTION',
            ),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(['appointment_id'], ['appointments.id'], ondelete='RESTRICT'),
            sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ondelete='RESTRICT'),
            sa.ForeignKeyConstraint(['business_day_id'], ['business_days.id'], ondelete='RESTRICT'),
            sa.ForeignKeyConstraint(['cashier_id'], ['employees.id'], ondelete='RESTRICT'),
            sa.ForeignKeyConstraint(['collected_by_user_id'], ['users.id'], ondelete='RESTRICT'),
            sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], ondelete='RESTRICT'),
            sa.PrimaryKeyConstraint('id'),
        )
        inspector = inspect(bind)

    existing_indexes = {index['name'] for index in inspector.get_indexes('appointment_deposit_transactions')}

    def create_index_if_missing(name, columns):
        if name not in existing_indexes:
            op.create_index(
                name,
                'appointment_deposit_transactions',
                columns,
                unique=False,
            )

    create_index_if_missing(
        'ix_appointment_deposit_transactions_appointment_id',
        ['appointment_id'],
    )
    create_index_if_missing(
        'ix_appointment_deposit_transactions_branch_id',
        ['branch_id'],
    )
    create_index_if_missing(
        'ix_appointment_deposit_transactions_business_day_id',
        ['business_day_id'],
    )
    create_index_if_missing(
        'ix_appointment_deposit_transactions_cashier_id',
        ['cashier_id'],
    )
    create_index_if_missing(
        'ix_appointment_deposit_transactions_collected_by_user_id',
        ['collected_by_user_id'],
    )
    create_index_if_missing(
        'ix_appointment_deposit_transactions_customer_id',
        ['customer_id'],
    )
    create_index_if_missing(
        'idx_appointment_deposit_transactions_business_day_payment',
        ['business_day_id', 'payment_method'],
    )
    create_index_if_missing(
        'idx_appointment_deposit_transactions_appointment_created',
        ['appointment_id', 'created_at'],
    )


def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)

    if not inspector.has_table('appointment_deposit_transactions'):
        return

    existing_indexes = {index['name'] for index in inspector.get_indexes('appointment_deposit_transactions')}

    def drop_index_if_exists(name):
        if name in existing_indexes:
            op.drop_index(name, table_name='appointment_deposit_transactions')

    drop_index_if_exists('idx_appointment_deposit_transactions_appointment_created')
    drop_index_if_exists('idx_appointment_deposit_transactions_business_day_payment')
    drop_index_if_exists('ix_appointment_deposit_transactions_customer_id')
    drop_index_if_exists('ix_appointment_deposit_transactions_collected_by_user_id')
    drop_index_if_exists('ix_appointment_deposit_transactions_cashier_id')
    drop_index_if_exists('ix_appointment_deposit_transactions_business_day_id')
    drop_index_if_exists('ix_appointment_deposit_transactions_branch_id')
    drop_index_if_exists('ix_appointment_deposit_transactions_appointment_id')
    op.drop_table('appointment_deposit_transactions')

    # Intentionally do not drop the PostgreSQL enum type on downgrade.
    # Leaving named enum types in place is safer than risking removal of a
    # shared or partially referenced type in recovery scenarios.
