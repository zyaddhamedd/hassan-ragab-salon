"""
app/models/payroll_settlement.py

Phase 2: Safe Settlement Ledger Foundation Models
================================================
Additive tables for persisting individual employee settlements, item allocations,
manual adjustments, and payment records without mutating legacy tables.
"""

from datetime import datetime, timezone
import enum
from app.extensions import db


class SettlementStatus(enum.Enum):
    """
    Lifecycle status of a payroll settlement.
    DRAFT: Created and previewed; source items are not permanently locked.
    APPROVED: Confirmed by manager; financial snapshots frozen and source items locked.
    PARTIALLY_PAID: Approved with partial payments recorded; remaining_balance > 0.
    PAID: Approved and fully disbursed; remaining_balance <= 0.
    CANCELLED: Voided before or after approval; releases all allocated items.
    """
    DRAFT = "DRAFT"
    APPROVED = "APPROVED"
    PARTIALLY_PAID = "PARTIALLY_PAID"
    PAID = "PAID"
    CANCELLED = "CANCELLED"


class PayrollSettlement(db.Model):
    """
    Master record for an approved or draft settlement snapshot.
    Preserves exact historical calculations even if prices or rates change.
    """
    __tablename__ = 'payroll_settlements'

    id = db.Column(db.Integer, primary_key=True)
    settlement_number = db.Column(db.String(64), unique=True, nullable=False, index=True)
    employee_id = db.Column(db.Integer, db.ForeignKey('employees.id', ondelete='RESTRICT'), nullable=False, index=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='RESTRICT'), nullable=False, index=True)
    date_from = db.Column(db.Date, nullable=False, index=True)
    date_to = db.Column(db.Date, nullable=False, index=True)

    status = db.Column(
        db.Enum(SettlementStatus, name='settlement_status_enum'),
        default=SettlementStatus.DRAFT,
        nullable=False,
        index=True
    )

    # ── Financial Snapshots ──────────────────────────────────────────────────
    total_barber_commission = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    total_assistant_commission = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    total_product_commission = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    total_commissions_earned = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    total_overtime = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    base_salary_allocated = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    total_gross_earnings = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)

    # ── Deduction Snapshots ──────────────────────────────────────────────────
    total_advances = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    total_commission_withdrawals = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    total_money_already_received = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    total_administrative_deductions = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    total_manual_deductions = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    total_manual_additions = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    total_deductions = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)

    # ── Prior Settlement Lineage (No duplicate artificial transactions) ──────
    carried_balance_applied = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    absorbed_settlement_id = db.Column(
        db.Integer,
        db.ForeignKey('payroll_settlements.id', ondelete='SET NULL'),
        nullable=True
    )

    # ── Net and Balance ──────────────────────────────────────────────────────
    net_payable = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    total_paid = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    remaining_balance = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    is_negative_balance = db.Column(db.Boolean, default=False, nullable=False)

    # ── Metadata & Audit Trail ───────────────────────────────────────────────
    notes = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False)
    approved_by = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    cancelled_by = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    cancellation_reason = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False
    )
    approved_at = db.Column(db.DateTime(timezone=True), nullable=True)
    cancelled_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # ── Relationships ────────────────────────────────────────────────────────
    employee = db.relationship('Employee', backref=db.backref('payroll_settlements', lazy='dynamic'))
    branch = db.relationship('Branch', backref=db.backref('payroll_settlements', lazy='dynamic'))
    creator = db.relationship('User', foreign_keys=[created_by])
    approver = db.relationship('User', foreign_keys=[approved_by])
    canceller = db.relationship('User', foreign_keys=[cancelled_by])
    absorbed_settlement = db.relationship(
        'PayrollSettlement',
        remote_side=[id],
        foreign_keys=[absorbed_settlement_id],
        backref=db.backref('absorbed_by_settlements', lazy='select')
    )

    @property
    def absorbed_settlement_ids(self):
        """Returns list of settlement IDs absorbed by this settlement."""
        import re
        ids = set()
        if self.absorbed_settlement_id:
            ids.add(self.absorbed_settlement_id)
        if self.notes:
            found = re.findall(r'\[ABSORBED_SETTLEMENT:(\d+)\]', self.notes)
            for f in found:
                ids.add(int(f))
        return sorted(ids)

    @property
    def absorbed_by(self):
        """
        Returns the active (APPROVED, PARTIALLY_PAID, PAID) settlement that absorbed this settlement's balance.
        Supports both direct foreign key lineage and multiple absorbed settlement lineage.
        """
        for s in (self.absorbed_by_settlements or []):
            if s.status in (SettlementStatus.APPROVED, SettlementStatus.PARTIALLY_PAID, SettlementStatus.PAID):
                return s

        # Also check multi-absorption lineage in notes
        token = f"[ABSORBED_SETTLEMENT:{self.id}]"
        active_absorbing = (
            PayrollSettlement.query.filter(
                PayrollSettlement.employee_id == self.employee_id,
                PayrollSettlement.status.in_([
                    SettlementStatus.APPROVED,
                    SettlementStatus.PARTIALLY_PAID,
                    SettlementStatus.PAID,
                ]),
                PayrollSettlement.notes.like(f"%{token}%"),
            )
            .order_by(PayrollSettlement.id.desc())
            .first()
        )
        if active_absorbing:
            return active_absorbing

        return None

    allocated_items = db.relationship(
        'SettlementAllocatedItem',
        backref='settlement',
        cascade='all, delete-orphan',
        lazy='selectin'
    )
    adjustments = db.relationship(
        'SettlementAdjustment',
        backref='settlement',
        cascade='all, delete-orphan',
        lazy='selectin'
    )
    payments = db.relationship(
        'SettlementPayment',
        backref='settlement',
        cascade='all, delete-orphan',
        lazy='selectin'
    )

    def to_dict(self):
        absorbing = self.absorbed_by
        is_absorbed = absorbing is not None
        effective_remaining_balance = 0.00 if is_absorbed else float(self.remaining_balance)
        absorbed_ids = self.absorbed_settlement_ids

        return {
            'id': self.id,
            'settlement_number': self.settlement_number,
            'employee_id': self.employee_id,
            'employee_name': self.employee.full_name if self.employee else 'Unknown',
            'branch_id': self.branch_id,
            'branch_name': self.branch.name if self.branch else 'Unknown',
            'date_from': self.date_from.isoformat(),
            'date_to': self.date_to.isoformat(),
            'status': self.status.value,
            'summary': {
                'total_barber_commission': float(self.total_barber_commission),
                'total_assistant_commission': float(self.total_assistant_commission),
                'total_product_commission': float(self.total_product_commission),
                'total_commissions_earned': float(self.total_commissions_earned),
                'total_overtime': float(self.total_overtime),
                'base_salary_allocated': float(self.base_salary_allocated),
                'total_gross_earnings': float(self.total_gross_earnings),
                'total_advances': float(self.total_advances),
                'total_commission_withdrawals': float(self.total_commission_withdrawals),
                'total_money_already_received': float(self.total_money_already_received),
                'total_administrative_deductions': float(self.total_administrative_deductions),
                'total_manual_deductions': float(self.total_manual_deductions),
                'total_manual_additions': float(self.total_manual_additions),
                'total_deductions': float(self.total_deductions),
                'carried_balance_applied': float(self.carried_balance_applied),
                'net_payable': float(self.net_payable),
                'total_paid': float(self.total_paid),
                'remaining_balance': float(self.remaining_balance),
                'effective_remaining_balance': effective_remaining_balance,
                'is_absorbed': is_absorbed,
                'absorbed_by_settlement_id': absorbing.id if absorbing else None,
                'absorbed_by_settlement_number': absorbing.settlement_number if absorbing else None,
                'is_negative_balance': self.is_negative_balance,
            },
            'absorbed_settlement_id': self.absorbed_settlement_id,
            'absorbed_settlement_ids': absorbed_ids,
            'absorbed_by_settlement_id': absorbing.id if absorbing else None,
            'absorbed_by_settlement_number': absorbing.settlement_number if absorbing else None,
            'is_absorbed': is_absorbed,
            'notes': self.notes,
            'created_by': self.created_by,
            'approved_by': self.approved_by,
            'cancelled_by': self.cancelled_by,
            'cancellation_reason': self.cancellation_reason,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'approved_at': self.approved_at.isoformat() if self.approved_at else None,
            'cancelled_at': self.cancelled_at.isoformat() if self.cancelled_at else None,
            'allocated_items_count': len(self.allocated_items),
            'adjustments_count': len(self.adjustments),
            'payments_count': len(self.payments),
        }


