"""Additive Staff identity metadata; no account creation or matching."""
from alembic import op
import sqlalchemy as sa

revision = 'zs_staff_identity_foundation'
down_revision = 'zr_payroll_settlement_ledger'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('employee_id', sa.Integer(), nullable=True))
    op.add_column('users', sa.Column('staff_auth_version', sa.Integer(), nullable=False, server_default='1'))
    op.create_foreign_key('fk_user_staff_employee', 'users', 'employees', ['employee_id'], ['id'], ondelete='RESTRICT')
    op.create_unique_constraint('uq_user_staff_employee', 'users', ['employee_id'])
    op.create_check_constraint('ck_user_staff_role', 'users', "employee_id IS NULL OR role = 'EMPLOYEE'")
    op.create_check_constraint('ck_user_staff_auth_version', 'users', 'staff_auth_version >= 1')
    op.create_table('staff_identity_events',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('employee_id', sa.Integer(), sa.ForeignKey('employees.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('actor_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('action', sa.String(20), nullable=False),
        sa.Column('auth_version', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False))


def downgrade():
    bind = op.get_bind()
    if bind.execute(sa.text('SELECT EXISTS (SELECT 1 FROM users WHERE employee_id IS NOT NULL) OR EXISTS (SELECT 1 FROM staff_identity_events)')).scalar():
        raise RuntimeError('Staff identities exist; use feature rollback instead of deleting identity history.')
    op.drop_table('staff_identity_events')
    op.drop_constraint('ck_user_staff_auth_version', 'users', type_='check')
    op.drop_constraint('ck_user_staff_role', 'users', type_='check')
    op.drop_constraint('uq_user_staff_employee', 'users', type_='unique')
    op.drop_constraint('fk_user_staff_employee', 'users', type_='foreignkey')
    op.drop_column('users', 'staff_auth_version')
    op.drop_column('users', 'employee_id')
