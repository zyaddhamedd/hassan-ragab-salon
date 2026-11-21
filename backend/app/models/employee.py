from datetime import datetime, timezone
import enum
from app.extensions import db

class EmployeeType(enum.Enum):
    BARBER = "BARBER"
    ASSISTANT = "ASSISTANT"
    CASHIER = "CASHIER"
    ADMIN = "ADMIN"
    STAFF = "STAFF"

class EmployeeStatus(enum.Enum):
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"

class Employee(db.Model):
    __tablename__ = 'employees'

    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20), nullable=True)
    
    # Use named enum for PostgreSQL
    employee_type = db.Column(db.Enum(EmployeeType, name='employee_type_enum'), nullable=False)
    
    image_url = db.Column(db.String(500), nullable=True)
    
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    
    base_salary = db.Column(db.Float, default=0.0, nullable=False)
    commission_wallet_balance = db.Column(db.Float, default=0.0, nullable=False)  # Cumulative commission wallet
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    
    # New Fields
    is_deleted = db.Column(db.Boolean, default=False, nullable=False)
    status = db.Column(db.Enum(EmployeeStatus, name='employee_status_enum'), default=EmployeeStatus.ACTIVE, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    branch = db.relationship('Branch', backref=db.backref('employees', lazy=True))

    def to_dict(self):
        return {
            'id': self.id,
            'full_name': self.full_name,
            'phone': self.phone,
            'image_url': self.image_url,
            'role': self.employee_type.value,
            'branch_id': self.branch_id,
            'branch_name': self.branch.name if self.branch else None,
            'base_salary': self.base_salary,
            'commission_wallet_balance': self.commission_wallet_balance or 0.0,
            'is_active': self.is_active,
            'status': self.status.value,
            'is_deleted': self.is_deleted,
            'created_at': self.created_at.isoformat(),
            'documents': [doc.to_dict() for doc in self.documents] if hasattr(self, 'documents') and self.documents else [],
            'overtimes': [ot.to_dict() for ot in self.overtimes] if hasattr(self, 'overtimes') and self.overtimes else []
        }

    def __repr__(self):
        return f'<Employee {self.full_name} ({self.employee_type.value})>'
