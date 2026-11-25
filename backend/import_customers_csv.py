"""Manual, additive customer CSV import for Hassan Ragab branches."""

import argparse
import csv
from datetime import datetime, timezone
import os
import re
import sys
from collections import defaultdict

from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError


ARABIC_DIGITS = str.maketrans(
    "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹",
    "01234567890123456789",
)
VALID_EGYPTIAN_PHONE = re.compile(r"^(?:010|011|012|015)\d{8}$")


def normalize_phone(value):
    if value is None:
        return None
    phone = str(value).strip().translate(ARABIC_DIGITS)
    phone = re.sub(r"[^\d+]", "", phone)
    if phone.startswith("+"):
        phone = phone[1:]
    if phone.startswith("0020"):
        phone = "0" + phone[4:]
    elif phone.startswith("20") and len(phone) == 12:
        phone = "0" + phone[2:]
    elif phone.startswith("002"):
        phone = "0" + phone[3:]
    return phone or None


def valid_phone(phone):
    return bool(phone and VALID_EGYPTIAN_PHONE.fullmatch(phone))


def clean_name(value):
    if value is None:
        return None
    name = " ".join(str(value).strip().split())
    return name[:100] if name else None


def parse_visit_count(value):
    if value is None:
        return None
    normalized = str(value).strip().translate(ARABIC_DIGITS).replace(",", "")
    if not re.fullmatch(r"\d+(?:\.0+)?", normalized):
        return None
    return int(normalized.split(".", 1)[0])


