"""Omar-only scheduling. No attendance, payroll or POS shift operations."""
from flask import Blueprint, jsonify, request, g
from werkzeug.exceptions import HTTPException, BadRequest
from app.extensions import db
from app.utils.admin_auth import require_admin, require_role
from app.services import employee_shift_service as shifts
from app.models.employee_shift import EmployeeShiftTemplate as Template

admin_employee_shifts_bp=Blueprint('admin_employee_shifts',__name__,url_prefix='/api/admin')


@admin_employee_shifts_bp.before_request
def guard():
    shifts.require_staff_identity_enabled()


@admin_employee_shifts_bp.after_request
def private(response):
    response.headers['Cache-Control']='no-store'
    return response


@admin_employee_shifts_bp.errorhandler(HTTPException)
def error(exc):
    db.session.rollback()
    return jsonify({'error':exc.name,'message':exc.description}),exc.code


@admin_employee_shifts_bp.route('/employee-shifts/templates',methods=['GET','POST'])
@require_admin
@require_role(*shifts.ROLES)
def templates():
    if request.method=='POST':
        return jsonify(shifts.create_template(g.current_user,request.get_json())),201
    if set(request.args)!={'branch_id'}:
        raise BadRequest('Expected branch_id only.')
    try:
        branch_id=int(request.args['branch_id'])
    except ValueError:
        raise BadRequest('Invalid branch ID.') from None
    shifts.authorize(g.current_user,branch_id)
    return jsonify({'templates':[shifts.template_data(t) for t in Template.query.filter_by(branch_id=branch_id).order_by(Template.id).all()]})


@admin_employee_shifts_bp.route('/employee-shifts/templates/<int:template_id>',methods=['PATCH'])
@require_admin
@require_role(*shifts.ROLES)
def template_state(template_id):
    data=request.get_json();shifts.fields(data,('is_active',))
    if type(data['is_active']) is not bool:
        raise BadRequest('Expected boolean is_active.')
    item=Template.query.filter_by(id=template_id).with_for_update().first_or_404()
    shifts.authorize(g.current_user,item.branch_id)
    item.is_active=data['is_active'];db.session.commit()
    return jsonify(shifts.template_data(item))


@admin_employee_shifts_bp.route('/employees/<int:employee_id>/shift-schedules',methods=['POST'])
@require_admin
@require_role(*shifts.ROLES)
def schedule(employee_id):
    return jsonify(shifts.plan(g.current_user,employee_id,'weekly',request.get_json())),201


@admin_employee_shifts_bp.route('/employees/<int:employee_id>/shift-overrides',methods=['POST'])
@require_admin
@require_role(*shifts.ROLES)
def override(employee_id):
    return jsonify(shifts.plan(g.current_user,employee_id,'override',request.get_json())),201


@admin_employee_shifts_bp.route('/employees/<int:employee_id>/shifts',methods=['GET'])
@require_admin
@require_role(*shifts.ROLES)
def read(employee_id):
    if set(request.args)!={'from','to'}:
        raise BadRequest('Expected from/to only.')
    start,end=shifts.period(request.args['from'],request.args['to'],31)
    item=shifts.employee(g.current_user,employee_id)
    result=shifts.read_shifts(item,start,end)
    if g.current_user.role.name=='BRANCH_MANAGER' and any(row['branch_id']!=g.current_user.branch_id for row in result):
        from werkzeug.exceptions import Forbidden
        raise Forbidden('Historical shift belongs to another branch.')
    return jsonify({'shifts':result})


@admin_employee_shifts_bp.route('/employees/<int:employee_id>/shift-instances',methods=['POST'])
@require_admin
@require_role(*shifts.ROLES)
def freeze(employee_id):
    data=request.get_json();shifts.fields(data,('from','to'))
    start,end=shifts.period(data['from'],data['to'],31)
    return jsonify({'shifts':shifts.freeze(g.current_user,employee_id,start,end)})


@admin_employee_shifts_bp.route('/employees/<int:employee_id>/shift-schedules/<int:row_id>',methods=['PATCH'])
@require_admin
@require_role(*shifts.ROLES)
def edit_schedule(employee_id,row_id):
    return jsonify(shifts.edit_plan(g.current_user,employee_id,'weekly',row_id,request.get_json()))


@admin_employee_shifts_bp.route('/employees/<int:employee_id>/shift-overrides/<int:row_id>',methods=['PATCH'])
@require_admin
@require_role(*shifts.ROLES)
def edit_override(employee_id,row_id):
    return jsonify(shifts.edit_plan(g.current_user,employee_id,'override',row_id,request.get_json()))


@admin_employee_shifts_bp.route('/employees/<int:employee_id>/shift-plans',methods=['GET'])
@require_admin
@require_role(*shifts.ROLES)
def plans(employee_id):
    from app.models.employee_shift import EmployeeWeeklyShift as Weekly,EmployeeShiftOverride as Override
    if set(request.args)!={'from','to'}:raise BadRequest('Expected from/to only.')
    start,end=shifts.period(request.args['from'],request.args['to'])
    item=shifts.employee(g.current_user,employee_id)
    weekly=Weekly.query.filter(Weekly.employee_id==item.id,Weekly.effective_from<=end,Weekly.effective_to>=start).order_by(Weekly.id).all()
    overrides=Override.query.filter(Override.employee_id==item.id,Override.shift_date.between(start,end)).order_by(Override.id).all()
    result=[]
    for kind,rows in [('weekly',weekly),('override',overrides)]:
        for row in rows:
            branch_id=db.session.get(Template,row.template_id).branch_id if kind=='weekly' else row.branch_id
            if g.current_user.role.name=='BRANCH_MANAGER' and branch_id!=g.current_user.branch_id:continue
            data={'kind':kind,'id':row.id,'version':row.version,'template_id':row.template_id,'supersedes_id':row.supersedes_id,'retired_from':row.retired_from.isoformat() if row.retired_from else None}
            data.update({'weekday':row.weekday,'effective_from':row.effective_from.isoformat(),'effective_to':row.effective_to.isoformat()} if kind=='weekly' else {'shift_date':row.shift_date.isoformat(),'is_rest':row.is_rest})
            result.append(data)
    return jsonify({'plans':result})
