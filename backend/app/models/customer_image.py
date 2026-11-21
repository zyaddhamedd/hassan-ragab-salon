from datetime import datetime, timezone
from app.extensions import db

class CustomerImage(db.Model):
    __tablename__ = 'customer_images'

    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.Integer, db.ForeignKey('customers.id'), nullable=False)
    image_url = db.Column(db.String(500), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    def __repr__(self):
        return f'<CustomerImage {self.id} for Customer {self.customer_id}>'
