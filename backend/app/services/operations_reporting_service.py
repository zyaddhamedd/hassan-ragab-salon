"""Read-only Operations Intelligence aggregation for Admin Reports.

The service keeps period activity, current snapshots, and control conditions
separate.  It deliberately does not infer absence, utilization, appointment
conversion, queue performance, historical inventory, or financial loss.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Sequence

from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import aliased, joinedload

from app.extensions import db
from app.models.appointment import Appointment, AppointmentStatus
from app.models.appointment_deposit_transaction import (
    AppointmentDepositTransaction,
    AppointmentDepositTransactionType,
)
from app.models.attendance import Attendance, AttendanceCheckoutSource, AttendanceStatus
from app.models.branch import Branch
from app.models.business_day import BusinessDay, BusinessDayStatus
from app.models.customer import Customer
from app.models.employee import Employee
from app.models.inventory_batch import BranchInventoryBatch, InventoryBatchStatus
from app.models.invoice import Invoice, InvoiceItem, InvoiceStatus
from app.models.product import Product, ProductBranchStock, StockMovement, StockMovementType
from app.models.promo_code import PromoRedemption
from app.models.supply_operations import (
    StockReturnRequest,
    StockShipment,
    StockShipmentItem,
    StockSupplyRequest,
    StockSupplyRequestItem,
)
from app.services.financial_service import cairo_day_window
from app.services.reporting_service import (
    PRODUCT_SLOW_MOVING_MAX_UNITS,
    ReportFilters,
    _comparison,
    _previous_filters,
)
from app.utils.date_utils import CAIRO_TZ, get_cairo_date


def _float(value) -> float:
    return round(float(value or 0), 2)


def _percent(part, total) -> float:
    return round(float(part or 0) * 100 / float(total), 1) if total else 0.0


def _iso(value):
    return value.isoformat() if value is not None else None


def _as_utc(value):
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _hours_between(start, end) -> float:
    return max((_as_utc(end) - _as_utc(start)).total_seconds(), 0) / 3600


def _pagination(page: int, per_page: int, total: int):
    total_pages = (total + per_page - 1) // per_page if total else 0
    return {
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": total_pages,
        "has_more": page < total_pages,
    }


def _timestamp_window(filters: ReportFilters):
    return cairo_day_window(filters.date_from, filters.date_to)


def _stock_state(quantity: int, threshold: int) -> str:
    return "NEGATIVE" if quantity < 0 else "OUT" if quantity == 0 else "LOW" if quantity <= threshold else "HEALTHY"


def _high_selling_cutoff(product_sales: dict) -> int:
    positive_sales = sorted(int(value or 0) for value in product_sales.values() if int(value or 0) > 0)
    return positive_sales[len(positive_sales) // 2] if positive_sales else 0


def _attendance_block(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    rows = (
        db.session.query(
            Attendance.id,
            Attendance.employee_id,
            Attendance.branch_id,
            Attendance.business_day_id,
            Attendance.date,
            Attendance.check_in_time,
            Attendance.check_out_time,
            Attendance.status,
            Attendance.checkout_source,
        )
        .filter(
            Attendance.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            Attendance.date >= filters.date_from,
            Attendance.date <= filters.date_to,
        )
        .all()
    )
    completed = []
    incomplete = 0
    sources = {source.value: 0 for source in AttendanceCheckoutSource}
    linked_days = set()
    legacy_days = set()
    invalid_duration = 0
    corrections_by_employee = defaultdict(lambda: {"completed": 0, "corrected": 0, "name": ""})
    employee_ids = {row.employee_id for row in rows}
    employee_names = dict(
        db.session.query(Employee.id, Employee.full_name).filter(Employee.id.in_(employee_ids)).all()
    ) if employee_ids else {}
    for row in rows:
        valid = (
            row.status == AttendanceStatus.LEFT
            and row.check_in_time is not None
            and row.check_out_time is not None
            and row.check_out_time >= row.check_in_time
        )
        if valid:
            completed.append(row)
            if row.business_day_id is not None:
                linked_days.add((row.employee_id, row.business_day_id))
            else:
                legacy_days.add((row.employee_id, row.branch_id, row.date))
            if row.checkout_source:
                sources[row.checkout_source.value] += 1
            employee = corrections_by_employee[row.employee_id]
            employee["completed"] += 1
            employee["name"] = employee_names.get(row.employee_id, f"#{row.employee_id}")
            if row.checkout_source == AttendanceCheckoutSource.ADMIN_CORRECTION:
                employee["corrected"] += 1
        else:
            incomplete += 1
            if row.check_in_time and row.check_out_time and row.check_out_time < row.check_in_time:
                invalid_duration += 1
    seconds = sum((row.check_out_time - row.check_in_time).total_seconds() for row in completed)
    repeated = [
        {
            "employee_id": employee_id,
            "employee_name": values["name"],
            "completed_sessions": values["completed"],
            "admin_corrections": values["corrected"],
            "correction_share": _percent(values["corrected"], values["completed"]),
        }
        for employee_id, values in corrections_by_employee.items()
        if values["completed"] >= 5
        and values["corrected"] >= 2
        and _percent(values["corrected"], values["completed"]) >= 20
    ]
    present_now = (
        db.session.query(func.count(func.distinct(Attendance.employee_id)))
        .filter(
            Attendance.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            Attendance.status == AttendanceStatus.PRESENT,
        )
        .scalar() or 0
    )
    closed_present = (
        db.session.query(func.count(Attendance.id))
        .join(BusinessDay, BusinessDay.id == Attendance.business_day_id)
        .filter(
            Attendance.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            Attendance.status == AttendanceStatus.PRESENT,
            BusinessDay.status == BusinessDayStatus.CLOSED,
        )
        .scalar() or 0
    )
    left = aliased(Attendance)
    right = aliased(Attendance)
    overlapping = (
        db.session.query(func.count(func.distinct(left.id)))
        .filter(
            left.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            left.date >= filters.date_from,
            left.date <= filters.date_to,
            left.employee_id == right.employee_id,
            left.id < right.id,
            left.check_in_time.isnot(None),
            right.check_in_time.isnot(None),
            func.coalesce(left.check_out_time, datetime.max.replace(tzinfo=timezone.utc)) > right.check_in_time,
            func.coalesce(right.check_out_time, datetime.max.replace(tzinfo=timezone.utc)) > left.check_in_time,
        )
        .scalar() or 0
    )
    recorded_hours = round(seconds / 3600, 2)
    return {
        "completed_sessions": len(completed),
        "incomplete_sessions": incomplete,
        "recorded_hours": recorded_hours,
        "average_session_hours": round(recorded_hours / len(completed), 2) if completed else 0.0,
        "recorded_workdays": len(linked_days) + len(legacy_days),
        "linked_workdays": len(linked_days),
        "legacy_workdays": len(legacy_days),
        "present_now": int(present_now),
        "checkout_sources": sources,
        "controls": {
            "present_on_closed_day": int(closed_present),
            "overlapping_sessions": int(overlapping),
            "invalid_duration_sessions": invalid_duration,
            "missing_business_day_link": sum(1 for row in rows if row.business_day_id is None),
            "repeated_corrections": repeated,
        },
    }


def _business_day_block(allowed_branch_ids: Sequence[int], filters: ReportFilters, page: int = 1, per_page: int = 20):
    start_utc, end_utc = _timestamp_window(filters)
    rows = (
        BusinessDay.query.options(joinedload(BusinessDay.branch), joinedload(BusinessDay.opener), joinedload(BusinessDay.closer))
        .filter(BusinessDay.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False)
        .order_by(BusinessDay.opened_at.desc(), BusinessDay.id.desc())
        .all()
    )
    today = get_cairo_date()
    now = datetime.now(timezone.utc)
    period_rows = [row for row in rows if start_utc <= _as_utc(row.opened_at) <= end_utc]
    open_rows = [row for row in rows if row.status == BusinessDayStatus.OPEN]
    old_open = [row for row in open_rows if _as_utc(row.opened_at).astimezone(CAIRO_TZ).date() < today]
    closed_period = [row for row in period_rows if row.status == BusinessDayStatus.CLOSED]
    attendance_counts = dict(
        db.session.query(Attendance.business_day_id, func.count(Attendance.id))
        .filter(Attendance.business_day_id.in_([row.id for row in rows]) if rows else False)
        .group_by(Attendance.business_day_id).all()
    )
    auto_counts = dict(
        db.session.query(Attendance.business_day_id, func.count(Attendance.id))
        .filter(
            Attendance.business_day_id.in_([row.id for row in rows]) if rows else False,
            Attendance.checkout_source == AttendanceCheckoutSource.BUSINESS_DAY_CLOSE,
        )
        .group_by(Attendance.business_day_id).all()
    )
    correction_counts = dict(
        db.session.query(Attendance.business_day_id, func.count(Attendance.id))
        .filter(
            Attendance.business_day_id.in_([row.id for row in rows]) if rows else False,
            Attendance.checkout_source == AttendanceCheckoutSource.ADMIN_CORRECTION,
        )
        .group_by(Attendance.business_day_id).all()
    )
    active_counts = dict(
        db.session.query(Attendance.business_day_id, func.count(Attendance.id))
        .filter(
            Attendance.business_day_id.in_([row.id for row in rows]) if rows else False,
            Attendance.status == AttendanceStatus.PRESENT,
        )
        .group_by(Attendance.business_day_id).all()
    )
    by_id = {row.id: row for row in rows}
    next_counts = defaultdict(int)
    for row in rows:
        if row.previous_day_id:
            next_counts[row.previous_day_id] += 1
    continuity = {
        "missing_previous_link": 0,
        "cross_branch_previous": 0,
        "chain_forks": sum(1 for count in next_counts.values() if count > 1),
        "closed_missing_closed_at": 0,
        "open_with_closed_at": 0,
        "present_on_closed_day": sum(active_counts.get(row.id, 0) for row in rows if row.status == BusinessDayStatus.CLOSED),
    }
    branch_order = defaultdict(list)
    for row in sorted(rows, key=lambda value: (value.branch_id, value.opened_at, value.id)):
        branch_order[row.branch_id].append(row)
        if row.status == BusinessDayStatus.CLOSED and row.closed_at is None:
            continuity["closed_missing_closed_at"] += 1
        if row.status == BusinessDayStatus.OPEN and row.closed_at is not None:
            continuity["open_with_closed_at"] += 1
        if row.previous_day_id:
            previous = by_id.get(row.previous_day_id)
            if previous and previous.branch_id != row.branch_id:
                continuity["cross_branch_previous"] += 1
    for branch_rows in branch_order.values():
        for index, row in enumerate(branch_rows):
            if index > 0 and row.previous_day_id is None:
                continuity["missing_previous_link"] += 1
    detail_source = period_rows + [item for item in old_open if item not in period_rows]
    page_rows = detail_source[(page - 1) * per_page:page * per_page]
    detail_rows = []
    for row in page_rows:
        duration_end = row.closed_at or now
        detail_rows.append({
            "business_day_id": row.id,
            "branch_id": row.branch_id,
            "branch_name": row.branch.name if row.branch else f"#{row.branch_id}",
            "status": row.status.value,
            "business_date": _as_utc(row.opened_at).astimezone(CAIRO_TZ).date().isoformat(),
            "opened_at": _iso(row.opened_at),
            "closed_at": _iso(row.closed_at),
            "duration_hours": round(_hours_between(row.opened_at, duration_end), 2),
            "opened_by": row.opener.full_name if row.opener else "—",
            "closed_by": row.closer.full_name if row.closer else None,
            "attendance_sessions": int(attendance_counts.get(row.id, 0)),
            "auto_checkouts": int(auto_counts.get(row.id, 0)),
            "admin_corrections": int(correction_counts.get(row.id, 0)),
            "active_attendance": int(active_counts.get(row.id, 0)),
            "variance": _float(row.variance) if row.variance is not None else None,
            "old_open": row in old_open,
        })
    durations = [_hours_between(row.opened_at, row.closed_at) for row in closed_period if row.closed_at]
    return {
        "opened": len(period_rows),
        "closed": len(closed_period),
        "currently_open": len(open_rows),
        "old_open": len(old_open),
        "average_closed_duration_hours": round(sum(durations) / len(durations), 2) if durations else 0.0,
        "days_with_admin_corrections": sum(1 for row in period_rows if correction_counts.get(row.id, 0)),
        "open_days_with_active_attendance": sum(1 for row in open_rows if active_counts.get(row.id, 0)),
        "continuity": continuity,
        "items": detail_rows,
        "pagination": _pagination(page, per_page, len(detail_source)),
    }


def _business_day_overview_context(allowed_branch_ids: Sequence[int]):
    open_rows = BusinessDay.query.filter(
        BusinessDay.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        BusinessDay.status == BusinessDayStatus.OPEN,
    ).all()
    today = get_cairo_date()
    return {
        "currently_open": len(open_rows),
        "old_open": sum(1 for row in open_rows if _as_utc(row.opened_at).astimezone(CAIRO_TZ).date() < today),
    }


def _appointment_overview_context(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    conditions = [
        Appointment.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        Appointment.appointment_date >= filters.date_from,
        Appointment.appointment_date <= filters.date_to,
    ]
    status_rows = db.session.query(Appointment.status, func.count(Appointment.id)).filter(*conditions).group_by(Appointment.status).all()
    count = sum(int(row_count or 0) for _status, row_count in status_rows)
    past_still_scheduled = Appointment.query.filter(
        Appointment.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        Appointment.status == AppointmentStatus.SCHEDULED,
        Appointment.appointment_date < get_cairo_date(),
    ).count()
    return {
        "count": count,
        "past_still_scheduled": int(past_still_scheduled),
        "status_basis": "CURRENT_STORED_STATUS",
    }


def _appointment_block(allowed_branch_ids: Sequence[int], filters: ReportFilters, page: int = 1, per_page: int = 20):
    conditions = [
        Appointment.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        Appointment.appointment_date >= filters.date_from,
        Appointment.appointment_date <= filters.date_to,
    ]
    status_rows = db.session.query(Appointment.status, func.count(Appointment.id)).filter(*conditions).group_by(Appointment.status).all()
    counts = {status.value: int(count) for status, count in status_rows}
    total = sum(counts.values())
    today = get_cairo_date()
    future = Appointment.query.filter(
        Appointment.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        Appointment.status == AppointmentStatus.SCHEDULED,
        Appointment.appointment_date > today,
    ).count()
    past = Appointment.query.filter(
        Appointment.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        Appointment.status == AppointmentStatus.SCHEDULED,
        Appointment.appointment_date < today,
    ).count()
    assigned = Appointment.query.filter(*conditions, Appointment.barber_id.isnot(None)).count()
    by_barber_rows = (
        db.session.query(
            Employee.id, Employee.full_name,
            func.count(Appointment.id),
            func.sum(case((Appointment.status == AppointmentStatus.SCHEDULED, 1), else_=0)),
            func.sum(case((Appointment.status == AppointmentStatus.COMPLETED, 1), else_=0)),
            func.sum(case((Appointment.status == AppointmentStatus.CANCELLED, 1), else_=0)),
            func.sum(case((and_(Appointment.status == AppointmentStatus.SCHEDULED, Appointment.appointment_date > today), 1), else_=0)),
        )
        .join(Employee, Employee.id == Appointment.barber_id)
        .filter(*conditions)
        .group_by(Employee.id, Employee.full_name)
        .order_by(func.count(Appointment.id).desc())
        .limit(10).all()
    )
    recent = (
        Appointment.query.options(joinedload(Appointment.branch), joinedload(Appointment.customer), joinedload(Appointment.barber), joinedload(Appointment.service))
        .filter(*conditions)
        .order_by(Appointment.appointment_date.desc(), Appointment.appointment_time.desc(), Appointment.id.desc())
        .offset((page - 1) * per_page).limit(per_page).all()
    )
    deposit_counts = dict(
        db.session.query(AppointmentDepositTransaction.appointment_id, func.count(AppointmentDepositTransaction.id))
        .filter(
            AppointmentDepositTransaction.appointment_id.in_([row.id for row in recent]) if recent else False,
            AppointmentDepositTransaction.transaction_type == AppointmentDepositTransactionType.DEPOSIT_COLLECTION,
        )
        .group_by(AppointmentDepositTransaction.appointment_id).all()
    )
    return {
        "count": total,
        "scheduled": counts.get(AppointmentStatus.SCHEDULED.value, 0),
        "completed": counts.get(AppointmentStatus.COMPLETED.value, 0),
        "cancelled": counts.get(AppointmentStatus.CANCELLED.value, 0),
        "scheduled_share": _percent(counts.get(AppointmentStatus.SCHEDULED.value, 0), total),
        "completed_share": _percent(counts.get(AppointmentStatus.COMPLETED.value, 0), total),
        "cancelled_share": _percent(counts.get(AppointmentStatus.CANCELLED.value, 0), total),
        "future_scheduled": int(future),
        "past_still_scheduled": int(past),
        "assigned_count": int(assigned),
        "by_barber": [{
            "barber_id": row[0], "barber_name": row[1], "appointments": int(row[2] or 0),
            "scheduled": int(row[3] or 0), "completed": int(row[4] or 0), "cancelled": int(row[5] or 0),
            "future_scheduled": int(row[6] or 0),
        } for row in by_barber_rows],
        "items": [{
            "appointment_id": row.id,
            "date": row.appointment_date.isoformat(),
            "time": row.appointment_time.isoformat(timespec="minutes"),
            "branch_name": row.branch.name if row.branch else f"#{row.branch_id}",
            "customer_name": row.customer.full_name if row.customer else "—",
            "barber_name": row.barber.full_name if row.barber else None,
            "service_name": row.service_name or (row.service.name if row.service else None),
            "status": row.status.value,
            "deposit_amount": int(row.deposit_amount or 0),
            "deposit_collection_count": int(deposit_counts.get(row.id, 0)),
        } for row in recent],
        "pagination": _pagination(page, per_page, total),
        "status_basis": "CURRENT_STORED_STATUS",
    }


def _deposit_block(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    start_utc, end_utc = _timestamp_window(filters)
    conditions = [
        AppointmentDepositTransaction.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        AppointmentDepositTransaction.created_at >= start_utc,
        AppointmentDepositTransaction.created_at <= end_utc,
        AppointmentDepositTransaction.transaction_type == AppointmentDepositTransactionType.DEPOSIT_COLLECTION,
    ]
    count, amount = db.session.query(func.count(AppointmentDepositTransaction.id), func.coalesce(func.sum(AppointmentDepositTransaction.amount), 0)).filter(*conditions).one()
    methods = db.session.query(AppointmentDepositTransaction.payment_method, func.count(AppointmentDepositTransaction.id), func.coalesce(func.sum(AppointmentDepositTransaction.amount), 0)).filter(*conditions).group_by(AppointmentDepositTransaction.payment_method).all()
    deposit_date = (
        func.date(func.timezone("Africa/Cairo", AppointmentDepositTransaction.created_at))
        if db.engine.dialect.name == "postgresql"
        else func.date(AppointmentDepositTransaction.created_at)
    )
    trend_rows = (
        db.session.query(deposit_date, func.count(AppointmentDepositTransaction.id), func.coalesce(func.sum(AppointmentDepositTransaction.amount), 0))
        .filter(*conditions).group_by(deposit_date).order_by(deposit_date.asc()).all()
    )
    return {
        "collection_count": int(count or 0),
        "collection_amount": _float(amount),
        "methods": [{"method": method.value, "count": int(rows), "amount": _float(total)} for method, rows, total in methods],
        "trend": [{"date": str(day), "count": int(rows), "amount": _float(total)} for day, rows, total in trend_rows],
        "lifecycle_basis": "COLLECTION_ONLY",
    }


def _promo_block(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    paid_conditions = [
        Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        Invoice.status == InvoiceStatus.PAID,
        Invoice.invoice_date >= filters.date_from,
        Invoice.invoice_date <= filters.date_to,
    ]
    paid_count = db.session.query(func.count(Invoice.id)).filter(*paid_conditions).scalar() or 0
    rows = (
        db.session.query(
            PromoRedemption.code_snapshot,
            func.count(PromoRedemption.id),
            func.coalesce(func.sum(PromoRedemption.promo_discount_amount), 0),
            func.coalesce(func.sum(PromoRedemption.net_invoice_total), 0),
        )
        .join(Invoice, Invoice.id == PromoRedemption.invoice_id)
        .filter(*paid_conditions)
        .group_by(PromoRedemption.code_snapshot)
        .order_by(func.count(PromoRedemption.id).desc())
        .all()
    )
    redemption_count = sum(int(row[1] or 0) for row in rows)
    detail_rows = (
        db.session.query(PromoRedemption, Invoice.customer_id, Invoice.branch_id, Branch.name)
        .join(Invoice, Invoice.id == PromoRedemption.invoice_id)
        .join(Branch, Branch.id == Invoice.branch_id)
        .filter(*paid_conditions).all()
    )
    customer_ids = {customer_id for _redemption, customer_id, _branch_id, _branch_name in detail_rows if customer_id}
    first_paid = {
        (customer_id, branch_id): first_date
        for customer_id, branch_id, first_date in (
            db.session.query(Invoice.customer_id, Invoice.branch_id, func.min(Invoice.invoice_date))
            .filter(Invoice.status == InvoiceStatus.PAID, Invoice.customer_id.in_(customer_ids) if customer_ids else False)
            .group_by(Invoice.customer_id, Invoice.branch_id).all()
        )
    }
    branch_context = defaultdict(lambda: {"redemptions": 0, "discount_amount": Decimal("0")})
    customer_context = {"first_known": 0, "previously_known": 0, "anonymous": 0}
    category_context = defaultdict(lambda: {"eligible_units": 0, "eligible_value": Decimal("0")})
    for redemption, customer_id, branch_id, branch_name in detail_rows:
        branch_context[(branch_id, branch_name)]["redemptions"] += 1
        branch_context[(branch_id, branch_name)]["discount_amount"] += Decimal(str(redemption.promo_discount_amount or 0))
        if customer_id is None:
            customer_context["anonymous"] += 1
        elif first_paid.get((customer_id, branch_id)) and first_paid[(customer_id, branch_id)] >= filters.date_from:
            customer_context["first_known"] += 1
        else:
            customer_context["previously_known"] += 1
        snapshot = redemption.eligibility_snapshot or {}
        for item in snapshot.get("items", []):
            category_name = item.get("category_name") or "غير مصنف"
            category_context[category_name]["eligible_units"] += int(item.get("quantity") or 0)
            category_context[category_name]["eligible_value"] += Decimal(str(item.get("eligible_line_total") or 0))
    non_paid = (
        db.session.query(func.count(PromoRedemption.id))
        .join(Invoice, Invoice.id == PromoRedemption.invoice_id)
        .filter(
            PromoRedemption.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            Invoice.status != InvoiceStatus.PAID,
        ).scalar() or 0
    )
    inconsistent = (
        db.session.query(func.count(PromoRedemption.id))
        .filter(
            PromoRedemption.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            PromoRedemption.net_invoice_total != PromoRedemption.gross_invoice_total - PromoRedemption.total_discount_amount,
        ).scalar() or 0
    )
    return {
        "redemption_count": redemption_count,
        "promo_invoice_share": _percent(redemption_count, paid_count),
        "discount_amount": _float(sum(Decimal(str(row[2] or 0)) for row in rows)),
        "net_sales": _float(sum(Decimal(str(row[3] or 0)) for row in rows)),
        "codes": [{"code": row[0], "redemptions": int(row[1]), "discount_amount": _float(row[2]), "net_sales": _float(row[3])} for row in rows[:10]],
        "branches": [{"branch_id": branch_id, "branch_name": branch_name, "redemptions": values["redemptions"], "discount_amount": _float(values["discount_amount"])} for (branch_id, branch_name), values in sorted(branch_context.items(), key=lambda item: item[1]["redemptions"], reverse=True)],
        "customer_context": customer_context,
        "eligible_categories": [{"category_name": name, "eligible_units": values["eligible_units"], "eligible_value": _float(values["eligible_value"])} for name, values in sorted(category_context.items(), key=lambda item: item[1]["eligible_value"], reverse=True)],
        "anomalies": {"non_paid_invoice": int(non_paid), "snapshot_reconciliation": int(inconsistent)},
    }


def _inventory_block(allowed_branch_ids: Sequence[int], filters: ReportFilters, page: int = 1, per_page: int = 20):
    stocks = (
        db.session.query(ProductBranchStock, Product, Branch)
        .join(Product, Product.id == ProductBranchStock.product_id)
        .join(Branch, Branch.id == ProductBranchStock.branch_id)
        .filter(ProductBranchStock.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False)
        .order_by(ProductBranchStock.stock_quantity.asc(), Product.name.asc()).all()
    )
    product_sales_rows = (
        db.session.query(Invoice.branch_id, InvoiceItem.product_id, func.coalesce(func.sum(InvoiceItem.quantity), 0))
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(
            Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            Invoice.status == InvoiceStatus.PAID,
            Invoice.invoice_date >= filters.date_from,
            Invoice.invoice_date <= filters.date_to,
            InvoiceItem.item_type == "PRODUCT_ITEM",
            InvoiceItem.product_id.isnot(None),
        ).group_by(Invoice.branch_id, InvoiceItem.product_id).all()
    )
    product_sales = {(branch_id, product_id): int(units or 0) for branch_id, product_id, units in product_sales_rows}
    high_cutoff = _high_selling_cutoff(product_sales)
    batch_total_rows = (
        db.session.query(BranchInventoryBatch.branch_id, BranchInventoryBatch.product_id, func.coalesce(func.sum(BranchInventoryBatch.remaining_quantity), 0))
        .filter(
            BranchInventoryBatch.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            BranchInventoryBatch.status != InventoryBatchStatus.ARCHIVED,
        ).group_by(BranchInventoryBatch.branch_id, BranchInventoryBatch.product_id).all()
    )
    batch_totals = {(branch_id, product_id): int(units or 0) for branch_id, product_id, units in batch_total_rows}
    items = []
    for stock, product, branch in stocks:
        quantity = int(stock.stock_quantity or 0)
        threshold = int(product.min_stock_threshold or 0)
        state = _stock_state(quantity, threshold)
        units_sold = int(product_sales.get((stock.branch_id, stock.product_id), 0) or 0)
        tracked_batch = int(batch_totals.get((stock.branch_id, stock.product_id), 0) or 0)
        items.append({
            "stock_id": stock.id, "branch_id": branch.id, "branch_name": branch.name,
            "product_id": product.id, "product_name": product.name, "category": product.category,
            "current_stock": quantity, "min_stock_threshold": threshold, "state": state,
            "is_available": bool(stock.is_available), "units_sold": units_sold,
            "slow_moving": quantity > 0 and units_sold <= PRODUCT_SLOW_MOVING_MAX_UNITS,
            "high_selling_stock_risk": high_cutoff > 0 and units_sold >= high_cutoff and state in {"LOW", "OUT", "NEGATIVE"},
            "tracked_batch_quantity": tracked_batch,
            "batch_mismatch": tracked_batch != quantity,
        })
    active_pairs = set(product_sales)
    stock_pairs = {(stock.branch_id, stock.product_id) for stock, _product, _branch in stocks}
    missing_stock_rows = len(active_pairs - stock_pairs)
    sale_missing_movement = (
        db.session.query(func.count(func.distinct(Invoice.id)))
        .join(InvoiceItem, InvoiceItem.invoice_id == Invoice.id)
        .filter(
            Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            Invoice.status == InvoiceStatus.PAID,
            Invoice.invoice_date >= filters.date_from,
            Invoice.invoice_date <= filters.date_to,
            InvoiceItem.item_type == "PRODUCT_ITEM",
            ~db.session.query(StockMovement.id).filter(
                StockMovement.invoice_id == Invoice.id,
                StockMovement.product_id == InvoiceItem.product_id,
                StockMovement.movement_type == StockMovementType.PRODUCT_SALE,
            ).exists(),
        ).scalar() or 0
    )
    movement_without_paid = (
        db.session.query(func.count(StockMovement.id))
        .outerjoin(Invoice, Invoice.id == StockMovement.invoice_id)
        .filter(
            StockMovement.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            StockMovement.movement_type == StockMovementType.PRODUCT_SALE,
            or_(Invoice.id.is_(None), Invoice.status != InvoiceStatus.PAID),
        ).scalar() or 0
    )
    return {
        "current_stock_units": sum(item["current_stock"] for item in items),
        "tracked_rows": len(items),
        "healthy": sum(1 for item in items if item["state"] == "HEALTHY"),
        "low": sum(1 for item in items if item["state"] == "LOW"),
        "out": sum(1 for item in items if item["state"] in {"OUT", "NEGATIVE"}),
        "negative": sum(1 for item in items if item["state"] == "NEGATIVE"),
        "unavailable": sum(1 for item in items if not item["is_available"]),
        "slow_moving": sum(1 for item in items if item["slow_moving"]),
        "high_selling_stock_risks": [item for item in items if item["high_selling_stock_risk"]][:10],
        "batch_mismatch_count": sum(1 for item in items if item["batch_mismatch"]),
        "reconciliation": {
            "paid_sales_without_movement": int(sale_missing_movement),
            "sale_movements_without_paid_invoice": int(movement_without_paid),
            "missing_stock_rows_with_activity": missing_stock_rows,
        },
        "high_selling_cutoff_units": high_cutoff,
        "slow_moving_max_units": PRODUCT_SLOW_MOVING_MAX_UNITS,
        "items": items[(page - 1) * per_page:page * per_page],
        "pagination": _pagination(page, per_page, len(items)),
    }


def _inventory_overview_context(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    stocks = (
        db.session.query(ProductBranchStock, Product, Branch)
        .join(Product, Product.id == ProductBranchStock.product_id)
        .join(Branch, Branch.id == ProductBranchStock.branch_id)
        .filter(ProductBranchStock.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False)
        .order_by(ProductBranchStock.stock_quantity.asc(), Product.name.asc()).all()
    )
    product_sales_rows = (
        db.session.query(Invoice.branch_id, InvoiceItem.product_id, func.coalesce(func.sum(InvoiceItem.quantity), 0))
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(
            Invoice.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            Invoice.status == InvoiceStatus.PAID,
            Invoice.invoice_date >= filters.date_from,
            Invoice.invoice_date <= filters.date_to,
            InvoiceItem.item_type == "PRODUCT_ITEM",
            InvoiceItem.product_id.isnot(None),
        ).group_by(Invoice.branch_id, InvoiceItem.product_id).all()
    )
    product_sales = {(branch_id, product_id): int(units or 0) for branch_id, product_id, units in product_sales_rows}
    high_cutoff = _high_selling_cutoff(product_sales)
    items = []
    for stock, product, branch in stocks:
        quantity = int(stock.stock_quantity or 0)
        threshold = int(product.min_stock_threshold or 0)
        state = _stock_state(quantity, threshold)
        units_sold = int(product_sales.get((stock.branch_id, stock.product_id), 0) or 0)
        items.append({
            "stock_id": stock.id,
            "branch_id": branch.id,
            "branch_name": branch.name,
            "product_id": product.id,
            "product_name": product.name,
            "category": product.category,
            "current_stock": quantity,
            "min_stock_threshold": threshold,
            "state": state,
            "is_available": bool(stock.is_available),
            "units_sold": units_sold,
            "slow_moving": quantity > 0 and units_sold <= PRODUCT_SLOW_MOVING_MAX_UNITS,
            "high_selling_stock_risk": high_cutoff > 0 and units_sold >= high_cutoff and state in {"LOW", "OUT", "NEGATIVE"},
            "tracked_batch_quantity": 0,
            "batch_mismatch": False,
        })
    return {
        "low": sum(1 for item in items if item["state"] == "LOW"),
        "out": sum(1 for item in items if item["state"] in {"OUT", "NEGATIVE"}),
        "negative": sum(1 for item in items if item["state"] == "NEGATIVE"),
        "high_selling_stock_risks": [item for item in items if item["high_selling_stock_risk"]][:3],
        "basis": "CURRENT_SNAPSHOT",
    }


def build_operations_overview_context(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    """Bounded current-state and appointment context for Executive Overview."""
    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "business_days": _business_day_overview_context(allowed_branch_ids),
        "appointments": _appointment_overview_context(allowed_branch_ids, filters),
        "inventory": _inventory_overview_context(allowed_branch_ids, filters),
    }


def _movement_block(allowed_branch_ids: Sequence[int], filters: ReportFilters, page: int = 1, per_page: int = 20):
    start_utc, end_utc = _timestamp_window(filters)
    conditions = [
        StockMovement.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        StockMovement.created_at >= start_utc,
        StockMovement.created_at <= end_utc,
    ]
    rows = db.session.query(StockMovement.movement_type, func.count(StockMovement.id), func.coalesce(func.sum(StockMovement.quantity), 0)).filter(*conditions).group_by(StockMovement.movement_type).all()
    recent = (
        StockMovement.query.options(joinedload(StockMovement.branch), joinedload(StockMovement.product), joinedload(StockMovement.employee))
        .filter(*conditions).order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
        .offset((page - 1) * per_page).limit(per_page).all()
    )
    total = StockMovement.query.filter(*conditions).count()
    return {
        "types": [{"type": row[0].value, "events": int(row[1]), "absolute_quantity": int(row[2] or 0)} for row in rows],
        "internal_consumption_units": sum(int(row[2] or 0) for row in rows if row[0] == StockMovementType.INTERNAL_CONSUMPTION),
        "adjustment_events": sum(int(row[1] or 0) for row in rows if row[0] == StockMovementType.STOCK_ADJUSTMENT),
        "adjustment_absolute_quantity": sum(int(row[2] or 0) for row in rows if row[0] == StockMovementType.STOCK_ADJUSTMENT),
        "adjustment_direction_available": False,
        "items": [{
            "movement_id": row.id, "date": _iso(row.created_at), "branch_name": row.branch.name if row.branch else f"#{row.branch_id}",
            "product_name": row.product.name if row.product else f"#{row.product_id}", "type": row.movement_type.value,
            "quantity": int(row.quantity), "actor_name": row.employee.full_name if row.employee else None,
            "invoice_id": row.invoice_id, "notes": row.notes,
        } for row in recent],
        "pagination": _pagination(page, per_page, total),
    }


def _supply_block(allowed_branch_ids: Sequence[int], filters: ReportFilters, page: int = 1, per_page: int = 20):
    start_utc, end_utc = _timestamp_window(filters)
    period_conditions = [
        StockSupplyRequest.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        StockSupplyRequest.created_at >= start_utc,
        StockSupplyRequest.created_at <= end_utc,
    ]
    requests = (
        StockSupplyRequest.query.options(joinedload(StockSupplyRequest.branch), joinedload(StockSupplyRequest.created_by_employee), joinedload(StockSupplyRequest.shipment), joinedload(StockSupplyRequest.items))
        .filter(*period_conditions).order_by(StockSupplyRequest.created_at.desc()).all()
    )
    sent_requests = (
        StockSupplyRequest.query.options(joinedload(StockSupplyRequest.shipment))
        .filter(
            StockSupplyRequest.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            StockSupplyRequest.sent_at >= start_utc,
            StockSupplyRequest.sent_at <= end_utc,
        ).all()
    )
    received_requests = (
        StockSupplyRequest.query.options(joinedload(StockSupplyRequest.shipment))
        .join(StockShipment, StockShipment.id == StockSupplyRequest.shipment_id)
        .filter(
            StockSupplyRequest.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            StockShipment.status == "RECEIVED",
            StockShipment.received_at >= start_utc,
            StockShipment.received_at <= end_utc,
        ).all()
    )
    current_pending = StockSupplyRequest.query.filter(
        StockSupplyRequest.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        StockSupplyRequest.status == "PENDING",
    ).count()
    oldest_pending = (
        StockSupplyRequest.query
        .filter(
            StockSupplyRequest.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
            StockSupplyRequest.status == "PENDING",
        )
        .order_by(StockSupplyRequest.created_at.asc(), StockSupplyRequest.id.asc()).first()
    )
    sent_durations, received_durations, total_durations = [], [], []
    for row in sent_requests:
        if row.sent_at:
            sent_durations.append(_hours_between(row.created_at, row.sent_at))
    for row in received_requests:
        if row.sent_at and row.shipment and row.shipment.received_at:
            received_durations.append(_hours_between(row.sent_at, row.shipment.received_at))
            total_durations.append(_hours_between(row.created_at, row.shipment.received_at))
    def avg(values):
        return round(sum(values) / len(values), 2) if values else None
    return {
        "created": len(requests),
        "current_pending": int(current_pending),
        "sent": len(sent_requests),
        "received": len(received_requests),
        "requested_units": sum(sum(int(item.requested_quantity or 0) for item in row.items) for row in requests),
        "final_units": sum(sum(int(item.final_quantity or 0) for item in row.items) for row in requests),
        "average_created_to_sent_hours": avg(sent_durations),
        "average_sent_to_received_hours": avg(received_durations),
        "average_created_to_received_hours": avg(total_durations),
        "oldest_pending": ({"request_id": oldest_pending.id, "request_ref": oldest_pending.request_ref, "created_at": _iso(oldest_pending.created_at)} if oldest_pending else None),
        "items": [{
            "request_id": row.id, "request_ref": row.request_ref, "branch_name": row.branch.name if row.branch else f"#{row.branch_id}",
            "status": row.status, "creator_name": row.created_by_employee.full_name if row.created_by_employee else "—",
            "created_at": _iso(row.created_at), "sent_at": _iso(row.sent_at),
            "shipment_id": row.shipment_id, "shipment_ref": row.shipment.shipment_ref if row.shipment else None,
            "requested_units": sum(int(item.requested_quantity or 0) for item in row.items),
            "final_units": sum(int(item.final_quantity or 0) for item in row.items),
        } for row in requests[(page - 1) * per_page:page * per_page]],
        "pagination": _pagination(page, per_page, len(requests)),
    }


def _shipment_block(allowed_branch_ids: Sequence[int], filters: ReportFilters, page: int = 1, per_page: int = 20):
    start_utc, end_utc = _timestamp_window(filters)
    outbound_scope = StockShipment.source_branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False
    inbound_scope = StockShipment.destination_branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False
    period_time = and_(StockShipment.created_at >= start_utc, StockShipment.created_at <= end_utc)
    shipments = (
        StockShipment.query.options(joinedload(StockShipment.source_branch), joinedload(StockShipment.destination_branch), joinedload(StockShipment.items))
        .filter(or_(outbound_scope, inbound_scope), period_time)
        .order_by(StockShipment.created_at.desc()).all()
    )
    received_shipments = (
        StockShipment.query.options(joinedload(StockShipment.items))
        .filter(
            or_(outbound_scope, inbound_scope),
            StockShipment.status == "RECEIVED",
            StockShipment.received_at >= start_utc,
            StockShipment.received_at <= end_utc,
        ).all()
    )
    current_transit = (
        StockShipment.query.options(joinedload(StockShipment.source_branch), joinedload(StockShipment.destination_branch), joinedload(StockShipment.items))
        .filter(or_(outbound_scope, inbound_scope), StockShipment.status == "IN_TRANSIT").all()
    )
    now = datetime.now(timezone.utc)
    received_transfer_durations = [
        _hours_between(row.created_at, row.received_at)
        for row in received_shipments if row.shipment_type == "OUTBOUND_TRANSFER" and row.received_at
    ]
    def units(row):
        return sum(int(item.quantity or 0) for item in row.items)
    return {
        "outbound_created": sum(1 for row in shipments if row.shipment_type == "OUTBOUND_TRANSFER" and row.source_branch_id in allowed_branch_ids),
        "outbound_units": sum(units(row) for row in shipments if row.shipment_type == "OUTBOUND_TRANSFER" and row.source_branch_id in allowed_branch_ids),
        "inbound_created": sum(1 for row in shipments if row.destination_branch_id in allowed_branch_ids),
        "inbound_units": sum(units(row) for row in shipments if row.destination_branch_id in allowed_branch_ids),
        "received": len(received_shipments),
        "received_units": sum(units(row) for row in received_shipments),
        "current_in_transit": len(current_transit),
        "average_receipt_duration_hours": round(sum(received_transfer_durations) / len(received_transfer_durations), 2) if received_transfer_durations else None,
        "in_transit": [{
            "shipment_id": row.id, "shipment_ref": row.shipment_ref,
            "source_name": row.source_branch.name if row.source_branch else None,
            "destination_name": row.destination_branch.name if row.destination_branch else f"#{row.destination_branch_id}",
            "units": units(row), "created_at": _iso(row.created_at),
            "age_days": round(_hours_between(row.created_at, now) / 24, 1),
        } for row in current_transit],
        "items": [{
            "shipment_id": row.id, "shipment_ref": row.shipment_ref, "shipment_type": row.shipment_type,
            "status": row.status, "source_name": row.source_branch.name if row.source_branch else None,
            "destination_name": row.destination_branch.name if row.destination_branch else f"#{row.destination_branch_id}",
            "units": units(row), "created_at": _iso(row.created_at), "received_at": _iso(row.received_at),
            "cancelled_at": _iso(row.cancelled_at), "cancellation_reason": row.cancellation_reason,
            "duration_hours": round(_hours_between(row.created_at, row.received_at), 2) if row.received_at else None,
        } for row in shipments[(page - 1) * per_page:page * per_page]],
        "pagination": _pagination(page, per_page, len(shipments)),
    }


def _return_block(allowed_branch_ids: Sequence[int], filters: ReportFilters, page: int = 1, per_page: int = 20):
    start_utc, end_utc = _timestamp_window(filters)
    conditions = [
        StockReturnRequest.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        StockReturnRequest.created_at >= start_utc,
        StockReturnRequest.created_at <= end_utc,
    ]
    rows = (
        StockReturnRequest.query.options(joinedload(StockReturnRequest.branch), joinedload(StockReturnRequest.product), joinedload(StockReturnRequest.created_by_employee), joinedload(StockReturnRequest.resolved_by_user))
        .filter(*conditions).order_by(StockReturnRequest.created_at.desc()).all()
    )
    resolved_rows = StockReturnRequest.query.filter(
        StockReturnRequest.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        StockReturnRequest.resolved_at >= start_utc,
        StockReturnRequest.resolved_at <= end_utc,
    ).all()
    current_pending = StockReturnRequest.query.filter(
        StockReturnRequest.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        StockReturnRequest.status == "PENDING",
    ).count()
    resolved_durations = [_hours_between(row.created_at, row.resolved_at) for row in resolved_rows if row.resolved_at]
    reason_mix = defaultdict(lambda: {"requests": 0, "units": 0})
    for row in rows:
        reason_mix[row.reason]["requests"] += 1
        reason_mix[row.reason]["units"] += int(row.requested_quantity or 0)
    return {
        "current_pending": int(current_pending),
        "returned_to_main": sum(1 for row in resolved_rows if row.status == "RETURNED_TO_MAIN"),
        "returned_to_supplier": sum(1 for row in resolved_rows if row.status == "RETURNED_TO_SUPPLIER"),
        "rejected": sum(1 for row in resolved_rows if row.status == "REJECTED"),
        "returned_units": sum(int(row.requested_quantity or 0) for row in resolved_rows if row.status in {"RETURNED_TO_MAIN", "RETURNED_TO_SUPPLIER"}),
        "average_resolution_hours": round(sum(resolved_durations) / len(resolved_durations), 2) if resolved_durations else None,
        "reason_mix": [{"reason": reason, **values} for reason, values in reason_mix.items()],
        "items": [{
            "return_id": row.id, "return_ref": row.return_ref, "branch_name": row.branch.name if row.branch else f"#{row.branch_id}",
            "product_name": row.product.name if row.product else f"#{row.product_id}", "quantity": int(row.requested_quantity),
            "reason": row.reason, "status": row.status, "creator_name": row.created_by_employee.full_name if row.created_by_employee else "—",
            "resolver_name": row.resolved_by_user.full_name if row.resolved_by_user else None,
            "created_at": _iso(row.created_at), "resolved_at": _iso(row.resolved_at),
            "duration_hours": round(_hours_between(row.created_at, row.resolved_at), 2) if row.resolved_at else None,
        } for row in rows[(page - 1) * per_page:page * per_page]],
        "pagination": _pagination(page, per_page, len(rows)),
    }


def _period_summary(allowed_branch_ids: Sequence[int], filters: ReportFilters, pages=None, per_page: int = 20):
    pages = pages or {}
    attendance = _attendance_block(allowed_branch_ids, filters)
    appointments = _appointment_block(allowed_branch_ids, filters, pages.get("appointments", 1), per_page)
    deposits = _deposit_block(allowed_branch_ids, filters)
    promo = _promo_block(allowed_branch_ids, filters)
    movements = _movement_block(allowed_branch_ids, filters, pages.get("movements", 1), per_page)
    supply = _supply_block(allowed_branch_ids, filters, pages.get("supply", 1), per_page)
    return {
        "attendance": attendance,
        "appointments": appointments,
        "deposits": deposits,
        "promo": promo,
        "movements": movements,
        "supply": supply,
    }


def _attention(attendance, appointments, business_days, inventory, supply, shipments):
    items = []
    if business_days["old_open"]:
        items.append({"code": "OLD_OPEN_BUSINESS_DAY", "label": "يوم عمل مفتوح من تاريخ سابق", "detail": f"يوجد {business_days['old_open']} يوم عمل مفتوح بدأ قبل تاريخ القاهرة الحالي.", "tone": "attention"})
    if attendance["controls"]["present_on_closed_day"]:
        items.append({"code": "PRESENT_ON_CLOSED_DAY", "label": "حضور مفتوح على يوم مغلق", "detail": f"يوجد {attendance['controls']['present_on_closed_day']} سجل حضور مفتوح مرتبط بيوم عمل مغلق.", "tone": "attention"})
    if attendance["controls"]["repeated_corrections"]:
        items.append({"code": "REPEATED_ATTENDANCE_CORRECTIONS", "label": "تصحيحات حضور متكررة", "detail": f"ينطبق حد المراجعة المعلن على {len(attendance['controls']['repeated_corrections'])} موظف. هذا لا يحدد مسؤولية الموظف.", "tone": "neutral"})
    if appointments["past_still_scheduled"]:
        items.append({"code": "PAST_STILL_SCHEDULED", "label": "مواعيد سابقة بحاجة لمراجعة الحالة", "detail": f"يوجد {appointments['past_still_scheduled']} موعد سابق ما زال مجدولًا.", "tone": "neutral"})
    if inventory["negative"]:
        items.append({"code": "NEGATIVE_STOCK", "label": "مخزون حالي سالب", "detail": f"يوجد {inventory['negative']} سجل منتج وفرع بكمية سالبة.", "tone": "attention"})
    if len(items) < 5 and inventory["high_selling_stock_risks"]:
        row = inventory["high_selling_stock_risks"][0]
        items.append({"code": "HIGH_SELLING_CURRENT_STOCK_RISK", "entity_id": row["product_id"], "label": "منتج متصدر منخفض حاليًا", "detail": f"{row['product_name']} من المنتجات الأعلى بيعًا في الفترة ومخزونه الحالي {row['state']} في {row['branch_name']}.", "tone": "neutral"})
    if len(items) < 5 and supply["current_pending"]:
        oldest = supply.get("oldest_pending")
        if oldest:
            items.append({"code": "AGED_PENDING_REQUEST", "entity_id": oldest["request_id"], "label": "طلب إمداد ما زال معلقًا", "detail": f"الطلب {oldest['request_ref']} ما زال معلقًا منذ {oldest['created_at'][:10]}.", "tone": "neutral"})
    if len(items) < 5 and shipments["in_transit"]:
        oldest = max(shipments["in_transit"], key=lambda row: row["age_days"])
        items.append({"code": "AGED_IN_TRANSIT", "entity_id": oldest["shipment_id"], "label": "شحنة قيد النقل", "detail": f"{oldest['shipment_ref']} قيد النقل منذ {oldest['age_days']} يومًا.", "tone": "neutral"})
    return items[:5]


def build_operations_report(allowed_branch_ids: Sequence[int], filters: ReportFilters, pages=None, per_page: int = 20):
    pages = pages or {}
    current = _period_summary(allowed_branch_ids, filters, pages, per_page)
    previous_filters = _previous_filters(filters)
    previous = _period_summary(allowed_branch_ids, previous_filters)
    business_days = _business_day_block(allowed_branch_ids, filters, pages.get("business_days", 1), per_page)
    inventory = _inventory_block(allowed_branch_ids, filters, pages.get("inventory", 1), per_page)
    shipments = _shipment_block(allowed_branch_ids, filters, pages.get("shipments", 1), per_page)
    returns = _return_block(allowed_branch_ids, filters, pages.get("returns", 1), per_page)
    attendance = current["attendance"]
    appointments = current["appointments"]
    deposits = current["deposits"]
    comparison = {
        "completed_sessions": _comparison(attendance["completed_sessions"], previous["attendance"]["completed_sessions"]),
        "recorded_hours": _comparison(attendance["recorded_hours"], previous["attendance"]["recorded_hours"]),
        "appointment_count": _comparison(appointments["count"], previous["appointments"]["count"]),
        "deposit_collection_count": _comparison(deposits["collection_count"], previous["deposits"]["collection_count"]),
        "deposit_collection_amount": _comparison(deposits["collection_amount"], previous["deposits"]["collection_amount"]),
        "promo_redemptions": _comparison(current["promo"]["redemption_count"], previous["promo"]["redemption_count"]),
        "internal_consumption_units": _comparison(current["movements"]["internal_consumption_units"], previous["movements"]["internal_consumption_units"]),
        "supply_requests_created": _comparison(current["supply"]["created"], previous["supply"]["created"]),
    }
    return {
        "meta": {
            "date_from": filters.date_from.isoformat(), "date_to": filters.date_to.isoformat(),
            "previous_date_from": previous_filters.date_from.isoformat(), "previous_date_to": previous_filters.date_to.isoformat(),
            "attendance_date_basis": "Attendance.date", "appointment_date_basis": "Appointment.appointment_date",
            "timestamp_timezone": "Africa/Cairo", "inventory_basis": "CURRENT_SNAPSHOT",
            "appointment_status_basis": "CURRENT_STORED_STATUS", "deposit_basis": "COLLECTION_ONLY",
        },
        "summary": {
            "completed_sessions": attendance["completed_sessions"], "recorded_hours": attendance["recorded_hours"],
            "appointment_count": appointments["count"], "appointment_completion_share": appointments["completed_share"],
            "deposit_collection_count": deposits["collection_count"], "deposit_collection_amount": deposits["collection_amount"],
            "old_open_business_days": business_days["old_open"], "current_low_stock_products": inventory["low"],
            "current_out_of_stock_products": inventory["out"],
        },
        "comparison": comparison,
        "attendance": attendance, "business_days": business_days, "appointments": appointments,
        "deposits": deposits, "promo": current["promo"], "inventory": inventory,
        "movements": current["movements"], "supply": current["supply"], "shipments": shipments, "returns": returns,
        "attention": _attention(attendance, appointments, business_days, inventory, current["supply"], shipments),
    }


def build_operations_drilldown(allowed_branch_ids: Sequence[int], filters: ReportFilters, entity_type: str, entity_id: int):
    if entity_type == "business-day":
        # The selected row may come from any server-side page.
        report = _business_day_block(allowed_branch_ids, filters, page=1, per_page=1_000_000)
        return next((row for row in report["items"] if row["business_day_id"] == entity_id), None)
    if entity_type == "appointment":
        row = Appointment.query.options(joinedload(Appointment.branch), joinedload(Appointment.customer), joinedload(Appointment.barber), joinedload(Appointment.service)).filter(
            Appointment.id == entity_id,
            Appointment.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        ).first()
        if not row:
            return None
        deposits = AppointmentDepositTransaction.query.options(joinedload(AppointmentDepositTransaction.cashier)).filter_by(
            appointment_id=row.id,
            transaction_type=AppointmentDepositTransactionType.DEPOSIT_COLLECTION,
        ).order_by(AppointmentDepositTransaction.created_at.asc()).all()
        return {
            "appointment_id": row.id, "branch_name": row.branch.name if row.branch else f"#{row.branch_id}",
            "customer_name": row.customer.full_name if row.customer else "—", "barber_name": row.barber.full_name if row.barber else None,
            "service_name": row.service_name or (row.service.name if row.service else None), "status": row.status.value,
            "date": row.appointment_date.isoformat(), "time": row.appointment_time.isoformat(timespec="minutes"),
            "deposit_amount": int(row.deposit_amount or 0),
            "collections": [{"transaction_id": item.id, "amount": int(item.amount), "method": item.payment_method.value, "cashier_name": item.cashier.full_name if item.cashier else "—", "created_at": _iso(item.created_at), "business_day_id": item.business_day_id} for item in deposits],
        }
    if entity_type == "inventory":
        row = db.session.query(ProductBranchStock, Product, Branch).join(Product, Product.id == ProductBranchStock.product_id).join(Branch, Branch.id == ProductBranchStock.branch_id).filter(
            ProductBranchStock.id == entity_id,
            ProductBranchStock.branch_id.in_(allowed_branch_ids) if allowed_branch_ids else False,
        ).first()
        if not row:
            return None
        stock, product, branch = row
        start_utc, end_utc = _timestamp_window(filters)
        movements = StockMovement.query.filter(StockMovement.product_id == product.id, StockMovement.branch_id == branch.id, StockMovement.created_at >= start_utc, StockMovement.created_at <= end_utc).order_by(StockMovement.created_at.desc()).limit(30).all()
        return {"product_id": product.id, "product_name": product.name, "branch_id": branch.id, "branch_name": branch.name, "current_stock": int(stock.stock_quantity), "min_stock_threshold": int(product.min_stock_threshold), "is_available": bool(stock.is_available), "movements": [{"movement_id": item.id, "type": item.movement_type.value, "quantity": int(item.quantity), "created_at": _iso(item.created_at), "notes": item.notes} for item in movements]}
    if entity_type == "supply-request":
        row = StockSupplyRequest.query.options(
            joinedload(StockSupplyRequest.items).joinedload(StockSupplyRequestItem.product),
            joinedload(StockSupplyRequest.shipment),
        ).filter(StockSupplyRequest.id == entity_id).first()
    elif entity_type == "shipment":
        row = StockShipment.query.options(
            joinedload(StockShipment.items).joinedload(StockShipmentItem.product),
            joinedload(StockShipment.source_branch),
            joinedload(StockShipment.destination_branch),
        ).filter(StockShipment.id == entity_id).first()
    elif entity_type == "return":
        row = StockReturnRequest.query.options(
            joinedload(StockReturnRequest.product),
            joinedload(StockReturnRequest.branch),
            joinedload(StockReturnRequest.created_by_employee),
            joinedload(StockReturnRequest.resolved_by_user),
        ).filter(StockReturnRequest.id == entity_id).first()
    else:
        return None
    if not row:
        return None
    branch_ids = set(allowed_branch_ids)
    if entity_type == "supply-request" and row.branch_id not in branch_ids:
        return None
    if entity_type == "shipment" and row.source_branch_id not in branch_ids and row.destination_branch_id not in branch_ids:
        return None
    if entity_type == "return" and row.branch_id not in branch_ids:
        return None
    if entity_type == "supply-request":
        return {"request_id": row.id, "request_ref": row.request_ref, "status": row.status, "branch_id": row.branch_id, "created_at": _iso(row.created_at), "sent_at": _iso(row.sent_at), "shipment_id": row.shipment_id, "items": [{"product_id": item.product_id, "product_name": item.product.name if item.product else f"#{item.product_id}", "requested_quantity": int(item.requested_quantity), "final_quantity": int(item.final_quantity) if item.final_quantity is not None else None} for item in row.items]}
    if entity_type == "shipment":
        return {"shipment_id": row.id, "shipment_ref": row.shipment_ref, "shipment_type": row.shipment_type, "status": row.status, "source_branch_id": row.source_branch_id, "destination_branch_id": row.destination_branch_id, "created_at": _iso(row.created_at), "received_at": _iso(row.received_at), "cancelled_at": _iso(row.cancelled_at), "cancellation_reason": row.cancellation_reason, "items": [{"product_id": item.product_id, "product_name": item.product.name if item.product else f"#{item.product_id}", "quantity": int(item.quantity)} for item in row.items]}
    return {"return_id": row.id, "return_ref": row.return_ref, "branch_id": row.branch_id, "product_id": row.product_id, "product_name": row.product.name if row.product else f"#{row.product_id}", "quantity": int(row.requested_quantity), "reason": row.reason, "status": row.status, "created_at": _iso(row.created_at), "resolved_at": _iso(row.resolved_at), "resolution_note": row.resolution_note}
