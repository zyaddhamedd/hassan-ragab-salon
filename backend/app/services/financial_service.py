"""
app/services/financial_service.py

Unified financial calculation service.

All functions accept Cairo-boundary dates and internally convert them to
UTC-aware datetimes before filtering TIMESTAMPTZ columns, eliminating the
naive-datetime edge case at Cairo midnight.

Public API
----------
cairo_day_window(start_date, end_date)
    -> (start_utc, end_utc) for TIMESTAMPTZ comparisons

calculate_revenue(start_date, end_date, branch_id=None)
    -> float

calculate_commissions(start_date, end_date, branch_id=None)
    -> float

calculate_expenses(start_date, end_date, branch_id=None)
    -> float

calculate_net_profit(start_date, end_date, branch_id=None)
    -> float  (revenue - commissions - expenses)

calculate_invoice_count(start_date, end_date, branch_id=None)
    -> int

calculate_services_count(start_date, end_date, branch_id=None)
    -> int

calculate_revenue_by_branch(start_date, end_date, branch_ids=None)
    -> dict {branch_id: {"revenue": float, "invoice_count": int}}

calculate_commissions_by_branch(start_date, end_date, branch_ids=None)
    -> dict {branch_id: float}

calculate_expenses_by_branch(start_date, end_date, branch_ids=None)
    -> dict {branch_id: float}

calculate_daily_revenue(start_date, end_date, branch_id=None)
    -> list[{"date": str, "revenue": float, "commissions": float, "expenses": float}]
"""

from datetime import datetime, date, timezone, timedelta, time
from typing import Optional

from sqlalchemy import func, case

from app.extensions import db
from app.utils.date_utils import CAIRO_TZ

# ---------------------------------------------------------------------------
# Payroll category codes — excluded from operating-expense aggregation.
# These represent employee payroll actions (advances, deductions, commission
# payouts, overtime) that are NOT true operating costs.  They exist in the
# Expense table only because of the dual-write pattern and must not reduce
# the operating net-profit figure.
# ---------------------------------------------------------------------------
PAYROLL_CATEGORY_CODES = ('ADVANCE', 'DISCOUNT', 'OVERTIME', 'DAILY_PERCENTAGE')


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _lazy_imports():
    """Deferred import to avoid circular import at module load time."""
    from app.models.invoice import Invoice, InvoiceItem, InvoiceStatus
    from app.models.expense import Expense
    return Invoice, InvoiceItem, InvoiceStatus, Expense


def cairo_day_window(start_date: date, end_date: date):
    """
    Convert a Cairo calendar date window into UTC-aware datetimes suitable
    for filtering TIMESTAMPTZ (paid_at, created_at) columns.

    Cairo midnight 00:00 on start_date  → UTC
    Cairo          23:59:59 on end_date → UTC

    Returns:
        (start_utc: datetime, end_utc: datetime)  — both tz-aware (UTC)
    """
    start_cairo = datetime(
        start_date.year, start_date.month, start_date.day,
        0, 0, 0, tzinfo=CAIRO_TZ
    )
    end_cairo = datetime(
        end_date.year, end_date.month, end_date.day,
        23, 59, 59, 999999, tzinfo=CAIRO_TZ
    )
    return (
        start_cairo.astimezone(timezone.utc),
        end_cairo.astimezone(timezone.utc)
    )


def _commission_expr(InvoiceItem):
    """
    SQLAlchemy column expression for a single invoice item's total commission.
    Barber commission is always included; assistant commission only when
    assistant_id IS NOT NULL.
    """
    return (
        InvoiceItem.service_price * InvoiceItem.barber_commission_percent / 100.0
    ) + case(
        (InvoiceItem.assistant_id != None,
         InvoiceItem.service_price * InvoiceItem.assistant_commission_percent / 100.0),
        else_=0.0
    )


# ---------------------------------------------------------------------------
# Scalar aggregation functions
# ---------------------------------------------------------------------------

