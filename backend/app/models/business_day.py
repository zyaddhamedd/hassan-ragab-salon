"""
BusinessDay Model
=================

Represents a single operational "day" for a branch — opened by a cashier
at the start of business and closed when the physical register is reconciled.

Key design decisions:
- One OPEN BusinessDay per branch at a time (enforced by partial unique index).
- opening_balance  — cash in the register when the day was opened.
- cash_in          — total CASH revenue collected during this business day
                     (set at close, immutable thereafter).
- cash_out         — total cash that physically left the register during this
                     business day (set at close, immutable thereafter).
- theoretical_balance — what the register *should* contain at close time,
                        computed by the close-day endpoint from financial data.
- closing_balance  — what the cashier *actually* counted in the register.
- variance         = closing_balance - theoretical_balance (negative = shortage).
- previous_day_id  — FK to the immediately preceding BusinessDay for this
                     branch, creating an auditable chain of custody.
"""

import enum
from datetime import datetime, timezone
from app.extensions import db


class BusinessDayStatus(enum.Enum):
    OPEN   = "OPEN"
    CLOSED = "CLOSED"


class BusinessDay(db.Model):
    __tablename__ = 'business_days'

    # ── Primary Key ─────────────────────────────────────────────────────────
    id = db.Column(db.Integer, primary_key=True)

    # ── Core Foreign Keys ────────────────────────────────────────────────────
    branch_id = db.Column(
        db.Integer,
        db.ForeignKey('branches.id', ondelete='RESTRICT'),
        nullable=False,
        index=True
    )

    opened_by = db.Column(
        db.Integer,
        db.ForeignKey('employees.id', ondelete='RESTRICT'),
        nullable=False
    )

    closed_by = db.Column(
        db.Integer,
        db.ForeignKey('employees.id', ondelete='SET NULL'),
        nullable=True
    )

    # ── Status ───────────────────────────────────────────────────────────────
    status = db.Column(
        db.Enum(BusinessDayStatus, name='business_day_status_enum'),
        nullable=False,
        default=BusinessDayStatus.OPEN
    )

    # ── Timestamps ───────────────────────────────────────────────────────────
    opened_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc)
    )

    closed_at = db.Column(
        db.DateTime(timezone=True),
        nullable=True
    )

    created_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc)
    )

    # ── Financial Balances ───────────────────────────────────────────────────
    # Cash physically in the register when the day was opened.
    opening_balance = db.Column(
        db.Numeric(10, 2),
        nullable=False,
        default=0
    )

    # What the register *should* contain at close time (computed at close).
    # Formula: opening_balance + CASH revenue IN − cash_out
    theoretical_balance = db.Column(
        db.Numeric(10, 2),
        nullable=True
    )

    # What the cashier physically counted in the register at close time.
    closing_balance = db.Column(
        db.Numeric(10, 2),
        nullable=True
    )

    # closing_balance − theoretical_balance.
    # Negative = cash shortage. Positive = overage.
    variance = db.Column(
        db.Numeric(10, 2),
        nullable=True
    )

    # ── Immutable Close-Time Ledger Snapshot ─────────────────────────────────
    # Total CASH revenue collected during this business day.
    # Populated at close time; never recomputed afterward.
    cash_in = db.Column(
        db.Numeric(12, 2),
        nullable=False,
        default=0
    )

    # Total cash that physically left the register during this business day.
    # Populated at close time; never recomputed afterward.
    cash_out = db.Column(
        db.Numeric(12, 2),
        nullable=False,
        default=0
    )

    # ── Chain-of-Custody Link ─────────────────────────────────────────────────
    # FK to the immediately preceding BusinessDay for this branch.
    # NULL on the very first day a branch ever opens.
    # Together with the next_day backref this forms an auditable linked list.
    previous_day_id = db.Column(
        db.Integer,
        db.ForeignKey('business_days.id', ondelete='SET NULL'),
        nullable=True
    )

    # ── DB-Level Constraints & Indexes ───────────────────────────────────────
    __table_args__ = (
        # Enforce at most one OPEN day per branch at any time.
        # A partial unique index only covers rows where status = 'OPEN',
        # so CLOSED rows for the same branch are allowed freely.
        # NOTE: SQLAlchemy cannot express partial indexes via __table_args__
        # directly; the index is created in the Alembic migration instead.
        db.Index('idx_business_days_branch_id', 'branch_id'),
        db.Index('idx_business_days_opened_at', 'branch_id', 'opened_at'),
    )

    # ── Relationships ────────────────────────────────────────────────────────
    branch = db.relationship(
        'Branch',
        backref=db.backref('business_days', lazy='dynamic')
    )
    opener = db.relationship(
        'Employee',
        foreign_keys=[opened_by],
        backref=db.backref('business_days_opened', lazy='dynamic')
    )
    closer = db.relationship(
        'Employee',
        foreign_keys=[closed_by],
        backref=db.backref('business_days_closed', lazy='dynamic')
    )
    # Self-referential chain link.
    # previous_day  — the BusinessDay that preceded this one for the same branch.
    # next_day      — the BusinessDay that followed this one (via backref).
    previous_day = db.relationship(
        'BusinessDay',
        foreign_keys=[previous_day_id],
        remote_side='BusinessDay.id',
        backref=db.backref('next_day', uselist=False),
        uselist=False
    )

    # ── Serialisation ────────────────────────────────────────────────────────
    def to_dict(self) -> dict:
        return {
            'id':                  self.id,
            'branch_id':           self.branch_id,
            'branch_name':         self.branch.name if self.branch else None,
            'status':              self.status.value,
            'opened_at':           self.opened_at.isoformat() if self.opened_at else None,
            'opened_by':           self.opened_by,
            'opener_name':         self.opener.full_name if self.opener else None,
            'closed_at':           self.closed_at.isoformat() if self.closed_at else None,
            'closed_by':           self.closed_by,
            'closer_name':         self.closer.full_name if self.closer else None,
            'opening_balance':     float(self.opening_balance) if self.opening_balance is not None else 0.0,
            'cash_in':             float(self.cash_in) if self.cash_in is not None else 0.0,
            'cash_out':            float(self.cash_out) if self.cash_out is not None else 0.0,
            'theoretical_balance': float(self.theoretical_balance) if self.theoretical_balance is not None else None,
            'closing_balance':     float(self.closing_balance) if self.closing_balance is not None else None,
            'variance':            float(self.variance) if self.variance is not None else None,
            'previous_day_id':     self.previous_day_id,
            'created_at':          self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return (
            f'<BusinessDay id={self.id} '
            f'branch_id={self.branch_id} '
            f'status={self.status.value}>'
        )
