"""Capture operational stock evidence in the caller's transaction; never commit here."""
from sqlalchemy.exc import IntegrityError
from app.extensions import db
from app.models.product import ProductBranchStock, StockMovement


def lock_product_stocks(pairs, *, create_missing=()):
    """Lock distinct (product, branch) pairs in a common location/product order.

    All multi-location/product callers acquire their complete set before changing
    quantities. A concurrent first insert is resolved inside a savepoint, without
    rolling back the caller's other work.
    """
    create_missing = set(create_missing)
    rows = {}
    for product_id, branch_id in sorted(set(pairs), key=lambda pair: (pair[1], pair[0])):
        def query():
            return (ProductBranchStock.query.populate_existing()
                    .filter_by(product_id=product_id, branch_id=branch_id)
                    .with_for_update().first())
        row = query()
        if row is None and (product_id, branch_id) in create_missing:
            try:
                with db.session.begin_nested():
                    row = ProductBranchStock(product_id=product_id, branch_id=branch_id, stock_quantity=0, is_available=True)
                    db.session.add(row)
                    db.session.flush()
            except IntegrityError:
                row = query()
                if row is None:
                    raise
        rows[(product_id, branch_id)] = row
    return rows


def capture_stock_movement(stock, balance_before, **movement_fields):
    """Called immediately after the existing mutation, while its row is locked.

    Opening stock is the only case with a newly inserted, transaction-owned row.
    Read the actual changed value, never infer the sign from the movement type.
    """
    if stock is None or (int(movement_fields['product_id']), int(movement_fields['branch_id'])) != (stock.product_id, stock.branch_id):
        raise ValueError('Movement product/location must match its operational stock row.')
    before = int(balance_before)
    after = int(stock.stock_quantity)
    delta = after - before
    if int(movement_fields['quantity']) != abs(delta):
        raise ValueError('Movement quantity must match its actual stock change.')
    return StockMovement(**movement_fields, balance_before=before, quantity_delta=delta, balance_after=after)
