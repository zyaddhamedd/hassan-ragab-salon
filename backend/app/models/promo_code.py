"""Promo persistence only; invoice/payment integration belongs to a later phase.

Redemptions hold independent snapshots and must be treated as append-only
financial evidence. No parent-side delete cascades or invoice backrefs are added.
"""
import enum
from datetime import datetime, timezone

from sqlalchemy.orm import validates

from app.extensions import db


class PromoDiscountType(enum.Enum):
    PERCENTAGE = "PERCENTAGE"
    FIXED = "FIXED"


class PromoDiscountScope(enum.Enum):
    SERVICES_ONLY = "SERVICES_ONLY"
    PRODUCTS_ONLY = "PRODUCTS_ONLY"
    SERVICES_AND_PRODUCTS = "SERVICES_AND_PRODUCTS"


class PromoCategoryScope(enum.Enum):
    ALL_SERVICE_CATEGORIES = "ALL_SERVICE_CATEGORIES"
    SELECTED_SERVICE_CATEGORIES = "SELECTED_SERVICE_CATEGORIES"


class PromoBranchScope(enum.Enum):
    ALL_BRANCHES = "ALL_BRANCHES"
    SELECTED_BRANCHES = "SELECTED_BRANCHES"


def _enum(enum_class, name):
    return db.Enum(
        enum_class, name=name, native_enum=False,
        create_constraint=True, validate_strings=True,
    )


class PromoCode(db.Model):
    __tablename__ = "promo_codes"

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(64), nullable=False)
    normalized_code = db.Column(db.String(64), nullable=False)
    discount_type = db.Column(_enum(PromoDiscountType, "promo_discount_type_enum"), nullable=False)
    discount_value = db.Column(db.Numeric(12, 2), nullable=False)
    discount_scope = db.Column(
        db.Enum(PromoDiscountScope, name="promo_discount_scope_enum", native_enum=False,
                create_constraint=True, validate_strings=True, length=32),
        nullable=False, default=PromoDiscountScope.SERVICES_ONLY, server_default="SERVICES_ONLY",
    )
    category_scope = db.Column(_enum(PromoCategoryScope, "promo_category_scope_enum"), nullable=False)
    branch_scope = db.Column(_enum(PromoBranchScope, "promo_branch_scope_enum"), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True, server_default=db.true())
    starts_at = db.Column(db.DateTime(timezone=True), nullable=True)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True)
    usage_limit = db.Column(db.Integer, nullable=True)
    version = db.Column(db.Integer, nullable=False, default=1, server_default="1")
    archived_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    updated_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        # Global uniqueness includes archived codes: their identity stays reserved.
        db.UniqueConstraint("normalized_code", name="uq_promo_codes_normalized_code"),
        db.CheckConstraint("length(trim(code)) BETWEEN 1 AND 64 AND normalized_code = upper(trim(code))", name="ck_promo_codes_normalized_code"),
        db.CheckConstraint("discount_value > 0 AND discount_value <= 9999999999.99", name="ck_promo_codes_discount_value"),
        db.CheckConstraint("discount_type != 'PERCENTAGE' OR discount_value <= 100", name="ck_promo_codes_percentage"),
        db.CheckConstraint("usage_limit IS NULL OR usage_limit > 0", name="ck_promo_codes_usage_limit"),
        db.CheckConstraint("starts_at IS NULL OR expires_at IS NULL OR starts_at < expires_at", name="ck_promo_codes_date_range"),
        db.CheckConstraint("version > 0", name="ck_promo_codes_version"),
    )

    created_by_user = db.relationship("User", foreign_keys=[created_by_user_id])
    updated_by_user = db.relationship("User", foreign_keys=[updated_by_user_id])

    @validates("code")
    def _normalize_code(self, key, value):
        from app.services.promo_code_service import normalize_promo_code

        self.normalized_code = normalize_promo_code(value)
        return value.strip()

    @validates("starts_at", "expires_at", "archived_at")
    def _normalize_datetime(self, key, value):
        from app.services.promo_code_service import normalize_promo_datetime

        return normalize_promo_datetime(value, key)


class PromoCodeCategory(db.Model):
    __tablename__ = "promo_code_categories"

    id = db.Column(db.Integer, primary_key=True)
    promo_code_id = db.Column(db.Integer, db.ForeignKey("promo_codes.id", ondelete="RESTRICT"), nullable=False)
    category_id = db.Column(db.Integer, db.ForeignKey("service_categories.id", ondelete="RESTRICT"), nullable=False, index=True)

    __table_args__ = (
        db.UniqueConstraint("promo_code_id", "category_id", name="uq_promo_code_categories_pair"),
    )

    promo_code = db.relationship("PromoCode")
    category = db.relationship("ServiceCategory")


