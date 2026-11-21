"""Certificate-verified real HTTP preparation checks; synthetic QA identities only."""
import argparse
import base64
import hashlib
import http.cookiejar
import json
import ssl
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime,timedelta,timezone
import runtime


class Client:
    def __init__(self,cfg,origin=None):
        runtime.validate(cfg)
        self.origin=origin or runtime.ORIGIN
        if self.origin not in (runtime.ORIGIN,cfg.get('mobile',{}).get('origin')):
            raise RuntimeError('Only exact configured isolated HTTPS origins are permitted')
        self.cfg=cfg;self.cookies=http.cookiejar.CookieJar()
        self.http=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(self.cookies),
            urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=str(runtime.PRIVATE/'ca.pem'))))
        status,health=self.call('/health')
        if status!=200 or health.get('integration_id')!=cfg['integration_id'] or health.get('environment')!=cfg['environment']:
            raise RuntimeError('Wrong isolated HTTPS runtime')
    def call(self,path,data=None,headers=None,method=None,raw=None):
        if not path.startswith('/') or path.startswith('//'):raise RuntimeError('Invalid isolated request target')
        body=raw if raw is not None else json.dumps(data,separators=(',',':'),sort_keys=True).encode() if data is not None else None
        req=urllib.request.Request(self.origin+path,data=body,headers={'Origin':self.origin,**({'Content-Type':'application/json'} if body is not None else {}),**(headers or {})},method=method)
        try:response=self.http.open(req,timeout=15)
        except urllib.error.HTTPError as error:response=error
        with response:
            raw_body=response.read()
            return response.status,json.loads(raw_body) if response.headers.get_content_type()=='application/json' else raw_body
    def expect(self,path,data=None,headers=None,method=None,status=200,raw=None):
        actual,result=self.call(path,data,headers,method,raw)
        if actual!=status:raise RuntimeError(f'Isolated QA request rejected: {path} HTTP {actual}, expected {status}')
        return result
    def csrf(self):return next(c.value for c in self.cookies if c.name=='omar_staff_csrf')


def manager(client,accounts):
    return client.expect('/api/admin/auth/login',accounts['manager'])['access_token']


def b64(value):return base64.urlsafe_b64encode(value).rstrip(b'=').decode()


def signed(client,binding,purpose,method,path,data=None,access=None):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
    device_id,key,jwk=binding
    raw=json.dumps(data,separators=(',',':'),sort_keys=True).encode() if data is not None else b''
    headers={'Authorization':'Bearer '+access} if access else {}
    if purpose in ('refresh','logout'):headers['X-Staff-CSRF']=client.csrf()
    challenge=client.expect('/api/staff/auth/device-challenges',dict(device_id=device_id,purpose=purpose,method=method,target=path,body_hash=hashlib.sha256(raw).hexdigest()),headers)
    payload={k:v for k,v in challenge.items() if k!='expires_at'}
    payload.update(iat=int(time.time()),jti=uuid.uuid4().hex)
    head=b64(json.dumps(dict(alg='ES256',typ='staff-device-proof+jwt',jwk=jwk),sort_keys=True,separators=(',',':')).encode())
    body=b64(json.dumps(payload,sort_keys=True,separators=(',',':')).encode())
    r,s=decode_dss_signature(key.sign((head+'.'+body).encode(),ec.ECDSA(hashes.SHA256())))
    proof=head+'.'+body+'.'+b64(r.to_bytes(32,'big')+s.to_bytes(32,'big'))
    return client.expect(path,headers={**headers,'X-Staff-Device':device_id,'DPoP':proof},method=method,raw=raw if method=='POST' else None)


