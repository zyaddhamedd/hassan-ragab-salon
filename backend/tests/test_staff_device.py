"""Real ES256 signatures and official Staff enrollment routes; no proof bypass."""
import hashlib
import importlib.util
from io import StringIO
import json
from pathlib import Path
import unittest
import uuid
from datetime import timedelta
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError
import test_staff_auth as auth_tests
import staff_device_support as support
from app.extensions import db
from app.models.user import User,UserRole
from app.models.staff_auth import StaffSession,StaffAuthRate
from app.models.staff_device import StaffDevice,StaffDeviceAudit,StaffDeviceChallenge,StaffEnrollmentGrant
from app.services import staff_auth_service as auth
from app.services.staff_identity_service import change_identity

ORIGIN=auth_tests.ORIGIN;PASSWORD=auth_tests.PASSWORD


class StaffDeviceTests(unittest.TestCase):
    token=auth_tests.StaffAuthTests.token
    create=auth_tests.StaffAuthTests.create
    post=auth_tests.StaffAuthTests.post
    code=auth_tests.StaffAuthTests.code
    cookie=auth_tests.StaffAuthTests.cookie
    csrf=auth_tests.StaffAuthTests.csrf
    binding_fixture=auth_tests.StaffAuthTests.binding_fixture
    bound_post=auth_tests.StaffAuthTests.bound_post
    login=auth_tests.StaffAuthTests.login
    me=auth_tests.StaffAuthTests.me

    def setUp(self):auth_tests.StaffAuthTests.setUp(self)

    def new_enrollment(self):
        user=db.session.get(User,self.staff_id)
        purpose='recovery' if user.staff_password_initialized else 'activation'
        response=self.post('/api/staff/auth/'+('recover' if purpose=='recovery' else 'activate'),
            {'username':'staff_one','code':self.code(purpose),'password':PASSWORD})
        self.assertEqual(response.status_code,200,response.json)
        grant=response.json['enrollment_grant'];key,jwk=support.key_pair()
        result=self.post('/api/staff/device-enrollments',{'enrollment_grant':grant,'public_jwk':jwk})
        self.assertEqual(result.status_code,201,result.json)
        return (result.json['device_id'],key,jwk),grant

    def approve(self,binding,replace=None):
        return self.post(f'/api/admin/employees/{self.employee.id}/staff-devices/{binding[0]}/approve',
            {'replace_device_id':replace,'reason':'Offline verified manager decision'},headers={'Authorization':'Bearer '+self.token()})

    def finish(self,binding):
        return support.proof_request(self.client,ORIGIN,binding,'finalize','POST','/api/staff/device-enrollments/'+binding[0]+'/finalize',{})

    def active(self):
        binding,_=self.new_enrollment();self.assertEqual(self.approve(binding).status_code,200)
        self.assertEqual(self.finish(binding).status_code,200);self.binding=binding;return binding

    def challenge(self,binding,purpose='login',target='/api/staff/auth/login',data=None,headers=None):
        return self.post('/api/staff/auth/device-challenges',{'device_id':binding[0],'purpose':purpose,
            'method':'POST' if purpose!='request' else 'GET','target':target,
            'body_hash':hashlib.sha256(support.encoded(data)).hexdigest()},headers=headers)

    def raw_login(self,binding,proof,data=None):
        return self.client.post('/api/staff/auth/login',base_url=ORIGIN,data=support.encoded(data or {'username':'staff_one','password':PASSWORD}),
            content_type='application/json',headers={'Origin':ORIGIN,'X-Staff-Device':binding[0],'DPoP':proof})

    def test_activation_bound_pending_approval_finalization_and_no_session_before_finalization(self):
        binding,raw=self.new_enrollment()
        self.assertEqual(StaffSession.query.count(),0);self.assertEqual(db.session.get(StaffDevice,binding[0]).state,'PENDING')
        self.assertEqual(self.challenge(binding).status_code,403)
        self.assertEqual(self.finish(binding).status_code,403)
        reused=self.post('/api/staff/device-enrollments',{'enrollment_grant':raw,'public_jwk':support.key_pair()[1]})
        self.assertEqual(reused.status_code,401)
        self.assertEqual(self.approve(binding).status_code,200);self.assertEqual(self.finish(binding).status_code,200)
        self.assertEqual(StaffSession.query.count(),0);self.binding=binding
        response=self.login();self.assertEqual(self.me(response.json['access_token']).status_code,200)
        device=db.session.get(StaffDevice,binding[0]);self.assertNotIn('"d"',device.public_jwk)
        self.assertEqual(device.approved_by,self.manager.id);self.assertIsNotNone(device.approved_at)
        self.assertEqual([x.action for x in StaffDeviceAudit.query.order_by(StaffDeviceAudit.id).all()],['requested','approved','finalized'])

    def test_private_key_and_unbound_grant_rejected(self):
        raw=self.code();activation=self.post('/api/staff/auth/activate',{'username':'staff_one','code':raw,'password':PASSWORD})
        grant=activation.json['enrollment_grant'];key,jwk=support.key_pair()
        self.assertEqual(self.post('/api/staff/device-enrollments',{'enrollment_grant':grant,'public_jwk':{**jwk,'d':'private-material'}}).status_code,400)
        self.assertEqual(self.post('/api/staff/device-enrollments',{'enrollment_grant':'not-a-grant','public_jwk':jwk}).status_code,401)
        result=self.post('/api/staff/device-enrollments',{'enrollment_grant':grant,'public_jwk':jwk});self.assertEqual(result.status_code,201)
        self.assertNotEqual(StaffEnrollmentGrant.query.one().grant_hash,grant)

    def test_proof_replay_signature_body_method_uri_and_time_rejected(self):
        binding=self.active();data={'username':'staff_one','password':PASSWORD}
        for changes in [{'htm':'GET'},{'htu':ORIGIN+'/api/staff/me'},{'body_hash':'0'*64},{'ath':'wrong'}, {'iat':0}]:
            StaffAuthRate.query.delete();db.session.commit()  # Independent attack cases, not a runtime limiter bypass.
            challenge=self.challenge(binding,data=data);self.assertEqual(challenge.status_code,200)
            proof=support.sign(binding[1],binding[2],challenge.json,changes)
            self.assertEqual(self.raw_login(binding,proof,data).status_code,403)
        StaffAuthRate.query.delete();db.session.commit()
        challenge=self.challenge(binding,data=data)
        wrong_key,wrong_jwk=support.key_pair();proof=support.sign(wrong_key,wrong_jwk,challenge.json)
        self.assertEqual(self.raw_login(binding,proof,data).status_code,403)
        proof=support.sign(binding[1],binding[2],challenge.json)
        success=self.raw_login(binding,proof,data);self.assertEqual(success.status_code,200)
        replay=self.raw_login(binding,proof,data);self.assertEqual(replay.status_code,403)
        self.assertEqual(StaffSession.query.count(),1)

    def test_expired_challenge_and_jti_reuse_across_fresh_challenges_rejected(self):
        binding=self.active();data={'username':'staff_one','password':PASSWORD}
        response=self.challenge(binding,data=data);item=db.session.get(StaffDeviceChallenge,response.json['challenge_id'])
        item.expires_at=auth.now_utc()-timedelta(seconds=1);db.session.commit()
        self.assertEqual(self.raw_login(binding,support.sign(binding[1],binding[2],response.json),data).status_code,403)
        jti=uuid.uuid4().hex
        first=self.challenge(binding,data=data);self.assertEqual(self.raw_login(binding,support.sign(binding[1],binding[2],first.json,{'jti':jti}),data).status_code,200)
        second=self.challenge(binding,data=data);self.assertEqual(self.raw_login(binding,support.sign(binding[1],binding[2],second.json,{'jti':jti}),data).status_code,403)

    def test_replacement_requires_explicit_old_device_and_revokes_old_sessions(self):
        old=self.active();self.login()
        new,_=self.new_enrollment() # Recovery revokes previous sessions; old approved key may log in again.
        self.binding=old;old_access=self.login().json['access_token']
        self.assertEqual(self.approve(new).status_code,409)
        self.assertEqual(self.approve(new,old[0]).status_code,200)
        self.assertEqual(self.me(old_access).status_code,200)
        self.assertEqual(self.finish(new).status_code,200)
        self.assertEqual(db.session.get(StaffDevice,old[0]).state,'REPLACED')
        self.assertEqual(db.session.get(StaffDevice,old[0]).replaced_by_id,new[0])
        self.assertTrue(all(x.revoked_at for x in StaffSession.query.filter_by(device_id=old[0])))
        self.assertIn(self.me(old_access).status_code,(401,403))
        self.binding=new;self.assertEqual(self.me(self.login().json['access_token']).status_code,200)
        self.assertEqual(StaffDevice.query.filter_by(employee_id=self.employee.id,state='ACTIVE').count(),1)

    def test_revocation_and_normal_logout_keep_proof_state_distinct(self):
        binding=self.active();access=self.login().json['access_token']
        self.assertEqual(self.bound_post('/api/staff/auth/logout',headers=self.csrf()).status_code,200)
        self.assertEqual(db.session.get(StaffDevice,binding[0]).state,'ACTIVE')
        self.assertEqual(self.me(access).status_code,401)
        access=self.login().json['access_token']
        response=self.post(f'/api/admin/employees/{self.employee.id}/staff-devices/{binding[0]}/revoke',{'reason':'Lost personal browser'},headers={'Authorization':'Bearer '+self.token()})
        self.assertEqual(response.status_code,200);self.assertEqual(self.me(access).status_code,403)
        device=db.session.get(StaffDevice,binding[0]);self.assertEqual(device.revoked_by,self.manager.id)
        self.assertIsNotNone(device.revoked_at)
        self.assertEqual(self.post('/api/staff/auth/logout',headers=self.csrf()).status_code,200)

    def test_database_one_active_device_and_manager_role_enforcement(self):
        active=self.active();key,jwk=support.key_pair()
        from app.services.mini_device_proof_service import public_jwk_thumbprint
        conflict=StaffDevice(id=uuid.uuid4().hex,user_id=self.staff_id,employee_id=self.employee.id,state='ACTIVE',public_jwk=json.dumps(jwk),thumbprint=public_jwk_thumbprint(jwk),enrollment_auth_version=1)
        db.session.add(conflict)
        with self.assertRaises(IntegrityError):db.session.flush()
        db.session.rollback()
        for role in [UserRole.BRANCH_MANAGER,UserRole.STORE_MANAGER,UserRole.CASHIER,UserRole.EMPLOYEE]:
            self.manager.role=role;db.session.commit()
            result=self.post(f'/api/admin/employees/{self.employee.id}/staff-devices/{active[0]}/revoke',{'reason':'Not allowed'},headers={'Authorization':'Bearer '+self.token()})
            self.assertEqual(result.status_code,403)

    def test_cross_employee_device_selection_and_unknown_device_fail_closed(self):
        binding=self.active()
        result=self.post(f'/api/admin/employees/{self.other.id}/staff-devices/{binding[0]}/revoke',{'reason':'Wrong owner'},headers={'Authorization':'Bearer '+self.token()})
        self.assertEqual(result.status_code,404)
        self.assertEqual(self.challenge(('0'*32,binding[1],binding[2])).status_code,403)
        # Token owner and session device cannot be changed just by supplying another device ID.
        self.binding=binding;access=self.login().json['access_token']
        from flask_jwt_extended import create_access_token,decode_token
        claims=decode_token(access)
        forged={k:claims[k] for k in ['token_type','aud','role','sid','staff_auth_version','device_id','cnf']};forged['device_id']='0'*32
        wrong=create_access_token(identity=str(self.staff_id),additional_claims=forged)
        self.assertEqual(self.me(wrong).status_code,401)

    def test_protected_read_consumes_proof_durably_and_query_is_bound(self):
        binding=self.active();access=self.login().json['access_token']
        target='/api/staff/me?employee_id='+str(self.other.id)
        challenge=self.challenge(binding,purpose='request',target=target,headers={'Authorization':'Bearer '+access})
        self.assertEqual(challenge.status_code,200)
        proof=support.sign(binding[1],binding[2],challenge.json)
        headers={'Origin':ORIGIN,'Authorization':'Bearer '+access,'X-Staff-Device':binding[0],'DPoP':proof}
        first=self.client.get(target,base_url=ORIGIN,headers=headers)
        self.assertEqual(first.status_code,200);self.assertEqual(first.json['identity']['employee_id'],self.employee.id)
        self.assertEqual(self.client.get(target,base_url=ORIGIN,headers=headers).status_code,403)
        self.assertIsNotNone(db.session.get(StaffDeviceChallenge,challenge.json['challenge_id']).consumed_at)
        # A valid signature for one query cannot authorize a different query.
        challenge=self.challenge(binding,purpose='request',target=target,headers={'Authorization':'Bearer '+access})
        proof=support.sign(binding[1],binding[2],challenge.json)
        self.assertEqual(self.client.get('/api/staff/me',base_url=ORIGIN,headers={**headers,'DPoP':proof}).status_code,403)

    def test_recovery_invalidates_pending_device_approval(self):
        binding,_=self.new_enrollment();self.assertEqual(self.approve(binding).status_code,200)
        raw=self.code('recovery')
        response=self.post('/api/staff/auth/recover',{'username':'staff_one','code':raw,'password':PASSWORD})
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.finish(binding).status_code,403)
        self.assertEqual(self.approve(binding).status_code,409)

    def test_new_device_migration_offline_and_default_guard(self):
        path=Path(__file__).resolve().parents[1]/'migrations/versions/zu_staff_personal_devices.py'
        spec=importlib.util.spec_from_file_location('staff_device_migration',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        output=StringIO()
        with Operations.context(MigrationContext.configure(dialect_name='postgresql',opts={'as_sql':True,'output_buffer':output})):module.upgrade()
        sql=output.getvalue();self.assertEqual(module.down_revision,'zt_staff_auth_sessions')
        self.assertIn('CREATE UNIQUE INDEX uq_staff_active_device_employee',sql);self.assertIn("WHERE state='ACTIVE'",sql)
        self.assertNotIn('INSERT INTO',sql)
        self.app.config['STAFF_IDENTITY_ENABLED']=False
        self.assertEqual(self.post('/api/staff/device-enrollments',{}).status_code,404)


if __name__=='__main__':unittest.main()
