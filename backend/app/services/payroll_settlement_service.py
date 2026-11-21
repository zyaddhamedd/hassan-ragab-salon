"""
app/services/payroll_settlement_service.py

Phase 2: Safe Settlement Ledger Foundation Service.
Manages settlement drafts, concurrency-safe approval locking,
cancellations, adjustments, and historical snapshots.
"""

from datetime import date, datetime, timezone
from decimal import Decimal
import uuid
from typing import Dict, List, Optional, Any
from sqlalchemy import or_, and_, func

from app.extensions import db
from app.models.employee import Employee
from app.models.branch import Branch
from app.models.payroll_settlement import (
    PayrollSettlement,
    SettlementStatus,
    SettlementAllocatedItem,
    SettlementAdjustment,
    SettlementPayment,
)
from app.services.payroll_calculation_service import calculate_employee_payroll_preview


class SettlementError(Exception):
    """Base exception for settlement errors."""
    pass


class SettlementConflictError(SettlementError):
    """Raised when an allocated item is already locked in another approved settlement."""
    pass


class SettlementValidationError(SettlementError):
    """Raised when settlement input or state transition is invalid."""
    pass


LOCKED_SETTLEMENT_STATUSES = [
    SettlementStatus.APPROVED,
    SettlementStatus.PARTIALLY_PAID,
    SettlementStatus.PAID,
]


def generate_settlement_number(date_obj: date) -> str:
    """Generate a readable, unique settlement identifier: SET-YYYYMMDD-XXXX."""
    random_suffix = uuid.uuid4().hex[:6].upper()
    return f"SET-{date_obj.strftime('%Y%m%d')}-{random_suffix}"


