"""Isolated in-memory identity/API tests; no application factory or live services."""
import sys
from pathlib import Path
import unittest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
from werkzeug.exceptions import Conflict, Forbidden, NotFound
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.extensions import db
from app.models.user import User, UserRole
from app.models.employee import Employee, EmployeeType, EmployeeStatus
from app.models.branch import Branch
from app.models.staff_identity_event import StaffIdentityEvent
from app.api.admin_staff_identity import admin_staff_identity_bp
from app.services.staff_identity_service import change_identity, read_identity, staff_safe_identity


class StaffIdentityTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(SQLALCHEMY_DATABASE_URI='sqlite:///:memory:', SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_SECRET_KEY='offline-identity-unit-test-secret-only-64-characters-not-runtime',
            STAFF_IDENTITY_ENABLED=True, STAFF_IDENTITY_OMAR_RUNTIME=True)
        db.init_app(self.app)
        JWTManager(self.app)
        self.app.register_blueprint(admin_staff_identity_bp)
        self.context = self.app.app_context(); self.context.push()
        self.addCleanup(self.context.pop)
        with db.engine.connect() as conn: conn.exec_driver_sql('PRAGMA foreign_keys=ON')
        db.metadata.create_all(db.engine, tables=[Branch.__table__, Employee.__table__, User.__table__, StaffIdentityEvent.__table__])
        self.addCleanup(db.session.remove)
        self.branch = Branch(name='Offline branch',city='Giza');db.session.add(self.branch);db.session.flush()
        self.manager = User(full_name='Offline manager',email='offline-admin',role=UserRole.SUPER_ADMIN,password_hash='!fixture',is_active=True)
        self.employee = Employee(full_name='Offline employee',employee_type=EmployeeType.BARBER,branch_id=self.branch.id,base_salary=9000,commission_wallet_balance=1234,status=EmployeeStatus.ACTIVE)
        self.other = Employee(full_name='Offline second',employee_type=EmployeeType.ASSISTANT,branch_id=self.branch.id,status=EmployeeStatus.ACTIVE)
        db.session.add_all([self.manager,self.employee,self.other]);db.session.commit()
        self.client = self.app.test_client()

    def create(self, employee=None, name='staff_one'):
        return change_identity(self.manager,(employee or self.employee).id,'create',{'username':name})

    def test_create_is_explicit_username_no_email_or_password_and_safe_serializer(self):
        result=self.create(name='Staff_One');user=db.session.get(User,result['user_id'])
        self.assertEqual(result['username'],'staff_one');self.assertEqual(user.employee_id,self.employee.id)
        self.assertEqual(user.role,UserRole.EMPLOYEE);self.assertFalse(user.is_active);self.assertFalse(user.check_password('anything'))
        self.assertEqual(set(result),{'user_id','employee_id','username','full_name','employee_type','branch_id','is_active','staff_auth_version','employee_eligible'})
        self.assertNotIn('9000',str(result));self.assertNotIn('1234',str(result));self.assertEqual(StaffIdentityEvent.query.count(),1)

    def test_duplicate_employee_and_username_rejected(self):
        self.create()
        with self.assertRaises(Conflict):self.create(name='another')
        with self.assertRaises(Conflict):self.create(self.other,name='STAFF_ONE')
        self.assertEqual(User.query.count(),2)

    def test_link_only_inactive_explicit_unlinked_employee_role(self):
        for role in (UserRole.SUPER_ADMIN,UserRole.CASHIER):
            user=User(full_name='Fixture',email='fixture_'+role.value.lower(),password_hash='!fixture',role=role,is_active=False);db.session.add(user);db.session.commit()
            with self.assertRaises(Conflict):change_identity(self.manager,self.employee.id,'link',{'user_id':user.id})
        user=User(full_name=self.employee.full_name,email='existing_staff',password_hash='!fixture',role=UserRole.EMPLOYEE,is_active=False);db.session.add(user);db.session.commit()
        self.assertIsNone(read_identity(self.manager,self.employee.id))
        result=change_identity(self.manager,self.employee.id,'link',{'user_id':user.id})
        self.assertEqual(result['user_id'],user.id);self.assertEqual(result['staff_auth_version'],2)
        with self.assertRaises(Conflict):change_identity(self.manager,self.other.id,'link',{'user_id':user.id})

    def test_activation_deactivation_version_and_employee_eligibility(self):
        result=self.create()
        result=change_identity(self.manager,self.employee.id,'state',{'is_active':True,'expected_version':1})
        self.assertTrue(result['is_active']);self.assertEqual(result['staff_auth_version'],2)
        same=change_identity(self.manager,self.employee.id,'state',{'is_active':True,'expected_version':2});self.assertEqual(same['staff_auth_version'],2)
        with self.assertRaises(Conflict):change_identity(self.manager,self.employee.id,'state',{'is_active':False,'expected_version':1})
        result=change_identity(self.manager,self.employee.id,'state',{'is_active':False,'expected_version':2});self.assertEqual(result['staff_auth_version'],3)
        self.employee.status=EmployeeStatus.SUSPENDED;db.session.commit()
        with self.assertRaises(Conflict):change_identity(self.manager,self.employee.id,'state',{'is_active':True,'expected_version':3})
        self.assertEqual(StaffIdentityEvent.query.count(),3)

    def test_service_rechecks_roles_and_both_feature_guards(self):
        for role in [UserRole.BRANCH_MANAGER,UserRole.STORE_MANAGER,UserRole.CASHIER,UserRole.EMPLOYEE]:
            self.manager.role=role
            with self.assertRaises(Forbidden):self.create()
        self.manager.role=UserRole.EXEC_ADMIN;self.create()
        for key in ['STAFF_IDENTITY_ENABLED','STAFF_IDENTITY_OMAR_RUNTIME']:
            self.app.config[key]=False
            with self.assertRaises(NotFound):read_identity(self.manager,self.employee.id)
            self.app.config[key]=True

    def test_database_constraints_prevent_bypass(self):
        result=self.create();user=db.session.get(User,result['user_id']);user.role=UserRole.CASHIER
        with self.assertRaises(IntegrityError):db.session.flush()
        db.session.rollback()
        user=db.session.get(User,result['user_id']);user.staff_auth_version=0
        with self.assertRaises(IntegrityError):db.session.flush()
        db.session.rollback()
        duplicate=User(email='duplicate',full_name='Fixture',role=UserRole.EMPLOYEE,password_hash='!fixture',employee_id=self.employee.id)
        db.session.add(duplicate)
        with self.assertRaises(IntegrityError):db.session.flush()
        db.session.rollback()

    def token(self, marker='admin', role=None):
        return create_access_token(identity=str(self.manager.id),additional_claims={'token_type':marker,'role':role or self.manager.role.value})

    def test_api_auth_separation_and_real_admin_decorators(self):
        url=f'/api/admin/employees/{self.employee.id}/staff-identity'
        for marker in ['staff','mini']:
            self.assertEqual(self.client.post(url,json={'username':'staff_one'},headers={'Authorization':'Bearer '+self.token(marker)}).status_code,403)
        self.assertEqual(self.client.get(url).status_code,401)
        for role in [UserRole.BRANCH_MANAGER,UserRole.STORE_MANAGER,UserRole.CASHIER,UserRole.EMPLOYEE]:
            self.manager.role=role;db.session.commit()
            self.assertEqual(self.client.get(url,headers={'Authorization':'Bearer '+self.token()}).status_code,403)
        self.manager.role=UserRole.EXEC_ADMIN;db.session.commit()
        headers={'Authorization':'Bearer '+self.token()}
        self.assertEqual(self.client.post(url,json={'username':'staff_one'},headers=headers).status_code,201)
        self.assertEqual(self.client.patch(url,json={'is_active':True,'expected_version':1},headers=headers).status_code,200)
        self.assertEqual(self.client.post(url,json={'username':'other'},headers=headers).status_code,409)
        self.app.config['STAFF_IDENTITY_ENABLED']=False
        for method in ['get','post','patch']:
            self.assertEqual(getattr(self.client,method)(url,json={}).status_code,404)
        self.assertEqual(self.client.post('/api/staff/auth/login',json={}).status_code,404)

    def test_legacy_user_crud_works_without_optional_staff_columns(self):
        # Separate in-memory database, deliberately representing pre-migration schema.
        app=Flask('legacy-identity-compatibility')
        app.config.update(SQLALCHEMY_DATABASE_URI='sqlite:///:memory:')
        db.init_app(app)
        with app.app_context():
            db.session.execute(db.text("CREATE TABLE users (id INTEGER PRIMARY KEY, full_name VARCHAR(100) NOT NULL, email VARCHAR(120) NOT NULL UNIQUE, password_hash VARCHAR(256) NOT NULL, role VARCHAR(20) NOT NULL, branch_id INTEGER, is_active BOOLEAN NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)"))
            user=User(full_name='Legacy',email='legacy-fixture',role=UserRole.SUPER_ADMIN,password_hash='!fixture')
            db.session.add(user);db.session.commit()
            fetched=User.query.filter_by(email='legacy-fixture').one()
            self.assertEqual(fetched.full_name,'Legacy')
            fetched.full_name='Legacy unchanged behavior';db.session.commit()
            self.assertEqual(User.query.count(),1)
            self.assertEqual(User.query.with_entities(User.role).distinct().count(),1)
            self.assertNotIn('employee_id',str(User.query.statement))
            self.assertNotIn('staff_auth_version',str(User.query.statement))
            db.session.remove()

    def test_mini_rejects_staff_marker_and_employee_role_before_any_device_flow(self):
        from app.api.mini import require_cashier
        self.app.add_url_rule('/test-mini-identity', view_func=require_cashier(lambda: {'unexpected': True}))
        for marker in ['staff', 'mini']:
            token=create_access_token(identity=str(self.manager.id),additional_claims={'token_type':marker,'role':'EMPLOYEE'})
            response=self.client.get('/test-mini-identity',headers={'Authorization':'Bearer '+token})
            self.assertIn(response.status_code,(401,403))

    def test_unknown_fields_no_arbitrary_link_or_financial_payload(self):
        url=f'/api/admin/employees/{self.employee.id}/staff-identity';headers={'Authorization':'Bearer '+self.token()}
        for data in [{'username':'safe','employee_id':self.other.id},{'username':'safe','password':'forbidden'},{'username':'safe','base_salary':99},{'username':'x@y.invalid'},{'username':None}]:
            self.assertEqual(self.client.post(url,json=data,headers=headers).status_code,400)
        self.assertEqual(User.query.count(),1)

