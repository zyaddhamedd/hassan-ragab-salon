from dataclasses import dataclass
from datetime import date
from typing import Optional

from sqlalchemy import func, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload
from sqlalchemy.sql import expression

from app.extensions import db
from app.models.inventory_batch import (
    BranchInventoryBatch,
    InventoryBatch,
    InventoryBatchSourceType,
    InventoryBatchStatus,
)
from app.models.product import ProductBranchStock, StockMovementType
from app.utils.date_utils import get_cairo_date, get_utc_now


@dataclass(frozen=True)
class FefoAllocationLine:
    batch_id: int
    branch_inventory_batch_id: int
    batch_number: str
    expiration_date: Optional[str]
    quantity: int


@dataclass(frozen=True)
class FefoDeductionResult:
    product_id: int
    branch_id: int
    requested_quantity: int
    allocated_quantity: int
    remaining_stock_after: int
    allocations: list[FefoAllocationLine]


class BatchDeductionValidationError(ValueError):
    pass


class BatchStockUnavailableError(ValueError):
    def __init__(
        self,
        *,
        requested_quantity,
        available_non_expired_quantity,
        available_total_quantity,
        allow_expired,
    ):
        self.requested_quantity = int(requested_quantity)
        self.available_non_expired_quantity = int(available_non_expired_quantity)
        self.available_total_quantity = int(available_total_quantity)
        self.allow_expired = bool(allow_expired)
        message = (
            "Insufficient FEFO stock for deduction. "
            f"requested={self.requested_quantity}, "
            f"available_non_expired={self.available_non_expired_quantity}, "
            f"available_total={self.available_total_quantity}, "
            f"allow_expired={self.allow_expired}"
        )
        super().__init__(message)


class BatchReconciliationError(RuntimeError):
    def __init__(self, *, branch_id, product_id, aggregate_quantity, tracked_quantity):
        self.branch_id = int(branch_id)
        self.product_id = int(product_id)
        self.aggregate_quantity = int(aggregate_quantity)
        self.tracked_quantity = int(tracked_quantity)
        message = (
            "Branch aggregate stock and tracked batch stock are out of sync. "
            f"branch_id={self.branch_id}, product_id={self.product_id}, "
            f"aggregate_quantity={self.aggregate_quantity}, tracked_quantity={self.tracked_quantity}"
        )
        super().__init__(message)


class BatchInvariantError(RuntimeError):
    pass


def compute_batch_display_status(expiration_date, today=None):
    today = today or get_cairo_date()
    if expiration_date is None:
        return "NO_EXPIRY", None

    days_remaining = (expiration_date - today).days
    if days_remaining < 0:
        return "EXPIRED", days_remaining
    if days_remaining <= 30:
        return "EXPIRING_SOON", days_remaining
    return "HEALTHY", days_remaining


def serialize_branch_batch(branch_batch, today=None, include_branch=False):
    batch = branch_batch.batch
    status, days_remaining = compute_batch_display_status(batch.expiration_date if batch else None, today=today)
    payload = {
        "batch_id": batch.id if batch else None,
        "batch_number": batch.batch_number if batch else None,
        "remaining_quantity": int(branch_batch.remaining_quantity or 0),
        "expiration_date": batch.expiration_date.isoformat() if batch and batch.expiration_date else None,
        "purchase_date": batch.purchase_date.isoformat() if batch and batch.purchase_date else None,
        "received_at": branch_batch.first_received_at.isoformat() if branch_batch.first_received_at else None,
        "days_remaining": days_remaining,
        "status": status,
    }
    if include_branch:
        payload.update({
            "branch_id": branch_batch.branch_id,
            "branch_name": branch_batch.branch.name if branch_batch.branch else f"Branch #{branch_batch.branch_id}",
            "is_main_warehouse": bool(getattr(branch_batch.branch, 'is_main_warehouse', False)),
        })
    return payload


