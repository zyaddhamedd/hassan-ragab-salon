"""backfill_is_business_expense_for_tip_expenses

Backfills is_business_expense = FALSE for all existing TIP expenses.

This migration updates expenses matching:
  1. expense_category_id pointing to TIP_PAYOUT category
  2. notes containing: 'tip', 'باقي', 'تيب', 'tip payout' (case-insensitive)

Result: All historical TIP expenses now have is_business_expense=False,
matching the behavior of newly-created TIP payout expenses.

Production-safe:
  - Read-only guard — no changes if TIP_PAYOUT category doesn't exist
  - Idempotent — safe to re-run (simple SET to FALSE, no complex logic)
  - Reversible — downgrade reverts to TRUE for same records (if needed)
  - Transaction-safe — single UPDATE statement with rollback on error

Revision ID: l9m1n3o5p7q6
Revises:     k8l0m2n4o6p5
Create Date: 2026-04-05 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text

# ---------------------------------------------------------------------------
# Revision identifiers — DO NOT change these
# ---------------------------------------------------------------------------
revision      = 'l9m1n3o5p7q6'
down_revision = 'k8l0m2n4o6p5'
branch_labels = None
depends_on    = None


# ---------------------------------------------------------------------------
# upgrade
# ---------------------------------------------------------------------------

def upgrade():
    conn = op.get_bind()

    # Step 1: Find TIP_PAYOUT category ID (guard against non-existent category)
    tip_category_result = conn.execute(text("""
        SELECT id
        FROM expense_categories
        WHERE code = 'TIP_PAYOUT'
        LIMIT 1
    """)).fetchone()

    tip_category_id = tip_category_result[0] if tip_category_result else None

    # Build the UPDATE statement dynamically based on whether TIP_PAYOUT exists
    if tip_category_id:
        # If TIP_PAYOUT category exists, update those expenses OR notes-based matches
        update_sql = f"""
            UPDATE expenses
            SET is_business_expense = FALSE
            WHERE
              (expense_category_id = {tip_category_id})
              OR
              (
                LOWER(notes) LIKE '%tip%'
                OR LOWER(notes) LIKE '%باقي%'
                OR LOWER(notes) LIKE '%تيب%'
                OR LOWER(notes) LIKE '%tip payout%'
              )
        """
    else:
        # If TIP_PAYOUT category doesn't exist, just use notes-based matching
        update_sql = """
            UPDATE expenses
            SET is_business_expense = FALSE
            WHERE
              LOWER(notes) LIKE '%tip%'
              OR LOWER(notes) LIKE '%باقي%'
              OR LOWER(notes) LIKE '%تيب%'
              OR LOWER(notes) LIKE '%tip payout%'
        """

    # Execute the update
    result = conn.execute(text(update_sql))

    # Log how many rows were updated (for visibility)
    rows_affected = result.rowcount
    print(f"\n{'='*70}")
    print(f"TIP Expense Backfill: {rows_affected} rows updated to is_business_expense=FALSE")
    print(f"{'='*70}\n")


# ---------------------------------------------------------------------------
# downgrade
# ---------------------------------------------------------------------------

def downgrade():
    """
    Revert is_business_expense = TRUE for TIP expenses.

    This reverts the backfill, restoring TIP expenses to the default
    is_business_expense=TRUE state. Use only if a full rollback is needed.
    """
    conn = op.get_bind()

    # Find TIP_PAYOUT category ID (same guard as upgrade)
    tip_category_result = conn.execute(text("""
        SELECT id
        FROM expense_categories
        WHERE code = 'TIP_PAYOUT'
        LIMIT 1
    """)).fetchone()

    tip_category_id = tip_category_result[0] if tip_category_result else None

    # Build revert statement
    if tip_category_id:
        revert_sql = f"""
            UPDATE expenses
            SET is_business_expense = TRUE
            WHERE
              (expense_category_id = {tip_category_id})
              OR
              (
                LOWER(notes) LIKE '%tip%'
                OR LOWER(notes) LIKE '%باقي%'
                OR LOWER(notes) LIKE '%تيب%'
                OR LOWER(notes) LIKE '%tip payout%'
              )
        """
    else:
        revert_sql = """
            UPDATE expenses
            SET is_business_expense = TRUE
            WHERE
              LOWER(notes) LIKE '%tip%'
              OR LOWER(notes) LIKE '%باقي%'
              OR LOWER(notes) LIKE '%تيب%'
              OR LOWER(notes) LIKE '%tip payout%'
        """

    result = conn.execute(text(revert_sql))
    rows_affected = result.rowcount
    print(f"\n{'='*70}")
    print(f"TIP Expense Rollback: {rows_affected} rows reverted to is_business_expense=TRUE")
    print(f"{'='*70}\n")
