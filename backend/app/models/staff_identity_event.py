from datetime import datetime, timezone
from app.extensions import db


class StaffIdentityEvent(db.Model):
    """Identity administration history only. Never store passwords/tokens here."""
    __tablename__ = 'staff_identity_events'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False)
    employee_id = db.Column(db.Integer, db.ForeignKey('employees.id', ondelete='RESTRICT'), nullable=False)
    actor_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False)
    action = db.Column(db.String(20), nullable=False)
    auth_version = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
