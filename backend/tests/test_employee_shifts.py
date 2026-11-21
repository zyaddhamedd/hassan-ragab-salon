"""Offline scheduling, safe auth and PostgreSQL DDL contract tests. No live DB."""
import sys
from pathlib import Path
import importlib.util
from io import StringIO
from datetime import date, timedelta
from unittest import TestCase, mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import test_staff_identity as identity_tests
from app.extensions import db
from app.models.user import User, UserRole
from app.models.branch import Branch
from app.models.employee_shift import EmployeeShiftTemplate as Template, EmployeeWeeklyShift as Weekly, EmployeeShiftOverride as Override, EmployeeShiftInstance as Instance, EmployeeShiftChange as Change
from app.services import employee_shift_service as shifts
from app.api.admin_employee_shifts import admin_employee_shifts_bp
from werkzeug.exceptions import Conflict, Forbidden, BadRequest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable
from alembic.operations import Operations
from alembic.migration import MigrationContext


class EmployeeShiftTests(TestCase):
    token=identity_tests.StaffIdentityTests.token
    def setUp(self):
        identity_tests.StaffIdentityTests.setUp(self)
        self.app.register_blueprint(admin_employee_shifts_bp)
        db.metadata.create_all(db.engine,tables=[Template.__table__,Weekly.__table__,Override.__table__,Instance.__table__,Change.__table__])
        self.patch=mock.patch.object(shifts,'today',return_value=date(2026,1,1));self.patch.start();self.addCleanup(self.patch.stop)
        self.start=date(2026,11,2)  # Monday.

    def template(self,start='12:00',end='21:00',grace=10):
        return shifts.create_template(self.manager,dict(branch_id=self.branch.id,name='Offline shift',start_time=start,end_time=end,grace_minutes=grace))['id']

    def weekly(self,template,weekday=0,start='2026-11-02',end='2026-11-30'):
        return shifts.plan(self.manager,self.employee.id,'weekly',dict(template_id=template,weekday=weekday,effective_from=start,effective_to=end))

    def override(self,d,template=None,rest=False):
        return shifts.plan(self.manager,self.employee.id,'override',dict(shift_date=d,is_rest=rest,template_id=template))

    def test_recurrence_effective_dates_and_no_implicit_writes(self):
        self.weekly(self.template())
        result=shifts.read_shifts(self.employee,self.start,self.start+timedelta(days=7))
        self.assertEqual([i['state'] for i in result],['SCHEDULED']+['UNASSIGNED']*6+['SCHEDULED'])
        self.assertFalse(any(r['frozen'] for r in result));self.assertEqual(Instance.query.count(),0)
        self.assertEqual(shifts.expectation(self.employee,date(2026,12,7)).state,'UNASSIGNED')

    def test_override_precedence_and_rest_are_explicit(self):
        self.weekly(self.template());alternate=self.template('14:00','22:00')
        self.override('2026-11-02',alternate);self.override('2026-11-09',rest=True)
        expected=shifts.expectation(self.employee,self.start)
        self.assertEqual(expected.source,'OVERRIDE');self.assertEqual(expected.start_at.astimezone(shifts.CAIRO).hour,14)
        rest=shifts.expectation(self.employee,date(2026,11,9));self.assertEqual(rest.state,'REST');self.assertIsNone(rest.start_at)
        with self.assertRaises(Conflict):self.override('2026-11-09',rest=True)

    def test_overnight_and_cairo_dst_elapsed_time(self):
        t=self.template('22:00','02:00')
        self.weekly(t,3,'2026-10-29','2026-10-29')
        self.weekly(t,3,'2026-04-23','2026-04-23')
        autumn=shifts.expectation(self.employee,date(2026,10,29));spring=shifts.expectation(self.employee,date(2026,4,23))
        self.assertEqual(autumn.end_at-autumn.start_at,timedelta(hours=5))
        self.assertEqual(spring.end_at-spring.start_at,timedelta(hours=3))
        self.assertEqual(autumn.end_at.astimezone(shifts.CAIRO).date(),date(2026,10,30))

    def test_nonexistent_dst_time_rejected_and_fold_is_deterministic(self):
        with self.assertRaises(Conflict):self.weekly(self.template('00:30','06:00'),4,'2026-04-24','2026-04-24')
        self.assertEqual(Weekly.query.count(),0)
        value=shifts.utc_local(date(2026,10,29),shifts.clock('23:30'))
        self.assertEqual(value.hour,20)  # First occurrence, UTC+3.

    def test_same_weekday_period_overlap_rejected_and_adjacent_periods_allowed(self):
        t=self.template();self.weekly(t)
        with self.assertRaises(Conflict):self.weekly(t,start='2026-11-09')
        self.weekly(t,start='2026-12-01',end='2026-12-31');self.assertEqual(Weekly.query.count(),2)

    def test_cross_midnight_overlap_and_touching_boundary(self):
        self.weekly(self.template('22:00','03:00'))
        with self.assertRaises(Conflict):self.weekly(self.template('02:00','08:00'),1)
        self.weekly(self.template('03:00','08:00'),1);self.assertEqual(Weekly.query.count(),2)

    def test_override_cannot_overlap_previous_overnight_and_rest_can_remove_it(self):
        self.weekly(self.template('22:00','03:00'))
        with self.assertRaises(Conflict):self.override('2026-11-03',self.template('01:00','07:00'))
        self.override('2026-11-02',rest=True)
        self.override('2026-11-03',self.template('01:00','07:00'))

    def test_frozen_history_stability_idempotency_and_inactive_templates(self):
        t=self.template();self.weekly(t)
        first=shifts.freeze(self.manager,self.employee.id,self.start,self.start+timedelta(days=1))
        self.assertTrue(all(r['frozen'] for r in first));self.assertEqual(Instance.query.count(),2)
        second=shifts.freeze(self.manager,self.employee.id,self.start,self.start+timedelta(days=1));self.assertEqual(first,second)
        db.session.get(Template,t).is_active=False;db.session.commit()
        self.assertEqual(first,shifts.read_shifts(self.employee,self.start,self.start+timedelta(days=1)))
        with self.assertRaises(Conflict):self.override('2026-11-02',rest=True)
        with self.assertRaises(Conflict):self.override('2026-11-04',t)
        with self.assertRaises(Conflict):self.weekly(t,1)

    def test_past_changes_and_malformed_inputs_rejected(self):
        t=self.template()
        for d in ['2025-12-31','2026-01-01']:
            with self.assertRaises(Conflict):self.override(d,t)
        for value in ['20261102','2026-02-30',1]:
            with self.assertRaises(BadRequest):shifts.day(value)
        with self.assertRaises(BadRequest):self.template('12:00','12:00')
        with self.assertRaises(BadRequest):self.template(grace=True)
        with self.assertRaises(BadRequest):shifts.period('2026-01-01','2028-01-01')

    def test_roles_branch_isolation_and_feature_disabled(self):
        other=Branch(name='Other offline branch',city='Giza');db.session.add(other);db.session.flush()
        actor=User(full_name='Offline manager',email='offline-branch',password_hash='!',role=UserRole.BRANCH_MANAGER,branch_id=other.id,is_active=True);db.session.add(actor);db.session.commit()
        with self.assertRaises(Forbidden):shifts.employee(actor,self.employee.id)
        with self.assertRaises(Forbidden):shifts.create_template(actor,dict(branch_id=self.branch.id,name='x',start_time='12:00',end_time='21:00',grace_minutes=0))
        response=self.client.get('/api/admin/employees/1/shifts?from=2026-11-02&to=2026-11-02',headers={'Authorization':'Bearer '+self.token()});self.assertEqual(response.status_code,200)
        self.app.config['STAFF_IDENTITY_ENABLED']=False
        self.assertEqual(self.client.get('/api/admin/employee-shifts/templates?branch_id=1').status_code,404)
        self.assertEqual(Template.query.count(),0)

    def test_manager_api_contract_and_template_edits_restricted(self):
        token={'Authorization':'Bearer '+self.token()}
        t=self.template()
        response=self.client.patch(f'/api/admin/employee-shifts/templates/{t}',json={'start_time':'15:00'},headers=token)
        self.assertEqual(response.status_code,400)
        response=self.client.post(f'/api/admin/employees/{self.employee.id}/shift-overrides',json={'shift_date':'2026-11-02','template_id':t,'is_rest':False},headers=token)
        self.assertEqual(response.status_code,201)
        response=self.client.get(f'/api/admin/employees/{self.employee.id}/shifts?from=2026-11-02&to=2026-11-02',headers=token)
        self.assertEqual(response.status_code,200);self.assertNotIn('salary',str(response.json));self.assertFalse(response.json['shifts'][0]['frozen'])

    def test_postgres_constraints_locks_and_migration_sql(self):
        sql='\n'.join(str(CreateTable(m.__table__).compile(dialect=postgresql.dialect())) for m in [Template,Weekly,Override,Instance])
        self.assertIn('ex_employee_weekly_period EXCLUDE USING gist',sql)
        self.assertIn('ex_employee_instance_overlap EXCLUDE USING gist',sql)
        self.assertIn("tstzrange(start_at, end_at, '[)')",sql)
        self.assertIn('uq_employee_shift_instance',sql)
        self.assertIn('FOR UPDATE',str(db.select(User).with_for_update().compile(dialect=postgresql.dialect())))
        path=Path(__file__).resolve().parents[1]/'migrations/versions/zv_employee_shift_planning.py'
        spec=importlib.util.spec_from_file_location('shift_revision',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        output=StringIO()
        with Operations.context(MigrationContext.configure(url='postgresql://',opts={'as_sql':True,'output_buffer':output})):
            module.upgrade()
        ddl=output.getvalue();self.assertIn('CREATE TRIGGER immutable_employee_shift',ddl)
        self.assertNotIn('CREATE EXTENSION',ddl);self.assertNotIn('INSERT INTO',ddl)
        self.assertNotIn('cashier_shifts',ddl.lower())

    def test_duplicate_instance_database_constraint(self):
        self.weekly(self.template());shifts.freeze(self.manager,self.employee.id,self.start,self.start)
        original=Instance.query.one()
        row=Instance(employee_id=original.employee_id,shift_date=original.shift_date,branch_id=original.branch_id,state='UNASSIGNED',source='NONE',grace_minutes=0,created_by=self.manager.id)
        db.session.add(row)
        with self.assertRaises(IntegrityError):db.session.flush()
        db.session.rollback()


class EmployeeShiftStaffAccessTests(TestCase):
    def setUp(self):
        import test_staff_auth as base
        base.StaffAuthTests.setUp(self)
        db.metadata.create_all(db.engine,tables=[Template.__table__,Weekly.__table__,Override.__table__,Instance.__table__,Change.__table__])

    def test_signed_own_read_only_contract_and_cross_employee_rejection(self):
        import staff_device_support as devices
        from test_staff_auth import ORIGIN
        self.activate();access=self.login().json['access_token']
        target='/api/staff/shifts?from=2026-11-02&to=2026-11-03'
        response=devices.proof_request(self.client,ORIGIN,self.binding_fixture(),'request','GET',target,headers={'Authorization':'Bearer '+access})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual([r['state'] for r in response.json['shifts']],['UNASSIGNED','UNASSIGNED'])
        self.assertEqual(Instance.query.count(),0)
        self.assertFalse(any(k in str(response.json) for k in ['salary','commission','settlement']))
        response=devices.proof_request(self.client,ORIGIN,self.binding_fixture(),'request','GET',target+'&employee_id=2',headers={'Authorization':'Bearer '+access})
        self.assertEqual(response.status_code,400)
        self.assertEqual(self.client.get(target,base_url=ORIGIN,headers={'Origin':ORIGIN,'Authorization':'Bearer '+access}).status_code,403)

    def test_admin_and_mini_tokens_cannot_read_staff_shifts_or_device_challenge(self):
        from test_staff_auth import ORIGIN
        from app.services.staff_device_service import _target
        target='/api/staff/shifts?from=2026-11-02&to=2026-11-02'
        for marker in ['admin','mini']:
            response=self.client.get(target,base_url=ORIGIN,headers={'Origin':ORIGIN,'Authorization':'Bearer '+self.token(marker)})
            self.assertEqual(response.status_code,401)
        with self.assertRaises(BadRequest):_target('request','0'*32,'GET','/api/staff/shifts/another')
        self.app.config['STAFF_IDENTITY_ENABLED']=False
        self.assertEqual(self.client.get(target).status_code,404)


# Reuse the existing real-signature offline auth helpers, not a runtime bypass.
import test_staff_auth as _auth_test_helpers
for _name in ('token','create','post','code','cookie','csrf','binding_fixture','bound_post','login','activate'):
    setattr(EmployeeShiftStaffAccessTests,_name,getattr(_auth_test_helpers.StaffAuthTests,_name))


class EmployeeShiftEditingTests(TestCase):
    setUp=EmployeeShiftTests.setUp
    token=EmployeeShiftTests.token
    template=EmployeeShiftTests.template
    weekly=EmployeeShiftTests.weekly
    override=EmployeeShiftTests.override
    def edit(self,kind,row,operation='replace',**extra):
        payload={'operation':operation,'expected_version':1,'reason':'Offline manager correction',**extra}
        return shifts.edit_plan(self.manager,self.employee.id,kind,row['id'],payload)

    def test_future_suffix_replace_preserves_original_and_past_expectations(self):
        old=self.weekly(self.template());alternate=self.template('14:00','22:00')
        original=Weekly.query.get(old['id']);before=shifts.serialize(shifts.expectation(self.employee,self.start))
        new=self.edit('weekly',old,effective_from='2026-11-09',template_id=alternate)
        self.assertEqual(original.effective_from,self.start);self.assertEqual(original.effective_to,date(2026,11,30))
        self.assertEqual(original.version,2);self.assertEqual(original.retired_from,date(2026,11,9))
        self.assertEqual(Weekly.query.get(new['id']).supersedes_id,old['id'])
        self.assertEqual(before,shifts.serialize(shifts.expectation(self.employee,self.start)))
        self.assertEqual(shifts.expectation(self.employee,date(2026,11,9)).start_at.astimezone(shifts.CAIRO).hour,14)
        self.assertEqual(Change.query.count(),1)
        with self.assertRaises(Conflict):self.edit('weekly',old,effective_from='2026-11-16',template_id=alternate)

    def test_cancel_weekly_and_override_reveals_base_schedule(self):
        t=self.template();weekly=self.weekly(t)
        self.edit('weekly',weekly,'cancel',effective_from='2026-11-16')
        self.assertEqual(shifts.expectation(self.employee,date(2026,11,16)).state,'UNASSIGNED')
        self.assertEqual(shifts.expectation(self.employee,date(2026,11,9)).state,'SCHEDULED')
        rest=self.override('2026-11-09',rest=True)
        self.edit('override',rest,'cancel')
        self.assertEqual(shifts.expectation(self.employee,date(2026,11,9)).state,'SCHEDULED')
        new=self.override('2026-11-09',rest=True);self.assertNotEqual(new['id'],rest['id'])

    def test_replace_rest_and_reject_frozen_or_already_effective_changes(self):
        t=self.template();row=self.weekly(t);override=self.override('2026-11-09',rest=True)
        replacement=self.edit('override',override,template_id=t,is_rest=False)
        shifts.freeze(self.manager,self.employee.id,date(2026,11,9),date(2026,11,9))
        with self.assertRaises(Conflict):self.edit('override',replacement,'cancel')
        with mock.patch.object(shifts,'today',return_value=date(2026,11,2)):
            with self.assertRaises(Conflict):self.edit('weekly',row,'cancel',effective_from='2026-11-02')
        # An already effective plan may still get a future suffix correction.
        with mock.patch.object(shifts,'today',return_value=date(2026,11,10)):
            self.edit('weekly',row,'cancel',effective_from='2026-11-16')

    def test_edit_overlap_rolls_back_retirement_and_audit(self):
        row=self.weekly(self.template('12:00','21:00'))
        self.weekly(self.template('02:00','08:00'),1)
        with self.assertRaises(Conflict):self.edit('weekly',row,template_id=self.template('22:00','03:00'),effective_from='2026-11-02')
        self.assertIsNone(Weekly.query.get(row['id']).retired_from);self.assertEqual(Change.query.count(),0)

    def test_wrong_employee_branch_and_bad_version_rejected(self):
        row=self.override('2026-11-09',rest=True)
        with self.assertRaises(Conflict):self.edit('override',row,'cancel',expected_version=99)
        from werkzeug.exceptions import NotFound
        with self.assertRaises(NotFound):shifts.edit_plan(self.manager,self.other.id,'override',row['id'],{'operation':'cancel','expected_version':1,'reason':'wrong employee'})
        other_branch=Branch(name='Other offline',city='Giza');db.session.add(other_branch);db.session.flush()
        self.manager.role=UserRole.BRANCH_MANAGER;self.manager.branch_id=other_branch.id
        with self.assertRaises(Forbidden):self.edit('override',row,'cancel')

    def test_edit_api_and_version_listing(self):
        row=self.weekly(self.template());headers={'Authorization':'Bearer '+self.token()}
        response=self.client.patch(f'/api/admin/employees/{self.employee.id}/shift-schedules/{row["id"]}',headers=headers,json={'operation':'cancel','expected_version':1,'effective_from':'2026-11-09','reason':'Offline cancellation'})
        self.assertEqual(response.status_code,200,response.json)
        response=self.client.get(f'/api/admin/employees/{self.employee.id}/shift-plans?from=2026-11-01&to=2026-11-30',headers=headers)
        self.assertEqual(response.json['plans'][0]['version'],2)
        self.assertEqual(response.json['plans'][0]['retired_from'],'2026-11-09')

