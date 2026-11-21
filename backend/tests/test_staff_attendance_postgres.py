"""Actual signed API races and real Staff-chain migrations, disposable PG ONLY."""
import os
import sys
import uuid
import hashlib
import importlib.util
import threading
import time
from pathlib import Path
from datetime import timedelta
from unittest import TestCase, skipUnless, mock
from flask import g
from flask_jwt_extended import JWTManager
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from alembic.operations import Operations
from alembic.migration import MigrationContext
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import test_attendance_postgres as pg_fixture
import staff_device_support as support
from test_staff_auth import ORIGIN, PASSWORD
from app.extensions import db
from app.api.staff import staff_bp
from app.api.admin import transfer_employee
from app.models.employee import Employee, EmployeeType
from app.models.user import User, UserRole
from app.models.attendance import Attendance, AttendanceStatus
from app.models.business_day import BusinessDay
from app.models.employee_shift import EmployeeShiftInstance as Instance
from app.models.staff_attendance import StaffAttendanceReceipt as Receipt
from app.services import staff_auth_service as auth, staff_geofence_service as geo
from app.services import attendance_compatibility as compat, staff_attendance_service as attendance_service, staff_device_service as devices

IN='/api/staff/attendance/check-in'
OUT='/api/staff/attendance/check-out'


