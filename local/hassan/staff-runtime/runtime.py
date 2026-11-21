"""Disposable Staff integration runtime. Never imports operational private config."""
import argparse
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[3]
PRIVATE = WORKSPACE / '.local/omar/staff-integration'
PG = Path('/opt/homebrew/opt/postgresql@16/bin')
ORIGIN = 'https://localhost:54443'
DATABASE = 'omar_staff_integration'
ROLE = 'omar_staff_test'
HEAD = 'zz_staff_gps_attendance'
sys.path.insert(0, str(WORKSPACE / 'backend'))


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n');path.chmod(0o600)


def clean_env():
    return {'PATH':'/opt/homebrew/bin:/usr/bin:/bin','HOME':str(Path.home()),'LANG':'en_US.UTF-8'}


def load():
    if Path.cwd().resolve() != WORKSPACE or WORKSPACE.name != 'omar-fahim-standalone':
        raise RuntimeError('Wrong standalone workspace')
    if PRIVATE.resolve() != PRIVATE or PRIVATE.stat().st_mode & 0o077:
        raise RuntimeError('Private isolated directory required')
    path=PRIVATE/'config.json'
    if path.resolve()!=path or path.stat().st_mode & 0o777 != 0o600:raise RuntimeError('Private config required')
    cfg=json.loads(path.read_text());validate(cfg)
    return cfg


def validate(cfg):
    if (cfg.get('environment')!='omar-disposable-staff-integration' or cfg.get('origin')!=ORIGIN or
        cfg.get('database')!=DATABASE or cfg.get('role')!=ROLE or cfg.get('port')!=55440 or
        cfg.get('socket')!=str(PRIVATE/'socket') or cfg.get('data')!=str(PRIVATE/'data') or
        cfg.get('workspace')!=str(WORKSPACE)):
        raise RuntimeError('Isolated runtime target mismatch')
    if cfg.get('mobile'):
        import ipaddress
        mobile=cfg['mobile'];address=ipaddress.ip_address(mobile['bind_ip'])
        if (address.version!=4 or not address.is_private or address.is_loopback or address.is_link_local or address.is_unspecified or address.is_multicast or address.is_reserved or
            mobile.get('port')!=54444 or not re.fullmatch(r'[a-z0-9-]+\.local',mobile.get('hostname','')) or
            mobile.get('origin')!='https://'+mobile['hostname']+':54444' or
            address not in ipaddress.ip_network(mobile['subnet'])):
            raise RuntimeError('Invalid private mobile test origin')
    for name in ('socket','data','uploads'):
        path=PRIVATE/name
        if path.is_symlink() or (path.exists() and (path.resolve()!=path or path.stat().st_uid!=os.getuid() or path.stat().st_mode & 0o077)):
            raise RuntimeError('Redirected or non-private disposable directory')
    for key in ('db_password','cluster_password','secret_key','jwt_secret'):
        if not isinstance(cfg.get(key),str) or not re.fullmatch('[0-9a-f]{64}',cfg[key]):raise RuntimeError('Fresh isolated secrets required')
    if len({cfg[k] for k in ('db_password','cluster_password','secret_key','jwt_secret')})!=4:raise RuntimeError('Secrets must differ')


def engine(cfg, admin=False):
    validate(cfg)
    from sqlalchemy import create_engine
    from sqlalchemy.engine import URL
    return create_engine(URL.create('postgresql+psycopg2',username='staff_cluster_admin' if admin else ROLE,
        password=cfg['cluster_password'] if admin else cfg['db_password'],database='postgres' if admin else DATABASE,
        query={'host':cfg['socket'],'port':'55440'}),hide_parameters=True,
        connect_args={'connect_timeout':5,'passfile':'/dev/null','require_auth':'scram-sha-256',
                      'options':'-c lock_timeout=5000 -c statement_timeout=120000'})


def identity(connection,cfg,admin=False):
    from sqlalchemy import text
    result=connection.execute(text("SELECT current_database(),current_user,inet_server_addr(),inet_server_port(),current_setting('port'),current_setting('listen_addresses'),floor(extract(epoch FROM pg_postmaster_start_time()))::bigint")).one()
    epoch=int((Path(cfg['data'])/'postmaster.pid').read_text().splitlines()[2])
    expected=('postgres' if admin else DATABASE,'staff_cluster_admin' if admin else ROLE,None,None,'55440','',epoch)
    if tuple(result)!=expected:raise RuntimeError('Disposable cluster identity not proven')
    if admin and connection.execute(text("SELECT current_setting('data_directory')")).scalar()!=cfg['data']:
        raise RuntimeError('Disposable data directory mismatch')
    return list(result)


