"""Lightweight Executive Overview aggregation for Admin Reports.

The overview deliberately composes canonical reporting helpers. It does not
introduce a second sales, finance, customer, or operations calculation path.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Sequence

from app.models.branch import Branch
from app.services.operations_reporting_service import build_operations_overview_context
from app.services.reporting_service import (
    COMPARISON_NEUTRAL_BAND_PERCENT,
    SALES_DECLINE_ATTENTION_PERCENT,
    ReportFilters,
    _comparison,
    _customer_core_state,
    _employee_service_core_rows,
    _finance_performance_comparison,
    _finance_performance_summary,
    _previous_filters,
    _previous_period,
    _sales_branch_rows,
    _sales_mix,
    _sales_summary,
    _sales_summary_comparison,
    _sales_trend,
    _top_sales_items,
)


def _money_difference(left, right) -> float:
    return round(float(Decimal(str(left or 0)) - Decimal(str(right or 0))), 2)


def _movement_word(comparison: dict, masculine: bool = True) -> str:
    percent = comparison.get("percent_change")
    if percent is None:
        return "دون قاعدة مقارنة"
    if abs(percent) < COMPARISON_NEUTRAL_BAND_PERCENT:
        return "استقر" if masculine else "استقرت"
    if percent > 0:
        return "ارتفع" if masculine else "ارتفعت"
    return "انخفض" if masculine else "انخفضت"


def _growth_driver(comparison: dict, current: dict) -> str:
    net = comparison["net_sales"]
    if net["percent_change"] is None:
        if current["net_sales"] > 0:
            return "سُجل نشاط مدفوع في الفترة الحالية دون قاعدة مقارنة سابقة صالحة."
        return "لا توجد قاعدة مقارنة كافية للفترة السابقة."
    if abs(net["percent_change"]) < COMPARISON_NEUTRAL_BAND_PERCENT:
        return "صافي المبيعات دون تغير ملحوظ مقارنة بالفترة السابقة."
    direction = "ارتفع" if net["percent_change"] > 0 else "انخفض"
    invoice_direction = _movement_word(comparison["paid_invoice_count"])
    ticket_direction = _movement_word(comparison["average_ticket"])
    return f"{direction} صافي المبيعات؛ عدد الفواتير {invoice_direction} ومتوسط الفاتورة {ticket_direction}."


def _aligned_trend(current_rows: list[dict], previous_rows: list[dict], filters: ReportFilters) -> list[dict]:
    previous_from, _previous_to = _previous_period(filters)
    current_map = {row["date"]: row for row in current_rows}
    previous_map = {row["date"]: row for row in previous_rows}
    days = (filters.date_to - filters.date_from).days + 1
    result = []
    for index in range(days):
        current_date = filters.date_from + timedelta(days=index)
        previous_date = previous_from + timedelta(days=index)
        current = current_map.get(current_date.isoformat(), {})
        previous = previous_map.get(previous_date.isoformat(), {})
        result.append({
            "period_index": index + 1,
            "date": current_date.isoformat(),
            "previous_date": previous_date.isoformat(),
            "net_sales": float(current.get("net_sales", 0) or 0),
            "previous_net_sales": float(previous.get("net_sales", 0) or 0),
            "gross_sales": float(current.get("gross_sales", 0) or 0),
            "discount_amount": float(current.get("discount_amount", 0) or 0),
            "paid_invoice_count": int(current.get("paid_invoice_count", 0) or 0),
            "average_ticket": float(current.get("average_ticket", 0) or 0),
        })
    return result


def _customer_context(allowed_branch_ids: Sequence[int], filters: ReportFilters):
    _rows, _history, coverage, summary = _customer_core_state(allowed_branch_ids, filters)
    _previous_rows, _previous_history, previous_coverage, previous_summary = _customer_core_state(
        allowed_branch_ids, _previous_filters(filters)
    )
    return {
        "identified_customers": summary["identified_customers"],
        "identified_invoice_coverage": coverage["identified_invoice_share"],
        "repeat_paid_day_share": summary["repeat_share"],
        "comparison": {
            "identified_invoice_coverage": _comparison(
                coverage["identified_invoice_share"], previous_coverage["identified_invoice_share"]
            ),
            "repeat_paid_day_share": _comparison(summary["repeat_share"], previous_summary["repeat_share"]),
        },
        "identity_basis": "Customer.id; branch-scoped records are never merged by phone",
        "repeat_basis": "Distinct paid invoice dates",
    }


def _team_context(allowed_branch_ids: Sequence[int], filters: ReportFilters, recorded_commission_cost: float):
    barber_filters = ReportFilters(**{**filters.__dict__, "employee_mode": "BARBER", "employee_id": None})
    rows = list(_employee_service_core_rows(allowed_branch_ids, barber_filters).values())
    rows.sort(key=lambda row: (-row["gross_service_value"], row["employee_name"]))
    total_gross = sum(Decimal(str(row["gross_service_value"])) for row in rows)
    leader = rows[0] if rows else None
    share = round(float(Decimal(str(leader["gross_service_value"])) / total_gross * 100), 1) if leader and total_gross else 0.0
    narrative = None
    if leader:
        narrative = (
            f"يمثل إسناد خدمات {leader['employee_name']} {share:.1f}% "
            "من قيمة الخدمات الإجمالية المسندة في النطاق؛ هذا وصف للإسناد وليس للإيراد الصافي."
        )
    return {
        "attributed_barber_count": len(rows),
        "recorded_commission_cost": recorded_commission_cost,
        "leading_barber": {
            "employee_id": leader["employee_id"],
            "employee_name": leader["employee_name"],
            "gross_service_value": leader["gross_service_value"],
            "share_percent": share,
        } if leader else None,
        "narrative": narrative,
    }


def _signals(sales: dict, sales_comparison: dict, finance: dict, previous_finance: dict, branches: list[dict], customers: dict, operations: dict):
    items = []
    net_comparison = sales_comparison["net_sales"]
    declining_branch = next((
        row for row in branches
        if row["comparison"]["percent_change"] is not None
        and row["comparison"]["percent_change"] <= SALES_DECLINE_ATTENTION_PERCENT
        and row["comparison"]["previous"] >= 100
    ), None)

    if finance["operating_contribution"] < 0:
        items.append({
            "code": "NEGATIVE_OPERATING_CONTRIBUTION", "level": "ATTENTION", "category": "FINANCIAL",
            "title": "المساهمة التشغيلية سالبة",
            "detail": f"المصروفات التشغيلية تمثل {finance['operating_expense_ratio']:.1f}% من صافي المبيعات ضمن الفترة.",
            "destination": "finance",
        })
    if sales["net_sales"] and sales["discount_rate"] >= 0:
        previous_ratio = previous_finance["operating_expense_ratio"]
        ratio_change = round(finance["operating_expense_ratio"] - previous_ratio, 1)
        if ratio_change >= 1 and finance["operating_contribution"] >= 0:
            items.append({
                "code": "OPERATING_EXPENSE_RATIO_INCREASE", "level": "REVIEW", "category": "FINANCIAL",
                "title": "ارتفاع نسبة المصروفات التشغيلية",
                "detail": f"ارتفعت من {previous_ratio:.1f}% إلى {finance['operating_expense_ratio']:.1f}% من صافي المبيعات.",
                "destination": "finance",
            })
    if (
        net_comparison["percent_change"] is not None
        and net_comparison["previous"] >= 100
        and net_comparison["percent_change"] <= SALES_DECLINE_ATTENTION_PERCENT
    ):
        branch_detail = (
            f" ويشمل السياق تراجع {declining_branch['branch_name']} "
            f"بنسبة {abs(declining_branch['comparison']['percent_change']):.1f}%."
            if declining_branch else ""
        )
        items.insert(0, {
            "code": "NET_SALES_DECLINE", "level": "REVIEW", "category": "COMMERCIAL",
            "title": "تراجع صافي المبيعات",
            "detail": f"صافي المبيعات أقل {abs(net_comparison['percent_change']):.1f}% من الفترة السابقة.{branch_detail}",
            "destination": "sales",
        })
    elif declining_branch and declining_branch["contribution_percent"] >= 10:
        items.append({
            "code": "MATERIAL_BRANCH_DECLINE", "level": "REVIEW", "category": "BRANCH",
            "title": "حركة فرع تحتاج مراجعة",
            "detail": f"انخفض صافي مبيعات {declining_branch['branch_name']} {abs(declining_branch['comparison']['percent_change']):.1f}% ويمثل {declining_branch['contribution_percent']:.1f}% من النطاق.",
            "destination": "branches", "entity_id": declining_branch["branch_id"],
        })

    coverage = customers["comparison"]["identified_invoice_coverage"]
    repeat = customers["comparison"]["repeat_paid_day_share"]
    if coverage["absolute_change"] <= -2:
        items.append({
            "code": "IDENTIFIED_COVERAGE_DECLINE", "level": "REVIEW", "category": "CUSTOMER",
            "title": "انخفاض تغطية هوية العميل",
            "detail": f"انخفضت تغطية الفواتير المرتبطة بسجل عميل {abs(coverage['absolute_change']):.1f} نقطة مئوية.",
            "destination": "customers",
        })
    elif repeat["percent_change"] is not None and repeat["percent_change"] <= -20:
        items.append({
            "code": "REPEAT_SHARE_DECLINE", "level": "REVIEW", "category": "CUSTOMER",
            "title": "تراجع النشاط المدفوع المتكرر",
            "detail": f"انخفضت نسبة العملاء ذوي الدفع في يومين مميزين أو أكثر {abs(repeat['percent_change']):.1f}%.",
            "destination": "customers",
        })

    if operations["business_days"]["old_open"]:
        items.append({
            "code": "OLD_OPEN_BUSINESS_DAY", "level": "ATTENTION", "category": "OPERATIONAL",
            "title": "يوم عمل مفتوح من تاريخ سابق",
            "detail": f"يوجد {operations['business_days']['old_open']} يوم عمل ما زال مفتوحًا بعد تاريخ بدايته.",
            "destination": "operations", "snapshot": True,
        })
    if operations["inventory"]["negative"]:
        items.append({
            "code": "NEGATIVE_STOCK", "level": "ATTENTION", "category": "INVENTORY",
            "title": "مخزون حالي سالب",
            "detail": f"يوجد {operations['inventory']['negative']} سجل منتج وفرع بكمية سالبة حاليًا.",
            "destination": "operations", "snapshot": True,
        })
    elif operations["inventory"]["high_selling_stock_risks"]:
        risk = operations["inventory"]["high_selling_stock_risks"][0]
        items.append({
            "code": "HIGH_SELLING_CURRENT_STOCK_RISK", "level": "REVIEW", "category": "INVENTORY",
            "title": "منتج نشط منخفض حاليًا",
            "detail": f"{risk['product_name']} من المنتجات الأعلى حركة ومخزونه {risk['state']} في {risk['branch_name']}.",
            "destination": "products", "entity_id": risk["product_id"], "snapshot": True,
        })
    if operations["appointments"]["past_still_scheduled"]:
        items.append({
            "code": "PAST_STILL_SCHEDULED", "level": "REVIEW", "category": "OPERATIONAL",
            "title": "مواعيد سابقة ما زالت مجدولة",
            "detail": f"يوجد {operations['appointments']['past_still_scheduled']} موعد سابق يحتاج مراجعة حالته الحالية.",
            "destination": "operations", "snapshot": True,
        })

    level_order = {"ATTENTION": 0, "REVIEW": 1, "CONTEXT": 2}
    category_order = {"COMMERCIAL": 0, "FINANCIAL": 1, "BRANCH": 2, "CUSTOMER": 3, "OPERATIONAL": 4, "INVENTORY": 5}
    items.sort(key=lambda item: (category_order[item["category"]], level_order[item["level"]], item["code"]))
    return items[:5]


def build_executive_overview(allowed_branch_ids: Sequence[int], filters: ReportFilters, *, fixed_branch_scope: bool = False):
    previous_filters = _previous_filters(filters)
    sales = _sales_summary(allowed_branch_ids, filters)
    previous_sales = _sales_summary(allowed_branch_ids, previous_filters)
    sales_comparison = _sales_summary_comparison(sales, previous_sales)
    finance = _finance_performance_summary(allowed_branch_ids, filters)
    previous_finance = _finance_performance_summary(allowed_branch_ids, previous_filters)
    finance_comparison = _finance_performance_comparison(finance, previous_finance)
    branches = _sales_branch_rows(allowed_branch_ids, filters, sales["net_sales"])
    mix = _sales_mix(allowed_branch_ids, filters)
    top_service = _top_sales_items(allowed_branch_ids, filters, "SERVICE_ITEM")
    top_product = _top_sales_items(allowed_branch_ids, filters, "PRODUCT_ITEM")
    customers = _customer_context(allowed_branch_ids, filters)
    team = _team_context(allowed_branch_ids, filters, finance["recorded_commission_cost"])
    operations = build_operations_overview_context(allowed_branch_ids, filters)
    trend = _aligned_trend(
        _sales_trend(allowed_branch_ids, filters),
        _sales_trend(allowed_branch_ids, previous_filters),
        filters,
    )
    previous_from, previous_to = _previous_period(filters)
    branch_models = Branch.query.filter(Branch.id.in_(allowed_branch_ids) if allowed_branch_ids else False).order_by(Branch.name).all()
    driver = _growth_driver(sales_comparison, sales)
    insights = [{"code": "SALES_DRIVERS", "text": driver}]
    if len(branches) > 1 and sales["net_sales"] > 0:
        insights.append({
            "code": "TOP_BRANCH_SHARE",
            "text": f"{branches[0]['branch_name']} يمثل {branches[0]['contribution_percent']:.1f}% من صافي المبيعات ضمن النطاق.",
        })
    signals = _signals(sales, sales_comparison, finance, previous_finance, branches, customers, operations)
    branch_net = round(sum(row["net_sales"] for row in branches), 2)
    branch_invoices = sum(row["paid_invoice_count"] for row in branches)
    return {
        "meta": {
            "date_from": filters.date_from.isoformat(),
            "date_to": filters.date_to.isoformat(),
            "previous_date_from": previous_from.isoformat(),
            "previous_date_to": previous_to.isoformat(),
            "date_basis": "Invoice.invoice_date (Cairo paid business date)",
            "timezone": "Africa/Cairo",
            "currency": "EGP",
            "authorized_branch_ids": list(allowed_branch_ids),
            "branches": [{"id": row.id, "name": row.name} for row in branch_models],
            "branch_scope_mode": "FIXED" if fixed_branch_scope else "SELECTABLE",
            "snapshot_as_of": operations["as_of"],
        },
        "summary": {
            **sales,
            "operating_expenses": finance["operating_expenses"],
            "recorded_commission_cost": finance["recorded_commission_cost"],
            "operating_contribution": finance["operating_contribution"],
            "operating_expense_ratio": finance["operating_expense_ratio"],
            "contribution_ratio": finance["contribution_ratio"],
        },
        "comparison": {
            **sales_comparison,
            "operating_expenses": finance_comparison["operating_expenses"],
            "recorded_commission_cost": finance_comparison["recorded_commission_cost"],
            "operating_contribution": finance_comparison["operating_contribution"],
        },
        "drivers": {
            "identity": "net_sales = paid_invoice_count × average_ticket",
            "text": driver,
            "invoice_count": sales_comparison["paid_invoice_count"],
            "average_ticket": sales_comparison["average_ticket"],
        },
        "trend": trend,
        "branches": branches[:5],
        "branch_count": len(branches),
        "mix": {**mix, "top_service": top_service, "top_product": top_product},
        "customers": customers,
        "team": team,
        "current_conditions": operations,
        "insights": insights[:2],
        "signals": signals,
        "reconciliation": {
            "sales_vs_finance_net_sales": _money_difference(sales["net_sales"], finance["net_sales"]),
            "sales_vs_finance_gross_sales": _money_difference(sales["gross_sales"], finance["gross_sales"]),
            "sales_vs_finance_discounts": _money_difference(sales["discount_amount"], finance["discount_amount"]),
            "sales_vs_branch_net_sales": _money_difference(sales["net_sales"], branch_net),
            "sales_vs_branch_paid_invoice_count": sales["paid_invoice_count"] - branch_invoices,
            "appointment_count": operations["appointments"]["count"],
            "current_negative_stock_rows": operations["inventory"]["negative"],
        },
    }