def verify():
    cfg=runtime.load();accounts=json.loads((runtime.PRIVATE/'accounts.json').read_text());client=Client(cfg)
    manager_token=manager(client,accounts);admin={'Authorization':'Bearer '+manager_token}
    account=next(a for a in accounts['staff'] if a['purpose']=='api')
    if account.get('verified_at'):raise RuntimeError('API readiness already verified; refuse to rerun account activation')
    activation=client.expect('/api/staff/auth/activate',dict(username=account['username'],code=account['activation_code'],password=account['password']))
    from cryptography.hazmat.primitives.asymmetric import ec
    key=ec.generate_private_key(ec.SECP256R1());numbers=key.public_key().public_numbers()
    jwk=dict(kty='EC',crv='P-256',x=b64(numbers.x.to_bytes(32,'big')),y=b64(numbers.y.to_bytes(32,'big')))
    enrolled=client.expect('/api/staff/device-enrollments',dict(enrollment_grant=activation['enrollment_grant'],public_jwk=jwk),status=201)
    device_id=enrolled['device_id'];binding=(device_id,key,jwk)
    status,_=client.call('/api/staff/auth/device-challenges',dict(device_id=device_id,purpose='login',method='POST',target='/api/staff/auth/login',body_hash=hashlib.sha256(b'{}').hexdigest()))
    if status!=403:raise RuntimeError('Unapproved device did not fail closed')
    client.expect(f"/api/admin/employees/{account['employee_id']}/staff-devices/{device_id}/approve",dict(replace_device_id=None,reason='Synthetic isolated QA approval'),admin)
    finalized=signed(client,binding,'finalize','POST',f'/api/staff/device-enrollments/{device_id}/finalize',{})
    if finalized['state']!='ACTIVE':raise RuntimeError('Device not finalized')
    login=signed(client,binding,'login','POST','/api/staff/auth/login',dict(username=account['username'],password=account['password']))
    profile=signed(client,binding,'request','GET','/api/staff/me',access=login['access_token'])
    if profile['identity']['employee_id']!=account['employee_id']:raise RuntimeError('Wrong synthetic employee')
    for word in ('salary','commission','payroll','latitude','longitude'):
        if word in json.dumps(profile):raise RuntimeError('Unsafe Staff profile')
    day=datetime.now().astimezone().date()
    shifts=signed(client,binding,'request','GET',f'/api/staff/shifts?from={day.isoformat()}&to={(day+timedelta(days=2)).isoformat()}',access=login['access_token'])
    if not shifts['shifts'] or not all(s['state']=='UNASSIGNED' for s in shifts['shifts']):raise RuntimeError('Unexpected QA planning state')
    state=signed(client,binding,'request','GET','/api/staff/attendance/current',access=login['access_token'])
    if state['state']!='NONE':raise RuntimeError('Unexpected attendance data')
    refresh_cookie=next(c for c in client.cookies if c.name=='omar_staff_refresh')
    if not refresh_cookie.secure or refresh_cookie.path!='/api/staff/auth' or 'HttpOnly' not in refresh_cookie._rest:
        raise RuntimeError('Secure Staff cookie contract changed')
    restored=signed(client,binding,'refresh','POST','/api/staff/auth/refresh',{})
    again=signed(client,binding,'request','GET','/api/staff/me',access=restored['access_token'])
    if again['identity']!=profile['identity']:raise RuntimeError('Session restore identity changed')
    client.expect('/');
    # MIME/CSP checks use the same verified TLS transport; no unverified context.
    for path,mime in [('/app.mjs','text/javascript'),('/assets/staff.css','text/css'),('/assets/prototype.css','text/css'),('/assets/mini-print-logo.svg','image/svg+xml')]:
        with client.http.open(runtime.ORIGIN+path,timeout=5) as response:
            if response.status!=200 or response.headers.get_content_type()!=mime or "connect-src 'self'" not in response.headers['Content-Security-Policy']:
                raise RuntimeError('Static MIME/CSP failure')
    for path in ['/api/admin/invoices','/api/admin/reports','/api/mini/auth/me','/uploads/private','/backend/app/config.py']:
        if client.call(path,headers=admin)[0]!=404:raise RuntimeError('Non-Staff/financial surface exposed')
    signed(client,binding,'logout','POST','/api/staff/auth/logout',{})
    client.expect(f"/api/admin/employees/{account['employee_id']}/staff-devices/{device_id}/revoke",dict(reason='Synthetic readiness completed'),admin)
    from sqlalchemy import text
    eng=runtime.engine(cfg)
    with eng.connect() as c:
        c.execute(text('SET TRANSACTION READ ONLY'));db_identity=runtime.identity(c,cfg)
        counts={t:c.execute(text('SELECT count(*) FROM '+t)).scalar() for t in ['attendances','staff_attendance_receipts','staff_geofence_versions','employee_shift_instances','business_days','cashier_shifts','customers','invoices','payroll_settlements']}
        if any(counts.values()):raise RuntimeError('Unexpected operational/attendance/geofence data in QA environment')
        revision=c.execute(text('SELECT version_num FROM alembic_version')).scalar()
    eng.dispose()
    account.update(verified_at=datetime.now(timezone.utc).isoformat(),qa_device_id=device_id,qa_device_state='REVOKED')
    runtime.write_json(runtime.PRIVATE/'accounts.json',accounts)
    runtime.write_json(runtime.PRIVATE/'readiness.json',dict(status='API_VERIFIED',origin=runtime.ORIGIN,database_identity=db_identity,
        revision=revision,checks=['TLS hostname/CA verification','pending device rejection','real manager approval','signed finalization',
        'Staff login','safe profile','UNASSIGNED shifts','authoritative NONE','cookie refresh/session restoration','signed logout',
        'MIME/CSP/API routing','financial surfaces blocked','zero attendance/financial/customer/GPS data'],counts=counts,
        browser_trust='NOT_INSTALLED',browser_mobile_acceptance='UNVERIFIED',physical_GPS='NOT_TESTED'))
    print('Real TLS/API readiness passed. Browser/mobile trust and physical GPS remain pending.')


