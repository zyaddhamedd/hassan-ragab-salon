"""Compatibility boundary only; no Staff GPS check-in/checkout implementation.

Lock order: transfer locks Employee, then Attendance; cashier paths lock BusinessDay,
then Attendance (never Employee). Future Staff checkout MUST lock and refresh the
same Attendance row, recheck branch/PRESENT/no checkout, and commit once. No caller
may cache an attendance object and later write its checkout without refreshing it.
"""
from werkzeug.exceptions import Conflict, BadRequest
from app.models.attendance import Attendance, AttendanceStatus, AttendanceCheckoutSource
from app.services.staff_identity_service import authorize

STAFF_ORIGIN = 'STAFF_GPS'


def require_legacy_closure(attendance):
    # Fail closed even if Staff has since been switched OFF: origin is durable.
    if attendance.attendance_origin == STAFF_ORIGIN:
        raise Conflict('Staff attendance requires Staff checkout or reviewed administrative closure.')


def close_transfer_attendance(employee_id, source_branch_id, actor, review, now):
    """Caller holds Employee lock; mutate only after locked state/source checks.

    No commit here: attendance, employee movement and transfer log are atomic.
    NULL origin means legacy; no historical backfill is needed.
    """
    rows = (Attendance.query.filter_by(employee_id=employee_id, check_out_time=None)
            .populate_existing().with_for_update(of=Attendance).all())
    if len(rows) > 1:
        raise Conflict('Ambiguous open attendance; manager investigation required.')
    if not rows:
        if review is not None:
            raise Conflict('Reviewed attendance is no longer open; reload before transferring.')
        return
    attendance = rows[0]
    if attendance.status != AttendanceStatus.PRESENT or attendance.check_out_time is not None:
        raise Conflict('Attendance is no longer open.')
    if attendance.branch_id != source_branch_id:
        raise Conflict('Open attendance does not belong to the transfer source branch.')
    if attendance.attendance_origin == STAFF_ORIGIN:
        authorize(actor)  # Both Omar/Staff flags, active SUPER_ADMIN or EXEC_ADMIN.
        if (not isinstance(review, dict) or set(review) != {'attendance_id', 'reason', 'acknowledge_unverified'}
                or type(review['attendance_id']) is not int or review['attendance_id'] != attendance.id
                or review['acknowledge_unverified'] is not True):
            raise Conflict('Explicit manager review of this attendance and unverified closure acknowledgement required.')
        reason = review['reason']
        if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 200:
            raise BadRequest('Administrative closure reason must contain 1–200 characters.')
        attendance.checkout_verification = 'ADMIN_UNVERIFIED'
        attendance.closure_actor_id = actor.id
        attendance.closure_reason = reason.strip()
        attendance.closure_recorded_at = now
        attendance.closure_review_required = True
    elif attendance.attendance_origin not in (None, 'LEGACY_CASHIER'):
        raise Conflict('Unknown attendance origin.')
    attendance.check_out_time = now
    attendance.status = AttendanceStatus.LEFT
    attendance.checkout_source = AttendanceCheckoutSource.ADMIN_CORRECTION
