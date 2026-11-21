"""merge_branches_heads

Revision ID: 20230621_merge_branches
Revises: 20230620_add_is_main_warehouse, e9d48d4ed194
Create Date: 2026-06-21 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20230621_merge_branches"
# List of parent revisions for the merge
down_revision = ("20230620_add_is_main_warehouse", "e9d48d4ed194")
branch_labels = None
depends_on = None


def upgrade():
    # No schema changes; this migration merges two heads.
    pass


def downgrade():
    # Downgrade is not possible for a merge without losing one branch.
    pass
