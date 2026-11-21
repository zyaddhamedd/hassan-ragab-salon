"""Real signed Staff attendance API tests; isolated in-memory DB, no live factory."""
import hashlib
import math
import json
import sys
import uuid
from pathlib import Path
from datetime import datetime, date, time, timedelta, timezone
from unittest import TestCase, mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import test_staff_auth as auth_tests
import staff_device_support as support
from app.extensions import db
from app.models.user import User
from app.models.employee import Employee
from app.models.attendance import Attendance, AttendanceStatus
from app.models.business_day import BusinessDay
from app.models.employee_shift import EmployeeShiftTemplate as Template, EmployeeWeeklyShift as Weekly, EmployeeShiftOverride as Override, EmployeeShiftInstance as Instance
from app.models.staff_geofence import StaffGeofenceVersion as Geofence
from app.models.staff_attendance import StaffAttendanceReceipt as Receipt
from app.models.staff_device import StaffDeviceChallenge, StaffDevice
from app.services import staff_auth_service as auth, staff_geofence_service as geo, staff_attendance_service as service
from app.services.attendance_compatibility import close_transfer_attendance
from werkzeug.exceptions import Conflict

ORIGIN=auth_tests.ORIGIN
IN='/api/staff/attendance/check-in'
OUT='/api/staff/attendance/check-out'


