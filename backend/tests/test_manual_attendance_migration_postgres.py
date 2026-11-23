"""Verify manual attendance audit columns through real PostgreSQL migrations."""

import os
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask
from flask_migrate import Migrate, upgrade
from sqlalchemy import text

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.extensions import db, jwt
from app.api.admin import admin_bp
from app.models.branch import Branch
from app.models.employee import Employee, EmployeeType
from app.models.user import User, UserRole
from app.utils.admin_auth import create_admin_token


@unittest.skipUnless(
    os.environ.get('HASSAN_ATTENDANCE_MIGRATION_DISPOSABLE_PG') == '1',
    'Opt-in disposable PostgreSQL test',
)
class ManualAttendanceMigrationPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='hassan-attendance-migration-pg-', dir='/private/tmp')
        cls.root = Path(cls.tmp.name)
        os.chmod(cls.root, 0o700)
        cls.bin = Path('/opt/homebrew/opt/postgresql@18/bin')
        cls.data = cls.root / 'data'
        cls.socket = cls.root / 'socket'
        cls.socket.mkdir(mode=0o700)
        cls.port = 55443
        subprocess.run(
            [str(cls.bin / 'initdb'), '-D', str(cls.data), '-A', 'trust',
             '--encoding=UTF8', '--locale=C.UTF-8', '-U', 'attendance_migration_test'],
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
                f'postgresql+psycopg2://attendance_migration_test@/postgres'
                f'?host={cls.socket}&port={cls.port}'
            ),
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            SECRET_KEY='offline-attendance-migration-test',
            JWT_SECRET_KEY='offline-attendance-migration-test',
            STAFF_IDENTITY_ENABLED=True,
            STAFF_IDENTITY_HR_RUNTIME=True,
        )
        db.init_app(cls.app)
        jwt.init_app(cls.app)
        Migrate(cls.app, db, directory=str(Path(__file__).resolve().parents[1] / 'migrations'))
        cls.app.register_blueprint(admin_bp)
        cls.app.config['TESTING'] = True
        cls.addClassCleanup(cls.tmp.cleanup)

    def setUp(self):
        self.ctx = self.app.app_context()
        self.ctx.push()
        self.addCleanup(self.ctx.pop)
        self.addCleanup(db.session.remove)
        with db.engine.begin() as connection:
            connection.exec_driver_sql('DROP SCHEMA public CASCADE')
            connection.exec_driver_sql('CREATE SCHEMA public')
        upgrade(directory=str(Path(__file__).resolve().parents[1] / 'migrations'),
                revision='aaa_dual_visa_terminals')

    def assert_manual_columns(self):
        with db.engine.begin() as connection:
            columns = connection.execute(text("""
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_schema='public' AND table_name='attendances'
                  AND column_name IN ('is_manual_check_in','check_in_actor_id')
                ORDER BY column_name
            """)).mappings().all()
            by_name = {row['column_name']: row for row in columns}

            manual = by_name['is_manual_check_in']
            actor = by_name['check_in_actor_id']
            self.assertEqual(manual['data_type'], 'boolean')
            self.assertEqual(manual['is_nullable'], 'NO')
            self.assertIn('false', manual['column_default'])
            self.assertEqual(actor['data_type'], 'integer')
            self.assertEqual(actor['is_nullable'], 'YES')

            fk = connection.execute(text("""
                SELECT confrelid::regclass::text AS target_table,
                       confdeltype::text AS delete_action,
                       pg_get_constraintdef(oid) AS definition
                FROM pg_constraint
                WHERE conname='fk_attendance_check_in_actor'
                  AND conrelid='public.attendances'::regclass
            """)).mappings().one()
            self.assertEqual(fk['target_table'], 'users')
            self.assertEqual(fk['delete_action'], 'r')
            self.assertIn('FOREIGN KEY (check_in_actor_id) REFERENCES users(id)', fk['definition'])

    def test_fresh_and_existing_upgrade_with_dashboard(self):
        now = datetime.now(timezone.utc)

        with db.engine.begin() as connection:
            branch_id = connection.execute(text("""
                INSERT INTO branches
                  (name, city, is_active, is_main_warehouse, allow_discounts, created_at, updated_at)
                VALUES ('Migration Test Branch','الشيخ زايد',TRUE,FALSE,TRUE,:now,:now)
                RETURNING id
            """), {'now': now}).scalar_one()
            employee_id = connection.execute(text("""
                INSERT INTO employees
                  (full_name, employee_type, branch_id, base_salary,
                   commission_wallet_balance, is_active, is_deleted, status, created_at, updated_at)
                VALUES ('Migration Employee', CAST(:employee_type AS employee_type_enum), :branch_id,
                        0, 0, TRUE, FALSE, CAST(:status AS employee_status_enum), :now, :now)
                RETURNING id
            """), {
                'employee_type': 'BARBER',
                'status': 'ACTIVE',
                'branch_id': branch_id,
                'now': now,
            }).scalar_one()
            connection.execute(text("""
                INSERT INTO attendances
                  (employee_id, branch_id, date, check_in_time, status, created_at, updated_at)
                VALUES (:employee_id, :branch_id, CURRENT_DATE, :now,
                        CAST(:status AS attendance_status_enum), :now, :now)
            """), {
                'employee_id': employee_id,
                'branch_id': branch_id,
                'status': 'PRESENT',
                'now': now,
            })

        upgrade(directory=str(Path(__file__).resolve().parents[1] / 'migrations'))
        self.assert_manual_columns()

        with db.engine.begin() as connection:
            row = connection.execute(text("""
                SELECT is_manual_check_in, check_in_actor_id
                FROM attendances
            """)).one()
            self.assertEqual(row.is_manual_check_in, False)
            self.assertIsNone(row.check_in_actor_id)
            connection.execute(text('DELETE FROM attendances'))

            head = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            self.assertEqual(head, 'aab_manual_attendance_checkin')

        admin = User(
            full_name='Migration Admin',
            email='migration-admin@example.test',
            role=UserRole.SUPER_ADMIN,
            branch_id=None,
            is_active=True,
        )
        admin.set_password('offline-dashboard-password')
        db.session.add(admin)
        db.session.commit()

        login = self.app.test_client().post('/api/admin/auth/login', json={
            'username': admin.email,
            'password': 'offline-dashboard-password',
        })
        self.assertEqual(login.status_code, 200, login.get_data(as_text=True))

        token = create_admin_token(admin)
        dashboard = self.app.test_client().get(
            '/api/admin/dashboard-v2/overview',
            headers={'Authorization': f'Bearer {token}'},
        )
        self.assertEqual(dashboard.status_code, 200, dashboard.get_data(as_text=True))
        self.assertIn('operational', dashboard.get_json())

        db.session.remove()
        with db.engine.begin() as connection:
            connection.exec_driver_sql('DROP SCHEMA public CASCADE')
            connection.exec_driver_sql('CREATE SCHEMA public')
        upgrade(directory=str(Path(__file__).resolve().parents[1] / 'migrations'))
        self.assert_manual_columns()
        with db.engine.begin() as connection:
            self.assertEqual(connection.execute(text('SELECT count(*) FROM attendances')).scalar_one(), 0)
            head = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            self.assertEqual(head, 'aab_manual_attendance_checkin')


if __name__ == '__main__':
    unittest.main()
