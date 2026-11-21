"""One-time synthetic cashier via the existing local Super Admin user endpoint for Hassan Ragab."""
import json
from pathlib import Path
import secrets
import sys
from urllib.request import Request, ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from hr_migrate import prepare, verify_identity, require, HEAD, PRIVATE
from hr_initialize import engine_for, warehouse_fingerprint, write_private


def check_empty(connection, credential_path):
    from sqlalchemy import text
    require(not credential_path.exists() and not credential_path.is_symlink(),
            'Existing cashier credential path; refusing duplicate provisioning')
    require(connection.execute(text('SELECT count(*) FROM employees')).scalar() == 0,
            'Existing employee; refusing duplicate provisioning')
    require(connection.execute(text('SELECT count(*) FROM users')).scalar() == 1,
            'Unexpected user inventory; refusing provisioning')
    require(connection.execute(text("SELECT role::text FROM users")).scalars().all() == ['SUPER_ADMIN'],
            'Unexpected existing administrator')


def main():
    from sqlalchemy import text
    settings, started = prepare(PRIVATE / 'backend.json')
    path = PRIVATE / 'cashier-qa.json'
    engine = engine_for(settings)
    try:
        with engine.connect() as connection:
            connection.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
            verify_identity(connection, started)
            check_empty(connection, path)
            require(connection.execute(text('SELECT version_num FROM alembic_version')).scalars().all() == [HEAD],
                    'Unexpected migration head')
            admin = json.loads((PRIVATE / 'initial-admin.json').read_text())
            require(warehouse_fingerprint(connection) == admin.get('warehouse_before_fingerprint', warehouse_fingerprint(connection)), 'Warehouse changed')
            branches = connection.execute(text('SELECT id,name,city FROM branches WHERE NOT is_main_warehouse AND is_active')).all()
            require(len(branches) == 1 and tuple(branches[0][1:]) == ('Hassan Ragab Salon', 'Giza'), 'Operating branch mismatch')
            require(connection.execute(text('SELECT count(*) FROM branches')).scalar() == 2, 'Unexpected branches')
            branch_id = branches[0][0]
        http = build_opener(ProxyHandler({}))

        def post(path, body, token=None):
            headers = {'Content-Type': 'application/json', 'Origin': 'http://127.0.0.1:3200'}
            if token:
                headers['Authorization'] = 'Bearer ' + token
            request = Request('http://127.0.0.1:5204/api/admin' + path,
                              data=json.dumps(body).encode(), headers=headers, method='POST')
            with http.open(request, timeout=15) as response:
                return response.status, json.load(response)

        status, login = post('/auth/login', {'username': admin['login'], 'password': admin['password']})
        require(status == 200 and login['user']['role'] == 'SUPER_ADMIN', 'Local Admin login failed')
        credential = dict(login='local-cashier-' + secrets.token_hex(8) + '@hassanragab.invalid',
                          password=secrets.token_urlsafe(36), display_name='Hassan Ragab Cashier QA',
                          branch_id=branch_id, target='127.0.0.1:55433/hassan_ragab_local')
        write_private(path, credential)
        status, _ = post('/users', dict(username=credential['login'], password=credential['password'],
            full_name=credential['display_name'], role='CASHIER', branch_id=branch_id, is_active=True), login['access_token'])
        require(status == 201, 'Provisioning did not return created; stop without retry')
        print('Created one synthetic cashier and matching employee through the canonical Admin endpoint.')
    finally:
        engine.dispose()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Cashier provisioning refused or failed (' + type(error).__name__ + '); no automatic retry.', file=sys.stderr)
        raise SystemExit(2)
