"""Signed, employee-scoped current state; isolated fixtures only."""
import unittest
from datetime import timedelta
import test_staff_attendance as fixtures
import staff_device_support as support
from app.extensions import db
from app.models.attendance import Attendance, AttendanceStatus
from app.models.employee_shift import EmployeeShiftInstance as Instance
from app.models.staff_attendance import StaffAttendanceReceipt as Receipt
from app.models.staff_device import StaffDevice
from app.models.branch import Branch
from app.services.attendance_compatibility import close_transfer_attendance

CURRENT='/api/staff/attendance/current'


class CurrentAttendanceTests(unittest.TestCase):
    def setUp(self):fixtures.StaffAttendanceTests.setUp(self)
    def read(self,query=''):
        return support.proof_request(self.client,fixtures.ORIGIN,self.binding,'request','GET',CURRENT+query,
            headers={'Authorization':'Bearer '+self.access})

    def test_none_is_read_only_no_implicit_shift_or_attendance(self):
        response=self.read();self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['state'],'NONE');self.assertTrue(response.json['check_in_eligible']);self.assertFalse(response.json['checkout_eligible'])
        self.assertIsNone(response.json['attendance']);self.assertEqual(Attendance.query.count(),0);self.assertEqual(Instance.query.count(),0)
        self.assertEqual(response.headers['Cache-Control'],'no-store')

    def test_open_recovery_is_owned_and_safe_and_does_not_mutate(self):
        payload=self.payload();created=self.send(data=payload);self.assertEqual(created.status_code,200,created.json)
        row=Attendance.query.one();before=(row.updated_at,row.check_out_time,Receipt.query.count(),Instance.query.count())
        response=self.read('?operation='+payload['idempotency_key']);self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['state'],'OPEN');self.assertTrue(response.json['checkout_eligible'])
        self.assertEqual(response.json['attendance']['attendance_id'],row.id);self.assertEqual(response.json['attendance']['shift'],created.json['shift'])
        self.assertEqual(response.json['recovery'],dict(action='CHECK_IN',attendance_id=row.id,committed=True))
        self.assertEqual(before,(row.updated_at,row.check_out_time,Receipt.query.count(),Instance.query.count()))
        for field in ['latitude','longitude','accuracy','request_hash','challenge','device_id','salary','commission','closure_reason','closure_actor']:
            self.assertNotIn(field,str(response.json))

    def test_closed_and_administrative_unverified_closure(self):
        rid=self.send().json['attendance_id'];out=self.payload(attendance_id=rid)
        self.assertEqual(self.send(fixtures.OUT,out).status_code,200)
        response=self.read('?operation='+out['idempotency_key']);self.assertEqual(response.json['state'],'CLOSED')
        self.assertEqual(response.json['attendance']['closure'],'GPS_VERIFIED');self.assertFalse(response.json['checkout_eligible'])
        rid=self.send().json['attendance_id']
        close_transfer_attendance(self.employee.id,self.branch.id,self.manager,dict(attendance_id=rid,reason='Private manager-only reason',acknowledge_unverified=True),self.now)
        db.session.commit();response=self.read();self.assertEqual(response.json['attendance']['closure'],'ADMIN_UNVERIFIED')
        self.assertNotIn('Private manager-only reason',str(response.json));self.assertFalse(response.json['checkout_eligible'])

    def test_branch_mismatch_missing_evidence_and_legacy_never_enable_checkout(self):
        row=Attendance(employee_id=self.employee.id,branch_id=self.branch.id,date=self.now.date(),check_in_time=self.now,status=AttendanceStatus.PRESENT,attendance_origin='STAFF_GPS')
        db.session.add(row);db.session.commit()
        self.assertEqual(self.read().json['state'],'REVIEW_REQUIRED')
        db.session.delete(row);db.session.commit()
        row=Attendance(employee_id=self.employee.id,branch_id=self.branch.id,date=self.now.date(),check_in_time=self.now,status=AttendanceStatus.PRESENT)
        db.session.add(row);db.session.commit();result=self.read().json
        self.assertEqual(result['state'],'BLOCKED_LEGACY');self.assertIsNone(result['attendance']);self.assertFalse(result['checkout_eligible'])
        db.session.delete(row);db.session.commit();self.send()
        branch=Branch(name='Private other branch',city='Giza');db.session.add(branch);db.session.flush();self.employee.branch_id=branch.id;db.session.commit()
        result=self.read().json;self.assertEqual(result['state'],'REVIEW_REQUIRED');self.assertFalse(result['checkout_eligible'])

    def test_other_employee_and_operation_reference_isolation_and_parameter_rejection(self):
        row=Attendance(employee_id=self.other.id,branch_id=self.branch.id,date=self.now.date(),check_in_time=self.now,status=AttendanceStatus.PRESENT,attendance_origin='STAFF_GPS')
        db.session.add(row);db.session.commit();self.assertEqual(self.read().json['state'],'NONE')
        self.assertIsNone(self.read('?operation='+'a'*32).json['recovery'])
        for query in ['?employee_id='+str(self.other.id),'?branch_id=1','?operation=bad','?operation='+'a'*32+'&operation='+'b'*32]:
            self.assertEqual(self.read(query).status_code,400)

    def test_device_revocation_and_feature_guards(self):
        device=db.session.get(StaffDevice,self.binding[0]);device.state='REVOKED';db.session.commit()
        self.assertIn(self.read().status_code,[401,403]);device.state='ACTIVE';db.session.commit()
        for flag in ['STAFF_IDENTITY_ENABLED','STAFF_IDENTITY_OMAR_RUNTIME']:
            self.app.config[flag]=False;self.assertEqual(self.read().status_code,404);self.app.config[flag]=True


for name in ('token','create','post','code','activate','cookie','binding_fixture','bound_post','login','payload','send','prepare','raw'):
    setattr(CurrentAttendanceTests,name,getattr(fixtures.StaffAttendanceTests,name))
