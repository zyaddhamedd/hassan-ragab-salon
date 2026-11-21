"""add_device_binding_to_branches (SAFE)

Revision ID: a6b7c8d9e0f1
Revises: b364a257cf87
Create Date: 2026-03-31 04:42:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a6b7c8d9e0f1'
down_revision = 'b364a257cf87'
branch_labels = None
depends_on = None

def upgrade():
    # Adding columns to branches table
    op.add_column('branches', sa.Column('authorized_device_id', sa.String(length=255), nullable=True))
    op.add_column('branches', sa.Column('binding_ip', sa.String(length=45), nullable=True))
    op.add_column('branches', sa.Column('binding_user_agent', sa.Text(), nullable=True))
    op.add_column('branches', sa.Column('binding_timestamp', sa.DateTime(timezone=True), nullable=True))

def downgrade():
    op.drop_column('branches', 'binding_timestamp')
    op.drop_column('branches', 'binding_user_agent')
    op.drop_column('branches', 'binding_ip')
    op.drop_column('branches', 'authorized_device_id')
