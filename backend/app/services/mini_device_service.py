from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from typing import Iterable, Optional, Union

from flask import current_app, has_app_context, has_request_context, request
from sqlalchemy import inspect
from sqlalchemy.exc import OperationalError, ProgrammingError

from app.extensions import db
from app.models.branch import Branch
from app.models.branch_device_enrollment import (
    BranchDeviceEnrollment,
    MiniDeviceEnrollmentStatus,
)
from app.models.branch_registered_device import (
    BranchRegisteredDevice,
    MiniAccessMode,
    MiniDeviceCredentialState,
    MiniDeviceProofState,
    MiniDeviceType,
)


MAX_ACTIVE_MINI_DEVICES_PER_BRANCH = 2
PAIRING_CODE_TTL_MINUTES = 15
DEFAULT_DEVICE_REPAIR_TTL_MINUTES = 15
DEVICE_CREDENTIAL_ENTROPY_BYTES = 32
DEVICE_CREDENTIAL_HASH_PREFIX = "sha256$"
_DEVICE_CREDENTIAL_HASH_DOMAIN = b"mini-device-credential:v1:"
ENROLLMENT_FINALIZATION_PROOF_ENTROPY_BYTES = 32
ENROLLMENT_FINALIZATION_PROOF_HASH_PREFIX = "sha256$"
_ENROLLMENT_FINALIZATION_PROOF_HASH_DOMAIN = b"mini-device-finalization:v1:"
_MAX_CREDENTIAL_VERSION = 2_147_483_647

_REGISTERED_DEVICE_TABLE_AVAILABLE: Optional[bool] = None
_DEVICE_ENROLLMENT_TABLE_AVAILABLE: Optional[bool] = None

INVENTORY_ONLY_ALLOWED_MINI_ENDPOINTS = {
    "mini.get_me",
    "mini.get_branch_inventory",
    "mini.get_branch_inventory_summary",
    "mini.get_product_activity_log",
    "mini.get_mini_product_details",
    "mini.search_mini_products",
    "mini.list_incoming_shipments",
    "mini.get_incoming_shipment",
    "mini.receive_incoming_shipment",
    "mini.consume_mini_product",
    "mini.create_supply_request",
    "mini.list_supply_requests",
    "mini.get_supply_request",
    "mini.create_return_request",
    "mini.list_return_requests",
    "mini.get_return_request",
    "mini.get_shipment_history",
    "mini.request_device_credential_upgrade",
}

_PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_ALLOWED_APPROVAL_PROFILES = {
    (MiniDeviceType.DESKTOP, MiniAccessMode.FULL_MINI),
    (MiniDeviceType.MOBILE, MiniAccessMode.INVENTORY_ONLY),
}


class MiniDeviceSecurityError(Exception):
    def __init__(
        self,
        *,
        error: str,
        details: Optional[str] = None,
        status_code: int = 400,
        payload: Optional[dict] = None,
    ) -> None:
        super().__init__(details or error)
        self.error = error
        self.details = details
        self.status_code = status_code
        self.payload = payload or {}


class MiniDeviceAuthorizationError(MiniDeviceSecurityError):
    def __init__(
        self,
        *,
        error: str = "DEVICE_NOT_AUTHORIZED",
        details: Optional[str] = None,
        status_code: int = 403,
        payload: Optional[dict] = None,
        finalization_proof: Optional[str] = None,
    ) -> None:
        super().__init__(
            error=error,
            details=details,
            status_code=status_code,
            payload=payload,
        )
        # Transient server-side transport only. This value is intentionally
        # excluded from payloads, reprs, logs, and Admin serializers.
        self.finalization_proof = finalization_proof


class MiniDeviceCredentialError(MiniDeviceAuthorizationError):
    pass


@dataclass
class ResolvedMiniDevice:
    id: Optional[int]
    device_id: str
    device_label: Optional[str]
    device_type: MiniDeviceType
    access_mode: MiniAccessMode
    is_active: bool
    last_seen_at: Optional[datetime]


@dataclass
class PendingMiniDeviceEnrollmentChallenge:
    enrollment_id: int
    pairing_code: str
    expires_at: datetime
    limit_reached: bool
    finalization_proof: str = field(repr=False)


@dataclass(frozen=True)
class IssuedMiniDeviceCredential:
    credential: str = field(repr=False)
    credential_version: int
    issued_at: datetime


@dataclass(frozen=True)
class VerifiedMiniDeviceCredential:
    device: BranchRegisteredDevice
    credential_version: int
    state: MiniDeviceCredentialState


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def generate_device_credential() -> str:
    """Return a URL-safe credential backed by 256 bits of OS randomness."""
    return secrets.token_urlsafe(DEVICE_CREDENTIAL_ENTROPY_BYTES)


def hash_device_credential(credential: str) -> str:
    """Create the versioned one-way digest persisted for a device credential."""
    if not isinstance(credential, str) or not credential:
        raise MiniDeviceCredentialError(
            error="DEVICE_CREDENTIAL_MISSING",
            details="A non-empty device credential is required.",
        )

    digest = hashlib.sha256(
        _DEVICE_CREDENTIAL_HASH_DOMAIN + credential.encode("utf-8")
    ).hexdigest()
    return f"{DEVICE_CREDENTIAL_HASH_PREFIX}{digest}"


def generate_enrollment_finalization_proof() -> str:
    return secrets.token_urlsafe(ENROLLMENT_FINALIZATION_PROOF_ENTROPY_BYTES)


def hash_enrollment_finalization_proof(
    enrollment_id: int,
    branch_id: int,
    device_id: str,
    proof: str,
) -> str:
    if not proof:
        raise MiniDeviceAuthorizationError(
            error="DEVICE_FINALIZATION_PROOF_MISSING",
            details="Enrollment finalization proof is required.",
        )
    scoped_value = f"{enrollment_id}:{branch_id}:{device_id}:{proof}".encode("utf-8")
    digest = hashlib.sha256(
        _ENROLLMENT_FINALIZATION_PROOF_HASH_DOMAIN + scoped_value
    ).hexdigest()
    return f"{ENROLLMENT_FINALIZATION_PROOF_HASH_PREFIX}{digest}"


def verify_device_credential_digest(stored_hash: str, credential: str) -> bool:
    """Compare a supplied credential with a stored digest in constant time."""
    if not stored_hash or not isinstance(credential, str) or not credential:
        return False
    if not stored_hash.startswith(DEVICE_CREDENTIAL_HASH_PREFIX):
        return False

    candidate_hash = hash_device_credential(credential)
    return secrets.compare_digest(stored_hash, candidate_hash)


def get_device_credential_state(
    device: BranchRegisteredDevice,
) -> MiniDeviceCredentialState:
    return device.credential_state


def increment_device_credential_version(current_version: Optional[int]) -> int:
    version = current_version if isinstance(current_version, int) else 1
    if version < 1 or version >= _MAX_CREDENTIAL_VERSION:
        raise MiniDeviceCredentialError(
            error="DEVICE_CREDENTIAL_VERSION_INVALID",
            details="The device credential version cannot be incremented safely.",
            status_code=409,
        )
    return version + 1


def increment_device_proof_key_version(current_version: Optional[int]) -> int:
    version = current_version if isinstance(current_version, int) else 1
    if version < 1 or version >= _MAX_CREDENTIAL_VERSION:
        raise MiniDeviceCredentialError(
            error="DEVICE_PROOF_KEY_VERSION_INVALID",
            details="The device proof-key version cannot be incremented safely.",
            status_code=409,
        )
    return version + 1


def invalidate_registered_device_proof_key(
    device: BranchRegisteredDevice,
    *,
    invalidated_at: Optional[datetime] = None,
    require_repair: bool = True,
) -> None:
    """Remove the public proof key and invalidate all key-bound sessions."""
    device.proof_public_key_jwk = None
    device.proof_key_thumbprint = None
    device.proof_key_algorithm = None
    device.proof_key_version = increment_device_proof_key_version(
        device.proof_key_version
    )
    device.proof_key_required = require_repair
    device.proof_key_rotated_at = invalidated_at or _utc_now()
    device.proof_key_registered_at = None
    device.last_proof_verified_at = None


def issue_registered_device_credential(
    device: BranchRegisteredDevice,
    *,
    commit: bool = False,
    issued_at: Optional[datetime] = None,
) -> IssuedMiniDeviceCredential:
    """Issue an initial credential without ever persisting the raw value."""
    if not device.is_active:
        raise MiniDeviceCredentialError(
            error="DEVICE_CREDENTIAL_REVOKED",
            details="Cannot issue a credential for an inactive device.",
        )
    if device.credential_hash:
        raise MiniDeviceCredentialError(
            error="DEVICE_CREDENTIAL_ALREADY_ENABLED",
            details="This device already has a credential; rotate it instead.",
            status_code=409,
        )

    now = issued_at or _utc_now()
    raw_credential = generate_device_credential()
    device.credential_hash = hash_device_credential(raw_credential)
    device.credential_required = True
    device.credential_version = max(1, device.credential_version or 1)
    device.credential_issued_at = now
    device.credential_rotated_at = None
    if commit:
        db.session.commit()

    return IssuedMiniDeviceCredential(
        credential=raw_credential,
        credential_version=device.credential_version,
        issued_at=now,
    )