def parse_visit_date(value):
    if value is None or not str(value).strip():
        return None
    normalized = str(value).strip().translate(ARABIC_DIGITS)
    try:
        parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = datetime.strptime(normalized, "%Y/%m/%d")
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def read_csv(path):
    if str(path) == "-":
        stream = sys.stdin
        should_close = False
    else:
        stream = open(path, "r", encoding="utf-8-sig", newline="")
        should_close = True
    try:
        reader = csv.DictReader(stream)
        required = {"NAME", "PHONE", "Branch"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError("Missing required CSV columns: " + ", ".join(sorted(missing)))

        rows = []
        for sheet_row, source in enumerate(reader, start=2):
            rows.append({
                "sheet_row": sheet_row,
                "name": clean_name(source.get("NAME")),
                "phone": normalize_phone(source.get("PHONE")),
                "branch": str(source.get("Branch") or "").strip(),
                "visit_count": parse_visit_count(source.get("NUM_VISITS")),
                "last_visit": parse_visit_date(source.get("LAST VISIT")),
                "last_visit_raw": str(source.get("LAST VISIT") or "").strip(),
            })
        return rows
    finally:
        if should_close:
            stream.close()


def database_url():
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is required")
    if url.startswith("postgres://"):
        url = "postgresql+psycopg2://" + url[len("postgres://"):]
    elif url.startswith("postgresql://") and "+psycopg2" not in url:
        url = "postgresql+psycopg2://" + url[len("postgresql://"):]
    return url


def inspect(rows, connection):
    branches = {
        row.name: row.id
        for row in connection.execute(text(
            "SELECT id, name FROM branches WHERE is_active = true"
        ))
    }
    existing_by_branch_phone = defaultdict(set)
    for db_row in connection.execute(text(
        "SELECT branch_id, phone, full_name FROM customers"
    )).mappings():
        normalized = normalize_phone(db_row["phone"])
        if normalized:
            existing_by_branch_phone[(db_row["branch_id"], normalized)].add(
                db_row["full_name"]
            )

    phone_groups = defaultdict(list)
    valid_rows = []
    missing_or_invalid = []

    for row in rows:
        if not row["name"] or not row["phone"] or not valid_phone(row["phone"]):
            missing_or_invalid.append(row)
            continue
        if row["branch"] not in branches:
            missing_or_invalid.append(row)
            continue
        phone_groups[row["phone"]].append(row)
        valid_rows.append(row)

    duplicate_numbers = 0
    conflict_numbers = 0
    conflict_row_numbers = []
    duplicate_row_numbers = []
    for phone, group in phone_groups.items():
        distinct_names = {row["name"] for row in group}
        if len(group) > 1:
            duplicate_numbers += 1
            duplicate_row_numbers.extend(row["sheet_row"] for row in group)
        if len(distinct_names) > 1:
            conflict_numbers += 1
            conflict_row_numbers.extend(row["sheet_row"] for row in group)

    existing_rows = []
    for row in valid_rows:
        branch_id = branches[row["branch"]]
        if len(phone_groups[row["phone"]]) > 1:
            continue
        if (branch_id, row["phone"]) in existing_by_branch_phone:
            existing_rows.append(row)
    conflicts = {
        row["sheet_row"]
        for row in valid_rows
        if len({item["name"] for item in phone_groups[row["phone"]]}) > 1
    }
    duplicates = {
        row["sheet_row"]
        for row in valid_rows
        if len(phone_groups[row["phone"]]) > 1
    }

    ready_rows = []
    for row in valid_rows:
        if row["sheet_row"] in conflicts or row["sheet_row"] in duplicates:
            continue
        branch_id = branches[row["branch"]]
        if (branch_id, row["phone"]) in existing_by_branch_phone:
            continue
        ready_rows.append(row)

    return {
        "branches": branches,
        "missing_or_invalid": missing_or_invalid,
        "duplicate_numbers": duplicate_numbers,
        "duplicate_rows": sorted(duplicates),
        "conflict_numbers": conflict_numbers,
        "conflict_rows": sorted(conflicts),
        "existing_rows": sorted({row["sheet_row"] for row in existing_rows}),
        "ready_rows": ready_rows,
    }


def print_report(total, result):
    print("Customer CSV import report")
    print(f"  total rows: {total}")
    print(f"  ready new: {len(result['ready_rows'])}")
    print(f"  existing: {len(result['existing_rows'])}")
    print(f"  duplicate numbers in sheet: {result['duplicate_numbers']}")
    print(f"  conflicting numbers/names in sheet: {result['conflict_numbers']}")
    print(f"  missing or invalid: {len(result['missing_or_invalid'])}")

    if result["conflict_rows"]:
        print("  conflict CSV row numbers: " + ", ".join(map(str, result["conflict_rows"])))
    if result["duplicate_rows"]:
        print("  duplicate CSV row numbers: " + ", ".join(map(str, result["duplicate_rows"])))
    if result["missing_or_invalid"]:
        print(
            "  missing/invalid CSV row numbers: "
            + ", ".join(str(row["sheet_row"]) for row in result["missing_or_invalid"])
        )


def apply_rows(connection, branches, ready_rows):
    inserted = 0
    for row in ready_rows:
        branch_id = branches[row["branch"]]
        database_phones = connection.execute(text("""
            SELECT phone
            FROM customers
            WHERE branch_id = :branch_id
        """), {"branch_id": branch_id}).scalars()
        if any(normalize_phone(phone) == row["phone"] for phone in database_phones):
            continue
        connection.execute(text("""
            INSERT INTO customers
                (full_name, phone, branch_id, last_barber_id, is_active, created_at, updated_at)
            VALUES
                (:full_name, :phone, :branch_id, NULL, true, now(), now())
        """), {
            "full_name": row["name"],
            "phone": row["phone"],
            "branch_id": branch_id,
        })
        inserted += 1
    return inserted


def inspect_visit_history(rows, connection):
    branches = {
        row.name: row.id
        for row in connection.execute(text(
            "SELECT id, name FROM branches WHERE is_active = true"
        ))
    }
    customers_by_branch_phone = defaultdict(list)
    for customer in connection.execute(text("""
        SELECT id, branch_id, phone, full_name, created_at,
               imported_visit_count, imported_last_visit, visit_history_cutoff_at
        FROM customers
    """)).mappings():
        normalized = normalize_phone(customer["phone"])
        if normalized:
            customers_by_branch_phone[(customer["branch_id"], normalized)].append(customer)

    source_groups = defaultdict(list)
    eligible = []
    invalid_rows = []
    for row in rows:
        branch_id = branches.get(row["branch"])
        if (
            not row["name"]
            or not row["phone"]
            or not valid_phone(row["phone"])
            or branch_id is None
            or row["visit_count"] is None
            or (row["last_visit_raw"] and row["last_visit"] is None)
        ):
            invalid_rows.append(row)
            continue
        if row["visit_count"] == 0:
            row = {**row, "last_visit": None}
        key = (branch_id, row["phone"])
        source_groups[key].append(row)
        eligible.append((row, branch_id))

    duplicate_rows = set()
    for group in source_groups.values():
        if len(group) > 1:
            duplicate_rows.update(row["sheet_row"] for row in group)

    ready_rows = []
    already_synced_rows = []
    not_found_rows = []
    conflict_rows = []
    for row, branch_id in eligible:
        if row["sheet_row"] in duplicate_rows:
            continue
        matches = customers_by_branch_phone.get((branch_id, row["phone"]), [])
        if not matches:
            not_found_rows.append(row)
            continue
        if len(matches) != 1:
            conflict_rows.append(row)
            continue
        customer = matches[0]
        if clean_name(customer["full_name"]) != row["name"]:
            conflict_rows.append(row)
            continue
        if customer["visit_history_cutoff_at"] is None:
            ready_rows.append({**row, "customer_id": customer["id"]})
            continue
        stored_last_visit = customer["imported_last_visit"]
        if (
            customer["imported_visit_count"] == row["visit_count"]
            and stored_last_visit == row["last_visit"]
        ):
            already_synced_rows.append(row)
        else:
            conflict_rows.append(row)

    return {
        "ready_rows": ready_rows,
        "already_synced_rows": already_synced_rows,
        "not_found_rows": not_found_rows,
        "invalid_rows": invalid_rows,
        "duplicate_rows": sorted(duplicate_rows),
        "conflict_rows": sorted(row["sheet_row"] for row in conflict_rows),
    }


def print_visit_history_report(total, result):
    print("Customer visit-history sync report")
    print(f"  total rows: {total}")
    print(f"  ready to sync: {len(result['ready_rows'])}")
    print(
        "  historical visits in ready rows: "
        f"{sum(row['visit_count'] for row in result['ready_rows'])}"
    )
    print(
        "  ready rows with a last-visit date: "
        f"{sum(row['last_visit'] is not None for row in result['ready_rows'])}"
    )
    print(f"  already synced: {len(result['already_synced_rows'])}")
    print(f"  customer not found: {len(result['not_found_rows'])}")
    print(f"  duplicates in CSV: {len(result['duplicate_rows'])}")
    print(f"  conflicts: {len(result['conflict_rows'])}")
    print(f"  missing or invalid: {len(result['invalid_rows'])}")
    for label, row_numbers in (
        ("customer not found", [row["sheet_row"] for row in result["not_found_rows"]]),
        ("duplicate CSV rows", result["duplicate_rows"]),
        ("conflict CSV rows", result["conflict_rows"]),
        ("missing/invalid CSV rows", [row["sheet_row"] for row in result["invalid_rows"]]),
    ):
        if row_numbers:
            print(f"  {label} (CSV row numbers): " + ", ".join(map(str, row_numbers)))


def apply_visit_history(connection, ready_rows):
    updated = 0
    for row in ready_rows:
        result = connection.execute(text("""
            UPDATE customers
            SET imported_visit_count = :visit_count,
                imported_last_visit = :last_visit,
            visit_history_cutoff_at = created_at,
                updated_at = now()
            WHERE id = :customer_id
              AND visit_history_cutoff_at IS NULL
        """), {
            "customer_id": row["customer_id"],
            "visit_count": row["visit_count"],
            "last_visit": row["last_visit"],
        })
        updated += result.rowcount
    return updated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", help="Path to the exported Customers CSV")
    parser.add_argument("--apply", action="store_true", help="Write new valid customers")
    parser.add_argument(
        "--sync-visit-history",
        action="store_true",
        help="Preview or apply NUM_VISITS and LAST VISIT for matching customers",
    )
    args = parser.parse_args()

    try:
        rows = read_csv(args.csv_path)
        engine = create_engine(database_url(), pool_pre_ping=True)
        with engine.begin() as connection:
            if args.sync_visit_history:
                result = inspect_visit_history(rows, connection)
                print_visit_history_report(len(rows), result)
                if not args.apply:
                    print("DRY RUN: no database changes made.")
                    return 0

                updated = apply_visit_history(connection, result["ready_rows"])
                print(f"APPLY: updated {updated} customer visit-history baseline(s).")
                return 0

            result = inspect(rows, connection)
            print_report(len(rows), result)
            if not args.apply:
                print("DRY RUN: no database changes made.")
                return 0

            inserted = apply_rows(connection, result["branches"], result["ready_rows"])
            print(f"APPLY: inserted {inserted} customer(s).")
        engine.dispose()
        return 0
    except (OSError, ValueError, RuntimeError, SQLAlchemyError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
