import os
import subprocess
import tempfile
import unittest
import importlib.util
from pathlib import Path
from datetime import timezone

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from flask import Flask

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import import_customers_csv as importer
from app.extensions import db
from app.utils.exports.clients import build_customer_stats_subquery


@unittest.skipUnless(
    os.environ.get("HASSAN_CUSTOMER_IMPORT_DISPOSABLE_PG") == "1",
    "Opt-in disposable PostgreSQL test",
)
class CustomerImportPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="hassan-customer-import-pg-", dir="/private/tmp")
        cls.root = Path(cls.tmp.name)
        os.chmod(cls.root, 0o700)
        cls.bin = Path("/opt/homebrew/opt/postgresql@18/bin")
        cls.data = cls.root / "data"
        cls.socket = cls.root / "socket"
        cls.socket.mkdir(mode=0o700)
        cls.port = 55444
        subprocess.run(
            [str(cls.bin / "initdb"), "-D", str(cls.data), "-A", "trust",
             "--encoding=UTF8", "--locale=C.UTF-8", "-U", "customer_import_test"],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        cls.addClassCleanup(
            lambda: subprocess.run(
                [str(cls.bin / "pg_ctl"), "-D", str(cls.data), "-m", "immediate", "stop"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        )
        subprocess.run(
            [str(cls.bin / "pg_ctl"), "-D", str(cls.data),
             "-l", str(cls.root / "server.log"),
             "-o", f"-h '' -k {cls.socket} -p {cls.port}", "-w", "start"],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        cls.url = (
            f"postgresql+psycopg2://customer_import_test@/postgres"
            f"?host={cls.socket}&port={cls.port}"
        )
        cls.engine = create_engine(cls.url)
        cls.app = Flask(__name__)
        cls.app.config.update(
            SQLALCHEMY_DATABASE_URI=cls.url,
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
        )
        db.init_app(cls.app)
        cls.addClassCleanup(cls.engine.dispose)

    def setUp(self):
        with self.engine.begin() as connection:
            connection.exec_driver_sql("DROP SCHEMA public CASCADE")
            connection.exec_driver_sql("CREATE SCHEMA public")
            connection.execute(text("""
                CREATE TABLE branches (
                    id serial PRIMARY KEY,
                    name varchar(100) UNIQUE NOT NULL,
                    is_active boolean NOT NULL DEFAULT true
                )
            """))
            connection.execute(text("""
                CREATE TABLE customers (
                    id serial PRIMARY KEY,
                    full_name varchar(100),
                    phone varchar(20) NOT NULL,
                    branch_id integer NOT NULL REFERENCES branches(id),
                    last_barber_id integer,
                    is_active boolean NOT NULL DEFAULT true,
                    imported_visit_count integer NOT NULL DEFAULT 0,
                    imported_last_visit timestamptz,
                    visit_history_cutoff_at timestamptz,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    UNIQUE (branch_id, phone)
                )
            """))
            connection.execute(text("""
                CREATE TABLE invoices (
                    id serial PRIMARY KEY,
                    branch_id integer NOT NULL REFERENCES branches(id),
                    customer_id integer REFERENCES customers(id),
                    status varchar(32) NOT NULL,
                    paid_at timestamptz,
                    total_amount numeric(12, 2) NOT NULL DEFAULT 0
                )
            """))
            connection.execute(text("""
                INSERT INTO branches (name) VALUES ('حسن رجب صالون')
            """))

    def test_dry_apply_rerun_and_conflict_skip(self):
        csv_path = Path(self.tmp.name) / "customers.csv"
        csv_path.write_text(
            "ID,NAME,PHONE,NUM_VISITS,LAST VISIT,DAYS,Branch\n"
            "1,عميل جديد,01000000001,0,,0,حسن رجب صالون\n"
            "2,عميل موجود,01100000002,0,,0,حسن رجب صالون\n"
            "3,اسم أول,01200000003,0,,0,حسن رجب صالون\n"
            "4,اسم ثاني,01200000003,0,,0,حسن رجب صالون\n"
            "5,,01100000005,0,,0,حسن رجب صالون\n"
            "6,رقم غير صالح,123,0,,0,حسن رجب صالون\n"
            "7,عميل مختلف,01500000007,0,,0,فرع غير موجود\n",
            encoding="utf-8",
        )
        with self.engine.begin() as connection:
            connection.execute(text("""
                INSERT INTO customers (full_name, phone, branch_id)
                VALUES ('عميل موجود', '01100000002',
                        (SELECT id FROM branches WHERE name='حسن رجب صالون'))
            """))

        os.environ["DATABASE_URL"] = self.url
        rows = importer.read_csv(csv_path)
        with self.engine.begin() as connection:
            result = importer.inspect(rows, connection)
            self.assertEqual(len(rows), 7)
            self.assertEqual(len(result["ready_rows"]), 1)
            self.assertEqual(len(result["existing_rows"]), 1)
            self.assertEqual(result["duplicate_numbers"], 1)
            self.assertEqual(result["conflict_numbers"], 1)
            self.assertEqual(len(result["missing_or_invalid"]), 3)
            before = connection.execute(text("SELECT count(*) FROM customers")).scalar_one()
            dry_after = connection.execute(text("SELECT count(*) FROM customers")).scalar_one()
            self.assertEqual(dry_after, before)
            inserted = importer.apply_rows(connection, result["branches"], result["ready_rows"])
            self.assertEqual(inserted, 1)
            after = connection.execute(text("SELECT count(*) FROM customers")).scalar_one()
            self.assertEqual(after, before + 1)

        rerun_rows = importer.read_csv(csv_path)
        with self.engine.begin() as connection:
            rerun = importer.inspect(rerun_rows, connection)
            before = connection.execute(text("SELECT count(*) FROM customers")).scalar_one()
            inserted = importer.apply_rows(connection, rerun["branches"], rerun["ready_rows"])
            after = connection.execute(text("SELECT count(*) FROM customers")).scalar_one()
            self.assertEqual(inserted, 0)
            self.assertEqual(after, before)

    def test_visit_history_dry_run_apply_and_rerun_preserve_new_invoice_visits(self):
        csv_path = Path(self.tmp.name) / "visit-history.csv"
        csv_path.write_text(
            "ID,NAME,PHONE,NUM_VISITS,LAST VISIT,DAYS,Branch\n"
            "2,عميل موجود,01100000002,3,2024-01-03 00:00:00,0,حسن رجب صالون\n",
            encoding="utf-8",
        )
        with self.engine.begin() as connection:
            connection.execute(text("""
                INSERT INTO customers (full_name, phone, branch_id, created_at)
                VALUES ('عميل موجود', '01100000002',
                        (SELECT id FROM branches WHERE name='حسن رجب صالون'),
                        '2024-01-01 00:00:00+00')
            """))
            connection.execute(text("""
                INSERT INTO invoices (branch_id, customer_id, status, paid_at, total_amount)
                SELECT c.branch_id, c.id, 'PAID', '2023-12-31 00:00:00+00', 10
                FROM customers c WHERE c.phone='01100000002'
            """))
        with self.engine.begin() as connection:
            before = connection.execute(text("""
                SELECT imported_visit_count, visit_history_cutoff_at,
                       (SELECT count(*) FROM invoices)
                FROM customers WHERE phone='01100000002'
            """)).one()
            self.assertEqual(before, (0, None, 1))

        env = os.environ.copy()
        env["DATABASE_URL"] = self.url
        command = [
            sys.executable,
            str(Path(__file__).resolve().parents[1] / "import_customers_csv.py"),
            str(csv_path),
            "--sync-visit-history",
        ]
        dry_run = subprocess.run(
            command, env=env, check=True, capture_output=True, text=True
        )
        self.assertIn("ready to sync: 1", dry_run.stdout)
        self.assertIn("DRY RUN: no database changes made.", dry_run.stdout)
        with self.engine.connect() as connection:
            unchanged = connection.execute(text("""
                SELECT imported_visit_count, visit_history_cutoff_at
                FROM customers WHERE phone='01100000002'
            """)).one()
            self.assertEqual(unchanged, (0, None))

        apply_result = subprocess.run(
            command + ["--apply"], env=env, check=True, capture_output=True, text=True
        )
        self.assertIn("updated 1 customer", apply_result.stdout)
        with self.app.app_context():
            with self.engine.begin() as connection:
                connection.execute(text("""
                    INSERT INTO invoices (branch_id, customer_id, status, paid_at, total_amount)
                    SELECT c.branch_id, c.id, 'PAID', '2024-01-05 00:00:00+00', 20
                    FROM customers c WHERE c.phone='01100000002'
                """))

            stats = build_customer_stats_subquery([1]).c
            visits_count, last_visit = db.session.query(
                stats.visits_count, stats.last_visit
            ).filter(stats.customer_id == 1).one()
            self.assertEqual(visits_count, 4)
            self.assertEqual(
                last_visit.astimezone(timezone.utc).isoformat(),
                "2024-01-05T00:00:00+00:00",
            )
            self.assertEqual(
                db.session.execute(text("SELECT count(*) FROM invoices")).scalar_one(),
                2,
            )

            rerun = subprocess.run(
                command + ["--apply"], env=env, check=True, capture_output=True, text=True
            )
            self.assertIn("already synced: 1", rerun.stdout)
            self.assertIn("updated 0 customer", rerun.stdout)
            visits_count_after, _ = db.session.query(
                stats.visits_count, stats.last_visit
            ).filter(stats.customer_id == 1).one()
            self.assertEqual(visits_count_after, 4)
            db.session.remove()

        changed_row = {**importer.read_csv(csv_path)[0], "visit_count": 4}
        with self.engine.begin() as connection:
            conflict = importer.inspect_visit_history([changed_row], connection)
            self.assertEqual(conflict["conflict_rows"], [2])
            self.assertEqual(len(conflict["ready_rows"]), 0)
            self.assertEqual(
                connection.execute(text("""
                    SELECT imported_visit_count FROM customers WHERE phone='01100000002'
                """)).scalar_one(),
                3,
            )

    def test_visit_history_migration_preserves_existing_customer_rows(self):
        migration_path = (
            Path(__file__).resolve().parents[1]
            / "migrations/versions/aac_customer_visit_baseline.py"
        )
        spec = importlib.util.spec_from_file_location("customer_visit_baseline", migration_path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)

        with self.engine.begin() as connection:
            connection.execute(text("DROP TABLE invoices"))
            connection.execute(text("DROP TABLE customers CASCADE"))
            connection.execute(text("""
                CREATE TABLE customers (
                    id serial PRIMARY KEY,
                    phone varchar(20) NOT NULL
                )
            """))
            connection.execute(text("INSERT INTO customers (phone) VALUES ('01000000001')"))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            columns = {
                row.column_name: row
                for row in connection.execute(text("""
                    SELECT column_name, data_type, is_nullable, column_default
                    FROM information_schema.columns
                    WHERE table_name='customers'
                """))
            }
            self.assertEqual(columns["imported_visit_count"].data_type, "integer")
            self.assertEqual(columns["imported_visit_count"].is_nullable, "NO")
            self.assertEqual(columns["imported_visit_count"].column_default, "0")
            self.assertEqual(columns["imported_last_visit"].data_type, "timestamp with time zone")
            self.assertEqual(columns["imported_last_visit"].is_nullable, "YES")
            self.assertEqual(
                columns["visit_history_cutoff_at"].data_type,
                "timestamp with time zone",
            )
            self.assertEqual(columns["visit_history_cutoff_at"].is_nullable, "YES")
            self.assertEqual(
                connection.execute(text("""
                    SELECT phone, imported_visit_count, imported_last_visit,
                           visit_history_cutoff_at
                    FROM customers
                """)).one(),
                ("01000000001", 0, None, None),
            )
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()

if __name__ == "__main__":
    unittest.main()
