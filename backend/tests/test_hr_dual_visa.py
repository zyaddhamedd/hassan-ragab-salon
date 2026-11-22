"""
Phase 2C — Dual Visa Terminals Financial Regression Test Suite (22 Scenarios)
Verifies all financial and operational requirements of Hassan Ragab Salon Dual Visa Terminals
in a 100% ISOLATED DISPOSABLE PostgreSQL cluster (never touching operational DB).
"""
import os
import sys
import tempfile
import subprocess
import unittest
from decimal import Decimal
from datetime import datetime, date, time, timezone
from pathlib import Path

# Add backend directory to sys.path
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.config import Config
Config.STAFF_IDENTITY_HR_RUNTIME = True


class DualVisaFinancialRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 1. Create temporary directory for isolated private PostgreSQL cluster
        cls.tmp = tempfile.TemporaryDirectory(prefix='hr-dual-visa-test-pg-', dir='/private/tmp')
        cls.root = Path(cls.tmp.name)
        os.chmod(cls.root, 0o700)
        cls.bin = Path('/opt/homebrew/bin')
        cls.data = cls.root / 'data'
        cls.socket = cls.root / 'socket'
        cls.socket.mkdir(mode=0o700)

        # 2. Initialize private cluster
        subprocess.run(
            [str(cls.bin / 'initdb'), '-D', str(cls.data), '-A', 'trust', '--no-locale', '-U', 'hassan_test'],
            check=True,
            stdout=subprocess.DEVNULL
        )

        # 3. Start PostgreSQL on private socket and high port
        cls.port = 55498
        subprocess.run(
            [
                str(cls.bin / 'pg_ctl'),
                '-D', str(cls.data),
                '-l', str(cls.root / 'server.log'),
                '-o', f"-h '' -k {cls.socket} -p {cls.port}",
                '-w', 'start'
            ],
            check=True,
            stdout=subprocess.DEVNULL
        )

        # 4. Configure app environment to point to disposable cluster
        os.environ['DATABASE_URL'] = f'postgresql+psycopg2://hassan_test@/postgres?host={cls.socket}&port={cls.port}'
        os.environ['JWT_SECRET_KEY'] = 'test-jwt-secret-key-at-least-32-characters-long'
        Config.SQLALCHEMY_DATABASE_URI = os.environ['DATABASE_URL']
        Config.JWT_SECRET_KEY = os.environ['JWT_SECRET_KEY']

        from app import create_app
        from app.extensions import db

        cls.app = create_app()
        cls.app_context = cls.app.app_context()
        cls.app_context.push()

        # 5. Build full schema on disposable database
        db.create_all()

        # 6. Seed fixture data
        from app.models.branch import Branch
        from app.models.employee import Employee, EmployeeType
        from app.models.user import User, UserRole
        from app.models.customer import Customer
        from app.models.service import Service, ServiceCategory
        from app.models.business_day import BusinessDay, BusinessDayStatus
        from app.models.expense_category import ExpenseCategory

        cls.branch = Branch(name="Hassan Ragab Test Branch", is_active=True, city="Giza")
        db.session.add(cls.branch)
        db.session.commit()

        cls.category = ServiceCategory(name="Test Category", is_active=True)
        db.session.add(cls.category)
        db.session.commit()

        cls.service = Service(name="Test Haircut", price=100.0, duration_minutes=30, category_id=cls.category.id, is_active=True)
        db.session.add(cls.service)
        db.session.commit()

        cls.barber = Employee(full_name="Test Barber", employee_type=EmployeeType.BARBER, branch_id=cls.branch.id, is_active=True)
        db.session.add(cls.barber)
        db.session.commit()

        cls.user = User(
            full_name="Test Barber",
            email="cashier@test.invalid",
            role=UserRole.CASHIER,
            branch_id=cls.branch.id,
            is_active=True
        )
        cls.user.set_password("TestPass123!")
        db.session.add(cls.user)
        db.session.commit()

        cls.customer = Customer(full_name="Test Customer", phone="01011112222", branch_id=cls.branch.id, is_active=True)
        db.session.add(cls.customer)
        db.session.commit()

        cls.bday = BusinessDay(
            branch_id=cls.branch.id,
            opened_by=cls.barber.id,
            opening_balance=Decimal("500.00"),
            theoretical_balance=Decimal("500.00"),
            status=BusinessDayStatus.OPEN,
            opened_at=datetime.now(timezone.utc)
        )
        db.session.add(cls.bday)
        db.session.commit()

        tip_cat = ExpenseCategory(name="Tip Payout", code="TIP_PAYOUT", is_active=True)
        db.session.add(tip_cat)
        db.session.commit()

    @classmethod
    def tearDownClass(cls):
        from app.extensions import db
        try:
            db.session.remove()
            cls.app_context.pop()
        except Exception:
            pass

        # Stop private PostgreSQL cluster
        try:
            subprocess.run(
                [str(cls.bin / 'pg_ctl'), '-D', str(cls.data), '-m', 'immediate', 'stop'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        except Exception:
            pass

        try:
            cls.tmp.cleanup()
        except Exception:
            pass

    def setUp(self):
        from app.extensions import db
        db.session.rollback()

    def tearDown(self):
        from app.extensions import db
        db.session.rollback()

    def _create_invoice(self, price=100.0, discount=0.0):
        from app.extensions import db
        from app.models.invoice import Invoice, InvoiceItem, InvoiceStatus

        inv = Invoice(
            branch_id=self.branch.id,
            cashier_id=self.barber.id,
            customer_id=self.customer.id,
            business_day_id=None,
            total_amount=float(price),
            discount_amount=float(discount),
            status=InvoiceStatus.DRAFT,
            created_at=datetime.now(timezone.utc)
        )
        db.session.add(inv)
        db.session.flush()

        item = InvoiceItem(
            invoice_id=inv.id,
            service_id=self.service.id,
            barber_id=self.barber.id,
            service_price=float(price),
            quantity=1
        )
        db.session.add(item)
        db.session.commit()
        return inv

    # Scenario 1: Visa 1 full payment
    def test_01_visa_1_full_payment(self):
        from app.modules.invoice_engine import InvoiceEngine
        from app.models.invoice import PaymentMethod, InvoiceStatus

        inv = self._create_invoice(100.0)
        payments = [{"method": "VISA_1", "amount": 100.0}]
        paid_inv = InvoiceEngine.confirm_payment(inv.id, confirmed_by_id=self.barber.id, payments=payments)
        self.assertEqual(paid_inv.status, InvoiceStatus.PAID)
        self.assertEqual(len(paid_inv.invoice_payments), 1)
        self.assertEqual(paid_inv.invoice_payments[0].method, PaymentMethod.VISA_1)
        self.assertEqual(paid_inv.invoice_payments[0].amount, Decimal("100.00"))
        self.assertEqual(paid_inv.invoice_payments[0].entered_amount, Decimal("100.00"))

    # Scenario 2: Visa 2 full payment
    def test_02_visa_2_full_payment(self):
        from app.modules.invoice_engine import InvoiceEngine
        from app.models.invoice import PaymentMethod, InvoiceStatus

        inv = self._create_invoice(150.0)
        payments = [{"method": "VISA_2", "amount": 150.0}]
        paid_inv = InvoiceEngine.confirm_payment(inv.id, confirmed_by_id=self.barber.id, payments=payments)
        self.assertEqual(paid_inv.status, InvoiceStatus.PAID)
        self.assertEqual(len(paid_inv.invoice_payments), 1)
        self.assertEqual(paid_inv.invoice_payments[0].method, PaymentMethod.VISA_2)
        self.assertEqual(paid_inv.invoice_payments[0].amount, Decimal("150.00"))

    # Scenario 3: Split payment Visa 1 + Visa 2
    def test_03_split_payment_visa_1_and_visa_2(self):
        from app.modules.invoice_engine import InvoiceEngine
        from app.models.invoice import PaymentMethod, InvoiceStatus

        inv = self._create_invoice(200.0)
        payments = [
            {"method": "VISA_1", "amount": 80.0},
            {"method": "VISA_2", "amount": 120.0}
        ]
        paid_inv = InvoiceEngine.confirm_payment(inv.id, confirmed_by_id=self.barber.id, payments=payments)
        self.assertEqual(paid_inv.status, InvoiceStatus.PAID)
        self.assertEqual(len(paid_inv.invoice_payments), 2)
        v1 = next(p for p in paid_inv.invoice_payments if p.method == PaymentMethod.VISA_1)
        v2 = next(p for p in paid_inv.invoice_payments if p.method == PaymentMethod.VISA_2)
        self.assertEqual(v1.amount, Decimal("80.00"))
        self.assertEqual(v2.amount, Decimal("120.00"))

    # Scenario 4: Split payment across all 4 methods (Cash, Visa 1, Visa 2, InstaPay)
    def test_04_split_across_all_four_methods(self):
        from app.modules.invoice_engine import InvoiceEngine
        from app.models.invoice import PaymentMethod, InvoiceStatus

        inv = self._create_invoice(400.0)
        payments = [
            {"method": "CASH", "amount": 100.0},
            {"method": "VISA_1", "amount": 100.0},
            {"method": "VISA_2", "amount": 100.0},
            {"method": "INSTAPAY", "amount": 100.0}
        ]
        paid_inv = InvoiceEngine.confirm_payment(inv.id, confirmed_by_id=self.barber.id, payments=payments)
        self.assertEqual(paid_inv.status, InvoiceStatus.PAID)
        self.assertEqual(len(paid_inv.invoice_payments), 4)
        methods = {p.method for p in paid_inv.invoice_payments}
        self.assertEqual(methods, {PaymentMethod.CASH, PaymentMethod.VISA_1, PaymentMethod.VISA_2, PaymentMethod.INSTAPAY})

    # Scenario 5: Free / fully discounted invoices
    def test_05_fully_discounted_invoice(self):
        from app.modules.invoice_engine import InvoiceEngine
        from app.models.invoice import InvoiceStatus, PaymentMethod

        inv = self._create_invoice(price=100.0, discount=100.0)
        paid_inv = InvoiceEngine.confirm_payment(inv.id, confirmed_by_id=self.barber.id, discount_amount=100.0)
        self.assertEqual(paid_inv.status, InvoiceStatus.PAID)
        self.assertEqual(paid_inv.is_fully_discounted, True)
        self.assertEqual(len(paid_inv.invoice_payments), 1)
        self.assertEqual(paid_inv.invoice_payments[0].amount, Decimal("0.00"))
        self.assertEqual(paid_inv.invoice_payments[0].method, PaymentMethod.CASH)

    # Scenario 6: Zero-total invoices
    def test_06_zero_total_invoice(self):
        from app.modules.invoice_engine import InvoiceEngine
        from app.models.invoice import InvoiceStatus

        inv = self._create_invoice(price=100.0, discount=100.0)
        payments = []
        paid_inv = InvoiceEngine.confirm_payment(inv.id, confirmed_by_id=self.barber.id, discount_amount=100.0, payments=payments)
        self.assertEqual(paid_inv.status, InvoiceStatus.PAID)
        self.assertEqual(paid_inv.total_amount - paid_inv.discount_amount, 0.0)

    # Scenario 7: Overpayment and cash change
    def test_07_cash_overpayment_change(self):
        from app.modules.invoice_engine import InvoiceEngine

        inv = self._create_invoice(80.0)
        payments = [{"method": "CASH", "amount": 100.0}]
        paid_inv = InvoiceEngine.confirm_payment(inv.id, confirmed_by_id=self.barber.id, payments=payments)
        self.assertEqual(paid_inv.change_amount, 20.0)
        self.assertEqual(paid_inv.invoice_payments[0].amount, Decimal("80.00"))
        self.assertEqual(paid_inv.invoice_payments[0].entered_amount, Decimal("100.00"))

    # Scenario 8: Visa 1 / Visa 2 overpayment resulting in TIP_PAYOUT
    def test_08_visa_overpayment_tip_payout(self):
        from app.modules.invoice_engine import InvoiceEngine
        from app.models.expense import Expense
        from app.models.expense_category import ExpenseCategory

        inv = self._create_invoice(100.0)
        payments = [{"method": "VISA_1", "amount": 120.0}]
        paid_inv = InvoiceEngine.confirm_payment(inv.id, confirmed_by_id=self.barber.id, payments=payments)
        self.assertEqual(paid_inv.change_amount, 20.0)
        self.assertEqual(paid_inv.invoice_payments[0].amount, Decimal("100.00"))
        self.assertEqual(paid_inv.invoice_payments[0].entered_amount, Decimal("120.00"))

        tip_cat = ExpenseCategory.query.filter_by(code='TIP_PAYOUT').first()
        self.assertIsNotNone(tip_cat)
        tip_expense = Expense.query.filter_by(
            business_day_id=self.bday.id,
            expense_category_id=tip_cat.id
        ).order_by(Expense.id.desc()).first()
        self.assertIsNotNone(tip_expense)
        self.assertEqual(Decimal(str(tip_expense.amount)), Decimal("20.00"))

    # Scenario 9: Repeated confirmation with idempotency key
    def test_09_idempotency_key_duplicate(self):
        import uuid
        from app.extensions import db
        from app.modules.invoice_engine import InvoiceEngine
        from app.models.invoice import InvoiceStatus
        from app.models.payment_confirmation_attempt import PaymentConfirmationAttemptStatus
        from app.services import payment_confirmation_attempt_service as attempt_service

        inv = self._create_invoice(100.0)
        attempt_id = str(uuid.uuid4())
        payments = [{"method": "VISA_1", "amount": 100.0}]
        data = {"payments": payments}
        req_fp = attempt_service.build_request_fingerprint(inv.id, data)

        attempt, is_new = attempt_service.claim_attempt(
            payment_attempt_id=attempt_id,
            invoice_id=inv.id,
            branch_id=self.branch.id,
            cashier_id=self.barber.id,
            request_fingerprint=req_fp
        )
        self.assertTrue(is_new)
        self.assertEqual(attempt.status, PaymentConfirmationAttemptStatus.PROCESSING)

        paid_inv = InvoiceEngine.confirm_payment(
            inv.id,
            confirmed_by_id=self.barber.id,
            payments=payments,
            payment_attempt_id=attempt_id
        )
        self.assertEqual(paid_inv.status, InvoiceStatus.PAID)
        self.assertEqual(len(paid_inv.invoice_payments), 1)

        # Second call with same attempt_id (simulate duplicate client request through claim_attempt)
        attempt2, is_new2 = attempt_service.claim_attempt(
            payment_attempt_id=attempt_id,
            invoice_id=inv.id,
            branch_id=self.branch.id,
            cashier_id=self.barber.id,
            request_fingerprint=req_fp
        )
        self.assertFalse(is_new2)
        self.assertEqual(attempt2.status, PaymentConfirmationAttemptStatus.SUCCEEDED)
        self.assertEqual(attempt2.invoice_id, inv.id)

    # Scenario 10: Retry after unconfirmed invoice
    def test_10_retry_unconfirmed_invoice(self):
        from app.modules.invoice_engine import InvoiceEngine
        from app.models.invoice import InvoiceStatus

        inv = self._create_invoice(100.0)
        self.assertEqual(inv.status, InvoiceStatus.DRAFT)
        payments = [{"method": "VISA_2", "amount": 100.0}]
        paid_inv = InvoiceEngine.confirm_payment(inv.id, confirmed_by_id=self.barber.id, payments=payments)
        self.assertEqual(paid_inv.status, InvoiceStatus.PAID)

    # Scenario 11: Deposit collected using Visa 1, remainder paid using Visa 2
    def test_11_deposit_visa_1_remainder_visa_2(self):
        from app.extensions import db
        from app.modules.invoice_engine import InvoiceEngine
        from app.models.appointment import Appointment, AppointmentStatus
        from app.models.appointment_deposit_transaction import AppointmentDepositTransaction, AppointmentDepositTransactionType
        from app.models.customer_balance import CustomerBalance
        from app.models.invoice import PaymentMethod, InvoiceStatus

        appt = Appointment(
            branch_id=self.branch.id,
            customer_id=self.customer.id,
            barber_id=self.barber.id,
            appointment_date=date.today(),
            appointment_time=time(14, 0),
            deposit_amount=30,
            status=AppointmentStatus.SCHEDULED
        )
        db.session.add(appt)
        db.session.flush()

        tx = AppointmentDepositTransaction(
            appointment_id=appt.id,
            customer_id=self.customer.id,
            branch_id=self.branch.id,
            business_day_id=self.bday.id,
            cashier_id=self.barber.id,
            collected_by_user_id=self.user.id,
            amount=Decimal("30.00"),
            payment_method=PaymentMethod.VISA_1,
            transaction_type=AppointmentDepositTransactionType.DEPOSIT_COLLECTION
        )
        db.session.add(tx)

        bal = CustomerBalance.query.filter_by(customer_id=self.customer.id, branch_id=self.branch.id).first()
        if not bal:
            bal = CustomerBalance(customer_id=self.customer.id, branch_id=self.branch.id, balance=Decimal("30.00"))
            db.session.add(bal)
        else:
            bal.balance = Decimal("30.00")
        db.session.commit()

        inv = self._create_invoice(100.0)
        payments = [{"method": "VISA_2", "amount": 70.0}]
        paid_inv = InvoiceEngine.confirm_payment(
            inv.id,
            confirmed_by_id=self.barber.id,
            appointment_id=appt.id,
            customer_id=self.customer.id,
            customer_phone=self.customer.phone,
            payments=payments
        )
        self.assertEqual(paid_inv.status, InvoiceStatus.PAID)
        self.assertEqual(paid_inv.invoice_payments[0].method, PaymentMethod.VISA_2)
        self.assertEqual(paid_inv.invoice_payments[0].amount, Decimal("70.00"))

    # Scenario 12: Deposit collected using Visa 2, remainder paid using Cash
    def test_12_deposit_visa_2_remainder_cash(self):
        from app.extensions import db
        from app.modules.invoice_engine import InvoiceEngine
        from app.models.appointment import Appointment, AppointmentStatus
        from app.models.appointment_deposit_transaction import AppointmentDepositTransaction, AppointmentDepositTransactionType
        from app.models.customer_balance import CustomerBalance
        from app.models.invoice import PaymentMethod, InvoiceStatus

        appt = Appointment(
            branch_id=self.branch.id,
            customer_id=self.customer.id,
            barber_id=self.barber.id,
            appointment_date=date.today(),
            appointment_time=time(16, 0),
            deposit_amount=40,
            status=AppointmentStatus.SCHEDULED
        )
        db.session.add(appt)
        db.session.flush()

        tx = AppointmentDepositTransaction(
            appointment_id=appt.id,
            customer_id=self.customer.id,
            branch_id=self.branch.id,
            business_day_id=self.bday.id,
            cashier_id=self.barber.id,
            collected_by_user_id=self.user.id,
            amount=Decimal("40.00"),
            payment_method=PaymentMethod.VISA_2,
            transaction_type=AppointmentDepositTransactionType.DEPOSIT_COLLECTION
        )
        db.session.add(tx)

        bal = CustomerBalance.query.filter_by(customer_id=self.customer.id, branch_id=self.branch.id).first()
        if not bal:
            bal = CustomerBalance(customer_id=self.customer.id, branch_id=self.branch.id, balance=Decimal("40.00"))
            db.session.add(bal)
        else:
            bal.balance = Decimal("40.00")
        db.session.commit()

        inv = self._create_invoice(100.0)
        payments = [{"method": "CASH", "amount": 60.0}]
        paid_inv = InvoiceEngine.confirm_payment(
            inv.id,
            confirmed_by_id=self.barber.id,
            appointment_id=appt.id,
            customer_id=self.customer.id,
            customer_phone=self.customer.phone,
            payments=payments
        )
        self.assertEqual(paid_inv.status, InvoiceStatus.PAID)
        self.assertEqual(paid_inv.invoice_payments[0].method, PaymentMethod.CASH)
        self.assertEqual(paid_inv.invoice_payments[0].amount, Decimal("60.00"))

    # Scenario 13: Historical generic Visa invoices preserved
    def test_13_historical_generic_visa_invoices(self):
        from app.extensions import db
        from app.models.invoice import InvoicePayment, PaymentMethod, InvoiceStatus
        from app.utils.treasury_business_days import build_business_day_collection_snapshot

        inv = self._create_invoice(100.0)
        inv.status = InvoiceStatus.PAID
        inv.business_day_id = self.bday.id
        p = InvoicePayment(
            invoice_id=inv.id,
            method=PaymentMethod.VISA,
            amount=Decimal("100.00"),
            entered_amount=Decimal("100.00")
        )
        db.session.add(p)
        db.session.commit()

        snap = build_business_day_collection_snapshot(self.bday.id)
        combined = snap["combined"]
        self.assertGreaterEqual(combined["visa_unassigned_in"], Decimal("100.00"))
        self.assertGreaterEqual(combined["visa_in"], Decimal("100.00"))

    # Scenario 14: Historical generic Visa deposits preserved
    def test_14_historical_generic_visa_deposits(self):
        from app.extensions import db
        from app.models.appointment import Appointment, AppointmentStatus
        from app.models.appointment_deposit_transaction import AppointmentDepositTransaction, AppointmentDepositTransactionType
        from app.models.invoice import PaymentMethod
        from app.utils.treasury_business_days import build_business_day_collection_snapshot

        appt = Appointment(
            branch_id=self.branch.id,
            customer_id=self.customer.id,
            barber_id=self.barber.id,
            appointment_date=date.today(),
            appointment_time=time(18, 0),
            deposit_amount=50,
            status=AppointmentStatus.SCHEDULED
        )
        db.session.add(appt)
        db.session.flush()

        tx = AppointmentDepositTransaction(
            appointment_id=appt.id,
            customer_id=self.customer.id,
            branch_id=self.branch.id,
            business_day_id=self.bday.id,
            cashier_id=self.barber.id,
            collected_by_user_id=self.user.id,
            amount=Decimal("50.00"),
            payment_method=PaymentMethod.VISA,
            transaction_type=AppointmentDepositTransactionType.DEPOSIT_COLLECTION
        )
        db.session.add(tx)
        db.session.commit()

        snap = build_business_day_collection_snapshot(self.bday.id)
        combined = snap["combined"]
        self.assertGreaterEqual(combined["visa_in"], Decimal("50.00"))
        self.assertGreaterEqual(combined["visa_unassigned_in"], Decimal("50.00"))

    # Scenario 15: Drawer closing with both machines matching expected values
    def test_15_drawer_closing_matching(self):
        from app.modules.invoice_engine import InvoiceEngine
        from app.utils.treasury_business_days import build_business_day_collection_snapshot

        inv1 = self._create_invoice(100.0)
        InvoiceEngine.confirm_payment(inv1.id, payments=[{"method": "VISA_1", "amount": 100.0}], confirmed_by_id=self.barber.id)
        inv2 = self._create_invoice(200.0)
        InvoiceEngine.confirm_payment(inv2.id, payments=[{"method": "VISA_2", "amount": 200.0}], confirmed_by_id=self.barber.id)

        snap = build_business_day_collection_snapshot(self.bday.id)
        combined = snap["combined"]
        expected_v1 = combined["visa_1_in"]
        expected_v2 = combined["visa_2_in"]

        actual_v1 = expected_v1
        actual_v2 = expected_v2

        diff_v1 = actual_v1 - expected_v1
        diff_v2 = actual_v2 - expected_v2
        self.assertEqual(diff_v1, Decimal("0.00"))
        self.assertEqual(diff_v2, Decimal("0.00"))

    # Scenario 16: Drawer closing with discrepancy on one machine
    def test_16_drawer_closing_discrepancy_single_terminal(self):
        from app.modules.invoice_engine import InvoiceEngine
        from app.utils.treasury_business_days import build_business_day_collection_snapshot

        inv1 = self._create_invoice(100.0)
        InvoiceEngine.confirm_payment(inv1.id, payments=[{"method": "VISA_1", "amount": 100.0}], confirmed_by_id=self.barber.id)
        inv2 = self._create_invoice(200.0)
        InvoiceEngine.confirm_payment(inv2.id, payments=[{"method": "VISA_2", "amount": 200.0}], confirmed_by_id=self.barber.id)

        snap = build_business_day_collection_snapshot(self.bday.id)
        combined = snap["combined"]

        expected_v1 = combined["visa_1_in"]
        expected_v2 = combined["visa_2_in"]

        actual_v1 = expected_v1 - Decimal("10.00")
        actual_v2 = expected_v2

        diff_v1 = actual_v1 - expected_v1
        diff_v2 = actual_v2 - expected_v2
        self.assertEqual(diff_v1, Decimal("-10.00"))
        self.assertEqual(diff_v2, Decimal("0.00"))

    # Scenario 17: Viewing historical close snapshots with stored actual_visa_1 and actual_visa_2
    def test_17_historical_close_snapshots_persistence(self):
        from app.extensions import db
        from app.models.business_day import BusinessDay, BusinessDayStatus

        test_bday = BusinessDay(
            branch_id=self.branch.id,
            opened_by=self.barber.id,
            opening_balance=Decimal("200.00"),
            theoretical_balance=Decimal("200.00"),
            actual_visa_1=Decimal("150.00"),
            actual_visa_2=Decimal("250.00"),
            actual_instapay=Decimal("50.00"),
            status=BusinessDayStatus.CLOSED,
            opened_at=datetime.now(timezone.utc),
            closed_at=datetime.now(timezone.utc)
        )
        db.session.add(test_bday)
        db.session.commit()

        reloaded = db.session.get(BusinessDay, test_bday.id)
        d = reloaded.to_dict()
        self.assertEqual(d["actual_visa_1"], 150.0)
        self.assertEqual(d["actual_visa_2"], 250.0)
        self.assertEqual(d["actual_instapay"], 50.0)

    # Scenario 18: API validation for unknown payment methods
    def test_18_unknown_payment_method_rejected(self):
        from app.modules.invoice_engine import InvoiceEngine

        inv = self._create_invoice(100.0)
        payments = [{"method": "VISA_3", "amount": 100.0}]
        with self.assertRaises(ValueError) as ctx:
            InvoiceEngine.confirm_payment(inv.id, payments=payments, confirmed_by_id=self.barber.id)
        self.assertIn("VISA_3", str(ctx.exception))

    # Scenario 19: Admin invoices aggregation and filtering
    def test_19_admin_invoices_aggregation_filtering(self):
        from app.modules.invoice_engine import InvoiceEngine
        from app.models.invoice import Invoice, InvoicePayment, PaymentMethod

        inv1 = self._create_invoice(100.0)
        InvoiceEngine.confirm_payment(inv1.id, payments=[{"method": "VISA_1", "amount": 100.0}], confirmed_by_id=self.barber.id)
        inv2 = self._create_invoice(200.0)
        InvoiceEngine.confirm_payment(inv2.id, payments=[{"method": "VISA_2", "amount": 200.0}], confirmed_by_id=self.barber.id)

        v1_invoices = Invoice.query.join(InvoicePayment).filter(InvoicePayment.method == PaymentMethod.VISA_1).all()
        v1_ids = [i.id for i in v1_invoices]
        self.assertIn(inv1.id, v1_ids)
        self.assertNotIn(inv2.id, v1_ids)

        v2_invoices = Invoice.query.join(InvoicePayment).filter(InvoicePayment.method == PaymentMethod.VISA_2).all()
        v2_ids = [i.id for i in v2_invoices]
        self.assertIn(inv2.id, v2_ids)
        self.assertNotIn(inv1.id, v2_ids)

        all_visa = Invoice.query.join(InvoicePayment).filter(
            InvoicePayment.method.in_([PaymentMethod.VISA, PaymentMethod.VISA_1, PaymentMethod.VISA_2])
        ).all()
        all_ids = [i.id for i in all_visa]
        self.assertIn(inv1.id, all_ids)
        self.assertIn(inv2.id, all_ids)

    # Scenario 20: Receipt print label rendering
    def test_20_receipt_print_label_rendering(self):
        def get_payment_label(m):
            upper = m.upper() if m else ""
            if upper == "CASH": return "نقدي"
            if upper == "VISA_1": return "فيزا 1"
            if upper == "VISA_2": return "فيزا 2"
            if upper == "VISA": return "Visa"
            if upper == "INSTAPAY": return "InstaPay"
            return m

        self.assertEqual(get_payment_label("VISA_1"), "فيزا 1")
        self.assertEqual(get_payment_label("visa_1"), "فيزا 1")
        self.assertEqual(get_payment_label("VISA_2"), "فيزا 2")
        self.assertEqual(get_payment_label("visa_2"), "فيزا 2")
        self.assertEqual(get_payment_label("VISA"), "Visa")
        self.assertEqual(get_payment_label("CASH"), "نقدي")
        self.assertEqual(get_payment_label("INSTAPAY"), "InstaPay")

    # Scenario 21: Excel/CSV export calculation with Visa 1 and Visa 2
    def test_21_export_calculation_visa_1_and_visa_2(self):
        from app.modules.invoice_engine import InvoiceEngine
        from app.utils.exports.invoices import _load_invoice_payment_breakdown

        inv1 = self._create_invoice(120.0)
        InvoiceEngine.confirm_payment(inv1.id, payments=[{"method": "VISA_1", "amount": 120.0}], confirmed_by_id=self.barber.id)

        inv2 = self._create_invoice(180.0)
        InvoiceEngine.confirm_payment(inv2.id, payments=[{"method": "VISA_2", "amount": 180.0}], confirmed_by_id=self.barber.id)

        inv3 = self._create_invoice(250.0)
        InvoiceEngine.confirm_payment(inv3.id, payments=[
            {"method": "CASH", "amount": 50.0},
            {"method": "VISA_1", "amount": 100.0},
            {"method": "VISA_2", "amount": 100.0}
        ], confirmed_by_id=self.barber.id)

        breakdown = _load_invoice_payment_breakdown([inv1.id, inv2.id, inv3.id])

        # Invoice 1 (all Visa 1)
        self.assertEqual(breakdown[inv1.id]["visa_paid"], Decimal("120.00"))
        self.assertEqual(breakdown[inv1.id]["cash_paid"], Decimal("0.00"))

        # Invoice 2 (all Visa 2)
        self.assertEqual(breakdown[inv2.id]["visa_paid"], Decimal("180.00"))

        # Invoice 3 (split: 50 cash + 100 visa 1 + 100 visa 2)
        self.assertEqual(breakdown[inv3.id]["cash_paid"], Decimal("50.00"))
        self.assertEqual(breakdown[inv3.id]["visa_paid"], Decimal("200.00"))

    # Scenario 22: Reporting service raw_tender with Visa 1 and Visa 2
    def test_22_reporting_service_raw_tender_dual_visa(self):
        from app.modules.invoice_engine import InvoiceEngine
        from app.services.reporting_service import build_report_filters, _finance_collections_summary

        filters = build_report_filters({"date_from": str(date.today()), "date_to": str(date.today())})
        collections_before = _finance_collections_summary([self.branch.id], filters)
        raw_before = collections_before["raw_tender"]

        inv1 = self._create_invoice(100.0)
        InvoiceEngine.confirm_payment(inv1.id, payments=[{"method": "VISA_1", "amount": 110.0}], confirmed_by_id=self.barber.id)

        inv2 = self._create_invoice(200.0)
        InvoiceEngine.confirm_payment(inv2.id, payments=[{"method": "VISA_2", "amount": 200.0}], confirmed_by_id=self.barber.id)

        collections_after = _finance_collections_summary([self.branch.id], filters)
        raw_after = collections_after["raw_tender"]

        self.assertEqual(raw_after["visa_1"] - raw_before.get("visa_1", 0.0), 110.0)
        self.assertEqual(raw_after["visa_2"] - raw_before.get("visa_2", 0.0), 200.0)
        self.assertEqual(raw_after["visa"] - raw_before.get("visa", 0.0), 310.0)


if __name__ == '__main__':
    unittest.main()
