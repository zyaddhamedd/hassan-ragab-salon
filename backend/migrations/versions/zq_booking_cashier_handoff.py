"""Persist booking Draft identity and its multi-customer safety flag."""
from alembic import op
import sqlalchemy as sa
revision = 'zq_booking_cashier_handoff'
down_revision = 'zp_booking_deposit_settlement'
branch_labels = None
depends_on = None

def upgrade():
    with op.batch_alter_table('invoices') as batch:
        batch.add_column(sa.Column('booking_appointment_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('booking_multi_customer', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.create_foreign_key('fk_invoice_booking_appointment', 'appointments', ['booking_appointment_id'], ['id'], ondelete='RESTRICT')
        batch.create_unique_constraint('uq_invoice_booking_appointment', ['booking_appointment_id'])

def downgrade():
    if op.get_bind().execute(sa.text('SELECT 1 FROM invoices WHERE booking_appointment_id IS NOT NULL LIMIT 1')).first():
        raise RuntimeError('Preserve existing booking-to-invoice evidence before downgrade.')
    with op.batch_alter_table('invoices') as batch:
        batch.drop_constraint('uq_invoice_booking_appointment', type_='unique')
        batch.drop_constraint('fk_invoice_booking_appointment', type_='foreignkey')
        batch.drop_column('booking_multi_customer')
        batch.drop_column('booking_appointment_id')
