"""Staff-only activation/session core. Personal approved-device proof is mandatory."""
from datetime import datetime, timedelta, timezone
from functools import wraps
import hashlib
import hmac
import re
import secrets
import uuid
from urllib.parse import urlsplit
from flask import current_app, request, g
from flask_jwt_extended import create_access_token, create_refresh_token, decode_token
from sqlalchemy import case
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, TooManyRequests, Unauthorized
from werkzeug.security import generate_password_hash, check_password_hash
from app.extensions import db
from app.models.user import User, UserRole
from app.models.staff_auth import StaffAuthCode, StaffSession, StaffAuthRate
from app.services.staff_identity_service import authorize, require_staff_identity_enabled, _eligible, _event

REFRESH_COOKIE = 'hr_staff_refresh'
CSRF_COOKIE = 'hr_staff_csrf'
REFRESH_PATH = '/api/staff/auth'
_DUMMY_HASH = generate_password_hash('staff-auth-timing-placeholder')


def now_utc():
    return datetime.now(timezone.utc)


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def digest(kind, value):
    key = current_app.config['JWT_SECRET_KEY'].encode()
    return hmac.new(key, ('hr-staff:'+kind+':'+value).encode(), hashlib.sha256).hexdigest()


def require_device_binding(user=None, session=None):
    from app.services.staff_device_service import verify_binding
    return verify_binding(user,session)


