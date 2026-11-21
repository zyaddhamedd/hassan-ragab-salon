"""Offline compatibility/API tests. Never construct the live application factory."""
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
from datetime import datetime, timezone
from decimal import Decimal
from flask import g
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import test_staff_identity as fixtures
from app.extensions import db
from app.models.attendance import Attendance, AttendanceStatus, AttendanceCheckoutSource
from app.models.business_day import BusinessDay, BusinessDayStatus
from app.models.employee_overtime import EmployeeOvertime
from app.models.employee_document import EmployeeDocument
from app.models.employee_transfer import EmployeeTransfer
from app.models.branch import Branch
from app.models.user import UserRole
from app.models.expense import Expense
from app.models.expense_category import ExpenseCategory
from app.api.admin import transfer_employee
from app.api.mini import check_in_employee, check_out_employee, close_business_day, get_today_attendance


class AttendanceCompatibilityTests(unittest.TestCase):
    def setUp(self):
        fixtures.StaffIdentityTests.setUp(self)
        db.metadata.create_all(db.engine, tables=[EmployeeOvertime.__table__, EmployeeDocument.__table__, BusinessDay.__table__, Attendance.__table__, EmployeeTransfer.__table__, ExpenseCategory.__table__, Expense.__table__])
        self.destination = Branch(name='Offline destination', city='Giza')
        db.session.add(self.destination); db.session.flush()
        self.day = BusinessDay(branch_id=self.branch.id, opened_by=self.employee.id, opening_balance=0)
        db.session.add(self.day); db.session.commit()
        self.now = datetime.now(timezone.utc)

    def attendance(self, origin=None):
        row = Attendance(employee_id=self.employee.id, branch_id=self.branch.id, business_day_id=self.day.id,
            date=self.now.date(), check_in_time=self.now, status=AttendanceStatus.PRESENT, attendance_origin=origin)
        db.session.add(row); db.session.commit(); return row

    def review(self, row):
        return dict(attendance_id=row.id, reason='Transfer requires attendance investigation', acknowledge_unverified=True)

    def call(self, view, data=None, **kwargs):
        # Exercise route logic with an already authenticated, scoped principal;
        # auth/device middleware has its own existing regression suites.
        with self.app.test_request_context('/', method='POST' if data is not None else 'GET', json=data):
            g.current_user=self.manager; g.branch_id=self.branch.id; g.cashier_id=self.employee.id
            return view.__wrapped__(**kwargs)

    def transfer(self, review=None):
        data={'branch_id':self.destination.id}
        if review is not None:data['attendance_closure_review']=review
        return self.call(transfer_employee,data,employee_id=self.employee.id)

    def test_legacy_transfer_and_serializers_unchanged_with_staff_off(self):
        self.app.config['STAFF_IDENTITY_ENABLED']=False
        row=self.attendance();before=set(row.to_dict())
        response,status=self.transfer();self.assertEqual(status,200)
        self.assertEqual(row.status,AttendanceStatus.LEFT);self.assertEqual(row.checkout_source,AttendanceCheckoutSource.ADMIN_CORRECTION)
        self.assertIsNone(row.checkout_verification);self.assertIsNone(row.closure_reason)
        self.assertEqual(set(row.to_dict()),before);self.assertNotIn('closure_reason',str(response.json))
        self.assertEqual(EmployeeTransfer.query.count(),1)

    def test_staff_transfer_requires_explicit_manager_review_and_audits(self):
        row=self.attendance('STAFF_GPS')
        self.assertEqual(self.transfer()[1],409);self.assertEqual(EmployeeTransfer.query.count(),0)
        self.assertEqual(self.employee.branch_id,self.branch.id);self.assertIsNone(row.check_out_time)
        self.assertEqual(self.transfer(self.review(row))[1],200)
        self.assertEqual(row.checkout_verification,'ADMIN_UNVERIFIED');self.assertTrue(row.closure_review_required)
        self.assertEqual(row.closure_actor_id,self.manager.id);self.assertEqual(row.closure_reason,self.review(row)['reason'])
        self.assertIsNotNone(row.closure_recorded_at);self.assertEqual(row.checkout_source,AttendanceCheckoutSource.ADMIN_CORRECTION)
        self.assertNotIn('closure_reason',row.to_dict());self.assertNotIn('closure_actor_id',row.to_dict())
        audit=(row.closure_reason,row.closure_recorded_at,row.check_out_time)
        self.assertEqual(self.transfer(self.review(row))[1],400)
        self.assertEqual(audit,(row.closure_reason,row.closure_recorded_at,row.check_out_time))

    def test_guard_roles_bad_review_and_branch_authorization(self):
        row=self.attendance('STAFF_GPS')
        for key in ['STAFF_IDENTITY_ENABLED','STAFF_IDENTITY_OMAR_RUNTIME']:
            self.app.config[key]=False;self.assertEqual(self.transfer(self.review(row))[1],404);self.app.config[key]=True
        self.manager.role=UserRole.STORE_MANAGER
        self.assertEqual(self.transfer(self.review(row))[1],403)
        self.manager.role=UserRole.BRANCH_MANAGER;self.manager.branch_id=self.branch.id
        self.assertEqual(self.transfer(self.review(row))[1],403)
        self.manager.role=UserRole.SUPER_ADMIN
        for review in [dict(self.review(row),attendance_id=row.id+1),dict(self.review(row),acknowledge_unverified=False)]:
            self.assertEqual(self.transfer(review)[1],409)
        self.assertEqual(self.transfer(dict(self.review(row),reason=' '))[1],400)
        self.assertEqual(EmployeeTransfer.query.count(),0)

    def test_mismatched_source_and_stale_review_rejected(self):
        row=self.attendance('STAFF_GPS');row.branch_id=self.destination.id;db.session.commit()
        self.assertEqual(self.transfer(self.review(row))[1],409)
        row.branch_id=self.branch.id;row.check_out_time=self.now;row.status=AttendanceStatus.LEFT
        row.checkout_verification='STAFF_GPS_VERIFIED';db.session.commit()
        self.assertEqual(self.transfer(self.review(row))[1],409)
        self.assertEqual(row.checkout_verification,'STAFF_GPS_VERIFIED')

    def test_legacy_checkin_checkout_and_repeat(self):
        response,status=self.call(check_in_employee,{'employee_id':self.employee.id});self.assertEqual(status,201)
        row=Attendance.query.one();self.assertIsNone(row.attendance_origin)
        self.assertEqual(self.call(check_in_employee,{'employee_id':self.employee.id})[1],400)
        response,status=self.call(check_out_employee,{'employee_id':self.employee.id});self.assertEqual(status,200)
        self.assertEqual(response.json['checkout_source'],'MANUAL');self.assertNotIn('closure_reason',response.json)
        self.assertEqual(self.call(check_out_employee,{'employee_id':self.employee.id})[1],400)

    def test_cashier_cannot_close_staff_even_when_feature_off(self):
        row=self.attendance('STAFF_GPS');self.app.config['STAFF_IDENTITY_ENABLED']=False
        self.assertEqual(self.call(check_out_employee,{'employee_id':self.employee.id})[1],409)
        self.assertIsNone(row.check_out_time)

    def test_existing_admin_and_mini_attendance_feeds_hide_closure_evidence(self):
        from app.utils.admin_attendance_workspace import build_attendance_workspace_payload
        row=self.attendance('STAFF_GPS')
        response,status=self.call(get_today_attendance)
        self.assertEqual(status,200)
        self.assertNotIn('attendance_origin',str(response.json))
        self.assertEqual(self.transfer(self.review(row))[1],200)
        for payload in [row.to_dict(),build_attendance_workspace_payload(self.day),self.call(get_today_attendance)[0].json]:
            for field in ['attendance_origin','checkout_verification','closure_actor_id','closure_reason','closure_recorded_at','closure_review_required']:
                self.assertNotIn(field,str(payload))
            self.assertNotIn('Transfer requires attendance investigation',str(payload))

    def close_day(self):
        combined={k:Decimal('0') for k in ['cash_in','visa_in','instapay_in','visa_collected','instapay_collected']}
        snapshot=dict(invoice_collections=combined,appointment_deposit_collections=combined,combined=combined,invoice_total=0,deposit_total=0,combined_total=0)
        with patch('app.api.mini.build_business_day_collection_snapshot',return_value=snapshot):
            return self.call(close_business_day,{'actual_balance':0})

    def test_business_day_legacy_close_and_staff_block_rollback(self):
        row=self.attendance('STAFF_GPS');self.assertEqual(self.close_day()[1],409)
        self.assertEqual(self.day.status,BusinessDayStatus.OPEN);self.assertIsNone(row.check_out_time)
        db.session.delete(row);db.session.commit()  # SQLite fixture only, no production trigger.
        row=self.attendance();response,status=self.close_day();self.assertEqual(status,200,response.json)
        self.assertEqual(row.checkout_source,AttendanceCheckoutSource.BUSINESS_DAY_CLOSE)
        self.assertEqual(response.json['auto_checked_out_count'],1)


if __name__=='__main__': unittest.main()
