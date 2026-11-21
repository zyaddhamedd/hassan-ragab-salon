from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import joinedload

from app.models.attendance import Attendance, AttendanceCheckoutSource, AttendanceStatus
from app.models.business_day import BusinessDay
from app.models.employee import Employee, EmployeeType
from app.utils.date_utils import get_utc_now, to_iso_string


CAIRO_TZ = ZoneInfo("Africa/Cairo")
ARABIC_WEEKDAY_NAMES = {
    0: "الاثنين",
    1: "الثلاثاء",
    2: "الأربعاء",
    3: "الخميس",
    4: "الجمعة",
    5: "السبت",
    6: "الأحد",
}
ATTENDANCE_ELIGIBLE_TYPES = (
    EmployeeType.BARBER,
    EmployeeType.ASSISTANT,
)


def build_attendance_workspace_payload(business_day: BusinessDay) -> dict:
    eligible_employees = (
        Employee.query
        .options(joinedload(Employee.branch))
        .filter(
            Employee.is_active == True,  # noqa: E712
            Employee.branch_id == business_day.branch_id,
            Employee.employee_type.in_(ATTENDANCE_ELIGIBLE_TYPES),
        )
        .order_by(Employee.full_name.asc(), Employee.id.asc())
        .all()
    )
    eligible_employee_ids = [employee.id for employee in eligible_employees]

    attendance_rows = []
    if eligible_employee_ids:
        attendance_rows = (
            Attendance.query
            .options(
                joinedload(Attendance.employee),
                joinedload(Attendance.branch),
            )
            .filter(
                Attendance.business_day_id == business_day.id,
                Attendance.branch_id == business_day.branch_id,
                Attendance.employee_id.in_(eligible_employee_ids),
            )
            .order_by(Attendance.check_in_time.asc(), Attendance.id.asc())
            .all()
        )

    rows: list[dict] = []
    attended_employee_ids: set[int] = set()
    still_present_employee_ids: set[int] = set()
    auto_checked_out_employee_ids: set[int] = set()

    for attendance in attendance_rows:
        employee = attendance.employee
        if employee is None:
            continue

        rows.append(_serialize_workspace_attendance_row(attendance, business_day))
        attended_employee_ids.add(employee.id)

        if attendance.status == AttendanceStatus.PRESENT:
            still_present_employee_ids.add(employee.id)

        if attendance.checkout_source == AttendanceCheckoutSource.BUSINESS_DAY_CLOSE:
            auto_checked_out_employee_ids.add(employee.id)

    absent_employees = [
        employee
        for employee in eligible_employees
        if employee.id not in attended_employee_ids
    ]
    rows.extend(
        _serialize_workspace_absence_row(employee, business_day)
        for employee in absent_employees
    )

    return {
        "business_day": _serialize_business_day_metadata(business_day),
        "summary": {
            "total_eligible": len(eligible_employees),
            "attended": len(attended_employee_ids),
            "absent": len(absent_employees),
            "still_present": len(still_present_employee_ids),
            "auto_checked_out": len(auto_checked_out_employee_ids),
            "attendance_sessions": len(attendance_rows),
        },
        "rows": rows,
    }


def build_legacy_attendance_payload(*, target_date: date, allowed_branch_ids: list[int]) -> dict:
    attendance_rows = (
        Attendance.query
        .options(
            joinedload(Attendance.employee),
            joinedload(Attendance.branch),
        )
        .filter(
            Attendance.business_day_id.is_(None),
            Attendance.date == target_date,
            Attendance.branch_id.in_(allowed_branch_ids),
        )
        .order_by(Attendance.check_in_time.asc(), Attendance.id.asc())
        .all()
    )

    return {
        "metadata": {
            "date": target_date.isoformat(),
            "legacy_only": True,
        },
        "rows": [_serialize_legacy_attendance_row(attendance) for attendance in attendance_rows],
    }


