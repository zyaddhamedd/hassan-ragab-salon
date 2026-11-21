from datetime import datetime, timezone

from sqlalchemy import event
from sqlalchemy.dialects.postgresql import JSONB

from app.extensions import db


INVOICE_AUDIT_EVENT_TYPES = (
    "DRAFT_CREATED",
    "ITEM_ADDED",
    "ITEM_UPDATED",
    "ITEM_REMOVED",
    "DRAFT_COMMITTED",
    "INVOICE_PAID",
    "INVOICE_DELETED",
)

INVOICE_AUDIT_SOURCES = (
    "MINI",
    "ADMIN",
    "SYSTEM",
    "BACKFILL",
)


class InvoiceAuditImmutableError(RuntimeError):
    pass


class InvoiceAuditEvent(db.Model):
    """Append-only invoice evidence with logical, non-cascading references."""

    __tablename__ = "invoice_audit_events"

    id = db.Column(
        db.BigInteger().with_variant(db.Integer(), "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    invoice_id = db.Column(db.Integer, nullable=False)
    sequence_number = db.Column(db.Integer, nullable=False)
    branch_id = db.Column(db.Integer, nullable=False)
    invoice_cashier_employee_id = db.Column(db.Integer, nullable=True)
    actor_user_id = db.Column(db.Integer, nullable=True)
    actor_employee_id = db.Column(db.Integer, nullable=True)
    actor_role = db.Column(db.String(64), nullable=True)
    event_type = db.Column(db.String(32), nullable=False)
    source = db.Column(db.String(16), nullable=False)
    payload_version = db.Column(
        db.Integer,
        nullable=False,
        default=1,
        server_default="1",
    )
    occurred_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=db.func.now(),
    )
    business_day_id = db.Column(db.Integer, nullable=True)
    registered_device_id = db.Column(db.Integer, nullable=True)
    request_id = db.Column(db.String(128), nullable=True)
    gross_before = db.Column(db.Numeric(12, 2), nullable=True)
    gross_after = db.Column(db.Numeric(12, 2), nullable=True)
    payload = db.Column(
        db.JSON(none_as_null=True).with_variant(JSONB(none_as_null=True), "postgresql"),
        nullable=False,
        default=dict,
        server_default=db.text("'{}'"),
    )

    __table_args__ = (
        db.UniqueConstraint(
            "invoice_id",
            "sequence_number",
            name="uq_invoice_audit_events_invoice_sequence",
        ),
        db.CheckConstraint(
            "sequence_number > 0",
            name="ck_invoice_audit_events_positive_sequence",
        ),
        db.CheckConstraint(
            "payload_version > 0",
            name="ck_invoice_audit_events_positive_payload_version",
        ),
        db.CheckConstraint(
            "event_type IN ('DRAFT_CREATED', 'ITEM_ADDED', 'ITEM_UPDATED', "
            "'ITEM_REMOVED', 'DRAFT_COMMITTED', 'INVOICE_PAID', 'INVOICE_DELETED')",
            name="ck_invoice_audit_events_event_type",
        ),
        db.CheckConstraint(
            "source IN ('MINI', 'ADMIN', 'SYSTEM', 'BACKFILL')",
            name="ck_invoice_audit_events_source",
        ),
        db.Index(
            "ix_invoice_audit_events_branch_occurred_id",
            "branch_id",
            db.desc("occurred_at"),
            db.desc("id"),
        ),
        db.Index(
            "ix_invoice_audit_events_branch_type_occurred",
            "branch_id",
            "event_type",
            db.desc("occurred_at"),
        ),
        db.Index(
            "ix_invoice_audit_events_actor_occurred",
            "actor_user_id",
            db.desc("occurred_at"),
        ),
    )


def _reject_invoice_audit_mutation(_mapper, _connection, _target):
    raise InvoiceAuditImmutableError("Invoice audit events are append-only.")


event.listen(InvoiceAuditEvent, "before_update", _reject_invoice_audit_mutation)
event.listen(InvoiceAuditEvent, "before_delete", _reject_invoice_audit_mutation)
