from datetime import datetime, timezone
from app.extensions import db

class Branch(db.Model):
    __tablename__ = 'branches'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    city = db.Column(db.String(50), nullable=False, default="Cairo")
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    is_main_warehouse = db.Column(db.Boolean, default=False, nullable=False)  # indicates the main warehouse branch
    allow_discounts = db.Column(db.Boolean, default=True, nullable=False)
    
    # Device Binding (Cashier Security)
    authorized_device_id = db.Column(db.String(255), nullable=True)
    binding_ip = db.Column(db.String(45), nullable=True)
    binding_user_agent = db.Column(db.Text, nullable=True)
    binding_timestamp = db.Column(db.DateTime(timezone=True), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'city': self.city,
            'is_active': self.is_active,
            'is_main_warehouse': self.is_main_warehouse,
            'allow_discounts': self.allow_discounts,
            'authorized_device_id': self.authorized_device_id,
            'binding_ip': self.binding_ip,
            'binding_user_agent': self.binding_user_agent,
            'binding_timestamp': self.binding_timestamp.isoformat() if self.binding_timestamp else None,
            'created_at': self.created_at.isoformat()
        }

    def __repr__(self):
        return f'<Branch {self.name}>'
