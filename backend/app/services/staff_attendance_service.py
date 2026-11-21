"""Staff-initiated GPS attendance using the existing Attendance row and locks."""
import re
import hashlib
from datetime import timedelta, timezone
from flask import g, request
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden
from app.extensions import db
from app.models.attendance import Attendance, AttendanceStatus, AttendanceCheckoutSource
from app.models.employee import Employee
from app.models.employee_shift import EmployeeShiftInstance
from app.models.staff_attendance import StaffAttendanceReceipt as Receipt
from app.services import staff_auth_service as auth, staff_device_service as devices
from app.services import staff_geofence_service as geo, employee_shift_service as shifts
from app.services.staff_identity_service import require_staff_identity_enabled
from app.services.attendance_compatibility import STAFF_ORIGIN


def freeze_expectation(employee, now, actor_id):
    """Caller holds Employee lock shared with all scheduling/transfer writes.

    A still-running previous overnight shift belongs to its START date. Otherwise
    use today's Cairo expectation, retaining REST/UNASSIGNED without inventing one.
    """
    day = now.astimezone(shifts.CAIRO).date()
    previous = shifts.expectation(employee, day - timedelta(days=1))
    row = previous if (previous.state == 'SCHEDULED' and
        shifts.aware(previous.start_at) <= now < shifts.aware(previous.end_at)) else shifts.expectation(employee, day)
    if row.branch_id != employee.branch_id:
        raise Conflict('Applicable shift belongs to another branch; manager scheduling review required.')
    if row.id is None:
        row.created_by = actor_id
        db.session.add(row)
        db.session.flush()
    return row


def response_for(receipt):
    attendance = db.session.get(Attendance, receipt.attendance_id)
    snapshot = db.session.get(EmployeeShiftInstance, receipt.shift_instance_id)
    # A historical confirmation receipt: retries return the same successful event,
    # never assert that an earlier check-in is still the employee's current state.
    shift = shifts.serialize(snapshot)
    for field in ('start_at', 'end_at'):
        value = getattr(snapshot, field)
        shift[field] = auth.aware(value).astimezone(timezone.utc).isoformat() if value else None
    return {
        'attendance_id': attendance.id, 'action': receipt.action, 'confirmed': True,
        'confirmed_at': auth.aware(receipt.recorded_at).astimezone(timezone.utc).isoformat(),
        'business_date': attendance.date.isoformat(),
        'check_in_time': auth.aware(attendance.check_in_time).astimezone(timezone.utc).isoformat(),
        'check_out_time': auth.aware(receipt.recorded_at).astimezone(timezone.utc).isoformat() if receipt.action == 'CHECK_OUT' else None,
        'shift': shift,
    }


