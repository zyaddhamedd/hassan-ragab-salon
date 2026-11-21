"""add_code_to_expense_categories

Adds a stable, unique `code` identifier to the expense_categories table.
Required for reliable treasury category mapping.

Strategy (production-safe, no data loss):
  1. ADD COLUMN code VARCHAR(50) — nullable first (safe for existing rows)
  2. Python backfill — handles Arabic/non-latin names, deduplicates
  3. ALTER COLUMN code SET NOT NULL — only after all rows are populated
  4. ADD UNIQUE CONSTRAINT — idempotent guard included
  5. CREATE INDEX IF NOT EXISTS — idempotent

Downgrade is fully reversible.

Revision ID: a3d5e7f9b1c2
Revises: 9b2c431bdf2d
Create Date: 2026-02-18 17:46:00.000000
"""

import re
from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text

# ---------------------------------------------------------------------------
# Revision identifiers — DO NOT change these
# ---------------------------------------------------------------------------
revision = 'a3d5e7f9b1c2'
down_revision = '9b2c431bdf2d'
branch_labels = None
depends_on = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _name_to_code(name: str) -> str:
    """
    Convert a category name to a stable uppercase code.

    Rules:
      - Spaces → underscores
      - Keep only A-Z, 0-9, underscore
      - Truncate to 50 characters
      - Arabic / non-latin names that produce an empty string → 'CAT'

    Examples:
      'سلف'          → 'CAT'   (Arabic, no latin chars)
      'Maintenance'  → 'MAINTENANCE'
      'Over Time'    → 'OVER_TIME'
    """
    raw = re.sub(r'[^A-Z0-9_]', '', name.upper().replace(' ', '_'))[:50]
    return raw if raw else 'CAT'


def _unique_code(base_code: str, used_codes: set) -> str:
    """
    Append an incrementing counter to base_code until it is unique
    within the used_codes set.
    """
    candidate = base_code
    counter = 1
    while candidate in used_codes:
        candidate = f"{base_code}_{counter}"
        counter += 1
    return candidate


# ---------------------------------------------------------------------------
# Upgrade
# ---------------------------------------------------------------------------

def upgrade():
    conn = op.get_bind()

    # ── Step 1: Add column as nullable ──────────────────────────────────────
    # Using IF NOT EXISTS so the migration is idempotent if re-run manually.
    conn.execute(text("""
        ALTER TABLE expense_categories
        ADD COLUMN IF NOT EXISTS code VARCHAR(50)
    """))
    print("  [1/5] Column 'code' added (nullable)")

    # ── Step 2: Backfill existing rows ───────────────────────────────────────
    # Fetch all rows that still have NULL code (handles partial re-runs).
    rows = conn.execute(
        text("SELECT id, name FROM expense_categories WHERE code IS NULL ORDER BY id")
    ).fetchall()

    if rows:
        # Build set of codes already assigned (from any previous partial run)
        existing_codes = {
            row[0]
            for row in conn.execute(
                text("SELECT code FROM expense_categories WHERE code IS NOT NULL")
            ).fetchall()
        }

        used_codes = set(existing_codes)

        for row_id, name in rows:
            base_code = _name_to_code(name)
            final_code = _unique_code(base_code, used_codes)
            used_codes.add(final_code)

            conn.execute(
                text("UPDATE expense_categories SET code = :code WHERE id = :id"),
                {"code": final_code, "id": row_id}
            )
            print(f"  [2/5] Backfilled: id={row_id}, name='{name}' → code='{final_code}'")
    else:
        print("  [2/5] No rows needed backfill (table empty or already populated)")

    # ── Step 3: Set NOT NULL constraint ─────────────────────────────────────
    # Safe now — all rows have a value.
    conn.execute(text("""
        ALTER TABLE expense_categories
        ALTER COLUMN code SET NOT NULL
    """))
    print("  [3/5] NOT NULL constraint applied")

    # ── Step 4: Add UNIQUE constraint ────────────────────────────────────────
    # Check if constraint already exists before adding (idempotent).
    constraint_exists = conn.execute(text("""
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'expense_categories'
          AND constraint_name = 'uq_expense_categories_code'
          AND constraint_type = 'UNIQUE'
    """)).fetchone()

    if not constraint_exists:
        conn.execute(text("""
            ALTER TABLE expense_categories
            ADD CONSTRAINT uq_expense_categories_code UNIQUE (code)
        """))
        print("  [4/5] UNIQUE constraint 'uq_expense_categories_code' added")
    else:
        print("  [4/5] UNIQUE constraint already exists — skipped")

    # ── Step 5: Create index ─────────────────────────────────────────────────
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_expense_categories_code
        ON expense_categories (code)
    """))
    print("  [5/5] Index 'ix_expense_categories_code' created")

    print("  ✅ upgrade complete: expense_categories.code is ready")


# ---------------------------------------------------------------------------
# Downgrade — fully reversible
# ---------------------------------------------------------------------------

def downgrade():
    conn = op.get_bind()

    # Drop index first (index depends on column)
    conn.execute(text("""
        DROP INDEX IF EXISTS ix_expense_categories_code
    """))
    print("  [1/3] Index dropped")

    # Drop unique constraint (constraint depends on column)
    conn.execute(text("""
        ALTER TABLE expense_categories
        DROP CONSTRAINT IF EXISTS uq_expense_categories_code
    """))
    print("  [2/3] UNIQUE constraint dropped")

    # Drop the column itself
    conn.execute(text("""
        ALTER TABLE expense_categories
        DROP COLUMN IF EXISTS code
    """))
    print("  [3/3] Column 'code' dropped")

    print("  ✅ downgrade complete: expense_categories.code removed")
