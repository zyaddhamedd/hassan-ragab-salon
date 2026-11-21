"""Additive Staff personal-device proof and approval; no device backfill."""
from alembic import op
import sqlalchemy as sa

revision='zu_staff_personal_devices'
down_revision='zt_staff_auth_sessions'
branch_labels=None
depends_on=None


def upgrade():
    op.create_table('staff_enrollment_grants',
        sa.Column('id',sa.String(32),primary_key=True),
        sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('auth_version',sa.Integer(),nullable=False),
        sa.Column('grant_hash',sa.String(64),nullable=False,unique=True),
        sa.Column('expires_at',sa.DateTime(timezone=True),nullable=False),
        sa.Column('consumed_at',sa.DateTime(timezone=True)))
    op.create_index('ix_staff_enrollment_grants_user_id','staff_enrollment_grants',['user_id'])
    op.create_table('staff_devices',
        sa.Column('id',sa.String(32),primary_key=True),
        sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('employee_id',sa.Integer(),sa.ForeignKey('employees.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('state',sa.String(12),nullable=False),
        sa.Column('public_jwk',sa.Text(),nullable=False),
        sa.Column('thumbprint',sa.String(64),nullable=False,unique=True),
        sa.Column('enrollment_auth_version',sa.Integer(),nullable=False),
        sa.Column('expected_active_id',sa.String(32),sa.ForeignKey('staff_devices.id',ondelete='RESTRICT')),
        sa.Column('approved_by',sa.Integer(),sa.ForeignKey('users.id',ondelete='RESTRICT')),
        sa.Column('approved_at',sa.DateTime(timezone=True)),
        sa.Column('activated_at',sa.DateTime(timezone=True)),
        sa.Column('revoked_by',sa.Integer(),sa.ForeignKey('users.id',ondelete='RESTRICT')),
        sa.Column('revoked_at',sa.DateTime(timezone=True)),
        sa.Column('replaced_by_id',sa.String(32),sa.ForeignKey('staff_devices.id',ondelete='RESTRICT')),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),
        sa.CheckConstraint("state IN ('PENDING','APPROVED','ACTIVE','REVOKED','REPLACED')",name='ck_staff_device_state'))
    op.create_index('ix_staff_devices_user_id','staff_devices',['user_id'])
    op.create_index('uq_staff_active_device_employee','staff_devices',['employee_id'],unique=True,postgresql_where=sa.text("state='ACTIVE'"))
    op.create_table('staff_device_challenges',
        sa.Column('id',sa.String(32),primary_key=True),
        sa.Column('device_id',sa.String(32),sa.ForeignKey('staff_devices.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('purpose',sa.String(12),nullable=False),
        sa.Column('nonce_hash',sa.String(64),nullable=False,unique=True),
        sa.Column('origin',sa.String(255),nullable=False),
        sa.Column('method',sa.String(8),nullable=False),
        sa.Column('target',sa.String(512),nullable=False),
        sa.Column('body_hash',sa.String(64),nullable=False),
        sa.Column('token_hash',sa.String(64)),
        sa.Column('auth_version',sa.Integer(),nullable=False),
        sa.Column('expires_at',sa.DateTime(timezone=True),nullable=False),
        sa.Column('consumed_at',sa.DateTime(timezone=True)),
        sa.Column('proof_jti',sa.String(128)),
        sa.UniqueConstraint('device_id','proof_jti',name='uq_staff_device_proof_jti'))
    op.create_index('ix_staff_device_challenges_device_id','staff_device_challenges',['device_id'])
    op.create_table('staff_device_audit',
        sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('device_id',sa.String(32),sa.ForeignKey('staff_devices.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('actor_id',sa.Integer(),sa.ForeignKey('users.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('action',sa.String(20),nullable=False),
        sa.Column('reason',sa.String(200)),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False))
    op.create_index('ix_staff_device_audit_device_id','staff_device_audit',['device_id'])
    op.add_column('staff_sessions',sa.Column('device_id',sa.String(32),nullable=True))
    op.create_foreign_key('fk_staff_session_device','staff_sessions','staff_devices',['device_id'],['id'],ondelete='RESTRICT')
    op.create_index('ix_staff_sessions_device_id','staff_sessions',['device_id'])


def downgrade():
    bind=op.get_bind()
    if bind.execute(sa.text('SELECT EXISTS(SELECT 1 FROM staff_devices) OR EXISTS(SELECT 1 FROM staff_enrollment_grants) OR EXISTS(SELECT 1 FROM staff_device_challenges) OR EXISTS(SELECT 1 FROM staff_device_audit) OR EXISTS(SELECT 1 FROM staff_sessions WHERE device_id IS NOT NULL)')).scalar():
        raise RuntimeError('Staff device history exists; disable the feature rather than delete binding history.')
    op.drop_index('ix_staff_sessions_device_id',table_name='staff_sessions')
    op.drop_constraint('fk_staff_session_device','staff_sessions',type_='foreignkey')
    op.drop_column('staff_sessions','device_id')
    op.drop_table('staff_device_audit')
    op.drop_table('staff_device_challenges')
    op.drop_table('staff_devices')
    op.drop_table('staff_enrollment_grants')
