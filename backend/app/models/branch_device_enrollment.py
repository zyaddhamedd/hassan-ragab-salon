from datetime import datetime, timezone
import enum

from app.extensions import db


class MiniDeviceEnrollmentStatus(enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    EXPIRED = "EXPIRED"
    REJECTED = "REJECTED"


class BranchDeviceEnrollment(db.Model):
    __tablename__ = "branch_device_enrollments"

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(
        db.Integer,
        db.ForeignKey("branches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    device_id = db.Column(db.String(255), nullable=False)
    pairing_code_hash = db.Column(db.String(64), nullable=False)
    status = db.Column(
        db.Enum(
            MiniDeviceEnrollmentStatus,
            name="mini_device_enrollment_status_enum",
            native_enum=False,
        ),
        nullable=False,
        default=MiniDeviceEnrollmentStatus.PENDING,
        index=True,
    )
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False, index=True)
    finalization_proof_hash = db.Column(db.String(128), nullable=True)
    finalization_expires_at = db.Column(db.DateTime(timezone=True), nullable=True)
    finalization_consumed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    approved_at = db.Column(db.DateTime(timezone=True), nullable=True)
    registered_device_id = db.Column(
        db.Integer,
        db.ForeignKey("branch_registered_devices.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    requested_ip = db.Column(db.String(45), nullable=True)
    requested_user_agent = db.Column(db.Text, nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    branch = db.relationship(
        "Branch",
        backref=db.backref(
            "device_enrollment_requests",
            lazy=True,
            cascade="all, delete-orphan",
        ),
    )
    registered_device = db.relationship("BranchRegisteredDevice")

    def to_dict(self):
        return {
            "id": self.id,
            "branch_id": self.branch_id,
            "device_id": self.device_id,
            "status": self.status.value if self.status else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "requested_ip": self.requested_ip,
            "requested_user_agent": self.requested_user_agent,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return (
            f"<BranchDeviceEnrollment branch={self.branch_id}"
            f" device={self.device_id}"
            f" status={self.status.value if self.status else 'UNKNOWN'}>"
        )
