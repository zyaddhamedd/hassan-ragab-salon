"""
EmployeeFinancialAction Model
==============================

Stage 1 of architectural separation between employee payroll actions
and branch operating expenses.

This table is ADDITIVE ONLY.
- Does NOT replace or modify the `expenses` table.
- Does NOT affect any existing endpoint.
- Will be used in Stage 2 to migrate barber financial actions here.

Action Types:
  ADVANCE             — Cash advance paid out of register now (is_cash_event = True)
  DEDUCTION           — Penalty/deduction from future salary (is_cash_event = False — no cash move today)
  COMMISSION_WITHDRAWAL — Barber draws their earned commission (is_cash_event = True)
  OVERTIME            — Overtime bonus (is_cash_event = True when paid out)
  MANUAL_ADJUSTMENT   — Admin correction entry (cash nature varies per record)
"""

import enum
from datetime import datetime, timezone
from app.extensions import db


class EmployeeActionType(enum.Enum):
    """
    Classifies the nature of a financial action taken on an employee's record.

    ADVANCE             — Cash advance: reduces register cash today, recovered from salary later.
    DEDUCTION           — Salary reduction: no cash movement today; applied at payroll settlement.
    COMMISSION_WITHDRAWAL — Barber collects their earned commission balance from the register.
    OVERTIME            — Overtime bonus paid to the employee.
    MANUAL_ADJUSTMENT   — Admin-initiated correction; set is_cash_event accordingly.
    """
    ADVANCE = "ADVANCE"
    DEDUCTION = "DEDUCTION"
    COMMISSION_WITHDRAWAL = "COMMISSION_WITHDRAWAL"
    OVERTIME = "OVERTIME"
    MANUAL_ADJUSTMENT = "MANUAL_ADJUSTMENT"


class EmployeeFinancialAction(db.Model):
    """
    Employee Financial Action — a clean, typed ledger for payroll-side transactions.

    Key design decisions:
    - `is_cash_event`: True means cash physically leaves the register on this date.
      DEDUCTION is False because it nets against a future salary, not today's cash.
    - `related_invoice_id`: Optional link to the invoice that generated a commission,
      enabling future per-invoice commission audit trail.
    - `created_by`: The user (cashier or admin) who recorded this action.
      Nullable to allow system-generated entries in the future.
    """
    __tablename__ = 'employee_financial_actions'

    # ── Primary Key ────────────────────────────────────────────────────────────
    id = db.Column(db.Integer, primary_key=True)

    # ── Core Foreign Keys ──────────────────────────────────────────────────────
    employee_id = db.Column(
        db.Integer,
        db.ForeignKey('employees.id', ondelete='RESTRICT'),
        nullable=False,
        index=True
    )
    branch_id = db.Column(
        db.Integer,
        db.ForeignKey('branches.id', ondelete='RESTRICT'),
        nullable=False,
        index=True
    )

    # ── Action Classification ──────────────────────────────────────────────────
    action_type = db.Column(
        db.Enum(EmployeeActionType, name='employee_action_type_enum'),
        nullable=False
    )

    # ── Financial Data ────────────────────────────────────────────────────────
    amount = db.Column(
        db.Numeric(12, 2),
        nullable=False
    )

    # True  = cash physically leaves the register today (ADVANCE, COMMISSION_WITHDRAWAL, OVERTIME)
    # False = no immediate cash movement; applied at salary settlement (DEDUCTION)
    is_cash_event = db.Column(
        db.Boolean,
        nullable=False,
        default=False
    )

    # ── Optional Context ──────────────────────────────────────────────────────
    related_invoice_id = db.Column(
        db.Integer,
        db.ForeignKey('invoices.id', ondelete='SET NULL'),
        nullable=True
    )

    notes = db.Column(db.Text, nullable=True)

    # ── Audit Trail ───────────────────────────────────────────────────────────
    created_by = db.Column(
        db.Integer,
        db.ForeignKey('users.id', ondelete='SET NULL'),
        nullable=True
    )

    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    # ── DB-Level Constraints & Indexes ────────────────────────────────────────
    __table_args__ = (
        # Amount must always be positive; sign convention is handled by action_type + is_cash_event
        db.CheckConstraint('amount > 0', name='chk_efa_positive_amount'),
        # Composite index for the most common Treasury query: all actions for a branch on a date range
        db.Index('idx_efa_branch_created', 'branch_id', 'created_at'),
        # Composite index for per-employee ledger lookup
        db.Index('idx_efa_employee_created', 'employee_id', 'created_at'),
    )

    # ── Relationships ─────────────────────────────────────────────────────────
    employee = db.relationship(
        'Employee',
        backref=db.backref('financial_actions', lazy='dynamic')
    )
    branch = db.relationship(
        'Branch',
        backref=db.backref('employee_financial_actions', lazy='dynamic')
    )
    related_invoice = db.relationship(
        'Invoice',
        backref=db.backref('employee_financial_actions', lazy='dynamic')
    )
    creator = db.relationship(
        'User',
        backref=db.backref('employee_financial_actions_created', lazy='dynamic')
    )

    # ── Serialisation ────────────────────────────────────────────────────────
    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'employee_id': self.employee_id,
            'employee_name': self.employee.full_name if self.employee else None,
            'branch_id': self.branch_id,
            'branch_name': self.branch.name if self.branch else None,
            'action_type': self.action_type.value,
            'amount': float(self.amount),
            'is_cash_event': self.is_cash_event,
            'related_invoice_id': self.related_invoice_id,
            'notes': self.notes,
            'created_by': self.created_by,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return (
            f'<EmployeeFinancialAction id={self.id} '
            f'type={self.action_type.value} '
            f'employee_id={self.employee_id} '
            f'amount={self.amount}>'
        )