def create_settlement_draft(
    employee_id: int,
    date_from: date,
    date_to: date,
    base_salary_allocated: float = 0.0,
    adjustments: Optional[List[Dict[str, Any]]] = None,
    notes: Optional[str] = None,
    user_id: int = 1,
) -> PayrollSettlement:
    """
    Creates a new DRAFT settlement with frozen snapshots and allocated source items.
    Items in a DRAFT are not permanently locked until approved.
    """
    employee = db.session.get(Employee, employee_id)
    if not employee:
        raise SettlementValidationError(f"Employee {employee_id} not found")

    if date_from > date_to:
        raise SettlementValidationError("date_from must be earlier than or equal to date_to")

    base_salary_allocated = round(float(base_salary_allocated or 0.0), 2)
    if base_salary_allocated < 0:
        raise SettlementValidationError("base_salary_allocated cannot be negative")

    # 1. Compute dynamic preview of unsettled performance and prior carryovers
    preview = calculate_employee_payroll_preview(employee, date_from, date_to)
    summary = preview["summary"]
    line_items = preview["line_items"]

    # 2. Parse and validate optional adjustments
    manual_additions = 0.0
    manual_deductions = 0.0
    validated_adjustments: List[Dict[str, Any]] = []

    if adjustments:
        for adj in adjustments:
            amt = round(float(adj.get("amount", 0.0)), 2)
            if amt <= 0:
                raise SettlementValidationError("Adjustment amount must be greater than zero")
            reason = (adj.get("reason") or "").strip()
            if not reason:
                raise SettlementValidationError("Mandatory reason required for every manual adjustment")
            category = adj.get("category", "OTHER")
            is_addition = bool(adj.get("is_addition", False))

            validated_adjustments.append({
                "category": category,
                "is_addition": is_addition,
                "amount": amt,
                "reason": reason,
            })
            if is_addition:
                manual_additions = round(manual_additions + amt, 2)
            else:
                manual_deductions = round(manual_deductions + amt, 2)

    # 3. Calculate final net payable for the draft
    # Gross = commissions + overtime + base_salary_allocated + manual_additions
    total_commissions = float(summary["gross_commissions"])
    total_overtime = float(summary["overtime"])
    gross_earnings = round(
        total_commissions + total_overtime + base_salary_allocated + manual_additions, 2
    )

    # Deductions = advances + withdrawals + administrative + manual deductions
    total_advances = float(summary["advances"])
    total_withdrawals = float(summary["commission_withdrawals"])
    total_admin_deductions = float(summary["administrative_deductions"])
    total_deductions = round(
        total_advances + total_withdrawals + total_admin_deductions + manual_deductions, 2
    )

    carried_balance = float(summary.get("carried_balance_applied", 0.0))
    absorbed_id = preview["meta"].get("absorbed_settlement_id")

    # Net = Gross - Deductions + carried_balance
    net_payable = round(gross_earnings - total_deductions + carried_balance, 2)

    # Lineage tokens for absorbed prior settlements
    meta = preview.get("meta", {})
    absorbed_ids = meta.get("absorbed_settlement_ids", [])
    notes_parts = [notes] if notes else []
    if absorbed_ids:
        tokens = " ".join(f"[ABSORBED_SETTLEMENT:{aid}]" for aid in absorbed_ids)
        notes_parts.append(tokens)
    combined_notes = "\n".join(notes_parts) if notes_parts else None

    # 4. Instantiate Master Record
    settlement = PayrollSettlement(
        settlement_number=generate_settlement_number(date_to),
        employee_id=employee.id,
        branch_id=employee.branch_id,
        date_from=date_from,
        date_to=date_to,
        status=SettlementStatus.DRAFT,
        total_barber_commission=summary["barber_commissions"],
        total_assistant_commission=summary["assistant_commissions"],
        total_product_commission=summary["product_commissions"],
        total_commissions_earned=total_commissions,
        total_overtime=total_overtime,
        base_salary_allocated=base_salary_allocated,
        total_gross_earnings=gross_earnings,
        total_advances=total_advances,
        total_commission_withdrawals=total_withdrawals,
        total_money_already_received=summary["money_already_received"],
        total_administrative_deductions=total_admin_deductions,
        total_manual_deductions=manual_deductions,
        total_manual_additions=manual_additions,
        total_deductions=total_deductions,
        carried_balance_applied=carried_balance,
        absorbed_settlement_id=absorbed_id,
        net_payable=net_payable,
        total_paid=0.00,
        remaining_balance=net_payable,
        is_negative_balance=(net_payable < 0),
        notes=combined_notes,
        created_by=user_id,
    )
    db.session.add(settlement)
    db.session.flush()

    # 5. Populate Allocated Items
    # A. Commissions
    for comm in line_items["commissions"]:
        role = comm["earning_role"]
        item_type = f"INVOICE_ITEM_{role}"
        db.session.add(SettlementAllocatedItem(
            settlement_id=settlement.id,
            item_type=item_type,
            source_item_id=comm["item_id"],
            earning_role=role,
            allocated_amount=comm["commission_amount"],
            source_reference=comm["source_id"],
        ))

    # B. Advances
    for adv in line_items["advances"]:
        db.session.add(SettlementAllocatedItem(
            settlement_id=settlement.id,
            item_type="ADVANCE",
            source_item_id=adv["action_id"],
            earning_role=None,
            allocated_amount=adv["amount"],
            source_reference=adv["source_id"],
        ))

    # C. Commission Withdrawals
    for cw in line_items["commission_withdrawals"]:
        db.session.add(SettlementAllocatedItem(
            settlement_id=settlement.id,
            item_type="COMMISSION_WITHDRAWAL",
            source_item_id=cw["action_id"],
            earning_role=None,
            allocated_amount=cw["amount"],
            source_reference=cw["source_id"],
        ))

    # D. Deductions
    for ded in line_items["deductions"]:
        db.session.add(SettlementAllocatedItem(
            settlement_id=settlement.id,
            item_type="DEDUCTION",
            source_item_id=ded["action_id"],
            earning_role=None,
            allocated_amount=ded["amount"],
            source_reference=ded["source_id"],
        ))

    # E. Overtime
    for ot in line_items["overtimes"]:
        origin = ot.get("origin")
        source_id = ot.get("source_id", "")
        parts = source_id.split(":")
        if origin == "FINANCIAL_ACTION":
            item_type = "OVERTIME"
            source_item_id = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
        else:
            item_type = "EMPLOYEE_OVERTIME"
            source_item_id = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else (int(parts[-1]) if parts[-1].isdigit() else 0)

        db.session.add(SettlementAllocatedItem(
            settlement_id=settlement.id,
            item_type=item_type,
            source_item_id=source_item_id,
            earning_role=None,
            allocated_amount=ot["amount"],
            source_reference=source_id,
        ))

    # 6. Populate Manual Adjustments
    for adj in validated_adjustments:
        db.session.add(SettlementAdjustment(
            settlement_id=settlement.id,
            category=adj["category"],
            is_addition=adj["is_addition"],
            amount=adj["amount"],
            reason=adj["reason"],
            created_by=user_id,
        ))

    db.session.commit()
    return settlement


