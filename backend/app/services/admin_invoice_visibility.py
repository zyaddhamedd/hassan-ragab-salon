"""Shared read-only predicates for Admin invoice listing and export."""

from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from sqlalchemy import and_, exists, func, or_

from app.models.invoice import Invoice, InvoiceItem, InvoiceStatus
from app.models.invoice_audit_event import InvoiceAuditEvent
from app.utils.date_utils import CAIRO_TZ


DRAFT_FAMILY_STATUSES = (InvoiceStatus.DRAFT, InvoiceStatus.DRAFT_COMMITTED)


def visible_pending_invoice_condition():
    """Show useful drafts, including currently empty drafts with add evidence."""
    has_items = exists().where(InvoiceItem.invoice_id == Invoice.id)
    had_items = exists().where(and_(
        InvoiceAuditEvent.invoice_id == Invoice.id,
        InvoiceAuditEvent.event_type == "ITEM_ADDED",
    ))
    return or_(
        Invoice.status == InvoiceStatus.DRAFT_COMMITTED,
        and_(Invoice.status == InvoiceStatus.DRAFT, or_(has_items, had_items)),
    )


def default_visible_invoice_condition():
    """Default Admin list: paid invoices and useful pending invoices only."""
    return or_(
        Invoice.status == InvoiceStatus.PAID,
        visible_pending_invoice_condition(),
    )


def invoice_activity_date_condition(*, date_from: Optional[date] = None, date_to: Optional[date] = None):
    """Use invoice_date for finalized rows and Cairo-day created_at for drafts."""
    draft_status = Invoice.status.in_(DRAFT_FAMILY_STATUSES)
    draft_conditions = [draft_status]
    finalized_conditions = [~draft_status]

    if date_from is not None:
        draft_conditions.append(Invoice.created_at >= _cairo_day_start_utc(date_from))
        finalized_conditions.append(Invoice.invoice_date >= date_from)

    if date_to is not None:
        draft_conditions.append(Invoice.created_at < _cairo_day_start_utc(date_to + timedelta(days=1)))
        finalized_conditions.append(Invoice.invoice_date <= date_to)

    return or_(and_(*draft_conditions), and_(*finalized_conditions))


def invoice_activity_sort_expression():
    """Stable mixed-status activity timestamp without inventing invoice dates."""
    return func.coalesce(Invoice.paid_at, Invoice.created_at)


def load_emptied_draft_evidence(invoices):
    """Batch-load factual audit evidence for empty Draft rows without N+1s."""
    candidates = [
        invoice.id
        for invoice in invoices
        if invoice.status == InvoiceStatus.DRAFT and len(invoice.invoice_items) == 0
    ]
    if not candidates:
        return {}

    historically_used_ids = {
        invoice_id
        for (invoice_id,) in (
            InvoiceAuditEvent.query
            .with_entities(InvoiceAuditEvent.invoice_id)
            .filter(
                InvoiceAuditEvent.invoice_id.in_(candidates),
                InvoiceAuditEvent.event_type == "ITEM_ADDED",
            )
            .distinct()
            .all()
        )
    }
    if not historically_used_ids:
        return {}

    latest_removal_sequences = (
        InvoiceAuditEvent.query
        .with_entities(
            InvoiceAuditEvent.invoice_id.label("invoice_id"),
            func.max(InvoiceAuditEvent.sequence_number).label("sequence_number"),
        )
        .filter(
            InvoiceAuditEvent.invoice_id.in_(historically_used_ids),
            InvoiceAuditEvent.event_type == "ITEM_REMOVED",
        )
        .group_by(InvoiceAuditEvent.invoice_id)
        .subquery()
    )
    removal_rows = (
        InvoiceAuditEvent.query
        .with_entities(
            InvoiceAuditEvent.invoice_id,
            InvoiceAuditEvent.gross_before,
        )
        .join(
            latest_removal_sequences,
            and_(
                InvoiceAuditEvent.invoice_id == latest_removal_sequences.c.invoice_id,
                InvoiceAuditEvent.sequence_number == latest_removal_sequences.c.sequence_number,
            ),
        )
        .all()
    )
    latest_gross_before = {
        invoice_id: float(gross_before) if gross_before is not None else None
        for invoice_id, gross_before in removal_rows
    }

    return {
        invoice_id: {
            "draft_state": "EMPTIED_DRAFT",
            "last_gross_before_emptying": latest_gross_before.get(invoice_id),
        }
        for invoice_id in historically_used_ids
    }


def _cairo_day_start_utc(day: date) -> datetime:
    local_start = datetime.combine(day, time.min, tzinfo=CAIRO_TZ)
    return local_start.astimezone(timezone.utc)
