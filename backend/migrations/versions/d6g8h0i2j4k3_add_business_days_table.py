"""add_business_days_table

Phase 3.1 — Treasury preparation: introduces the BusinessDay model, which
tracks a single operational "day" (open → close) for each branch.

This migration:
  - Creates ENUM type  business_day_status_enum  (OPEN, CLOSED)
  - Creates table      business_days
  - Creates standard composite indexes
  - Creates a PARTIAL UNIQUE INDEX to enforce at most one OPEN day per branch
  - Creates nothing else; drops nothing

Production-safe:
  - Fully idempotent (IF NOT EXISTS guards throughout)
  - Fully reversible (downgrade drops table then enum type)
  - Does NOT touch any existing table

Revision ID: d6g8h0i2j4k3
Revises:     c5f7a9b3e4d2
Create Date: 2026-02-28 21:46:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text

# ---------------------------------------------------------------------------
# Revision identifiers — DO NOT change these
# ---------------------------------------------------------------------------
revision      = 'd6g8h0i2j4k3'
down_revision = 'c5f7a9b3e4d2'
branch_labels = None
depends_on    = None


# ---------------------------------------------------------------------------
# Upgrade
# ---------------------------------------------------------------------------

def upgrade():
    conn = op.get_bind()

    # ── Step 1: Create ENUM type ─────────────────────────────────────────────
    conn.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_type WHERE typname = 'business_day_status_enum'
            ) THEN
                CREATE TYPE business_day_status_enum AS ENUM ('OPEN', 'CLOSED');
            END IF;
        END$$;
    """))
    print("  [1/4] ENUM type 'business_day_status_enum' ready")

    # ── Step 2: Create table ─────────────────────────────────────────────────
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS business_days (
            id                   SERIAL          PRIMARY KEY,

            -- Branch isolation
            branch_id            INTEGER         NOT NULL
                                 REFERENCES branches(id) ON DELETE RESTRICT,

            -- Status
            status               business_day_status_enum  NOT NULL
                                 DEFAULT 'OPEN',

            -- Timestamps
            opened_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
            closed_at            TIMESTAMPTZ,
            created_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

            -- Who opened / closed
            opened_by            INTEGER         NOT NULL
                                 REFERENCES employees(id) ON DELETE RESTRICT,
            closed_by            INTEGER
                                 REFERENCES employees(id) ON DELETE SET NULL,

            -- Financial balances
            opening_balance      NUMERIC(10, 2)  NOT NULL DEFAULT 0,
            theoretical_balance  NUMERIC(10, 2),
            closing_balance      NUMERIC(10, 2),
            variance             NUMERIC(10, 2),

            -- Inline check: closed_at must be after opened_at when present
            CONSTRAINT chk_bd_close_after_open
                CHECK (closed_at IS NULL OR closed_at >= opened_at)
        );
    """))
    print("  [2/4] Table 'business_days' created")

    # ── Step 3: Standard indexes ─────────────────────────────────────────────
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_business_days_branch_id
        ON business_days (branch_id);
    """))

    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_business_days_branch_opened_at
        ON business_days (branch_id, opened_at);
    """))
    print("  [3/4] Standard indexes created")

    # ── Step 4: Partial unique index (one OPEN day per branch) ───────────────
    # A partial index covering only OPEN rows ensures the DB rejects a second
    # INSERT of status='OPEN' for the same branch_id, while allowing any
    # number of CLOSED rows for the same branch.
    conn.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_business_days_branch_open
        ON business_days (branch_id)
        WHERE status = 'OPEN';
    """))
    print("  [4/4] Partial unique index 'uq_business_days_branch_open' created")

    # ── Verify ───────────────────────────────────────────────────────────────
    result = conn.execute(text("""
        SELECT COUNT(*) FROM information_schema.tables
        WHERE table_name  = 'business_days'
          AND table_schema = 'public'
    """)).scalar()

    if result == 1:
        print("  ✅ upgrade complete: business_days table is ready")
    else:
        raise RuntimeError("Migration verification failed: 'business_days' not found after CREATE")


# ---------------------------------------------------------------------------
# Downgrade — fully reversible
# ---------------------------------------------------------------------------

def downgrade():
    conn = op.get_bind()

    # Drop indexes first (partial index must be named explicitly)
    for idx in [
        'uq_business_days_branch_open',
        'idx_business_days_branch_opened_at',
        'idx_business_days_branch_id',
    ]:
        conn.execute(text(f"DROP INDEX IF EXISTS {idx}"))
    print("  [1/3] Indexes dropped")

    # Drop the table
    conn.execute(text("DROP TABLE IF EXISTS business_days"))
    print("  [2/3] Table 'business_days' dropped")

    # Drop the ENUM type (only safe after table is gone)
    conn.execute(text("DROP TYPE IF EXISTS business_day_status_enum"))
    print("  [3/3] ENUM type 'business_day_status_enum' dropped")

    print("  ✅ downgrade complete: business_days fully removed")
