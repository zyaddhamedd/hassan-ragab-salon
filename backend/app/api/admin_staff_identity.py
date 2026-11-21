"""Omar-only identity administration. Staff authentication is a separate, device-gated blueprint."""
from flask import Blueprint, jsonify, request, g
from app.utils.admin_auth import require_admin, require_role
from app.models.user import UserRole
from app.services.staff_identity_service import (
    require_staff_identity_enabled, read_identity, change_identity,
)

admin_staff_identity_bp = Blueprint('admin_staff_identity', __name__, url_prefix='/api/admin')


@admin_staff_identity_bp.before_request
def feature_guard():
    require_staff_identity_enabled()


@admin_staff_identity_bp.errorhandler(400)
@admin_staff_identity_bp.errorhandler(403)
@admin_staff_identity_bp.errorhandler(404)
@admin_staff_identity_bp.errorhandler(409)
@admin_staff_identity_bp.errorhandler(429)
def identity_error(error):
    from app.extensions import db
    db.session.rollback()
    return jsonify({'error': error.name, 'message': error.description}), error.code


@admin_staff_identity_bp.route('/employees/<int:employee_id>/staff-identity', methods=['GET', 'POST', 'PATCH'])
@require_admin
@require_role(UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN)
def identity(employee_id):
    if request.method == 'GET':
        return jsonify({'identity': read_identity(g.current_user, employee_id)})
    operation = 'create' if request.method == 'POST' else 'state'
    result = change_identity(g.current_user, employee_id, operation, request.get_json())
    return jsonify({'identity': result}), 201 if operation == 'create' else 200


@admin_staff_identity_bp.route('/employees/<int:employee_id>/staff-identity/link', methods=['POST'])
@require_admin
@require_role(UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN)
def link_identity(employee_id):
    return jsonify({'identity': change_identity(g.current_user, employee_id, 'link', request.get_json())})


@admin_staff_identity_bp.after_request
def private_identity_response(response):
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@admin_staff_identity_bp.route('/employees/<int:employee_id>/staff-identity/codes', methods=['POST'])
@require_admin
@require_role(UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN)
def issue_identity_code(employee_id):
    from werkzeug.exceptions import BadRequest
    from app.services.staff_auth_service import issue_code
    data = request.get_json()
    if not isinstance(data, dict) or set(data) != {'purpose'}:
        raise BadRequest('Expected code purpose only.')
    return jsonify(issue_code(g.current_user, employee_id, data['purpose'])), 201


@admin_staff_identity_bp.route('/employees/<int:employee_id>/staff-identity/revoke-sessions', methods=['POST'])
@require_admin
@require_role(UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN)
def revoke_identity_sessions(employee_id):
    from werkzeug.exceptions import BadRequest
    from app.services.staff_auth_service import revoke_sessions
    if request.get_json() != {}:
        raise BadRequest('Expected an empty object.')
    revoke_sessions(g.current_user, employee_id)
    return jsonify({'success': True})


@admin_staff_identity_bp.before_app_request
def protect_staff_from_legacy_user_mutations():
    # Legacy password edits do not revoke Staff sessions. Keep Staff changes on
    # the dedicated audited path, even while the Staff feature is temporarily off.
    from flask import current_app
    if (current_app.config.get('STAFF_IDENTITY_OMAR_RUNTIME') is not True or
            request.endpoint not in {'admin.update_user', 'admin.delete_user'}):
        return None

    @require_admin
    @require_role(UserRole.SUPER_ADMIN)
    def check_target():
        from app.extensions import db
        from app.models.user import User
        target = db.session.get(User, (request.view_args or {}).get('user_id'))
        if target and target.role == UserRole.EMPLOYEE:
            return jsonify({'error': 'Conflict', 'message': 'Use dedicated Staff identity administration.'}), 409
        return None
    return check_target()


@admin_staff_identity_bp.route('/employees/<int:employee_id>/staff-devices',methods=['GET'])
@require_admin
@require_role(UserRole.SUPER_ADMIN,UserRole.EXEC_ADMIN)
def staff_devices(employee_id):
    from app.services.staff_device_service import list_devices
    return jsonify({'devices':list_devices(g.current_user,employee_id)})


@admin_staff_identity_bp.route('/employees/<int:employee_id>/staff-devices/<device_id>/<action>',methods=['POST'])
@require_admin
@require_role(UserRole.SUPER_ADMIN,UserRole.EXEC_ADMIN)
def staff_device_decision(employee_id,device_id,action):
    from werkzeug.exceptions import BadRequest
    from app.services.staff_device_service import decide
    fields={'reason','replace_device_id'} if action=='approve' else {'reason'}
    data=request.get_json()
    if action not in ('approve','revoke') or not isinstance(data,dict) or set(data)!=fields:raise BadRequest('Invalid device decision.')
    return jsonify(decide(g.current_user,employee_id,device_id,action,data['reason'],data.get('replace_device_id')))
