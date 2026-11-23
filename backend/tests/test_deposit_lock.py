"""Isolated in-memory tests for Phase 5: Deposit Lock.
Ensures date/time slot locking occurs if and only if an active appointment has a confirmed deposit.
"""
import sys
from pathlib import Path
import unittest
from datetime import datetime, date, time, timezone
from flask import Flask, g
from flask_jwt_extended import JWTManager

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import test_staff_identity as fixtures
from app.extensions import db
from app.models.branch import Branch
from app.models.employee import Employee, EmployeeType, EmployeeStatus
from app.models.user import User, UserRole
from app.models.customer import Customer
from app.models.customer_balance import CustomerBalance
from app.models.business_day import BusinessDay, BusinessDayStatus
from app.models.appointment import Appointment, AppointmentStatus
from app.models.appointment_deposit_transaction import (
    AppointmentDepositTransaction,
    AppointmentDepositTransactionType,
)
from app.models.service import Service
from app.models.invoice import Invoice
from app.api.mini import create_appointment, update_appointment_status


class DepositLockTests(unittest.TestCase):
    def setUp(self):
        fixtures.StaffIdentityTests.setUp(self)
        db.metadata.create_all(
            db.engine,
            tables=[
                Customer.__table__,
                CustomerBalance.__table__,
                BusinessDay.__table__,
                Invoice.__table__,
                Appointment.__table__,
                AppointmentDepositTransaction.__table__,
                Service.__table__,
            ]
        )
        self.branch2 = Branch(name='Second Branch', city='Cairo')
        db.session.add(self.branch2)
        db.session.flush()

        self.barber1 = self.employee
        self.barber2 = self.other

        self.customer1 = Customer(
            full_name='Customer One',
            phone='01011111111',
            branch_id=self.branch.id
        )
        self.customer2 = Customer(
            full_name='Customer Two',
            phone='01022222222',
            branch_id=self.branch.id
        )
        self.customer3 = Customer(
            full_name='Customer Three',
            phone='01033333333',
            branch_id=self.branch2.id
        )
        db.session.add_all([self.customer1, self.customer2, self.customer3])

        # Open business days for both branches
        self.day1 = BusinessDay(
            branch_id=self.branch.id,
            opened_by=self.barber1.id,
            opening_balance=0,
            status=BusinessDayStatus.OPEN
        )
        self.day2 = BusinessDay(
            branch_id=self.branch2.id,
            opened_by=self.barber1.id,
            opening_balance=0,
            status=BusinessDayStatus.OPEN
        )
        db.session.add_all([self.day1, self.day2])
        db.session.commit()

        self.test_date_str = '2026-11-25'
        self.test_time_str = '14:00'

    def call_create(self, branch_id, payload):
        with self.app.test_request_context('/', method='POST', json=payload):
            g.current_user = self.manager
            g.user_id = self.manager.id
            g.branch_id = branch_id
            g.cashier_id = self.barber1.id
            return create_appointment.__wrapped__()

    def call_update_status(self, branch_id, appointment_id, status_str):
        with self.app.test_request_context(f'/appointments/{appointment_id}/status', method='PATCH', json={'status': status_str}):
            g.current_user = self.manager
            g.user_id = self.manager.id
            g.branch_id = branch_id
            g.cashier_id = self.barber1.id
            return update_appointment_status.__wrapped__(appointment_id)

    def test_multiple_non_deposit_appointments_allowed_at_same_slot(self):
        """Rule 1: Multiple appointments at same branch/date/time allowed when none has deposit."""
        p1 = {
            'customer_name': 'Customer One',
            'phone': '01011111111',
            'date': self.test_date_str,
            'time': self.test_time_str,
            'deposit': 0,
            'barber_id': self.barber1.id
        }
        res1, code1 = self.call_create(self.branch.id, p1)
        self.assertEqual(code1, 201)

        p2 = {
            'customer_name': 'Customer Two',
            'phone': '01022222222',
            'date': self.test_date_str,
            'time': self.test_time_str,
            'deposit': 0,
            'barber_id': self.barber2.id
        }
        res2, code2 = self.call_create(self.branch.id, p2)
        self.assertEqual(code2, 201)

    def test_deposit_appointment_locks_slot(self):
        """Rule 2, 3, 4: Appointment with deposit locks exact date/time. Subsequent bookings fail with 409."""
        # Booking with deposit
        p1 = {
            'customer_name': 'Customer One',
            'phone': '01011111111',
            'date': self.test_date_str,
            'time': self.test_time_str,
            'deposit': 100,
            'deposit_payment_method': 'CASH',
            'barber_id': self.barber1.id
        }
        res1, code1 = self.call_create(self.branch.id, p1)
        self.assertEqual(code1, 201)
        self.assertIn('deposit_transaction', res1.get_json())

        # Attempt to create another appointment without deposit at locked slot -> 409
        p2 = {
            'customer_name': 'Customer Two',
            'phone': '01022222222',
            'date': self.test_date_str,
            'time': self.test_time_str,
            'deposit': 0,
            'barber_id': self.barber2.id
        }
        res2, code2 = self.call_create(self.branch.id, p2)
        self.assertEqual(code2, 409)
        data2 = res2.get_json()
        self.assertEqual(data2.get('error'), 'هذا الموعد محجوز ومؤكد بعربون. يرجى اختيار موعد آخر.')

        # Attempt to create another appointment with deposit at locked slot -> 409
        p3 = {
            'customer_name': 'Customer Two',
            'phone': '01022222222',
            'date': self.test_date_str,
            'time': self.test_time_str,
            'deposit': 50,
            'deposit_payment_method': 'CASH',
            'barber_id': self.barber1.id
        }
        res3, code3 = self.call_create(self.branch.id, p3)
        self.assertEqual(code3, 409)
        data3 = res3.get_json()
        self.assertEqual(data3.get('error'), 'هذا الموعد محجوز ومؤكد بعربون. يرجى اختيار موعد آخر.')

    def test_cancellation_releases_lock(self):
        """Rule 8: Cancellation releases the deposit lock."""
        p1 = {
            'customer_name': 'Customer One',
            'phone': '01011111111',
            'date': self.test_date_str,
            'time': self.test_time_str,
            'deposit': 100,
            'deposit_payment_method': 'CASH',
            'barber_id': self.barber1.id
        }
        res1, code1 = self.call_create(self.branch.id, p1)
        self.assertEqual(code1, 201)
        app_id = res1.get_json()['id']

        # Cancel the appointment
        res_cancel, code_cancel = self.call_update_status(self.branch.id, app_id, 'cancelled')
        self.assertEqual(code_cancel, 200)

        # Now slot should be open again
        p2 = {
            'customer_name': 'Customer Two',
            'phone': '01022222222',
            'date': self.test_date_str,
            'time': self.test_time_str,
            'deposit': 50,
            'deposit_payment_method': 'CASH',
            'barber_id': self.barber2.id
        }
        res2, code2 = self.call_create(self.branch.id, p2)
        self.assertEqual(code2, 201)

    def test_different_branches_independent(self):
        """Rule: Different branches can use the same appointment slot independently."""
        # Branch 1 locks slot
        p1 = {
            'customer_name': 'Customer One',
            'phone': '01011111111',
            'date': self.test_date_str,
            'time': self.test_time_str,
            'deposit': 100,
            'deposit_payment_method': 'CASH',
            'barber_id': self.barber1.id
        }
        res1, code1 = self.call_create(self.branch.id, p1)
        self.assertEqual(code1, 201)

        # Branch 2 creates booking at the same date and time -> succeeds
        p2 = {
            'customer_name': 'Customer Three',
            'phone': '01033333333',
            'date': self.test_date_str,
            'time': self.test_time_str,
            'deposit': 100,
            'deposit_payment_method': 'CASH',
            'barber_id': None
        }
        res2, code2 = self.call_create(self.branch2.id, p2)
        self.assertEqual(code2, 201)

    def test_reactivating_cancelled_appointment_checks_lock(self):
        """Reactivating a cancelled deposit appointment when slot was claimed by another deposit fails."""
        # App 1 with deposit
        p1 = {
            'customer_name': 'Customer One',
            'phone': '01011111111',
            'date': self.test_date_str,
            'time': self.test_time_str,
            'deposit': 100,
            'deposit_payment_method': 'CASH',
            'barber_id': self.barber1.id
        }
        res1, code1 = self.call_create(self.branch.id, p1)
        app1_id = res1.get_json()['id']

        # Cancel App 1
        self.call_update_status(self.branch.id, app1_id, 'cancelled')

        # App 2 claims the slot with deposit
        p2 = {
            'customer_name': 'Customer Two',
            'phone': '01022222222',
            'date': self.test_date_str,
            'time': self.test_time_str,
            'deposit': 100,
            'deposit_payment_method': 'CASH',
            'barber_id': self.barber2.id
        }
        res2, code2 = self.call_create(self.branch.id, p2)
        self.assertEqual(code2, 201)

        # Attempt to reactivate App 1 -> 409
        res_reactivate, code_reactivate = self.call_update_status(self.branch.id, app1_id, 'scheduled')
        self.assertEqual(code_reactivate, 409)
        self.assertEqual(res_reactivate.get_json().get('error'), 'هذا الموعد محجوز ومؤكد بعربون. يرجى اختيار موعد آخر.')


if __name__ == '__main__':
    unittest.main()