def rotate_registered_device_credential(
    device: BranchRegisteredDevice,
    *,
    commit: bool = False,
    rotated_at: Optional[datetime] = None,
) -> IssuedMiniDeviceCredential:
    """Replace a credential digest and invalidate its previous version."""
    if not device.is_active:
        raise MiniDeviceCredentialError(
            error="DEVICE_CREDENTIAL_REVOKED",
            details="Cannot rotate a credential for an inactive device.",
        )
    if not device.credential_hash:
        raise MiniDeviceCredentialError(
            error="DEVICE_CREDENTIAL_MISSING",
            details="This legacy device does not have a credential to rotate.",
            status_code=409,
            payload={"credential_state": MiniDeviceCredentialState.LEGACY.value},
        )

    now = rotated_at or _utc_now()
    raw_credential = generate_device_credential()
    device.credential_hash = hash_device_credential(raw_credential)
    device.credential_version = increment_device_credential_version(
        device.credential_version
    )
    device.credential_issued_at = now
    device.credential_rotated_at = now
    if commit:
        db.session.commit()

    return IssuedMiniDeviceCredential(
        credential=raw_credential,
        credential_version=device.credential_version,
        issued_at=now,
    )


def invalidate_registered_device_credential(
    device: BranchRegisteredDevice,
    *,
    invalidated_at: Optional[datetime] = None,
) -> None:
    """Remove any usable digest when a registered device is revoked."""
    if not device.credential_hash:
        return
    device.credential_hash = None
    device.credential_version = increment_device_credential_version(
        device.credential_version
    )
    device.credential_rotated_at = invalidated_at or _utc_now()


def verify_registered_device_credential(
    device: Optional[BranchRegisteredDevice],
    credential: Optional[str],
    *,
    expected_branch_id: Optional[int] = None,
    expected_device_id: Optional[str] = None,
    expected_credential_version: Optional[int] = None,
) -> VerifiedMiniDeviceCredential:
    """Verify ownership proof for one exact registered-device row."""
    if device is None:
        raise MiniDeviceCredentialError(
            error="DEVICE_CREDENTIAL_MISMATCH",
            details="No matching registered device exists.",
        )
    if (
        expected_branch_id is not None
        and device.branch_id != expected_branch_id
    ) or (
        expected_device_id is not None
        and device.device_id != expected_device_id
    ):
        raise MiniDeviceCredentialError(
            error="DEVICE_CREDENTIAL_MISMATCH",
            details="The credential does not belong to the requested device.",
        )
    if not device.is_active:
        raise MiniDeviceCredentialError(
            error="DEVICE_CREDENTIAL_REVOKED",
            details="The registered device is inactive or revoked.",
            payload={"credential_state": MiniDeviceCredentialState.REVOKED.value},
        )
    if not device.credential_hash:
        raise MiniDeviceCredentialError(
            error="DEVICE_CREDENTIAL_MISSING",
            details="This legacy device has not been issued a credential yet.",
            payload={"credential_state": MiniDeviceCredentialState.LEGACY.value},
        )
    if not isinstance(device.credential_version, int) or device.credential_version < 1:
        raise MiniDeviceCredentialError(
            error="DEVICE_CREDENTIAL_VERSION_INVALID",
            details="The stored device credential version is invalid.",
        )
    if (
        expected_credential_version is not None
        and device.credential_version != expected_credential_version
    ):
        raise MiniDeviceCredentialError(
            error="DEVICE_CREDENTIAL_MISMATCH",
            details="The device credential version does not match.",
        )
    if not credential:
        raise MiniDeviceCredentialError(
            error="DEVICE_CREDENTIAL_MISSING",
            details="A device credential is required.",
        )
    if not verify_device_credential_digest(device.credential_hash, credential):
        raise MiniDeviceCredentialError(
            error="DEVICE_CREDENTIAL_INVALID",
            details="The device credential is invalid.",
        )

    return VerifiedMiniDeviceCredential(
        device=device,
        credential_version=device.credential_version,
        state=MiniDeviceCredentialState.CREDENTIAL_ENABLED,
    )


def resolve_and_verify_registered_device_credential(
    branch_id: int,
    device_id: str,
    credential: Optional[str],
    *,
    expected_credential_version: Optional[int] = None,
) -> VerifiedMiniDeviceCredential:
    device = get_registered_device(branch_id, device_id)
    return verify_registered_device_credential(
        device,
        credential,
        expected_branch_id=branch_id,
        expected_device_id=device_id,
        expected_credential_version=expected_credential_version,
    )


def build_mini_device_jwt_claims(
    device: Union[BranchRegisteredDevice, ResolvedMiniDevice, None],
    *,
    credential_verified: bool = False,
) -> dict:
    """Return optional binding claims only after credential verification."""
    if not credential_verified:
        return {}
    if not isinstance(device, BranchRegisteredDevice):
        return {}
    if device.id is None or device.credential_state != MiniDeviceCredentialState.CREDENTIAL_ENABLED:
        return {}
    claims = {
        "registered_device_id": device.id,
        "device_credential_version": device.credential_version,
    }
    if device.proof_state == MiniDeviceProofState.PROOF_ENABLED:
        claims.update({
            "cnf": {"jkt": device.proof_key_thumbprint},
            "device_proof_key_version": device.proof_key_version,
        })
    return claims


def _request_ip() -> Optional[str]:
    if not has_request_context():
        return None
    return request.remote_addr


def _request_user_agent() -> Optional[str]:
    if not has_request_context():
        return None
    if request.user_agent:
        return request.user_agent.string or None
    return None


def _mark_registered_device_table_unavailable() -> None:
    global _REGISTERED_DEVICE_TABLE_AVAILABLE
    _REGISTERED_DEVICE_TABLE_AVAILABLE = False


def _mark_device_enrollment_table_unavailable() -> None:
    global _DEVICE_ENROLLMENT_TABLE_AVAILABLE
    _DEVICE_ENROLLMENT_TABLE_AVAILABLE = False


def _table_presence(model) -> Optional[bool]:
    try:
        return inspect(db.engine).has_table(model.__tablename__)
    except Exception:
        return None


def _has_table(model) -> bool:
    return _table_presence(model) is True


def registered_device_table_available() -> bool:
    global _REGISTERED_DEVICE_TABLE_AVAILABLE

    if _REGISTERED_DEVICE_TABLE_AVAILABLE is None:
        _REGISTERED_DEVICE_TABLE_AVAILABLE = _has_table(BranchRegisteredDevice)

    return _REGISTERED_DEVICE_TABLE_AVAILABLE


def device_enrollment_table_available() -> bool:
    global _DEVICE_ENROLLMENT_TABLE_AVAILABLE

    if _DEVICE_ENROLLMENT_TABLE_AVAILABLE is None:
        _DEVICE_ENROLLMENT_TABLE_AVAILABLE = _has_table(BranchDeviceEnrollment)

    return _DEVICE_ENROLLMENT_TABLE_AVAILABLE


def _safe_query(
    available: bool,
    mark_unavailable,
    query_fn,
    fallback,
):
    if not available:
        return fallback

    try:
        return query_fn()
    except (ProgrammingError, OperationalError):
        db.session.rollback()
        mark_unavailable()
        return fallback


def _safe_registered_device_query(query_fn, fallback):
    return _safe_query(
        registered_device_table_available(),
        _mark_registered_device_table_unavailable,
        query_fn,
        fallback,
    )


def _safe_device_enrollment_query(query_fn, fallback):
    return _safe_query(
        device_enrollment_table_available(),
        _mark_device_enrollment_table_unavailable,
        query_fn,
        fallback,
    )


def _default_device_label(device_type: MiniDeviceType) -> str:
    if device_type == MiniDeviceType.MOBILE:
        return "Mini Mobile Device"
    if device_type == MiniDeviceType.TABLET:
        return "Mini Tablet Device"
    return "Mini Desktop Device"


def _generate_pairing_code() -> str:
    raw = "".join(secrets.choice(_PAIRING_CODE_ALPHABET) for _ in range(6))
    return f"{raw[:4]}-{raw[4:]}"


def _hash_pairing_code(branch_id: int, device_id: str, pairing_code: str) -> str:
    token = f"{branch_id}:{device_id}:{pairing_code}".encode("utf-8")
    return hashlib.sha256(token).hexdigest()


def _pairing_expiry(now: Optional[datetime] = None) -> datetime:
    return (now or _utc_now()) + timedelta(minutes=PAIRING_CODE_TTL_MINUTES)


