"""Read-only, presentation-safe serialization for one invoice audit timeline."""

from decimal import Decimal, InvalidOperation
from typing import Mapping

from app.extensions import db
from app.models.employee import Employee
from app.models.invoice import Invoice
from app.models.invoice_audit_event import InvoiceAuditEvent
from app.models.product import Product
from app.models.service import Service
from app.models.user import User
from app.utils.date_utils import to_iso_string


MAX_TIMELINE_EVENTS = 500

def _optional_int(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _safe_text(value, *, max_length=256):
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned[:max_length] if cleaned else None


def _money_text(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    if not amount.is_finite():
        return None
    return format(amount.quantize(Decimal("0.01")), "f")


def _bool_or_none(value):
    return value if isinstance(value, bool) else None


def _collect_item_references(snapshot, employee_ids, service_ids, product_ids):
    if not isinstance(snapshot, Mapping):
        return
    for key in ("barber_id", "assistant_id", "seller_id"):
        reference = _optional_int(snapshot.get(key))
        if reference is not None:
            employee_ids.add(reference)
    service_id = _optional_int(snapshot.get("service_id"))
    product_id = _optional_int(snapshot.get("product_id"))
    if service_id is not None:
        service_ids.add(service_id)
    if product_id is not None:
        product_ids.add(product_id)


def _safe_item_snapshot(snapshot, *, employee_names, service_names, product_names):
    if not isinstance(snapshot, Mapping):
        return {}

    item_type = _safe_text(snapshot.get("item_type"), max_length=32)
    service_id = _optional_int(snapshot.get("service_id"))
    product_id = _optional_int(snapshot.get("product_id"))
    barber_id = _optional_int(snapshot.get("barber_id"))
    assistant_id = _optional_int(snapshot.get("assistant_id"))
    seller_id = _optional_int(snapshot.get("seller_id"))
    catalog_name = _safe_text(snapshot.get("catalog_name"))
    if not catalog_name:
        if item_type == "PRODUCT_ITEM":
            catalog_name = product_names.get(product_id)
        else:
            catalog_name = service_names.get(service_id)

    quantity = _optional_int(snapshot.get("quantity"))
    return {
        "item_type": item_type,
        "catalog_name": catalog_name,
        "quantity": quantity,
        "unit_price": _money_text(snapshot.get("unit_price")),
        "line_total": _money_text(snapshot.get("line_total")),
        "barber_name": employee_names.get(barber_id),
        "assistant_name": employee_names.get(assistant_id),
        "seller_name": employee_names.get(seller_id),
    }


def _safe_discount(discount):
    if not isinstance(discount, Mapping):
        return None
    return {
        "source": _safe_text(discount.get("source"), max_length=32),
        "type": _safe_text(discount.get("type"), max_length=32),
        "configured_value": _money_text(discount.get("configured_value")),
        "amount": _money_text(discount.get("amount")),
        "promo_code": _safe_text(discount.get("promo_code"), max_length=64),
    }


def _safe_payments(payments):
    if not isinstance(payments, list):
        return []
    safe_payments = []
    for payment in payments[:20]:
        if not isinstance(payment, Mapping):
            continue
        safe_payments.append({
            "method": _safe_text(payment.get("method"), max_length=32),
            "amount": _money_text(payment.get("amount")),
            "entered_amount": _money_text(payment.get("entered_amount")),
        })
    return safe_payments


def _safe_payload(event_type, payload, *, employee_names, service_names, product_names):
    if not isinstance(payload, Mapping):
        return {}

    if event_type in ("ITEM_ADDED", "ITEM_REMOVED"):
        return _safe_item_snapshot(
            payload,
            employee_names=employee_names,
            service_names=service_names,
            product_names=product_names,
        )

    if event_type == "ITEM_UPDATED":
        return {
            "before": _safe_item_snapshot(
                payload.get("before"),
                employee_names=employee_names,
                service_names=service_names,
                product_names=product_names,
            ),
            "after": _safe_item_snapshot(
                payload.get("after"),
                employee_names=employee_names,
                service_names=service_names,
                product_names=product_names,
            ),
        }

    if event_type == "DRAFT_CREATED":
        return {"status": _safe_text(payload.get("status"), max_length=32)}

    if event_type == "DRAFT_COMMITTED":
        return {
            "previous_status": _safe_text(payload.get("previous_status"), max_length=32),
            "new_status": _safe_text(payload.get("new_status"), max_length=32),
            "item_count": _optional_int(payload.get("item_count")),
            "gross_amount": _money_text(payload.get("gross_amount")),
        }

    if event_type == "INVOICE_PAID":
        return {
            "invoice_number": _optional_int(payload.get("invoice_number")),
            "invoice_date": _safe_text(payload.get("invoice_date"), max_length=32),
            "item_count": _optional_int(payload.get("item_count")),
            "gross_total": _money_text(payload.get("gross_total")),
            "discount": _safe_discount(payload.get("discount")),
            "net_total": _money_text(payload.get("net_total")),
            "payments": _safe_payments(payload.get("payments")),
            "business_day_id": _optional_int(payload.get("business_day_id")),
            "is_fully_discounted": _bool_or_none(payload.get("is_fully_discounted")),
        }

    if event_type == "INVOICE_DELETED":
        return {
            "status": _safe_text(payload.get("status"), max_length=32),
            "invoice_number": _optional_int(payload.get("invoice_number")),
            "item_count": _optional_int(payload.get("item_count")),
            "gross_amount": _money_text(payload.get("gross_amount")),
        }

    # Unknown future event types remain renderable without exposing arbitrary JSON.
    return {}


def _actor_fallback(source, role):
    if source == "SYSTEM":
        return "النظام"
    if source == "ADMIN":
        return "الإدارة"
    if role == "CASHIER":
        return "كاشير الفرع"
    return "مستخدم غير متاح"


def build_invoice_audit_timeline(invoice_id):
    """Return a bounded safe timeline plus its branch scope, or ``None``."""
    normalized_invoice_id = int(invoice_id)
    invoice = db.session.get(Invoice, normalized_invoice_id)
    event_query = InvoiceAuditEvent.query.filter_by(invoice_id=normalized_invoice_id)
    if invoice is not None:
        branch_id = invoice.branch_id
    else:
        anchor = event_query.order_by(InvoiceAuditEvent.sequence_number.asc()).first()
        if anchor is None:
            return None
        branch_id = anchor.branch_id

    rows = (
        event_query
        .filter(InvoiceAuditEvent.branch_id == branch_id)
        .order_by(InvoiceAuditEvent.sequence_number.asc())
        .limit(MAX_TIMELINE_EVENTS + 1)
        .all()
    )

    visible_rows = rows[:MAX_TIMELINE_EVENTS]
    anchor = visible_rows[0] if visible_rows else None
    invoice_owner_id = invoice.cashier_id if invoice is not None else anchor.invoice_cashier_employee_id

    employee_ids = {invoice_owner_id} if invoice_owner_id is not None else set()
    user_ids = set()
    service_ids = set()
    product_ids = set()
    for row in visible_rows:
        if row.actor_employee_id is not None:
            employee_ids.add(row.actor_employee_id)
        if row.invoice_cashier_employee_id is not None:
            employee_ids.add(row.invoice_cashier_employee_id)
        if row.actor_user_id is not None:
            user_ids.add(row.actor_user_id)
        if row.event_type == "ITEM_UPDATED" and isinstance(row.payload, Mapping):
            _collect_item_references(row.payload.get("before"), employee_ids, service_ids, product_ids)
            _collect_item_references(row.payload.get("after"), employee_ids, service_ids, product_ids)
        elif row.event_type in ("ITEM_ADDED", "ITEM_REMOVED"):
            _collect_item_references(row.payload, employee_ids, service_ids, product_ids)

    employees = Employee.query.filter(Employee.id.in_(employee_ids)).all() if employee_ids else []
    users = User.query.filter(User.id.in_(user_ids)).all() if user_ids else []
    services = Service.query.filter(Service.id.in_(service_ids)).all() if service_ids else []
    products = Product.query.filter(Product.id.in_(product_ids)).all() if product_ids else []
    employee_names = {employee.id: employee.full_name for employee in employees}
    user_names = {user.id: user.full_name for user in users}
    service_names = {service.id: service.name for service in services}
    product_names = {product.id: product.name for product in products}

    events = []
    for row in visible_rows:
        actor_name = (
            employee_names.get(row.actor_employee_id)
            or user_names.get(row.actor_user_id)
            or _actor_fallback(row.source, row.actor_role)
        )
        owner_id = row.invoice_cashier_employee_id or invoice_owner_id
        owner_name = employee_names.get(owner_id) or "صاحب الفاتورة غير متاح"
        events.append({
            "id": row.id,
            "sequence_number": row.sequence_number,
            "event_type": row.event_type,
            "occurred_at": to_iso_string(row.occurred_at),
            "source": row.source,
            "actor": {
                "display_name": actor_name,
                "role": row.actor_role,
                "is_invoice_owner": (
                    row.actor_employee_id is not None
                    and owner_id is not None
                    and row.actor_employee_id == owner_id
                ),
            },
            "invoice_owner": {"display_name": owner_name},
            "gross_before": _money_text(row.gross_before),
            "gross_after": _money_text(row.gross_after),
            "payload": _safe_payload(
                row.event_type,
                row.payload,
                employee_names=employee_names,
                service_names=service_names,
                product_names=product_names,
            ),
        })

    return {
        "invoice_id": normalized_invoice_id,
        "branch_id": branch_id,
        "audit_history_available": bool(events),
        "events_truncated": len(rows) > MAX_TIMELINE_EVENTS,
        "events": events,
    }
