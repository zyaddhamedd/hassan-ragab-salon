import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from sqlalchemy import create_engine, text

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import import_customers_csv as importer


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
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    UNIQUE (branch_id, phone)
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


if __name__ == "__main__":
    unittest.main()