class PromoCodeBranch(db.Model):
    __tablename__ = "promo_code_branches"

    id = db.Column(db.Integer, primary_key=True)
    promo_code_id = db.Column(db.Integer, db.ForeignKey("promo_codes.id", ondelete="RESTRICT"), nullable=False)
    branch_id = db.Column(db.Integer, db.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True)

    __table_args__ = (
        db.UniqueConstraint("promo_code_id", "branch_id", name="uq_promo_code_branches_pair"),
    )

    promo_code = db.relationship("PromoCode")
    branch = db.relationship("Branch")


class PromoRedemption(db.Model):
    __tablename__ = "promo_redemptions"

    id = db.Column(db.Integer, primary_key=True)
    promo_code_id = db.Column(db.Integer, db.ForeignKey("promo_codes.id", ondelete="RESTRICT"), nullable=False, index=True)
    invoice_id = db.Column(db.Integer, db.ForeignKey("invoices.id", ondelete="RESTRICT"), nullable=False)
    branch_id = db.Column(db.Integer, db.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True)
    confirmed_by_employee_id = db.Column(db.Integer, db.ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False)
    redeemed_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    code_snapshot = db.Column(db.String(64), nullable=False)
    promo_version_snapshot = db.Column(db.Integer, nullable=False)
    discount_type_snapshot = db.Column(_enum(PromoDiscountType, "promo_redemption_discount_type_enum"), nullable=False)
    discount_value_snapshot = db.Column(db.Numeric(12, 2), nullable=False)
    category_scope_snapshot = db.Column(_enum(PromoCategoryScope, "promo_redemption_category_scope_enum"), nullable=False)
    branch_scope_snapshot = db.Column(_enum(PromoBranchScope, "promo_redemption_branch_scope_enum"), nullable=False)

    eligible_subtotal = db.Column(db.Numeric(12, 2), nullable=False)
    promo_discount_amount = db.Column(db.Numeric(12, 2), nullable=False)
    gross_invoice_total = db.Column(db.Numeric(12, 2), nullable=False)
    total_discount_amount = db.Column(db.Numeric(12, 2), nullable=False)
    net_invoice_total = db.Column(db.Numeric(12, 2), nullable=False)
    # Version 1 evidence will contain item/service/category identities and names,
    # quantities, decimal-string unit prices/line totals, and selected categories.
    # No default: future redemption writers must explicitly provide the evidence.
    eligibility_snapshot_version = db.Column(db.Integer, nullable=False, default=1, server_default="1")
    eligibility_snapshot = db.Column(db.JSON(none_as_null=True), nullable=False)

    __table_args__ = (
        db.UniqueConstraint("invoice_id", name="uq_promo_redemptions_invoice_id"),
        db.CheckConstraint("promo_version_snapshot > 0 AND eligibility_snapshot_version > 0", name="ck_promo_redemptions_versions"),
        db.CheckConstraint("discount_value_snapshot > 0 AND discount_value_snapshot <= 9999999999.99", name="ck_promo_redemptions_configured_value"),
        db.CheckConstraint("discount_type_snapshot != 'PERCENTAGE' OR discount_value_snapshot <= 100", name="ck_promo_redemptions_percentage"),
        db.CheckConstraint("eligible_subtotal > 0 AND eligible_subtotal <= gross_invoice_total", name="ck_promo_redemptions_eligible_subtotal"),
        db.CheckConstraint("promo_discount_amount > 0 AND promo_discount_amount <= eligible_subtotal", name="ck_promo_redemptions_discount"),
        # V1 forbids stacking with manual invoice discounts.
        db.CheckConstraint("total_discount_amount = promo_discount_amount", name="ck_promo_redemptions_no_stacking"),
        db.CheckConstraint("gross_invoice_total > 0 AND gross_invoice_total <= 9999999999.99 AND net_invoice_total >= 0 AND net_invoice_total = gross_invoice_total - total_discount_amount", name="ck_promo_redemptions_totals"),
    )

    promo_code = db.relationship("PromoCode")
    invoice = db.relationship("Invoice")
    branch = db.relationship("Branch")
    confirmed_by_employee = db.relationship("Employee", foreign_keys=[confirmed_by_employee_id])

    @validates("redeemed_at")
    def _normalize_redeemed_at(self, key, value):
        from app.services.promo_code_service import normalize_promo_datetime

        if value is None:
            raise ValueError("redeemed_at must be timezone-aware")
        return normalize_promo_datetime(value, key)
