"""Booking handoff context and lazy, atomic booking Draft identity."""
from app.extensions import db
from app.models.appointment import Appointment, AppointmentStatus
from app.models.invoice import Invoice, InvoiceStatus
from app.models.employee import Employee, EmployeeType
from app.models.attendance import Attendance, AttendanceStatus
from app.models.service import Service, ServiceCategory
from app.services.booking_deposit_service import eligible_bookings
from app.models.business_day import BusinessDay, BusinessDayStatus


def booking_for_branch(appointment_id, branch_id, lock=False):
    if type(appointment_id) is not int:
        raise ValueError('معرّف الحجز غير صالح')
    query = Appointment.query.filter_by(id=appointment_id, branch_id=branch_id)
    if lock:
        query = query.populate_existing().with_for_update()
    booking = query.first()
    if not booking:
        raise ValueError('الحجز غير متاح لهذا الفرع')
    if booking.status != AppointmentStatus.SCHEDULED:
        raise ValueError('الحجز غير مجدول ولا يمكن تسليمه للكاشير')
    if not booking.customer or booking.customer.branch_id != branch_id:
        raise ValueError('العميل غير متاح لهذا الفرع')
    return booking


def linked_draft(booking):
    invoice = Invoice.query.filter_by(booking_appointment_id=booking.id).populate_existing().first()
    if invoice and (invoice.branch_id != booking.branch_id or invoice.status != InvoiceStatus.DRAFT):
        labels = {'PAID': 'تمت محاسبة هذا الحجز بالفعل', 'DRAFT_COMMITTED': 'فاتورة الحجز محفوظة كمعلقة ومقفلة', 'CANCELED': 'فاتورة الحجز ملغاة'}
        raise ValueError(labels.get(invoice.status.value, 'فاتورة الحجز غير متاحة'))
    if invoice is None:
        # Prior documented settlements also identify a paid booking. Read them
        # without backfilling or rewriting historical invoice links.
        from app.models.appointment_deposit_transaction import AppointmentDepositTransaction as Tx, AppointmentDepositTransactionType as Kind
        prior = db.session.query(Tx.id).join(Invoice, Invoice.id == Tx.invoice_id).filter(
            Tx.appointment_id == booking.id, Tx.transaction_type == Kind.DEPOSIT_APPLIED,
            Invoice.status == InvoiceStatus.PAID).first()
        if prior:
            raise ValueError('تمت محاسبة هذا الحجز بالفعل')
    return invoice


def safe_service(booking):
    if not booking.service_id:
        return None
    return Service.query.join(ServiceCategory).filter(Service.id == booking.service_id,
        Service.is_active.is_(True), ServiceCategory.is_active.is_(True)).first()


def safe_barber(booking):
    if not booking.barber_id:
        return None
    return Employee.query.join(Attendance, Attendance.employee_id == Employee.id).join(
        BusinessDay, BusinessDay.id == Attendance.business_day_id).filter(
        Employee.id == booking.barber_id, Employee.branch_id == booking.branch_id,
        Employee.employee_type == EmployeeType.BARBER, Employee.is_active.is_(True),
        Attendance.branch_id == booking.branch_id, BusinessDay.branch_id == booking.branch_id,
        BusinessDay.status == BusinessDayStatus.OPEN,
        Attendance.status == AttendanceStatus.PRESENT).first()


def get_context(appointment_id, branch_id):
    booking = booking_for_branch(appointment_id, branch_id)
    invoice = linked_draft(booking)
    deposits = eligible_bookings(booking.customer_id, branch_id)
    return booking, invoice, next((d for d in deposits if d['appointment_id'] == booking.id), None)


def get_or_create_draft(appointment_id, branch_id, cashier_id, actor_context, multi_customer=False):
    # Lock only the booking here. Existing invoices are read, never locked after
    # the booking: checkout locks invoice before booking, so avoid an inversion.
    booking = booking_for_branch(appointment_id, branch_id, lock=True)
    invoice = linked_draft(booking)
    if invoice:
        db.session.commit()  # Release booking lock; no invoice mutation.
        return invoice, False
    from app.modules.invoice_engine import InvoiceEngine
    try:
        invoice = InvoiceEngine.create_draft_invoice(branch_id, cashier_id, actor_context, commit=False)
        invoice.booking_appointment_id = booking.id
        invoice.booking_multi_customer = multi_customer
        invoice.customer_id = booking.customer_id
        invoice.customer_name = booking.customer.full_name
        invoice.customer_phone = booking.customer.phone
        db.session.commit()
        return invoice, True
    except Exception:
        db.session.rollback()
        raise


def validate_prefill(invoice, service_id, barber_id):
    if not invoice.booking_appointment_id or invoice.booking_multi_customer:
        raise ValueError('لا يمكن تجهيز الخدمة تلقائيًا لهذه الفاتورة')
    booking = booking_for_branch(invoice.booking_appointment_id, invoice.branch_id)
    service, barber = safe_service(booking), safe_barber(booking)
    if not service or not barber or service.id != service_id or barber.id != barber_id:
        raise ValueError('الخدمة أو الحلاق لم يعد متاحًا؛ اخترهما يدويًا')
