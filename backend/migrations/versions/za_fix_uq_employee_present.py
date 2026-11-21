"""repair missing one-open-attendance invariant

Revision ID: za_fix_uq_employee_present
Revises: z9_att_bd_p1a
Create Date: 2026-08-28 00:00:01.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.sql import text


revision = 'za_fix_uq_employee_present'
down_revision = 'z9_att_bd_p1a'
branch_labels = None
depends_on = None


TABLE_NAME = 'attendances'
INDEX_NAME = 'uq_employee_present'
INDEX_COLUMNS = ['employee_id']
INDEX_PREDICATE = "status = 'PRESENT'"


def _normalize_sql(value):
    if not value:
        return ''
    normalized = value.lower()
    for token in (' ', '\n', '\t', '(', ')', '"'):
        normalized = normalized.replace(token, '')
    normalized = normalized.replace("::attendance_status_enum", '')
    normalized = normalized.replace("::text", '')
    return normalized


def _find_present_duplicates(bind):
    rows = bind.execute(
        text(
            """
            SELECT employee_id, COUNT(*) AS row_count
            FROM attendances
            WHERE status = :status
            GROUP BY employee_id
            HAVING COUNT(*) > 1
            ORDER BY employee_id
            """
        ),
        {'status': 'PRESENT'},
    ).fetchall()
    return [(row[0], row[1]) for row in rows]


def _index_exists(bind, index_name):
    dialect_name = bind.dialect.name
    if dialect_name == 'postgresql':
        row = bind.execute(
            text(
                """
                SELECT 1
                FROM pg_indexes
                WHERE schemaname = current_schema()
                  AND tablename = :table_name
                  AND indexname = :index_name
                """
            ),
            {'table_name': TABLE_NAME, 'index_name': index_name},
        ).fetchone()
        return row is not None

    if dialect_name == 'sqlite':
        row = bind.execute(
            text(
                """
                SELECT 1
                FROM sqlite_master
                WHERE type = 'index'
                  AND tbl_name = :table_name
                  AND name = :index_name
                """
            ),
            {'table_name': TABLE_NAME, 'index_name': index_name},
        ).fetchone()
        return row is not None

    inspector = inspect(bind)
    return any(index.get('name') == index_name for index in inspector.get_indexes(TABLE_NAME))


def _postgres_index_columns(bind, index_name):
    rows = bind.execute(
        text(
            """
            SELECT attribute.attname
            FROM pg_class AS index_rel
            JOIN pg_index AS index_meta
              ON index_meta.indexrelid = index_rel.oid
            JOIN LATERAL unnest(index_meta.indkey) WITH ORDINALITY AS key_cols(attnum, ord)
              ON true
            JOIN pg_attribute AS attribute
              ON attribute.attrelid = index_meta.indrelid
             AND attribute.attnum = key_cols.attnum
            WHERE index_rel.relname = :index_name
            ORDER BY key_cols.ord
            """
        ),
        {'index_name': index_name},
    ).fetchall()
    return [row[0] for row in rows]


def _has_equivalent_index(bind):
    dialect_name = bind.dialect.name
    normalized_target_predicate = _normalize_sql(INDEX_PREDICATE)

    if dialect_name == 'postgresql':
        rows = bind.execute(
            text(
                """
                SELECT
                    index_rel.relname AS index_name,
                    index_meta.indisunique AS is_unique,
                    pg_get_expr(index_meta.indpred, index_meta.indrelid) AS predicate
                FROM pg_class AS table_rel
                JOIN pg_index AS index_meta
                  ON index_meta.indrelid = table_rel.oid
                JOIN pg_class AS index_rel
                  ON index_rel.oid = index_meta.indexrelid
                WHERE table_rel.relname = :table_name
                """
            ),
            {'table_name': TABLE_NAME},
        ).fetchall()

        for row in rows:
            if not row.is_unique:
                continue
            if _postgres_index_columns(bind, row.index_name) != INDEX_COLUMNS:
                continue
            if _normalize_sql(row.predicate) == normalized_target_predicate:
                return True
        return False

    if dialect_name == 'sqlite':
        rows = bind.execute(
            text(
                """
                SELECT name, sql
                FROM sqlite_master
                WHERE type = 'index'
                  AND tbl_name = :table_name
                """
            ),
            {'table_name': TABLE_NAME},
        ).fetchall()
        for row in rows:
            sql = _normalize_sql(row.sql)
            if 'createuniqueindex' not in sql:
                continue
            if 'onattendances(employee_id)' not in sql:
                continue
            if normalized_target_predicate in sql:
                return True
        return False

    return _index_exists(bind, INDEX_NAME)


def upgrade():
    bind = op.get_bind()
    duplicates = _find_present_duplicates(bind)
    if duplicates:
        details = ', '.join(
            f"employee_id={employee_id} count={row_count}"
            for employee_id, row_count in duplicates
        )
        raise RuntimeError(
            f"Cannot create {INDEX_NAME}: duplicate PRESENT attendance rows exist ({details})"
        )

    if _index_exists(bind, INDEX_NAME) or _has_equivalent_index(bind):
        return

    op.create_index(
        INDEX_NAME,
        TABLE_NAME,
        INDEX_COLUMNS,
        unique=True,
        postgresql_where=text(INDEX_PREDICATE),
        sqlite_where=text(INDEX_PREDICATE),
    )


def downgrade():
    bind = op.get_bind()
    if _index_exists(bind, INDEX_NAME):
        op.drop_index(INDEX_NAME, table_name=TABLE_NAME)
