from datetime import datetime, timezone
import enum
from app.extensions import db

class Product(db.Model):
    __tablename__ = 'products'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), nullable=False)
    category = db.Column(db.String(100), nullable=False)
    unit = db.Column(db.String(50), nullable=False)
    
    # TODO: supplier_name and expiry_date should move later to StockBatch / Purchase Batch when the purchase module is implemented
    pieces_per_unit = db.Column(db.Integer, default=1, nullable=False)
    supplier_name = db.Column(db.String(150), nullable=True)
    expiry_date = db.Column(db.Date, nullable=True)
    
    selling_price = db.Column(db.Float, default=0.0, nullable=False)
    cost_price = db.Column(db.Float, default=0.0, nullable=True)
    min_stock_threshold = db.Column(db.Integer, default=5, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    image_url = db.Column(db.String(255), nullable=True)
    # Commission percentage paid to the employee who sells this product (0 = no commission)
    sales_commission_percent = db.Column(db.Float, default=0.0, nullable=False)
    
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    def __repr__(self):
        return f"<Product {self.id}: {self.name}>"

class ProductBranchStock(db.Model):
    __tablename__ = 'product_branch_stocks'
    
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id', ondelete='CASCADE'), nullable=False)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='CASCADE'), nullable=False)
    stock_quantity = db.Column(db.Integer, default=0, nullable=False)
    is_available = db.Column(db.Boolean, default=True, nullable=False)
    
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Unique constraint per branch/product combination
    __table_args__ = (
        db.UniqueConstraint('branch_id', 'product_id', name='uq_branch_product_stock'),
    )

    product = db.relationship('Product', backref=db.backref('branch_stocks', lazy=True, cascade="all, delete-orphan"))
    branch = db.relationship('Branch', backref=db.backref('product_stocks', lazy=True, cascade="all, delete-orphan"))

    def __repr__(self):
        return f"<ProductBranchStock Product:{self.product_id} Branch:{self.branch_id} Stock:{self.stock_quantity}>"

class StockMovementType(enum.Enum):
    PRODUCT_SALE = "PRODUCT_SALE"
    INTERNAL_CONSUMPTION = "INTERNAL_CONSUMPTION"
    SUPPLY_IN = "SUPPLY_IN"
    TRANSFER_OUT = "TRANSFER_OUT"
    TRANSFER_IN = "TRANSFER_IN"
    RETURN_TO_SUPPLIER = "RETURN_TO_SUPPLIER"
    STOCK_ADJUSTMENT = "STOCK_ADJUSTMENT"

class StockMovement(db.Model):
    __tablename__ = 'stock_movements'
    
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id', ondelete='CASCADE'), nullable=False)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='CASCADE'), nullable=False)
    movement_type = db.Column(db.Enum(StockMovementType, native_enum=False), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)  # positive absolute quantity
    reversal_of_movement_id = db.Column(
        db.Integer, db.ForeignKey('stock_movements.id', ondelete='RESTRICT'), nullable=True,
    )
    # Historical movements remain NULL. New writers capture these under the stock lock.
    balance_before = db.Column(db.Integer, nullable=True)
    quantity_delta = db.Column(db.Integer, nullable=True)
    balance_after = db.Column(db.Integer, nullable=True)
    invoice_id = db.Column(db.Integer, db.ForeignKey('invoices.id', ondelete='SET NULL'), nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=True) # Employee id who did this
    notes = db.Column(db.Text, nullable=True) # Reason/details for manual consumption or adjustment
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    product = db.relationship('Product')
    branch = db.relationship('Branch')
    invoice = db.relationship('Invoice')
    employee = db.relationship('Employee')

    __table_args__ = (
        db.UniqueConstraint('reversal_of_movement_id', name='uq_stock_movement_reversal'),
        db.CheckConstraint('reversal_of_movement_id IS NULL OR reversal_of_movement_id <> id', name='ck_stock_movement_reversal_not_self'),
        db.CheckConstraint(
            '(balance_before IS NULL AND quantity_delta IS NULL AND balance_after IS NULL) OR '
            '(balance_before IS NOT NULL AND quantity_delta IS NOT NULL AND balance_after IS NOT NULL '
            'AND balance_after = balance_before + quantity_delta AND quantity = abs(quantity_delta))',
            name='ck_stock_movement_balance_snapshot',
        ),
        db.Index('ix_stock_movements_product_created_id', 'product_id', db.desc('created_at'), db.desc('id')),
        db.Index('ix_stock_movements_product_branch_created_id', 'product_id', 'branch_id', db.desc('created_at'), db.desc('id')),
    )

    def __repr__(self):
        return f"<StockMovement {self.id}: {self.movement_type.value} Product:{self.product_id} Qty:{self.quantity}>"
