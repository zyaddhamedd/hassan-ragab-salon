"""add Mini device credential foundation

Revision ID: zg_mini_device_credentials
Revises: zf_invoice_audit_events
Create Date: 2026-09-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "zg_mini_device_credentials"
down_revision = "zf_invoice_audit_events"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("branch_registered_devices") as batch_op:
        batch_op.add_column(
            sa.Column("credential_hash", sa.String(length=128), nullable=True),
        )
        batch_op.add_column(
            sa.Column(
                "credential_version",
                sa.Integer(),
                server_default=sa.text("1"),
                nullable=False,
            ),
        )
        batch_op.add_column(
            sa.Column("credential_issued_at", sa.DateTime(timezone=True), nullable=True),
        )
        batch_op.add_column(
            sa.Column("credential_rotated_at", sa.DateTime(timezone=True), nullable=True),
        )
        batch_op.create_check_constraint(
            "ck_branch_registered_devices_credential_version_positive",
            "credential_version > 0",
        )


def downgrade():
    with op.batch_alter_table("branch_registered_devices") as batch_op:
        batch_op.drop_constraint(
            "ck_branch_registered_devices_credential_version_positive",
            type_="check",
        )
        batch_op.drop_column("credential_rotated_at")
        batch_op.drop_column("credential_issued_at")
        batch_op.drop_column("credential_version")
        batch_op.drop_column("credential_hash")
