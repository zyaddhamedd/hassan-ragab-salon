"""Promo configuration, transactional management, and read-only draft previews.

Preview quotes are advisory, never usage reservations or payment authorization.
Final validation, locking, and redemption writes belong to the payment phase.
"""
import re
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from zoneinfo import ZoneInfo
import hashlib
import json

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models.promo_code import PromoCode, PromoCodeCategory, PromoCodeBranch, PromoRedemption
from app.models.invoice import Invoice, InvoiceItem, InvoiceStatus
from app.models.service import ServiceCategory, Service
from app.models.product import Product
from app.models.branch import Branch
from app.models.user import UserRole

from app.models.promo_code import PromoBranchScope, PromoCategoryScope, PromoDiscountType, PromoDiscountScope


MAX_PROMO_VALUE = Decimal("9999999999.99")
MAX_USAGE_LIMIT = 2147483647


def normalize_promo_code(code: str) -> str:
    """Trim and uppercase a 1–64 character ASCII code (letters/digits/_/-).

    Keeping the alphabet ASCII makes Python and database canonicalization agree
    independently of PostgreSQL collation. Archived codes share this namespace.
    """
    if not isinstance(code, str):
        raise ValueError("Promo code must be a string")
    normalized = code.strip().upper()
    if not re.fullmatch(r"[A-Z0-9_-]{1,64}", normalized) or not code.strip().isascii():
        raise ValueError("Promo code must contain 1–64 ASCII letters, digits, underscores or hyphens")
    return normalized


def _validate_enum(value, enum_class, field):
    try:
        return enum_class(value)
    except (ValueError, TypeError):
        raise ValueError(f"Invalid {field}") from None


def validate_discount_type(discount_type) -> PromoDiscountType:
    return _validate_enum(discount_type, PromoDiscountType, "discount type")


def validate_discount_value(discount_type, value) -> Decimal:
    discount_type = validate_discount_type(discount_type)
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Discount value must be a finite positive decimal") from None
    if not amount.is_finite() or amount <= 0 or amount > MAX_PROMO_VALUE:
        raise ValueError("Discount value must be positive and fit Numeric(12, 2)")
    if discount_type == PromoDiscountType.PERCENTAGE and amount > 100:
        raise ValueError("Percentage discount cannot exceed 100")
    if amount != amount.quantize(Decimal("0.01")):
        raise ValueError("Discount value must have at most two decimal places")
    return amount.quantize(Decimal("0.01"))


def validate_usage_limit(usage_limit):
    if usage_limit is None:
        return None
    if type(usage_limit) is not int or not 1 <= usage_limit <= MAX_USAGE_LIMIT:
        raise ValueError("Usage limit must be a positive integer or null")
    return usage_limit


def normalize_promo_datetime(value, field="datetime"):
    if value is None:
        return None
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field} must be a timezone-aware datetime")
    return value.astimezone(timezone.utc)


def validate_date_range(starts_at=None, expires_at=None):
    starts_at = normalize_promo_datetime(starts_at, "starts_at")
    expires_at = normalize_promo_datetime(expires_at, "expires_at")
    if starts_at is not None and expires_at is not None and starts_at >= expires_at:
        raise ValueError("starts_at must be earlier than expires_at")
    return starts_at, expires_at


def _validate_scope(scope, ids, enum_class, selected_scope, field):
    scope = _validate_enum(scope, enum_class, field)
    if ids is None:
        ids = ()
    if not isinstance(ids, (list, tuple, set, frozenset)):
        raise ValueError(f"{field} IDs must be a collection of positive integers")
    if any(type(item_id) is not int or item_id <= 0 for item_id in ids):
        raise ValueError(f"{field} IDs must be positive integers")
    normalized_ids = tuple(sorted(set(ids)))
    if scope == selected_scope and not normalized_ids:
        raise ValueError(f"Selected {field} requires at least one ID")
    if scope != selected_scope and normalized_ids:
        raise ValueError(f"All {field} cannot also specify selected IDs")
    return scope, normalized_ids


def validate_category_scope(scope, category_ids=None):
    return _validate_scope(
        scope, category_ids, PromoCategoryScope,
        PromoCategoryScope.SELECTED_SERVICE_CATEGORIES, "category scope",
    )


def validate_branch_scope(scope, branch_ids=None):
    return _validate_scope(
        scope, branch_ids, PromoBranchScope,
        PromoBranchScope.SELECTED_BRANCHES, "branch scope",
    )