def calculate_revenue(
    start_date: date,
    end_date: date,
    branch_id: Optional[int] = None
) -> float:
    """Total revenue from PAID invoices within the Cairo date window."""
    Invoice, _, InvoiceStatus, _ = _lazy_imports()
    start_utc, end_utc = cairo_day_window(start_date, end_date)

    # Use NET revenue (after discount) instead of gross total_amount
    q = db.session.query(
        func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0))
    ).filter(
        Invoice.status == InvoiceStatus.PAID,
        Invoice.paid_at >= start_utc,
        Invoice.paid_at <= end_utc
    )
    if branch_id is not None:
        q = q.filter(Invoice.branch_id == branch_id)
    return float(q.scalar() or 0.0)


def calculate_commissions(
    start_date: date,
    end_date: date,
    branch_id: Optional[int] = None
) -> float:
    """
    Total commissions (barber + assistant) from PAID invoices within the
    Cairo date window.
    """
    Invoice, InvoiceItem, InvoiceStatus, _ = _lazy_imports()
    start_utc, end_utc = cairo_day_window(start_date, end_date)

    q = db.session.query(
        func.sum(_commission_expr(InvoiceItem))
    ).join(Invoice, Invoice.id == InvoiceItem.invoice_id).filter(
        Invoice.status == InvoiceStatus.PAID,
        Invoice.paid_at >= start_utc,
        Invoice.paid_at <= end_utc,
        InvoiceItem.item_type == 'SERVICE_ITEM'
    )
    if branch_id is not None:
        q = q.filter(Invoice.branch_id == branch_id)
    return float(q.scalar() or 0.0)


def calculate_expenses(
    start_date: date,
    end_date: date,
    branch_id: Optional[int] = None
) -> float:
    """
    Total OPERATING expenses within the bare-date window.

    Payroll-category expenses (ADVANCE, DISCOUNT, OVERTIME, DAILY_PERCENTAGE)
    are excluded so that employee financial actions do not distort the
    operating net-profit figure.
    """
    _, _, _, Expense = _lazy_imports()
    from app.models.expense_category import ExpenseCategory

    q = (
        db.session.query(func.sum(Expense.amount))
        .join(ExpenseCategory, ExpenseCategory.id == Expense.expense_category_id)
        .filter(
            Expense.expense_date >= start_date,
            Expense.expense_date <= end_date,
            ~ExpenseCategory.code.in_(PAYROLL_CATEGORY_CODES),
            Expense.is_business_expense == True  # Exclude TIP (is_business_expense=False)
        )
    )
    if branch_id is not None:
        q = q.filter(Expense.branch_id == branch_id)
    return float(q.scalar() or 0.0)


def calculate_cash_out(
    start_date: date,
    end_date: date,
    branch_id: Optional[int] = None
) -> 'Decimal':
    """
    Total cash that physically left the register within the bare-date window.

    Filters Expense rows where is_cash_event == True, regardless of category.
    This intentionally includes payroll cash events (advances, commission
    payouts) because those amounts DO leave the physical register even though
    they are excluded from the operating net-profit calculation.

    Use this function for treasury CASH account reconciliation — it represents
    the true register OUT-flow for the period.

    Returns:
        Decimal — sum of all cash-event expenses; Decimal('0.00') when empty.
    """
    from decimal import Decimal
    _, _, _, Expense = _lazy_imports()

    q = (
        db.session.query(func.sum(Expense.amount))
        .filter(
            Expense.expense_date >= start_date,
            Expense.expense_date <= end_date,
            Expense.is_cash_event == True          # noqa: E712 — SQLAlchemy requires ==
        )
    )
    if branch_id is not None:
        q = q.filter(Expense.branch_id == branch_id)

    raw = q.scalar()
    return Decimal(str(raw)) if raw is not None else Decimal('0.00')


def calculate_net_profit(
    start_date: date,
    end_date: date,
    branch_id: Optional[int] = None
) -> float:
    """Net profit = (Revenue − Commissions) − Expenses."""
    revenue = calculate_revenue(start_date, end_date, branch_id)
    commissions = calculate_commissions(start_date, end_date, branch_id)
    expenses = calculate_expenses(start_date, end_date, branch_id)
    return (revenue - commissions) - expenses