def record(action, data):
    """Authenticated proof is consumed by require_staff before entering here.

    Re-lock auth state so revocation/replacement cannot slip between that committed
    proof and this write. Lock User/Session/Device -> Employee -> Attendance ->
    Branch, with no reverse acquisition. Success commits snapshot/row/receipt once.
    Failed writes roll back; their already consumed challenge remains one-time.
    """
    require_staff_identity_enabled()
    auth.require_origin()
    fields = {'idempotency_key', 'location'} | ({'attendance_id'} if action == 'CHECK_OUT' else set())
    if action not in ('CHECK_IN', 'CHECK_OUT') or not isinstance(data, dict) or set(data) != fields or request.args:
        raise BadRequest('Unexpected or missing attendance fields.')
    key = data['idempotency_key']
    if not isinstance(key, str) or not re.fullmatch('[0-9a-f]{32}', key):
        raise BadRequest('Expected a new 32-character lowercase hexadecimal idempotency key.')
    if action == 'CHECK_OUT' and (type(data['attendance_id']) is not int or data['attendance_id'] <= 0):
        raise BadRequest('Expected the confirmed attendance ID.')
    try:
        user, session = auth._locked_session(g.staff_access_claims)
        owner, device = devices._user_for(g.staff_device_id)
        if owner.id != user.id or device.id != session.device_id or device.state != 'ACTIVE':
            raise Forbidden('Active session-bound personal device required.')
        employee = (Employee.query.filter_by(id=user.employee_id)
                    .populate_existing().with_for_update().first())
        if not employee or not auth._active(user):
            raise Forbidden('Staff employee is not eligible.')
        digest = auth.digest('attendance-request', hashlib.sha256(request.get_data(cache=True)).hexdigest())
        receipt = Receipt.query.filter_by(user_id=user.id, idempotency_key=key).first()
        if receipt:
            if receipt.action != action or receipt.request_hash != digest:
                raise Conflict('Idempotency key was already used for a different request.')
            result = response_for(receipt)
            db.session.commit()
            return result

        if action == 'CHECK_IN':
            open_rows = (Attendance.query.filter(Attendance.employee_id == employee.id,
                         or_(Attendance.status == AttendanceStatus.PRESENT, Attendance.check_out_time.is_(None)))
                         .populate_existing().with_for_update(of=Attendance).all())
            if open_rows:
                raise Conflict('An attendance row is already open; check out or request manager review.')
            attendance = None
        else:
            attendance = (Attendance.query.filter_by(id=data['attendance_id'], employee_id=employee.id)
                          .populate_existing().with_for_update(of=Attendance).first())
            if (not attendance or attendance.attendance_origin != STAFF_ORIGIN or
                    attendance.branch_id != employee.branch_id or attendance.status != AttendanceStatus.PRESENT or
                    attendance.check_out_time is not None):
                raise Conflict('This Staff attendance is not open in the authenticated employee branch.')
            check_in = Receipt.query.filter_by(attendance_id=attendance.id, action='CHECK_IN').first()
            if not check_in or check_in.user_id != user.id:
                raise Conflict('Verified Staff check-in evidence is missing; manager review required.')

        # Serialize against configuration changes, then obtain a fresh SERVER clock.
        geo.operating_branch(employee.branch_id, lock=True)
        now = auth.now_utc()
        configuration = geo.current(employee.branch_id)
        geo.evaluate(configuration, data['location'], now=now)
        if action == 'CHECK_IN':
            snapshot = freeze_expectation(employee, now, user.id)
            attendance = Attendance(employee_id=employee.id, branch_id=employee.branch_id,
                business_day_id=None, date=snapshot.shift_date, check_in_time=now,
                status=AttendanceStatus.PRESENT, attendance_origin=STAFF_ORIGIN)
            db.session.add(attendance)
            db.session.flush()  # Existing uq_employee_present remains the final duplicate guard.
        else:
            if now < auth.aware(attendance.check_in_time):
                raise Conflict('Server clock precedes check-in; manager review required.')
            snapshot = db.session.get(EmployeeShiftInstance, check_in.shift_instance_id)
            attendance.check_out_time = now
            attendance.status = AttendanceStatus.LEFT
            attendance.checkout_source = AttendanceCheckoutSource.MANUAL
            attendance.checkout_verification = 'STAFF_GPS_VERIFIED'
        receipt = Receipt(user_id=user.id, idempotency_key=key, request_hash=digest, action=action,
            attendance_id=attendance.id, shift_instance_id=snapshot.id, geofence_version_id=configuration.id,
            device_id=device.id, challenge_id=g.staff_proof_challenge_id, recorded_at=now)
        db.session.add(receipt)
        db.session.flush()
        result = response_for(receipt)
        db.session.commit()
        return result
    except IntegrityError:
        db.session.rollback()
        raise Conflict('Concurrent attendance change; retry with a fresh proof and the same request key.') from None
    except Exception:
        db.session.rollback()
        raise


