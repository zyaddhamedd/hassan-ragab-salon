from datetime import datetime, timezone
import enum

from app.extensions import db
from app.models.invoice import PaymentMethod


class AppointmentDepositTransactionType(enum.Enum):
    DEPOSIT_COLLECTION = "DEPOSIT_COLLECTION"
    DEPOSIT_APPLIED = "DEPOSIT_APPLIED"
    DEPOSIT_REFUND = "DEPOSIT_REFUND"
    DEPOSIT_ADJUSTMENT = "DEPOSIT_ADJUSTMENT"


class AppointmentDepositTransaction(db.Model):
    __tablename__ = 'appointment_deposit_transactions'

    id = db.Column(db.Integer, primary_key=True)
    appointment_id = db.Column(
        db.Integer,
        db.ForeignKey('appointments.id', ondelete='RESTRICT'),
        nullable=False,
        index=True,
    )
    customer_id = db.Column(
        db.Integer,
        db.ForeignKey('customers.id', ondelete='RESTRICT'),
        nullable=False,
        index=True,
    )
    branch_id = db.Column(
        db.Integer,
        db.ForeignKey('branches.id', ondelete='RESTRICT'),
        nullable=False,
        index=True,
    )
    business_day_id = db.Column(
        db.Integer,
        db.ForeignKey('business_days.id', ondelete='RESTRICT'),
        nullable=False,
        index=True,
    )
    cashier_id = db.Column(
        db.Integer,
        db.ForeignKey('employees.id', ondelete='RESTRICT'),
        nullable=False,
        index=True,
    )
    collected_by_user_id = db.Column(
        db.Integer,
        db.ForeignKey('users.id', ondelete='RESTRICT'),
        nullable=False,
        index=True,
    )
    amount = db.Column(db.Numeric(12, 2), nullable=False)
    invoice_id = db.Column(db.Integer, db.ForeignKey('invoices.id', ondelete='RESTRICT'), nullable=True, index=True)
    source_collection_id = db.Column(db.Integer, db.ForeignKey('appointment_deposit_transactions.id', ondelete='RESTRICT'), nullable=True, index=True)
    invoice = db.relationship('Invoice', backref=db.backref('deposit_applications', lazy='selectin'), foreign_keys=[invoice_id])
    payment_method = db.Column(
        db.Enum(PaymentMethod, name='payment_method_enum'),
        nullable=False,
    )
    transaction_type = db.Column(
        db.Enum(
            AppointmentDepositTransactionType,
            name='appointment_deposit_transaction_type_enum',
        ),
        nullable=False,
        default=AppointmentDepositTransactionType.DEPOSIT_COLLECTION,
    )
    created_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        db.UniqueConstraint('invoice_id', 'source_collection_id', name='uq_deposit_invoice_collection'),
        db.CheckConstraint("transaction_type != 'DEPOSIT_APPLIED' OR (invoice_id IS NOT NULL AND source_collection_id IS NOT NULL AND source_collection_id <> id AND amount > 0)", name='ck_deposit_application_reference'),
        db.CheckConstraint("transaction_type = 'DEPOSIT_APPLIED' OR (invoice_id IS NULL AND source_collection_id IS NULL)", name='ck_deposit_collection_no_invoice'),
        db.Index(
            'idx_appointment_deposit_transactions_business_day_payment',
            'business_day_id',
            'payment_method',
        ),
        db.Index(
            'idx_appointment_deposit_transactions_appointment_created',
            'appointment_id',
            'created_at',
        ),
    )

    appointment = db.relationship(
        'Appointment',
        backref=db.backref('deposit_transactions', lazy=True),
    )
    customer = db.relationship(
        'Customer',
        backref=db.backref('appointment_deposit_transactions', lazy=True),
    )
    branch = db.relationship(
        'Branch',
        backref=db.backref('appointment_deposit_transactions', lazy=True),
    )
    business_day = db.relationship(
        'BusinessDay',
        backref=db.backref('appointment_deposit_transactions', lazy='dynamic'),
    )
    cashier = db.relationship(
        'Employee',
        foreign_keys=[cashier_id],
        backref=db.backref('collected_appointment_deposit_transactions', lazy=True),
    )
    collected_by_user = db.relationship(
        'User',
        foreign_keys=[collected_by_user_id],
        backref=db.backref('appointment_deposit_transactions_collected', lazy=True),
    )

    def __repr__(self):
        return (
            f'<AppointmentDepositTransaction id={self.id} '
            f'appointment_id={self.appointment_id} '
            f'type={self.transaction_type.value} '
            f'amount={self.amount}>'
        )
