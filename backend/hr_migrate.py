"""Guarded, empty-database-only Hassan Ragab migration command. Never imports Flask."""
import argparse
import ast
import contextlib
import importlib.util
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import traceback
from urllib.parse import urlsplit

from hr_local import WORKSPACE, validate

CLUSTER = Path.home() / 'Library/Application Support/Hassan Ragab Salon/postgresql16/data'
HEAD = 'zx_staff_geofence_versions'
PRIVATE = WORKSPACE / '.local/hassan'
SYSTEM_SCHEMAS = "n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def prepare(config_path):
    require(Path.cwd() == WORKSPACE and Path(__file__).resolve().parent.parent == WORKSPACE,
            'Wrong workspace')
    require(Path(sys.prefix).resolve() == PRIVATE / 'venv' and sys.prefix != sys.base_prefix,
            'Use the isolated Hassan virtual environment')
    branch = subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip()
    require(branch in {'feat/hassan-ragab-setup', 'main'}, 'Wrong branch')
    require(config_path == PRIVATE / 'backend.json' and config_path.resolve() == config_path,
            'Use the exact private Hassan config path without symlinks')
    require(config_path.stat().st_mode & 0o777 == 0o600, 'Private config must be mode 0600')
    settings = validate(json.loads(config_path.read_text()))
    require(PRIVATE.resolve() == PRIVATE and PRIVATE.stat().st_mode & 0o077 == 0,
            'Private directory must be isolated and owner-only')
    require(CLUSTER.resolve() == CLUSTER and CLUSTER.stat().st_mode & 0o777 == 0o700,
            'Wrong cluster directory or permissions')
    pid = (CLUSTER / 'postmaster.pid').read_text().splitlines()
    require(pid[1] == str(CLUSTER) and pid[3] == '55433' and pid[5] == '127.0.0.1'
            and pid[7].strip() == 'ready', 'Cluster identity mismatch')
    listener = subprocess.check_output(
        ['/usr/sbin/lsof', '-nP', '-a', '-p', pid[0], '-iTCP:55433', '-sTCP:LISTEN'], text=True)
    require('127.0.0.1:55433 (LISTEN)' in listener, 'Cluster PID does not own expected listener')
    rules = [line.split() for line in (CLUSTER / 'pg_hba.conf').read_text().splitlines()
             if line.strip() and not line.lstrip().startswith('#')]
    require(rules == [
        ['local', 'all', 'all', 'reject'],
        ['host', 'postgres', 'hassan_cluster_admin', '127.0.0.1/32', 'scram-sha-256'],
        ['host', 'hassan_ragab_local', 'hassan_ragab_local', '127.0.0.1/32', 'scram-sha-256'],
        ['host', 'all', 'all', '0.0.0.0/0', 'reject'],
        ['host', 'all', 'all', '::0/0', 'reject'],
    ], 'Unexpected cluster authentication rules')
    spec = importlib.util.spec_from_file_location('hassan_audit', WORKSPACE / 'local/hassan/audit_migrations.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    graph = module.audit()
    require(json.loads(json.dumps(graph)) == json.loads((WORKSPACE / 'local/hassan/migration-graph.json').read_text()),
            'Canonical migration graph differs from reviewed manifest')
    require(graph['count'] == 63 and graph['heads'] == [HEAD]
            and graph['roots'] == ['9a1b321acf1c'], 'Unexpected graph')
    os.environ.clear()
    os.environ.update(settings)
    return settings, int(pid[2])


def verify_identity(connection, started):
    from sqlalchemy import text
    row = connection.execute(text("""SELECT host(inet_server_addr()), inet_server_port(),
        current_database(), current_user, session_user,
        floor(extract(epoch FROM pg_postmaster_start_time()))::bigint,
        pg_get_userbyid(d.datdba), current_setting('server_version_num')::int
        FROM pg_database d WHERE d.datname=current_database()""")).one()
    require(tuple(row[:7]) == ('127.0.0.1', 55433, 'hassan_ragab_local', 'hassan_ragab_local',
                               'hassan_ragab_local', started, 'hassan_ragab_local')
            and 160000 <= row[7] < 170000, 'Database/server/owner identity mismatch')
    flags = connection.execute(text("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user")).one()
    require(not any(flags), 'Application role is unexpectedly privileged')
    require(connection.execute(text("SELECT lanpltrusted FROM pg_language WHERE lanname='plpgsql'")).scalar() is True,
            'Trusted PL/pgSQL missing')
    require(connection.execute(text("SELECT has_schema_privilege(current_user,'public','CREATE')")).scalar() is True,
            'Schema CREATE privilege missing')


def verify_empty(connection):
    from sqlalchemy import text
    for table, join in [('pg_class', 'c.relnamespace'), ('pg_proc', 'c.pronamespace'), ('pg_type', 'c.typnamespace')]:
        count = connection.execute(text(
            f'SELECT count(*) FROM {table} c JOIN pg_namespace n ON n.oid={join} WHERE {SYSTEM_SCHEMAS}'
        )).scalar()
        require(count == 0, 'Database is not empty; stop rather than replace or resume')
    schemas = connection.execute(text("SELECT nspname FROM pg_namespace n WHERE " + SYSTEM_SCHEMAS)).scalars().all()
    require(schemas == ['public'], 'Unexpected application schema')
    require(connection.execute(text("SELECT count(*) FROM pg_extension WHERE extname <> 'plpgsql'")).scalar() == 0,
            'Unexpected extensions')


def expected_tables():
    tables = {'employee_financial_actions', 'business_days', 'alembic_version'}
    for path in (WORKSPACE / 'backend/migrations/versions').glob('*.py'):
        tree = ast.parse(path.read_text())
        for function in tree.body:
            if isinstance(function, ast.FunctionDef) and function.name == 'upgrade':
                for node in ast.walk(function):
                    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'create_table':
                        tables.add(ast.literal_eval(node.args[0]))
    return tables


def verify_result(connection):
    from sqlalchemy import inspect, text
    tables = set(inspect(connection).get_table_names(schema='public'))
    require(tables == expected_tables(), 'Unexpected final table inventory')
    require(connection.execute(text('SELECT version_num FROM public.alembic_version')).scalars().all() == [HEAD],
            'Unexpected Alembic head')
    counts = {table: connection.execute(text(f'SELECT count(*) FROM public."{table}"')).scalar() for table in sorted(tables)}
    require(counts['branches'] == 1 and counts['alembic_version'] == 1
            and all(count == 0 for table, count in counts.items() if table not in {'branches', 'alembic_version'}),
            'Unexpected seeded business data')
    branch = connection.execute(text('SELECT name,city,is_active,is_main_warehouse,allow_discounts FROM public.branches')).one()
    require(tuple(branch) == ('Main Warehouse', 'Cairo', True, True, False), 'Unexpected warehouse seed')
    invalid = connection.execute(text("SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND NOT c.convalidated")).scalar()
    require(invalid == 0, 'Unvalidated constraints')
    required = {'ck_stock_movement_balance_snapshot', 'uq_stock_movement_reversal',
                'ck_deposit_application_reference', 'uq_settlement_number', 'uq_deposit_invoice_collection'}
    constraints = set(connection.execute(text("SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'")).scalars())
    require(required <= constraints, 'Required integrity constraints missing')
    indexes = set(connection.execute(text("SELECT indexname FROM pg_indexes WHERE schemaname='public'")).scalars())
    require('uq_employee_present' in indexes, 'Attendance uniqueness missing')
    require('uq_single_main_warehouse' not in indexes, 'Unexpected deviation from canonical warehouse index behavior')
    triggers = set(connection.execute(text("SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal")).scalars())
    require({'trg_invoice_audit_events_append_only', 'return_valuation_immutable'} <= triggers,
            'Required immutability triggers missing')
    return dict(head=HEAD, table_count=len(tables), application_table_count=len(tables)-1,
                row_counts=counts, constraint_count=len(constraints), warehouse=list(branch),
                warehouse_unique_index=False)


class RedactedLog:
    def __init__(self, stream, values):
        self.stream, self.values = stream, values

    def write(self, message):
        for value in self.values:
            message = message.replace(value, '<redacted>')
        return self.stream.write(message)

    def flush(self):
        self.stream.flush()


def execute(settings, started, apply):
    require(not apply, 'Standalone migration execution awaits separate reviewed authorization; no migration attempted')
    from sqlalchemy import create_engine
    from sqlalchemy.engine import URL
    from sqlalchemy.pool import NullPool
    target = urlsplit(settings['DATABASE_URL'])
    engine = create_engine(URL.create('postgresql+psycopg2', username=target.username,
        password=target.password, host=target.hostname, port=target.port, database='hassan_ragab_local'),
        poolclass=NullPool, hide_parameters=True, connect_args={
            'connect_timeout': 5, 'require_auth': 'scram-sha-256', 'passfile': '/dev/null',
            'application_name': 'hr_guarded_migrations',
            'options': '-c search_path=public -c lock_timeout=5000 -c statement_timeout=120000',
        })
    try:
        with engine.begin() as connection:
            if not apply:
                from sqlalchemy import text
                connection.execute(text('SET TRANSACTION READ ONLY'))
            verify_identity(connection, started)
            verify_empty(connection)
            print('Verified Hassan Ragab identity, SCRAM authentication, ownership, PL/pgSQL and empty schema.')
            if not apply:
                return {'status': 'preflight_passed', 'target': '127.0.0.1:55433/hassan_ragab_local'}
    except Exception as exc:
        raise RuntimeError(f'Hassan Ragab migration preflight rejected: {type(exc).__name__}: {exc}') from None