def calculate_invoice_count(
    start_date: date,
    end_date: date,
    branch_id: Optional[int] = None
) -> int:
    """Count of PAID invoices within the Cairo date window."""
    Invoice, _, InvoiceStatus, _ = _lazy_imports()
    start_utc, end_utc = cairo_day_window(start_date, end_date)

    q = db.session.query(func.count(Invoice.id)).filter(
        Invoice.status == InvoiceStatus.PAID,
        Invoice.paid_at >= start_utc,
        Invoice.paid_at <= end_utc
    )
    if branch_id is not None:
        q = q.filter(Invoice.branch_id == branch_id)
    return int(q.scalar() or 0)


def calculate_services_count(
    start_date: date,
    end_date: date,
    branch_id: Optional[int] = None
) -> int:
    """Sum of InvoiceItem.quantity for PAID invoices within the window."""
    Invoice, InvoiceItem, InvoiceStatus, _ = _lazy_imports()
    start_utc, end_utc = cairo_day_window(start_date, end_date)

    q = db.session.query(func.sum(InvoiceItem.quantity)
    ).join(Invoice, Invoice.id == InvoiceItem.invoice_id).filter(
        Invoice.status == InvoiceStatus.PAID,
        Invoice.paid_at >= start_utc,
        Invoice.paid_at <= end_utc
    )
    if branch_id is not None:
        q = q.filter(Invoice.branch_id == branch_id)
    return int(q.scalar() or 0)


# ---------------------------------------------------------------------------
# Grouped aggregation functions (single query, GROUP BY branch_id)
# ---------------------------------------------------------------------------

def calculate_revenue_by_branch(
    start_date: date,
    end_date: date,
    branch_ids: Optional[list] = None
) -> dict:
    """
    Returns {branch_id: {"revenue": float, "invoice_count": int}}
    Single query with GROUP BY branch_id — no N+1.
    """
    Invoice, _, InvoiceStatus, _ = _lazy_imports()
    start_utc, end_utc = cairo_day_window(start_date, end_date)

    # Use NET revenue (after discount) instead of gross total_amount
    q = db.session.query(
        Invoice.branch_id,
        func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)).label('rev'),
        func.count(Invoice.id).label('cnt')
    ).filter(
        Invoice.status == InvoiceStatus.PAID,
        Invoice.paid_at >= start_utc,
        Invoice.paid_at <= end_utc
    )
    if branch_ids:
        q = q.filter(Invoice.branch_id.in_(branch_ids))

    rows = q.group_by(Invoice.branch_id).all()
    return {
        r.branch_id: {
            "revenue": float(r.rev or 0.0),
            "invoice_count": int(r.cnt or 0)
        }
        for r in rows
    }


