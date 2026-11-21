"""add append-only invoice audit event ledger

Revision ID: zf_invoice_audit_events
Revises: ze_payment_confirmation_attempts
Create Date: 2026-09-20 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "zf_invoice_audit_events"
down_revision = "ze_payment_confirmation_attempts"
branch_labels = None
depends_on = None


EVENT_TYPES = (
    "DRAFT_CREATED",
    "ITEM_ADDED",
    "ITEM_UPDATED",
    "ITEM_REMOVED",
    "DRAFT_COMMITTED",
    "INVOICE_PAID",
    "INVOICE_DELETED",
)

SOURCES = ("MINI", "ADMIN", "SYSTEM", "BACKFILL")


def _quoted_values(values):
    return ", ".join(f"'{value}'" for value in values)


def _is_postgresql():
    return op.get_bind().dialect.name == "postgresql"


def upgrade():
    json_type = sa.JSON(none_as_null=True).with_variant(
        postgresql.JSONB(none_as_null=True),
        "postgresql",
    )
    event_id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")

    op.create_table(
        "invoice_audit_events",
        sa.Column("id", event_id_type, autoincrement=True, nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.Column("invoice_cashier_employee_id", sa.Integer(), nullable=True),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("actor_employee_id", sa.Integer(), nullable=True),
        sa.Column("actor_role", sa.String(length=64), nullable=True),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("payload_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("business_day_id", sa.Integer(), nullable=True),
        sa.Column("registered_device_id", sa.Integer(), nullable=True),
        sa.Column("request_id", sa.String(length=128), nullable=True),
        sa.Column("gross_before", sa.Numeric(12, 2), nullable=True),
        sa.Column("gross_after", sa.Numeric(12, 2), nullable=True),
        sa.Column("payload", json_type, server_default=sa.text("'{}'"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "invoice_id",
            "sequence_number",
            name="uq_invoice_audit_events_invoice_sequence",
        ),
        sa.CheckConstraint(
            "sequence_number > 0",
            name="ck_invoice_audit_events_positive_sequence",
        ),
        sa.CheckConstraint(
            "payload_version > 0",
            name="ck_invoice_audit_events_positive_payload_version",
        ),
        sa.CheckConstraint(
            f"event_type IN ({_quoted_values(EVENT_TYPES)})",
            name="ck_invoice_audit_events_event_type",
        ),
        sa.CheckConstraint(
            f"source IN ({_quoted_values(SOURCES)})",
            name="ck_invoice_audit_events_source",
        ),
    )
    op.create_index(
        "ix_invoice_audit_events_branch_occurred_id",
        "invoice_audit_events",
        ["branch_id", sa.text("occurred_at DESC"), sa.text("id DESC")],
    )
    op.create_index(
        "ix_invoice_audit_events_branch_type_occurred",
        "invoice_audit_events",
        ["branch_id", "event_type", sa.text("occurred_at DESC")],
    )
    op.create_index(
        "ix_invoice_audit_events_actor_occurred",
        "invoice_audit_events",
        ["actor_user_id", sa.text("occurred_at DESC")],
    )

    if _is_postgresql():
        op.execute(sa.text("""
            CREATE FUNCTION reject_invoice_audit_event_mutation()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                RAISE EXCEPTION 'invoice_audit_events is append-only'
                    USING ERRCODE = '55000';
            END;
            $$
        """))
        op.execute(sa.text("""
            CREATE TRIGGER trg_invoice_audit_events_append_only
            BEFORE UPDATE OR DELETE ON invoice_audit_events
            FOR EACH ROW
            EXECUTE FUNCTION reject_invoice_audit_event_mutation()
        """))


def downgrade():
    if _is_postgresql():
        op.execute(sa.text("""
            DROP TRIGGER IF EXISTS trg_invoice_audit_events_append_only
            ON invoice_audit_events
        """))
        op.execute(sa.text("DROP FUNCTION IF EXISTS reject_invoice_audit_event_mutation()"))

    op.drop_index(
        "ix_invoice_audit_events_actor_occurred",
        table_name="invoice_audit_events",
    )
    op.drop_index(
        "ix_invoice_audit_events_branch_type_occurred",
        table_name="invoice_audit_events",
    )
    op.drop_index(
        "ix_invoice_audit_events_branch_occurred_id",
        table_name="invoice_audit_events",
    )
    op.drop_table("invoice_audit_events")
