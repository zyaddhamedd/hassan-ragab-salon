from datetime import datetime, timezone
import enum

from app.extensions import db


class MiniDeviceProofChallengePurpose(enum.Enum):
    ENROLLMENT = "ENROLLMENT"
    LOGIN = "LOGIN"
    REFRESH = "REFRESH"


class MiniDeviceProofChallenge(db.Model):
    __tablename__ = "mini_device_proof_challenges"

    id = db.Column(db.String(36), primary_key=True)
    nonce_hash = db.Column(db.String(128), nullable=False)
    purpose = db.Column(
        db.Enum(
            MiniDeviceProofChallengePurpose,
            name="mini_device_proof_challenge_purpose_enum",
            native_enum=False,
        ),
        nullable=False,
        index=True,
    )
    branch_id = db.Column(
        db.Integer,
        db.ForeignKey("branches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    registered_device_id = db.Column(
        db.Integer,
        db.ForeignKey("branch_registered_devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    device_id = db.Column(db.String(255), nullable=False)
    proof_key_thumbprint = db.Column(db.String(64), nullable=True)
    proof_key_version = db.Column(db.Integer, nullable=False)
    expected_origin = db.Column(db.String(512), nullable=False)
    token_hash = db.Column(db.String(64), nullable=True)
    issued_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False, index=True)
    consumed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    registered_device = db.relationship("BranchRegisteredDevice")


class MiniDeviceProofReplay(db.Model):
    __tablename__ = "mini_device_proof_replays"

    id = db.Column(db.Integer, primary_key=True)
    proof_key_thumbprint = db.Column(db.String(64), nullable=False)
    jti = db.Column(db.String(128), nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False, index=True)

    __table_args__ = (
        db.UniqueConstraint(
            "proof_key_thumbprint",
            "jti",
            name="uq_mini_device_proof_replay_thumbprint_jti",
        ),
    )
