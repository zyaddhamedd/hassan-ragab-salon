"""close_orphaned_attendance_records

Data-cleanup migration: closes attendance records that were left permanently
stuck with status='PRESENT' and check_out_time=NULL because the old check-out
code used a date-based lookup (filter_by(date=today)) which silently failed
whenever the calendar date rolled over after midnight during a shift.

After this migration every such stale record is set to:
    status         = 'LEFT'
    check_out_time = NOW() UTC
    updated_at     = NOW() UTC

Safety:
  - Only records older than 12 hours are affected.  Any employee who checked
    in within the last 12 hours is on an active shift and is left untouched.
  - The WHERE clause is inherently idempotent: already-fixed rows have
    check_out_time IS NOT NULL and will not match on a second run.
  - No schema changes — purely a data UPDATE.
  - downgrade() is intentionally a no-op: there is no meaningful way to
    "restore" stale ghost records; reverting would just re-introduce the bug.

Revision ID: i5j7k9l1m3n2
Revises:     h4i6j8k0l2m1
Create Date: 2026-03-23 23:53:58.000000
"""

from alembic import op
from sqlalchemy.sql import text

# ---------------------------------------------------------------------------
# Revision identifiers — DO NOT change these
# ---------------------------------------------------------------------------
revision      = 'i5j7k9l1m3n2'
down_revision = 'h4i6j8k0l2m1'
branch_labels = None
depends_on    = None


# ---------------------------------------------------------------------------
# upgrade
# ---------------------------------------------------------------------------

def upgrade():
    conn = op.get_bind()

    # ── Step 1: Count affected rows so the deploy log is informative ─────────
    result = conn.execute(text("""
        SELECT COUNT(*) AS orphaned_count
        FROM attendances
        WHERE status         = 'PRESENT'
          AND check_out_time IS NULL
          AND check_in_time  < NOW() - INTERVAL '12 hours'
    """))
    row = result.fetchone()
    orphaned_count = row[0] if row else 0

    if orphaned_count == 0:
        print("[SKIP] No orphaned PRESENT attendance records found — nothing to fix.")
        return

    print(f"[INFO] Found {orphaned_count} orphaned PRESENT attendance record(s) "
          "older than 12 hours.  Closing them now ...")

    # ── Step 2: Close all stale PRESENT records ───────────────────────────────
    # Conditions:
    #   status = 'PRESENT'        — only open-shift records
    #   check_out_time IS NULL    — only records that were never closed
    #   check_in_time < NOW()-12h — only stale records; active shifts are safe
    #
    # This WHERE clause is idempotent: re-running the migration will find
    # 0 rows because fixed records have check_out_time IS NOT NULL.
    conn.execute(text("""
        UPDATE attendances
        SET
            status         = 'LEFT',
            check_out_time = NOW(),
            updated_at     = NOW()
        WHERE status         = 'PRESENT'
          AND check_out_time IS NULL
          AND check_in_time  < NOW() - INTERVAL '12 hours'
    """))

    print(f"[OK]   {orphaned_count} orphaned attendance record(s) closed successfully.")

    # ── Step 3: Verify — confirm no stale PRESENT records remain ─────────────
    verify = conn.execute(text("""
        SELECT COUNT(*) AS remaining
        FROM attendances
        WHERE status         = 'PRESENT'
          AND check_out_time IS NULL
          AND check_in_time  < NOW() - INTERVAL '12 hours'
    """))
    remaining = verify.fetchone()[0]

    if remaining == 0:
        print("[OK]   Verification passed — 0 orphaned records remain.")
    else:
        # Should never happen, but log it clearly if it does
        print(f"[WARN] Verification found {remaining} record(s) still orphaned "
              "after update.  Investigate manually.")


# ---------------------------------------------------------------------------
# downgrade — intentionally a no-op
# ---------------------------------------------------------------------------

def downgrade():
    # There is no meaningful rollback for a data-cleanup migration.
    # Re-introducing stale PRESENT records would:
    #   (a) re-block check-ins for all affected employees, and
    #   (b) not restore original check_out_time values (they were NULL).
    # This migration is designed to be permanent.
    print("[SKIP] downgrade() is a no-op for this data-cleanup migration.")
