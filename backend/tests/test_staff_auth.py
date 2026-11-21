"""Offline Staff security tests. Real device signatures are used; fixtures are confined to test memory."""
from datetime import timedelta
import importlib.util
from io import StringIO
from pathlib import Path
import unittest
from flask_jwt_extended import create_access_token, create_refresh_token, decode_token
from alembic.migration import MigrationContext
from alembic.operations import Operations
import test_staff_identity as identity_tests
from app.extensions import db
from app.models.user import User, UserRole
from app.models.employee import EmployeeStatus
from app.models.staff_auth import StaffAuthCode, StaffSession, StaffAuthRate
from app.services import staff_auth_service as auth
from app.services.staff_identity_service import change_identity
from app.api.staff import staff_bp
import staff_device_support as devices

ORIGIN='https://staff.example.test'
PASSWORD='offline-only-strong-password-2026'


class StaffAuthTests(unittest.TestCase):
    token=identity_tests.StaffIdentityTests.token
    create=identity_tests.StaffIdentityTests.create

    def setUp(self):
        identity_tests.StaffIdentityTests.setUp(self)
        self.app.config['STAFF_TRUSTED_ORIGINS']=(ORIGIN,)
        self.app.register_blueprint(staff_bp)
        from flask import Blueprint
        legacy=Blueprint('admin',__name__)
        legacy.add_url_rule('/legacy/users/<int:user_id>',endpoint='update_user',view_func=lambda user_id:{'legacy':True},methods=['PUT'])
        self.app.register_blueprint(legacy)
        from app.api.mini import require_cashier
        self.app.add_url_rule('/test-mini',view_func=require_cashier(lambda:{'unexpected':True}))
        devices.tables()
        db.metadata.create_all(db.engine,tables=[StaffAuthCode.__table__,StaffSession.__table__,StaffAuthRate.__table__])
        self.binding=None
        result=self.create()
        self.staff_id=result['user_id']
        change_identity(self.manager,self.employee.id,'state',{'is_active':True,'expected_version':1})

    def post(self,path,data=None,headers=None):
        return self.client.post(path,base_url=ORIGIN,json=data,headers={'Origin':ORIGIN,**(headers or {})})

    def code(self,purpose='activation'):
        response=self.post(f'/api/admin/employees/{self.employee.id}/staff-identity/codes',{'purpose':purpose},{'Authorization':'Bearer '+self.token()})
        self.assertEqual(response.status_code,201,response.json)
        self.assertEqual(response.headers['Cache-Control'],'no-store')
        return response.json['code']

    def activate(self):
        raw=self.code()
        response=self.post('/api/staff/auth/activate',{'username':'STAFF_ONE','code':raw,'password':PASSWORD})
        self.assertEqual(response.status_code,200,response.json)
        return raw

    def binding_fixture(self):
        if self.binding is None:self.binding=devices.fixture_active(db.session.get(User,self.staff_id))
        return self.binding

    def bound_post(self,path,data=None,headers=None):
        purpose={'/api/staff/auth/login':'login','/api/staff/auth/refresh':'refresh','/api/staff/auth/logout':'logout'}[path]
        return devices.proof_request(self.client,ORIGIN,self.binding_fixture(),purpose,'POST',path,data,headers)

    def me(self,access,query=''):
        return devices.proof_request(self.client,ORIGIN,self.binding_fixture(),'request','GET','/api/staff/me'+query,
            headers={'Authorization':'Bearer '+access})

    def login(self):
        response=self.bound_post('/api/staff/auth/login',{'username':'staff_one','password':PASSWORD})
        self.assertEqual(response.status_code,200,response.json)
        return response

    def cookie(self,name,path='/'):
        item=self.client.get_cookie(name,domain='staff.example.test',path=path)
        return item.value if item else None

    def csrf(self):return {'X-Staff-CSRF':self.cookie(auth.CSRF_COOKIE)}

    def test_activation_single_use_hash_storage_and_no_session_issued(self):
        raw=self.activate();item=StaffAuthCode.query.one();user=db.session.get(User,self.staff_id)
        self.assertNotEqual(item.code_hash,raw);self.assertEqual(item.code_hash,auth.digest('code:activation',raw))
        self.assertTrue(user.staff_password_initialized);self.assertTrue(user.check_password(PASSWORD));self.assertNotEqual(user.password_hash,PASSWORD)
        self.assertIsNotNone(item.consumed_at);self.assertEqual(StaffSession.query.count(),0)
        self.assertIsNone(self.cookie(auth.REFRESH_COOKIE,auth.REFRESH_PATH))
        response=self.post('/api/staff/auth/activate',{'username':'staff_one','code':raw,'password':PASSWORD})
        self.assertEqual(response.status_code,401)

    def test_operational_requests_require_approved_key_proof(self):
        self.activate()
        response=self.post('/api/staff/auth/login',{'username':'staff_one','password':PASSWORD})
        self.assertEqual(response.status_code,403);self.assertIn('device',response.json['message'].lower())
        self.assertEqual(StaffSession.query.count(),0)
        # A test-only approved-device fixture then exercises real signed proofs; unsigned calls remain closed.
        login=self.login();access=login.json['access_token']
        self.assertEqual(self.client.get('/api/staff/me',base_url=ORIGIN,headers={'Authorization':'Bearer '+access}).status_code,403)
        self.assertEqual(self.post('/api/staff/auth/refresh',headers=self.csrf()).status_code,403)

    def test_login_tokens_cookies_and_financial_allowlist(self):
        self.activate();response=self.login();data=response.json
        self.assertEqual(set(data),{'access_token','expires_in','csrf'});self.assertEqual(data['expires_in'],900)
        claims=decode_token(data['access_token']);self.assertEqual(claims['token_type'],'staff');self.assertEqual(claims['aud'],'hr-staff');self.assertEqual(claims['role'],'EMPLOYEE');self.assertEqual(claims['type'],'access')
        cookie=next(v for v in response.headers.getlist('Set-Cookie') if v.startswith(auth.REFRESH_COOKIE+'='))
        for value in ['HttpOnly','Secure','SameSite=Strict','Path=/api/staff/auth']:self.assertIn(value,cookie)
        self.assertNotIn('Domain=',cookie)
        refresh=self.cookie(auth.REFRESH_COOKIE,auth.REFRESH_PATH);session=StaffSession.query.one()
        self.assertNotEqual(session.refresh_hash,refresh);self.assertEqual(session.refresh_hash,auth.digest('refresh',refresh))
        me=self.me(data['access_token'],'?employee_id='+str(self.other.id));self.assertEqual(me.status_code,200)
        identity=me.json['identity'];self.assertEqual(identity['employee_id'],self.employee.id)
        self.assertEqual(set(identity),{'user_id','employee_id','username','full_name','employee_type','branch_id','is_active','staff_auth_version','employee_eligible'})
        self.assertNotIn('salary',str(me.json));self.assertNotIn('commission',str(me.json));self.assertEqual(me.headers['Cache-Control'],'no-store')

    def test_unknown_wrong_password_and_inactive_login_responses_match(self):
        self.activate()
        invalid={'username':'missing_user','password':'wrong-password'}
        unknown=self.post('/api/staff/auth/login',invalid)
        wrong=self.post('/api/staff/auth/login',{'username':'staff_one','password':'wrong-password'})
        user=db.session.get(User,self.staff_id);user.is_active=False;db.session.commit()
        inactive=self.post('/api/staff/auth/login',{'username':'staff_one','password':PASSWORD})
        self.assertEqual([unknown.status_code,wrong.status_code,inactive.status_code],[401,401,401]);self.assertEqual(unknown.json,wrong.json);self.assertEqual(wrong.json,inactive.json)

    def test_refresh_rotation_and_old_token_replay_revoke_entire_session(self):
        self.activate();first=self.login();old=self.cookie(auth.REFRESH_COOKIE,auth.REFRESH_PATH);csrf=self.cookie(auth.CSRF_COOKIE)
        second=self.bound_post('/api/staff/auth/refresh',headers=self.csrf());self.assertEqual(second.status_code,200)
        new=self.cookie(auth.REFRESH_COOKIE,auth.REFRESH_PATH);self.assertNotEqual(old,new)
        self.assertEqual(self.me(second.json['access_token']).status_code,200)
        self.client.set_cookie(auth.REFRESH_COOKIE,old,domain='staff.example.test',path=auth.REFRESH_PATH,secure=True)
        self.client.set_cookie(auth.CSRF_COOKIE,csrf,domain='staff.example.test',path='/',secure=True)
        replay=self.bound_post('/api/staff/auth/refresh',headers={'X-Staff-CSRF':csrf});self.assertEqual(replay.status_code,401)
        self.assertEqual(StaffSession.query.one().revoked_reason,'refresh-replay')
        self.assertEqual(self.me(first.json['access_token']).status_code,401);self.assertEqual(self.me(second.json['access_token']).status_code,401)

    def test_refresh_logout_csrf_origin_cookie_path_and_idempotent_logout(self):
        self.activate();login=self.login();access=login.json['access_token']
        self.assertEqual(self.bound_post('/api/staff/auth/refresh').status_code,403)
        self.assertEqual(self.bound_post('/api/staff/auth/refresh',headers={'X-Staff-CSRF':'wrong'}).status_code,403)
        self.assertEqual(self.bound_post('/api/staff/auth/refresh',headers={**self.csrf(),'Origin':'https://other.example'}).status_code,403)
        self.assertEqual(self.post('/api/staff/auth/logout').status_code,403)
        self.assertIsNone(StaffSession.query.one().revoked_at)
        self.assertEqual(self.bound_post('/api/staff/auth/logout',headers=self.csrf()).status_code,200)
        self.assertIsNotNone(StaffSession.query.one().revoked_at);self.assertEqual(self.me(access).status_code,401)
        self.assertIsNone(self.cookie(auth.REFRESH_COOKIE,auth.REFRESH_PATH))
        self.assertEqual(self.post('/api/staff/auth/logout').status_code,200)

    def test_recovery_revokes_all_sessions_and_codes_are_single_use(self):
        self.activate();one=self.login();two=self.login();old_version=db.session.get(User,self.staff_id).staff_auth_version
        raw=self.code('recovery');password='offline-new-strong-password-2026'
        result=self.post('/api/staff/auth/recover',{'username':'staff_one','code':raw,'password':password});self.assertEqual(result.status_code,200)
        user=db.session.get(User,self.staff_id);self.assertTrue(user.check_password(password));self.assertEqual(user.staff_auth_version,old_version+1)
        self.assertTrue(all(s.revoked_at for s in StaffSession.query.all()))
        self.assertEqual(self.me(one.json['access_token']).status_code,401);self.assertEqual(self.me(two.json['access_token']).status_code,401)
        self.assertEqual(self.post('/api/staff/auth/recover',{'username':'staff_one','code':raw,'password':password}).status_code,401)

    def test_expired_reissued_wrong_user_and_wrong_purpose_codes_rejected(self):
        first=self.code();second=self.code();data={'username':'staff_one','code':first,'password':PASSWORD}
        self.assertEqual(self.post('/api/staff/auth/activate',data).status_code,401)
        self.assertEqual(self.post('/api/staff/auth/recover',{**data,'code':second}).status_code,401)
        self.assertEqual(self.post('/api/staff/auth/activate',{**data,'username':'another_user','code':second}).status_code,401)
        item=StaffAuthCode.query.filter_by(code_hash=auth.digest('code:activation',second)).one();item.expires_at=auth.now_utc()-timedelta(seconds=1);db.session.commit()
        self.assertEqual(self.post('/api/staff/auth/activate',{**data,'code':second}).status_code,401)
        self.assertEqual(StaffSession.query.count(),0)

    def test_rate_limits_survive_failed_requests_and_store_only_key_digests(self):
        self.activate()
        for _ in range(5):self.assertEqual(self.bound_post('/api/staff/auth/login',{'username':'staff_one','password':'wrong'}).status_code,401)
        blocked=self.bound_post('/api/staff/auth/login',{'username':'staff_one','password':'wrong'});self.assertEqual(blocked.status_code,429);self.assertEqual(blocked.headers['Retry-After'],'900')
        for item in StaffAuthRate.query.all():self.assertEqual(len(item.key),64);self.assertNotIn('staff_one',item.key)

    def test_cross_application_and_role_isolation(self):
        self.activate();access=self.login().json['access_token']
        admin_url=f'/api/admin/employees/{self.employee.id}/staff-identity'
        self.assertEqual(self.client.get(admin_url,base_url=ORIGIN,headers={'Authorization':'Bearer '+access}).status_code,403)
        self.assertIn(self.client.get('/test-mini',base_url=ORIGIN,headers={'Authorization':'Bearer '+access}).status_code,(401,403))
        for marker,role in [('admin','SUPER_ADMIN'),('mini','CASHIER')]:
            token=create_access_token(identity=str(self.manager.id),additional_claims={'token_type':marker,'role':role})
            self.assertEqual(self.me(token).status_code,401)
        claims=decode_token(access)
        for key,value in [('aud','wrong-app'),('role','CASHIER'),('sid','wrong-session'),('staff_auth_version',-1)]:
            payload={k:claims[k] for k in ['token_type','aud','role','sid','staff_auth_version','device_id','cnf']};payload[key]=value
            token=create_access_token(identity=str(self.staff_id),additional_claims=payload)
            self.assertEqual(self.me(token).status_code,401)

    def test_inactive_employee_account_branch_and_expired_sessions_rejected(self):
        self.activate();access=self.login().json['access_token'];user=db.session.get(User,self.staff_id)
        for obj,key,value in [(user,'is_active',False),(self.employee,'is_active',False),(self.employee,'is_deleted',True),(self.employee,'status',EmployeeStatus.SUSPENDED),(self.branch,'is_active',False),(self.branch,'is_main_warehouse',True)]:
            previous=getattr(obj,key);setattr(obj,key,value);db.session.commit();self.assertIn(self.me(access).status_code,(401,403));setattr(obj,key,previous);db.session.commit()
        session=StaffSession.query.one();session.expires_at=auth.now_utc()-timedelta(seconds=1);db.session.commit()
        self.assertEqual(self.me(access).status_code,401);self.assertEqual(self.bound_post('/api/staff/auth/refresh',headers=self.csrf()).status_code,401)

    def test_manager_revocation_and_sensitive_code_administration_roles(self):
        self.activate();access=self.login().json['access_token']
        url=f'/api/admin/employees/{self.employee.id}/staff-identity/revoke-sessions'
        result=self.post(url,{},headers={'Authorization':'Bearer '+self.token()});self.assertEqual(result.status_code,200);self.assertEqual(self.me(access).status_code,401)
        for role in [UserRole.BRANCH_MANAGER,UserRole.STORE_MANAGER,UserRole.CASHIER,UserRole.EMPLOYEE]:
            self.manager.role=role;db.session.commit()
            result=self.post(f'/api/admin/employees/{self.employee.id}/staff-identity/codes',{'purpose':'recovery'},headers={'Authorization':'Bearer '+self.token()})
            self.assertEqual(result.status_code,403)

    def test_feature_disabled_and_https_origin_requirements(self):
        for key in ['STAFF_IDENTITY_ENABLED','STAFF_IDENTITY_OMAR_RUNTIME']:
            self.app.config[key]=False
            for path in ['/auth/login','/auth/activate','/auth/recover','/auth/refresh','/auth/logout']:
                self.assertEqual(self.post('/api/staff'+path,{}).status_code,404)
            self.assertEqual(self.me('invalid').status_code,404);self.app.config[key]=True
        self.assertEqual(StaffSession.query.count(),0)
        self.assertEqual(self.client.post('/api/staff/auth/login',base_url='http://staff.example.test',json={'username':'staff_one','password':PASSWORD},headers={'Origin':ORIGIN}).status_code,403)
        self.app.config['STAFF_TRUSTED_ORIGINS']=()
        self.assertEqual(self.post('/api/staff/auth/login',{'username':'staff_one','password':PASSWORD}).status_code,403)

    def test_expired_access_refresh_and_token_type_substitution(self):
        self.activate();access=self.login().json['access_token'];claims=decode_token(access)
        payload={k:claims[k] for k in ['token_type','aud','role','sid','staff_auth_version','device_id','cnf']}
        expired=create_access_token(identity=str(self.staff_id),additional_claims=payload,expires_delta=timedelta(seconds=-1))
        self.assertEqual(self.me(expired).status_code,401)
        token=create_refresh_token(identity=str(self.staff_id),additional_claims=payload)
        self.assertEqual(self.me(token).status_code,401)
        expired_refresh=create_refresh_token(identity=str(self.staff_id),additional_claims=payload,expires_delta=timedelta(seconds=-1))
        self.client.set_cookie(auth.REFRESH_COOKIE,expired_refresh,domain='staff.example.test',path=auth.REFRESH_PATH,secure=True)
        self.assertEqual(self.bound_post('/api/staff/auth/refresh',headers=self.csrf()).status_code,401)

    def test_legacy_password_mutation_cannot_bypass_staff_revocation_policy(self):
        url='/legacy/users/'+str(self.staff_id)
        headers={'Authorization':'Bearer '+self.token()}
        for enabled in [True,False]:
            self.app.config['STAFF_IDENTITY_ENABLED']=enabled
            response=self.client.put(url,base_url=ORIGIN,json={'password':'not-accepted'},headers=headers)
            self.assertEqual(response.status_code,409)
        self.assertEqual(self.client.put(url,base_url=ORIGIN,json={}).status_code,401)
        self.assertEqual(self.client.put('/legacy/users/'+str(self.manager.id),base_url=ORIGIN,json={},headers=headers).status_code,200)
        self.app.config['STAFF_IDENTITY_OMAR_RUNTIME']=False
        self.assertEqual(self.client.put(url,base_url=ORIGIN,json={},headers=headers).status_code,200)

    def test_code_validation_version_binding_and_inactive_rejection(self):
        raw=self.code()
        payload={'username':'staff_one','code':raw,'password':PASSWORD}
        self.assertEqual(self.post('/api/staff/auth/activate',{**payload,'password':'short'}).status_code,400)
        self.assertIsNone(StaffAuthCode.query.one().consumed_at)
        self.assertEqual(self.post('/api/staff/auth/activate',{**payload,'employee_id':self.other.id}).status_code,400)
        user=db.session.get(User,self.staff_id);user.staff_auth_version+=1;db.session.commit()
        self.assertEqual(self.post('/api/staff/auth/activate',payload).status_code,401)
        raw=self.code();user.is_active=False;db.session.commit()
        self.assertEqual(self.post('/api/staff/auth/activate',{**payload,'code':raw}).status_code,401)
        self.assertFalse(db.session.get(User,self.staff_id).staff_password_initialized)

    def test_new_migration_generates_additive_sql_without_connection(self):
        file=Path(__file__).resolve().parents[1]/'migrations/versions/zt_staff_auth_sessions.py'
        spec=importlib.util.spec_from_file_location('staff_session_migration',file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        output=StringIO()
        with Operations.context(MigrationContext.configure(dialect_name='postgresql',opts={'as_sql':True,'output_buffer':output})):module.upgrade()
        sql=output.getvalue();self.assertEqual(module.down_revision,'zs_staff_identity_foundation')
        for table in ['staff_auth_codes','staff_sessions','staff_auth_rates']:self.assertIn('CREATE TABLE '+table,sql)
        for operation in ['INSERT INTO','DELETE FROM','UPDATE ','DROP TABLE']:self.assertNotIn(operation,sql)


if __name__=='__main__':unittest.main()
