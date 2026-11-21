from datetime import datetime, timezone
from app.extensions import db

class EmployeeTransfer(db.Model):
    __tablename__ = 'employee_transfers'

    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=False)
    from_branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    to_branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    transfer_date = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    
    # Relationships
    employee = db.relationship('Employee', backref=db.backref('transfers', lazy=True))
    from_branch = db.relationship('Branch', foreign_keys=[from_branch_id])
    to_branch = db.relationship('Branch', foreign_keys=[to_branch_id])

    def to_dict(self):
        return {
            'id': self.id,
            'employee_id': self.employee_id,
            'from_branch_id': self.from_branch_id,
            'from_branch_name': self.from_branch.name if self.from_branch else 'Unknown',
            'to_branch_id': self.to_branch_id,
            'to_branch_name': self.to_branch.name if self.to_branch else 'Unknown',
            'transfer_date': self.transfer_date.isoformat()
        }