def _repair_expiry(now: Optional[datetime] = None) -> datetime:
    ttl_minutes = DEFAULT_DEVICE_REPAIR_TTL_MINUTES
    if has_app_context():
        ttl_minutes = current_app.config.get(
            "MINI_DEVICE_REPAIR_TTL_MINUTES",
            DEFAULT_DEVICE_REPAIR_TTL_MINUTES,
        )
    return (now or _utc_now()) + timedelta(minutes=ttl_minutes)


def legacy_device_compatibility_enabled() -> bool:
    if not has_app_context():
        return True
    return bool(
        current_app.config.get(
            "MINI_LEGACY_DEVICE_COMPATIBILITY_ENABLED",
            True,
        )
    )


def _legacy_table_fallback_allowed() -> bool:
    """Allow pre-table compatibility only when explicitly enabled.

    If the table exists but queries fail (schema drift/database error), fail
    closed instead of treating secure rows as legacy ID-only devices.
    """
    return (
        legacy_device_compatibility_enabled()
        and _table_presence(BranchRegisteredDevice) is False
    )


def _coerce_utc_datetime(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _ua_contains(user_agent: Optional[str], needle: str) -> bool:
    return bool(user_agent and needle.lower() in user_agent.lower())


def suggest_device_type_from_user_agent(user_agent: Optional[str]) -> MiniDeviceType:
    if _ua_contains(user_agent, "iphone") or _ua_contains(user_agent, "android"):
        return MiniDeviceType.MOBILE
    if _ua_contains(user_agent, "ipad") or _ua_contains(user_agent, "tablet"):
        return MiniDeviceType.TABLET
    return MiniDeviceType.DESKTOP


def summarize_device_user_agent(user_agent: Optional[str]) -> str:
    if not user_agent:
        return "Unknown Device"

    os_name = "Unknown OS"
    browser_name = "Unknown Browser"

    if _ua_contains(user_agent, "iphone") or _ua_contains(user_agent, "ipad"):
        os_name = "iOS"
    elif _ua_contains(user_agent, "android"):
        os_name = "Android"
    elif _ua_contains(user_agent, "windows"):
        os_name = "Windows"
    elif _ua_contains(user_agent, "mac os") or _ua_contains(user_agent, "macintosh"):
        os_name = "macOS"
    elif _ua_contains(user_agent, "linux"):
        os_name = "Linux"

    if _ua_contains(user_agent, "edg"):
        browser_name = "Edge"
    elif _ua_contains(user_agent, "crios") or (
        _ua_contains(user_agent, "chrome") and not _ua_contains(user_agent, "edg")
    ):
        browser_name = "Chrome"
    elif _ua_contains(user_agent, "fxios") or _ua_contains(user_agent, "firefox"):
        browser_name = "Firefox"
    elif _ua_contains(user_agent, "safari") and not _ua_contains(user_agent, "chrome"):
        browser_name = "Safari"

    return f"{os_name} / {browser_name}"


def _validate_approval_profile(
    device_type: MiniDeviceType,
    access_mode: MiniAccessMode,
) -> None:
    if (device_type, access_mode) not in _ALLOWED_APPROVAL_PROFILES:
        raise MiniDeviceSecurityError(
            error="INVALID_DEVICE_PROFILE",
            details="نوع وصلاحية الجهاز غير مسموح بهما في هذه المرحلة.",
            status_code=400,
        )


def count_active_registered_devices(branch_id: int) -> int:
    return _safe_registered_device_query(
        lambda: (
            BranchRegisteredDevice.query.filter_by(
                branch_id=branch_id,
                is_active=True,
            ).count()
        ),
        0,
    )


def count_registered_devices(branch_id: int) -> int:
    return _safe_registered_device_query(
        lambda: BranchRegisteredDevice.query.filter_by(branch_id=branch_id).count(),
        0,
    )


def list_registered_devices(branch_id: int) -> list[BranchRegisteredDevice]:
    return _safe_registered_device_query(
        lambda: (
            BranchRegisteredDevice.query.filter_by(branch_id=branch_id)
            .order_by(
                BranchRegisteredDevice.is_active.desc(),
                BranchRegisteredDevice.created_at.asc(),
            )
            .all()
        ),
        [],
    )


def get_registered_device(
    branch_id: int,
    device_id: str,
) -> Optional[BranchRegisteredDevice]:
    return _safe_registered_device_query(
        lambda: (
            BranchRegisteredDevice.query.filter_by(
                branch_id=branch_id,
                device_id=device_id,
            ).first()
        ),
        None,
    )


def get_registered_device_by_id(
    branch_id: int,
    registered_device_id: int,
) -> Optional[BranchRegisteredDevice]:
    return _safe_registered_device_query(
        lambda: (
            BranchRegisteredDevice.query.filter_by(
                branch_id=branch_id,
                id=registered_device_id,
            ).first()
        ),
        None,
    )


def get_active_registered_device(
    branch_id: int,
    device_id: str,
) -> Optional[BranchRegisteredDevice]:
    return _safe_registered_device_query(
        lambda: (
            BranchRegisteredDevice.query.filter_by(
                branch_id=branch_id,
                device_id=device_id,
                is_active=True,
            ).first()
        ),
        None,
    )


def ensure_branch_can_activate_additional_device(
    branch_id: int,
    *,
    device_id: Optional[str] = None,
) -> None:
    active_count = count_active_registered_devices(branch_id)
    if device_id:
        existing = get_active_registered_device(branch_id, device_id)
        if existing:
            return

    if active_count >= MAX_ACTIVE_MINI_DEVICES_PER_BRANCH:
        raise MiniDeviceSecurityError(
            error="MAX_ACTIVE_MINI_DEVICES_REACHED",
            details="تم الوصول إلى الحد الأقصى للأجهزة المفعلة لهذا الفرع.",
            status_code=409,
        )


def touch_registered_device(
    device: Union[BranchRegisteredDevice, ResolvedMiniDevice],
    *,
    commit: bool = False,
    seen_at: Optional[datetime] = None,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Union[BranchRegisteredDevice, ResolvedMiniDevice]:
    if isinstance(device, ResolvedMiniDevice):
        device.last_seen_at = seen_at or _utc_now()
        return device

    device.last_seen_at = seen_at or _utc_now()
    device.last_seen_ip = ip if ip is not None else _request_ip()
    device.last_seen_user_agent = (
        user_agent if user_agent is not None else _request_user_agent()
    )
    if commit:
        db.session.commit()
    return device


def activate_or_create_registered_device(
    *,
    branch: Branch,
    device_id: str,
    device_type: MiniDeviceType,
    access_mode: MiniAccessMode,
    created_by_user_id: Optional[int] = None,
    device_label: Optional[str] = None,
    sync_legacy_branch_binding: bool = False,
    last_seen_at: Optional[datetime] = None,
    last_seen_ip: Optional[str] = None,
    last_seen_user_agent: Optional[str] = None,
    credential_required: bool = False,
    proof_key_required: bool = False,
    commit: bool = True,
) -> Union[BranchRegisteredDevice, ResolvedMiniDevice]:
    if not registered_device_table_available():
        legacy_device = ResolvedMiniDevice(
            id=None,
            device_id=device_id,
            device_label=device_label or _default_device_label(device_type),
            device_type=device_type,
            access_mode=access_mode,
            is_active=True,
            last_seen_at=last_seen_at or _utc_now(),
        )
        if sync_legacy_branch_binding:
            sync_branch_legacy_binding(
                branch,
                device_id,
                seen_at=legacy_device.last_seen_at,
                ip=last_seen_ip if last_seen_ip is not None else _request_ip(),
                user_agent=(
                    last_seen_user_agent
                    if last_seen_user_agent is not None
                    else _request_user_agent()
                ),
            )
            if commit:
                db.session.commit()
        return legacy_device

    existing = get_registered_device(branch.id, device_id)
    if existing and not existing.is_active:
        ensure_branch_can_activate_additional_device(branch.id, device_id=device_id)
        invalidate_registered_device_credential(existing)
        require_proof_after_reactivation = bool(
            existing.proof_key_required
            or existing.proof_public_key_jwk
            or proof_key_required
        )
        invalidate_registered_device_proof_key(
            existing,
            require_repair=require_proof_after_reactivation,
        )
        existing.is_active = True
        existing.revoked_at = None
        existing.revoked_by_user_id = None
        existing.device_type = device_type
        existing.access_mode = access_mode
        existing.credential_required = bool(
            existing.credential_required or credential_required
        )
        existing.proof_key_required = bool(
            existing.proof_key_required or proof_key_required
        )
        if device_label:
            existing.device_label = device_label
        if created_by_user_id and existing.created_by_user_id is None:
            existing.created_by_user_id = created_by_user_id
        touch_registered_device(
            existing,
            seen_at=last_seen_at,
            ip=last_seen_ip,
            user_agent=last_seen_user_agent,
        )
        if sync_legacy_branch_binding:
            sync_branch_legacy_binding(
                branch,
                device_id,
                seen_at=existing.last_seen_at,
                ip=existing.last_seen_ip,
                user_agent=existing.last_seen_user_agent,
            )
        if commit:
            db.session.commit()
        return existing

    if existing and existing.is_active:
        existing.device_type = device_type
        existing.access_mode = access_mode
        existing.credential_required = bool(
            existing.credential_required or credential_required
        )
        existing.proof_key_required = bool(
            existing.proof_key_required or proof_key_required
        )
        if device_label:
            existing.device_label = device_label
        touch_registered_device(
            existing,
            seen_at=last_seen_at,
            ip=last_seen_ip,
            user_agent=last_seen_user_agent,
        )
        if sync_legacy_branch_binding:
            sync_branch_legacy_binding(
                branch,
                device_id,
                seen_at=existing.last_seen_at,
                ip=existing.last_seen_ip,
                user_agent=existing.last_seen_user_agent,
            )
        if commit:
            db.session.commit()
        return existing

    ensure_branch_can_activate_additional_device(branch.id, device_id=device_id)

    device = BranchRegisteredDevice(
        branch_id=branch.id,
        device_id=device_id,
        device_label=device_label or _default_device_label(device_type),
        device_type=device_type,
        access_mode=access_mode,
        is_active=True,
        created_by_user_id=created_by_user_id,
        credential_required=credential_required,
        proof_key_required=proof_key_required,
    )
    db.session.add(device)
    db.session.flush()
    touch_registered_device(
        device,
        seen_at=last_seen_at,
        ip=last_seen_ip,
        user_agent=last_seen_user_agent,
    )
    if sync_legacy_branch_binding:
        sync_branch_legacy_binding(
            branch,
            device_id,
            seen_at=device.last_seen_at,
            ip=device.last_seen_ip,
            user_agent=device.last_seen_user_agent,
        )
    if commit:
        db.session.commit()
    return device


def sync_branch_legacy_binding(
    branch: Branch,
    device_id: Optional[str],
    *,
    seen_at: Optional[datetime] = None,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    branch.authorized_device_id = device_id
    branch.binding_timestamp = seen_at
    branch.binding_ip = ip
    branch.binding_user_agent = user_agent


def revoke_branch_registered_devices(
    branch: Branch,
    *,
    revoked_by_user_id: Optional[int] = None,
    device_ids: Optional[Iterable[str]] = None,
    clear_legacy_binding: bool = True,
) -> int:
    if not registered_device_table_available():
        if clear_legacy_binding:
            sync_branch_legacy_binding(
                branch,
                None,
                seen_at=None,
                ip=None,
                user_agent=None,
            )
            db.session.commit()
        return 0

    now = _utc_now()
    query = BranchRegisteredDevice.query.filter_by(branch_id=branch.id, is_active=True)
    if device_ids is not None:
        query = query.filter(BranchRegisteredDevice.device_id.in_(list(device_ids)))

    devices = _safe_registered_device_query(query.all, [])
    for device in devices:
        invalidate_registered_device_credential(device, invalidated_at=now)
        require_proof_after_revocation = bool(
            device.proof_key_required
            or device.proof_public_key_jwk
            or current_app.config.get("MINI_PROOF_ENROLLMENT_REQUIRED", True)
        )
        invalidate_registered_device_proof_key(
            device,
            invalidated_at=now,
            require_repair=require_proof_after_revocation,
        )
        device.is_active = False
        device.revoked_at = now
        device.revoked_by_user_id = revoked_by_user_id

    if clear_legacy_binding:
        sync_branch_legacy_binding(branch, None, seen_at=None, ip=None, user_agent=None)

    db.session.commit()
    return len(devices)


def revoke_registered_device(
    branch: Branch,
    registered_device_id: int,
    *,
    revoked_by_user_id: Optional[int] = None,
) -> BranchRegisteredDevice:
    device = get_registered_device_by_id(branch.id, registered_device_id)
    if not device:
        raise MiniDeviceSecurityError(
            error="REGISTERED_DEVICE_NOT_FOUND",
            details="الجهاز المطلوب غير موجود لهذا الفرع.",
            status_code=404,
        )

    if not device.is_active:
        changed = False
        if device.credential_hash:
            invalidate_registered_device_credential(device)
            changed = True
        if device.proof_public_key_jwk or device.proof_key_thumbprint:
            invalidate_registered_device_proof_key(device, require_repair=True)
            changed = True
        if changed:
            db.session.commit()
        return device

    invalidate_registered_device_credential(device)
    require_proof_after_revocation = bool(
        device.proof_key_required
        or device.proof_public_key_jwk
        or current_app.config.get("MINI_PROOF_ENROLLMENT_REQUIRED", True)
    )
    invalidate_registered_device_proof_key(
        device,
        require_repair=require_proof_after_revocation,
    )
    device.is_active = False
    device.revoked_at = _utc_now()
    device.revoked_by_user_id = revoked_by_user_id
    db.session.commit()
    return device


def _mark_enrollment_expired(enrollment: BranchDeviceEnrollment) -> None:
    if enrollment.status == MiniDeviceEnrollmentStatus.PENDING:
        enrollment.status = MiniDeviceEnrollmentStatus.EXPIRED


def expire_stale_device_enrollments(branch_id: Optional[int] = None) -> int:
    if not device_enrollment_table_available():
        return 0

    now = _utc_now()
    query = BranchDeviceEnrollment.query.filter(
        BranchDeviceEnrollment.status == MiniDeviceEnrollmentStatus.PENDING,
        BranchDeviceEnrollment.expires_at <= now,
    )
    if branch_id is not None:
        query = query.filter(BranchDeviceEnrollment.branch_id == branch_id)

    enrollments = _safe_device_enrollment_query(query.all, [])
    if not enrollments:
        return 0

    for enrollment in enrollments:
        enrollment.status = MiniDeviceEnrollmentStatus.EXPIRED

    db.session.commit()
    return len(enrollments)


def _get_pending_device_enrollment(
    branch_id: int,
    device_id: str,
) -> Optional[BranchDeviceEnrollment]:
    return _safe_device_enrollment_query(
        lambda: (
            BranchDeviceEnrollment.query.filter_by(
                branch_id=branch_id,
                device_id=device_id,
                status=MiniDeviceEnrollmentStatus.PENDING,
            )
            .order_by(BranchDeviceEnrollment.created_at.desc())
            .first()
        ),
        None,
    )


def get_device_enrollment_for_branch(
    branch_id: int,
    enrollment_id: int,
) -> Optional[BranchDeviceEnrollment]:
    return _safe_device_enrollment_query(
        lambda: (
            BranchDeviceEnrollment.query.filter_by(
                branch_id=branch_id,
                id=enrollment_id,
            ).first()
        ),
        None,
    )


def list_device_enrollments(branch_id: int) -> list[BranchDeviceEnrollment]:
    expire_stale_device_enrollments(branch_id)
    return _safe_device_enrollment_query(
        lambda: (
            BranchDeviceEnrollment.query.filter_by(branch_id=branch_id)
            .order_by(
                BranchDeviceEnrollment.status.asc(),
                BranchDeviceEnrollment.created_at.desc(),
            )
            .all()
        ),
        [],
    )


def request_device_enrollment(
    branch: Branch,
    device_id: str,
) -> PendingMiniDeviceEnrollmentChallenge:
    if not device_enrollment_table_available():
        raise MiniDeviceAuthorizationError(
            error="DEVICE_NOT_AUTHORIZED",
            details="يرجى استخدام جهاز مسجل أو التواصل مع الإدارة لتفعيل جهاز إضافي.",
        )

    expire_stale_device_enrollments(branch.id)
    now = _utc_now()
    pairing_code = _generate_pairing_code()
    finalization_proof = generate_enrollment_finalization_proof()
    expires_at = _pairing_expiry(now)
    limit_reached = count_active_registered_devices(branch.id) >= MAX_ACTIVE_MINI_DEVICES_PER_BRANCH

    enrollment = _get_pending_device_enrollment(branch.id, device_id)
    if enrollment:
        enrollment.pairing_code_hash = _hash_pairing_code(
            branch.id,
            device_id,
            pairing_code,
        )
        enrollment.expires_at = expires_at
        enrollment.requested_ip = _request_ip()
        enrollment.requested_user_agent = _request_user_agent()
        enrollment.updated_at = now
    else:
        enrollment = BranchDeviceEnrollment(
            branch_id=branch.id,
            device_id=device_id,
            pairing_code_hash=_hash_pairing_code(branch.id, device_id, pairing_code),
            status=MiniDeviceEnrollmentStatus.PENDING,
            expires_at=expires_at,
            requested_ip=_request_ip(),
            requested_user_agent=_request_user_agent(),
        )
        db.session.add(enrollment)

    db.session.flush()
    enrollment.finalization_proof_hash = hash_enrollment_finalization_proof(
        enrollment.id,
        branch.id,
        device_id,
        finalization_proof,
    )
    enrollment.finalization_expires_at = expires_at
    enrollment.finalization_consumed_at = None

    db.session.commit()
    return PendingMiniDeviceEnrollmentChallenge(
        enrollment_id=enrollment.id,
        pairing_code=pairing_code,
        expires_at=expires_at,
        limit_reached=limit_reached,
        finalization_proof=finalization_proof,
    )


def _ensure_enrollment_can_be_resolved(
    branch: Branch,
    enrollment: BranchDeviceEnrollment,
    pairing_code: str,
) -> None:
    expires_at = _coerce_utc_datetime(enrollment.expires_at)

    if enrollment.branch_id != branch.id:
        raise MiniDeviceSecurityError(
            error="DEVICE_ENROLLMENT_BRANCH_MISMATCH",
            details="لا يمكن اعتماد طلب جهاز لفرع مختلف.",
            status_code=409,
        )

    if enrollment.status == MiniDeviceEnrollmentStatus.APPROVED:
        raise MiniDeviceSecurityError(
            error="DEVICE_ENROLLMENT_ALREADY_APPROVED",
            details="تم اعتماد هذا الطلب من قبل.",
            status_code=409,
        )

    if enrollment.status == MiniDeviceEnrollmentStatus.REJECTED:
        raise MiniDeviceSecurityError(
            error="DEVICE_ENROLLMENT_ALREADY_REJECTED",
            details="تم رفض هذا الطلب بالفعل.",
            status_code=409,
        )

    if enrollment.status == MiniDeviceEnrollmentStatus.EXPIRED or (
        expires_at is not None and expires_at <= _utc_now()
    ):
        _mark_enrollment_expired(enrollment)
        db.session.commit()
        raise MiniDeviceSecurityError(
            error="DEVICE_ENROLLMENT_EXPIRED",
            details="انتهت صلاحية رمز تسجيل هذا الجهاز.",
            status_code=409,
        )

    expected_hash = _hash_pairing_code(branch.id, enrollment.device_id, pairing_code)
    if enrollment.pairing_code_hash != expected_hash:
        raise MiniDeviceSecurityError(
            error="INVALID_PAIRING_CODE",
            details="رمز تسجيل الجهاز غير صحيح.",
            status_code=400,
        )


def approve_device_enrollment(
    branch: Branch,
    enrollment_id: int,
    *,
    pairing_code: str,
    device_label: str,
    device_type: MiniDeviceType,
    access_mode: MiniAccessMode,
    approved_by_user_id: Optional[int] = None,
) -> Union[BranchRegisteredDevice, ResolvedMiniDevice]:
    if not device_enrollment_table_available():
        raise MiniDeviceSecurityError(
            error="DEVICE_ENROLLMENT_NOT_AVAILABLE",
            details="نظام طلبات تسجيل الأجهزة غير متاح حالياً.",
            status_code=409,
        )

    _validate_approval_profile(device_type, access_mode)
    enrollment = get_device_enrollment_for_branch(branch.id, enrollment_id)
    if not enrollment:
        raise MiniDeviceSecurityError(
            error="DEVICE_ENROLLMENT_NOT_FOUND",
            details="طلب تسجيل الجهاز غير موجود لهذا الفرع.",
            status_code=404,
        )

    _ensure_enrollment_can_be_resolved(branch, enrollment, pairing_code.strip().upper())
    ensure_branch_can_activate_additional_device(branch.id, device_id=enrollment.device_id)

    device = activate_or_create_registered_device(
        branch=branch,
        device_id=enrollment.device_id,
        device_type=device_type,
        access_mode=access_mode,
        created_by_user_id=approved_by_user_id,
        device_label=device_label.strip() or _default_device_label(device_type),
        sync_legacy_branch_binding=False,
        last_seen_ip=enrollment.requested_ip,
        last_seen_user_agent=enrollment.requested_user_agent,
        credential_required=True,
        proof_key_required=current_app.config.get(
            "MINI_PROOF_ENROLLMENT_REQUIRED",
            True,
        ),
        commit=False,
    )

    now = _utc_now()
    enrollment.status = MiniDeviceEnrollmentStatus.APPROVED
    enrollment.registered_device_id = getattr(device, "id", None)
    enrollment.approved_at = now
    enrollment.updated_at = now
    db.session.commit()
    return device


def reject_device_enrollment(
    branch: Branch,
    enrollment_id: int,
) -> BranchDeviceEnrollment:
    if not device_enrollment_table_available():
        raise MiniDeviceSecurityError(
            error="DEVICE_ENROLLMENT_NOT_AVAILABLE",
            details="نظام طلبات تسجيل الأجهزة غير متاح حالياً.",
            status_code=409,
        )

    enrollment = get_device_enrollment_for_branch(branch.id, enrollment_id)
    if not enrollment:
        raise MiniDeviceSecurityError(
            error="DEVICE_ENROLLMENT_NOT_FOUND",
            details="طلب تسجيل الجهاز غير موجود لهذا الفرع.",
            status_code=404,
        )

    if enrollment.status == MiniDeviceEnrollmentStatus.APPROVED:
        raise MiniDeviceSecurityError(
            error="DEVICE_ENROLLMENT_ALREADY_APPROVED",
            details="تم اعتماد هذا الطلب بالفعل.",
            status_code=409,
        )

    if enrollment.status == MiniDeviceEnrollmentStatus.REJECTED:
        return enrollment

    expires_at = _coerce_utc_datetime(enrollment.expires_at)
    if enrollment.status == MiniDeviceEnrollmentStatus.EXPIRED or (
        expires_at is not None and expires_at <= _utc_now()
    ):
        _mark_enrollment_expired(enrollment)
    else:
        enrollment.status = MiniDeviceEnrollmentStatus.REJECTED

    enrollment.updated_at = _utc_now()
    db.session.commit()
    return enrollment


def authorize_registered_device_repair(
    branch: Branch,
    registered_device_id: int,
    *,
    authorized_by_user_id: Optional[int] = None,
) -> BranchRegisteredDevice:
    """Put one existing row into an Admin-authorized secure re-pair window."""
    if not registered_device_table_available():
        raise MiniDeviceSecurityError(
            error="DEVICE_SECURITY_UNAVAILABLE",
            details="جدول الأجهزة المسجلة غير متاح.",
            status_code=503,
        )

    device = (
        BranchRegisteredDevice.query.filter_by(
            id=registered_device_id,
            branch_id=branch.id,
        )
        .with_for_update()
        .one_or_none()
    )
    if not device:
        raise MiniDeviceSecurityError(
            error="REGISTERED_DEVICE_NOT_FOUND",
            details="الجهاز المطلوب غير موجود لهذا الفرع.",
            status_code=404,
        )

    now = _utc_now()
    outstanding = BranchDeviceEnrollment.query.filter(
        BranchDeviceEnrollment.branch_id == branch.id,
        BranchDeviceEnrollment.device_id == device.device_id,
        BranchDeviceEnrollment.status.in_([
            MiniDeviceEnrollmentStatus.PENDING,
            MiniDeviceEnrollmentStatus.APPROVED,
        ]),
        BranchDeviceEnrollment.finalization_consumed_at.is_(None),
    ).all()
    for enrollment in outstanding:
        enrollment.status = MiniDeviceEnrollmentStatus.EXPIRED
        enrollment.finalization_proof_hash = None
        enrollment.updated_at = now

    # Enter the controlled finalization state immediately. For an already
    # secured device this also bumps the version and removes the old digest,
    # so Admin-initiated rotation invalidates access/refresh sessions at once.
    if device.credential_hash:
        invalidate_registered_device_credential(device, invalidated_at=now)
    proof_was_or_is_required = bool(
        device.proof_key_required
        or device.proof_public_key_jwk
        or current_app.config.get("MINI_PROOF_ENROLLMENT_REQUIRED", True)
    )
    invalidate_registered_device_proof_key(
        device,
        invalidated_at=now,
        require_repair=proof_was_or_is_required,
    )
    device.credential_required = True
    device.repair_authorized_at = now
    device.repair_expires_at = _repair_expiry(now)
    device.repair_authorized_by_user_id = authorized_by_user_id
    db.session.commit()
    return device


def claim_admin_authorized_device_repair(
    branch: Branch,
    device_id: str,
) -> Optional[PendingMiniDeviceEnrollmentChallenge]:
    """Let the physical Mini browser claim a short Admin-opened re-pair window."""
    if not registered_device_table_available():
        return None

    device = (
        BranchRegisteredDevice.query.filter_by(
            branch_id=branch.id,
            device_id=device_id,
        )
        .with_for_update()
        .one_or_none()
    )
    if not device or device.repair_authorized_at is None:
        return None

    now = _utc_now()
    repair_expires_at = _coerce_utc_datetime(device.repair_expires_at)
    if repair_expires_at is None or repair_expires_at <= now:
        device.repair_authorized_at = None
        device.repair_expires_at = None
        device.repair_authorized_by_user_id = None
        db.session.commit()
        return None

    if not device.is_active:
        ensure_branch_can_activate_additional_device(
            branch.id,
            device_id=device.device_id,
        )
        device.is_active = True
        device.revoked_at = None
        device.revoked_by_user_id = None

    if device.credential_hash:
        invalidate_registered_device_credential(device, invalidated_at=now)
    if device.proof_public_key_jwk or device.proof_key_thumbprint:
        invalidate_registered_device_proof_key(
            device,
            invalidated_at=now,
            require_repair=True,
        )

    # Any previous proof is unrecoverable by design. Expire it before issuing a
    # fresh browser-held proof under the new Admin authorization.
    outstanding = BranchDeviceEnrollment.query.filter(
        BranchDeviceEnrollment.branch_id == branch.id,
        BranchDeviceEnrollment.device_id == device.device_id,
        BranchDeviceEnrollment.status.in_([
            MiniDeviceEnrollmentStatus.PENDING,
            MiniDeviceEnrollmentStatus.APPROVED,
        ]),
        BranchDeviceEnrollment.finalization_consumed_at.is_(None),
    ).all()
    for previous in outstanding:
        previous.status = MiniDeviceEnrollmentStatus.EXPIRED
        previous.finalization_proof_hash = None
        previous.updated_at = now

    pairing_code = _generate_pairing_code()
    proof = generate_enrollment_finalization_proof()
    expires_at = _pairing_expiry(now)
    enrollment = BranchDeviceEnrollment(
        branch_id=branch.id,
        device_id=device.device_id,
        pairing_code_hash=_hash_pairing_code(
            branch.id,
            device.device_id,
            pairing_code,
        ),
        status=MiniDeviceEnrollmentStatus.APPROVED,
        expires_at=expires_at,
        finalization_expires_at=expires_at,
        approved_at=now,
        registered_device_id=device.id,
        requested_ip=_request_ip(),
        requested_user_agent=_request_user_agent(),
    )
    db.session.add(enrollment)
    db.session.flush()
    enrollment.finalization_proof_hash = hash_enrollment_finalization_proof(
        enrollment.id,
        branch.id,
        device.device_id,
        proof,
    )

    device.credential_required = True
    device.repair_authorized_at = None
    device.repair_expires_at = None
    device.repair_authorized_by_user_id = None
    db.session.commit()
    return PendingMiniDeviceEnrollmentChallenge(
        enrollment_id=enrollment.id,
        pairing_code="",
        expires_at=expires_at,
        limit_reached=False,
        finalization_proof=proof,
    )


def enforce_mini_device_session_binding(
    device: Union[BranchRegisteredDevice, ResolvedMiniDevice],
    claims: dict,
) -> None:
    """Strictly bind credential-enabled JWTs to one row and credential version."""
    claim_device_id = claims.get("registered_device_id")
    claim_version = claims.get("device_credential_version")
    claim_branch_id = claims.get("branch_id")

    if isinstance(device, ResolvedMiniDevice):
        if claim_device_id is not None or claim_version is not None:
            raise MiniDeviceAuthorizationError(
                error="DEVICE_SESSION_MISMATCH",
                details="جلسة الجهاز لا تطابق الجهاز الحالي.",
            )
        return

    if device.credential_state == MiniDeviceCredentialState.CREDENTIAL_ENABLED:
        if claim_branch_id != device.branch_id or claim_device_id != device.id:
            raise MiniDeviceAuthorizationError(
                error="DEVICE_SESSION_MISMATCH",
                details="جلسة الجهاز لا تطابق الجهاز الحالي.",
            )
        if not isinstance(claim_version, int) or claim_version < 1:
            raise MiniDeviceAuthorizationError(
                error="DEVICE_CREDENTIAL_VERSION_INVALID",
                details="إصدار اعتماد الجهاز غير موجود أو غير صالح.",
            )
        if claim_version != device.credential_version:
            raise MiniDeviceAuthorizationError(
                error="DEVICE_CREDENTIAL_VERSION_INVALID",
                details="انتهت صلاحية جلسة الجهاز بعد تغيير الاعتماد.",
            )
        claim_thumbprint = (claims.get("cnf") or {}).get("jkt") \
            if isinstance(claims.get("cnf"), dict) else None
        claim_proof_version = claims.get("device_proof_key_version")
        if device.proof_state == MiniDeviceProofState.PROOF_ENABLED:
            if claim_thumbprint != device.proof_key_thumbprint:
                raise MiniDeviceAuthorizationError(
                    error="DEVICE_PROOF_SESSION_MISMATCH",
                    details="جلسة الجهاز لا تطابق مفتاح الإثبات الحالي.",
                )
            if claim_proof_version != device.proof_key_version:
                raise MiniDeviceAuthorizationError(
                    error="DEVICE_PROOF_KEY_VERSION_INVALID",
                    details="انتهت صلاحية جلسة الجهاز بعد تغيير مفتاح الإثبات.",
                )
        elif claim_thumbprint is not None or claim_proof_version is not None:
            raise MiniDeviceAuthorizationError(
                error="DEVICE_PROOF_SESSION_MISMATCH",
                details="جلسة مربوطة بمفتاح لا يمكن استخدامها كجلسة اعتماد فقط.",
            )
        return

    if claim_device_id is not None or claim_version is not None:
        raise MiniDeviceAuthorizationError(
            error="DEVICE_SESSION_MISMATCH",
            details="جلسة جهاز مؤمنة لا يمكن استخدامها كجلسة قديمة.",
        )


def _approved_finalization_enrollment_for_device(
    branch_id: int,
    registered_device_id: int,
) -> Optional[BranchDeviceEnrollment]:
    return _safe_device_enrollment_query(
        lambda: (
            BranchDeviceEnrollment.query.filter_by(
                branch_id=branch_id,
                registered_device_id=registered_device_id,
                status=MiniDeviceEnrollmentStatus.APPROVED,
            )
            .order_by(BranchDeviceEnrollment.approved_at.desc())
            .first()
        ),
        None,
    )


def _pending_finalization_payload(device: BranchRegisteredDevice) -> dict:
    enrollment = _approved_finalization_enrollment_for_device(
        device.branch_id,
        device.id,
    )
    if not enrollment:
        return {"credential_state": MiniDeviceCredentialState.PENDING_FINALIZATION.value}
    return {
        "credential_state": MiniDeviceCredentialState.PENDING_FINALIZATION.value,
        "pending_enrollment_id": enrollment.id,
        "expires_at": enrollment.finalization_expires_at.isoformat()
        if enrollment.finalization_expires_at
        else None,
    }


def enforce_registered_device_credential(
    device: BranchRegisteredDevice,
    credential: Optional[str],
) -> bool:
    """Enforce credentials only for Phase-2 devices; legacy rows stay compatible."""
    state = device.credential_state
    if state == MiniDeviceCredentialState.LEGACY:
        if not legacy_device_compatibility_enabled():
            raise MiniDeviceCredentialError(
                error="DEVICE_CREDENTIAL_MISSING",
                details="تم إيقاف توافق الأجهزة القديمة لهذا النظام.",
                payload={"credential_state": MiniDeviceCredentialState.LEGACY.value},
            )
        return False
    if state == MiniDeviceCredentialState.PENDING_FINALIZATION:
        raise MiniDeviceCredentialError(
            error="DEVICE_FINALIZATION_REQUIRED",
            details="تم اعتماد الجهاز ويجب إكمال التفعيل من نفس المتصفح.",
            payload=_pending_finalization_payload(device),
        )
    if state == MiniDeviceCredentialState.REVOKED:
        raise MiniDeviceCredentialError(
            error="DEVICE_CREDENTIAL_REVOKED",
            details="الجهاز غير نشط أو تم إلغاؤه.",
        )
    verify_registered_device_credential(
        device,
        credential,
        expected_branch_id=device.branch_id,
        expected_device_id=device.device_id,
    )
    return True


def finalize_approved_device_enrollment(
    enrollment_id: int,
    *,
    device_id: str,
    finalization_proof: Optional[str],
    proof_challenge_id: Optional[str] = None,
    proof_challenge: Optional[str] = None,
    device_proof: Optional[str] = None,
    proof_public_key_jwk: Optional[dict] = None,
    proof_origin: Optional[str] = None,
) -> tuple[BranchRegisteredDevice, IssuedMiniDeviceCredential]:
    """Consume one approved enrollment proof and issue exactly one credential.

    PostgreSQL serializes contenders using the enrollment row lock. The consumed
    marker and credential digest are committed in the same transaction.
    """
    enrollment = (
        BranchDeviceEnrollment.query.filter_by(id=enrollment_id)
        .with_for_update()
        .one_or_none()
    )
    if not enrollment:
        raise MiniDeviceSecurityError(
            error="DEVICE_ENROLLMENT_NOT_FOUND",
            details="طلب تسجيل الجهاز غير موجود.",
            status_code=404,
        )
    if enrollment.status != MiniDeviceEnrollmentStatus.APPROVED:
        raise MiniDeviceSecurityError(
            error="DEVICE_ENROLLMENT_NOT_APPROVED",
            details="لم يتم اعتماد طلب تسجيل الجهاز بعد.",
            status_code=409,
        )
    if enrollment.finalization_consumed_at is not None:
        raise MiniDeviceSecurityError(
            error="DEVICE_FINALIZATION_ALREADY_CONSUMED",
            details="تم استخدام إثبات تفعيل هذا الجهاز بالفعل.",
            status_code=409,
        )
    expires_at = _coerce_utc_datetime(enrollment.finalization_expires_at)
    if expires_at is None or expires_at <= _utc_now():
        raise MiniDeviceSecurityError(
            error="DEVICE_FINALIZATION_PROOF_EXPIRED",
            details="انتهت صلاحية إثبات تفعيل الجهاز.",
            status_code=409,
        )
    if enrollment.device_id != device_id:
        raise MiniDeviceSecurityError(
            error="DEVICE_FINALIZATION_DEVICE_MISMATCH",
            details="إثبات التفعيل لا يخص هذا الجهاز.",
            status_code=403,
        )
    if not finalization_proof:
        raise MiniDeviceSecurityError(
            error="DEVICE_FINALIZATION_PROOF_MISSING",
            details="إثبات تفعيل الجهاز غير موجود في هذا المتصفح.",
            status_code=403,
        )
    expected_hash = hash_enrollment_finalization_proof(
        enrollment.id,
        enrollment.branch_id,
        enrollment.device_id,
        finalization_proof,
    )
    if not enrollment.finalization_proof_hash or not secrets.compare_digest(
        enrollment.finalization_proof_hash,
        expected_hash,
    ):
        raise MiniDeviceSecurityError(
            error="DEVICE_FINALIZATION_PROOF_INVALID",
            details="إثبات تفعيل الجهاز غير صحيح.",
            status_code=403,
        )

    device = BranchRegisteredDevice.query.filter_by(
        id=enrollment.registered_device_id,
        branch_id=enrollment.branch_id,
        device_id=enrollment.device_id,
    ).one_or_none()
    if not device or not device.is_active:
        raise MiniDeviceSecurityError(
            error="DEVICE_NOT_AUTHORIZED",
            details="الجهاز المعتمد غير موجود أو غير نشط.",
            status_code=403,
        )
    if device.credential_hash:
        raise MiniDeviceSecurityError(
            error="DEVICE_FINALIZATION_ALREADY_CONSUMED",
            details="تم إصدار اعتماد لهذا الجهاز بالفعل.",
            status_code=409,
        )
    if not device.credential_required:
        raise MiniDeviceSecurityError(
            error="DEVICE_FINALIZATION_STATE_INVALID",
            details="الجهاز ليس في حالة انتظار التفعيل.",
            status_code=409,
        )

    if device.proof_key_required:
        from app.models.mini_device_proof import MiniDeviceProofChallengePurpose
        from app.services.mini_device_proof_service import (
            bind_enrollment_public_key,
            verify_and_consume_challenge,
        )

        if not all((
            proof_challenge_id,
            proof_challenge,
            device_proof,
            proof_public_key_jwk,
        )):
            raise MiniDeviceSecurityError(
                error="DEVICE_PROOF_FINALIZATION_REQUIRED",
                details="يجب إكمال تفعيل مفتاح إثبات الجهاز من هذا المتصفح.",
                status_code=403,
            )
        verification = verify_and_consume_challenge(
            challenge_id=proof_challenge_id,
            challenge_nonce=proof_challenge,
            proof=device_proof,
            purpose=MiniDeviceProofChallengePurpose.ENROLLMENT,
            device=device,
            origin=proof_origin,
            public_jwk=proof_public_key_jwk,
        )
        bind_enrollment_public_key(device, verification)

    consumed_at = _utc_now()
    claimed = BranchDeviceEnrollment.query.filter(
        BranchDeviceEnrollment.id == enrollment.id,
        BranchDeviceEnrollment.finalization_consumed_at.is_(None),
        BranchDeviceEnrollment.finalization_proof_hash == expected_hash,
    ).update(
        {
            BranchDeviceEnrollment.finalization_consumed_at: consumed_at,
            BranchDeviceEnrollment.finalization_proof_hash: None,
            BranchDeviceEnrollment.updated_at: consumed_at,
        },
        synchronize_session=False,
    )
    if claimed != 1:
        db.session.rollback()
        raise MiniDeviceSecurityError(
            error="DEVICE_FINALIZATION_ALREADY_CONSUMED",
            details="تم استخدام إثبات تفعيل هذا الجهاز بالفعل.",
            status_code=409,
        )

    issued = issue_registered_device_credential(device, commit=False)
    db.session.commit()
    return device, issued


def serialize_mini_device_context(
    device: Union[BranchRegisteredDevice, ResolvedMiniDevice, None],
) -> Optional[dict]:
    if not device:
        return None

    payload = {
        "id": getattr(device, "id", None),
        "device_id": device.device_id,
        "device_label": device.device_label,
        "device_type": device.device_type.value,
        "access_mode": device.access_mode.value,
        "is_active": device.is_active,
        "last_seen_at": device.last_seen_at.isoformat() if device.last_seen_at else None,
    }
    if isinstance(device, BranchRegisteredDevice):
        payload["credential_state"] = device.credential_state.value
        payload["proof_state"] = device.proof_state.value
        payload["proof_key_version"] = device.proof_key_version
    else:
        payload["credential_state"] = MiniDeviceCredentialState.LEGACY.value
    return payload


def serialize_registered_device_for_admin(
    device: Union[BranchRegisteredDevice, ResolvedMiniDevice],
) -> dict:
    payload = serialize_mini_device_context(device) or {}
    payload.update(
        {
            "created_at": getattr(device, "created_at", None).isoformat()
            if getattr(device, "created_at", None)
            else None,
            "updated_at": getattr(device, "updated_at", None).isoformat()
            if getattr(device, "updated_at", None)
            else None,
            "revoked_at": getattr(device, "revoked_at", None).isoformat()
            if getattr(device, "revoked_at", None)
            else None,
            "last_seen_ip": getattr(device, "last_seen_ip", None),
            "last_seen_user_agent": getattr(device, "last_seen_user_agent", None),
            "device_summary": summarize_device_user_agent(
                getattr(device, "last_seen_user_agent", None)
            ),
            "repair_authorized_at": getattr(device, "repair_authorized_at", None).isoformat()
            if getattr(device, "repair_authorized_at", None)
            else None,
            "repair_expires_at": getattr(device, "repair_expires_at", None).isoformat()
            if getattr(device, "repair_expires_at", None)
            else None,
            "proof_state": getattr(device, "proof_state", MiniDeviceProofState.CREDENTIAL_ONLY).value,
            "proof_key_version": getattr(device, "proof_key_version", None),
            "proof_key_registered_at": getattr(device, "proof_key_registered_at", None).isoformat()
            if getattr(device, "proof_key_registered_at", None)
            else None,
            "last_proof_verified_at": getattr(device, "last_proof_verified_at", None).isoformat()
            if getattr(device, "last_proof_verified_at", None)
            else None,
        }
    )
    return payload


def serialize_device_enrollment_for_admin(
    enrollment: BranchDeviceEnrollment,
) -> dict:
    return {
        "id": enrollment.id,
        "branch_id": enrollment.branch_id,
        "device_id": enrollment.device_id,
        "status": enrollment.status.value,
        "expires_at": enrollment.expires_at.isoformat() if enrollment.expires_at else None,
        "created_at": enrollment.created_at.isoformat() if enrollment.created_at else None,
        "updated_at": enrollment.updated_at.isoformat() if enrollment.updated_at else None,
        "requested_ip": enrollment.requested_ip,
        "requested_user_agent": enrollment.requested_user_agent,
        "device_summary": summarize_device_user_agent(enrollment.requested_user_agent),
        "suggested_device_type": suggest_device_type_from_user_agent(
            enrollment.requested_user_agent
        ).value,
    }


def build_branch_device_security_snapshot(branch: Branch) -> dict:
    expire_stale_device_enrollments(branch.id)
    registered_devices = list_registered_devices(branch.id)
    security_available = registered_device_table_available()
    active_registered_devices = [d for d in registered_devices if d.is_active]
    pending_enrollments = [
        enrollment
        for enrollment in list_device_enrollments(branch.id)
        if enrollment.status == MiniDeviceEnrollmentStatus.PENDING
    ]
    secure_device_count = sum(
        device.credential_state == MiniDeviceCredentialState.CREDENTIAL_ENABLED
        for device in registered_devices
    )
    proof_enabled_device_count = sum(
        device.proof_state == MiniDeviceProofState.PROOF_ENABLED
        for device in registered_devices
    )
    legacy_registered_device_count = sum(
        device.credential_state == MiniDeviceCredentialState.LEGACY
        for device in registered_devices
    )
    # A branch-level binding with no registered row is still an ID-only
    # compatibility dependency and must block fleet migration completion.
    legacy_fallback_device_count = int(
        security_available
        and not registered_devices
        and bool(branch.authorized_device_id)
    )
    legacy_device_count = (
        legacy_registered_device_count + legacy_fallback_device_count
    )
    pending_finalization_count = sum(
        device.credential_state == MiniDeviceCredentialState.PENDING_FINALIZATION
        for device in registered_devices
    )
    revoked_device_count = sum(
        device.credential_state == MiniDeviceCredentialState.REVOKED
        for device in registered_devices
    )

    return {
        "active_device_count": len(active_registered_devices),
        "max_active_devices": MAX_ACTIVE_MINI_DEVICES_PER_BRANCH,
        "secure_device_count": secure_device_count,
        "proof_enabled_device_count": proof_enabled_device_count,
        "legacy_device_count": legacy_device_count,
        "pending_finalization_count": pending_finalization_count,
        "revoked_device_count": revoked_device_count,
        "legacy_fallback_device_count": legacy_fallback_device_count,
        "security_available": security_available,
        "migration_complete": (
            security_available
            and legacy_device_count == 0
            and pending_finalization_count == 0
        ),
        "legacy_compatibility_enabled": legacy_device_compatibility_enabled(),
        "registered_devices": [
            serialize_registered_device_for_admin(device)
            for device in registered_devices
        ],
        "pending_enrollments": [
            serialize_device_enrollment_for_admin(enrollment)
            for enrollment in pending_enrollments
        ],
    }


def resolve_authenticated_registered_device(
    branch: Branch,
    device_id: str,
    credential: Optional[str] = None,
) -> Union[BranchRegisteredDevice, ResolvedMiniDevice]:
    if not registered_device_table_available():
        if _legacy_table_fallback_allowed() and branch.authorized_device_id == device_id:
            return ResolvedMiniDevice(
                id=None,
                device_id=device_id,
                device_label="Legacy Desktop Device",
                device_type=MiniDeviceType.DESKTOP,
                access_mode=MiniAccessMode.FULL_MINI,
                is_active=True,
                last_seen_at=branch.binding_timestamp or _utc_now(),
            )
        raise MiniDeviceAuthorizationError(
            error="DEVICE_SECURITY_UNAVAILABLE",
            details="تعذر التحقق من سجل الجهاز بشكل آمن.",
            status_code=503,
        )

    registered_devices = list_registered_devices(branch.id)
    if not registered_device_table_available():
        raise MiniDeviceAuthorizationError(
            error="DEVICE_SECURITY_UNAVAILABLE",
            details="تعذر التحقق من سجل الجهاز بشكل آمن.",
            status_code=503,
        )
    for device in registered_devices:
        if device.device_id == device_id and device.is_active:
            enforce_registered_device_credential(device, credential)
            return device

    has_registered_rows = bool(registered_devices)
    if (
        legacy_device_compatibility_enabled()
        and not has_registered_rows
        and branch.authorized_device_id == device_id
    ):
        return ResolvedMiniDevice(
            id=None,
            device_id=device_id,
            device_label="Legacy Desktop Device",
            device_type=MiniDeviceType.DESKTOP,
            access_mode=MiniAccessMode.FULL_MINI,
            is_active=True,
            last_seen_at=branch.binding_timestamp or _utc_now(),
        )

    raise MiniDeviceAuthorizationError(
        error="DEVICE_NOT_AUTHORIZED",
        details="هذا الجهاز غير مصرح له بالدخول لنظام الكاشير في هذا الفرع",
    )


def authorize_mini_login_device(
    branch: Branch,
    device_id: str,
    *,
    created_by_user_id: Optional[int] = None,
    credential: Optional[str] = None,
) -> Union[BranchRegisteredDevice, ResolvedMiniDevice]:
    if not registered_device_table_available():
        if not _legacy_table_fallback_allowed():
            raise MiniDeviceAuthorizationError(
                error="DEVICE_SECURITY_UNAVAILABLE",
                details="تعذر التحقق من سجل الجهاز بشكل آمن.",
                status_code=503,
            )
        if branch.authorized_device_id is None:
            now = _utc_now()
            sync_branch_legacy_binding(
                branch,
                device_id,
                seen_at=now,
                ip=_request_ip(),
                user_agent=_request_user_agent(),
            )
            db.session.commit()
            return ResolvedMiniDevice(
                id=None,
                device_id=device_id,
                device_label="Legacy Desktop Device",
                device_type=MiniDeviceType.DESKTOP,
                access_mode=MiniAccessMode.FULL_MINI,
                is_active=True,
                last_seen_at=now,
            )

        if branch.authorized_device_id == device_id:
            return ResolvedMiniDevice(
                id=None,
                device_id=device_id,
                device_label="Legacy Desktop Device",
                device_type=MiniDeviceType.DESKTOP,
                access_mode=MiniAccessMode.FULL_MINI,
                is_active=True,
                last_seen_at=branch.binding_timestamp or _utc_now(),
            )

        raise MiniDeviceAuthorizationError(
            error="DEVICE_NOT_AUTHORIZED",
            details="يرجى استخدام الجهاز المعتمد للفرع أو التواصل مع الإدارة لإعادة ضبط الربط.",
        )

    repair_challenge = claim_admin_authorized_device_repair(branch, device_id)
    if repair_challenge:
        raise MiniDeviceAuthorizationError(
            error="DEVICE_FINALIZATION_REQUIRED",
            details="تم بدء إعادة ربط الجهاز. أكمل التفعيل من هذا المتصفح.",
            payload={
                "credential_state": MiniDeviceCredentialState.PENDING_FINALIZATION.value,
                "pending_enrollment_id": repair_challenge.enrollment_id,
                "expires_at": repair_challenge.expires_at.isoformat(),
            },
            finalization_proof=repair_challenge.finalization_proof,
        )

    active_device = get_active_registered_device(branch.id, device_id)
    if not registered_device_table_available():
        raise MiniDeviceAuthorizationError(
            error="DEVICE_SECURITY_UNAVAILABLE",
            details="تعذر التحقق من سجل الجهاز بشكل آمن.",
            status_code=503,
        )
    if active_device:
        enforce_registered_device_credential(active_device, credential)
        return touch_registered_device(active_device, commit=True)

    has_registered_rows = count_registered_devices(branch.id) > 0
    if not registered_device_table_available():
        raise MiniDeviceAuthorizationError(
            error="DEVICE_SECURITY_UNAVAILABLE",
            details="تعذر التحقق من سجل الجهاز بشكل آمن.",
            status_code=503,
        )
    if (
        legacy_device_compatibility_enabled()
        and not has_registered_rows
        and branch.authorized_device_id == device_id
    ):
        return activate_or_create_registered_device(
            branch=branch,
            device_id=device_id,
            device_type=MiniDeviceType.DESKTOP,
            access_mode=MiniAccessMode.FULL_MINI,
            created_by_user_id=created_by_user_id,
            sync_legacy_branch_binding=True,
            last_seen_at=branch.binding_timestamp or _utc_now(),
            last_seen_ip=branch.binding_ip,
            last_seen_user_agent=branch.binding_user_agent,
        )

    active_count = count_active_registered_devices(branch.id)
    if not registered_device_table_available():
        raise MiniDeviceAuthorizationError(
            error="DEVICE_SECURITY_UNAVAILABLE",
            details="تعذر التحقق من سجل الجهاز بشكل آمن.",
            status_code=503,
        )
    if (
        legacy_device_compatibility_enabled()
        and active_count == 0
        and branch.authorized_device_id is None
        and not has_registered_rows
    ):
        return activate_or_create_registered_device(
            branch=branch,
            device_id=device_id,
            device_type=MiniDeviceType.DESKTOP,
            access_mode=MiniAccessMode.FULL_MINI,
            created_by_user_id=created_by_user_id,
            sync_legacy_branch_binding=True,
        )

    challenge = request_device_enrollment(branch, device_id)
    raise MiniDeviceAuthorizationError(
        error="DEVICE_ENROLLMENT_REQUIRED",
        details="هذا الجهاز غير مسجل لهذا الفرع. اطلب من الإدارة اعتماد الجهاز.",
        payload={
            "pending_enrollment_id": challenge.enrollment_id,
            "pairing_code": challenge.pairing_code,
            "expires_at": challenge.expires_at.isoformat(),
            "limit_reached": challenge.limit_reached,
        },
        finalization_proof=challenge.finalization_proof,
    )


def enforce_mini_access_for_endpoint(
    access_mode: MiniAccessMode,
    endpoint_name: Optional[str],
) -> None:
    if access_mode == MiniAccessMode.FULL_MINI:
        return

    if (
        access_mode == MiniAccessMode.INVENTORY_ONLY
        and endpoint_name in INVENTORY_ONLY_ALLOWED_MINI_ENDPOINTS
    ):
        return

    raise MiniDeviceAuthorizationError(
        error="MINI_ACCESS_DENIED",
        details="هذا الجهاز مفعل للمخزن فقط ولا يمكنه الوصول إلى هذه الشاشة أو العملية.",
    )
