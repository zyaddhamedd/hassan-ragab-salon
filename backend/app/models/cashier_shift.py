"""
Cashier Shift Model
Tracks cashier work shifts for financial accountability and reporting.
"""
import enum
from datetime import datetime, timezone
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.extensions import db


class ShiftStatus(enum.Enum):
    """Shift status enumeration"""
    OPEN = "OPEN"
    CLOSED = "CLOSED"


class CashierShift(db.Model):
    """
    Cashier Shift Session Model
    
    Represents a cashier's work shift with financial accountability.
    Each shift has an opening and closing cash balance derived from the treasury ledger.
    
    CRITICAL RULES:
    - One OPEN shift per cashier per branch
    - Shift does NOT reset treasury ledger
    - Opening balance = current treasury CASH balance at open time
    - Closing balance = current treasury CASH balance at close time
    - All transactions must occur within an active shift
    """
    __tablename__ = 'cashier_shifts'
    
    # Primary Key
    id = db.Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    # Foreign Keys
    branch_id = db.Column(
        db.Integer,
        db.ForeignKey('branches.id'),
        nullable=False,
        index=True
    )
    
    cashier_user_id = db.Column(
        db.Integer,
        db.ForeignKey('users.id'),
        nullable=False,
        index=True
    )
    
    closed_by = db.Column(
        db.Integer,
        db.ForeignKey('users.id'),
        nullable=True
    )
    
    # Timestamps
    opened_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )
    
    closed_at = db.Column(
        db.DateTime(timezone=True),
        nullable=True
    )
    
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )
    
    # Financial Data (derived from treasury)
    opening_cash_balance = db.Column(
        db.Numeric(10, 2),
        nullable=False
    )
    
    closing_cash_balance = db.Column(
        db.Numeric(10, 2),
        nullable=True
    )
    
    # Status
    status = db.Column(
        db.Enum(ShiftStatus, name='shift_status_enum'),
        nullable=False,
        default=ShiftStatus.OPEN
    )
    
    # Relationships
    branch = db.relationship('Branch', backref='cashier_shifts')
    cashier = db.relationship(
        'User',
        foreign_keys=[cashier_user_id],
        backref='shifts_as_cashier'
    )
    closer = db.relationship(
        'User',
        foreign_keys=[closed_by],
        backref='shifts_closed'
    )
    
    # Constraints
    __table_args__ = (
        # Ensure closed_at is after opened_at
        db.CheckConstraint(
            'closed_at IS NULL OR closed_at >= opened_at',
            name='check_close_after_open'
        ),
        # Composite indexes for performance
        db.Index('idx_branch_opened_at', 'branch_id', 'opened_at'),
        db.Index('idx_cashier_status', 'cashier_user_id', 'status'),
        db.Index('idx_branch_status', 'branch_id', 'status'),
    )
    
    def to_dict(self):
        """Serialize shift to dictionary"""
        return {
            'id': str(self.id),
            'branch_id': self.branch_id,
            'branch_name': self.branch.name if self.branch else None,
            'cashier_user_id': self.cashier_user_id,
            'cashier_name': self.cashier.full_name if self.cashier else None,
            'opened_at': self.opened_at.isoformat() if self.opened_at else None,
            'closed_at': self.closed_at.isoformat() if self.closed_at else None,
            'opening_cash_balance': float(self.opening_cash_balance) if self.opening_cash_balance else 0,
            'closing_cash_balance': float(self.closing_cash_balance) if self.closing_cash_balance else None,
            'status': self.status.value,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'closed_by': self.closed_by
        }
    
    def __repr__(self):
        return f"<CashierShift {self.id} - {self.status.value} - Branch {self.branch_id}>"
