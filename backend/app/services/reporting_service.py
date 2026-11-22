"""Read-only aggregation for the Admin Reports module.

Metric contracts
----------------
service_gross_value
    Sum of ``invoice_items.service_price * quantity`` for SERVICE_ITEM rows on
    PAID invoices. Invoice-level discounts are deliberately not allocated.
service_units
    Sum of SERVICE_ITEM quantities on PAID invoices.
average_realized_service_price
    service_gross_value / service_units.
product_gross_sales_value
    Sum of ``invoice_items.service_price * quantity`` for PRODUCT_ITEM rows on
    PAID invoices. This is sales value, never profit or margin.
product_units_sold
    Sum of PRODUCT_ITEM quantities on PAID invoices.
finance_net_sales
    Paid invoice gross less invoice-level discount on ``Invoice.invoice_date``.
operating_expenses
    Business expenses on ``Expense.expense_date`` excluding payroll settlement
    category codes ADVANCE, DISCOUNT, OVERTIME, and DAILY_PERCENTAGE.
operating_contribution
    finance_net_sales less recorded invoice commission snapshots and operating
    expenses. This is a contribution indicator, never profit.
invoice_collections
    Modern ``InvoicePayment.amount`` plus legacy invoice net assigned to the
    legacy payment method. Raw tender is disclosed separately.
treasury_cash
    Exact BusinessDay membership: opening plus cash invoice/deposit collections
    less cash Expense events. Closed days retain their stored close snapshot.

Sales use ``Invoice.invoice_date``: the Cairo business date assigned when an
invoice becomes PAID. Stock movement context uses Cairo boundaries around
``StockMovement.created_at`` and is labelled separately in the API response.
Catalog names/categories are current labels because invoice items do not store
historical catalog snapshots.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Optional, Sequence

from sqlalchemy import Numeric, and_, case, cast, desc, exists, func, or_
from sqlalchemy.orm import aliased

from app.extensions import db
from app.models.appointment_deposit_transaction import (
    AppointmentDepositTransaction,
    AppointmentDepositTransactionType,
)
from app.models.appointment import Appointment, AppointmentStatus
from app.models.attendance import Attendance, AttendanceCheckoutSource, AttendanceStatus
from app.models.branch import Branch
from app.models.business_day import BusinessDay, BusinessDayStatus
from app.models.customer import Customer
from app.models.customer_balance import CustomerBalance
from app.services.booking_deposit_service import has_application
from app.models.employee import Employee
from app.models.employee_financial_action import EmployeeActionType, EmployeeFinancialAction
from app.models.expense import Expense
from app.models.expense_category import ExpenseCategory
from app.models.inventory_batch import BranchInventoryBatch, InventoryBatch
from app.models.invoice import Invoice, InvoiceItem, InvoicePayment, InvoiceStatus, PaymentMethod
from app.models.invoice_audit_event import InvoiceAuditEvent
from app.models.promo_code import PromoRedemption
from app.models.product import Product, ProductBranchStock, StockMovement
from app.models.service import BranchService, Service, ServiceCategory
from app.models.supply_operations import (
    StockReturnRequest,
    StockShipment,
    StockShipmentItem,
    StockSupplyRequest,
    StockSupplyRequestItem,
)
from app.services.financial_service import cairo_day_window
from app.utils.date_utils import CAIRO_TZ, get_cairo_date


REPORT_SORT_DIRECTIONS = {"asc", "desc"}
COMPARISON_NEUTRAL_BAND_PERCENT = 2.0
SERVICE_DECLINE_MIN_PREVIOUS_UNITS = 3
SERVICE_DECLINE_MIN_PREVIOUS_GROSS = 100.0
SERVICE_DECLINE_PERCENT_THRESHOLD = -25.0
SERVICE_CONCENTRATION_ATTENTION_PERCENT = 45.0
PRODUCT_SLOW_MOVING_MAX_UNITS = 1
PRODUCT_HIGH_STOCK_MIN_UNITS = 10
PRODUCT_TOP_SELLER_ATTENTION_LIMIT = 10
SALES_DECLINE_ATTENTION_PERCENT = -20.0
SALES_CONCENTRATION_ATTENTION_PERCENT = 45.0
SALES_PAYMENT_DOMINANCE_PERCENT = 70.0
SALES_DISCOUNT_RATE_INCREASE_POINTS = 2.0
FINANCE_VARIANCE_ATTENTION_AMOUNT = 1.0
FINANCE_CHANGE_ATTENTION_AMOUNT = 100.0
NON_OPERATING_EXPENSE_CODES = {"ADVANCE", "DISCOUNT", "OVERTIME", "DAILY_PERCENTAGE"}
BRANCH_LOW_BASE_INVOICES = 5
BRANCH_DECLINE_ATTENTION_PERCENT = -20.0
BRANCH_EXPENSE_RATIO_INCREASE_POINTS = 5.0
EMPLOYEE_MODES = {"BARBER", "ASSISTANT", "CASHIER"}
EMPLOYEE_SERVICE_LOW_BASE_UNITS = 5
EMPLOYEE_SERVICE_RANKING_MIN_UNITS = 3
EMPLOYEE_AVERAGE_MIN_UNITS = 5
EMPLOYEE_CUSTOMER_MIN_COUNT = 5
EMPLOYEE_ATTENDANCE_MIN_SESSIONS = 3
EMPLOYEE_ATTENDANCE_MIN_HOURS = 8.0
EMPLOYEE_ATTENDANCE_MIN_COVERAGE = 80.0
CUSTOMER_DORMANCY_OPTIONS = {30, 60, 90, 180}
CUSTOMER_COHORTS = {"FIRST_KNOWN", "PREVIOUSLY_KNOWN"}
CUSTOMER_RECENCY_BUCKETS = {"0_30", "31_60", "61_90", "91_PLUS"}
CUSTOMER_REPEAT_FILTERS = {"BEHAVIORAL", "TRANSACTION", "NON_REPEAT"}
SERVICE_SORT_FIELDS = {
    "gross_value": "gross_value",
    "units": "units",
    "average_price": "average_price",
    "name": "service_name",
}
PRODUCT_SORT_FIELDS = {
    "gross_sales_value": "gross_sales_value",
    "units_sold": "units_sold",
    "current_stock": "current_stock",
    "name": "name",
}
SALES_SORT_FIELDS = {
    "invoice_date": Invoice.invoice_date,
    "invoice_number": Invoice.invoice_number,
    "gross_sales": Invoice.total_amount,
    "discount_amount": Invoice.discount_amount,
    "net_sales": Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0),
}


@dataclass(frozen=True)
class ReportFilters:
    date_from: date
    date_to: date
    category_id: Optional[int] = None
    service_id: Optional[int] = None
    barber_id: Optional[int] = None
    product_id: Optional[int] = None
    product_category: Optional[str] = None
    payment_method: Optional[str] = None
    promo_code: Optional[str] = None
    cashier_id: Optional[int] = None
    sales_item_type: Optional[str] = None
    expense_category_id: Optional[int] = None
    business_day_status: Optional[str] = None
    employee_mode: str = "BARBER"
    employee_id: Optional[int] = None
    customer_cohort: Optional[str] = None
    customer_recency_bucket: Optional[str] = None
    customer_repeat: Optional[str] = None
    dormancy_days: int = 90


def parse_report_date_range(date_from_raw, date_to_raw) -> tuple[date, date]:
    today = get_cairo_date()
    default_from = today.replace(day=1)
    try:
        date_from = date.fromisoformat(str(date_from_raw)[:10]) if date_from_raw else default_from
        date_to = date.fromisoformat(str(date_to_raw)[:10]) if date_to_raw else today
    except ValueError as exc:
        raise ValueError("date_from and date_to must use YYYY-MM-DD.") from exc
    if date_from > date_to:
        raise ValueError("date_from cannot be after date_to.")
    return date_from, date_to


def parse_optional_positive_int(raw_value, field_name: str) -> Optional[int]:
    if raw_value in (None, "", "all", "ALL"):
        return None
    try:
        value = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be an integer.") from exc
    if value <= 0:
        raise ValueError(f"{field_name} must be positive.")
    return value


def build_report_filters(source) -> ReportFilters:
    date_from, date_to = parse_report_date_range(source.get("date_from"), source.get("date_to"))
    product_category = str(source.get("product_category") or "").strip() or None
    payment_method = str(source.get("payment_method") or "").strip().upper() or None
    if payment_method and payment_method not in {method.value for method in PaymentMethod}:
        raise ValueError("payment_method must be CASH, VISA, VISA_1, VISA_2, or INSTAPAY.")
    sales_item_type = str(source.get("sales_item_type") or "").strip().upper() or None
    if sales_item_type and sales_item_type not in {"SERVICE_ITEM", "PRODUCT_ITEM"}:
        raise ValueError("sales_item_type must be SERVICE_ITEM or PRODUCT_ITEM.")
    business_day_status = str(source.get("business_day_status") or "").strip().upper() or None
    if business_day_status and business_day_status not in {status.value for status in BusinessDayStatus}:
        raise ValueError("business_day_status must be OPEN or CLOSED.")
    employee_mode = str(source.get("employee_mode") or "BARBER").strip().upper()
    if employee_mode not in EMPLOYEE_MODES:
        raise ValueError("employee_mode must be BARBER, ASSISTANT, or CASHIER.")
    customer_cohort = str(source.get("customer_cohort") or "").strip().upper() or None
    if customer_cohort and customer_cohort not in CUSTOMER_COHORTS:
        raise ValueError("customer_cohort must be FIRST_KNOWN or PREVIOUSLY_KNOWN.")
    customer_recency_bucket = str(source.get("customer_recency_bucket") or "").strip().upper() or None
    if customer_recency_bucket and customer_recency_bucket not in CUSTOMER_RECENCY_BUCKETS:
        raise ValueError("customer_recency_bucket must be 0_30, 31_60, 61_90, or 91_PLUS.")
    customer_repeat = str(source.get("customer_repeat") or "").strip().upper() or None
    if customer_repeat and customer_repeat not in CUSTOMER_REPEAT_FILTERS:
        raise ValueError("customer_repeat must be BEHAVIORAL, TRANSACTION, or NON_REPEAT.")
    dormancy_raw = source.get("dormancy_days")
    try:
        dormancy_days = int(dormancy_raw) if dormancy_raw not in (None, "") else 90
    except (TypeError, ValueError) as exc:
        raise ValueError("dormancy_days must be 30, 60, 90, or 180.") from exc
    if dormancy_days not in CUSTOMER_DORMANCY_OPTIONS:
        raise ValueError("dormancy_days must be 30, 60, 90, or 180.")
    return ReportFilters(
        date_from=date_from,
        date_to=date_to,
        category_id=parse_optional_positive_int(source.get("category_id"), "category_id"),
        service_id=parse_optional_positive_int(source.get("service_id"), "service_id"),
        barber_id=parse_optional_positive_int(source.get("barber_id"), "barber_id"),
        product_id=parse_optional_positive_int(source.get("product_id"), "product_id"),
        product_category=product_category,
        payment_method=payment_method,
        promo_code=str(source.get("promo_code") or "").strip().upper() or None,
        cashier_id=parse_optional_positive_int(source.get("cashier_id"), "cashier_id"),
        sales_item_type=sales_item_type,
        expense_category_id=parse_optional_positive_int(source.get("expense_category_id"), "expense_category_id"),
        business_day_status=business_day_status,
        employee_mode=employee_mode,
        employee_id=parse_optional_positive_int(source.get("employee_id"), "employee_id"),
        customer_cohort=customer_cohort,
        customer_recency_bucket=customer_recency_bucket,
        customer_repeat=customer_repeat,
        dormancy_days=dormancy_days,
    )


def _branch_conditions(allowed_branch_ids: Sequence[int]):
    return [Invoice.branch_id.in_(allowed_branch_ids)] if allowed_branch_ids else [False]


def _service_conditions(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, include_dates=True):
    conditions = [
        Invoice.status == InvoiceStatus.PAID,
        InvoiceItem.item_type == "SERVICE_ITEM",
        InvoiceItem.service_id.isnot(None),
        *_branch_conditions(allowed_branch_ids),
    ]
    if include_dates:
        conditions.extend([
            Invoice.invoice_date >= filters.date_from,
            Invoice.invoice_date <= filters.date_to,
        ])
    if filters.category_id:
        conditions.append(Service.category_id == filters.category_id)
    if filters.service_id:
        conditions.append(InvoiceItem.service_id == filters.service_id)
    if filters.barber_id:
        conditions.append(InvoiceItem.barber_id == filters.barber_id)
    return conditions


def _product_sales_conditions(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, include_dates=True):
    conditions = [
        Invoice.status == InvoiceStatus.PAID,
        InvoiceItem.item_type == "PRODUCT_ITEM",
        InvoiceItem.product_id.isnot(None),
        *_branch_conditions(allowed_branch_ids),
    ]
    if include_dates:
        conditions.extend([
            Invoice.invoice_date >= filters.date_from,
            Invoice.invoice_date <= filters.date_to,
        ])
    if filters.product_id:
        conditions.append(InvoiceItem.product_id == filters.product_id)
    if filters.product_category:
        conditions.append(Product.category == filters.product_category)
    return conditions


def _service_base_query(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    return (
        db.session.query(InvoiceItem)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .join(Service, Service.id == InvoiceItem.service_id)
        .join(ServiceCategory, ServiceCategory.id == Service.category_id)
        .filter(*_service_conditions(allowed_branch_ids, filters))
    )


def _product_sales_base_query(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    return (
        db.session.query(InvoiceItem)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .join(Product, Product.id == InvoiceItem.product_id)
        .filter(*_product_sales_conditions(allowed_branch_ids, filters))
    )


def _change_percent(current: float, previous: float) -> Optional[float]:
    """Return a percent change only when the previous value is a valid base."""
    if previous == 0:
        return 0.0 if current == 0 else None
    return round(((current - previous) / previous) * 100.0, 1)


def _comparison(current: float, previous: float):
    return {
        "current": current,
        "previous": previous,
        "absolute_change": round(current - previous, 2),
        "percent_change": _change_percent(current, previous),
    }


def _sales_summary_comparison(current: dict, previous: dict):
    """Canonical Sales comparison contract shared with Executive Overview."""
    return {
        "net_sales": _comparison(current["net_sales"], previous["net_sales"]),
        "paid_invoice_count": _comparison(current["paid_invoice_count"], previous["paid_invoice_count"]),
        "average_ticket": _comparison(current["average_ticket"], previous["average_ticket"]),
        "discount_amount": _comparison(current["discount_amount"], previous["discount_amount"]),
    }


def _finance_performance_comparison(current: dict, previous: dict):
    """Canonical Finance comparison, including signed contribution bases."""
    comparison = {
        key: _comparison(current[key], previous[key])
        for key in ("net_sales", "operating_expenses", "recorded_commission_cost", "operating_contribution")
    }
    if previous["operating_contribution"] < 0:
        comparison["operating_contribution"]["percent_change"] = round(
            (
                (current["operating_contribution"] - previous["operating_contribution"])
                / abs(previous["operating_contribution"])
            ) * 100.0,
            1,
        )
    return comparison


def _previous_period(filters: ReportFilters) -> tuple[date, date]:
    period_days = (filters.date_to - filters.date_from).days + 1
    previous_to = filters.date_from - timedelta(days=1)
    return previous_to - timedelta(days=period_days - 1), previous_to


def _previous_filters(filters: ReportFilters) -> ReportFilters:
    previous_from, previous_to = _previous_period(filters)
    return ReportFilters(
        date_from=previous_from,
        date_to=previous_to,
        category_id=filters.category_id,
        service_id=filters.service_id,
        barber_id=filters.barber_id,
        product_id=filters.product_id,
        product_category=filters.product_category,
        payment_method=filters.payment_method,
        promo_code=filters.promo_code,
        cashier_id=filters.cashier_id,
        sales_item_type=filters.sales_item_type,
        expense_category_id=filters.expense_category_id,
        business_day_status=filters.business_day_status,
        employee_mode=filters.employee_mode,
        employee_id=filters.employee_id,
        customer_cohort=filters.customer_cohort,
        customer_recency_bucket=filters.customer_recency_bucket,
        customer_repeat=filters.customer_repeat,
        dormancy_days=filters.dormancy_days,
    )


def _share(part: float, total: float) -> float:
    return round((part / total) * 100.0, 1) if total else 0.0


def _comparison_insight(label: str, comparison: dict) -> Optional[dict]:
    percent = comparison["percent_change"]
    if percent is None:
        return None
    if abs(percent) < COMPARISON_NEUTRAL_BAND_PERCENT:
        return {"code": "STABLE", "text": f"{label} دون تغير ملحوظ مقارنة بالفترة السابقة."}
    direction = "ارتفعت" if percent > 0 else "انخفضت"
    return {
        "code": "PERIOD_CHANGE",
        "text": f"{label} {direction} {abs(percent):.1f}% مقارنة بالفترة السابقة.",
    }


def _pagination_payload(page: int, per_page: int, total: int):
    total_pages = max((total + per_page - 1) // per_page, 1) if total else 1
    return {
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": total_pages,
        "has_more": page < total_pages,
    }


def _rank_winner(rows: Iterable, id_index: int, value_index: int):
    winners = {}
    for row in rows:
        owner_id = row[id_index]
        if owner_id not in winners or float(row[value_index] or 0) > float(winners[owner_id][value_index] or 0):
            winners[owner_id] = row
    return winners


def _scoped_active_services(allowed_branch_ids: Sequence[int], filters: Optional[ReportFilters] = None):
    if not allowed_branch_ids:
        return []
    assigned_ids = (
        db.session.query(BranchService.service_id)
        .filter(BranchService.branch_id.in_(allowed_branch_ids), BranchService.is_active.is_(True))
    )
    query = (
        db.session.query(Service.id, Service.name, Service.category_id, ServiceCategory.name.label("category_name"))
        .join(ServiceCategory, ServiceCategory.id == Service.category_id)
        .filter(Service.is_active.is_(True), Service.id.in_(assigned_ids))
    )
    if filters and filters.category_id:
        query = query.filter(Service.category_id == filters.category_id)
    if filters and filters.service_id:
        query = query.filter(Service.id == filters.service_id)
    return query.order_by(Service.name.asc()).all()


def _service_filter_options(allowed_branch_ids: Sequence[int]):
    base_conditions = [
        Invoice.status == InvoiceStatus.PAID,
        InvoiceItem.item_type == "SERVICE_ITEM",
        InvoiceItem.service_id.isnot(None),
        *_branch_conditions(allowed_branch_ids),
    ]
    historically_sold = (
        db.session.query(Service.id, Service.name, Service.category_id)
        .join(InvoiceItem, InvoiceItem.service_id == Service.id)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(*base_conditions)
        .distinct()
        .order_by(Service.name.asc())
        .all()
    )
    assigned = _scoped_active_services(allowed_branch_ids)
    services_by_id = {row.id: row for row in historically_sold}
    services_by_id.update({row.id: row for row in assigned})
    services = sorted(services_by_id.values(), key=lambda row: row.name.casefold())
    category_ids = {row.category_id for row in services}
    categories = (
        ServiceCategory.query.filter(ServiceCategory.id.in_(category_ids)).order_by(ServiceCategory.name.asc()).all()
        if category_ids else []
    )
    barbers = (
        db.session.query(Employee.id, Employee.full_name)
        .join(InvoiceItem, InvoiceItem.barber_id == Employee.id)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(*base_conditions, InvoiceItem.barber_id.isnot(None))
        .distinct()
        .order_by(Employee.full_name.asc())
        .all()
    )
    branches = Branch.query.filter(Branch.id.in_(allowed_branch_ids)).order_by(Branch.name.asc()).all() if allowed_branch_ids else []
    return {
        "categories": [{"id": row.id, "name": row.name} for row in categories],
        "services": [{"id": row.id, "name": row.name, "category_id": row.category_id} for row in services],
        "barbers": [{"id": row.id, "name": row.full_name} for row in barbers],
        "branches": [{"id": row.id, "name": row.name} for row in branches],
    }


def _build_service_intelligence(
    allowed_branch_ids: Sequence[int],
    filters: ReportFilters,
    ranked_services: list[dict],
    previous_services: list[dict],
    categories: list[dict],
    branches: list[dict],
    gross_comparison: dict,
):
    current_total = float(gross_comparison["current"] or 0)
    previous_total = float(gross_comparison["previous"] or 0)
    top_one_share = ranked_services[0]["contribution_percent"] if ranked_services else 0.0
    top_three_share = _share(sum(row["gross_value"] for row in ranked_services[:3]), current_total)
    concentration = {
        "top_one_service_share": top_one_share,
        "top_three_services_share": top_three_share,
        "top_category_share": categories[0]["contribution_percent"] if categories else 0.0,
        "top_branch_share": branches[0]["contribution_percent"] if branches else 0.0,
    }

    insights = []
    if ranked_services and current_total > 0:
        leader = ranked_services[0]
        insights.append({
            "code": "TOP_SERVICE_SHARE",
            "text": f"{leader['service_name']} تمثل {leader['contribution_percent']:.1f}% من قيمة الخدمات خلال الفترة.",
        })
    if len(ranked_services) >= 3:
        insights.append({
            "code": "TOP_THREE_CONCENTRATION",
            "text": f"أعلى 3 خدمات تمثل {top_three_share:.1f}% من إجمالي قيمة الخدمات.",
        })
    if categories and current_total > 0:
        insights.append({
            "code": "TOP_CATEGORY_SHARE",
            "text": f"تصنيف {categories[0]['category_name']} يساهم بنسبة {categories[0]['contribution_percent']:.1f}% من قيمة الخدمات.",
        })
    comparison_insight = _comparison_insight("قيمة الخدمات", gross_comparison)
    if comparison_insight:
        insights.append(comparison_insight)

    current_by_id = {row["service_id"]: row for row in ranked_services}
    previous_by_id = {row["service_id"]: row for row in previous_services}
    candidates = {
        row.id: {
            "service_id": row.id,
            "service_name": row.name,
            "category_id": row.category_id,
            "category_name": row.category_name,
        }
        for row in _scoped_active_services(allowed_branch_ids, filters)
    }
    for row in [*ranked_services, *previous_services]:
        candidates.setdefault(row["service_id"], {
            "service_id": row["service_id"],
            "service_name": row["service_name"],
            "category_id": row["category_id"],
            "category_name": row["category_name"],
        })

    weak_services = []
    decline_candidates = []
    for service_id, candidate in candidates.items():
        current = current_by_id.get(service_id)
        previous = previous_by_id.get(service_id)
        current_units = int((current or {}).get("units", 0))
        current_gross = float((current or {}).get("gross_value", 0))
        previous_units = int((previous or {}).get("units", 0))
        previous_gross = float((previous or {}).get("gross_value", 0))
        percent_change = _change_percent(current_gross, previous_gross)
        base = {
            **candidate,
            "current_units": current_units,
            "current_gross_value": current_gross,
            "previous_units": previous_units,
            "previous_gross_value": previous_gross,
            "percent_change": percent_change,
        }
        if current_units == 0:
            weak_services.append({**base, "reason": "ZERO_ACTIVITY"})
        elif (
            previous_units >= SERVICE_DECLINE_MIN_PREVIOUS_UNITS
            and previous_gross >= SERVICE_DECLINE_MIN_PREVIOUS_GROSS
            and percent_change is not None
            and percent_change <= SERVICE_DECLINE_PERCENT_THRESHOLD
        ):
            decline_candidates.append({**base, "reason": "MATERIAL_DECLINE"})
        elif current_units <= 1:
            weak_services.append({**base, "reason": "LOW_ACTIVITY"})
    decline_candidates.sort(key=lambda row: row["percent_change"] if row["percent_change"] is not None else 0)
    weak_services = (decline_candidates + sorted(weak_services, key=lambda row: (row["current_units"], -row["previous_units"])))[:8]

    attention = []
    if (
        gross_comparison["previous"] >= SERVICE_DECLINE_MIN_PREVIOUS_GROSS
        and gross_comparison["percent_change"] is not None
        and gross_comparison["percent_change"] <= -20.0
    ):
        attention.append({
            "code": "REPORT_DECLINE",
            "label": "تراجع يحتاج مراجعة",
            "detail": f"قيمة الخدمات أقل {abs(gross_comparison['percent_change']):.1f}% من الفترة السابقة.",
            "tone": "neutral",
        })
    if top_one_share >= SERVICE_CONCENTRATION_ATTENTION_PERCENT:
        attention.append({
            "code": "HIGH_CONCENTRATION",
            "label": "اعتماد مرتفع",
            "detail": f"خدمة واحدة تمثل {top_one_share:.1f}% من قيمة الخدمات.",
            "tone": "neutral",
        })
    for row in decline_candidates[:2]:
        previous_share = _share(row["previous_gross_value"], previous_total)
        detail = f"{row['service_name']} انخفضت {abs(row['percent_change']):.1f}% بعد {row['previous_units']} خدمات في الفترة السابقة."
        if previous_share >= 15:
            detail += f" وكانت تمثل {previous_share:.1f}% من القيمة السابقة."
        attention.append({
            "code": "SERVICE_DECLINE",
            "entity_id": row["service_id"],
            "label": "نشاط منخفض",
            "detail": detail,
            "tone": "neutral",
        })
    zero_activity = next((row for row in weak_services if row["reason"] == "ZERO_ACTIVITY"), None)
    if zero_activity:
        attention.append({
            "code": "ZERO_ACTIVITY",
            "entity_id": zero_activity["service_id"],
            "label": "بدون نشاط مدفوع",
            "detail": f"{zero_activity['service_name']} لم تسجل نشاطاً مدفوعاً ضمن الفلاتر الحالية.",
            "tone": "neutral",
        })
    return concentration, insights[:4], attention[:5], weak_services


def build_services_report(
    allowed_branch_ids: Sequence[int],
    filters: ReportFilters,
    *,
    page: int = 1,
    per_page: int = 12,
    search: str = "",
    sort_by: str = "gross_value",
    sort_dir: str = "desc",
):
    gross_expr = InvoiceItem.service_price * InvoiceItem.quantity
    base_query = _service_base_query(allowed_branch_ids, filters)
    gross_value, units, invoice_count = base_query.with_entities(
        func.coalesce(func.sum(gross_expr), 0),
        func.coalesce(func.sum(InvoiceItem.quantity), 0),
        func.count(func.distinct(Invoice.id)),
    ).one()
    gross_value = float(gross_value or 0)
    units = int(units or 0)

    previous_filters = _previous_filters(filters)
    previous_gross, previous_units, previous_invoice_count = (
        _service_base_query(allowed_branch_ids, previous_filters)
        .with_entities(
            func.coalesce(func.sum(gross_expr), 0),
            func.coalesce(func.sum(InvoiceItem.quantity), 0),
            func.count(func.distinct(Invoice.id)),
        ).one()
    )
    previous_gross = float(previous_gross or 0)
    previous_units = int(previous_units or 0)
    previous_invoice_count = int(previous_invoice_count or 0)

    service_rows = (
        base_query.with_entities(
            Service.id,
            Service.name,
            ServiceCategory.id.label("category_id"),
            ServiceCategory.name.label("category_name"),
            func.sum(InvoiceItem.quantity).label("units"),
            func.sum(gross_expr).label("gross_value"),
            func.count(func.distinct(Invoice.id)).label("invoice_count"),
        )
        .group_by(Service.id, Service.name, ServiceCategory.id, ServiceCategory.name)
        .order_by(desc("gross_value"), Service.name.asc())
        .all()
    )
    total_gross = gross_value
    ranked_services = [
        {
            "service_id": row.id,
            "service_name": row.name,
            "category_id": row.category_id,
            "category_name": row.category_name,
            "units": int(row.units or 0),
            "gross_value": float(row.gross_value or 0),
            "average_price": round(float(row.gross_value or 0) / int(row.units or 1), 2),
            "contribution_percent": round(float(row.gross_value or 0) / total_gross * 100, 1) if total_gross else 0.0,
            "invoice_count": int(row.invoice_count or 0),
        }
        for row in service_rows
    ]

    previous_service_rows = (
        _service_base_query(allowed_branch_ids, previous_filters)
        .with_entities(
            Service.id,
            Service.name,
            ServiceCategory.id.label("category_id"),
            ServiceCategory.name.label("category_name"),
            func.sum(InvoiceItem.quantity).label("units"),
            func.sum(gross_expr).label("gross_value"),
            func.count(func.distinct(Invoice.id)).label("invoice_count"),
        )
        .group_by(Service.id, Service.name, ServiceCategory.id, ServiceCategory.name)
        .all()
    )
    previous_services = [{
        "service_id": row.id,
        "service_name": row.name,
        "category_id": row.category_id,
        "category_name": row.category_name,
        "units": int(row.units or 0),
        "gross_value": float(row.gross_value or 0),
        "invoice_count": int(row.invoice_count or 0),
    } for row in previous_service_rows]

    category_rows = (
        base_query.with_entities(
            ServiceCategory.id,
            ServiceCategory.name,
            func.sum(InvoiceItem.quantity).label("units"),
            func.sum(gross_expr).label("gross_value"),
        )
        .group_by(ServiceCategory.id, ServiceCategory.name)
        .order_by(desc("gross_value"))
        .all()
    )
    categories = [{
        "category_id": row.id,
        "category_name": row.name,
        "units": int(row.units or 0),
        "gross_value": float(row.gross_value or 0),
        "contribution_percent": round(float(row.gross_value or 0) / total_gross * 100, 1) if total_gross else 0.0,
    } for row in category_rows]

    branch_rows = (
        base_query.join(Branch, Branch.id == Invoice.branch_id)
        .with_entities(
            Branch.id,
            Branch.name,
            func.sum(InvoiceItem.quantity).label("units"),
            func.sum(gross_expr).label("gross_value"),
        )
        .group_by(Branch.id, Branch.name)
        .order_by(desc("gross_value"))
        .all()
    )
    branches = [{
        "branch_id": row.id,
        "branch_name": row.name,
        "units": int(row.units or 0),
        "gross_value": float(row.gross_value or 0),
        "contribution_percent": round(float(row.gross_value or 0) / total_gross * 100, 1) if total_gross else 0.0,
    } for row in branch_rows]

    barber_rows = (
        base_query.join(Employee, Employee.id == InvoiceItem.barber_id)
        .filter(InvoiceItem.barber_id.isnot(None))
        .with_entities(
            Employee.id,
            Employee.full_name,
            func.sum(InvoiceItem.quantity).label("units"),
            func.sum(gross_expr).label("gross_value"),
            func.count(func.distinct(Invoice.id)).label("invoice_count"),
            func.count(func.distinct(Invoice.customer_id)).label("customer_count"),
        )
        .group_by(Employee.id, Employee.full_name)
        .order_by(desc("gross_value"))
        .limit(8)
        .all()
    )
    barbers = [{
        "barber_id": row.id,
        "barber_name": row.full_name,
        "units": int(row.units or 0),
        "gross_attributed_value": float(row.gross_value or 0),
        "invoice_count": int(row.invoice_count or 0),
        "customer_count": int(row.customer_count or 0),
    } for row in barber_rows]

    trend_rows = (
        base_query.with_entities(
            Invoice.invoice_date.label("date"),
            func.sum(gross_expr).label("gross_value"),
            func.sum(InvoiceItem.quantity).label("units"),
            func.count(func.distinct(Invoice.id)).label("paid_invoice_count"),
        )
        .group_by(Invoice.invoice_date)
        .order_by(Invoice.invoice_date.asc())
        .all()
    )
    trend = [{
        "date": row.date.isoformat(),
        "gross_value": float(row.gross_value or 0),
        "units": int(row.units or 0),
        "paid_invoice_count": int(row.paid_invoice_count or 0),
    } for row in trend_rows]

    filtered = ranked_services
    normalized_search = search.strip().casefold()
    if normalized_search:
        filtered = [row for row in filtered if normalized_search in row["service_name"].casefold() or normalized_search in row["category_name"].casefold()]
    sort_key = SERVICE_SORT_FIELDS.get(sort_by, "gross_value")
    reverse = sort_dir not in REPORT_SORT_DIRECTIONS or sort_dir == "desc"
    filtered = sorted(filtered, key=lambda row: (row[sort_key], row["service_name"]), reverse=reverse)
    total = len(filtered)
    page_rows = filtered[(page - 1) * per_page: page * per_page]

    visible_ids = [row["service_id"] for row in page_rows]
    top_branch_map = {}
    top_barber_map = {}
    if visible_ids:
        service_branch_rows = (
            base_query.join(Branch, Branch.id == Invoice.branch_id)
            .filter(InvoiceItem.service_id.in_(visible_ids))
            .with_entities(InvoiceItem.service_id, Branch.id, Branch.name, func.sum(gross_expr).label("gross_value"))
            .group_by(InvoiceItem.service_id, Branch.id, Branch.name).all()
        )
        service_barber_rows = (
            base_query.join(Employee, Employee.id == InvoiceItem.barber_id)
            .filter(InvoiceItem.service_id.in_(visible_ids), InvoiceItem.barber_id.isnot(None))
            .with_entities(InvoiceItem.service_id, Employee.id, Employee.full_name, func.sum(gross_expr).label("gross_value"))
            .group_by(InvoiceItem.service_id, Employee.id, Employee.full_name).all()
        )
        top_branch_map = _rank_winner(service_branch_rows, 0, 3)
        top_barber_map = _rank_winner(service_barber_rows, 0, 3)
    for row in page_rows:
        branch = top_branch_map.get(row["service_id"])
        barber = top_barber_map.get(row["service_id"])
        row["top_branch"] = {"id": branch[1], "name": branch[2]} if branch else None
        row["top_barber"] = {"id": barber[1], "name": barber[2]} if barber else None

    top_service = ranked_services[0] if ranked_services else None
    top_category = categories[0] if categories else None
    gross_comparison = _comparison(gross_value, previous_gross)
    units_comparison = _comparison(units, previous_units)
    invoices_comparison = _comparison(int(invoice_count or 0), previous_invoice_count)
    concentration, insights, attention, weak_services = _build_service_intelligence(
        allowed_branch_ids,
        filters,
        ranked_services,
        previous_services,
        categories,
        branches,
        gross_comparison,
    )
    return {
        "meta": {
            "date_basis": "paid_invoice_date_cairo",
            "date_from": filters.date_from.isoformat(),
            "date_to": filters.date_to.isoformat(),
            "previous_date_from": previous_filters.date_from.isoformat(),
            "previous_date_to": previous_filters.date_to.isoformat(),
            "currency": "EGP",
            "category_label_basis": "current_catalog",
        },
        "summary": {
            "service_gross_value": gross_value,
            "service_units": units,
            "average_realized_service_price": round(gross_value / units, 2) if units else 0.0,
            "paid_invoice_count": int(invoice_count or 0),
            "period_change_percent": gross_comparison["percent_change"],
            "top_service": top_service,
            "top_category": top_category,
        },
        "comparison": {
            "service_gross_value": gross_comparison,
            "service_units": units_comparison,
            "paid_invoice_count": invoices_comparison,
        },
        "concentration": concentration,
        "insights": insights,
        "attention": attention,
        "weak_services": weak_services,
        "trend": trend,
        "service_ranking": ranked_services[:8],
        "categories": categories,
        "branches": branches,
        "barbers": barbers,
        "table": {"items": page_rows, "pagination": _pagination_payload(page, per_page, total)},
        "filter_options": _service_filter_options(allowed_branch_ids),
    }


def build_service_drilldown(allowed_branch_ids: Sequence[int], filters: ReportFilters, service_id: int):
    service = db.session.get(Service, service_id)
    if not service:
        return None
    scoped_filters = ReportFilters(
        date_from=filters.date_from,
        date_to=filters.date_to,
        category_id=filters.category_id,
        service_id=service_id,
        barber_id=filters.barber_id,
    )
    report = build_services_report(allowed_branch_ids, scoped_filters, per_page=1)
    base_query = _service_base_query(allowed_branch_ids, scoped_filters)
    gross_expr = InvoiceItem.service_price * InvoiceItem.quantity
    context_filters = ReportFilters(
        date_from=filters.date_from,
        date_to=filters.date_to,
        category_id=filters.category_id,
        barber_id=filters.barber_id,
    )
    context_total = float(
        _service_base_query(allowed_branch_ids, context_filters)
        .with_entities(func.coalesce(func.sum(gross_expr), 0)).scalar() or 0
    )
    recent_rows = (
        base_query.with_entities(
            Invoice.id,
            Invoice.invoice_number,
            Invoice.invoice_date,
            Branch.name.label("branch_name"),
            Employee.full_name.label("barber_name"),
            InvoiceItem.quantity,
            gross_expr.label("gross_value"),
        )
        .join(Branch, Branch.id == Invoice.branch_id)
        .outerjoin(Employee, Employee.id == InvoiceItem.barber_id)
        .order_by(Invoice.invoice_date.desc(), Invoice.id.desc())
        .limit(8).all()
    )
    service_total = float(report["summary"]["service_gross_value"] or 0)
    contribution_share = _share(service_total, context_total)
    top_branch_share = report["branches"][0]["contribution_percent"] if report["branches"] else 0.0
    top_barber_share = _share(report["barbers"][0]["gross_attributed_value"], service_total) if report["barbers"] else 0.0
    drilldown_insights = []
    comparison_insight = _comparison_insight("قيمة الخدمة", report["comparison"]["service_gross_value"])
    if comparison_insight:
        drilldown_insights.append(comparison_insight)
    if context_total > 0:
        drilldown_insights.append({"code": "CONTRIBUTION", "text": f"الخدمة تمثل {contribution_share:.1f}% من قيمة الخدمات ضمن الفلاتر الحالية."})
    if report["branches"]:
        drilldown_insights.append({"code": "TOP_BRANCH", "text": f"{report['branches'][0]['branch_name']} يمثل {top_branch_share:.1f}% من قيمة هذه الخدمة."})
    if report["barbers"]:
        drilldown_insights.append({"code": "TOP_BARBER", "text": f"{report['barbers'][0]['barber_name']} منسوب إليه {top_barber_share:.1f}% من قيمة هذه الخدمة."})
    return {
        "service": {
            "id": service.id,
            "name": service.name,
            "category_name": service.category.name if service.category else "غير مصنف",
        },
        "meta": report["meta"],
        "summary": report["summary"],
        "comparison": report["comparison"],
        "analysis": {
            "contribution_share": contribution_share,
            "top_branch_share": top_branch_share,
            "top_barber_share": top_barber_share,
            "insights": drilldown_insights[:4],
        },
        "trend": report["trend"],
        "branches": report["branches"],
        "barbers": report["barbers"],
        "recent_invoices": [{
            "invoice_id": row.id,
            "invoice_number": row.invoice_number,
            "date": row.invoice_date.isoformat() if row.invoice_date else None,
            "branch_name": row.branch_name,
            "barber_name": row.barber_name,
            "units": int(row.quantity or 0),
            "gross_value": float(row.gross_value or 0),
        } for row in recent_rows],
    }


def _product_filter_options(allowed_branch_ids: Sequence[int]):
    scoped_product_ids = db.session.query(ProductBranchStock.product_id).filter(ProductBranchStock.branch_id.in_(allowed_branch_ids))
    products = (
        Product.query.filter(Product.id.in_(scoped_product_ids), Product.is_active.is_(True))
        .order_by(Product.name.asc()).all()
        if allowed_branch_ids else []
    )
    categories = sorted({product.category for product in products if product.category})
    branches = Branch.query.filter(Branch.id.in_(allowed_branch_ids)).order_by(Branch.name.asc()).all() if allowed_branch_ids else []
    return {
        "categories": categories,
        "products": [{"id": row.id, "name": row.name, "category": row.category} for row in products],
        "branches": [{"id": row.id, "name": row.name} for row in branches],
    }


def _scoped_stock_rows(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    query = (
        db.session.query(
            Product.id,
            Product.name,
            Product.category,
            Product.min_stock_threshold,
            func.coalesce(func.sum(ProductBranchStock.stock_quantity), 0).label("current_stock"),
            func.count(func.distinct(case((ProductBranchStock.stock_quantity > 0, ProductBranchStock.branch_id)))).label("branches_carrying"),
        )
        .join(ProductBranchStock, ProductBranchStock.product_id == Product.id)
        .filter(ProductBranchStock.branch_id.in_(allowed_branch_ids), Product.is_active.is_(True))
    )
    if filters.product_id:
        query = query.filter(Product.id == filters.product_id)
    if filters.product_category:
        query = query.filter(Product.category == filters.product_category)
    return query.group_by(Product.id, Product.name, Product.category, Product.min_stock_threshold)


def _median(values: Sequence[int]) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return float(ordered[middle])
    return (ordered[middle - 1] + ordered[middle]) / 2.0


def _build_product_intelligence(
    ranking: list[dict],
    detailed: list[dict],
    branches: list[dict],
    sales_comparison: dict,
    units_comparison: dict,
    inventory_health: dict,
):
    total_sales = float(sales_comparison["current"] or 0)
    top_one_share = ranking[0]["contribution_percent"] if ranking else 0.0
    top_three_share = _share(sum(row["gross_sales_value"] for row in ranking[:3]), total_sales)
    concentration = {
        "top_one_product_share": top_one_share,
        "top_three_products_share": top_three_share,
        "top_branch_share": branches[0]["contribution_percent"] if branches else 0.0,
    }

    detailed_by_id = {row["product_id"]: row for row in detailed}
    top_stock_attention = []
    for ranked in ranking[:PRODUCT_TOP_SELLER_ATTENTION_LIMIT]:
        product = detailed_by_id.get(ranked["product_id"])
        if product and product["stock_state"] in {"LOW", "OUT"}:
            top_stock_attention.append(product)

    zero_sales_with_stock = [row for row in detailed if row["current_stock"] > 0 and row["units_sold"] == 0]
    slow_movers = [
        {**row, "reason": "LOW_MOVEMENT"}
        for row in detailed
        if row["current_stock"] > 0 and row["units_sold"] <= PRODUCT_SLOW_MOVING_MAX_UNITS
    ]
    slow_movers.sort(key=lambda row: (-row["current_stock"], row["units_sold"], row["product_name"]))

    positive_units = [row["units_sold"] for row in detailed if row["units_sold"] > 0]
    sales_threshold = _median(positive_units)
    quadrants = {
        "HIGH_SALES_LOW_STOCK": [],
        "HIGH_SALES_HEALTHY_STOCK": [],
        "LOW_SALES_HIGH_STOCK": [],
        "LOW_SALES_LOW_STOCK": [],
    }
    for row in detailed:
        high_sales = sales_threshold > 0 and row["units_sold"] >= sales_threshold
        low_stock = row["stock_state"] in {"LOW", "OUT"}
        if high_sales and low_stock:
            key = "HIGH_SALES_LOW_STOCK"
        elif high_sales:
            key = "HIGH_SALES_HEALTHY_STOCK"
        elif low_stock:
            key = "LOW_SALES_LOW_STOCK"
        else:
            key = "LOW_SALES_HIGH_STOCK"
        quadrants[key].append({
            "product_id": row["product_id"],
            "product_name": row["product_name"],
            "units_sold": row["units_sold"],
            "current_stock": row["current_stock"],
            "stock_state": row["stock_state"],
        })
    matrix_labels = {
        "HIGH_SALES_LOW_STOCK": "حركة مرتفعة ومخزون منخفض",
        "HIGH_SALES_HEALTHY_STOCK": "حركة مرتفعة وتغطية مستقرة",
        "LOW_SALES_HIGH_STOCK": "حركة منخفضة ومخزون مرتفع",
        "LOW_SALES_LOW_STOCK": "حركة منخفضة ومخزون منخفض",
    }
    matrix = {
        "sales_units_threshold": sales_threshold,
        "threshold_basis": "median_positive_units_in_selected_period",
        "quadrants": [{
            "key": key,
            "label": matrix_labels[key],
            "count": len(items),
            "items": sorted(items, key=lambda row: (-row["units_sold"], -row["current_stock"]))[:5],
        } for key, items in quadrants.items()],
    }

    insights = []
    if ranking and total_sales > 0:
        insights.append({
            "code": "TOP_PRODUCT_SHARE",
            "text": f"{ranking[0]['product_name']} يمثل {top_one_share:.1f}% من قيمة مبيعات المنتجات.",
        })
    if len(ranking) >= 3:
        insights.append({
            "code": "TOP_THREE_CONCENTRATION",
            "text": f"أعلى 3 منتجات تمثل {top_three_share:.1f}% من قيمة مبيعات المنتجات.",
        })
    if top_stock_attention:
        insights.append({
            "code": "TOP_SELLERS_STOCK_ATTENTION",
            "text": f"{len(top_stock_attention)} من أعلى المنتجات مبيعاً لديها مخزون منخفض أو نافد حالياً.",
        })
    elif zero_sales_with_stock:
        insights.append({
            "code": "STOCK_WITHOUT_SALES",
            "text": f"{len(zero_sales_with_stock)} منتجات لديها مخزون حالي دون مبيعات خلال الفترة.",
        })
    comparison_insight = _comparison_insight("الوحدات المباعة", units_comparison)
    if comparison_insight:
        insights.append(comparison_insight)

    attention = []
    for row in top_stock_attention[:3]:
        attention.append({
            "code": "TOP_SELLER_OUT_OF_STOCK" if row["stock_state"] == "OUT" else "TOP_SELLER_LOW_STOCK",
            "entity_id": row["product_id"],
            "label": "مخزون نافد" if row["stock_state"] == "OUT" else "مخزون منخفض",
            "detail": f"{row['product_name']} باع {row['units_sold']} وحدة ومخزونه الحالي {row['current_stock']}.",
            "tone": "attention",
        })
    if inventory_health["expired_units"] > 0:
        attention.append({
            "code": "EXPIRED_EXPOSURE",
            "label": "تعرض صلاحية",
            "detail": f"يوجد {inventory_health['expired_units']} وحدة منتهية الصلاحية ضمن المخزون الحالي المسجل بالدفعات.",
            "tone": "attention",
        })
    elif inventory_health["expiring_within_30_days_units"] > 0:
        attention.append({
            "code": "NEAR_EXPIRY_EXPOSURE",
            "label": "صلاحية قريبة",
            "detail": f"يوجد {inventory_health['expiring_within_30_days_units']} وحدة تنتهي خلال 30 يوماً.",
            "tone": "neutral",
        })
    for row in slow_movers:
        high_stock_floor = max(int(row["min_stock_threshold"] or 0) * 2, PRODUCT_HIGH_STOCK_MIN_UNITS)
        if row["current_stock"] >= high_stock_floor:
            attention.append({
                "code": "HIGH_STOCK_LOW_SALES",
                "entity_id": row["product_id"],
                "label": "منخفض الحركة",
                "detail": f"{row['product_name']} لديه {row['current_stock']} وحدة حالياً مقابل {row['units_sold']} مباعة خلال الفترة.",
                "tone": "neutral",
            })
            break
    return concentration, insights[:4], attention[:5], slow_movers[:8], matrix


def build_products_report(
    allowed_branch_ids: Sequence[int],
    filters: ReportFilters,
    *,
    page: int = 1,
    per_page: int = 12,
    search: str = "",
    sort_by: str = "gross_sales_value",
    sort_dir: str = "desc",
):
    gross_expr = InvoiceItem.service_price * InvoiceItem.quantity
    sales_base = _product_sales_base_query(allowed_branch_ids, filters)
    sales_value, units_sold, paid_invoice_count = sales_base.with_entities(
        func.coalesce(func.sum(gross_expr), 0),
        func.coalesce(func.sum(InvoiceItem.quantity), 0),
        func.count(func.distinct(Invoice.id)),
    ).one()
    sales_value = float(sales_value or 0)
    units_sold = int(units_sold or 0)

    previous_filters = _previous_filters(filters)
    previous_sales_value, previous_units_sold, previous_invoice_count = (
        _product_sales_base_query(allowed_branch_ids, previous_filters)
        .with_entities(
            func.coalesce(func.sum(gross_expr), 0),
            func.coalesce(func.sum(InvoiceItem.quantity), 0),
            func.count(func.distinct(Invoice.id)),
        ).one()
    )
    previous_sales_value = float(previous_sales_value or 0)
    previous_units_sold = int(previous_units_sold or 0)
    previous_invoice_count = int(previous_invoice_count or 0)

    sales_rows = (
        sales_base.with_entities(
            Product.id,
            Product.name,
            Product.category,
            func.sum(InvoiceItem.quantity).label("units_sold"),
            func.sum(gross_expr).label("gross_sales_value"),
            func.count(func.distinct(Invoice.id)).label("invoice_count"),
        )
        .group_by(Product.id, Product.name, Product.category)
        .order_by(desc("gross_sales_value"), Product.name.asc()).all()
    )
    sales_map = {row.id: row for row in sales_rows}
    ranking = [{
        "product_id": row.id,
        "product_name": row.name,
        "category": row.category,
        "units_sold": int(row.units_sold or 0),
        "gross_sales_value": float(row.gross_sales_value or 0),
        "average_selling_price": round(float(row.gross_sales_value or 0) / int(row.units_sold or 1), 2),
        "contribution_percent": round(float(row.gross_sales_value or 0) / sales_value * 100, 1) if sales_value else 0.0,
        "invoice_count": int(row.invoice_count or 0),
    } for row in sales_rows]

    trend_rows = (
        sales_base.with_entities(
            Invoice.invoice_date.label("date"),
            func.sum(gross_expr).label("gross_sales_value"),
            func.sum(InvoiceItem.quantity).label("units_sold"),
        )
        .group_by(Invoice.invoice_date).order_by(Invoice.invoice_date.asc()).all()
    )
    trend = [{"date": row.date.isoformat(), "gross_sales_value": float(row.gross_sales_value or 0), "units_sold": int(row.units_sold or 0)} for row in trend_rows]

    branch_sales_rows = (
        sales_base.join(Branch, Branch.id == Invoice.branch_id)
        .with_entities(
            Branch.id,
            Branch.name,
            func.sum(InvoiceItem.quantity).label("units_sold"),
            func.sum(gross_expr).label("gross_sales_value"),
        )
        .group_by(Branch.id, Branch.name)
        .order_by(desc("gross_sales_value"))
        .all()
    )
    branches = [{
        "branch_id": row.id,
        "branch_name": row.name,
        "units_sold": int(row.units_sold or 0),
        "gross_sales_value": float(row.gross_sales_value or 0),
        "contribution_percent": round(float(row.gross_sales_value or 0) / sales_value * 100, 1) if sales_value else 0.0,
    } for row in branch_sales_rows]

    stock_rows = _scoped_stock_rows(allowed_branch_ids, filters).all() if allowed_branch_ids else []
    stock_map = {row.id: row for row in stock_rows}
    health = {"healthy": 0, "low": 0, "out": 0}
    for row in stock_rows:
        quantity = int(row.current_stock or 0)
        if quantity <= 0:
            health["out"] += 1
        elif quantity <= int(row.min_stock_threshold or 0):
            health["low"] += 1
        else:
            health["healthy"] += 1

    today = get_cairo_date()
    expiry_base = (
        db.session.query(BranchInventoryBatch)
        .join(InventoryBatch, InventoryBatch.id == BranchInventoryBatch.batch_id)
        .join(Product, Product.id == BranchInventoryBatch.product_id)
        .filter(
            BranchInventoryBatch.branch_id.in_(allowed_branch_ids),
            BranchInventoryBatch.remaining_quantity > 0,
            InventoryBatch.expiration_date.isnot(None),
        )
    )
    if filters.product_id:
        expiry_base = expiry_base.filter(BranchInventoryBatch.product_id == filters.product_id)
    if filters.product_category:
        expiry_base = expiry_base.filter(Product.category == filters.product_category)
    expired_units = int(expiry_base.with_entities(func.coalesce(func.sum(case((InventoryBatch.expiration_date < today, BranchInventoryBatch.remaining_quantity), else_=0)), 0)).scalar() or 0)
    expiring_units = int(expiry_base.with_entities(func.coalesce(func.sum(case((and_(InventoryBatch.expiration_date >= today, InventoryBatch.expiration_date <= today + timedelta(days=30)), BranchInventoryBatch.remaining_quantity), else_=0)), 0)).scalar() or 0)
    inventory_health = {
        **health,
        "tracked_products": sum(health.values()),
        "expired_units": expired_units,
        "expiring_within_30_days_units": expiring_units,
    }

    movement_start, movement_end = cairo_day_window(filters.date_from, filters.date_to)
    movement_query = (
        db.session.query(StockMovement.movement_type, func.sum(StockMovement.quantity).label("quantity"))
        .join(Product, Product.id == StockMovement.product_id)
        .filter(
            StockMovement.branch_id.in_(allowed_branch_ids),
            StockMovement.created_at >= movement_start,
            StockMovement.created_at <= movement_end,
        )
    )
    if filters.product_id:
        movement_query = movement_query.filter(StockMovement.product_id == filters.product_id)
    if filters.product_category:
        movement_query = movement_query.filter(Product.category == filters.product_category)
    movement_rows = movement_query.group_by(StockMovement.movement_type).all()
    movements = [{"type": row.movement_type.value, "quantity": int(row.quantity or 0)} for row in movement_rows]

    supply_request_query = StockSupplyRequest.query.filter(StockSupplyRequest.branch_id.in_(allowed_branch_ids), StockSupplyRequest.status.in_(["PENDING", "SENT"]))
    if filters.product_id or filters.product_category:
        supply_request_query = supply_request_query.join(StockSupplyRequestItem)
        if filters.product_id:
            supply_request_query = supply_request_query.filter(StockSupplyRequestItem.product_id == filters.product_id)
        if filters.product_category:
            supply_request_query = supply_request_query.join(Product, Product.id == StockSupplyRequestItem.product_id).filter(Product.category == filters.product_category)
    pending_supply_requests = int(supply_request_query.with_entities(func.count(func.distinct(StockSupplyRequest.id))).scalar() or 0)

    shipment_scope = or_(StockShipment.destination_branch_id.in_(allowed_branch_ids), StockShipment.source_branch_id.in_(allowed_branch_ids))
    shipment_query = StockShipment.query.filter(shipment_scope, StockShipment.status == "IN_TRANSIT")
    if filters.product_id or filters.product_category:
        shipment_query = shipment_query.join(StockShipmentItem)
        if filters.product_id:
            shipment_query = shipment_query.filter(StockShipmentItem.product_id == filters.product_id)
        if filters.product_category:
            shipment_query = shipment_query.join(Product, Product.id == StockShipmentItem.product_id).filter(Product.category == filters.product_category)
    in_transit_shipments = int(shipment_query.with_entities(func.count(func.distinct(StockShipment.id))).scalar() or 0)
    return_query = StockReturnRequest.query.filter(StockReturnRequest.branch_id.in_(allowed_branch_ids), StockReturnRequest.status == "PENDING")
    if filters.product_id:
        return_query = return_query.filter(StockReturnRequest.product_id == filters.product_id)
    if filters.product_category:
        return_query = return_query.join(Product, Product.id == StockReturnRequest.product_id).filter(Product.category == filters.product_category)
    pending_returns = int(return_query.with_entities(func.count(func.distinct(StockReturnRequest.id))).scalar() or 0)

    product_ids = sorted(set(stock_map) | set(sales_map))
    detailed = []
    for product_id in product_ids:
        stock = stock_map.get(product_id)
        sale = sales_map.get(product_id)
        name = stock.name if stock else sale.name
        category = stock.category if stock else sale.category
        current_stock = int(stock.current_stock or 0) if stock else 0
        threshold = int(stock.min_stock_threshold or 0) if stock else 0
        state = "OUT" if current_stock <= 0 else "LOW" if current_stock <= threshold else "HEALTHY"
        gross_sales = float(sale.gross_sales_value or 0) if sale else 0.0
        detailed.append({
            "product_id": product_id,
            "product_name": name,
            "category": category,
            "units_sold": int(sale.units_sold or 0) if sale else 0,
            "gross_sales_value": gross_sales,
            "average_selling_price": round(gross_sales / int(sale.units_sold or 1), 2) if sale else 0.0,
            "current_stock": current_stock,
            "stock_state": state,
            "min_stock_threshold": threshold,
            "branches_carrying_stock": int(stock.branches_carrying or 0) if stock else 0,
        })

    analysis_rows = [dict(row) for row in detailed]
    normalized_search = search.strip().casefold()
    if normalized_search:
        detailed = [row for row in detailed if normalized_search in row["product_name"].casefold() or normalized_search in (row["category"] or "").casefold()]
    sort_key = PRODUCT_SORT_FIELDS.get(sort_by, "gross_sales_value")
    reverse = sort_dir not in REPORT_SORT_DIRECTIONS or sort_dir == "desc"
    detailed = sorted(detailed, key=lambda row: (row[sort_key], row["product_name"]) if sort_key != "name" else row["product_name"], reverse=reverse)
    total = len(detailed)
    page_rows = detailed[(page - 1) * per_page: page * per_page]

    visible_ids = [row["product_id"] for row in page_rows]
    top_branch_map = {}
    recent_activity_map = {}
    if visible_ids:
        branch_rows = (
            sales_base.join(Branch, Branch.id == Invoice.branch_id)
            .filter(InvoiceItem.product_id.in_(visible_ids))
            .with_entities(InvoiceItem.product_id, Branch.id, Branch.name, func.sum(gross_expr).label("gross_value"))
            .group_by(InvoiceItem.product_id, Branch.id, Branch.name).all()
        )
        top_branch_map = _rank_winner(branch_rows, 0, 3)
        activity_rows = (
            db.session.query(StockMovement.product_id, func.max(StockMovement.created_at))
            .filter(StockMovement.product_id.in_(visible_ids), StockMovement.branch_id.in_(allowed_branch_ids))
            .group_by(StockMovement.product_id).all()
        )
        recent_activity_map = {row[0]: row[1] for row in activity_rows}
    for row in page_rows:
        branch = top_branch_map.get(row["product_id"])
        activity = recent_activity_map.get(row["product_id"])
        row["top_branch"] = {"id": branch[1], "name": branch[2]} if branch else None
        row["recent_activity_at"] = activity.isoformat() if activity else None

    sales_comparison = _comparison(sales_value, previous_sales_value)
    units_comparison = _comparison(units_sold, previous_units_sold)
    invoices_comparison = _comparison(int(paid_invoice_count or 0), previous_invoice_count)
    concentration, insights, attention, slow_movers, inventory_matrix = _build_product_intelligence(
        ranking,
        analysis_rows,
        branches,
        sales_comparison,
        units_comparison,
        inventory_health,
    )

    return {
        "meta": {
            "sales_date_basis": "paid_invoice_date_cairo",
            "movement_date_basis": "stock_movement_created_at_cairo",
            "inventory_basis": "current_position",
            "date_from": filters.date_from.isoformat(),
            "date_to": filters.date_to.isoformat(),
            "previous_date_from": previous_filters.date_from.isoformat(),
            "previous_date_to": previous_filters.date_to.isoformat(),
            "currency": "EGP",
            "category_label_basis": "current_catalog",
        },
        "summary": {
            "product_gross_sales_value": sales_value,
            "product_units_sold": units_sold,
            "paid_invoice_count": int(paid_invoice_count or 0),
            "strongest_product": ranking[0] if ranking else None,
            "low_stock_products": health["low"],
            "out_of_stock_products": health["out"],
        },
        "comparison": {
            "product_gross_sales_value": sales_comparison,
            "product_units_sold": units_comparison,
            "paid_invoice_count": invoices_comparison,
        },
        "concentration": concentration,
        "insights": insights,
        "attention": attention,
        "slow_movers": slow_movers,
        "inventory_matrix": inventory_matrix,
        "sales_trend": trend,
        "sales_ranking": ranking[:8],
        "branches": branches,
        "inventory_health": inventory_health,
        "movements": movements,
        "supply_context": {
            "pending_supply_requests": pending_supply_requests,
            "in_transit_shipments": in_transit_shipments,
            "pending_returns": pending_returns,
        },
        "table": {"items": page_rows, "pagination": _pagination_payload(page, per_page, total)},
        "filter_options": _product_filter_options(allowed_branch_ids),
    }


def build_product_drilldown(allowed_branch_ids: Sequence[int], filters: ReportFilters, product_id: int):
    product = db.session.get(Product, product_id)
    if not product:
        return None
    scoped_filters = ReportFilters(
        date_from=filters.date_from,
        date_to=filters.date_to,
        product_id=product_id,
        product_category=filters.product_category,
    )
    report = build_products_report(allowed_branch_ids, scoped_filters, per_page=1)
    branch_stock = (
        db.session.query(Branch.id, Branch.name, ProductBranchStock.stock_quantity, ProductBranchStock.is_available)
        .join(ProductBranchStock, ProductBranchStock.branch_id == Branch.id)
        .filter(ProductBranchStock.product_id == product_id, Branch.id.in_(allowed_branch_ids))
        .order_by(ProductBranchStock.stock_quantity.desc()).all()
    )
    movements = (
        db.session.query(StockMovement, Branch.name)
        .join(Branch, Branch.id == StockMovement.branch_id)
        .filter(StockMovement.product_id == product_id, StockMovement.branch_id.in_(allowed_branch_ids))
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc()).limit(10).all()
    )
    stock_context = report["table"]["items"][0] if report["table"]["items"] else {
        "current_stock": 0,
        "stock_state": "OUT",
        "min_stock_threshold": int(product.min_stock_threshold or 0),
        "branches_carrying_stock": 0,
    }
    return {
        "product": {"id": product.id, "name": product.name, "category": product.category, "unit": product.unit},
        "meta": report["meta"],
        "summary": report["summary"],
        "comparison": report["comparison"],
        "stock_context": stock_context,
        "insights": report["insights"],
        "attention": report["attention"],
        "sales_trend": report["sales_trend"],
        "inventory_health": report["inventory_health"],
        "movements_summary": report["movements"],
        "supply_context": report["supply_context"],
        "branch_stock": [{
            "branch_id": row.id,
            "branch_name": row.name,
            "stock_quantity": int(row.stock_quantity or 0),
            "is_available": bool(row.is_available),
        } for row in branch_stock],
        "recent_movements": [{
            "id": movement.id,
            "branch_name": branch_name,
            "type": movement.movement_type.value,
            "quantity": int(movement.quantity or 0),
            "created_at": movement.created_at.isoformat(),
            "invoice_id": movement.invoice_id,
            "notes": movement.notes,
        } for movement, branch_name in movements],
    }


def _money(value) -> float:
    return float(Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _sales_cashier_id():
    """Payment finalizer, with invoice cashier fallback for historical rows."""
    return func.coalesce(Invoice.confirmed_by, Invoice.cashier_id)


def _sales_conditions(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, include_dates=True):
    conditions = [
        Invoice.status == InvoiceStatus.PAID,
        *_branch_conditions(allowed_branch_ids),
    ]
    if include_dates:
        conditions.extend([
            Invoice.invoice_date >= filters.date_from,
            Invoice.invoice_date <= filters.date_to,
        ])
    if filters.cashier_id:
        conditions.append(_sales_cashier_id() == filters.cashier_id)
    if filters.promo_code:
        redemption_filter = aliased(PromoRedemption)
        conditions.append(exists().where(and_(
            redemption_filter.invoice_id == Invoice.id,
            func.upper(redemption_filter.code_snapshot) == filters.promo_code,
        )))
    if filters.sales_item_type:
        item_filter = aliased(InvoiceItem)
        conditions.append(exists().where(and_(
            item_filter.invoice_id == Invoice.id,
            item_filter.item_type == filters.sales_item_type,
        )))
    if filters.payment_method:
        payment_method = PaymentMethod(filters.payment_method)
        has_any_payment_row = or_(exists().where(InvoicePayment.invoice_id == Invoice.id), has_application(Invoice.id))
        if payment_method == PaymentMethod.VISA:
            visa_methods = [PaymentMethod.VISA, PaymentMethod.VISA_1, PaymentMethod.VISA_2]
            has_selected_payment_row = exists().where(and_(
                InvoicePayment.invoice_id == Invoice.id,
                InvoicePayment.method.in_(visa_methods),
                InvoicePayment.amount > 0,
            ))
            conditions.append(or_(
                has_selected_payment_row,
                and_(~has_any_payment_row, Invoice.payment_method.in_(visa_methods)),
            ))
        else:
            has_selected_payment_row = exists().where(and_(
                InvoicePayment.invoice_id == Invoice.id,
                InvoicePayment.method == payment_method,
                InvoicePayment.amount > 0,
            ))
            conditions.append(or_(
                has_selected_payment_row,
                and_(~has_any_payment_row, Invoice.payment_method == payment_method),
            ))
    return conditions


def _sales_summary(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    gross = func.coalesce(func.sum(Invoice.total_amount), 0)
    discounts = func.coalesce(func.sum(Invoice.discount_amount), 0)
    row = (
        db.session.query(
            gross.label("gross_sales"),
            discounts.label("discount_amount"),
            func.count(Invoice.id).label("paid_invoice_count"),
            func.coalesce(func.sum(case((Invoice.discount_amount > 0, 1), else_=0)), 0).label("discounted_invoice_count"),
            func.coalesce(func.sum(case((Invoice.is_fully_discounted.is_(True), 1), else_=0)), 0).label("fully_discounted_invoice_count"),
            func.coalesce(func.sum(case((Invoice.customer_id.isnot(None), 1), else_=0)), 0).label("identified_customer_invoice_count"),
        )
        .filter(*_sales_conditions(allowed_branch_ids, filters))
        .one()
    )
    gross_value = _money(row.gross_sales)
    discount_value = _money(row.discount_amount)
    net_value = _money(Decimal(str(gross_value)) - Decimal(str(discount_value)))
    invoice_count = int(row.paid_invoice_count or 0)
    discounted_count = int(row.discounted_invoice_count or 0)
    identified_count = int(row.identified_customer_invoice_count or 0)
    return {
        "gross_sales": gross_value,
        "discount_amount": discount_value,
        "net_sales": net_value,
        "paid_invoice_count": invoice_count,
        "average_ticket": _money(Decimal(str(net_value)) / invoice_count) if invoice_count else 0.0,
        "discount_rate": round((discount_value / gross_value) * 100.0, 1) if gross_value else 0.0,
        "discounted_invoice_count": discounted_count,
        "fully_discounted_invoice_count": int(row.fully_discounted_invoice_count or 0),
        "average_discount_per_discounted_invoice": _money(Decimal(str(discount_value)) / discounted_count) if discounted_count else 0.0,
        "identified_customer_invoice_count": identified_count,
        "anonymous_invoice_count": max(invoice_count - identified_count, 0),
    }


def _sales_trend(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    rows = (
        db.session.query(
            Invoice.invoice_date,
            func.sum(Invoice.total_amount).label("gross_sales"),
            func.sum(Invoice.discount_amount).label("discount_amount"),
            func.count(Invoice.id).label("paid_invoice_count"),
        )
        .filter(*_sales_conditions(allowed_branch_ids, filters))
        .group_by(Invoice.invoice_date)
        .order_by(Invoice.invoice_date.asc())
        .all()
    )
    result = []
    for row in rows:
        gross_value = _money(row.gross_sales)
        discount_value = _money(row.discount_amount)
        net_value = _money(Decimal(str(gross_value)) - Decimal(str(discount_value)))
        count = int(row.paid_invoice_count or 0)
        result.append({
            "date": row.invoice_date.isoformat(),
            "gross_sales": gross_value,
            "discount_amount": discount_value,
            "net_sales": net_value,
            "paid_invoice_count": count,
            "average_ticket": _money(Decimal(str(net_value)) / count) if count else 0.0,
        })
    return result


def _sales_branch_rows(allowed_branch_ids: Sequence[int], filters: ReportFilters, total_net: float):
    rows = (
        db.session.query(
            Branch.id,
            Branch.name,
            func.sum(Invoice.total_amount).label("gross_sales"),
            func.sum(Invoice.discount_amount).label("discount_amount"),
            func.count(Invoice.id).label("paid_invoice_count"),
        )
        .join(Branch, Branch.id == Invoice.branch_id)
        .filter(*_sales_conditions(allowed_branch_ids, filters))
        .group_by(Branch.id, Branch.name)
        .all()
    )
    previous_filters = _previous_filters(filters)
    previous_rows = (
        db.session.query(
            Invoice.branch_id,
            func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)).label("net_sales"),
        )
        .filter(*_sales_conditions(allowed_branch_ids, previous_filters))
        .group_by(Invoice.branch_id)
        .all()
    )
    previous_by_branch = {row.branch_id: _money(row.net_sales) for row in previous_rows}
    result = []
    for row in rows:
        gross_value = _money(row.gross_sales)
        discount_value = _money(row.discount_amount)
        net_value = _money(Decimal(str(gross_value)) - Decimal(str(discount_value)))
        count = int(row.paid_invoice_count or 0)
        result.append({
            "branch_id": row.id,
            "branch_name": row.name,
            "net_sales": net_value,
            "paid_invoice_count": count,
            "average_ticket": _money(Decimal(str(net_value)) / count) if count else 0.0,
            "contribution_percent": _share(net_value, total_net),
            "comparison": _comparison(net_value, previous_by_branch.get(row.id, 0.0)),
        })
    return sorted(result, key=lambda item: (-item["net_sales"], item["branch_name"]))


def _sales_payment_context(allowed_branch_ids: Sequence[int], filters: ReportFilters, net_sales: float):
    invoice_ids = db.session.query(Invoice.id).filter(*_sales_conditions(allowed_branch_ids, filters))
    modern_rows = (
        db.session.query(InvoicePayment.method, func.sum(InvoicePayment.amount).label("amount"))
        .filter(InvoicePayment.invoice_id.in_(invoice_ids))
        .group_by(InvoicePayment.method)
        .all()
    )
    has_payment_rows = or_(exists().where(InvoicePayment.invoice_id == Invoice.id), has_application(Invoice.id))
    legacy_rows = (
        db.session.query(
            Invoice.payment_method,
            func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)).label("amount"),
        )
        .filter(*_sales_conditions(allowed_branch_ids, filters), ~has_payment_rows)
        .group_by(Invoice.payment_method)
        .all()
    )
    totals = {method.value: Decimal("0.00") for method in PaymentMethod}
    for method, amount in modern_rows:
        if method is not None:
            totals[method.value] += Decimal(str(amount or 0))
    legacy_invoice_count = 0
    for method, amount in legacy_rows:
        if method is not None:
            totals[method.value] += Decimal(str(amount or 0))
    legacy_invoice_count = int(
        db.session.query(func.count(Invoice.id))
        .filter(*_sales_conditions(allowed_branch_ids, filters), ~has_payment_rows)
        .scalar() or 0
    )
    split_group = (
        db.session.query(InvoicePayment.invoice_id)
        .filter(InvoicePayment.invoice_id.in_(invoice_ids), InvoicePayment.amount > 0)
        .group_by(InvoicePayment.invoice_id)
        .having(func.count(func.distinct(InvoicePayment.method)) > 1)
        .subquery()
    )
    split_count = int(db.session.query(func.count()).select_from(split_group).scalar() or 0)
    collected_total = _money(sum(totals.values(), Decimal("0.00")))
    applied_total = Decimal(str(db.session.query(func.coalesce(func.sum(AppointmentDepositTransaction.amount), 0)).filter(
        AppointmentDepositTransaction.invoice_id.in_(invoice_ids),
        AppointmentDepositTransaction.transaction_type == AppointmentDepositTransactionType.DEPOSIT_APPLIED).scalar() or 0))
    methods = [{
        "method": method.value,
        "amount": _money(totals[method.value]),
        "share_percent": _share(float(totals[method.value]), collected_total),
    } for method in PaymentMethod]
    invoice_count = int(invoice_ids.count())
    return {
        "methods": methods,
        "invoice_collections_total": collected_total,
        "split_payment_invoice_count": split_count,
        "split_payment_rate": _share(split_count, invoice_count),
        "legacy_fallback_invoice_count": legacy_invoice_count,
        "deposit_applications": _money(applied_total),
        "reconciliation_difference": _money(Decimal(str(net_sales)) - Decimal(str(collected_total)) - applied_total),
        "basis": "invoice_payments_amount_then_legacy_net_by_invoice_payment_method",
    }


def _sales_mix(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    rows = (
        db.session.query(
            InvoiceItem.item_type,
            func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross_value"),
            func.sum(InvoiceItem.quantity).label("units"),
        )
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(*_sales_conditions(allowed_branch_ids, filters), InvoiceItem.item_type.in_(["SERVICE_ITEM", "PRODUCT_ITEM"]))
        .group_by(InvoiceItem.item_type)
        .all()
    )
    by_type = {row.item_type: row for row in rows}
    service_value = _money(getattr(by_type.get("SERVICE_ITEM"), "gross_value", 0))
    product_value = _money(getattr(by_type.get("PRODUCT_ITEM"), "gross_value", 0))
    total_item_value = _money(Decimal(str(service_value)) + Decimal(str(product_value)))
    return {
        "basis": "gross_invoice_item_value_before_invoice_discount",
        "service_gross_value": service_value,
        "product_gross_value": product_value,
        "service_units": int(getattr(by_type.get("SERVICE_ITEM"), "units", 0) or 0),
        "product_units": int(getattr(by_type.get("PRODUCT_ITEM"), "units", 0) or 0),
        "service_share_percent": _share(service_value, total_item_value),
        "product_share_percent": _share(product_value, total_item_value),
    }


def _top_sales_items(allowed_branch_ids: Sequence[int], filters: ReportFilters, item_type: str):
    model = Service if item_type == "SERVICE_ITEM" else Product
    foreign_key = InvoiceItem.service_id if item_type == "SERVICE_ITEM" else InvoiceItem.product_id
    rows = (
        db.session.query(
            model.id,
            model.name,
            func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross_value"),
        )
        .select_from(InvoiceItem)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .join(model, model.id == foreign_key)
        .filter(*_sales_conditions(allowed_branch_ids, filters), InvoiceItem.item_type == item_type)
        .group_by(model.id, model.name)
        .order_by(desc("gross_value"), model.name.asc())
        .limit(1)
        .all()
    )
    return {"id": rows[0].id, "name": rows[0].name, "gross_value": _money(rows[0].gross_value)} if rows else None


def _sales_promo_context(allowed_branch_ids: Sequence[int], filters: ReportFilters, paid_invoice_count: int):
    rows = (
        db.session.query(
            PromoRedemption.code_snapshot,
            func.count(PromoRedemption.id).label("redemption_count"),
            func.sum(PromoRedemption.promo_discount_amount).label("promo_discount_total"),
            func.sum(PromoRedemption.net_invoice_total).label("net_sales"),
        )
        .join(Invoice, Invoice.id == PromoRedemption.invoice_id)
        .filter(*_sales_conditions(allowed_branch_ids, filters))
        .group_by(PromoRedemption.code_snapshot)
        .order_by(desc("redemption_count"), desc("promo_discount_total"))
        .all()
    )
    codes = [{
        "code": row.code_snapshot,
        "redemption_count": int(row.redemption_count or 0),
        "promo_discount_total": _money(row.promo_discount_total),
        "net_sales": _money(row.net_sales),
    } for row in rows]
    redemption_count = sum(row["redemption_count"] for row in codes)
    return {
        "paid_redemption_count": redemption_count,
        "promo_discount_total": _money(sum(Decimal(str(row["promo_discount_total"])) for row in codes)),
        "net_sales_on_redeemed_invoices": _money(sum(Decimal(str(row["net_sales"])) for row in codes)),
        "promo_invoice_share_percent": _share(redemption_count, paid_invoice_count),
        "top_codes": codes[:5],
    }


def _sales_cashier_context(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    rows = (
        db.session.query(
            Employee.id,
            Employee.full_name,
            func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)).label("net_sales"),
            func.count(Invoice.id).label("paid_invoice_count"),
        )
        .join(Employee, Employee.id == _sales_cashier_id())
        .filter(*_sales_conditions(allowed_branch_ids, filters))
        .group_by(Employee.id, Employee.full_name)
        .order_by(desc("net_sales"), Employee.full_name.asc())
        .all()
    )
    return [{
        "cashier_id": row.id,
        "cashier_name": row.full_name,
        "net_sales_processed": _money(row.net_sales),
        "paid_invoice_count": int(row.paid_invoice_count or 0),
        "average_ticket": _money(Decimal(str(row.net_sales or 0)) / int(row.paid_invoice_count)) if row.paid_invoice_count else 0.0,
    } for row in rows]


def _sales_filter_options(allowed_branch_ids: Sequence[int]):
    base = [Invoice.status == InvoiceStatus.PAID, *_branch_conditions(allowed_branch_ids)]
    cashiers = (
        db.session.query(Employee.id, Employee.full_name)
        .join(Invoice, _sales_cashier_id() == Employee.id)
        .filter(*base)
        .distinct()
        .order_by(Employee.full_name.asc())
        .all()
    )
    promo_codes = (
        db.session.query(PromoRedemption.code_snapshot)
        .join(Invoice, Invoice.id == PromoRedemption.invoice_id)
        .filter(*base)
        .distinct()
        .order_by(PromoRedemption.code_snapshot.asc())
        .all()
    )
    branches = Branch.query.filter(Branch.id.in_(allowed_branch_ids)).order_by(Branch.name.asc()).all() if allowed_branch_ids else []
    return {
        "branches": [{"id": row.id, "name": row.name} for row in branches],
        "cashiers": [{"id": row.id, "name": row.full_name} for row in cashiers],
        "promo_codes": [row.code_snapshot for row in promo_codes],
        "payment_methods": [method.value for method in PaymentMethod],
    }


def _sales_page_extras(invoice_ids: Sequence[int]):
    if not invoice_ids:
        return {}, {}
    payment_rows = (
        db.session.query(InvoicePayment.invoice_id, InvoicePayment.method, func.sum(InvoicePayment.amount).label("amount"))
        .filter(InvoicePayment.invoice_id.in_(invoice_ids))
        .group_by(InvoicePayment.invoice_id, InvoicePayment.method)
        .all()
    )
    payments = {}
    for invoice_id, method, amount in payment_rows:
        payments.setdefault(invoice_id, {})[method.value] = _money(amount)
    item_rows = (
        db.session.query(
            InvoiceItem.invoice_id,
            func.sum(case((InvoiceItem.item_type == "SERVICE_ITEM", InvoiceItem.service_price * InvoiceItem.quantity), else_=0)).label("service_gross"),
            func.sum(case((InvoiceItem.item_type == "PRODUCT_ITEM", InvoiceItem.service_price * InvoiceItem.quantity), else_=0)).label("product_gross"),
            func.sum(case((InvoiceItem.item_type == "SERVICE_ITEM", InvoiceItem.quantity), else_=0)).label("service_units"),
            func.sum(case((InvoiceItem.item_type == "PRODUCT_ITEM", InvoiceItem.quantity), else_=0)).label("product_units"),
        )
        .filter(InvoiceItem.invoice_id.in_(invoice_ids))
        .group_by(InvoiceItem.invoice_id)
        .all()
    )
    items = {row.invoice_id: {
        "service_gross_value": _money(row.service_gross),
        "product_gross_value": _money(row.product_gross),
        "service_units": int(row.service_units or 0),
        "product_units": int(row.product_units or 0),
    } for row in item_rows}
    return payments, items


def _sales_table(
    allowed_branch_ids: Sequence[int], filters: ReportFilters, *, page: int, per_page: int,
    search: str, sort_by: str, sort_dir: str,
):
    query = (
        db.session.query(
            Invoice.id,
            Invoice.invoice_number,
            Invoice.invoice_date,
            Invoice.total_amount,
            Invoice.discount_amount,
            Invoice.payment_method,
            Invoice.is_fully_discounted,
            Invoice.customer_name,
            Invoice.customer_phone,
            Invoice.customer_id,
            Branch.name.label("branch_name"),
            Employee.full_name.label("cashier_name"),
            Customer.full_name.label("customer_full_name"),
            PromoRedemption.code_snapshot.label("promo_code"),
        )
        .join(Branch, Branch.id == Invoice.branch_id)
        .join(Employee, Employee.id == _sales_cashier_id())
        .outerjoin(Customer, Customer.id == Invoice.customer_id)
        .outerjoin(PromoRedemption, PromoRedemption.invoice_id == Invoice.id)
        .filter(*_sales_conditions(allowed_branch_ids, filters))
    )
    if search:
        search_filters = [
            Customer.full_name.ilike(f"%{search}%"),
            Invoice.customer_name.ilike(f"%{search}%"),
            Invoice.customer_phone.ilike(f"%{search}%"),
            Employee.full_name.ilike(f"%{search}%"),
            Branch.name.ilike(f"%{search}%"),
            PromoRedemption.code_snapshot.ilike(f"%{search}%"),
        ]
        if search.isdigit():
            search_filters.append(Invoice.invoice_number == int(search))
        query = query.filter(or_(*search_filters))
    total = query.order_by(None).count()
    sort_expression = SALES_SORT_FIELDS.get(sort_by, Invoice.invoice_date)
    order = sort_expression.asc() if sort_dir == "asc" else sort_expression.desc()
    rows = query.order_by(order, Invoice.id.desc()).offset((page - 1) * per_page).limit(per_page).all()
    invoice_ids = [row.id for row in rows]
    payment_map, item_map = _sales_page_extras(invoice_ids)
    items = []
    for row in rows:
        gross_value = _money(row.total_amount)
        discount_value = _money(row.discount_amount)
        net_value = _money(Decimal(str(gross_value)) - Decimal(str(discount_value)))
        payment_slices = payment_map.get(row.id)
        if payment_slices is None:
            payment_slices = {row.payment_method.value: net_value} if row.payment_method else {}
        items.append({
            "invoice_id": row.id,
            "invoice_number": row.invoice_number,
            "invoice_date": row.invoice_date.isoformat() if row.invoice_date else None,
            "branch_name": row.branch_name,
            "customer_name": row.customer_full_name or row.customer_name or "عميل غير مسجل",
            "cashier_name": row.cashier_name,
            "gross_sales": gross_value,
            "discount_amount": discount_value,
            "net_sales": net_value,
            "payment_slices": [{"method": method, "amount": amount} for method, amount in sorted(payment_slices.items())],
            "promo_code": row.promo_code,
            "is_fully_discounted": bool(row.is_fully_discounted),
            **item_map.get(row.id, {"service_gross_value": 0.0, "product_gross_value": 0.0, "service_units": 0, "product_units": 0}),
        })
    return {"items": items, "pagination": _pagination_payload(page, per_page, total)}


def _sales_intelligence(summary: dict, previous: dict, branches: list[dict], payments: dict, promo: dict, top_service, top_product):
    net_comparison = _comparison(summary["net_sales"], previous["net_sales"])
    invoice_comparison = _comparison(summary["paid_invoice_count"], previous["paid_invoice_count"])
    ticket_comparison = _comparison(summary["average_ticket"], previous["average_ticket"])
    discount_rate_change = round(summary["discount_rate"] - previous["discount_rate"], 1)
    insights = []
    if net_comparison["percent_change"] is not None:
        if abs(net_comparison["percent_change"]) < COMPARISON_NEUTRAL_BAND_PERCENT:
            insights.append({"code": "NET_STABLE", "text": "صافي المبيعات دون تغير ملحوظ مقارنة بالفترة السابقة."})
        else:
            direction = "ارتفع" if net_comparison["percent_change"] > 0 else "انخفض"
            volume_direction = "ارتفع" if invoice_comparison["absolute_change"] > 0 else "انخفض" if invoice_comparison["absolute_change"] < 0 else "استقر"
            ticket_direction = "ارتفع" if ticket_comparison["absolute_change"] > 0 else "انخفض" if ticket_comparison["absolute_change"] < 0 else "استقر"
            insights.append({
                "code": "SALES_DRIVERS",
                "text": f"صافي المبيعات {direction} {abs(net_comparison['percent_change']):.1f}%؛ عدد الفواتير {volume_direction} ومتوسط الفاتورة {ticket_direction}.",
            })
    if branches and summary["net_sales"] > 0:
        insights.append({"code": "TOP_BRANCH_SHARE", "text": f"{branches[0]['branch_name']} يمثل {branches[0]['contribution_percent']:.1f}% من صافي المبيعات خلال الفترة."})
    leading_payment = max(payments["methods"], key=lambda row: row["amount"], default=None)
    if leading_payment and leading_payment["amount"] > 0:
        labels = {"CASH": "الدفع النقدي", "VISA": "الدفع بالفيزا", "INSTAPAY": "الدفع بإنستا باي"}
        insights.append({"code": "PAYMENT_SHARE", "text": f"{labels[leading_payment['method']]} يمثل {leading_payment['share_percent']:.1f}% من تحصيلات الفواتير."})
    if abs(discount_rate_change) >= SALES_DISCOUNT_RATE_INCREASE_POINTS and summary["discount_amount"] > 0:
        direction = "ارتفع" if discount_rate_change > 0 else "انخفض"
        insights.append({"code": "DISCOUNT_RATE_CHANGE", "text": f"معدل الخصم {direction} من {previous['discount_rate']:.1f}% إلى {summary['discount_rate']:.1f}%."})

    attention = []
    if previous["net_sales"] >= 100 and net_comparison["percent_change"] is not None and net_comparison["percent_change"] <= SALES_DECLINE_ATTENTION_PERCENT:
        attention.append({"code": "NET_SALES_DECLINE", "label": "تراجع يحتاج مراجعة", "detail": f"صافي المبيعات أقل {abs(net_comparison['percent_change']):.1f}% من الفترة السابقة.", "tone": "neutral"})
    if invoice_comparison["absolute_change"] < 0 < ticket_comparison["absolute_change"]:
        attention.append({"code": "VOLUME_DOWN_TICKET_UP", "label": "تغير في محركات البيع", "detail": "عدد الفواتير انخفض بينما ارتفع متوسط الفاتورة.", "tone": "neutral"})
    elif invoice_comparison["absolute_change"] > 0 > ticket_comparison["absolute_change"]:
        attention.append({"code": "VOLUME_UP_TICKET_DOWN", "label": "تغير في محركات البيع", "detail": "عدد الفواتير ارتفع بينما انخفض متوسط الفاتورة.", "tone": "neutral"})
    if discount_rate_change >= SALES_DISCOUNT_RATE_INCREASE_POINTS and summary["discounted_invoice_count"]:
        attention.append({"code": "DISCOUNT_RATE_INCREASE", "label": "خصومات تحتاج مراجعة", "detail": f"معدل الخصم أعلى {discount_rate_change:.1f} نقطة مئوية من الفترة السابقة.", "tone": "neutral"})
    if summary["fully_discounted_invoice_count"]:
        attention.append({"code": "FULLY_DISCOUNTED", "label": "فواتير مخصومة بالكامل", "detail": f"يوجد {summary['fully_discounted_invoice_count']} فاتورة مدفوعة بصافي صفر.", "tone": "neutral"})
    if branches and branches[0]["contribution_percent"] >= SALES_CONCENTRATION_ATTENTION_PERCENT:
        attention.append({"code": "BRANCH_CONCENTRATION", "entity_id": branches[0]["branch_id"], "label": "اعتماد مرتفع", "detail": f"فرع واحد يمثل {branches[0]['contribution_percent']:.1f}% من صافي المبيعات.", "tone": "neutral"})
    if leading_payment and leading_payment["share_percent"] >= SALES_PAYMENT_DOMINANCE_PERCENT:
        attention.append({"code": "PAYMENT_CONCENTRATION", "label": "تركيز طريقة الدفع", "detail": f"طريقة دفع واحدة تمثل {leading_payment['share_percent']:.1f}% من تحصيلات الفواتير.", "tone": "neutral"})
    if abs(payments["reconciliation_difference"]) >= 0.01:
        attention.append({"code": "PAYMENT_RECONCILIATION", "label": "فرق تحصيل يحتاج مراجعة", "detail": f"الفرق بين صافي الفواتير وشرائح التحصيل المسجلة {abs(payments['reconciliation_difference']):.2f} ج.م.", "tone": "attention"})
    concentration = {
        "top_branch_share": branches[0]["contribution_percent"] if branches else 0.0,
        "top_three_branches_share": round(sum(row["contribution_percent"] for row in branches[:3]), 1),
        "top_service_gross_share": _share((top_service or {}).get("gross_value", 0), summary["gross_sales"]),
        "top_product_gross_share": _share((top_product or {}).get("gross_value", 0), summary["gross_sales"]),
        "top_promo_redemption_share": _share(promo["top_codes"][0]["redemption_count"], promo["paid_redemption_count"]) if promo["top_codes"] else 0.0,
    }
    return insights[:4], attention[:5], concentration


def build_sales_report(
    allowed_branch_ids: Sequence[int], filters: ReportFilters, *, page=1, per_page=12,
    search="", sort_by="invoice_date", sort_dir="desc",
):
    sort_dir = sort_dir if sort_dir in REPORT_SORT_DIRECTIONS else "desc"
    summary = _sales_summary(allowed_branch_ids, filters)
    previous_filters = _previous_filters(filters)
    previous = _sales_summary(allowed_branch_ids, previous_filters)
    comparison = _sales_summary_comparison(summary, previous)
    branches = _sales_branch_rows(allowed_branch_ids, filters, summary["net_sales"])
    payments = _sales_payment_context(allowed_branch_ids, filters, summary["net_sales"])
    mix = _sales_mix(allowed_branch_ids, filters)
    promo = _sales_promo_context(allowed_branch_ids, filters, summary["paid_invoice_count"])
    top_service = _top_sales_items(allowed_branch_ids, filters, "SERVICE_ITEM")
    top_product = _top_sales_items(allowed_branch_ids, filters, "PRODUCT_ITEM")
    insights, attention, concentration = _sales_intelligence(summary, previous, branches, payments, promo, top_service, top_product)
    previous_from, previous_to = _previous_period(filters)
    return {
        "meta": {
            "date_basis": "Invoice.invoice_date (Cairo paid business date)",
            "date_from": filters.date_from.isoformat(),
            "date_to": filters.date_to.isoformat(),
            "previous_date_from": previous_from.isoformat(),
            "previous_date_to": previous_to.isoformat(),
            "currency": "EGP",
            "item_mix_basis": "gross invoice item value before invoice-level discount",
            "payment_basis": payments["basis"],
            "cashier_basis": "Invoice.confirmed_by with Invoice.cashier_id legacy fallback",
        },
        "summary": summary,
        "comparison": comparison,
        "drivers": {
            "identity": "net_sales = paid_invoice_count × average_ticket",
            "invoice_count": comparison["paid_invoice_count"],
            "average_ticket": comparison["average_ticket"],
        },
        "discounts": {
            "total_discount_amount": summary["discount_amount"],
            "discount_rate": summary["discount_rate"],
            "previous_discount_rate": previous["discount_rate"],
            "discount_rate_change_points": round(summary["discount_rate"] - previous["discount_rate"], 1),
            "discounted_invoice_count": summary["discounted_invoice_count"],
            "fully_discounted_invoice_count": summary["fully_discounted_invoice_count"],
            "average_discount_per_discounted_invoice": summary["average_discount_per_discounted_invoice"],
        },
        "trend": _sales_trend(allowed_branch_ids, filters),
        "branches": branches,
        "payments": payments,
        "mix": mix,
        "promo": promo,
        "customers": {
            "identified_invoice_count": summary["identified_customer_invoice_count"],
            "anonymous_invoice_count": summary["anonymous_invoice_count"],
            "identified_invoice_share_percent": _share(summary["identified_customer_invoice_count"], summary["paid_invoice_count"]),
            "anonymous_invoice_share_percent": _share(summary["anonymous_invoice_count"], summary["paid_invoice_count"]),
            "basis": "invoice.customer_id within branch-scoped paid invoices",
        },
        "cashiers": _sales_cashier_context(allowed_branch_ids, filters),
        "top_service": top_service,
        "top_product": top_product,
        "concentration": concentration,
        "insights": insights,
        "attention": attention,
        "table": _sales_table(
            allowed_branch_ids, filters, page=page, per_page=per_page,
            search=search, sort_by=sort_by, sort_dir=sort_dir,
        ),
        "filter_options": _sales_filter_options(allowed_branch_ids),
    }


def build_sales_drilldown(allowed_branch_ids: Sequence[int], filters: ReportFilters, invoice_id: int):
    row = (
        db.session.query(Invoice, Branch.name.label("branch_name"), Employee.full_name.label("cashier_name"), Customer.full_name.label("customer_full_name"))
        .join(Branch, Branch.id == Invoice.branch_id)
        .join(Employee, Employee.id == _sales_cashier_id())
        .outerjoin(Customer, Customer.id == Invoice.customer_id)
        .filter(Invoice.id == invoice_id, *_sales_conditions(allowed_branch_ids, filters))
        .first()
    )
    if not row:
        return None
    invoice, branch_name, cashier_name, customer_full_name = row
    payment_map, item_map = _sales_page_extras([invoice.id])
    gross_value = _money(invoice.total_amount)
    discount_value = _money(invoice.discount_amount)
    net_value = _money(Decimal(str(gross_value)) - Decimal(str(discount_value)))
    slices = payment_map.get(invoice.id)
    payment_basis = "invoice_payments"
    if slices is None:
        slices = {invoice.payment_method.value: net_value} if invoice.payment_method else {}
        payment_basis = "legacy_invoice_payment_method_net_fallback"
    promo = PromoRedemption.query.filter_by(invoice_id=invoice.id).first()
    item_rows = (
        db.session.query(InvoiceItem, Service.name.label("service_name"), Product.name.label("product_name"), Employee.full_name.label("barber_name"))
        .outerjoin(Service, Service.id == InvoiceItem.service_id)
        .outerjoin(Product, Product.id == InvoiceItem.product_id)
        .outerjoin(Employee, Employee.id == InvoiceItem.barber_id)
        .filter(InvoiceItem.invoice_id == invoice.id)
        .order_by(InvoiceItem.id.asc())
        .all()
    )
    return {
        "invoice": {
            "id": invoice.id,
            "invoice_number": invoice.invoice_number,
            "invoice_date": invoice.invoice_date.isoformat() if invoice.invoice_date else None,
            "paid_at": invoice.paid_at.isoformat() if invoice.paid_at else None,
            "business_day_id": invoice.business_day_id,
            "branch_name": branch_name,
            "customer_name": customer_full_name or invoice.customer_name or "عميل غير مسجل",
            "customer_phone": invoice.customer_phone,
            "cashier_name": cashier_name,
            "gross_sales": gross_value,
            "discount_amount": discount_value,
            "net_sales": net_value,
            "is_fully_discounted": bool(invoice.is_fully_discounted),
        },
        "payments": {
            "basis": payment_basis,
            "slices": [{"method": method, "amount": amount} for method, amount in sorted(slices.items())],
            "total": _money(sum((Decimal(str(value)) for value in slices.values()), Decimal("0.00"))),
        },
        "promo": {
            "code": promo.code_snapshot,
            "discount_amount": _money(promo.promo_discount_amount),
            "eligible_subtotal": _money(promo.eligible_subtotal),
        } if promo else None,
        "item_summary": item_map.get(invoice.id, {"service_gross_value": 0.0, "product_gross_value": 0.0, "service_units": 0, "product_units": 0}),
        "items": [{
            "id": item.id,
            "item_type": item.item_type,
            "name": service_name or product_name or "بند غير مسمى",
            "quantity": int(item.quantity or 0),
            "unit_price": _money(item.service_price),
            "gross_value": _money(Decimal(str(item.service_price or 0)) * int(item.quantity or 0)),
            "barber_name": barber_name,
        } for item, service_name, product_name, barber_name in item_rows],
    }


def sales_export_rows(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, search=""):
    return _sales_table(
        allowed_branch_ids,
        filters,
        page=1,
        per_page=100000,
        search=search,
        sort_by="invoice_date",
        sort_dir="desc",
    )["items"]


# ---------------------------------------------------------------------------
# Finance & Treasury report
# ---------------------------------------------------------------------------

def _finance_invoice_conditions(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    return [
        Invoice.status == InvoiceStatus.PAID,
        Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        Invoice.invoice_date >= filters.date_from,
        Invoice.invoice_date <= filters.date_to,
    ]


def _finance_expense_conditions(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, operating_only=True):
    conditions = [
        Expense.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        Expense.expense_date >= filters.date_from,
        Expense.expense_date <= filters.date_to,
    ]
    if operating_only:
        conditions.extend([
            Expense.is_business_expense.is_(True),
            ~ExpenseCategory.code.in_(NON_OPERATING_EXPENSE_CODES),
        ])
    if filters.expense_category_id:
        conditions.append(Expense.expense_category_id == filters.expense_category_id)
    return conditions


def _commission_expression():
    service_amount = (
        func.coalesce(InvoiceItem.service_price, 0)
        * (
            func.coalesce(InvoiceItem.barber_commission_percent, 0)
            + case(
                (InvoiceItem.assistant_id.isnot(None), func.coalesce(InvoiceItem.assistant_commission_percent, 0)),
                else_=0,
            )
        )
        / 100.0
    )
    return case(
        (Invoice.is_fully_discounted.is_(True), 0),
        (InvoiceItem.item_type == "SERVICE_ITEM", service_amount),
        (InvoiceItem.item_type == "PRODUCT_ITEM", func.coalesce(InvoiceItem.sales_commission_amount, 0)),
        else_=0,
    )


def _finance_performance_summary(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    sales_row = (
        db.session.query(
            func.coalesce(func.sum(Invoice.total_amount), 0).label("gross"),
            func.coalesce(func.sum(Invoice.discount_amount), 0).label("discount"),
            func.count(Invoice.id).label("invoice_count"),
        )
        .filter(*_finance_invoice_conditions(allowed_branch_ids, filters))
        .one()
    )
    gross = _money(sales_row.gross)
    discount = _money(sales_row.discount)
    net = _money(Decimal(str(gross)) - Decimal(str(discount)))
    commission = _money(
        db.session.query(func.coalesce(func.sum(_commission_expression()), 0))
        .select_from(InvoiceItem)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(*_finance_invoice_conditions(allowed_branch_ids, filters))
        .scalar()
    )
    operating_expenses = _money(
        db.session.query(func.coalesce(func.sum(Expense.amount), 0))
        .join(ExpenseCategory, ExpenseCategory.id == Expense.expense_category_id)
        .filter(*_finance_expense_conditions(allowed_branch_ids, filters))
        .scalar()
    )
    contribution = _money(Decimal(str(net)) - Decimal(str(commission)) - Decimal(str(operating_expenses)))
    return {
        "gross_sales": gross,
        "discount_amount": discount,
        "net_sales": net,
        "paid_invoice_count": int(sales_row.invoice_count or 0),
        "operating_expenses": operating_expenses,
        "recorded_commission_cost": commission,
        "operating_contribution": contribution,
        "operating_expense_ratio": _share(operating_expenses, net),
        "contribution_ratio": _share(contribution, net),
    }


def _finance_trend(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    sales_rows = (
        db.session.query(
            Invoice.invoice_date,
            func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)).label("net_sales"),
        )
        .filter(*_finance_invoice_conditions(allowed_branch_ids, filters))
        .group_by(Invoice.invoice_date).all()
    )
    expense_rows = (
        db.session.query(Expense.expense_date, func.sum(Expense.amount).label("amount"))
        .join(ExpenseCategory, ExpenseCategory.id == Expense.expense_category_id)
        .filter(*_finance_expense_conditions(allowed_branch_ids, filters))
        .group_by(Expense.expense_date).all()
    )
    by_date = {row.invoice_date: {"net_sales": _money(row.net_sales), "operating_expenses": 0.0} for row in sales_rows}
    for row in expense_rows:
        by_date.setdefault(row.expense_date, {"net_sales": 0.0, "operating_expenses": 0.0})["operating_expenses"] = _money(row.amount)
    result = []
    cursor = filters.date_from
    while cursor <= filters.date_to:
        values = by_date.get(cursor, {"net_sales": 0.0, "operating_expenses": 0.0})
        result.append({"date": cursor.isoformat(), **values})
        cursor += timedelta(days=1)
    return result


def _deposit_conditions(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    start_utc, end_utc = cairo_day_window(filters.date_from, filters.date_to)
    return [
        AppointmentDepositTransaction.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        AppointmentDepositTransaction.transaction_type == AppointmentDepositTransactionType.DEPOSIT_COLLECTION,
        AppointmentDepositTransaction.created_at >= start_utc,
        AppointmentDepositTransaction.created_at <= end_utc,
    ]


def _finance_collections_summary(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    invoice_ids = db.session.query(Invoice.id).filter(*_finance_invoice_conditions(allowed_branch_ids, filters))
    modern = (
        db.session.query(
            InvoicePayment.method,
            func.sum(InvoicePayment.amount).label("allocated"),
            func.sum(func.coalesce(InvoicePayment.entered_amount, InvoicePayment.amount)).label("entered"),
        )
        .filter(InvoicePayment.invoice_id.in_(invoice_ids))
        .group_by(InvoicePayment.method).all()
    )
    has_payment = or_(exists().where(InvoicePayment.invoice_id == Invoice.id), has_application(Invoice.id))
    legacy = (
        db.session.query(
            Invoice.payment_method,
            func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)).label("amount"),
        )
        .filter(*_finance_invoice_conditions(allowed_branch_ids, filters), ~has_payment)
        .group_by(Invoice.payment_method).all()
    )
    allocated = {method.value: Decimal("0") for method in PaymentMethod}
    raw = {method.value: Decimal("0") for method in PaymentMethod}
    modern_invoice_ids = set()
    modern_allocated_total = Decimal("0")
    modern_entered_total = Decimal("0")
    for method, amount, entered in modern:
        if method:
            allocated[method.value] += Decimal(str(amount or 0))
            raw[method.value] += Decimal(str(entered or 0))
            modern_allocated_total += Decimal(str(amount or 0))
            modern_entered_total += Decimal(str(entered or 0))
    for method, amount in legacy:
        if method:
            allocated[method.value] += Decimal(str(amount or 0))
    modern_invoice_ids.update(row[0] for row in db.session.query(InvoicePayment.invoice_id).filter(InvoicePayment.invoice_id.in_(invoice_ids)).distinct().all())
    modern_invoice_ids.update(row[0] for row in db.session.query(Invoice.id).filter(Invoice.id.in_(invoice_ids), has_application(Invoice.id)).all())
    split_subquery = (
        db.session.query(InvoicePayment.invoice_id)
        .filter(InvoicePayment.invoice_id.in_(invoice_ids), InvoicePayment.amount > 0)
        .group_by(InvoicePayment.invoice_id)
        .having(func.count(func.distinct(InvoicePayment.method)) > 1)
        .subquery()
    )
    split_count = int(db.session.query(func.count()).select_from(split_subquery).scalar() or 0)
    invoice_count = int(invoice_ids.count())
    deposit_rows = (
        db.session.query(AppointmentDepositTransaction.payment_method, func.sum(AppointmentDepositTransaction.amount).label("amount"))
        .filter(*_deposit_conditions(allowed_branch_ids, filters))
        .group_by(AppointmentDepositTransaction.payment_method).all()
    )
    deposits = {method.value: Decimal("0") for method in PaymentMethod}
    for method, amount in deposit_rows:
        deposits[method.value] += Decimal(str(amount or 0))
    invoice_total = _money(sum(allocated.values(), Decimal("0")))
    deposit_total = _money(sum(deposits.values(), Decimal("0")))
    from app.models.appointment_deposit_transaction import AppointmentDepositTransactionType as DepositKind
    applied_total = Decimal(str(db.session.query(func.coalesce(func.sum(AppointmentDepositTransaction.amount), 0)).filter(
        AppointmentDepositTransaction.invoice_id.in_(invoice_ids),
        AppointmentDepositTransaction.transaction_type == DepositKind.DEPOSIT_APPLIED).scalar() or 0))
    net_sales = _finance_performance_summary(allowed_branch_ids, filters)["net_sales"]
    if db.engine.dialect.name == "postgresql":
        deposit_date = func.date(func.timezone("Africa/Cairo", AppointmentDepositTransaction.created_at))
    else:
        deposit_date = func.date(AppointmentDepositTransaction.created_at)
    deposit_trend_rows = (
        db.session.query(deposit_date.label("day"), func.sum(AppointmentDepositTransaction.amount).label("amount"))
        .filter(*_deposit_conditions(allowed_branch_ids, filters))
        .group_by(deposit_date).order_by(deposit_date.asc()).all()
    )
    change_due = _money(db.session.query(func.coalesce(func.sum(Invoice.change_amount), 0)).filter(*_finance_invoice_conditions(allowed_branch_ids, filters)).scalar())
    modern_change_due = _money(
        db.session.query(func.coalesce(func.sum(Invoice.change_amount), 0))
        .filter(*_finance_invoice_conditions(allowed_branch_ids, filters), has_payment).scalar()
    )
    return {
        "invoice_methods": [{"method": method.value, "amount": _money(allocated[method.value]), "share_percent": _share(float(allocated[method.value]), invoice_total)} for method in PaymentMethod],
        "deposit_methods": [{"method": method.value, "amount": _money(deposits[method.value]), "share_percent": _share(float(deposits[method.value]), deposit_total)} for method in PaymentMethod],
        "invoice_collections": invoice_total,
        "deposit_collections": deposit_total,
        "deposit_trend": [{"date": str(row.day), "amount": _money(row.amount)} for row in deposit_trend_rows],
        "total_collections": _money(Decimal(str(invoice_total)) + Decimal(str(deposit_total))),
        "split_payment_invoice_count": split_count,
        "split_payment_rate": _share(split_count, invoice_count),
        "legacy_fallback_invoice_count": max(invoice_count - len(modern_invoice_ids), 0),
        "deposit_applications": _money(applied_total),
        "invoice_reconciliation_difference": _money(Decimal(str(invoice_total)) + applied_total - Decimal(str(net_sales))),
        "raw_tender": {
            "visa": _money(raw[PaymentMethod.VISA.value] + raw[PaymentMethod.VISA_1.value] + raw[PaymentMethod.VISA_2.value]),
            "visa_1": _money(raw[PaymentMethod.VISA_1.value]),
            "visa_2": _money(raw[PaymentMethod.VISA_2.value]),
            "visa_unassigned": _money(raw[PaymentMethod.VISA.value]),
            "instapay": _money(raw[PaymentMethod.INSTAPAY.value]),
            "change_due": change_due,
            "reconciliation_difference": _money(modern_entered_total - modern_allocated_total - Decimal(str(modern_change_due))),
            "basis": "modern_invoice_payments_entered_amount_only",
        },
        "basis": "invoice_payments_amount_then_legacy_invoice_net",
    }


def _business_day_scope(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    start_utc, end_utc = cairo_day_window(filters.date_from, filters.date_to)
    conditions = [
        BusinessDay.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        BusinessDay.opened_at >= start_utc,
        BusinessDay.opened_at <= end_utc,
    ]
    if filters.business_day_status:
        conditions.append(BusinessDay.status == BusinessDayStatus(filters.business_day_status))
    return conditions


def _method_totals_for_business_days(day_ids: Sequence[int], model_kind: str):
    totals = {day_id: {method.value: Decimal("0") for method in PaymentMethod} for day_id in day_ids}
    if not day_ids:
        return totals
    if model_kind == "deposit":
        rows = (
            db.session.query(AppointmentDepositTransaction.business_day_id, AppointmentDepositTransaction.payment_method, func.sum(AppointmentDepositTransaction.amount))
            .filter(
                AppointmentDepositTransaction.business_day_id.in_(day_ids),
                AppointmentDepositTransaction.transaction_type == AppointmentDepositTransactionType.DEPOSIT_COLLECTION,
            )
            .group_by(AppointmentDepositTransaction.business_day_id, AppointmentDepositTransaction.payment_method).all()
        )
        for day_id, method, amount in rows:
            totals[day_id][method.value] += Decimal(str(amount or 0))
        return totals
    modern_rows = (
        db.session.query(Invoice.business_day_id, InvoicePayment.method, func.sum(InvoicePayment.amount))
        .join(InvoicePayment, InvoicePayment.invoice_id == Invoice.id)
        .filter(Invoice.business_day_id.in_(day_ids), Invoice.status == InvoiceStatus.PAID)
        .group_by(Invoice.business_day_id, InvoicePayment.method).all()
    )
    for day_id, method, amount in modern_rows:
        totals[day_id][method.value] += Decimal(str(amount or 0))
    has_payment = or_(exists().where(InvoicePayment.invoice_id == Invoice.id), has_application(Invoice.id))
    legacy_rows = (
        db.session.query(Invoice.business_day_id, Invoice.payment_method, func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)))
        .filter(Invoice.business_day_id.in_(day_ids), Invoice.status == InvoiceStatus.PAID, ~has_payment)
        .group_by(Invoice.business_day_id, Invoice.payment_method).all()
    )
    for day_id, method, amount in legacy_rows:
        if method:
            totals[day_id][method.value] += Decimal(str(amount or 0))
    return totals


def _cash_out_by_business_day(day_ids: Sequence[int]):
    totals = {day_id: Decimal("0") for day_id in day_ids}
    breakdown = {day_id: {key: Decimal("0") for key in ("operating", "advance", "commission_withdrawal", "overtime", "drawer_change", "other")} for day_id in day_ids}
    if not day_ids:
        return totals, breakdown
    rows = (
        db.session.query(Expense.business_day_id, ExpenseCategory.code, Expense.amount, Expense.is_business_expense)
        .join(ExpenseCategory, ExpenseCategory.id == Expense.expense_category_id)
        .filter(Expense.business_day_id.in_(day_ids), Expense.is_cash_event.is_(True)).all()
    )
    for day_id, code, amount, is_business in rows:
        value = Decimal(str(amount or 0))
        totals[day_id] += value
        key = {
            "ADVANCE": "advance",
            "DAILY_PERCENTAGE": "commission_withdrawal",
            "OVERTIME": "overtime",
            "TIP_PAYOUT": "drawer_change",
        }.get(code)
        if key is None:
            key = "operating" if is_business and code not in NON_OPERATING_EXPENSE_CODES else "other"
        breakdown[day_id][key] += value
    return totals, breakdown


def _cairo_iso_date(value: Optional[datetime]):
    if not value:
        return None
    source = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return source.astimezone(CAIRO_TZ).date().isoformat()


def _business_day_rows(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, page=1, per_page=10, paginate=True):
    query = (
        db.session.query(BusinessDay, Branch.name.label("branch_name"))
        .join(Branch, Branch.id == BusinessDay.branch_id)
        .filter(*_business_day_scope(allowed_branch_ids, filters))
        .order_by(BusinessDay.opened_at.desc(), BusinessDay.id.desc())
    )
    total = query.count()
    pairs = query.offset((page - 1) * per_page).limit(per_page).all() if paginate else query.all()
    day_ids = [day.id for day, _ in pairs]
    invoice_methods = _method_totals_for_business_days(day_ids, "invoice")
    deposit_methods = _method_totals_for_business_days(day_ids, "deposit")
    cash_out, _ = _cash_out_by_business_day(day_ids)
    rows = []
    for day, branch_name in pairs:
        invoice_cash = invoice_methods[day.id][PaymentMethod.CASH.value]
        deposit_cash = deposit_methods[day.id][PaymentMethod.CASH.value]
        recomputed_cash_out = cash_out[day.id]
        recomputed_theoretical = Decimal(str(day.opening_balance or 0)) + invoice_cash + deposit_cash - recomputed_cash_out
        is_closed = day.status == BusinessDayStatus.CLOSED
        theoretical = Decimal(str(day.theoretical_balance if is_closed and day.theoretical_balance is not None else recomputed_theoretical))
        counted = Decimal(str(day.closing_balance)) if is_closed and day.closing_balance is not None else None
        variance = counted - theoretical if counted is not None else None
        rows.append({
            "business_day_id": day.id,
            "branch_id": day.branch_id,
            "branch_name": branch_name,
            "business_date": _cairo_iso_date(day.opened_at),
            "opened_at": day.opened_at.isoformat(),
            "closed_at": day.closed_at.isoformat() if day.closed_at else None,
            "status": day.status.value,
            "opening_balance": _money(day.opening_balance),
            "cash_invoice_collections": _money(invoice_cash),
            "cash_deposit_collections": _money(deposit_cash),
            "cash_out": _money(day.cash_out if is_closed else recomputed_cash_out),
            "recomputed_cash_out": _money(recomputed_cash_out),
            "theoretical_cash": _money(theoretical),
            "recomputed_theoretical_cash": _money(recomputed_theoretical),
            "counted_cash": _money(counted) if counted is not None else None,
            "variance": _money(variance) if variance is not None else None,
            "calculation_basis": "STORED_CLOSE_SNAPSHOT" if is_closed else "LIVE_RECOMPUTED",
            "invoice_methods": {method.value: _money(invoice_methods[day.id][method.value]) for method in PaymentMethod},
            "deposit_methods": {method.value: _money(deposit_methods[day.id][method.value]) for method in PaymentMethod},
        })
    return {"items": rows, "pagination": _pagination_payload(page, per_page, total)}


def _finance_cash_out(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    day_ids = [row[0] for row in db.session.query(BusinessDay.id).filter(*_business_day_scope(allowed_branch_ids, filters)).all()]
    totals, breakdown = _cash_out_by_business_day(day_ids)
    combined = {key: sum((values[key] for values in breakdown.values()), Decimal("0")) for key in ("operating", "advance", "commission_withdrawal", "overtime", "drawer_change", "other")}
    return {
        "total": _money(sum(totals.values(), Decimal("0"))),
        "breakdown": {key: _money(value) for key, value in combined.items()},
        "basis": "cash_expenses_linked_to_selected_business_days",
    }


def _finance_performance_table(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, page=1, per_page=12):
    branch_names = dict(
        db.session.query(Branch.id, Branch.name)
        .filter(Branch.id.in_(allowed_branch_ids) if allowed_branch_ids else False).all()
    )
    sales_rows = (
        db.session.query(Invoice.invoice_date, Branch.id, Branch.name, func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)))
        .join(Branch, Branch.id == Invoice.branch_id)
        .filter(*_finance_invoice_conditions(allowed_branch_ids, filters))
        .group_by(Invoice.invoice_date, Branch.id, Branch.name).all()
    )
    commission_rows = (
        db.session.query(Invoice.invoice_date, Invoice.branch_id, func.sum(_commission_expression()))
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(*_finance_invoice_conditions(allowed_branch_ids, filters))
        .group_by(Invoice.invoice_date, Invoice.branch_id).all()
    )
    expense_rows = (
        db.session.query(Expense.expense_date, Branch.id, Branch.name, func.sum(Expense.amount))
        .join(Branch, Branch.id == Expense.branch_id)
        .join(ExpenseCategory, ExpenseCategory.id == Expense.expense_category_id)
        .filter(*_finance_expense_conditions(allowed_branch_ids, filters))
        .group_by(Expense.expense_date, Branch.id, Branch.name).all()
    )
    values = {}
    for day, branch_id, branch_name, amount in sales_rows:
        values[(day, branch_id)] = {"date": day.isoformat(), "branch_id": branch_id, "branch_name": branch_name, "net_sales": _money(amount), "operating_expenses": 0.0, "recorded_commission_cost": 0.0}
    for day, branch_id, amount in commission_rows:
        key = (day, branch_id)
        values.setdefault(key, {"date": day.isoformat(), "branch_id": branch_id, "branch_name": branch_names.get(branch_id, "—"), "net_sales": 0.0, "operating_expenses": 0.0, "recorded_commission_cost": 0.0})["recorded_commission_cost"] = _money(amount)
    for day, branch_id, branch_name, amount in expense_rows:
        key = (day, branch_id)
        values.setdefault(key, {"date": day.isoformat(), "branch_id": branch_id, "branch_name": branch_name, "net_sales": 0.0, "operating_expenses": 0.0, "recorded_commission_cost": 0.0})["operating_expenses"] = _money(amount)
    rows = sorted(values.values(), key=lambda row: (row["date"], row["branch_name"]), reverse=True)
    for row in rows:
        row["operating_contribution"] = _money(Decimal(str(row["net_sales"])) - Decimal(str(row["recorded_commission_cost"])) - Decimal(str(row["operating_expenses"])))
    total = len(rows)
    return {"items": rows[(page - 1) * per_page: page * per_page], "pagination": _pagination_payload(page, per_page, total)}


def _finance_expense_table(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, page=1, per_page=12):
    query = (
        db.session.query(Expense, Branch.name.label("branch_name"), ExpenseCategory.name.label("category_name"), ExpenseCategory.code.label("category_code"))
        .join(Branch, Branch.id == Expense.branch_id)
        .join(ExpenseCategory, ExpenseCategory.id == Expense.expense_category_id)
        .filter(*_finance_expense_conditions(allowed_branch_ids, filters, operating_only=False))
        .order_by(Expense.expense_date.desc(), Expense.id.desc())
    )
    total = query.count()
    rows = query.offset((page - 1) * per_page).limit(per_page).all()
    return {"items": [{
        "expense_id": expense.id,
        "date": expense.expense_date.isoformat(),
        "branch_name": branch_name,
        "category_name": "باقي ممول من الخزنة" if category_code == "TIP_PAYOUT" else category_name,
        "category_code": category_code,
        "amount": _money(expense.amount),
        "is_business_expense": bool(expense.is_business_expense),
        "is_cash_event": bool(expense.is_cash_event),
        "business_day_id": expense.business_day_id,
    } for expense, branch_name, category_name, category_code in rows], "pagination": _pagination_payload(page, per_page, total)}


def _finance_deposit_table(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, page=1, per_page=12):
    query = (
        db.session.query(AppointmentDepositTransaction, Branch.name, Customer.full_name, Customer.phone)
        .join(Branch, Branch.id == AppointmentDepositTransaction.branch_id)
        .join(Customer, Customer.id == AppointmentDepositTransaction.customer_id)
        .filter(*_deposit_conditions(allowed_branch_ids, filters))
        .order_by(AppointmentDepositTransaction.created_at.desc(), AppointmentDepositTransaction.id.desc())
    )
    total = query.count()
    rows = query.offset((page - 1) * per_page).limit(per_page).all()
    return {"items": [{
        "transaction_id": transaction.id,
        "date": _cairo_iso_date(transaction.created_at),
        "created_at": transaction.created_at.isoformat(),
        "branch_name": branch_name,
        "appointment_id": transaction.appointment_id,
        "customer_name": customer_name or customer_phone,
        "method": transaction.payment_method.value,
        "amount": _money(transaction.amount),
        "business_day_id": transaction.business_day_id,
    } for transaction, branch_name, customer_name, customer_phone in rows], "pagination": _pagination_payload(page, per_page, total)}


def _finance_exceptions(allowed_branch_ids: Sequence[int], filters: ReportFilters, business_days: dict, collections: dict, cash_out: dict):
    items = []
    missing_day_count = int(db.session.query(func.count(Invoice.id)).filter(*_finance_invoice_conditions(allowed_branch_ids, filters), Invoice.business_day_id.is_(None)).scalar() or 0)
    if missing_day_count:
        items.append({"code": "MISSING_BUSINESS_DAY", "label": "فواتير بلا يوم عمل", "detail": f"{missing_day_count} فاتورة مدفوعة لا ترتبط بيوم عمل.", "tone": "attention"})
    payment_totals = (
        db.session.query(InvoicePayment.invoice_id.label("invoice_id"), func.sum(InvoicePayment.amount).label("allocated"))
        .group_by(InvoicePayment.invoice_id).subquery()
    )
    mismatched_invoice_count = int(
        db.session.query(func.count(Invoice.id))
        .join(payment_totals, payment_totals.c.invoice_id == Invoice.id)
        .filter(
            *_finance_invoice_conditions(allowed_branch_ids, filters),
            func.abs(payment_totals.c.allocated - (Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0))) >= 0.01,
        ).scalar() or 0
    )
    mismatch = abs(collections["invoice_reconciliation_difference"])
    if mismatched_invoice_count:
        items.append({"code": "PAYMENT_ALLOCATION_MISMATCH", "label": "فرق تخصيص التحصيل", "detail": f"{mismatched_invoice_count} فاتورة لا تتطابق شرائح تحصيلها مع صافي الفاتورة؛ صافي الفرق الكلي {mismatch:.2f} ج.م.", "tone": "attention"})
    raw_mismatch = abs(collections["raw_tender"]["reconciliation_difference"])
    if raw_mismatch >= 0.01:
        items.append({"code": "RAW_TENDER_MISMATCH", "label": "فرق الخام والباقي", "detail": f"فرق قدره {raw_mismatch:.2f} ج.م بين المبلغ المُدخل والتخصيص والباقي المسجل.", "tone": "attention"})
    has_payment = or_(exists().where(InvoicePayment.invoice_id == Invoice.id), has_application(Invoice.id))
    legacy_electronic = (
        db.session.query(func.count(Invoice.id), func.coalesce(func.sum(Invoice.discount_amount), 0))
        .filter(
            *_finance_invoice_conditions(allowed_branch_ids, filters),
            ~has_payment,
            Invoice.payment_method.in_([PaymentMethod.VISA, PaymentMethod.VISA_1, PaymentMethod.VISA_2, PaymentMethod.INSTAPAY]),
            Invoice.discount_amount > 0,
        ).one()
    )
    if int(legacy_electronic[0] or 0):
        items.append({"code": "LEGACY_ELECTRONIC_GROSS_DIFFERENCE", "label": "فرق تاريخي محتمل مع الخزنة القديمة", "detail": f"{int(legacy_electronic[0])} فاتورة إلكترونية قديمة تُحتسب هنا بالصافي؛ فرق الإجمالي القديم {float(legacy_electronic[1]):.2f} ج.م.", "tone": "neutral"})
    variance_days = [row for row in business_days["items"] if row["variance"] is not None and abs(row["variance"]) >= FINANCE_VARIANCE_ATTENTION_AMOUNT]
    if variance_days:
        items.append({"code": "CASH_VARIANCE", "label": "فروق عد نقدي", "detail": f"ظهر فرق مادي في {len(variance_days)} يوم عمل مغلق.", "tone": "attention"})
    unresolved = [row for row in business_days["items"] if row["status"] == "OPEN" and row["business_date"] and row["business_date"] < get_cairo_date().isoformat()]
    if unresolved:
        items.append({"code": "OPEN_DAY_UNRESOLVED", "label": "يوم عمل ما زال مفتوحًا", "detail": f"{len(unresolved)} يوم عمل سابق لم يُغلق.", "tone": "attention"})
    drawer_change = cash_out["breakdown"]["drawer_change"]
    if drawer_change >= FINANCE_CHANGE_ATTENTION_AMOUNT:
        items.append({"code": "DRAWER_FUNDED_CHANGE", "label": "باقي ممول من الخزنة", "detail": f"بلغ {drawer_change:.2f} ج.م خلال أيام العمل المختارة.", "tone": "neutral"})
    if collections["legacy_fallback_invoice_count"]:
        items.append({"code": "LEGACY_PAYMENT_FALLBACK", "label": "تحصيلات تاريخية", "detail": f"{collections['legacy_fallback_invoice_count']} فاتورة تستخدم صافي الفاتورة مع طريقة الدفع القديمة.", "tone": "neutral"})
    return items[:5]


def build_finance_report(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, page=1, per_page=12, expense_page=1, deposit_page=1, business_day_page=1):
    current = _finance_performance_summary(allowed_branch_ids, filters)
    previous_filters = _previous_filters(filters)
    previous = _finance_performance_summary(allowed_branch_ids, previous_filters)
    collections = _finance_collections_summary(allowed_branch_ids, filters)
    previous_collections = _finance_collections_summary(allowed_branch_ids, previous_filters)
    business_days = _business_day_rows(allowed_branch_ids, filters, page=business_day_page, per_page=10)
    exception_business_days = business_days
    if business_days["pagination"]["total"] > len(business_days["items"]):
        exception_business_days = _business_day_rows(allowed_branch_ids, filters, paginate=False)
    cash_out = _finance_cash_out(allowed_branch_ids, filters)
    comparison = _finance_performance_comparison(current, previous)
    comparison.update({
        "invoice_collections": _comparison(collections["invoice_collections"], previous_collections["invoice_collections"]),
        "deposit_collections": _comparison(collections["deposit_collections"], previous_collections["deposit_collections"]),
    })
    insights = []
    sales_insight = _comparison_insight("صافي المبيعات", comparison["net_sales"])
    if sales_insight:
        insights.append(sales_insight)
    previous_ratio = previous["operating_expense_ratio"]
    if abs(current["operating_expense_ratio"] - previous_ratio) >= 1:
        direction = "ارتفعت" if current["operating_expense_ratio"] > previous_ratio else "انخفضت"
        insights.append({"code": "EXPENSE_RATIO", "text": f"نسبة المصروفات التشغيلية {direction} من {previous_ratio:.1f}% إلى {current['operating_expense_ratio']:.1f}%."})
    if collections["total_collections"]:
        insights.append({"code": "DEPOSIT_SHARE", "text": f"تحصيلات العربون تمثل {_share(collections['deposit_collections'], collections['total_collections']):.1f}% من إجمالي التحصيلات."})
    variance_count = len([row for row in exception_business_days["items"] if row["variance"] is not None and abs(row["variance"]) >= FINANCE_VARIANCE_ATTENTION_AMOUNT])
    if variance_count:
        insights.append({"code": "VARIANCE_DAYS", "text": f"ظهر فرق نقدي مادي في {variance_count} يوم عمل مغلق خلال الفترة."})
    previous_from, previous_to = _previous_period(filters)
    return {
        "meta": {
            "date_from": filters.date_from.isoformat(), "date_to": filters.date_to.isoformat(),
            "previous_date_from": previous_from.isoformat(), "previous_date_to": previous_to.isoformat(),
            "performance_date_basis": "invoice_date_and_expense_date_cairo_calendar",
            "treasury_date_basis": "business_day_opened_at_and_exact_business_day_id",
            "currency": "EGP",
        },
        "summary": current,
        "comparison": comparison,
        "trend": _finance_trend(allowed_branch_ids, filters),
        "collections": collections,
        "cash_out": cash_out,
        "business_days": business_days,
        "insights": insights[:4],
        "attention": _finance_exceptions(allowed_branch_ids, filters, exception_business_days, collections, cash_out),
        "performance_table": _finance_performance_table(allowed_branch_ids, filters, page=page, per_page=per_page),
        "expenses_table": _finance_expense_table(allowed_branch_ids, filters, page=expense_page, per_page=per_page),
        "deposits_table": _finance_deposit_table(allowed_branch_ids, filters, page=deposit_page, per_page=per_page),
        "filter_options": {
            "expense_categories": [{"id": row.id, "name": row.name} for row in ExpenseCategory.query.order_by(ExpenseCategory.name).all()],
            "business_day_statuses": [status.value for status in BusinessDayStatus],
        },
    }


def build_finance_business_day_drilldown(allowed_branch_ids: Sequence[int], filters: ReportFilters, business_day_id: int):
    pair = (
        db.session.query(BusinessDay, Branch.name)
        .join(Branch, Branch.id == BusinessDay.branch_id)
        .filter(BusinessDay.id == business_day_id, BusinessDay.branch_id.in_(allowed_branch_ids)).first()
    )
    if not pair:
        return None
    day, branch_name = pair
    scoped_filters = ReportFilters(date_from=_cairo_date_value(day.opened_at), date_to=_cairo_date_value(day.opened_at))
    row = _business_day_rows(allowed_branch_ids, scoped_filters, paginate=False)["items"]
    snapshot = next((item for item in row if item["business_day_id"] == business_day_id), None)
    if snapshot is None:
        return None
    _, breakdown = _cash_out_by_business_day([business_day_id])
    payment_rows = (
        db.session.query(InvoicePayment.invoice_id, InvoicePayment.method, InvoicePayment.amount, InvoicePayment.entered_amount)
        .join(Invoice, Invoice.id == InvoicePayment.invoice_id)
        .filter(Invoice.business_day_id == business_day_id, Invoice.status == InvoiceStatus.PAID).all()
    )
    payment_map = {}
    for invoice_id, method, amount, entered in payment_rows:
        payment_map.setdefault(invoice_id, []).append({"method": method.value, "amount": _money(amount), "entered_amount": _money(entered if entered is not None else amount)})
    invoices = (
        db.session.query(Invoice).filter(Invoice.business_day_id == business_day_id, Invoice.status == InvoiceStatus.PAID)
        .order_by(Invoice.id.desc()).limit(50).all()
    )
    has_payment_ids = set(payment_map)
    invoice_items = []
    for invoice in invoices:
        net = _money(Decimal(str(invoice.total_amount or 0)) - Decimal(str(invoice.discount_amount or 0)))
        slices = payment_map.get(invoice.id)
        if slices is None:
            slices = [{"method": invoice.payment_method.value if invoice.payment_method else "UNKNOWN", "amount": net, "entered_amount": None}]
        invoice_items.append({"invoice_id": invoice.id, "invoice_number": invoice.invoice_number, "net_sales": net, "change_due": _money(invoice.change_amount), "payment_slices": slices, "basis": "invoice_payments" if invoice.id in has_payment_ids else "legacy_net_fallback"})
    expense_rows = (
        db.session.query(Expense, Branch.name, ExpenseCategory.name, ExpenseCategory.code)
        .join(Branch, Branch.id == Expense.branch_id)
        .join(ExpenseCategory, ExpenseCategory.id == Expense.expense_category_id)
        .filter(Expense.business_day_id == business_day_id, Expense.branch_id.in_(allowed_branch_ids))
        .order_by(Expense.id.desc()).limit(100).all()
    )
    expenses = [{
        "expense_id": expense.id,
        "date": expense.expense_date.isoformat(),
        "branch_name": expense_branch_name,
        "category_name": "باقي ممول من الخزنة" if category_code == "TIP_PAYOUT" else category_name,
        "category_code": category_code,
        "amount": _money(expense.amount),
        "is_business_expense": bool(expense.is_business_expense),
        "is_cash_event": bool(expense.is_cash_event),
        "business_day_id": expense.business_day_id,
    } for expense, expense_branch_name, category_name, category_code in expense_rows]
    deposits = (
        db.session.query(AppointmentDepositTransaction, Customer.full_name, Customer.phone)
        .join(Customer, Customer.id == AppointmentDepositTransaction.customer_id)
        .filter(AppointmentDepositTransaction.business_day_id == business_day_id, AppointmentDepositTransaction.transaction_type == AppointmentDepositTransactionType.DEPOSIT_COLLECTION)
        .order_by(AppointmentDepositTransaction.id.desc()).limit(50).all()
    )
    return {
        "business_day": snapshot,
        "branch_name": branch_name,
        "cash_out_breakdown": {key: _money(value) for key, value in breakdown[business_day_id].items()},
        "invoices": invoice_items,
        "expenses": expenses,
        "deposits": [{"transaction_id": transaction.id, "appointment_id": transaction.appointment_id, "customer_name": name or phone, "method": transaction.payment_method.value, "amount": _money(transaction.amount)} for transaction, name, phone in deposits],
        "notes": [
            "الأيام المغلقة تعرض لقطة الإغلاق المخزنة، مع تفاصيل التحصيل والمصروفات المعاد تجميعها.",
            "إجمالي الخزنة قد يختلف عن الفواتير لأنه يشمل العربون والخروج النقدي والعضوية الدقيقة ليوم العمل.",
        ],
    }


# ---------------------------------------------------------------------------
# Branch performance report
# ---------------------------------------------------------------------------

def _ratio_or_none(part: float, total: float) -> Optional[float]:
    return round((part / total) * 100.0, 1) if total else None


def _branch_comparison(current: float, previous: float, *, signed_base=False):
    result = _comparison(current, previous)
    if signed_base and previous < 0:
        result["percent_change"] = round(((current - previous) / abs(previous)) * 100.0, 1)
    return result


def _branch_financial_maps(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    sales_rows = (
        db.session.query(
            Invoice.branch_id,
            func.coalesce(func.sum(Invoice.total_amount), 0).label("gross"),
            func.coalesce(func.sum(Invoice.discount_amount), 0).label("discount"),
            func.count(Invoice.id).label("invoice_count"),
            func.count(func.distinct(Invoice.customer_id)).label("identified_customers"),
            func.sum(case((Invoice.customer_id.isnot(None), 1), else_=0)).label("identified_invoices"),
        )
        .filter(*_finance_invoice_conditions(allowed_branch_ids, filters))
        .group_by(Invoice.branch_id).all()
    )
    expenses = dict(
        db.session.query(Expense.branch_id, func.coalesce(func.sum(Expense.amount), 0))
        .join(ExpenseCategory, ExpenseCategory.id == Expense.expense_category_id)
        .filter(*_finance_expense_conditions(allowed_branch_ids, filters))
        .group_by(Expense.branch_id).all()
    )
    commissions = dict(
        db.session.query(Invoice.branch_id, func.coalesce(func.sum(_commission_expression()), 0))
        .select_from(InvoiceItem)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(*_finance_invoice_conditions(allowed_branch_ids, filters))
        .group_by(Invoice.branch_id).all()
    )
    sales = {}
    for row in sales_rows:
        gross = _money(row.gross)
        discount = _money(row.discount)
        net = _money(Decimal(str(gross)) - Decimal(str(discount)))
        count = int(row.invoice_count or 0)
        sales[row.branch_id] = {
            "gross_sales": gross,
            "discount_amount": discount,
            "net_sales": net,
            "paid_invoice_count": count,
            "average_ticket": _money(Decimal(str(net)) / count) if count else 0.0,
            "identified_customers": int(row.identified_customers or 0),
            "identified_invoice_count": int(row.identified_invoices or 0),
        }
    return sales, {key: _money(value) for key, value in expenses.items()}, {key: _money(value) for key, value in commissions.items()}


def _branch_customer_cohorts(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    first_paid = (
        db.session.query(
            Invoice.branch_id.label("branch_id"),
            Invoice.customer_id.label("customer_id"),
            func.min(Invoice.invoice_date).label("first_paid_date"),
        )
        .filter(
            Invoice.status == InvoiceStatus.PAID,
            Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            Invoice.customer_id.isnot(None),
            Invoice.invoice_date.isnot(None),
        )
        .group_by(Invoice.branch_id, Invoice.customer_id).subquery()
    )
    rows = (
        db.session.query(
            Invoice.branch_id,
            func.count(func.distinct(case((first_paid.c.first_paid_date >= filters.date_from, Invoice.customer_id)))).label("first_known"),
            func.count(func.distinct(case((first_paid.c.first_paid_date < filters.date_from, Invoice.customer_id)))).label("previously_known"),
        )
        .join(first_paid, and_(first_paid.c.branch_id == Invoice.branch_id, first_paid.c.customer_id == Invoice.customer_id))
        .filter(*_finance_invoice_conditions(allowed_branch_ids, filters), Invoice.customer_id.isnot(None))
        .group_by(Invoice.branch_id).all()
    )
    return {row.branch_id: {"first_known": int(row.first_known or 0), "previously_known": int(row.previously_known or 0)} for row in rows}


def _branch_payments(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    conditions = _finance_invoice_conditions(allowed_branch_ids, filters)
    modern = (
        db.session.query(Invoice.branch_id, InvoicePayment.method, func.sum(InvoicePayment.amount))
        .join(InvoicePayment, InvoicePayment.invoice_id == Invoice.id)
        .filter(*conditions).group_by(Invoice.branch_id, InvoicePayment.method).all()
    )
    has_payment = or_(exists().where(InvoicePayment.invoice_id == Invoice.id), has_application(Invoice.id))
    legacy = (
        db.session.query(Invoice.branch_id, Invoice.payment_method, func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)))
        .filter(*conditions, ~has_payment).group_by(Invoice.branch_id, Invoice.payment_method).all()
    )
    split_subquery = (
        db.session.query(Invoice.branch_id.label("branch_id"), InvoicePayment.invoice_id.label("invoice_id"))
        .join(InvoicePayment, InvoicePayment.invoice_id == Invoice.id)
        .filter(*conditions, InvoicePayment.amount > 0)
        .group_by(Invoice.branch_id, InvoicePayment.invoice_id)
        .having(func.count(func.distinct(InvoicePayment.method)) > 1).subquery()
    )
    split_counts = dict(db.session.query(split_subquery.c.branch_id, func.count()).group_by(split_subquery.c.branch_id).all())
    result = {branch_id: {method.value: Decimal("0") for method in PaymentMethod} for branch_id in allowed_branch_ids}
    for branch_id, method, amount in [*modern, *legacy]:
        if method:
            result.setdefault(branch_id, {item.value: Decimal("0") for item in PaymentMethod})[method.value] += Decimal(str(amount or 0))
    invoice_counts = dict(db.session.query(Invoice.branch_id, func.count(Invoice.id)).filter(*conditions).group_by(Invoice.branch_id).all())
    return {
        branch_id: {
            "methods": {method.value: _money(values[method.value]) for method in PaymentMethod},
            "split_payment_invoice_count": int(split_counts.get(branch_id, 0)),
            "split_payment_rate": _share(split_counts.get(branch_id, 0), invoice_counts.get(branch_id, 0)),
        }
        for branch_id, values in result.items()
    }


def _branch_item_context(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    conditions = _finance_invoice_conditions(allowed_branch_ids, filters)
    mix_rows = (
        db.session.query(
            Invoice.branch_id, InvoiceItem.item_type,
            func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross"),
            func.sum(InvoiceItem.quantity).label("units"),
        )
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(*conditions, InvoiceItem.item_type.in_(["SERVICE_ITEM", "PRODUCT_ITEM"]))
        .group_by(Invoice.branch_id, InvoiceItem.item_type).all()
    )
    result = {branch_id: {"service_gross_value": 0.0, "product_gross_value": 0.0, "service_units": 0, "product_units": 0} for branch_id in allowed_branch_ids}
    for branch_id, item_type, gross, units in mix_rows:
        prefix = "service" if item_type == "SERVICE_ITEM" else "product"
        result[branch_id][f"{prefix}_gross_value"] = _money(gross)
        result[branch_id][f"{prefix}_units"] = int(units or 0)

    service_rows = (
        db.session.query(Invoice.branch_id, Service.id, Service.name, func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross"), func.sum(InvoiceItem.quantity).label("units"))
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id).join(Service, Service.id == InvoiceItem.service_id)
        .filter(*conditions, InvoiceItem.item_type == "SERVICE_ITEM")
        .group_by(Invoice.branch_id, Service.id, Service.name).all()
    )
    product_rows = (
        db.session.query(Invoice.branch_id, Product.id, Product.name, func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross"), func.sum(InvoiceItem.quantity).label("units"))
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id).join(Product, Product.id == InvoiceItem.product_id)
        .filter(*conditions, InvoiceItem.item_type == "PRODUCT_ITEM")
        .group_by(Invoice.branch_id, Product.id, Product.name).all()
    )
    barber_rows = (
        db.session.query(
            Invoice.branch_id, Employee.id, Employee.full_name,
            func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross"),
            func.sum(InvoiceItem.quantity).label("units"),
            func.count(func.distinct(Invoice.id)).label("invoices"),
            func.count(func.distinct(Invoice.customer_id)).label("customers"),
        )
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id).join(Employee, Employee.id == InvoiceItem.barber_id)
        .filter(*conditions, InvoiceItem.item_type == "SERVICE_ITEM")
        .group_by(Invoice.branch_id, Employee.id, Employee.full_name).all()
    )
    service_category_rows = (
        db.session.query(Invoice.branch_id, ServiceCategory.name, func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross"))
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id).join(Service, Service.id == InvoiceItem.service_id).join(ServiceCategory, ServiceCategory.id == Service.category_id)
        .filter(*conditions, InvoiceItem.item_type == "SERVICE_ITEM")
        .group_by(Invoice.branch_id, ServiceCategory.name).all()
    )
    product_category_rows = (
        db.session.query(Invoice.branch_id, Product.category, func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross"))
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id).join(Product, Product.id == InvoiceItem.product_id)
        .filter(*conditions, InvoiceItem.item_type == "PRODUCT_ITEM")
        .group_by(Invoice.branch_id, Product.category).all()
    )
    def grouped(rows, total_key):
        grouped_rows = {}
        for branch_id, entity_id, name, gross, units, *extras in rows:
            total = result[branch_id][total_key]
            item = {"id": entity_id, "name": name, "gross_value": _money(gross), "units": int(units or 0), "share_percent": _share(float(gross or 0), total)}
            if extras:
                item.update({"paid_invoice_count": int(extras[0] or 0), "identified_customer_count": int(extras[1] or 0)})
            grouped_rows.setdefault(branch_id, []).append(item)
        for items in grouped_rows.values():
            items.sort(key=lambda item: (-item["gross_value"], item["name"]))
        return grouped_rows
    services = grouped(service_rows, "service_gross_value")
    products = grouped(product_rows, "product_gross_value")
    barbers = grouped(barber_rows, "service_gross_value")
    categories = {}
    for item_type, category_rows, total_key in (("SERVICE", service_category_rows, "service_gross_value"), ("PRODUCT", product_category_rows, "product_gross_value")):
        for branch_id, name, gross in category_rows:
            categories.setdefault(branch_id, []).append({"item_type": item_type, "name": name or "غير مصنف", "gross_value": _money(gross), "share_percent": _share(float(gross or 0), result[branch_id][total_key])})
    for items in categories.values():
        items.sort(key=lambda item: (-item["gross_value"], item["name"]))
    for branch_id, values in result.items():
        service_total = values["service_gross_value"]
        product_total = values["product_gross_value"]
        gross_total = service_total + product_total
        values.update({
            "service_share_percent": _share(service_total, gross_total),
            "product_share_percent": _share(product_total, gross_total),
            "top_services": services.get(branch_id, [])[:5],
            "top_products": products.get(branch_id, [])[:5],
            "top_barbers": barbers.get(branch_id, [])[:5],
            "categories": categories.get(branch_id, [])[:8],
            "top_service_share": services.get(branch_id, [{}])[0].get("share_percent", 0.0) if services.get(branch_id) else 0.0,
            "top_three_service_share": round(sum(item["share_percent"] for item in services.get(branch_id, [])[:3]), 1),
            "top_product_share": products.get(branch_id, [{}])[0].get("share_percent", 0.0) if products.get(branch_id) else 0.0,
            "top_three_product_share": round(sum(item["share_percent"] for item in products.get(branch_id, [])[:3]), 1),
            "top_barber_share": barbers.get(branch_id, [{}])[0].get("share_percent", 0.0) if barbers.get(branch_id) else 0.0,
        })
    return result


def _branch_attendance(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    rows = Attendance.query.filter(
        Attendance.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        Attendance.date >= filters.date_from,
        Attendance.date <= filters.date_to,
        Attendance.check_out_time.isnot(None),
        Attendance.status == AttendanceStatus.LEFT,
    ).all()
    result = {}
    for row in rows:
        values = result.setdefault(row.branch_id, {"completed_sessions": 0, "recorded_hours": 0.0, "employee_ids": set(), "checkout_sources": {source.value: 0 for source in AttendanceCheckoutSource}})
        values["completed_sessions"] += 1
        values["employee_ids"].add(row.employee_id)
        if row.check_in_time and row.check_out_time and row.check_out_time >= row.check_in_time:
            values["recorded_hours"] += (row.check_out_time - row.check_in_time).total_seconds() / 3600.0
        if row.checkout_source:
            values["checkout_sources"][row.checkout_source.value] += 1
    serialized = {}
    for branch_id, values in result.items():
        employee_ids = values.pop("employee_ids")
        serialized[branch_id] = {
            **values,
            "recorded_hours": round(values["recorded_hours"], 1),
            "employees_with_attendance": len(employee_ids),
        }
    return serialized


def _branch_appointments(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    rows = (
        db.session.query(
            Appointment.branch_id, Appointment.status, func.count(Appointment.id),
            func.sum(case((Appointment.barber_id.isnot(None), 1), else_=0)),
        )
        .filter(
            Appointment.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            Appointment.appointment_date >= filters.date_from,
            Appointment.appointment_date <= filters.date_to,
        ).group_by(Appointment.branch_id, Appointment.status).all()
    )
    result = {}
    for branch_id, status, count, barber_linked in rows:
        values = result.setdefault(branch_id, {"scheduled": 0, "completed": 0, "cancelled": 0, "barber_linked": 0, "total": 0})
        values[status.value] = int(count or 0)
        values["total"] += int(count or 0)
        values["barber_linked"] += int(barber_linked or 0)
    deposits = dict(
        db.session.query(AppointmentDepositTransaction.branch_id, func.sum(AppointmentDepositTransaction.amount))
        .filter(*_deposit_conditions(allowed_branch_ids, filters)).group_by(AppointmentDepositTransaction.branch_id).all()
    )
    for branch_id in allowed_branch_ids:
        result.setdefault(branch_id, {"scheduled": 0, "completed": 0, "cancelled": 0, "barber_linked": 0, "total": 0})["deposit_collections"] = _money(deposits.get(branch_id, 0))
    return result


def _branch_treasury(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    rows = _business_day_rows(allowed_branch_ids, filters, paginate=False)["items"]
    today = get_cairo_date().isoformat()
    result = {}
    for row in rows:
        values = result.setdefault(row["branch_id"], {"closed_days": 0, "open_overdue_days": 0, "material_variance_days": 0, "total_absolute_variance": 0.0, "largest_absolute_variance": 0.0})
        if row["status"] == "CLOSED":
            values["closed_days"] += 1
            variance = abs(row["variance"] or 0)
            values["total_absolute_variance"] += variance
            values["largest_absolute_variance"] = max(values["largest_absolute_variance"], variance)
            if variance >= FINANCE_VARIANCE_ATTENTION_AMOUNT:
                values["material_variance_days"] += 1
        elif row["business_date"] and row["business_date"] < today:
            values["open_overdue_days"] += 1
    for values in result.values():
        values["total_absolute_variance"] = _money(values["total_absolute_variance"])
        values["largest_absolute_variance"] = _money(values["largest_absolute_variance"])
        values["variance_frequency"] = _share(values["material_variance_days"], values["closed_days"])
        values["variance_ranking_eligible"] = values["closed_days"] >= 5
    return result


def _branch_inventory(allowed_branch_ids: Sequence[int], filters: ReportFilters, item_context: dict):
    stock_rows = (
        db.session.query(
            ProductBranchStock.branch_id,
            func.coalesce(func.sum(ProductBranchStock.stock_quantity), 0),
            func.sum(case((ProductBranchStock.stock_quantity <= 0, 1), else_=0)),
            func.sum(case((and_(ProductBranchStock.stock_quantity > 0, ProductBranchStock.stock_quantity <= Product.min_stock_threshold), 1), else_=0)),
        ).join(Product, Product.id == ProductBranchStock.product_id)
        .filter(ProductBranchStock.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False)
        .group_by(ProductBranchStock.branch_id).all()
    )
    result = {branch_id: {"stock_units": int(units or 0), "out_of_stock_products": int(out_count or 0), "low_stock_products": int(low_count or 0)} for branch_id, units, out_count, low_count in stock_rows}
    expiry_rows = (
        db.session.query(
            BranchInventoryBatch.branch_id,
            func.sum(case((InventoryBatch.expiration_date < get_cairo_date(), BranchInventoryBatch.remaining_quantity), else_=0)),
            func.sum(case((and_(InventoryBatch.expiration_date >= get_cairo_date(), InventoryBatch.expiration_date <= get_cairo_date() + timedelta(days=30)), BranchInventoryBatch.remaining_quantity), else_=0)),
        ).join(InventoryBatch, InventoryBatch.id == BranchInventoryBatch.batch_id)
        .filter(BranchInventoryBatch.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False, BranchInventoryBatch.remaining_quantity > 0)
        .group_by(BranchInventoryBatch.branch_id).all()
    )
    for branch_id, expired, near in expiry_rows:
        result.setdefault(branch_id, {})["expired_batch_units"] = int(expired or 0)
        result[branch_id]["near_expiry_batch_units"] = int(near or 0)
    supply = dict(db.session.query(StockSupplyRequest.branch_id, func.count(StockSupplyRequest.id)).filter(StockSupplyRequest.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False, StockSupplyRequest.status == "PENDING").group_by(StockSupplyRequest.branch_id).all())
    returns = dict(db.session.query(StockReturnRequest.branch_id, func.count(StockReturnRequest.id)).filter(StockReturnRequest.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False, StockReturnRequest.status == "PENDING").group_by(StockReturnRequest.branch_id).all())
    inbound = dict(db.session.query(StockShipment.destination_branch_id, func.count(StockShipment.id)).filter(StockShipment.destination_branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False, StockShipment.status == "IN_TRANSIT").group_by(StockShipment.destination_branch_id).all())
    outbound = dict(db.session.query(StockShipment.source_branch_id, func.count(StockShipment.id)).filter(StockShipment.source_branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False, StockShipment.status == "IN_TRANSIT").group_by(StockShipment.source_branch_id).all())
    stock_by_branch_product = {(row.branch_id, row.product_id): row.stock_quantity for row in ProductBranchStock.query.filter(ProductBranchStock.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False).all()}
    product_unit_rows = (
        db.session.query(Invoice.branch_id, InvoiceItem.product_id, func.sum(InvoiceItem.quantity))
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(*_finance_invoice_conditions(allowed_branch_ids, filters), InvoiceItem.item_type == "PRODUCT_ITEM")
        .group_by(Invoice.branch_id, InvoiceItem.product_id).all()
    )
    product_units = {(branch_id, product_id): int(units or 0) for branch_id, product_id, units in product_unit_rows}
    top_product_ids = {item["id"] for values in item_context.values() for item in values.get("top_products", [])[:10]}
    product_thresholds = dict(db.session.query(Product.id, Product.min_stock_threshold).filter(Product.id.in_(top_product_ids)).all()) if top_product_ids else {}
    for branch_id in allowed_branch_ids:
        values = result.setdefault(branch_id, {"stock_units": 0, "out_of_stock_products": 0, "low_stock_products": 0})
        values.setdefault("expired_batch_units", 0)
        values.setdefault("near_expiry_batch_units", 0)
        values.update({"pending_supply_requests": int(supply.get(branch_id, 0)), "inbound_transfers": int(inbound.get(branch_id, 0)), "outbound_transfers": int(outbound.get(branch_id, 0)), "pending_returns": int(returns.get(branch_id, 0))})
        values["slow_moving_products"] = sum(1 for (stock_branch_id, product_id), stock in stock_by_branch_product.items() if stock_branch_id == branch_id and stock > 0 and product_units.get((branch_id, product_id), 0) <= PRODUCT_SLOW_MOVING_MAX_UNITS)
        risks = []
        for product in item_context.get(branch_id, {}).get("top_products", [])[:10]:
            stock = int(stock_by_branch_product.get((branch_id, product["id"]), 0) or 0)
            threshold = product_thresholds.get(product["id"])
            if threshold is not None and stock <= threshold:
                risks.append({"product_id": product["id"], "name": product["name"], "current_stock": stock, "state": "OUT" if stock <= 0 else "LOW"})
        values["top_selling_stock_risks"] = risks
    return result


def _branch_daily_performance(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    sales = dict(((row.branch_id, row.invoice_date), (_money(row.net), int(row.count or 0))) for row in (
        db.session.query(Invoice.branch_id, Invoice.invoice_date, func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)).label("net"), func.count(Invoice.id).label("count"))
        .filter(*_finance_invoice_conditions(allowed_branch_ids, filters)).group_by(Invoice.branch_id, Invoice.invoice_date).all()
    ))
    expenses = dict(((row.branch_id, row.expense_date), _money(row.amount)) for row in (
        db.session.query(Expense.branch_id, Expense.expense_date, func.sum(Expense.amount).label("amount")).join(ExpenseCategory, ExpenseCategory.id == Expense.expense_category_id)
        .filter(*_finance_expense_conditions(allowed_branch_ids, filters)).group_by(Expense.branch_id, Expense.expense_date).all()
    ))
    commissions = dict(((row.branch_id, row.invoice_date), _money(row.amount)) for row in (
        db.session.query(Invoice.branch_id, Invoice.invoice_date, func.sum(_commission_expression()).label("amount")).select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(*_finance_invoice_conditions(allowed_branch_ids, filters)).group_by(Invoice.branch_id, Invoice.invoice_date).all()
    ))
    names = dict(db.session.query(Branch.id, Branch.name).filter(Branch.id.in_(allowed_branch_ids) if allowed_branch_ids else False).all())
    keys = sorted(set(sales) | set(expenses) | set(commissions), key=lambda value: (value[1], names.get(value[0], "")))
    result = []
    for branch_id, day in keys:
        net, count = sales.get((branch_id, day), (0.0, 0))
        expense = expenses.get((branch_id, day), 0.0)
        commission = commissions.get((branch_id, day), 0.0)
        result.append({"date": day.isoformat(), "branch_id": branch_id, "branch_name": names.get(branch_id, ""), "net_sales": net, "paid_invoice_count": count, "average_ticket": _money(Decimal(str(net)) / count) if count else 0.0, "operating_expenses": expense, "recorded_commission_cost": commission, "operating_contribution": _money(Decimal(str(net)) - Decimal(str(expense)) - Decimal(str(commission)))})
    return result


def _branch_attention(branches: list[dict]):
    items = []
    for branch in branches:
        comparisons = branch["comparison"]
        previous_count = comparisons["paid_invoice_count"]["previous"]
        if comparisons["net_sales"]["percent_change"] is not None and comparisons["net_sales"]["percent_change"] <= BRANCH_DECLINE_ATTENTION_PERCENT and comparisons["net_sales"]["previous"] >= 100 and previous_count >= 3:
            items.append({"code": "BRANCH_NET_SALES_DECLINE", "entity_id": branch["branch_id"], "label": "انخفاض صافي المبيعات", "detail": f"{branch['branch_name']} انخفض {abs(comparisons['net_sales']['percent_change']):.1f}% مقارنة بالفترة السابقة.", "tone": "attention"})
        elif comparisons["paid_invoice_count"]["percent_change"] is not None and comparisons["paid_invoice_count"]["percent_change"] <= BRANCH_DECLINE_ATTENTION_PERCENT and previous_count >= 5:
            items.append({"code": "BRANCH_INVOICE_DECLINE", "entity_id": branch["branch_id"], "label": "انخفاض عدد الفواتير", "detail": f"{branch['branch_name']} سجّل انخفاضاً قدره {abs(comparisons['paid_invoice_count']['percent_change']):.1f}% في الفواتير المدفوعة.", "tone": "attention"})
        previous_net = comparisons["net_sales"]["previous"]
        previous_expense = comparisons["operating_expenses"]["previous"]
        previous_ratio = _ratio_or_none(previous_expense, previous_net)
        if branch["expense_ratio"] is not None and previous_ratio is not None and branch["expense_ratio"] - previous_ratio >= BRANCH_EXPENSE_RATIO_INCREASE_POINTS:
            items.append({"code": "BRANCH_EXPENSE_RATIO_INCREASE", "entity_id": branch["branch_id"], "label": "ارتفاع نسبة المصروفات", "detail": f"{branch['branch_name']} ارتفعت نسبة مصروفاته التشغيلية {branch['expense_ratio'] - previous_ratio:.1f} نقطة مئوية.", "tone": "attention"})
        if branch["net_sales"] > 0 and branch["operating_contribution"] < 0:
            items.append({"code": "BRANCH_NEGATIVE_CONTRIBUTION", "entity_id": branch["branch_id"], "label": "مساهمة تشغيلية سالبة", "detail": f"المساهمة التشغيلية المسجلة في {branch['branch_name']} سالبة خلال الفترة.", "tone": "attention"})
        mix = branch["mix"]
        if mix["top_service_share"] >= 45 and mix["service_gross_value"] >= 100 and mix["service_units"] >= 5:
            items.append({"code": "BRANCH_SERVICE_CONCENTRATION", "entity_id": branch["branch_id"], "label": "تركز في خدمة واحدة", "detail": f"الخدمة الأعلى تمثل {mix['top_service_share']:.1f}% من قيمة الخدمات الإجمالية في {branch['branch_name']}.", "tone": "neutral"})
        if mix["top_product_share"] >= 45 and mix["product_gross_value"] >= 100 and mix["product_units"] >= 5:
            items.append({"code": "BRANCH_PRODUCT_CONCENTRATION", "entity_id": branch["branch_id"], "label": "تركز في منتج واحد", "detail": f"المنتج الأعلى يمثل {mix['top_product_share']:.1f}% من قيمة المنتجات الإجمالية في {branch['branch_name']}.", "tone": "neutral"})
        if mix["top_barber_share"] >= 50 and mix["service_units"] >= 10:
            items.append({"code": "BRANCH_BARBER_CONCENTRATION", "entity_id": branch["branch_id"], "label": "تركز إسناد الخدمات", "detail": f"الحلاق الأعلى يمثل {mix['top_barber_share']:.1f}% من قيمة الخدمات المسندة في {branch['branch_name']}.", "tone": "neutral"})
        treasury = branch["treasury"]
        if treasury["closed_days"] >= 5 and treasury["material_variance_days"] >= 2 and treasury["variance_frequency"] >= 20:
            items.append({"code": "BRANCH_REPEATED_VARIANCE", "entity_id": branch["branch_id"], "label": "فروق نقدية متكررة", "detail": f"ظهر فرق مادي في {treasury['material_variance_days']} من {treasury['closed_days']} أيام مغلقة في {branch['branch_name']}.", "tone": "attention"})
        if treasury["open_overdue_days"]:
            items.append({"code": "BRANCH_OLD_OPEN_DAY", "entity_id": branch["branch_id"], "label": "يوم عمل سابق مفتوح", "detail": f"لدى {branch['branch_name']} {treasury['open_overdue_days']} يوم عمل سابق لم يُغلق.", "tone": "attention"})
        if branch["inventory"]["top_selling_stock_risks"]:
            risk = branch["inventory"]["top_selling_stock_risks"][0]
            items.append({"code": "BRANCH_TOP_PRODUCT_STOCK_RISK", "entity_id": branch["branch_id"], "label": "مخزون منتج متصدر", "detail": f"{risk['name']} من المنتجات المتصدرة في {branch['branch_name']} ومخزونه الحالي {risk['current_stock']}.", "tone": "attention"})
    priority = {"BRANCH_NEGATIVE_CONTRIBUTION": 0, "BRANCH_NET_SALES_DECLINE": 1, "BRANCH_REPEATED_VARIANCE": 2, "BRANCH_OLD_OPEN_DAY": 3, "BRANCH_TOP_PRODUCT_STOCK_RISK": 4}
    return sorted(items, key=lambda item: (priority.get(item["code"], 9), item["label"]))[:5]


def build_branch_report(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    branch_models = Branch.query.filter(Branch.id.in_(allowed_branch_ids) if allowed_branch_ids else False).order_by(Branch.name.asc()).all()
    current_sales, current_expenses, current_commissions = _branch_financial_maps(allowed_branch_ids, filters)
    previous_filters = _previous_filters(filters)
    previous_sales, previous_expenses, previous_commissions = _branch_financial_maps(allowed_branch_ids, previous_filters)
    mix = _branch_item_context(allowed_branch_ids, filters)
    payments = _branch_payments(allowed_branch_ids, filters)
    cohorts = _branch_customer_cohorts(allowed_branch_ids, filters)
    attendance = _branch_attendance(allowed_branch_ids, filters)
    appointments = _branch_appointments(allowed_branch_ids, filters)
    treasury = _branch_treasury(allowed_branch_ids, filters)
    inventory = _branch_inventory(allowed_branch_ids, filters, mix)
    total_net = sum((current_sales.get(branch.id, {}).get("net_sales", 0.0) for branch in branch_models), 0.0)
    rows = []
    for branch in branch_models:
        current = current_sales.get(branch.id, {"gross_sales": 0.0, "discount_amount": 0.0, "net_sales": 0.0, "paid_invoice_count": 0, "average_ticket": 0.0, "identified_customers": 0, "identified_invoice_count": 0})
        previous = previous_sales.get(branch.id, {"net_sales": 0.0, "paid_invoice_count": 0, "average_ticket": 0.0})
        expense = current_expenses.get(branch.id, 0.0)
        commission = current_commissions.get(branch.id, 0.0)
        contribution = _money(Decimal(str(current["net_sales"])) - Decimal(str(expense)) - Decimal(str(commission)))
        previous_expense = previous_expenses.get(branch.id, 0.0)
        previous_commission = previous_commissions.get(branch.id, 0.0)
        previous_contribution = _money(Decimal(str(previous["net_sales"])) - Decimal(str(previous_expense)) - Decimal(str(previous_commission)))
        low_base = current["paid_invoice_count"] < BRANCH_LOW_BASE_INVOICES
        branch_mix = mix.get(branch.id, {"service_gross_value": 0.0, "product_gross_value": 0.0, "service_units": 0, "product_units": 0, "service_share_percent": 0.0, "product_share_percent": 0.0, "top_services": [], "top_products": [], "top_barbers": [], "categories": [], "top_service_share": 0.0, "top_three_service_share": 0.0, "top_product_share": 0.0, "top_three_product_share": 0.0, "top_barber_share": 0.0})
        attendance_values = attendance.get(branch.id, {"completed_sessions": 0, "recorded_hours": 0.0, "employees_with_attendance": 0, "checkout_sources": {source.value: 0 for source in AttendanceCheckoutSource}})
        attendance_values["attributed_service_gross_per_recorded_hour"] = _money(Decimal(str(branch_mix["service_gross_value"])) / Decimal(str(attendance_values["recorded_hours"]))) if attendance_values["recorded_hours"] > 0 else None
        row = {
            "branch_id": branch.id, "branch_name": branch.name, "is_active": bool(branch.is_active),
            **current,
            "operating_expenses": expense, "recorded_commission_cost": commission, "operating_contribution": contribution,
            "expense_ratio": _ratio_or_none(expense, current["net_sales"]), "commission_ratio": _ratio_or_none(commission, current["net_sales"]), "contribution_ratio": _ratio_or_none(contribution, current["net_sales"]),
            "scope_share_percent": _share(current["net_sales"], total_net), "low_base": low_base,
            "ranking_eligible": {"average_ticket": not low_base, "expense_ratio": not low_base and current["net_sales"] > 0, "commission_ratio": not low_base and current["net_sales"] > 0, "contribution_ratio": not low_base and current["net_sales"] > 0, "growth": previous["net_sales"] > 0 and previous["paid_invoice_count"] >= 3},
            "comparison": {
                "net_sales": _branch_comparison(current["net_sales"], previous["net_sales"]),
                "paid_invoice_count": _branch_comparison(current["paid_invoice_count"], previous["paid_invoice_count"]),
                "average_ticket": _branch_comparison(current["average_ticket"], previous["average_ticket"]),
                "operating_expenses": _branch_comparison(expense, previous_expense),
                "recorded_commission_cost": _branch_comparison(commission, previous_commission),
                "operating_contribution": _branch_comparison(contribution, previous_contribution, signed_base=True),
            },
            "mix": branch_mix,
            "payments": payments.get(branch.id, {"methods": {method.value: 0.0 for method in PaymentMethod}, "split_payment_invoice_count": 0, "split_payment_rate": 0.0}),
            "customers": {"identified_invoice_share": _share(current["identified_invoice_count"], current["paid_invoice_count"]), "anonymous_invoice_share": _share(current["paid_invoice_count"] - current["identified_invoice_count"], current["paid_invoice_count"]), **cohorts.get(branch.id, {"first_known": 0, "previously_known": 0})},
            "attendance": attendance_values,
            "appointments": appointments.get(branch.id, {"scheduled": 0, "completed": 0, "cancelled": 0, "barber_linked": 0, "total": 0, "deposit_collections": 0.0}),
            "treasury": treasury.get(branch.id, {"closed_days": 0, "open_overdue_days": 0, "material_variance_days": 0, "variance_frequency": 0.0, "variance_ranking_eligible": False, "total_absolute_variance": 0.0, "largest_absolute_variance": 0.0}),
            "inventory": inventory.get(branch.id, {"stock_units": 0, "low_stock_products": 0, "out_of_stock_products": 0, "expired_batch_units": 0, "near_expiry_batch_units": 0, "slow_moving_products": 0, "pending_supply_requests": 0, "inbound_transfers": 0, "outbound_transfers": 0, "pending_returns": 0, "top_selling_stock_risks": []}),
        }
        count_change = row["comparison"]["paid_invoice_count"]["percent_change"]
        ticket_change = row["comparison"]["average_ticket"]["percent_change"]
        if count_change is None or ticket_change is None:
            driver = "نشاط جديد مسجل في الفترة الحالية" if current["net_sales"] > 0 and previous["net_sales"] == 0 else "لا توجد قاعدة سابقة صالحة لتحليل المحركات"
        elif abs(count_change) < COMPARISON_NEUTRAL_BAND_PERCENT and abs(ticket_change) < COMPARISON_NEUTRAL_BAND_PERCENT:
            driver = "لم يتغير عدد الفواتير أو متوسط الفاتورة بصورة ملحوظة."
        elif count_change >= COMPARISON_NEUTRAL_BAND_PERCENT and ticket_change >= COMPARISON_NEUTRAL_BAND_PERCENT:
            driver = "ارتفع كل من عدد الفواتير ومتوسط الفاتورة."
        elif count_change <= -COMPARISON_NEUTRAL_BAND_PERCENT and ticket_change <= -COMPARISON_NEUTRAL_BAND_PERCENT:
            driver = "انخفض كل من عدد الفواتير ومتوسط الفاتورة."
        elif count_change >= COMPARISON_NEUTRAL_BAND_PERCENT:
            driver = "ارتفع عدد الفواتير بينما لم يرتفع متوسط الفاتورة معه."
        elif ticket_change >= COMPARISON_NEUTRAL_BAND_PERCENT:
            driver = "ارتفع متوسط الفاتورة بينما لم يرتفع عدد الفواتير معه."
        elif count_change <= -COMPARISON_NEUTRAL_BAND_PERCENT:
            driver = "انخفض عدد الفواتير مع ثبات أو ارتفاع متوسط الفاتورة."
        else:
            driver = "انخفض متوسط الفاتورة مع ثبات أو ارتفاع عدد الفواتير."
        row["growth_driver"] = driver
        rows.append(row)
    rows.sort(key=lambda row: (-row["net_sales"], row["branch_name"]))
    insights = []
    if rows and total_net > 0:
        insights.append({"code": "TOP_BRANCH_SHARE", "text": f"{rows[0]['branch_name']} يمثل {rows[0]['scope_share_percent']:.1f}% من صافي المبيعات ضمن النطاق المختار."})
    changed = next((row for row in rows if row["comparison"]["net_sales"]["percent_change"] is not None and abs(row["comparison"]["net_sales"]["percent_change"]) >= 2), None)
    if changed:
        insights.append({"code": "BRANCH_CHANGE_DRIVER", "text": f"{changed['branch_name']}: {changed['growth_driver']}"})
    ratio_row = next((row for row in rows if row["expense_ratio"] is not None), None)
    if ratio_row:
        insights.append({"code": "BRANCH_EXPENSE_RATIO", "text": f"المصروفات التشغيلية في {ratio_row['branch_name']} تمثل {ratio_row['expense_ratio']:.1f}% من صافي مبيعاته."})
    concentrated = next((row for row in rows if row["mix"]["top_service_share"] >= 45), None)
    if concentrated and concentrated["mix"]["top_services"]:
        insights.append({"code": "BRANCH_SERVICE_SHARE", "text": f"{concentrated['mix']['top_services'][0]['name']} تمثل {concentrated['mix']['top_service_share']:.1f}% من قيمة الخدمات الإجمالية في {concentrated['branch_name']}."})
    previous_from, previous_to = _previous_period(filters)
    return {
        "meta": {"date_from": filters.date_from.isoformat(), "date_to": filters.date_to.isoformat(), "previous_date_from": previous_from.isoformat(), "previous_date_to": previous_to.isoformat(), "date_basis": "transaction_time_branch_and_cairo_calendar_dates", "currency": "EGP", "low_base_invoice_threshold": BRANCH_LOW_BASE_INVOICES},
        "summary": {"branch_count": len(rows), "net_sales": _money(total_net), "paid_invoice_count": sum(row["paid_invoice_count"] for row in rows), "operating_expenses": _money(sum(row["operating_expenses"] for row in rows)), "recorded_commission_cost": _money(sum(row["recorded_commission_cost"] for row in rows)), "operating_contribution": _money(sum(row["operating_contribution"] for row in rows))},
        "branches": rows,
        "daily_performance": _branch_daily_performance(allowed_branch_ids, filters),
        "insights": insights[:4],
        "attention": _branch_attention(rows),
    }


def build_branch_drilldown(allowed_branch_ids: Sequence[int], filters: ReportFilters, branch_id: int):
    if branch_id not in allowed_branch_ids:
        return None
    report = build_branch_report([branch_id], filters)
    return report["branches"][0] if report["branches"] else None


# ---------------------------------------------------------------------------
# Employees / Barbers Intelligence
# ---------------------------------------------------------------------------

def _employee_role_column(mode: str):
    if mode == "BARBER":
        return InvoiceItem.barber_id
    if mode == "ASSISTANT":
        return InvoiceItem.assistant_id
    raise ValueError("Service employee mode must be BARBER or ASSISTANT.")


def _employee_service_conditions(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, include_dates=True):
    employee_column = _employee_role_column(filters.employee_mode)
    conditions = [
        Invoice.status == InvoiceStatus.PAID,
        InvoiceItem.item_type == "SERVICE_ITEM",
        InvoiceItem.service_id.isnot(None),
        employee_column.isnot(None),
        *_branch_conditions(allowed_branch_ids),
    ]
    if include_dates:
        conditions.extend([Invoice.invoice_date >= filters.date_from, Invoice.invoice_date <= filters.date_to])
    if filters.employee_id:
        conditions.append(employee_column == filters.employee_id)
    if filters.service_id:
        conditions.append(InvoiceItem.service_id == filters.service_id)
    if filters.category_id:
        conditions.append(Service.category_id == filters.category_id)
    return conditions


def _employee_service_commission_expression(mode: str):
    percent = InvoiceItem.barber_commission_percent if mode == "BARBER" else InvoiceItem.assistant_commission_percent
    price_numeric = cast(func.coalesce(InvoiceItem.service_price, 0), Numeric(18, 6))
    percent_numeric = cast(func.coalesce(percent, 0), Numeric(18, 6))
    return case(
        (Invoice.is_fully_discounted.is_(True), 0),
        else_=func.round(price_numeric * percent_numeric / Decimal("100"), 2),
    )


def _employee_service_core_rows(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    employee_column = _employee_role_column(filters.employee_mode)
    commission = _employee_service_commission_expression(filters.employee_mode)
    rows = (
        db.session.query(
            Employee.id,
            Employee.full_name,
            Employee.employee_type,
            Employee.branch_id.label("current_branch_id"),
            Branch.name.label("current_branch_name"),
            Employee.is_active,
            Employee.is_deleted,
            Employee.status,
            Employee.commission_wallet_balance,
            Employee.base_salary,
            func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross_value"),
            func.sum(InvoiceItem.quantity).label("units"),
            func.count(func.distinct(Invoice.id)).label("invoice_count"),
            func.count(func.distinct(Invoice.customer_id)).label("customer_count"),
            func.sum(commission).label("commission_accrued"),
        )
        .select_from(InvoiceItem)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .join(Service, Service.id == InvoiceItem.service_id)
        .join(Employee, Employee.id == employee_column)
        .outerjoin(Branch, Branch.id == Employee.branch_id)
        .filter(*_employee_service_conditions(allowed_branch_ids, filters))
        .group_by(
            Employee.id, Employee.full_name, Employee.employee_type, Employee.branch_id, Branch.name,
            Employee.is_active, Employee.is_deleted, Employee.status,
            Employee.commission_wallet_balance, Employee.base_salary,
        )
        .all()
    )
    result = {}
    for row in rows:
        units = int(row.units or 0)
        invoices = int(row.invoice_count or 0)
        gross = _money(row.gross_value)
        result[row.id] = {
            "employee_id": row.id,
            "employee_name": row.full_name,
            "current_role": row.employee_type.value if row.employee_type else None,
            "current_branch_id": row.current_branch_id,
            "current_branch_name": row.current_branch_name,
            "current_status": row.status.value if row.status else ("ACTIVE" if row.is_active else "SUSPENDED"),
            "is_active": bool(row.is_active),
            "is_deleted": bool(row.is_deleted),
            "gross_service_value": gross,
            "service_units": units,
            "paid_invoice_count": invoices,
            "identified_customer_count": int(row.customer_count or 0),
            "average_gross_per_unit": _money(Decimal(str(gross)) / units) if units else 0.0,
            "average_gross_per_invoice": _money(Decimal(str(gross)) / invoices) if invoices else 0.0,
            "service_commission_accrued": _money(row.commission_accrued),
            "current_wallet": _money(row.commission_wallet_balance),
            "current_base_salary": _money(row.base_salary),
            "low_base": units < EMPLOYEE_SERVICE_LOW_BASE_UNITS,
            "ranking_eligible": {
                "gross_service_value": units >= EMPLOYEE_SERVICE_RANKING_MIN_UNITS,
                "average_gross_per_unit": units >= EMPLOYEE_AVERAGE_MIN_UNITS,
                "average_gross_per_invoice": invoices >= 5,
                "identified_customer_count": int(row.customer_count or 0) >= EMPLOYEE_CUSTOMER_MIN_COUNT,
                "attendance_hours": False,
                "gross_per_recorded_hour": False,
                "growth": False,
            },
        }
    return result


def _employee_service_breakdowns(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    employee_column = _employee_role_column(filters.employee_mode)
    conditions = _employee_service_conditions(allowed_branch_ids, filters)
    service_rows = (
        db.session.query(
            employee_column.label("employee_id"), Service.id, Service.name,
            ServiceCategory.id.label("category_id"), ServiceCategory.name.label("category_name"),
            func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross_value"),
            func.sum(InvoiceItem.quantity).label("units"),
        )
        .select_from(InvoiceItem)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .join(Service, Service.id == InvoiceItem.service_id)
        .join(ServiceCategory, ServiceCategory.id == Service.category_id)
        .filter(*conditions)
        .group_by(employee_column, Service.id, Service.name, ServiceCategory.id, ServiceCategory.name)
        .all()
    )
    category_rows = (
        db.session.query(
            employee_column.label("employee_id"), ServiceCategory.id, ServiceCategory.name,
            func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross_value"),
            func.sum(InvoiceItem.quantity).label("units"),
        )
        .select_from(InvoiceItem)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .join(Service, Service.id == InvoiceItem.service_id)
        .join(ServiceCategory, ServiceCategory.id == Service.category_id)
        .filter(*conditions)
        .group_by(employee_column, ServiceCategory.id, ServiceCategory.name)
        .all()
    )
    by_employee = {}
    for row in service_rows:
        gross = _money(row.gross_value)
        units = int(row.units or 0)
        by_employee.setdefault(row.employee_id, {"services": [], "categories": []})["services"].append({
            "service_id": row.id, "service_name": row.name,
            "category_id": row.category_id, "category_name": row.category_name,
            "gross_value": gross, "units": units,
            "average_gross_per_unit": _money(Decimal(str(gross)) / units) if units else 0.0,
        })
    for row in category_rows:
        by_employee.setdefault(row.employee_id, {"services": [], "categories": []})["categories"].append({
            "category_id": row.id, "category_name": row.name,
            "gross_value": _money(row.gross_value), "units": int(row.units or 0),
        })
    for values in by_employee.values():
        values["services"].sort(key=lambda item: (-item["gross_value"], item["service_name"]))
        values["categories"].sort(key=lambda item: (-item["gross_value"], item["category_name"]))
    return by_employee


def _employee_customer_context(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    employee_column = _employee_role_column(filters.employee_mode)
    base = _employee_service_conditions(allowed_branch_ids, filters)
    repeat_rows = (
        db.session.query(employee_column.label("employee_id"), Invoice.customer_id)
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id).join(Service, Service.id == InvoiceItem.service_id)
        .filter(*base, Invoice.customer_id.isnot(None))
        .group_by(employee_column, Invoice.customer_id)
        .having(func.count(func.distinct(Invoice.id)) >= 2)
        .all()
    )
    current_pairs = set(
        db.session.query(employee_column, Invoice.customer_id)
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id).join(Service, Service.id == InvoiceItem.service_id)
        .filter(*base, Invoice.customer_id.isnot(None)).distinct().all()
    )
    historical_conditions = _employee_service_conditions(allowed_branch_ids, filters, include_dates=False)
    historical_pairs = set(
        db.session.query(employee_column, Invoice.customer_id)
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id).join(Service, Service.id == InvoiceItem.service_id)
        .filter(*historical_conditions, Invoice.invoice_date < filters.date_from, Invoice.customer_id.isnot(None)).distinct().all()
    )
    result = {}
    for employee_id, _customer_id in repeat_rows:
        result.setdefault(employee_id, {"repeat_identified_customers": 0, "previously_recorded_customers": 0})["repeat_identified_customers"] += 1
    for employee_id, customer_id in current_pairs & historical_pairs:
        result.setdefault(employee_id, {"repeat_identified_customers": 0, "previously_recorded_customers": 0})["previously_recorded_customers"] += 1
    return result


def _employee_transaction_branches(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    employee_column = _employee_role_column(filters.employee_mode)
    rows = (
        db.session.query(employee_column.label("employee_id"), Branch.id, Branch.name,
                         func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross"),
                         func.sum(InvoiceItem.quantity).label("units"))
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .join(Service, Service.id == InvoiceItem.service_id).join(Branch, Branch.id == Invoice.branch_id)
        .filter(*_employee_service_conditions(allowed_branch_ids, filters))
        .group_by(employee_column, Branch.id, Branch.name).all()
    )
    result = {}
    for employee_id, branch_id, name, gross, units in rows:
        result.setdefault(employee_id, []).append({"branch_id": branch_id, "branch_name": name, "gross_value": _money(gross), "units": int(units or 0)})
    return result


def _employee_attendance_context(allowed_branch_ids: Sequence[int], filters: ReportFilters, activity_dates=None):
    conditions = [
        Attendance.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        Attendance.date >= filters.date_from,
        Attendance.date <= filters.date_to,
    ]
    if filters.employee_id:
        conditions.append(Attendance.employee_id == filters.employee_id)
    rows = Attendance.query.filter(*conditions).all()
    result = {}
    completed_dates = set()
    for row in rows:
        values = result.setdefault(row.employee_id, {
            "completed_sessions": 0, "recorded_workdays": 0, "recorded_hours": 0.0,
            "average_session_hours": 0.0, "incomplete_sessions": 0,
            "checkout_sources": {source.value: 0 for source in AttendanceCheckoutSource},
            "attendance_coverage": 0.0,
        })
        completed = (
            row.status == AttendanceStatus.LEFT and row.check_in_time is not None
            and row.check_out_time is not None and row.check_out_time >= row.check_in_time
        )
        if completed:
            values["completed_sessions"] += 1
            values["recorded_hours"] += (row.check_out_time - row.check_in_time).total_seconds() / 3600.0
            completed_dates.add((row.employee_id, row.branch_id, row.date))
            if row.checkout_source:
                values["checkout_sources"][row.checkout_source.value] += 1
        else:
            values["incomplete_sessions"] += 1
    workdays = {}
    for employee_id, _branch_id, attendance_date in completed_dates:
        workdays.setdefault(employee_id, set()).add(attendance_date)
    for employee_id, values in result.items():
        values["recorded_workdays"] = len(workdays.get(employee_id, set()))
        values["recorded_hours"] = round(values["recorded_hours"], 2)
        values["average_session_hours"] = round(values["recorded_hours"] / values["completed_sessions"], 2) if values["completed_sessions"] else 0.0
    if activity_dates:
        for employee_id, dates in activity_dates.items():
            values = result.setdefault(employee_id, {
                "completed_sessions": 0, "recorded_workdays": 0, "recorded_hours": 0.0,
                "average_session_hours": 0.0, "incomplete_sessions": 0,
                "checkout_sources": {source.value: 0 for source in AttendanceCheckoutSource},
                "attendance_coverage": 0.0,
            })
            covered = sum(1 for branch_id, activity_date in dates if (employee_id, branch_id, activity_date) in completed_dates)
            values["attendance_coverage"] = _share(covered, len(dates))
    return result


def _employee_activity_dates(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    employee_column = _employee_role_column(filters.employee_mode)
    rows = (
        db.session.query(employee_column.label("employee_id"), Invoice.branch_id, Invoice.invoice_date)
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id).join(Service, Service.id == InvoiceItem.service_id)
        .filter(*_employee_service_conditions(allowed_branch_ids, filters)).distinct().all()
    )
    result = {}
    for employee_id, branch_id, activity_date in rows:
        result.setdefault(employee_id, set()).add((branch_id, activity_date))
    return result


def _employee_product_context(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    conditions = [
        Invoice.status == InvoiceStatus.PAID,
        Invoice.invoice_date >= filters.date_from,
        Invoice.invoice_date <= filters.date_to,
        Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        InvoiceItem.item_type == "PRODUCT_ITEM",
        InvoiceItem.assigned_employee_id.isnot(None),
    ]
    if filters.employee_id:
        conditions.append(InvoiceItem.assigned_employee_id == filters.employee_id)
    rows = (
        db.session.query(
            InvoiceItem.assigned_employee_id, Product.id, Product.name,
            func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross"),
            func.sum(InvoiceItem.quantity).label("units"),
            func.sum(case((Invoice.is_fully_discounted.is_(True), 0), else_=func.coalesce(InvoiceItem.sales_commission_amount, 0))).label("commission"),
        )
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id).join(Product, Product.id == InvoiceItem.product_id)
        .filter(*conditions)
        .group_by(InvoiceItem.assigned_employee_id, Product.id, Product.name).all()
    )
    result = {}
    for employee_id, product_id, name, gross, units, commission in rows:
        values = result.setdefault(employee_id, {"gross_product_value": 0.0, "product_units": 0, "product_commission_accrued": 0.0, "top_products": []})
        item = {"product_id": product_id, "product_name": name, "gross_value": _money(gross), "units": int(units or 0), "commission_accrued": _money(commission)}
        values["top_products"].append(item)
        values["gross_product_value"] += item["gross_value"]
        values["product_units"] += item["units"]
        values["product_commission_accrued"] += item["commission_accrued"]
    for values in result.values():
        values["gross_product_value"] = _money(values["gross_product_value"])
        values["product_commission_accrued"] = _money(values["product_commission_accrued"])
        values["top_products"].sort(key=lambda item: (-item["gross_value"], item["product_name"]))
        values["top_products"] = values["top_products"][:5]
    return result


def _employee_appointment_context(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    if filters.employee_mode != "BARBER":
        return {}
    conditions = [
        Appointment.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        Appointment.appointment_date >= filters.date_from,
        Appointment.appointment_date <= filters.date_to,
        Appointment.barber_id.isnot(None),
    ]
    if filters.employee_id:
        conditions.append(Appointment.barber_id == filters.employee_id)
    rows = Appointment.query.filter(*conditions).all()
    result = {}
    today = get_cairo_date()
    for row in rows:
        values = result.setdefault(row.barber_id, {"assigned": 0, "scheduled": 0, "completed": 0, "cancelled": 0, "future": 0, "with_deposit": 0, "service_mix": {}})
        values["assigned"] += 1
        if row.status == AppointmentStatus.SCHEDULED:
            values["scheduled"] += 1
        elif row.status == AppointmentStatus.COMPLETED:
            values["completed"] += 1
        elif row.status == AppointmentStatus.CANCELLED:
            values["cancelled"] += 1
        if row.appointment_date > today:
            values["future"] += 1
        if (row.deposit_amount or 0) > 0:
            values["with_deposit"] += 1
        label = row.service_name or (row.service.name if row.service else "غير محدد")
        values["service_mix"][label] = values["service_mix"].get(label, 0) + 1
    for values in result.values():
        values["service_mix"] = [{"name": name, "count": count} for name, count in sorted(values["service_mix"].items(), key=lambda item: (-item[1], item[0]))[:5]]
    return result


def _employee_financial_actions(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    start_utc, end_utc = cairo_day_window(filters.date_from, filters.date_to)
    conditions = [
        EmployeeFinancialAction.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        EmployeeFinancialAction.created_at >= start_utc,
        EmployeeFinancialAction.created_at <= end_utc,
    ]
    if filters.employee_id:
        conditions.append(EmployeeFinancialAction.employee_id == filters.employee_id)
    rows = (
        db.session.query(EmployeeFinancialAction.employee_id, EmployeeFinancialAction.action_type, func.sum(EmployeeFinancialAction.amount).label("amount"), func.count(EmployeeFinancialAction.id).label("count"))
        .filter(*conditions).group_by(EmployeeFinancialAction.employee_id, EmployeeFinancialAction.action_type).all()
    )
    result = {}
    for employee_id, action_type, amount, count in rows:
        values = result.setdefault(employee_id, {item.value: {"amount": 0.0, "count": 0} for item in EmployeeActionType})
        values[action_type.value] = {"amount": _money(amount), "count": int(count or 0)}
    return result


def _employee_service_trend(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    rows = (
        db.session.query(
            Invoice.invoice_date,
            func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross"),
            func.sum(InvoiceItem.quantity).label("units"),
            func.count(func.distinct(Invoice.id)).label("invoices"),
        )
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id).join(Service, Service.id == InvoiceItem.service_id)
        .filter(*_employee_service_conditions(allowed_branch_ids, filters))
        .group_by(Invoice.invoice_date).order_by(Invoice.invoice_date.asc()).all()
    )
    return [{"date": row.invoice_date.isoformat(), "gross_service_value": _money(row.gross), "service_units": int(row.units or 0), "paid_invoice_count": int(row.invoices or 0)} for row in rows]


def _employee_service_summary(rows: Sequence[dict]):
    gross = _money(sum((Decimal(str(row["gross_service_value"])) for row in rows), Decimal("0")))
    units = sum(row["service_units"] for row in rows)
    invoices = sum(row["paid_invoice_count"] for row in rows)
    customers = sum(row["identified_customer_count"] for row in rows)
    commission = _money(sum((Decimal(str(row["service_commission_accrued"])) for row in rows), Decimal("0")))
    return {
        "employee_count": len(rows), "gross_service_value": gross, "service_units": units,
        "paid_invoice_count": invoices, "identified_customer_count": customers,
        "average_gross_per_unit": _money(Decimal(str(gross)) / units) if units else 0.0,
        "service_commission_accrued": commission,
    }


def _employee_service_scope_summary(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    employee_column = _employee_role_column(filters.employee_mode)
    row = (
        db.session.query(
            func.count(func.distinct(employee_column)).label("employee_count"),
            func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross"),
            func.sum(InvoiceItem.quantity).label("units"),
            func.count(func.distinct(Invoice.id)).label("invoices"),
            func.count(func.distinct(Invoice.customer_id)).label("customers"),
            func.sum(_employee_service_commission_expression(filters.employee_mode)).label("commission"),
        )
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id).join(Service, Service.id == InvoiceItem.service_id)
        .filter(*_employee_service_conditions(allowed_branch_ids, filters)).one()
    )
    units = int(row.units or 0)
    gross = _money(row.gross)
    return {
        "employee_count": int(row.employee_count or 0), "gross_service_value": gross,
        "service_units": units, "paid_invoice_count": int(row.invoices or 0),
        "identified_customer_count": int(row.customers or 0),
        "average_gross_per_unit": _money(Decimal(str(gross)) / units) if units else 0.0,
        "service_commission_accrued": _money(row.commission),
    }


def _employee_service_attention(rows: Sequence[dict]):
    candidates = []
    for row in rows:
        gross_change = row["comparison"]["gross_service_value"]
        unit_change = row["comparison"]["service_units"]
        if (
            gross_change["previous"] >= SERVICE_DECLINE_MIN_PREVIOUS_GROSS
            and row["previous_service_units"] >= SERVICE_DECLINE_MIN_PREVIOUS_UNITS
            and gross_change["percent_change"] is not None
            and gross_change["percent_change"] <= SERVICE_DECLINE_PERCENT_THRESHOLD
        ):
            candidates.append({"code": "EMPLOYEE_ACTIVITY_DECLINE", "entity_id": row["employee_id"], "label": "انخفاض نشاط مسجل", "detail": f"انخفضت قيمة النشاط المسندة إلى {row['employee_name']} بنسبة {abs(gross_change['percent_change']):.1f}% مقارنة بالفترة السابقة.", "tone": "attention"})
        elif row["previous_service_units"] >= SERVICE_DECLINE_MIN_PREVIOUS_UNITS and unit_change["percent_change"] is not None and unit_change["percent_change"] <= -25:
            candidates.append({"code": "EMPLOYEE_UNIT_DECLINE", "entity_id": row["employee_id"], "label": "انخفاض وحدات الخدمة", "detail": f"انخفضت وحدات الخدمة المسجلة لدى {row['employee_name']} بنسبة {abs(unit_change['percent_change']):.1f}%.", "tone": "attention"})
        top_service_share = row.get("top_service_share", 0)
        if row["gross_service_value"] >= 100 and row["service_units"] >= 5 and top_service_share >= 45:
            candidates.append({"code": "EMPLOYEE_SERVICE_CONCENTRATION", "entity_id": row["employee_id"], "label": "تركز في خدمة واحدة", "detail": f"الخدمة الأعلى تمثل {top_service_share:.1f}% من النشاط المسند إلى {row['employee_name']}.", "tone": "neutral"})
        attendance = row["attendance"]
        if (row["service_units"] >= 5 or row["gross_service_value"] >= 100) and attendance["attendance_coverage"] < 80:
            candidates.append({"code": "EMPLOYEE_ATTENDANCE_COVERAGE", "entity_id": row["employee_id"], "label": "تغطية حضور تحتاج مراجعة", "detail": f"تغطية الحضور المكتمل لأيام نشاط {row['employee_name']} هي {attendance['attendance_coverage']:.1f}%.", "tone": "neutral"})
        corrections = attendance["checkout_sources"].get(AttendanceCheckoutSource.ADMIN_CORRECTION.value, 0)
        if attendance["completed_sessions"] >= 5 and corrections >= 2 and _share(corrections, attendance["completed_sessions"]) >= 20:
            candidates.append({"code": "EMPLOYEE_ADMIN_CHECKOUT", "entity_id": row["employee_id"], "label": "تصحيحات حضور متكررة", "detail": f"سُجلت {corrections} عمليات خروج مصححة إداريًا لـ {row['employee_name']}.", "tone": "neutral"})
    priority = {"EMPLOYEE_ACTIVITY_DECLINE": 0, "EMPLOYEE_UNIT_DECLINE": 1, "EMPLOYEE_ATTENDANCE_COVERAGE": 2, "EMPLOYEE_ADMIN_CHECKOUT": 3, "EMPLOYEE_SERVICE_CONCENTRATION": 4}
    candidates.sort(key=lambda item: (priority.get(item["code"], 9), item["entity_id"]))
    return candidates[:5]


def _build_service_employee_report(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, page=1, per_page=12, search="", sort_by="gross_service_value", sort_dir="desc", include_wallet=False):
    current = _employee_service_core_rows(allowed_branch_ids, filters)
    previous_filters = _previous_filters(filters)
    previous = _employee_service_core_rows(allowed_branch_ids, previous_filters)
    breakdowns = _employee_service_breakdowns(allowed_branch_ids, filters)
    customer_context = _employee_customer_context(allowed_branch_ids, filters)
    branches = _employee_transaction_branches(allowed_branch_ids, filters)
    activity_dates = _employee_activity_dates(allowed_branch_ids, filters)
    attendance = _employee_attendance_context(allowed_branch_ids, filters, activity_dates)
    products = _employee_product_context(allowed_branch_ids, filters)
    appointments = _employee_appointment_context(allowed_branch_ids, filters)
    actions = _employee_financial_actions(allowed_branch_ids, filters)
    rows = []
    empty_attendance = {"completed_sessions": 0, "recorded_workdays": 0, "recorded_hours": 0.0, "average_session_hours": 0.0, "incomplete_sessions": 0, "checkout_sources": {source.value: 0 for source in AttendanceCheckoutSource}, "attendance_coverage": 0.0}
    empty_products = {"gross_product_value": 0.0, "product_units": 0, "product_commission_accrued": 0.0, "top_products": []}
    empty_appointments = {"assigned": 0, "scheduled": 0, "completed": 0, "cancelled": 0, "future": 0, "with_deposit": 0, "service_mix": []}
    empty_actions = {item.value: {"amount": 0.0, "count": 0} for item in EmployeeActionType}
    for employee_id, row in current.items():
        prior = previous.get(employee_id, {})
        mix = breakdowns.get(employee_id, {"services": [], "categories": []})
        total_gross = row["gross_service_value"]
        for item in mix["services"]:
            item["share_percent"] = _share(item["gross_value"], total_gross)
        for item in mix["categories"]:
            item["share_percent"] = _share(item["gross_value"], total_gross)
        employee_attendance = attendance.get(employee_id, {**empty_attendance, "checkout_sources": dict(empty_attendance["checkout_sources"])})
        gross_per_hour_eligible = (
            row["service_units"] >= 5 and employee_attendance["completed_sessions"] >= 3
            and employee_attendance["recorded_hours"] >= 8 and employee_attendance["attendance_coverage"] >= 80
        )
        row["ranking_eligible"]["attendance_hours"] = employee_attendance["completed_sessions"] >= 3 and employee_attendance["recorded_hours"] >= 8
        row["ranking_eligible"]["gross_per_recorded_hour"] = gross_per_hour_eligible
        row["ranking_eligible"]["growth"] = prior.get("gross_service_value", 0) >= 100 and prior.get("service_units", 0) >= 3
        row.update({
            "comparison": {
                "gross_service_value": _comparison(row["gross_service_value"], prior.get("gross_service_value", 0)),
                "service_units": _comparison(row["service_units"], prior.get("service_units", 0)),
                "paid_invoice_count": _comparison(row["paid_invoice_count"], prior.get("paid_invoice_count", 0)),
                "identified_customer_count": _comparison(row["identified_customer_count"], prior.get("identified_customer_count", 0)),
                "service_commission_accrued": _comparison(row["service_commission_accrued"], prior.get("service_commission_accrued", 0)),
            },
            "previous_service_units": prior.get("service_units", 0),
            "top_services": mix["services"][:5],
            "categories": mix["categories"],
            "top_service_share": mix["services"][0]["share_percent"] if mix["services"] else 0.0,
            "top_three_service_share": round(sum(item["share_percent"] for item in mix["services"][:3]), 1),
            "customer_context": customer_context.get(employee_id, {"repeat_identified_customers": 0, "previously_recorded_customers": 0}),
            "transaction_branches": branches.get(employee_id, []),
            "attendance": employee_attendance,
            "gross_per_recorded_hour": _money(Decimal(str(row["gross_service_value"])) / Decimal(str(employee_attendance["recorded_hours"]))) if gross_per_hour_eligible else None,
            "products": products.get(employee_id, empty_products),
            "appointments": appointments.get(employee_id, empty_appointments),
            "financial_actions": actions.get(employee_id, empty_actions),
        })
        if not include_wallet:
            row["current_wallet"] = None
            row["current_base_salary"] = None
        rows.append(row)
    all_rows = list(rows)
    if search:
        needle = search.casefold()
        rows = [row for row in rows if needle in row["employee_name"].casefold()]
    sortable = {"gross_service_value", "service_units", "service_commission_accrued", "identified_customer_count", "average_gross_per_unit", "paid_invoice_count", "attendance_hours", "growth"}
    if sort_by not in sortable:
        sort_by = "gross_service_value"
    def sort_value(item):
        if sort_by == "attendance_hours":
            return item["attendance"]["recorded_hours"]
        if sort_by == "growth":
            value = item["comparison"]["gross_service_value"]["percent_change"]
            return value if value is not None else float("-inf")
        return item.get(sort_by, 0)
    rows.sort(key=lambda item: item["employee_name"])
    eligibility_key = {
        "gross_service_value": "gross_service_value",
        "average_gross_per_unit": "average_gross_per_unit",
        "identified_customer_count": "identified_customer_count",
        "attendance_hours": "attendance_hours",
        "growth": "growth",
    }.get(sort_by)
    if eligibility_key:
        eligible = [item for item in rows if item["ranking_eligible"][eligibility_key]]
        ineligible = [item for item in rows if not item["ranking_eligible"][eligibility_key]]
        eligible.sort(key=sort_value, reverse=sort_dir != "asc")
        rows = eligible + ineligible
    else:
        rows.sort(key=sort_value, reverse=sort_dir != "asc")
    summary = _employee_service_scope_summary(allowed_branch_ids, filters)
    previous_summary = _employee_service_scope_summary(allowed_branch_ids, previous_filters)
    comparison = {key: _comparison(summary[key], previous_summary[key]) for key in ("gross_service_value", "service_units", "paid_invoice_count", "identified_customer_count", "service_commission_accrued")}
    insights = []
    gross_insight = _comparison_insight("قيمة نشاط الخدمات المسند", comparison["gross_service_value"])
    if gross_insight:
        insights.append(gross_insight)
    if all_rows:
        label = "الحلاق" if filters.employee_mode == "BARBER" else "المساعد"
        gross_leader = max(all_rows, key=lambda item: (item["gross_service_value"], item["employee_name"]))
        insights.append({"code": "LEADING_EMPLOYEE_SHARE", "text": f"{label} {gross_leader['employee_name']} يمثل {_share(gross_leader['gross_service_value'], summary['gross_service_value']):.1f}% من قيمة النشاط المسند في النطاق."})
    previous_from, previous_to = _previous_period(filters)
    total = len(rows)
    page_items = rows[(page - 1) * per_page: page * per_page]
    return {
        "meta": {"mode": filters.employee_mode, "date_from": filters.date_from.isoformat(), "date_to": filters.date_to.isoformat(), "previous_date_from": previous_from.isoformat(), "previous_date_to": previous_to.isoformat(), "date_basis": "Invoice.invoice_date (Cairo paid business date)", "currency": "EGP", "commission_basis": "current_invoice_engine_line_amount_without_service_quantity", "wallet_visible": include_wallet},
        "summary": summary,
        "comparison": comparison,
        "trend": _employee_service_trend(allowed_branch_ids, filters),
        "insights": insights[:4],
        "attention": _employee_service_attention(all_rows),
        "table": {"items": page_items, "pagination": _pagination_payload(page, per_page, total)},
        "filter_options": _employee_filter_options(allowed_branch_ids, filters),
    }


def _employee_filter_options(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    if filters.employee_mode == "CASHIER":
        employee_id_expr = _sales_cashier_id()
        rows = (
            db.session.query(Employee.id, Employee.full_name)
            .join(Invoice, employee_id_expr == Employee.id)
            .filter(Invoice.status == InvoiceStatus.PAID, Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False)
            .distinct().order_by(Employee.full_name.asc()).all()
        )
    else:
        employee_column = _employee_role_column(filters.employee_mode)
        rows = (
            db.session.query(Employee.id, Employee.full_name)
            .join(InvoiceItem, employee_column == Employee.id).join(Invoice, Invoice.id == InvoiceItem.invoice_id)
            .filter(Invoice.status == InvoiceStatus.PAID, Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False, InvoiceItem.item_type == "SERVICE_ITEM")
            .distinct().order_by(Employee.full_name.asc()).all()
        )
    services = (
        db.session.query(Service.id, Service.name, Service.category_id)
        .join(InvoiceItem, InvoiceItem.service_id == Service.id).join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(Invoice.status == InvoiceStatus.PAID, Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False, InvoiceItem.item_type == "SERVICE_ITEM")
        .distinct().order_by(Service.name.asc()).all()
    )
    categories = (
        db.session.query(ServiceCategory.id, ServiceCategory.name)
        .join(Service, Service.category_id == ServiceCategory.id).join(InvoiceItem, InvoiceItem.service_id == Service.id).join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(Invoice.status == InvoiceStatus.PAID, Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False, InvoiceItem.item_type == "SERVICE_ITEM")
        .distinct().order_by(ServiceCategory.name.asc()).all()
    )
    return {
        "employees": [{"id": row.id, "name": row.full_name} for row in rows],
        "services": [{"id": row.id, "name": row.name, "category_id": row.category_id} for row in services],
        "categories": [{"id": row.id, "name": row.name} for row in categories],
    }


def _cashier_conditions(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, include_dates=True):
    conditions = [Invoice.status == InvoiceStatus.PAID, Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False]
    if include_dates:
        conditions.extend([Invoice.invoice_date >= filters.date_from, Invoice.invoice_date <= filters.date_to])
    if filters.employee_id:
        conditions.append(_sales_cashier_id() == filters.employee_id)
    return conditions


def _cashier_core_rows(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    rows = (
        db.session.query(
            Employee.id, Employee.full_name, Employee.employee_type, Employee.branch_id.label("current_branch_id"),
            Branch.name.label("current_branch_name"),
            Employee.is_active, Employee.is_deleted, Employee.status, Employee.commission_wallet_balance, Employee.base_salary,
            func.count(Invoice.id).label("invoice_count"),
            func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)).label("net_sales"),
        )
        .select_from(Invoice).join(Employee, Employee.id == _sales_cashier_id()).outerjoin(Branch, Branch.id == Employee.branch_id)
        .filter(*_cashier_conditions(allowed_branch_ids, filters))
        .group_by(Employee.id, Employee.full_name, Employee.employee_type, Employee.branch_id, Branch.name, Employee.is_active, Employee.is_deleted, Employee.status, Employee.commission_wallet_balance, Employee.base_salary)
        .all()
    )
    result = {}
    for row in rows:
        count = int(row.invoice_count or 0)
        net = _money(row.net_sales)
        result[row.id] = {
            "employee_id": row.id, "employee_name": row.full_name,
            "current_role": row.employee_type.value if row.employee_type else None,
            "current_branch_id": row.current_branch_id,
            "current_branch_name": row.current_branch_name,
            "current_status": row.status.value if row.status else ("ACTIVE" if row.is_active else "SUSPENDED"),
            "is_active": bool(row.is_active), "is_deleted": bool(row.is_deleted),
            "paid_invoices_finalized": count, "net_sales_finalized": net,
            "average_ticket_finalized": _money(Decimal(str(net)) / count) if count else 0.0,
            "current_wallet": _money(row.commission_wallet_balance), "current_base_salary": _money(row.base_salary),
        }
    return result


def _cashier_transaction_branches(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    rows = (
        db.session.query(
            _sales_cashier_id().label("employee_id"), Branch.id, Branch.name,
            func.count(Invoice.id).label("invoice_count"),
            func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)).label("net_sales"),
        )
        .select_from(Invoice).join(Branch, Branch.id == Invoice.branch_id)
        .filter(*_cashier_conditions(allowed_branch_ids, filters))
        .group_by(_sales_cashier_id(), Branch.id, Branch.name)
        .all()
    )
    result = {}
    for employee_id, branch_id, branch_name, invoice_count, net_sales in rows:
        result.setdefault(employee_id, []).append({
            "branch_id": branch_id,
            "branch_name": branch_name,
            "paid_invoice_count": int(invoice_count or 0),
            "net_sales_finalized": _money(net_sales),
        })
    return result


def _cashier_payment_context(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    invoice_ids = db.session.query(Invoice.id).filter(*_cashier_conditions(allowed_branch_ids, filters))
    modern = (
        db.session.query(_sales_cashier_id().label("employee_id"), InvoicePayment.method, func.sum(InvoicePayment.amount).label("amount"))
        .select_from(Invoice).join(InvoicePayment, InvoicePayment.invoice_id == Invoice.id)
        .filter(*_cashier_conditions(allowed_branch_ids, filters))
        .group_by(_sales_cashier_id(), InvoicePayment.method).all()
    )
    has_payment = or_(exists().where(InvoicePayment.invoice_id == Invoice.id), has_application(Invoice.id))
    legacy = (
        db.session.query(_sales_cashier_id().label("employee_id"), Invoice.payment_method, func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)).label("amount"))
        .filter(*_cashier_conditions(allowed_branch_ids, filters), ~has_payment)
        .group_by(_sales_cashier_id(), Invoice.payment_method).all()
    )
    split_rows = (
        db.session.query(_sales_cashier_id().label("employee_id"), InvoicePayment.invoice_id)
        .select_from(Invoice).join(InvoicePayment, InvoicePayment.invoice_id == Invoice.id)
        .filter(Invoice.id.in_(invoice_ids), InvoicePayment.amount > 0)
        .group_by(_sales_cashier_id(), InvoicePayment.invoice_id)
        .having(func.count(func.distinct(InvoicePayment.method)) > 1).all()
    )
    result = {}
    for employee_id, method, amount in [*modern, *legacy]:
        values = result.setdefault(employee_id, {"methods": {item.value: 0.0 for item in PaymentMethod}, "split_payment_invoice_count": 0})
        if method:
            values["methods"][method.value] = _money(Decimal(str(values["methods"][method.value])) + Decimal(str(amount or 0)))
    for employee_id, _invoice_id in split_rows:
        result.setdefault(employee_id, {"methods": {item.value: 0.0 for item in PaymentMethod}, "split_payment_invoice_count": 0})["split_payment_invoice_count"] += 1
    return result


def _cashier_operational_context(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    start_utc, end_utc = cairo_day_window(filters.date_from, filters.date_to)
    promo_rows = (
        db.session.query(PromoRedemption.confirmed_by_employee_id, func.count(PromoRedemption.id))
        .filter(PromoRedemption.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False, PromoRedemption.redeemed_at >= start_utc, PromoRedemption.redeemed_at <= end_utc)
        .group_by(PromoRedemption.confirmed_by_employee_id).all()
    )
    deposit_rows = (
        db.session.query(AppointmentDepositTransaction.cashier_id, func.sum(AppointmentDepositTransaction.amount), func.count(AppointmentDepositTransaction.id))
        .filter(
            AppointmentDepositTransaction.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            AppointmentDepositTransaction.transaction_type == AppointmentDepositTransactionType.DEPOSIT_COLLECTION,
            AppointmentDepositTransaction.created_at >= start_utc, AppointmentDepositTransaction.created_at <= end_utc,
        ).group_by(AppointmentDepositTransaction.cashier_id).all()
    )
    day_rows = BusinessDay.query.filter(BusinessDay.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False, BusinessDay.opened_at >= start_utc, BusinessDay.opened_at <= end_utc).all()
    audit_rows = (
        db.session.query(InvoiceAuditEvent.actor_employee_id, InvoiceAuditEvent.event_type, func.count(InvoiceAuditEvent.id))
        .filter(InvoiceAuditEvent.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False, InvoiceAuditEvent.occurred_at >= start_utc, InvoiceAuditEvent.occurred_at <= end_utc, InvoiceAuditEvent.actor_employee_id.isnot(None))
        .group_by(InvoiceAuditEvent.actor_employee_id, InvoiceAuditEvent.event_type).all()
    )
    result = {}
    def base(employee_id):
        return result.setdefault(employee_id, {"promo_redemptions_confirmed": 0, "deposit_collections": 0.0, "deposit_collection_count": 0, "business_days_opened": 0, "business_days_closed": 0, "closed_day_variance": 0.0, "closed_day_absolute_variance": 0.0, "audit_event_count": 0, "audit_events": {}})
    for employee_id, count in promo_rows:
        base(employee_id)["promo_redemptions_confirmed"] = int(count or 0)
    for employee_id, amount, count in deposit_rows:
        base(employee_id).update({"deposit_collections": _money(amount), "deposit_collection_count": int(count or 0)})
    for day in day_rows:
        base(day.opened_by)["business_days_opened"] += 1
        if day.closed_by:
            values = base(day.closed_by)
            values["business_days_closed"] += 1
            values["closed_day_variance"] = _money(Decimal(str(values["closed_day_variance"])) + Decimal(str(day.variance or 0)))
            values["closed_day_absolute_variance"] = _money(Decimal(str(values["closed_day_absolute_variance"])) + abs(Decimal(str(day.variance or 0))))
    for employee_id, event_type, count in audit_rows:
        values = base(employee_id)
        values["audit_events"][event_type] = int(count or 0)
        values["audit_event_count"] += int(count or 0)
    return result


def _cashier_trend(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    rows = (
        db.session.query(Invoice.invoice_date, func.count(Invoice.id), func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)))
        .filter(*_cashier_conditions(allowed_branch_ids, filters)).group_by(Invoice.invoice_date).order_by(Invoice.invoice_date.asc()).all()
    )
    return [{"date": day.isoformat(), "paid_invoices_finalized": int(count or 0), "net_sales_finalized": _money(net)} for day, count, net in rows]


def _cashier_summary(rows: Sequence[dict]):
    invoices = sum(row["paid_invoices_finalized"] for row in rows)
    net = _money(sum((Decimal(str(row["net_sales_finalized"])) for row in rows), Decimal("0")))
    return {"employee_count": len(rows), "paid_invoices_finalized": invoices, "net_sales_finalized": net, "average_ticket_finalized": _money(Decimal(str(net)) / invoices) if invoices else 0.0}


def _build_cashier_report(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, page=1, per_page=12, search="", sort_by="net_sales_finalized", sort_dir="desc", include_wallet=False):
    current = _cashier_core_rows(allowed_branch_ids, filters)
    previous = _cashier_core_rows(allowed_branch_ids, _previous_filters(filters))
    payments = _cashier_payment_context(allowed_branch_ids, filters)
    transaction_branches = _cashier_transaction_branches(allowed_branch_ids, filters)
    operations = _cashier_operational_context(allowed_branch_ids, filters)
    attendance = _employee_attendance_context(allowed_branch_ids, filters)
    actions = _employee_financial_actions(allowed_branch_ids, filters)
    rows = []
    empty_payments = {"methods": {item.value: 0.0 for item in PaymentMethod}, "split_payment_invoice_count": 0}
    empty_operations = {"promo_redemptions_confirmed": 0, "deposit_collections": 0.0, "deposit_collection_count": 0, "business_days_opened": 0, "business_days_closed": 0, "closed_day_variance": 0.0, "closed_day_absolute_variance": 0.0, "audit_event_count": 0, "audit_events": {}}
    empty_attendance = {"completed_sessions": 0, "recorded_workdays": 0, "recorded_hours": 0.0, "average_session_hours": 0.0, "incomplete_sessions": 0, "checkout_sources": {source.value: 0 for source in AttendanceCheckoutSource}, "attendance_coverage": 0.0}
    empty_actions = {item.value: {"amount": 0.0, "count": 0} for item in EmployeeActionType}
    for employee_id, row in current.items():
        prior = previous.get(employee_id, {})
        payment = payments.get(employee_id, {"methods": dict(empty_payments["methods"]), "split_payment_invoice_count": 0})
        payment["split_payment_rate"] = _share(payment["split_payment_invoice_count"], row["paid_invoices_finalized"])
        payment_total = sum(payment["methods"].values())
        payment["shares"] = {method: _share(amount, payment_total) for method, amount in payment["methods"].items()}
        row.update({
            "comparison": {
                "paid_invoices_finalized": _comparison(row["paid_invoices_finalized"], prior.get("paid_invoices_finalized", 0)),
                "net_sales_finalized": _comparison(row["net_sales_finalized"], prior.get("net_sales_finalized", 0)),
                "average_ticket_finalized": _comparison(row["average_ticket_finalized"], prior.get("average_ticket_finalized", 0)),
            },
            "payments": payment,
            "transaction_branches": transaction_branches.get(employee_id, []),
            "operations": operations.get(employee_id, empty_operations),
            "attendance": attendance.get(employee_id, empty_attendance),
            "financial_actions": actions.get(employee_id, empty_actions),
        })
        if not include_wallet:
            row["current_wallet"] = None
            row["current_base_salary"] = None
        rows.append(row)
    all_rows = list(rows)
    if search:
        needle = search.casefold()
        rows = [row for row in rows if needle in row["employee_name"].casefold()]
    sortable = {"paid_invoices_finalized", "net_sales_finalized", "average_ticket_finalized", "business_days_closed", "deposit_collections"}
    if sort_by not in sortable:
        sort_by = "net_sales_finalized"
    def sort_value(item):
        if sort_by in {"business_days_closed", "deposit_collections"}:
            return item["operations"][sort_by]
        return item[sort_by]
    rows.sort(key=lambda item: item["employee_name"])
    rows.sort(key=sort_value, reverse=sort_dir != "asc")
    summary = _cashier_summary(list(current.values()))
    previous_summary = _cashier_summary(list(previous.values()))
    comparison = {key: _comparison(summary[key], previous_summary[key]) for key in ("paid_invoices_finalized", "net_sales_finalized", "average_ticket_finalized")}
    sales_filters = ReportFilters(**{**filters.__dict__, "cashier_id": filters.employee_id})
    aggregate_payments = _sales_payment_context(allowed_branch_ids, sales_filters, summary["net_sales_finalized"])
    summary.update({
        "split_payment_invoice_count": aggregate_payments["split_payment_invoice_count"],
        "promo_redemptions_confirmed": sum(row["operations"]["promo_redemptions_confirmed"] for row in all_rows),
        "deposit_collections": _money(sum(Decimal(str(row["operations"]["deposit_collections"])) for row in all_rows)),
        "business_days_opened": sum(row["operations"]["business_days_opened"] for row in all_rows),
        "business_days_closed": sum(row["operations"]["business_days_closed"] for row in all_rows),
        "invoice_audit_event_count": sum(row["operations"]["audit_event_count"] for row in all_rows),
        "closed_day_absolute_variance": _money(sum(Decimal(str(row["operations"]["closed_day_absolute_variance"])) for row in all_rows)),
    })
    insights = []
    net_insight = _comparison_insight("صافي المبيعات التي تم تحصيلها", comparison["net_sales_finalized"])
    if net_insight:
        insights.append(net_insight)
    if rows:
        insights.append({"code": "CASHIER_ACTIVITY_CONTEXT", "text": f"{rows[0]['employee_name']} أنهى {rows[0]['paid_invoices_finalized']} فاتورة مدفوعة خلال الفترة؛ هذا وصف لحجم المعالجة وليس للمبيعات التي أنشأها."})
    attention = []
    for row in rows:
        change = row["comparison"]["paid_invoices_finalized"]
        if change["previous"] >= 5 and change["percent_change"] is not None and change["percent_change"] <= -25:
            attention.append({"code": "CASHIER_FINALIZATION_DECLINE", "entity_id": row["employee_id"], "label": "انخفاض الفواتير المحصلة", "detail": f"انخفض عدد الفواتير التي أنهاها {row['employee_name']} بنسبة {abs(change['percent_change']):.1f}%.", "tone": "neutral"})
    previous_from, previous_to = _previous_period(filters)
    total = len(rows)
    return {
        "meta": {"mode": "CASHIER", "date_from": filters.date_from.isoformat(), "date_to": filters.date_to.isoformat(), "previous_date_from": previous_from.isoformat(), "previous_date_to": previous_to.isoformat(), "date_basis": "Invoice.invoice_date for invoice activity; Cairo timestamps for operations", "cashier_basis": "Invoice.confirmed_by with Invoice.cashier_id legacy fallback", "currency": "EGP", "wallet_visible": include_wallet},
        "summary": summary, "comparison": comparison, "payments": aggregate_payments,
        "trend": _cashier_trend(allowed_branch_ids, filters), "insights": insights[:4], "attention": attention[:5],
        "table": {"items": rows[(page - 1) * per_page: page * per_page], "pagination": _pagination_payload(page, per_page, total)},
        "filter_options": _employee_filter_options(allowed_branch_ids, filters),
    }


def build_employee_report(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, page=1, per_page=12, search="", sort_by="", sort_dir="desc", include_wallet=False):
    if sort_dir not in REPORT_SORT_DIRECTIONS:
        raise ValueError("sort_dir must be asc or desc.")
    if filters.employee_mode == "CASHIER":
        return _build_cashier_report(allowed_branch_ids, filters, page=page, per_page=per_page, search=search, sort_by=sort_by or "net_sales_finalized", sort_dir=sort_dir, include_wallet=include_wallet)
    return _build_service_employee_report(allowed_branch_ids, filters, page=page, per_page=per_page, search=search, sort_by=sort_by or "gross_service_value", sort_dir=sort_dir, include_wallet=include_wallet)


def build_employee_drilldown(allowed_branch_ids: Sequence[int], filters: ReportFilters, employee_id: int, *, include_wallet=False):
    scoped_filters = ReportFilters(**{**filters.__dict__, "employee_id": employee_id})
    report = build_employee_report(allowed_branch_ids, scoped_filters, page=1, per_page=1, include_wallet=include_wallet)
    items = report["table"]["items"]
    if not items:
        return None
    return {"meta": report["meta"], "employee": items[0], "trend": report["trend"], "insights": report["insights"], "attention": report["attention"]}


def employee_export_report(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, include_wallet=False):
    return build_employee_report(allowed_branch_ids, filters, page=1, per_page=100000, include_wallet=include_wallet)


# ---------------------------------------------------------------------------
# Customers intelligence
# ---------------------------------------------------------------------------

def _customer_invoice_conditions(
    allowed_branch_ids: Sequence[int],
    filters: ReportFilters,
    *,
    include_dates: bool = True,
    identified_only: bool = False,
):
    conditions = [
        Invoice.status == InvoiceStatus.PAID,
        Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        Invoice.invoice_date.isnot(None),
    ]
    if include_dates:
        conditions.extend([Invoice.invoice_date >= filters.date_from, Invoice.invoice_date <= filters.date_to])
    if identified_only:
        conditions.append(Invoice.customer_id.isnot(None))
    if filters.service_id or filters.category_id or filters.barber_id:
        item_conditions = [
            InvoiceItem.invoice_id == Invoice.id,
            InvoiceItem.item_type == "SERVICE_ITEM",
            InvoiceItem.service_id.isnot(None),
        ]
        if filters.service_id:
            item_conditions.append(InvoiceItem.service_id == filters.service_id)
        if filters.barber_id:
            item_conditions.append(InvoiceItem.barber_id == filters.barber_id)
        if filters.category_id:
            item_conditions.extend([Service.id == InvoiceItem.service_id, Service.category_id == filters.category_id])
        conditions.append(exists().where(*item_conditions))
    if filters.product_id or filters.product_category:
        item_conditions = [
            InvoiceItem.invoice_id == Invoice.id,
            InvoiceItem.item_type == "PRODUCT_ITEM",
            InvoiceItem.product_id.isnot(None),
        ]
        if filters.product_id:
            item_conditions.append(InvoiceItem.product_id == filters.product_id)
        if filters.product_category:
            item_conditions.extend([Product.id == InvoiceItem.product_id, Product.category == filters.product_category])
        conditions.append(exists().where(*item_conditions))
    if filters.promo_code:
        conditions.append(exists().where(
            PromoRedemption.invoice_id == Invoice.id,
            func.upper(PromoRedemption.code_snapshot) == filters.promo_code,
        ))
    return conditions


def _customer_history_map(allowed_branch_ids: Sequence[int], filters: ReportFilters, customer_id: Optional[int] = None):
    query = (
        db.session.query(
            Invoice.customer_id,
            func.min(Invoice.invoice_date).label("first_paid_date"),
            func.max(Invoice.invoice_date).label("last_paid_date"),
            func.count(func.distinct(Invoice.id)).label("paid_invoice_count"),
            func.count(func.distinct(Invoice.invoice_date)).label("paid_date_count"),
            func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)).label("net_spend"),
        )
        .filter(
            Invoice.status == InvoiceStatus.PAID,
            Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            Invoice.customer_id.isnot(None),
            Invoice.invoice_date.isnot(None),
            Invoice.invoice_date <= filters.date_to,
        )
    )
    if customer_id:
        query = query.filter(Invoice.customer_id == customer_id)
    rows = query.group_by(Invoice.customer_id).all()
    return {
        row.customer_id: {
            "first_paid_date": row.first_paid_date,
            "last_paid_date": row.last_paid_date,
            "paid_invoice_count": int(row.paid_invoice_count or 0),
            "paid_date_count": int(row.paid_date_count or 0),
            "net_spend": _money(row.net_spend),
        }
        for row in rows
    }


def _customer_interval_map(
    allowed_branch_ids: Sequence[int],
    filters: ReportFilters,
    *,
    lifetime: bool = False,
    customer_id: Optional[int] = None,
):
    day_conditions = [
        Invoice.status == InvoiceStatus.PAID,
        Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        Invoice.customer_id.isnot(None),
        Invoice.invoice_date.isnot(None),
        Invoice.invoice_date <= filters.date_to,
    ]
    if not lifetime:
        day_conditions.append(Invoice.invoice_date >= filters.date_from)
    if customer_id:
        day_conditions.append(Invoice.customer_id == customer_id)
    paid_days = (
        db.session.query(Invoice.customer_id.label("customer_id"), Invoice.invoice_date.label("paid_date"))
        .filter(*day_conditions).distinct().subquery()
    )
    previous_date = func.lag(paid_days.c.paid_date).over(
        partition_by=paid_days.c.customer_id,
        order_by=paid_days.c.paid_date,
    )
    lagged = db.session.query(
        paid_days.c.customer_id,
        paid_days.c.paid_date,
        previous_date.label("previous_date"),
    ).subquery()
    if db.engine.dialect.name == "sqlite":
        gap_expression = func.julianday(lagged.c.paid_date) - func.julianday(lagged.c.previous_date)
    else:
        gap_expression = lagged.c.paid_date - lagged.c.previous_date
    rows = (
        db.session.query(
            lagged.c.customer_id,
            func.avg(gap_expression).label("average_gap"),
            func.count(lagged.c.previous_date).label("gap_count"),
        )
        .filter(lagged.c.previous_date.isnot(None))
        .group_by(lagged.c.customer_id).all()
    )
    return {
        row.customer_id: {
            "average_days": round(float(row.average_gap), 1) if row.average_gap is not None else None,
            "gap_count": int(row.gap_count or 0),
        }
        for row in rows
    }


def _customer_period_rows(allowed_branch_ids: Sequence[int], filters: ReportFilters, customer_id: Optional[int] = None):
    query = (
        db.session.query(
            Invoice.customer_id,
            Customer.full_name,
            Customer.phone,
            Customer.branch_id.label("record_branch_id"),
            Branch.name.label("record_branch_name"),
            Customer.is_active,
            func.sum(Invoice.total_amount).label("gross_spend"),
            func.sum(Invoice.discount_amount).label("discount_amount"),
            func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)).label("net_spend"),
            func.count(func.distinct(Invoice.id)).label("paid_invoice_count"),
            func.count(func.distinct(Invoice.invoice_date)).label("paid_date_count"),
            func.min(Invoice.invoice_date).label("period_first_paid_date"),
            func.max(Invoice.invoice_date).label("period_last_paid_date"),
        )
        .select_from(Invoice)
        .join(Customer, Customer.id == Invoice.customer_id)
        .join(Branch, Branch.id == Customer.branch_id)
        .filter(*_customer_invoice_conditions(allowed_branch_ids, filters, identified_only=True))
    )
    if customer_id:
        query = query.filter(Invoice.customer_id == customer_id)
    rows = query.group_by(
        Invoice.customer_id, Customer.full_name, Customer.phone, Customer.branch_id,
        Branch.name, Customer.is_active,
    ).all()
    return [{
        "customer_id": row.customer_id,
        "customer_name": row.full_name or "عميل غير مسمى",
        "phone": row.phone,
        "record_branch_id": row.record_branch_id,
        "record_branch_name": row.record_branch_name,
        "operational_status": "ACTIVE" if row.is_active else "INACTIVE",
        "gross_spend": _money(row.gross_spend),
        "discount_amount": _money(row.discount_amount),
        "net_spend": _money(row.net_spend),
        "paid_invoice_count": int(row.paid_invoice_count or 0),
        "paid_date_count": int(row.paid_date_count or 0),
        "period_first_paid_date": row.period_first_paid_date.isoformat() if row.period_first_paid_date else None,
        "period_last_paid_date": row.period_last_paid_date.isoformat() if row.period_last_paid_date else None,
    } for row in rows]


def _customer_coverage(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    gross = func.coalesce(func.sum(Invoice.total_amount), 0)
    discount = func.coalesce(func.sum(Invoice.discount_amount), 0)
    identified_net = func.coalesce(func.sum(case((
        Invoice.customer_id.isnot(None),
        Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0),
    ), else_=0)), 0)
    row = db.session.query(
        func.count(Invoice.id).label("paid_invoice_count"),
        func.sum(case((Invoice.customer_id.isnot(None), 1), else_=0)).label("identified_invoice_count"),
        gross.label("gross"), discount.label("discount"), identified_net.label("identified_net"),
    ).filter(*_customer_invoice_conditions(allowed_branch_ids, filters)).one()
    paid_count = int(row.paid_invoice_count or 0)
    identified_count = int(row.identified_invoice_count or 0)
    total_net = _money(Decimal(str(row.gross or 0)) - Decimal(str(row.discount or 0)))
    identified_net_value = _money(row.identified_net)
    return {
        "paid_invoice_count": paid_count,
        "identified_invoice_count": identified_count,
        "anonymous_invoice_count": max(paid_count - identified_count, 0),
        "identified_invoice_share": _share(identified_count, paid_count),
        "anonymous_invoice_share": _share(max(paid_count - identified_count, 0), paid_count),
        "total_net_sales": total_net,
        "identified_net_spend": identified_net_value,
        "identified_net_sales_share": _share(identified_net_value, total_net),
    }


def _customer_recency_bucket(days: int) -> str:
    if days <= 30:
        return "0_30"
    if days <= 60:
        return "31_60"
    if days <= 90:
        return "61_90"
    return "91_PLUS"


def _customer_enrich_core_rows(rows: list[dict], history: dict, intervals: dict, filters: ReportFilters):
    for row in rows:
        historical = history.get(row["customer_id"], {})
        first_paid = historical.get("first_paid_date")
        last_paid = historical.get("last_paid_date")
        cohort = "FIRST_KNOWN" if first_paid and first_paid >= filters.date_from else "PREVIOUSLY_KNOWN"
        recency = (filters.date_to - last_paid).days if last_paid else None
        interval = intervals.get(row["customer_id"], {})
        row.update({
            "average_ticket": _money(Decimal(str(row["net_spend"])) / row["paid_invoice_count"]) if row["paid_invoice_count"] else None,
            "low_base": row["paid_invoice_count"] < 2,
            "cohort": cohort,
            "transaction_repeat": row["paid_invoice_count"] >= 2,
            "behavioral_repeat": row["paid_date_count"] >= 2,
            "first_paid_date": first_paid.isoformat() if first_paid else None,
            "last_paid_date": last_paid.isoformat() if last_paid else None,
            "recency_days": recency,
            "recency_bucket": _customer_recency_bucket(recency) if recency is not None else None,
            "average_paid_day_interval": interval.get("average_days"),
            "_interval_gap_count": interval.get("gap_count", 0),
            "recorded_lifetime_net_spend": historical.get("net_spend", 0.0),
            "lifetime_paid_invoice_count": historical.get("paid_invoice_count", 0),
            "lifetime_paid_date_count": historical.get("paid_date_count", 0),
            "dormant": recency is not None and recency > filters.dormancy_days,
        })
    return rows


def _customer_filter_rows(rows: list[dict], filters: ReportFilters, search: str):
    if search:
        needle = search.casefold()
        rows = [row for row in rows if needle in row["customer_name"].casefold() or needle in (row["phone"] or "").casefold()]
    if filters.customer_cohort:
        rows = [row for row in rows if row["cohort"] == filters.customer_cohort]
    if filters.customer_recency_bucket:
        rows = [row for row in rows if row["recency_bucket"] == filters.customer_recency_bucket]
    if filters.customer_repeat == "BEHAVIORAL":
        rows = [row for row in rows if row["behavioral_repeat"]]
    elif filters.customer_repeat == "TRANSACTION":
        rows = [row for row in rows if row["transaction_repeat"]]
    elif filters.customer_repeat == "NON_REPEAT":
        rows = [row for row in rows if not row["behavioral_repeat"]]
    return rows


def _customer_item_context(allowed_branch_ids: Sequence[int], filters: ReportFilters, customer_ids: Sequence[int]):
    if not customer_ids:
        return {}, {}, {}, {"services": [], "products": [], "barbers": [], "product_active_customers": 0, "service_only_customers": 0, "categories_by_customer": {}}
    conditions = _customer_invoice_conditions(allowed_branch_ids, filters, identified_only=True)
    service_rows = (
        db.session.query(
            Invoice.customer_id, Service.id, Service.name, ServiceCategory.id.label("category_id"),
            ServiceCategory.name.label("category_name"),
            func.sum(InvoiceItem.quantity).label("units"),
            func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross_value"),
            func.count(func.distinct(Invoice.id)).label("invoice_count"),
        )
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .join(Service, Service.id == InvoiceItem.service_id)
        .join(ServiceCategory, ServiceCategory.id == Service.category_id)
        .filter(*conditions, Invoice.customer_id.in_(customer_ids), InvoiceItem.item_type == "SERVICE_ITEM")
        .group_by(Invoice.customer_id, Service.id, Service.name, ServiceCategory.id, ServiceCategory.name).all()
    )
    product_rows = (
        db.session.query(
            Invoice.customer_id, Product.id, Product.name,
            func.sum(InvoiceItem.quantity).label("units"),
            func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross_value"),
            func.count(func.distinct(Invoice.id)).label("invoice_count"),
        )
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .join(Product, Product.id == InvoiceItem.product_id)
        .filter(*conditions, Invoice.customer_id.in_(customer_ids), InvoiceItem.item_type == "PRODUCT_ITEM")
        .group_by(Invoice.customer_id, Product.id, Product.name).all()
    )
    total_service_rows = dict(
        db.session.query(Invoice.customer_id, func.sum(InvoiceItem.quantity))
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(*conditions, Invoice.customer_id.in_(customer_ids), InvoiceItem.item_type == "SERVICE_ITEM")
        .group_by(Invoice.customer_id).all()
    )
    barber_rows = (
        db.session.query(
            Invoice.customer_id, Employee.id, Employee.full_name,
            func.sum(InvoiceItem.quantity).label("units"),
            func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label("gross_value"),
            func.count(func.distinct(Invoice.id)).label("invoice_count"),
        )
        .select_from(InvoiceItem).join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .join(Employee, Employee.id == InvoiceItem.barber_id)
        .filter(*conditions, Invoice.customer_id.in_(customer_ids), InvoiceItem.item_type == "SERVICE_ITEM", InvoiceItem.barber_id.isnot(None))
        .group_by(Invoice.customer_id, Employee.id, Employee.full_name).all()
    )
    services = {}
    categories = {}
    service_totals = {}
    for row in service_rows:
        item = {"service_id": row.id, "service_name": row.name, "category_id": row.category_id, "category_name": row.category_name, "units": int(row.units or 0), "gross_value": _money(row.gross_value), "invoice_count": int(row.invoice_count or 0)}
        services.setdefault(row.customer_id, []).append(item)
        category = categories.setdefault(row.customer_id, {}).setdefault(row.category_id, {"category_id": row.category_id, "category_name": row.category_name, "units": 0, "gross_value": 0.0})
        category["units"] += item["units"]
        category["gross_value"] = _money(Decimal(str(category["gross_value"])) + Decimal(str(item["gross_value"])))
        total = service_totals.setdefault(row.id, {"service_id": row.id, "service_name": row.name, "units": 0, "gross_value": 0.0, "invoice_count": 0})
        total["units"] += item["units"]
        total["gross_value"] = _money(Decimal(str(total["gross_value"])) + Decimal(str(item["gross_value"])))
        total["invoice_count"] += item["invoice_count"]
    products = {}
    product_totals = {}
    for row in product_rows:
        item = {"product_id": row.id, "product_name": row.name, "units": int(row.units or 0), "gross_value": _money(row.gross_value), "invoice_count": int(row.invoice_count or 0)}
        products.setdefault(row.customer_id, []).append(item)
        total = product_totals.setdefault(row.id, {"product_id": row.id, "product_name": row.name, "units": 0, "gross_value": 0.0, "invoice_count": 0})
        total["units"] += item["units"]
        total["gross_value"] = _money(Decimal(str(total["gross_value"])) + Decimal(str(item["gross_value"])))
        total["invoice_count"] += item["invoice_count"]
    barbers = {}
    barber_totals = {}
    for row in barber_rows:
        denominator = int(total_service_rows.get(row.customer_id) or 0)
        units = int(row.units or 0)
        invoices = int(row.invoice_count or 0)
        item = {"barber_id": row.id, "barber_name": row.full_name, "service_units": units, "gross_service_value": _money(row.gross_value), "service_invoice_count": invoices, "affinity_share": _share(units, denominator), "eligible": denominator >= 3 or invoices >= 2}
        barbers.setdefault(row.customer_id, []).append(item)
        total = barber_totals.setdefault(row.id, {"barber_id": row.id, "barber_name": row.full_name, "service_units": 0, "gross_service_value": 0.0, "customer_count": 0})
        total["service_units"] += units
        total["gross_service_value"] = _money(Decimal(str(total["gross_service_value"])) + Decimal(str(item["gross_service_value"])))
        total["customer_count"] += 1
    for values in services.values():
        values.sort(key=lambda item: (-item["units"], -item["gross_value"], item["service_name"]))
    for customer_id, values in categories.items():
        categories[customer_id] = sorted(values.values(), key=lambda item: (-item["units"], -item["gross_value"], item["category_name"]))
    for values in products.values():
        values.sort(key=lambda item: (-item["units"], -item["gross_value"], item["product_name"]))
    for values in barbers.values():
        values.sort(key=lambda item: (-item["service_units"], -item["gross_service_value"], item["barber_name"]))
    global_context = {
        "services": sorted(service_totals.values(), key=lambda item: (-item["units"], -item["gross_value"]))[:10],
        "products": sorted(product_totals.values(), key=lambda item: (-item["units"], -item["gross_value"]))[:10],
        "barbers": sorted(barber_totals.values(), key=lambda item: (-item["service_units"], -item["gross_service_value"]))[:10],
        "product_active_customers": len(products),
        "service_only_customers": len(set(services) - set(products)),
    }
    return services, products, barbers, {**global_context, "categories_by_customer": categories}


def _customer_supporting_context(allowed_branch_ids: Sequence[int], filters: ReportFilters, customer_ids: Sequence[int]):
    if not customer_ids:
        return {}, {}, {}, {}
    appointment_rows = (
        db.session.query(
            Appointment.customer_id, Appointment.status, func.count(Appointment.id),
            func.sum(case((Appointment.deposit_amount > 0, 1), else_=0)),
        )
        .filter(
            Appointment.branch_id.in_(allowed_branch_ids), Appointment.customer_id.in_(customer_ids),
            Appointment.appointment_date >= filters.date_from, Appointment.appointment_date <= filters.date_to,
        )
        .group_by(Appointment.customer_id, Appointment.status).all()
    )
    appointments = {}
    for customer_id, status, count, with_deposit in appointment_rows:
        values = appointments.setdefault(customer_id, {"scheduled": 0, "completed": 0, "cancelled": 0, "future_scheduled": 0, "with_deposit": 0})
        values[status.value] = int(count or 0)
        values["with_deposit"] += int(with_deposit or 0)
    future_rows = (
        db.session.query(Appointment.customer_id, func.count(Appointment.id))
        .filter(
            Appointment.branch_id.in_(allowed_branch_ids), Appointment.customer_id.in_(customer_ids),
            Appointment.status == AppointmentStatus.SCHEDULED, Appointment.appointment_date > filters.date_to,
        ).group_by(Appointment.customer_id).all()
    )
    for customer_id, count in future_rows:
        appointments.setdefault(customer_id, {"scheduled": 0, "completed": 0, "cancelled": 0, "future_scheduled": 0, "with_deposit": 0})["future_scheduled"] = int(count or 0)
    promo_rows = (
        db.session.query(
            Invoice.customer_id, func.count(PromoRedemption.id), func.sum(PromoRedemption.promo_discount_amount),
            func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)),
        )
        .select_from(PromoRedemption).join(Invoice, Invoice.id == PromoRedemption.invoice_id)
        .filter(*_customer_invoice_conditions(allowed_branch_ids, filters, identified_only=True), Invoice.customer_id.in_(customer_ids))
        .group_by(Invoice.customer_id).all()
    )
    promos = {customer_id: {"redemption_count": int(count or 0), "paid_promo_invoice_count": int(count or 0), "promo_discount_amount": _money(discount), "net_sales_on_promo_invoices": _money(net)} for customer_id, count, discount, net in promo_rows}
    start_utc, end_utc = cairo_day_window(filters.date_from, filters.date_to)
    deposit_rows = (
        db.session.query(
            AppointmentDepositTransaction.customer_id,
            func.count(AppointmentDepositTransaction.id), func.sum(AppointmentDepositTransaction.amount),
        )
        .filter(
            AppointmentDepositTransaction.branch_id.in_(allowed_branch_ids),
            AppointmentDepositTransaction.customer_id.in_(customer_ids),
            AppointmentDepositTransaction.transaction_type == AppointmentDepositTransactionType.DEPOSIT_COLLECTION,
            AppointmentDepositTransaction.created_at >= start_utc, AppointmentDepositTransaction.created_at <= end_utc,
        ).group_by(AppointmentDepositTransaction.customer_id).all()
    )
    deposits = {customer_id: {"collection_count": int(count or 0), "collection_amount": _money(amount)} for customer_id, count, amount in deposit_rows}
    balance_rows = (
        db.session.query(CustomerBalance.customer_id, func.sum(CustomerBalance.balance))
        .filter(CustomerBalance.customer_id.in_(customer_ids), CustomerBalance.branch_id.in_(allowed_branch_ids))
        .group_by(CustomerBalance.customer_id).all()
    )
    balances = {customer_id: float(balance or 0) for customer_id, balance in balance_rows}
    return appointments, promos, deposits, balances


def _customer_data_quality(allowed_branch_ids: Sequence[int]):
    missing_dates = db.session.query(func.count(Invoice.id)).filter(
        Invoice.status == InvoiceStatus.PAID,
        Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        Invoice.invoice_date.is_(None),
    ).scalar() or 0
    mismatches = (
        db.session.query(func.count(Invoice.id)).join(Customer, Customer.id == Invoice.customer_id)
        .filter(
            Invoice.status == InvoiceStatus.PAID,
            Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            Invoice.branch_id != Customer.branch_id,
        ).scalar() or 0
    )
    # Keep this diagnostic branch-scoped and normalize common Egyptian local/
    # international forms to the same national number. PostgreSQL can remove
    # every non-digit character; the SQLite expression supports the test suite.
    if db.engine.dialect.name == "postgresql":
        phone_digits = func.regexp_replace(func.coalesce(Customer.phone, ""), "[^0-9]", "", "g")
    else:
        phone_digits = func.replace(
            func.replace(func.replace(func.replace(func.replace(func.coalesce(Customer.phone, ""), " ", ""), "-", ""), "+", ""), "(", ""), ")", ""
        )
    normalized_phone = case(
        (phone_digits.like("0020%"), func.substr(phone_digits, 5)),
        (phone_digits.like("20%"), func.substr(phone_digits, 3)),
        (phone_digits.like("0%"), func.substr(phone_digits, 2)),
        else_=phone_digits,
    )
    duplicate_groups = (
        db.session.query(Customer.branch_id, normalized_phone.label("normalized_phone"))
        .filter(
            Customer.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            normalized_phone != "",
        )
        .group_by(Customer.branch_id, normalized_phone).having(func.count(Customer.id) > 1).count()
    )
    return {
        "missing_invoice_date_count": int(missing_dates),
        "branch_customer_mismatch_count": int(mismatches),
        "suspected_same_branch_phone_duplicate_groups": int(duplicate_groups),
    }


def _customer_summary(rows: Sequence[dict], coverage: dict, history: dict, filters: ReportFilters):
    customer_count = len(rows)
    net_spend = _money(sum((Decimal(str(row["net_spend"])) for row in rows), Decimal("0")))
    invoice_count = sum(row["paid_invoice_count"] for row in rows)
    interval_rows = [row for row in rows if row["average_paid_day_interval"] is not None and row["_interval_gap_count"] > 0]
    interval_gap_count = sum(row["_interval_gap_count"] for row in interval_rows)
    known_as_of = len(history)
    dormant_count = sum(1 for value in history.values() if (filters.date_to - value["last_paid_date"]).days > filters.dormancy_days)
    return {
        "identified_customers": customer_count,
        "identified_invoice_share": coverage["identified_invoice_share"],
        "identified_net_spend": net_spend,
        "identified_net_sales_share": coverage["identified_net_sales_share"],
        "paid_invoice_count": invoice_count,
        "average_ticket": _money(Decimal(str(net_spend)) / invoice_count) if invoice_count else None,
        "first_known_customers": sum(1 for row in rows if row["cohort"] == "FIRST_KNOWN"),
        "previously_known_customers": sum(1 for row in rows if row["cohort"] == "PREVIOUSLY_KNOWN"),
        "transaction_repeat_customers": sum(1 for row in rows if row["transaction_repeat"]),
        "repeat_paid_day_customers": sum(1 for row in rows if row["behavioral_repeat"]),
        "repeat_share": _share(sum(1 for row in rows if row["behavioral_repeat"]), customer_count),
        "distinct_paid_dates": sum(row["paid_date_count"] for row in rows),
        "average_paid_day_interval": round(sum(row["average_paid_day_interval"] * row["_interval_gap_count"] for row in interval_rows) / interval_gap_count, 1) if interval_gap_count else None,
        "known_as_of_customers": known_as_of,
        "dormant_customers": dormant_count,
        "anonymous_invoice_count": coverage["anonymous_invoice_count"],
        "anonymous_invoice_share": coverage["anonymous_invoice_share"],
    }


def _customer_core_state(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, search="", customer_id: Optional[int] = None):
    history = _customer_history_map(allowed_branch_ids, filters, customer_id)
    intervals = _customer_interval_map(allowed_branch_ids, filters, customer_id=customer_id)
    rows = _customer_period_rows(allowed_branch_ids, filters, customer_id)
    if customer_id and not rows and customer_id in history:
        identity = (
            db.session.query(Customer, Branch.name.label("branch_name"))
            .join(Branch, Branch.id == Customer.branch_id)
            .filter(Customer.id == customer_id).first()
        )
        if identity:
            customer, branch_name = identity
            rows.append({
                "customer_id": customer.id,
                "customer_name": customer.full_name or "عميل غير مسمى",
                "phone": customer.phone,
                "record_branch_id": customer.branch_id,
                "record_branch_name": branch_name,
                "operational_status": "ACTIVE" if customer.is_active else "INACTIVE",
                "gross_spend": 0.0,
                "discount_amount": 0.0,
                "net_spend": 0.0,
                "paid_invoice_count": 0,
                "paid_date_count": 0,
                "period_first_paid_date": None,
                "period_last_paid_date": None,
            })
    rows = _customer_enrich_core_rows(rows, history, intervals, filters)
    rows = _customer_filter_rows(rows, filters, search)
    coverage = _customer_coverage(allowed_branch_ids, filters)
    return rows, history, coverage, _customer_summary(rows, coverage, history, filters)


def _customer_filter_options(allowed_branch_ids: Sequence[int]):
    service_options = _service_filter_options(allowed_branch_ids)
    product_options = _product_filter_options(allowed_branch_ids)
    sales_options = _sales_filter_options(allowed_branch_ids)
    return {
        "services": service_options["services"],
        "categories": service_options["categories"],
        "barbers": service_options["barbers"],
        "products": product_options["products"],
        "product_categories": product_options["categories"],
        "promo_codes": sales_options["promo_codes"],
        "dormancy_options": sorted(CUSTOMER_DORMANCY_OPTIONS),
    }


def build_customer_report(
    allowed_branch_ids: Sequence[int],
    filters: ReportFilters,
    *,
    page=1,
    per_page=12,
    search="",
    sort_by="net_spend",
    sort_dir="desc",
    customer_id: Optional[int] = None,
):
    if sort_dir not in REPORT_SORT_DIRECTIONS:
        raise ValueError("sort_dir must be asc or desc.")
    rows, history, coverage, summary = _customer_core_state(allowed_branch_ids, filters, search=search, customer_id=customer_id)
    previous_rows, previous_history, previous_coverage, previous_summary = _customer_core_state(
        allowed_branch_ids, _previous_filters(filters), search=search, customer_id=customer_id,
    )
    customer_ids = [row["customer_id"] for row in rows]
    services, products, barbers, item_context = _customer_item_context(allowed_branch_ids, filters, customer_ids)
    appointments, promos, deposits, balances = _customer_supporting_context(allowed_branch_ids, filters, customer_ids)
    empty_appointments = {"scheduled": 0, "completed": 0, "cancelled": 0, "future_scheduled": 0, "with_deposit": 0}
    empty_promo = {"redemption_count": 0, "paid_promo_invoice_count": 0, "promo_discount_amount": 0.0, "net_sales_on_promo_invoices": 0.0}
    empty_deposit = {"collection_count": 0, "collection_amount": 0.0}
    categories_by_customer = item_context.pop("categories_by_customer")
    for row in rows:
        customer_services = services.get(row["customer_id"], [])
        customer_products = products.get(row["customer_id"], [])
        customer_barbers = barbers.get(row["customer_id"], [])
        promo = promos.get(row["customer_id"], dict(empty_promo))
        promo["invoice_share"] = _share(promo["paid_promo_invoice_count"], row["paid_invoice_count"])
        row.update({
            "top_service": customer_services[0] if customer_services else None,
            "top_product": customer_products[0] if customer_products else None,
            "top_barber_affinity": customer_barbers[0] if customer_barbers and customer_barbers[0]["eligible"] else None,
            "service_preferences": customer_services[:8],
            "category_preferences": categories_by_customer.get(row["customer_id"], [])[:8],
            "product_preferences": customer_products[:8],
            "barber_affinity": customer_barbers[:8],
            "appointments": appointments.get(row["customer_id"], dict(empty_appointments)),
            "promo": promo,
            "deposits": deposits.get(row["customer_id"], dict(empty_deposit)),
            "recorded_current_deposit_balance": balances.get(row["customer_id"], 0),
        })
    sortable = {
        "net_spend", "recorded_lifetime_net_spend", "paid_invoice_count", "paid_date_count",
        "average_ticket", "recency_days", "last_paid_date", "customer_name",
    }
    if sort_by not in sortable:
        sort_by = "net_spend"
    def sort_value(item):
        value = item.get(sort_by)
        if value is None:
            return -1 if sort_dir == "desc" else float("inf")
        return value.casefold() if isinstance(value, str) else value
    rows.sort(key=lambda item: item["customer_name"].casefold())
    rows.sort(key=sort_value, reverse=sort_dir == "desc")
    top_rows = sorted(rows, key=lambda item: (-item["net_spend"], item["customer_name"]))
    identified_net = summary["identified_net_spend"]
    concentration = {
        "top_one_share": _share(sum(row["net_spend"] for row in top_rows[:1]), identified_net),
        "top_five_share": _share(sum(row["net_spend"] for row in top_rows[:5]), identified_net),
        "top_ten_share": _share(sum(row["net_spend"] for row in top_rows[:10]), identified_net),
        "denominator": "IDENTIFIED_NET_SPEND",
    }
    previous_top = sorted(previous_rows, key=lambda item: -item["net_spend"])
    previous_top_five = _share(sum(row["net_spend"] for row in previous_top[:5]), previous_summary["identified_net_spend"])
    comparison_keys = (
        "identified_customers", "identified_net_spend", "paid_invoice_count", "average_ticket",
        "first_known_customers", "previously_known_customers", "repeat_share", "anonymous_invoice_share",
    )
    comparison = {
        key: _comparison(float(summary[key] or 0), float(previous_summary[key] or 0))
        for key in comparison_keys
    }
    recency_distribution = {key: 0 for key in ("0_30", "31_60", "61_90", "91_PLUS")}
    for historical in history.values():
        recency_distribution[_customer_recency_bucket((filters.date_to - historical["last_paid_date"]).days)] += 1
    frequency_distribution = {"1": 0, "2": 0, "3_5": 0, "6_PLUS": 0}
    for row in rows:
        days = row["paid_date_count"]
        frequency_distribution["1" if days == 1 else "2" if days == 2 else "3_5" if days <= 5 else "6_PLUS"] += 1
    period_spends = sorted(row["net_spend"] for row in rows if row["net_spend"] > 0)
    lifetime_spends = sorted(value["net_spend"] for value in history.values() if value["net_spend"] > 0)
    period_high_value = period_spends[max(int(len(period_spends) * .75) - 1, 0)] if period_spends else 0.0
    lifetime_high_value = lifetime_spends[max(int(len(lifetime_spends) * .75) - 1, 0)] if lifetime_spends else 0.0
    average_tickets = sorted(row["average_ticket"] for row in rows if row["average_ticket"] is not None)
    median_ticket = _median(average_tickets) if average_tickets else 0.0
    promo_active = sum(1 for row in rows if row["promo"]["redemption_count"] > 0)
    history_ranking = sorted(history.items(), key=lambda item: (-item[1]["net_spend"], item[0]))
    dormant_history = [
        (customer_key, values)
        for customer_key, values in history_ranking
        if (filters.date_to - values["last_paid_date"]).days > filters.dormancy_days
    ]
    identity_ids = {customer_key for customer_key, _values in history_ranking[:10]}
    identity_ids.update(customer_key for customer_key, _values in dormant_history[:10])
    identity_rows = (
        db.session.query(Customer.id, Customer.full_name, Customer.branch_id, Branch.name)
        .join(Branch, Branch.id == Customer.branch_id)
        .filter(Customer.id.in_(identity_ids)).all()
        if identity_ids else []
    )
    identity_map = {row.id: {"customer_name": row.full_name or "عميل غير مسمى", "record_branch_id": row.branch_id, "record_branch_name": row.name} for row in identity_rows}
    lifetime_ranking = [{
        "customer_id": customer_key,
        **identity_map.get(customer_key, {"customer_name": "عميل غير مسمى", "record_branch_id": None, "record_branch_name": "غير متاح"}),
        "recorded_lifetime_net_spend": values["net_spend"],
        "lifetime_paid_invoice_count": values["paid_invoice_count"],
        "lifetime_paid_date_count": values["paid_date_count"],
        "last_paid_date": values["last_paid_date"].isoformat(),
        "recency_days": (filters.date_to - values["last_paid_date"]).days,
    } for customer_key, values in history_ranking[:10]]
    dormant_ranking = [{
        "customer_id": customer_key,
        **identity_map.get(customer_key, {"customer_name": "عميل غير مسمى", "record_branch_id": None, "record_branch_name": "غير متاح"}),
        "recorded_lifetime_net_spend": values["net_spend"],
        "lifetime_paid_invoice_count": values["paid_invoice_count"],
        "last_paid_date": values["last_paid_date"].isoformat(),
        "recency_days": (filters.date_to - values["last_paid_date"]).days,
    } for customer_key, values in dormant_history[:10]]
    high_value_dormant_count = sum(1 for _customer_key, values in dormant_history if lifetime_high_value and values["net_spend"] >= lifetime_high_value)
    segment_rows = [
        {"code": "RECENT_FIRST_KNOWN", "label": "أول نشاط مدفوع مسجل حديثًا", "count": sum(1 for row in rows if row["cohort"] == "FIRST_KNOWN" and (row["recency_days"] or 0) <= 30), "rule": "أول نشاط مدفوع مسجل داخل الفترة وآخر نشاط خلال 30 يومًا من نهاية الفترة"},
        {"code": "FREQUENT_RECORDED", "label": "نشاط مدفوع متكرر", "count": sum(1 for row in rows if row["paid_date_count"] >= 3), "rule": "3 تواريخ دفع مميزة أو أكثر داخل الفترة"},
        {"code": "HIGH_RECORDED_NET", "label": "صافي إنفاق مسجل مرتفع", "count": sum(1 for row in rows if period_high_value and row["net_spend"] >= period_high_value), "rule": f"صافي الفترة عند أو أعلى من الربيع الأعلى ({period_high_value:.2f})"},
        {"code": "FREQUENT_LOW_TICKET", "label": "متكرر بمتوسط فاتورة منخفض", "count": sum(1 for row in rows if row["paid_date_count"] >= 3 and row["average_ticket"] is not None and row["average_ticket"] < median_ticket), "rule": f"3 تواريخ دفع أو أكثر ومتوسط فاتورة أقل من وسيط الفترة ({median_ticket:.2f})"},
        {"code": "INACTIVE_HIGH_VALUE", "label": "قيمة مسجلة مرتفعة دون نشاط حديث", "count": high_value_dormant_count, "rule": f"صافي العمر المسجل عند الربيع الأعلى وعدم وجود نشاط لأكثر من {filters.dormancy_days} يومًا"},
        {"code": "PROMO_ACTIVE", "label": "استخدام برومو مسجل", "count": promo_active, "rule": "فاتورة مدفوعة واحدة على الأقل مرتبطة باسترداد برومو"},
        {"code": "PRODUCT_ACTIVE", "label": "نشاط منتجات مسجل", "count": item_context["product_active_customers"], "rule": "وحدة منتج مدفوعة واحدة على الأقل داخل الفترة"},
        {"code": "SERVICE_ONLY", "label": "نشاط خدمات فقط", "count": item_context["service_only_customers"], "rule": "خدمات مدفوعة دون منتجات داخل الفترة"},
    ]
    insights = []
    net_insight = _comparison_insight("صافي الإنفاق المرتبط بعملاء معروفين", comparison["identified_net_spend"])
    if net_insight:
        insights.append(net_insight)
    insights.append({"code": "IDENTIFIED_COVERAGE", "text": f"مقاييس العملاء تغطي {coverage['identified_invoice_share']:.1f}% من الفواتير المدفوعة في الفترة."})
    if summary["identified_customers"]:
        insights.append({"code": "REPEAT_SHARE", "text": f"{summary['repeat_share']:.1f}% من سجلات العملاء النشطة لها دفع في يومين مميزين أو أكثر."})
    if top_rows:
        insights.append({"code": "TOP_CUSTOMER_SHARE", "text": f"أعلى سجل عميل من حيث صافي الفترة يمثل {concentration['top_one_share']:.1f}% من صافي إنفاق العملاء المعروفين."})
    attention = []
    coverage_change = comparison["anonymous_invoice_share"]["absolute_change"]
    if coverage_change >= 2:
        attention.append({"code": "IDENTIFIED_COVERAGE_DECLINE", "label": "انخفاض تغطية هوية العميل", "detail": f"ارتفعت حصة الفواتير المجهولة {coverage_change:.1f} نقطة مئوية مقارنة بالفترة السابقة.", "tone": "attention"})
    concentration_change = concentration["top_five_share"] - previous_top_five
    if concentration_change >= 5:
        attention.append({"code": "CUSTOMER_CONCENTRATION_INCREASE", "label": "ارتفاع تركّز الإنفاق المسجل", "detail": f"ارتفعت حصة أعلى 5 سجلات عملاء {concentration_change:.1f} نقطة مئوية.", "tone": "neutral"})
    for row in [item for item in dormant_ranking if lifetime_high_value and item["recorded_lifetime_net_spend"] >= lifetime_high_value][:3]:
        attention.append({"code": "HIGH_VALUE_DORMANT", "entity_id": row["customer_id"], "label": "قيمة مسجلة مرتفعة دون نشاط حديث", "detail": f"{row['customer_name']} لا يملك نشاطًا مدفوعًا مسجلًا منذ {row['recency_days']} يومًا؛ الحد المعروض {filters.dormancy_days} يومًا.", "tone": "neutral"})
    previous_from, previous_to = _previous_period(filters)
    total = len(rows)
    for row in rows:
        row.pop("_interval_gap_count", None)
        row.pop("period_first_paid_date", None)
        row.pop("period_last_paid_date", None)
    page_rows = rows[(page - 1) * per_page: page * per_page]
    return {
        "meta": {
            "date_from": filters.date_from.isoformat(), "date_to": filters.date_to.isoformat(),
            "previous_date_from": previous_from.isoformat(), "previous_date_to": previous_to.isoformat(),
            "date_basis": "Invoice.invoice_date (Cairo business date)", "currency": "EGP",
            "identity_basis": "Customer.id; branch-scoped records are never merged by phone",
            "spend_basis": "Paid invoice total_amount minus invoice-level discount_amount",
            "repeat_basis": "Distinct paid invoice dates", "lifetime_basis": "All qualifying stored history through date_to",
            "dormancy_days": filters.dormancy_days,
        },
        "summary": summary,
        "coverage": coverage,
        "comparison": comparison,
        "cohorts": {"first_known": summary["first_known_customers"], "previously_known": summary["previously_known_customers"]},
        "recency_distribution": recency_distribution,
        "frequency_distribution": frequency_distribution,
        "concentration": concentration,
        "rankings": {
            "selected_period_net_spend": [{key: row[key] for key in ("customer_id", "customer_name", "record_branch_name", "net_spend", "paid_invoice_count", "paid_date_count", "recency_days")} for row in top_rows[:10]],
            "recorded_lifetime_net_spend": lifetime_ranking,
        },
        "dormancy": {"threshold_days": filters.dormancy_days, "known_as_of_count": len(history), "dormant_count": len(dormant_history), "customers": dormant_ranking},
        "preferences": item_context,
        "segments": segment_rows,
        "insights": insights[:4], "attention": attention[:5],
        "data_quality": {**_customer_data_quality(allowed_branch_ids), "anonymous_paid_invoices": coverage["anonymous_invoice_count"]},
        "table": {"items": page_rows, "pagination": _pagination_payload(page, per_page, total)},
        "filter_options": _customer_filter_options(allowed_branch_ids),
    }


def build_customer_drilldown(allowed_branch_ids: Sequence[int], filters: ReportFilters, customer_id: int):
    report = build_customer_report(allowed_branch_ids, filters, page=1, per_page=1, customer_id=customer_id)
    items = report["table"]["items"]
    if not items:
        return None
    customer = items[0]
    invoice_rows = (
        db.session.query(
            Invoice.id, Invoice.invoice_number, Invoice.invoice_date, Branch.name,
            Invoice.total_amount, Invoice.discount_amount,
        )
        .join(Branch, Branch.id == Invoice.branch_id)
        .filter(*_customer_invoice_conditions(allowed_branch_ids, filters, identified_only=True), Invoice.customer_id == customer_id)
        .order_by(Invoice.invoice_date.desc(), Invoice.id.desc()).limit(100).all()
    )
    promo_code_rows = (
        db.session.query(PromoRedemption.code_snapshot, func.count(PromoRedemption.id), func.sum(PromoRedemption.promo_discount_amount))
        .join(Invoice, Invoice.id == PromoRedemption.invoice_id)
        .filter(*_customer_invoice_conditions(allowed_branch_ids, filters, identified_only=True), Invoice.customer_id == customer_id)
        .group_by(PromoRedemption.code_snapshot).order_by(func.count(PromoRedemption.id).desc()).all()
    )
    start_utc, end_utc = cairo_day_window(filters.date_from, filters.date_to)
    deposit_methods = (
        db.session.query(AppointmentDepositTransaction.payment_method, func.count(AppointmentDepositTransaction.id), func.sum(AppointmentDepositTransaction.amount))
        .filter(
            AppointmentDepositTransaction.branch_id.in_(allowed_branch_ids),
            AppointmentDepositTransaction.customer_id == customer_id,
            AppointmentDepositTransaction.transaction_type == AppointmentDepositTransactionType.DEPOSIT_COLLECTION,
            AppointmentDepositTransaction.created_at >= start_utc,
            AppointmentDepositTransaction.created_at <= end_utc,
        ).group_by(AppointmentDepositTransaction.payment_method).all()
    )
    lifetime_interval = _customer_interval_map(allowed_branch_ids, filters, lifetime=True, customer_id=customer_id).get(customer_id, {})
    return {
        "meta": report["meta"],
        "customer": customer,
        "paid_activity": [{
            "invoice_id": row.id, "invoice_number": row.invoice_number, "date": row.invoice_date.isoformat(),
            "branch_name": row.name, "gross": _money(row.total_amount), "discount": _money(row.discount_amount),
            "net": _money(Decimal(str(row.total_amount or 0)) - Decimal(str(row.discount_amount or 0))),
        } for row in invoice_rows],
        "lifetime_average_paid_day_interval": lifetime_interval.get("average_days"),
        "promo_codes": [{"code": code, "redemption_count": int(count or 0), "discount_amount": _money(amount)} for code, count, amount in promo_code_rows],
        "deposit_methods": [{"method": method.value, "collection_count": int(count or 0), "collection_amount": _money(amount)} for method, count, amount in deposit_methods],
    }


def customer_export_report(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, search=""):
    return build_customer_report(allowed_branch_ids, filters, page=1, per_page=100000, search=search)


def _cairo_date_value(value: datetime) -> date:
    source = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return source.astimezone(CAIRO_TZ).date()


def finance_performance_export_rows(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    return _finance_performance_table(allowed_branch_ids, filters, page=1, per_page=100000)["items"]


def finance_treasury_export_rows(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    return _business_day_rows(allowed_branch_ids, filters, paginate=False)["items"]


def service_export_rows(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    report = build_services_report(allowed_branch_ids, filters, page=1, per_page=100000)
    return report["table"]["items"]


def product_export_rows(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    report = build_products_report(allowed_branch_ids, filters, page=1, per_page=100000)
    return report["table"]["items"]
