"""add attendance business day fields for phase 1a

Revision ID: z9_att_bd_p1a
Revises: y8_appointment_deposit_phase1
Create Date: 2026-08-28 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import text


revision = 'z9_att_bd_p1a'
down_revision = 'y8_appointment_deposit_phase1'
branch_labels = None
depends_on = None


CHECKOUT_SOURCE_ENUM_NAME = 'attendance_checkout_source_enum'
ATTENDANCE_BUSINESS_DAY_FK = 'fk_attendances_business_day_id'
ATTENDANCE_BUSINESS_DAY_INDEX = 'idx_attendances_business_day_id'
ATTENDANCE_CLOSE_QUERY_INDEX = 'idx_attendances_branch_business_day_present'
ATTENDANCE_CLOSE_QUERY_PREDICATE = text("status = 'PRESENT'")


def _column_exists(inspector, table_name, column_name):
    return any(column['name'] == column_name for column in inspector.get_columns(table_name))


def _foreign_key_exists(inspector, table_name, fk_name):
    return any(fk.get('name') == fk_name for fk in inspector.get_foreign_keys(table_name))


def _index_exists(bind, index_name):
    dialect_name = bind.dialect.name
    if dialect_name == 'postgresql':
        row = bind.execute(text("""
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = current_schema()
              AND indexname = :index_name
        """), {'index_name': index_name}).fetchone()
        return row is not None

    if dialect_name == 'sqlite':
        row = bind.execute(text("""
            SELECT 1
            FROM sqlite_master
            WHERE type = 'index'
              AND name = :index_name
        """), {'index_name': index_name}).fetchone()
        return row is not None

    inspector = inspect(bind)
    for existing_index in inspector.get_indexes('attendances'):
        if existing_index.get('name') == index_name:
            return True
    return False


def _create_checkout_source_enum_if_needed(bind):
    bind.execute(text(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_type
                WHERE typname = '{CHECKOUT_SOURCE_ENUM_NAME}'
            ) THEN
                CREATE TYPE {CHECKOUT_SOURCE_ENUM_NAME} AS ENUM (
                    'MANUAL',
                    'BUSINESS_DAY_CLOSE',
                    'ADMIN_CORRECTION'
                );
            END IF;
        END
        $$;
    """))


def _drop_checkout_source_enum_if_needed(bind):
    bind.execute(text(f"DROP TYPE IF EXISTS {CHECKOUT_SOURCE_ENUM_NAME}"))


def _checkout_source_type_for_dialect(dialect_name):
    if dialect_name == 'postgresql':
        return postgresql.ENUM(
            'MANUAL',
            'BUSINESS_DAY_CLOSE',
            'ADMIN_CORRECTION',
            name=CHECKOUT_SOURCE_ENUM_NAME,
            create_type=False,
        )

    return sa.Enum(
        'MANUAL',
        'BUSINESS_DAY_CLOSE',
        'ADMIN_CORRECTION',
        name=CHECKOUT_SOURCE_ENUM_NAME,
        native_enum=False,
    )


def upgrade():
    bind = op.get_bind()
    dialect_name = bind.dialect.name
    inspector = inspect(bind)

    if dialect_name == 'postgresql':
        _create_checkout_source_enum_if_needed(bind)

    business_day_id_missing = not _column_exists(inspector, 'attendances', 'business_day_id')
    checkout_source_missing = not _column_exists(inspector, 'attendances', 'checkout_source')
    business_day_fk_missing = not _foreign_key_exists(inspector, 'attendances', ATTENDANCE_BUSINESS_DAY_FK)
    checkout_source_type = _checkout_source_type_for_dialect(dialect_name)

    if dialect_name == 'sqlite':
        with op.batch_alter_table('attendances', schema=None) as batch_op:
            if business_day_id_missing:
                batch_op.add_column(sa.Column('business_day_id', sa.Integer(), nullable=True))
            if checkout_source_missing:
                batch_op.add_column(sa.Column('checkout_source', checkout_source_type, nullable=True))
            if business_day_fk_missing:
                batch_op.create_foreign_key(
                    ATTENDANCE_BUSINESS_DAY_FK,
                    'business_days',
                    ['business_day_id'],
                    ['id'],
                    ondelete='RESTRICT',
                )
    else:
        if business_day_id_missing:
            op.add_column(
                'attendances',
                sa.Column('business_day_id', sa.Integer(), nullable=True),
            )
        if checkout_source_missing:
            op.add_column(
                'attendances',
                sa.Column('checkout_source', checkout_source_type, nullable=True),
            )
        if business_day_fk_missing:
            op.create_foreign_key(
                ATTENDANCE_BUSINESS_DAY_FK,
                'attendances',
                'business_days',
                ['business_day_id'],
                ['id'],
                ondelete='RESTRICT',
            )

    if not _index_exists(bind, ATTENDANCE_BUSINESS_DAY_INDEX):
        op.create_index(
            ATTENDANCE_BUSINESS_DAY_INDEX,
            'attendances',
            ['business_day_id'],
            unique=False,
        )

    if not _index_exists(bind, ATTENDANCE_CLOSE_QUERY_INDEX):
        op.create_index(
            ATTENDANCE_CLOSE_QUERY_INDEX,
            'attendances',
            ['branch_id', 'business_day_id'],
            unique=False,
            postgresql_where=ATTENDANCE_CLOSE_QUERY_PREDICATE,
            sqlite_where=ATTENDANCE_CLOSE_QUERY_PREDICATE,
        )


def downgrade():
    bind = op.get_bind()
    dialect_name = bind.dialect.name
    inspector = inspect(bind)

    if _index_exists(bind, ATTENDANCE_CLOSE_QUERY_INDEX):
        op.drop_index(ATTENDANCE_CLOSE_QUERY_INDEX, table_name='attendances')

    if _index_exists(bind, ATTENDANCE_BUSINESS_DAY_INDEX):
        op.drop_index(ATTENDANCE_BUSINESS_DAY_INDEX, table_name='attendances')

    business_day_id_exists = _column_exists(inspector, 'attendances', 'business_day_id')
    checkout_source_exists = _column_exists(inspector, 'attendances', 'checkout_source')
    business_day_fk_exists = _foreign_key_exists(inspector, 'attendances', ATTENDANCE_BUSINESS_DAY_FK)

    if dialect_name == 'sqlite':
        with op.batch_alter_table('attendances', schema=None) as batch_op:
            if business_day_fk_exists:
                batch_op.drop_constraint(ATTENDANCE_BUSINESS_DAY_FK, type_='foreignkey')
            if checkout_source_exists:
                batch_op.drop_column('checkout_source')
            if business_day_id_exists:
                batch_op.drop_column('business_day_id')
    else:
        if business_day_fk_exists:
            op.drop_constraint(ATTENDANCE_BUSINESS_DAY_FK, 'attendances', type_='foreignkey')
        if checkout_source_exists:
            op.drop_column('attendances', 'checkout_source')
        if business_day_id_exists:
            op.drop_column('attendances', 'business_day_id')

    if dialect_name == 'postgresql':
        _drop_checkout_source_enum_if_needed(bind)
