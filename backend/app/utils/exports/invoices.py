from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import and_, exists, func, or_

from app.models.appointment_deposit_transaction import AppointmentDepositTransaction, AppointmentDepositTransactionType
from app.extensions import db
from app.models.branch import Branch
from app.models.customer import Customer
from app.models.employee import Employee
from app.models.invoice import Invoice, InvoiceItem, InvoicePayment, InvoiceStatus, PaymentMethod
from app.models.promo_code import PromoDiscountType, PromoRedemption
from app.services.admin_invoice_visibility import (
    default_visible_invoice_condition,
    invoice_activity_date_condition,
    invoice_activity_sort_expression,
    visible_pending_invoice_condition,
)
from app.utils.date_utils import CAIRO_TZ
from app.utils.exports.excel import ExcelCell, ExcelColumn
from app.utils.exports.filenames import build_export_filename


INVOICE_EXPORT_DEFAULT_MODE = "invoice_summary"
INVOICE_EXPORT_CHUNK_SIZE = 1000
INVOICE_EXPORT_MAX_ROWS = 50000
INVOICE_EXPORT_MAX_COLUMNS = 25


STATUS_LABELS = {
    InvoiceStatus.PAID: "مدفوعة",
    InvoiceStatus.DRAFT: "مسودة نشطة",
    InvoiceStatus.DRAFT_COMMITTED: "معلقة / متروكة",
    InvoiceStatus.CANCELED: "ملغاة",
}

PAYMENT_METHOD_LABELS = {
    PaymentMethod.CASH: "كاش",
    PaymentMethod.VISA: "فيزا",
    PaymentMethod.INSTAPAY: "إنستا باي",
}

TYPE_FILTER_VALUES = {"جميع الفواتير", "عادية", "بخصم", "معلقة"}
STATUS_FILTER_VALUES = {
    "PAID": [InvoiceStatus.PAID],
    "DRAFT": [InvoiceStatus.DRAFT],
    "DRAFT_COMMITTED": [InvoiceStatus.DRAFT_COMMITTED],
    "CANCELED": [InvoiceStatus.CANCELED],
    "مدفوعة": [InvoiceStatus.PAID],
    "معلقة": [InvoiceStatus.DRAFT],
    "مسودة غير مكتملة": [InvoiceStatus.DRAFT_COMMITTED],
    "مسودة نشطة": [InvoiceStatus.DRAFT],
    "معلقة / متروكة": [InvoiceStatus.DRAFT_COMMITTED],
    "ملغاة": [InvoiceStatus.CANCELED],
}


