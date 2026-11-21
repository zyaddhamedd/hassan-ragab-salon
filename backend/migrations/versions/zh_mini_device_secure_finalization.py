"""add secure Mini device enrollment finalization

Revision ID: zh_mini_device_finalization
Revises: zg_mini_device_credentials
Create Date: 2026-09-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "zh_mini_device_finalization"
down_revision = "zg_mini_device_credentials"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("branch_registered_devices") as batch_op:
        batch_op.add_column(
            sa.Column(
                "credential_required",
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            )
        )

    with op.batch_alter_table("branch_device_enrollments") as batch_op:
        batch_op.add_column(sa.Column("finalization_proof_hash", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("finalization_expires_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("finalization_consumed_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("registered_device_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_branch_device_enrollments_registered_device_id",
            "branch_registered_devices",
            ["registered_device_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_branch_device_enrollments_registered_device_id",
            ["registered_device_id"],
            unique=False,
        )


def downgrade():
    with op.batch_alter_table("branch_device_enrollments") as batch_op:
        batch_op.drop_index("ix_branch_device_enrollments_registered_device_id")
        batch_op.drop_constraint(
            "fk_branch_device_enrollments_registered_device_id",
            type_="foreignkey",
        )
        batch_op.drop_column("registered_device_id")
        batch_op.drop_column("approved_at")
        batch_op.drop_column("finalization_consumed_at")
        batch_op.drop_column("finalization_expires_at")
        batch_op.drop_column("finalization_proof_hash")

    with op.batch_alter_table("branch_registered_devices") as batch_op:
        batch_op.drop_column("credential_required")
