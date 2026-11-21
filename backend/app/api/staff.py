"""Staff authentication surface, disabled by default and operationally device-gated."""
from flask import Blueprint, jsonify, request, g
from werkzeug.exceptions import BadRequest, HTTPException
from app.extensions import db
from app.services.staff_identity_service import require_staff_identity_enabled, staff_safe_identity
from app.services import staff_auth_service as auth

staff_bp=Blueprint('staff',__name__,url_prefix='/api/staff')


@staff_bp.before_request
def guard():
    require_staff_identity_enabled()


@staff_bp.after_request
def no_cache(response):
    response.headers['Cache-Control']='no-store'
    response.headers['Pragma']='no-cache'
    response.headers['Referrer-Policy']='no-referrer'
    return response


@staff_bp.errorhandler(HTTPException)
def auth_error(error):
    db.session.rollback()
    response=jsonify({'error':error.name,'message':error.description})
    response.status_code=error.code
    if error.code==429:response.headers['Retry-After']='900'
    return response


def body(fields):
    data=request.get_json()
    if not isinstance(data,dict) or set(data)!=set(fields):raise BadRequest('Unexpected or missing fields.')
    return data


@staff_bp.route('/auth/activate',methods=['POST'])
def activate():
    data=body(['username','code','password'])
    enrollment=auth.consume_code(data['username'],data['code'],data['password'],'activation')
    return jsonify({'success':True,**enrollment})


@staff_bp.route('/auth/recover',methods=['POST'])
def recover():
    data=body(['username','code','password'])
    enrollment=auth.consume_code(data['username'],data['code'],data['password'],'recovery')
    response=jsonify({'success':True,**enrollment});auth.clear_cookies(response);return response


def token_response(tokens):
    response=jsonify({'access_token':tokens['access_token'],'expires_in':tokens['expires_in'],'csrf':tokens['csrf']})
    auth.set_cookies(response,tokens)
    return response


@staff_bp.route('/auth/login',methods=['POST'])
def login():
    data=body(['username','password'])
    return token_response(auth.login(data['username'],data['password']))


@staff_bp.route('/auth/refresh',methods=['POST'])
def refresh():
    return token_response(auth.refresh())


@staff_bp.route('/auth/logout',methods=['POST'])
def logout():
    auth.logout()
    response=jsonify({'success':True});auth.clear_cookies(response);return response


@staff_bp.route('/me',methods=['GET'])
@auth.require_staff
def me():
    return jsonify({'identity':staff_safe_identity(g.staff_user)})


@staff_bp.route('/device-enrollments',methods=['POST'])
def enroll_device():
    from app.services.staff_device_service import enroll
    data=body(['enrollment_grant','public_jwk'])
    return jsonify(enroll(data['enrollment_grant'],data['public_jwk'])),201


@staff_bp.route('/auth/device-challenges',methods=['POST'])
def device_challenge():
    from app.services.staff_device_service import challenge
    data=body(['device_id','purpose','method','target','body_hash'])
    return jsonify(challenge(data['device_id'],data['purpose'],data['method'],data['target'],data['body_hash']))


@staff_bp.route('/device-enrollments/<device_id>/finalize',methods=['POST'])
def finalize_device(device_id):
    from app.services.staff_device_service import finalize
    body([])
    return jsonify(finalize(device_id))


@staff_bp.route('/shifts',methods=['GET'])
@auth.require_staff
def own_shifts():
    from app.services import employee_shift_service as shifts
    from app.models.employee import Employee
    if set(request.args)!={'from','to'}:
        raise BadRequest('Expected from/to only; employee identity is session-bound.')
    start,end=shifts.period(request.args['from'],request.args['to'],31)
    employee=db.session.get(Employee,g.staff_user.employee_id)
    return jsonify({'shifts':shifts.read_shifts(employee,start,end)})


@staff_bp.route('/attendance/check-in',methods=['POST'])
@auth.require_staff
def attendance_check_in():
    from app.services.staff_attendance_service import record
    return jsonify(record('CHECK_IN', body(['idempotency_key','location'])))


@staff_bp.route('/attendance/check-out',methods=['POST'])
@auth.require_staff
def attendance_check_out():
    from app.services.staff_attendance_service import record
    return jsonify(record('CHECK_OUT', body(['idempotency_key','location','attendance_id'])))


@staff_bp.route('/attendance/current',methods=['GET'])
@auth.require_staff
def attendance_current():
    from app.services.staff_attendance_service import current
    return jsonify(current())
