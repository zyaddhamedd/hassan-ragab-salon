from datetime import datetime, timezone
from app.extensions import db


def utc_now():return datetime.now(timezone.utc)


class StaffEnrollmentGrant(db.Model):
    __tablename__='staff_enrollment_grants'
    id=db.Column(db.String(32),primary_key=True)
    user_id=db.Column(db.Integer,db.ForeignKey('users.id',ondelete='RESTRICT'),nullable=False,index=True)
    auth_version=db.Column(db.Integer,nullable=False)
    grant_hash=db.Column(db.String(64),nullable=False,unique=True)
    expires_at=db.Column(db.DateTime(timezone=True),nullable=False)
    consumed_at=db.Column(db.DateTime(timezone=True))


class StaffDevice(db.Model):
    __tablename__='staff_devices'
    id=db.Column(db.String(32),primary_key=True)
    user_id=db.Column(db.Integer,db.ForeignKey('users.id',ondelete='RESTRICT'),nullable=False,index=True)
    employee_id=db.Column(db.Integer,db.ForeignKey('employees.id',ondelete='RESTRICT'),nullable=False)
    state=db.Column(db.String(12),nullable=False,default='PENDING')
    public_jwk=db.Column(db.Text,nullable=False)
    thumbprint=db.Column(db.String(64),nullable=False,unique=True)
    enrollment_auth_version=db.Column(db.Integer,nullable=False)
    expected_active_id=db.Column(db.String(32),db.ForeignKey('staff_devices.id',ondelete='RESTRICT'))
    approved_by=db.Column(db.Integer,db.ForeignKey('users.id',ondelete='RESTRICT'))
    approved_at=db.Column(db.DateTime(timezone=True))
    activated_at=db.Column(db.DateTime(timezone=True))
    revoked_by=db.Column(db.Integer,db.ForeignKey('users.id',ondelete='RESTRICT'))
    revoked_at=db.Column(db.DateTime(timezone=True))
    replaced_by_id=db.Column(db.String(32),db.ForeignKey('staff_devices.id',ondelete='RESTRICT'))
    created_at=db.Column(db.DateTime(timezone=True),nullable=False,default=utc_now)
    __table_args__=(
        db.CheckConstraint("state IN ('PENDING','APPROVED','ACTIVE','REVOKED','REPLACED')",name='ck_staff_device_state'),
        db.Index('uq_staff_active_device_employee','employee_id',unique=True,
            postgresql_where=db.text("state='ACTIVE'"),sqlite_where=db.text("state='ACTIVE'")),
    )


class StaffDeviceChallenge(db.Model):
    __tablename__='staff_device_challenges'
    id=db.Column(db.String(32),primary_key=True)
    device_id=db.Column(db.String(32),db.ForeignKey('staff_devices.id',ondelete='RESTRICT'),nullable=False,index=True)
    purpose=db.Column(db.String(12),nullable=False)
    nonce_hash=db.Column(db.String(64),nullable=False,unique=True)
    origin=db.Column(db.String(255),nullable=False)
    method=db.Column(db.String(8),nullable=False)
    target=db.Column(db.String(512),nullable=False)
    body_hash=db.Column(db.String(64),nullable=False)
    token_hash=db.Column(db.String(64))
    auth_version=db.Column(db.Integer,nullable=False)
    expires_at=db.Column(db.DateTime(timezone=True),nullable=False)
    consumed_at=db.Column(db.DateTime(timezone=True))
    proof_jti=db.Column(db.String(128))
    __table_args__=(db.UniqueConstraint('device_id','proof_jti',name='uq_staff_device_proof_jti'),)


class StaffDeviceAudit(db.Model):
    __tablename__='staff_device_audit'
    id=db.Column(db.Integer,primary_key=True)
    device_id=db.Column(db.String(32),db.ForeignKey('staff_devices.id',ondelete='RESTRICT'),nullable=False,index=True)
    actor_id=db.Column(db.Integer,db.ForeignKey('users.id',ondelete='RESTRICT'),nullable=False)
    action=db.Column(db.String(20),nullable=False)
    reason=db.Column(db.String(200))
    created_at=db.Column(db.DateTime(timezone=True),nullable=False,default=utc_now)
