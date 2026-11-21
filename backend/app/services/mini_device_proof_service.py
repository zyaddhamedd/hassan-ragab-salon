from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
import secrets
import uuid
from typing import Optional
from urllib.parse import urlsplit, urlunsplit

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from flask import current_app
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.branch_device_enrollment import (
    BranchDeviceEnrollment,
    MiniDeviceEnrollmentStatus,
)
from app.models.branch_registered_device import (
    BranchRegisteredDevice,
    MiniDeviceProofState,
)
from app.models.mini_device_proof import (
    MiniDeviceProofChallenge,
    MiniDeviceProofChallengePurpose,
    MiniDeviceProofReplay,
)
from app.services.mini_device_service import (
    MiniDeviceAuthorizationError,
    MiniDeviceSecurityError,
    hash_enrollment_finalization_proof,
    verify_device_credential_digest,
)


PROOF_ALGORITHM = "ES256"
PROOF_CHALLENGE_ENTROPY_BYTES = 32
_PROOF_CHALLENGE_HASH_DOMAIN = b"mini-device-proof-challenge:v1:"
_MAX_PROOF_SIZE = 16_384


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    if not isinstance(value, str) or not value:
        raise ValueError("invalid base64url value")
    padding = "=" * (-len(value) % 4)
    return base64.b64decode(value + padding, altchars=b"-_", validate=True)


def _canonical_public_jwk(jwk: dict) -> dict:
    if not isinstance(jwk, dict):
        raise MiniDeviceSecurityError(
            error="DEVICE_PROOF_PUBLIC_KEY_INVALID",
            details="مفتاح إثبات الجهاز العام غير صالح.",
            status_code=400,
        )
    if jwk.get("kty") != "EC" or jwk.get("crv") != "P-256":
        raise MiniDeviceSecurityError(
            error="DEVICE_PROOF_ALGORITHM_INVALID",
            details="يجب استخدام مفتاح ECDSA P-256.",
            status_code=400,
        )
    if "d" in jwk:
        raise MiniDeviceSecurityError(
            error="DEVICE_PROOF_PRIVATE_KEY_REJECTED",
            details="لا يجوز إرسال المفتاح الخاص إلى الخادم.",
            status_code=400,
        )
    x = jwk.get("x")
    y = jwk.get("y")
    try:
        if len(_b64url_decode(x)) != 32 or len(_b64url_decode(y)) != 32:
            raise ValueError("P-256 coordinates must be 32 bytes")
    except (TypeError, ValueError):
        raise MiniDeviceSecurityError(
            error="DEVICE_PROOF_PUBLIC_KEY_INVALID",
            details="إحداثيات مفتاح إثبات الجهاز غير صالحة.",
            status_code=400,
        )
    return {"crv": "P-256", "kty": "EC", "x": x, "y": y}