def build_product_batch_summary(product_id, branch_id=None, include_branch=False):
    today = get_cairo_date()
    query_options = [joinedload(BranchInventoryBatch.batch)]
    if include_branch:
        query_options.append(joinedload(BranchInventoryBatch.branch))

    query = (
        BranchInventoryBatch.query
        .options(*query_options)
        .join(InventoryBatch, InventoryBatch.id == BranchInventoryBatch.batch_id)
        .filter(
            BranchInventoryBatch.product_id == product_id,
            BranchInventoryBatch.remaining_quantity > 0,
            BranchInventoryBatch.status != InventoryBatchStatus.ARCHIVED,
            InventoryBatch.status != InventoryBatchStatus.ARCHIVED,
        )
        .order_by(
            expression.nulls_last(InventoryBatch.expiration_date.asc()),
            BranchInventoryBatch.first_received_at.asc(),
            InventoryBatch.batch_number.asc(),
        )
    )

    if branch_id is not None:
        query = query.filter(BranchInventoryBatch.branch_id == branch_id)

    rows = query.all()
    batches = [serialize_branch_batch(row, today=today, include_branch=include_branch) for row in rows]

    nearest_expiration = None
    nearest_expiration_days = None
    latest_received_at = None
    for row in rows:
        expiration_date = row.batch.expiration_date if row.batch else None
        if nearest_expiration is None and expiration_date is not None:
            nearest_expiration = expiration_date.isoformat()
            nearest_expiration_days = (expiration_date - today).days
        received_ts = row.first_received_at
        if received_ts is not None:
            if latest_received_at is None or received_ts > latest_received_at:
                latest_received_at = received_ts

    tracked_total = sum(int(row.remaining_quantity or 0) for row in rows)
    return {
        "nearest_expiration": nearest_expiration,
        "nearest_expiration_days": nearest_expiration_days,
        "latest_received_at": latest_received_at.isoformat() if latest_received_at else None,
        "tracked_total_stock": tracked_total,
        "batches": batches,
    }


def generate_supply_batch_number():
    prefix = f"LOT-{get_cairo_date().strftime('%y%m%d')}-"
    latest_batch = (
        InventoryBatch.query
        .filter(InventoryBatch.batch_number.like(f"{prefix}%"))
        .order_by(InventoryBatch.batch_number.desc())
        .first()
    )

    next_number = 1
    if latest_batch and latest_batch.batch_number:
        try:
            next_number = int(latest_batch.batch_number.rsplit('-', 1)[-1]) + 1
        except ValueError:
            next_number = 1

    return f"{prefix}{next_number:04d}"


def _acquire_daily_batch_number_lock():
    if db.session.bind and db.session.bind.dialect.name == 'postgresql':
        lock_key = int(get_cairo_date().strftime('%y%m%d'))
        db.session.execute(
            text("SELECT pg_advisory_xact_lock(:namespace, :lock_key)"),
            {"namespace": 4101, "lock_key": lock_key},
        )


def _coerce_positive_int(value, field_name):
    if isinstance(value, bool):
        raise BatchDeductionValidationError(f"{field_name} must be a positive integer.")

    coerced_value = int(value)
    if coerced_value <= 0:
        raise BatchDeductionValidationError(f"{field_name} must be greater than zero.")
    return coerced_value


def _coerce_optional_int(value, field_name):
    if value is None:
        return None
    if isinstance(value, bool):
        raise BatchDeductionValidationError(f"{field_name} must be an integer.")
    return int(value)


def _normalize_movement_type(movement_type):
    if isinstance(movement_type, StockMovementType):
        return movement_type
    if isinstance(movement_type, str):
        try:
            return StockMovementType(movement_type)
        except ValueError as exc:
            raise BatchDeductionValidationError(f"Unsupported movement_type: {movement_type}") from exc
    raise BatchDeductionValidationError("movement_type must be a StockMovementType or matching string value.")


def _lock_product_branch_stock(branch_id, product_id):
    stock_row = (
        ProductBranchStock.query
        .filter_by(branch_id=branch_id, product_id=product_id)
        .with_for_update()
        .first()
    )
    if not stock_row:
        raise BatchDeductionValidationError(
            f"Tracked ProductBranchStock row was not found for branch_id={branch_id}, product_id={product_id}."
        )
    return stock_row


def _get_branch_tracked_quantity(branch_id, product_id):
    tracked_quantity = (
        db.session.query(func.coalesce(func.sum(BranchInventoryBatch.remaining_quantity), 0))
        .filter(
            BranchInventoryBatch.branch_id == branch_id,
            BranchInventoryBatch.product_id == product_id,
            BranchInventoryBatch.status != InventoryBatchStatus.ARCHIVED,
        )
        .scalar()
    )
    return int(tracked_quantity or 0)


def _reconcile_branch_product_or_raise(stock_row, branch_id, product_id):
    aggregate_quantity = int(stock_row.stock_quantity or 0)
    tracked_quantity = _get_branch_tracked_quantity(branch_id, product_id)
    if aggregate_quantity != tracked_quantity:
        raise BatchReconciliationError(
            branch_id=branch_id,
            product_id=product_id,
            aggregate_quantity=aggregate_quantity,
            tracked_quantity=tracked_quantity,
        )
    return tracked_quantity