INVOICE_EXPORT_COLUMNS = {
    "invoice_number": {
        "header": "رقم الفاتورة",
        "width": 16,
        "cell_type": "text",
        "supports_total": False,
    },
    "business_day_id": {
        "header": "رقم اليومية",
        "width": 14,
        "cell_type": "integer",
        "supports_total": False,
    },
    "invoice_date": {
        "header": "تاريخ الفاتورة",
        "width": 16,
        "cell_type": "date",
        "supports_total": False,
    },
    "invoice_time": {
        "header": "وقت الفاتورة",
        "width": 12,
        "cell_type": "time",
        "supports_total": False,
    },
    "created_at": {
        "header": "تاريخ الإنشاء",
        "width": 20,
        "cell_type": "datetime",
        "supports_total": False,
    },
    "branch": {
        "header": "الفرع",
        "width": 22,
        "cell_type": "text",
        "supports_total": False,
    },
    "customer_name": {
        "header": "اسم العميل",
        "width": 26,
        "cell_type": "text",
        "supports_total": False,
    },
    "customer_phone": {
        "header": "هاتف العميل",
        "width": 18,
        "cell_type": "text",
        "supports_total": False,
    },
    "cashier": {
        "header": "الكاشير",
        "width": 22,
        "cell_type": "text",
        "supports_total": False,
    },
    "barbers": {
        "header": "الحلاقون",
        "width": 28,
        "cell_type": "text",
        "supports_total": False,
    },
    "barber_count": {
        "header": "عدد الحلاقين",
        "width": 14,
        "cell_type": "integer",
        "supports_total": False,
    },
    "type": {
        "header": "نوع الفاتورة",
        "width": 16,
        "cell_type": "text",
        "supports_total": False,
    },
    "status": {
        "header": "الحالة",
        "width": 16,
        "cell_type": "text",
        "supports_total": False,
    },
    "payment_method": {
        "header": "طريقة الدفع",
        "width": 16,
        "cell_type": "text",
        "supports_total": False,
    },
    "subtotal": {
        "header": "الإجمالي قبل الخصم",
        "width": 18,
        "cell_type": "amount",
        "supports_total": True,
    },
    "discount_amount": {
        "header": "الخصم",
        "width": 16,
        "cell_type": "amount",
        "supports_total": True,
    },
    "deposit_applied": {"header": "عربون مطبق سابقًا", "width": 20, "cell_type": "amount", "supports_total": True},
    "new_collection": {"header": "تحصيل الفاتورة الجديد", "width": 20, "cell_type": "amount", "supports_total": True},
    "final_total": {
        "header": "الصافي",
        "width": 16,
        "cell_type": "amount",
        "supports_total": True,
    },
    "cash_paid": {
        "header": "المتحصل نقداً",
        "width": 18,
        "cell_type": "amount",
        "supports_total": True,
    },
    "visa_paid": {
        "header": "المتحصل فيزا",
        "width": 18,
        "cell_type": "amount",
        "supports_total": True,
    },
    "instapay_paid": {
        "header": "المتحصل إنستا باي",
        "width": 20,
        "cell_type": "amount",
        "supports_total": True,
    },
    "net_collected": {
        "header": "إجمالي المتحصل",
        "width": 18,
        "cell_type": "amount",
        "supports_total": True,
    },
    "promo_code": {
        "header": "كود الخصم",
        "width": 18,
        "cell_type": "text",
        "supports_total": False,
    },
    "promo_discount": {
        "header": "خصم الكود",
        "width": 16,
        "cell_type": "amount",
        "supports_total": True,
    },
    "promo_type": {
        "header": "نوع كود الخصم",
        "width": 16,
        "cell_type": "text",
        "supports_total": False,
    },
    "promo_eligible_subtotal": {
        "header": "المبلغ المؤهل للخصم",
        "width": 20,
        "cell_type": "amount",
        "supports_total": True,
    },
}


@dataclass(frozen=True)
class InvoiceExportFilters:
    branch_id: Optional[int]
    barber_id: Optional[int]
    cashier_id: Optional[int]
    business_day_id: Optional[int]
    payment_method: Optional[PaymentMethod]
    type_filter: Optional[str]
    status_filters: Tuple[InvoiceStatus, ...]
    search: str


def normalize_invoice_export_mode(raw_mode) -> str:
    mode = str(raw_mode or INVOICE_EXPORT_DEFAULT_MODE).strip() or INVOICE_EXPORT_DEFAULT_MODE
    if mode != INVOICE_EXPORT_DEFAULT_MODE:
        raise ValueError(f"Unsupported export mode: {mode}")
    return mode


def parse_invoice_export_date_range(payload: dict) -> tuple[date, date]:
    raw_date_from = payload.get("date_from")
    raw_date_to = payload.get("date_to")

    if raw_date_from in (None, "") or raw_date_to in (None, ""):
        raise ValueError("date_from and date_to are required.")

    try:
        date_from = date.fromisoformat(str(raw_date_from)[:10])
        date_to = date.fromisoformat(str(raw_date_to)[:10])
    except ValueError as exc:
        raise ValueError("date_from and date_to must be valid YYYY-MM-DD dates.") from exc

    if date_from > date_to:
        raise ValueError("date_from cannot be after date_to.")

    return date_from, date_to