def public_jwk_thumbprint(jwk: dict) -> str:
    canonical = _canonical_public_jwk(jwk)
    encoded = json.dumps(
        canonical,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")
    return _b64url_encode(hashlib.sha256(encoded).digest())


def access_token_hash(token: str) -> str:
    return _b64url_encode(hashlib.sha256(token.encode("ascii")).digest())


def _stored_public_jwk(device: BranchRegisteredDevice) -> dict:
    try:
        value = json.loads(device.proof_public_key_jwk or "")
    except (TypeError, ValueError, json.JSONDecodeError):
        raise MiniDeviceAuthorizationError(
            error="DEVICE_PROOF_KEY_INVALID",
            details="مفتاح إثبات الجهاز المسجل غير صالح ويجب إعادة ربط الجهاز.",
        )
    canonical = _canonical_public_jwk(value)
    if public_jwk_thumbprint(canonical) != device.proof_key_thumbprint:
        raise MiniDeviceAuthorizationError(
            error="DEVICE_PROOF_KEY_INVALID",
            details="بصمة مفتاح إثبات الجهاز لا تطابق السجل.",
        )
    return canonical


def _public_key(jwk: dict):
    canonical = _canonical_public_jwk(jwk)
    numbers = ec.EllipticCurvePublicNumbers(
        int.from_bytes(_b64url_decode(canonical["x"]), "big"),
        int.from_bytes(_b64url_decode(canonical["y"]), "big"),
        ec.SECP256R1(),
    )
    try:
        return numbers.public_key()
    except ValueError:
        raise MiniDeviceSecurityError(
            error="DEVICE_PROOF_PUBLIC_KEY_INVALID",
            details="مفتاح إثبات الجهاز ليس نقطة P-256 صالحة.",
            status_code=400,
        )


def _decode_and_verify_jws(proof: str, expected_jwk: dict, expected_typ: str) -> dict:
    if not isinstance(proof, str) or not proof or len(proof) > _MAX_PROOF_SIZE:
        raise MiniDeviceAuthorizationError(
            error="DEVICE_PROOF_MISSING",
            details="إثبات امتلاك مفتاح الجهاز مطلوب.",
        )
    parts = proof.split(".")
    if len(parts) != 3 or any(not part for part in parts):
        raise MiniDeviceAuthorizationError(
            error="DEVICE_PROOF_INVALID",
            details="صيغة إثبات الجهاز غير صالحة.",
        )
    try:
        header = json.loads(_b64url_decode(parts[0]))
        payload = json.loads(_b64url_decode(parts[1]))
        signature = _b64url_decode(parts[2])
    except (ValueError, TypeError, json.JSONDecodeError):
        raise MiniDeviceAuthorizationError(
            error="DEVICE_PROOF_INVALID",
            details="تعذر قراءة إثبات الجهاز.",
        )
    if not isinstance(header, dict) or not isinstance(payload, dict):
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_INVALID")
    if header.get("alg") != PROOF_ALGORITHM or header.get("typ") != expected_typ:
        raise MiniDeviceAuthorizationError(
            error="DEVICE_PROOF_ALGORITHM_INVALID",
            details="خوارزمية إثبات الجهاز غير مسموح بها.",
        )
    try:
        header_jwk = _canonical_public_jwk(header.get("jwk"))
        expected = _canonical_public_jwk(expected_jwk)
    except MiniDeviceSecurityError:
        raise MiniDeviceAuthorizationError(
            error="DEVICE_PROOF_PUBLIC_KEY_INVALID",
            details="المفتاح العام داخل إثبات الجهاز غير صالح.",
        )
    if not secrets.compare_digest(
        public_jwk_thumbprint(header_jwk),
        public_jwk_thumbprint(expected),
    ):
        raise MiniDeviceAuthorizationError(
            error="DEVICE_PROOF_KEY_MISMATCH",
            details="مفتاح توقيع الإثبات لا يطابق الجهاز المسجل.",
        )
    if len(signature) != 64:
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_SIGNATURE_INVALID")
    r = int.from_bytes(signature[:32], "big")
    s = int.from_bytes(signature[32:], "big")
    try:
        _public_key(expected).verify(
            encode_dss_signature(r, s),
            f"{parts[0]}.{parts[1]}".encode("ascii"),
            ec.ECDSA(hashes.SHA256()),
        )
    except InvalidSignature:
        raise MiniDeviceAuthorizationError(
            error="DEVICE_PROOF_SIGNATURE_INVALID",
            details="توقيع إثبات الجهاز غير صحيح.",
        )
    return payload


def _hash_challenge(nonce: str) -> str:
    return hashlib.sha256(
        _PROOF_CHALLENGE_HASH_DOMAIN + nonce.encode("utf-8")
    ).hexdigest()


def _trusted_origin(origin: Optional[str]) -> str:
    trusted = current_app.config.get("MINI_PROOF_TRUSTED_ORIGINS", ())
    if not origin or origin not in trusted:
        raise MiniDeviceAuthorizationError(
            error="DEVICE_PROOF_ORIGIN_INVALID",
            details="مصدر إثبات الجهاز غير موثوق.",
        )
    return origin


def _challenge_lifetime(purpose: MiniDeviceProofChallengePurpose) -> int:
    if purpose == MiniDeviceProofChallengePurpose.ENROLLMENT:
        return int(current_app.config.get("MINI_PROOF_FINALIZATION_TTL_SECONDS", 300))
    return int(current_app.config.get("MINI_PROOF_CHALLENGE_TTL_SECONDS", 120))


def _issue_challenge(
    device: BranchRegisteredDevice,
    purpose: MiniDeviceProofChallengePurpose,
    *,
    expected_origin: str,
    proof_key_thumbprint: Optional[str] = None,
    token_hash: Optional[str] = None,
) -> dict:
    now = _utc_now()
    MiniDeviceProofChallenge.query.filter(
        MiniDeviceProofChallenge.expires_at <= now - timedelta(days=1)
    ).delete(synchronize_session=False)
    nonce = secrets.token_urlsafe(PROOF_CHALLENGE_ENTROPY_BYTES)
    challenge = MiniDeviceProofChallenge(
        id=str(uuid.uuid4()),
        nonce_hash=_hash_challenge(nonce),
        purpose=purpose,
        branch_id=device.branch_id,
        registered_device_id=device.id,
        device_id=device.device_id,
        proof_key_thumbprint=proof_key_thumbprint or device.proof_key_thumbprint,
        proof_key_version=device.proof_key_version,
        expected_origin=expected_origin,
        token_hash=token_hash,
        issued_at=now,
        expires_at=now + timedelta(seconds=_challenge_lifetime(purpose)),
    )
    db.session.add(challenge)
    db.session.commit()
    return {
        "proof_required": True,
        "challenge_id": challenge.id,
        "challenge": nonce,
        "purpose": purpose.value,
        "branch_id": device.branch_id,
        "registered_device_id": device.id,
        "device_id": device.device_id,
        "proof_key_thumbprint": challenge.proof_key_thumbprint,
        "proof_key_version": challenge.proof_key_version,
        "origin": expected_origin,
        "issued_at": int(now.timestamp()),
        "expires_at": int((_coerce_utc(challenge.expires_at) or now).timestamp()),
        **({"ath": token_hash} if token_hash else {}),
    }


def create_enrollment_challenge(
    enrollment_id: int,
    *,
    device_id: str,
    finalization_proof: Optional[str],
    public_jwk: dict,
    origin: Optional[str],
) -> dict:
    expected_origin = _trusted_origin(origin)
    enrollment = (
        BranchDeviceEnrollment.query.filter_by(id=enrollment_id)
        .with_for_update()
        .one_or_none()
    )
    if not enrollment:
        raise MiniDeviceSecurityError(error="DEVICE_ENROLLMENT_NOT_FOUND", status_code=404)
    if enrollment.status != MiniDeviceEnrollmentStatus.APPROVED:
        raise MiniDeviceSecurityError(error="DEVICE_ENROLLMENT_NOT_APPROVED", status_code=409)
    if enrollment.finalization_consumed_at is not None:
        raise MiniDeviceSecurityError(error="DEVICE_FINALIZATION_ALREADY_CONSUMED", status_code=409)
    expires_at = _coerce_utc(enrollment.finalization_expires_at)
    if expires_at is None or expires_at <= _utc_now():
        raise MiniDeviceSecurityError(error="DEVICE_FINALIZATION_PROOF_EXPIRED", status_code=409)
    if enrollment.device_id != device_id:
        raise MiniDeviceAuthorizationError(error="DEVICE_FINALIZATION_DEVICE_MISMATCH")
    if not finalization_proof:
        raise MiniDeviceAuthorizationError(error="DEVICE_FINALIZATION_PROOF_MISSING")
    expected_finalization_hash = hash_enrollment_finalization_proof(
        enrollment.id,
        enrollment.branch_id,
        enrollment.device_id,
        finalization_proof,
    )
    if not enrollment.finalization_proof_hash or not secrets.compare_digest(
        enrollment.finalization_proof_hash,
        expected_finalization_hash,
    ):
        raise MiniDeviceAuthorizationError(error="DEVICE_FINALIZATION_PROOF_INVALID")
    device = db.session.get(BranchRegisteredDevice, enrollment.registered_device_id)
    if not device or not device.is_active or device.device_id != device_id:
        raise MiniDeviceAuthorizationError(error="DEVICE_NOT_AUTHORIZED")
    if device.proof_public_key_jwk:
        raise MiniDeviceSecurityError(error="DEVICE_PROOF_ALREADY_ENABLED", status_code=409)

    canonical_jwk = _canonical_public_jwk(public_jwk)
    _public_key(canonical_jwk)
    thumbprint = public_jwk_thumbprint(canonical_jwk)
    device.proof_key_required = True
    MiniDeviceProofChallenge.query.filter_by(
        registered_device_id=device.id,
        purpose=MiniDeviceProofChallengePurpose.ENROLLMENT,
        consumed_at=None,
    ).update({"consumed_at": _utc_now()}, synchronize_session=False)
    db.session.flush()
    return _issue_challenge(
        device,
        MiniDeviceProofChallengePurpose.ENROLLMENT,
        expected_origin=expected_origin,
        proof_key_thumbprint=thumbprint,
    )


def create_login_challenge(
    *,
    device_id: str,
    credential: Optional[str],
    origin: Optional[str],
) -> dict:
    candidates = BranchRegisteredDevice.query.filter_by(
        device_id=device_id,
        is_active=True,
    ).all()
    device = next(
        (
            candidate
            for candidate in candidates
            if candidate.credential_hash
            and credential
            and verify_device_credential_digest(candidate.credential_hash, credential)
        ),
        None,
    )
    if not device or device.proof_state != MiniDeviceProofState.PROOF_ENABLED:
        return {"proof_required": False}
    expected_origin = _trusted_origin(origin)
    return _issue_challenge(
        device,
        MiniDeviceProofChallengePurpose.LOGIN,
        expected_origin=expected_origin,
    )


def create_refresh_challenge(
    device: BranchRegisteredDevice,
    refresh_token: str,
    *,
    origin: Optional[str],
) -> dict:
    if not isinstance(device, BranchRegisteredDevice):
        return {"proof_required": False}
    if device.proof_state != MiniDeviceProofState.PROOF_ENABLED:
        return {"proof_required": False}
    expected_origin = _trusted_origin(origin)
    return _issue_challenge(
        device,
        MiniDeviceProofChallengePurpose.REFRESH,
        expected_origin=expected_origin,
        token_hash=access_token_hash(refresh_token),
    )


def verify_and_consume_challenge(
    *,
    challenge_id: str,
    challenge_nonce: str,
    proof: str,
    purpose: MiniDeviceProofChallengePurpose,
    device: BranchRegisteredDevice,
    origin: Optional[str],
    public_jwk: Optional[dict] = None,
    token: Optional[str] = None,
) -> dict:
    expected_origin = _trusted_origin(origin)
    challenge = (
        MiniDeviceProofChallenge.query.filter_by(id=challenge_id)
        .with_for_update()
        .one_or_none()
    )
    if not challenge or challenge.purpose != purpose:
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_CHALLENGE_INVALID")
    now = _utc_now()
    if challenge.consumed_at is not None:
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_CHALLENGE_REPLAYED")
    if (_coerce_utc(challenge.expires_at) or now) <= now:
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_CHALLENGE_EXPIRED")
    if not isinstance(challenge_nonce, str) or not challenge_nonce or not secrets.compare_digest(
        challenge.nonce_hash,
        _hash_challenge(challenge_nonce),
    ):
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_CHALLENGE_INVALID")
    if (
        challenge.branch_id != device.branch_id
        or challenge.registered_device_id != device.id
        or challenge.device_id != device.device_id
        or challenge.proof_key_version != device.proof_key_version
        or challenge.expected_origin != expected_origin
    ):
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_CHALLENGE_MISMATCH")

    expected_jwk = public_jwk if purpose == MiniDeviceProofChallengePurpose.ENROLLMENT else _stored_public_jwk(device)
    expected_thumbprint = public_jwk_thumbprint(expected_jwk)
    if not challenge.proof_key_thumbprint or not secrets.compare_digest(
        challenge.proof_key_thumbprint,
        expected_thumbprint,
    ):
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_KEY_MISMATCH")
    payload = _decode_and_verify_jws(proof, expected_jwk, "mini-device-proof+jwt")
    required_claims = {
        "challenge_id": challenge.id,
        "challenge": challenge_nonce,
        "purpose": purpose.value,
        "branch_id": device.branch_id,
        "registered_device_id": device.id,
        "device_id": device.device_id,
        "jkt": expected_thumbprint,
        "key_version": device.proof_key_version,
        "origin": expected_origin,
    }
    for name, expected in required_claims.items():
        if payload.get(name) != expected:
            raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_CLAIM_MISMATCH")
    try:
        iat = int(payload["iat"])
        exp = int(payload["exp"])
    except (KeyError, TypeError, ValueError):
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_TIME_INVALID")
    skew = int(current_app.config.get("MINI_PROOF_IAT_SKEW_SECONDS", 60))
    now_epoch = int(now.timestamp())
    challenge_expiry_epoch = int((_coerce_utc(challenge.expires_at) or now).timestamp())
    if abs(now_epoch - iat) > skew or exp < now_epoch or exp != challenge_expiry_epoch:
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_TIME_INVALID")
    if purpose == MiniDeviceProofChallengePurpose.REFRESH:
        expected_hash = access_token_hash(token or "")
        if not challenge.token_hash or not secrets.compare_digest(challenge.token_hash, expected_hash):
            raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_TOKEN_MISMATCH")
        if payload.get("ath") != expected_hash:
            raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_TOKEN_MISMATCH")

    consumed_at = _utc_now()
    claimed = MiniDeviceProofChallenge.query.filter(
        MiniDeviceProofChallenge.id == challenge.id,
        MiniDeviceProofChallenge.consumed_at.is_(None),
    ).update({"consumed_at": consumed_at}, synchronize_session=False)
    if claimed != 1:
        db.session.rollback()
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_CHALLENGE_REPLAYED")
    return {
        "public_jwk": _canonical_public_jwk(expected_jwk),
        "thumbprint": expected_thumbprint,
        "verified_at": consumed_at,
    }


def bind_enrollment_public_key(
    device: BranchRegisteredDevice,
    verification: dict,
) -> None:
    device.proof_public_key_jwk = json.dumps(
        verification["public_jwk"],
        sort_keys=True,
        separators=(",", ":"),
    )
    device.proof_key_thumbprint = verification["thumbprint"]
    device.proof_key_algorithm = PROOF_ALGORITHM
    device.proof_key_required = True
    device.proof_key_registered_at = verification["verified_at"]
    device.last_proof_verified_at = verification["verified_at"]


def verify_login_assertion(
    device: BranchRegisteredDevice,
    proof_payload: Optional[dict],
    *,
    origin: Optional[str],
) -> None:
    if device.proof_state == MiniDeviceProofState.PENDING_FINALIZATION:
        raise MiniDeviceAuthorizationError(
            error="DEVICE_PROOF_REPAIR_REQUIRED",
            details="مفتاح إثبات الجهاز مفقود. يجب أن تبدأ الإدارة إعادة الربط.",
        )
    if device.proof_state != MiniDeviceProofState.PROOF_ENABLED:
        return
    if not isinstance(proof_payload, dict):
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_REQUIRED")
    verification = verify_and_consume_challenge(
        challenge_id=proof_payload.get("challenge_id"),
        challenge_nonce=proof_payload.get("challenge"),
        proof=proof_payload.get("proof"),
        purpose=MiniDeviceProofChallengePurpose.LOGIN,
        device=device,
        origin=origin,
    )
    device.last_proof_verified_at = verification["verified_at"]
    db.session.commit()


def verify_refresh_assertion(
    device: BranchRegisteredDevice,
    proof_payload: Optional[dict],
    refresh_token: str,
    *,
    origin: Optional[str],
) -> None:
    if not isinstance(device, BranchRegisteredDevice):
        return
    if device.proof_state != MiniDeviceProofState.PROOF_ENABLED:
        return
    if not isinstance(proof_payload, dict):
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_REQUIRED")
    verification = verify_and_consume_challenge(
        challenge_id=proof_payload.get("challenge_id"),
        challenge_nonce=proof_payload.get("challenge"),
        proof=proof_payload.get("proof"),
        purpose=MiniDeviceProofChallengePurpose.REFRESH,
        device=device,
        origin=origin,
        token=refresh_token,
    )
    device.last_proof_verified_at = verification["verified_at"]
    db.session.commit()


def _canonical_request_uri_candidates(path: str) -> set[str]:
    bases = {
        str(base).rstrip("/")
        for base in current_app.config.get("MINI_PROOF_ALLOWED_API_BASE_URLS", ())
        if base
    }
    if current_app.config.get("TESTING"):
        bases.update(current_app.config.get("MINI_PROOF_TRUSTED_ORIGINS", ()))
    return {f"{base}{path}" for base in bases if base}


def _normalize_htu(value: str) -> str:
    if not isinstance(value, str):
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_URI_INVALID")
    try:
        parsed = urlsplit(value)
    except (TypeError, ValueError):
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_URI_INVALID")
    if parsed.scheme not in {"https", "http"} or not parsed.netloc or parsed.username or parsed.password:
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_URI_INVALID")
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path or "/", "", ""))