def certificates():
    from cryptography import x509
    from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
    from cryptography.hazmat.primitives import hashes,serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    import ipaddress
    now=datetime.now(timezone.utc)
    ca_key=ec.generate_private_key(ec.SECP256R1());server_key=ec.generate_private_key(ec.SECP256R1())
    name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Omar disposable Staff QA CA')])
    ca=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=30))
        .add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True)
        .add_extension(x509.KeyUsage(digital_signature=True,key_encipherment=False,key_cert_sign=True,crl_sign=True,
            content_commitment=False,data_encipherment=False,key_agreement=False,encipher_only=False,decipher_only=False),critical=True)
        .sign(ca_key,hashes.SHA256()))
    leaf=(x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'localhost')]))
        .issuer_name(name).public_key(server_key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=7))
        .add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True)
        .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),critical=False)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),critical=False)
        .sign(ca_key,hashes.SHA256()))
    for filename,key in [('ca-key.pem',ca_key),('server-key.pem',server_key)]:
        (PRIVATE/filename).write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    (PRIVATE/'ca.pem').write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    (PRIVATE/'server.pem').write_bytes(leaf.public_bytes(serialization.Encoding.PEM))
    for path in PRIVATE.glob('*.pem'):path.chmod(0o600)
    return ca.fingerprint(hashes.SHA256()).hex()


def factory(cfg):
    validate(cfg)
    os.environ.clear();os.environ.update({'FLASK_ENV':'production','ENABLE_DEV_ROUTES':'false','UPLOAD_FOLDER':str(PRIVATE/'uploads')})
    from app.config import Config
    eng=engine(cfg)
    with eng.connect() as c:identity(c,cfg)
    Config.SQLALCHEMY_DATABASE_URI=eng.url;eng.dispose()
    Config.SECRET_KEY=cfg['secret_key'];Config.JWT_SECRET_KEY=cfg['jwt_secret']
    Config.STAFF_IDENTITY_OMAR_RUNTIME=True;Config.STAFF_IDENTITY_ENABLED=True;Config.STAFF_TRUSTED_ORIGINS=(ORIGIN,)+( (cfg['mobile']['origin'],) if cfg.get('mobile') else () )
    Config.SQLALCHEMY_ENGINE_OPTIONS={'pool_size':3,'max_overflow':0,'pool_pre_ping':True,
        'connect_args':{'passfile':'/dev/null','require_auth':'scram-sha-256'}}
    Config.API_CORS_ALLOWED_ORIGINS=Config.STAFF_TRUSTED_ORIGINS;Config.SESSION_COOKIE_NAME='omar_staff_qa_flask_session'
    Config.SESSION_COOKIE_SECURE=True;Config.SESSION_COOKIE_SAMESITE='Strict'
    Config.MINI_LEGACY_DEVICE_COMPATIBILITY_ENABLED=False;Config.MINI_PROOF_ENROLLMENT_REQUIRED=True
    from app import create_app
    app=create_app(bootstrap=False)
    from flask import request,jsonify,send_from_directory
    static=WORKSPACE/'.local/omar/staff-build'
    manifest=json.loads((static/'manifest.json').read_text())
    @app.before_request
    def isolation_surface():
        # The phone listener never exposes manager/Admin, even to localhost clients.
        if request.path.startswith('/api/admin/') and (request.remote_addr not in ('127.0.0.1','::1') or request.host!='localhost:54443' or request.environ.get('SERVER_PORT')!='54443'):
            return jsonify(error='Not found'),404
        if request.host not in ['localhost:54443']+([cfg['mobile']['hostname']+':54444',cfg['mobile']['bind_ip']+':54444','localhost:54444'] if cfg.get('mobile') else []):
            return jsonify(error='Not found'),404
        allowed=(request.path=='/health' or request.path=='/api/admin/auth/login' or request.path.startswith('/api/staff/') or
            re.fullmatch(r'/api/admin/employees/\d+/(staff-identity/codes|staff-devices(?:/[0-9a-f]{32}/(?:approve|revoke))?)',request.path) or
            request.path in ('/','/field-check','/field-check.mjs','/field-check.css') or request.path.lstrip('/') in manifest)
        if not allowed:return jsonify(error='Not found'),404
    # Existing health function is replaced only in this disposable app instance.
    app.view_functions['health']=lambda:jsonify(status='ok',environment=cfg['environment'],integration_id=cfg['integration_id'])
    @app.route('/')
    def staff_index():return send_from_directory(static,'index.html')
    @app.route('/field-check')
    def field_check():return send_from_directory(WORKSPACE/'local/omar/staff-runtime','field-check.html')
    @app.route('/field-check.css')
    def field_styles():return send_from_directory(WORKSPACE/'local/omar/staff-runtime','field-check.css',mimetype='text/css')
    @app.route('/field-check.mjs')
    def field_script():return send_from_directory(WORKSPACE/'local/omar/staff-runtime','field-check.mjs',mimetype='text/javascript')
    @app.route('/<path:filename>')
    def staff_asset(filename):
        if filename not in manifest:return jsonify(error='Not found'),404
        return send_from_directory(static,filename,mimetype='text/javascript' if filename.endswith('.mjs') else None)
    @app.after_request
    def headers(response):
        response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
        response.headers['X-Content-Type-Options']='nosniff';response.headers['Referrer-Policy']='no-referrer'
        response.headers['Cache-Control']='no-store'
        return response
    return app


