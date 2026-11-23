from datetime import datetime, timezone
import enum
from app.extensions import db

class AttendanceStatus(enum.Enum):
    PRESENT = "PRESENT"
    LEFT = "LEFT"


class AttendanceCheckoutSource(enum.Enum):
    MANUAL = "MANUAL"
    BUSINESS_DAY_CLOSE = "BUSINESS_DAY_CLOSE"
    ADMIN_CORRECTION = "ADMIN_CORRECTION"


class Attendance(db.Model):
    __tablename__ = 'attendances'

    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=False)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    business_day_id = db.Column(
        db.Integer,
        db.ForeignKey('business_days.id', ondelete='RESTRICT'),
        nullable=True,
        index=True
    )
    date = db.Column(db.Date, nullable=False)
    check_in_time = db.Column(db.DateTime(timezone=True), nullable=False)
    check_out_time = db.Column(db.DateTime(timezone=True), nullable=True)
    checkout_source = db.Column(
        db.Enum(
            AttendanceCheckoutSource,
            name='attendance_checkout_source_enum'
        ),
        nullable=True
    )
    
    # NULL is historical cashier attendance. Never infer/backfill GPS provenance.
    attendance_origin = db.Column(db.String(24), nullable=True)
    checkout_verification = db.Column(db.String(24), nullable=True)
    closure_actor_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=True)
    closure_reason = db.Column(db.String(200), nullable=True)
    closure_recorded_at = db.Column(db.DateTime(timezone=True), nullable=True)
    closure_review_required = db.Column(db.Boolean, nullable=True)

    # Manual check-in audit metadata
    is_manual_check_in = db.Column(db.Boolean, default=False, server_default='false', nullable=False)
    check_in_actor_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=True)
    check_in_actor = db.relationship('User', foreign_keys=[check_in_actor_id])

    # Use named enum for PostgreSQL
    status = db.Column(db.Enum(AttendanceStatus, name='attendance_status_enum'), nullable=False)
    
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        db.CheckConstraint("attendance_origin IS NULL OR attendance_origin IN ('LEGACY_CASHIER','STAFF_GPS')", name='ck_attendance_origin'),
        db.CheckConstraint("checkout_verification IS NULL OR checkout_verification IN ('ADMIN_UNVERIFIED','STAFF_GPS_VERIFIED')", name='ck_attendance_verification'),
        db.CheckConstraint("""
            (checkout_verification IS NULL AND closure_actor_id IS NULL AND closure_reason IS NULL
             AND closure_recorded_at IS NULL AND closure_review_required IS NULL
             AND (attendance_origin IS NULL OR attendance_origin <> 'STAFF_GPS' OR check_out_time IS NULL))
            OR (attendance_origin = 'STAFF_GPS' AND attendance_origin IS NOT NULL
                AND checkout_verification IS NOT NULL AND check_out_time IS NOT NULL AND status = 'LEFT'
                AND ((checkout_verification = 'ADMIN_UNVERIFIED' AND checkout_source = 'ADMIN_CORRECTION'
                      AND checkout_source IS NOT NULL AND closure_actor_id IS NOT NULL
                      AND closure_reason IS NOT NULL AND length(trim(closure_reason)) BETWEEN 1 AND 200
                      AND closure_recorded_at IS NOT NULL AND closure_review_required IS TRUE)
                     OR (checkout_verification = 'STAFF_GPS_VERIFIED' AND closure_actor_id IS NULL
                         AND closure_reason IS NULL AND closure_recorded_at IS NULL AND closure_review_required IS NULL)))
        """, name='ck_attendance_closure_evidence'),
        # Uniqueness is enforced at the DB level by a partial index:
        #   CREATE UNIQUE INDEX uq_employee_present
        #   ON attendances (employee_id) WHERE status = 'PRESENT'
        # This allows multiple LEFT records per employee per day (multiple
        # business days on the same calendar date) while still preventing
        # two simultaneous PRESENT rows for the same employee.
        # Migration: j6k8l0m2n4o3
    )

    # Relationships
    employee = db.relationship('Employee', backref=db.backref('attendance', lazy=True))
    branch = db.relationship('Branch', backref=db.backref('attendance', lazy=True))
    business_day = db.relationship(
        'BusinessDay',
        foreign_keys=[business_day_id],
        backref=db.backref('attendances', lazy='dynamic')
    )

    def __repr__(self):
        return f'<Attendance {self.employee_id} {self.date}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'employee_id': self.employee_id,
            'employee_name': self.employee.full_name if self.employee else None,
            'branch_id': self.branch_id,
            'date': self.date.isoformat() if self.date else None,
            'check_in_time': self.check_in_time.strftime('%H:%M:%S') if self.check_in_time else None,
            'check_out_time': self.check_out_time.strftime('%H:%M:%S') if self.check_out_time else None,
            'status': self.status.value if self.status else None
        }
