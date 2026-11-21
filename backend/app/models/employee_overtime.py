from datetime import datetime, timezone, date
from app.extensions import db

class EmployeeOvertime(db.Model):
    __tablename__ = 'employee_overtime'

    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=False, index=True)
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    reason = db.Column(db.String(500), nullable=True)
    date = db.Column(db.Date, nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationship
    employee = db.relationship('Employee', backref=db.backref('overtimes', lazy=True, cascade='all, delete-orphan'))

    def to_dict(self):
        return {
            'id': self.id,
            'employee_id': self.employee_id,
            'amount': float(self.amount),
            'reason': self.reason,
            'date': self.date.isoformat(),
            'created_at': self.created_at.isoformat()
        }
