"""Staff identity metadata only. No password, session, device or financial flow."""
import re
from flask import current_app
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound
from app.extensions import db
from app.models.user import User, UserRole
from app.models.employee import Employee, EmployeeStatus
from app.models.branch import Branch
from app.models.staff_identity_event import StaffIdentityEvent

MANAGERS = {UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN}
UNINITIALIZED_PASSWORD = '!staff-password-not-initialized'


def require_staff_identity_enabled():
    if (current_app.config.get('STAFF_IDENTITY_ENABLED') is not True or
            current_app.config.get('STAFF_IDENTITY_OMAR_RUNTIME') is not True):
        raise NotFound()


def authorize(actor):
    require_staff_identity_enabled()
    if not actor or not actor.is_active or actor.role not in MANAGERS:
        raise Forbidden('Staff identity administration requires SUPER_ADMIN or EXEC_ADMIN.')


def staff_safe_identity(user):
    """Explicit allowlist, intentionally independent of Employee.to_dict()."""
    if user.role != UserRole.EMPLOYEE or user.employee_id is None:
        raise Conflict('Not a linked Staff identity.')
    employee = user.employee
    return {
        'user_id': user.id, 'employee_id': employee.id, 'username': user.email,
        'full_name': employee.full_name, 'employee_type': employee.employee_type.value,
        'branch_id': employee.branch_id, 'is_active': user.is_active,
        'staff_auth_version': user.staff_auth_version,
        'employee_eligible': bool(employee.is_active and not employee.is_deleted and
                                  employee.status == EmployeeStatus.ACTIVE),
    }


def _employee(employee_id, lock=False):
    query = Employee.query.filter_by(id=employee_id)
    employee = (query.with_for_update() if lock else query).first()
    if employee is None:
        raise NotFound('Employee not found.')
    return employee


def _eligible(employee):
    branch = db.session.get(Branch, employee.branch_id)
    if (not employee.is_active or employee.is_deleted or employee.status != EmployeeStatus.ACTIVE
            or not branch or not branch.is_active or branch.is_main_warehouse):
        raise Conflict('Employee is not eligible for an active Staff identity.')


def _event(user, actor, action):
    db.session.add(StaffIdentityEvent(user_id=user.id, employee_id=user.employee_id,
        actor_id=actor.id, action=action, auth_version=user.staff_auth_version))


def read_identity(actor, employee_id):
    authorize(actor)
    _employee(employee_id)
    user = User.query.filter_by(employee_id=employee_id).first()
    return staff_safe_identity(user) if user else None


def change_identity(actor, employee_id, operation, payload):
    authorize(actor)
    if not isinstance(payload, dict):
        raise BadRequest('Expected a JSON object.')
    allowed = {'create': {'username'}, 'link': {'user_id'}, 'state': {'is_active', 'expected_version'}}
    if operation not in allowed or set(payload) != allowed[operation]:
        raise BadRequest('Unexpected or missing identity fields.')
    try:
        employee = _employee(employee_id, lock=True)
        user = User.query.filter_by(employee_id=employee_id).with_for_update().first()
        if operation in ('create', 'link'):
            if user:
                raise Conflict('Employee already has a Staff identity.')
            if operation == 'create':
                username = payload['username']
                if not isinstance(username, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{2,63}', username):
                    raise BadRequest('Username must be 3–64 ASCII letters, digits, dots, underscores or hyphens.')
                username = username.lower()
                if User.query.filter(func.lower(User.email) == username).first():
                    raise Conflict('Username already exists.')
                user = User(full_name=employee.full_name, email=username, role=UserRole.EMPLOYEE,
                    employee_id=employee.id, branch_id=employee.branch_id, is_active=False,
                    password_hash=UNINITIALIZED_PASSWORD, staff_auth_version=1)
                db.session.add(user)
                db.session.flush()
            else:
                user_id = payload['user_id']
                if type(user_id) is not int or user_id <= 0:
                    raise BadRequest('user_id must be a positive integer.')
                user = User.query.filter_by(id=user_id).with_for_update().first()
                if not user:
                    raise NotFound('User not found.')
                if user.role != UserRole.EMPLOYEE or user.employee_id is not None or user.is_active:
                    raise Conflict('Only an inactive, unlinked EMPLOYEE account may be linked.')
                if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{2,63}', user.email):
                    raise Conflict('Existing account does not have an eligible Staff username.')
                user.employee_id = employee.id
                user.staff_auth_version += 1
            _event(user, actor, operation)
        else:
            if user is None:
                raise NotFound('Staff identity not found.')
            if type(payload['is_active']) is not bool or type(payload['expected_version']) is not int:
                raise BadRequest('is_active must be boolean and expected_version integer.')
            if payload['expected_version'] != user.staff_auth_version:
                raise Conflict('Identity changed; reload before retrying.')
            if payload['is_active']:
                _eligible(employee)
            if user.is_active != payload['is_active']:
                user.is_active = payload['is_active']
                user.staff_auth_version += 1
                _event(user, actor, 'activate' if user.is_active else 'deactivate')
        db.session.flush()
        result = staff_safe_identity(user)
        db.session.commit()
        return result
    except IntegrityError:
        db.session.rollback()
        raise Conflict('Username or employee identity already exists.') from None
    except Exception:
        db.session.rollback()
        raise