def enforce_request_proof(
    device: BranchRegisteredDevice,
    claims: dict,
    *,
    access_token: str,
    proof: Optional[str],
    method: str,
    path: str,
) -> None:
    cnf = claims.get("cnf")
    claim_key_version = claims.get("device_proof_key_version")
    if not isinstance(device, BranchRegisteredDevice):
        if cnf is not None or claim_key_version is not None:
            raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_SESSION_MISMATCH")
        return
    if device.proof_state != MiniDeviceProofState.PROOF_ENABLED:
        if cnf is not None or claim_key_version is not None:
            raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_SESSION_MISMATCH")
        if device.proof_key_required:
            raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_REPAIR_REQUIRED")
        return
    if device.proof_key_algorithm != PROOF_ALGORITHM:
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_ALGORITHM_INVALID")
    if not isinstance(cnf, dict) or cnf.get("jkt") != device.proof_key_thumbprint:
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_SESSION_MISMATCH")
    if claim_key_version != device.proof_key_version:
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_KEY_VERSION_INVALID")

    expected_jwk = _stored_public_jwk(device)
    payload = _decode_and_verify_jws(proof, expected_jwk, "dpop+jwt")
    jti = payload.get("jti")
    if not isinstance(jti, str) or not 16 <= len(jti) <= 128:
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_JTI_INVALID")
    if payload.get("htm") != method.upper():
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_METHOD_MISMATCH")
    htu = _normalize_htu(payload.get("htu"))
    if htu not in _canonical_request_uri_candidates(path):
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_URI_MISMATCH")
    expected_ath = access_token_hash(access_token)
    if payload.get("ath") != expected_ath:
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_TOKEN_MISMATCH")
    try:
        iat = int(payload["iat"])
    except (KeyError, TypeError, ValueError):
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_TIME_INVALID")
    now = _utc_now()
    skew = int(current_app.config.get("MINI_PROOF_IAT_SKEW_SECONDS", 60))
    if abs(int(now.timestamp()) - iat) > skew:
        raise MiniDeviceAuthorizationError(error="DEVICE_PROOF_TIME_INVALID")

    replay_ttl = int(current_app.config.get("MINI_PROOF_REPLAY_TTL_SECONDS", 180))
    MiniDeviceProofReplay.query.filter(
        MiniDeviceProofReplay.expires_at <= now
    ).delete(synchronize_session=False)
    db.session.add(MiniDeviceProofReplay(
        proof_key_thumbprint=device.proof_key_thumbprint,
        jti=jti,
        created_at=now,
        expires_at=now + timedelta(seconds=replay_ttl),
    ))
    device.last_proof_verified_at = now
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        raise MiniDeviceAuthorizationError(
            error="DEVICE_PROOF_REPLAYED",
            details="تم استخدام إثبات الطلب من قبل.",
        )
