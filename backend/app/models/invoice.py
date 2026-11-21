from datetime import datetime, timezone
import enum
from app.extensions import db


class InvoiceStatus(enum.Enum):
    DRAFT = "DRAFT"
    DRAFT_COMMITTED = "DRAFT_COMMITTED"
    PAID = "PAID"
    CANCELED = "CANCELED"


class PaymentMethod(enum.Enum):
    CASH = "CASH"
    VISA = "VISA"
    INSTAPAY = "INSTAPAY"


class Invoice(db.Model):
    __tablename__ = 'invoices'

    id = db.Column(db.Integer, primary_key=True)

    # Invoice number is per-branch (handled in app logic)
    # Nullable because DRAFT invoices don't have a number yet
    invoice_number = db.Column(db.Integer, nullable=True)

    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    cashier_id = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=False)
    customer_id = db.Column(db.Integer, db.ForeignKey('customers.id'), nullable=True)
    booking_appointment_id = db.Column(db.Integer, db.ForeignKey('appointments.id', ondelete='RESTRICT'), nullable=True, unique=True)
    # Preserve deposit ambiguity across refresh without changing grouped-invoice semantics.
    booking_multi_customer = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    customer_name = db.Column(db.String(100), nullable=True)
    customer_phone = db.Column(db.String(20), nullable=True)

    # Grouped invoices (parent / child)
    parent_invoice_id = db.Column(db.Integer, db.ForeignKey('invoices.id'), nullable=True)
    is_grouped = db.Column(db.Boolean, default=False, nullable=False)

    status = db.Column(
        db.Enum(InvoiceStatus, name='invoice_status_enum'),
        default=InvoiceStatus.DRAFT,
        nullable=False
    )

    total_amount = db.Column(db.Float, default=0.0, nullable=False)
    discount_amount = db.Column(db.Float, default=0.0, nullable=False)

    # Added to identify free/fully discounted invoices for auditing after confirmation
    is_fully_discounted = db.Column(db.Boolean, default=False, nullable=False)

    # Payment method is Nullable because DRAFT invoices are not paid yet
    # Soft-deprecated: use invoice_payments table for split payment detail.
    # Kept for backward compatibility and dominant-method shim.
    payment_method = db.Column(
        db.Enum(PaymentMethod, name='payment_method_enum'),
        nullable=True
    )

    # Amount returned to customer when they overpay (e.g. 200 paid for 150 bill).
    # 0.0 for exact or card/digital payments.
    change_amount = db.Column(db.Float, default=0.0, nullable=True)
    
    # Who confirmed the payment (finalizer)
    confirmed_by = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=True)
    
    # When the payment was confirmed
    paid_at = db.Column(db.DateTime(timezone=True), nullable=True)
    
    # Date of invoice (for per-day numbering) - set from paid_at date
    invoice_date = db.Column(db.Date, nullable=True, index=True)

    # ── BusinessDay anchor ───────────────────────────────────────────────────
    # Links this invoice to the operational BusinessDay during which it was
    # confirmed (PAID).  Nullable so that DRAFT invoices and any legacy PAID
    # invoices that predate this column are not broken.
    # ondelete='RESTRICT' prevents a BusinessDay from being deleted while it
    # still has attributed invoices.
    business_day_id = db.Column(
        db.Integer,
        db.ForeignKey('business_days.id', ondelete='RESTRICT'),
        nullable=True,
        index=True
    )

    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    # ✅ IMPORTANT: invoice number must be unique per branch per day
    __table_args__ = (
        db.UniqueConstraint(
            'branch_id',
            'invoice_date',
            'invoice_number',
            name='uq_branch_date_invoice_number'
        ),
    )

    # Relationships
    branch = db.relationship(
        'Branch',
        backref=db.backref('invoices', lazy=True)
    )

    cashier = db.relationship(
        'Employee',
        foreign_keys=[cashier_id],
        backref=db.backref('processed_invoices', lazy=True)
    )

    confirmed_by_employee = db.relationship(
        'Employee',
        foreign_keys=[confirmed_by],
        backref=db.backref('confirmed_invoices', lazy=True)
    )

    customer = db.relationship(
        'Customer',
        backref=db.backref('invoices', lazy=True)
    )

    invoice_items = db.relationship(
        'InvoiceItem',
        backref='invoice',
        lazy=True,
        cascade="all, delete-orphan"
    )

    invoice_payments = db.relationship(
        'InvoicePayment',
        backref='invoice',
        lazy=True,
        cascade="all, delete-orphan"
    )

    business_day = db.relationship(
        'BusinessDay',
        foreign_keys=[business_day_id],
        backref=db.backref('invoices', lazy='dynamic')
    )

    # Self-referential relationship (parent / children invoices)
    children = db.relationship(
        'Invoice',
        backref=db.backref('parent', remote_side=[id]),
        lazy=True
    )

    def __repr__(self):
        return f'<Invoice {self.id} Branch:{self.branch_id}>'


