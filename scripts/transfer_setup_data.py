#!/usr/bin/env python3
"""
Omar Fahim Setup Data Transfer Script (Local -> Railway Live).

Transfers salon setup & seeding data (categories, services, prices, commissions,
branch links, stylists & assistants, and Cashier Studio preferences) safely
into a live migrated database without duplicating branches or overwriting
existing users/credentials.

Subcommands:
  setup-railway Direct one-command interactive setup for Omar Fahim on Railway
                (creates 'الشيخ زايد' branch, 'omar' admin, 'momen' cashier, and imports all data)
  export        Export setup data from local PostgreSQL (127.0.0.1:55433)
  import        Import setup data into target PostgreSQL with --dry-run or --apply
  remap-studio  Translate Cashier Studio browser preferences from old IDs to new live IDs
"""

import argparse
import base64
import copy
import getpass
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tarfile
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

# Attempt importing psycopg2
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    psycopg2 = None

# Werkzeug password hashing
try:
    from werkzeug.security import generate_password_hash, check_password_hash
except ImportError:
    generate_password_hash = None
    check_password_hash = None

FORMAT_VERSION = "1.0"
WORKSPACE = Path(__file__).resolve().parents[1]
DEFAULT_LOCAL_CONFIG = WORKSPACE / ".local/hassan/backend.json"
DEFAULT_EXPORT_PATH = WORKSPACE / ".local/hassan/hr_setup_data_export.json"
DEFAULT_IMAGES_BUNDLE = WORKSPACE / ".local/hassan/hr_setup_images.tar.gz"
DEFAULT_MAPPING_PATH = WORKSPACE / ".local/hassan/id_mapping.json"
DEFAULT_TARGET_UPLOADS = WORKSPACE / ".local/hassan/target_uploads"
TARGET_BRANCH_DEFAULT = "الشيخ زايد"


def redact_url(url_str: str) -> str:
    """Mask password in PostgreSQL URL for safe logging."""
    if not url_str:
        return ""
    try:
        parts = urlsplit(url_str)
        if parts.password:
            netloc = parts.netloc.replace(f":{parts.password}@", ":****@")
            return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
    except Exception:
        pass
    return re.sub(r":([^@/]+)@", ":****@", url_str)


def get_db_connection(db_url: str):
    """Create psycopg2 connection from database URL with connection timeout."""
    if not psycopg2:
        raise RuntimeError("psycopg2 is required. Run inside .local/hassan/venv or pip install psycopg2-binary.")
    conn = psycopg2.connect(db_url, connect_timeout=10)
    conn.set_client_encoding('UTF8')
    return conn


def read_local_db_url(config_path: Path) -> str:
    """Read DATABASE_URL from private local backend config."""
    if not config_path.exists():
        raise FileNotFoundError(f"Local config file not found at: {config_path}")
    data = json.loads(config_path.read_text())
    url = data.get("DATABASE_URL")
    if not url:
        raise ValueError(f"DATABASE_URL key missing in {config_path}")
    return url


def validate_password_strength(password: str) -> tuple[bool, str]:
    """Ensure password meets minimum security standards."""
    if not password:
        return False, "Password cannot be empty."
    if len(password) < 8:
        return False, "Password must be at least 8 characters long."
    if len(password) > 128:
        return False, "Password cannot exceed 128 characters."
    if password.strip() != password:
        return False, "Password cannot start or end with whitespace."
    return True, ""


def validate_email_format(email: str) -> tuple[bool, str]:
    """Validate basic email format."""
    if not email:
        return False, "Email cannot be empty."
    if "@" not in email or "." not in email:
        return False, "Invalid email format (must contain '@' and domain)."
    if len(email) > 120:
        return False, "Email cannot exceed 120 characters."
    return True, ""


# ============================================================================
# EXPORT LOGIC
# ============================================================================

