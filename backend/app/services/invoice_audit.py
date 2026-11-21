import enum
import json
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Mapping, Optional

from flask import g
from sqlalchemy import func

from app.extensions import db
from app.models.invoice import Invoice
from app.models.invoice_audit_event import (
    INVOICE_AUDIT_EVENT_TYPES,
    INVOICE_AUDIT_SOURCES,
    InvoiceAuditEvent,
)


MONEY_QUANTUM = Decimal("0.01")
PAYLOAD_VERSION = 1


class InvoiceAuditValidationError(ValueError):
    pass


class InvoiceAuditEventType(str, enum.Enum):
    DRAFT_CREATED = "DRAFT_CREATED"
    ITEM_ADDED = "ITEM_ADDED"
    ITEM_UPDATED = "ITEM_UPDATED"
    ITEM_REMOVED = "ITEM_REMOVED"
    DRAFT_COMMITTED = "DRAFT_COMMITTED"
    INVOICE_PAID = "INVOICE_PAID"
    INVOICE_DELETED = "INVOICE_DELETED"


class InvoiceAuditSource(str, enum.Enum):
    MINI = "MINI"
    ADMIN = "ADMIN"
    SYSTEM = "SYSTEM"
    BACKFILL = "BACKFILL"


def _optional_int(value, field_name):
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        raise InvoiceAuditValidationError(f"{field_name} must be an integer or null.")


def _role_value(value):
    if value is None:
        return None
    raw_value = getattr(value, "value", value)
    role = str(raw_value).strip()
    if not role or len(role) > 64:
        raise InvoiceAuditValidationError("actor role is invalid.")
    return role


@dataclass(frozen=True)
class AuditActorContext:
    user_id: Optional[int]
    employee_id: Optional[int]
    branch_id: Optional[int]
    role: Optional[str]
    registered_device_id: Optional[int]
    source: InvoiceAuditSource

    def __post_init__(self):
        try:
            source = (
                self.source
                if isinstance(self.source, InvoiceAuditSource)
                else InvoiceAuditSource(str(self.source))
            )
        except ValueError:
            raise InvoiceAuditValidationError("Invalid invoice audit source.")

        object.__setattr__(self, "source", source)
        object.__setattr__(self, "user_id", _optional_int(self.user_id, "user_id"))
        object.__setattr__(self, "employee_id", _optional_int(self.employee_id, "employee_id"))
        object.__setattr__(self, "branch_id", _optional_int(self.branch_id, "branch_id"))
        object.__setattr__(
            self,
            "registered_device_id",
            _optional_int(self.registered_device_id, "registered_device_id"),
        )
        object.__setattr__(self, "role", _role_value(self.role))

        if source in (InvoiceAuditSource.MINI, InvoiceAuditSource.ADMIN) and self.user_id is None:
            raise InvoiceAuditValidationError(f"{source.value} actor requires user_id.")
        if source == InvoiceAuditSource.MINI and self.branch_id is None:
            raise InvoiceAuditValidationError("MINI actor requires branch_id.")

    @classmethod
    def from_mini_request(cls):
        device = getattr(g, "mini_device", None)
        return cls(
            user_id=getattr(g, "user_id", None),
            employee_id=getattr(g, "cashier_id", None),
            branch_id=getattr(g, "branch_id", None),
            role=getattr(g, "role", None),
            registered_device_id=getattr(device, "id", None),
            source=InvoiceAuditSource.MINI,
        )

    @classmethod
    def from_admin_request(cls):
        return cls(
            user_id=getattr(g, "user_id", None),
            employee_id=None,
            branch_id=getattr(g, "branch_id", None),
            role=getattr(g, "user_role", None),
            registered_device_id=None,
            source=InvoiceAuditSource.ADMIN,
        )

    @classmethod
    def system(cls, *, branch_id=None):
        return cls(
            user_id=None,
            employee_id=None,
            branch_id=branch_id,
            role=None,
            registered_device_id=None,
            source=InvoiceAuditSource.SYSTEM,
        )


_SENSITIVE_PAYLOAD_KEY_PARTS = (
    "phone",
    "address",
    "password",
    "token",
    "authorization",
    "credential",
    "card_number",
    "cvv",
    "device_id",
    "raw_request",
    "request_body",
    "headers",
)


def _normalized_key(key):
    return re.sub(r"[^a-z0-9]+", "_", key.strip().lower()).strip("_")


def _normalize_payload_value(value: Any, path: str):
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise InvoiceAuditValidationError(f"Non-finite decimal at {path}.")
        return format(value, "f")
    if isinstance(value, float):
        raise InvoiceAuditValidationError(
            f"Binary float is not allowed in audit payload at {path}; use Decimal."
        )
    if isinstance(value, enum.Enum):
        return _normalize_payload_value(value.value, path)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Mapping):
        normalized = {}
        for key, nested_value in value.items():
            if not isinstance(key, str):
                raise InvoiceAuditValidationError(f"Payload key at {path} must be a string.")
            normalized_key = _normalized_key(key)
            if not normalized_key:
                raise InvoiceAuditValidationError(f"Payload key at {path} is empty.")
            if any(part in normalized_key for part in _SENSITIVE_PAYLOAD_KEY_PARTS):
                raise InvoiceAuditValidationError(
                    f"Sensitive field is not allowed in audit payload: {path}.{key}"
                )
            normalized[key] = _normalize_payload_value(nested_value, f"{path}.{key}")
        return normalized
    if isinstance(value, (list, tuple)):
        return [
            _normalize_payload_value(nested_value, f"{path}[{index}]")
            for index, nested_value in enumerate(value)
        ]
    raise InvoiceAuditValidationError(
        f"Unsupported audit payload value at {path}: {type(value).__name__}."
    )


