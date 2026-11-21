"""Prepare only synthetic QA geofence/planning with explicit owner approval."""
import argparse
import json
import secrets
from datetime import timedelta
import runtime


def prepare(approved):
    if not approved:raise RuntimeError('Explicit owner approval required for test parameters')
    cfg=runtime.load();app=runtime.factory(cfg)
    from app.extensions import db
    from app.models.user import User
    from app.models.employee import Employee
    from app.models.employee_shift import EmployeeShiftTemplate as Template, EmployeeWeeklyShift as Weekly
    from app.services import staff_geofence_service as geo, employee_shift_service as shifts
    from app.services.staff_identity_service import change_identity
    accounts=json.loads((runtime.PRIVATE/'accounts.json').read_text())
    with app.app_context():
        manager=User.query.filter_by(email=accounts['manager']['username']).one()
        browser=next(a for a in accounts['staff'] if a['purpose']=='browser')
        employee=db.session.get(Employee,browser['employee_id'])
        if employee.full_name!='Synthetic Staff QA browser':raise RuntimeError('Wrong synthetic employee')
        expected=dict(latitude=30.032083486995774,longitude=30.987334731699523,radius_m=100.,max_accuracy_m=25.,max_age_seconds=30,enabled=True)
        previous=geo.current(employee.branch_id)
        if previous and all(getattr(previous,k)==v for k,v in expected.items()):geofence=geo.serialize(previous)
        else:
            geofence=geo.configure(manager,employee.branch_id,dict(expected_version=previous.version if previous else 0,
                **expected,reason='TEST ONLY: owner approved 100m/25m/30s for field calibration; not production policy'))
        # Respect the existing rule: assignment edits must start AFTER today's Cairo date.
        today=shifts.today();tomorrow=today+timedelta(days=1)
        template=Template.query.filter_by(branch_id=employee.branch_id,name='SYNTHETIC QA ONLY 12:00-20:00').first()
        if not template:
            result=shifts.create_template(manager,dict(branch_id=employee.branch_id,name='SYNTHETIC QA ONLY 12:00-20:00',start_time='12:00',end_time='20:00',grace_minutes=0))
            template=db.session.get(Template,result['id'])
        if not Weekly.query.filter_by(employee_id=employee.id,effective_from=tomorrow).first():
            shifts.plan(manager,employee.id,'weekly',dict(template_id=template.id,weekday=tomorrow.weekday(),effective_from=tomorrow.isoformat(),effective_to=tomorrow.isoformat()))
        frozen=shifts.freeze(manager,employee.id,today,today)[0]
        if frozen['state']!='UNASSIGNED':raise RuntimeError('Unexpected current-day fixture; no assignment will be overwritten')
        # Dedicated API probe; never enroll or consume the owner's browser identity.
        probe=next((a for a in accounts['staff'] if a['purpose']=='field_probe'),None)
        if not probe:
            probe_employee=Employee(full_name='Synthetic Staff QA field probe',employee_type=employee.employee_type,branch_id=employee.branch_id)
            db.session.add(probe_employee);db.session.commit()
            result=change_identity(manager,probe_employee.id,'create',{'username':'staff_qa_field_probe'})
            change_identity(manager,probe_employee.id,'state',{'is_active':True,'expected_version':1})
            probe=dict(purpose='field_probe',employee_id=probe_employee.id,user_id=result['user_id'],username='staff_qa_field_probe',password=secrets.token_urlsafe(24))
            accounts['staff'].append(probe);runtime.write_json(runtime.PRIVATE/'accounts.json',accounts)
        runtime.write_json(runtime.PRIVATE/'field-configuration.json',dict(owner_approved=True,scope='ISOLATED TEST ONLY',geofence=geofence,
            browser_employee_id=employee.id,current_shift=frozen,next_day_shift=dict(date=tomorrow.isoformat(),template=template.name),
            physical_GPS_acceptance='UNVERIFIED'))
    print('Owner-approved test geofence active: 100m / 25m / 30s. Current day frozen UNASSIGNED; fictional assigned shift prepared for tomorrow.')


def results():
    cfg=runtime.load()
    from sqlalchemy import text
    accounts=json.loads((runtime.PRIVATE/'accounts.json').read_text())
    account=next(a for a in accounts['staff'] if a['purpose']=='browser')
    engine=runtime.engine(cfg)
    with engine.connect() as c:
        c.execute(text('SET TRANSACTION READ ONLY'));runtime.identity(c,cfg)
        rows=c.execute(text("SELECT id,date,check_in_time,check_out_time,status,attendance_origin,checkout_verification FROM attendances WHERE employee_id=:id ORDER BY id"),{'id':account['employee_id']}).mappings().all()
        print(json.dumps({'scope':'ISOLATED SYNTHETIC EMPLOYEE ONLY','employee_id':account['employee_id'],
            'revision':c.execute(text('SELECT version_num FROM alembic_version')).scalar(),
            'attendance':[dict(row) for row in rows]},default=str,indent=2))
    engine.dispose()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['prepare','results']);parser.add_argument('--owner-approved-test-parameters',action='store_true');args=parser.parse_args()
    if args.action=='prepare':prepare(args.owner_approved_test_parameters)
    else:results()