def _serialize_business_day_metadata(business_day: BusinessDay) -> dict:
    opened_at_local = _to_cairo_time(business_day.opened_at)

    return {
        "id": business_day.id,
        "branch_id": business_day.branch_id,
        "branch_name": business_day.branch.name if business_day.branch else "Unknown",
        "status": business_day.status.value if business_day.status else None,
        "business_date": opened_at_local.date().isoformat() if opened_at_local else None,
        "day_label": _format_business_day_label(opened_at_local),
        "opened_at": to_iso_string(business_day.opened_at),
        "closed_at": to_iso_string(business_day.closed_at),
        "opened_by": business_day.opener.full_name if business_day.opener else None,
        "closed_by": business_day.closer.full_name if business_day.closer else None,
    }


def _serialize_workspace_attendance_row(attendance: Attendance, business_day: BusinessDay) -> dict:
    metadata = _serialize_business_day_metadata(business_day)
    return {
        "row_type": "ATTENDANCE",
        "attendance_id": attendance.id,
        "employee_id": attendance.employee_id,
        "employee_name": attendance.employee.full_name if attendance.employee else None,
        "employee_type": attendance.employee.employee_type.value if attendance.employee and attendance.employee.employee_type else None,
        "branch_id": business_day.branch_id,
        "branch_name": metadata["branch_name"],
        "business_day_id": business_day.id,
        "business_date": metadata["business_date"],
        "business_day_label": metadata["day_label"],
        "check_in_time": to_iso_string(attendance.check_in_time),
        "check_out_time": to_iso_string(attendance.check_out_time),
        "duration_minutes": _calculate_duration_minutes(
            attendance.check_in_time,
            attendance.check_out_time,
            attendance.status,
        ),
        "attendance_status": attendance.status.value if attendance.status else None,
        "checkout_source": attendance.checkout_source.value if attendance.checkout_source else None,
    }


def _serialize_workspace_absence_row(employee: Employee, business_day: BusinessDay) -> dict:
    metadata = _serialize_business_day_metadata(business_day)
    return {
        "row_type": "ABSENCE",
        "attendance_id": None,
        "employee_id": employee.id,
        "employee_name": employee.full_name,
        "employee_type": employee.employee_type.value if employee.employee_type else None,
        "branch_id": business_day.branch_id,
        "branch_name": metadata["branch_name"],
        "business_day_id": business_day.id,
        "business_date": metadata["business_date"],
        "business_day_label": metadata["day_label"],
        "check_in_time": None,
        "check_out_time": None,
        "duration_minutes": 0,
        "attendance_status": "ABSENT",
        "checkout_source": None,
    }


def _serialize_legacy_attendance_row(attendance: Attendance) -> dict:
    return {
        "row_type": "ATTENDANCE",
        "attendance_id": attendance.id,
        "employee_id": attendance.employee_id,
        "employee_name": attendance.employee.full_name if attendance.employee else None,
        "employee_type": attendance.employee.employee_type.value if attendance.employee and attendance.employee.employee_type else None,
        "branch_id": attendance.branch_id,
        "branch_name": attendance.branch.name if attendance.branch else "Unknown",
        "attendance_date": attendance.date.isoformat() if attendance.date else None,
        "check_in_time": to_iso_string(attendance.check_in_time),
        "check_out_time": to_iso_string(attendance.check_out_time),
        "duration_minutes": _calculate_duration_minutes(
            attendance.check_in_time,
            attendance.check_out_time,
            attendance.status,
        ),
        "attendance_status": attendance.status.value if attendance.status else None,
        "checkout_source": attendance.checkout_source.value if attendance.checkout_source else None,
        "business_day_id": None,
    }


def _calculate_duration_minutes(
    check_in_time: Optional[datetime],
    check_out_time: Optional[datetime],
    status: Optional[AttendanceStatus],
) -> int:
    if check_in_time is None:
        return 0

    if check_out_time is None and status == AttendanceStatus.PRESENT:
        end_time = get_utc_now()
    else:
        end_time = check_out_time

    if end_time is None:
        return 0

    delta_seconds = (_ensure_utc(end_time) - _ensure_utc(check_in_time)).total_seconds()
    return max(0, int(delta_seconds // 60))


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _to_cairo_time(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return _ensure_utc(value).astimezone(CAIRO_TZ)


def _format_business_day_label(opened_at_local: Optional[datetime]) -> Optional[str]:
    if opened_at_local is None:
        return None

    weekday_label = ARABIC_WEEKDAY_NAMES.get(opened_at_local.weekday(), "")
    return f"{weekday_label} {opened_at_local.date().isoformat()}".strip()
