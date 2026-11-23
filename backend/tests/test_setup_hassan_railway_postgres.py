"""Disposable PostgreSQL coverage for the explicit Hassan Railway setup CLI."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from flask import Flask
from flask_migrate import Migrate, upgrade

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.cli import register_cli_commands
from app.extensions import db
from app.models.branch import Branch
from app.models.employee import Employee, EmployeeType
from app.models.user import User, UserRole


@unittest.skipUnless(
    os.environ.get('HASSAN_RAILWAY_SETUP_DISPOSABLE_PG') == '1',
    'Opt-in disposable PostgreSQL test',
)
class RailwaySetupPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='hassan-railway-pg-', dir='/private/tmp')
        cls.root = Path(cls.tmp.name)
        os.chmod(cls.root, 0o700)
        cls.bin = Path('/opt/homebrew/opt/postgresql@18/bin')
        cls.data = cls.root / 'data'
        cls.socket = cls.root / 'socket'
        cls.socket.mkdir(mode=0o700)
        cls.port = 55442
        subprocess.run(
            [str(cls.bin / 'initdb'), '-D', str(cls.data), '-A', 'trust',
             '--encoding=UTF8', '--locale=C.UTF-8', '-U', 'railway_setup_test'],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        cls.addClassCleanup(
            lambda: subprocess.run(
                [str(cls.bin / 'pg_ctl'), '-D', str(cls.data), '-m', 'immediate', 'stop'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        )
        subprocess.run(
            [str(cls.bin / 'pg_ctl'), '-D', str(cls.data),
             '-l', str(cls.root / 'server.log'),
             '-o', f"-h '' -k {cls.socket} -p {cls.port}", '-w', 'start'],
            check=True,
            stdout=subprocess.DEVNULL,
        )

        cls.app = Flask(__name__)
        cls.app.config.update(
            SQLALCHEMY_DATABASE_URI=(
                f'postgresql+psycopg2://railway_setup_test@/postgres'
                f'?host={cls.socket}&port={cls.port}'
            ),
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            STAFF_IDENTITY_ENABLED=True,
            STAFF_IDENTITY_HR_RUNTIME=True,
        )
        db.init_app(cls.app)
        cls.migrate = Migrate(cls.app, db, directory=str(Path(__file__).resolve().parents[1] / 'migrations'))
        register_cli_commands(cls.app)
        cls.app.config['TESTING'] = True
        cls.addClassCleanup(cls.tmp.cleanup)

    def setUp(self):
        self.ctx = self.app.app_context()
        self.ctx.push()
        self.addCleanup(self.ctx.pop)
        self.addCleanup(db.session.remove)
        db.drop_all()
        db.session.remove()
        with db.engine.begin() as connection:
            connection.exec_driver_sql('DROP SCHEMA public CASCADE')
            connection.exec_driver_sql('CREATE SCHEMA public')
        upgrade(directory=str(Path(__file__).resolve().parents[1] / 'migrations'))

    def test_dry_run_apply_rerun_and_conflict(self):
        runner = self.app.test_cli_runner()

        before_branches = Branch.query.count()
        before_users = User.query.count()
        result = runner.invoke(args=['setup-hassan-railway'])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn('DRY RUN', result.output)
        self.assertEqual(Branch.query.count(), before_branches)
        self.assertEqual(User.query.count(), before_users)

        result = runner.invoke(
            args=['setup-hassan-railway', '--apply'],
            input=(
                'offline-admin-password\noffline-admin-password\n'
                'cashier1@example.test\noffline-cashier1-password\noffline-cashier1-password\n'
                'cashier2@example.test\noffline-cashier2-password\noffline-cashier2-password\n'
            ),
        )
        self.assertEqual(result.exit_code, 0, result.output)

        salon = Branch.query.filter_by(name='حسن رجب صالون').one()
        truck = Branch.query.filter_by(name='Hasan Ragab Truck').one()
        self.assertEqual((salon.city, salon.is_active, salon.is_main_warehouse, salon.allow_discounts),
                         ('الشيخ زايد', True, False, True))
        self.assertEqual((truck.city, truck.is_active, truck.is_main_warehouse, truck.allow_discounts),
                         ('الشيخ زايد', True, False, True))

        admin = User.query.filter_by(email='admin@hassanragab.com').one()
        cashier1 = User.query.filter_by(email='cashier1@example.test').one()
        cashier2 = User.query.filter_by(email='cashier2@example.test').one()
        self.assertEqual(admin.role, UserRole.SUPER_ADMIN)
        self.assertIsNone(admin.branch_id)
        self.assertTrue(admin.check_password('offline-admin-password'))
        self.assertEqual((cashier1.role, cashier1.branch_id), (UserRole.CASHIER, salon.id))
        self.assertEqual((cashier2.role, cashier2.branch_id), (UserRole.CASHIER, truck.id))
        self.assertTrue(cashier1.check_password('offline-cashier1-password'))
        self.assertTrue(cashier2.check_password('offline-cashier2-password'))

        employee1 = Employee.query.filter_by(
            full_name='كاشير١', branch_id=salon.id, employee_type=EmployeeType.CASHIER
        ).one()
        employee2 = Employee.query.filter_by(
            full_name='كاشير٢', branch_id=truck.id, employee_type=EmployeeType.CASHIER
        ).one()
        self.assertTrue(employee1.is_active)
        self.assertTrue(employee2.is_active)

        password_hashes = {
            admin.email: admin.password_hash,
            cashier1.email: cashier1.password_hash,
            cashier2.email: cashier2.password_hash,
        }
        counts = (Branch.query.count(), User.query.count(), Employee.query.count())
        result = runner.invoke(args=['setup-hassan-railway', '--apply'], input='')
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual((Branch.query.count(), User.query.count(), Employee.query.count()), counts)
        db.session.expire_all()
        for email, password_hash in password_hashes.items():
            self.assertEqual(User.query.filter_by(email=email).one().password_hash, password_hash)

        conflict = Branch.query.filter_by(name='حسن رجب صالون').one()
        conflict.city = 'القاهرة'
        db.session.commit()
        before = (Branch.query.count(), User.query.count(), Employee.query.count())
        result = runner.invoke(
            args=['setup-hassan-railway', '--apply'],
            input='',
        )
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn('Conflict', result.output)
        self.assertEqual((Branch.query.count(), User.query.count(), Employee.query.count()), before)


if __name__ == '__main__':
    unittest.main()
