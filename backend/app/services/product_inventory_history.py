"""Read-only, location-scoped history. Never reconstruct inside requests."""
from datetime import date, datetime, time, timedelta, timezone
from math import ceil
from zoneinfo import ZoneInfo

from flask import request
from sqlalchemy import select, func, literal, Integer, or_, exists
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models.branch import Branch
from app.models.product import StockMovement, StockMovementType
from app.models.inventory_batch import InventoryBatch, BranchInventoryBatch, InventoryBatchStatus
from app.services.inventory_batch_service import compute_batch_display_status
from app.utils.date_utils import get_cairo_date


def snapshot_fields(movement):
    values = (movement.balance_before, movement.quantity_delta, movement.balance_after)
    captured = all(value is not None for value in values)
    return {
        'balance_before': values[0] if captured else None,
        'quantity_delta': values[1] if captured else None,
        'balance_after': values[2] if captured else None,
        'snapshot_status': 'RECORDED' if captured else 'UNAVAILABLE_LEGACY',
    }


def _positive_integer(name, default, maximum=None):
    raw = request.args.get(name)
    try:
        value = default if raw is None else int(raw)
    except (TypeError, ValueError):
        raise ValueError(f'Invalid {name}.')
    if value < 1:
        raise ValueError(f'Invalid {name}.')
    return min(value, maximum) if maximum else value


def _location_ids(allowed_ids):
    raw = request.args.get('branch_id', 'all')
    if raw == 'all':
        return list(allowed_ids)
    try:
        branch_id = int(raw)
    except (TypeError, ValueError):
        raise ValueError('Invalid branch_id.')
    # The route validates authorization first, including explicit locations.
    if branch_id not in allowed_ids:
        from flask import abort
        abort(403, description='Access to this inventory branch is restricted.')
    return [branch_id]


def _locations(allowed_ids):
    return [{'branch_id': branch.id, 'branch_name': branch.name, 'is_main_warehouse': bool(branch.is_main_warehouse)}
            for branch in Branch.query.filter(Branch.id.in_(allowed_ids)).order_by(Branch.is_main_warehouse.desc(), Branch.name, Branch.id)]


def _date_bound(name):
    raw = request.args.get(name)
    if not raw:
        return None
    try:
        result = date.fromisoformat(raw)
        if result.isoformat() != raw:
            raise ValueError()
        return result
    except ValueError:
        raise ValueError(f'Invalid {name}; expected YYYY-MM-DD.')


def _pagination(total, page, per_page):
    pages = ceil(total / per_page)
    page = min(page, pages) if pages else 1
    return {'page': page, 'per_page': per_page, 'total_items': total, 'total_pages': pages,
            'has_next': page < pages, 'has_prev': page > 1}


def build_activity_history(product_id, allowed_ids):
    from app.services.stock_recovery_reader import page_balances
    raw_conditional = request.args.get('include_conditional', 'false')
    if raw_conditional not in {'true', 'false'}:
        raise ValueError('Invalid include_conditional.')
    page = _positive_integer('page', 1)
    per_page = _positive_integer('per_page', 20, 50)
    branch_ids = _location_ids(allowed_ids)
    start, end = _date_bound('date_from'), _date_bound('date_to')
    if start and end and start > end:
        raise ValueError('date_from must not be after date_to.')
    query = StockMovement.query.filter(StockMovement.product_id == product_id, StockMovement.branch_id.in_(branch_ids))
    raw_type = request.args.get('movement_type', 'all')
    if raw_type != 'all':
        try:
            movement_type = StockMovementType(raw_type)
        except ValueError:
            raise ValueError('Invalid movement_type.')
        query = query.filter(StockMovement.movement_type == movement_type)
    cairo = ZoneInfo('Africa/Cairo')
    if start:
        try:
            inclusive_start = datetime.combine(start, time.min, cairo).astimezone(timezone.utc)
        except OverflowError:
            raise ValueError('date_from is out of range.')
        query = query.filter(StockMovement.created_at >= inclusive_start)
    if end:
        try:
            exclusive_end = datetime.combine(end + timedelta(days=1), time.min, cairo).astimezone(timezone.utc)
        except OverflowError:
            raise ValueError('date_to is out of range.')
        query = query.filter(StockMovement.created_at < exclusive_end)
    raw_watermark = request.args.get('as_of_id')
    if raw_watermark is None:
        watermark = query.with_entities(func.max(StockMovement.id)).scalar() or 0
    else:
        try:
            watermark = int(raw_watermark)
            if watermark < 0 or watermark > 2147483647:
                raise ValueError()
        except ValueError:
            raise ValueError('Invalid as_of_id.')
    query = query.filter(StockMovement.id <= watermark)
    pagination = _pagination(query.count(), page, per_page)
    rows = (query.options(joinedload(StockMovement.branch), joinedload(StockMovement.invoice))
            .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
            .offset((pagination['page'] - 1) * per_page).limit(per_page).all())
    items = []
    balances = page_balances(rows, include_conditional=raw_conditional == 'true')
    for movement in rows:
        snapshot = snapshot_fields(movement)
        delta = snapshot['quantity_delta']
        invoice = movement.invoice
        if invoice and invoice.branch_id != movement.branch_id:
            invoice = None  # Do not expose an unreliable cross-location reference.
        items.append({
            'id': movement.id, 'product_id': movement.product_id, 'branch_id': movement.branch_id,
            'branch_name': movement.branch.name if movement.branch else None,
            'movement_type': movement.movement_type.value, 'quantity': movement.quantity,
            'direction': 'IN' if delta is not None and delta > 0 else 'OUT' if delta is not None and delta < 0 else 'NEUTRAL' if delta == 0 else 'UNKNOWN',
            'created_at': movement.created_at.isoformat(), 'notes': movement.notes,
            'invoice_id': invoice.id if invoice else None, 'invoice_number': invoice.invoice_number if invoice else None,
            'reference_label': f'فاتورة #{invoice.invoice_number}' if invoice and invoice.invoice_number else f'حركة #{movement.id}',
            **snapshot,
            'balance': balances[movement.id],
        })
    return {'items': items, 'pagination': pagination, 'as_of_id': watermark, 'locations': _locations(allowed_ids), 'date_timezone': 'Africa/Cairo'}