def normalize_invoice_export_columns(raw_columns) -> list[str]:
    if not isinstance(raw_columns, list) or len(raw_columns) == 0:
        raise ValueError("columns must be a non-empty array.")

    if len(raw_columns) > INVOICE_EXPORT_MAX_COLUMNS:
        raise ValueError(f"Too many columns requested. Maximum is {INVOICE_EXPORT_MAX_COLUMNS}.")

    normalized: list[str] = []
    seen = set()

    for column_id in raw_columns:
        if column_id not in INVOICE_EXPORT_COLUMNS:
            raise ValueError(f"Unknown column: {column_id}")
        if column_id in seen:
            raise ValueError(f"Duplicate column: {column_id}")
        seen.add(column_id)
        normalized.append(column_id)

    return normalized


def normalize_invoice_export_filters(payload: dict) -> InvoiceExportFilters:
    raw_filters = payload.get("filters")
    if raw_filters is None:
        raw_filters = {}
    if not isinstance(raw_filters, dict):
        raise ValueError("filters must be an object when provided.")

    merged_filters = dict(raw_filters)
    for key in ("branch_id", "barber_id", "cashier_id", "business_day_id", "payment_method", "type", "status", "search"):
        if key not in merged_filters and key in payload:
            merged_filters[key] = payload.get(key)

    unknown_filter_keys = sorted(set(merged_filters.keys()) - {"branch_id", "barber_id", "cashier_id", "business_day_id", "payment_method", "type", "status", "search"})
    if unknown_filter_keys:
        raise ValueError(f"Unknown filter fields: {', '.join(unknown_filter_keys)}")

    return InvoiceExportFilters(
        branch_id=_parse_optional_positive_int(merged_filters.get("branch_id"), "branch_id"),
        barber_id=_parse_optional_positive_int(merged_filters.get("barber_id"), "barber_id"),
        cashier_id=_parse_optional_positive_int(merged_filters.get("cashier_id"), "cashier_id"),
        business_day_id=_parse_optional_positive_int(merged_filters.get("business_day_id"), "business_day_id"),
        payment_method=_normalize_payment_method(merged_filters.get("payment_method")),
        type_filter=_normalize_type_filter(merged_filters.get("type")),
        status_filters=_normalize_status_filter(merged_filters.get("status")),
        search=str(merged_filters.get("search") or "").strip(),
    )


def build_invoice_export_workbook_columns(column_ids: Sequence[str]) -> List[ExcelColumn]:
    return [
        ExcelColumn(
            title=INVOICE_EXPORT_COLUMNS[column_id]["header"],
            width=INVOICE_EXPORT_COLUMNS[column_id]["width"],
            cell_type=INVOICE_EXPORT_COLUMNS[column_id]["cell_type"],
        )
        for column_id in column_ids
    ]


def build_invoices_export_filename(
    *,
    requested_branch,
    allowed_branch_ids: Sequence[int],
    date_from: date,
    date_to: date,
    exported_on: date,
) -> str:
    qualifiers = [
        _resolve_invoice_scope_label(requested_branch, allowed_branch_ids),
        str(date_from),
        str(date_to),
    ]

    return build_export_filename(
        "Invoices",
        extension="xlsx",
        qualifiers=qualifiers,
        exported_on=exported_on,
    )


def count_invoice_export_rows(
    allowed_branch_ids: Sequence[int],
    *,
    filters: InvoiceExportFilters,
    date_from: date,
    date_to: date,
) -> int:
    query = _build_invoice_export_query(
        allowed_branch_ids,
        filters=filters,
        date_from=date_from,
        date_to=date_to,
    )
    return query.order_by(None).count()


