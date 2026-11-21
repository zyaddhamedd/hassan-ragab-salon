"""Opt-in real locking/migration tests in a freshly initialized private cluster.

Run with OMAR_ATTENDANCE_DISPOSABLE_PG=1. No external DSN is accepted. TCP is
DISABLED; initdb/pg_ctl only address a new TemporaryDirectory owned by this test.
"""
import os
import sys
import tempfile
import subprocess
import importlib.util
import threading
import time
import unittest
from pathlib import Path
from datetime import datetime, timezone
from flask import Flask, g
from sqlalchemy import text
from alembic.operations import Operations
from alembic.migration import MigrationContext
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.extensions import db
from app.models.branch import Branch
from app.models.employee import Employee, EmployeeType
from app.models.user import User, UserRole
from app.models.business_day import BusinessDay
from app.models.attendance import Attendance, AttendanceStatus, AttendanceCheckoutSource
from app.models.employee_transfer import EmployeeTransfer
from app.models.employee_document import EmployeeDocument
from app.models.employee_overtime import EmployeeOvertime
from app.services.attendance_compatibility import close_transfer_attendance
from werkzeug.exceptions import Conflict


@unittest.skipUnless(os.environ.get('OMAR_ATTENDANCE_DISPOSABLE_PG')=='1','Opt-in disposable PostgreSQL test')
class AttendancePostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory(prefix='omar-attendance-pg-',dir='/private/tmp')
        cls.root=Path(cls.tmp.name);os.chmod(cls.root,0o700)
        cls.bin=Path('/opt/homebrew/opt/postgresql@16/bin')
        cls.data=cls.root/'data';cls.socket=cls.root/'socket';cls.socket.mkdir(mode=0o700)
        cls.addClassCleanup(cls.tmp.cleanup)
        subprocess.run([str(cls.bin/'initdb'),'-D',str(cls.data),'-A','trust','--no-locale','-U','attendance_test'],check=True,stdout=subprocess.DEVNULL)
        cls.addClassCleanup(lambda:subprocess.run([str(cls.bin/'pg_ctl'),'-D',str(cls.data),'-m','immediate','stop'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
        subprocess.run([str(cls.bin/'pg_ctl'),'-D',str(cls.data),'-l',str(cls.root/'server.log'),'-o',f"-h '' -k {cls.socket} -p 55439",'-w','start'],check=True,stdout=subprocess.DEVNULL)
        cls.app=Flask(__name__)
        cls.app.config.update(SQLALCHEMY_DATABASE_URI=f'postgresql+psycopg2://attendance_test@/postgres?host={cls.socket}&port=55439',
            SQLALCHEMY_ENGINE_OPTIONS={'connect_args':{'options':'-c lock_timeout=3000 -c statement_timeout=10000'}},
            SQLALCHEMY_TRACK_MODIFICATIONS=False,STAFF_IDENTITY_ENABLED=True,STAFF_IDENTITY_OMAR_RUNTIME=True)
        db.init_app(cls.app)
        with cls.app.app_context():
            with db.engine.connect() as c:
                identity=c.execute(text('select inet_server_addr(), current_user, current_setting(\'data_directory\'), current_setting(\'listen_addresses\')')).one()
                assert identity==(None,'attendance_test',str(cls.data),'')
            cls.addClassCleanup(cls.dispose)
        spec=importlib.util.spec_from_file_location('attendance_migration',Path(__file__).resolve().parents[1]/'migrations/versions/zy_staff_attendance_evidence.py')
        cls.migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.migration)

    @classmethod
    def dispose(cls):
        with cls.app.app_context():db.session.remove();db.engine.dispose()

    def setUp(self):
        self.ctx=self.app.app_context();self.ctx.push();self.addCleanup(self.ctx.pop);self.addCleanup(db.session.remove)
        with db.engine.begin() as c:
            c.execute(text('DROP SCHEMA public CASCADE'));c.execute(text('CREATE SCHEMA public'))
        db.metadata.create_all(db.engine,tables=[Branch.__table__,Employee.__table__,User.__table__,BusinessDay.__table__,EmployeeTransfer.__table__,EmployeeDocument.__table__,EmployeeOvertime.__table__])
        with db.engine.begin() as c:
            Attendance.__table__.c.status.type.create(c, checkfirst=True)
            Attendance.__table__.c.checkout_source.type.create(c, checkfirst=True)
            c.execute(text('''CREATE TABLE attendances (
                id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id),
                branch_id integer NOT NULL REFERENCES branches(id), business_day_id integer REFERENCES business_days(id),
                date date NOT NULL, check_in_time timestamptz NOT NULL, check_out_time timestamptz,
                checkout_source attendance_checkout_source_enum, status attendance_status_enum NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())'''))
            c.execute(text("CREATE UNIQUE INDEX uq_employee_present ON attendances(employee_id) WHERE status='PRESENT'"))
        self.branch=Branch(name='Private test source',city='Giza');self.dest=Branch(name='Private test target',city='Giza')
        db.session.add_all([self.branch,self.dest]);db.session.flush()
        self.emp=Employee(full_name='Offline',employee_type=EmployeeType.BARBER,branch_id=self.branch.id)
        self.actor=User(full_name='Offline',email='offline',password_hash='!fixture',role=UserRole.SUPER_ADMIN,is_active=True)
        db.session.add_all([self.emp,self.actor]);db.session.commit()
        self.eid=self.emp.id;self.aid=self.actor.id;self.bid=self.branch.id;self.did=self.dest.id
        db.session.remove()
        with db.engine.begin() as c:
            c.execute(text("INSERT INTO attendances(employee_id,branch_id,date,check_in_time,status) VALUES (:e,:b,current_date,now(),'PRESENT')"),dict(e=self.eid,b=self.bid))
            self.before=c.execute(text('SELECT * FROM attendances')).all()
            with Operations.context(MigrationContext.configure(c)):self.migration.upgrade()

    def staff(self):
        # New Staff row: provenance is set at INSERT, never backfilled.
        with db.engine.begin() as c:
            c.execute(text('DELETE FROM attendances'))
        row=Attendance(employee_id=self.eid,branch_id=self.bid,date=datetime.now(timezone.utc).date(),
            check_in_time=datetime.now(timezone.utc),status=AttendanceStatus.PRESENT,attendance_origin='STAFF_GPS')
        db.session.add(row);db.session.commit();self.rid=row.id
        return row

    def review(self):return dict(attendance_id=self.rid,reason='Reviewed transfer closure',acknowledge_unverified=True)

    def test_additive_migration_preserves_legacy_and_unique_open_constraint(self):
        with db.engine.connect() as c:
            after=c.execute(text('SELECT id,employee_id,branch_id,business_day_id,date,check_in_time,check_out_time,checkout_source,status,created_at,updated_at FROM attendances')).all()
            self.assertEqual(self.before,after)
            self.assertIsNone(c.execute(text('SELECT attendance_origin FROM attendances')).scalar())
        from sqlalchemy.exc import IntegrityError
        with self.assertRaises(IntegrityError),db.engine.begin() as c:
            c.execute(text("INSERT INTO attendances(employee_id,branch_id,date,check_in_time,status) VALUES (:e,:b,current_date,now(),'PRESENT')"),dict(e=self.eid,b=self.bid))
        with db.engine.begin() as c:
            with Operations.context(MigrationContext.configure(c)):self.migration.downgrade()
            self.assertEqual(self.before,c.execute(text('SELECT * FROM attendances')).all())

    def test_real_postgres_legacy_cashier_checkout_lock_and_response(self):
        from app.api.mini import check_out_employee
        day=BusinessDay(branch_id=self.bid,opened_by=self.eid,opening_balance=0)
        db.session.add(day);db.session.flush()
        row=Attendance.query.one();row.business_day_id=day.id;db.session.commit()
        with self.app.test_request_context('/',method='POST',json={'employee_id':self.eid}):
            g.branch_id=self.bid;g.cashier_id=self.eid
            response,status=check_out_employee.__wrapped__()
        self.assertEqual(status,200,response.json)
        self.assertEqual(response.json['checkout_source'],'MANUAL')
        self.assertNotIn('closure_reason',response.json)

    def test_admin_evidence_immutable_and_incomplete_closure_rejected(self):
        row=self.staff()
        from sqlalchemy.exc import IntegrityError
        with self.assertRaises(IntegrityError),db.engine.begin() as c:
            c.execute(text("UPDATE attendances SET check_out_time=now(),status='LEFT' WHERE id=:id"),dict(id=self.rid))
        close_transfer_attendance(self.eid,self.bid,self.actor,self.review(),datetime.now(timezone.utc));db.session.commit()
        for statement in ["UPDATE attendances SET closure_reason='rewritten'",'DELETE FROM attendances',"UPDATE attendances SET attendance_origin=NULL",'UPDATE attendances SET closure_review_required=false']:
            with self.assertRaises(IntegrityError),db.engine.begin() as c:c.execute(text(statement))
        db.session.remove()
        with self.assertRaises(RuntimeError),db.engine.begin() as c:
            with Operations.context(MigrationContext.configure(c)):self.migration.downgrade()
        row=db.session.get(Attendance,self.rid);self.assertEqual(row.checkout_verification,'ADMIN_UNVERIFIED');self.assertTrue(row.closure_review_required)

    def race(self,first):
        self.staff();rid=self.rid;eid=self.eid;bid=self.bid;aid=self.aid;did=self.did;review=self.review()
        held=threading.Event();release=threading.Event();second_started=threading.Event();result={};pids={}
        def transfer(hold):
            with self.app.app_context():
                try:
                    pids['transfer']=db.session.execute(text('select pg_backend_pid()')).scalar()
                    db.session.query(Employee).filter_by(id=eid).populate_existing().with_for_update().one()
                    if not hold:second_started.set()
                    close_transfer_attendance(eid,bid,db.session.get(User,aid),review,datetime.now(timezone.utc))
                    if hold:held.set();assert release.wait(10)
                    db.session.get(Employee,eid).branch_id=did
                    db.session.add(EmployeeTransfer(employee_id=eid,from_branch_id=bid,to_branch_id=did))
                    db.session.commit();result['transfer']='closed'
                except Conflict:db.session.rollback();result['transfer']='stale'
                except BaseException as e:result['error']=repr(e);held.set()
                finally:db.session.remove()
        def checkout(hold):
            # Contract probe for future checkout, NOT a GPS endpoint/implementation.
            with self.app.app_context():
                try:
                    pids['checkout']=db.session.execute(text('select pg_backend_pid()')).scalar()
                    if not hold:second_started.set()
                    row=Attendance.query.filter_by(id=rid).populate_existing().with_for_update().one()
                    if row.status!=AttendanceStatus.PRESENT or row.check_out_time is not None:
                        db.session.rollback();result['checkout']='already_closed';return
                    assert row.branch_id==bid
                    if hold:held.set();assert release.wait(10)
                    row.check_out_time=datetime.now(timezone.utc);row.status=AttendanceStatus.LEFT
                    row.checkout_source=AttendanceCheckoutSource.MANUAL;row.checkout_verification='STAFF_GPS_VERIFIED'
                    db.session.commit();result['checkout']='closed'
                except BaseException as e:result['error']=repr(e);held.set()
                finally:db.session.remove()
        funcs={'transfer':transfer,'checkout':checkout};second='checkout' if first=='transfer' else 'transfer'
        a=threading.Thread(target=funcs[first],args=(True,));b=threading.Thread(target=funcs[second],args=(False,))
        a.start()
        try:
            self.assertTrue(held.wait(10),result);b.start();self.assertTrue(second_started.wait(10),result)
            blocked=False
            for _ in range(100):
                with db.engine.connect() as c:
                    blocked=c.execute(text("SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE pid=:pid"),dict(pid=pids[second])).scalar()
                if blocked:break
                time.sleep(.02)
            self.assertTrue(blocked,'Second writer must actually wait on PostgreSQL row lock')
        finally:
            release.set();a.join(10)
            if b.ident:b.join(10)
        self.assertFalse(a.is_alive());self.assertFalse(b.is_alive());self.assertNotIn('error',result)
        db.session.expire_all();row=db.session.get(Attendance,rid)
        if first=='transfer':
            self.assertEqual(result,{'transfer':'closed','checkout':'already_closed'})
            self.assertEqual(row.checkout_verification,'ADMIN_UNVERIFIED');self.assertEqual(row.closure_actor_id,aid)
        else:
            self.assertEqual(result,{'checkout':'closed','transfer':'stale'})
            self.assertEqual(row.checkout_verification,'STAFF_GPS_VERIFIED');self.assertIsNone(row.closure_actor_id)
            self.assertEqual(db.session.get(Employee,eid).branch_id,bid)
        self.assertEqual(Attendance.query.count(),1)

    def test_transfer_wins_checkout_waits_and_rechecks(self):self.race('transfer')
    def test_checkout_wins_transfer_waits_and_rechecks(self):self.race('checkout')


if __name__=='__main__':unittest.main()