def build_batch_history(product_id, allowed_ids):
    page = _positive_integer('page', 1)
    per_page = _positive_integer('per_page', 20, 50)
    branch_ids = _location_ids(allowed_ids)
    view = request.args.get('view', 'current')
    lifecycle = request.args.get('lifecycle_status', 'ALL')
    if view not in {'current', 'all'}:
        raise ValueError('Invalid batch view.')
    if lifecycle not in {'ALL', 'ACTIVE', 'DEPLETED', 'ARCHIVED'}:
        raise ValueError('Invalid lifecycle_status.')
    B, L = InventoryBatch, BranchInventoryBatch
    location_query = select(
        L.id.label('branch_record_id'), B.id.label('batch_id'), L.first_received_at.label('received_at')
    ).join(B, B.id == L.batch_id).where(L.product_id == product_id, B.product_id == product_id, L.branch_id.in_(branch_ids))
    if view == 'current':
        location_query = location_query.where(L.status == InventoryBatchStatus.ACTIVE, B.status == InventoryBatchStatus.ACTIVE, L.remaining_quantity > 0)
    if lifecycle == 'ACTIVE':
        location_query = location_query.where(L.status == InventoryBatchStatus.ACTIVE, B.status == InventoryBatchStatus.ACTIVE)
    elif lifecycle != 'ALL':
        value = InventoryBatchStatus(lifecycle)
        location_query = location_query.where(or_(L.status == value, B.status == value))
    if view == 'all':
        # Preserve parent records with no location record, without inventing a
        # remaining quantity or treating the origin as a current stock location.
        parent_query = select(literal(None, Integer).label('branch_record_id'), B.id.label('batch_id'), B.created_at.label('received_at')).where(
            B.product_id == product_id, B.created_branch_id.in_(branch_ids),
            ~exists(select(L.id).where(L.batch_id == B.id)),
        )
        if lifecycle != 'ALL':
            parent_query = parent_query.where(B.status == InventoryBatchStatus(lifecycle))
        records = location_query.union_all(parent_query).subquery()
    else:
        records = location_query.subquery()
    total = db.session.scalar(select(func.count()).select_from(records))
    pagination = _pagination(total, page, per_page)
    keys = db.session.execute(select(records).order_by(records.c.received_at.desc(), records.c.batch_id.desc(), records.c.branch_record_id.desc().nullslast())
                              .offset((pagination['page'] - 1) * per_page).limit(per_page)).all()
    batch_ids = [key.batch_id for key in keys]
    parents = {batch.id: batch for batch in B.query.options(joinedload(B.created_branch)).filter(B.id.in_(batch_ids)).all()}
    location_ids = [key.branch_record_id for key in keys if key.branch_record_id is not None]
    locations = {row.id: row for row in L.query.options(joinedload(L.branch)).filter(L.id.in_(location_ids)).all()}
    today = get_cairo_date()
    items = []
    for key in keys:
        batch = parents[key.batch_id]
        row = locations.get(key.branch_record_id)
        expiry_status, days = compute_batch_display_status(batch.expiration_date, today)
        items.append({
            'record_key': f'location-{row.id}' if row else f'batch-{batch.id}',
            'branch_record_id': row.id if row else None, 'batch_id': batch.id, 'batch_number': batch.batch_number,
            'branch_id': row.branch_id if row else None, 'branch_name': row.branch.name if row and row.branch else None,
            'is_main_warehouse': bool(row and row.branch and row.branch.is_main_warehouse),
            'remaining_quantity': row.remaining_quantity if row else None,
            'initial_quantity': batch.initial_quantity if batch.created_branch_id in allowed_ids else None,
            'batch_status': batch.status.value, 'location_status': row.status.value if row else None,
            'expiry_status': expiry_status, 'days_remaining': days,
            'expiration_date': batch.expiration_date.isoformat() if batch.expiration_date else None,
            'purchase_date': batch.purchase_date.isoformat() if batch.purchase_date else None,
            'received_at': row.first_received_at.isoformat() if row else None,
            'created_at': batch.created_at.isoformat(), 'last_moved_at': row.last_moved_at.isoformat() if row and row.last_moved_at else None,
            'source_type': batch.source_type.value, 'source_ref': batch.source_ref,
            'is_legacy': batch.batch_number.startswith('LEGACY-'),
            'origin_branch_name': batch.created_branch.name if batch.created_branch_id in allowed_ids and batch.created_branch else None,
        })
    return {'items': items, 'pagination': pagination, 'locations': _locations(allowed_ids), 'view': view,
            'quantity_basis': 'RECORDED_BATCH_REMAINDER_NOT_OPERATIONAL_BALANCE'}
