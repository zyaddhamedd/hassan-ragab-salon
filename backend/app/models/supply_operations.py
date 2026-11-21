from datetime import datetime, timezone
from app.extensions import db
from app.models.product import ProductBranchStock

# Reference code logic removed as per final decision

SHIPMENT_TYPES = (
    'OUTBOUND_TRANSFER',
    'INBOUND_SUPPLY',
)

RETURN_REQUEST_REASONS = (
    'DAMAGED',
    'EXPIRED',
    'WRONG_SHIPMENT',
    'NOT_NEEDED',
    'MANUFACTURING_DEFECT',
    'OTHER',
)

RETURN_REQUEST_REASON_LABELS = {
    'DAMAGED': 'تالف',
    'EXPIRED': 'منتهي',
    'WRONG_SHIPMENT': 'شحنة خاطئة',
    'NOT_NEEDED': 'غير مطلوب',
    'MANUFACTURING_DEFECT': 'عيب تصنيع',
    'OTHER': 'أخرى',
}

RETURN_REQUEST_STATUSES = (
    'PENDING',
    'RETURNED_TO_MAIN',
    'RETURNED_TO_SUPPLIER',
    'REJECTED',
)

class SupplyInRecord(db.Model):
    __tablename__ = 'supply_in_records'

    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id', ondelete='CASCADE'), nullable=False)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='CASCADE'), nullable=False)  # destination branch (main warehouse flag can be true)
    quantity = db.Column(db.Integer, nullable=False)
    supplier_name = db.Column(db.String(150), nullable=True)
    cost_price = db.Column(db.Numeric(10, 2), nullable=True)
    expiry_date = db.Column(db.Date, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    product = db.relationship('Product')
    branch = db.relationship('Branch')
    user = db.relationship('User')

    def __repr__(self):
        return f"<SupplyInRecord {self.id} Product:{self.product_id} Qty:{self.quantity}>"

class StockShipment(db.Model):
    __tablename__ = 'stock_shipments'

    id = db.Column(db.Integer, primary_key=True)
    shipment_ref = db.Column(db.String(50), unique=True, nullable=False, index=True)
    shipment_type = db.Column(db.String(30), nullable=False, default='OUTBOUND_TRANSFER', index=True)
    source_branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='CASCADE'), nullable=True)
    destination_branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='CASCADE'), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='IN_TRANSIT', index=True)
    note = db.Column(db.Text, nullable=True)
    supplier_name_snapshot = db.Column(db.String(150), nullable=True)
    products_count = db.Column(db.Integer, nullable=False, default=0)
    pieces_count = db.Column(db.Integer, nullable=False, default=0)
    total_cost_snapshot = db.Column(db.Float, nullable=False, default=0.0)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    received_by_employee_id = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    received_at = db.Column(db.DateTime(timezone=True), nullable=True)
    cancelled_at = db.Column(db.DateTime(timezone=True), nullable=True)
    cancelled_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    cancellation_reason = db.Column(db.Text, nullable=True)

    source_branch = db.relationship('Branch', foreign_keys=[source_branch_id])
    destination_branch = db.relationship('Branch', foreign_keys=[destination_branch_id])
    created_by_user = db.relationship('User', foreign_keys=[created_by_user_id])
    received_by_employee = db.relationship('Employee', foreign_keys=[received_by_employee_id])
    cancelled_by_user = db.relationship('User', foreign_keys=[cancelled_by_user_id])
    items = db.relationship(
        'StockShipmentItem',
        back_populates='shipment',
        lazy=True,
        cascade='all, delete-orphan',
        order_by='StockShipmentItem.id.asc()',
    )

    def __repr__(self):
        return f"<StockShipment {self.shipment_ref} Status:{self.status}>"

class StockShipmentItem(db.Model):
    __tablename__ = 'stock_shipment_items'

    id = db.Column(db.Integer, primary_key=True)
    shipment_id = db.Column(db.Integer, db.ForeignKey('stock_shipments.id', ondelete='CASCADE'), nullable=False, index=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id', ondelete='CASCADE'), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    unit_cost_snapshot = db.Column(db.Float, nullable=True)

    shipment = db.relationship('StockShipment', back_populates='items')
    product = db.relationship('Product')

    __table_args__ = (
        db.UniqueConstraint('shipment_id', 'product_id', name='uq_stock_shipment_item_product'),
    )

    def __repr__(self):
        return f"<StockShipmentItem Shipment:{self.shipment_id} Product:{self.product_id} Qty:{self.quantity}>"

class TransferRequest(db.Model):
    __tablename__ = 'transfer_requests'

    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id', ondelete='CASCADE'), nullable=False)
    from_branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='CASCADE'), nullable=False)
    to_branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='CASCADE'), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    notes = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), nullable=False, default='PENDING')  # PENDING, IN_TRANSIT, RECEIVED, CANCELLED
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    dispatched_at = db.Column(db.DateTime(timezone=True), nullable=True)
    received_at = db.Column(db.DateTime(timezone=True), nullable=True)

    product = db.relationship('Product')
    from_branch = db.relationship('Branch', foreign_keys=[from_branch_id])
    to_branch = db.relationship('Branch', foreign_keys=[to_branch_id])
    user = db.relationship('User')

    def __repr__(self):
        return f"<TransferRequest {self.id} Status:{self.status}>"