def prepare():
    if PRIVATE.exists():raise RuntimeError('Existing disposable environment found; refuse to overwrite/reinitialize')
    if subprocess.check_output(['git','branch','--show-current'],cwd=WORKSPACE,text=True).strip()!='feat/omar-fahim-setup':raise RuntimeError('Wrong branch')
    for port in (54443,55440):
        result=subprocess.run(['/usr/sbin/lsof','-nP',f'-iTCP:{port}','-sTCP:LISTEN'],capture_output=True,text=True)
        if result.returncode!=1 or result.stdout or result.stderr:raise RuntimeError('Test port ownership conflict')
    os.umask(0o077);PRIVATE.mkdir(mode=0o700)
    for directory in ('socket','uploads'):(PRIVATE/directory).mkdir(mode=0o700)
    cfg=dict(environment='omar-disposable-staff-integration',workspace=str(WORKSPACE),origin=ORIGIN,
        database=DATABASE,role=ROLE,port=55440,socket=str(PRIVATE/'socket'),data=str(PRIVATE/'data'),integration_id=secrets.token_hex(16))
    cfg.update({key:secrets.token_hex(32) for key in ('db_password','cluster_password','secret_key','jwt_secret')})
    write_json(PRIVATE/'config.json',cfg);validate(cfg)
    pwfile=PRIVATE/'init-password';pwfile.write_text(cfg['cluster_password']);pwfile.chmod(0o600)
    try:subprocess.run([str(PG/'initdb'),'-D',cfg['data'],'-U','staff_cluster_admin','-A','scram-sha-256','--pwfile',str(pwfile),'--no-locale','--encoding=UTF8'],env=clean_env(),check=True,stdout=subprocess.DEVNULL)
    finally:pwfile.unlink()
    with (Path(cfg['data'])/'postgresql.conf').open('a') as f:
        f.write(f"\nlisten_addresses = ''\nport = 55440\nunix_socket_directories = '{cfg['socket']}'\npassword_encryption = 'scram-sha-256'\n")
    (Path(cfg['data'])/'pg_hba.conf').write_text('local postgres staff_cluster_admin scram-sha-256\nlocal omar_staff_integration omar_staff_test scram-sha-256\nlocal all all reject\nhost all all 127.0.0.1/32 reject\nhost all all ::1/128 reject\n')
    subprocess.run([str(PG/'pg_ctl'),'-D',cfg['data'],'-l',str(PRIVATE/'postgres.log'),'-w','start'],env=clean_env(),check=True,stdout=subprocess.DEVNULL)
    from sqlalchemy import text
    admin=engine(cfg,True)
    with admin.connect().execution_options(isolation_level='AUTOCOMMIT') as c:
        identity(c,cfg,True)
        # Generated hex only; role/database are fixed constants, never user input.
        c.execute(text(f'CREATE ROLE {ROLE} LOGIN PASSWORD :password NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8'), {'password':cfg['db_password']})
        c.exec_driver_sql(f'CREATE DATABASE {DATABASE} OWNER {ROLE} TEMPLATE template0 ENCODING \'UTF8\'')
    admin.dispose()
    finish_prepare(cfg)