class StaffAttendanceTests(TestCase):
    token=auth_tests.StaffAuthTests.token
    create=auth_tests.StaffAuthTests.create
    post=auth_tests.StaffAuthTests.post
    code=auth_tests.StaffAuthTests.code
    activate=auth_tests.StaffAuthTests.activate
    cookie=auth_tests.StaffAuthTests.cookie
    binding_fixture=auth_tests.StaffAuthTests.binding_fixture
    bound_post=auth_tests.StaffAuthTests.bound_post
    login=auth_tests.StaffAuthTests.login

    def setUp(self):
        auth_tests.StaffAuthTests.setUp(self)
        db.metadata.create_all(db.engine,tables=[BusinessDay.__table__,Attendance.__table__,Template.__table__,Weekly.__table__,Override.__table__,Instance.__table__,Geofence.__table__,Receipt.__table__])
        db.session.execute(db.text("CREATE UNIQUE INDEX uq_employee_present ON attendances(employee_id) WHERE status='PRESENT'"));db.session.commit()
        self.activate();self.access=self.login().json['access_token']
        self.now=datetime(2026,10,30,12,tzinfo=timezone.utc)
        self.clock=mock.patch.object(auth,'now_utc',side_effect=lambda:self.now);self.clock.start();self.addCleanup(self.clock.stop)
        geo.configure(self.manager,self.branch.id,dict(expected_version=0,latitude=0.,longitude=0.,radius_m=100.,max_accuracy_m=20.,max_age_seconds=30,enabled=True,reason='Explicit test-only geofence'))

    def payload(self,**changes):
        return {'idempotency_key':uuid.uuid4().hex,'location':dict(latitude=0.,longitude=0.,accuracy_m=5.,captured_at=self.now.isoformat()),**changes}

    def send(self,path=IN,data=None,**kwargs):
        return support.proof_request(self.client,ORIGIN,self.binding,'request','POST',path,data or self.payload(),
            headers={'Authorization':'Bearer '+self.access},**kwargs)

    def prepare(self,path,data):
        raw=support.encoded(data)
        response=self.post('/api/staff/auth/device-challenges',dict(device_id=self.binding[0],purpose='request',method='POST',target=path,body_hash=hashlib.sha256(raw).hexdigest()),headers={'Authorization':'Bearer '+self.access})
        self.assertEqual(response.status_code,200,response.json)
        headers={'Origin':ORIGIN,'Authorization':'Bearer '+self.access,'X-Staff-Device':self.binding[0],'DPoP':support.sign(self.binding[1],self.binding[2],response.json)}
        return raw,headers,response.json

    def raw(self,path,raw,headers):
        return self.client.post(path,base_url=ORIGIN,data=raw,content_type='application/json',headers=headers)

    def scheduled(self,d,start=time(22),end=time(2)):
        template=Template(branch_id=self.branch.id,name='Offline overnight',start_time=start,end_time=end,created_by=self.manager.id,grace_minutes=10)
        db.session.add(template);db.session.flush()
        db.session.add(Weekly(employee_id=self.employee.id,template_id=template.id,weekday=d.weekday(),effective_from=d,effective_to=d,created_by=self.manager.id));db.session.commit()

    def test_checkin_checkout_without_cashier_day_safe_response_and_receipts(self):
        result=self.send();self.assertEqual(result.status_code,200,result.json);body=result.json
        self.assertTrue(body['confirmed']);self.assertEqual(body['action'],'CHECK_IN');self.assertEqual(body['shift']['state'],'UNASSIGNED')
        self.assertTrue(body['shift']['frozen']);self.assertIsNone(body['check_out_time'])
        row=Attendance.query.one();self.assertEqual(row.attendance_origin,'STAFF_GPS');self.assertIsNone(row.business_day_id)
        self.assertEqual(auth.aware(row.check_in_time),self.now);self.assertEqual(BusinessDay.query.count(),0)
        self.now+=timedelta(hours=9)
        result=self.send(OUT,self.payload(attendance_id=row.id));self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['action'],'CHECK_OUT');self.assertEqual(result.json['shift'],body['shift'])
        db.session.refresh(row);self.assertEqual(row.checkout_verification,'STAFF_GPS_VERIFIED');self.assertIsNone(row.closure_actor_id)
        self.assertEqual(Receipt.query.count(),2);self.assertEqual(Instance.query.count(),1);self.assertEqual(BusinessDay.query.count(),0)
        receipt=Receipt.query.filter_by(action='CHECK_OUT').one();self.assertEqual(receipt.device_id,self.binding[0]);self.assertEqual(receipt.recorded_at,row.check_out_time)
        for word in ['salary','commission','payroll','latitude','longitude','accuracy_m','geofence_version','device_id','challenge_id','request_hash','closure_reason']:
            self.assertNotIn(word,json.dumps(result.json))
        self.assertNotIn('latitude',Receipt.__table__.columns);self.assertNotIn('longitude',Receipt.__table__.columns)

    def test_exact_idempotent_retries_need_fresh_proofs_and_cannot_mutate_body(self):
        data=self.payload();raw,headers,challenge=self.prepare(IN,data)
        first=self.raw(IN,raw,headers);self.assertEqual(first.status_code,200,first.json)
        self.assertEqual(self.raw(IN,raw,headers).status_code,403)
        self.now+=timedelta(seconds=31)  # Retry confirms prior commit, does not create offline attendance.
        second=self.send(IN,data);self.assertEqual(second.json,first.json)
        self.assertEqual(Attendance.query.count(),1);self.assertEqual(Receipt.query.count(),1)
        changed={**data,'location':{**data['location'],'captured_at':self.now.isoformat()}}
        self.assertEqual(self.send(IN,changed).status_code,409)
        out=self.payload(attendance_id=first.json['attendance_id']);a=self.send(OUT,out);b=self.send(OUT,out)
        self.assertEqual(a.status_code,200,a.json);self.assertEqual(a.json,b.json);self.assertEqual(Receipt.query.count(),2)
        self.assertEqual(self.send(OUT,self.payload(attendance_id=first.json['attendance_id'])).status_code,409)
        self.assertEqual(self.send(IN,self.payload(idempotency_key=out['idempotency_key'])).status_code,409)

    def test_server_identity_strict_fields_owned_target_and_duplicate_open(self):
        for data in [self.payload(employee_id=self.other.id),self.payload(branch_id=self.branch.id),self.payload(timestamp=self.now.isoformat()),self.payload(offline=True),self.payload(idempotency_key='weak')]:
            self.assertEqual(self.send(IN,data).status_code,400)
        first=self.send();self.assertEqual(first.status_code,200)
        self.assertEqual(self.send().status_code,409)
        self.assertEqual(self.send(OUT,self.payload(attendance_id=first.json['attendance_id']+99)).status_code,409)
        self.assertEqual(self.send(OUT,self.payload(attendance_id=True)).status_code,400)
        self.assertEqual(Attendance.query.count(),1);self.assertEqual(Receipt.query.count(),1)

    def test_legacy_or_administratively_closed_attendance_cannot_be_claimed(self):
        legacy=Attendance(employee_id=self.employee.id,branch_id=self.branch.id,date=self.now.date(),check_in_time=self.now,status=AttendanceStatus.PRESENT)
        db.session.add(legacy);db.session.commit()
        self.assertEqual(self.send(OUT,self.payload(attendance_id=legacy.id)).status_code,409)
        self.assertEqual(self.send().status_code,409)
        db.session.delete(legacy);db.session.commit()
        result=self.send();rid=result.json['attendance_id']
        Employee.query.filter_by(id=self.employee.id).with_for_update().one()
        close_transfer_attendance(self.employee.id,self.branch.id,self.manager,dict(attendance_id=rid,reason='Explicit manager test review',acknowledge_unverified=True),self.now)
        db.session.commit()
        before=db.session.get(Attendance,rid).check_out_time
        self.assertEqual(self.send(OUT,self.payload(attendance_id=rid)).status_code,409)
        row=db.session.get(Attendance,rid);self.assertEqual(row.checkout_verification,'ADMIN_UNVERIFIED');self.assertEqual(row.check_out_time,before)
        self.assertEqual(Receipt.query.count(),1)

    def test_delayed_checkout_does_not_close_a_new_session(self):
        first=self.send().json['attendance_id'];self.assertEqual(self.send(OUT,self.payload(attendance_id=first)).status_code,200)
        second=self.send().json['attendance_id'];self.assertNotEqual(first,second)
        self.assertEqual(self.send(OUT,self.payload(attendance_id=first)).status_code,409)
        self.assertEqual(db.session.get(Attendance,second).status,AttendanceStatus.PRESENT)

    def test_geofence_fail_closed_both_actions_and_proof_consumed_on_failure(self):
        row=geo.current(self.branch.id);row.enabled=False;db.session.commit()
        self.assertEqual(self.send().status_code,409);row.enabled=True;db.session.commit()
        for changes in [dict(captured_at=(self.now-timedelta(seconds=31)).isoformat()),dict(captured_at=(self.now+timedelta(seconds=1)).isoformat()),dict(accuracy_m=21),dict(latitude=1.)]:
            data=self.payload();data['location'].update(changes)
            raw,headers,challenge=self.prepare(IN,data)
            self.assertEqual(self.raw(IN,raw,headers).status_code,403)
            self.assertIsNotNone(db.session.get(StaffDeviceChallenge,challenge['challenge_id']).consumed_at)
            self.assertEqual(self.raw(IN,raw,headers).status_code,403)
        self.assertEqual(Instance.query.count(),0);self.assertEqual(Attendance.query.count(),0)
        first=self.send().json['attendance_id']
        for reading in [None,{},dict(latitude=0.,longitude=0.,accuracy_m=float('nan'),captured_at=self.now.isoformat())]:
            self.assertEqual(self.send(OUT,self.payload(attendance_id=first,location=reading)).status_code,400)
        row.enabled=False;db.session.commit()
        self.assertEqual(self.send(OUT,self.payload(attendance_id=first)).status_code,409)
        self.assertIsNone(db.session.get(Attendance,first).check_out_time);self.assertEqual(Receipt.query.count(),1)

    def test_both_actions_geofence_boundary_and_unconfigured_fail_closed(self):
        row=geo.current(self.branch.id);db.session.delete(row);db.session.commit()
        self.assertEqual(self.send().status_code,409)
        geo.configure(self.manager,self.branch.id,dict(expected_version=0,latitude=0.,longitude=0.,radius_m=100.,max_accuracy_m=20.,max_age_seconds=30,enabled=True,reason='Explicit restored test-only configuration'))
        data=self.payload();data['location']['latitude']=math.degrees(95.001/geo.EARTH_RADIUS_M)
        self.assertEqual(self.send(IN,data).status_code,403)
        data=self.payload();data['location']['latitude']=math.degrees(94.999/geo.EARTH_RADIUS_M)
        first=self.send(IN,data);self.assertEqual(first.status_code,200,first.json)
        checkout=self.payload(attendance_id=first.json['attendance_id']);checkout['location']['latitude']=math.degrees(95.001/geo.EARTH_RADIUS_M)
        self.assertEqual(self.send(OUT,checkout).status_code,403)
        checkout=self.payload(attendance_id=first.json['attendance_id']);checkout['location']['latitude']=math.degrees(94.999/geo.EARTH_RADIUS_M)
        self.assertEqual(self.send(OUT,checkout).status_code,200)

    def test_challenge_rejects_query_and_cross_token_substitution(self):
        data=self.payload();raw,headers,challenge=self.prepare(IN,data)
        other=self.login().json['access_token']
        self.assertEqual(self.raw(IN,raw,{**headers,'Authorization':'Bearer '+other}).status_code,403)
        for target in [IN+'?branch_id=1','https://other.example'+IN]:
            response=self.post('/api/staff/auth/device-challenges',dict(device_id=self.binding[0],purpose='request',method='POST',target=target,body_hash=hashlib.sha256(raw).hexdigest()),headers={'Authorization':'Bearer '+self.access})
            self.assertEqual(response.status_code,400)
        self.assertEqual(Attendance.query.count(),0)

    def test_proof_binds_method_target_body_token_device_and_expires(self):
        data=self.payload();raw,headers,challenge=self.prepare(IN,data)
        tampered=support.encoded({**data,'location':{**data['location'],'longitude':1.}})
        self.assertEqual(self.raw(IN,tampered,headers).status_code,403)
        self.assertEqual(self.raw(OUT,raw,headers).status_code,403)
        self.assertEqual(self.client.get(IN,base_url=ORIGIN,headers=headers).status_code,405)
        self.assertEqual(self.raw(IN,raw,{**headers,'X-Staff-Device':uuid.uuid4().hex}).status_code,403)
        self.assertEqual(self.raw(IN,raw,{**headers,'DPoP':headers['DPoP'][:-5]+'aaaaa'}).status_code,403)
        self.now+=timedelta(seconds=61)
        self.assertEqual(self.raw(IN,raw,headers).status_code,403)
        self.assertEqual(Attendance.query.count(),0)

    def test_auth_guards_revocation_and_origin(self):
        data=self.payload();raw,headers,_=self.prepare(IN,data)
        self.assertEqual(self.raw(IN,raw,{**headers,'Origin':'https://untrusted.example'}).status_code,403)
        self.assertEqual(self.raw(IN,raw,{k:v for k,v in headers.items() if k!='Authorization'}).status_code,401)
        device=db.session.get(StaffDevice,self.binding[0]);device.state='REVOKED';db.session.commit()
        self.assertEqual(self.raw(IN,raw,headers).status_code,401)
        device.state='ACTIVE';db.session.commit()
        for flag in ['STAFF_IDENTITY_ENABLED','STAFF_IDENTITY_OMAR_RUNTIME']:
            self.app.config[flag]=False;self.assertEqual(self.raw(IN,raw,headers).status_code,404);self.app.config[flag]=True
        self.assertEqual(Attendance.query.count(),0)

    def test_atomic_snapshot_attendance_receipt_rollback_does_not_unconsume_proof(self):
        data=self.payload();raw,headers,challenge=self.prepare(IN,data)
        self.app.testing=True
        with mock.patch.object(service,'response_for',side_effect=RuntimeError('Test-only forced rollback')):
            with self.assertRaises(RuntimeError):self.raw(IN,raw,headers)
        self.assertEqual(Instance.query.count(),0);self.assertEqual(Attendance.query.count(),0);self.assertEqual(Receipt.query.count(),0)
        self.assertIsNotNone(db.session.get(StaffDeviceChallenge,challenge['challenge_id']).consumed_at)
        self.assertEqual(self.raw(IN,raw,headers).status_code,403)
        self.assertEqual(self.send(IN,data).status_code,200)

    def test_overnight_autumn_dst_and_checkout_reuses_start_day_snapshot(self):
        self.now=datetime(2026,10,29,22,30,tzinfo=timezone.utc)
        self.scheduled(date(2026,10,29))
        first=self.send();self.assertEqual(first.status_code,200,first.json)
        self.assertEqual(first.json['business_date'],'2026-10-29')
        snapshot=Instance.query.one();self.assertEqual(auth.aware(snapshot.end_at)-auth.aware(snapshot.start_at),timedelta(hours=5))
        self.now+=timedelta(hours=4)
        final=self.send(OUT,self.payload(attendance_id=first.json['attendance_id']))
        self.assertEqual(final.status_code,200,final.json);self.assertEqual(final.json['shift'],first.json['shift'])
        self.assertEqual(Instance.query.count(),1)

    def test_spring_dst_and_rest_unassigned_are_not_invented_shifts(self):
        self.now=datetime(2026,4,23,22,30,tzinfo=timezone.utc);self.scheduled(date(2026,4,23))
        result=self.send();self.assertEqual(result.status_code,200,result.json)
        row=Instance.query.one();self.assertEqual(auth.aware(row.end_at)-auth.aware(row.start_at),timedelta(hours=3))
        self.send(OUT,self.payload(attendance_id=result.json['attendance_id']))
        self.now=datetime(2026,10,30,12,tzinfo=timezone.utc)
        db.session.add(Override(employee_id=self.employee.id,branch_id=self.branch.id,shift_date=self.now.date(),is_rest=True,created_by=self.manager.id));db.session.commit()
        result=self.send();self.assertEqual(result.json['shift']['state'],'REST');self.assertIsNone(result.json['shift']['start_at'])
        self.assertIsNone(result.json['shift']['end_at']);self.assertEqual(result.json['shift']['source'],'OVERRIDE')
    def test_nonexistent_dst_shift_is_not_silently_changed(self):
        self.now=datetime(2026,4,24,1,30,tzinfo=timezone.utc)
        self.scheduled(date(2026,4,24),start=time(0,30),end=time(6))
        result=self.send();self.assertEqual(result.status_code,409,result.json)
        self.assertEqual(Attendance.query.count(),0);self.assertEqual(Instance.query.count(),0)



if __name__=='__main__':
    import unittest
    unittest.main()
