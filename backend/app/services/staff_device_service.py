"""Personal Staff device proof. Reuses Mini cryptography, never its device records."""
import hashlib
import hmac
import json
import re
import secrets
import uuid
from datetime import timedelta
from urllib.parse import urlsplit
from flask import request,current_app,g
from sqlalchemy.exc import IntegrityError
from werkzeug.exceptions import BadRequest,Conflict,Forbidden,NotFound,Unauthorized
from app.extensions import db
from app.models.user import User,UserRole
from app.models.staff_auth import StaffSession
from app.models.staff_device import StaffDevice,StaffDeviceAudit,StaffDeviceChallenge,StaffEnrollmentGrant
from app.services.staff_identity_service import authorize,require_staff_identity_enabled
from app.services import staff_auth_service as auth
from app.services.mini_device_proof_service import _canonical_public_jwk,_public_key,_decode_and_verify_jws,public_jwk_thumbprint,access_token_hash
from app.services.mini_device_service import MiniDeviceSecurityError


def _id(value):
    if not isinstance(value,str) or not re.fullmatch('[0-9a-f]{32}',value):raise Forbidden('Invalid Staff device proof.')
    return value


def _user_for(device_id, require_active=True):
    device=db.session.get(StaffDevice,_id(device_id))
    if not device:raise Forbidden('Invalid Staff device proof.')
    user=User.query.filter_by(id=device.user_id).populate_existing().with_for_update().first()
    device=StaffDevice.query.filter_by(id=device.id).populate_existing().with_for_update().first()
    if (not user or user.role!=UserRole.EMPLOYEE or user.employee_id!=device.employee_id
            or (require_active and (not auth._active(user) or not user.staff_password_initialized))):
        raise Forbidden('Invalid Staff device proof.')
    return user,device


def _audit(device,actor,action,reason=None):
    db.session.add(StaffDeviceAudit(device_id=device.id,actor_id=actor.id,action=action,reason=reason))


def grant(user):
    raw=secrets.token_urlsafe(32)
    db.session.add(StaffEnrollmentGrant(id=uuid.uuid4().hex,user_id=user.id,auth_version=user.staff_auth_version,
        grant_hash=auth.digest('enrollment',raw),expires_at=auth.now_utc()+timedelta(minutes=15)))
    return {'enrollment_grant':raw,'enrollment_expires_in':900}


def enroll(raw,jwk):
    require_staff_identity_enabled();auth.require_origin();auth.rate_limit('device-enroll',limit=5)
    if not isinstance(raw,str) or not 32<=len(raw)<=128:raise Unauthorized('Invalid enrollment grant.')
    item=StaffEnrollmentGrant.query.filter_by(grant_hash=auth.digest('enrollment',raw)).first()
    if not item:raise Unauthorized('Invalid enrollment grant.')
    user=User.query.filter_by(id=item.user_id).populate_existing().with_for_update().first()
    item=StaffEnrollmentGrant.query.filter_by(id=item.id).populate_existing().with_for_update().first()
    if (not auth._active(user) or not user.staff_password_initialized or item.consumed_at
            or auth.aware(item.expires_at)<=auth.now_utc() or item.auth_version!=user.staff_auth_version):
        raise Unauthorized('Invalid enrollment grant.')
    try:
        canonical=_canonical_public_jwk(jwk);_public_key(canonical)
    except MiniDeviceSecurityError:raise BadRequest('Invalid P-256 public key; private keys are forbidden.') from None
    device=StaffDevice(id=uuid.uuid4().hex,user_id=user.id,employee_id=user.employee_id,state='PENDING',
        public_jwk=json.dumps(canonical,sort_keys=True),thumbprint=public_jwk_thumbprint(canonical),enrollment_auth_version=user.staff_auth_version)
    item.consumed_at=auth.now_utc();db.session.add(device)
    try:
        db.session.flush();_audit(device,user,'requested');db.session.commit()
    except IntegrityError:
        db.session.rollback();raise Conflict('This public key is already registered.') from None
    return {'device_id':device.id,'state':device.state}


def list_devices(actor,employee_id):
    authorize(actor)
    return [{'device_id':d.id,'state':d.state,'thumbprint':d.thumbprint,'approved_by':d.approved_by,
        'approved_at':d.approved_at.isoformat() if d.approved_at else None,
        'revoked_by':d.revoked_by,'revoked_at':d.revoked_at.isoformat() if d.revoked_at else None,
        'replaced_by_id':d.replaced_by_id} for d in StaffDevice.query.filter_by(employee_id=employee_id).order_by(StaffDevice.created_at.desc()).all()]