class StockAdjustment(db.Model):
    __tablename__ = 'stock_adjustments'

    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id', ondelete='CASCADE'), nullable=False)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='CASCADE'), nullable=False)
    old_quantity = db.Column(db.Integer, nullable=False)
    new_quantity = db.Column(db.Integer, nullable=False)
    difference = db.Column(db.Integer, nullable=False)  # new - old (positive = increase)
    reason = db.Column(db.Text, nullable=False)
    notes = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    product = db.relationship('Product')
    branch = db.relationship('Branch')
    user = db.relationship('User')

    def __repr__(self):
        return f"<StockAdjustment {self.id} Diff:{self.difference}>"

class StockSupplyRequest(db.Model):
    __tablename__ = 'stock_supply_requests'

    id = db.Column(db.Integer, primary_key=True)
    request_ref = db.Column(db.String(50), unique=True, nullable=False, index=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='CASCADE'), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='PENDING', index=True)  # PENDING, SENT, RECEIVED
    note = db.Column(db.Text, nullable=True)
    created_by_employee_id = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=False)
    shipment_id = db.Column(db.Integer, db.ForeignKey('stock_shipments.id', ondelete='SET NULL'), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    sent_at = db.Column(db.DateTime(timezone=True), nullable=True)

    branch = db.relationship('Branch', foreign_keys=[branch_id])
    created_by_employee = db.relationship('Employee', foreign_keys=[created_by_employee_id])
    shipment = db.relationship('StockShipment', foreign_keys=[shipment_id])
    items = db.relationship(
        'StockSupplyRequestItem',
        back_populates='request',
        lazy=True,
        cascade='all, delete-orphan',
        order_by='StockSupplyRequestItem.id.asc()',
    )

    def __repr__(self):
        return f"<StockSupplyRequest {self.request_ref} Status:{self.status}>"

class StockSupplyRequestItem(db.Model):
    __tablename__ = 'stock_supply_request_items'

    id = db.Column(db.Integer, primary_key=True)
    request_id = db.Column(db.Integer, db.ForeignKey('stock_supply_requests.id', ondelete='CASCADE'), nullable=False, index=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id', ondelete='CASCADE'), nullable=False)
    requested_quantity = db.Column(db.Integer, nullable=False)
    final_quantity = db.Column(db.Integer, nullable=True)  # Null until sent

    request = db.relationship('StockSupplyRequest', back_populates='items')
    product = db.relationship('Product')

    __table_args__ = (
        db.UniqueConstraint('request_id', 'product_id', name='uq_stock_supply_request_item_product'),
    )

    def __repr__(self):
        return f"<StockSupplyRequestItem Request:{self.request_id} Product:{self.product_id} ReqQty:{self.requested_quantity}>"


class StockReturnRequest(db.Model):
    __tablename__ = 'stock_return_requests'

    id = db.Column(db.Integer, primary_key=True)
    return_ref = db.Column(db.String(50), unique=True, nullable=False, index=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='CASCADE'), nullable=False, index=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id', ondelete='CASCADE'), nullable=False, index=True)
    requested_quantity = db.Column(db.Integer, nullable=False)
    branch_stock_snapshot = db.Column(db.Integer, nullable=False)
    reason = db.Column(db.String(40), nullable=False, index=True)
    notes = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(30), nullable=False, default='PENDING', index=True)
    created_by_employee_id = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=False)
    resolved_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    resolved_at = db.Column(db.DateTime(timezone=True), nullable=True)
    resolution_note = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    branch = db.relationship('Branch', foreign_keys=[branch_id])
    product = db.relationship('Product', foreign_keys=[product_id])
    created_by_employee = db.relationship('Employee', foreign_keys=[created_by_employee_id])
    resolved_by_user = db.relationship('User', foreign_keys=[resolved_by_user_id])

    __table_args__ = (
        db.CheckConstraint('requested_quantity > 0', name='ck_stock_return_requests_requested_quantity_positive'),
        db.CheckConstraint('branch_stock_snapshot >= 0', name='ck_stock_return_requests_stock_snapshot_non_negative'),
    )

    def __repr__(self):
        return f"<StockReturnRequest {self.return_ref} Status:{self.status}>"
