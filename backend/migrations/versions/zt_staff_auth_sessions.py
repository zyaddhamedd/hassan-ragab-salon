"""Additive Staff activation codes, revocable sessions and atomic rate limits."""
from alembic import op
import sqlalchemy as sa

revision='zt_staff_auth_sessions'
down_revision='zs_staff_identity_foundation'
branch_labels=None
depends_on=None


def upgrade():
    op.add_column('users',sa.Column('staff_password_initialized',sa.Boolean(),nullable=False,server_default=sa.false()))
    op.create_table('staff_auth_codes',
        sa.Column('id',sa.String(32),primary_key=True),
        sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('issued_by',sa.Integer(),sa.ForeignKey('users.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('purpose',sa.String(10),nullable=False),
        sa.Column('code_hash',sa.String(64),nullable=False,unique=True),
        sa.Column('auth_version',sa.Integer(),nullable=False),
        sa.Column('expires_at',sa.DateTime(timezone=True),nullable=False),
        sa.Column('consumed_at',sa.DateTime(timezone=True)),
        sa.Column('revoked_at',sa.DateTime(timezone=True)),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),
        sa.CheckConstraint("purpose IN ('activation','recovery')",name='ck_staff_code_purpose'))
    op.create_index('ix_staff_auth_codes_user_id','staff_auth_codes',['user_id'])
    op.create_table('staff_sessions',
        sa.Column('id',sa.String(32),primary_key=True),
        sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('auth_version',sa.Integer(),nullable=False),
        sa.Column('refresh_hash',sa.String(64),nullable=False),
        sa.Column('csrf_hash',sa.String(64),nullable=False),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),
        sa.Column('expires_at',sa.DateTime(timezone=True),nullable=False),
        sa.Column('revoked_at',sa.DateTime(timezone=True)),
        sa.Column('revoked_reason',sa.String(24)))
    op.create_index('ix_staff_sessions_user_id','staff_sessions',['user_id'])
    op.create_table('staff_auth_rates',sa.Column('key',sa.String(64),primary_key=True),
        sa.Column('bucket',sa.BigInteger(),nullable=False),sa.Column('attempts',sa.Integer(),nullable=False))


def downgrade():
    bind=op.get_bind()
    if bind.execute(sa.text('SELECT EXISTS(SELECT 1 FROM staff_auth_codes) OR EXISTS(SELECT 1 FROM staff_sessions) OR EXISTS(SELECT 1 FROM users WHERE staff_password_initialized)')).scalar():
        raise RuntimeError('Staff auth history exists; disable the feature instead of deleting identity/session history.')
    op.drop_table('staff_auth_rates')
    op.drop_table('staff_sessions')
    op.drop_table('staff_auth_codes')
    op.drop_column('users','staff_password_initialized')