def build_invoice_export_rows(
    allowed_branch_ids: Sequence[int],
    *,
    filters: InvoiceExportFilters,
    date_from: date,
    date_to: date,
    column_ids: Sequence[str],
    chunk_size: int = INVOICE_EXPORT_CHUNK_SIZE,
) -> Iterable[List[ExcelCell]]:
    require_barber_data = any(column_id in {"barbers", "barber_count"} for column_id in column_ids)
    require_payment_breakdown = any(column_id in {"cash_paid", "visa_paid", "instapay_paid", "net_collected"} for column_id in column_ids)
    require_promo_data = any(column_id in {"promo_code", "promo_discount", "promo_type", "promo_eligible_subtotal"} for column_id in column_ids)

    totals = defaultdict(lambda: Decimal("0.00"))
    label_column_index = _find_totals_label_column_index(column_ids)
    exported_row_count = 0

    last_activity_at = None
    last_invoice_id = None

    while True:
        batch_query = _build_invoice_export_query(
            allowed_branch_ids,
            filters=filters,
            date_from=date_from,
            date_to=date_to,
        )

        activity_at = invoice_activity_sort_expression()
        if last_activity_at is not None and last_invoice_id is not None:
            batch_query = batch_query.filter(
                or_(
                    activity_at < last_activity_at,
                    and_(
                        activity_at == last_activity_at,
                        Invoice.id < last_invoice_id,
                    ),
                )
            )

        batch = (
            batch_query
            .order_by(activity_at.desc().nullslast(), Invoice.id.desc())
            .limit(chunk_size)
            .all()
        )

        if not batch:
            break

        batch_invoice_ids = [row.id for row in batch]
        barber_map = _load_invoice_barber_preview(batch_invoice_ids) if require_barber_data else {}
        payment_map = _load_invoice_payment_breakdown(batch_invoice_ids) if require_payment_breakdown else {}
        promo_map = _load_invoice_promo_breakdown(batch_invoice_ids) if require_promo_data else {}

        for row in batch:
            export_values = _build_invoice_export_value_map(
                row,
                barbers=barber_map.get(row.id, []),
                payment_breakdown=payment_map.get(row.id),
                promo=promo_map.get(row.id),
            )

            for column_id in column_ids:
                if INVOICE_EXPORT_COLUMNS[column_id]["supports_total"]:
                    totals[column_id] += Decimal(str(export_values[column_id] or 0))

            yield [
                _build_invoice_export_cell(column_id, export_values[column_id])
                for column_id in column_ids
            ]
            exported_row_count += 1

        last_activity_at = batch[-1].activity_at
        last_invoice_id = batch[-1].id

    totals_row = _build_invoice_export_totals_row(column_ids, totals, label_column_index) if exported_row_count > 0 else None
    if totals_row is not None:
        yield totals_row