def update_settlement_draft(
    settlement_id: int,
    base_salary_allocated: Optional[float] = None,
    adjustments: Optional[List[Dict[str, Any]]] = None,
    notes: Optional[str] = None,
    user_id: int = 1,
) -> PayrollSettlement:
    """
    Updates an existing DRAFT settlement (fixed salary, adjustments, notes).
    Recomputes financial totals on the backend.
    Strictly forbidden on approved, paid, or cancelled settlements.
    """
    settlement = db.session.get(PayrollSettlement, settlement_id)
    if not settlement:
        raise SettlementValidationError(f"Settlement {settlement_id} not found")

    if settlement.status != SettlementStatus.DRAFT:
        raise SettlementValidationError(f"Cannot edit settlement with status {settlement.status.value}. Only DRAFT settlements are editable.")

    if base_salary_allocated is not None:
        val = round(float(base_salary_allocated or 0.0), 2)
        if val < 0:
            raise SettlementValidationError("base_salary_allocated cannot be negative")
        settlement.base_salary_allocated = val

    if notes is not None:
        settlement.notes = notes

    if adjustments is not None:
        # Clear existing adjustments
        for adj in list(settlement.adjustments):
            db.session.delete(adj)
        db.session.flush()

        manual_additions = 0.0
        manual_deductions = 0.0
        for adj in adjustments:
            amt = round(float(adj.get("amount", 0.0)), 2)
            if amt <= 0:
                raise SettlementValidationError("Adjustment amount must be greater than zero")
            reason = (adj.get("reason") or "").strip()
            if not reason:
                raise SettlementValidationError("Mandatory reason required for every manual adjustment")
            category = adj.get("category", "OTHER")
            is_addition = bool(adj.get("is_addition", False))

            db.session.add(SettlementAdjustment(
                settlement_id=settlement.id,
                category=category,
                is_addition=is_addition,
                amount=amt,
                reason=reason,
                created_by=user_id,
            ))
            if is_addition:
                manual_additions = round(manual_additions + amt, 2)
            else:
                manual_deductions = round(manual_deductions + amt, 2)

        settlement.total_manual_additions = manual_additions
        settlement.total_manual_deductions = manual_deductions

    # Recalculate totals on backend
    gross = round(
        float(settlement.total_commissions_earned) +
        float(settlement.total_overtime) +
        float(settlement.base_salary_allocated) +
        float(settlement.total_manual_additions),
        2
    )
    deductions = round(
        float(settlement.total_advances) +
        float(settlement.total_commission_withdrawals) +
        float(settlement.total_administrative_deductions) +
        float(settlement.total_manual_deductions),
        2
    )
    carried = float(settlement.carried_balance_applied)
    net_payable = round(gross - deductions + carried, 2)

    settlement.total_gross_earnings = gross
    settlement.total_deductions = deductions
    settlement.net_payable = net_payable
    settlement.remaining_balance = net_payable
    settlement.is_negative_balance = (net_payable < 0)

    db.session.commit()
    return settlement


