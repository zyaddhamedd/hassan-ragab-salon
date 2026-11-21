from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, Sequence
from zoneinfo import ZoneInfo

from sqlalchemy import exists, func

from app.services.booking_deposit_service import has_application
from app.extensions import db
from app.models.appointment_deposit_transaction import (
    AppointmentDepositTransaction,
    AppointmentDepositTransactionType,
)
from app.models.branch import Branch
from app.models.business_day import BusinessDay, BusinessDayStatus
from app.models.employee import Employee
from app.models.expense import Expense
from app.models.invoice import Invoice, InvoicePayment, InvoiceStatus, PaymentMethod
from app.utils.admin_auth import resolve_branch_scope


CAIRO_TZ = ZoneInfo("Africa/Cairo")
ARABIC_WEEKDAY_NAMES = {
    0: "الاثنين",
    1: "الثلاثاء",
    2: "الأربعاء",
    3: "الخميس",
    4: "الجمعة",
    5: "السبت",
    6: "الأحد",
}
TREASURY_PAYMENT_METHODS = (
    PaymentMethod.CASH,
    PaymentMethod.VISA,
    PaymentMethod.INSTAPAY,
)


def normalize_business_day_status(raw_status: Optional[str]) -> Optional[str]:
    if raw_status is None:
        return None

    normalized = str(raw_status).strip().upper()
    return normalized if normalized in {BusinessDayStatus.OPEN.value, BusinessDayStatus.CLOSED.value} else None


