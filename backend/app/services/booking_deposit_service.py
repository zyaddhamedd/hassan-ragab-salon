"""Booking-specific prepaid settlement. Collection history is never rewritten."""
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy import exists, func
from app.extensions import db
from app.models.appointment import Appointment, AppointmentStatus
from app.models.appointment_deposit_transaction import AppointmentDepositTransaction as Tx, AppointmentDepositTransactionType as Kind
from app.models.customer import Customer
from app.models.customer_balance import CustomerBalance
from app.models.user import User


def money(value):
    return Decimal(str(value or 0)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def has_application(invoice_id):
    return exists().where(Tx.invoice_id == invoice_id, Tx.transaction_type == Kind.DEPOSIT_APPLIED)


def serialize_settlement(invoice):
    rows = [row for row in invoice.deposit_applications if row.transaction_type == Kind.DEPOSIT_APPLIED]
    amount = sum((money(row.amount) for row in rows), Decimal('0.00'))
    return {'appointment_id': rows[0].appointment_id if rows else None,
            'applied_amount': float(amount), 'application_ids': [row.id for row in rows],
            'new_collection_amount': float(money(invoice.total_amount) - money(invoice.discount_amount) - amount) if invoice.status.value == 'PAID' else 0,
            'remaining_unpaid': 0 if invoice.status.value == 'PAID' else None}


def available_collections(appointment, lock=False):
    query = Tx.query.filter_by(appointment_id=appointment.id, customer_id=appointment.customer_id,
        branch_id=appointment.branch_id, transaction_type=Kind.DEPOSIT_COLLECTION).order_by(Tx.id)
    if lock:
        query = query.populate_existing().with_for_update()
    result = []
    for source in query.all():
        used = db.session.query(func.coalesce(func.sum(Tx.amount), 0)).filter(
            Tx.source_collection_id == source.id, Tx.transaction_type == Kind.DEPOSIT_APPLIED).scalar()
        available = money(source.amount) - money(used)
        if available < 0:
            raise ValueError('سجل العربون غير متطابق ويحتاج مراجعة الإدارة')
        if available:
            result.append((source, available))
    return result


def _validate_documented_balance(customer_id, branch_id, balance):
    # Extra legacy credit is never a source; a documented-credit deficit is unsafe.
    collected = db.session.query(func.coalesce(func.sum(Tx.amount), 0)).filter_by(
        customer_id=customer_id, branch_id=branch_id, transaction_type=Kind.DEPOSIT_COLLECTION).scalar()
    applied = db.session.query(func.coalesce(func.sum(Tx.amount), 0)).filter_by(
        customer_id=customer_id, branch_id=branch_id, transaction_type=Kind.DEPOSIT_APPLIED).scalar()
    if money(collected) - money(applied) > money(balance.balance if balance else 0):
        raise ValueError('رصيد العربون غير متطابق ويحتاج مراجعة الإدارة')


def eligible_bookings(customer_id, branch_id):
    customer = Customer.query.filter_by(id=customer_id, branch_id=branch_id).first()
    if not customer:
        raise ValueError('العميل غير متاح لهذا الفرع')
    balance = CustomerBalance.query.filter_by(customer_id=customer.id, branch_id=branch_id).first()
    _validate_documented_balance(customer.id, branch_id, balance)
    result = []
    for booking in Appointment.query.filter_by(customer_id=customer.id, branch_id=branch_id,
            status=AppointmentStatus.SCHEDULED).order_by(Appointment.appointment_date, Appointment.id):
        available = sum((amount for _, amount in available_collections(booking)), Decimal('0.00'))
        if available:
            result.append({'appointment_id': booking.id, 'customer_id': customer.id,
                'date': booking.appointment_date.isoformat(), 'time': booking.appointment_time.isoformat(),
                'service_name': booking.service_name, 'available_amount': float(available)})
    return result


def apply_booking_deposit(invoice, appointment_id, customer_id, customer_phone, net_amount,
                          business_day_id, cashier_id, multi_customer=False, expected_amount=None, actor_user_id=None):
    if not appointment_id:
        return Decimal('0.00')
    if invoice.booking_appointment_id and invoice.booking_appointment_id != appointment_id:
        raise ValueError('العربون لا يخص الحجز المرتبط بالفاتورة')
    if type(multi_customer) is not bool or multi_customer or invoice.is_grouped or invoice.booking_multi_customer:
        raise ValueError('لا يمكن تطبيق عربون على فاتورة متعددة العملاء')
    if type(appointment_id) is not int or type(customer_id) is not int:
        raise ValueError('يجب تحديد الحجز والعميل بدقة')
    booking = Appointment.query.populate_existing().filter_by(id=appointment_id).with_for_update().first()
    if not booking or booking.branch_id != invoice.branch_id or booking.customer_id != customer_id:
        raise ValueError('الحجز لا يخص العميل أو الفرع الحالي')
    if booking.status != AppointmentStatus.SCHEDULED:
        raise ValueError('يمكن استخدام عربون الحجز المجدول فقط')
    customer = Customer.query.filter_by(id=customer_id, branch_id=invoice.branch_id).first()
    if not customer or customer.phone.strip() != str(customer_phone or '').strip():
        raise ValueError('بيانات العميل لا تطابق صاحب الحجز')
    if invoice.customer_id and invoice.customer_id != customer.id:
        raise ValueError('لا يمكن استخدام عربون عميل آخر')
    if db.session.query(Tx.id).filter_by(invoice_id=invoice.id, transaction_type=Kind.DEPOSIT_APPLIED).first():
        raise ValueError('تم تطبيق عربون على هذه الفاتورة بالفعل')
    if money(net_amount) == 0:
        return Decimal('0.00')
    sources = available_collections(booking, lock=True)
    available = sum((amount for _, amount in sources), Decimal('0.00'))
    if available <= 0:
        raise ValueError('لا يوجد عربون موثق متاح لهذا الحجز')
    balance = CustomerBalance.query.populate_existing().filter_by(customer_id=customer.id,
        branch_id=invoice.branch_id).with_for_update().first()
    _validate_documented_balance(customer.id, invoice.branch_id, balance)
    amount = min(available, money(net_amount))
    if expected_amount is not None and money(expected_amount) != amount:
        raise ValueError('تغير العربون أو الفاتورة؛ أعد التحقق من المبلغ قبل التأكيد')
    if not balance or money(balance.balance) < amount:
        raise ValueError('رصيد العربون غير متطابق ويحتاج مراجعة الإدارة')
    from app.models.employee import Employee
    finalizer = Employee.query.filter_by(id=cashier_id, branch_id=invoice.branch_id).first()
    if actor_user_id is not None:
        # JWT subjects are strings; PostgreSQL must receive an integer for users.id.
        try:
            if isinstance(actor_user_id, bool) or not str(actor_user_id).isdigit():
                raise ValueError
            actor_user_id = int(actor_user_id)
        except (TypeError, ValueError):
            raise ValueError('تعذر تحديد مستخدم الكاشير لتوثيق العربون') from None
        user = User.query.filter_by(id=actor_user_id, branch_id=invoice.branch_id).first()
    else:
        user = User.query.filter_by(full_name=finalizer.full_name, branch_id=invoice.branch_id).first() if finalizer else None
    if not user:
        raise ValueError('تعذر تحديد مستخدم الكاشير لتوثيق العربون')
    remaining = amount
    for source, source_available in sources:
        take = min(source_available, remaining)
        if take > 0:
            db.session.add(Tx(appointment_id=booking.id, customer_id=customer.id, branch_id=invoice.branch_id,
                business_day_id=business_day_id, cashier_id=cashier_id, collected_by_user_id=user.id,
                amount=take, payment_method=source.payment_method, transaction_type=Kind.DEPOSIT_APPLIED,
                invoice_id=invoice.id, source_collection_id=source.id))
            remaining -= take
    balance.balance = money(balance.balance) - amount
    invoice.customer_id = customer.id
    return amount
