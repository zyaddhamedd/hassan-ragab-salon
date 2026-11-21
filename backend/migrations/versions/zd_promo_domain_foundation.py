"""Promo domain and database foundation only.

Revision ID: zd_promo_domain_foundation
Revises: zc_m4c_device_enrollments

Downgrade is structural only. Do not use it to roll back a deployment after
redemptions exist: disable future promo use and retain financial evidence.
"""
from alembic import op
import sqlalchemy as sa


revision = "zd_promo_domain_foundation"
down_revision = "zc_m4c_device_enrollments"
branch_labels = None
depends_on = None


def _enum(name, *values):
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True)


def upgrade():
    op.create_table(
        "promo_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("normalized_code", sa.String(64), nullable=False),
        sa.Column("discount_type", _enum("promo_discount_type_enum", "PERCENTAGE", "FIXED"), nullable=False),
        sa.Column("discount_value", sa.Numeric(12, 2), nullable=False),
        sa.Column("category_scope", _enum("promo_category_scope_enum", "ALL_SERVICE_CATEGORIES", "SELECTED_SERVICE_CATEGORIES"), nullable=False),
        sa.Column("branch_scope", _enum("promo_branch_scope_enum", "ALL_BRANCHES", "SELECTED_BRANCHES"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("usage_limit", sa.Integer(), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("normalized_code", name="uq_promo_codes_normalized_code"),
        sa.CheckConstraint("length(trim(code)) BETWEEN 1 AND 64 AND normalized_code = upper(trim(code))", name="ck_promo_codes_normalized_code"),
        sa.CheckConstraint("discount_value > 0 AND discount_value <= 9999999999.99", name="ck_promo_codes_discount_value"),
        sa.CheckConstraint("discount_type != 'PERCENTAGE' OR discount_value <= 100", name="ck_promo_codes_percentage"),
        sa.CheckConstraint("usage_limit IS NULL OR usage_limit > 0", name="ck_promo_codes_usage_limit"),
        sa.CheckConstraint("starts_at IS NULL OR expires_at IS NULL OR starts_at < expires_at", name="ck_promo_codes_date_range"),
        sa.CheckConstraint("version > 0", name="ck_promo_codes_version"),
    )
    op.create_table(
        "promo_code_categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("promo_code_id", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["promo_code_id"], ["promo_codes.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["category_id"], ["service_categories.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("promo_code_id", "category_id", name="uq_promo_code_categories_pair"),
    )
    op.create_index("ix_promo_code_categories_category_id", "promo_code_categories", ["category_id"])
    op.create_table(
        "promo_code_branches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("promo_code_id", sa.Integer(), nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["promo_code_id"], ["promo_codes.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("promo_code_id", "branch_id", name="uq_promo_code_branches_pair"),
    )
    op.create_index("ix_promo_code_branches_branch_id", "promo_code_branches", ["branch_id"])
    op.create_table(
        "promo_redemptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("promo_code_id", sa.Integer(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.Column("confirmed_by_employee_id", sa.Integer(), nullable=False),
        sa.Column("redeemed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("code_snapshot", sa.String(64), nullable=False),
        sa.Column("promo_version_snapshot", sa.Integer(), nullable=False),
        sa.Column("discount_type_snapshot", _enum("promo_redemption_discount_type_enum", "PERCENTAGE", "FIXED"), nullable=False),
        sa.Column("discount_value_snapshot", sa.Numeric(12, 2), nullable=False),
        sa.Column("category_scope_snapshot", _enum("promo_redemption_category_scope_enum", "ALL_SERVICE_CATEGORIES", "SELECTED_SERVICE_CATEGORIES"), nullable=False),
        sa.Column("branch_scope_snapshot", _enum("promo_redemption_branch_scope_enum", "ALL_BRANCHES", "SELECTED_BRANCHES"), nullable=False),
        sa.Column("eligible_subtotal", sa.Numeric(12, 2), nullable=False),
        sa.Column("promo_discount_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("gross_invoice_total", sa.Numeric(12, 2), nullable=False),
        sa.Column("total_discount_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("net_invoice_total", sa.Numeric(12, 2), nullable=False),
        sa.Column("eligibility_snapshot_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("eligibility_snapshot", sa.JSON(none_as_null=True), nullable=False),
        sa.ForeignKeyConstraint(["promo_code_id"], ["promo_codes.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["confirmed_by_employee_id"], ["employees.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("invoice_id", name="uq_promo_redemptions_invoice_id"),
        sa.CheckConstraint("promo_version_snapshot > 0 AND eligibility_snapshot_version > 0", name="ck_promo_redemptions_versions"),
        sa.CheckConstraint("discount_value_snapshot > 0 AND discount_value_snapshot <= 9999999999.99", name="ck_promo_redemptions_configured_value"),
        sa.CheckConstraint("discount_type_snapshot != 'PERCENTAGE' OR discount_value_snapshot <= 100", name="ck_promo_redemptions_percentage"),
        sa.CheckConstraint("eligible_subtotal > 0 AND eligible_subtotal <= gross_invoice_total", name="ck_promo_redemptions_eligible_subtotal"),
        sa.CheckConstraint("promo_discount_amount > 0 AND promo_discount_amount <= eligible_subtotal", name="ck_promo_redemptions_discount"),
        sa.CheckConstraint("total_discount_amount = promo_discount_amount", name="ck_promo_redemptions_no_stacking"),
        sa.CheckConstraint("gross_invoice_total > 0 AND gross_invoice_total <= 9999999999.99 AND net_invoice_total >= 0 AND net_invoice_total = gross_invoice_total - total_discount_amount", name="ck_promo_redemptions_totals"),
    )
    op.create_index("ix_promo_redemptions_promo_code_id", "promo_redemptions", ["promo_code_id"])
    op.create_index("ix_promo_redemptions_branch_id", "promo_redemptions", ["branch_id"])


def downgrade():
    # No standalone PostgreSQL ENUM types: enums are VARCHAR + CHECK constraints.
    op.drop_index("ix_promo_redemptions_branch_id", table_name="promo_redemptions")
    op.drop_index("ix_promo_redemptions_promo_code_id", table_name="promo_redemptions")
    op.drop_table("promo_redemptions")
    op.drop_index("ix_promo_code_branches_branch_id", table_name="promo_code_branches")
    op.drop_table("promo_code_branches")
    op.drop_index("ix_promo_code_categories_category_id", table_name="promo_code_categories")
    op.drop_table("promo_code_categories")
    op.drop_table("promo_codes")
