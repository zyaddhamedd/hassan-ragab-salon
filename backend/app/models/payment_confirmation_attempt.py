from datetime import datetime, timezone
import enum

from app.extensions import db


class PaymentConfirmationAttemptStatus(enum.Enum):
    PROCESSING = "PROCESSING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"


class PaymentConfirmationAttempt(db.Model):
    __tablename__ = "payment_confirmation_attempts"

    payment_attempt_id = db.Column(db.String(36), primary_key=True)
    invoice_id = db.Column(
        db.Integer,
        db.ForeignKey("invoices.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    branch_id = db.Column(
        db.Integer,
        db.ForeignKey("branches.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    cashier_id = db.Column(
        db.Integer,
        db.ForeignKey("employees.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    request_fingerprint = db.Column(db.String(64), nullable=False)
    status = db.Column(
        db.Enum(
            PaymentConfirmationAttemptStatus,
            name="payment_confirmation_attempt_status_enum",
            native_enum=False,
            create_constraint=True,
        ),
        nullable=False,
        default=PaymentConfirmationAttemptStatus.PROCESSING,
        index=True,
    )
    failure_code = db.Column(db.String(64), nullable=True)
    failure_message = db.Column(db.String(255), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    invoice = db.relationship("Invoice", foreign_keys=[invoice_id])
