from datetime import datetime, timezone
from app.extensions import db

class ExpenseCategory(db.Model):
    """
    Admin-controlled global expense categories.
    Categories are defined by Admin and can be assigned to branches.
    """
    __tablename__ = 'expense_categories'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    code = db.Column(db.String(50), nullable=False, unique=True, index=True)  # Stable identifier for treasury mapping
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    def __repr__(self):
        return f'<ExpenseCategory {self.name} ({self.code})>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'code': self.code,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
