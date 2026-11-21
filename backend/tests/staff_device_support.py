"""Test-only P-256 helpers. Private keys exist in test memory, never runtime config."""
import base64
import hashlib
import json
import uuid
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from app.extensions import db
from app.models.staff_device import StaffDevice,StaffEnrollmentGrant,StaffDeviceChallenge,StaffDeviceAudit
from app.services import staff_auth_service as auth
from app.services.mini_device_proof_service import public_jwk_thumbprint


def tables():
    db.metadata.create_all(db.engine,tables=[StaffEnrollmentGrant.__table__,StaffDevice.__table__,StaffDeviceChallenge.__table__,StaffDeviceAudit.__table__])


def b64(raw):return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def key_pair():
    key=ec.generate_private_key(ec.SECP256R1());n=key.public_key().public_numbers()
    return key,{'kty':'EC','crv':'P-256','x':b64(n.x.to_bytes(32,'big')),'y':b64(n.y.to_bytes(32,'big'))}


def encoded(data):
    return json.dumps(data,sort_keys=True,separators=(',',':')).encode() if data is not None else b''


def sign(key,jwk,challenge,changes=None):
    header=b64(encoded({'typ':'staff-device-proof+jwt','alg':'ES256','jwk':jwk}))
    payload={k:v for k,v in challenge.items() if k!='expires_at'}
    payload.update(iat=int(auth.now_utc().timestamp()),jti=uuid.uuid4().hex)
    payload.update(changes or {})
    body=b64(encoded(payload));der=key.sign((header+'.'+body).encode(),ec.ECDSA(hashes.SHA256()));r,s=decode_dss_signature(der)
    return header+'.'+body+'.'+b64(r.to_bytes(32,'big')+s.to_bytes(32,'big'))


def fixture_active(user):
    key,jwk=key_pair()
    device=StaffDevice(id=uuid.uuid4().hex,user_id=user.id,employee_id=user.employee_id,state='ACTIVE',
        public_jwk=json.dumps(jwk),thumbprint=public_jwk_thumbprint(jwk),enrollment_auth_version=user.staff_auth_version,
        approved_by=user.id,approved_at=auth.now_utc(),activated_at=auth.now_utc())
    db.session.add(device);db.session.commit()
    return device.id,key,jwk


def proof_request(client,origin,binding,purpose,method,target,data=None,headers=None,changes=None):
    device_id,key,jwk=binding;raw=encoded(data)
    headers={'Origin':origin,**(headers or {})}
    challenge=client.post('/api/staff/auth/device-challenges',base_url=origin,json={
        'device_id':device_id,'purpose':purpose,'method':method,'target':target,'body_hash':hashlib.sha256(raw).hexdigest()},headers=headers)
    if challenge.status_code!=200:return challenge
    proof=sign(key,jwk,challenge.json,changes)
    return client.open(target,method=method,base_url=origin,data=raw,content_type='application/json',
        headers={**headers,'X-Staff-Device':device_id,'DPoP':proof})
