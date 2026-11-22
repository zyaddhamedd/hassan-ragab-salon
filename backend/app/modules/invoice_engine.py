from app.extensions import db
from app.services.stock_movement_service import capture_stock_movement, lock_product_stocks
from app.models.invoice import Invoice, InvoiceStatus
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from app.services.invoice_audit import (
    AuditActorContext,
    InvoiceAuditEventType,
    append_invoice_event,
    build_item_snapshot,
)

class InvoiceEngine:
    INVOICE_NUMBER_LOCK_NAMESPACE = 4202
    INVOICE_NUMBER_MAX_RETRIES = 3

    @staticmethod
    def _acquire_invoice_number_lock(branch_id: int, invoice_date) -> None:
        """
        Serialize invoice-number allocation per branch/day on PostgreSQL.
        """
        if not db.session.bind or db.session.bind.dialect.name != 'postgresql':
            return

        from sqlalchemy import text

        lock_key = (int(branch_id) * 100_000_000) + int(invoice_date.strftime('%Y%m%d'))
        db.session.execute(
            text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {"lock_key": lock_key},
        )

    @staticmethod
    def _is_invoice_number_conflict(exc: Exception) -> bool:
        message = str(getattr(exc, 'orig', exc) or '')
        return 'uq_branch_date_invoice_number' in message or (
            'invoices.branch_id, invoices.invoice_date, invoices.invoice_number' in message
        )

    @staticmethod
    def _lock_invoice_row(invoice_id: int):
        return (
            Invoice.query
            .populate_existing()
            .filter(Invoice.id == invoice_id)
            .with_for_update()
            .first()
        )

    @staticmethod
    def _audit_actor(actor_context, branch_id):
        return actor_context or AuditActorContext.system(branch_id=branch_id)

    @staticmethod
    def _audit_money(value):
        return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    @staticmethod
    def _item_catalog_name(item):
        if item.item_type == "SERVICE_ITEM" and item.service:
            return item.service.name
        if item.item_type == "PRODUCT_ITEM" and item.product:
            return item.product.name
        return None

    @staticmethod
    def create_draft_invoice(branch_id: int, cashier_id: int, actor_context=None, commit=True) -> Invoice:
        """
        Always creates a FRESH empty DRAFT invoice.
        
        Old drafts (DRAFT or DRAFT_COMMITTED) are NOT deleted — they remain
        in the DB and appear in Admin as "معلقة".
        
        Args:
            branch_id (int): ID of the branch
            cashier_id (int): ID of the cashier (employee)
            
        Returns:
            Invoice: A brand new empty DRAFT invoice
        """
        new_draft = Invoice(
            branch_id=branch_id,
            cashier_id=cashier_id,
            status=InvoiceStatus.DRAFT,
            invoice_number=None,
            payment_method=None,
            total_amount=0.0,
            discount_amount=0.0,
            change_amount=0.0,
            is_fully_discounted=False
        )
        
        try:
            db.session.add(new_draft)
            db.session.flush()
            append_invoice_event(
                invoice_id=new_draft.id,
                event_type=InvoiceAuditEventType.DRAFT_CREATED,
                actor=InvoiceEngine._audit_actor(actor_context, branch_id),
                gross_after=Decimal("0.00"),
                payload={"status": InvoiceStatus.DRAFT.value},
            )
            if commit:
                db.session.commit()
        except Exception:
            db.session.rollback()
            raise
        
        return new_draft



    @staticmethod
    def add_item_to_invoice(
        invoice_id: int,
        service_id: int,
        barber_id: int,
        assistant_id: int = None,
        quantity: int = 1,
        actor_context=None,
        booking_prefill=False,
    ) -> Invoice:
        """
        Adds a service item to a DRAFT invoice.
        Enforces Snapshot Rule: copies price and commission percentages from Service at this moment.
        """
        from app.models.invoice import InvoiceItem
        from app.models.service import Service
        
        # 1. Get Invoice and validate DRAFT status
        invoice = InvoiceEngine._lock_invoice_row(invoice_id)
        if not invoice:
            raise ValueError(f"Invoice {invoice_id} not found.")
        
        if invoice.status != InvoiceStatus.DRAFT:
            raise ValueError(f"Cannot add items to invoice in {invoice.status} status. Only DRAFT allowed.")
            
        if booking_prefill:
            from app.services.booking_handoff_service import validate_prefill
            validate_prefill(invoice, service_id, barber_id)
            if InvoiceItem.query.filter_by(invoice_id=invoice.id).first():
                return invoice  # A repeated automatic preload never adds another item.

        # 2. Get Service to snapshot data
        service = Service.query.get(service_id)
        if not service:
            raise ValueError(f"Service {service_id} not found.")
            
        gross_before = InvoiceEngine._audit_money(invoice.total_amount)
        try:
            # 3. Create InvoiceItem (Snapshot)
            item = InvoiceItem(
                invoice_id=invoice.id,
                service_id=service.id,
                barber_id=barber_id,
                assistant_id=assistant_id,
                service_price=service.price,
                quantity=quantity
            )

            # Set commissions (snapshot logic)
            item.set_commissions(service)

            db.session.add(item)

            # 4. Recalculate total
            # Flush to ensure item is visible for calculation
            db.session.flush()
            InvoiceEngine._recalculate_total(invoice)
            gross_after = InvoiceEngine._audit_money(invoice.total_amount)
            append_invoice_event(
                invoice_id=invoice.id,
                event_type=InvoiceAuditEventType.ITEM_ADDED,
                actor=InvoiceEngine._audit_actor(actor_context, invoice.branch_id),
                gross_before=gross_before,
                gross_after=gross_after,
                payload=build_item_snapshot(item, catalog_name=service.name),
            )
            db.session.commit()
        except Exception:
            db.session.rollback()
            raise
        return invoice

    @staticmethod
    def add_product_to_invoice(
        invoice_id: int,
        product_id: int,
        quantity: int = 1,
        assigned_employee_id: int = None,
        actor_context=None,
    ) -> Invoice:
        """
        Adds or updates a product item in a DRAFT invoice.
        Only performs stock validation. Does NOT deduct stock.
        """
        from app.models.invoice import InvoiceItem
        from app.models.product import Product, ProductBranchStock
        from app.models.employee import Employee
        
        # 1. Get Invoice and validate DRAFT status
        invoice = InvoiceEngine._lock_invoice_row(invoice_id)
        if not invoice:
             raise ValueError(f"Invoice {invoice_id} not found.")
        
        if invoice.status != InvoiceStatus.DRAFT:
             raise ValueError(f"Cannot add items to invoice in {invoice.status} status. Only DRAFT allowed.")
             
        # 2. Get Product
        product = Product.query.get(product_id)
        if not product:
             raise ValueError(f"Product {product_id} not found.")

        if not assigned_employee_id:
             raise ValueError("اختر الموظف المسؤول عن بيع المنتج.")

        assigned_employee = Employee.query.filter_by(
             id=assigned_employee_id,
             branch_id=invoice.branch_id,
             is_active=True,
             is_deleted=False
        ).first()
        if not assigned_employee:
             raise ValueError("الموظف المسؤول عن بيع المنتج غير موجود في هذا الفرع.")
             
        if not product.is_active:
             raise ValueError("المنتج غير نشط")
             
        if product.selling_price <= 0.0:
             raise ValueError("هذا المنتج غير معروض للبيع")
             
        # 3. Check stock availability for this branch
        branch_stock = ProductBranchStock.query.filter_by(
             branch_id=invoice.branch_id,
             product_id=product.id
        ).first()
        
        if quantity <= 0:
             raise ValueError("الكمية يجب أن تكون أكبر من الصفر")
             
        if not branch_stock or not branch_stock.is_available or branch_stock.stock_quantity < quantity:
             available_qty = branch_stock.stock_quantity if branch_stock and branch_stock.is_available else 0
             raise ValueError(f"الكمية المطلوبة ({quantity}) غير متوفرة. المتاح: {available_qty}")
             
        sales_commission_percent = float(product.sales_commission_percent or 0.0)
        sales_commission_amount = round(
             float(product.selling_price) * int(quantity) * sales_commission_percent / 100.0,
             2
        )

        existing_item = InvoiceItem.query.filter_by(
             invoice_id=invoice_id,
             product_id=product_id,
             item_type="PRODUCT_ITEM"
        ).first()

        gross_before = InvoiceEngine._audit_money(invoice.total_amount)
        before_snapshot = (
            build_item_snapshot(existing_item, catalog_name=product.name)
            if existing_item
            else None
        )
        try:
            if existing_item:
                 item = existing_item
                 item.quantity = quantity
                 item.service_price = product.selling_price
                 item.assigned_employee_id = assigned_employee.id
                 item.sales_commission_percent = sales_commission_percent
                 item.sales_commission_amount = sales_commission_amount
            else:
                 item = InvoiceItem(
                     invoice_id=invoice.id,
                     item_type="PRODUCT_ITEM",
                     product_id=product.id,
                     service_id=None,
                     barber_id=None,
                     assistant_id=None,
                     service_price=product.selling_price,
                     quantity=quantity,
                     barber_commission_percent=0.0,
                     assistant_commission_percent=0.0,
                     assigned_employee_id=assigned_employee.id,
                     sales_commission_percent=sales_commission_percent,
                     sales_commission_amount=sales_commission_amount
                 )
                 db.session.add(item)

            db.session.flush()
            InvoiceEngine._recalculate_total(invoice)
            gross_after = InvoiceEngine._audit_money(invoice.total_amount)
            after_snapshot = build_item_snapshot(item, catalog_name=product.name)
            append_invoice_event(
                invoice_id=invoice.id,
                event_type=(
                    InvoiceAuditEventType.ITEM_UPDATED
                    if existing_item
                    else InvoiceAuditEventType.ITEM_ADDED
                ),
                actor=InvoiceEngine._audit_actor(actor_context, invoice.branch_id),
                gross_before=gross_before,
                gross_after=gross_after,
                payload=(
                    {"before": before_snapshot, "after": after_snapshot}
                    if existing_item
                    else after_snapshot
                ),
            )
            db.session.commit()
        except Exception:
            db.session.rollback()
            raise
        return invoice

    @staticmethod
    def remove_item_from_invoice(invoice_id: int, item_id: int, actor_context=None) -> Invoice:
        """
        Removes an item from a DRAFT invoice.
        """
        from app.models.invoice import InvoiceItem
        
        # 1. Get Invoice and validate DRAFT status
        invoice = InvoiceEngine._lock_invoice_row(invoice_id)
        if not invoice:
            raise ValueError(f"Invoice {invoice_id} not found.")
            
        if invoice.status != InvoiceStatus.DRAFT:
            raise ValueError(f"Cannot remove items from invoice in {invoice.status} status. Only DRAFT allowed.")
            
        # 2. Get Item
        item = InvoiceItem.query.get(item_id)
        if not item or item.invoice_id != invoice_id:
            raise ValueError(f"Item {item_id} not found in invoice {invoice_id}.")

        gross_before = InvoiceEngine._audit_money(invoice.total_amount)
        removed_snapshot = build_item_snapshot(
            item,
            catalog_name=InvoiceEngine._item_catalog_name(item),
        )
        try:
            # 3. Remove item
            db.session.delete(item)

            # 4. Recalculate total
            # Flush to confirm deletion before calc
            db.session.flush()
            InvoiceEngine._recalculate_total(invoice)
            gross_after = InvoiceEngine._audit_money(invoice.total_amount)
            append_invoice_event(
                invoice_id=invoice.id,
                event_type=InvoiceAuditEventType.ITEM_REMOVED,
                actor=InvoiceEngine._audit_actor(actor_context, invoice.branch_id),
                gross_before=gross_before,
                gross_after=gross_after,
                payload=removed_snapshot,
            )
            db.session.commit()
        except Exception:
            db.session.rollback()
            raise
        return invoice

    @staticmethod
    def _recalculate_total(invoice: Invoice):
        """
        Internal helper to recalculate total_amount based on items.
        total = sum(price * quantity)
        """
        total = 0.0
        for item in invoice.invoice_items:
            total += (item.service_price * item.quantity)
        
        invoice.total_amount = total

    @staticmethod
    def confirm_payment(
        invoice_id: int,
        confirmed_by_id: int,
        discount_amount: float = 0.0,
        customer_name: str = None,
        customer_phone: str = None,
        # Legacy single-method path (kept for backward compat)
        payment_method_str: str = None,
        # New split-payment path: list of {method: str, amount: float}
        payments: list = None,
        # Promo parameters
        promo_code: str = None,
        quote_id: str = None,
        promo_version: int = None,
        payment_attempt_id: str = None,
        actor_context=None,
        appointment_id=None,
        customer_id=None,
        multi_customer=False,
        expected_deposit_amount=None,
        confirmed_by_user_id=None,
    ) -> Invoice:
        """
        Transitions an invoice from DRAFT to PAID.

        Split Payment Support
        ─────────────────────
        • Either `payment_method_str` (legacy) or `payments` (new) must be provided.
        • If `payments` is provided, each entry must have:
            - method: "CASH" | "VISA" | "INSTAPAY"
            - amount: positive number
          and sum(amounts) must be >= net_amount (overpayment is allowed).
        • Overpayment normalization: amounts are trimmed so stored revenue
          equals exactly net_amount. The excess (change) is stored in
          invoice.change_amount for receipt display and NOT counted as revenue.
        • Trimming order: CASH first (since change is physical cash returned).
        • invoice.payment_method is set to the dominant method (highest trimmed
          amount) for backward-compatible legacy queries.

        BusinessDay binding & Promo Locking rules
        ─────────────────────────────────────────
        • Strict Lock Order:
          1. Invoice row (SELECT FOR UPDATE)
          2. Open BusinessDay (SELECT FOR UPDATE)
          3. PromoCode row (SELECT FOR UPDATE) when promo_code is supplied
          4. Invoice-number advisory lock (per branch/day)
        • No Stacking: if promo_code is supplied and discount_amount > 0,
          reject with PROMO_MANUAL_DISCOUNT_CONFLICT.
        • Authoritative state: all financial totals & promo eligibility
          are evaluated from the locked invoice items, never trusted from client.
        """
        from app.models.invoice import InvoiceStatus, PaymentMethod, InvoicePayment
        from app.models.business_day import BusinessDay, BusinessDayStatus
        from app.models.employee import Employee
        from app.models.customer import Customer
        from datetime import datetime, timezone
        from zoneinfo import ZoneInfo
        from sqlalchemy import func
        from sqlalchemy.exc import IntegrityError
        from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
        from app.models.payment_confirmation_attempt import (
            PaymentConfirmationAttempt,
            PaymentConfirmationAttemptStatus,
        )

        CAIRO_TZ = ZoneInfo("Africa/Cairo")

        if promo_code and discount_amount and float(discount_amount) > 0:
            from app.services.promo_code_service import PromoError
            raise PromoError("PROMO_MANUAL_DISCOUNT_CONFLICT", 409)

        # ── ATOMIC TRANSACTION ────────────────────────────────────────────────
        try:
            # 1. Lock invoice row
            invoice = InvoiceEngine._lock_invoice_row(invoice_id)
            if not invoice:
                raise ValueError(f"Invoice {invoice_id} not found.")
            if invoice.status != InvoiceStatus.DRAFT:
                raise ValueError(f"Cannot confirm invoice {invoice_id} with status {invoice.status}. Only DRAFT allowed.")
            if not invoice.invoice_items:
                raise ValueError("Cannot confirm an empty invoice. Add items first.")

            payment_attempt = None
            if payment_attempt_id:
                payment_attempt = (
                    PaymentConfirmationAttempt.query
                    .filter_by(payment_attempt_id=payment_attempt_id)
                    .with_for_update()
                    .first()
                )
                if not payment_attempt:
                    raise ValueError("Payment confirmation attempt not found.")
                if (
                    payment_attempt.invoice_id != invoice.id
                    or payment_attempt.branch_id != invoice.branch_id
                    or payment_attempt.cashier_id != confirmed_by_id
                ):
                    raise ValueError("Payment confirmation attempt context mismatch.")
                if payment_attempt.status != PaymentConfirmationAttemptStatus.PROCESSING:
                    raise ValueError("Payment confirmation attempt is not processing.")

            # 2. Fetch & lock OPEN BusinessDay
            open_day = (
                BusinessDay.query
                .filter_by(branch_id=invoice.branch_id, status=BusinessDayStatus.OPEN)
                .with_for_update()
                .first()
            )
            if not open_day:
                raise ValueError("لا يوجد يوم عمل مفتوح حالياً لهذا الفرع")

            if invoice.business_day_id is not None:
                raise ValueError(f"الفاتورة رقم {invoice_id} مُسجلة بالفعل.")

            now_utc = datetime.now(timezone.utc)
            today   = now_utc.astimezone(CAIRO_TZ).date()

            # 3. Promo Code Redemption & Authoritative Financial Calculations
            promo_redemption = None
            if promo_code:
                from app.services.promo_code_service import redeem_invoice_promo
                promo_discount, promo_redemption, _ = redeem_invoice_promo(
                    invoice=invoice,
                    code=promo_code,
                    confirmed_by_id=confirmed_by_id,
                    quote_id=quote_id,
                    promo_version=promo_version,
                    now_utc=now_utc,
                )
                discount_dec = promo_discount
            else:
                discount_dec = Decimal(str(discount_amount or 0.0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

            gross_total = Decimal("0.00")
            for item in invoice.invoice_items:
                gross_total += Decimal(str(item.service_price)) * item.quantity
            total_dec = gross_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            invoice.total_amount = float(total_dec)
            net_amount = total_dec - discount_dec

            # Hard validation rules
            if discount_dec > total_dec:
                raise ValueError("الخصم لا يمكن أن يتجاوز إجمالي الفاتورة")
            if total_dec <= 0:
                raise ValueError("إجمالي الفاتورة يجب أن يكون أكبر من الصفر قبل تطبيق الخصم")
            if net_amount < 0:
                raise ValueError("إجمالي الفاتورة لا يمكن أن يكون سالباً")
            if discount_dec > 0 and not invoice.branch.allow_discounts:
                if promo_code:
                    from app.services.promo_code_service import PromoError
                    raise PromoError("PROMO_DISCOUNTS_DISABLED", 400)
                raise ValueError(f"الخصومات غير مفعّلة لهذا الفرع ({invoice.branch.name})")

            is_free_invoice = (net_amount == Decimal("0.00"))

            if invoice.booking_appointment_id:
                from app.services.booking_handoff_service import booking_for_branch
                linked_booking = booking_for_branch(invoice.booking_appointment_id, invoice.branch_id, lock=True)
                if not invoice.booking_multi_customer and str(customer_phone or '').strip() != linked_booking.customer.phone.strip():
                    raise ValueError('بيانات العميل لا تطابق الحجز المرتبط بالفاتورة')

            from app.services.booking_deposit_service import apply_booking_deposit
            deposit_applied = apply_booking_deposit(invoice, appointment_id, customer_id, customer_phone,
                net_amount, open_day.id, confirmed_by_id, multi_customer=multi_customer, expected_amount=expected_deposit_amount, actor_user_id=confirmed_by_user_id)
            collection_due = net_amount - deposit_applied

            resolved_payments = []  # [{method, amount, entered_amount}]
            cash_paid_amount = Decimal('0.00')
            raw_change = Decimal('0.00')

            # ── PAYMENT RESOLUTION ───────────────────────────────────────────
            if is_free_invoice:
                resolved_payments = [{
                    'method': PaymentMethod.CASH,
                    'amount': Decimal('0.00'),
                    'entered_amount': Decimal('0.00')
                }]
                cash_paid_amount = Decimal('0.00')
                raw_change = Decimal('0.00')
            elif collection_due == Decimal("0.00"):
                if payments:
                    try:
                        if not isinstance(payments, list) or any(Decimal(str(p.get('amount', 0))) != 0 for p in payments):
                            raise ValueError('الفاتورة مغطاة بالعربون؛ امسح مبالغ الدفع الجديدة')
                    except (AttributeError, TypeError, InvalidOperation):
                        raise ValueError('بيانات الدفع غير صالحة') from None
                resolved_payments = []
            elif payments:
                if not isinstance(payments, list) or len(payments) == 0:
                    raise ValueError("payments must be a non-empty list.")

                for p in payments:
                    method_str = str(p.get('method', '')).upper().strip()
                    try:
                        pm = PaymentMethod(method_str)
                    except ValueError:
                        raise ValueError(f"Invalid payment method: '{p.get('method')}'. Must be CASH, VISA, VISA_1, VISA_2, or INSTAPAY.")

                    try:
                        amt = Decimal(str(p.get('amount', 0)))
                    except Exception:
                        raise ValueError(f"Invalid amount for {method_str}: {p.get('amount')}")

                    if amt < 0:
                        raise ValueError(f"Payment amount cannot be negative for {method_str}.")

                    if amt > 0:
                        resolved_payments.append({
                            'method': pm,
                            'amount': amt,
                            'entered_amount': amt
                        })

                if not resolved_payments:
                    raise ValueError("يجب إدخال مبلغ دفع واحد على الأقل للفاتورة غير المجانية")

                total_paid = sum(p['entered_amount'] for p in resolved_payments)
                cash_paid_amount = sum(
                    p['entered_amount'] for p in resolved_payments
                    if p['method'] == PaymentMethod.CASH
                )

                if total_paid < collection_due:
                    raise ValueError(
                        f"المبلغ المدفوع ({float(total_paid):.2f}) أقل من صافي الفاتورة ({float(collection_due):.2f})"
                    )

                raw_change = total_paid - collection_due

                if raw_change > Decimal('0.00'):
                    remaining_trim = raw_change
                    method_priority = [PaymentMethod.CASH, PaymentMethod.VISA_1, PaymentMethod.VISA_2, PaymentMethod.VISA, PaymentMethod.INSTAPAY]

                    for priority_method in method_priority:
                        for p in resolved_payments:
                            if p['method'] == priority_method and remaining_trim > Decimal('0.00'):
                                trim = min(p['amount'], remaining_trim)
                                p['amount'] -= trim
                                remaining_trim -= trim
                        if remaining_trim <= Decimal('0.00'):
                            break

                    resolved_payments = [
                        p for p in resolved_payments
                        if (
                            p['amount'] > Decimal('0.00')
                            or p.get('entered_amount', Decimal('0.00')) > Decimal('0.00')
                        )
                    ]
            elif payment_method_str:
                try:
                    pm = PaymentMethod(payment_method_str.upper())
                except ValueError:
                    raise ValueError(f"Invalid payment method: {payment_method_str}")
                resolved_payments = [{
                    'method': pm,
                    'amount': collection_due,
                    'entered_amount': collection_due
                }]
                cash_paid_amount = collection_due if pm == PaymentMethod.CASH else Decimal('0.00')
                raw_change = Decimal('0.00')
            else:
                raise ValueError("يجب تحديد طريقة الدفع للفاتورة غير المجانية")

            dominant_pm = max(resolved_payments, key=lambda p: p['amount'])['method'] if resolved_payments else None

            # Resolve cashier user
            cashier_user = None
            if confirmed_by_id:
                cashier_employee = Employee.query.get(confirmed_by_id)
                if cashier_employee:
                    from app.models.user import User
                    cashier_user = User.query.filter_by(
                        full_name=cashier_employee.full_name,
                        branch_id=invoice.branch_id
                    ).first()

            # 4. Serialize invoice numbering per branch/day
            InvoiceEngine._acquire_invoice_number_lock(invoice.branch_id, today)

            for attempt in range(InvoiceEngine.INVOICE_NUMBER_MAX_RETRIES):
                with db.session.no_autoflush:
                    max_num = db.session.query(func.max(Invoice.invoice_number)).filter(
                        Invoice.branch_id == invoice.branch_id,
                        Invoice.invoice_date == today,
                        Invoice.invoice_number.isnot(None),
                    ).scalar()
                    next_num = (max_num or 0) + 1

                    invoice.invoice_number = next_num
                    invoice.invoice_date = today
                    invoice.payment_method = dominant_pm
                    invoice.status = InvoiceStatus.PAID
                    invoice.confirmed_by = confirmed_by_id
                    invoice.paid_at = now_utc
                    invoice.business_day_id = open_day.id
                    invoice.customer_name = customer_name
                    invoice.customer_phone = customer_phone
                    invoice.discount_amount = float(discount_dec)
                    invoice.change_amount = float(raw_change)
                    invoice.is_fully_discounted = is_free_invoice

                try:
                    with db.session.begin_nested():
                        db.session.flush([invoice])
                    break
                except IntegrityError as exc:
                    if (
                        attempt >= (InvoiceEngine.INVOICE_NUMBER_MAX_RETRIES - 1)
                        or not InvoiceEngine._is_invoice_number_conflict(exc)
                    ):
                        raise
                    invoice = InvoiceEngine._lock_invoice_row(invoice_id)
            else:
                raise RuntimeError("Invoice number allocation failed unexpectedly.")

            # 5. Promo Redemption Record
            if promo_redemption is not None:
                promo_redemption.redeemed_at = now_utc
                db.session.add(promo_redemption)

            # 2. Create InvoicePayment rows
            for p in resolved_payments:
                payment_record = InvoicePayment(
                    invoice_id=invoice.id,
                    method=p['method'],
                    amount=p['amount'].quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
                    entered_amount=p['entered_amount'].quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                )
                db.session.add(payment_record)

            # 3. Customer management logic (unchanged)
            # Fetch customer by phone (read-only lookup)
            phone_clean = customer_phone.strip() if customer_phone else None
            customer = None
            if phone_clean:
                customer = Customer.query.filter_by(phone=phone_clean, branch_id=invoice.branch_id).first()

            if not customer and phone_clean:
                try:
                    with db.session.begin_nested():
                        customer = Customer(
                            full_name=(customer_name.strip() if customer_name and customer_name.strip() else 'عميل غير مسمى'),
                            phone=phone_clean,
                            branch_id=invoice.branch_id,
                            is_active=True,
                        )
                        db.session.add(customer)
                        db.session.flush()
                except IntegrityError:
                    customer = Customer.query.filter_by(phone=phone_clean, branch_id=invoice.branch_id).first()

            if customer:
                invoice.customer_id = customer.id
                last_barber_id = next((item.barber_id for item in reversed(invoice.invoice_items) if item.barber_id), None)
                if last_barber_id:
                    customer.last_barber_id = last_barber_id

            # 3.5 Deduct product stock and log stock movements (FINAL DESTRUCTION ONLY AT CONFIRMATION)
            from app.models.product import ProductBranchStock, StockMovement, StockMovementType
            stock_rows = lock_product_stocks([
                (item.product_id, invoice.branch_id)
                for item in invoice.invoice_items if item.item_type == 'PRODUCT_ITEM'
            ])
            for item in invoice.invoice_items:
                if item.item_type == 'PRODUCT_ITEM':
                    branch_stock = stock_rows[(item.product_id, invoice.branch_id)]
                    
                    if not branch_stock or not branch_stock.is_available or branch_stock.stock_quantity < item.quantity:
                        raise ValueError("الكمية غير متاحة في هذا الفرع.")
                    
                    # Decrement stock
                    balance_before = branch_stock.stock_quantity
                    branch_stock.stock_quantity -= item.quantity
                    
                    # Create stock movement record
                    movement = capture_stock_movement(branch_stock, balance_before,
                        product_id=item.product_id,
                        branch_id=invoice.branch_id,
                        movement_type=StockMovementType.PRODUCT_SALE,
                        quantity=item.quantity,  # positive absolute quantity
                        invoice_id=invoice.id,
                        created_by=confirmed_by_id
                    )
                    db.session.add(movement)

            # 4. Commission logic (STRICT: ONLY if NOT a free invoice)
            if not is_free_invoice:
                from sqlalchemy import update as sql_update
                from app.models.employee import Employee as _Employee

                for item in invoice.invoice_items:
                    if item.item_type != 'SERVICE_ITEM':
                        continue
                    if item.barber_id and item.barber_commission_percent > 0:
                        share = round(float(item.service_price) * float(item.barber_commission_percent) / 100.0, 2)
                        db.session.execute(
                            sql_update(_Employee)
                            .where(_Employee.id == item.barber_id)
                            .values(commission_wallet_balance=_Employee.commission_wallet_balance + share)
                            .execution_options(synchronize_session=False)
                        )

                    if item.assistant_id and item.assistant_commission_percent > 0:
                        share = round(float(item.service_price) * float(item.assistant_commission_percent) / 100.0, 2)
                        db.session.execute(
                            sql_update(_Employee)
                            .where(_Employee.id == item.assistant_id)
                            .values(commission_wallet_balance=_Employee.commission_wallet_balance + share)
                            .execution_options(synchronize_session=False)
                        )

                for item in invoice.invoice_items:
                    if item.item_type != 'PRODUCT_ITEM':
                        continue
                    if not item.assigned_employee_id or (item.sales_commission_amount or 0) <= 0:
                        continue

                    db.session.execute(
                        sql_update(_Employee)
                        .where(_Employee.id == item.assigned_employee_id)
                        .values(
                            commission_wallet_balance=(
                                _Employee.commission_wallet_balance + float(item.sales_commission_amount)
                            )
                        )
                        .execution_options(synchronize_session=False)
                    )
            else:
                # Free invoices bypass commissions completely
                pass

            # 4.5 Auto-create TIP_PAYOUT expense for overpayments
            #     (Smart tip handling: calculate deficit between change and cash paid)
            #     When change_amount > cash_paid, the difference must come from the cash drawer.
            #     Business logic:
            #     - If change = 50 and cash_paid = 0 → expense = 50 (full change from drawer)
            #     - If change = 50 and cash_paid = 100 → expense = 0 (change from cash received)
            #     - If change = 50 and cash_paid = 20 → expense = 30 (20 from cash, 30 from drawer)
            if raw_change > Decimal('0.00'):
                # Expense needed only if change exceeds cash paid
                # (the cash paid can be used to give change, only deficit comes from drawer)
                expense_amount = raw_change - cash_paid_amount

                # Only create tip expense if there's a deficit
                if expense_amount > Decimal('0.00'):
                    from app.models.expense import Expense
                    from app.models.expense_category import ExpenseCategory
                    from app.models.user import UserRole

                    # Get or create TIP_PAYOUT category
                    tip_category = ExpenseCategory.query.filter_by(code='TIP_PAYOUT').first()
                    if not tip_category:
                        tip_category = ExpenseCategory(
                            name='Tip Payout',
                            code='TIP_PAYOUT',
                            is_active=True
                        )
                        db.session.add(tip_category)
                        db.session.flush()

                    # ✅ FIX 3: Fallback if cashier user lookup failed
                    if not cashier_user:
                        from app.models.user import User
                        # Try to find a SUPER_ADMIN user as fallback
                        fallback_user = User.query.filter_by(
                            role=UserRole.SUPER_ADMIN,
                            is_active=True
                        ).first()
                        
                        if fallback_user:
                            cashier_user = fallback_user
                            # Log this for audit trail (not silent anymore)
                            import sys
                            print(
                                f"[TIP-FALLBACK-WARNING] Cashier user not found for employee_id={confirmed_by_id}, "
                                f"branch_id={invoice.branch_id}. Using fallback SUPER_ADMIN user_id={fallback_user.id}",
                                file=sys.stderr
                            )
                        else:
                            # No fallback available - raise explicit error to prevent silent failure
                            raise ValueError(
                                f"Cannot create tip expense: cashier user not found for employee_id={confirmed_by_id} "
                                f"and no system admin available. Tip payout cannot be processed."
                            )

                    # Create tip payout expense with valid user (either original cashier or fallback)
                    tip_expense = Expense(
                        branch_id=invoice.branch_id,
                        expense_category_id=tip_category.id,
                        amount=float(expense_amount),
                        is_cash_event=True,
                        is_business_expense=False,  # TIP is cash movement, NOT a business expense
                        notes="Auto tip payout from overpayment",
                        expense_date=today,
                        created_by=cashier_user.id,
                        business_day_id=open_day.id
                    )
                    db.session.add(tip_expense)

            # 5. Final total verification (memory check before commit)
            InvoiceEngine._recalculate_total(invoice)

            # ── COMMIT
            if payment_attempt is not None:
                payment_attempt.status = PaymentConfirmationAttemptStatus.SUCCEEDED
                payment_attempt.failure_code = None
                payment_attempt.failure_message = None
                payment_attempt.completed_at = now_utc

            db.session.flush()
            if promo_redemption is not None:
                discount_payload = {
                    "source": "PROMO",
                    "type": promo_redemption.discount_type_snapshot.value,
                    "configured_value": promo_redemption.discount_value_snapshot,
                    "amount": discount_dec,
                    "promo_redemption_id": promo_redemption.id,
                    "promo_code_id": promo_redemption.promo_code_id,
                    "promo_code": promo_redemption.code_snapshot,
                }
            elif discount_dec > Decimal("0.00"):
                discount_payload = {
                    "source": "MANUAL",
                    "type": "FIXED",
                    "configured_value": discount_dec,
                    "amount": discount_dec,
                    "promo_redemption_id": None,
                    "promo_code_id": None,
                    "promo_code": None,
                }
            else:
                discount_payload = {
                    "source": "NONE",
                    "type": "NONE",
                    "configured_value": Decimal("0.00"),
                    "amount": Decimal("0.00"),
                    "promo_redemption_id": None,
                    "promo_code_id": None,
                    "promo_code": None,
                }

            append_invoice_event(
                invoice_id=invoice.id,
                event_type=InvoiceAuditEventType.INVOICE_PAID,
                actor=InvoiceEngine._audit_actor(actor_context, invoice.branch_id),
                gross_before=total_dec,
                gross_after=total_dec,
                request_id=payment_attempt_id,
                payload={
                    "invoice_number": invoice.invoice_number,
                    "invoice_date": invoice.invoice_date,
                    "item_count": len(invoice.invoice_items),
                    "gross_total": total_dec,
                    "discount": discount_payload,
                    "net_total": net_amount,
                    "booking_deposit_applied": deposit_applied,
                    "appointment_id": appointment_id,
                    "payments": [
                        {
                            "method": payment["method"].value,
                            "amount": payment["amount"].quantize(
                                Decimal("0.01"), rounding=ROUND_HALF_UP
                            ),
                            "entered_amount": payment["entered_amount"].quantize(
                                Decimal("0.01"), rounding=ROUND_HALF_UP
                            ),
                        }
                        for payment in resolved_payments
                    ],
                    "business_day_id": invoice.business_day_id,
                    "confirmed_by_employee_id": confirmed_by_id,
                    "customer_id": invoice.customer_id,
                    "is_fully_discounted": invoice.is_fully_discounted,
                },
            )
            db.session.commit()
            
            # 6. Notify Admins (Fail-safe, non-blocking)
            from app.services.notification_service import NotificationService
            NotificationService.broadcast_invoice(invoice)

        except Exception as e:
            db.session.rollback()
            raise e

        return invoice

    @staticmethod
    def commit_draft(invoice_id: int, actor_context=None) -> Invoice:
        """
        Commits a DRAFT invoice to DRAFT_COMMITTED status.
        This locks the draft as a snapshot for admin audit trail.
        
        Rules:
        1. Only DRAFT invoices can be committed
        2. Invoice must have at least 1 item
        3. Status changes to DRAFT_COMMITTED (read-only)
        4. Invoice becomes visible in Admin as "فواتير مسودة"
        
        Args:
            invoice_id: ID of the draft invoice
            
        Returns:
            Invoice: The committed draft invoice
            
        Raises:
            ValueError: If invoice is not DRAFT or has no items
        """
        # 1. Get Invoice and Validate Status
        invoice = InvoiceEngine._lock_invoice_row(invoice_id)
        if not invoice:
            raise ValueError(f"Invoice {invoice_id} not found.")
            
        if invoice.status != InvoiceStatus.DRAFT:
            raise ValueError(f"Cannot commit invoice {invoice_id} with status {invoice.status}. Only DRAFT allowed.")
            
        # 2. Validate Items Presence
        if not invoice.invoice_items or len(invoice.invoice_items) == 0:
            raise ValueError("Cannot commit an empty invoice. Add items first.")
            
        gross_amount = InvoiceEngine._audit_money(invoice.total_amount)
        item_count = len(invoice.invoice_items)
        try:
            # 3. Lock Draft (State Transition)
            invoice.status = InvoiceStatus.DRAFT_COMMITTED
            # Note: invoice_number remains None (not a paid invoice)
            # Note: payment_method remains None (not paid)
            # Note: confirmed_by remains None (not confirmed)
            append_invoice_event(
                invoice_id=invoice.id,
                event_type=InvoiceAuditEventType.DRAFT_COMMITTED,
                actor=InvoiceEngine._audit_actor(actor_context, invoice.branch_id),
                gross_before=gross_amount,
                gross_after=gross_amount,
                payload={
                    "previous_status": InvoiceStatus.DRAFT.value,
                    "new_status": InvoiceStatus.DRAFT_COMMITTED.value,
                    "item_count": item_count,
                    "gross_amount": gross_amount,
                },
            )
            db.session.commit()
        except Exception:
            db.session.rollback()
            raise
        return invoice
