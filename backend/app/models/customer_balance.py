from datetime import datetime, timezone
from app.extensions import db

class CustomerBalance(db.Model):
    __tablename__ = 'customer_balances'

    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.Integer, db.ForeignKey('customers.id'), nullable=False)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    balance = db.Column(db.Numeric(12, 2), default=0, nullable=False)
    
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        db.UniqueConstraint('customer_id', 'branch_id', name='uq_customer_branch_balance'),
    )

    # Relationships
    customer = db.relationship('Customer', backref=db.backref('balances', lazy=True))
    branch = db.relationship('Branch', backref=db.backref('customer_balances', lazy=True))

    def __repr__(self):
        return f'<CustomerBalance customer_id={self.customer_id} branch_id={self.branch_id} balance={self.balance}>'
