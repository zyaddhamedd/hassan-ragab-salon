"""Sensitive Omar-only site configuration; no employee GPS endpoint."""
from flask import Blueprint,jsonify,request,g
from werkzeug.exceptions import HTTPException
from app.extensions import db
from app.utils.admin_auth import require_admin,require_role
from app.models.user import UserRole
from app.services.staff_identity_service import require_staff_identity_enabled
from app.services.staff_geofence_service import read_configuration,configure

admin_staff_geofence_bp=Blueprint('admin_staff_geofence',__name__,url_prefix='/api/admin')


@admin_staff_geofence_bp.before_request
def guard():require_staff_identity_enabled()


@admin_staff_geofence_bp.after_request
def private(response):
    response.headers['Cache-Control']='no-store'
    return response


@admin_staff_geofence_bp.errorhandler(HTTPException)
def error(exc):
    db.session.rollback()
    return jsonify({'error':exc.name,'message':exc.description}),exc.code


@admin_staff_geofence_bp.route('/branches/<int:branch_id>/staff-geofence',methods=['GET','POST'])
@require_admin
@require_role(UserRole.SUPER_ADMIN,UserRole.EXEC_ADMIN)
def geofence(branch_id):
    if request.method=='GET':return jsonify(read_configuration(g.current_user,branch_id))
    return jsonify({'configuration':configure(g.current_user,branch_id,request.get_json())}),201
