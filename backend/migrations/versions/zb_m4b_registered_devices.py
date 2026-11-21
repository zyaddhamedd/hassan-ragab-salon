"""m4b registered devices foundation

Revision ID: zb_m4b_registered_devices
Revises: za_fix_uq_employee_present
Create Date: 2026-09-01 00:00:01.000000
"""

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = 'zb_m4b_registered_devices'
down_revision = 'za_fix_uq_employee_present'
branch_labels = None
depends_on = None


mini_device_type_enum = sa.Enum(
    'DESKTOP',
    'MOBILE',
    'TABLET',
    name='mini_device_type_enum',
    native_enum=False,
)

mini_access_mode_enum = sa.Enum(
    'FULL_MINI',
    'INVENTORY_ONLY',
    name='mini_access_mode_enum',
    native_enum=False,
)


def upgrade():
    op.create_table(
        'branch_registered_devices',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('branch_id', sa.Integer(), nullable=False),
        sa.Column('device_id', sa.String(length=255), nullable=False),
        sa.Column('device_label', sa.String(length=120), nullable=True),
        sa.Column('device_type', mini_device_type_enum, nullable=False),
        sa.Column('access_mode', mini_access_mode_enum, nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_by_user_id', sa.Integer(), nullable=True),
        sa.Column('revoked_by_user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_seen_ip', sa.String(length=45), nullable=True),
        sa.Column('last_seen_user_agent', sa.Text(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['revoked_by_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('branch_id', 'device_id', name='uq_branch_registered_device_identity'),
    )
    op.create_index(
        op.f('ix_branch_registered_devices_branch_id'),
        'branch_registered_devices',
        ['branch_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_branch_registered_devices_is_active'),
        'branch_registered_devices',
        ['is_active'],
        unique=False,
    )

    bind = op.get_bind()
    metadata = sa.MetaData()
    branches = sa.Table(
        'branches',
        metadata,
        sa.Column('id', sa.Integer()),
        sa.Column('authorized_device_id', sa.String(length=255)),
        sa.Column('binding_ip', sa.String(length=45)),
        sa.Column('binding_user_agent', sa.Text()),
        sa.Column('binding_timestamp', sa.DateTime(timezone=True)),
    )
    branch_registered_devices = sa.Table(
        'branch_registered_devices',
        metadata,
        sa.Column('branch_id', sa.Integer()),
        sa.Column('device_id', sa.String(length=255)),
        sa.Column('device_label', sa.String(length=120)),
        sa.Column('device_type', sa.String(length=32)),
        sa.Column('access_mode', sa.String(length=32)),
        sa.Column('is_active', sa.Boolean()),
        sa.Column('created_by_user_id', sa.Integer()),
        sa.Column('revoked_by_user_id', sa.Integer()),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.Column('updated_at', sa.DateTime(timezone=True)),
        sa.Column('last_seen_at', sa.DateTime(timezone=True)),
        sa.Column('last_seen_ip', sa.String(length=45)),
        sa.Column('last_seen_user_agent', sa.Text()),
        sa.Column('revoked_at', sa.DateTime(timezone=True)),
    )

    rows = bind.execute(
        sa.select(
            branches.c.id,
            branches.c.authorized_device_id,
            branches.c.binding_ip,
            branches.c.binding_user_agent,
            branches.c.binding_timestamp,
        ).where(branches.c.authorized_device_id.is_not(None))
    ).fetchall()

    now = datetime.now(timezone.utc)
    inserts = []
    for row in rows:
        seen_at = row.binding_timestamp or now
        inserts.append({
            'branch_id': row.id,
            'device_id': row.authorized_device_id,
            'device_label': 'Migrated Desktop Device',
            'device_type': 'DESKTOP',
            'access_mode': 'FULL_MINI',
            'is_active': True,
            'created_by_user_id': None,
            'revoked_by_user_id': None,
            'created_at': seen_at,
            'updated_at': seen_at,
            'last_seen_at': seen_at,
            'last_seen_ip': row.binding_ip,
            'last_seen_user_agent': row.binding_user_agent,
            'revoked_at': None,
        })

    if inserts:
        bind.execute(branch_registered_devices.insert(), inserts)

    op.alter_column('branch_registered_devices', 'is_active', server_default=None)


def downgrade():
    op.drop_index(op.f('ix_branch_registered_devices_is_active'), table_name='branch_registered_devices')
    op.drop_index(op.f('ix_branch_registered_devices_branch_id'), table_name='branch_registered_devices')
    op.drop_table('branch_registered_devices')
    mini_access_mode_enum.drop(op.get_bind(), checkfirst=False)
    mini_device_type_enum.drop(op.get_bind(), checkfirst=False)