def _build_invoice_export_query(
    allowed_branch_ids: Sequence[int],
    *,
    filters: InvoiceExportFilters,
    date_from: date,
    date_to: date,
):
    query = (
        db.session.query(
            Invoice.id.label("id"),
            Invoice.invoice_number.label("invoice_number"),
            Invoice.invoice_date.label("invoice_date"),
            Invoice.created_at.label("created_at"),
            invoice_activity_sort_expression().label("activity_at"),
            Invoice.business_day_id.label("business_day_id"),
            Invoice.customer_name.label("invoice_customer_name"),
            Invoice.customer_phone.label("customer_phone"),
            Customer.full_name.label("customer_full_name"),
            Branch.name.label("branch_name"),
            Employee.full_name.label("cashier_name"),
            Invoice.total_amount.label("total_amount"),
            Invoice.discount_amount.label("discount_amount"),
            db.session.query(func.coalesce(func.sum(AppointmentDepositTransaction.amount), 0)).filter(
                AppointmentDepositTransaction.invoice_id == Invoice.id,
                AppointmentDepositTransaction.transaction_type == AppointmentDepositTransactionType.DEPOSIT_APPLIED
            ).correlate(Invoice).scalar_subquery().label("deposit_applied"),
            Invoice.payment_method.label("payment_method"),
            Invoice.status.label("status"),
        )
        .join(Branch, Branch.id == Invoice.branch_id)
        .join(Employee, Employee.id == Invoice.cashier_id)
        .outerjoin(Customer, Customer.id == Invoice.customer_id)
        .filter(
            Invoice.branch_id.in_(allowed_branch_ids),
            invoice_activity_date_condition(date_from=date_from, date_to=date_to),
        )
    )

    if filters.branch_id is not None:
        query = query.filter(Invoice.branch_id == filters.branch_id)

    if filters.cashier_id is not None:
        query = query.filter(Invoice.cashier_id == filters.cashier_id)

    if filters.business_day_id is not None:
        query = query.filter(Invoice.business_day_id == filters.business_day_id)

    if filters.payment_method is not None:
        query = query.filter(Invoice.payment_method == filters.payment_method)

    if filters.search:
        search_filters = [
            Customer.full_name.ilike(f"%{filters.search}%"),
            Invoice.customer_name.ilike(f"%{filters.search}%"),
        ]
        if filters.search.isdigit():
            search_filters.append(Invoice.invoice_number == int(filters.search))
        query = query.filter(or_(*search_filters))

    if filters.barber_id is not None:
        query = query.filter(
            exists().where(
                and_(
                    InvoiceItem.invoice_id == Invoice.id,
                    InvoiceItem.item_type != "PRODUCT_ITEM",
                    InvoiceItem.barber_id == filters.barber_id,
                )
            )
        )

    if filters.type_filter == "عادية":
        query = query.filter(
            Invoice.status == InvoiceStatus.PAID,
            Invoice.discount_amount == 0,
        )
    elif filters.type_filter == "بخصم":
        query = query.filter(
            Invoice.status == InvoiceStatus.PAID,
            Invoice.discount_amount > 0,
        )
    elif filters.type_filter == "معلقة":
        query = query.filter(visible_pending_invoice_condition())
    elif filters.type_filter in (None, "جميع الفواتير") and not filters.status_filters:
        query = query.filter(default_visible_invoice_condition())

    if filters.status_filters:
        query = query.filter(Invoice.status.in_(filters.status_filters))

    return query


def _load_invoice_barber_preview(invoice_ids: Sequence[int]) -> Dict[int, List[dict]]:
    rows = (
        db.session.query(
            InvoiceItem.invoice_id,
            InvoiceItem.id,
            InvoiceItem.barber_id,
            Employee.full_name,
        )
        .outerjoin(Employee, Employee.id == InvoiceItem.barber_id)
        .filter(
            InvoiceItem.invoice_id.in_(invoice_ids),
            InvoiceItem.item_type != "PRODUCT_ITEM",
            InvoiceItem.barber_id.isnot(None),
        )
        .order_by(InvoiceItem.invoice_id.asc(), InvoiceItem.id.asc())
        .all()
    )

    result = defaultdict(list)
    seen_barbers = defaultdict(set)
    for invoice_id, _item_id, barber_id, barber_name in rows:
        if barber_id in seen_barbers[invoice_id]:
            continue
        seen_barbers[invoice_id].add(barber_id)
        result[invoice_id].append({
            "id": barber_id,
            "name": barber_name or "",
        })

    return dict(result)


def _load_invoice_payment_breakdown(invoice_ids: Sequence[int]) -> Dict[int, Dict[str, Decimal]]:
    rows = (
        db.session.query(
            InvoicePayment.invoice_id,
            InvoicePayment.method,
            func.sum(InvoicePayment.amount).label("amount"),
        )
        .filter(InvoicePayment.invoice_id.in_(invoice_ids))
        .group_by(InvoicePayment.invoice_id, InvoicePayment.method)
        .all()
    )

    payment_map: Dict[int, Dict[str, Decimal]] = {}
    for invoice_id, method, amount in rows:
        bucket = payment_map.setdefault(invoice_id, {
            "has_payment_rows": True,
            "cash_paid": Decimal("0.00"),
            "visa_paid": Decimal("0.00"),
            "instapay_paid": Decimal("0.00"),
        })
        amount_decimal = Decimal(str(amount or "0.00"))
        if method == PaymentMethod.CASH:
            bucket["cash_paid"] += amount_decimal
        elif method == PaymentMethod.VISA:
            bucket["visa_paid"] += amount_decimal
        elif method == PaymentMethod.INSTAPAY:
            bucket["instapay_paid"] += amount_decimal

    return payment_map


