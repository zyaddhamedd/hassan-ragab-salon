from datetime import datetime, timezone
import enum

from app.extensions import db


class MiniDeviceType(enum.Enum):
    DESKTOP = "DESKTOP"
    MOBILE = "MOBILE"
    TABLET = "TABLET"


class MiniAccessMode(enum.Enum):
    FULL_MINI = "FULL_MINI"
    INVENTORY_ONLY = "INVENTORY_ONLY"


class MiniDeviceCredentialState(enum.Enum):
    LEGACY = "LEGACY"
    PENDING_FINALIZATION = "PENDING_FINALIZATION"
    CREDENTIAL_ENABLED = "CREDENTIAL_ENABLED"
    REVOKED = "REVOKED"


class MiniDeviceProofState(enum.Enum):
    CREDENTIAL_ONLY = "CREDENTIAL_ONLY"
    PENDING_FINALIZATION = "PENDING_FINALIZATION"
    PROOF_ENABLED = "PROOF_ENABLED"
    REVOKED = "REVOKED"


class BranchRegisteredDevice(db.Model):
    __tablename__ = 'branch_registered_devices'

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='CASCADE'), nullable=False, index=True)
    device_id = db.Column(db.String(255), nullable=False)
    device_label = db.Column(db.String(120), nullable=True)
    device_type = db.Column(
        db.Enum(MiniDeviceType, name='mini_device_type_enum', native_enum=False),
        nullable=False,
        default=MiniDeviceType.DESKTOP,
    )
    access_mode = db.Column(
        db.Enum(MiniAccessMode, name='mini_access_mode_enum', native_enum=False),
        nullable=False,
        default=MiniAccessMode.FULL_MINI,
    )
    is_active = db.Column(db.Boolean, nullable=False, default=True, index=True)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    revoked_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    last_seen_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_seen_ip = db.Column(db.String(45), nullable=True)
    last_seen_user_agent = db.Column(db.Text, nullable=True)
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)
    credential_hash = db.Column(db.String(128), nullable=True)
    credential_version = db.Column(
        db.Integer,
        nullable=False,
        default=1,
        server_default='1',
    )
    credential_issued_at = db.Column(db.DateTime(timezone=True), nullable=True)
    credential_rotated_at = db.Column(db.DateTime(timezone=True), nullable=True)
    credential_required = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        server_default=db.false(),
    )
    repair_authorized_at = db.Column(db.DateTime(timezone=True), nullable=True)
    repair_expires_at = db.Column(db.DateTime(timezone=True), nullable=True)
    repair_authorized_by_user_id = db.Column(
        db.Integer,
        db.ForeignKey('users.id'),
        nullable=True,
    )
    proof_public_key_jwk = db.Column(db.Text, nullable=True)
    proof_key_thumbprint = db.Column(db.String(64), nullable=True, unique=True)
    proof_key_algorithm = db.Column(db.String(16), nullable=True)
    proof_key_version = db.Column(
        db.Integer,
        nullable=False,
        default=1,
        server_default='1',
    )
    proof_key_required = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        server_default=db.false(),
    )
    proof_key_registered_at = db.Column(db.DateTime(timezone=True), nullable=True)
    proof_key_rotated_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_proof_verified_at = db.Column(db.DateTime(timezone=True), nullable=True)

    branch = db.relationship('Branch', backref=db.backref('registered_devices', lazy=True, cascade='all, delete-orphan'))
    created_by_user = db.relationship('User', foreign_keys=[created_by_user_id])
    revoked_by_user = db.relationship('User', foreign_keys=[revoked_by_user_id])
    repair_authorized_by_user = db.relationship(
        'User',
        foreign_keys=[repair_authorized_by_user_id],
    )

    __table_args__ = (
        db.UniqueConstraint('branch_id', 'device_id', name='uq_branch_registered_device_identity'),
        db.CheckConstraint(
            'credential_version > 0',
            name='ck_branch_registered_devices_credential_version_positive',
        ),
        db.CheckConstraint(
            'proof_key_version > 0',
            name='ck_branch_registered_devices_proof_key_version_positive',
        ),
    )

    @property
    def credential_state(self):
        if not self.is_active:
            return MiniDeviceCredentialState.REVOKED
        if self.credential_hash:
            return MiniDeviceCredentialState.CREDENTIAL_ENABLED
        if self.credential_required:
            return MiniDeviceCredentialState.PENDING_FINALIZATION
        return MiniDeviceCredentialState.LEGACY

    @property
    def proof_state(self):
        if not self.is_active:
            return MiniDeviceProofState.REVOKED
        if self.proof_public_key_jwk and self.proof_key_thumbprint:
            return MiniDeviceProofState.PROOF_ENABLED
        if self.proof_key_required:
            return MiniDeviceProofState.PENDING_FINALIZATION
        return MiniDeviceProofState.CREDENTIAL_ONLY

    def to_dict(self):
        return {
            'id': self.id,
            'branch_id': self.branch_id,
            'device_id': self.device_id,
            'device_label': self.device_label,
            'device_type': self.device_type.value if self.device_type else None,
            'access_mode': self.access_mode.value if self.access_mode else None,
            'is_active': self.is_active,
            'created_by_user_id': self.created_by_user_id,
            'revoked_by_user_id': self.revoked_by_user_id,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'last_seen_at': self.last_seen_at.isoformat() if self.last_seen_at else None,
            'last_seen_ip': self.last_seen_ip,
            'last_seen_user_agent': self.last_seen_user_agent,
            'revoked_at': self.revoked_at.isoformat() if self.revoked_at else None,
            'credential_state': self.credential_state.value,
            'proof_state': self.proof_state.value,
            'proof_key_version': self.proof_key_version,
            'proof_key_registered_at': self.proof_key_registered_at.isoformat()
            if self.proof_key_registered_at
            else None,
            'last_proof_verified_at': self.last_proof_verified_at.isoformat()
            if self.last_proof_verified_at
            else None,
            'repair_authorized_at': self.repair_authorized_at.isoformat()
            if self.repair_authorized_at
            else None,
            'repair_expires_at': self.repair_expires_at.isoformat()
            if self.repair_expires_at
            else None,
        }

    def __repr__(self):
        return (
            f"<BranchRegisteredDevice branch={self.branch_id}"
            f" device={self.device_id}"
            f" mode={self.access_mode.value if self.access_mode else 'UNKNOWN'}"
            f" active={self.is_active}>"
        )
