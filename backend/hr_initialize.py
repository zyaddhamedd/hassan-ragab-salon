"""Explicit first-time Hassan Ragab local initialization. No factory, server or migrations."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import sys
from urllib.parse import urlsplit

from hr_migrate import (HEAD, PRIVATE, expected_tables, prepare, require,
                        verify_identity, verify_result)

CREDENTIALS = PRIVATE / 'initial-admin.json'
BRANCH_NAME = 'Hassan Ragab Salon'
BRANCH_CITY = 'Giza'
DISPLAY_NAME = 'Hassan Ragab Administrator'


class AlreadyInitialized(RuntimeError):
    pass


def engine_for(settings):
    from sqlalchemy import create_engine
    from sqlalchemy.engine import URL
    from sqlalchemy.pool import NullPool
    url = urlsplit(settings['DATABASE_URL'])
    return create_engine(URL.create('postgresql+psycopg2', username=url.username,
        password=url.password, host=url.hostname, port=url.port, database='hassan_ragab_local'),
        poolclass=NullPool, hide_parameters=True, connect_args={
            'connect_timeout': 5, 'require_auth': 'scram-sha-256', 'passfile': '/dev/null',
            'application_name': 'hr_explicit_initialization',
            'options': '-c search_path=public -c lock_timeout=5000 -c statement_timeout=30000',
        })


def warehouse_fingerprint(connection):
    from sqlalchemy import text
    rows = connection.execute(text("SELECT to_jsonb(b)::text, xmin::text FROM public.branches b WHERE is_main_warehouse ORDER BY id")).all()
    require(len(rows) == 1, 'Expected exactly one existing internal warehouse')
    return hashlib.sha256(json.dumps([list(r) for r in rows]).encode()).hexdigest()


def first_time(connection):
    from sqlalchemy import text
    users, operating = connection.execute(text("SELECT (SELECT count(*) FROM public.users), (SELECT count(*) FROM public.branches WHERE NOT is_main_warehouse)")).one()
    if users or operating:
        raise AlreadyInitialized('Existing user or operating branch; refusing without writes')
    # Includes revision, complete inventory, constraints and zero business rows.
    verify_result(connection)
    require(not CREDENTIALS.exists() and not CREDENTIALS.is_symlink(),
            'Existing credential path; stop for ownership review')
    return warehouse_fingerprint(connection)


def write_private(path, values):
    require(path.parent == PRIVATE and PRIVATE.resolve() == PRIVATE,
            'Private output must remain in the isolated directory')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(values, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def create_records(session, password, login):
    from app.models import Branch, User, UserRole
    branch = Branch(name=BRANCH_NAME, city=BRANCH_CITY, is_active=True,
                    is_main_warehouse=False, allow_discounts=True)
    admin = User(full_name=DISPLAY_NAME, email=login, role=UserRole.SUPER_ADMIN,
                 branch_id=None, is_active=True)
    admin.set_password(password)
    require(admin.password_hash != password and admin.password_hash.startswith('scrypt:'),
            'Unexpected password hashing behavior')
    require(admin.check_password(password), 'Password hash verification failed')
    session.add_all([branch, admin])
    session.flush()


def state_fingerprint(connection):
    from sqlalchemy import text
    state = {}
    for table in sorted(expected_tables()):
        state[table] = connection.execute(text(
            f'SELECT to_jsonb(t)::text, xmin::text FROM public."{table}" t ORDER BY to_jsonb(t)::text'
        )).all()
        state[table] = [list(row) for row in state[table]]
    state['sequences'] = [list(row) for row in connection.execute(text(
        "SELECT schemaname,sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename"
    ))]
    return hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest()


def verify_initialized(connection, credentials):
    from sqlalchemy import inspect, text
    from app.models import User, UserRole
    tables = set(inspect(connection).get_table_names(schema='public'))
    require(tables == expected_tables(), 'Unexpected table inventory')
    require(connection.execute(text('SELECT version_num FROM public.alembic_version')).scalars().all() == [HEAD],
            'Migration head mismatch')
    counts = {table: connection.execute(text(f'SELECT count(*) FROM public."{table}"')).scalar()
              for table in sorted(tables)}
    require(counts['users'] == 1 and counts['branches'] == 2 and counts['alembic_version'] == 1
            and all(count == 0 for table, count in counts.items() if table not in {'users','branches','alembic_version'}),
            'Unexpected users, branches or business data')
    require(warehouse_fingerprint(connection) == credentials['warehouse_before_fingerprint'],
            'Existing warehouse record changed')
    branch = connection.execute(text("SELECT name,city,is_active,is_main_warehouse,allow_discounts,authorized_device_id,binding_ip,binding_user_agent,binding_timestamp FROM public.branches WHERE NOT is_main_warehouse")).one()
    require(tuple(branch) == (BRANCH_NAME, BRANCH_CITY, True, False, True, None, None, None, None),
            'Unexpected operating branch settings')
    row = connection.execute(User.__table__.select()).mappings().one()
    require(row['full_name'] == DISPLAY_NAME and row['email'] == credentials['login']
            and row['role'] == UserRole.SUPER_ADMIN and row['is_active'] is True
            and row['branch_id'] is None, 'Unexpected admin identity, role or scope')
    require(row['password_hash'].startswith('scrypt:') and row['password_hash'] != credentials['password'],
            'Password was not securely hashed')
    user = User(**dict(row))
    require(user.check_password(credentials['password'])
            and not user.check_password(credentials['password'] + '-incorrect'), 'Password verification mismatch')
    return dict(head=HEAD, application_tables=len(tables) - 1, users=1, super_admins=1,
                operating_branches=1, internal_warehouses=1,
                branch_name=BRANCH_NAME, branch_city=BRANCH_CITY,
                password_hash_verified=True, warehouse_unchanged=True,
                other_application_rows=0, state_fingerprint=state_fingerprint(connection))


def read_credentials():
    require(CREDENTIALS.resolve() == CREDENTIALS and CREDENTIALS.stat().st_mode & 0o777 == 0o600,
            'Private credential file must be real and owner-only')
    return json.loads(CREDENTIALS.read_text())


def execute(settings, started, mode):
    from sqlalchemy import text
    engine = engine_for(settings)
    try:
        if mode in {'check', 'verify'}:
            with engine.connect() as connection:
                connection.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
                verify_identity(connection, started)
                if mode == 'check':
                    fingerprint = first_time(connection)
                    return dict(status='first_time_preflight_passed', head=HEAD,
                                warehouse_before_fingerprint=fingerprint)
                return dict(status='initialized_state_verified', **verify_initialized(connection, read_credentials()))

        from sqlalchemy.orm import Session
        with Session(engine, expire_on_commit=False) as session:
            with session.begin():
                connection = session.connection()
                verify_identity(connection, started)
                connection.execute(text('LOCK TABLE public.branches, public.users IN EXCLUSIVE MODE'))
                fingerprint = first_time(connection)
                require(not (PRIVATE / 'initialization-result.json').exists(), 'Existing initialization evidence')
                credentials = dict(login='local-admin-' + secrets.token_hex(8) + '@hassanragab.invalid',
                    password=secrets.token_urlsafe(36), display_name=DISPLAY_NAME,
                    target='127.0.0.1:55433/hassan_ragab_local',
                    warehouse_before_fingerprint=fingerprint, created_at_epoch=started)
                write_private(CREDENTIALS, credentials)
                create_records(session, credentials['password'], credentials['login'])
                session.flush()
                result = dict(status='initialized', credentials_path=str(CREDENTIALS),
                              **verify_initialized(connection, credentials))
                return result
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    try:
        settings, started = prepare(args.config.resolve())
        chosen = 'apply' if args.apply else 'verify' if args.verify else 'check'
        result = execute(settings, started, chosen)
        if chosen == 'apply':
            write_private(PRIVATE / 'initialization-result.json', result)
    except AlreadyInitialized:
        parser.exit(3, 'Hassan Ragab initialization refused: existing user or operating branch; no writes performed.\n')
    except Exception:
        parser.exit(2, 'Hassan Ragab initialization stopped: a safety/configuration/state check failed. Inspect privately; do not retry or replace existing data.\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