def _get_available_batch_quantities(branch_id, product_id, today):
    rows = (
        db.session.query(BranchInventoryBatch.remaining_quantity, InventoryBatch.expiration_date)
        .join(InventoryBatch, InventoryBatch.id == BranchInventoryBatch.batch_id)
        .filter(
            BranchInventoryBatch.branch_id == branch_id,
            BranchInventoryBatch.product_id == product_id,
            BranchInventoryBatch.remaining_quantity > 0,
            BranchInventoryBatch.status != InventoryBatchStatus.ARCHIVED,
            InventoryBatch.status != InventoryBatchStatus.ARCHIVED,
        )
        .all()
    )

    available_total_quantity = 0
    available_non_expired_quantity = 0
    for remaining_quantity, expiration_date in rows:
        remaining_quantity = int(remaining_quantity or 0)
        available_total_quantity += remaining_quantity
        if expiration_date is None or expiration_date >= today:
            available_non_expired_quantity += remaining_quantity

    return available_non_expired_quantity, available_total_quantity


def _lock_fefo_candidate_batches(branch_id, product_id, allow_expired, today):
    query = (
        BranchInventoryBatch.query
        .join(InventoryBatch, InventoryBatch.id == BranchInventoryBatch.batch_id)
        .filter(
            BranchInventoryBatch.branch_id == branch_id,
            BranchInventoryBatch.product_id == product_id,
            BranchInventoryBatch.remaining_quantity > 0,
            BranchInventoryBatch.status != InventoryBatchStatus.ARCHIVED,
            InventoryBatch.status != InventoryBatchStatus.ARCHIVED,
        )
    )

    if not allow_expired:
        query = query.filter(
            or_(
                InventoryBatch.expiration_date.is_(None),
                InventoryBatch.expiration_date >= today,
            )
        )

    return (
        query.order_by(
            expression.nulls_last(InventoryBatch.expiration_date.asc()),
            BranchInventoryBatch.first_received_at.asc(),
            InventoryBatch.batch_number.asc(),
        )
        .with_for_update()
        .all()
    )


def _sync_inventory_batch_statuses(batch_ids):
    if not batch_ids:
        return

    impacted_batches = (
        InventoryBatch.query
        .filter(InventoryBatch.id.in_(sorted(batch_ids)))
        .with_for_update()
        .all()
    )
    impacted_batch_ids = {batch.id for batch in impacted_batches}
    if impacted_batch_ids != set(batch_ids):
        raise BatchInvariantError("One or more impacted inventory batches could not be locked.")

    branch_rows = (
        BranchInventoryBatch.query
        .filter(
            BranchInventoryBatch.batch_id.in_(sorted(batch_ids)),
            BranchInventoryBatch.status != InventoryBatchStatus.ARCHIVED,
        )
        .all()
    )

    rows_by_batch_id = {}
    for row in branch_rows:
        rows_by_batch_id.setdefault(row.batch_id, []).append(row)

    for batch in impacted_batches:
        owned_rows = rows_by_batch_id.get(batch.id, [])
        if not owned_rows:
            raise BatchInvariantError(f"Inventory batch {batch.id} has no non-archived branch rows.")

        if any(int(row.remaining_quantity or 0) > 0 for row in owned_rows):
            batch.status = InventoryBatchStatus.ACTIVE
        else:
            batch.status = InventoryBatchStatus.DEPLETED


