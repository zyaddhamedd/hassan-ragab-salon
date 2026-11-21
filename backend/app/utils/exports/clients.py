from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Iterable, Optional, Sequence

from sqlalchemy import case, false, func, or_

from app.extensions import db
from app.models.branch import Branch
from app.models.customer import Customer
from app.models.employee import Employee
from app.models.invoice import Invoice, InvoiceStatus
from app.utils.date_utils import CAIRO_TZ
from app.utils.exports.filenames import build_export_filename


CLIENT_EXPORT_COLUMNS = {
    "name": {"header": "Name", "width": 26},
    "phone": {"header": "Phone", "width": 18},
    "visits_count": {"header": "Visits Count", "width": 14},
    "total_spending": {"header": "Total Spending", "width": 18},
    "last_barber": {"header": "Last Barber", "width": 22},
    "last_visit_date": {"header": "Last Visit Date", "width": 18},
    "branch": {"header": "Branch", "width": 20},
    "customer_since": {"header": "Customer Since", "width": 18},
}

DEFAULT_CLIENT_EXPORT_COLUMN_IDS = list(CLIENT_EXPORT_COLUMNS.keys())


def normalize_customer_search(raw_search) -> str:
    return str(raw_search or "").strip()


def parse_starred_only(raw_value) -> bool:
    if raw_value is None:
        return False
    return str(raw_value).strip().lower() in {"1", "true", "yes", "on"}


def normalize_client_export_columns(raw_columns) -> list[str]:
    if not isinstance(raw_columns, list):
        return DEFAULT_CLIENT_EXPORT_COLUMN_IDS.copy()

    normalized: list[str] = []
    for column_id in raw_columns:
        if column_id in CLIENT_EXPORT_COLUMNS and column_id not in normalized:
            normalized.append(column_id)

    return normalized or DEFAULT_CLIENT_EXPORT_COLUMN_IDS.copy()


def build_customer_filter_conditions(
    allowed_branch_ids: Sequence[int],
    *,
    search: str = "",
    starred_only: bool = False,
):
    conditions = [Customer.branch_id.in_(allowed_branch_ids)]

    normalized_search = normalize_customer_search(search)
    if normalized_search:
        conditions.append(
            or_(
                Customer.full_name.ilike(f"%{normalized_search}%"),
                Customer.phone.ilike(f"%{normalized_search}%"),
            )
        )

    if starred_only:
        # Star persistence is not implemented in the current Admin system.
        # The existing Clients page therefore resolves "Starred Only" to an
        # empty dataset. Returning no rows here keeps exports aligned with the
        # page the user currently sees while leaving the API contract ready for
        # future starred-client storage.
        conditions.append(false())

    return conditions


def build_customer_stats_subquery(allowed_branch_ids: Sequence[int]):
    return (
        db.session.query(
            Invoice.customer_id.label("customer_id"),
            func.count(Invoice.id).label("visits_count"),
            func.max(Invoice.paid_at).label("last_visit"),
            func.sum(Invoice.total_amount).label("total_spend"),
        )
        .filter(
            Invoice.status == InvoiceStatus.PAID,
            Invoice.customer_id.isnot(None),
            Invoice.branch_id.in_(allowed_branch_ids),
        )
        .group_by(Invoice.customer_id)
        .subquery()
    )


def build_customer_recent_activity_ordering(stats_subquery):
    return (
        case((stats_subquery.c.last_visit.is_(None), 1), else_=0).asc(),
        stats_subquery.c.last_visit.desc(),
        Customer.created_at.desc(),
        Customer.id.desc(),
    )


def build_client_export_query(
    allowed_branch_ids: Sequence[int],
    *,
    search: str = "",
    starred_only: bool = False,
):
    stats_subquery = build_customer_stats_subquery(allowed_branch_ids)
    conditions = build_customer_filter_conditions(
        allowed_branch_ids,
        search=search,
        starred_only=starred_only,
    )

    return (
        db.session.query(
            Customer.full_name.label("full_name"),
            Customer.phone.label("phone"),
            Customer.created_at.label("customer_since"),
            Branch.name.label("branch_name"),
            Employee.full_name.label("last_barber_name"),
            func.coalesce(stats_subquery.c.visits_count, 0).label("visits_count"),
            func.coalesce(stats_subquery.c.total_spend, 0).label("total_spend"),
            stats_subquery.c.last_visit.label("last_visit"),
        )
        .join(Branch, Branch.id == Customer.branch_id)
        .outerjoin(Employee, Employee.id == Customer.last_barber_id)
        .outerjoin(stats_subquery, stats_subquery.c.customer_id == Customer.id)
        .filter(*conditions)
        .order_by(*build_customer_recent_activity_ordering(stats_subquery))
    )


def build_clients_export_filename(
    *,
    requested_branch,
    allowed_branch_ids: Sequence[int],
    search: str = "",
    starred_only: bool = False,
    exported_on: Optional[date] = None,
) -> str:
    qualifiers = [_resolve_clients_scope_label(requested_branch, allowed_branch_ids)]

    normalized_search = normalize_customer_search(search)
    if normalized_search:
        qualifiers.append(f"Search {normalized_search[:24]}")

    if starred_only:
        qualifiers.append("Starred")

    return build_export_filename(
        "Clients",
        extension="xlsx",
        qualifiers=qualifiers,
        exported_on=exported_on,
    )


def build_client_export_rows(records: Iterable, column_ids: Sequence[str]) -> Iterable[list[str]]:
    for record in records:
        values_by_column = {
            "name": record.full_name or "",
            "phone": record.phone or "",
            "visits_count": str(int(record.visits_count or 0)),
            "total_spending": format_export_currency(record.total_spend),
            "last_barber": record.last_barber_name or "",
            "last_visit_date": format_export_date(record.last_visit),
            "branch": record.branch_name or "",
            "customer_since": format_export_date(record.customer_since),
        }
        yield [values_by_column[column_id] for column_id in column_ids]


def format_export_currency(value) -> str:
    if value is None:
        return ""

    amount = Decimal(str(value))
    return f"{amount:,.2f} ج.م"


def format_export_date(value) -> str:
    if value is None:
        return ""

    if isinstance(value, date) and not isinstance(value, datetime):
        return value.strftime("%b %d, %Y")

    dt = value
    if getattr(dt, "tzinfo", None) is not None:
        dt = dt.astimezone(CAIRO_TZ)

    return dt.strftime("%b %d, %Y")


def _resolve_clients_scope_label(requested_branch, allowed_branch_ids: Sequence[int]) -> str:
    if requested_branch and str(requested_branch).lower() != "all":
        branch = Branch.query.filter(Branch.id == int(requested_branch)).first()
        return branch.name if branch else f"Branch_{requested_branch}"

    if len(allowed_branch_ids) == 1:
        branch = Branch.query.filter(Branch.id == allowed_branch_ids[0]).first()
        if branch:
            return branch.name

    return "All"