def finish_prepare(cfg):
    eng=engine(cfg)
    from sqlalchemy import text
    with eng.connect() as c:
        identity(c,cfg)
        if c.execute(text("SELECT count(*) FROM pg_tables WHERE schemaname='public'")).scalar()!=0:
            raise RuntimeError('Preparation resume requires empty disposable application schema')
    from alembic import command
    from alembic.config import Config as AlembicConfig
    import importlib.util
    spec=importlib.util.spec_from_file_location('audit',WORKSPACE/'local/omar/audit_migrations.py');audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
    graph=audit.audit()
    if graph['heads']!=[HEAD] or json.loads(json.dumps(graph))!=json.loads((WORKSPACE/'local/omar/migration-graph.json').read_text()):raise RuntimeError('Unreviewed migration graph')
    stages=[]
    for revision in ('zr_payroll_settlement_ledger',HEAD):
        with eng.begin() as c:
            identity(c,cfg)
            migration=AlembicConfig();migration.set_main_option('script_location',str(WORKSPACE/'local/omar/alembic'))
            migration.set_main_option('version_locations',str(WORKSPACE/'backend/migrations/versions'))
            migration.attributes.update(connection=c,omar_guarded=True)
            command.upgrade(migration,revision)
            actual=c.execute(text('SELECT version_num FROM alembic_version')).scalars().all()
            if actual!=[revision]:raise RuntimeError('Unexpected test revision')
            stages.append(dict(revision=revision,table_count=c.execute(text("SELECT count(*) FROM pg_tables WHERE schemaname='public'")).scalar()))
    eng.dispose()
    cfg['ca_sha256']=certificates();write_json(PRIVATE/'config.json',cfg)
    app=factory(cfg)
    from app.extensions import db
    from app.models.branch import Branch
    from app.models.employee import Employee,EmployeeType
    from app.models.user import User,UserRole
    from app.services.staff_identity_service import change_identity
    from app.services.staff_auth_service import issue_code
    with app.app_context(),app.test_request_context('/',base_url=ORIGIN,headers={'Origin':ORIGIN}):
        branch=Branch(name='SYNTHETIC STAFF QA — NOT A SALON',city='Test environment')
        manager=User(full_name='Synthetic QA Manager',email='staff_qa_manager',role=UserRole.SUPER_ADMIN,is_active=True)
        manager_password=secrets.token_urlsafe(24);manager.set_password(manager_password)
        db.session.add_all([branch,manager]);db.session.commit()
        accounts={'manager':dict(username=manager.email,password=manager_password),'staff':[]}
        for suffix in ('api','browser'):
            employee=Employee(full_name='Synthetic Staff QA '+suffix,employee_type=EmployeeType.BARBER,branch_id=branch.id)
            db.session.add(employee);db.session.commit()
            username='staff_qa_'+suffix
            result=change_identity(manager,employee.id,'create',{'username':username})
            change_identity(manager,employee.id,'state',{'is_active':True,'expected_version':1})
            code=issue_code(manager,employee.id,'activation')
            accounts['staff'].append(dict(purpose=suffix,employee_id=employee.id,user_id=result['user_id'],username=username,
                password=secrets.token_urlsafe(24),activation_code=code['code'],code_expires_at=code['expires_at']))
        write_json(PRIVATE/'accounts.json',accounts)
        # No geofence is configured or enabled. Shift projection remains UNASSIGNED.
        from app.models.staff_geofence import StaffGeofenceVersion
        if StaffGeofenceVersion.query.count()!=0:raise RuntimeError('Unexpected geofence configuration')
    write_json(PRIVATE/'preparation.json',dict(stages=stages,staff_enabled_in_test_only=True,geofence='UNCONFIGURED',
        ca_trust='NOT_INSTALLED',browser_mobile_acceptance='PENDING',synthetic_only=True))
    print('Prepared isolated cluster and full canonical chain. Secrets: private accounts/config files only.')


def serve():
    cfg=load()
    import ssl
    from werkzeug.serving import make_server
    app=factory(cfg);context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.minimum_version=ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(PRIVATE/'server.pem',PRIVATE/'server-key.pem')
    servers=[make_server('127.0.0.1',54443,app,threaded=True,ssl_context=context)]
    if cfg.get('mobile'):
        mobile_context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);mobile_context.minimum_version=ssl.TLSVersion.TLSv1_2
        mobile_context.load_cert_chain(PRIVATE/'mobile-server.pem',PRIVATE/'mobile-server-key.pem')
        servers.extend([make_server(address,54444,app,threaded=True,ssl_context=mobile_context) for address in ('127.0.0.1',cfg['mobile']['bind_ip'])])
    write_json(PRIVATE/'server.json',dict(pid=os.getpid(),cwd=str(WORKSPACE),origin=ORIGIN,environment=cfg['environment'],mobile=cfg.get('mobile')))
    import threading
    for listener in servers[1:]:threading.Thread(target=listener.serve_forever,daemon=True).start()
    print('Isolated Staff TLS ready; mobile trust requires owner installation/actual-device verification.',flush=True)
    try:servers[0].serve_forever()
    finally:
        for listener in servers:listener.server_close()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['prepare','resume','serve']);args=parser.parse_args()
    if args.action=='prepare':prepare()
    elif args.action=='resume':finish_prepare(load())
    else:serve()