@skipUnless(os.environ.get('OMAR_ATTENDANCE_DISPOSABLE_PG')=='1','Opt-in disposable PostgreSQL test')
class StaffAttendancePostgresTests(TestCase):
    @classmethod
    def setUpClass(cls):
        pg_fixture.AttendancePostgresTests.setUpClass.__func__(cls)
        cls.app.config.update(JWT_SECRET_KEY='isolated-staff-attendance-test-secret-at-least-64-characters-only',STAFF_TRUSTED_ORIGINS=(ORIGIN,))
        JWTManager(cls.app);cls.app.register_blueprint(staff_bp)

    @classmethod
    def dispose(cls):pg_fixture.AttendancePostgresTests.dispose.__func__(cls)

    def setUp(self):
        pg_fixture.AttendancePostgresTests.setUp(self)
        self.legacy_employee_id=self.eid
        db.session.remove()
        # Rewind the empty optional foundation fixture, then run every real Staff
        # upgrade from a modeled legacy baseline. Not a live-schema upgrade tool.
        with db.engine.begin() as c:
            with Operations.context(MigrationContext.configure(c)):self.migration.downgrade()
            c.execute(text('ALTER TABLE users DROP COLUMN employee_id CASCADE, DROP COLUMN staff_auth_version CASCADE, DROP COLUMN staff_password_initialized CASCADE'))
            c.execute(text("CREATE TABLE alembic_version(version_num varchar(32) PRIMARY KEY)"))
            c.execute(text("INSERT INTO alembic_version VALUES ('zr_payroll_settlement_ledger')"))
            current='zr_payroll_settlement_ledger'
            for name in ['zs_staff_identity_foundation','zt_staff_auth_sessions','zu_staff_personal_devices','zv_employee_shift_planning','zw_employee_shift_supersession','zx_staff_geofence_versions','zy_staff_attendance_evidence','zz_staff_gps_attendance']:
                spec=importlib.util.spec_from_file_location(name,Path(__file__).resolve().parents[1]/'migrations/versions'/f'{name}.py')
                module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
                assert module.down_revision==current and len(module.revision)<=32
                with Operations.context(MigrationContext.configure(c)):module.upgrade()
                current=module.revision;c.execute(text('UPDATE alembic_version SET version_num=:v'),dict(v=current))
                self.new_migration=module
            after=c.execute(text('SELECT id,employee_id,branch_id,business_day_id,date,check_in_time,check_out_time,checkout_source,status,created_at,updated_at FROM attendances')).all()
            self.assertEqual(self.before,after)
        employee=Employee(full_name='Private Staff fixture',employee_type=EmployeeType.BARBER,branch_id=self.bid)
        db.session.add(employee);db.session.flush();self.eid=employee.id
        user=User(full_name='Private Staff',email='private-staff',role=UserRole.EMPLOYEE,employee_id=self.eid,
            staff_auth_version=1,staff_password_initialized=True,is_active=True)
        user.set_password(PASSWORD);db.session.add(user);db.session.commit();self.uid=user.id
        self.binding=support.fixture_active(user)
        self.client=self.app.test_client()
        response=support.proof_request(self.client,ORIGIN,self.binding,'login','POST','/api/staff/auth/login',dict(username='private-staff',password=PASSWORD))
        self.assertEqual(response.status_code,200,response.json);self.access=response.json['access_token']
        geo.configure(db.session.get(User,self.aid),self.bid,dict(expected_version=0,latitude=0.,longitude=0.,radius_m=100.,max_accuracy_m=20.,max_age_seconds=30,enabled=True,reason='Explicit isolated test configuration'))
        db.session.remove()

    def payload(self,**changes):
        return {'idempotency_key':uuid.uuid4().hex,'location':dict(latitude=0.,longitude=0.,accuracy_m=5.,captured_at=auth.now_utc().isoformat()),**changes}

    def prepared(self,path,data):
        raw=support.encoded(data)
        result=self.client.post('/api/staff/auth/device-challenges',base_url=ORIGIN,json=dict(device_id=self.binding[0],purpose='request',method='POST',target=path,body_hash=hashlib.sha256(raw).hexdigest()),headers={'Origin':ORIGIN,'Authorization':'Bearer '+self.access})
        self.assertEqual(result.status_code,200,result.json)
        return raw,{'Origin':ORIGIN,'Authorization':'Bearer '+self.access,'X-Staff-Device':self.binding[0],'DPoP':support.sign(self.binding[1],self.binding[2],result.json)}

    def send_prepared(self,path,prepared):
        raw,headers=prepared
        with self.app.test_client() as client:
            return client.post(path,base_url=ORIGIN,data=raw,content_type='application/json',headers=headers)

    def send(self,path=IN,data=None):return self.send_prepared(path,self.prepared(path,data or self.payload()))

    def check_in(self):
        response=self.send();self.assertEqual(response.status_code,200,response.json)
        self.rid=response.json['attendance_id'];db.session.remove();return response

    def transfer(self):
        with self.app.app_context(),self.app.test_request_context('/',method='POST',json={'branch_id':self.did,'attendance_closure_review':dict(attendance_id=self.rid,reason='Explicit private manager closure',acknowledge_unverified=True)}):
            g.current_user=db.session.get(User,self.aid)
            response,status=transfer_employee.__wrapped__(self.eid)
            return status,response.json

    def test_real_signed_endpoints_migration_bindings_immutability_and_retry(self):
        first=self.check_in()
        with self.assertRaises(IntegrityError),db.engine.begin() as c:
            c.execute(text("UPDATE attendances SET check_in_time=check_in_time-interval '1 minute' WHERE id=:id"),dict(id=self.rid))
        out=self.payload(attendance_id=self.rid);response=self.send(OUT,out)
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(self.send(OUT,out).json,response.json)
        self.assertEqual(Receipt.query.count(),2);self.assertEqual(Instance.query.count(),1);self.assertEqual(BusinessDay.query.count(),0)
        row=db.session.get(Attendance,self.rid);self.assertEqual(row.checkout_verification,'STAFF_GPS_VERIFIED')
        db.session.remove()
        for statement in ['DELETE FROM staff_attendance_receipts',"UPDATE staff_attendance_receipts SET request_hash='changed'",'UPDATE attendances SET check_out_time=now() WHERE attendance_origin=\'STAFF_GPS\'']:
            with self.assertRaises(IntegrityError),db.engine.begin() as c:c.execute(text(statement))
        with self.assertRaises(RuntimeError),db.engine.begin() as c:
            with Operations.context(MigrationContext.configure(c)):self.new_migration.downgrade()
        self.assertEqual(first.json['shift'],response.json['shift'])

    def test_empty_receipt_migration_downgrade_and_upgrade_preserve_legacy(self):
        with db.engine.begin() as c:
            with Operations.context(MigrationContext.configure(c)):self.new_migration.downgrade();self.new_migration.upgrade()
            self.assertEqual(self.before,c.execute(text('SELECT id,employee_id,branch_id,business_day_id,date,check_in_time,check_out_time,checkout_source,status,created_at,updated_at FROM attendances')).all())

    def test_current_state_read_during_checkout_is_consistent_and_has_no_attendance_locks(self):
        from sqlalchemy import event
        self.check_in();path='/api/staff/attendance/current'
        read_before=support.proof_request(self.client,ORIGIN,self.binding,'request','GET',path,headers={'Authorization':'Bearer '+self.access})
        self.assertEqual(read_before.status_code,200,read_before.json);self.assertEqual(read_before.json['state'],'OPEN')
        challenge=self.client.post('/api/staff/auth/device-challenges',base_url=ORIGIN,json=dict(device_id=self.binding[0],purpose='request',method='GET',target=path,body_hash=hashlib.sha256(b'').hexdigest()),headers={'Origin':ORIGIN,'Authorization':'Bearer '+self.access})
        self.assertEqual(challenge.status_code,200,challenge.json)
        headers={'Origin':ORIGIN,'Authorization':'Bearer '+self.access,'X-Staff-Device':self.binding[0],'DPoP':support.sign(self.binding[1],self.binding[2],challenge.json)}
        checkout=self.prepared(OUT,self.payload(attendance_id=self.rid));db.session.remove()
        held=threading.Event();release=threading.Event();result={};queries=[];real_evaluate=geo.evaluate
        def pause(*args,**kwargs):
            value=real_evaluate(*args,**kwargs);held.set()
            if not release.wait(8):raise RuntimeError('Test barrier timeout')
            return value
        def capture(conn,cursor,statement,params,context,many):
            if threading.current_thread().name=='current-reader':queries.append(statement)
        def write():
            response=self.send_prepared(OUT,checkout);result['write']=(response.status_code,response.json)
        def read():
            with self.app.test_client() as client:
                response=client.get(path,base_url=ORIGIN,headers=headers);result['read']=(response.status_code,response.json)
        engine=db.engine;event.listen(engine,'before_cursor_execute',capture)
        a=threading.Thread(target=write);b=threading.Thread(name='current-reader',target=read)
        try:
            with mock.patch.object(geo,'evaluate',side_effect=pause):
                a.start()
                try:
                    self.assertTrue(held.wait(8),result);b.start();blocked=False
                    for _ in range(100):
                        with db.engine.connect() as c:blocked=c.execute(text("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid())")).scalar()
                        if blocked:break
                        time.sleep(.01)
                    self.assertTrue(blocked)
                finally:
                    release.set();a.join(10)
                    if b.ident:b.join(10)
        finally:event.remove(engine,'before_cursor_execute',capture)
        self.assertFalse(a.is_alive());self.assertFalse(b.is_alive())
        self.assertEqual(result['write'][0],200,result);self.assertEqual(result['read'][0],200,result)
        state=result['read'][1];self.assertEqual(state['state'],'CLOSED');self.assertFalse(state['checkout_eligible'])
        self.assertIsNotNone(state['attendance']['check_out_time']);self.assertEqual(state['attendance']['closure'],'GPS_VERIFIED')
        attendance_queries=[q for q in queries if 'attendances' in q.lower()]
        self.assertEqual(len(attendance_queries),1)
        self.assertNotIn('FOR UPDATE',attendance_queries[0].upper())
        self.assertTrue(attendance_queries[0].lstrip().upper().startswith('SELECT'))
        self.assertEqual(Receipt.query.count(),2);self.assertEqual(Instance.query.count(),1)

    def test_latest_disabled_geofence_never_falls_back(self):
        self.check_in()
        geo.configure(db.session.get(User,self.aid),self.bid,dict(expected_version=1,latitude=0.,longitude=0.,radius_m=None,max_accuracy_m=None,max_age_seconds=None,enabled=False,reason='Explicit disabled isolated test configuration'))
        response=self.send(OUT,self.payload(attendance_id=self.rid))
        self.assertEqual(response.status_code,409,response.json)
        self.assertEqual(Receipt.query.count(),1);self.assertIsNone(db.session.get(Attendance,self.rid).check_out_time)

    def test_revocation_between_consumed_proof_and_write_is_rechecked(self):
        prepared=self.prepared(IN,self.payload());db.session.remove()
        held=threading.Event();release=threading.Event();result={};real_record=attendance_service.record
        def pause(*args,**kwargs):
            held.set()
            if not release.wait(8):raise RuntimeError('Test barrier timeout')
            return real_record(*args,**kwargs)
        def worker():
            try:
                response=self.send_prepared(IN,prepared);result['response']=(response.status_code,response.json)
            except BaseException as error:result['error']=repr(error)
        with mock.patch.object(attendance_service,'record',side_effect=pause):
            thread=threading.Thread(target=worker);thread.start()
            try:
                self.assertTrue(held.wait(8),result)
                devices.decide(db.session.get(User,self.aid),self.eid,self.binding[0],'revoke','Isolated test revocation')
            finally:release.set();thread.join(10)
        self.assertFalse(thread.is_alive());self.assertNotIn('error',result)
        self.assertEqual(result['response'][0],401,result)
        self.assertEqual(Attendance.query.filter_by(employee_id=self.eid).count(),0)
        self.assertEqual(Receipt.query.count(),0);self.assertEqual(Instance.query.count(),0)

    def test_concurrent_checkins_cannot_create_two_open_rows(self):
        one=self.prepared(IN,self.payload());two=self.prepared(IN,self.payload());db.session.remove()
        held=threading.Event();release=threading.Event();result={};real_evaluate=geo.evaluate
        def pause(*args,**kwargs):
            answer=real_evaluate(*args,**kwargs)
            if threading.current_thread().name=='first-checkin':
                held.set()
                if not release.wait(8):raise RuntimeError('Test barrier timeout')
            return answer
        def worker(label,prepared):
            try:
                response=self.send_prepared(IN,prepared);result[label]=(response.status_code,response.json)
            except BaseException as error:result[label]=('exception',repr(error))
        a=threading.Thread(name='first-checkin',target=worker,args=('first',one));b=threading.Thread(target=worker,args=('second',two))
        with mock.patch.object(geo,'evaluate',side_effect=pause):
            a.start()
            try:
                self.assertTrue(held.wait(8),result);b.start()
                blocked=False
                for _ in range(100):
                    with db.engine.connect() as c:
                        blocked=c.execute(text("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid())")).scalar()
                    if blocked:break
                    if 'second' in result:break
                    time.sleep(.01)
                self.assertTrue(blocked,result)
            finally:
                release.set();a.join(10)
                if b.ident:b.join(10)
        self.assertFalse(a.is_alive());self.assertFalse(b.is_alive())
        self.assertEqual(result['first'][0],200,result);self.assertEqual(result['second'][0],409,result)
        self.assertEqual(Attendance.query.filter_by(employee_id=self.eid,status=AttendanceStatus.PRESENT).count(),1)
        self.assertEqual(Receipt.query.count(),1);self.assertEqual(Instance.query.count(),1)

    def race(self,first,*,repeated=False,replay=False):
        self.check_in();data=self.payload(attendance_id=self.rid)
        one=self.prepared(OUT,data);two=one if replay else self.prepared(OUT,data)
        db.session.remove()
        held=threading.Event();release=threading.Event();started=threading.Event();result={}
        real_evaluate=geo.evaluate;real_transfer=compat.close_transfer_attendance
        def hold_checkout(*args,**kwargs):
            answer=real_evaluate(*args,**kwargs)
            if threading.current_thread().name=='first-attendance-writer':
                held.set()
                if not release.wait(8):raise RuntimeError('Test lock barrier timeout')
            return answer
        def hold_transfer(*args,**kwargs):
            real_transfer(*args,**kwargs)
            if threading.current_thread().name=='first-attendance-writer':
                held.set()
                if not release.wait(8):raise RuntimeError('Test lock barrier timeout')
        def worker(label,kind,prepared):
            try:
                if label=='second':started.set()
                if kind=='transfer':result[label]=self.transfer()
                else:
                    response=self.send_prepared(OUT,prepared);result[label]=(response.status_code,response.json)
            except BaseException as error:result[label]=('exception',repr(error))
        second='checkout' if repeated else ('checkout' if first=='transfer' else 'transfer')
        a=threading.Thread(name='first-attendance-writer',target=worker,args=('first',first,one))
        b=threading.Thread(name='second-attendance-writer',target=worker,args=('second',second,two))
        with mock.patch.object(geo,'evaluate',side_effect=hold_checkout),mock.patch.object(compat,'close_transfer_attendance',side_effect=hold_transfer):
            a.start()
            try:
                self.assertTrue(held.wait(8),result);b.start();self.assertTrue(started.wait(8),result)
                blocked=False
                for _ in range(100):
                    with db.engine.connect() as c:
                        blocked=c.execute(text("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid())")).scalar()
                    if blocked:break
                    if 'second' in result:break
                    time.sleep(.01)
                self.assertTrue(blocked,('Second real endpoint must wait on PostgreSQL lock',result))
            finally:
                release.set();a.join(10)
                if b.ident:b.join(10)
        self.assertFalse(a.is_alive());self.assertFalse(b.is_alive());db.session.expire_all()
        row=db.session.get(Attendance,self.rid)
        if repeated:
            self.assertEqual(result['first'][0],200,result)
            self.assertEqual(result['second'][0],403 if replay else 200,result)
            if not replay:self.assertEqual(result['first'][1],result['second'][1])
            self.assertEqual(row.checkout_verification,'STAFF_GPS_VERIFIED');self.assertEqual(Receipt.query.count(),2)
        elif first=='transfer':
            self.assertEqual(result['first'][0],200,result);self.assertEqual(result['second'][0],409,result)
            self.assertEqual(row.checkout_verification,'ADMIN_UNVERIFIED');self.assertEqual(Receipt.query.count(),1)
            self.assertEqual(db.session.get(Employee,self.eid).branch_id,self.did)
        else:
            self.assertEqual(result['first'][0],200,result);self.assertEqual(result['second'][0],409,result)
            self.assertEqual(row.checkout_verification,'STAFF_GPS_VERIFIED');self.assertEqual(Receipt.query.count(),2)
            self.assertEqual(db.session.get(Employee,self.eid).branch_id,self.bid)
        self.assertEqual(Attendance.query.filter_by(employee_id=self.eid).count(),1)

    def test_transfer_wins_real_checkout_cannot_overwrite(self):self.race('transfer')
    def test_real_checkout_wins_reviewed_transfer_rechecks(self):self.race('checkout')
    def test_concurrent_checkout_retries_with_fresh_proofs_are_idempotent(self):self.race('checkout',repeated=True)
    def test_concurrent_identical_proof_is_single_use(self):self.race('checkout',repeated=True,replay=True)


if __name__=='__main__':
    import unittest
    unittest.main()
