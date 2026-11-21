"""add_is_main_warehouse_to_branches

Revision ID: 20230620_add_is_main_warehouse
Revises: a6b7c8d9e0f1
Create Date: 2026-06-20 20:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20230620_add_is_main_warehouse"
down_revision = "a6b7c8d9e0f1"
branch_labels = None
depends_on = None

def upgrade():
    # Add is_main_warehouse column to branches table
    op.add_column(
        "branches",
        sa.Column(
            "is_main_warehouse",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    # Remove server default to let SQLAlchemy model default handle future inserts
    op.alter_column("branches", "is_main_warehouse", server_default=None)

def downgrade():
    op.drop_column("branches", "is_main_warehouse")