def normalize_payload(payload):
    if payload is None:
        return {}
    if not isinstance(payload, Mapping):
        raise InvoiceAuditValidationError("Audit payload must be an object.")
    normalized = _normalize_payload_value(payload, "payload")
    json.dumps(normalized, ensure_ascii=False, sort_keys=True)
    return normalized


def _money(value, field_name):
    if value is None:
        return None
    if isinstance(value, float):
        raise InvoiceAuditValidationError(f"{field_name} must use Decimal, not float.")
    try:
        decimal_value = Decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        raise InvoiceAuditValidationError(f"{field_name} is not a valid decimal amount.")
    if not decimal_value.is_finite():
        raise InvoiceAuditValidationError(f"{field_name} must be finite.")
    return decimal_value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def _event_type(value):
    try:
        event_type = (
            value
            if isinstance(value, InvoiceAuditEventType)
            else InvoiceAuditEventType(str(value))
        )
    except ValueError:
        raise InvoiceAuditValidationError("Invalid invoice audit event type.")
    if event_type.value not in INVOICE_AUDIT_EVENT_TYPES:
        raise InvoiceAuditValidationError("Invalid invoice audit event type.")
    return event_type


def build_item_snapshot(item, *, catalog_name):
    unit_price = _money(Decimal(str(item.service_price)), "unit_price")
    quantity = int(item.quantity)
    return normalize_payload({
        "item_id": item.id,
        "item_type": item.item_type,
        "service_id": item.service_id,
        "product_id": item.product_id,
        "catalog_name": catalog_name,
        "quantity": quantity,
        "unit_price": unit_price,
        "line_total": unit_price * quantity,
        "barber_id": item.barber_id,
        "assistant_id": item.assistant_id,
        "seller_id": item.assigned_employee_id,
    })


def append_invoice_event(
    *,
    invoice_id: int,
    event_type,
    actor: AuditActorContext,
    payload=None,
    gross_before=None,
    gross_after=None,
    request_id=None,
    payload_version: int = PAYLOAD_VERSION,
):
    """Append one event to the caller's transaction without committing it."""
    if not isinstance(actor, AuditActorContext):
        raise InvoiceAuditValidationError("actor must be an AuditActorContext.")
    if actor.source.value not in INVOICE_AUDIT_SOURCES:
        raise InvoiceAuditValidationError("Invalid invoice audit source.")
    if actor.source == InvoiceAuditSource.BACKFILL:
        raise InvoiceAuditValidationError("BACKFILL is reserved and disabled in Phase 1.")

    try:
        normalized_payload_version = int(payload_version)
    except (TypeError, ValueError):
        raise InvoiceAuditValidationError("payload_version must be a positive integer.")
    if normalized_payload_version <= 0:
        raise InvoiceAuditValidationError("payload_version must be a positive integer.")

    normalized_request_id = None
    if request_id is not None:
        normalized_request_id = str(request_id).strip()
        if not normalized_request_id or len(normalized_request_id) > 128:
            raise InvoiceAuditValidationError("request_id is invalid.")

    # This is the serialization point. Every production invoice mutation must
    # use the same invoice-row lock before it writes business state or events.
    invoice = (
        Invoice.query
        .populate_existing()
        .filter(Invoice.id == int(invoice_id))
        .with_for_update()
        .first()
    )
    if invoice is None:
        raise InvoiceAuditValidationError(f"Invoice {invoice_id} not found.")
    if actor.branch_id is not None and actor.branch_id != invoice.branch_id:
        raise InvoiceAuditValidationError("Actor branch does not match invoice branch.")

    current_sequence = (
        db.session.query(func.max(InvoiceAuditEvent.sequence_number))
        .filter(InvoiceAuditEvent.invoice_id == invoice.id)
        .scalar()
    )
    next_sequence = int(current_sequence or 0) + 1

    audit_event = InvoiceAuditEvent(
        invoice_id=invoice.id,
        sequence_number=next_sequence,
        branch_id=invoice.branch_id,
        invoice_cashier_employee_id=invoice.cashier_id,
        actor_user_id=actor.user_id,
        actor_employee_id=actor.employee_id,
        actor_role=actor.role,
        event_type=_event_type(event_type).value,
        source=actor.source.value,
        payload_version=normalized_payload_version,
        business_day_id=invoice.business_day_id,
        registered_device_id=actor.registered_device_id,
        request_id=normalized_request_id,
        gross_before=_money(gross_before, "gross_before"),
        gross_after=_money(gross_after, "gross_after"),
        payload=normalize_payload(payload),
    )
    db.session.add(audit_event)
    db.session.flush([audit_event])
    return audit_event
