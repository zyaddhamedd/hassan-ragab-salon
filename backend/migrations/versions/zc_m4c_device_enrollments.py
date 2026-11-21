"""m4c pending device enrollments

Revision ID: zc_m4c_device_enrollments
Revises: zb_m4b_registered_devices
Create Date: 2026-09-01 03:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "zc_m4c_device_enrollments"
down_revision = "zb_m4b_registered_devices"
branch_labels = None
depends_on = None


mini_device_enrollment_status_enum = sa.Enum(
    "PENDING",
    "APPROVED",
    "EXPIRED",
    "REJECTED",
    name="mini_device_enrollment_status_enum",
    native_enum=False,
)


def upgrade():
    op.create_table(
        "branch_device_enrollments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.String(length=255), nullable=False),
        sa.Column("pairing_code_hash", sa.String(length=64), nullable=False),
        sa.Column("status", mini_device_enrollment_status_enum, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("requested_ip", sa.String(length=45), nullable=True),
        sa.Column("requested_user_agent", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_branch_device_enrollments_branch_id"),
        "branch_device_enrollments",
        ["branch_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_branch_device_enrollments_expires_at"),
        "branch_device_enrollments",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_branch_device_enrollments_status"),
        "branch_device_enrollments",
        ["status"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        op.f("ix_branch_device_enrollments_status"),
        table_name="branch_device_enrollments",
    )
    op.drop_index(
        op.f("ix_branch_device_enrollments_expires_at"),
        table_name="branch_device_enrollments",
    )
    op.drop_index(
        op.f("ix_branch_device_enrollments_branch_id"),
        table_name="branch_device_enrollments",
    )
    op.drop_table("branch_device_enrollments")
    mini_device_enrollment_status_enum.drop(op.get_bind(), checkfirst=False)