def fetch_admin_business_day_rows(
    user,
    *,
    branch_id_param=None,
    start_date_str: Optional[str] = None,
    end_date_str: Optional[str] = None,
    status: Optional[str] = None,
) -> list[dict]:
    allowed_branch_ids = resolve_branch_scope(user, branch_id_param)
    if not allowed_branch_ids:
        return []

    normalized_status = normalize_business_day_status(status)
    business_days = _fetch_business_days(
        allowed_branch_ids,
        start_date_str=start_date_str,
        end_date_str=end_date_str,
        status=normalized_status,
    )
    if not business_days:
        return []

    branch_map = {
        branch.id: branch.name
        for branch in Branch.query.filter(Branch.id.in_({day.branch_id for day in business_days})).all()
    }

    employee_ids = {day.opened_by for day in business_days if day.opened_by}
    employee_ids |= {day.closed_by for day in business_days if day.closed_by}
    employee_map = {
        employee.id: employee.full_name
        for employee in Employee.query.filter(Employee.id.in_(employee_ids)).all()
    } if employee_ids else {}

    open_day_ids = [day.id for day in business_days if day.status == BusinessDayStatus.OPEN]
    collection_snapshots = build_business_day_collection_snapshots([day.id for day in business_days])
    open_cash_out = _aggregate_cash_expenses(open_day_ids)

    rows: list[dict] = []
    for business_day in business_days:
        collection_snapshot = collection_snapshots.get(
            business_day.id,
            _empty_business_day_snapshot(),
        )
        combined = collection_snapshot["combined"]
        invoice_collections = collection_snapshot["invoice_collections"]
        deposit_collections = collection_snapshot["appointment_deposit_collections"]

        cash_value = _decimal_from_nullable(business_day.cash_in) if business_day.status == BusinessDayStatus.CLOSED else combined["cash_in"]
        expense_value = _decimal_from_nullable(business_day.cash_out) if business_day.status == BusinessDayStatus.CLOSED else open_cash_out.get(business_day.id, Decimal("0.00"))
        visa_revenue_value = combined["visa_in"]
        visa_collected_value = combined["visa_collected"]
        instapay_revenue_value = combined["instapay_in"]
        instapay_collected_value = combined["instapay_collected"]

        if business_day.status == BusinessDayStatus.CLOSED:
            theoretical_balance = _decimal_or_none(business_day.theoretical_balance)
            actual_balance = _decimal_or_none(business_day.closing_balance)
            variance = _decimal_or_none(business_day.variance)
        else:
            theoretical_balance = _decimal_from_nullable(business_day.opening_balance) + cash_value - expense_value
            actual_balance = None
            variance = None

        total_income = cash_value + visa_collected_value + instapay_collected_value
        net_income = total_income - expense_value
        opened_at_local = business_day.opened_at.astimezone(CAIRO_TZ) if business_day.opened_at else None

        rows.append({
            "id": business_day.id,
            "branch_id": business_day.branch_id,
            "branch_name": branch_map.get(business_day.branch_id, "Unknown"),
            "status": business_day.status.value,
            "status_label": "Live" if business_day.status == BusinessDayStatus.OPEN else "مغلق",
            "opened_at": business_day.opened_at.isoformat() if business_day.opened_at else None,
            "closed_at": business_day.closed_at.isoformat() if business_day.closed_at else None,
            "opened_by": employee_map.get(business_day.opened_by, "Unknown") if business_day.opened_by else "Unknown",
            "closed_by": employee_map.get(business_day.closed_by) if business_day.closed_by else None,
            "opening_balance": float(_decimal_from_nullable(business_day.opening_balance)),
            "cash_in": float(cash_value),
            "visa_in": float(visa_revenue_value),
            "instapay_in": float(instapay_revenue_value),
            "visa_collected": float(visa_collected_value),
            "instapay_collected": float(instapay_collected_value),
            "invoice_cash_in": float(invoice_collections["cash_in"]),
            "invoice_visa_in": float(invoice_collections["visa_in"]),
            "invoice_instapay_in": float(invoice_collections["instapay_in"]),
            "invoice_visa_collected": float(invoice_collections["visa_collected"]),
            "invoice_instapay_collected": float(invoice_collections["instapay_collected"]),
            "appointment_deposit_cash_in": float(deposit_collections["cash_in"]),
            "appointment_deposit_visa_in": float(deposit_collections["visa_in"]),
            "appointment_deposit_instapay_in": float(deposit_collections["instapay_in"]),
            "appointment_deposit_visa_collected": float(deposit_collections["visa_collected"]),
            "appointment_deposit_instapay_collected": float(deposit_collections["instapay_collected"]),
            "cash_out": float(expense_value),
            "theoretical_balance": float(theoretical_balance) if theoretical_balance is not None else None,
            "actual_balance": float(actual_balance) if actual_balance is not None else None,
            "variance": float(variance) if variance is not None else None,
            "day_label": _format_business_day_label(opened_at_local),
            "business_date": opened_at_local.date().isoformat() if opened_at_local else None,
            "total_sales": float(collection_snapshot["invoice_total"]),
            "appointment_deposit_total": float(collection_snapshot["deposit_total"]),
            "total_income": float(total_income),
            "total_collected": float(collection_snapshot["combined_total"]),
            "net_income": float(net_income),
        })

    return rows


def build_business_day_collection_snapshot(business_day_id: int) -> dict:
    return build_business_day_collection_snapshots([business_day_id]).get(
        business_day_id,
        _empty_business_day_snapshot(),
    )


