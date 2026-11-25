"""Store imported customer visit history without creating invoices.

Revision ID: aac_customer_visit_baseline
Revises: aab_manual_attendance_checkin
"""

from alembic import op
import sqlalchemy as sa


revision = "aac_customer_visit_baseline"
down_revision = "aab_manual_attendance_checkin"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "customers",
        sa.Column("imported_visit_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "customers",
        sa.Column("imported_last_visit", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "customers",
        sa.Column("visit_history_cutoff_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column("customers", "visit_history_cutoff_at")
    op.drop_column("customers", "imported_last_visit")
    op.drop_column("customers", "imported_visit_count")
