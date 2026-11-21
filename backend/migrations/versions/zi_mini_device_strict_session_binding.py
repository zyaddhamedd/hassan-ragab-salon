"""add Mini device re-pair authorization fields

Revision ID: zi_mini_device_strict_binding
Revises: zh_mini_device_finalization
Create Date: 2026-09-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "zi_mini_device_strict_binding"
down_revision = "zh_mini_device_finalization"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("branch_registered_devices") as batch_op:
        batch_op.add_column(sa.Column("repair_authorized_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("repair_expires_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("repair_authorized_by_user_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_branch_registered_devices_repair_authorized_by_user_id",
            "users",
            ["repair_authorized_by_user_id"],
            ["id"],
        )


def downgrade():
    with op.batch_alter_table("branch_registered_devices") as batch_op:
        batch_op.drop_constraint(
            "fk_branch_registered_devices_repair_authorized_by_user_id",
            type_="foreignkey",
        )
        batch_op.drop_column("repair_authorized_by_user_id")
        batch_op.drop_column("repair_expires_at")
        batch_op.drop_column("repair_authorized_at")