def build_business_day_collection_snapshots(business_day_ids: Sequence[int]) -> dict[int, dict]:
    if not business_day_ids:
        return {}

    invoice_revenue_by_method = {
        payment_method: _aggregate_invoice_totals(
            business_day_ids,
            payment_method=payment_method,
            legacy_net_amount=(payment_method == PaymentMethod.CASH),
        )
        for payment_method in TREASURY_PAYMENT_METHODS
    }
    invoice_collected_by_method = {
        payment_method: _aggregate_invoice_totals(
            business_day_ids,
            payment_method=payment_method,
            use_entered_amount=(payment_method != PaymentMethod.CASH),
            legacy_net_amount=(payment_method == PaymentMethod.CASH),
        )
        for payment_method in TREASURY_PAYMENT_METHODS
    }
    deposit_by_method = {
        payment_method: _aggregate_appointment_deposit_totals(
            business_day_ids,
            payment_method=payment_method,
        )
        for payment_method in TREASURY_PAYMENT_METHODS
    }

    snapshots: dict[int, dict] = {}
    for business_day_id in business_day_ids:
        invoice_totals = _empty_method_totals()
        invoice_collected_totals = _empty_method_totals()
        deposit_totals = _empty_method_totals()
        combined_totals = _empty_method_totals()

        for payment_method in TREASURY_PAYMENT_METHODS:
            invoice_value = invoice_revenue_by_method[payment_method].get(business_day_id, Decimal("0.00"))
            invoice_collected_value = invoice_collected_by_method[payment_method].get(business_day_id, Decimal("0.00"))
            deposit_value = deposit_by_method[payment_method].get(business_day_id, Decimal("0.00"))

            invoice_totals[_revenue_field_name(payment_method)] = invoice_value
            invoice_collected_totals[_collected_field_name(payment_method)] = invoice_collected_value
            deposit_totals[_revenue_field_name(payment_method)] = deposit_value
            deposit_totals[_collected_field_name(payment_method)] = deposit_value
            combined_totals[_revenue_field_name(payment_method)] = invoice_value + deposit_value
            combined_totals[_collected_field_name(payment_method)] = invoice_collected_value + deposit_value

        invoice_total = (
            invoice_totals["cash_in"] +
            invoice_totals["visa_in"] +
            invoice_totals["instapay_in"]
        )
        deposit_total = (
            deposit_totals["cash_in"] +
            deposit_totals["visa_in"] +
            deposit_totals["instapay_in"]
        )
        combined_total = (
            combined_totals["cash_in"] +
            combined_totals["visa_collected"] +
            combined_totals["instapay_collected"]
        )

        snapshots[business_day_id] = {
            "invoice_collections": {
                **invoice_totals,
                "visa_collected": invoice_collected_totals["visa_collected"],
                "instapay_collected": invoice_collected_totals["instapay_collected"],
            },
            "appointment_deposit_collections": deposit_totals,
            "combined": combined_totals,
            "invoice_total": invoice_total,
            "deposit_total": deposit_total,
            "combined_total": combined_total,
        }

    return snapshots


def _fetch_business_days(
    allowed_branch_ids: Sequence[int],
    *,
    start_date_str: Optional[str],
    end_date_str: Optional[str],
    status: Optional[str],
) -> list[BusinessDay]:
    query = BusinessDay.query.filter(BusinessDay.branch_id.in_(allowed_branch_ids))

    if status:
        query = query.filter(BusinessDay.status == BusinessDayStatus(status))

    if start_date_str:
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
        utc_start = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=CAIRO_TZ).astimezone(timezone.utc)
        query = query.filter(BusinessDay.opened_at >= utc_start)

    if end_date_str:
        end_date = datetime.strptime(end_date_str, "%Y-%m-%d").date()
        utc_end = datetime.combine(end_date, datetime.max.time()).replace(tzinfo=CAIRO_TZ).astimezone(timezone.utc)
        query = query.filter(BusinessDay.opened_at <= utc_end)

    return query.order_by(BusinessDay.opened_at.desc()).all()


def _aggregate_invoice_totals(
    business_day_ids: Sequence[int],
    *,
    payment_method: PaymentMethod,
    use_entered_amount: bool = False,
    legacy_net_amount: bool = False,
) -> dict[int, Decimal]:
    if not business_day_ids:
        return {}

    payment_expression = func.coalesce(InvoicePayment.entered_amount, InvoicePayment.amount) if use_entered_amount else InvoicePayment.amount
    legacy_expression = (
        Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)
        if legacy_net_amount else
        Invoice.total_amount
    )

    combined_totals: defaultdict[int, Decimal] = defaultdict(lambda: Decimal("0.00"))

    payment_rows = (
        db.session.query(
            Invoice.business_day_id,
            func.sum(payment_expression).label("value"),
        )
        .join(InvoicePayment, InvoicePayment.invoice_id == Invoice.id)
        .filter(
            Invoice.business_day_id.in_(business_day_ids),
            Invoice.status == InvoiceStatus.PAID,
            InvoicePayment.method == payment_method,
        )
        .group_by(Invoice.business_day_id)
        .all()
    )

    legacy_rows = (
        db.session.query(
            Invoice.business_day_id,
            func.sum(legacy_expression).label("value"),
        )
        .filter(
            Invoice.business_day_id.in_(business_day_ids),
            Invoice.status == InvoiceStatus.PAID,
            Invoice.payment_method == payment_method,
            ~exists().where(InvoicePayment.invoice_id == Invoice.id),
            ~has_application(Invoice.id),
        )
        .group_by(Invoice.business_day_id)
        .all()
    )

    for row in payment_rows:
        combined_totals[row.business_day_id] += Decimal(str(row.value or "0.00"))

    for row in legacy_rows:
        combined_totals[row.business_day_id] += Decimal(str(row.value or "0.00"))

    return dict(combined_totals)


