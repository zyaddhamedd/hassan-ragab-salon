"""Immutable proof receipts, never an alternative attendance ledger or GPS store."""
from app.extensions import db


class StaffAttendanceReceipt(db.Model):
    __tablename__ = 'staff_attendance_receipts'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False)
    idempotency_key = db.Column(db.String(32), nullable=False)
    request_hash = db.Column(db.String(64), nullable=False)  # Keyed digest, no raw location/body.
    action = db.Column(db.String(12), nullable=False)
    attendance_id = db.Column(db.Integer, db.ForeignKey('attendances.id', ondelete='RESTRICT'), nullable=False)
    shift_instance_id = db.Column(db.Integer, db.ForeignKey('employee_shift_instances.id', ondelete='RESTRICT'), nullable=False)
    geofence_version_id = db.Column(db.Integer, db.ForeignKey('staff_geofence_versions.id', ondelete='RESTRICT'), nullable=False)
    device_id = db.Column(db.String(32), db.ForeignKey('staff_devices.id', ondelete='RESTRICT'), nullable=False)
    challenge_id = db.Column(db.String(32), db.ForeignKey('staff_device_challenges.id', ondelete='RESTRICT'), nullable=False, unique=True)
    recorded_at = db.Column(db.DateTime(timezone=True), nullable=False)
    __table_args__ = (
        db.UniqueConstraint('user_id', 'idempotency_key', name='uq_staff_attendance_retry'),
        db.UniqueConstraint('attendance_id', 'action', name='uq_staff_attendance_action'),
        db.CheckConstraint("action IN ('CHECK_IN','CHECK_OUT')", name='ck_staff_attendance_action'),
    )
