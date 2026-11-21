"""Creation-time cost evidence, separate from operational and financial records."""
from sqlalchemy import event
from app.extensions import db


class ReturnItemValuation(db.Model):
    __tablename__ = 'return_item_valuations'

    id = db.Column(db.Integer, primary_key=True)
    source_type = db.Column(db.String(32), nullable=False)
    return_request_id = db.Column(db.Integer, db.ForeignKey('stock_return_requests.id', ondelete='CASCADE'))
    stock_movement_id = db.Column(db.Integer, db.ForeignKey('stock_movements.id', ondelete='CASCADE'))
    item_key = db.Column(db.String(80), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id', ondelete='CASCADE'), nullable=False)
    quantity_snapshot = db.Column(db.Integer, nullable=False)
    unit_cost_snapshot = db.Column(db.Numeric(18, 2), nullable=True)
    valuation_source = db.Column(db.String(32), nullable=False)
    snapshot_at = db.Column(db.DateTime(timezone=True), nullable=False)

    __table_args__ = (
        db.UniqueConstraint('return_request_id', 'item_key', name='uq_return_valuation_request_item'),
        db.UniqueConstraint('stock_movement_id', 'item_key', name='uq_return_valuation_movement_item'),
        db.CheckConstraint("(source_type = 'BRANCH_REQUEST' AND return_request_id IS NOT NULL AND stock_movement_id IS NULL) OR (source_type IN ('DIRECT_SUPPLIER_RETURN','MANUAL_SUPPLIER_RETURN') AND stock_movement_id IS NOT NULL AND return_request_id IS NULL)", name='ck_return_valuation_identity'),
        db.CheckConstraint('quantity_snapshot > 0', name='ck_return_valuation_quantity'),
        db.CheckConstraint("(valuation_source = 'RECORDED_AT_CREATION' AND unit_cost_snapshot IS NOT NULL AND unit_cost_snapshot >= 0 AND unit_cost_snapshot <= 9999999999999999.99) OR (valuation_source = 'UNAVAILABLE' AND unit_cost_snapshot IS NULL)", name='ck_return_valuation_cost'),
    )


@event.listens_for(ReturnItemValuation, 'before_update')
def immutable_return_valuation(mapper, connection, target):
    raise ValueError('Return cost snapshots cannot be updated.')
