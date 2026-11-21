"""Read-only location health. No assignment inference from auto-created zero rows.

Historical evidence establishes prior stock/use, never a recovered quantity.
Missing balances and zero rows without evidence remain UNKNOWN. There is no
explicit product-location exclusion field today, so NOT_APPLICABLE is reserved
and is never inferred from is_available (an operational visibility switch).
"""
from sqlalchemy import and_, case, or_, select, union
from app.extensions import db
from app.models.branch import Branch
from app.models.product import Product, ProductBranchStock, StockMovement
from app.models.invoice import Invoice, InvoiceItem, InvoiceStatus
from app.models.supply_operations import (
    StockAdjustment, StockReturnRequest, StockShipment, StockShipmentItem,
    SupplyInRecord, TransferRequest,
)


def previously_stocked_pairs(branch_ids, product_ids=None):
    """All retained operational evidence, scoped in every UNION arm; no limits.

    Pending supply requests and shipments not yet received do not establish
    destination stock. Informational batch remainders are not stock evidence.
    """
    def scoped(product, branch, *conditions):
        return select(product.label('product_id'), branch.label('branch_id')).where(
            branch.in_(branch_ids),
            product.in_(product_ids) if product_ids is not None else True,
            *conditions,
        )

    dispatched = StockShipment.status.in_(['IN_TRANSIT', 'RECEIVED'])
    statements = [
        scoped(StockMovement.product_id, StockMovement.branch_id,
               or_(StockMovement.quantity > 0, StockMovement.balance_before > 0, StockMovement.balance_after > 0)),
        scoped(StockAdjustment.product_id, StockAdjustment.branch_id,
               or_(StockAdjustment.old_quantity > 0, StockAdjustment.new_quantity > 0)),
        scoped(SupplyInRecord.product_id, SupplyInRecord.branch_id, SupplyInRecord.quantity > 0),
        scoped(StockReturnRequest.product_id, StockReturnRequest.branch_id, StockReturnRequest.branch_stock_snapshot > 0),
        scoped(StockShipmentItem.product_id, StockShipment.source_branch_id,
               StockShipmentItem.quantity > 0, dispatched, StockShipment.shipment_type == 'OUTBOUND_TRANSFER')
        .join(StockShipment, StockShipment.id == StockShipmentItem.shipment_id),
        scoped(StockShipmentItem.product_id, StockShipment.destination_branch_id,
               StockShipmentItem.quantity > 0, StockShipment.status == 'RECEIVED')
        .join(StockShipment, StockShipment.id == StockShipmentItem.shipment_id),
        scoped(TransferRequest.product_id, TransferRequest.from_branch_id,
               TransferRequest.quantity > 0, TransferRequest.status.in_(['IN_TRANSIT', 'RECEIVED'])),
        scoped(TransferRequest.product_id, TransferRequest.to_branch_id,
               TransferRequest.quantity > 0, TransferRequest.status == 'RECEIVED'),
        scoped(InvoiceItem.product_id, Invoice.branch_id,
               InvoiceItem.item_type == 'PRODUCT_ITEM', InvoiceItem.quantity > 0, Invoice.status == InvoiceStatus.PAID)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id),
    ]
    return union(*statements).subquery('previously_stocked_locations')


def location_stock_states(branch_ids, product_ids=None):
    """One row per persisted operational balance; quantities are never inferred.

    The designated main warehouse is applicable to products with a stock row.
    Inactive locations retain their state/quantity but are excluded from alerts.
    """
    evidence = previously_stocked_pairs(branch_ids, product_ids)
    quantity = ProductBranchStock.stock_quantity
    status = case(
        (quantity < 0, 'UNKNOWN'),
        (and_(quantity > 0, quantity <= Product.min_stock_threshold), 'LOW_STOCK'),
        (quantity > 0, 'AVAILABLE'),
        (or_(Branch.is_main_warehouse.is_(True), evidence.c.product_id.isnot(None)), 'OUT_OF_STOCK'),
        else_='UNKNOWN',
    )
    return (
        db.session.query(
            ProductBranchStock.product_id, ProductBranchStock.branch_id,
            quantity.label('stock_quantity'), status.label('stock_status'),
            Branch.is_active.label('location_active'),
            Branch.is_main_warehouse,
        )
        .join(Product, Product.id == ProductBranchStock.product_id)
        .join(Branch, Branch.id == ProductBranchStock.branch_id)
        .outerjoin(evidence, and_(evidence.c.product_id == ProductBranchStock.product_id,
                                evidence.c.branch_id == ProductBranchStock.branch_id))
        .filter(ProductBranchStock.branch_id.in_(branch_ids),
                ProductBranchStock.product_id.in_(product_ids) if product_ids is not None else True)
        .subquery('location_stock_states')
    )


def location_alert_counts(branch_ids):
    states = location_stock_states(branch_ids)
    return (
        db.session.query(
            states.c.product_id,
            db.func.sum(case((states.c.stock_status == 'LOW_STOCK', 1), else_=0)).label('low_stock_locations_count'),
            db.func.sum(case((states.c.stock_status == 'OUT_OF_STOCK', 1), else_=0)).label('out_of_stock_locations_count'),
            db.func.sum(case((states.c.stock_status == 'UNKNOWN', 1), else_=0)).label('unknown_locations_count'),
            db.func.sum(case((states.c.stock_status.in_(['AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK']), 1), else_=0)).label('applicable_locations_count'),
        )
        .filter(states.c.location_active.is_(True))
        .group_by(states.c.product_id).subquery('location_alert_counts')
    )


def legacy_mini_status(status):
    return {'LOW_STOCK': 'LOW', 'OUT_OF_STOCK': 'OUT'}.get(status, status)