def decide(actor,employee_id,device_id,action,reason,expected_active=None):
    authorize(actor)
    if not isinstance(reason,str) or not 3<=len(reason.strip())<=200:raise BadRequest('A 3–200 character reason is required.')
    if action not in ('approve','revoke'):raise BadRequest('Invalid device action.')
    if expected_active is not None:_id(expected_active)
    user,device=_user_for(device_id,require_active=action!='revoke')
    if device.employee_id!=employee_id:raise NotFound('Device not found for employee.')
    if action=='approve':
        if device.state not in ('PENDING','APPROVED') or device.enrollment_auth_version!=user.staff_auth_version:raise Conflict('Device request is no longer eligible.')
        active=StaffDevice.query.filter_by(employee_id=employee_id,state='ACTIVE').populate_existing().with_for_update().first()
        if (active.id if active else None)!=expected_active:raise Conflict('Active device changed; explicit replacement approval required.')
        device.expected_active_id=expected_active;device.state='APPROVED';device.approved_by=actor.id;device.approved_at=auth.now_utc()
        _audit(device,actor,'approved',reason.strip())
    else:
        if device.state in ('REVOKED','REPLACED'):return {'device_id':device.id,'state':device.state}
        device.state='REVOKED';device.revoked_by=actor.id;device.revoked_at=auth.now_utc()
        StaffSession.query.filter_by(device_id=device.id,revoked_at=None).update({'revoked_at':auth.now_utc(),'revoked_reason':'device-revoked'})
        _audit(device,actor,'revoked',reason.strip())
    db.session.commit();return {'device_id':device.id,'state':device.state}


def _target(purpose,device_id,method,target):
    if not isinstance(purpose,str) or not isinstance(method,str):raise BadRequest('Invalid proof target.')
    if not isinstance(target,str) or len(target)>512 or not target.isascii():raise BadRequest('Invalid proof target.')
    parsed=urlsplit(target)
    paths={'finalize':('POST','/api/staff/device-enrollments/'+device_id+'/finalize'),
        'login':('POST','/api/staff/auth/login'),'refresh':('POST','/api/staff/auth/refresh'),
        'logout':('POST','/api/staff/auth/logout'),'request':('GET','/api/staff/me')}
    if purpose=='request' and parsed.path=='/api/staff/shifts':
        paths['request']=('GET','/api/staff/shifts')
    if purpose=='request' and parsed.path=='/api/staff/attendance/current':
        paths['request']=('GET',parsed.path)
    if purpose=='request' and parsed.path in ('/api/staff/attendance/check-in','/api/staff/attendance/check-out') and not parsed.query:
        paths['request']=('POST',parsed.path)
    if (purpose not in paths or (method,parsed.path)!=paths[purpose] or parsed.scheme or parsed.netloc
            or parsed.fragment or (purpose!='request' and parsed.query)):
        raise BadRequest('Invalid proof target.')


def challenge(device_id,purpose,method,target,body_hash):
    require_staff_identity_enabled();auth.require_origin();_id(device_id)
    auth.rate_limit('device-challenge',device_id,limit=60,ip_limit=300)
    _target(purpose,device_id,method,target)
    if not isinstance(body_hash,str) or not re.fullmatch('[0-9a-f]{64}',body_hash):raise BadRequest('Expected SHA-256 body hash.')
    user,device=_user_for(device_id)
    token_hash=None
    if purpose=='finalize':
        if device.state!='APPROVED' or device.enrollment_auth_version!=user.staff_auth_version:raise Forbidden('Device not approved.')
    elif device.state!='ACTIVE':raise Forbidden('Device is not active.')
    if purpose in ('refresh','logout','request'):
        if purpose=='request':
            parts=request.headers.get('Authorization','').split()
            if len(parts)!=2 or parts[0].lower()!='bearer':raise Unauthorized('Invalid Staff session.')
            raw=parts[1];claims=auth._decode(raw,'access')
        else:
            auth._csrf();raw=request.cookies.get(auth.REFRESH_COOKIE);claims=auth._decode(raw,'refresh')
        owner,session=auth._locked_session(claims)
        if owner.id!=user.id or session.device_id!=device.id:raise Forbidden('Session/device mismatch.')
        token_hash=access_token_hash(raw)
    nonce=secrets.token_urlsafe(32)
    item=StaffDeviceChallenge(id=uuid.uuid4().hex,device_id=device.id,purpose=purpose,nonce_hash=auth.digest('device-nonce',nonce),
        origin=request.headers['Origin'],method=method,target=target,body_hash=body_hash,token_hash=token_hash,
        auth_version=user.staff_auth_version,expires_at=auth.now_utc()+timedelta(seconds=60))
    db.session.add(item);db.session.commit()
    return {'challenge_id':item.id,'challenge':nonce,'device_id':device.id,'purpose':purpose,'htm':method,
        'htu':item.origin+target,'body_hash':body_hash,'ath':token_hash,'expires_at':auth.aware(item.expires_at).isoformat()}