def do_export(source_url: str, output_path: Path, images_bundle_path: Path, uploads_folder: Path = None):
    print(f"[*] Connecting to source DB: {redact_url(source_url)}")
    conn = get_db_connection(source_url)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # 1. Alembic version
            cur.execute("SELECT version_num FROM alembic_version LIMIT 1;")
            alembic_row = cur.fetchone()
            alembic_rev = alembic_row["version_num"] if alembic_row else "unknown"

            # 2. Branches metadata (to contextualize local salon vs warehouse)
            cur.execute("""
                SELECT id, name, city, is_active, is_main_warehouse
                FROM branches
                ORDER BY id;
            """)
            branches = cur.fetchall()

            # Identify local salon branch (the operating salon branch)
            local_salon_branch = None
            for b in branches:
                if not b["is_main_warehouse"]:
                    local_salon_branch = b
                    break

            # 3. Service Categories
            cur.execute("""
                SELECT id, name, commission_type, is_active, created_at, updated_at
                FROM service_categories
                ORDER BY id;
            """)
            categories = cur.fetchall()

            # 4. Services
            cur.execute("""
                SELECT id, name, price, barber_commission_percent, assistant_commission_percent,
                       duration_minutes, category_id, is_active, created_at, updated_at
                FROM services
                ORDER BY id;
            """)
            services = cur.fetchall()

            # 5. Branch Services
            cur.execute("""
                SELECT id, branch_id, service_id, is_active, created_at, updated_at
                FROM branch_services
                ORDER BY id;
            """)
            branch_services = cur.fetchall()

            # 6. Employees (Barbers & Assistants & Staff)
            # Exclude synthetic local QA cashier ("Omar Local Cashier QA")
            cur.execute("""
                SELECT id, full_name, phone, employee_type, image_url, branch_id,
                       base_salary, commission_wallet_balance, is_active, is_deleted,
                       status, created_at, updated_at
                FROM employees
                WHERE full_name NOT LIKE '%Cashier QA%' AND full_name NOT LIKE '%Local Cashier%'
                ORDER BY id;
            """)
            employees = cur.fetchall()

        # Build Export Payload
        export_payload = {
            "format_version": FORMAT_VERSION,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "source_info": {
                "target": redact_url(source_url),
                "alembic_revision": alembic_rev,
                "local_salon_branch": local_salon_branch
            },
            "counts": {
                "service_categories": len(categories),
                "services": len(services),
                "branch_services": len(branch_services),
                "employees": len(employees),
                "branches": len(branches)
            },
            "data": {
                "branches": branches,
                "service_categories": categories,
                "services": services,
                "branch_services": branch_services,
                "employees": employees
            }
        }

        # Ensure output directory exists and is owner-only
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(output_path.parent, 0o700)
        except Exception:
            pass

        # Write JSON with custom serializer for dates
        def json_serial(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            raise TypeError(f"Type {type(obj)} not serializable")

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(export_payload, f, indent=2, ensure_ascii=False, default=json_serial)
            f.write("\n")
        try:
            os.chmod(output_path, 0o600)
        except Exception:
            pass

        print(f"[+] Exported setup data saved to: {output_path}")
        print(f"    - Categories:      {len(categories)}")
        print(f"    - Services:        {len(services)}")
        print(f"    - Branch Services: {len(branch_services)}")
        print(f"    - Employees:       {len(employees)} (Stylists & Assistants)")
        print(f"    - Alembic Rev:     {alembic_rev}")

        # Image bundling
        if not uploads_folder:
            uploads_folder = WORKSPACE / ".local/hassan/uploads"
        
        bundled_images = 0
        if uploads_folder.exists():
            images_bundle_path.parent.mkdir(parents=True, exist_ok=True)
            with tarfile.open(images_bundle_path, "w:gz") as tar:
                for emp in employees:
                    img_rel = emp.get("image_url")
                    if img_rel:
                        img_file = uploads_folder / img_rel
                        if img_file.exists():
                            tar.add(img_file, arcname=img_rel)
                            bundled_images += 1
            print(f"[+] Bundled {bundled_images} employee images to: {images_bundle_path}")
        else:
            print(f"[!] Uploads directory not found at {uploads_folder}; skipping image bundle.")

        return export_payload

    finally:
        conn.close()


# ============================================================================
# TARGET SCHEMA & BRANCH RESOLUTION
# ============================================================================

def verify_target_schema(cur):
    """Verify that expected target tables exist and alembic_version is initialized."""
    cur.execute("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
    """)
    tables = {row["table_name"] for row in cur.fetchall()}
    required_tables = {"service_categories", "services", "branch_services", "employees", "branches", "users", "alembic_version"}
    missing = required_tables - tables
    if missing:
        raise RuntimeError(f"Target database missing required tables: {missing}. Ensure migrations have run!")

    # Check alembic_version
    cur.execute("SELECT version_num FROM alembic_version;")
    revs = [r["version_num"] for r in cur.fetchall()]
    if not revs:
        raise RuntimeError("Target database has empty alembic_version table. Run migrations first!")
    return revs[0]


def resolve_or_plan_branch(cur, branch_name: str, create_if_missing: bool = True):
    """
    Find branch by exact name.
    If exists: validate it is active and not main warehouse.
    If missing and create_if_missing is True: return planning dict with to_create=True.
    """
    cur.execute("""
        SELECT id, name, city, is_active, is_main_warehouse
        FROM branches
        WHERE name = %s;
    """, (branch_name,))
    branch = cur.fetchone()

    if branch:
        if branch["is_main_warehouse"]:
            raise ValueError(f"Branch '{branch_name}' (ID: {branch['id']}) is configured as the main warehouse. Operating salon branch cannot be a warehouse.")
        if not branch["is_active"]:
            raise ValueError(f"Branch '{branch_name}' (ID: {branch['id']}) is inactive.")
        return {
            "id": branch["id"],
            "name": branch["name"],
            "city": branch["city"],
            "is_active": branch["is_active"],
            "is_main_warehouse": False,
            "to_create": False
        }

    if not create_if_missing:
        raise ValueError(f"Branch '{branch_name}' not found on target database.")

    return {
        "id": None,
        "name": branch_name,
        "city": "Giza",
        "is_active": True,
        "is_main_warehouse": False,
        "to_create": True
    }


# ============================================================================
# USER ACCOUNTS PLANNING & RESOLUTION
# ============================================================================

def plan_admin_account(cur, email: str = None, password: str = None):
    """
    Plan admin account 'omar' (role: SUPER_ADMIN).
    Checks if 'omar' or the given email already exists in users.
    If exists and compatible (SUPER_ADMIN): reuse existing account without modifying password.
    If exists and conflicting: raise ValueError.
    If missing: plan creation with hashed password.
    """
    query = "SELECT id, full_name, email, role, branch_id, is_active FROM users WHERE full_name = 'omar'"
    params = []
    if email:
        query += " OR email = %s"
        params.append(email)

    cur.execute(query, tuple(params))
    existing_users = cur.fetchall()

    if existing_users:
        user = existing_users[0]
        if user["role"] != "SUPER_ADMIN" or not user["is_active"]:
            raise ValueError(f"Conflicting admin account '{user['full_name']}' ({user['email']}): role is {user['role']}, active={user['is_active']}. Expected active SUPER_ADMIN.")
        return {
            "id": user["id"],
            "username": "omar",
            "full_name": user["full_name"],
            "email": user["email"],
            "role": "SUPER_ADMIN",
            "branch_id": None,
            "to_create": False,
            "password_hash": None
        }

    if not email:
        raise ValueError("Admin email is required to create admin account 'omar'.")
    if not password:
        raise ValueError("Admin password is required to create admin account 'omar'.")

    val_ok, val_err = validate_password_strength(password)
    if not val_ok:
        raise ValueError(f"Admin password validation failed: {val_err}")

    if not generate_password_hash:
        raise RuntimeError("werkzeug is required for password hashing.")

    hashed = generate_password_hash(password)
    return {
        "id": None,
        "username": "omar",
        "full_name": "omar",
        "email": email,
        "role": "SUPER_ADMIN",
        "branch_id": None,
        "to_create": True,
        "password_hash": hashed
    }


def plan_cashier_account(cur, target_branch_id: int, password: str = None):
    """
    Plan cashier account 'momen' (role: CASHIER, branch: target_branch_id).
    Checks if 'momen' already exists in users.
    If exists and compatible (CASHIER for target_branch_id): reuse without modifying password.
    If exists and conflicting: raise ValueError.
    If missing: plan creation with hashed password.
    """
    cur.execute("SELECT id, full_name, email, role, branch_id, is_active FROM users WHERE email = 'momen' OR full_name = 'momen';")
    existing_users = cur.fetchall()

    if existing_users:
        user = existing_users[0]
        if user["role"] != "CASHIER":
            raise ValueError(f"Conflicting cashier user 'momen': role is {user['role']}, expected CASHIER.")
        if target_branch_id and user["branch_id"] != target_branch_id:
            raise ValueError(f"Conflicting cashier user 'momen': assigned to branch ID {user['branch_id']}, expected {target_branch_id}.")
        return {
            "id": user["id"],
            "username": "momen",
            "full_name": "momen",
            "email": user["email"],
            "role": "CASHIER",
            "branch_id": user["branch_id"],
            "to_create": False,
            "password_hash": None
        }

    if not password:
        raise ValueError("Cashier password is required to create cashier account 'momen'.")

    val_ok, val_err = validate_password_strength(password)
    if not val_ok:
        raise ValueError(f"Cashier password validation failed: {val_err}")

    if not generate_password_hash:
        raise RuntimeError("werkzeug is required for password hashing.")

    hashed = generate_password_hash(password)
    return {
        "id": None,
        "username": "momen",
        "full_name": "momen",
        "email": "momen",
        "role": "CASHIER",
        "branch_id": target_branch_id,
        "to_create": True,
        "password_hash": hashed
    }


# ============================================================================
# MAIN IMPORT / SETUP WORKFLOW
# ============================================================================

def do_import(target_url: str,
              export_file: Path,
              target_branch_name: str = TARGET_BRANCH_DEFAULT,
              target_branch_id: int = None,
              create_branch_if_missing: bool = True,
              admin_email: str = None,
              admin_password: str = None,
              cashier_password: str = None,
              dry_run: bool = True,
              on_conflict: str = "abort",
              mapping_output: Path = DEFAULT_MAPPING_PATH,
              images_bundle: Path = DEFAULT_IMAGES_BUNDLE,
              target_uploads_dir: Path = DEFAULT_TARGET_UPLOADS):
    """
    Import setup data into target database.
    dry_run: if True, reads existing target state, computes diffs, prints plan, rolls back.
    dry_run: if False, performs atomic import in a single transaction.
    """
    if not export_file.exists():
        raise FileNotFoundError(f"Export file not found: {export_file}")

    with open(export_file, "r", encoding="utf-8") as f:
        export_payload = json.load(f)

    if export_payload.get("format_version") != FORMAT_VERSION:
        raise ValueError(f"Unsupported export format version: {export_payload.get('format_version')}")

    data = export_payload["data"]
    src_categories = data["service_categories"]
    src_services = data["services"]
    src_employees = data["employees"]

    print(f"[*] Target DB: {redact_url(target_url)}")
    print(f"[*] Mode:      {'[DRY-RUN / PREVIEW]' if dry_run else '[APPLY / COMMIT]'}")

    conn = get_db_connection(target_url)
    conn.autocommit = False

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # 1. Schema check
            target_rev = verify_target_schema(cur)
            print(f"[+] Target schema verified. Alembic revision: {target_rev}")

            # 2. Target branch resolution / planning
            if target_branch_id is not None:
                cur.execute("SELECT id, name, city, is_active, is_main_warehouse FROM branches WHERE id = %s", (target_branch_id,))
                target_branch = cur.fetchone()
                if not target_branch:
                    raise ValueError(f"Target branch ID {target_branch_id} not found in target database.")
                target_branch["to_create"] = False
            else:
                target_branch = resolve_or_plan_branch(cur, target_branch_name, create_if_missing=create_branch_if_missing)

            target_b_id = target_branch["id"]
            if target_branch["to_create"]:
                print(f"[+] Branch '{target_branch['name']}' not found on target; will be created on apply.")
            else:
                print(f"[+] Target branch resolved: ID={target_b_id}, Name='{target_branch['name']}', City='{target_branch['city']}'")

            # 3. Plan Admin ('omar') and Cashier ('momen') Accounts
            admin_plan = None
            cashier_plan = None
            if admin_email or admin_password:
                admin_plan = plan_admin_account(cur, email=admin_email, password=admin_password)
            if cashier_password or target_b_id is not None:
                try:
                    cashier_plan = plan_cashier_account(cur, target_branch_id=target_b_id, password=cashier_password)
                except ValueError as e:
                    if "password is required" in str(e) and not cashier_password:
                        pass  # Skip if cashier password wasn't provided in raw import mode
                    else:
                        raise

            # 4. Read existing target state for diffing and idempotency
            cur.execute("SELECT id, name, commission_type, is_active FROM service_categories;")
            target_categories = {row["name"]: row for row in cur.fetchall()}

            cur.execute("SELECT id, name, price, barber_commission_percent, assistant_commission_percent, category_id, is_active FROM services;")
            target_services = {}
            for row in cur.fetchall():
                target_services[(row["category_id"], row["name"])] = row

            cur.execute("SELECT id, full_name, phone, employee_type, branch_id, base_salary, is_active, status FROM employees;")
            target_employees_by_phone = {}
            target_employees_by_name = {}
            for row in cur.fetchall():
                if row.get("phone"):
                    target_employees_by_phone[row["phone"]] = row
                target_employees_by_name[(row["branch_id"], row["full_name"])] = row

            target_branch_services = {}
            if target_b_id is not None:
                cur.execute("SELECT service_id, is_active FROM branch_services WHERE branch_id = %s;", (target_b_id,))
                target_branch_services = {row["service_id"]: row for row in cur.fetchall()}

            # ------------------------------------------------------------
            # PLAN & CONFLICT ANALYSIS
            # ------------------------------------------------------------
            category_mapping = {}  # local_id -> target_id
            categories_to_insert = []
            category_matches = []
            category_conflicts = []

            for cat in src_categories:
                name = cat["name"]
                if name in target_categories:
                    existing = target_categories[name]
                    if existing["commission_type"] == cat["commission_type"]:
                        category_matches.append((cat, existing))
                        category_mapping[cat["id"]] = existing["id"]
                    else:
                        category_conflicts.append({
                            "type": "category",
                            "name": name,
                            "source_id": cat["id"],
                            "target_id": existing["id"],
                            "reason": f"commission_type differs: source={cat['commission_type']} vs target={existing['commission_type']}"
                        })
                        category_mapping[cat["id"]] = existing["id"]
                else:
                    categories_to_insert.append(cat)

            # Services analysis
            service_mapping = {}  # local_id -> target_id
            services_to_insert = []
            service_matches = []
            service_conflicts = []

            for s in src_services:
                s_name = s["name"]
                src_cat_id = s["category_id"]
                target_cat_id = category_mapping.get(src_cat_id)

                existing = None
                if target_cat_id is not None and (target_cat_id, s_name) in target_services:
                    existing = target_services[(target_cat_id, s_name)]
                else:
                    for (cid, sname), srow in target_services.items():
                        if sname == s_name:
                            existing = srow
                            break

                if existing:
                    diffs = []
                    if abs(float(existing["price"]) - float(s["price"])) > 0.001:
                        diffs.append(f"price: src={s['price']} vs target={existing['price']}")
                    if abs(float(existing["barber_commission_percent"]) - float(s["barber_commission_percent"])) > 0.001:
                        diffs.append(f"barber_comm: src={s['barber_commission_percent']}% vs target={existing['barber_commission_percent']}%")
                    if abs(float(existing["assistant_commission_percent"]) - float(s["assistant_commission_percent"])) > 0.001:
                        diffs.append(f"asst_comm: src={s['assistant_commission_percent']}% vs target={existing['assistant_commission_percent']}%")
                    
                    if not diffs:
                        service_matches.append((s, existing))
                        service_mapping[s["id"]] = existing["id"]
                    else:
                        service_conflicts.append({
                            "type": "service",
                            "name": s_name,
                            "source_id": s["id"],
                            "target_id": existing["id"],
                            "reason": ", ".join(diffs)
                        })
                        service_mapping[s["id"]] = existing["id"]
                else:
                    services_to_insert.append(s)

            # Employees analysis
            employee_mapping = {}  # local_id -> target_id
            employees_to_insert = []
            employee_matches = []
            employee_conflicts = []

            for emp in src_employees:
                phone = emp.get("phone")
                name = emp["full_name"]
                existing = None

                if phone and phone in target_employees_by_phone:
                    existing = target_employees_by_phone[phone]
                elif target_b_id is not None and (target_b_id, name) in target_employees_by_name:
                    existing = target_employees_by_name[(target_b_id, name)]

                if existing:
                    diffs = []
                    if existing["employee_type"] != emp["employee_type"]:
                        diffs.append(f"type: src={emp['employee_type']} vs target={existing['employee_type']}")
                    if abs(float(existing["base_salary"]) - float(emp["base_salary"])) > 0.001:
                        diffs.append(f"base_salary: src={emp['base_salary']} vs target={existing['base_salary']}")
                    
                    if not diffs:
                        employee_matches.append((emp, existing))
                        employee_mapping[emp["id"]] = existing["id"]
                    else:
                        employee_conflicts.append({
                            "type": "employee",
                            "name": name,
                            "source_id": emp["id"],
                            "target_id": existing["id"],
                            "reason": ", ".join(diffs)
                        })
                        employee_mapping[emp["id"]] = existing["id"]
                else:
                    employees_to_insert.append(emp)

            # Branch services to insert
            branch_services_to_insert = []
            for s in src_services:
                s_id = service_mapping.get(s["id"])
                if s_id and s_id not in target_branch_services:
                    branch_services_to_insert.append((s["id"], s["is_active"]))
                elif not s_id:
                    branch_services_to_insert.append((s["id"], s["is_active"]))

            # ------------------------------------------------------------
            # REPORT SUMMARY
            # ------------------------------------------------------------
            total_conflicts = len(category_conflicts) + len(service_conflicts) + len(employee_conflicts)

            print("\n================== IMPORT ANALYSIS SUMMARY ==================")
            print(f"Target Branch:      '{target_branch['name']}' ({'TO CREATE' if target_branch['to_create'] else f'EXISTS, ID: {target_b_id}'})")
            if admin_plan:
                print(f"Admin User 'omar':  {admin_plan['email']} ({'TO CREATE' if admin_plan['to_create'] else f'EXISTS, ID: {admin_plan['id']}'})")
            if cashier_plan:
                print(f"Cashier 'momen':    momen ({'TO CREATE' if cashier_plan['to_create'] else f'EXISTS, ID: {cashier_plan['id']}'})")
            print(f"Service Categories: {len(categories_to_insert)} to insert, {len(category_matches)} matching, {len(category_conflicts)} conflicts")
            print(f"Services:           {len(services_to_insert)} to insert, {len(service_matches)} matching, {len(service_conflicts)} conflicts")
            print(f"Branch Services:    {len(branch_services_to_insert)} to link to branch '{target_branch['name']}'")
            print(f"Employees (Staff):  {len(employees_to_insert)} to insert, {len(employee_matches)} matching, {len(employee_conflicts)} conflicts")
            print(f"Total Conflicts:    {total_conflicts}")
            print("=============================================================\n")

            if total_conflicts > 0:
                print("⚠️ CONFLICT DETAILS DETECTED:")
                for c in category_conflicts + service_conflicts + employee_conflicts:
                    print(f"  - [{c['type'].upper()}] '{c['name']}' (src_id={c['source_id']}, target_id={c['target_id']}): {c['reason']}")
                print()

            if dry_run:
                conn.rollback()
                print("[+] DRY-RUN COMPLETE. No database changes were made (transaction rolled back).")
                if total_conflicts > 0 and on_conflict == "abort":
                    print("ℹ️ Note: --apply will abort on these conflicts unless --on-conflict is set to 'skip' or 'overwrite'.")
                return {
                    "status": "dry_run_success",
                    "branch_to_create": target_branch["to_create"],
                    "admin_to_create": admin_plan["to_create"] if admin_plan else False,
                    "cashier_to_create": cashier_plan["to_create"] if cashier_plan else False,
                    "to_insert": {
                        "categories": len(categories_to_insert),
                        "services": len(services_to_insert),
                        "branch_services": len(branch_services_to_insert),
                        "employees": len(employees_to_insert)
                    },
                    "matches": {
                        "categories": len(category_matches),
                        "services": len(service_matches),
                        "employees": len(employee_matches)
                    },
                    "conflicts": total_conflicts
                }

            # ------------------------------------------------------------
            # APPLY WRITES (SINGLE TRANSACTION)
            # ------------------------------------------------------------
            if total_conflicts > 0 and on_conflict == "abort":
                conn.rollback()
                raise RuntimeError(f"Import aborted: {total_conflicts} conflicts found. Review them in --dry-run or use --on-conflict skip|overwrite.")

            # 1. Create Target Branch if missing
            if target_branch["to_create"]:
                cur.execute("""
                    INSERT INTO branches (name, city, is_active, is_main_warehouse, allow_discounts, created_at, updated_at)
                    VALUES (%s, %s, TRUE, FALSE, TRUE, NOW(), NOW())
                    RETURNING id;
                """, (target_branch["name"], target_branch["city"]))
                target_b_id = cur.fetchone()["id"]
                target_branch["id"] = target_b_id
                print(f"[+] Created branch '{target_branch['name']}' with ID: {target_b_id}")

            # 2. Create Admin Account 'omar' if missing
            if admin_plan and admin_plan["to_create"]:
                cur.execute("""
                    INSERT INTO users (full_name, email, password_hash, role, branch_id, is_active, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, TRUE, NOW(), NOW())
                    RETURNING id;
                """, (admin_plan["full_name"], admin_plan["email"], admin_plan["password_hash"],
                      admin_plan["role"], admin_plan["branch_id"]))
                admin_id = cur.fetchone()["id"]
                print(f"[+] Created admin account 'omar' (ID: {admin_id}, Email: {admin_plan['email']})")

            # 3. Create Cashier Account 'momen' if missing
            if cashier_plan and cashier_plan["to_create"]:
                cur.execute("""
                    INSERT INTO users (full_name, email, password_hash, role, branch_id, is_active, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, TRUE, NOW(), NOW())
                    RETURNING id;
                """, (cashier_plan["full_name"], cashier_plan["email"], cashier_plan["password_hash"],
                      cashier_plan["role"], target_b_id))
                cashier_id = cur.fetchone()["id"]
                print(f"[+] Created cashier account 'momen' (ID: {cashier_id}, Role: CASHIER, Branch: {target_b_id})")

                # Also create corresponding Employee record for CASHIER (required by Mini login)
                cur.execute("""
                    SELECT id FROM employees WHERE full_name = 'momen' AND branch_id = %s AND employee_type = 'CASHIER';
                """, (target_b_id,))
                existing_emp = cur.fetchone()
                if not existing_emp:
                    cur.execute("""
                        INSERT INTO employees (full_name, phone, employee_type, branch_id, base_salary,
                                              commission_wallet_balance, is_active, is_deleted, status,
                                              created_at, updated_at)
                        VALUES ('momen', NULL, 'CASHIER', %s, 0.0, 0.0, TRUE, FALSE, 'ACTIVE', NOW(), NOW())
                        RETURNING id;
                    """, (target_b_id,))
                    print(f"[+] Created employee cashier record 'momen' (ID: {cur.fetchone()['id']})")

            # 4. Insert Categories
            for cat in categories_to_insert:
                cur.execute("""
                    INSERT INTO service_categories (name, commission_type, is_active, created_at, updated_at)
                    VALUES (%s, %s, %s, NOW(), NOW())
                    RETURNING id;
                """, (cat["name"], cat["commission_type"], cat["is_active"]))
                new_id = cur.fetchone()["id"]
                category_mapping[cat["id"]] = new_id

            # 5. Insert Services
            for s in services_to_insert:
                target_cat_id = category_mapping[s["category_id"]]
                cur.execute("""
                    INSERT INTO services (name, price, barber_commission_percent, assistant_commission_percent,
                                         duration_minutes, category_id, is_active, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                    RETURNING id;
                """, (s["name"], s["price"], s["barber_commission_percent"], s["assistant_commission_percent"],
                      s.get("duration_minutes"), target_cat_id, s["is_active"]))
                new_id = cur.fetchone()["id"]
                service_mapping[s["id"]] = new_id

            # 6. Handle Service Overwrites if requested
            if on_conflict == "overwrite":
                for conf in service_conflicts:
                    src_s = next(x for x in src_services if x["id"] == conf["source_id"])
                    cur.execute("""
                        UPDATE services
                        SET price = %s, barber_commission_percent = %s, assistant_commission_percent = %s,
                            is_active = %s, updated_at = NOW()
                        WHERE id = %s;
                    """, (src_s["price"], src_s["barber_commission_percent"], src_s["assistant_commission_percent"],
                          src_s["is_active"], conf["target_id"]))

            # 7. Insert Branch Services (Auto-link to target branch)
            for src_s_id, is_active in branch_services_to_insert:
                t_service_id = service_mapping[src_s_id]
                cur.execute("""
                    INSERT INTO branch_services (branch_id, service_id, is_active, created_at, updated_at)
                    VALUES (%s, %s, %s, NOW(), NOW())
                    ON CONFLICT (branch_id, service_id)
                    DO UPDATE SET is_active = EXCLUDED.is_active, updated_at = NOW();
                """, (target_b_id, t_service_id, is_active))

            # 8. Insert Employees
            image_rename_plan = {}  # old_path -> new_path
            for emp in employees_to_insert:
                old_img = emp.get("image_url")
                new_img = None

                cur.execute("""
                    INSERT INTO employees (full_name, phone, employee_type, image_url, branch_id,
                                          base_salary, commission_wallet_balance, is_active, is_deleted,
                                          status, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, 0.0, %s, %s, %s, NOW(), NOW())
                    RETURNING id;
                """, (emp["full_name"], emp.get("phone"), emp["employee_type"], None,
                      target_b_id, emp.get("base_salary", 0.0), emp.get("is_active", True),
                      emp.get("is_deleted", False), emp.get("status", "ACTIVE")))
                new_emp_id = cur.fetchone()["id"]
                employee_mapping[emp["id"]] = new_emp_id

                if old_img:
                    filename = Path(old_img).name
                    new_img = f"employees/{new_emp_id}/{filename}"
                    image_rename_plan[old_img] = new_img
                    cur.execute("UPDATE employees SET image_url = %s WHERE id = %s", (new_img, new_emp_id))

            # Commit the entire import transaction!
            conn.commit()
            print("[+] TRANSACTION COMMITTED SUCCESSFULLY!")

            # ------------------------------------------------------------
            # POST-COMMIT CASHIER & MINI VERIFICATION
            # ------------------------------------------------------------
            # 1. Mini Services Query
            cur.execute("""
                SELECT s.id, s.name, s.price, sc.name as category_name
                FROM services s
                JOIN service_categories sc ON s.category_id = sc.id
                JOIN branch_services bs ON bs.service_id = s.id AND bs.branch_id = %s
                WHERE s.is_active = TRUE AND sc.is_active = TRUE AND bs.is_active = TRUE
                ORDER BY sc.name, s.name;
            """, (target_b_id,))
            mini_services = cur.fetchall()

            # 2. Mini Employees Query (Barbers and Assistants)
            cur.execute("""
                SELECT id, full_name, employee_type, phone
                FROM employees
                WHERE branch_id = %s AND is_active = TRUE AND is_deleted = FALSE
                  AND employee_type IN ('BARBER', 'ASSISTANT')
                ORDER BY id;
            """, (target_b_id,))
            mini_employees = cur.fetchall()

            print("\n================= POST-IMPORT VERIFICATION =================")
            print(f"Target Branch:              {target_branch['name']} (ID: {target_b_id})")
            print(f"Mini Active Services:       {len(mini_services)} services visible in Cashier")
            print(f"Mini Active Stylists/Staff: {len(mini_employees)} staff members visible for booking")
            for emp in mini_employees:
                print(f"   - [{emp['employee_type']}] #{emp['id']} {emp['full_name']}")
            print("============================================================\n")

            # ------------------------------------------------------------
            # PERSIST ID MAPPINGS FOR CASHIER STUDIO
            # ------------------------------------------------------------
            mapping_data = {
                "format_version": FORMAT_VERSION,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "target_branch_id": target_b_id,
                "target_branch_name": target_branch["name"],
                "category_id_map": {str(k): v for k, v in category_mapping.items()},
                "service_id_map": {str(k): v for k, v in service_mapping.items()},
                "employee_id_map": {str(k): v for k, v in employee_mapping.items()},
                "image_rename_plan": image_rename_plan
            }
            mapping_output.parent.mkdir(parents=True, exist_ok=True)
            with open(mapping_output, "w", encoding="utf-8") as f:
                json.dump(mapping_data, f, indent=2)
            print(f"[+] ID mapping persisted to: {mapping_output}")

            # ------------------------------------------------------------
            # PROCESS IMAGES FOR TARGET UPLOADS
            # ------------------------------------------------------------
            if images_bundle and images_bundle.exists() and image_rename_plan:
                target_uploads_dir.mkdir(parents=True, exist_ok=True)
                with tarfile.open(images_bundle, "r:gz") as tar:
                    for old_rel, new_rel in image_rename_plan.items():
                        try:
                            member = tar.getmember(old_rel)
                            extracted = tar.extractfile(member)
                            if extracted:
                                dest_file = target_uploads_dir / new_rel
                                dest_file.parent.mkdir(parents=True, exist_ok=True)
                                with open(dest_file, "wb") as df:
                                    shutil.copyfileobj(extracted, df)
                        except KeyError:
                            pass
                print(f"[+] Prepared employee images in target layout at: {target_uploads_dir}")
                print(f"    To copy to live Railway container: rsync -av {target_uploads_dir}/ <target_uploads_folder>/")

            return {
                "status": "apply_success",
                "target_branch_id": target_b_id,
                "inserted": {
                    "categories": len(categories_to_insert),
                    "services": len(services_to_insert),
                    "branch_services": len(branch_services_to_insert),
                    "employees": len(employees_to_insert)
                },
                "verified": {
                    "mini_services": len(mini_services),
                    "mini_employees": len(mini_employees)
                },
                "mapping_file": str(mapping_output)
            }

    except Exception as e:
        conn.rollback()
        print(f"\n❌ IMPORT FAILED: {e}")
        print("   Transaction was completely rolled back; target database remains untouched.")
        raise
    finally:
        conn.close()


# ============================================================================
# INTERACTIVE SETUP-RAILWAY SUBCOMMAND
# ============================================================================

def do_setup_railway_interactive(target_url: str = None,
                                admin_email: str = None,
                                admin_password: str = None,
                                cashier_password: str = None,
                                auto_apply: bool = False,
                                export_file: Path = DEFAULT_EXPORT_PATH,
                                branch_name: str = TARGET_BRANCH_DEFAULT,
                                mapping_output: Path = DEFAULT_MAPPING_PATH):
    """
    Dedicated unified command for Omar Fahim Railway setup.
    1. Prompts for DB connection if not set.
    2. Prompts for admin email & password for 'omar'.
    3. Prompts for cashier password for 'momen'.
    4. Shows preview (dry-run).
    5. Asks user to type 'APPLY'.
    6. Executes branch & account creation and setup data import inside 1 transaction.
    """
    print("\n" + "=" * 70)
    print("  Omar Fahim Standalone - Railway Production Setup & Seeding Tool")
    print("=" * 70)

    # 1. Database Connection URL
    db_url = target_url or os.environ.get("TARGET_DATABASE_URL")
    if not db_url:
        print("\n[?] Enter Railway PostgreSQL Connection URL (input will be hidden):")
        db_url = getpass.getpass("    Database URL: ").strip()
        if not db_url:
            print("[-] No database URL provided. Aborting.")
            sys.exit(1)

    # Validate target connectivity
    print(f"\n[*] Connecting to target DB: {redact_url(db_url)}")
    test_conn = get_db_connection(db_url)
    try:
        with test_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            verify_target_schema(cur)
            cur.execute("SELECT id, full_name, email, role FROM users WHERE full_name = 'omar';")
            existing_omar = cur.fetchone()
            cur.execute("SELECT id, full_name, email, role FROM users WHERE email = 'momen' OR full_name = 'momen';")
            existing_momen = cur.fetchone()
    finally:
        test_conn.close()

    # 2. Admin 'omar' credentials
    if existing_omar:
        print(f"[✓] Admin user 'omar' ({existing_omar['email']}) already exists. Existing credentials preserved.")
        a_email = existing_omar["email"]
        a_pass = None
    else:
        print("\n[*] Setup Admin User 'omar' (SUPER_ADMIN):")
        a_email = admin_email
        while not a_email:
            raw_email = input("    Enter Admin Email for 'omar': ").strip()
            ok, err = validate_email_format(raw_email)
            if ok:
                a_email = raw_email
            else:
                print(f"    ❌ {err}")

        a_pass = admin_password
        while not a_pass:
            p1 = getpass.getpass("    Enter Admin Password (hidden, min 8 chars): ")
            ok, err = validate_password_strength(p1)
            if not ok:
                print(f"    ❌ {err}")
                continue
            p2 = getpass.getpass("    Confirm Admin Password: ")
            if p1 != p2:
                print("    ❌ Passwords do not match.")
                continue
            a_pass = p1

    # 3. Cashier 'momen' credentials
    if existing_momen:
        print(f"[✓] Cashier user 'momen' already exists for branch. Existing credentials preserved.")
        c_pass = None
    else:
        print(f"\n[*] Setup Cashier User 'momen' (CASHIER for branch '{branch_name}'):")
        c_pass = cashier_password
        while not c_pass:
            p1 = getpass.getpass("    Enter Cashier Password for 'momen' (hidden, min 8 chars): ")
            ok, err = validate_password_strength(p1)
            if not ok:
                print(f"    ❌ {err}")
                continue
            p2 = getpass.getpass("    Confirm Cashier Password: ")
            if p1 != p2:
                print("    ❌ Passwords do not match.")
                continue
            c_pass = p1

    # 4. Run Dry-Run Preview
    print("\n[*] Running Dry-Run analysis against Railway database...")
    dry_result = do_import(
        target_url=db_url,
        export_file=export_file,
        target_branch_name=branch_name,
        create_branch_if_missing=True,
        admin_email=a_email,
        admin_password=a_pass,
        cashier_password=c_pass,
        dry_run=True,
        mapping_output=mapping_output
    )

    if dry_result["conflicts"] > 0:
        print("❌ Cannot proceed with APPLY due to conflicts detected above.")
        print("   Please resolve the conflicts or inspect your target database.")
        sys.exit(2)

    # 5. Interactive Confirmation
    if not auto_apply:
        print("\n" + "-" * 70)
        confirm = input("👉 Type 'APPLY' to commit branch, accounts and setup data to Railway: ").strip()
        if confirm != "APPLY":
            print("\n[-] Operation cancelled by user. No writes performed.")
            return {"status": "cancelled"}

    # 6. Apply Execution
    print("\n[*] Committing setup and data transfer in a single transaction...")
    apply_result = do_import(
        target_url=db_url,
        export_file=export_file,
        target_branch_name=branch_name,
        create_branch_if_missing=True,
        admin_email=a_email,
        admin_password=a_pass,
        cashier_password=c_pass,
        dry_run=False,
        mapping_output=mapping_output
    )

    print("\n" + "=" * 70)
    print("🎉 OMAR FAHIM SETUP ON RAILWAY COMPLETED SUCCESSFULLY!")
    print(f"   - Branch:          {branch_name}")
    print(f"   - Admin Account:   omar ({a_email})")
    print(f"   - Cashier Account: momen")
    print(f"   - Active Services: {apply_result['verified']['mini_services']}")
    print(f"   - Active Staff:    {apply_result['verified']['mini_employees']}")
    print("=" * 70 + "\n")
    return apply_result


# ============================================================================
# CASHIER STUDIO PREFERENCES REMAPPING
# ============================================================================

def remap_studio_preferences(mapping_file: Path, input_prefs_source: str, target_device_id: str, target_branch_id: int = None):
    """
    Translates Cashier Studio preferences JSON from local IDs to live IDs.
    Returns the remapped JSON object and the exact localStorage key & script to paste in browser.
    """
    if not mapping_file.exists():
        raise FileNotFoundError(f"Mapping file not found: {mapping_file}")

    with open(mapping_file, "r", encoding="utf-8") as f:
        mapping_data = json.load(f)

    cat_map = {int(k): v for k, v in mapping_data["category_id_map"].items()}
    srv_map = {int(k): v for k, v in mapping_data["service_id_map"].items()}
    t_branch_id = target_branch_id or mapping_data["target_branch_id"]

    # Parse input preferences (from file path or raw JSON string)
    if Path(input_prefs_source).exists():
        raw_prefs = json.loads(Path(input_prefs_source).read_text(encoding="utf-8"))
    else:
        raw_prefs = json.loads(input_prefs_source)

    if raw_prefs.get("version") != 1:
        raise ValueError("Unsupported Cashier Studio preferences version (expected 1)")

    # 1. Remap categoryOrder
    old_cat_order = raw_prefs.get("categoryOrder", [])
    new_cat_order = [cat_map[cid] for cid in old_cat_order if cid in cat_map]
    for new_cid in cat_map.values():
        if new_cid not in new_cat_order:
            new_cat_order.append(new_cid)

    # 2. Remap serviceOrderByCategory
    old_svc_order = raw_prefs.get("serviceOrderByCategory", {})
    new_svc_order = {}
    for old_cid_str, s_list in old_svc_order.items():
        try:
            old_cid = int(old_cid_str)
        except ValueError:
            continue
        new_cid = cat_map.get(old_cid)
        if new_cid is not None:
            new_s_list = [srv_map[sid] for sid in s_list if sid in srv_map]
            new_svc_order[str(new_cid)] = new_s_list

    # 3. Remap serviceAppearance (POPULAR flags)
    old_appearance = raw_prefs.get("serviceAppearance", {})
    new_appearance = {}
    for old_sid_str, app_obj in old_appearance.items():
        try:
            old_sid = int(old_sid_str)
        except ValueError:
            continue
        new_sid = srv_map.get(old_sid)
        if new_sid is not None:
            new_appearance[str(new_sid)] = app_obj

    remapped_preferences = {
        "version": 1,
        "categoryOrder": new_cat_order,
        "serviceOrderByCategory": new_svc_order,
        "serviceAppearance": new_appearance
    }

    from urllib.parse import quote
    storage_key = f"hr:cashier-studio:hassan-ragab-salon:v1:{t_branch_id}:{quote(target_device_id)}"
    serialized = json.dumps(remapped_preferences, ensure_ascii=False)

    js_snippet = f"localStorage.setItem('{storage_key}', JSON.stringify({serialized}));"

    print("\n================ CASHIER STUDIO PREFERENCES REMAPPING ================")
    print(f"Target Branch ID:  {t_branch_id}")
    print(f"Target Device ID:  {target_device_id}")
    print(f"LocalStorage Key:  {storage_key}")
    print("\n[Copy & Paste this one-liner into Cashier Browser Console on live domain]:\n")
    print(js_snippet)
    print("\n======================================================================\n")

    return {
        "storage_key": storage_key,
        "preferences": remapped_preferences,
        "js_snippet": js_snippet
    }


# ============================================================================
# CLI ENTRY POINT
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Omar Fahim Setup Data Transfer Tool (Local -> Railway Live)",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    # --- SETUP-RAILWAY (UNIFIED INTERACTIVE COMMAND) ---
    p_setup = subparsers.add_parser("setup-railway", help="Unified interactive command for Omar Fahim Railway setup")
    p_setup.add_argument("--target-db-url", "-d", type=str,
                         default=os.environ.get("TARGET_DATABASE_URL"),
                         help="Target Railway PostgreSQL connection URL")
    p_setup.add_argument("--branch-name", "-b", type=str, default=TARGET_BRANCH_DEFAULT,
                         help=f"Target branch name (default: '{TARGET_BRANCH_DEFAULT}')")
    p_setup.add_argument("--admin-email", type=str, default=None,
                         help="Email address for admin 'omar'")
    p_setup.add_argument("--admin-password", type=str, default=None,
                         help="Password for admin 'omar' (or prompt securely)")
    p_setup.add_argument("--cashier-password", type=str, default=None,
                         help="Password for cashier 'momen' (or prompt securely)")
    p_setup.add_argument("--export-file", "-f", type=Path, default=DEFAULT_EXPORT_PATH,
                         help="Path to export JSON file")
    p_setup.add_argument("--auto-apply", action="store_true",
                         help="Skip interactive 'APPLY' prompt (for scripts/tests)")
    p_setup.add_argument("--mapping-output", type=Path, default=DEFAULT_MAPPING_PATH,
                         help="Path to write ID mapping JSON")

    # --- EXPORT ---
    p_export = subparsers.add_parser("export", help="Export setup data from local database")
    p_export.add_argument("--config", type=Path, default=DEFAULT_LOCAL_CONFIG,
                          help="Path to private local backend.json")
    p_export.add_argument("--source-db-url", type=str, default=None,
                          help="Direct PostgreSQL URL override for local DB")
    p_export.add_argument("--output", "-o", type=Path, default=DEFAULT_EXPORT_PATH,
                          help="Destination path for exported JSON")
    p_export.add_argument("--images-output", type=Path, default=DEFAULT_IMAGES_BUNDLE,
                          help="Destination path for bundled images tar.gz")
    p_export.add_argument("--uploads-folder", type=Path, default=None,
                          help="Source uploads folder (defaults to .local/hassan/uploads)")

    # --- IMPORT ---
    p_import = subparsers.add_parser("import", help="Import setup data into target Railway database")
    p_import.add_argument("--file", "-f", type=Path, default=DEFAULT_EXPORT_PATH,
                          help="Path to setup data export JSON file")
    p_import.add_argument("--target-db-url", "-d", type=str,
                          default=os.environ.get("TARGET_DATABASE_URL"),
                          help="Target PostgreSQL connection URL (or env TARGET_DATABASE_URL)")
    p_import.add_argument("--target-branch-name", "-b", type=str, default=TARGET_BRANCH_DEFAULT,
                          help=f"Target branch name (default: '{TARGET_BRANCH_DEFAULT}')")
    p_import.add_argument("--target-branch-id", type=int, default=None,
                          help="Target branch ID override")
    p_import.add_argument("--create-branch-if-missing", action="store_true", default=True,
                          help="Create target branch if it does not exist")
    p_import.add_argument("--admin-email", type=str, default=None,
                          help="Admin email for 'omar' (if user creation needed)")
    p_import.add_argument("--admin-password", type=str, default=None,
                          help="Admin password for 'omar'")
    p_import.add_argument("--cashier-password", type=str, default=None,
                          help="Cashier password for 'momen'")
    mode_group = p_import.add_mutually_exclusive_group(required=True)
    mode_group.add_argument("--dry-run", action="store_true",
                            help="Analyze differences, show counts & conflicts, roll back")
    mode_group.add_argument("--apply", action="store_true",
                            help="Execute import in a single transaction and commit")
    p_import.add_argument("--on-conflict", choices=["abort", "skip", "overwrite"], default="abort",
                          help="Conflict resolution behavior (default: abort)")
    p_import.add_argument("--mapping-output", type=Path, default=DEFAULT_MAPPING_PATH,
                          help="Path to write ID mapping JSON")
    p_import.add_argument("--images-bundle", type=Path, default=DEFAULT_IMAGES_BUNDLE,
                          help="Path to bundled images tar.gz")
    p_import.add_argument("--target-uploads-dir", type=Path, default=DEFAULT_TARGET_UPLOADS,
                          help="Directory to extract remapped images")

    # --- REMAP STUDIO ---
    p_studio = subparsers.add_parser("remap-studio", help="Remap Cashier Studio browser preferences")
    p_studio.add_argument("--mapping-file", "-m", type=Path, default=DEFAULT_MAPPING_PATH,
                          help="Path to id_mapping.json generated during --apply")
    p_studio.add_argument("--input-prefs", "-p", type=str, required=True,
                          help="Path to local preferences JSON file OR inline JSON string")
    p_studio.add_argument("--target-device-id", type=str, required=True,
                          help="Target cashier device ID (from device enrollment)")
    p_studio.add_argument("--target-branch-id", type=int, default=None,
                          help="Target branch ID override")

    args = parser.parse_args()

    if args.subcommand == "setup-railway":
        do_setup_railway_interactive(
            target_url=args.target_db_url,
            admin_email=args.admin_email,
            admin_password=args.admin_password,
            cashier_password=args.cashier_password,
            auto_apply=args.auto_apply,
            export_file=args.export_file.resolve(),
            branch_name=args.branch_name,
            mapping_output=args.mapping_output.resolve()
        )

    elif args.subcommand == "export":
        src_url = args.source_db_url or read_local_db_url(args.config)
        do_export(src_url, args.output.resolve(), args.images_output.resolve(), args.uploads_folder)

    elif args.subcommand == "import":
        if not args.target_db_url:
            parser.error("--target-db-url (or TARGET_DATABASE_URL env) is required for import.")
        do_import(
            target_url=args.target_db_url,
            export_file=args.file.resolve(),
            target_branch_name=args.target_branch_name,
            target_branch_id=args.target_branch_id,
            create_branch_if_missing=args.create_branch_if_missing,
            admin_email=args.admin_email,
            admin_password=args.admin_password,
            cashier_password=args.cashier_password,
            dry_run=args.dry_run,
            on_conflict=args.on_conflict,
            mapping_output=args.mapping_output.resolve(),
            images_bundle=args.images_bundle.resolve() if args.images_bundle else None,
            target_uploads_dir=args.target_uploads_dir.resolve()
        )

    elif args.subcommand == "remap-studio":
        remap_studio_preferences(
            mapping_file=args.mapping_file.resolve(),
            input_prefs_source=args.input_prefs,
            target_device_id=args.target_device_id,
            target_branch_id=args.target_branch_id
        )


if __name__ == "__main__":
    main()