def _load_invoice_promo_breakdown(invoice_ids: Sequence[int]) -> Dict[int, PromoRedemption]:
    redemptions = (
        PromoRedemption.query
        .filter(PromoRedemption.invoice_id.in_(invoice_ids))
        .all()
    )
    return {r.invoice_id: r for r in redemptions}


def _build_invoice_export_value_map(
    row,
    *,
    barbers: Sequence[dict],
    payment_breakdown: Optional[Dict[str, Decimal]],
    promo: Optional[PromoRedemption] = None,
) -> Dict[str, object]:
    created_at_cairo = _to_cairo_datetime(row.created_at)
    final_total = Decimal(str(row.total_amount or 0)) - Decimal(str(row.discount_amount or 0))
    final_total = final_total.quantize(Decimal("0.01"))

    if payment_breakdown and payment_breakdown.get("has_payment_rows"):
        cash_paid = payment_breakdown["cash_paid"]
        visa_paid = payment_breakdown["visa_paid"]
        instapay_paid = payment_breakdown["instapay_paid"]
    else:
        cash_paid = Decimal("0.00")
        visa_paid = Decimal("0.00")
        instapay_paid = Decimal("0.00")
        if row.status == InvoiceStatus.PAID and row.payment_method is not None and not row.deposit_applied:
            if row.payment_method == PaymentMethod.CASH:
                cash_paid = final_total
            elif row.payment_method == PaymentMethod.VISA:
                visa_paid = final_total
            elif row.payment_method == PaymentMethod.INSTAPAY:
                instapay_paid = final_total

    customer_name = row.customer_full_name or row.invoice_customer_name or "عميل مفاجئ"
    barber_names = [barber["name"] for barber in barbers if barber.get("name")]
    invoice_type = _resolve_invoice_type(row.status, row.discount_amount)

    promo_type_label = ""
    if promo:
        promo_type_label = "نسبة مئوية" if promo.discount_type_snapshot == PromoDiscountType.PERCENTAGE else "مبلغ ثابت"

    return {
        "invoice_number": str(row.invoice_number) if row.invoice_number is not None else "",
        "business_day_id": row.business_day_id,
        "invoice_date": row.invoice_date,
        "invoice_time": created_at_cairo.time().replace(second=0, microsecond=0) if created_at_cairo else None,
        "created_at": created_at_cairo.replace(microsecond=0) if created_at_cairo else None,
        "branch": row.branch_name or "",
        "customer_name": customer_name,
        "customer_phone": row.customer_phone or "",
        "cashier": row.cashier_name or "",
        "barbers": ", ".join(barber_names),
        "barber_count": len(barber_names),
        "type": invoice_type,
        "status": STATUS_LABELS.get(row.status, "معلقة"),
        "payment_method": PAYMENT_METHOD_LABELS.get(row.payment_method, row.payment_method.value if row.payment_method else ""),
        "subtotal": float(Decimal(str(row.total_amount or 0)).quantize(Decimal("0.01"))),
        "discount_amount": float(Decimal(str(row.discount_amount or 0)).quantize(Decimal("0.01"))),
        "deposit_applied": float(row.deposit_applied or 0),
        "new_collection": float(final_total - Decimal(str(row.deposit_applied or 0))) if row.status == InvoiceStatus.PAID else 0,
        "final_total": float(final_total),
        "cash_paid": float(cash_paid),
        "visa_paid": float(visa_paid),
        "instapay_paid": float(instapay_paid),
        "net_collected": float((cash_paid + visa_paid + instapay_paid).quantize(Decimal("0.01"))),
        "promo_code": promo.code_snapshot if promo else "",
        "promo_discount": float(promo.promo_discount_amount) if promo else 0.0,
        "promo_type": promo_type_label,
        "promo_eligible_subtotal": float(promo.eligible_subtotal) if promo else 0.0,
    }