def username(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{2,63}', value):
        return ''
    return value.lower()


def rate_limit(action, name='', limit=5, ip_limit=30):
    """Database-atomic fixed-window limits; independent from auth transaction rollback."""
    bucket = int(now_utc().timestamp()) // 900
    dialect = db.session.get_bind().dialect.name
    if dialect == 'postgresql':
        from sqlalchemy.dialects.postgresql import insert
    elif dialect == 'sqlite':
        from sqlalchemy.dialects.sqlite import insert
    else:
        raise Forbidden('Unsupported Staff rate-limit storage.')
    counts = []
    for value, ceiling in [('ip:'+str(request.remote_addr),ip_limit), ('username:'+name,limit)]:
        if value == 'username:' and not name:
            continue
        key = digest('rate',action+':'+value)
        statement = insert(StaffAuthRate).values(key=key,bucket=bucket,attempts=1)
        statement = statement.on_conflict_do_update(index_elements=['key'],set_={
            'bucket':bucket,'attempts':case((StaffAuthRate.bucket==bucket,StaffAuthRate.attempts+1),else_=1)
        }).returning(StaffAuthRate.attempts)
        count=db.session.execute(statement).scalar_one()
        counts.append((count,ceiling))
        if count>ceiling:
            db.session.commit()
            raise TooManyRequests('Too many Staff authentication attempts; try later.')
    db.session.commit()
    if any(count>ceiling for count,ceiling in counts):
        raise TooManyRequests('Too many Staff authentication attempts; try later.')


def require_origin():
    origin = request.headers.get('Origin')
    trusted = current_app.config.get('STAFF_TRUSTED_ORIGINS',())
    if (not request.is_secure or not isinstance(trusted,(tuple,list)) or not origin or origin not in trusted
            or urlsplit(origin).scheme!='https' or urlsplit(origin).path):
        raise Forbidden('Untrusted Staff origin.')


def _csrf():
    require_origin()
    cookie = request.cookies.get(CSRF_COOKIE,'')
    header = request.headers.get('X-Staff-CSRF','')
    if not cookie or not header or len(header)>128 or not hmac.compare_digest(cookie,header):
        raise Forbidden('Invalid Staff CSRF proof.')
    return header


def _active(user):
    if not user or user.role!=UserRole.EMPLOYEE or not user.employee_id or not user.is_active:
        return False
    try:
        _eligible(user.employee)
    except Conflict:
        return False
    return True


def issue_code(actor, employee_id, purpose):
    authorize(actor)
    if purpose not in ('activation','recovery'):
        raise BadRequest('Expected activation or recovery purpose.')
    rate_limit('issue-code:'+str(actor.id),str(employee_id),limit=5)
    user=User.query.filter_by(employee_id=employee_id).with_for_update().first()
    if not _active(user):
        raise Conflict('Staff identity must be eligible and administratively active.')
    if (purpose=='activation') == bool(user.staff_password_initialized):
        raise Conflict('Wrong code purpose for the current identity state.')
    now=now_utc()
    StaffAuthCode.query.filter_by(user_id=user.id,purpose=purpose,consumed_at=None,revoked_at=None).update({'revoked_at':now})
    raw=secrets.token_urlsafe(32)
    item=StaffAuthCode(id=uuid.uuid4().hex,user_id=user.id,issued_by=actor.id,purpose=purpose,
        code_hash=digest('code:'+purpose,raw),auth_version=user.staff_auth_version,expires_at=now+timedelta(minutes=15))
    db.session.add(item);_event(user,actor,'issue_'+purpose);db.session.commit()
    return {'code':raw,'purpose':purpose,'expires_at':item.expires_at.isoformat()}


def consume_code(name, raw, password, purpose):
    require_staff_identity_enabled();require_origin()
    normalized=username(name)
    rate_limit('consume:'+purpose,normalized or 'invalid',limit=5)
    if not isinstance(password,str) or not 12<=len(password)<=128:
        raise BadRequest('Password must contain 12–128 characters.')
    if not normalized or not isinstance(raw,str) or not 32<=len(raw)<=128:
        raise Unauthorized('Invalid or expired code.')
    user=User.query.filter_by(email=normalized,role=UserRole.EMPLOYEE).with_for_update().first()
    code=StaffAuthCode.query.filter_by(user_id=user.id,code_hash=digest('code:'+purpose,raw),purpose=purpose).with_for_update().first() if user else None
    if (not _active(user) or code is None or code.user_id!=user.id or code.consumed_at or code.revoked_at
            or aware(code.expires_at)<=now_utc() or code.auth_version!=user.staff_auth_version
            or (purpose=='activation')==bool(user.staff_password_initialized)):
        raise Unauthorized('Invalid or expired code.')
    now=now_utc();user.set_password(password);user.staff_password_initialized=True
    user.staff_auth_version+=1;code.consumed_at=now
    StaffAuthCode.query.filter(StaffAuthCode.user_id==user.id,StaffAuthCode.id!=code.id,StaffAuthCode.revoked_at.is_(None)).update({'revoked_at':now})
    StaffSession.query.filter_by(user_id=user.id,revoked_at=None).update({'revoked_at':now,'revoked_reason':'password-reset'})
    db.session.add(code)
    # Employee initiated; identity event records the actual actor, not a manager impersonation.
    _event(user,user,'password_'+purpose)
    from app.services.staff_device_service import grant
    enrollment=grant(user)
    db.session.commit()
    return enrollment


def _claims(user, session):
    from app.models.staff_device import StaffDevice
    device=db.session.get(StaffDevice,session.device_id)
    if not device or device.state!='ACTIVE':raise Unauthorized('Invalid Staff device.')
    return {'token_type':'staff','aud':'hr-staff','role':'EMPLOYEE','sid':session.id,'staff_auth_version':user.staff_auth_version,
        'device_id':device.id,'cnf':{'jkt':device.thumbprint}}


def _tokens(user, session):
    now=now_utc();remaining=aware(session.expires_at)-now
    if remaining.total_seconds()<=0:raise Unauthorized('Invalid Staff session.')
    claims=_claims(user,session)
    access=create_access_token(identity=str(user.id),additional_claims=claims,expires_delta=min(timedelta(minutes=15),remaining))
    refresh=create_refresh_token(identity=str(user.id),additional_claims=claims,expires_delta=remaining)
    csrf=secrets.token_urlsafe(32)
    session.refresh_hash=digest('refresh',refresh);session.csrf_hash=digest('csrf',csrf)
    return {'access_token':access,'refresh_token':refresh,'csrf':csrf,'expires_in':min(900,int(remaining.total_seconds())),'refresh_expires_in':int(remaining.total_seconds())}


def login(name, password):
    require_staff_identity_enabled();require_origin()
    normalized=username(name);rate_limit('login',normalized or 'invalid',limit=5)
    user=User.query.filter_by(email=normalized,role=UserRole.EMPLOYEE).with_for_update().first() if normalized else None
    supplied=password if isinstance(password,str) and len(password)<=128 else ''
    stored=user.password_hash if user and user.staff_password_initialized else _DUMMY_HASH
    try:
        valid=check_password_hash(stored,supplied)
    except (ValueError,TypeError):
        valid=False
    if not valid or not _active(user) or not user.staff_password_initialized:
        raise Unauthorized('Invalid credentials.')
    device=require_device_binding(user)
    session=StaffSession(id=uuid.uuid4().hex,user_id=user.id,device_id=device.id,auth_version=user.staff_auth_version,
        refresh_hash='',csrf_hash='',expires_at=now_utc()+timedelta(days=7))
    db.session.add(session);tokens=_tokens(user,session);db.session.commit()
    return tokens


def _decode(token, token_type, expired=False):
    if not isinstance(token,str) or not 1<=len(token)<=8192:raise Unauthorized('Invalid Staff session.')
    try:claims=decode_token(token,allow_expired=expired)
    except Exception:raise Unauthorized('Invalid Staff session.') from None
    if (claims.get('token_type')!='staff' or claims.get('aud')!='hr-staff' or claims.get('type')!=token_type
            or claims.get('role')!='EMPLOYEE' or not isinstance(claims.get('sid'),str)
            or type(claims.get('staff_auth_version')) is not int or not isinstance(claims.get('device_id'),str)
            or not isinstance(claims.get('cnf'),dict)):
        raise Unauthorized('Invalid Staff session.')
    return claims


def _locked_session(claims, allow_revoked=False):
    try:user_id=int(claims['sub'])
    except (KeyError,TypeError,ValueError):raise Unauthorized('Invalid Staff session.') from None
    user=User.query.filter_by(id=user_id).populate_existing().with_for_update().first()
    session=StaffSession.query.filter_by(id=claims['sid'],user_id=user_id).populate_existing().with_for_update().first()
    if not user or not session:raise Unauthorized('Invalid Staff session.')
    from app.models.staff_device import StaffDevice
    device=db.session.get(StaffDevice,session.device_id) if session.device_id else None
    if (not device or session.device_id!=claims['device_id'] or device.user_id!=user.id
            or device.employee_id!=user.employee_id or claims['cnf'].get('jkt')!=device.thumbprint
            or (not allow_revoked and device.state!='ACTIVE')):
        raise Unauthorized('Invalid Staff device session.')
    if not allow_revoked and (not _active(user) or not user.staff_password_initialized or session.revoked_at
            or aware(session.expires_at)<=now_utc() or session.auth_version!=user.staff_auth_version
            or claims['staff_auth_version']!=user.staff_auth_version):
        raise Unauthorized('Invalid Staff session.')
    return user,session


def refresh():
    require_staff_identity_enabled();csrf=_csrf();rate_limit('refresh',limit=30)
    raw=request.cookies.get(REFRESH_COOKIE);claims=_decode(raw,'refresh')
    user,session=_locked_session(claims)
    require_device_binding(user,session)
    if not hmac.compare_digest(session.refresh_hash,digest('refresh',raw)):
        session.revoked_at=now_utc();session.revoked_reason='refresh-replay';db.session.commit()
        raise Unauthorized('Invalid Staff session.')
    if not hmac.compare_digest(session.csrf_hash,digest('csrf',csrf)):
        raise Forbidden('Invalid Staff CSRF proof.')
    tokens=_tokens(user,session);db.session.commit();return tokens


def logout():
    require_staff_identity_enabled();require_origin()
    raw=request.cookies.get(REFRESH_COOKIE)
    if not raw:return
    csrf=_csrf();claims=_decode(raw,'refresh',expired=True)
    user,session=_locked_session(claims,allow_revoked=True)
    if not hmac.compare_digest(session.csrf_hash,digest('csrf',csrf)):
        raise Forbidden('Invalid Staff CSRF proof.')
    if not session.revoked_at:
        require_device_binding(user,session)
        session.revoked_at=now_utc();session.revoked_reason='logout';db.session.commit()


def require_staff(function):
    @wraps(function)
    def wrapped(*args,**kwargs):
        require_staff_identity_enabled()
        parts=request.headers.get('Authorization','').split()
        if len(parts)!=2 or parts[0].lower()!='bearer':raise Unauthorized('Invalid Staff session.')
        claims=_decode(parts[1],'access');user,session=_locked_session(claims)
        require_device_binding(user,session)
        db.session.commit()  # Persist one-time proof consumption even if the protected operation later fails.
        g.staff_user=user;g.staff_session=session
        g.staff_access_claims=claims;g.staff_device_id=session.device_id
        return function(*args,**kwargs)
    return wrapped


def set_cookies(response,tokens):
    response.set_cookie(REFRESH_COOKIE,tokens['refresh_token'],httponly=True,secure=True,samesite='Strict',path=REFRESH_PATH,max_age=tokens['refresh_expires_in'])
    response.set_cookie(CSRF_COOKIE,tokens['csrf'],httponly=False,secure=True,samesite='Strict',path='/',max_age=tokens['refresh_expires_in'])


def clear_cookies(response):
    response.delete_cookie(REFRESH_COOKIE,path=REFRESH_PATH,secure=True,httponly=True,samesite='Strict')
    response.delete_cookie(CSRF_COOKIE,path='/',secure=True,samesite='Strict')


def revoke_sessions(actor, employee_id):
    authorize(actor)
    user=User.query.filter_by(employee_id=employee_id).with_for_update().first()
    if not user or user.role!=UserRole.EMPLOYEE:
        raise Conflict('Linked Staff identity required.')
    user.staff_auth_version+=1
    StaffSession.query.filter_by(user_id=user.id,revoked_at=None).update({'revoked_at':now_utc(),'revoked_reason':'manager-revocation'})
    _event(user,actor,'revoke_sessions');db.session.commit()