class InvoiceItem(db.Model):
    __tablename__ = 'invoice_items'

    id = db.Column(db.Integer, primary_key=True)
    invoice_id = db.Column(db.Integer, db.ForeignKey('invoices.id'), nullable=False)
    
    item_type = db.Column(db.String(20), default="SERVICE_ITEM", nullable=False) # SERVICE_ITEM or PRODUCT_ITEM
    service_id = db.Column(db.Integer, db.ForeignKey('services.id'), nullable=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=True)

    barber_id = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=True)
    assistant_id = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=True)

    service_price = db.Column(db.Float, nullable=False)
    quantity = db.Column(db.Integer, default=1, nullable=False)
    barber_commission_percent = db.Column(db.Float, default=0.0, nullable=False)
    assistant_commission_percent = db.Column(db.Float, default=10.0, nullable=False)

    # ── Product commission (PRODUCT_ITEM only; NULL for SERVICE_ITEM) ─────────
    # assigned_employee_id: the employee responsible for selling this product (required for PRODUCT_ITEM)
    # sales_commission_percent: snapshot of Product.sales_commission_percent at sale time
    # sales_commission_amount:  pre-calculated amount (price * qty * pct / 100) stored as snapshot
    assigned_employee_id     = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=True)
    sales_commission_percent = db.Column(db.Float, default=0.0, nullable=True)
    sales_commission_amount  = db.Column(db.Float, default=0.0, nullable=True)

    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    # Relationships
    service = db.relationship('Service')
    product = db.relationship('Product')
    barber = db.relationship('Employee', foreign_keys=[barber_id])
    assistant = db.relationship('Employee', foreign_keys=[assistant_id])
    assigned_employee = db.relationship('Employee', foreign_keys=[assigned_employee_id])

    def set_commissions(self, service: 'Service'):
        """
        Snapshots commission percentages from the service.
        Commissions are pre-split at the service level based on category.
        """
        if not service:
            self.barber_commission_percent = 0.0
            self.assistant_commission_percent = 0.0
            return

        self.barber_commission_percent = service.barber_commission_percent
        self.assistant_commission_percent = service.assistant_commission_percent

    def __repr__(self):
        return f'<InvoiceItem {self.id} Invoice:{self.invoice_id}>'


class InvoicePayment(db.Model):
    """
    Stores one row per payment method slice for a PAID invoice.

    For a split payment (e.g. 100 cash + 50 visa on a 150 invoice):
        InvoicePayment(invoice_id=X, method=CASH, amount=100)
        InvoicePayment(invoice_id=X, method=VISA, amount=50)

    Amounts are always trimmed to actual revenue (never includes customer
    change / overpayment). Sum of new payments plus recorded booking deposit
    applications equals invoice net_amount. Fully prepaid invoices have no new
    payment rows and must never use the legacy collection fallback.

    entered_amount preserves the original tender typed by the cashier before
    any trimming. This allows receipts and machine/bank reconciliation to use
    the real collected figure while treasury revenue continues to use amount.

    Legacy invoices (pre-split-payment) have NO rows here - they are still
    aggregated via Invoice.payment_method for treasury reporting.
    """
    __tablename__ = 'invoice_payments'

    id         = db.Column(db.Integer, primary_key=True)
    invoice_id = db.Column(
        db.Integer,
        db.ForeignKey('invoices.id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )
    method = db.Column(
        db.Enum(PaymentMethod, name='payment_method_enum'),
        nullable=False
    )
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    entered_amount = db.Column(db.Numeric(10, 2), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=True
    )

    def __repr__(self):
        return f'<InvoicePayment {self.id} Invoice:{self.invoice_id} {self.method.value}:{self.amount}>'


# ============================================================================
# Commission Lifecycle Note
# ============================================================================
# commission_wallet_balance is credited inside InvoiceEngine.confirm_payment()
# ONLY when an invoice transitions to PAID status. No commission is credited
# at item-insertion time. See: app/modules/invoice_engine.py
# ============================================================================
