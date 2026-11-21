"""
Comprehensive tests for setup data transfer script (Local -> Railway Live).
Tests against a real disposable PostgreSQL 16 cluster.

Verifies:
1. Schema & pre-existing branch/admin initialization
2. Creation of 'الشيخ زايد' branch, admin 'omar', and cashier 'momen'
3. Import on existing branch and accounts (credentials preserved)
4. Double import (idempotency, zero duplicates)
5. Conflict detection, reporting, and full rollback
6. Mini Cashier queries (services & employees visibility for 'الشيخ زايد')
7. Cashier Studio preferences remapping with translated IDs
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

# Add backend and scripts to sys.path
WORKSPACE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(WORKSPACE / "backend"))
sys.path.insert(0, str(WORKSPACE / "scripts"))

from transfer_setup_data import (
    do_export,
    do_import,
    do_setup_railway_interactive,
    remap_studio_preferences,
    FORMAT_VERSION,
    TARGET_BRANCH_DEFAULT
)
import psycopg2
import psycopg2.extras
from werkzeug.security import check_password_hash


class SetupDataTransferTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 1. Start disposable PostgreSQL cluster
        cls.tmp_dir = tempfile.TemporaryDirectory(prefix="hr-transfer-test-pg-")
        cls.root = Path(cls.tmp_dir.name)
        cls.bin_path = Path("/opt/homebrew/opt/postgresql@16/bin")
        if not cls.bin_path.exists():
            cls.bin_path = Path("/usr/local/opt/postgresql@16/bin")
        cls.data_dir = cls.root / "data"
        cls.socket_dir = cls.root / "socket"
        cls.socket_dir.mkdir(mode=0o700)
        cls.port = 55498

        # Run initdb with UTF8 encoding
        subprocess.run(
            [str(cls.bin_path / "initdb"), "-D", str(cls.data_dir), "-A", "trust", "--encoding=UTF8", "-U", "postgres"],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )

        # Start pg_ctl
        subprocess.run(
            [str(cls.bin_path / "pg_ctl"), "-D", str(cls.data_dir), "-l", str(cls.root / "server.log"),
             "-o", f"-h '' -k {cls.socket_dir} -p {cls.port}", "-w", "start"],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )

        cls.target_db_url = f"postgresql://postgres@/postgres?host={cls.socket_dir}&port={cls.port}"

        # 2. Dump schema from local DB and apply to test DB using psql
        local_config_file = WORKSPACE / ".local/hassan/backend.json"
        if not local_config_file.exists():
            raise unittest.SkipTest("Local database config not present in fresh Hassan standalone workspace")
        local_config = json.loads(local_config_file.read_text())
        local_db_url = local_config["DATABASE_URL"]

        dump_proc = subprocess.Popen(
            [str(cls.bin_path / "pg_dump"), "--dbname", local_db_url, "--schema-only"],
            stdout=subprocess.PIPE
        )
        subprocess.run(
            [str(cls.bin_path / "psql"), "-h", str(cls.socket_dir), "-p", str(cls.port), "-U", "postgres", "-d", "postgres"],
            stdin=dump_proc.stdout,
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        dump_proc.wait()

        # Ensure alembic_version has the head revision
        conn = psycopg2.connect(cls.target_db_url)
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SELECT version_num FROM alembic_version;")
            if not cur.fetchall():
                cur.execute("INSERT INTO alembic_version (version_num) VALUES ('zr_payroll_settlement_ledger');")
        conn.close()

        # 3. Perform export from local DB into a test export file
        cls.export_file = cls.root / "exported_setup.json"
        cls.images_bundle = cls.root / "exported_images.tar.gz"
        cls.mapping_file = cls.root / "id_mapping.json"
        cls.target_uploads = cls.root / "target_uploads"

        do_export(
            source_url=local_db_url,
            output_path=cls.export_file,
            images_bundle_path=cls.images_bundle
        )

    @classmethod
    def tearDownClass(cls):
        try:
            subprocess.run(
                [str(cls.bin_path / "pg_ctl"), "-D", str(cls.data_dir), "-m", "immediate", "stop"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
        except Exception:
            pass
        cls.tmp_dir.cleanup()

    def setUp(self):
        conn = psycopg2.connect(self.target_db_url)
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE branch_services, services, service_categories, employees CASCADE;")
            cur.execute("TRUNCATE TABLE users, branches CASCADE;")
            cur.execute("ALTER SEQUENCE branches_id_seq RESTART WITH 1;")
            cur.execute("ALTER SEQUENCE service_categories_id_seq RESTART WITH 1;")
            cur.execute("ALTER SEQUENCE services_id_seq RESTART WITH 1;")
            cur.execute("ALTER SEQUENCE branch_services_id_seq RESTART WITH 1;")
            cur.execute("ALTER SEQUENCE employees_id_seq RESTART WITH 1;")
            cur.execute("ALTER SEQUENCE users_id_seq RESTART WITH 1;")

            # Seed initial warehouse created by migrations
            cur.execute("""
                INSERT INTO branches (name, city, is_active, is_main_warehouse, allow_discounts, created_at, updated_at)
                VALUES ('Main Warehouse', 'Cairo', TRUE, TRUE, TRUE, NOW(), NOW());
            """)
        conn.close()

    def test_01_setup_railway_creates_branch_accounts_and_data(self):
        """Verify setup-railway creates 'الشيخ زايد', admin 'omar', cashier 'momen', and imports all setup data."""
        result = do_setup_railway_interactive(
            target_url=self.target_db_url,
            admin_email="omar@omarfahim.com",
            admin_password="SuperAdminPassword123!",
            cashier_password="MomenCashierPassword123!",
            auto_apply=True,
            export_file=self.export_file,
            branch_name="الشيخ زايد",
            mapping_output=self.mapping_file
        )
        self.assertEqual(result["status"], "apply_success")
        self.assertEqual(result["inserted"]["categories"], 8)
        self.assertEqual(result["inserted"]["services"], 46)
        self.assertEqual(result["inserted"]["branch_services"], 46)
        self.assertEqual(result["inserted"]["employees"], 10)

        # Verify DB records
        conn = psycopg2.connect(self.target_db_url)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # 1. Verify branch 'الشيخ زايد'
            cur.execute("SELECT id, name, city, is_active, is_main_warehouse FROM branches WHERE name = 'الشيخ زايد';")
            zayed_branch = cur.fetchone()
            self.assertIsNotNone(zayed_branch)
            self.assertFalse(zayed_branch["is_main_warehouse"])
            self.assertTrue(zayed_branch["is_active"])
            zayed_id = zayed_branch["id"]

            # 2. Verify admin 'omar'
            cur.execute("SELECT id, full_name, email, role, password_hash, branch_id FROM users WHERE full_name = 'omar';")
            omar_user = cur.fetchone()
            self.assertIsNotNone(omar_user)
            self.assertEqual(omar_user["role"], "SUPER_ADMIN")
            self.assertEqual(omar_user["email"], "omar@omarfahim.com")
            self.assertIsNone(omar_user["branch_id"])
            self.assertTrue(check_password_hash(omar_user["password_hash"], "SuperAdminPassword123!"))

            # 3. Verify cashier 'momen'
            cur.execute("SELECT id, full_name, email, role, password_hash, branch_id FROM users WHERE email = 'momen';")
            momen_user = cur.fetchone()
            self.assertIsNotNone(momen_user)
            self.assertEqual(momen_user["role"], "CASHIER")
            self.assertEqual(momen_user["branch_id"], zayed_id)
            self.assertTrue(check_password_hash(momen_user["password_hash"], "MomenCashierPassword123!"))

            # 4. Verify employee record for cashier 'momen'
            cur.execute("SELECT id, full_name, employee_type, branch_id FROM employees WHERE full_name = 'momen';")
            momen_emp = cur.fetchone()
            self.assertIsNotNone(momen_emp)
            self.assertEqual(momen_emp["employee_type"], "CASHIER")
            self.assertEqual(momen_emp["branch_id"], zayed_id)

            # 5. Verify 10 staff employees linked to 'الشيخ زايد'
            cur.execute("SELECT count(*) FROM employees WHERE branch_id = %s AND employee_type IN ('BARBER', 'ASSISTANT');", (zayed_id,))
            self.assertEqual(cur.fetchone()["count"], 10)

            # 6. Verify 46 branch_services linked to 'الشيخ زايد'
            cur.execute("SELECT count(*) FROM branch_services WHERE branch_id = %s;", (zayed_id,))
            self.assertEqual(cur.fetchone()["count"], 46)
        conn.close()

    def test_02_setup_railway_on_existing_branch_and_accounts(self):
        """Verify that when branch and accounts already exist, they are reused without modifying passwords."""
        # Pre-create branch 'الشيخ زايد'
        conn = psycopg2.connect(self.target_db_url)
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO branches (name, city, is_active, is_main_warehouse, allow_discounts, created_at, updated_at)
                VALUES ('الشيخ زايد', 'Giza', TRUE, FALSE, TRUE, NOW(), NOW())
                RETURNING id;
            """)
            z_id = cur.fetchone()[0]

            # Pre-create admin 'omar' with known hash
            from werkzeug.security import generate_password_hash
            orig_admin_hash = generate_password_hash("OriginalAdminPass999!")
            cur.execute("""
                INSERT INTO users (full_name, email, password_hash, role, branch_id, is_active, created_at, updated_at)
                VALUES ('omar', 'omar@pre-existing.com', %s, 'SUPER_ADMIN', NULL, TRUE, NOW(), NOW());
            """, (orig_admin_hash,))

            # Pre-create cashier 'momen' with known hash
            orig_cashier_hash = generate_password_hash("OriginalCashierPass888!")
            cur.execute("""
                INSERT INTO users (full_name, email, password_hash, role, branch_id, is_active, created_at, updated_at)
                VALUES ('momen', 'momen', %s, 'CASHIER', %s, TRUE, NOW(), NOW());
            """, (orig_cashier_hash, z_id))
        conn.close()

        # Run setup-railway
        result = do_setup_railway_interactive(
            target_url=self.target_db_url,
            auto_apply=True,
            export_file=self.export_file,
            branch_name="الشيخ زايد",
            mapping_output=self.mapping_file
        )
        self.assertEqual(result["status"], "apply_success")

        # Verify passwords were NOT changed and branch was NOT duplicated
        conn = psycopg2.connect(self.target_db_url)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT count(*) FROM branches WHERE name = 'الشيخ زايد';")
            self.assertEqual(cur.fetchone()["count"], 1)

            cur.execute("SELECT password_hash FROM users WHERE full_name = 'omar';")
            self.assertEqual(cur.fetchone()["password_hash"], orig_admin_hash)

            cur.execute("SELECT password_hash FROM users WHERE email = 'momen';")
            self.assertEqual(cur.fetchone()["password_hash"], orig_cashier_hash)
        conn.close()

    def test_03_setup_railway_idempotency(self):
        """Verify that running setup-railway a second time results in 0 new records."""
        # First execution
        do_setup_railway_interactive(
            target_url=self.target_db_url,
            admin_email="omar@omarfahim.com",
            admin_password="SuperAdminPassword123!",
            cashier_password="MomenCashierPassword123!",
            auto_apply=True,
            export_file=self.export_file,
            branch_name="الشيخ زايد",
            mapping_output=self.mapping_file
        )

        # Second execution (identical arguments)
        result2 = do_setup_railway_interactive(
            target_url=self.target_db_url,
            admin_email="omar@omarfahim.com",
            auto_apply=True,
            export_file=self.export_file,
            branch_name="الشيخ زايد",
            mapping_output=self.mapping_file
        )
        self.assertEqual(result2["status"], "apply_success")
        self.assertEqual(result2["inserted"]["categories"], 0)
        self.assertEqual(result2["inserted"]["services"], 0)
        self.assertEqual(result2["inserted"]["branch_services"], 0)
        self.assertEqual(result2["inserted"]["employees"], 0)

        # Confirm total counts in database
        conn = psycopg2.connect(self.target_db_url)
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM branches;")
            self.assertEqual(cur.fetchone()[0], 2)  # Warehouse + Sheikh Zayed
            cur.execute("SELECT count(*) FROM users;")
            self.assertEqual(cur.fetchone()[0], 2)  # omar + momen
            cur.execute("SELECT count(*) FROM service_categories;")
            self.assertEqual(cur.fetchone()[0], 8)
            cur.execute("SELECT count(*) FROM services;")
            self.assertEqual(cur.fetchone()[0], 46)
            cur.execute("SELECT count(*) FROM employees;")
            self.assertEqual(cur.fetchone()[0], 11) # 10 staff + 1 cashier
        conn.close()

    def test_04_setup_railway_conflict_full_rollback(self):
        """Verify conflict is reported and rolls back all writes if account or branch conflicts."""
        # Pre-seed a conflicting user 'omar' with wrong role 'CASHIER'
        conn = psycopg2.connect(self.target_db_url)
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO users (full_name, email, password_hash, role, branch_id, is_active, created_at, updated_at)
                VALUES ('omar', 'conflict@omar.invalid', 'scrypt:test', 'CASHIER', 1, TRUE, NOW(), NOW());
            """)
        conn.close()

        # Attempt setup-railway: must raise ValueError and abort
        with self.assertRaises(ValueError) as ctx:
            do_setup_railway_interactive(
                target_url=self.target_db_url,
                admin_email="omar@omarfahim.com",
                admin_password="SuperAdminPassword123!",
                cashier_password="MomenCashierPassword123!",
                auto_apply=True,
                export_file=self.export_file,
                branch_name="الشيخ زايد",
                mapping_output=self.mapping_file
            )
        self.assertIn("Conflicting admin account", str(ctx.exception))

        # Verify Sheikh Zayed branch was NOT created and no categories/services were inserted
        conn = psycopg2.connect(self.target_db_url)
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM branches WHERE name = 'الشيخ زايد';")
            self.assertEqual(cur.fetchone()[0], 0)
            cur.execute("SELECT count(*) FROM service_categories;")
            self.assertEqual(cur.fetchone()[0], 0)
            cur.execute("SELECT count(*) FROM services;")
            self.assertEqual(cur.fetchone()[0], 0)
        conn.close()

    def test_05_mini_cashier_visibility_for_sheikh_zayed(self):
        """Verify Mini cashier query retrieves active services and staff for branch 'الشيخ زايد'."""
        do_setup_railway_interactive(
            target_url=self.target_db_url,
            admin_email="omar@omarfahim.com",
            admin_password="SuperAdminPassword123!",
            cashier_password="MomenCashierPassword123!",
            auto_apply=True,
            export_file=self.export_file,
            branch_name="الشيخ زايد",
            mapping_output=self.mapping_file
        )

        conn = psycopg2.connect(self.target_db_url)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id FROM branches WHERE name = 'الشيخ زايد';")
            zayed_id = cur.fetchone()["id"]

            # Mini Services Query
            cur.execute("""
                SELECT s.id, s.name, s.price, s.category_id, sc.name as category_name
                FROM services s
                JOIN service_categories sc ON s.category_id = sc.id
                JOIN branch_services bs ON bs.service_id = s.id AND bs.branch_id = %s
                WHERE s.is_active = TRUE AND sc.is_active = TRUE AND bs.is_active = TRUE
                ORDER BY sc.name, s.name;
            """, (zayed_id,))
            services = cur.fetchall()
            self.assertEqual(len(services), 40)

            # Mini Employees Query
            cur.execute("""
                SELECT id, full_name, employee_type
                FROM employees
                WHERE branch_id = %s AND is_active = TRUE AND is_deleted = FALSE
                  AND employee_type IN ('BARBER', 'ASSISTANT')
                ORDER BY id;
            """, (zayed_id,))
            employees = cur.fetchall()
            self.assertEqual(len(employees), 10)

            names = {e["full_name"] for e in employees}
            self.assertIn("مستر عمر فهيم", names)
            self.assertIn("أحمد محمود", names)
        conn.close()

    def test_06_remap_studio_preferences(self):
        """Verify remapping Cashier Studio preferences works with Sheikh Zayed IDs."""
        do_setup_railway_interactive(
            target_url=self.target_db_url,
            admin_email="omar@omarfahim.com",
            admin_password="SuperAdminPassword123!",
            cashier_password="MomenCashierPassword123!",
            auto_apply=True,
            export_file=self.export_file,
            branch_name="الشيخ زايد",
            mapping_output=self.mapping_file
        )

        local_prefs = {
            "version": 1,
            "categoryOrder": [4, 5, 8],
            "serviceOrderByCategory": {"4": [45, 46]},
            "serviceAppearance": {"45": {"popular": True}}
        }

        result = remap_studio_preferences(
            mapping_file=self.mapping_file,
            input_prefs_source=json.dumps(local_prefs),
            target_device_id="cashier-ipad-terminal-01"
        )
        self.assertEqual(result["preferences"]["version"], 1)
        self.assertEqual(result["storage_key"], "hr:cashier-studio:hassan-ragab-salon:v1:2:cashier-ipad-terminal-01")
        self.assertIn("localStorage.setItem", result["js_snippet"])


if __name__ == "__main__":
    unittest.main()
