from datetime import datetime, timezone
import enum

from app.extensions import db


class InventoryBatchSourceType(enum.Enum):
    OPENING_BALANCE = "OPENING_BALANCE"
    SUPPLY_RECEIPT = "SUPPLY_RECEIPT"


class InventoryBatchStatus(enum.Enum):
    ACTIVE = "ACTIVE"
    DEPLETED = "DEPLETED"
    ARCHIVED = "ARCHIVED"


class InventoryBatch(db.Model):
    __tablename__ = 'inventory_batches'

    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id', ondelete='CASCADE'), nullable=False, index=True)
    batch_number = db.Column(db.String(50), nullable=False, unique=True, index=True)
    expiration_date = db.Column(db.Date, nullable=True)
    purchase_date = db.Column(db.Date, nullable=True)
    supplier_name_snapshot = db.Column(db.String(150), nullable=True)
    initial_quantity = db.Column(db.Integer, nullable=False)
    source_type = db.Column(db.Enum(InventoryBatchSourceType, native_enum=False), nullable=False)
    source_ref = db.Column(db.String(50), nullable=True, index=True)
    created_branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='CASCADE'), nullable=False, index=True)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    status = db.Column(
        db.Enum(InventoryBatchStatus, native_enum=False),
        default=InventoryBatchStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    product = db.relationship('Product', backref=db.backref('inventory_batches', lazy=True, cascade="all, delete-orphan"))
    created_branch = db.relationship('Branch', foreign_keys=[created_branch_id])
    created_by_user = db.relationship('User', foreign_keys=[created_by_user_id])
    branch_batches = db.relationship(
        'BranchInventoryBatch',
        back_populates='batch',
        lazy=True,
        cascade='all, delete-orphan',
        order_by='BranchInventoryBatch.id.asc()',
    )

    __table_args__ = (
        db.CheckConstraint('initial_quantity >= 0', name='ck_inventory_batches_initial_quantity_non_negative'),
    )

    def __repr__(self):
        return f"<InventoryBatch {self.batch_number} Product:{self.product_id} Qty:{self.initial_quantity}>"


class BranchInventoryBatch(db.Model):
    __tablename__ = 'branch_inventory_batches'

    id = db.Column(db.Integer, primary_key=True)
    batch_id = db.Column(db.Integer, db.ForeignKey('inventory_batches.id', ondelete='CASCADE'), nullable=False, index=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='CASCADE'), nullable=False, index=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id', ondelete='CASCADE'), nullable=False, index=True)
    remaining_quantity = db.Column(db.Integer, nullable=False)
    first_received_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    last_moved_at = db.Column(db.DateTime(timezone=True), nullable=True)
    status = db.Column(
        db.Enum(InventoryBatchStatus, native_enum=False),
        default=InventoryBatchStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    batch = db.relationship('InventoryBatch', back_populates='branch_batches')
    branch = db.relationship('Branch', foreign_keys=[branch_id])
    product = db.relationship('Product', foreign_keys=[product_id], backref=db.backref('branch_inventory_batches', lazy=True, cascade="all, delete-orphan"))

    __table_args__ = (
        db.UniqueConstraint('branch_id', 'batch_id', name='uq_branch_inventory_batch_branch_batch'),
        db.CheckConstraint('remaining_quantity >= 0', name='ck_branch_inventory_batches_remaining_quantity_non_negative'),
    )

    def __repr__(self):
        return f"<BranchInventoryBatch Branch:{self.branch_id} Batch:{self.batch_id} Qty:{self.remaining_quantity}>"
