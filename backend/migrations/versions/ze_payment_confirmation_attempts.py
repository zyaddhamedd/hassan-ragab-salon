"""add durable payment confirmation attempts

Revision ID: ze_payment_confirmation_attempts
Revises: zd_promo_domain_foundation
Create Date: 2026-09-20 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "ze_payment_confirmation_attempts"
down_revision = "zd_promo_domain_foundation"
branch_labels = None
depends_on = None


attempt_status_enum = sa.Enum(
    "PROCESSING",
    "SUCCEEDED",
    "FAILED",
    name="payment_confirmation_attempt_status_enum",
    native_enum=False,
    create_constraint=True,
)


def upgrade():
    op.create_table(
        "payment_confirmation_attempts",
        sa.Column("payment_attempt_id", sa.String(length=36), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.Column("cashier_id", sa.Integer(), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("status", attempt_status_enum, nullable=False),
        sa.Column("failure_code", sa.String(length=64), nullable=True),
        sa.Column("failure_message", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["cashier_id"], ["employees.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("payment_attempt_id"),
    )
    op.create_index(
        "ix_payment_confirmation_attempts_invoice_id",
        "payment_confirmation_attempts",
        ["invoice_id"],
    )
    op.create_index(
        "ix_payment_confirmation_attempts_branch_id",
        "payment_confirmation_attempts",
        ["branch_id"],
    )
    op.create_index(
        "ix_payment_confirmation_attempts_cashier_id",
        "payment_confirmation_attempts",
        ["cashier_id"],
    )
    op.create_index(
        "ix_payment_confirmation_attempts_status",
        "payment_confirmation_attempts",
        ["status"],
    )


def downgrade():
    op.drop_index("ix_payment_confirmation_attempts_status", table_name="payment_confirmation_attempts")
    op.drop_index("ix_payment_confirmation_attempts_cashier_id", table_name="payment_confirmation_attempts")
    op.drop_index("ix_payment_confirmation_attempts_branch_id", table_name="payment_confirmation_attempts")
    op.drop_index("ix_payment_confirmation_attempts_invoice_id", table_name="payment_confirmation_attempts")
    op.drop_table("payment_confirmation_attempts")