def manage(args):
    cfg=runtime.load();accounts=json.loads((runtime.PRIVATE/'accounts.json').read_text());client=Client(cfg)
    account=next((a for a in accounts['staff'] if a['employee_id']==args.employee_id),None)
    if not account:raise RuntimeError('Only configured synthetic employee IDs are permitted')
    headers={'Authorization':'Bearer '+manager(client,accounts)}
    if args.action=='code':
        result=client.expect(f'/api/admin/employees/{args.employee_id}/staff-identity/codes',dict(purpose=args.purpose),headers,status=201)
        account.update(latest_code=result['code'],latest_code_purpose=args.purpose,code_expires_at=result['expires_at'])
        if args.purpose=='activation':account['activation_code']=result['code']
        runtime.write_json(runtime.PRIVATE/'accounts.json',accounts)
        print('Fresh synthetic account code saved in private accounts.json; expires in 15 minutes.')
    else:
        if not re.fullmatch('[0-9a-f]{32}',args.device_id):raise RuntimeError('Invalid device ID')
        if args.replace_device_id is not None and not re.fullmatch('[0-9a-f]{32}',args.replace_device_id):raise RuntimeError('Invalid replacement ID')
        client.expect(f'/api/admin/employees/{args.employee_id}/staff-devices/{args.device_id}/approve',dict(replace_device_id=args.replace_device_id,reason='Explicit isolated browser QA device approval'),headers)
        print('Synthetic device approved by the real manager endpoint; browser must still finalize its proof.')


if __name__=='__main__':
    import re
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='action',required=True)
    sub.add_parser('verify')
    code=sub.add_parser('code');code.add_argument('--employee-id',type=int,required=True);code.add_argument('--purpose',choices=['activation','recovery'],default='activation')
    approve=sub.add_parser('approve');approve.add_argument('--employee-id',type=int,required=True);approve.add_argument('--device-id',required=True);approve.add_argument('--replace-device-id')
    args=parser.parse_args()
    if args.action=='verify':verify()
    else:manage(args)
