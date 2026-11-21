"""add STORE_MANAGER to user_role_enum

Revision ID: x7_store_manager_role
Revises: w6_inbound_shipments
Create Date: 2026-07-03 00:15:00.000000
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = 'x7_store_manager_role'
down_revision = 'w6_inbound_shipments'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'STORE_MANAGER'")


def downgrade():
    # PostgreSQL enum values are intentionally left in place on downgrade.
    pass
