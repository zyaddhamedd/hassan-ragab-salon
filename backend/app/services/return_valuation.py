"""Return cost disclosure only. Decimal strings; no inventory/treasury writes."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from sqlalchemy import select
from app.extensions import db
from app.models.product import Product
from app.models.return_valuation import ReturnItemValuation

CENT = Decimal('0.01')
MAX_COST = Decimal('9999999999999999.99')


def money(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        with localcontext() as ctx:
            ctx.prec = 50
            amount = Decimal(str(value))
            if not amount.is_finite() or amount < 0 or amount > MAX_COST:
                return None
            return amount.quantize(CENT, rounding=ROUND_HALF_UP).copy_abs()
    except (InvalidOperation, ValueError, TypeError):
        return None


def capture_return_cost(*, product_id, quantity, created_at, return_request_id=None, stock_movement_id=None, direct=True):
    """One caller transaction, after document flush; never commit or revalue.

    A shared lock re-reads the product cost rather than a stale ORM identity map.
    The lock serializes against product price updates until the return commits.
    """
    if (return_request_id is None) == (stock_movement_id is None) or type(quantity) is not int or quantity <= 0:
        raise ValueError('A return needs one unambiguous source item and positive quantity.')
    key = f'request:{return_request_id}' if return_request_id is not None else f'movement:{stock_movement_id}'
    predicate = ReturnItemValuation.return_request_id == return_request_id if return_request_id is not None else ReturnItemValuation.stock_movement_id == stock_movement_id
    existing = ReturnItemValuation.query.filter(predicate, ReturnItemValuation.item_key == key).first()
    if existing:
        if existing.product_id != product_id or existing.quantity_snapshot != quantity:
            raise ValueError('Return item identity changed; refusing to replace its snapshot.')
        return existing
    cost = db.session.execute(select(Product.cost_price).where(Product.id == product_id).with_for_update(read=True)).scalar_one()
    unit = money(cost)
    row = ReturnItemValuation(
        source_type='BRANCH_REQUEST' if return_request_id is not None else 'DIRECT_SUPPLIER_RETURN' if direct else 'MANUAL_SUPPLIER_RETURN',
        return_request_id=return_request_id, stock_movement_id=stock_movement_id, item_key=key,
        product_id=product_id, quantity_snapshot=quantity, unit_cost_snapshot=unit,
        valuation_source='RECORDED_AT_CREATION' if unit is not None else 'UNAVAILABLE', snapshot_at=created_at,
    )
    db.session.add(row)
    db.session.flush()
    return row


def value_item(*, product_id, product_name, quantity, item_key, current_cost, snapshot=None, trusted_quantity=True):
    valid_quantity = type(quantity) is int and quantity > 0 and trusted_quantity
    source = 'UNAVAILABLE'
    unit = None
    if valid_quantity:
        if snapshot is not None:
            if snapshot.product_id == product_id and snapshot.quantity_snapshot == quantity and snapshot.item_key == item_key:
                unit = money(snapshot.unit_cost_snapshot) if snapshot.valuation_source == 'RECORDED_AT_CREATION' else None
                source = 'RECORDED_AT_CREATION' if unit is not None else 'UNAVAILABLE'
        else:
            unit = money(current_cost)
            source = 'CURRENT_COST_ESTIMATE' if unit is not None else 'UNAVAILABLE'
    with localcontext() as ctx:
        ctx.prec = 50
        total = unit * quantity if unit is not None else None
    return dict(product_id=product_id, product_name=product_name, item_key=item_key,
                quantity=quantity if valid_quantity else None, unit_cost=format(unit, '.2f') if unit is not None else None,
                line_cost_total=format(total, '.2f') if total is not None else None,
                valuation_source=source, snapshot_at=snapshot.snapshot_at.isoformat() if snapshot is not None else None)


def summarize(items):
    """A partial known subtotal is never labelled a complete return total."""
    missing = sum(item['line_cost_total'] is None for item in items)
    with localcontext() as ctx:
        ctx.prec = 50
        subtotal = sum((Decimal(item['line_cost_total']) for item in items if item['line_cost_total'] is not None), Decimal('0.00'))
    complete = bool(items) and missing == 0
    source = ('UNAVAILABLE' if not complete else 'CURRENT_COST_ESTIMATE'
              if any(item['valuation_source'] == 'CURRENT_COST_ESTIMATE' for item in items) else 'RECORDED_AT_CREATION')
    return dict(currency='EGP', items=items, return_cost_total=format(subtotal, '.2f') if complete else None,
                known_cost_subtotal=format(subtotal, '.2f'), unavailable_items_count=missing,
                is_complete=complete, valuation_source=source)


def request_valuations(requests):
    ids = [request.id for request in requests]
    rows = ReturnItemValuation.query.filter(ReturnItemValuation.return_request_id.in_(ids)).all() if ids else []
    snapshots = {row.return_request_id: row for row in rows}
    return {request.id: summarize([value_item(
        product_id=request.product_id, product_name=request.product.name if request.product else f'منتج #{request.product_id}',
        quantity=request.requested_quantity, item_key=f'request:{request.id}',
        current_cost=request.product.cost_price if request.product else None, snapshot=snapshots.get(request.id),
    )]) for request in requests}


def supplier_movement_valuation(movement):
    snapshot = ReturnItemValuation.query.filter_by(stock_movement_id=movement.id, item_key=f'movement:{movement.id}').first()
    known_out = movement.quantity_delta is not None and movement.quantity_delta < 0 and abs(movement.quantity_delta) == movement.quantity
    legacy_direct = movement.quantity_delta is None and (movement.notes or '').startswith('[SUP-RET-')
    return summarize([value_item(
        product_id=movement.product_id, product_name=movement.product.name if movement.product else f'منتج #{movement.product_id}',
        quantity=movement.quantity, item_key=f'movement:{movement.id}',
        current_cost=movement.product.cost_price if movement.product else None, snapshot=snapshot,
        trusted_quantity=known_out or legacy_direct,
    )])
