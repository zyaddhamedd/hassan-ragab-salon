"""Explicit booking deposit applications; retain all historical monetary values.

Revision ID: zp_booking_deposit_settlement
Revises: zo_promo_discount_scope
"""
from alembic import op
import sqlalchemy as sa
revision = 'zp_booking_deposit_settlement'
down_revision = 'zo_promo_discount_scope'
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().execute(sa.text("SELECT 1 FROM appointment_deposit_transactions WHERE transaction_type = 'DEPOSIT_APPLIED' LIMIT 1")).first():
        raise RuntimeError('Existing unlinked applications require reconciliation before this migration.')
    with op.batch_alter_table('appointment_deposit_transactions') as batch:
        batch.alter_column('amount', existing_type=sa.Integer(), type_=sa.Numeric(12, 2), existing_nullable=False)
        batch.add_column(sa.Column('invoice_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('source_collection_id', sa.Integer(), nullable=True))
        batch.create_foreign_key('fk_deposit_application_invoice', 'invoices', ['invoice_id'], ['id'], ondelete='RESTRICT')
        batch.create_foreign_key('fk_deposit_application_source', 'appointment_deposit_transactions', ['source_collection_id'], ['id'], ondelete='RESTRICT')
        batch.create_index('ix_appointment_deposit_transactions_invoice_id', ['invoice_id'])
        batch.create_index('ix_appointment_deposit_transactions_source_collection_id', ['source_collection_id'])
        batch.create_unique_constraint('uq_deposit_invoice_collection', ['invoice_id', 'source_collection_id'])
        batch.create_check_constraint('ck_deposit_application_reference', "transaction_type != 'DEPOSIT_APPLIED' OR (invoice_id IS NOT NULL AND source_collection_id IS NOT NULL AND source_collection_id <> id AND amount > 0)")
        batch.create_check_constraint('ck_deposit_collection_no_invoice', "transaction_type = 'DEPOSIT_APPLIED' OR (invoice_id IS NULL AND source_collection_id IS NULL)")
    with op.batch_alter_table('customer_balances') as batch:
        batch.alter_column('balance', existing_type=sa.Integer(), type_=sa.Numeric(12, 2), existing_nullable=False)


def downgrade():
    # Financial application evidence and fractional remaining credit must be retained.
    raise RuntimeError('Retain deposit settlement schema when rolling back application code.')
