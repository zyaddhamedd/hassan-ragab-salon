from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Optional, Sequence

from app.models.branch import Branch
from app.utils.exports.excel import ExcelRow
from app.utils.exports.filenames import build_export_filename


TREASURY_BUSINESS_DAY_EXPORT_COLUMNS = [
    {"id": "status_label", "header": "حالة", "width": 14},
    {"id": "business_day_number", "header": "رقم اليومية", "width": 14},
    {"id": "branch_name", "header": "الفرع", "width": 22},
    {"id": "day_label", "header": "اليوم", "width": 24},
    {"id": "cashier_name", "header": "الكاشير", "width": 20},
    {"id": "cash_collected", "header": "النقد", "width": 16},
    {"id": "visa_collected", "header": "Visa (محصل)", "width": 18},
    {"id": "instapay_collected", "header": "Instapay (محصل)", "width": 20},
    {"id": "expenses", "header": "المصروفات", "width": 16},
    {"id": "total_income", "header": "إجمالي الدخل", "width": 18},
    {"id": "net_income", "header": "إجمالي صافي الدخل", "width": 20},
]


def build_treasury_business_day_export_filename(
    *,
    requested_branch,
    allowed_branch_ids: Sequence[int],
    start_date_str: Optional[str],
    end_date_str: Optional[str],
    status: Optional[str] = None,
    exported_on: Optional[date] = None,
) -> str:
    qualifiers = ["Business Days", _resolve_scope_label(requested_branch, allowed_branch_ids)]

    if start_date_str and end_date_str:
        qualifiers.append(f"{start_date_str} to {end_date_str}")
    elif start_date_str:
        qualifiers.append(f"From {start_date_str}")
    elif end_date_str:
        qualifiers.append(f"To {end_date_str}")

    if status:
        qualifiers.append(status.upper())

    return build_export_filename(
        "Treasury",
        extension="xlsx",
        qualifiers=qualifiers,
        exported_on=exported_on,
    )


def build_treasury_business_day_export_rows(records: Sequence[dict]):
    totals = {
        "cash_collected": Decimal("0.00"),
        "visa_collected": Decimal("0.00"),
        "instapay_collected": Decimal("0.00"),
        "expenses": Decimal("0.00"),
        "total_income": Decimal("0.00"),
        "net_income": Decimal("0.00"),
    }

    for record in records:
        cash_collected = Decimal(str(record.get("cash_in") or 0))
        visa_collected = Decimal(str(record.get("visa_collected") or record.get("visa_in") or 0))
        instapay_collected = Decimal(str(record.get("instapay_collected") or record.get("instapay_in") or 0))
        expenses = Decimal(str(record.get("cash_out") or 0))
        total_income = Decimal(str(record.get("total_income") or 0))
        net_income = Decimal(str(record.get("net_income") or 0))

        totals["cash_collected"] += cash_collected
        totals["visa_collected"] += visa_collected
        totals["instapay_collected"] += instapay_collected
        totals["expenses"] += expenses
        totals["total_income"] += total_income
        totals["net_income"] += net_income

        yield [
            record.get("status_label") or "",
            str(record.get("id") or ""),
            record.get("branch_name") or "",
            record.get("day_label") or "",
            record.get("opened_by") or "",
            format_currency_value(cash_collected),
            format_currency_value(visa_collected),
            format_currency_value(instapay_collected),
            format_currency_value(expenses),
            format_currency_value(total_income),
            format_currency_value(net_income),
        ]

    yield ExcelRow(
        values=[
            "الإجمالي",
            "",
            "",
            "",
            "",
            format_currency_value(totals["cash_collected"]),
            format_currency_value(totals["visa_collected"]),
            format_currency_value(totals["instapay_collected"]),
            format_currency_value(totals["expenses"]),
            format_currency_value(totals["total_income"]),
            format_currency_value(totals["net_income"]),
        ],
        style_id=3,
    )


def format_currency_value(value) -> str:
    amount = Decimal(str(value or 0))
    return f"{amount:,.2f}"


def _resolve_scope_label(requested_branch, allowed_branch_ids: Sequence[int]) -> str:
    if requested_branch and str(requested_branch).lower() != "all":
        branch = Branch.query.filter(Branch.id == int(requested_branch)).first()
        return branch.name if branch else f"Branch_{requested_branch}"

    if len(allowed_branch_ids) == 1:
        branch = Branch.query.filter(Branch.id == allowed_branch_ids[0]).first()
        if branch:
            return branch.name

    return "All"
