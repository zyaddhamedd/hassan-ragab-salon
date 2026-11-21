from datetime import datetime, timezone, date
from app.extensions import db
from sqlalchemy import CheckConstraint

class Expense(db.Model):
    """
    Mini-created expense records.
    Each expense belongs to a branch and must use an allowed category.
    """
    __tablename__ = 'expenses'

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False, index=True)
    expense_category_id = db.Column(db.Integer, db.ForeignKey('expense_categories.id'), nullable=False)
    
    # Financial data - use Numeric for precision
    amount = db.Column(db.Numeric(10, 2), nullable=False)

    # True  = cash physically leaves the register on expense_date (default for all existing rows)
    # False = non-cash accounting entry (e.g., payroll deduction recorded here for audit only)
    is_cash_event = db.Column(
        db.Boolean,
        nullable=False,
        default=True,
        server_default='true'
    )
    
    # True = counts toward business expenses (ADVANCE, COMMISSION, OVERTIME, DEDUCTION)
    # False = cash movement only, NOT a business expense (TIP_PAYOUT)
    # Used to separate treasury cash flow from profit/expense reporting
    is_business_expense = db.Column(
        db.Boolean,
        nullable=False,
        default=True,
        server_default='true'
    )
    
    # Optional notes
    notes = db.Column(db.String(500), nullable=True)
    
    # Date of expense (separate from created_at to allow backdating within limits)
    expense_date = db.Column(db.Date, nullable=False, index=True)
    
    # Audit trail
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    # ── BusinessDay anchor ────────────────────────────────────────────────────
    # Links this expense to the operational BusinessDay during which it was
    # recorded.  Nullable so that legacy rows and any non-cash accounting
    # entries that predate this column are not broken.
    # ondelete='RESTRICT' prevents a BusinessDay from being deleted while it
    # still has attributed expenses.
    business_day_id = db.Column(
        db.Integer,
        db.ForeignKey('business_days.id', ondelete='RESTRICT'),
        nullable=True,
        index=True
    )

    # Constraints
    __table_args__ = (
        CheckConstraint('amount > 0', name='check_positive_amount'),
        db.Index('idx_branch_expense_date', 'branch_id', 'expense_date'),  # Composite index for daily queries
    )

    # Relationships
    branch = db.relationship('Branch', backref=db.backref('expenses', lazy=True))
    expense_category = db.relationship('ExpenseCategory', backref=db.backref('expenses', lazy=True))
    cashier = db.relationship('User', backref=db.backref('expenses_created', lazy=True))
    business_day = db.relationship(
        'BusinessDay',
        foreign_keys=[business_day_id],
        backref=db.backref('expenses', lazy='dynamic')
    )

    def __repr__(self):
        return f'<Expense {self.id} - {self.amount} on {self.expense_date}>'
    
    def to_dict(self):
        """Serialize expense for API response"""
        # Adjust for Egypt Time (UTC+2) for display
        # Note: This is a simple adjustment. Ideally use pytz if available.
        from datetime import timedelta
        local_time = self.created_at + timedelta(hours=2) if self.created_at else None
        
        return {
            'id': self.id,
            'branch_id': self.branch_id,
            'category': self.expense_category.name if self.expense_category else None,
            'category_id': self.expense_category_id,
            'amount': float(self.amount),
            'is_cash_event': self.is_cash_event,
            'is_business_expense': self.is_business_expense,
            'notes': self.notes,
            'expense_date': self.expense_date.isoformat() if self.expense_date else None,
            'cashier': self.cashier.full_name if self.cashier else None,
            'cashier_id': self.created_by,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            # Extract time from adjusted local time for UI display
            'time': local_time.strftime('%H:%M') if local_time else None,
            'business_day_id': self.business_day_id,
        }