def _proof(user,device,purpose,raw_token=None):
    if not request.is_secure:raise Forbidden('HTTPS is required for Staff proof.')
    if request.headers.get('X-Staff-Device') not in (None,device.id):raise Forbidden('Staff device header mismatch.')
    try:
        public=json.loads(device.public_jwk)
        if public_jwk_thumbprint(public)!=device.thumbprint:raise Forbidden('Invalid stored device key.')
        payload=_decode_and_verify_jws(request.headers.get('DPoP'),public,'staff-device-proof+jwt')
    except (MiniDeviceSecurityError,ValueError,TypeError):raise Forbidden('Invalid Staff device proof.') from None
    challenge_id=_id(payload.get('challenge_id'))
    item=StaffDeviceChallenge.query.filter_by(id=challenge_id,device_id=device.id).populate_existing().with_for_update().first()
    now=auth.now_utc()
    target=request.path+('?' + request.query_string.decode('ascii') if request.query_string else '')
    origin=request.headers.get('Origin')
    if (not item or item.consumed_at or auth.aware(item.expires_at)<=now or item.auth_version!=user.staff_auth_version
            or item.purpose!=purpose or item.method!=request.method or item.target!=target
            or item.origin not in current_app.config.get('STAFF_TRUSTED_ORIGINS',())
            or (origin and origin!=item.origin)):
        raise Forbidden('Invalid or expired Staff device challenge.')
    nonce=payload.get('challenge');jti=payload.get('jti');iat=payload.get('iat')
    if (not isinstance(nonce,str) or len(nonce)>128 or not hmac.compare_digest(item.nonce_hash,auth.digest('device-nonce',nonce))
            or not isinstance(jti,str) or not 16<=len(jti)<=128 or type(iat) is not int
            or abs(int(now.timestamp())-iat)>60):raise Forbidden('Invalid Staff proof time/nonce.')
    expected={'device_id':device.id,'purpose':purpose,'htm':request.method,'htu':item.origin+target,
        'body_hash':hashlib.sha256(request.get_data(cache=True)).hexdigest(),'ath':access_token_hash(raw_token) if raw_token else None}
    if any(payload.get(key)!=value for key,value in expected.items()) or item.body_hash!=expected['body_hash'] or item.token_hash!=expected['ath']:
        raise Forbidden('Staff proof request mismatch.')
    item.consumed_at=now;item.proof_jti=jti
    try:db.session.flush()
    except IntegrityError:
        db.session.rollback();raise Forbidden('Staff proof replay rejected.') from None

    return item.id


def finalize(device_id):
    require_staff_identity_enabled();auth.require_origin();_id(device_id);auth.rate_limit('device-finalize',device_id,limit=10)
    user,device=_user_for(device_id)
    if device.state!='APPROVED' or device.enrollment_auth_version!=user.staff_auth_version:raise Conflict('Device is not approved.')
    active=StaffDevice.query.filter_by(employee_id=user.employee_id,state='ACTIVE').populate_existing().with_for_update().first()
    if (active.id if active else None)!=device.expected_active_id:raise Conflict('Active device changed; manager must review again.')
    _proof(user,device,'finalize')
    if active:
        active.state='REPLACED';active.revoked_by=device.approved_by;active.revoked_at=auth.now_utc();active.replaced_by_id=device.id
        StaffSession.query.filter_by(device_id=active.id,revoked_at=None).update({'revoked_at':auth.now_utc(),'revoked_reason':'device-replaced'})
        _audit(active,db.session.get(User,device.approved_by),'replaced','Approved personal device replacement')
        db.session.flush()  # Release the ACTIVE partial index before activating replacement.
    device.state='ACTIVE';device.activated_at=auth.now_utc();_audit(device,user,'finalized')
    try:db.session.commit()
    except IntegrityError:
        db.session.rollback();raise Conflict('An active personal device already exists.') from None
    return {'device_id':device.id,'state':device.state}


def verify_binding(user,session=None):
    require_staff_identity_enabled()
    if not user:raise Forbidden('Staff device required.')
    device=StaffDevice.query.filter_by(id=_id(request.headers.get('X-Staff-Device')),user_id=user.id,employee_id=user.employee_id).populate_existing().with_for_update().first()
    if not device or device.state!='ACTIVE':raise Forbidden('Active Staff device required.')
    if session is None:
        purpose='login';raw=None
    else:
        if session.device_id!=device.id:raise Forbidden('Session/device mismatch.')
        if request.path=='/api/staff/auth/refresh':purpose='refresh';raw=request.cookies.get(auth.REFRESH_COOKIE)
        elif request.path=='/api/staff/auth/logout':purpose='logout';raw=request.cookies.get(auth.REFRESH_COOKIE)
        else:purpose='request';raw=request.headers.get('Authorization','').split()[-1]
    g.staff_proof_challenge_id=_proof(user,device,purpose,raw)
    return device