class StaffMigrationTests(unittest.TestCase):
    def test_additive_postgres_sql_offline_only(self):
        import importlib.util
        from io import StringIO
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        path=Path(__file__).resolve().parents[1]/'migrations/versions/zs_staff_identity_foundation.py'
        spec=importlib.util.spec_from_file_location('staff_migration_test',path)
        migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)
        output=StringIO()
        with Operations.context(MigrationContext.configure(dialect_name='postgresql',opts={'as_sql':True,'output_buffer':output})):
            migration.upgrade()
        sql=output.getvalue()
        self.assertEqual(migration.down_revision,'zr_payroll_settlement_ledger')
        self.assertIn('ADD COLUMN employee_id',sql)
        self.assertIn('UNIQUE (employee_id)',sql)
        self.assertIn("role = 'EMPLOYEE'",sql)
        self.assertIn('ON DELETE RESTRICT',sql)
        self.assertIn('CREATE TABLE staff_identity_events',sql)
        for verb in ['INSERT INTO','UPDATE ','DELETE FROM','DROP TABLE','ALTER TYPE']:
            self.assertNotIn(verb,sql)

    def test_guard_default_false_not_inherited_and_no_staff_login_routes(self):
        from app.config import Config
        self.assertIs(Config.STAFF_IDENTITY_ENABLED,False)
        self.assertIs(Config.STAFF_IDENTITY_OMAR_RUNTIME,False)
        self.assertNotIn('/api/staff',str(admin_staff_identity_bp.deferred_functions))


if __name__=='__main__':unittest.main()
