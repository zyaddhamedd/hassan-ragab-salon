from datetime import datetime, timezone
from app.extensions import db


def now_utc():
    return datetime.now(timezone.utc)


class StaffAuthCode(db.Model):
    __tablename__ = 'staff_auth_codes'
    id = db.Column(db.String(32), primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False, index=True)
    issued_by = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False)
    purpose = db.Column(db.String(10), nullable=False)
    code_hash = db.Column(db.String(64), nullable=False, unique=True)
    auth_version = db.Column(db.Integer, nullable=False)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    consumed_at = db.Column(db.DateTime(timezone=True))
    revoked_at = db.Column(db.DateTime(timezone=True))
    created_at = db.Column(db.DateTime(timezone=True), default=now_utc, nullable=False)
    __table_args__ = (db.CheckConstraint("purpose IN ('activation','recovery')", name='ck_staff_code_purpose'),)


class StaffSession(db.Model):
    __tablename__ = 'staff_sessions'
    id = db.Column(db.String(32), primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False, index=True)
    device_id = db.Column(db.String(32), db.ForeignKey('staff_devices.id', ondelete='RESTRICT', name='fk_staff_session_device'), nullable=True, index=True)
    auth_version = db.Column(db.Integer, nullable=False)
    refresh_hash = db.Column(db.String(64), nullable=False)
    csrf_hash = db.Column(db.String(64), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=now_utc, nullable=False)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    revoked_at = db.Column(db.DateTime(timezone=True))
    revoked_reason = db.Column(db.String(24))


class StaffAuthRate(db.Model):
    __tablename__ = 'staff_auth_rates'
    key = db.Column(db.String(64), primary_key=True)
    bucket = db.Column(db.BigInteger, nullable=False)
    attempts = db.Column(db.Integer, nullable=False)