def calculate_revenue_by_payment_method(
    start_date: date,
    end_date: date,
    branch_id: Optional[int] = None
) -> dict:
    """
    Revenue breakdown by payment method for PAID invoices within the Cairo
    date window.

    Mirrors calculate_revenue() exactly (same paid_at UTC filter, same
    InvoiceStatus.PAID guard, same cairo_day_window conversion) but groups
    by Invoice.payment_method instead of returning a scalar sum.

    Returns:
        {
            "CASH":      Decimal — total revenue collected in cash,
            "VISA":      Decimal — total revenue collected by card,
            "INSTAPAY":  Decimal — total revenue collected via InstaPay,
        }

    All three keys are always present; missing methods default to
    Decimal('0.00') so callers never need to guard against KeyError.
    Treasury can use CASH directly as the register IN-flow for the period.
    """
    from app.services.booking_deposit_service import has_application
    from app.models.invoice import InvoicePayment
    from decimal import Decimal
    Invoice, _, InvoiceStatus, _ = _lazy_imports()
    start_utc, end_utc = cairo_day_window(start_date, end_date)

    # Use NET revenue (after discount) instead of gross total_amount
    q = db.session.query(
        Invoice.payment_method,
        func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)).label('rev')
    ).filter(
        Invoice.status == InvoiceStatus.PAID,
        Invoice.paid_at >= start_utc,
        Invoice.paid_at <= end_utc,
        ~has_application(Invoice.id)
    )
    if branch_id is not None:
        q = q.filter(Invoice.branch_id == branch_id)

    rows = q.group_by(Invoice.payment_method).all()

    deposit_query = db.session.query(InvoicePayment.method.label("payment_method"), func.sum(InvoicePayment.amount).label('rev')).join(
        Invoice, Invoice.id == InvoicePayment.invoice_id).filter(
            Invoice.status == InvoiceStatus.PAID, Invoice.paid_at >= start_utc, Invoice.paid_at <= end_utc,
            has_application(Invoice.id))
    if branch_id is not None:
        deposit_query = deposit_query.filter(Invoice.branch_id == branch_id)
    rows += deposit_query.group_by(InvoicePayment.method).all()

    # Seed all three methods with zero so callers always get a complete dict
    # regardless of which methods were actually used during the period.
    result = {
        "CASH":     Decimal('0.00'),
        "VISA":     Decimal('0.00'),
        "INSTAPAY": Decimal('0.00'),
    }
    for row in rows:
        if row.payment_method is not None:
            key = row.payment_method.value  # PaymentMethod enum → string
            if key in result:
                result[key] += Decimal(str(row.rev or '0.00'))
    return result


def calculate_commissions_by_branch(
    start_date: date,
    end_date: date,
    branch_ids: Optional[list] = None
) -> dict:
    """
    Returns {branch_id: float}  — total commissions per branch.
    Single query with GROUP BY branch_id.
    """
    Invoice, InvoiceItem, InvoiceStatus, _ = _lazy_imports()
    start_utc, end_utc = cairo_day_window(start_date, end_date)

    q = db.session.query(
        Invoice.branch_id,
        func.sum(_commission_expr(InvoiceItem)).label('comm')
    ).join(Invoice, Invoice.id == InvoiceItem.invoice_id).filter(
        Invoice.status == InvoiceStatus.PAID,
        Invoice.paid_at >= start_utc,
        Invoice.paid_at <= end_utc,
        InvoiceItem.item_type == 'SERVICE_ITEM'
    )
    if branch_ids:
        q = q.filter(Invoice.branch_id.in_(branch_ids))

    rows = q.group_by(Invoice.branch_id).all()
    return {r.branch_id: float(r.comm or 0.0) for r in rows}


def calculate_expenses_by_branch(
    start_date: date,
    end_date: date,
    branch_ids: Optional[list] = None
) -> dict:
    """
    Returns {branch_id: float} — total OPERATING expenses per branch.
    Single query with GROUP BY branch_id.

    Payroll-category expenses (ADVANCE, DISCOUNT, OVERTIME, DAILY_PERCENTAGE)
    are excluded so that employee financial actions do not distort the
    per-branch net-profit figures shown on the dashboard.
    """
    _, _, _, Expense = _lazy_imports()
    from app.models.expense_category import ExpenseCategory

    q = (
        db.session.query(
            Expense.branch_id,
            func.sum(Expense.amount).label('exp')
        )
        .join(ExpenseCategory, ExpenseCategory.id == Expense.expense_category_id)
        .filter(
            Expense.expense_date >= start_date,
            Expense.expense_date <= end_date,
            ~ExpenseCategory.code.in_(PAYROLL_CATEGORY_CODES),
            Expense.is_business_expense == True  # Exclude TIP (is_business_expense=False)
        )
    )
    if branch_ids:
        q = q.filter(Expense.branch_id.in_(branch_ids))

    rows = q.group_by(Expense.branch_id).all()
    return {r.branch_id: float(r.exp or 0.0) for r in rows}


# ---------------------------------------------------------------------------
# Daily time-series (for revenue chart)
# ---------------------------------------------------------------------------