def _aggregate_appointment_deposit_totals(
    business_day_ids: Sequence[int],
    *,
    payment_method: PaymentMethod,
) -> dict[int, Decimal]:
    if not business_day_ids:
        return {}

    rows = (
        db.session.query(
            AppointmentDepositTransaction.business_day_id,
            func.sum(AppointmentDepositTransaction.amount).label("value"),
        )
        .filter(
            AppointmentDepositTransaction.business_day_id.in_(business_day_ids),
            AppointmentDepositTransaction.payment_method == payment_method,
            AppointmentDepositTransaction.transaction_type == AppointmentDepositTransactionType.DEPOSIT_COLLECTION,
        )
        .group_by(AppointmentDepositTransaction.business_day_id)
        .all()
    )

    return {
        row.business_day_id: Decimal(str(row.value or "0.00"))
        for row in rows
    }


def _aggregate_cash_expenses(business_day_ids: Sequence[int]) -> dict[int, Decimal]:
    if not business_day_ids:
        return {}

    rows = (
        db.session.query(
            Expense.business_day_id,
            func.sum(Expense.amount).label("cash_out"),
        )
        .filter(
            Expense.business_day_id.in_(business_day_ids),
            Expense.is_cash_event == True,  # noqa: E712
        )
        .group_by(Expense.business_day_id)
        .all()
    )

    return {
        row.business_day_id: Decimal(str(row.cash_out or "0.00"))
        for row in rows
    }


def _empty_method_totals() -> dict[str, Decimal]:
    return {
        "cash_in": Decimal("0.00"),
        "visa_in": Decimal("0.00"),
        "instapay_in": Decimal("0.00"),
        "visa_collected": Decimal("0.00"),
        "instapay_collected": Decimal("0.00"),
    }


def _empty_business_day_snapshot() -> dict:
    return {
        "invoice_collections": _empty_method_totals(),
        "appointment_deposit_collections": _empty_method_totals(),
        "combined": _empty_method_totals(),
        "invoice_total": Decimal("0.00"),
        "deposit_total": Decimal("0.00"),
        "combined_total": Decimal("0.00"),
    }


def _revenue_field_name(payment_method: PaymentMethod) -> str:
    return {
        PaymentMethod.CASH: "cash_in",
        PaymentMethod.VISA: "visa_in",
        PaymentMethod.INSTAPAY: "instapay_in",
    }[payment_method]


def _collected_field_name(payment_method: PaymentMethod) -> str:
    return {
        PaymentMethod.CASH: "cash_in",
        PaymentMethod.VISA: "visa_collected",
        PaymentMethod.INSTAPAY: "instapay_collected",
    }[payment_method]


def _decimal_from_nullable(value) -> Decimal:
    return Decimal(str(value or "0.00"))


def _decimal_or_none(value) -> Optional[Decimal]:
    if value is None:
        return None
    return Decimal(str(value))


def _format_business_day_label(opened_at_local: Optional[datetime]) -> str:
    if opened_at_local is None:
        return ""

    weekday_label = ARABIC_WEEKDAY_NAMES.get(opened_at_local.weekday(), "")
    return f"{weekday_label} {opened_at_local.date().isoformat()}".strip()