PROMO_MESSAGES = {
    "PROMO_NOT_FOUND": "كود الخصم غير موجود",
    "PROMO_INACTIVE": "كود الخصم غير نشط",
    "PROMO_ARCHIVED": "كود الخصم مؤرشف ولا يمكن استخدامه أو تعديله",
    "PROMO_NOT_STARTED": "لم يبدأ موعد استخدام كود الخصم",
    "PROMO_EXPIRED": "انتهت صلاحية كود الخصم",
    "PROMO_BRANCH_NOT_ALLOWED": "كود الخصم غير متاح لهذا الفرع",
    "PROMO_USAGE_LIMIT_REACHED": "تم الوصول للحد الأقصى لاستخدام كود الخصم",
    "PROMO_NO_ELIGIBLE_ITEMS": "لا توجد بنود مؤهلة لهذا الكود",
    "PROMO_DISCOUNTS_DISABLED": "الخصومات غير مفعلة لهذا الفرع",
    "PROMO_INVALID_CONFIGURATION": "إعدادات كود الخصم أو البيانات المدخلة غير صالحة",
    "PROMO_DUPLICATE_CODE": "كود الخصم مسجل بالفعل، بما في ذلك الأكواد المؤرشفة",
    "PROMO_FORBIDDEN": "ليس لديك صلاحية إدارة هذا الكود أو نطاق الفروع",
    "PROMO_INVOICE_NOT_FOUND": "الفاتورة غير موجودة أو غير متاحة لهذا الفرع",
    "PROMO_INVALID_INVOICE_STATE": "يمكن معاينة الخصم على فاتورة مسودة فقط",
    "PROMO_INVALID_INVOICE": "بيانات بنود الفاتورة غير صالحة لحساب الخصم",
    "PROMO_MANUAL_DISCOUNT_CONFLICT": "لا يمكن الجمع بين كود الخصم والخصم اليدوي",
    "PROMO_QUOTE_STALE": "انتهت صلاحية تسعير كود الخصم لتغير بيانات الفاتورة أو الكود، يرجى إعادة تطبيق الكود",
    "PROMO_ALREADY_REDEEMED": "تم استخدام كود خصم على هذه الفاتورة بالفعل",
    "PROMO_CODE_IMMUTABLE": "لا يمكن تغيير هوية كود خصم سبق استخدامه",
    "PROMO_INTERNAL_ERROR": "تعذر تنفيذ طلب كود الخصم، حاول مرة أخرى",
}


class PromoError(ValueError):
    def __init__(self, code, status=400):
        self.code = code
        self.status = status
        super().__init__(PROMO_MESSAGES[code])

    def to_dict(self):
        return {"error": self.code, "message": str(self)}