def current():
    """One MVCC SELECT: fresh authority, attendance and frozen shift, no row locks.

    Proof consumption remains the existing auth write; this read never freezes a
    shift or changes attendance. Results are point-in-time, not a checkout lease.
    """
    require_staff_identity_enabled()
    from sqlalchemy import and_, case
    from werkzeug.exceptions import Unauthorized
    from app.models.user import User, UserRole
    from app.models.branch import Branch
    from app.models.employee import EmployeeStatus
    from app.models.staff_auth import StaffSession
    from app.models.staff_device import StaffDevice
    from sqlalchemy.orm import aliased
    if set(request.args) - {'operation'} or len(request.args.getlist('operation')) > 1 or request.get_data():
        raise BadRequest('Unexpected attendance state parameters or body.')
    operation = request.args.get('operation')
    if operation is not None and not re.fullmatch('[0-9a-f]{32}', operation):
        raise BadRequest('Expected a valid attendance operation reference.')
    Recovery = aliased(Receipt)
    RecoveryAttendance = aliased(Attendance)
    claims = g.staff_access_claims
    now = auth.now_utc()
    open_row = or_(Attendance.status == AttendanceStatus.PRESENT, Attendance.check_out_time.is_(None))
    rows = (db.session.query(Employee, Attendance, EmployeeShiftInstance, Receipt.id, Recovery, RecoveryAttendance.id)
        .join(User, and_(User.employee_id == Employee.id, User.id == int(claims['sub'])))
        .join(StaffSession, and_(StaffSession.user_id == User.id, StaffSession.id == claims['sid']))
        .join(StaffDevice, and_(StaffDevice.id == StaffSession.device_id, StaffDevice.id == claims['device_id'],
                               StaffDevice.user_id == User.id, StaffDevice.employee_id == Employee.id))
        .join(Branch, Branch.id == Employee.branch_id)
        .outerjoin(Attendance, and_(Attendance.employee_id == Employee.id,
                                   or_(Attendance.attendance_origin == STAFF_ORIGIN, open_row)))
        .outerjoin(Receipt, and_(Receipt.attendance_id == Attendance.id, Receipt.action == 'CHECK_IN', Receipt.user_id == User.id))
        .outerjoin(EmployeeShiftInstance, and_(EmployeeShiftInstance.id == Receipt.shift_instance_id,
            EmployeeShiftInstance.employee_id == Employee.id, EmployeeShiftInstance.branch_id == Attendance.branch_id,
            EmployeeShiftInstance.shift_date == Attendance.date))
        .outerjoin(Recovery, and_(Recovery.user_id == User.id, Recovery.idempotency_key == operation))
        .outerjoin(RecoveryAttendance, and_(RecoveryAttendance.id == Recovery.attendance_id, RecoveryAttendance.employee_id == Employee.id))
        .filter(User.role == UserRole.EMPLOYEE, User.is_active.is_(True), User.staff_password_initialized.is_(True),
            User.staff_auth_version == claims['staff_auth_version'], StaffSession.auth_version == User.staff_auth_version,
            StaffSession.revoked_at.is_(None), StaffSession.expires_at > now, StaffDevice.state == 'ACTIVE',
            StaffDevice.thumbprint == claims['cnf']['jkt'], Employee.is_active.is_(True), Employee.is_deleted.is_(False),
            Employee.status == EmployeeStatus.ACTIVE, Branch.is_active.is_(True), Branch.is_main_warehouse.is_(False))
        .order_by(case((open_row, 0), else_=1), Attendance.check_in_time.desc(), Attendance.id.desc())
        .limit(2).populate_existing().all())
    if not rows:
        raise Unauthorized('Invalid Staff session.')
    employee, attendance, snapshot, receipt_id, recovered, recovered_id = rows[0]
    result = dict(state='NONE', check_in_eligible=True, checkout_eligible=False, attendance=None,
                  observed_at=now.astimezone(timezone.utc).isoformat(),
                  recovery=dict(action=recovered.action, attendance_id=recovered_id, committed=True) if recovered and recovered_id else None)
    if attendance is None:
        return result
    is_open = attendance.status == AttendanceStatus.PRESENT and attendance.check_out_time is None
    inconsistent = (attendance.status == AttendanceStatus.PRESENT) != (attendance.check_out_time is None)
    if attendance.attendance_origin != STAFF_ORIGIN:
        return dict(result, state='BLOCKED_LEGACY', check_in_eligible=False)
    shift = shifts.serialize(snapshot) if snapshot else None
    if shift:
        for field in ('start_at', 'end_at'):
            value = getattr(snapshot, field)
            shift[field] = auth.aware(value).astimezone(timezone.utc).isoformat() if value else None
    result['attendance'] = dict(attendance_id=attendance.id, business_date=attendance.date.isoformat(),
        check_in_time=auth.aware(attendance.check_in_time).astimezone(timezone.utc).isoformat(),
        check_out_time=auth.aware(attendance.check_out_time).astimezone(timezone.utc).isoformat() if attendance.check_out_time else None,
        closure='ADMIN_UNVERIFIED' if attendance.checkout_verification == 'ADMIN_UNVERIFIED' else
                'GPS_VERIFIED' if attendance.checkout_verification == 'STAFF_GPS_VERIFIED' else None,
        shift=shift)
    multiple_open = sum(1 for _, row, _, _, _, _ in rows if row and (row.status == AttendanceStatus.PRESENT or row.check_out_time is None)) > 1
    if inconsistent or multiple_open or (is_open and (attendance.branch_id != employee.branch_id or not snapshot or not receipt_id)):
        return dict(result, state='REVIEW_REQUIRED', check_in_eligible=False)
    return dict(result, state='OPEN' if is_open else 'CLOSED', checkout_eligible=is_open, check_in_eligible=not is_open)