def calculate_daily_revenue(
    start_date: date,
    end_date: date,
    branch_id: Optional[int] = None
) -> list:
    """
    Returns a list of dicts, one per calendar day from start_date to end_date:
    [{"date": "YYYY-MM-DD", "revenue": float, "commissions": float, "expenses": float}]

    Revenue and commissions are grouped by DATE(paid_at AT TIME ZONE 'Africa/Cairo')
    so that invoices confirmed after 22:00 UTC (= 00:00 Cairo next day) land on
    the correct Cairo calendar day.

    Expenses use expense_date (already a bare Cairo date).
    """
    Invoice, InvoiceItem, InvoiceStatus, Expense = _lazy_imports()
    start_utc, end_utc = cairo_day_window(start_date, end_date)

    # Daily revenue: cast paid_at to Cairo date in DB
    # Use NET revenue (after discount) instead of gross total_amount
    rev_q = db.session.query(
        func.date(
            func.timezone('Africa/Cairo', Invoice.paid_at)
        ).label('day'),
        func.sum(Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)).label('revenue')
    ).filter(
        Invoice.status == InvoiceStatus.PAID,
        Invoice.paid_at >= start_utc,
        Invoice.paid_at <= end_utc
    )
    if branch_id is not None:
        rev_q = rev_q.filter(Invoice.branch_id == branch_id)
    rev_rows = rev_q.group_by(
        func.date(func.timezone('Africa/Cairo', Invoice.paid_at))
    ).all()
    rev_map = {str(r.day): float(r.revenue or 0.0) for r in rev_rows}

    # Daily commissions: same timezone cast
    comm_q = db.session.query(
        func.date(
            func.timezone('Africa/Cairo', Invoice.paid_at)
        ).label('day'),
        func.sum(_commission_expr(InvoiceItem)).label('commissions')
    ).join(Invoice, Invoice.id == InvoiceItem.invoice_id).filter(
        Invoice.status == InvoiceStatus.PAID,
        Invoice.paid_at >= start_utc,
        Invoice.paid_at <= end_utc,
        InvoiceItem.item_type == 'SERVICE_ITEM'
    )
    if branch_id is not None:
        comm_q = comm_q.filter(Invoice.branch_id == branch_id)
    comm_rows = comm_q.group_by(
        func.date(func.timezone('Africa/Cairo', Invoice.paid_at))
    ).all()
    comm_map = {str(r.day): float(r.commissions or 0.0) for r in comm_rows}

    # Daily expenses: expense_date is already a bare Cairo date.
    # Exclude payroll-category rows (same filter as calculate_expenses).
    from app.models.expense_category import ExpenseCategory
    exp_q = (
        db.session.query(
            func.date(Expense.expense_date).label('day'),
            func.sum(Expense.amount).label('expense')
        )
        .join(ExpenseCategory, ExpenseCategory.id == Expense.expense_category_id)
        .filter(
            Expense.expense_date >= start_date,
            Expense.expense_date <= end_date,
            ~ExpenseCategory.code.in_(PAYROLL_CATEGORY_CODES),
            Expense.is_business_expense == True  # Exclude TIP (is_business_expense=False)
        )
    )
    if branch_id is not None:
        exp_q = exp_q.filter(Expense.branch_id == branch_id)
    exp_rows = exp_q.group_by(func.date(Expense.expense_date)).all()
    exp_map = {str(r.day): float(r.expense or 0.0) for r in exp_rows}

    # Consolidate into daily list
    days_count = (end_date - start_date).days + 1
    result = []
    for i in range(days_count):
        d = start_date + timedelta(days=i)
        d_str = d.isoformat()
        revenue = rev_map.get(d_str, 0.0)
        commissions = comm_map.get(d_str, 0.0)
        expenses = exp_map.get(d_str, 0.0)
        result.append({
            "date": d_str,
            "revenue": revenue,
            "commissions": commissions,
            "expenses": expenses,
            "net_profit": (revenue - commissions) - expenses
        })
    return result
