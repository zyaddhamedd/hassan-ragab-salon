'''Preserve the stock_movements created_by branch in the real migration graph.'''

"""update_stock_movement_created_by_fk

Revision ID: 123456789abc
Revises: e9d48d4ed194
Create Date: 2026-06-20 18:22:40.000000
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "123456789abc"
down_revision = "e9d48d4ed194"
branch_labels = None
depends_on = None


def upgrade():
    # Keep this branch as a no-op. The product/supply feature code writes mixed
    # actor ids here today, so changing the FK in this historical migration is
    # not safe. A coordinated data-model cleanup can be added later as a new
    # forward migration.
    pass


def downgrade():
    pass
