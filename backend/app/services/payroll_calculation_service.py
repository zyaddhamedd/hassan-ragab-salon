"""
app/services/payroll_calculation_service.py

Read-Only Payroll & Settlement Calculation Service (Phase 1 & Phase 2).
Provides preview calculations for arbitrary, inclusive date ranges
without mutating database state, wallet balances, or treasury ledgers.
Automatically excludes items locked by approved/paid settlements and
safely surfaces carried balances from unabsorbed prior settlements.
"""

from datetime import date, datetime
import calendar
from typing import Dict, List, Optional, Any, Set, Tuple
from sqlalchemy import or_, and_, func

from app.extensions import db
from app.models.employee import Employee
from app.models.invoice import Invoice, InvoiceItem, InvoiceStatus
from app.models.employee_financial_action import EmployeeFinancialAction, EmployeeActionType
from app.models.employee_overtime import EmployeeOvertime
from app.services.financial_service import cairo_day_window
from app.utils.date_utils import to_iso_string


def calculate_employee_payroll_preview(
    employee: Employee,
    date_from: date,
    date_to: date
) -> Dict[str, Any]:
    """
    Computes an exact, item-level payroll preview for an employee
    across ANY arbitrary inclusive date range (date_from to date_to).

    Guarantees:
    - Zero mutations: DOES NOT write to DB, does not change wallet balance.
    - Zero assumptions: Fixed salary is reported separately as an optional
      suggestion, NOT silently bundled into net_payable.
    - Symmetrical deduction: ADVANCE and COMMISSION_WITHDRAWAL both reduce
      remaining payable with distinct source identities.
    - Cairo-accurate: Filters timestamp columns using Cairo midnight-to-midnight window.
    - Preserves negative balances: Advances exceeding earnings yield negative net.
    - Deduplication: Automatically filters out items already allocated in an
      APPROVED, PARTIALLY_PAID, or PAID settlement.
    - Carried balance lineage: Surfaces outstanding debt or unpaid balances
      from unabsorbed prior settlements without synthetic duplicate transactions.
    """
    if date_from > date_to:
        raise ValueError("date_from must be earlier than or equal to date_to")

    start_utc, end_utc = cairo_day_window(date_from, date_to)

    # -------------------------------------------------------------------------
    # 0. QUERY LOCKED ALLOCATED ITEMS (To support overlapping ranges safely)
    # -------------------------------------------------------------------------
    from app.models.payroll_settlement import (
        PayrollSettlement,
        SettlementAllocatedItem,
        SettlementStatus,
    )
    locked_allocated_keys: Set[Tuple[str, int]] = set()
    locked_query = (
        db.session.query(SettlementAllocatedItem.item_type, SettlementAllocatedItem.source_item_id)
        .join(PayrollSettlement, PayrollSettlement.id == SettlementAllocatedItem.settlement_id)
        .filter(
            PayrollSettlement.employee_id == employee.id,
            PayrollSettlement.status.in_([
                SettlementStatus.APPROVED,
                SettlementStatus.PARTIALLY_PAID,
                SettlementStatus.PAID,
            ])
        )
    )
    for row in locked_query.all():
        locked_allocated_keys.add((str(row[0]), int(row[1])))

    # -------------------------------------------------------------------------
    # 0B. DERIVE PRIOR UNABSORBED CARRIED BALANCES (Debt or Unpaid Salary)
    # -------------------------------------------------------------------------
    carried_balance_applied = 0.0
    absorbed_settlement_id: Optional[int] = None
    unabsorbed_priors: List[Any] = []
    prior_settlements = (
        PayrollSettlement.query.filter(
            PayrollSettlement.employee_id == employee.id,
            PayrollSettlement.status.in_([
                SettlementStatus.APPROVED,
                SettlementStatus.PARTIALLY_PAID,
            ]),
            PayrollSettlement.remaining_balance != 0,
            PayrollSettlement.date_to <= date_to,
        )
        .order_by(PayrollSettlement.date_to.asc(), PayrollSettlement.id.asc())
        .all()
    )
    for prior in prior_settlements:
        # Check if prior has already been absorbed
        if ("CARRIED_SETTLEMENT_BALANCE", prior.id) in locked_allocated_keys:
            continue
        if prior.absorbed_by is not None:
            continue

        unabsorbed_priors.append(prior)

    if unabsorbed_priors:
        carried_balance_applied = round(sum(float(p.remaining_balance) for p in unabsorbed_priors), 2)
        absorbed_settlement_id = unabsorbed_priors[-1].id

    # -------------------------------------------------------------------------
    # 1. COMMISSIONS (Services, Assistants, Product Sales)
    # -------------------------------------------------------------------------
    # Query all eligible items where the invoice was confirmed PAID within window.
    # Exclude drafts, cancellations, and fully discounted (free) invoices.
    eligible_items_query = (
        db.session.query(InvoiceItem, Invoice)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(
            Invoice.status == InvoiceStatus.PAID,
            Invoice.is_fully_discounted.is_(False),
            func.coalesce(Invoice.paid_at, Invoice.created_at) >= start_utc,
            func.coalesce(Invoice.paid_at, Invoice.created_at) <= end_utc,
            or_(
                InvoiceItem.barber_id == employee.id,
                InvoiceItem.assistant_id == employee.id,
                InvoiceItem.assigned_employee_id == employee.id,
            )
        )
        .order_by(Invoice.created_at.asc(), InvoiceItem.id.asc())
    )
    eligible_records = eligible_items_query.all()

    commission_items: List[Dict[str, Any]] = []
    total_barber_commission = 0.0
    total_assistant_commission = 0.0
    total_product_commission = 0.0
    branch_attribution: Dict[str, Dict[str, Any]] = {}
    already_settled_items_count = 0

    for item, invoice in eligible_records:
        branch_name = invoice.branch.name if invoice.branch else "Unknown"
        branch_id = invoice.branch_id
        if branch_name not in branch_attribution:
            branch_attribution[branch_name] = {
                "branch_id": branch_id,
                "branch_name": branch_name,
                "operations_count": 0,
                "service_commissions": 0.0,
                "product_commissions": 0.0,
                "total_commissions": 0.0,
            }

        # A. Barber Service Commission
        if item.item_type == "SERVICE_ITEM" and item.barber_id == employee.id:
            if ("INVOICE_ITEM_BARBER", item.id) in locked_allocated_keys:
                already_settled_items_count += 1
            else:
                pct = float(item.barber_commission_percent or 0.0)
                price = float(item.service_price or 0.0)
                share = round((price * pct) / 100.0, 2)
                if share > 0:
                    service_title = item.service.name if item.service else f"Service #{item.service_id}"
                    commission_items.append({
                        "source_id": f"INVOICE_ITEM:{item.id}:BARBER",
                        "item_id": item.id,
                        "invoice_id": invoice.id,
                        "invoice_number": invoice.invoice_number,
                        "earning_role": "BARBER",
                        "item_type": "SERVICE_ITEM",
                        "title": service_title,
                        "gross_price": price,
                        "commission_percent": pct,
                        "commission_amount": share,
                        "branch_id": branch_id,
                        "branch_name": branch_name,
                        "date": to_iso_string(invoice.paid_at or invoice.created_at),
                    })
                    total_barber_commission = round(total_barber_commission + share, 2)
                    branch_attribution[branch_name]["operations_count"] += 1
                    branch_attribution[branch_name]["service_commissions"] = round(
                        branch_attribution[branch_name]["service_commissions"] + share, 2
                    )
                    branch_attribution[branch_name]["total_commissions"] = round(
                        branch_attribution[branch_name]["total_commissions"] + share, 2
                    )

        # B. Assistant Service Commission
        if item.item_type == "SERVICE_ITEM" and item.assistant_id == employee.id:
            if ("INVOICE_ITEM_ASSISTANT", item.id) in locked_allocated_keys:
                already_settled_items_count += 1
            else:
                pct = float(item.assistant_commission_percent or 0.0)
                price = float(item.service_price or 0.0)
                share = round((price * pct) / 100.0, 2)
                if share > 0:
                    service_title = item.service.name if item.service else f"Service #{item.service_id}"
                    commission_items.append({
                        "source_id": f"INVOICE_ITEM:{item.id}:ASSISTANT",
                        "item_id": item.id,
                        "invoice_id": invoice.id,
                        "invoice_number": invoice.invoice_number,
                        "earning_role": "ASSISTANT",
                        "item_type": "SERVICE_ITEM",
                        "title": f"{service_title} (مساعد)",
                        "gross_price": price,
                        "commission_percent": pct,
                        "commission_amount": share,
                        "branch_id": branch_id,
                        "branch_name": branch_name,
                        "date": to_iso_string(invoice.paid_at or invoice.created_at),
                    })
                    total_assistant_commission = round(total_assistant_commission + share, 2)
                    branch_attribution[branch_name]["operations_count"] += 1
                    branch_attribution[branch_name]["service_commissions"] = round(
                        branch_attribution[branch_name]["service_commissions"] + share, 2
                    )
                    branch_attribution[branch_name]["total_commissions"] = round(
                        branch_attribution[branch_name]["total_commissions"] + share, 2
                    )

        # C. Product Sales Commission
        if item.item_type == "PRODUCT_ITEM" and item.assigned_employee_id == employee.id:
            if ("INVOICE_ITEM_PRODUCT", item.id) in locked_allocated_keys:
                already_settled_items_count += 1
            else:
                share = round(float(item.sales_commission_amount or 0.0), 2)
                pct = float(item.sales_commission_percent or 0.0)
                price = float(item.service_price or 0.0)
                if share > 0:
                    product_title = item.product.name if item.product else f"Product #{item.product_id}"
                    commission_items.append({
                        "source_id": f"INVOICE_ITEM:{item.id}:PRODUCT_SALES",
                        "item_id": item.id,
                        "invoice_id": invoice.id,
                        "invoice_number": invoice.invoice_number,
                        "earning_role": "PRODUCT_SALES",
                        "item_type": "PRODUCT_ITEM",
                        "title": product_title,
                        "gross_price": price,
                        "commission_percent": pct,
                        "commission_amount": share,
                        "branch_id": branch_id,
                        "branch_name": branch_name,
                        "date": to_iso_string(invoice.paid_at or invoice.created_at),
                    })
                    total_product_commission = round(total_product_commission + share, 2)
                    branch_attribution[branch_name]["operations_count"] += 1
                    branch_attribution[branch_name]["product_commissions"] = round(
                        branch_attribution[branch_name]["product_commissions"] + share, 2
                    )
                    branch_attribution[branch_name]["total_commissions"] = round(
                        branch_attribution[branch_name]["total_commissions"] + share, 2
                    )

    total_service_commission = round(total_barber_commission + total_assistant_commission, 2)
    total_commissions_earned = round(total_service_commission + total_product_commission, 2)

    # -------------------------------------------------------------------------
    # 2. FINANCIAL ACTIONS (Advances, Commission Withdrawals, Deductions, Overtime)
    # -------------------------------------------------------------------------
    actions = (
        EmployeeFinancialAction.query.filter(
            EmployeeFinancialAction.employee_id == employee.id,
            EmployeeFinancialAction.created_at >= start_utc,
            EmployeeFinancialAction.created_at <= end_utc,
        )
        .order_by(EmployeeFinancialAction.created_at.asc(), EmployeeFinancialAction.id.asc())
        .all()
    )

    advance_items: List[Dict[str, Any]] = []
    commission_withdrawal_items: List[Dict[str, Any]] = []
    deduction_items: List[Dict[str, Any]] = []
    action_overtime_items: List[Dict[str, Any]] = []

    total_advances = 0.0
    total_commission_withdrawals = 0.0
    total_deductions = 0.0
    total_action_overtime = 0.0

    for act in actions:
        amt = round(float(act.amount or 0.0), 2)
        base_record = {
            "source_id": f"FINANCIAL_ACTION:{act.id}:{act.action_type.value}",
            "action_id": act.id,
            "action_type": act.action_type.value,
            "amount": amt,
            "is_cash_event": act.is_cash_event,
            "notes": act.notes or "",
            "date": to_iso_string(act.created_at),
            "branch_id": act.branch_id,
        }

        # Check if already locked by prior approved settlement
        if (act.action_type.value, act.id) in locked_allocated_keys:
            already_settled_items_count += 1
            continue

        if act.action_type == EmployeeActionType.ADVANCE:
            advance_items.append(base_record)
            total_advances = round(total_advances + amt, 2)

        elif act.action_type == EmployeeActionType.COMMISSION_WITHDRAWAL:
            commission_withdrawal_items.append(base_record)
            total_commission_withdrawals = round(total_commission_withdrawals + amt, 2)

        elif act.action_type == EmployeeActionType.DEDUCTION:
            deduction_items.append(base_record)
            total_deductions = round(total_deductions + amt, 2)

        elif act.action_type == EmployeeActionType.OVERTIME:
            action_overtime_items.append(base_record)
            total_action_overtime = round(total_action_overtime + amt, 2)

    # -------------------------------------------------------------------------
    # 3. OVERTIME RECORDS (Dedicated employee_overtime table)
    # -------------------------------------------------------------------------
    raw_overtimes = (
        EmployeeOvertime.query.filter(
            EmployeeOvertime.employee_id == employee.id,
            EmployeeOvertime.date >= date_from,
            EmployeeOvertime.date <= date_to,
        )
        .order_by(EmployeeOvertime.date.asc(), EmployeeOvertime.id.asc())
        .all()
    )

    overtime_items: List[Dict[str, Any]] = []
    total_overtime = 0.0

    # Start with actions overtime (if not locked)
    for aot in action_overtime_items:
        overtime_items.append({
            "source_id": aot["source_id"],
            "amount": aot["amount"],
            "reason": aot["notes"] or "أوفر تايم مسجل بالخزينة",
            "date": aot["date"],
            "origin": "FINANCIAL_ACTION",
        })
        total_overtime = round(total_overtime + aot["amount"], 2)

    # Add standalone EmployeeOvertime entries if not already represented in EFA and not locked
    for ot in raw_overtimes:
        if ("EMPLOYEE_OVERTIME", ot.id) in locked_allocated_keys:
            already_settled_items_count += 1
            continue

        ot_amt = round(float(ot.amount or 0.0), 2)
        already_in_efa = any(
            aot["amount"] == ot_amt and aot["date"].startswith(ot.date.isoformat())
            for aot in action_overtime_items
        )
        if not already_in_efa:
            overtime_items.append({
                "source_id": f"EMPLOYEE_OVERTIME:{ot.id}",
                "amount": ot_amt,
                "reason": ot.reason or "أوفر تايم",
                "date": ot.date.isoformat(),
                "origin": "EMPLOYEE_OVERTIME",
            })
            total_overtime = round(total_overtime + ot_amt, 2)

    # -------------------------------------------------------------------------
    # 4. FIXED SALARY & SUGGESTED PRORATION (Informational, NOT included in default net)
    # -------------------------------------------------------------------------
    configured_base_salary = round(float(employee.base_salary or 0.0), 2)
    days_in_period = (date_to - date_from).days + 1
    # Month length of date_from
    days_in_month = calendar.monthrange(date_from.year, date_from.month)[1]
    suggested_prorated_base_salary = 0.0
    if configured_base_salary > 0:
        suggested_prorated_base_salary = round(
            configured_base_salary * (days_in_period / float(days_in_month)), 2
        )

    # -------------------------------------------------------------------------
    # 5. NET PAYABLE COMPUTATION (Negative Balances Preserved)
    # -------------------------------------------------------------------------
    # Both ADVANCE and COMMISSION_WITHDRAWAL are money already received out of drawer/register.
    total_money_already_received = round(total_advances + total_commission_withdrawals, 2)
    total_deductions_combined = round(total_money_already_received + total_deductions, 2)

    # Net payable from earned performance + carried balance from prior settlement
    # Net = (Commissions + Overtime) - (Advances + Commission Withdrawals + Deductions) + carried_balance
    net_payable = round(
        total_commissions_earned + total_overtime - total_deductions_combined + carried_balance_applied, 2
    )

    # Optional preview figure if manager elects to include suggested salary
    net_payable_with_suggested_salary = round(net_payable + suggested_prorated_base_salary, 2)

    # -------------------------------------------------------------------------
    # 6. UNRESOLVED AMBIGUITIES & WARNINGS
    # -------------------------------------------------------------------------
    ambiguities: List[str] = []
    if configured_base_salary > 0 and total_commissions_earned > 0:
        ambiguities.append(
            "تم رصد نموذج أجر مركب: الموظف مسجل براتب أساسي ونسبة عمولة. "
            "الراتب الأساسي معروض كاقتراح استرشادي منفصل ولم يتم دمجه تلقائياً في صافي المستحق."
        )
    if net_payable < 0:
        ambiguities.append(
            f"صافي المستحق قيمة سالبة ({net_payable:,.2f} ج.م): المسحوبات والسلف تجاوزت الأرباح المحققة. "
            "الموظف مدين للصالون بهذا الفارق ويجب ترحيله كدين أو تحصيله نقداً."
        )
    if total_commission_withdrawals > 0:
        ambiguities.append(
            f"تم رصد سحوبات نِسَب يومية مسبقة بقيمة {total_commission_withdrawals:,.2f} ج.م. "
            "تم خصمها تلقائياً كأموال مستلمة مسبقاً لمنع الصرف المزدوج لنفس العمولات."
        )
    if carried_balance_applied != 0:
        priors_desc = ", ".join(f"#{p.settlement_number}" for p in unabsorbed_priors) if unabsorbed_priors else f"#{absorbed_settlement_id}"
        if carried_balance_applied < 0:
            ambiguities.append(
                f"تم ترحيل مديونية سابقة غير مسددة بقيمة {abs(carried_balance_applied):,.2f} ج.م "
                f"من تسوية سابقة ({priors_desc})."
            )
        else:
            ambiguities.append(
                f"تم ترحيل رصيد مستحق سابق غير منصرف بقيمة {carried_balance_applied:,.2f} ج.م "
                f"من تسوية سابقة ({priors_desc})."
            )
    if already_settled_items_count > 0:
        ambiguities.append(
            f"تم استبعاد {already_settled_items_count} بند مالي مصفى مسبقاً في تسويات معتمدة أخرى ضمن هذا النطاق الزمني."
        )

    carried_balance_items = [
        {
            "source_id": f"SETTLEMENT:{p.settlement_number}",
            "settlement_id": p.id,
            "settlement_number": p.settlement_number,
            "amount": round(float(p.remaining_balance), 2),
        }
        for p in unabsorbed_priors
    ]

    return {
        "meta": {
            "version": "v2-calculation-preview",
            "employee_id": employee.id,
            "employee_name": employee.full_name,
            "employee_type": employee.employee_type.value if employee.employee_type else "BARBER",
            "home_branch": employee.branch.name if employee.branch else "Unknown",
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
            "days_in_period": days_in_period,
            "generated_at": datetime.now().isoformat(),
            "reference_wallet_balance": round(float(employee.commission_wallet_balance or 0.0), 2),
            "absorbed_settlement_id": absorbed_settlement_id,
            "absorbed_settlement_ids": [p.id for p in unabsorbed_priors],
            "absorbed_settlements": [
                {
                    "id": p.id,
                    "settlement_number": p.settlement_number,
                    "remaining_balance": round(float(p.remaining_balance), 2),
                }
                for p in unabsorbed_priors
            ],
            "already_settled_items_excluded_count": already_settled_items_count,
            "disclaimer": "معاينة حسابية استرشادية للقراءة فقط. لا يتم تعديل قاعدة البيانات أو الخزينة أو الأرصدة.",
        },
        "summary": {
            "gross_commissions": total_commissions_earned,
            "service_commissions": total_service_commission,
            "barber_commissions": total_barber_commission,
            "assistant_commissions": total_assistant_commission,
            "product_commissions": total_product_commission,
            "overtime": total_overtime,
            "total_earnings": round(total_commissions_earned + total_overtime, 2),

            # Deductions Breakdown
            "advances": total_advances,
            "commission_withdrawals": total_commission_withdrawals,
            "money_already_received": total_money_already_received,
            "administrative_deductions": total_deductions,
            "total_deductions": total_deductions_combined,

            # Carried balances & Net
            "carried_balance_applied": carried_balance_applied,
            "net_payable": net_payable,
            "net_payable_with_suggested_salary": net_payable_with_suggested_salary,
            "is_negative_balance": net_payable < 0,
        },
        "fixed_salary_info": {
            "configured_base_salary": configured_base_salary,
            "days_in_period": days_in_period,
            "days_in_month": days_in_month,
            "suggested_prorated_base_salary": suggested_prorated_base_salary,
            "is_included_in_net": False,
            "note": "لم يتم إدراج الراتب الأساسي تلقائياً في صافي المستحق. يتطلب قراراً إدارياً صريحاً عند الاعتماد.",
        },
        "branch_attribution": list(branch_attribution.values()),
        "line_items": {
            "commissions": commission_items,
            "advances": advance_items,
            "commission_withdrawals": commission_withdrawal_items,
            "deductions": deduction_items,
            "overtimes": overtime_items,
            "carried_balances": carried_balance_items,
        },
        "ambiguities": ambiguities,
    }
