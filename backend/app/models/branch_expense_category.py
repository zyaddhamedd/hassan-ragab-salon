from datetime import datetime, timezone
from app.extensions import db

class BranchExpenseCategory(db.Model):
    """
    Controls which expense categories are available for each branch.
    Admin assigns categories to branches through this model.
    """
    __tablename__ = 'branch_expense_categories'

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    expense_category_id = db.Column(db.Integer, db.ForeignKey('expense_categories.id'), nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    
    # Composite unique constraint to prevent duplicate assignments
    __table_args__ = (
        db.UniqueConstraint('branch_id', 'expense_category_id', name='uq_branch_expense_category'),
    )

    # Relationships
    branch = db.relationship('Branch', backref=db.backref('expense_categories', lazy=True))
    expense_category = db.relationship('ExpenseCategory', backref=db.backref('branch_assignments', lazy=True))

    def __repr__(self):
        return f'<BranchExpenseCategory branch_id={self.branch_id} category_id={self.expense_category_id}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'branch_id': self.branch_id,
            'expense_category_id': self.expense_category_id,
            'category_name': self.expense_category.name if self.expense_category else None,
            'is_active': self.is_active
        }