class SettlementAllocatedItem(db.Model):
    """
    Junction record locking specific source items to a settlement.
    Prevents double-counting or double-deducting across overlapping ranges.
    """
    __tablename__ = 'settlement_allocated_items'

    id = db.Column(db.Integer, primary_key=True)
    settlement_id = db.Column(
        db.Integer,
        db.ForeignKey('payroll_settlements.id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )
    # Distinct classification: INVOICE_ITEM_BARBER, INVOICE_ITEM_ASSISTANT, INVOICE_ITEM_PRODUCT,
    # ADVANCE, COMMISSION_WITHDRAWAL, DEDUCTION, OVERTIME
    item_type = db.Column(db.String(32), nullable=False)
    source_item_id = db.Column(db.Integer, nullable=False)
    earning_role = db.Column(db.String(20), nullable=True)  # BARBER, ASSISTANT, PRODUCT_SALES, or None
    allocated_amount = db.Column(db.Numeric(10, 2), nullable=False)
    source_reference = db.Column(db.String(64), nullable=False)  # e.g. INVOICE_ITEM:1042:BARBER
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        db.UniqueConstraint(
            'settlement_id',
            'item_type',
            'source_item_id',
            name='uq_settlement_allocated_item'
        ),
        db.Index('idx_allocated_item_lookup', 'item_type', 'source_item_id'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'settlement_id': self.settlement_id,
            'item_type': self.item_type,
            'source_item_id': self.source_item_id,
            'earning_role': self.earning_role,
            'allocated_amount': float(self.allocated_amount),
            'source_reference': self.source_reference,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class SettlementAdjustment(db.Model):
    """
    Optional manual adjustment on a settlement with mandatory textual justification.
    """
    __tablename__ = 'settlement_adjustments'

    id = db.Column(db.Integer, primary_key=True)
    settlement_id = db.Column(
        db.Integer,
        db.ForeignKey('payroll_settlements.id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )
    category = db.Column(db.String(32), nullable=False)  # BONUS, PENALTY, ABSENCE, OTHER_ADDITION, OTHER_DEDUCTION
    is_addition = db.Column(db.Boolean, nullable=False)  # True = Add, False = Deduct
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    reason = db.Column(db.String(500), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        db.CheckConstraint('amount > 0', name='chk_settlement_adjustment_positive_amount'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'settlement_id': self.settlement_id,
            'category': self.category,
            'is_addition': self.is_addition,
            'amount': float(self.amount),
            'reason': self.reason,
            'created_by': self.created_by,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class SettlementPayment(db.Model):
    """
    Disbursement record against an approved settlement.
    Supports multiple partial disbursements without duplicating carryovers.
    """
    __tablename__ = 'settlement_payments'

    id = db.Column(db.Integer, primary_key=True)
    settlement_id = db.Column(
        db.Integer,
        db.ForeignKey('payroll_settlements.id', ondelete='RESTRICT'),
        nullable=False,
        index=True
    )
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    payment_method = db.Column(db.String(32), nullable=False)  # CASH, BANK_TRANSFER, VODAFONE_CASH, INSTAPAY, OTHER
    treasury_expense_id = db.Column(db.Integer, db.ForeignKey('expenses.id', ondelete='SET NULL'), nullable=True)
    idempotency_key = db.Column(db.String(64), unique=True, nullable=False, index=True)
    is_reversed = db.Column(db.Boolean, default=False, nullable=False)
    reversal_reason = db.Column(db.Text, nullable=True)
    reversed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    reversed_by = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    paid_by = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False)
    paid_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    notes = db.Column(db.Text, nullable=True)

    __table_args__ = (
        db.CheckConstraint('amount > 0', name='chk_settlement_payment_positive_amount'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'settlement_id': self.settlement_id,
            'amount': float(self.amount),
            'payment_method': self.payment_method,
            'treasury_expense_id': self.treasury_expense_id,
            'idempotency_key': self.idempotency_key,
            'is_reversed': self.is_reversed,
            'reversal_reason': self.reversal_reason,
            'reversed_at': self.reversed_at.isoformat() if self.reversed_at else None,
            'paid_by': self.paid_by,
            'paid_at': self.paid_at.isoformat() if self.paid_at else None,
            'notes': self.notes,
        }
