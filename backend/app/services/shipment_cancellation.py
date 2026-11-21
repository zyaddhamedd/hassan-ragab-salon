"""Reverse an unreceived outbound shipment in the caller's transaction."""
from sqlalchemy import exists, func, or_, select

from app.extensions import db
from app.models.product import StockMovement, StockMovementType
from app.models.supply_operations import (
    StockAdjustment, StockReturnRequest, StockShipment, StockShipmentItem, StockSupplyRequest,
)
from app.services.stock_movement_service import capture_stock_movement, lock_product_stocks
from app.utils.date_utils import get_utc_now


class ShipmentCancellationConflict(ValueError):
    pass


def cancel_shipment(shipment, *, user_id, reason=None):
    """The caller must hold this shipment's FOR UPDATE lock before entry.

    Old movements may lack balance snapshots. Their exact reference, product,
    location, type and quantity must still agree. Unattributable positive manual
    adjustments/receipts are deliberately treated as possible compensation.
    No commits, batch mutations, request reopening, or history rewriting here.
    """
    def conflict(message):
        raise ShipmentCancellationConflict(message)

    if shipment.shipment_type != 'OUTBOUND_TRANSFER' or shipment.status != 'IN_TRANSIT':
        conflict('يمكن إلغاء شحنة تحويل قيد النقل فقط.')
    if (not shipment.source_branch_id or shipment.source_branch_id == shipment.destination_branch_id
            or shipment.received_at is not None or shipment.received_by_employee_id is not None
            or shipment.cancelled_at is not None or shipment.cancelled_by_user_id is not None):
        conflict('توجد بيانات استلام أو إلغاء متعارضة؛ يجب مراجعة الشحنة.')
    items = list(shipment.items)
    quantities = {item.product_id: item.quantity for item in items}
    if not items or len(quantities) != len(items) or any(q <= 0 for q in quantities.values()):
        conflict('بنود الشحنة غير مكتملة أو غير صحيحة.')

    # Also lock existing destination balances to serialize against manual credits
    # and returns. Only source balances will change.
    pairs = [(pid, bid) for pid in quantities for bid in (shipment.source_branch_id, shipment.destination_branch_id)]
    stocks = lock_product_stocks(pairs)
    if any(stocks[(pid, shipment.source_branch_id)] is None for pid in quantities):
        conflict('رصيد المصدر الأصلي غير موجود؛ تعذرت إعادة المخزون بأمان.')

    reference = f'[{shipment.shipment_ref}]'
    movements = (StockMovement.query.filter(func.strpos(StockMovement.notes, reference) > 0)
                 .order_by(StockMovement.id).with_for_update().all())
    originals = {}
    for movement in movements:
        quantity = quantities.get(movement.product_id)
        if (quantity is None or movement.product_id in originals
                or movement.branch_id != shipment.source_branch_id
                or movement.movement_type != StockMovementType.TRANSFER_OUT
                or movement.quantity != quantity or movement.invoice_id is not None
                or movement.reversal_of_movement_id is not None
                or not (movement.notes or '').strip().startswith(reference)):
            conflict('حركات الشحنة تتضمن استلاماً أو تعويضاً أو خصماً متعارضاً.')
        snapshots = (movement.balance_before, movement.quantity_delta, movement.balance_after)
        if any(v is not None for v in snapshots) and (
            any(v is None for v in snapshots) or movement.quantity_delta != -quantity
            or movement.balance_after != movement.balance_before - quantity
        ):
            conflict('أرصدة حركة الخصم الأصلية غير متطابقة.')
        originals[movement.product_id] = movement
    if set(originals) != set(quantities):
        conflict('تعذر إثبات حركة الخصم الأصلية لكل منتج في الشحنة.')
    original_ids = [m.id for m in originals.values()]
    if StockMovement.query.filter(StockMovement.reversal_of_movement_id.in_(original_ids)).first():
        conflict('تمت إعادة مخزون الشحنة سابقاً.')
    if StockSupplyRequest.query.filter_by(shipment_id=shipment.id, status='RECEIVED').first():
        conflict('يوجد طلب إمداد مرتبط مسجل كمستلم.')

    # Other fully documented shipment receipts and structured reversals do not
    # imply compensation for this shipment. Everything else remains ambiguous.
    documented_receipt = exists(select(StockShipmentItem.id).join(
        StockShipment, StockShipment.id == StockShipmentItem.shipment_id
    ).where(
        StockShipment.id != shipment.id, StockShipment.shipment_type == 'OUTBOUND_TRANSFER',
        StockShipment.status == 'RECEIVED', StockShipment.received_at.isnot(None),
        StockShipment.destination_branch_id == StockMovement.branch_id,
        StockShipmentItem.product_id == StockMovement.product_id,
        StockShipmentItem.quantity == StockMovement.quantity,
        func.strpos(StockMovement.notes, '[' + StockShipment.shipment_ref + ']') == 1,
        StockMovement.movement_type == StockMovementType.TRANSFER_IN,
    ))
    possible_compensation = StockMovement.query.filter(
        StockMovement.product_id.in_(quantities),
        StockMovement.branch_id.in_([shipment.source_branch_id, shipment.destination_branch_id]),
        StockMovement.created_at >= shipment.created_at,
        StockMovement.movement_type.in_([StockMovementType.TRANSFER_IN, StockMovementType.STOCK_ADJUSTMENT]),
        or_(StockMovement.quantity_delta.is_(None), StockMovement.quantity_delta > 0),
        StockMovement.reversal_of_movement_id.is_(None),
        ~documented_receipt,
    ).first()
    manual_adjustment = StockAdjustment.query.filter(
        StockAdjustment.product_id.in_(quantities),
        StockAdjustment.branch_id.in_([shipment.source_branch_id, shipment.destination_branch_id]),
        StockAdjustment.created_at >= shipment.created_at, StockAdjustment.difference > 0,
    ).first()
    returned = StockReturnRequest.query.filter(
        StockReturnRequest.product_id.in_(quantities), StockReturnRequest.branch_id == shipment.destination_branch_id,
        StockReturnRequest.status == 'RETURNED_TO_MAIN', StockReturnRequest.resolved_at >= shipment.created_at,
    ).first()
    if possible_compensation or manual_adjustment or returned:
        conflict('توجد حركات استلام أو تسوية محتملة بعد الإرسال؛ يجب مراجعتها قبل الإلغاء لتجنب تكرار المخزون.')

    for product_id, quantity in quantities.items():
        stock = stocks[(product_id, shipment.source_branch_id)]
        before = stock.stock_quantity
        stock.stock_quantity += quantity
        db.session.add(capture_stock_movement(
            stock, before, product_id=product_id, branch_id=shipment.source_branch_id,
            movement_type=StockMovementType.STOCK_ADJUSTMENT, quantity=quantity,
            reversal_of_movement_id=originals[product_id].id,
            notes=f'{reference} إلغاء الشحنة وإعادة الكمية إلى المصدر الأصلي',
        ))
    shipment.status = 'CANCELLED'
    shipment.cancelled_at = get_utc_now()
    shipment.cancelled_by_user_id = user_id
    shipment.cancellation_reason = reason
    db.session.flush()