def deduct_stock_fefo(
    *,
    branch_id: int,
    product_id: int,
    quantity: int,
    movement_type,
    source_ref: Optional[str],
    actor_id: Optional[int],
    allow_expired: bool = False,
) -> FefoDeductionResult:
    branch_id = _coerce_positive_int(branch_id, "Branch ID")
    product_id = _coerce_positive_int(product_id, "Product ID")
    quantity = _coerce_positive_int(quantity, "Quantity")
    _normalize_movement_type(movement_type)
    actor_id = _coerce_optional_int(actor_id, "Actor ID")
    if source_ref is not None and not isinstance(source_ref, str):
        raise BatchDeductionValidationError("source_ref must be a string or None.")

    today = get_cairo_date()
    now = get_utc_now()
    stock_row = _lock_product_branch_stock(branch_id, product_id)
    _reconcile_branch_product_or_raise(stock_row, branch_id, product_id)

    available_non_expired_quantity, available_total_quantity = _get_available_batch_quantities(
        branch_id,
        product_id,
        today,
    )
    if allow_expired:
        if available_total_quantity < quantity:
            raise BatchStockUnavailableError(
                requested_quantity=quantity,
                available_non_expired_quantity=available_non_expired_quantity,
                available_total_quantity=available_total_quantity,
                allow_expired=allow_expired,
            )
    elif available_non_expired_quantity < quantity:
        raise BatchStockUnavailableError(
            requested_quantity=quantity,
            available_non_expired_quantity=available_non_expired_quantity,
            available_total_quantity=available_total_quantity,
            allow_expired=allow_expired,
        )

    candidate_rows = _lock_fefo_candidate_batches(branch_id, product_id, allow_expired, today)
    allocations = []
    impacted_batch_ids = set()
    remaining_to_allocate = quantity

    for branch_batch in candidate_rows:
        if remaining_to_allocate <= 0:
            break

        available_quantity = int(branch_batch.remaining_quantity or 0)
        if available_quantity <= 0:
            continue

        batch = branch_batch.batch
        if not batch:
            raise BatchInvariantError(
                f"BranchInventoryBatch {branch_batch.id} is missing its parent InventoryBatch relation."
            )

        allocated_quantity = min(available_quantity, remaining_to_allocate)
        next_remaining_quantity = available_quantity - allocated_quantity
        if next_remaining_quantity < 0:
            raise BatchInvariantError(
                f"FEFO deduction attempted to overdraw BranchInventoryBatch {branch_batch.id}."
            )

        branch_batch.remaining_quantity = next_remaining_quantity
        branch_batch.last_moved_at = now
        branch_batch.status = (
            InventoryBatchStatus.DEPLETED
            if next_remaining_quantity == 0
            else InventoryBatchStatus.ACTIVE
        )
        impacted_batch_ids.add(branch_batch.batch_id)
        allocations.append(FefoAllocationLine(
            batch_id=batch.id,
            branch_inventory_batch_id=branch_batch.id,
            batch_number=batch.batch_number,
            expiration_date=batch.expiration_date.isoformat() if batch.expiration_date else None,
            quantity=allocated_quantity,
        ))
        remaining_to_allocate -= allocated_quantity

    if remaining_to_allocate != 0:
        raise BatchInvariantError(
            f"FEFO allocation ended early with remaining quantity {remaining_to_allocate} for product_id={product_id}."
        )

    stock_after = int(stock_row.stock_quantity or 0) - quantity
    if stock_after < 0:
        raise BatchInvariantError(
            f"FEFO deduction would make ProductBranchStock negative for branch_id={branch_id}, product_id={product_id}."
        )

    stock_row.stock_quantity = stock_after
    _sync_inventory_batch_statuses(impacted_batch_ids)
    db.session.flush()
    _reconcile_branch_product_or_raise(stock_row, branch_id, product_id)

    allocated_quantity = sum(line.quantity for line in allocations)
    if allocated_quantity != quantity:
        raise BatchInvariantError(
            f"FEFO allocated quantity mismatch. requested={quantity}, allocated={allocated_quantity}."
        )

    return FefoDeductionResult(
        product_id=product_id,
        branch_id=branch_id,
        requested_quantity=quantity,
        allocated_quantity=allocated_quantity,
        remaining_stock_after=stock_after,
        allocations=allocations,
    )


def create_supply_batch(
    *,
    product_id,
    branch_id,
    quantity,
    expiration_date,
    supplier_name_snapshot,
    source_ref,
    created_by_user_id,
    purchase_date=None,
):
    product_id = _coerce_positive_int(product_id, "Product ID")
    branch_id = _coerce_positive_int(branch_id, "Branch ID")
    quantity = _coerce_positive_int(quantity, "Batch quantity")
    if expiration_date is not None and not isinstance(expiration_date, date):
        raise ValueError("Expiration date must be a valid date value.")
    if purchase_date is not None and not isinstance(purchase_date, date):
        raise ValueError("Purchase date must be a valid date value.")

    now = get_utc_now()
    _acquire_daily_batch_number_lock()
    batch = None
    for _ in range(10):
        candidate = InventoryBatch(
            product_id=product_id,
            batch_number=generate_supply_batch_number(),
            expiration_date=expiration_date,
            purchase_date=purchase_date,
            supplier_name_snapshot=supplier_name_snapshot,
            initial_quantity=quantity,
            source_type=InventoryBatchSourceType.SUPPLY_RECEIPT,
            source_ref=source_ref,
            created_branch_id=branch_id,
            created_by_user_id=created_by_user_id,
            created_at=now,
            status=InventoryBatchStatus.ACTIVE,
        )
        try:
            with db.session.begin_nested():
                db.session.add(candidate)
                db.session.flush()
            batch = candidate
            break
        except IntegrityError:
            continue

    if batch is None:
        raise ValueError("Failed to generate a unique batch number for the supply receipt.")

    branch_batch = BranchInventoryBatch(
        batch_id=batch.id,
        branch_id=branch_id,
        product_id=product_id,
        remaining_quantity=quantity,
        first_received_at=now,
        last_moved_at=None,
        status=InventoryBatchStatus.ACTIVE,
    )
    db.session.add(branch_batch)
    db.session.flush()
    return batch, branch_batch


