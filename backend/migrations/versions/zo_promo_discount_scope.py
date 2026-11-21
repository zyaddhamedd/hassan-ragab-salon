"""Add explicit promo discount scope; preserve legacy service-only behavior.

Revision ID: zo_promo_discount_scope
Revises: zn_shipment_cancellation
"""
from alembic import op
import sqlalchemy as sa

revision = "zo_promo_discount_scope"
down_revision = "zn_shipment_cancellation"
branch_labels = None
depends_on = None


def upgrade():
    # Inline CHECK permits an additive ALTER on SQLite too: no table rebuild.
    op.add_column("promo_codes", sa.Column(
        "discount_scope", sa.String(32),
        sa.CheckConstraint("discount_scope IN ('SERVICES_ONLY', 'PRODUCTS_ONLY', 'SERVICES_AND_PRODUCTS')", name="promo_discount_scope_enum"),
        nullable=False, server_default="SERVICES_ONLY",
    ))


def downgrade():
    # Structural rollback only, before V2 use. Retain this column after V2 writes.
    with op.batch_alter_table("promo_codes") as batch:
        batch.drop_constraint("promo_discount_scope_enum", type_="check")
        batch.drop_column("discount_scope")