def _stored_datetime(value):
    # PostgreSQL returns aware timestamptz values; SQLite drops tzinfo on reload.
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def parse_promo_date(value, *, expiry=False):
    """Aware ISO timestamp or Cairo calendar date; expiry dates include that day."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Expected an ISO date or timezone-aware timestamp")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        calendar_date = date.fromisoformat(value)
        if expiry:
            calendar_date += timedelta(days=1)
        return datetime.combine(calendar_date, time.min, ZoneInfo("Africa/Cairo")).astimezone(timezone.utc)
    return normalize_promo_datetime(datetime.fromisoformat(value.replace("Z", "+00:00")))


def money(value):
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def is_promo_item_eligible(promo, item_type, category_id, category_ids):
    """One scope/category rule shared by preview and authoritative redemption."""
    scope = _validate_enum(promo.discount_scope, PromoDiscountScope, "discount scope")
    if item_type == "PRODUCT_ITEM":
        return scope in (PromoDiscountScope.PRODUCTS_ONLY, PromoDiscountScope.SERVICES_AND_PRODUCTS)
    return item_type == "SERVICE_ITEM" and scope != PromoDiscountScope.PRODUCTS_ONLY and (
        promo.category_scope == PromoCategoryScope.ALL_SERVICE_CATEGORIES or category_id in category_ids
    )


def calculate_promo_discount(discount_type, configured_value, eligible_subtotal):
    """Pure Decimal calculation, capped to eligible subtotal; no invoice writes."""
    try:
        discount_type = validate_discount_type(discount_type)
        configured_value = validate_discount_value(discount_type, configured_value)
        eligible = Decimal(str(eligible_subtotal))
        if not eligible.is_finite() or not 0 < eligible <= MAX_PROMO_VALUE:
            raise PromoError("PROMO_NO_ELIGIBLE_ITEMS")
        eligible = money(eligible)
        amount = eligible * configured_value / Decimal("100") if discount_type == PromoDiscountType.PERCENTAGE else configured_value
        discount = min(money(amount), eligible)
        if discount <= 0:
            raise PromoError("PROMO_NO_ELIGIBLE_ITEMS")
        return discount
    except PromoError:
        raise
    except (ValueError, InvalidOperation, TypeError):
        raise PromoError("PROMO_INVALID_CONFIGURATION") from None


def promo_memberships(promo_id):
    categories = tuple(row[0] for row in db.session.query(PromoCodeCategory.category_id).filter_by(promo_code_id=promo_id).order_by(PromoCodeCategory.category_id))
    branches = tuple(row[0] for row in db.session.query(PromoCodeBranch.branch_id).filter_by(promo_code_id=promo_id).order_by(PromoCodeBranch.branch_id))
    return categories, branches


def paid_usage_count(promo_id):
    return db.session.query(func.count(PromoRedemption.id)).join(Invoice, Invoice.id == PromoRedemption.invoice_id).filter(
        PromoRedemption.promo_code_id == promo_id, Invoice.status == InvoiceStatus.PAID,
    ).scalar() or 0


def validate_promo_availability(promo, branch, category_ids, branch_ids, used_count, now=None):
    if promo.archived_at is not None:
        raise PromoError("PROMO_ARCHIVED")
    if not promo.is_active:
        raise PromoError("PROMO_INACTIVE")
    try:
        _validate_enum(promo.discount_scope, PromoDiscountScope, "discount scope")
        validate_discount_value(promo.discount_type, promo.discount_value)
        validate_category_scope(promo.category_scope, category_ids)
        validate_branch_scope(promo.branch_scope, branch_ids)
        validate_usage_limit(promo.usage_limit)
        start, end = validate_date_range(_stored_datetime(promo.starts_at), _stored_datetime(promo.expires_at))
        now = normalize_promo_datetime(now or datetime.now(timezone.utc))
    except ValueError:
        raise PromoError("PROMO_INVALID_CONFIGURATION") from None
    if start is not None and now < start:
        raise PromoError("PROMO_NOT_STARTED")
    if end is not None and now >= end:
        raise PromoError("PROMO_EXPIRED")
    if promo.branch_scope == PromoBranchScope.SELECTED_BRANCHES and branch.id not in branch_ids:
        raise PromoError("PROMO_BRANCH_NOT_ALLOWED", 403)
    if not branch.allow_discounts:
        raise PromoError("PROMO_DISCOUNTS_DISABLED")
    if promo.usage_limit is not None and used_count >= promo.usage_limit:
        raise PromoError("PROMO_USAGE_LIMIT_REACHED")


def preview_invoice_promo(invoice_id, branch_id, code):
    """Read persisted items and current service categories. Never flush or commit."""
    with db.session.no_autoflush:
        invoice = Invoice.query.options(joinedload(Invoice.branch)).filter_by(id=invoice_id, branch_id=branch_id).first() if branch_id else None
        if invoice is None:
            raise PromoError("PROMO_INVOICE_NOT_FOUND", 404)
        if invoice.status != InvoiceStatus.DRAFT:
            raise PromoError("PROMO_INVALID_INVOICE_STATE", 409)
        if invoice.discount_amount != 0:
            raise PromoError("PROMO_MANUAL_DISCOUNT_CONFLICT", 409)
        if db.session.query(PromoRedemption.id).filter_by(invoice_id=invoice.id).first():
            raise PromoError("PROMO_INVALID_INVOICE_STATE", 409)
        try:
            normalized = normalize_promo_code(code)
        except ValueError:
            raise PromoError("PROMO_NOT_FOUND", 404) from None
        promo = PromoCode.query.filter_by(normalized_code=normalized).first()
        if promo is None:
            raise PromoError("PROMO_NOT_FOUND", 404)
        category_ids, branch_ids = promo_memberships(promo.id)
        validate_promo_availability(promo, invoice.branch, category_ids, branch_ids, paid_usage_count(promo.id))
        items = InvoiceItem.query.options(joinedload(InvoiceItem.service)).filter_by(invoice_id=invoice.id).order_by(InvoiceItem.id).all()
        gross = Decimal("0")
        eligible = Decimal("0")
        item_context = []
        for item in items:
            try:
                price = Decimal(str(item.service_price))
                if not price.is_finite() or not 0 <= price <= MAX_PROMO_VALUE or type(item.quantity) is not int or item.quantity <= 0:
                    raise ValueError()
                line_total = price * item.quantity
                if line_total > MAX_PROMO_VALUE:
                    raise ValueError()
            except (InvalidOperation, ValueError, TypeError):
                raise PromoError("PROMO_INVALID_INVOICE") from None
            if item.item_type not in ("SERVICE_ITEM", "PRODUCT_ITEM"):
                raise PromoError("PROMO_INVALID_INVOICE")
            gross += line_total
            category_id = item.service.category_id if item.item_type == "SERVICE_ITEM" and item.service else None
            matches = is_promo_item_eligible(promo, item.item_type, category_id, category_ids)
            if matches:
                eligible += line_total
            item_context.append([item.id, item.item_type, item.service_id, item.product_id, str(price), item.quantity, category_id])
        if gross > MAX_PROMO_VALUE:
            raise PromoError("PROMO_INVALID_INVOICE")
        gross, eligible = money(gross), money(eligible)
        if eligible <= 0:
            raise PromoError("PROMO_NO_ELIGIBLE_ITEMS")
        discount = calculate_promo_discount(promo.discount_type, promo.discount_value, eligible)
        result = {
            "promo_id": promo.id, "code": promo.normalized_code, "version": promo.version,
            "discount_type": promo.discount_type.value, "configured_value": str(money(promo.discount_value)),
            "eligible_subtotal": str(eligible), "promo_discount": str(discount),
            "gross_subtotal": str(gross), "projected_total_discount": str(discount),
            "projected_net_total": str(gross - discount),
            "category_scope": promo.category_scope.value, "branch_scope": promo.branch_scope.value,
            "discount_scope": promo.discount_scope.value, "quote_version": 2,
        }
        # Deterministic context identifier, NOT a signature or a reservation.
        context = {"result": result, "invoice_id": invoice.id, "branch_id": branch_id,
                   "items": item_context, "categories": category_ids, "branches": branch_ids}
        result["quote_id"] = hashlib.sha256(json.dumps(context, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return result


def redeem_invoice_promo(invoice, code, confirmed_by_id, quote_id=None, promo_version=None, now_utc=None):
    """Authoritative validation and redemption snapshot within the confirm transaction."""
    if not code:
        raise PromoError("PROMO_NOT_FOUND", 404)
    if invoice.status != InvoiceStatus.DRAFT:
        raise PromoError("PROMO_INVALID_INVOICE_STATE", 409)
    if db.session.query(PromoRedemption.id).filter_by(invoice_id=invoice.id).first():
        raise PromoError("PROMO_ALREADY_REDEEMED", 409)

    try:
        normalized = normalize_promo_code(code)
    except ValueError:
        raise PromoError("PROMO_NOT_FOUND", 404) from None

    promo = PromoCode.query.populate_existing().filter_by(normalized_code=normalized).with_for_update().first()
    if promo is None:
        raise PromoError("PROMO_NOT_FOUND", 404)

    now = normalize_promo_datetime(now_utc or datetime.now(timezone.utc))
    category_ids, branch_ids = promo_memberships(promo.id)
    validate_promo_availability(promo, invoice.branch, category_ids, branch_ids, paid_usage_count(promo.id), now=now)

    if promo_version is not None and int(promo_version) != promo.version:
        raise PromoError("PROMO_QUOTE_STALE", 409)

    items = InvoiceItem.query.options(
        joinedload(InvoiceItem.service).joinedload(Service.category),
        joinedload(InvoiceItem.product),
    ).filter_by(invoice_id=invoice.id).order_by(InvoiceItem.id).all()

    if not items:
        raise PromoError("PROMO_INVALID_INVOICE")

    gross = Decimal("0")
    eligible = Decimal("0")
    item_context = []
    item_snapshots = []

    for item in items:
        try:
            price = Decimal(str(item.service_price))
            if not price.is_finite() or not 0 <= price <= MAX_PROMO_VALUE or type(item.quantity) is not int or item.quantity <= 0:
                raise ValueError()
            line_total = price * item.quantity
            if line_total > MAX_PROMO_VALUE:
                raise ValueError()
        except (InvalidOperation, ValueError, TypeError):
            raise PromoError("PROMO_INVALID_INVOICE") from None

        if item.item_type not in ("SERVICE_ITEM", "PRODUCT_ITEM"):
            raise PromoError("PROMO_INVALID_INVOICE")

        gross += line_total
        category_id = item.service.category_id if item.item_type == "SERVICE_ITEM" and item.service else None
        matches = is_promo_item_eligible(promo, item.item_type, category_id, category_ids)
        if matches:
            eligible += line_total

        service_name = item.service.name if item.item_type == "SERVICE_ITEM" and item.service else None
        category_name = item.service.category.name if item.item_type == "SERVICE_ITEM" and item.service and item.service.category else None
        product_name = item.product.name if item.item_type == "PRODUCT_ITEM" and hasattr(item, "product") and item.product else None

        item_snapshots.append({
            "invoice_item_id": item.id,
            "item_type": item.item_type,
            "service_id": item.service_id,
            "service_name": service_name,
            "category_id": category_id,
            "category_name": category_name,
            "product_id": item.product_id,
            "product_name": product_name,
            "quantity": item.quantity,
            "unit_price": str(money(price)),
            "line_total": str(money(line_total)),
            "is_eligible": matches,
        })
        item_context.append([item.id, item.item_type, item.service_id, item.product_id, str(price), item.quantity, category_id])

    if gross > MAX_PROMO_VALUE:
        raise PromoError("PROMO_INVALID_INVOICE")

    gross, eligible = money(gross), money(eligible)
    if eligible <= 0:
        raise PromoError("PROMO_NO_ELIGIBLE_ITEMS")

    discount = calculate_promo_discount(promo.discount_type, promo.discount_value, eligible)

    result_preview = {
        "promo_id": promo.id, "code": promo.normalized_code, "version": promo.version,
        "discount_type": promo.discount_type.value, "configured_value": str(money(promo.discount_value)),
        "eligible_subtotal": str(eligible), "promo_discount": str(discount),
        "gross_subtotal": str(gross), "projected_total_discount": str(discount),
        "projected_net_total": str(gross - discount),
        "category_scope": promo.category_scope.value, "branch_scope": promo.branch_scope.value,
        "discount_scope": promo.discount_scope.value, "quote_version": 2,
    }
    context = {
        "result": result_preview, "invoice_id": invoice.id, "branch_id": invoice.branch_id,
        "items": item_context, "categories": category_ids, "branches": branch_ids,
    }
    calculated_quote_id = hashlib.sha256(json.dumps(context, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    if quote_id is not None and str(quote_id).strip() != calculated_quote_id:
        raise PromoError("PROMO_QUOTE_STALE", 409)

    redemption = PromoRedemption(
        promo_code_id=promo.id,
        invoice_id=invoice.id,
        branch_id=invoice.branch_id,
        confirmed_by_employee_id=confirmed_by_id,
        redeemed_at=now,
        code_snapshot=promo.normalized_code,
        promo_version_snapshot=promo.version,
        discount_type_snapshot=promo.discount_type,
        discount_value_snapshot=money(promo.discount_value),
        category_scope_snapshot=promo.category_scope,
        branch_scope_snapshot=promo.branch_scope,
        eligible_subtotal=eligible,
        promo_discount_amount=discount,
        gross_invoice_total=gross,
        total_discount_amount=discount,
        net_invoice_total=gross - discount,
        eligibility_snapshot_version=2,
        eligibility_snapshot={
            "discount_scope": promo.discount_scope.value,
            "items": item_snapshots,
            "selected_category_ids": list(category_ids),
            "selected_branch_ids": list(branch_ids),
        },
    )

    promo_summary = {
        "code": promo.normalized_code,
        "discount_type": promo.discount_type.value,
        "configured_value": str(money(promo.discount_value)),
        "eligible_subtotal": str(eligible),
        "discount_amount": str(discount),
        "version": promo.version,
    }

    return discount, redemption, promo_summary


PROMO_FIELDS = {"discount_scope", "code", "discount_type", "discount_value", "category_scope", "category_ids", "branch_scope", "branch_ids", "is_active", "starts_at", "expires_at", "usage_limit"}


def _manager_scope(user, branch_scope, branch_ids):
    if user.role in (UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN):
        return
    if user.role == UserRole.BRANCH_MANAGER and user.branch_id and branch_scope == PromoBranchScope.SELECTED_BRANCHES and tuple(branch_ids) == (user.branch_id,):
        return
    raise PromoError("PROMO_FORBIDDEN", 403)


def _configuration(payload, current=None):
    if not isinstance(payload, dict) or not payload or set(payload) - PROMO_FIELDS:
        raise PromoError("PROMO_INVALID_CONFIGURATION")
    old_categories, old_branches = promo_memberships(current.id) if current else ((), ())
    values = {key: getattr(current, key) for key in PROMO_FIELDS - {"category_ids", "branch_ids"}} if current else {"discount_scope": PromoDiscountScope.SERVICES_ONLY, "is_active": True, "starts_at": None, "expires_at": None, "usage_limit": None}
    values.update(category_ids=old_categories, branch_ids=old_branches)
    values.update(payload)
    try:
        values["discount_scope"] = _validate_enum(values["discount_scope"], PromoDiscountScope, "discount scope")
        normalize_promo_code(values["code"])
        values["code"] = values["code"].strip()
        values["discount_type"] = validate_discount_type(values["discount_type"])
        values["discount_value"] = validate_discount_value(values["discount_type"], values["discount_value"])
        values["usage_limit"] = validate_usage_limit(values["usage_limit"])
        if type(values["is_active"]) is not bool:
            raise ValueError()
        for key in ("starts_at", "expires_at"):
            values[key] = parse_promo_date(values[key], expiry=key == "expires_at") if key in payload else _stored_datetime(values[key])
        values["starts_at"], values["expires_at"] = validate_date_range(values["starts_at"], values["expires_at"])
        values["category_scope"], values["category_ids"] = validate_category_scope(values["category_scope"], values["category_ids"])
        values["branch_scope"], values["branch_ids"] = validate_branch_scope(values["branch_scope"], values["branch_ids"])
    except (KeyError, ValueError, TypeError, OverflowError):
        raise PromoError("PROMO_INVALID_CONFIGURATION") from None
    if values["category_ids"]:
        existing = {row[0] for row in db.session.query(ServiceCategory.id).filter(ServiceCategory.id.in_(values["category_ids"]))}
        if existing != set(values["category_ids"]):
            raise PromoError("PROMO_INVALID_CONFIGURATION")
    if values["branch_ids"]:
        existing = {row[0] for row in db.session.query(Branch.id).filter(Branch.id.in_(values["branch_ids"]))}
        if existing != set(values["branch_ids"]):
            raise PromoError("PROMO_INVALID_CONFIGURATION")
    return values, old_categories, old_branches


def serialize_promo(promo, category_ids=(), branch_ids=()):
    return {
        "id": promo.id, "code": promo.code, "normalized_code": promo.normalized_code,
        "discount_scope": promo.discount_scope.value,
        "discount_type": promo.discount_type.value, "discount_value": str(money(promo.discount_value)),
        "category_scope": promo.category_scope.value, "category_ids": list(category_ids),
        "branch_scope": promo.branch_scope.value, "branch_ids": list(branch_ids),
        "is_active": promo.is_active, "usage_limit": promo.usage_limit, "version": promo.version,
        **{key: _stored_datetime(getattr(promo, key)).isoformat() if getattr(promo, key) else None
           for key in ("starts_at", "expires_at", "archived_at", "created_at", "updated_at")},
    }


def _replace_memberships(promo, category_ids, branch_ids, old_categories=(), old_branches=()):
    for model, key, new, old in ((PromoCodeCategory, "category_id", category_ids, old_categories),
                                (PromoCodeBranch, "branch_id", branch_ids, old_branches)):
        if tuple(new) != tuple(old):
            model.query.filter_by(promo_code_id=promo.id).delete(synchronize_session=False)
            db.session.add_all(model(promo_code_id=promo.id, **{key: identity}) for identity in new)


def _configuration_integrity_error(error):
    # Handle flush/autoflush/commit races with the same public error contract.
    original = str(error.orig)
    if "uq_promo_codes_normalized_code" in original or "UNIQUE constraint failed: promo_codes.normalized_code" in original:
        return PromoError("PROMO_DUPLICATE_CODE", 409)
    return PromoError("PROMO_INVALID_CONFIGURATION")


def save_promo(payload, user, promo_id=None):
    try:
        current = PromoCode.query.populate_existing().filter_by(id=promo_id).with_for_update().first() if promo_id is not None else None
        if promo_id is not None and current is None:
            raise PromoError("PROMO_NOT_FOUND", 404)
        if current:
            _, current_branches = promo_memberships(current.id)
            _manager_scope(user, current.branch_scope, current_branches)
            if current.archived_at:
                raise PromoError("PROMO_ARCHIVED", 409)
        values, old_categories, old_branches = _configuration(payload, current)
        _manager_scope(user, values["branch_scope"], values["branch_ids"])
        canonical = normalize_promo_code(values["code"])
        duplicate = PromoCode.query.filter_by(normalized_code=canonical).first()
        if duplicate is not None and (current is None or duplicate.id != current.id):
            raise PromoError("PROMO_DUPLICATE_CODE", 409)
        if current and current.normalized_code != canonical and PromoRedemption.query.filter_by(promo_code_id=current.id).first():
            raise PromoError("PROMO_CODE_IMMUTABLE", 409)
        categories, branches = values.pop("category_ids"), values.pop("branch_ids")
        if current is None:
            current = PromoCode(**values, created_by_user_id=user.id, updated_by_user_id=user.id)
            db.session.add(current)
            db.session.flush()
        else:
            changed = categories != old_categories or branches != old_branches
            for key, value in values.items():
                old = _stored_datetime(getattr(current, key)) if key in ("starts_at", "expires_at") else getattr(current, key)
                changed = changed or old != value
                setattr(current, key, value)
            if changed:
                current.version += 1
                current.updated_by_user_id = user.id
        _replace_memberships(current, categories, branches, old_categories, old_branches)
        db.session.commit()
        return serialize_promo(current, categories, branches)
    except IntegrityError as error:
        db.session.rollback()
        raise _configuration_integrity_error(error) from None
    except Exception:
        db.session.rollback()
        raise


def archive_promo(promo_id, user):
    try:
        promo = PromoCode.query.populate_existing().filter_by(id=promo_id).with_for_update().first()
        if promo is None:
            raise PromoError("PROMO_NOT_FOUND", 404)
        categories, branches = promo_memberships(promo.id)
        _manager_scope(user, promo.branch_scope, branches)
        if promo.archived_at is None:
            promo.archived_at = datetime.now(timezone.utc)
            promo.is_active = False
            promo.version += 1
            promo.updated_by_user_id = user.id
        db.session.commit()
        return serialize_promo(promo, categories, branches)
    except IntegrityError as error:
        db.session.rollback()
        raise _configuration_integrity_error(error) from None
    except Exception:
        db.session.rollback()
        raise


def list_promos(allowed_branch_ids, page, per_page, search=None, is_active=None):
    query = PromoCode.query
    if allowed_branch_ids is not None:
        if not allowed_branch_ids:
            query = query.filter(False)
        else:
            matching = db.session.query(PromoCodeBranch.promo_code_id).filter(PromoCodeBranch.branch_id.in_(allowed_branch_ids))
            query = query.filter(or_(PromoCode.branch_scope == PromoBranchScope.ALL_BRANCHES, PromoCode.id.in_(matching)))
    if search:
        query = query.filter(PromoCode.normalized_code.contains(search.strip().upper(), autoescape=True))
    if is_active is not None:
        query = query.filter(PromoCode.is_active == is_active)
    paginated = query.order_by(PromoCode.created_at.desc(), PromoCode.id.desc()).paginate(page=page, per_page=per_page, error_out=False)
    ids = [promo.id for promo in paginated.items]
    categories, branches = {}, {}
    if ids:
        for row in PromoCodeCategory.query.filter(PromoCodeCategory.promo_code_id.in_(ids)).order_by(PromoCodeCategory.category_id):
            categories.setdefault(row.promo_code_id, []).append(row.category_id)
        for row in PromoCodeBranch.query.filter(PromoCodeBranch.promo_code_id.in_(ids)).order_by(PromoCodeBranch.branch_id):
            branches.setdefault(row.promo_code_id, []).append(row.branch_id)
    return {"items": [serialize_promo(promo, categories.get(promo.id, ()), branches.get(promo.id, ())) for promo in paginated.items],
            "total": paginated.total, "pages": paginated.pages, "current_page": page, "per_page": per_page}