def discard_settlement_draft(settlement_id: int, user_id: int) -> None:
    """
    Discards an unapproved DRAFT settlement, deleting it and its transient allocations.
    Approved or paid settlements cannot be discarded.
    """
    settlement = db.session.get(PayrollSettlement, settlement_id)
    if not settlement:
        raise SettlementValidationError(f"Settlement {settlement_id} not found")

    if settlement.status != SettlementStatus.DRAFT:
        raise SettlementValidationError(f"Cannot discard settlement with status {settlement.status.value}. Only DRAFT settlements can be discarded.")

    db.session.delete(settlement)
    db.session.commit()


def approve_settlement(
    settlement_id: int,
    user_id: int,
    allow_overlapping_salary_override: bool = False,
    salary_override_reason: Optional[str] = None,
    user_role: Optional[str] = None,
) -> PayrollSettlement:
    """
    Approves a draft settlement with pessimistic row-locking on the employee.
    Enforces:
    1. Revalidation against exact live financial source items (detects refunds, new advances, etc.).
    2. Zero allocated-item conflict against other approved settlements.
    3. Fixed salary duplication guard with documented SUPER_ADMIN/EXEC_ADMIN override only.
    """
    settlement = db.session.get(PayrollSettlement, settlement_id)
    if not settlement:
        raise SettlementValidationError(f"Settlement {settlement_id} not found")

    if settlement.status != SettlementStatus.DRAFT:
        raise SettlementValidationError(f"Cannot approve settlement with status {settlement.status.value}")

    # Pessimistic concurrency lock on employee row
    employee = db.session.query(Employee).filter_by(id=settlement.employee_id).with_for_update().first()
    if not employee:
        raise SettlementValidationError(f"Employee {settlement.employee_id} not found")

    # 1. CONCURRENCY GUARD: Check every allocated item against all approved/paid settlements
    for item in settlement.allocated_items:
        conflict = (
            db.session.query(SettlementAllocatedItem)
            .join(PayrollSettlement, PayrollSettlement.id == SettlementAllocatedItem.settlement_id)
            .filter(
                PayrollSettlement.id != settlement.id,
                PayrollSettlement.status.in_(LOCKED_SETTLEMENT_STATUSES),
                SettlementAllocatedItem.item_type == item.item_type,
                SettlementAllocatedItem.source_item_id == item.source_item_id,
            )
            .first()
        )
        if conflict:
            raise SettlementConflictError(
                f"Source item '{item.source_reference}' was already locked by approved settlement "
                f"#{conflict.settlement.settlement_number}"
            )

    # Check carried settlements concurrency
    for aid in settlement.absorbed_settlement_ids:
        prior_settlement = db.session.get(PayrollSettlement, aid)
        if prior_settlement and prior_settlement.absorbed_by and prior_settlement.absorbed_by.id != settlement.id:
            raise SettlementConflictError(
                f"Prior settlement #{prior_settlement.settlement_number} was already absorbed by "
                f"#{prior_settlement.absorbed_by.settlement_number}"
            )

    # 2. LIVE REVALIDATION & EXACT SOURCE IDENTITY GUARD: Check if source transactions changed
    fresh_preview = calculate_employee_payroll_preview(employee, settlement.date_from, settlement.date_to)
    fresh_line_items = fresh_preview["line_items"]
    fresh_summary = fresh_preview["summary"]

    from collections import Counter
    fresh_source_items = Counter()
    for comm in fresh_line_items.get("commissions", []):
        role = comm["earning_role"]
        fresh_source_items[(f"INVOICE_ITEM_{role}", int(comm["item_id"]), round(float(comm["commission_amount"]), 2))] += 1

    for adv in fresh_line_items.get("advances", []):
        fresh_source_items[("ADVANCE", int(adv["action_id"]), round(float(adv["amount"]), 2))] += 1

    for cw in fresh_line_items.get("commission_withdrawals", []):
        fresh_source_items[("COMMISSION_WITHDRAWAL", int(cw["action_id"]), round(float(cw["amount"]), 2))] += 1

    for ded in fresh_line_items.get("deductions", []):
        fresh_source_items[("DEDUCTION", int(ded["action_id"]), round(float(ded["amount"]), 2))] += 1

    for ot in fresh_line_items.get("overtimes", []):
        origin = ot.get("origin")
        source_id = ot.get("source_id", "")
        parts = source_id.split(":")
        if origin == "FINANCIAL_ACTION":
            item_type = "OVERTIME"
            source_item_id = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
        else:
            item_type = "EMPLOYEE_OVERTIME"
            source_item_id = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else (int(parts[-1]) if parts[-1].isdigit() else 0)
        fresh_source_items[(item_type, source_item_id, round(float(ot["amount"]), 2))] += 1

    draft_source_items = Counter()
    for item in settlement.allocated_items:
        draft_source_items[(str(item.item_type), int(item.source_item_id), round(float(item.allocated_amount), 2))] += 1

    if draft_source_items != fresh_source_items:
        removed_or_changed = list((draft_source_items - fresh_source_items).keys())
        added_or_changed = list((fresh_source_items - draft_source_items).keys())
        category_map = {
            "ADVANCE": "advances",
            "COMMISSION_WITHDRAWAL": "withdrawals",
            "DEDUCTION": "admin deductions",
            "OVERTIME": "overtime",
            "EMPLOYEE_OVERTIME": "overtime",
        }
        affected_types = set()
        for k in removed_or_changed + added_or_changed:
            t = k[0]
            if t.startswith("INVOICE_ITEM"):
                affected_types.add("commissions")
            else:
                affected_types.add(category_map.get(t, t.lower()))
        type_str = ", ".join(sorted(affected_types))

        raise SettlementConflictError(
            f"Underlying financial sources changed since draft creation ({type_str}): "
            f"{len(removed_or_changed)} removed/modified, {len(added_or_changed)} added/modified. "
            f"Approval blocked. Please refresh or update draft."
        )

    stale_mismatches = []
    if float(fresh_summary["gross_commissions"]) != float(settlement.total_commissions_earned):
        stale_mismatches.append(f"commissions (draft={settlement.total_commissions_earned}, live={fresh_summary['gross_commissions']})")
    if float(fresh_summary["advances"]) != float(settlement.total_advances):
        stale_mismatches.append(f"advances (draft={settlement.total_advances}, live={fresh_summary['advances']})")
    if float(fresh_summary["commission_withdrawals"]) != float(settlement.total_commission_withdrawals):
        stale_mismatches.append(f"withdrawals (draft={settlement.total_commission_withdrawals}, live={fresh_summary['commission_withdrawals']})")
    if float(fresh_summary["administrative_deductions"]) != float(settlement.total_administrative_deductions):
        stale_mismatches.append(f"admin deductions (draft={settlement.total_administrative_deductions}, live={fresh_summary['administrative_deductions']})")
    if float(fresh_summary["overtime"]) != float(settlement.total_overtime):
        stale_mismatches.append(f"overtime (draft={settlement.total_overtime}, live={fresh_summary['overtime']})")

    fresh_absorbed_ids = set(fresh_preview["meta"].get("absorbed_settlement_ids", []))
    draft_absorbed_ids = set(settlement.absorbed_settlement_ids)
    if fresh_absorbed_ids != draft_absorbed_ids:
        stale_mismatches.append(f"carried settlements lineage (draft={draft_absorbed_ids}, live={fresh_absorbed_ids})")
    if float(fresh_summary["carried_balance_applied"]) != float(settlement.carried_balance_applied):
        stale_mismatches.append(f"carried balance (draft={settlement.carried_balance_applied}, live={fresh_summary['carried_balance_applied']})")

    if stale_mismatches:
        raise SettlementConflictError(
            f"Underlying financial sources changed since draft creation: {', '.join(stale_mismatches)}. "
            f"Approval blocked. Please refresh or update draft."
        )

    # 3. FIXED SALARY DUPLICATION GUARD
    if settlement.base_salary_allocated > 0:
        overlapping_salary_conflict = (
            PayrollSettlement.query.filter(
                PayrollSettlement.id != settlement.id,
                PayrollSettlement.employee_id == settlement.employee_id,
                PayrollSettlement.status.in_(LOCKED_SETTLEMENT_STATUSES),
                PayrollSettlement.base_salary_allocated > 0,
                PayrollSettlement.date_from <= settlement.date_to,
                PayrollSettlement.date_to >= settlement.date_from,
            ).first()
        )
        if overlapping_salary_conflict:
            override_reason_clean = (salary_override_reason or "").strip()
            if not allow_overlapping_salary_override:
                raise SettlementValidationError(
                    f"Fixed salary was already allocated in overlapping approved settlement #{overlapping_salary_conflict.settlement_number} "
                    f"({overlapping_salary_conflict.date_from} to {overlapping_salary_conflict.date_to}). "
                    f"Overlapping fixed salary allocation blocked without explicit authorized manager override reason."
                )
            if not override_reason_clean:
                raise SettlementValidationError(
                    "A non-empty salary_override_reason is strictly required to override overlapping fixed salary."
                )
            if user_role and user_role not in ("SUPER_ADMIN", "EXEC_ADMIN"):
                raise SettlementValidationError(
                    "Only SUPER_ADMIN and EXEC_ADMIN may authorize overlapping fixed salary overrides."
                )
            settlement.notes = f"{settlement.notes or ''}\n[OVERRIDE APPROVED by user #{user_id}]: Overlapping salary approved against #{overlapping_salary_conflict.settlement_number}. Reason: {override_reason_clean}".strip()

    # Transition to APPROVED
    settlement.status = SettlementStatus.APPROVED
    settlement.approved_by = user_id
    settlement.approved_at = datetime.now(timezone.utc)
    db.session.commit()
    return settlement


