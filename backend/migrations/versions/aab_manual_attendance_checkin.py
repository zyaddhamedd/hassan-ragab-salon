"""Add manual check-in audit metadata to attendance rows."""

from alembic import op
import sqlalchemy as sa


revision = 'aab_manual_attendance_checkin'
down_revision = 'aaa_dual_visa_terminals'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'attendances',
        sa.Column(
            'is_manual_check_in',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        'attendances',
        sa.Column('check_in_actor_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_attendance_check_in_actor',
        'attendances',
        'users',
        ['check_in_actor_id'],
        ['id'],
        ondelete='RESTRICT',
    )


def downgrade():
    op.drop_constraint(
        'fk_attendance_check_in_actor',
        'attendances',
        type_='foreignkey',
    )
    op.drop_column('attendances', 'check_in_actor_id')
    op.drop_column('attendances', 'is_manual_check_in')