def _build_invoice_export_cell(column_id: str, value: object) -> ExcelCell:
    return ExcelCell(
        value=value,
        cell_type=INVOICE_EXPORT_COLUMNS[column_id]["cell_type"],
    )


def _build_invoice_export_totals_row(
    column_ids: Sequence[str],
    totals: Dict[str, Decimal],
    label_column_index: Optional[int],
) -> Optional[List[ExcelCell]]:
    if label_column_index is None:
        return None

    if not any(INVOICE_EXPORT_COLUMNS[column_id]["supports_total"] for column_id in column_ids):
        return None

    row: List[ExcelCell] = []
    for index, column_id in enumerate(column_ids):
        if index == label_column_index:
            row.append(ExcelCell(value="الإجمالي", cell_type="text", style_id=3))
        elif INVOICE_EXPORT_COLUMNS[column_id]["supports_total"]:
            row.append(
                ExcelCell(
                    value=float(totals.get(column_id, Decimal("0.00"))),
                    cell_type=INVOICE_EXPORT_COLUMNS[column_id]["cell_type"],
                    style_id=7 if INVOICE_EXPORT_COLUMNS[column_id]["cell_type"] == "amount" else 5,
                )
            )
        else:
            row.append(ExcelCell(value="", cell_type="text", style_id=3))

    return row


def _find_totals_label_column_index(column_ids: Sequence[str]) -> Optional[int]:
    for index, column_id in enumerate(column_ids):
        if not INVOICE_EXPORT_COLUMNS[column_id]["supports_total"]:
            return index
    return None


def _resolve_invoice_type(status: InvoiceStatus, discount_amount) -> str:
    if status in (InvoiceStatus.DRAFT, InvoiceStatus.DRAFT_COMMITTED):
        return "معلقة"
    if float(discount_amount or 0) > 0:
        return "بخصم"
    return "عادية"


def _to_cairo_datetime(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(CAIRO_TZ)
    return value


def _parse_optional_positive_int(raw_value, field_name: str) -> Optional[int]:
    if raw_value in (None, "", "all", "All"):
        return None

    try:
        parsed = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be a positive integer.") from exc

    if parsed <= 0:
        raise ValueError(f"{field_name} must be a positive integer.")

    return parsed


def _normalize_payment_method(raw_value) -> Optional[PaymentMethod]:
    if raw_value in (None, "", "all", "All"):
        return None

    value = str(raw_value).strip().upper()
    value = {
        "كاش": "CASH",
        "فيزا": "VISA",
        "إنستا باي": "INSTAPAY",
    }.get(value, value)

    try:
        return PaymentMethod(value)
    except ValueError as exc:
        raise ValueError(f"Unsupported payment_method: {raw_value}") from exc


def _normalize_type_filter(raw_value) -> Optional[str]:
    if raw_value in (None, "", "جميع الفواتير"):
        return None

    value = str(raw_value).strip()
    if value not in TYPE_FILTER_VALUES:
        raise ValueError(f"Unsupported type filter: {raw_value}")
    return value


def _normalize_status_filter(raw_value) -> Tuple[InvoiceStatus, ...]:
    if raw_value in (None, "", "all", "All"):
        return ()

    value = str(raw_value).strip()
    statuses = STATUS_FILTER_VALUES.get(value)
    if not statuses:
        raise ValueError(f"Unsupported status filter: {raw_value}")
    return tuple(statuses)


def _resolve_invoice_scope_label(requested_branch, allowed_branch_ids: Sequence[int]) -> str:
    if requested_branch and str(requested_branch).lower() != "all":
        branch = Branch.query.filter(Branch.id == int(requested_branch)).first()
        return branch.name if branch else f"Branch_{requested_branch}"

    if len(allowed_branch_ids) == 1:
        branch = Branch.query.filter(Branch.id == allowed_branch_ids[0]).first()
        if branch:
            return branch.name

    return "All"