def cancel_settlement(settlement_id: int, reason: str, user_id: int) -> PayrollSettlement:
    """
    Cancels a settlement, releasing all allocated source items.
    Blocked if actual payments have already been disbursed.
    """
    settlement = db.session.get(PayrollSettlement, settlement_id)
    if not settlement:
        raise SettlementValidationError(f"Settlement {settlement_id} not found")

    if settlement.status in (SettlementStatus.PAID, SettlementStatus.PARTIALLY_PAID):
        raise SettlementValidationError("Cannot cancel a settlement with active payments recorded.")

    if settlement.status == SettlementStatus.CANCELLED:
        raise SettlementValidationError("Settlement is already cancelled.")

    clean_reason = (reason or "").strip()
    if not clean_reason:
        raise SettlementValidationError("Mandatory cancellation reason required")

    settlement.status = SettlementStatus.CANCELLED
    settlement.cancelled_by = user_id
    settlement.cancelled_at = datetime.now(timezone.utc)
    settlement.cancellation_reason = clean_reason
    db.session.commit()
    return settlement


def get_settlement_by_id(settlement_id: int) -> Optional[Dict[str, Any]]:
    """Fetches full settlement details including items, adjustments, and payments."""
    settlement = db.session.get(PayrollSettlement, settlement_id)
    if not settlement:
        return None

    data = settlement.to_dict()
    data["allocated_items"] = [item.to_dict() for item in settlement.allocated_items]
    data["adjustments"] = [adj.to_dict() for adj in settlement.adjustments]
    data["payments"] = [pmt.to_dict() for pmt in settlement.payments]
    return data


def list_employee_settlements(
    employee_id: int,
    status: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    page: int = 1,
    per_page: int = 20,
) -> Dict[str, Any]:
    """Lists historical settlements for an employee with pagination."""
    query = PayrollSettlement.query.filter_by(employee_id=employee_id)
    if status:
        try:
            status_enum = SettlementStatus(status.upper())
            query = query.filter_by(status=status_enum)
        except ValueError:
            pass

    if date_from:
        query = query.filter(PayrollSettlement.date_to >= date_from)
    if date_to:
        query = query.filter(PayrollSettlement.date_from <= date_to)

    total = query.count()
    items = (
        query.order_by(PayrollSettlement.date_to.desc(), PayrollSettlement.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    return {
        "items": [item.to_dict() for item in items],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page if per_page else 1,
    }