def create_opening_balance_batch(
    *,
    product_id,
    branch_id,
    quantity,
    expiration_date,
    supplier_name_snapshot,
    source_ref,
    created_by_user_id,
    purchase_date=None,
):
    product_id = _coerce_positive_int(product_id, "Product ID")
    branch_id = _coerce_positive_int(branch_id, "Branch ID")
    quantity = _coerce_positive_int(quantity, "Opening batch quantity")
    if expiration_date is not None and not isinstance(expiration_date, date):
        raise ValueError("Expiration date must be a valid date value.")
    if purchase_date is not None and not isinstance(purchase_date, date):
        raise ValueError("Purchase date must be a valid date value.")

    now = get_utc_now()
    batch = InventoryBatch(
        product_id=product_id,
        batch_number=f"OPENING-{branch_id}-{product_id}-001",
        expiration_date=expiration_date,
        purchase_date=purchase_date,
        supplier_name_snapshot=supplier_name_snapshot,
        initial_quantity=quantity,
        source_type=InventoryBatchSourceType.OPENING_BALANCE,
        source_ref=source_ref,
        created_branch_id=branch_id,
        created_by_user_id=created_by_user_id,
        created_at=now,
        status=InventoryBatchStatus.ACTIVE,
    )
    db.session.add(batch)
    db.session.flush()

    branch_batch = BranchInventoryBatch(
        batch_id=batch.id,
        branch_id=branch_id,
        product_id=product_id,
        remaining_quantity=quantity,
        first_received_at=now,
        last_moved_at=None,
        status=InventoryBatchStatus.ACTIVE,
    )
    db.session.add(branch_batch)
    db.session.flush()
    return batch, branch_batch


def find_branch_batch_stock_mismatches(branch_id=None, product_id=None):
    aggregate_rows = ProductBranchStock.query
    if branch_id is not None:
        aggregate_rows = aggregate_rows.filter(ProductBranchStock.branch_id == branch_id)
    if product_id is not None:
        aggregate_rows = aggregate_rows.filter(ProductBranchStock.product_id == product_id)
    aggregate_rows = aggregate_rows.all()

    tracked_rows = BranchInventoryBatch.query.filter(BranchInventoryBatch.status != InventoryBatchStatus.ARCHIVED)
    if branch_id is not None:
        tracked_rows = tracked_rows.filter(BranchInventoryBatch.branch_id == branch_id)
    if product_id is not None:
        tracked_rows = tracked_rows.filter(BranchInventoryBatch.product_id == product_id)
    tracked_rows = tracked_rows.all()

    tracked_totals = {}
    for row in tracked_rows:
        key = (row.branch_id, row.product_id)
        tracked_totals[key] = tracked_totals.get(key, 0) + int(row.remaining_quantity or 0)

    aggregate_map = {}
    for row in aggregate_rows:
        key = (row.branch_id, row.product_id)
        aggregate_map[key] = int(row.stock_quantity or 0)

    mismatch_keys = sorted(set(aggregate_map.keys()) | set(tracked_totals.keys()))
    mismatches = []
    for branch_id_value, product_id_value in mismatch_keys:
        aggregate_quantity = int(aggregate_map.get((branch_id_value, product_id_value), 0))
        tracked_quantity = int(tracked_totals.get((branch_id_value, product_id_value), 0))
        if aggregate_quantity == tracked_quantity:
            continue
        mismatches.append({
            "branch_id": branch_id_value,
            "product_id": product_id_value,
            "product_branch_stock_quantity": aggregate_quantity,
            "branch_batch_total_quantity": tracked_quantity,
            "difference": aggregate_quantity - tracked_quantity,
        })

    return mismatches
