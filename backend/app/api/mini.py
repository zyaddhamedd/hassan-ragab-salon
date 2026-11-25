from flask import Blueprint, current_app, request, jsonify, g
from app.modules.invoice_engine import InvoiceEngine
from app.models.invoice import Invoice, InvoiceItem, InvoiceStatus, PaymentMethod
from app.extensions import db
from app.services.stock_movement_service import capture_stock_movement, lock_product_stocks
from app.services.inventory_stock_status import location_stock_states, legacy_mini_status
from app.services.return_valuation import capture_return_cost
from functools import wraps
from typing import Optional
from flask_jwt_extended import (
    create_access_token, create_refresh_token,
    verify_jwt_in_request, get_jwt, get_jwt_identity
)
from sqlalchemy import case, func, or_
from sqlalchemy.orm import joinedload
from app.utils.date_utils import get_cairo_date, get_utc_now, to_iso_string
from app.utils.treasury_business_days import build_business_day_collection_snapshot
from app.services.mini_device_service import (
    MiniAccessMode,
    MiniDeviceAuthorizationError,
    MiniDeviceCredentialState,
    MiniDeviceSecurityError,
    authorize_mini_login_device,
    build_mini_device_jwt_claims,
    claim_admin_authorized_device_repair,
    enforce_mini_device_session_binding,
    enforce_mini_access_for_endpoint,
    finalize_approved_device_enrollment,
    resolve_authenticated_registered_device,
    serialize_mini_device_context,
    touch_registered_device,
)
from app.services.mini_device_proof_service import (
    create_enrollment_challenge,
    create_login_challenge,
    create_refresh_challenge,
    enforce_request_proof,
    verify_login_assertion,
    verify_refresh_assertion,
)
from app.services.invoice_audit import AuditActorContext

mini_bp = Blueprint('mini', __name__, url_prefix='/api/mini')


def _device_credential_cookie() -> Optional[str]:
    return request.cookies.get(
        current_app.config.get("MINI_DEVICE_COOKIE_NAME", "mini_device_credential")
    )


def _authorization_bearer_token() -> Optional[str]:
    authorization = request.headers.get("Authorization", "")
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def _set_enrollment_proof_cookie(response, proof: str) -> None:
    response.set_cookie(
        current_app.config.get(
            "MINI_ENROLLMENT_PROOF_COOKIE_NAME",
            "mini_device_enrollment_proof",
        ),
        proof,
        max_age=current_app.config.get("MINI_ENROLLMENT_PROOF_COOKIE_MAX_AGE", 60 * 15),
        secure=current_app.config.get("MINI_DEVICE_COOKIE_SECURE", False),
        httponly=True,
        samesite=current_app.config.get("MINI_DEVICE_COOKIE_SAMESITE", "Lax"),
        path="/api/mini/auth/device-enrollments",
    )


def _set_device_credential_cookie(response, credential: str) -> None:
    response.set_cookie(
        current_app.config.get("MINI_DEVICE_COOKIE_NAME", "mini_device_credential"),
        credential,
        max_age=current_app.config.get("MINI_DEVICE_COOKIE_MAX_AGE", 60 * 60 * 24 * 365),
        secure=current_app.config.get("MINI_DEVICE_COOKIE_SECURE", False),
        httponly=True,
        samesite=current_app.config.get("MINI_DEVICE_COOKIE_SAMESITE", "Lax"),
        path="/api/mini",
    )


def _mini_error_response(error: MiniDeviceSecurityError):
    payload = {"error": error.error}
    if error.details:
        payload["details"] = error.details
    if error.payload:
        payload.update(error.payload)
    return jsonify(payload), error.status_code


def _trusted_finalization_origin() -> bool:
    origin = request.headers.get("Origin")
    trusted_origins = current_app.config.get(
        "MINI_FINALIZATION_TRUSTED_ORIGINS",
        (),
    )
    return bool(origin and origin in trusted_origins)


def _load_active_cashier_runtime(identity, branch_id):
    from app.models.branch import Branch
    from app.models.user import User, UserRole

    try:
        user_id = int(identity)
    except (TypeError, ValueError):
        raise MiniDeviceAuthorizationError(
            error="DEVICE_NOT_AUTHORIZED",
            details="هوية جلسة الكاشير غير صالحة.",
        )

    user = db.session.get(User, user_id)
    if not user or not user.is_active or user.role != UserRole.CASHIER:
        raise MiniDeviceAuthorizationError(
            error="DEVICE_NOT_AUTHORIZED",
            details="حساب الكاشير غير نشط أو غير مصرح له.",
        )
    if not branch_id or user.branch_id != branch_id:
        raise MiniDeviceAuthorizationError(
            error="DEVICE_SESSION_MISMATCH",
            details="فرع جلسة الكاشير لا يطابق المستخدم الحالي.",
        )

    branch = db.session.get(Branch, branch_id)
    if not branch or not branch.is_active or branch.is_main_warehouse:
        raise MiniDeviceAuthorizationError(
            error="DEVICE_NOT_AUTHORIZED",
            details="الفرع غير نشط أو غير متاح لنظام Mini.",
        )
    return user, branch


def _parse_mini_bounded_pagination(default_per_page: int = 20, max_per_page: int = 50):
    raw_page = request.args.get('page', type=int)
    raw_per_page = request.args.get('per_page', type=int)

    page = raw_page if isinstance(raw_page, int) and raw_page > 0 else 1
    per_page = raw_per_page if isinstance(raw_per_page, int) and raw_per_page > 0 else default_per_page
    return page, min(per_page, max_per_page)

# ============================================================================
# Authentication Middleware
# ============================================================================

def _mini_token_rejection(claims):
    # Keep existing unmarked cashier sessions valid, never Admin tokens.
    marker = claims.get('token_type')
    if marker == 'admin' or marker not in (None, 'mini') or (marker is None and claims.get('role') != 'CASHIER'):
        return jsonify({"error": "Invalid token type. Mini authentication required."}), 403
    return None


def require_cashier(f):
    """Decorator to require cashier authentication via JWT"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Verify JWT token (this natively triggers 401 loaders if expired)
        verify_jwt_in_request()
        
        # Get claims
        claims = get_jwt()
        rejection = _mini_token_rejection(claims)
        if rejection is not None:
            return rejection
        role = claims.get('role')
        
        # ROLES ALLOWED: CASHIER, SUPER_ADMIN, BRANCH_MANAGER, EXEC_ADMIN
        allowed_roles = ['CASHIER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'EXEC_ADMIN']
        
        if role not in allowed_roles:
            return jsonify({"error": "Unauthorized access", "role": role}), 403
            
        # Set context
        g.user_id = get_jwt_identity()
        g.role = role
        g.is_admin = role != 'CASHIER'
        g.cashier_id = claims.get('cashier_id') # May be None for admins
        g.branch_id = claims.get('branch_id')   # May be None for Super Admin
        
        # DIAGNOSTIC: Log branch_id for investigation
        print(f"[REQUIRE_CASHIER] user_id={g.user_id}, role={role}, branch_id={g.branch_id}, cashier_id={g.cashier_id}")
        
        if not g.user_id:
            return jsonify({"error": "Invalid token (no identity)"}), 401
            
        # For CASHIERS, we strictly require cashier_id and branch_id
        if not g.is_admin and (not g.cashier_id or not g.branch_id):
             return jsonify({"error": "Invalid cashier token claims"}), 401
             
        # --- DEVICE BINDING SECURITY ENFORCEMENT (PRODUCTION CRITICAL) ---
        # Only enforce for the 'CASHIER' role to allow Admin flexibility
        if role == 'CASHIER':
             device_id = request.headers.get('X-Device-ID')
             
             # 1. Hard requirement: Header must exist
             if not device_id:
                 return jsonify({"error": "Unauthorized: Device ID header missing"}), 403
                 
             # 2. Validation: Compare against Branch's authorized device
             try:
                  g.current_user, branch = _load_active_cashier_runtime(
                      g.user_id,
                      g.branch_id,
                  )
                  g.branch = branch
                  g.mini_device = resolve_authenticated_registered_device(
                      branch,
                      device_id,
                      credential=_device_credential_cookie(),
                  )
                  enforce_mini_device_session_binding(g.mini_device, claims)
                  enforce_request_proof(
                      g.mini_device,
                      claims,
                      access_token=_authorization_bearer_token() or "",
                      proof=request.headers.get("DPoP"),
                      method=request.method,
                      path=request.path,
                  )
                  g.mini_device_credential_verified = (
                      getattr(g.mini_device, "credential_state", None)
                      == MiniDeviceCredentialState.CREDENTIAL_ENABLED
                  )
                  g.mini_access_mode = g.mini_device.access_mode.value
                  enforce_mini_access_for_endpoint(g.mini_device.access_mode, request.endpoint)
             except MiniDeviceAuthorizationError as auth_error:
                  print(
                      f"[SECURITY] Mini auth denied for branch {g.branch_id}:"
                      f" endpoint={request.endpoint}"
                      f" error={auth_error.error}"
                  )
                  payload = {"error": auth_error.error}
                  if auth_error.details:
                      payload["details"] = auth_error.details
                  if auth_error.payload:
                      payload.update(auth_error.payload)
                  payload["access_mode"] = getattr(g, "mini_access_mode", None)
                  return jsonify(payload), auth_error.status_code
        else:
             g.mini_device = None
             g.mini_access_mode = MiniAccessMode.FULL_MINI.value
        
        return f(*args, **kwargs)
    return decorated_function


def _append_mini_device_context(payload: dict, device) -> dict:
    payload["device_context"] = serialize_mini_device_context(device)
    return payload


from app.api.promo_errors import promo_api_errors
from app.services import promo_code_service
from app.services import payment_confirmation_attempt_service as payment_attempt_service
from app.models.payment_confirmation_attempt import (
    PaymentConfirmationAttempt,
    PaymentConfirmationAttemptStatus,
)


@mini_bp.route('/invoice/<int:invoice_id>/promo/validate', methods=['POST'])
@require_cashier
@promo_api_errors
def validate_invoice_promo(invoice_id):
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or set(payload) != {'code'}:
        raise promo_code_service.PromoError('PROMO_INVALID_CONFIGURATION')
    return jsonify(promo_code_service.preview_invoice_promo(invoice_id, g.branch_id, payload['code']))


def _get_request_branch():
    branch = getattr(g, "branch", None)
    if branch is not None:
        return branch

    from app.models.branch import Branch

    branch = Branch.query.get(g.branch_id)
    g.branch = branch
    return branch

# ============================================================================
# Authentication Endpoints
# ============================================================================


@mini_bp.route('/auth/proof/login-challenge', methods=['POST'])
def issue_login_proof_challenge():
    data = request.get_json(silent=True) or {}
    device_id = data.get("device_id")
    if not isinstance(device_id, str) or not device_id:
        return jsonify({"error": "DEVICE_ID_REQUIRED"}), 400
    try:
        return jsonify(create_login_challenge(
            device_id=device_id,
            credential=_device_credential_cookie(),
            origin=request.headers.get("Origin"),
        )), 200
    except MiniDeviceSecurityError as error:
        return _mini_error_response(error)

@mini_bp.route('/auth/login', methods=['POST'])
def login():
    """Authenticate cashier user for Mini system"""
    from app.models.user import User, UserRole
    from app.models.branch import Branch
    from app.models.employee import Employee, EmployeeType
    
    try:
        data = request.get_json()
        
        # Get credentials
        email = data.get('email') or data.get('username')
        password = data.get('password')
        
        # Validation
        if not email or not password:
            return jsonify({"error": "البريد الإلكتروني وكلمة المرور مطلوبان"}), 400
        
        # Find user by email
        user = User.query.filter_by(email=email).first()
        
        if not user:
            return jsonify({"error": "بيانات الدخول غير صحيحة"}), 401
        
        # Check password
        if not user.check_password(password):
            return jsonify({"error": "بيانات الدخول غير صحيحة"}), 401
        
        # Check if user is a cashier
        if user.role != UserRole.CASHIER:
            return jsonify({"error": "هذا الحساب غير مصرح له بالدخول إلى نظام الكاشير"}), 403
        
        # Check if user is active
        if not user.is_active:
            return jsonify({"error": "هذا الحساب غير نشط"}), 403
        
        # Check if user has a branch
        if not user.branch_id:
            return jsonify({"error": "لم يتم تعيين فرع لهذا المستخدم"}), 400
        
        # Get branch info
        branch = Branch.query.get(user.branch_id)
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404
        if not branch.is_active:
            return jsonify({"error": "الفرع غير نشط"}), 403
        if branch.is_main_warehouse:
            return jsonify({"error": "لا يمكن استخدام المخزن الرئيسي لتسجيل دخول الكاشير."}), 403
        
        # --- DEVICE BINDING SECURITY (CASHIER ONLY) ---
        device_id = data.get('device_id')
        if not device_id:
            return jsonify({"error": "معرف الجهاز (Device ID) مطلوب للدخول"}), 400

        try:
            registered_device = authorize_mini_login_device(
                branch,
                device_id,
                created_by_user_id=user.id,
                credential=_device_credential_cookie(),
            )
            if getattr(registered_device, "id", None) is not None:
                verify_login_assertion(
                    registered_device,
                    data.get("device_proof"),
                    origin=request.headers.get("Origin"),
                )
        except MiniDeviceAuthorizationError as auth_error:
            print(f"[SECURITY] Unauthorized access attempt for branch {branch.id} from device: {device_id}")
            payload = {"error": auth_error.error}
            if auth_error.details:
                payload["details"] = auth_error.details
            if auth_error.payload:
                payload.update(auth_error.payload)
            response = jsonify(payload)
            if auth_error.finalization_proof:
                _set_enrollment_proof_cookie(response, auth_error.finalization_proof)
            return response, auth_error.status_code

        # Find corresponding Employee record
        employee = Employee.query.filter_by(
            full_name=user.full_name,
            branch_id=user.branch_id,
            employee_type=EmployeeType.CASHIER
        ).first()
        
        if not employee:
            return jsonify({"error": "لم يتم العثور على سجل موظف (كاشير) لهذا المستخدم"}), 404
            
        # Generate JWT Tokens
        token_claims = {
            "token_type": "mini",
            "role": "CASHIER",
            "cashier_id": employee.id,
            "branch_id": branch.id,
            "name": employee.full_name
        }
        credential_verified = (
            getattr(registered_device, "credential_state", None)
            == MiniDeviceCredentialState.CREDENTIAL_ENABLED
        )
        token_claims.update(build_mini_device_jwt_claims(
            registered_device,
            credential_verified=credential_verified,
        ))
        access_token  = create_access_token(identity=str(user.id), additional_claims=token_claims)
        refresh_token = create_refresh_token(identity=str(user.id), additional_claims=token_claims)

        print(f"[AUTH] Mini login OK: user_id={user.id}, branch_id={branch.id}")

        # Return cashier info with both tokens
        # 'token' key kept for backward compatibility with existing clients
        return jsonify(_append_mini_device_context({
            "token": access_token,          # legacy key — keep
            "access_token": access_token,   # new canonical key
            "refresh_token": refresh_token,
            "cashier": {
                "id": employee.id,
                "user_id": user.id,
                "name": employee.full_name,
                "email": user.email,
                "branch_id": branch.id,
                "branch_name": branch.name,
                "branch_settings": {
                    "allow_discounts": branch.allow_discounts
                }
            }
        }, registered_device)), 200
        
    except Exception as e:
        print(f"Login error: {e}")
        return jsonify({"error": "حدث خطأ أثناء تسجيل الدخول"}), 500


@mini_bp.route('/auth/device-enrollments/<int:enrollment_id>/proof-challenge', methods=['POST'])
def issue_enrollment_proof_challenge(enrollment_id):
    if not _trusted_finalization_origin():
        return jsonify({
            "error": "DEVICE_FINALIZATION_ORIGIN_INVALID",
            "details": "مصدر طلب تفعيل الجهاز غير موثوق.",
        }), 403
    data = request.get_json(silent=True) or {}
    if not isinstance(data.get("device_id"), str) or not isinstance(data.get("public_key_jwk"), dict):
        return jsonify({
            "error": "DEVICE_PROOF_PUBLIC_KEY_REQUIRED",
            "details": "معرف الجهاز والمفتاح العام مطلوبان.",
        }), 400
    proof_cookie_name = current_app.config.get(
        "MINI_ENROLLMENT_PROOF_COOKIE_NAME",
        "mini_device_enrollment_proof",
    )
    try:
        result = create_enrollment_challenge(
            enrollment_id,
            device_id=data["device_id"],
            finalization_proof=request.cookies.get(proof_cookie_name),
            public_jwk=data["public_key_jwk"],
            origin=request.headers.get("Origin"),
        )
        return jsonify(result), 200
    except MiniDeviceSecurityError as error:
        return _mini_error_response(error)


@mini_bp.route('/auth/device-enrollments/<int:enrollment_id>/finalize', methods=['POST'])
def finalize_device_enrollment(enrollment_id):
    """Deliver a credential once to the exact browser that requested pairing."""
    if not _trusted_finalization_origin():
        return jsonify({
            "error": "DEVICE_FINALIZATION_ORIGIN_INVALID",
            "details": "مصدر طلب تفعيل الجهاز غير موثوق.",
        }), 403

    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get("device_id"), str):
        return jsonify({
            "error": "DEVICE_ID_REQUIRED",
            "details": "معرف الجهاز مطلوب لإكمال التفعيل.",
        }), 400

    proof_cookie_name = current_app.config.get(
        "MINI_ENROLLMENT_PROOF_COOKIE_NAME",
        "mini_device_enrollment_proof",
    )
    try:
        device, issued = finalize_approved_device_enrollment(
            enrollment_id,
            device_id=data["device_id"],
            finalization_proof=request.cookies.get(proof_cookie_name),
            proof_challenge_id=data.get("proof_challenge_id"),
            proof_challenge=data.get("proof_challenge"),
            device_proof=data.get("device_proof"),
            proof_public_key_jwk=data.get("public_key_jwk"),
            proof_origin=request.headers.get("Origin"),
        )
    except MiniDeviceSecurityError as error:
        return _mini_error_response(error)

    response = jsonify({
        "status": "success",
        "device_context": serialize_mini_device_context(device),
    })
    _set_device_credential_cookie(response, issued.credential)
    response.delete_cookie(
        proof_cookie_name,
        path="/api/mini/auth/device-enrollments",
        secure=current_app.config.get("MINI_DEVICE_COOKIE_SECURE", False),
        httponly=True,
        samesite=current_app.config.get("MINI_DEVICE_COOKIE_SAMESITE", "Lax"),
    )
    return response, 200


@mini_bp.route('/auth/device-credential/upgrade-request', methods=['POST'])
@require_cashier
def request_device_credential_upgrade():
    """Create an explicitly approvable re-pair request for a legacy device.

    This is the Phase-2 backend foundation only; no automatic upgrade occurs.
    """
    device = getattr(g, "mini_device", None)
    if not device or getattr(device, "id", None) is None:
        return jsonify({
            "error": "DEVICE_CREDENTIAL_UPGRADE_UNAVAILABLE",
            "details": "يجب أن يكون الجهاز مسجلاً قبل طلب الترقية.",
        }), 409
    challenge = claim_admin_authorized_device_repair(g.branch, device.device_id)
    if challenge is None:
        return jsonify({
            "error": "DEVICE_REPAIR_ADMIN_AUTHORIZATION_REQUIRED",
            "details": "يجب أن تبدأ الإدارة إعادة ربط هذا الجهاز أولاً.",
        }), 409
    response = jsonify({
        "status": "finalization_required",
        "pending_enrollment_id": challenge.enrollment_id,
        "expires_at": challenge.expires_at.isoformat(),
    })
    _set_enrollment_proof_cookie(response, challenge.finalization_proof)
    return response, 202


@mini_bp.route('/auth/me', methods=['GET'])
@require_cashier
def get_me():
    """
    Lightweight token validation endpoint.
    Returns 200 + cashier info if token is valid.
    Returns 401 automatically if token is expired or invalid (via require_cashier).
    Used by the Mini frontend to silently restore sessions on page refresh.
    """
    from app.models.employee import Employee

    try:
        employee = Employee.query.get(g.cashier_id)
        branch = _get_request_branch()

        if not employee or not branch:
            return jsonify({"error": "Cashier or branch not found"}), 404

        return jsonify(_append_mini_device_context({
            "id": employee.id,
            "name": employee.full_name,
            "branch_id": branch.id,
            "branch_name": branch.name,
            "branch_settings": {
                "allow_discounts": branch.allow_discounts
            }
        }, getattr(g, "mini_device", None))), 200

    except Exception as e:
        return jsonify({"error": "Failed to fetch session", "details": str(e)}), 500

# ============================================================================
# Token Refresh Endpoint
# ============================================================================


@mini_bp.route('/auth/proof/refresh-challenge', methods=['POST'])
def issue_refresh_proof_challenge():
    verify_jwt_in_request(refresh=True)
    claims = get_jwt()
    rejection = _mini_token_rejection(claims)
    if rejection is not None:
        return rejection
    if claims.get("role") != "CASHIER":
        return jsonify({"proof_required": False}), 200
    device_id = request.headers.get("X-Device-ID")
    refresh_token = _authorization_bearer_token()
    if not device_id or not refresh_token:
        return jsonify({"error": "DEVICE_ID_REQUIRED"}), 400
    try:
        _, branch = _load_active_cashier_runtime(
            get_jwt_identity(),
            claims.get("branch_id"),
        )
        device = resolve_authenticated_registered_device(
            branch,
            device_id,
            credential=_device_credential_cookie(),
        )
        enforce_mini_device_session_binding(device, claims)
        return jsonify(create_refresh_challenge(
            device,
            refresh_token,
            origin=request.headers.get("Origin"),
        )), 200
    except MiniDeviceSecurityError as error:
        return _mini_error_response(error)

@mini_bp.route('/auth/refresh', methods=['POST'])
def refresh_token():
    """
    Exchange a valid refresh token for a new access token.
    Refresh token must be passed as: Authorization: Bearer <refresh_token>
    Returns a new access_token only — does NOT issue a new refresh token.
    """
    # This validates the token AND enforces it is a refresh token.
    # Native flask_jwt_extended loaders will catch expirations and return a clean 401 JSON.
    verify_jwt_in_request(refresh=True)

    user_id = get_jwt_identity()
    claims  = get_jwt()
    rejection = _mini_token_rejection(claims)
    if rejection is not None:
        return rejection
    role    = claims.get('role')
    data = request.get_json(silent=True) or {}

    # --- DEVICE BINDING SECURITY (CASHIER ONLY) ---
    device_context = None

    if role == 'CASHIER':
        device_id = request.headers.get('X-Device-ID')
        branch_id = claims.get('branch_id')
        
        if not device_id:
             return jsonify({"error": "Unauthorized: Device ID header missing"}), 403
             
        try:
             _, branch = _load_active_cashier_runtime(user_id, branch_id)
             registered_device = resolve_authenticated_registered_device(
                 branch,
                 device_id,
                 credential=_device_credential_cookie(),
             )
             enforce_mini_device_session_binding(registered_device, claims)
             verify_refresh_assertion(
                 registered_device,
                 data.get("device_proof"),
                 _authorization_bearer_token() or "",
                 origin=request.headers.get("Origin"),
             )
             touch_registered_device(registered_device, commit=True)
             device_context = serialize_mini_device_context(registered_device)
        except MiniDeviceAuthorizationError as auth_error:
             print(f"[SECURITY] Token refresh blocked for branch {branch_id}: {auth_error.error}")
             payload = {"error": auth_error.error}
             if auth_error.details:
                 payload["details"] = auth_error.details
             if auth_error.payload:
                 payload.update(auth_error.payload)
             return jsonify(payload), auth_error.status_code

    # Preserve all original claims in the new access token
    new_claims = {
        "token_type": "mini",
        "role":       claims.get("role"),
        "cashier_id": claims.get("cashier_id"),
        "branch_id":  claims.get("branch_id"),
        "name":       claims.get("name"),
    }
    if role == 'CASHIER' and registered_device is not None:
        credential_verified = (
            getattr(registered_device, "credential_state", None)
            == MiniDeviceCredentialState.CREDENTIAL_ENABLED
        )
        if credential_verified:
            new_claims.update(build_mini_device_jwt_claims(
                registered_device,
                credential_verified=True,
            ))
    new_access_token = create_access_token(identity=user_id, additional_claims=new_claims)

    print(f"[AUTH] Mini token refreshed for user_id={user_id}")
    response_payload = {"access_token": new_access_token}
    if device_context is not None:
        response_payload["device_context"] = device_context
    return jsonify(response_payload), 200


# ============================================================================
# Invoice Endpoints
# ============================================================================



def _serialize_item(item: InvoiceItem) -> dict:
    return {
        "id": item.id,
        "item_type": item.item_type,
        "service_id": item.service_id,
        "service_name": item.service.name if item.service else None,
        "product_id": item.product_id,
        "product_name": item.product.name if item.product else None,
        "barber_id": item.barber_id,
        "barber_name": item.barber.full_name if item.barber else None,
        "assistant_id": item.assistant_id,
        "assistant_name": item.assistant.full_name if item.assistant else None,
        "assigned_employee_id": item.assigned_employee_id,
        "assigned_employee_name": item.assigned_employee.full_name if item.assigned_employee else None,
        "price": item.service_price,
        "quantity": item.quantity,
        "total": item.service_price * item.quantity,
        # Analytical data for frontend if needed
        "barber_commission": item.barber_commission_percent,
        "assistant_commission": item.assistant_commission_percent,
        "sales_commission_percent": float(item.sales_commission_percent or 0),
        "sales_commission_amount": float(item.sales_commission_amount or 0)
    }

def _serialize_invoice(invoice: Invoice) -> dict:
    from app.models.promo_code import PromoRedemption
    from app.services.booking_deposit_service import serialize_settlement
    redemption = PromoRedemption.query.filter_by(invoice_id=invoice.id).first()
    promo_data = None
    if redemption:
        promo_data = {
            "code": redemption.code_snapshot,
            "discount_type": redemption.discount_type_snapshot.value,
            "configured_value": str(redemption.discount_value_snapshot),
            "eligible_subtotal": float(redemption.eligible_subtotal),
            "discount_amount": float(redemption.promo_discount_amount),
            "version": redemption.promo_version_snapshot,
        }

    return {
        "id": invoice.id,
        "invoice_number": invoice.invoice_number,
        "branch_id": invoice.branch_id,
        "cashier_id": invoice.cashier_id,
        "status": invoice.status.value,
        "total_amount": invoice.total_amount,
        "discount_amount": invoice.discount_amount,
        "net_amount": invoice.total_amount - invoice.discount_amount,
        "promo": promo_data,
        "customer_id": invoice.customer_id,
        "booking_appointment_id": invoice.booking_appointment_id,
        "booking_multi_customer": invoice.booking_multi_customer,
        "deposit_settlement": serialize_settlement(invoice),
        "payment_method": invoice.payment_method.value if invoice.payment_method else None,
        # Safe array fallback for split payments vs legacy invoices
        "payments": (
            [
                {
                    "method": p.method.value,
                    "amount": float(p.amount),
                    "entered_amount": float(
                        p.entered_amount if p.entered_amount is not None else p.amount
                    ),
                }
                for p in invoice.invoice_payments
            ]
            if invoice.invoice_payments and len(invoice.invoice_payments) > 0
            else (
                [{
                    "method": invoice.payment_method.value,
                    "amount": float(invoice.total_amount),
                    "entered_amount": float(invoice.total_amount),
                }]
                if invoice.payment_method else []
            )
        ),
        # Change returned to customer (0 for exact/card payments)
        "change_amount": float(invoice.change_amount or 0),
        "items": [_serialize_item(item) for item in invoice.invoice_items],
        "customer_name": invoice.customer_name,
        "customer_phone": invoice.customer_phone,
        "created_at": invoice.created_at.isoformat() if invoice.created_at else None
    }

def _get_inventory_status(stock_quantity: int, min_stock_threshold: int) -> str:
    if stock_quantity <= 0:
        return "OUT"
    if stock_quantity <= max(0, int(min_stock_threshold or 0)):
        return "LOW"
    return "AVAILABLE"


def _normalize_optional_text(value):
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None

def _serialize_inventory_activity(movement) -> dict:
    reason = movement.notes or "استخدام داخلي"
    return {
        "id": movement.id,
        "movement_type": movement.movement_type.value,
        "product_id": movement.product_id,
        "product_name": movement.product.name if movement.product else f"منتج #{movement.product_id}",
        "image_url": movement.product.image_url if movement.product else None,
        "quantity": int(movement.quantity or 0),
        "branch_id": movement.branch_id,
        "branch_name": movement.branch.name if movement.branch else f"فرع #{movement.branch_id}",
        "reason": reason,
        "created_at": movement.created_at.isoformat() if movement.created_at else None,
    }

def _serialize_shipment_item(item) -> dict:
    return {
        "product_id": item.product_id,
        "product_name": item.product.name if item.product else f"منتج #{item.product_id}",
        "image_url": item.product.image_url if item.product else None,
        "quantity": int(item.quantity or 0),
    }

def _serialize_shipment_summary(shipment) -> dict:
    items = [_serialize_shipment_item(item) for item in shipment.items]
    total_quantity = sum(int(item["quantity"] or 0) for item in items)
    return {
        "id": shipment.id,
        "shipment_ref": shipment.shipment_ref,
        "status": shipment.status,
        "created_at": shipment.created_at.isoformat() if shipment.created_at else None,
        "source_branch_name": shipment.source_branch.name if shipment.source_branch else "المخزن الرئيسي",
        "destination_branch_id": shipment.destination_branch_id,
        "destination_branch_name": shipment.destination_branch.name if shipment.destination_branch else f"فرع #{shipment.destination_branch_id}",
        "items_count": len(items),
        "total_quantity": total_quantity,
        "note": shipment.note,
        "items_preview": items[:3],
    }

def _serialize_shipment_details(shipment) -> dict:
    items = [_serialize_shipment_item(item) for item in shipment.items]
    total_quantity = sum(int(item["quantity"] or 0) for item in items)
    return {
        "id": shipment.id,
        "shipment_ref": shipment.shipment_ref,
        "status": shipment.status,
        "created_at": shipment.created_at.isoformat() if shipment.created_at else None,
        "received_at": shipment.received_at.isoformat() if shipment.received_at else None,
        "source_branch_name": shipment.source_branch.name if shipment.source_branch else "المخزن الرئيسي",
        "destination_branch_id": shipment.destination_branch_id,
        "destination_branch_name": shipment.destination_branch.name if shipment.destination_branch else f"فرع #{shipment.destination_branch_id}",
        "items_count": len(items),
        "total_quantity": total_quantity,
        "note": shipment.note,
        "items": items,
    }

@mini_bp.route('/invoice/draft', methods=['POST'])
@require_cashier
def create_draft_invoice():
    # Use secure IDs from JWT claims (g), never trust request body for identity
    branch_id = g.branch_id
    cashier_id = g.cashier_id

    if not branch_id or not cashier_id:
        return jsonify({"error": "Unauthorized: Branch or Cashier identity missing from session"}), 401

    try:
        data = request.get_json(silent=True) or {}
        appointment_id = data.get('booking_appointment_id')
        if appointment_id is not None:
            from app.services.booking_handoff_service import get_or_create_draft
            if type(data.get('booking_multi_customer', False)) is not bool:
                raise ValueError('booking_multi_customer must be boolean')
            invoice, created = get_or_create_draft(appointment_id, branch_id, cashier_id, AuditActorContext.from_mini_request(), data.get('booking_multi_customer', False))
        else:
            invoice = InvoiceEngine.create_draft_invoice(branch_id=branch_id, cashier_id=cashier_id,
                actor_context=AuditActorContext.from_mini_request())
            created = True
        return jsonify({**_serialize_invoice(invoice), 'booking_draft_created': created}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500

@mini_bp.route('/invoice/<int:invoice_id>/items', methods=['POST'])
@require_cashier
def add_item_to_invoice(invoice_id):
    from app.models.invoice import Invoice
    
    # 1. Authorize: Ensure invoice exists and belongs to the current branch
    invoice_obj = Invoice.query.get(invoice_id)
    if not invoice_obj or invoice_obj.branch_id != g.branch_id:
        return jsonify({"error": "Invoice not found or access denied"}), 404

    data = request.get_json()
    if not data:
        return jsonify({"error": "No input data provided"}), 400
        
    service_id = data.get('service_id')
    barber_id = data.get('barber_id')
    quantity = data.get('quantity', 1)
    assistant_id = data.get('assistant_id')
    booking_prefill = data.get('booking_prefill', False)
    if type(booking_prefill) is not bool:
        return jsonify({'error': 'booking_prefill must be boolean'}), 400

    if not service_id or not barber_id:
        return jsonify({"error": "service_id and barber_id are required"}), 400

    try:
        updated_invoice = InvoiceEngine.add_item_to_invoice(
            invoice_id=invoice_id,
            service_id=service_id,
            barber_id=barber_id,
            assistant_id=assistant_id,
            quantity=quantity,
            actor_context=AuditActorContext.from_mini_request(),
            booking_prefill=booking_prefill,
        )
        return jsonify(_serialize_invoice(updated_invoice)), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500

@mini_bp.route('/invoice/<int:invoice_id>/items/<int:item_id>', methods=['DELETE'])
@require_cashier
def remove_item_from_invoice(invoice_id, item_id):
    from app.models.invoice import Invoice
    
    # 1. Authorize: Ensure invoice belongs to the current branch
    invoice_obj = Invoice.query.get(invoice_id)
    if not invoice_obj or invoice_obj.branch_id != g.branch_id:
        return jsonify({"error": "Invoice not found or access denied"}), 404

    try:
        updated_invoice = InvoiceEngine.remove_item_from_invoice(
            invoice_id=invoice_id,
            item_id=item_id,
            actor_context=AuditActorContext.from_mini_request(),
        )
        return jsonify(_serialize_invoice(updated_invoice)), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500

@mini_bp.route('/products', methods=['GET'])
@require_cashier
def get_mini_products():
    """
    Get active products with positive branch stock levels and selling price > 0.
    Supports include_zero_stock=true query parameter to fetch all active products for the branch.
    """
    from app.models.product import Product, ProductBranchStock
    try:
        include_zero_stock = request.args.get('include_zero_stock', 'false').lower() == 'true'
        
        query = db.session.query(
            Product.id,
            Product.name,
            Product.selling_price,
            Product.unit,
            Product.category,
            Product.image_url,
            Product.sales_commission_percent,
            ProductBranchStock.stock_quantity
        ).join(
            ProductBranchStock,
            db.and_(
                ProductBranchStock.product_id == Product.id,
                ProductBranchStock.branch_id == g.branch_id
            ),
            isouter=True
        ).filter(
            Product.is_active == True,
            Product.selling_price > 0.0
        )
        
        if not include_zero_stock:
            query = query.filter(
                ProductBranchStock.is_available == True,
                ProductBranchStock.stock_quantity > 0
            )
            
        results = query.order_by(Product.name.asc()).all()

        products = []
        for row in results:
            p_id, p_name, p_price, p_unit, p_category, p_image_url, p_commission_pct, p_qty = row
            products.append({
                "id": p_id,
                "name": p_name,
                "selling_price": p_price,
                "unit": p_unit,
                "category": p_category,
                "image_url": p_image_url,
                "stock_quantity": p_qty if p_qty is not None else 0,
                "sales_commission_percent": float(p_commission_pct or 0)
            })
        return jsonify(products), 200
    except Exception as e:
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@mini_bp.route('/products/search', methods=['GET'])
@require_cashier
def search_mini_products():
    from app.models.product import Product, ProductBranchStock

    try:
        include_zero_stock = request.args.get('include_zero_stock', 'false').lower() == 'true'
        limit = min(50, max(1, int(request.args.get('limit', 20))))
        query_text = (request.args.get('q') or '').strip()

        states = location_stock_states([g.branch_id])
        query = (
            db.session.query(
                Product.id,
                Product.name,
                Product.unit,
                Product.category,
                Product.image_url,
                Product.selling_price,
                Product.min_stock_threshold,
                states.c.stock_status,
                func.coalesce(ProductBranchStock.stock_quantity, 0).label('stock_quantity'),
            )
            .outerjoin(
                ProductBranchStock,
                db.and_(
                    ProductBranchStock.product_id == Product.id,
                    ProductBranchStock.branch_id == g.branch_id,
                ),
            )
            .outerjoin(states, db.and_(states.c.product_id == Product.id, states.c.branch_id == g.branch_id))
            .filter(
                Product.is_active == True,
                Product.selling_price > 0.0,
            )
        )

        if query_text:
            pattern = f"%{query_text}%"
            query = query.filter(
                or_(
                    Product.name.ilike(pattern),
                    Product.category.ilike(pattern),
                )
            )

        if not include_zero_stock:
            query = query.filter(
                ProductBranchStock.is_available == True,
                ProductBranchStock.stock_quantity > 0,
            )

        rows = (
            query
            .order_by(Product.name.asc(), Product.id.asc())
            .limit(limit)
            .all()
        )

        return jsonify([{
            "id": row.id,
            "name": row.name,
            "unit": row.unit,
            "category": row.category,
            "image_url": row.image_url,
            "selling_price": float(row.selling_price or 0),
            "stock_quantity": int(row.stock_quantity or 0),
            "min_stock_threshold": int(row.min_stock_threshold or 0),
            "status": legacy_mini_status(row.stock_status or 'UNKNOWN'),
        } for row in rows]), 200
    except ValueError:
        return jsonify({"error": "Invalid search parameters."}), 400
    except Exception as e:
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500

@mini_bp.route('/inventory', methods=['GET'])
@require_cashier
def get_branch_inventory():
    from app.models.branch import Branch
    from app.models.product import Product, ProductBranchStock, StockMovement, StockMovementType

    try:
        if not g.branch_id:
            return jsonify({"error": "Branch context is missing"}), 400

        branch = _get_request_branch()
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404
        if branch.is_main_warehouse:
            return jsonify({"error": "لا يمكن عرض بيانات المخزن الرئيسي داخل Mini."}), 403

        states = location_stock_states([g.branch_id])

        stock_rows = (
            db.session.query(ProductBranchStock, Product, states.c.stock_status)
            .join(Product, Product.id == ProductBranchStock.product_id)
            .join(states, db.and_(states.c.product_id == Product.id, states.c.branch_id == g.branch_id))
            .filter(
                ProductBranchStock.branch_id == g.branch_id,
                ProductBranchStock.is_available == True,
                Product.is_active == True,
            )
            .order_by(Product.name.asc())
            .all()
        )

        products = []
        for stock_row, product, stock_status in stock_rows:
            quantity = int(stock_row.stock_quantity or 0)
            if stock_status == 'UNKNOWN':
                continue

            products.append({
                "product_id": product.id,
                "name": product.name,
                "image_url": product.image_url,
                "category": product.category,
                "selling_price": float(product.selling_price or 0),
                "unit": product.unit,
                "stock_quantity": quantity,
                "min_stock_threshold": int(product.min_stock_threshold or 0),
                "status": legacy_mini_status(stock_status),
                "stock_status": stock_status,
            })

        recent_consumption = (
            StockMovement.query
            .join(Product, Product.id == StockMovement.product_id)
            .join(Branch, Branch.id == StockMovement.branch_id)
            .filter(
                StockMovement.branch_id == g.branch_id,
                StockMovement.movement_type == StockMovementType.INTERNAL_CONSUMPTION,
            )
            .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
            .limit(8)
            .all()
        )

        return jsonify({
            "branch": {
                "id": branch.id,
                "name": branch.name,
            },
            "products": products,
            "recent_activity": [_serialize_inventory_activity(movement) for movement in recent_consumption],
        }), 200
    except Exception as e:
        return jsonify({"error": "Failed to fetch branch inventory", "details": str(e)}), 500


@mini_bp.route('/inventory/summary', methods=['GET'])
@require_cashier
def get_branch_inventory_summary():
    from sqlalchemy import func
    from app.models.supply_operations import StockReturnRequest, StockSupplyRequest

    try:
        if not g.branch_id:
            return jsonify({"error": "Branch context is missing"}), 400

        branch = _get_request_branch()
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404
        if branch.is_main_warehouse:
            return jsonify({"error": "لا يمكن عرض بيانات المخزن الرئيسي داخل Mini."}), 403

        active_supply_requests = (
            db.session.query(func.count(StockSupplyRequest.id))
            .filter(
                StockSupplyRequest.branch_id == g.branch_id,
                StockSupplyRequest.status.in_(['PENDING', 'SENT']),
            )
            .scalar()
            or 0
        )
        pending_supply_requests = (
            db.session.query(func.count(StockSupplyRequest.id))
            .filter(
                StockSupplyRequest.branch_id == g.branch_id,
                StockSupplyRequest.status == 'PENDING',
            )
            .scalar()
            or 0
        )
        pending_returns = (
            db.session.query(func.count(StockReturnRequest.id))
            .filter(
                StockReturnRequest.branch_id == g.branch_id,
                StockReturnRequest.status == 'PENDING',
            )
            .scalar()
            or 0
        )

        return jsonify({
            "active_supply_requests": int(active_supply_requests),
            "pending_supply_requests": int(pending_supply_requests),
            "pending_returns": int(pending_returns),
        }), 200
    except Exception as e:
        return jsonify({"error": "Failed to fetch branch inventory summary", "details": str(e)}), 500

@mini_bp.route('/inventory/activity', methods=['GET'])
@require_cashier
def get_product_activity_log():
    """
    GET /api/mini/inventory/activity
    Returns branch-scoped product activity (PRODUCT_SALE + INTERNAL_CONSUMPTION only).
    Query params: start_date, end_date, type=all|sales|consumption, q, page, per_page
    """
    from app.models.product import Product, StockMovement, StockMovementType
    from app.models.invoice import Invoice
    from app.models.employee import Employee
    from datetime import datetime, timezone, timedelta

    try:
        if not g.branch_id:
            return jsonify({"error": "Branch context is missing"}), 400

        branch = _get_request_branch()
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404
        if branch.is_main_warehouse:
            return jsonify({"error": "لا يمكن عرض بيانات المخزن الرئيسي داخل Mini."}), 403

        # --- Parse query params ---
        activity_type = (request.args.get('type') or 'all').strip().lower()  # all | sales | consumption
        q = ((request.args.get('q') or request.args.get('search') or '')).strip()
        page, per_page = _parse_mini_bounded_pagination(default_per_page=20, max_per_page=50)

        start_date_str = request.args.get('start_date')
        end_date_str = request.args.get('end_date')

        # Default: today (Cairo timezone approximated as UTC+3)
        now_utc = datetime.now(timezone.utc)
        cairo_offset = timedelta(hours=3)
        today_cairo = (now_utc + cairo_offset).date()

        if start_date_str:
            try:
                start_dt = datetime.strptime(start_date_str, '%Y-%m-%d').replace(tzinfo=timezone.utc)
            except ValueError:
                return jsonify({"error": "Invalid start_date format. Use YYYY-MM-DD"}), 400
        else:
            start_dt = datetime(today_cairo.year, today_cairo.month, today_cairo.day, 0, 0, 0, tzinfo=timezone.utc) - cairo_offset

        if end_date_str:
            try:
                end_dt = datetime.strptime(end_date_str, '%Y-%m-%d').replace(tzinfo=timezone.utc) + timedelta(days=1)
            except ValueError:
                return jsonify({"error": "Invalid end_date format. Use YYYY-MM-DD"}), 400
        else:
            end_dt = datetime(today_cairo.year, today_cairo.month, today_cairo.day, 23, 59, 59, tzinfo=timezone.utc) - cairo_offset + timedelta(seconds=1)

        # --- Determine movement types to include ---
        allowed_types = []
        if activity_type == 'sales':
            allowed_types = [StockMovementType.PRODUCT_SALE]
        elif activity_type == 'consumption':
            allowed_types = [StockMovementType.INTERNAL_CONSUMPTION]
        else:
            allowed_types = [StockMovementType.PRODUCT_SALE, StockMovementType.INTERNAL_CONSUMPTION]

        filters = [
            StockMovement.branch_id == g.branch_id,
            StockMovement.movement_type.in_(allowed_types),
            StockMovement.created_at >= start_dt,
            StockMovement.created_at < end_dt,
        ]

        query = (
            StockMovement.query
            .join(Product, Product.id == StockMovement.product_id)
            .options(
                joinedload(StockMovement.product),
                joinedload(StockMovement.employee),
                joinedload(StockMovement.invoice).joinedload(Invoice.cashier),
            )
            .filter(*filters)
        )

        if q:
            query = query.filter(Product.name.ilike(f'%{q}%'))

        summary_query = (
            db.session.query(
                func.count(StockMovement.id).label('total_movements'),
                func.coalesce(
                    func.sum(
                        case(
                            (StockMovement.movement_type == StockMovementType.PRODUCT_SALE, StockMovement.quantity),
                            else_=0,
                        )
                    ),
                    0,
                ).label('total_sales_qty'),
                func.coalesce(
                    func.sum(
                        case(
                            (StockMovement.movement_type == StockMovementType.INTERNAL_CONSUMPTION, StockMovement.quantity),
                            else_=0,
                        )
                    ),
                    0,
                ).label('total_consumption_qty'),
            )
            .select_from(StockMovement)
            .join(Product, Product.id == StockMovement.product_id)
            .filter(*filters)
        )

        if q:
            summary_query = summary_query.filter(Product.name.ilike(f'%{q}%'))

        summary_row = summary_query.one()
        total_movements = int(summary_row.total_movements or 0)
        total_sales_qty = int(summary_row.total_sales_qty or 0)
        total_consumption_qty = int(summary_row.total_consumption_qty or 0)
        total_pages = (total_movements + per_page - 1) // per_page if total_movements > 0 else 0

        if total_pages > 0 and page > total_pages:
            page = total_pages

        page_rows = (
            query
            .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
            .limit(per_page)
            .offset((page - 1) * per_page)
            .all()
        )

        def serialize_activity_item(movement):
            is_sale = movement.movement_type == StockMovementType.PRODUCT_SALE

            # Actor: prefer employee full_name, fallback invoice cashier
            actor_name = None
            if movement.employee:
                actor_name = movement.employee.full_name
            elif movement.invoice and movement.invoice.cashier:
                actor_name = movement.invoice.cashier.full_name

            # Invoice number (only for sales)
            invoice_number = None
            if is_sale and movement.invoice and movement.invoice.invoice_number is not None:
                invoice_number = movement.invoice.invoice_number

            return {
                "id": movement.id,
                "type": "PRODUCT_SALE" if is_sale else "INTERNAL_CONSUMPTION",
                "product_id": movement.product_id,
                "product_name": movement.product.name if movement.product else f"منتج #{movement.product_id}",
                "product_image_url": movement.product.image_url if movement.product else None,
                "product_unit": movement.product.unit if movement.product else "",
                "quantity": int(movement.quantity or 0),
                "invoice_number": invoice_number,
                "reason": movement.notes if not is_sale else None,
                "actor_name": actor_name,
                "created_at": movement.created_at.isoformat() if movement.created_at else None,
            }

        items = [serialize_activity_item(movement) for movement in page_rows]

        return jsonify({
            "items": items,
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total_movements,
                "pages": total_pages,
                "has_next": total_pages > 0 and page < total_pages,
                "has_prev": page > 1,
            },
            "summary": {
                "total_sales_qty": total_sales_qty,
                "total_consumption_qty": total_consumption_qty,
                "total_movements": total_movements,
            },
        }), 200

    except Exception as e:
        return jsonify({"error": "Failed to fetch product activity", "details": str(e)}), 500

@mini_bp.route('/inventory/products/<int:product_id>/details', methods=['GET'])
@require_cashier
def get_mini_product_details(product_id):
    """
    GET /api/mini/inventory/products/<int:product_id>/details
    Returns lazily loaded batch details of a product for the cashier's branch.
    """
    from app.models.product import Product, ProductBranchStock
    from app.services.inventory_batch_service import build_product_batch_summary

    try:
        if not g.branch_id:
            return jsonify({"error": "Branch context is missing"}), 400

        product = Product.query.get(product_id)
        if not product or not product.is_active:
            return jsonify({"error": "المنتج غير موجود أو غير نشط."}), 404

        stock_row = ProductBranchStock.query.filter_by(
            product_id=product_id, branch_id=g.branch_id
        ).first()

        quantity = int(stock_row.stock_quantity or 0) if stock_row else 0

        states = location_stock_states([g.branch_id], [product_id])
        stock_status = db.session.query(states.c.stock_status).scalar() or 'UNKNOWN'

        # Build batch summary using the service helper
        batch_summary = build_product_batch_summary(product_id, branch_id=g.branch_id)

        # Build product payload
        product_payload = {
            "product_id": product.id,
            "name": product.name,
            "image_url": product.image_url,
            "category": product.category,
            "selling_price": float(product.selling_price or 0),
            "unit": product.unit,
            "stock_quantity": quantity,
            "min_stock_threshold": int(product.min_stock_threshold or 0),
            "status": legacy_mini_status(stock_status),
            "stock_status": stock_status,
            "nearest_expiration": batch_summary.get("nearest_expiration"),
            "nearest_expiration_days": batch_summary.get("nearest_expiration_days"),
            "latest_received_at": batch_summary.get("latest_received_at"),
        }

        return jsonify({
            "product": product_payload,
            "total_stock": quantity,
            "nearest_expiration": batch_summary.get("nearest_expiration"),
            "nearest_expiration_days": batch_summary.get("nearest_expiration_days"),
            "latest_received_at": batch_summary.get("latest_received_at"),
            "batches": batch_summary.get("batches", []),
        }), 200

    except Exception as e:
        return jsonify({"error": "Failed to fetch product details", "details": str(e)}), 500

@mini_bp.route('/shipments/incoming', methods=['GET'])
@require_cashier
def list_incoming_shipments():
    from sqlalchemy.orm import joinedload
    from app.models.supply_operations import StockShipment, StockShipmentItem

    try:
        if not g.branch_id:
            return jsonify({"error": "Branch context is missing"}), 400

        branch = _get_request_branch()
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404
        if branch.is_main_warehouse:
            return jsonify({"error": "لا يمكن عرض شحنات المخزن الرئيسي داخل Mini."}), 403

        shipments = (
            StockShipment.query
            .options(
                joinedload(StockShipment.source_branch),
                joinedload(StockShipment.destination_branch),
                joinedload(StockShipment.items).joinedload(StockShipmentItem.product)
            )
            .filter(
                StockShipment.destination_branch_id == g.branch_id,
                StockShipment.status == 'IN_TRANSIT',
            )
            .order_by(StockShipment.created_at.desc(), StockShipment.id.desc())
            .all()
        )

        return jsonify([_serialize_shipment_summary(shipment) for shipment in shipments]), 200
    except Exception as e:
        return jsonify({"error": "Failed to fetch incoming shipments", "details": str(e)}), 500

@mini_bp.route('/shipments/<int:shipment_id>', methods=['GET'])
@require_cashier
def get_incoming_shipment(shipment_id):
    from sqlalchemy.orm import joinedload
    from app.models.supply_operations import StockShipment, StockShipmentItem

    try:
        if not g.branch_id:
            return jsonify({"error": "Branch context is missing"}), 400

        branch = _get_request_branch()
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404
        if branch.is_main_warehouse:
            return jsonify({"error": "لا يمكن عرض شحنات المخزن الرئيسي داخل Mini."}), 403

        shipment = (
            StockShipment.query
            .options(
                joinedload(StockShipment.source_branch),
                joinedload(StockShipment.destination_branch),
                joinedload(StockShipment.items).joinedload(StockShipmentItem.product)
            )
            .filter_by(id=shipment_id, destination_branch_id=g.branch_id)
            .first()
        )

        if not shipment:
            return jsonify({"error": "الشحنة غير موجودة"}), 404

        return jsonify(_serialize_shipment_details(shipment)), 200
    except Exception as e:
        return jsonify({"error": "Failed to fetch shipment details", "details": str(e)}), 500

@mini_bp.route('/shipments/<int:shipment_id>/receive', methods=['POST'])
@require_cashier
def receive_incoming_shipment(shipment_id):
    from app.models.product import ProductBranchStock, StockMovement, StockMovementType
    from app.models.supply_operations import StockShipment

    try:
        if not g.branch_id:
            return jsonify({"error": "Branch context is missing"}), 400

        branch = _get_request_branch()
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404
        if branch.is_main_warehouse:
            return jsonify({"error": "لا يمكن استلام شحنات المخزن الرئيسي داخل Mini."}), 403

        shipment = (
            StockShipment.query.populate_existing()
            .filter_by(id=shipment_id, destination_branch_id=g.branch_id)
            .with_for_update()
            .first()
        )

        if not shipment:
            return jsonify({"error": "الشحنة غير موجودة"}), 404
        if shipment.status == 'RECEIVED':
            return jsonify({"error": "تم استلام هذه الشحنة بالفعل."}), 409
        if shipment.status == 'CANCELLED':
            return jsonify({"error": "تم إلغاء هذه الشحنة ولا يمكن استلامها."}), 409
        if shipment.status != 'IN_TRANSIT':
            return jsonify({"error": "حالة الشحنة لا تسمح بالاستلام."}), 400

        source_branch_name = shipment.source_branch.name if shipment.source_branch else "المخزن الرئيسي"
        movement_note = f"[{shipment.shipment_ref}] استلام شحنة من {source_branch_name}"

        pairs = [(item.product_id, g.branch_id) for item in shipment.items]
        locked_stocks = lock_product_stocks(pairs, create_missing=pairs)
        for item in shipment.items:
            stock = locked_stocks[(item.product_id, g.branch_id)]
            balance_before = stock.stock_quantity
            stock.stock_quantity += int(item.quantity or 0)
            stock.is_available = True

            db.session.add(capture_stock_movement(stock, balance_before,
                product_id=item.product_id,
                branch_id=g.branch_id,
                movement_type=StockMovementType.TRANSFER_IN,
                quantity=int(item.quantity or 0),
                created_by=g.cashier_id if hasattr(g, 'cashier_id') and g.cashier_id else None,
                notes=movement_note
            ))

        shipment.status = 'RECEIVED'
        shipment.received_at = get_utc_now()
        shipment.received_by_employee_id = g.cashier_id if hasattr(g, 'cashier_id') and g.cashier_id else None

        # Update linked StockSupplyRequest status to RECEIVED if exists
        from app.models.supply_operations import StockSupplyRequest
        linked_req = StockSupplyRequest.query.filter_by(shipment_id=shipment.id).first()
        if linked_req:
            linked_req.status = 'RECEIVED'

        db.session.commit()

        return jsonify({
            "message": "تم استلام الشحنة وإضافتها لمخزن الفرع.",
            "shipment": _serialize_shipment_details(shipment),
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to receive shipment", "details": str(e)}), 500

@mini_bp.route('/products/consume', methods=['POST'])
@require_cashier
def consume_mini_product():
    from app.models.product import Product, ProductBranchStock, StockMovement, StockMovementType

    try:
        if not g.branch_id:
            return jsonify({"error": "Branch context is missing"}), 400

        branch = _get_request_branch()
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404
        if branch.is_main_warehouse:
            return jsonify({"error": "لا يمكن تنفيذ الاستهلاك من المخزن الرئيسي داخل Mini."}), 403

        data = request.get_json() or {}
        product_id = data.get('product_id')
        quantity = data.get('quantity')
        reason = str(data.get('reason') or 'استخدام داخلي').strip()
        note = str(data.get('note') or '').strip()
        allowed_reasons = {'استخدام داخلي', 'تالف', 'تنظيف', 'أخرى'}

        try:
            product_id = int(product_id)
            quantity = int(quantity)
        except (TypeError, ValueError):
            return jsonify({"error": "بيانات المنتج أو الكمية غير صحيحة."}), 400

        if quantity <= 0:
            return jsonify({"error": "الكمية يجب أن تكون أكبر من الصفر."}), 400
        if reason not in allowed_reasons:
            return jsonify({"error": "سبب الاستهلاك غير صحيح."}), 400

        product = Product.query.get(product_id)
        if not product or not product.is_active:
            return jsonify({"error": "المنتج غير موجود أو غير نشط."}), 404

        stock = lock_product_stocks([(product_id, g.branch_id)])[(product_id, g.branch_id)]
        if stock and not stock.is_available:
            stock = None

        if not stock or int(stock.stock_quantity or 0) < quantity:
            return jsonify({"error": "الكمية غير متاحة في هذا الفرع."}), 400

        balance_before = stock.stock_quantity
        stock.stock_quantity -= quantity

        if reason == 'أخرى':
            notes = f"أخرى - {note}" if note else "أخرى"
        else:
            notes = reason

        movement = capture_stock_movement(stock, balance_before,
            product_id=product_id,
            branch_id=g.branch_id,
            movement_type=StockMovementType.INTERNAL_CONSUMPTION,
            quantity=quantity,
            created_by=g.cashier_id if hasattr(g, 'cashier_id') and g.cashier_id else None,
            notes=notes
        )
        db.session.add(movement)
        db.session.commit()

        return jsonify({
            "message": "تم تسجيل الاستهلاك بنجاح.",
            "product": {
                "product_id": product.id,
                "name": product.name,
                "image_url": product.image_url,
                "category": product.category,
                "selling_price": float(product.selling_price or 0),
                "unit": product.unit,
                "stock_quantity": int(stock.stock_quantity or 0),
                "min_stock_threshold": int(product.min_stock_threshold or 0),
                "status": _get_inventory_status(int(stock.stock_quantity or 0), int(product.min_stock_threshold or 0)),
            },
            "activity": _serialize_inventory_activity(movement),
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to record consumption", "details": str(e)}), 500

@mini_bp.route('/invoice/<int:invoice_id>/products', methods=['POST'])
@require_cashier
def add_product_to_invoice(invoice_id):
    from app.models.invoice import Invoice
    
    # 1. Authorize: Ensure invoice exists and belongs to the current branch
    invoice_obj = Invoice.query.get(invoice_id)
    if not invoice_obj or invoice_obj.branch_id != g.branch_id:
        return jsonify({"error": "Invoice not found or access denied"}), 404

    data = request.get_json()
    if not data:
        return jsonify({"error": "No input data provided"}), 400
        
    product_id = data.get('product_id')
    quantity = data.get('quantity', 1)
    assigned_employee_id = data.get('assigned_employee_id')

    if not product_id:
        return jsonify({"error": "product_id is required"}), 400
    if not assigned_employee_id:
        return jsonify({"error": "اختر الموظف المسؤول عن بيع المنتج."}), 400

    try:
        updated_invoice = InvoiceEngine.add_product_to_invoice(
            invoice_id=invoice_id,
            product_id=product_id,
            quantity=quantity,
            assigned_employee_id=assigned_employee_id,
            actor_context=AuditActorContext.from_mini_request(),
        )
        return jsonify(_serialize_invoice(updated_invoice)), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500

@mini_bp.route('/services', methods=['GET'])
@require_cashier
def get_services():
    """
    Get ALL active services globally — no branch filtering.
    Services are global: any branch sees all active services.
    Source of Truth: Service table directly (no BranchService JOIN).
    """
    from app.extensions import db
    from app.models.service import Service, ServiceCategory, CommissionType

    # Build the query: directly from Service, LEFT JOIN for Categories
    # No BranchService filtering — services are global
    results = db.session.query(
        Service.id,
        Service.name,
        Service.price,
        Service.category_id,
        ServiceCategory.name.label('category_name'),
        ServiceCategory.commission_type.label('comm_type'),
        Service.barber_commission_percent,
        Service.assistant_commission_percent
    ).outerjoin(ServiceCategory, Service.category_id == ServiceCategory.id)\
     .filter(Service.is_active == True)\
     .filter(db.or_(ServiceCategory.is_active == True, ServiceCategory.id == None))\
     .order_by(Service.name.asc())\
     .all()

    # Grouping by category (UI expects this nested structure)
    categories_map = {}
    for row in results:
        s_id, s_name, s_price, s_cat_id, cat_name, comm_type, s_barber_comm, s_asst_comm = row

        cid   = s_cat_id if s_cat_id is not None else 0
        cname = cat_name if cat_name else "خدمات عامة"

        if cid not in categories_map:
            categories_map[cid] = {"id": cid, "name": cname, "services": []}

        categories_map[cid]["services"].append({
            "id":                           s_id,
            "name":                         s_name,
            "price":                        s_price,
            "category_id":                  s_cat_id,
            "commission_type":              comm_type.value if hasattr(comm_type, 'value') else "BARBER_ONLY",
            "barber_commission_percent":    s_barber_comm,
            "assistant_commission_percent": s_asst_comm,
            "has_assistant":                (comm_type == CommissionType.BARBER_AND_ASSISTANT) if hasattr(comm_type, 'value') else False
        })

    # Sort categories: Newest first (ID desc)
    sorted_categories = sorted(categories_map.values(), key=lambda x: int(x['id']), reverse=True)
    res_data = {"categories": sorted_categories}

    if not res_data["categories"]:
        return jsonify({
            "debug":    True,
            "rows":     [],
            "message":  "No active services found"
        }), 200

    return jsonify(res_data), 200




@mini_bp.route('/barbers', methods=['GET'])
@require_cashier
def get_barbers():
    """Get barbers who are PRESENT today for the authenticated branch"""
    from app.models.employee import Employee, EmployeeType
    from app.models.attendance import Attendance, AttendanceStatus
    
    today = get_cairo_date()
    
    # Get barbers who are PRESENT today
    barbers = db.session.query(Employee).join(
        Attendance,
        db.and_(
            Attendance.employee_id == Employee.id,
            Attendance.date == today
        )
    ).filter(
        Employee.employee_type == EmployeeType.BARBER,
        Employee.branch_id == g.branch_id,
        Employee.is_active == True,
        Attendance.status == AttendanceStatus.PRESENT
    ).all()
    
    return jsonify([{
        "id": b.id,
        "name": b.full_name,
        "image_url": b.image_url
    } for b in barbers]), 200

@mini_bp.route('/assistants', methods=['GET'])
@require_cashier
def get_assistants():
    """Get assistants who are PRESENT today for the authenticated branch"""
    from app.models.employee import Employee, EmployeeType
    from app.models.attendance import Attendance, AttendanceStatus
    
    today = get_cairo_date()
    
    # Get assistants who are PRESENT today
    assistants = db.session.query(Employee).join(
        Attendance,
        db.and_(
            Attendance.employee_id == Employee.id,
            Attendance.date == today
        )
    ).filter(
        Employee.employee_type == EmployeeType.ASSISTANT,
        Employee.branch_id == g.branch_id,
        Employee.is_active == True,
        Attendance.status == AttendanceStatus.PRESENT
    ).all()
    
    return jsonify([{
        "id": a.id,
        "name": a.full_name,
        "image_url": a.image_url
    } for a in assistants]), 200

@mini_bp.route('/employees', methods=['GET'])
@require_cashier
def get_employees_mini():
    """
    Get employees (Barbers & Assistants) for the current branch.
    Used for selection in Mini system.
    """
    from app.models.employee import Employee, EmployeeType
    
    try:
        # Filter:
        # 1. Branch ID (from header/g)
        # 2. Role (Barber or Assistant) - Cashiers/Admins don't perform services
        # 3. Active only
        
        employees = Employee.query.filter(
            Employee.branch_id == g.branch_id,
            Employee.employee_type.in_([EmployeeType.BARBER, EmployeeType.ASSISTANT]),
            Employee.is_active == True
        ).order_by(Employee.id.desc()).all()
        
        return jsonify([{
            "id": e.id,
            "full_name": e.full_name,
            "role": e.employee_type.value,
            "employee_type": e.employee_type.value,
            "phone": e.phone,
            "image_url": e.image_url
        } for e in employees]), 200
        
    except Exception as e:
        return jsonify({"error": "Failed to fetch employees", "details": str(e)}), 500


# ============================================================================
# BUSINESS DAY ENDPOINTS
# ============================================================================

@mini_bp.route('/business-day/open', methods=['POST'])
@require_cashier
def open_business_day():
    """
    Open a new BusinessDay for the authenticated branch.

    Rules:
    - opening_balance is always Decimal('0.00') — ZERO-RESET mode (register
      cleared between every business day).
    - Returns 400 if an OPEN BusinessDay already exists for this branch.
    - branch_id and opened_by are taken exclusively from the JWT token.
    - previous_day_id is set to the most recent CLOSED day for this branch
      (NULL if this is the very first day), establishing the chain-of-custody
      link without carrying a balance forward.
    - The previous CLOSED day is locked with SELECT FOR UPDATE so that
      concurrent open requests cannot race against the same anchor row.
    - Everything runs inside a single transaction (no intermediate commits).
    - No side effects on invoices, expenses, or any other model.
    """
    from app.models.business_day import BusinessDay, BusinessDayStatus
    from app.models.employee import Employee
    from decimal import Decimal
    from datetime import datetime, timezone

    try:
        # ── Branch isolation — JWT only ──────────────────────────────────────
        branch_id  = g.branch_id
        cashier_id = g.cashier_id   # employee id of the logged-in cashier
        
        # DIAGNOSTIC: Log branch_id in open query
        print(f"[OPEN] branch_id={branch_id} (type={type(branch_id).__name__}), cashier_id={cashier_id}")

        # Verify the employee record exists (belt-and-suspenders)
        cashier = Employee.query.get(cashier_id)
        if not cashier:
            return jsonify({"error": "Cashier employee record not found"}), 404

        # ── Guard: only one OPEN day per branch ──────────────────────────────
        # Regular read — if an OPEN day already exists we return immediately
        # without acquiring any locks.
        existing = BusinessDay.query.filter_by(
            branch_id=branch_id,
            status=BusinessDayStatus.OPEN
        ).first()
        
        # DIAGNOSTIC: Log check result
        print(f"[OPEN] Existing OPEN check result: found={existing is not None}")
        if existing:
            print(f"[OPEN] Found existing OPEN day: id={existing.id}, branch_id={existing.branch_id}")

        if existing:
            return jsonify({
                "error": "A business day is already open.",
                "open_since": existing.opened_at.isoformat() if existing.opened_at else None,
                "business_day_id": existing.id
            }), 400

        # ── Fetch previous CLOSED day (SELECT FOR UPDATE) ─────────────────────
        # Locking the most recent CLOSED row serialises concurrent open attempts
        # so that only one request can anchor itself to the same previous day.
        # The lock is held until the INSERT + commit below complete atomically.
        previous_day = (
            BusinessDay.query
            .filter_by(branch_id=branch_id, status=BusinessDayStatus.CLOSED)
            .order_by(BusinessDay.closed_at.desc())
            .with_for_update()
            .first()
        )

        previous_day_id = previous_day.id if previous_day else None

        # ── Create new BusinessDay ────────────────────────────────────────────
        # ZERO-RESET mode: opening_balance is always 0 (register emptied daily).
        # previous_day_id links this day into the auditable chain without
        # carrying forward a non-zero balance.
        business_day = BusinessDay(
            branch_id=branch_id,
            opened_by=cashier_id,
            opened_at=datetime.now(timezone.utc),
            status=BusinessDayStatus.OPEN,
            opening_balance=Decimal('0.00'),
            previous_day_id=previous_day_id
        )

        db.session.add(business_day)
        # Force the full business-day + attendance mutation set to be validated
        # before the single final commit so any flush-time failure rolls back all.
        db.session.flush()
        db.session.commit()   # releases the FOR UPDATE lock

        return jsonify({
            "id":               business_day.id,
            "status":           business_day.status.value,
            "opened_at":        business_day.opened_at.isoformat(),
            "opening_balance":  float(business_day.opening_balance),
            "branch_id":        business_day.branch_id,
            "opened_by":        business_day.opened_by,
        }), 201

    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@mini_bp.route('/business-day/current', methods=['GET'])
@require_cashier
def get_current_business_day():
    """
    Read-only: returns the current OPEN BusinessDay for the authenticated branch.
    No enforcement, no side effects.
    """
    from app.models.business_day import BusinessDay, BusinessDayStatus

    try:
        open_day = BusinessDay.query.filter_by(
            branch_id=g.branch_id,
            status=BusinessDayStatus.OPEN
        ).first()

        if open_day:
            return jsonify({
                "exists":          True,
                "business_day_id": open_day.id,
                "opened_at":       open_day.opened_at.isoformat() if open_day.opened_at else None,
                "status":          open_day.status.value,
            }), 200

        return jsonify({"exists": False}), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@mini_bp.route('/business-day/summary', methods=['GET'])
@require_cashier
def get_business_day_summary():
    """
    Read-only: calculates the current cash state for the OPEN BusinessDay.
    Used by the frontend to preview cash_in, visa_in, instapay_in, cash_out,
    and theoretical_balance before submitting the close day request.

    Dual-path aggregation (backward compatible):
    ─────────────────────────────────────────────
    • NEW invoices: amounts summed from invoice_payments table (split-payment aware).
    • LEGACY invoices (no invoice_payments rows): summed from Invoice.payment_method
      and Invoice.total_amount as before.
    This ensures correct totals for both pre- and post-migration invoices.

    All aggregation is anchored to business_day_id — no Cairo date windows,
    no expense_date ranges.  This prevents CLOSED-day values from bleeding
    into a new OPEN day that shares the same Cairo calendar date.
    """
    from app.models.business_day import BusinessDay, BusinessDayStatus
    from app.models.expense import Expense
    from decimal import Decimal
    from sqlalchemy import func

    try:
        branch_id = g.branch_id
        
        # DIAGNOSTIC: Log branch_id in summary query
        print(f"[SUMMARY] Querying for OPEN day with branch_id={branch_id} (type={type(branch_id).__name__})")

        # ── 1. Fetch the OPEN BusinessDay ─────────────────────────────────────
        business_day = BusinessDay.query.filter_by(
            branch_id=branch_id,
            status=BusinessDayStatus.OPEN
        ).first()
        
        # DIAGNOSTIC: Log result
        print(f"[SUMMARY] Query result: found={business_day is not None}")
        if business_day:
            print(f"[SUMMARY] Found OPEN day: id={business_day.id}, branch_id={business_day.branch_id}")

        if not business_day:
            return jsonify({"exists": False}), 200

        collection_snapshot = build_business_day_collection_snapshot(business_day.id)
        invoice_collections = collection_snapshot["invoice_collections"]
        deposit_collections = collection_snapshot["appointment_deposit_collections"]
        combined_collections = collection_snapshot["combined"]

        cash_in = combined_collections["cash_in"]
        visa_in = combined_collections["visa_in"]
        instapay_in = combined_collections["instapay_in"]
        visa_collected = combined_collections["visa_collected"]
        instapay_collected = combined_collections["instapay_collected"]

        # ── 3. Cash OUT — cash-event expenses bound to this BusinessDay ───────
        raw_cash_out = (
            db.session.query(func.sum(Expense.amount))
            .filter(
                Expense.business_day_id == business_day.id,
                Expense.is_cash_event   == True,    # noqa: E712
            )
            .scalar()
        )
        cash_out = Decimal(str(raw_cash_out)) if raw_cash_out is not None else Decimal('0.00')

        # ── 4. Theoretical balance ────────────────────────────────────────────
        opening_bal     = Decimal(str(business_day.opening_balance or '0.00'))
        theoretical_bal = opening_bal + cash_in - cash_out

        # ── 5. Reporting totals ──────────────────────────────────────────────
        total_sales = collection_snapshot["invoice_total"]
        appointment_deposit_total = collection_snapshot["deposit_total"]
        total_collected = (
            cash_in +
            visa_collected +
            instapay_collected
        )

        return jsonify({
            "exists":              True,
            "business_day_id":     business_day.id,
            "status":              business_day.status.value,
            "opened_at":           business_day.opened_at.isoformat(),
            "cash_in":             float(cash_in),
            "visa_in":             float(visa_in),
            "visa_1_in":           float(combined_collections.get("visa_1_in", 0)),
            "visa_2_in":           float(combined_collections.get("visa_2_in", 0)),
            "visa_unassigned_in":  float(combined_collections.get("visa_unassigned_in", 0)),
            "instapay_in":         float(instapay_in),
            "visa_collected":      float(visa_collected),
            "visa_1_collected":    float(combined_collections.get("visa_1_collected", 0)),
            "visa_2_collected":    float(combined_collections.get("visa_2_collected", 0)),
            "visa_unassigned_collected": float(combined_collections.get("visa_unassigned_collected", 0)),
            "instapay_collected":  float(instapay_collected),
            "invoice_cash_in":     float(invoice_collections["cash_in"]),
            "invoice_visa_in":     float(invoice_collections["visa_in"]),
            "invoice_visa_1_in":   float(invoice_collections.get("visa_1_in", 0)),
            "invoice_visa_2_in":   float(invoice_collections.get("visa_2_in", 0)),
            "invoice_visa_unassigned_in": float(invoice_collections.get("visa_unassigned_in", 0)),
            "invoice_instapay_in": float(invoice_collections["instapay_in"]),
            "invoice_visa_collected": float(invoice_collections["visa_collected"]),
            "invoice_visa_1_collected": float(invoice_collections.get("visa_1_collected", 0)),
            "invoice_visa_2_collected": float(invoice_collections.get("visa_2_collected", 0)),
            "invoice_visa_unassigned_collected": float(invoice_collections.get("visa_unassigned_collected", 0)),
            "invoice_instapay_collected": float(invoice_collections["instapay_collected"]),
            "appointment_deposit_cash_in": float(deposit_collections["cash_in"]),
            "appointment_deposit_visa_in": float(deposit_collections["visa_in"]),
            "appointment_deposit_visa_1_in": float(deposit_collections.get("visa_1_in", 0)),
            "appointment_deposit_visa_2_in": float(deposit_collections.get("visa_2_in", 0)),
            "appointment_deposit_visa_unassigned_in": float(deposit_collections.get("visa_unassigned_in", 0)),
            "appointment_deposit_instapay_in": float(deposit_collections["instapay_in"]),
            "appointment_deposit_visa_collected": float(deposit_collections["visa_collected"]),
            "appointment_deposit_visa_1_collected": float(deposit_collections.get("visa_1_collected", 0)),
            "appointment_deposit_visa_2_collected": float(deposit_collections.get("visa_2_collected", 0)),
            "appointment_deposit_visa_unassigned_collected": float(deposit_collections.get("visa_unassigned_collected", 0)),
            "appointment_deposit_instapay_collected": float(deposit_collections["instapay_collected"]),
            "cash_out":            float(cash_out),
            "theoretical_balance": float(theoretical_bal),
            "total_sales":         float(total_sales),
            "appointment_deposit_total": float(appointment_deposit_total),
            "total_collected":     float(total_collected),
        }), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@mini_bp.route('/business-day/close', methods=['POST'])
@require_cashier
def close_business_day():
    """
    Close the currently OPEN BusinessDay for the authenticated branch.

    Uses the same dual-path aggregation as /business-day/summary:
    - NEW invoices: cash_in computed from InvoicePayment rows (CASH method only)
    - LEGACY invoices: cash_in from Invoice.payment_method == CASH
    This ensures correct ledger snapshot regardless of migration state.

    Steps:
      1. Fetch OPEN BusinessDay for g.branch_id with SELECT FOR UPDATE.
      2. Read actual_balance from request body.
      3. Compute cash_in (dual-path), visa_in, instapay_in (for report).
      4. Compute cash_out from expenses.
      5. Store immutable cash_in and cash_out snapshot on BusinessDay row.
      6. theoretical_balance = opening_balance + cash_in - cash_out.
      7. variance = closing_balance - theoretical_balance.
      8. Transition status -> CLOSED.
    """
    from app.models.business_day import BusinessDay, BusinessDayStatus
    from app.models.attendance import Attendance, AttendanceStatus, AttendanceCheckoutSource
    from app.models.employee import Employee, EmployeeType
    from app.models.expense import Expense
    from decimal import Decimal, InvalidOperation
    from sqlalchemy import func

    try:
        branch_id  = g.branch_id
        cashier_id = g.cashier_id

        # ── 1. Fetch & lock the OPEN BusinessDay ─────────────────────────────
        business_day = (
            BusinessDay.query
            .filter_by(branch_id=branch_id, status=BusinessDayStatus.OPEN)
            .with_for_update()
            .first()
        )

        if not business_day:
            return jsonify({"error": "No open business day found."}), 400

        # ── 2. Validate request body ─────────────────────────────────────────
        data = request.get_json() or {}
        raw_actual = data.get('actual_balance')

        if raw_actual is None:
            return jsonify({"error": "actual_balance is required."}), 400

        try:
            actual_balance = Decimal(str(raw_actual))
        except InvalidOperation:
            return jsonify({"error": "actual_balance must be a valid number."}), 400

        # Per-method actual counts (optional — default to 0 for backward compat)
        def _parse_actual(key):
            raw = data.get(key)
            if raw is None:
                return None
            try:
                return Decimal(str(raw))
            except InvalidOperation:
                return Decimal('0.00')

        actual_cash     = _parse_actual('actual_cash') if _parse_actual('actual_cash') is not None else Decimal('0.00')
        actual_visa_1   = _parse_actual('actual_visa_1')
        actual_visa_2   = _parse_actual('actual_visa_2')
        actual_instapay = _parse_actual('actual_instapay') if _parse_actual('actual_instapay') is not None else Decimal('0.00')
        raw_actual_visa = _parse_actual('actual_visa')

        if actual_visa_1 is not None or actual_visa_2 is not None:
            v1 = actual_visa_1 if actual_visa_1 is not None else Decimal('0.00')
            v2 = actual_visa_2 if actual_visa_2 is not None else Decimal('0.00')
            actual_visa = v1 + v2
            business_day.actual_visa_1 = v1
            business_day.actual_visa_2 = v2
        else:
            # Explicit legacy fallback: preserve unassigned actual_visa without silent mapping to terminal 1 or 2
            actual_visa = raw_actual_visa if raw_actual_visa is not None else Decimal('0.00')
            business_day.actual_visa_1 = None
            business_day.actual_visa_2 = None

        business_day.actual_instapay = actual_instapay

        # If actual_cash was explicitly provided, use it as the canonical
        # actual_balance so the two values can never diverge.
        if 'actual_cash' in data:
            actual_balance = actual_cash

        collection_snapshot = build_business_day_collection_snapshot(business_day.id)
        invoice_collections = collection_snapshot["invoice_collections"]
        deposit_collections = collection_snapshot["appointment_deposit_collections"]
        combined_collections = collection_snapshot["combined"]

        cash_in     = combined_collections["cash_in"]
        visa_in     = combined_collections["visa_in"]
        instapay_in = combined_collections["instapay_in"]
        visa_collected     = combined_collections["visa_collected"]
        instapay_collected = combined_collections["instapay_collected"]

        # ── 4. Cash OUT — cash-event expenses bound to this BusinessDay ───────
        from app.models.expense_category import ExpenseCategory
        
        raw_cash_out = (
            db.session.query(func.sum(Expense.amount))
            .filter(
                Expense.business_day_id == business_day.id,
                Expense.is_cash_event   == True,            # noqa: E712
            )
            .scalar()
        )
        cash_out = Decimal(str(raw_cash_out)) if raw_cash_out is not None else Decimal('0.00')

        # ── 4a. Expense breakdown by category ──────────────────────────────────
        # Query expenses by category for detailed receipt
        def _sum_by_category(code):
            """Sum expenses where is_cash_event=TRUE and category.code matches."""
            amt = (
                db.session.query(func.sum(Expense.amount))
                .join(ExpenseCategory, ExpenseCategory.id == Expense.expense_category_id)
                .filter(
                    Expense.business_day_id == business_day.id,
                    Expense.is_cash_event   == True,        # noqa: E712
                    ExpenseCategory.code    == code,
                )
                .scalar()
            )
            return Decimal(str(amt)) if amt is not None else Decimal('0.00')

        advance_total = _sum_by_category('ADVANCE')
        overtime_total = _sum_by_category('OVERTIME')
        commission_total = _sum_by_category('DAILY_PERCENTAGE')
        
        # Manual expenses = total - known categories (includes TIP_PAYOUT, custom expenses)
        manual_expenses_total = cash_out - advance_total - overtime_total - commission_total

        # ── 5. Immutable ledger snapshot ──────────────────────────────────────
        business_day.cash_in  = cash_in
        business_day.cash_out = cash_out

        # ── 6. Theoretical balance ────────────────────────────────────────────
        opening_bal     = Decimal(str(business_day.opening_balance or '0.00'))
        theoretical_bal = opening_bal + cash_in - cash_out

        # ── 7. Variance ───────────────────────────────────────────────────────
        variance = actual_balance - theoretical_bal

        # ── 8. Calculate daily income and net daily ────────────────────────────
        daily_income = cash_in + visa_collected + instapay_collected
        net_daily = actual_cash + actual_visa + actual_instapay

        present_attendances = (
            db.session.query(Attendance)
            .join(Employee, Employee.id == Attendance.employee_id)
            .filter(
                Attendance.branch_id == branch_id,
                Attendance.business_day_id == business_day.id,
                Attendance.status == AttendanceStatus.PRESENT,
                Employee.employee_type.in_([EmployeeType.BARBER, EmployeeType.ASSISTANT]),
            )
            .populate_existing()
            .with_for_update(of=Attendance)
            .all()
        )

        from app.services.attendance_compatibility import require_legacy_closure
        if any(row.attendance_origin == 'STAFF_GPS' for row in present_attendances):
            db.session.rollback()
            return jsonify({"error": "Open Staff attendance requires reviewed closure before business-day close."}), 409

        shared_close_timestamp = get_utc_now()
        for attendance in present_attendances:
            require_legacy_closure(attendance)
            attendance.check_out_time = shared_close_timestamp
            attendance.status = AttendanceStatus.LEFT
            attendance.checkout_source = AttendanceCheckoutSource.BUSINESS_DAY_CLOSE

        auto_checked_out_count = len(present_attendances)

        # ── 9. Transition to CLOSED ───────────────────────────────────────────
        business_day.status              = BusinessDayStatus.CLOSED
        business_day.closed_at           = shared_close_timestamp
        business_day.closed_by           = cashier_id
        business_day.theoretical_balance = theoretical_bal
        business_day.closing_balance     = actual_balance
        business_day.variance            = variance

        # Validate the combined treasury + attendance mutation set before the
        # single final commit so any flush-time failure rolls back everything.
        db.session.flush()
        db.session.commit()   # releases the FOR UPDATE lock

        # ── 10. Per-method reconciliation diffs ────────────────────────────────
        # diff > 0 = overage, diff < 0 = shortage
        # Cash expected = net cash after expenses (cash_in - cash_out)
        diff_cash     = actual_cash     - (cash_in - cash_out)
        diff_visa     = actual_visa     - visa_collected
        diff_instapay = actual_instapay - instapay_collected
        total_diff    = diff_cash + diff_visa + diff_instapay

        visa_1_collected = combined_collections.get("visa_1_collected", Decimal("0.00"))
        visa_2_collected = combined_collections.get("visa_2_collected", Decimal("0.00"))
        visa_unassigned_collected = combined_collections.get("visa_unassigned_collected", Decimal("0.00"))

        diff_visa_1 = (actual_visa_1 - visa_1_collected) if actual_visa_1 is not None else None
        diff_visa_2 = (actual_visa_2 - visa_2_collected) if actual_visa_2 is not None else None

        return jsonify({
            "business_day_id":     business_day.id,
            "status":              business_day.status.value,
            # ── Income breakdown ──
            "cash_in":             float(cash_in),
            "visa_in":             float(visa_in),
            "visa_1_in":           float(combined_collections.get("visa_1_in", 0)),
            "visa_2_in":           float(combined_collections.get("visa_2_in", 0)),
            "visa_unassigned_in":  float(combined_collections.get("visa_unassigned_in", 0)),
            "instapay_in":         float(instapay_in),
            "visa_collected":      float(visa_collected),
            "visa_1_collected":    float(visa_1_collected),
            "visa_2_collected":    float(visa_2_collected),
            "visa_unassigned_collected": float(visa_unassigned_collected),
            "instapay_collected":  float(instapay_collected),
            "invoice_cash_in":     float(invoice_collections["cash_in"]),
            "invoice_visa_in":     float(invoice_collections["visa_in"]),
            "invoice_instapay_in": float(invoice_collections["instapay_in"]),
            "invoice_visa_collected": float(invoice_collections["visa_collected"]),
            "invoice_instapay_collected": float(invoice_collections["instapay_collected"]),
            "appointment_deposit_cash_in": float(deposit_collections["cash_in"]),
            "appointment_deposit_visa_in": float(deposit_collections["visa_in"]),
            "appointment_deposit_instapay_in": float(deposit_collections["instapay_in"]),
            "appointment_deposit_visa_collected": float(deposit_collections["visa_collected"]),
            "appointment_deposit_instapay_collected": float(deposit_collections["instapay_collected"]),
            "total_sales":         float(collection_snapshot["invoice_total"]),
            "appointment_deposit_total": float(collection_snapshot["deposit_total"]),
            "total_collected":     float(collection_snapshot["combined_total"]),
            "daily_income":        float(daily_income),
            # ── Expense breakdown ──
            "total_expenses":      float(cash_out),
            "advance_total":       float(advance_total),
            "overtime_total":      float(overtime_total),
            "commission_total":    float(commission_total),
            "manual_expenses_total": float(manual_expenses_total),
            # ── Actual (entered by cashier) ──
            "actual_cash":         float(actual_cash),
            "actual_visa":         float(actual_visa),
            "actual_visa_1":       float(actual_visa_1) if actual_visa_1 is not None else None,
            "actual_visa_2":       float(actual_visa_2) if actual_visa_2 is not None else None,
            "actual_instapay":     float(actual_instapay),
            "net_daily":           float(net_daily),
            # ── Per-method diffs ──
            "diff_cash":           float(diff_cash),
            "diff_visa":           float(diff_visa),
            "diff_visa_1":         float(diff_visa_1) if diff_visa_1 is not None else None,
            "diff_visa_2":         float(diff_visa_2) if diff_visa_2 is not None else None,
            "diff_instapay":       float(diff_instapay),
            "total_diff":          float(total_diff),
            # ── Register balance reconciliation (unchanged) ──
            "theoretical_balance": float(theoretical_bal),
            "actual_balance":      float(actual_balance),
            "variance":            float(variance),
            "auto_checked_out_count": auto_checked_out_count,
            "closed_at":           shared_close_timestamp.isoformat(),
        }), 200

    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


# ============================================================================
# ATTENDANCE ENDPOINTS
# ============================================================================

@mini_bp.route('/attendance/today', methods=['GET'])
@require_cashier
def get_today_attendance():
    """Get all employees with their attendance status for today — single JOIN query (no N+1)."""
    from app.models.employee import Employee, EmployeeType
    from app.models.attendance import Attendance, AttendanceStatus
    from app.models.business_day import BusinessDay, BusinessDayStatus
    from sqlalchemy import and_

    try:
        today = get_cairo_date()
        open_business_day = BusinessDay.query.filter_by(
            branch_id=g.branch_id,
            status=BusinessDayStatus.OPEN
        ).first()

        if open_business_day:
            rows = (
                db.session.query(Employee, Attendance)
                .outerjoin(
                    Attendance,
                    and_(
                        Attendance.employee_id == Employee.id,
                        Attendance.branch_id == g.branch_id,
                        Attendance.business_day_id == open_business_day.id,
                        Attendance.status == AttendanceStatus.PRESENT
                    )
                )
                .filter(
                    Employee.branch_id == g.branch_id,
                    Employee.is_active == True,
                    Employee.employee_type.in_([EmployeeType.BARBER, EmployeeType.ASSISTANT])
                )
                .order_by(Employee.employee_type, Employee.id.desc())
                .all()
            )
        else:
            rows = [
                (employee, None)
                for employee in (
                    db.session.query(Employee)
                    .filter(
                        Employee.branch_id == g.branch_id,
                        Employee.is_active == True,
                        Employee.employee_type.in_([EmployeeType.BARBER, EmployeeType.ASSISTANT])
                    )
                    .order_by(Employee.employee_type, Employee.id.desc())
                    .all()
                )
            ]

        result = []
        for emp, attendance in rows:
            if attendance:
                result.append({
                    'id':             emp.id,
                    'name':           emp.full_name,
                    'type':           emp.employee_type.value,
                    'status':         attendance.status.value,
                    'check_in_time':  to_iso_string(attendance.check_in_time)  if attendance.check_in_time  else None,
                    'check_out_time': to_iso_string(attendance.check_out_time) if attendance.check_out_time else None,
                    'business_day_id': attendance.business_day_id,
                    'checkout_source': attendance.checkout_source.value if attendance.checkout_source else None,
                    'image_url':      emp.image_url,
                    'phone':          emp.phone,
                })
            else:
                result.append({
                    'id':             emp.id,
                    'name':           emp.full_name,
                    'type':           emp.employee_type.value,
                    'status':         'ABSENT',
                    'check_in_time':  None,
                    'check_out_time': None,
                    'business_day_id': None,
                    'checkout_source': None,
                    'image_url':      emp.image_url,
                    'phone':          emp.phone,
                })

        # Sort: BARBERs first, then by ID descending (newest first)
        result.sort(key=lambda x: (0 if x['type'] == 'BARBER' else 1, -x['id']))

        return jsonify({
            'date':      today.isoformat(),
            'employees': result
        }), 200

    except Exception as e:
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500



@mini_bp.route('/attendance/check-in', methods=['POST'])
@require_cashier
def check_in_employee():
    """
    Check-in an employee for the current business day.

    Business-day-aware: the attendance `date` is anchored to the date the
    current OPEN BusinessDay was opened (Cairo local date), not the current
    wall-clock date.  This means a shift that started before midnight and runs
    until 2–3 AM is stored under a single date (the business day start date)
    and will never be split by the calendar midnight boundary.

    Duplicate guard: we block on status=PRESENT so that a second check-in
    cannot slip through even if the calendar date has rolled over.
    """
    from app.models.employee import Employee, EmployeeType
    from app.models.attendance import Attendance, AttendanceStatus
    from app.models.business_day import BusinessDay, BusinessDayStatus
    from app.utils.date_utils import CAIRO_TZ, get_utc_now, to_iso_string
    from datetime import datetime, timedelta, timezone
    from sqlalchemy.exc import IntegrityError

    try:
        data = request.get_json() or {}
        employee_id = data.get('employee_id')
        manual_time = data.get('manual_time')

        if not employee_id:
            return jsonify({"error": "employee_id is required"}), 400

        # Verify employee exists, is active, and belongs to this branch
        employee = Employee.query.filter_by(
            id=employee_id,
            branch_id=g.branch_id,
            is_active=True
        ).first()

        if not employee:
            return jsonify({"error": "Employee not found or not active in this branch"}), 404

        # Verify employee is BARBER or ASSISTANT
        if employee.employee_type not in [EmployeeType.BARBER, EmployeeType.ASSISTANT]:
            return jsonify({"error": "Only barbers and assistants can check-in"}), 400

        open_day = BusinessDay.query.filter_by(
            branch_id=g.branch_id,
            status=BusinessDayStatus.OPEN
        ).with_for_update().first()

        if not open_day:
            return jsonify({"error": "يجب فتح الخزنة أولاً قبل تسجيل الحضور"}), 400

        # ── Safety guard: block if employee already has an open (PRESENT) shift ──
        # This check is status-based, not date-based, so it correctly catches
        # any open shift regardless of which calendar date it was created on.
        already_present = Attendance.query.filter_by(
            employee_id=employee_id,
            status=AttendanceStatus.PRESENT
        ).first()

        if already_present:
            if already_present.business_day_id is None:
                return jsonify({
                    "error": "يوجد سجل حضور مفتوح قديم غير مرتبط بيوم عمل ويحتاج إلى مراجعة الإدارة"
                }), 400

            if already_present.business_day_id != open_day.id or already_present.branch_id != g.branch_id:
                return jsonify({
                    "error": "يوجد سجل حضور مفتوح في يوم عمل آخر ويحتاج إلى مراجعة الإدارة"
                }), 400

            return jsonify({"error": "الموظف مسجل حضور بالفعل في يوم العمل الحالي"}), 400

        attendance_date = open_day.opened_at.astimezone(CAIRO_TZ).date()
        now_utc = get_utc_now()
        effective_check_in_time = now_utc

        # Handle optional manual check-in time in Africa/Cairo
        if manual_time:
            if not isinstance(manual_time, str):
                return jsonify({"error": "صيغة الوقت غير صالحة"}), 400

            parts = manual_time.strip().split(':')
            if len(parts) not in (2, 3):
                return jsonify({"error": "صيغة الوقت غير صالحة، يجب أن تكون بتنسيق HH:MM"}), 400

            try:
                hour = int(parts[0])
                minute = int(parts[1])
                second = int(parts[2]) if len(parts) == 3 else 0
                if not (0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59):
                    raise ValueError()
            except ValueError:
                return jsonify({"error": "قيمة الساعة أو الدقيقة غير صالحة"}), 400

            now_cairo = now_utc.astimezone(CAIRO_TZ)
            opened_at_cairo = open_day.opened_at.astimezone(CAIRO_TZ)
            business_date = opened_at_cairo.date()

            # Date resolution:
            if now_cairo.date() == business_date:
                candidate_date = business_date
            else:
                # Business day spans across midnight
                candidate_today = datetime(now_cairo.year, now_cairo.month, now_cairo.day, hour, minute, second, tzinfo=CAIRO_TZ)
                if candidate_today <= now_cairo:
                    candidate_date = now_cairo.date()
                else:
                    candidate_date = business_date

            candidate_cairo = datetime(candidate_date.year, candidate_date.month, candidate_date.day, hour, minute, second, tzinfo=CAIRO_TZ)
            candidate_utc = candidate_cairo.astimezone(timezone.utc)

            # Future time rejection (allow 60s skew tolerance)
            if candidate_utc > now_utc + timedelta(seconds=60):
                return jsonify({"error": "لا يمكن تسجيل وقت حضور في المستقبل"}), 400

            # Do not allow selecting times from unrelated previous days
            if candidate_cairo.date() < business_date:
                return jsonify({"error": "وقت الحضور لا يمكن أن يكون قبل تاريخ يوم العمل"}), 400

            # Overlapping sessions rejection: check against closed sessions today in this business day
            existing_closed_sessions = Attendance.query.filter(
                Attendance.employee_id == employee_id,
                Attendance.business_day_id == open_day.id,
                Attendance.status == AttendanceStatus.LEFT
            ).all()

            for sess in existing_closed_sessions:
                if sess.check_out_time:
                    sess_checkout = sess.check_out_time if sess.check_out_time.tzinfo else sess.check_out_time.replace(tzinfo=timezone.utc)
                    if candidate_utc < sess_checkout:
                        return jsonify({
                            "error": "وقت الحضور يتعارض مع جلسة حضور سابقة مسجلة للموظف"
                        }), 400

            effective_check_in_time = candidate_utc

        # Determine whether check-in was explicitly adjusted / manual
        is_manual_entry = False
        if manual_time:
            is_manual_flag = data.get('is_manual', False) if isinstance(data, dict) else False
            diff_from_recording = abs((now_utc - effective_check_in_time).total_seconds())
            if is_manual_flag or diff_from_recording >= 60:
                is_manual_entry = True

        actor_id = getattr(g, 'user_id', None)

        # Create attendance record
        attendance = Attendance(
            employee_id=employee_id,
            branch_id=g.branch_id,
            business_day_id=open_day.id,
            date=attendance_date,          # business-day start date, not wall-clock date
            check_in_time=effective_check_in_time,
            status=AttendanceStatus.PRESENT,
            is_manual_check_in=is_manual_entry,
            check_in_actor_id=actor_id
        )

        db.session.add(attendance)
        db.session.commit()

        actor_name = None
        if is_manual_entry:
            if attendance.check_in_actor:
                actor_name = attendance.check_in_actor.full_name
            elif getattr(g, 'current_user', None):
                actor_name = getattr(g.current_user, 'full_name', None)

        return jsonify({
            'id': attendance.id,
            'employee_id': employee.id,
            'employee_name': employee.full_name,
            'date': attendance_date.isoformat(),
            'business_day_id': attendance.business_day_id,
            "check_in_time": to_iso_string(attendance.check_in_time),
            "created_at": to_iso_string(attendance.created_at),
            "is_manual_check_in": attendance.is_manual_check_in,
            "recorded_by": actor_name,
            'check_out_time': None,
            'checkout_source': None,
            'status': attendance.status.value
        }), 201

    except IntegrityError:
        db.session.rollback()
        return jsonify({
            "error": "تعذر تسجيل الحضور لأن الموظف لديه سجل حضور مفتوح بالفعل"
        }), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@mini_bp.route('/attendance/check-out', methods=['POST'])
@require_cashier
def check_out_employee():
    """
    Check-out an employee — midnight-safe.

    The lookup is done by status=PRESENT rather than by date=today.  This
    means the correct attendance record is always found even if the calendar
    date has rolled over since the employee checked in (e.g. 10 PM → 2 AM
    shift).  In the rare edge case where more than one PRESENT record exists
    for the same employee (data inconsistency), we pick the one with the
    latest check_in_time.
    """
    from app.models.employee import Employee
    from app.models.attendance import Attendance, AttendanceStatus, AttendanceCheckoutSource
    from app.models.business_day import BusinessDay, BusinessDayStatus

    try:
        data = request.get_json()
        employee_id = data.get('employee_id')

        if not employee_id:
            return jsonify({"error": "employee_id is required"}), 400

        # Verify employee exists and belongs to this branch
        employee = Employee.query.filter_by(
            id=employee_id,
            branch_id=g.branch_id,
            is_active=True
        ).first()

        if not employee:
            return jsonify({"error": "Employee not found or not active in this branch"}), 404

        open_day = BusinessDay.query.filter_by(
            branch_id=g.branch_id,
            status=BusinessDayStatus.OPEN
        ).with_for_update().first()

        if not open_day:
            return jsonify({"error": "لا توجد خزنة مفتوحة حالياً لتسجيل الانصراف"}), 400

        attendance = (
            Attendance.query
            .filter_by(
                employee_id=employee_id,
                branch_id=g.branch_id,
                business_day_id=open_day.id,
                status=AttendanceStatus.PRESENT
            )
            .populate_existing().with_for_update(of=Attendance)
            .first()
        )

        if not attendance:
            return jsonify({
                "error": "لا يوجد سجل حضور مفتوح لهذا الموظف في يوم العمل الحالي"
            }), 400

        if attendance.attendance_origin == 'STAFF_GPS':
            db.session.rollback()
            return jsonify({"error": "Cashier checkout cannot close Staff attendance."}), 409

        # Update attendance record
        now_utc = get_utc_now()
        attendance.check_out_time = now_utc
        attendance.status = AttendanceStatus.LEFT
        attendance.checkout_source = AttendanceCheckoutSource.MANUAL

        db.session.commit()

        return jsonify({
            'id': attendance.id,
            'employee_id': employee.id,
            'employee_name': employee.full_name,
            'date': attendance.date.isoformat() if attendance.date else None,
            'business_day_id': attendance.business_day_id,
            "check_in_time": to_iso_string(attendance.check_in_time),
            "check_out_time": to_iso_string(attendance.check_out_time),
            'checkout_source': attendance.checkout_source.value if attendance.checkout_source else None,
            'status': attendance.status.value
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@mini_bp.route('/invoice/<int:invoice_id>/confirm', methods=['POST'])
@require_cashier
def confirm_payment(invoice_id):
    """
    Confirm payment for a DRAFT invoice.

    Accepts either:
    - Legacy: { payment_method: "CASH", ... }
    - New split: { payments: [{method: "CASH", amount: 100}, {method: "VISA", amount: 50}], ... }

    In both cases, overpayment is allowed (paid >= total). The change is
    calculated automatically and returned in change_amount.
    Only actual invoice revenue is stored in invoice_payments (not overpayment).
    """
    # ✅ FIX 1: Validate invoice belongs to authenticated cashier's branch
    from app.models.invoice import Invoice
    invoice_obj = Invoice.query.get(invoice_id)
    if not invoice_obj or invoice_obj.branch_id != g.branch_id:
        return jsonify({"error": "Invoice not found or access denied"}), 404

    data = request.get_json()
    if not data:
        return jsonify({"error": "No input data provided"}), 400

    # Support BOTH legacy single method AND new split payment array
    payment_method = data.get('payment_method')   # legacy
    payments       = data.get('payments')          # new split payment list
    discount_amount = data.get('discount_amount', 0.0)
    customer_name  = data.get('customer_name')
    customer_phone = data.get('customer_phone')
    promo_code     = data.get('promo_code')
    quote_id       = data.get('quote_id')
    promo_version  = data.get('promo_version')
    raw_payment_attempt_id = data.get('payment_attempt_id')

    # ✅ FIX 2: Use authenticated cashier from JWT, NOT from request body
    confirmed_by = g.cashier_id
    if not confirmed_by:
        return jsonify({"error": "Authentication error: cashier_id missing from session"}), 401

    if payment_method is None and payments is None:
        return jsonify({"error": "Either payment_method or payments is required"}), 400

    payment_attempt_id = None
    if raw_payment_attempt_id is not None:
        try:
            payment_attempt_id = payment_attempt_service.normalize_attempt_id(raw_payment_attempt_id)
            request_fingerprint = payment_attempt_service.build_request_fingerprint(invoice_id, data)
            attempt, is_new_attempt = payment_attempt_service.claim_attempt(
                payment_attempt_id=payment_attempt_id,
                invoice_id=invoice_id,
                branch_id=g.branch_id,
                cashier_id=confirmed_by,
                request_fingerprint=request_fingerprint,
            )
        except payment_attempt_service.PaymentAttemptError as error:
            return jsonify({"error": error.code, "message": error.message}), error.status_code

        if not is_new_attempt:
            if attempt.status == PaymentConfirmationAttemptStatus.SUCCEEDED:
                paid_invoice = Invoice.query.get(attempt.invoice_id)
                if not paid_invoice or paid_invoice.status != InvoiceStatus.PAID:
                    return jsonify({
                        "error": "PAYMENT_ATTEMPT_INCONSISTENT",
                        "message": "تعذر التحقق من نتيجة الدفع. يرجى التواصل مع الإدارة.",
                    }), 500
                return jsonify(_serialize_invoice(paid_invoice)), 200
            if attempt.status == PaymentConfirmationAttemptStatus.PROCESSING:
                return jsonify({
                    "payment_attempt_id": payment_attempt_id,
                    "status": "PROCESSING",
                }), 202
            return jsonify({
                "error": attempt.failure_code or "PAYMENT_ATTEMPT_FAILED",
                "message": attempt.failure_message or "تعذر إكمال الدفع.",
                "payment_attempt_id": payment_attempt_id,
                "status": "FAILED",
            }), 409

    try:
        invoice = InvoiceEngine.confirm_payment(
            invoice_id=invoice_id,
            confirmed_by_id=confirmed_by,
            discount_amount=float(discount_amount),
            customer_name=customer_name,
            customer_phone=customer_phone,
            payment_method_str=payment_method,
            payments=payments,
            promo_code=promo_code,
            quote_id=quote_id,
            promo_version=promo_version,
            payment_attempt_id=payment_attempt_id,
            appointment_id=data.get("appointment_id"),
            customer_id=data.get("customer_id"),
            multi_customer=data.get("multi_customer", False),
            expected_deposit_amount=data.get("expected_deposit_amount"),
            confirmed_by_user_id=g.user_id,
            actor_context=AuditActorContext.from_mini_request(),
        )
    except promo_code_service.PromoError as e:
        if payment_attempt_id:
            payment_attempt_service.mark_attempt_failed(
                payment_attempt_id,
                failure_code=e.code,
                failure_message=str(e),
            )
        payload = e.to_dict()
        if payment_attempt_id:
            payload.update({"payment_attempt_id": payment_attempt_id, "status": "FAILED"})
        return jsonify(payload), e.status
    except ValueError as e:
        developer_message = str(e)
        public_message = (
            "تعذر تأكيد الدفع لأن الفاتورة لم تعد معلقة."
            if "Only DRAFT allowed" in developer_message
            else developer_message
        )
        if payment_attempt_id:
            payment_attempt_service.mark_attempt_failed(
                payment_attempt_id,
                failure_code="PAYMENT_REJECTED",
                failure_message=public_message,
            )
        print(f"[PAYMENT_REJECTED] invoice_id={invoice_id}: {developer_message}")
        payload = {"error": "PAYMENT_REJECTED", "message": public_message}
        if payment_attempt_id:
            payload.update({"payment_attempt_id": payment_attempt_id, "status": "FAILED"})
        return jsonify(payload), 400
    except Exception as e:
        failure_attempt = None
        current_app.logger.exception("Payment confirmation failed: invoice_id=%s", invoice_id)
        if payment_attempt_id:
            failure_attempt = payment_attempt_service.mark_attempt_failed(
                payment_attempt_id,
                failure_code="PAYMENT_INTERNAL_ERROR",
                failure_message="تعذر إكمال الدفع. يرجى التحقق من النتيجة والمحاولة مرة أخرى.",
            )
            if failure_attempt.status == PaymentConfirmationAttemptStatus.SUCCEEDED:
                paid_invoice = Invoice.query.get(failure_attempt.invoice_id)
                if paid_invoice and paid_invoice.status == InvoiceStatus.PAID:
                    return jsonify(_serialize_invoice(paid_invoice)), 200
        payload = {
            "error": "PAYMENT_INTERNAL_ERROR",
            "message": "تعذر إكمال الدفع. يرجى المحاولة مرة أخرى.",
        }
        if failure_attempt and failure_attempt.status == PaymentConfirmationAttemptStatus.FAILED:
            payload.update({"payment_attempt_id": payment_attempt_id, "status": "FAILED"})
        return jsonify(payload), 500

    return jsonify(_serialize_invoice(invoice)), 200


@mini_bp.route('/payment-attempt/<payment_attempt_id>', methods=['GET'])
@require_cashier
def get_payment_attempt(payment_attempt_id):
    """Return the authenticated cashier's authoritative payment-attempt state."""
    try:
        normalized_attempt_id = payment_attempt_service.normalize_attempt_id(payment_attempt_id)
    except payment_attempt_service.PaymentAttemptError as error:
        return jsonify({"error": error.code, "message": error.message}), error.status_code

    attempt = PaymentConfirmationAttempt.query.filter_by(
        payment_attempt_id=normalized_attempt_id,
        branch_id=g.branch_id,
        cashier_id=g.cashier_id,
    ).first()
    if not attempt:
        # NOT_FOUND is a safe recovery state: Mini may resend the original
        # request with the same idempotency key. It reveals no invoice data.
        return jsonify({
            "payment_attempt_id": normalized_attempt_id,
            "status": "NOT_FOUND",
        }), 200

    payload = {
        "payment_attempt_id": normalized_attempt_id,
        "status": attempt.status.value,
    }
    if attempt.status == PaymentConfirmationAttemptStatus.SUCCEEDED:
        invoice = Invoice.query.get(attempt.invoice_id)
        if not invoice or invoice.status != InvoiceStatus.PAID:
            return jsonify({
                "error": "PAYMENT_ATTEMPT_INCONSISTENT",
                "message": "تعذر التحقق من نتيجة الدفع. يرجى التواصل مع الإدارة.",
            }), 500
        payload["invoice"] = _serialize_invoice(invoice)
    elif attempt.status == PaymentConfirmationAttemptStatus.FAILED:
        payload["error"] = {
            "code": attempt.failure_code or "PAYMENT_ATTEMPT_FAILED",
            "message": attempt.failure_message or "تعذر إكمال الدفع.",
        }
    return jsonify(payload), 200

@mini_bp.route('/invoice/<int:invoice_id>/commit-draft', methods=['POST'])
@require_cashier
def commit_draft_invoice(invoice_id):
    """
    Commit a DRAFT invoice to DRAFT_COMMITTED status.
    This locks the draft as a snapshot for admin audit trail.
    """
    from app.models.invoice import Invoice

    invoice_obj = Invoice.query.get(invoice_id)
    if not invoice_obj or invoice_obj.branch_id != g.branch_id:
        return jsonify({"error": "Invoice not found or access denied"}), 404

    try:
        invoice = InvoiceEngine.commit_draft(
            invoice_id=invoice_id,
            actor_context=AuditActorContext.from_mini_request(),
        )
        return jsonify(_serialize_invoice(invoice)), 200
    except ValueError as e:
        print(f"❌ commit_draft validation error for invoice {invoice_id}: {e}")
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"❌ commit_draft failed for invoice {invoice_id}: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Commit draft failed", "details": str(e)}), 500

# ============================================================================
# CUSTOMER ENDPOINTS
# ============================================================================

def _serialize_customer(customer, branch_id=None):
    """Serialize customer object with images"""
    from app.models.customer_balance import CustomerBalance

    deposit_balance = getattr(customer, 'deposit_balance', None)
    if deposit_balance is None:
        scoped_branch_id = branch_id if branch_id is not None else customer.branch_id
        balance_row = CustomerBalance.query.filter_by(
            customer_id=customer.id,
            branch_id=scoped_branch_id,
        ).first()
        deposit_balance = float(balance_row.balance or 0) if balance_row else 0

    return {
        "id": customer.id,
        "name": customer.full_name,  # Map full_name -> name
        "phone": customer.phone,
        "last_barber_id": customer.last_barber_id,
        "last_barber_name": customer.last_barber.full_name if customer.last_barber else None,
        "images": [img.image_url for img in customer.images],
        "created_at": customer.created_at.isoformat() if customer.created_at else None,
        "deposit_balance": float(deposit_balance or 0),
    }

@mini_bp.route('/customers/<int:customer_id>/eligible-booking-deposits', methods=['GET'])
@require_cashier
def get_eligible_booking_deposits(customer_id):
    from app.services.booking_deposit_service import eligible_bookings
    try:
        return jsonify({"bookings": eligible_bookings(customer_id, g.branch_id)})
    except ValueError as error:
        return jsonify({"error": str(error)}), 400


@mini_bp.route('/customers/search', methods=['GET'])
@require_cashier
def search_customers():
    """
    Search customers within the cashier's branch by phone prefix or name.
    Returns top 5 matches ordered by most-recently created.

    Query params:
        q (str): Digits-only phone prefix (min 3 chars) or customer name (min 2 chars).

    Returns:
        200 [ { id, full_name, phone }, ... ]
    """
    from app.models.customer import Customer
    from app.models.customer_balance import CustomerBalance
    from sqlalchemy import and_, func

    query = request.args.get('q', '').strip()
    is_digits_only = query.isdigit()

    if not query:
        return jsonify([]), 200

    if is_digits_only:
        if len(query) < 3:
            return jsonify([]), 200

        search_filter = Customer.phone.startswith(query)
    else:
        if len(query) < 2:
            return jsonify([]), 200

        search_filter = func.lower(Customer.full_name).like(f"%{query.lower()}%")

    customers = (
        db.session.query(
            Customer,
            func.coalesce(CustomerBalance.balance, 0).label("deposit_balance"),
        )
        .outerjoin(
            CustomerBalance,
            and_(
                CustomerBalance.customer_id == Customer.id,
                CustomerBalance.branch_id == g.branch_id,
            ),
        )
        .filter(
            Customer.branch_id == g.branch_id,
            Customer.is_active == True,
            search_filter
        )
        .order_by(Customer.created_at.desc(), Customer.id.desc())
        .limit(5)
        .all()
    )

    return jsonify([
        {
            "id": customer.id,
            "full_name": customer.full_name,
            "phone": customer.phone,
            "deposit_balance": float(deposit_balance or 0),
        }
        for customer, deposit_balance in customers
    ]), 200


@mini_bp.route('/customers/by-phone', methods=['GET'])
@require_cashier
def get_customer_by_phone():
    """
    Lookup a single customer by phone number within the cashier's branch.
    Used by the Mini frontend for real-time autofill during invoice creation.

    Query params:
        phone (str): The phone number to search for.

    Returns:
        200 { id, full_name, phone }  — customer found
        404 { error }                  — not found
        400 { error }                  — phone param missing
    """
    from app.models.customer import Customer
    from app.models.customer_balance import CustomerBalance
    from sqlalchemy import and_, func

    phone = request.args.get('phone', '').strip()
    if not phone:
        return jsonify({"error": "phone parameter is required"}), 400

    row = (
        db.session.query(
            Customer,
            func.coalesce(CustomerBalance.balance, 0).label("deposit_balance"),
        )
        .outerjoin(
            CustomerBalance,
            and_(
                CustomerBalance.customer_id == Customer.id,
                CustomerBalance.branch_id == g.branch_id,
            ),
        )
        .filter(
            Customer.phone == phone,
            Customer.branch_id == g.branch_id,
            Customer.is_active == True,
        )
        .first()
    )

    if not row:
        return jsonify({"error": "Customer not found"}), 404

    customer, deposit_balance = row

    return jsonify({
        "id": customer.id,
        "full_name": customer.full_name,
        "phone": customer.phone,
        "deposit_balance": float(deposit_balance or 0),
    }), 200


@mini_bp.route('/customers', methods=['GET'])
@require_cashier
def get_customers():
    """Get paginated customers for the current cashier's branch."""
    from app.models.customer import Customer
    from app.models.customer_balance import CustomerBalance
    from app.utils.exports.clients import build_customer_stats_subquery
    from sqlalchemy.orm import joinedload, selectinload
    from sqlalchemy import and_, func, or_
    from math import ceil

    try:
        page = max(request.args.get('page', default=1, type=int) or 1, 1)
        requested_per_page = request.args.get('per_page', default=20, type=int) or 20
        per_page = min(max(requested_per_page, 1), 50)
        query = (request.args.get('q') or '').strip()

        base_query = Customer.query.filter(
            Customer.branch_id == g.branch_id,
            Customer.is_active == True,
        )

        if query:
            lowered_query = query.lower()
            base_query = base_query.filter(
                or_(
                    func.lower(func.coalesce(Customer.full_name, '')).like(f"%{lowered_query}%"),
                    Customer.phone.like(f"%{query}%"),
                )
            )

        total = base_query.count()
        total_pages = ceil(total / per_page) if total else 0

        visit_stats_subquery = build_customer_stats_subquery([g.branch_id])

        balances_subquery = (
            db.session.query(
                CustomerBalance.customer_id.label('customer_id'),
                CustomerBalance.balance.label('deposit_balance'),
            )
            .filter(CustomerBalance.branch_id == g.branch_id)
            .subquery()
        )

        rows = (
            db.session.query(
                Customer,
                func.coalesce(visit_stats_subquery.c.visits_count, 0).label('visits_count'),
                visit_stats_subquery.c.last_visit.label('last_visit'),
                func.coalesce(balances_subquery.c.deposit_balance, 0).label('deposit_balance'),
            )
            .outerjoin(
                visit_stats_subquery,
                visit_stats_subquery.c.customer_id == Customer.id,
            )
            .outerjoin(
                balances_subquery,
                balances_subquery.c.customer_id == Customer.id,
            )
            .options(
                joinedload(Customer.last_barber),
                selectinload(Customer.images),
            )
            .filter(
                Customer.branch_id == g.branch_id,
                Customer.is_active == True,
            )
        )

        if query:
            lowered_query = query.lower()
            rows = rows.filter(
                or_(
                    func.lower(func.coalesce(Customer.full_name, '')).like(f"%{lowered_query}%"),
                    Customer.phone.like(f"%{query}%"),
                )
            )

        paginated_rows = (
            rows
            .order_by(
                case((visit_stats_subquery.c.last_visit.is_(None), 1), else_=0).asc(),
                visit_stats_subquery.c.last_visit.desc(),
                Customer.created_at.desc(),
                Customer.id.desc(),
            )
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )

        items = []
        for customer, visits_count, last_visit, deposit_balance in paginated_rows:
            items.append({
                "id": customer.id,
                "name": customer.full_name,
                "phone": customer.phone,
                "last_barber_id": customer.last_barber_id,
                "last_barber_name": customer.last_barber.full_name if customer.last_barber else None,
                "images": [img.image_url for img in customer.images],
                "created_at": customer.created_at.isoformat() if customer.created_at else None,
                "last_visit_at": to_iso_string(last_visit) if last_visit else None,
                "visits_count": int(visits_count or 0),
                "deposit_balance": float(deposit_balance or 0),
            })

        return jsonify({
            "items": items,
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
            "has_more": page < total_pages,
        }), 200
    except Exception as e:
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@mini_bp.route('/customers', methods=['POST'])
@require_cashier
def create_customer():
    """Create a new customer for the current cashier's branch"""
    from app.models.customer import Customer
    from app.models.customer_image import CustomerImage
    from app.models.employee import Employee, EmployeeType
    from app.extensions import db
    from app.utils.upload_utils import save_uploaded_file
    from sqlalchemy.exc import IntegrityError
    
    try:
        # Get form data
        name = request.form.get('name')
        phone = request.form.get('phone')
        last_barber_id_raw = (request.form.get('last_barber_id') or '').strip()
        # Validation
        if not name or not name.strip():
            return jsonify({"error": "Name is required"}), 400
        
        if not phone or not phone.strip():
            return jsonify({"error": "Phone is required"}), 400

        last_barber_id = None
        if last_barber_id_raw:
            try:
                last_barber_id = int(last_barber_id_raw)
            except ValueError:
                return jsonify({"error": "last_barber_id must be a valid integer"}), 400

            barber = Employee.query.filter(
                Employee.id == last_barber_id,
                Employee.branch_id == g.branch_id,
                Employee.employee_type == EmployeeType.BARBER,
                Employee.is_active == True,
            ).first()
            if not barber:
                return jsonify({"error": "Selected barber was not found in this branch"}), 400
        
        # Create customer with current branch_id from authenticated cashier
        customer = Customer(
            full_name=name.strip(),
            phone=phone.strip(),
            branch_id=g.branch_id,  # Use authenticated cashier's branch
            last_barber_id=last_barber_id,
        )
        
        db.session.add(customer)
        db.session.flush()  # Get customer.id before committing
        
        # Handle image uploads
        uploaded_files = request.files.getlist('images[]')
        for file in uploaded_files:
            if file and file.filename:
                try:
                    # Save with branch and customer isolation
                    image_path = save_uploaded_file(file, g.branch_id, customer.id)
                    customer_image = CustomerImage(
                        customer_id=customer.id,
                        image_url=image_path  # Store relative path
                    )
                    db.session.add(customer_image)
                except ValueError as e:
                    # Skip invalid files but continue
                    print(f"Skipping invalid file: {e}")
        
        db.session.commit()
        
        return jsonify(_serialize_customer(customer, branch_id=g.branch_id)), 201
        
    except IntegrityError as e:
        db.session.rollback()
        # Check if it's a phone uniqueness violation
        if 'uq_branch_phone' in str(e.orig):
            return jsonify({"error": "Phone number already exists for this branch"}), 400
        return jsonify({"error": "Database integrity error", "details": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500
@mini_bp.route('/customers/<int:customer_id>', methods=['DELETE'])
@require_cashier
def delete_customer(customer_id):
    """Delete a customer and their associated images"""
    from app.models.customer import Customer
    from app.models.appointment_deposit_transaction import AppointmentDepositTransaction
    from app.extensions import db
    import shutil
    import os
    
    try:
        # Get customer
        customer = Customer.query.get(customer_id)
        
        if not customer:
            return jsonify({"error": "Customer not found"}), 404
            
        # Verify branch ownership
        if customer.branch_id != g.branch_id:
            return jsonify({"error": "Unauthorized access to this customer"}), 403

        has_financial_transactions = (
            AppointmentDepositTransaction.query
            .filter_by(customer_id=customer.id)
            .first()
        )
        if has_financial_transactions:
            return jsonify({
                "error": "This customer has appointment deposit transactions and cannot be deleted in Phase 1."
            }), 409

        from app.models.invoice import Invoice
        if Invoice.query.filter_by(customer_id=customer.id).first():
            return jsonify({
                "error": "This customer has invoice history and cannot be deleted."
            }), 409
            
        # Delete image files directory
        # Construct path: uploads/customers/{branch_id}/{customer_id}
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        customer_dir = os.path.join(base_dir, 'uploads', 'customers', str(customer.branch_id), str(customer.id))
        
        if os.path.exists(customer_dir):
            try:
                shutil.rmtree(customer_dir)
            except Exception as e:
                print(f"Error deleting directory {customer_dir}: {e}")
                # Continue with DB deletion even if file deletion fails
        
        # Delete related records first to avoid foreign key constraints
        from app.models.appointment import Appointment
        from app.models.customer_balance import CustomerBalance
        
        # Delete appointments
        Appointment.query.filter_by(customer_id=customer.id).delete()
        
        # Delete customer balance
        CustomerBalance.query.filter_by(customer_id=customer.id).delete()
        
        # Delete from database
        db.session.delete(customer)
        db.session.commit()
        
        return jsonify({"message": "Customer deleted successfully"}), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500
@mini_bp.route('/customers/<int:customer_id>', methods=['PATCH'])
@require_cashier
def update_customer(customer_id):
    """Update a customer details and upload new images"""
    from app.models.customer import Customer
    from app.models.customer_image import CustomerImage
    from app.models.employee import Employee, EmployeeType
    from app.extensions import db
    from app.utils.upload_utils import save_uploaded_file
    from sqlalchemy.exc import IntegrityError
    
    try:
        # Get customer
        customer = Customer.query.get(customer_id)
        
        if not customer:
            return jsonify({"error": "Customer not found"}), 404
            
        # Verify branch ownership
        if customer.branch_id != g.branch_id:
            return jsonify({"error": "Unauthorized access to this customer"}), 403
            
        # Get form data
        name = request.form.get('name')
        phone = request.form.get('phone')
        last_barber_id_raw = request.form.get('last_barber_id')
        # Update fields if provided
        if name and name.strip():
            customer.full_name = name.strip()
            
        if phone and phone.strip():
            customer.phone = phone.strip()

        if last_barber_id_raw is not None:
            normalized_last_barber_id = last_barber_id_raw.strip()
            if normalized_last_barber_id:
                try:
                    last_barber_id = int(normalized_last_barber_id)
                except ValueError:
                    return jsonify({"error": "last_barber_id must be a valid integer"}), 400

                barber = Employee.query.filter(
                    Employee.id == last_barber_id,
                    Employee.branch_id == g.branch_id,
                    Employee.employee_type == EmployeeType.BARBER,
                    Employee.is_active == True,
                ).first()
                if not barber:
                    return jsonify({"error": "Selected barber was not found in this branch"}), 400

                customer.last_barber_id = last_barber_id
            else:
                customer.last_barber_id = None
        
        # Handle image uploads
        uploaded_files = request.files.getlist('images[]')
        for file in uploaded_files:
            if file and file.filename:
                try:
                    # Save with branch and customer isolation
                    image_path = save_uploaded_file(file, g.branch_id, customer.id)
                    customer_image = CustomerImage(
                        customer_id=customer.id,
                        image_url=image_path  # Store relative path
                    )
                    db.session.add(customer_image)
                except ValueError as e:
                    print(f"Skipping invalid file: {e}")
        
        db.session.commit()
        
        return jsonify(_serialize_customer(customer, branch_id=g.branch_id)), 200
        
    except IntegrityError as e:
        db.session.rollback()
        if 'uq_branch_phone' in str(e.orig):
            return jsonify({"error": "Phone number already exists for this branch"}), 400
        return jsonify({"error": "Database integrity error", "details": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500

@mini_bp.route('/waiting/draw', methods=['POST'])
@require_cashier
def draw_waiting_ticket():
    """Draw a new waiting ticket for today (per branch)"""
    from app.models.waiting_ticket import WaitingTicket
    from app.extensions import db
    from sqlalchemy import func
    from datetime import date
    
    today = get_cairo_date()
    branch_id = g.branch_id
    
    # Get last number for today for this branch
    max_num = db.session.query(func.max(WaitingTicket.number)).filter_by(date=today, branch_id=branch_id).scalar()
    next_num = (max_num or 0) + 1
    
    ticket = WaitingTicket(
        number=next_num,
        date=today,
        branch_id=branch_id
    )
    
    db.session.add(ticket)
    db.session.commit()
    
    return jsonify(ticket.to_dict()), 201

@mini_bp.route('/waiting/current', methods=['GET'])
@require_cashier
def get_current_waiting_number():
    """Get the latest waiting number for today (per branch)"""
    from app.models.waiting_ticket import WaitingTicket
    from app.extensions import db
    from sqlalchemy import func
    from datetime import date
    
    today = get_cairo_date()
    branch_id = g.branch_id
    
    max_num = db.session.query(func.max(WaitingTicket.number)).filter_by(date=today, branch_id=branch_id).scalar()
    
    return jsonify({"current_number": max_num or 0}), 200

@mini_bp.route('/waiting/reset', methods=['POST'])
@require_cashier
def reset_waiting_tickets():
    """Reset waiting tickets for today (Testing/Admin) - Per Branch"""
    from app.models.waiting_ticket import WaitingTicket
    from app.extensions import db
    from datetime import date
    
    today = get_cairo_date()
    branch_id = g.branch_id
    
    WaitingTicket.query.filter_by(date=today, branch_id=branch_id).delete()
    db.session.commit()
    
    return jsonify({"message": "Waiting tickets reset for today"}), 200

# ============================================================================
# APPOINTMENT ENDPOINTS
# ============================================================================

def _serialize_appointment(appointment):
    """Serialize appointment object with relationships"""
    return {
        "id": appointment.id,
        "customer_id": appointment.customer_id,
        "customer_name": appointment.customer.full_name if appointment.customer else None,
        "phone": appointment.customer.phone if appointment.customer else None,
        "barber_id": appointment.barber_id,
        "barber_name": appointment.barber.full_name if appointment.barber else None,
        "service_id": appointment.service_id,
        "service_name": appointment.service_name or (appointment.service.name if appointment.service else None),
        "date": appointment.appointment_date.isoformat(),
        "time": to_iso_string(appointment.appointment_time),
        "deposit": appointment.deposit_amount,
        "status": appointment.status.value,
        "created_at": appointment.created_at.isoformat() if appointment.created_at else None
    }


def _payment_method_label(payment_method):
    raw = payment_method.value if hasattr(payment_method, 'value') else str(payment_method or '')
    return {
        'CASH': 'كاش',
        'VISA': 'Visa',
        'INSTAPAY': 'Instapay',
    }.get(raw.upper(), raw)


def _serialize_appointment_deposit_transaction(transaction):
    appointment = transaction.appointment
    customer = transaction.customer
    return {
        "id": transaction.id,
        "receipt_number": f"ADT-{transaction.id}",
        "appointment_id": transaction.appointment_id,
        "customer_id": transaction.customer_id,
        "customer_name": customer.full_name if customer else None,
        "customer_phone": customer.phone if customer else None,
        "branch_id": transaction.branch_id,
        "branch_name": transaction.branch.name if transaction.branch else None,
        "business_day_id": transaction.business_day_id,
        "cashier_id": transaction.cashier_id,
        "cashier_name": transaction.cashier.full_name if transaction.cashier else None,
        "collected_by_user_id": transaction.collected_by_user_id,
        "amount": float(transaction.amount),
        "payment_method": transaction.payment_method.value if transaction.payment_method else None,
        "payment_method_label": _payment_method_label(transaction.payment_method),
        "transaction_type": transaction.transaction_type.value if transaction.transaction_type else None,
        "created_at": transaction.created_at.isoformat() if transaction.created_at else None,
        "appointment_date": appointment.appointment_date.isoformat() if appointment and appointment.appointment_date else None,
        "appointment_time": to_iso_string(appointment.appointment_time) if appointment and appointment.appointment_time else None,
        "service_name": appointment.service_name or (appointment.service.name if appointment and appointment.service else None),
        "barber_name": appointment.barber.full_name if appointment and appointment.barber else None,
    }

@mini_bp.route('/appointments', methods=['POST'])
@require_cashier
def create_appointment():
    """Create a new manual appointment with find-or-create customer logic"""
    from app.models.appointment import Appointment
    from app.models.appointment_deposit_transaction import (
        AppointmentDepositTransaction,
        AppointmentDepositTransactionType,
    )
    from app.models.business_day import BusinessDay, BusinessDayStatus
    from app.models.customer import Customer
    from app.models.employee import Employee
    from app.models.customer_balance import CustomerBalance
    from app.extensions import db
    from datetime import datetime
    from decimal import Decimal, InvalidOperation
    
    try:
        data = request.get_json() or {}
        
        # Extract and validate required fields
        customer_name = (data.get('customer_name') or '').strip()
        phone = (data.get('phone') or '').strip()
        appointment_date = data.get('date')  # ISO format: "2024-02-01"
        appointment_time = data.get('time')  # 24-hour format: "16:30"
        
        # Optional fields
        service_name = (data.get('service_name') or '').strip() or None
        barber_id = data.get('barber_id')  # Optional - can be assigned later
        deposit_payment_method_raw = (data.get('deposit_payment_method') or '').strip().upper()
        
        # Validation
        if not customer_name or not phone or not appointment_date or not appointment_time:
            return jsonify({"error": "customer_name, phone, date, and time are required"}), 400

        try:
            deposit_decimal = Decimal(str(data.get('deposit', 0) or 0))
        except InvalidOperation:
            return jsonify({"error": "deposit must be a valid number"}), 400

        if deposit_decimal < 0:
            return jsonify({"error": "deposit cannot be negative"}), 400

        if deposit_decimal != deposit_decimal.quantize(Decimal('1')):
            return jsonify({"error": "deposit must be a whole number"}), 400

        deposit = int(deposit_decimal)

        deposit_payment_method = None
        if deposit > 0:
            if not deposit_payment_method_raw:
                return jsonify({"error": "deposit_payment_method is required when deposit > 0"}), 400
            try:
                deposit_payment_method = PaymentMethod(deposit_payment_method_raw)
            except ValueError:
                return jsonify({"error": "Invalid deposit_payment_method. Must be CASH, VISA, VISA_1, VISA_2, or INSTAPAY"}), 400

            if not g.cashier_id:
                return jsonify({"error": "A cashier context is required to collect a deposit."}), 403
        
        print(f"🔍 RECEIVED APPOINTMENT DATA:")
        print(f"   customer_name: {customer_name}")
        print(f"   phone: {phone}")
        print(f"   appointment_date (RAW): {appointment_date}")
        print(f"   appointment_time (RAW): {appointment_time}")
        print(f"   service_name: {service_name}")
        print(f"   deposit: {deposit}")
        
        open_business_day = None
        if deposit > 0:
            open_business_day = (
                BusinessDay.query
                .filter_by(branch_id=g.branch_id, status=BusinessDayStatus.OPEN)
                .with_for_update()
                .first()
            )
            if not open_business_day:
                return jsonify({"error": "No open business day found for collecting this deposit."}), 400

        # Find or create customer (branch-scoped)
        customer = Customer.query.filter_by(phone=phone, branch_id=g.branch_id).first()
        
        if not customer:
            # Auto-create new customer in this branch
            customer = Customer(
                full_name=customer_name,
                phone=phone,
                branch_id=g.branch_id,
            )
            db.session.add(customer)
            db.session.flush()  # Get customer.id
        elif customer_name and customer.full_name != customer_name:
            customer.full_name = customer_name
        
        # Verify barber belongs to this branch (if provided)
        if barber_id:
            barber = Employee.query.filter_by(id=barber_id, branch_id=g.branch_id).first()
            if not barber:
                return jsonify({"error": "Barber not found or does not belong to this branch"}), 404
        
        # Parse date and time
        try:
            parsed_date = datetime.strptime(appointment_date, '%Y-%m-%d').date()
            parsed_time = datetime.strptime(appointment_time, '%H:%M').time()
            print(f"✅ PARSED DATE: {parsed_date} (type: {type(parsed_date)})")
            print(f"✅ PARSED TIME: {parsed_time} (type: {type(parsed_time)})")
        except ValueError as e:
            print(f"❌ DATE PARSING ERROR: {str(e)}")
            return jsonify({"error": f"Invalid date or time format: {str(e)}"}), 400

        # Deposit Lock Enforcement: Check if slot is locked by an active appointment with a paid deposit
        from app.models.appointment import AppointmentStatus
        from sqlalchemy import or_, and_, exists

        # Lock any existing rows at this branch/date/time to prevent concurrent deposit race conditions
        existing_slot_appointments = (
            Appointment.query
            .filter_by(
                branch_id=g.branch_id,
                appointment_date=parsed_date,
                appointment_time=parsed_time
            )
            .with_for_update()
            .all()
        )
        for existing_app in existing_slot_appointments:
            if existing_app.status != AppointmentStatus.CANCELLED:
                has_deposit_tx = (
                    AppointmentDepositTransaction.query
                    .filter_by(
                        appointment_id=existing_app.id,
                        transaction_type=AppointmentDepositTransactionType.DEPOSIT_COLLECTION
                    )
                    .filter(AppointmentDepositTransaction.amount > 0)
                    .first()
                )
                if existing_app.deposit_amount > 0 or has_deposit_tx:
                    return jsonify({
                        "error": "هذا الموعد محجوز ومؤكد بعربون. يرجى اختيار موعد آخر."
                    }), 409
        
        # Create appointment
        appointment = Appointment(
            branch_id=g.branch_id,
            customer_id=customer.id,
            barber_id=barber_id,  # Can be None
            service_id=None,  # Will be used when admin adds services
            service_name=service_name,  # Free-text for now
            appointment_date=parsed_date,
            appointment_time=parsed_time,
            deposit_amount=deposit
        )
        
        print(f"✅ APPOINTMENT OBJECT CREATED:")
        print(f"   appointment_date: {appointment.appointment_date}")
        print(f"   appointment_time: {appointment.appointment_time}")
        
        db.session.add(appointment)
        db.session.flush()  # Get appointment.id
        
        deposit_transaction = None
        # Handle deposit - increase customer balance
        if deposit > 0:
            deposit_transaction = AppointmentDepositTransaction(
                appointment_id=appointment.id,
                customer_id=customer.id,
                branch_id=g.branch_id,
                business_day_id=open_business_day.id,
                cashier_id=g.cashier_id,
                collected_by_user_id=g.user_id,
                amount=deposit,
                payment_method=deposit_payment_method,
                transaction_type=AppointmentDepositTransactionType.DEPOSIT_COLLECTION,
            )
            db.session.add(deposit_transaction)

            balance = (
                CustomerBalance.query
                .filter_by(customer_id=customer.id, branch_id=g.branch_id)
                .with_for_update()
                .first()
            )
            
            if balance:
                balance.balance += deposit
            else:
                balance = CustomerBalance(
                    customer_id=customer.id,
                    branch_id=g.branch_id,
                    balance=deposit
                )
                db.session.add(balance)
        
        db.session.commit()

        response = _serialize_appointment(appointment)
        if deposit_transaction:
            response["deposit_transaction"] = _serialize_appointment_deposit_transaction(deposit_transaction)
        
        return jsonify(response), 201
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500

@mini_bp.route('/appointments', methods=['GET'])
@require_cashier
def get_appointments():
    """Get upcoming appointments for the current branch"""
    from app.models.appointment import Appointment, AppointmentStatus
    from sqlalchemy.orm import joinedload
    from datetime import date, timedelta

    try:
        today    = get_cairo_date()
        tomorrow = today + timedelta(days=1)

        # Eager-load all three lazy relationships to eliminate 1+3N query pattern.
        # Without joinedload: 1 query + 3 per appointment (customer, barber, service).
        # With joinedload: 1 query total (single LEFT OUTER JOIN for scalar relations;
        # SQLAlchemy batches collection relations automatically).
        appointments = (
            Appointment.query
            .options(
                joinedload(Appointment.customer),
                joinedload(Appointment.barber),
                joinedload(Appointment.service),
            )
            .filter_by(branch_id=g.branch_id, status=AppointmentStatus.SCHEDULED)
            .filter(Appointment.appointment_date >= today)
            .order_by(Appointment.appointment_date, Appointment.appointment_time)
            .all()
        )

        # Group by today / tomorrow / future
        today_appointments = [
            _serialize_appointment(a) for a in appointments
            if a.appointment_date == today
        ]
        tomorrow_appointments = [
            _serialize_appointment(a) for a in appointments
            if a.appointment_date == tomorrow
        ]
        future_appointments = [
            _serialize_appointment(a) for a in appointments
            if a.appointment_date > tomorrow
        ]

        return jsonify({
            "today":    today_appointments,
            "tomorrow": tomorrow_appointments,
            "future":   future_appointments,
        }), 200

    except Exception as e:
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@mini_bp.route('/appointments/<int:appointment_id>/cashier-context', methods=['GET'])
@require_cashier
def get_booking_cashier_context(appointment_id):
    from app.services.booking_handoff_service import get_context, safe_barber, safe_service
    try:
        booking, invoice, deposit = get_context(appointment_id, g.branch_id)
        barber, service = safe_barber(booking), safe_service(booking)
        return jsonify({
            'appointment': {**_serialize_appointment(booking), 'branch_id': booking.branch_id},
            'customer': {**_serialize_customer(booking.customer, g.branch_id), 'full_name': booking.customer.full_name},
            'invoice': _serialize_invoice(invoice) if invoice else None,
            'eligible_deposit': deposit,
            'prefill_service': {'id': service.id, 'name': service.name, 'price': service.price,
                                'has_assistant': service.category.commission_type.value == 'BARBER_AND_ASSISTANT'} if service else None,
            'prefill_barber': {'id': barber.id, 'name': barber.full_name} if barber else None,
            'prefill_service_id': service.id if service else None,
            'prefill_barber_id': barber.id if barber else None,
        })
    except ValueError as error:
        return jsonify({'error': 'BOOKING_HANDOFF_UNAVAILABLE', 'message': str(error)}), 409


@mini_bp.route('/invoice/<int:invoice_id>/booking-multi-customer', methods=['POST'])
@require_cashier
def mark_booking_multi_customer(invoice_id):
    invoice = Invoice.query.filter_by(id=invoice_id, branch_id=g.branch_id).with_for_update().first()
    if not invoice or not invoice.booking_appointment_id or invoice.status != InvoiceStatus.DRAFT:
        db.session.rollback()
        return jsonify({'error': 'فاتورة الحجز غير متاحة'}), 409
    invoice.booking_multi_customer = True  # Monotonic: refresh cannot enable a deposit again.
    db.session.commit()
    return jsonify(_serialize_invoice(invoice))


@mini_bp.route('/appointments/<int:appointment_id>', methods=['PATCH'])
@require_cashier
def update_appointment_status(appointment_id):
    """Update appointment status"""
    from app.models.appointment import Appointment, AppointmentStatus
    from app.extensions import db
    
    try:
        data = request.get_json()
        status = data.get('status')
        
        if not status:
            return jsonify({"error": "status is required"}), 400
        
        # Validate status
        try:
            new_status = AppointmentStatus(status)
        except ValueError:
            return jsonify({"error": "Invalid status. Must be: scheduled, completed, or cancelled"}), 400
        
        # Get appointment
        appointment = Appointment.query.get(appointment_id)
        
        if not appointment:
            return jsonify({"error": "Appointment not found"}), 404
        
        # Verify branch ownership
        if appointment.branch_id != g.branch_id:
            return jsonify({"error": "Unauthorized access to this appointment"}), 403
        
        # If reactivating or modifying an appointment with a paid deposit, ensure slot is not locked by another appointment
        if new_status != AppointmentStatus.CANCELLED and appointment.status == AppointmentStatus.CANCELLED and appointment.deposit_amount > 0:
            other_locked = (
                Appointment.query
                .filter(
                    Appointment.branch_id == appointment.branch_id,
                    Appointment.appointment_date == appointment.appointment_date,
                    Appointment.appointment_time == appointment.appointment_time,
                    Appointment.id != appointment.id,
                    Appointment.status != AppointmentStatus.CANCELLED,
                    Appointment.deposit_amount > 0
                )
                .first()
            )
            if other_locked:
                return jsonify({
                    "error": "هذا الموعد محجوز ومؤكد بعربون. يرجى اختيار موعد آخر."
                }), 409

        # Update status
        appointment.status = new_status
        db.session.commit()
        
        return jsonify(_serialize_appointment(appointment)), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@mini_bp.route('/appointments/<int:appointment_id>', methods=['DELETE'])
@require_cashier
def delete_appointment(appointment_id):
    """Delete an appointment (branch-scoped)"""
    from app.models.appointment import Appointment
    from app.models.appointment_deposit_transaction import AppointmentDepositTransaction
    from app.models.customer_balance import CustomerBalance
    from app.extensions import db
    try:
        appointment = Appointment.query.filter_by(
            id=appointment_id,
            branch_id=g.branch_id
        ).first()
        
        if not appointment:
            return jsonify({"error": "Appointment not found or does not belong to this branch"}), 404

        has_financial_transactions = (
            AppointmentDepositTransaction.query
            .filter_by(appointment_id=appointment.id)
            .first()
        )

        if has_financial_transactions:
            return jsonify({
                "error": "This appointment has recorded deposit transactions and cannot be deleted in Phase 1."
            }), 409
        
        # Legacy safeguard: only appointments with no immutable financial rows
        # are still allowed to reverse their old aggregate-only deposit effect.
        if appointment.deposit_amount > 0:
            balance = CustomerBalance.query.filter_by(
                customer_id=appointment.customer_id,
                branch_id=g.branch_id
            ).first()
            
            if balance:
                balance.balance -= appointment.deposit_amount
                if balance.balance < 0:
                    balance.balance = 0
        
        db.session.delete(appointment)
        db.session.commit()
        
        return jsonify({"message": "Appointment deleted successfully"}), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


# ============================================================================
# EXPENSE ENDPOINTS
# ============================================================================

@mini_bp.route('/expense-categories', methods=['GET'])
@require_cashier
def get_mini_expense_categories():
    """
    Get active expense categories for the current branch.
    
    Response: [
        {"id": 1, "name": "Category A"},
        {"id": 2, "name": "Category B"}
    ]
    """
    from app.models.expense_category import ExpenseCategory
    from app.models.branch_expense_category import BranchExpenseCategory
    from app.extensions import db
    
    try:
        # Determine strict branch assignment
        # OLD Logic: Global categories are those assigned to this branch via BranchExpenseCategory
        # NEW Logic: expenses are GLOBAL. All active categories are available to all branches.
        
        categories = ExpenseCategory.query.filter_by(
            is_active=True
        ).order_by(ExpenseCategory.name.asc()).all()

        print(f"🔍 [expense-categories] Global Fetch: found={len(categories)} categories")

        # Serialize to strictly required flat shape
        response = [
            {"id": cat.id, "name": cat.name}
            for cat in categories
        ]

        return jsonify(response), 200
        
    except Exception as e:
        return jsonify({"error": "Failed to fetch expense categories", "details": str(e)}), 500


@mini_bp.route('/expenses/categories', methods=['GET'])
@require_cashier
def get_expense_categories():
    """Get active expense categories allowed for the current branch (Legacy/Duplicate)"""
    from app.models.expense_category import ExpenseCategory
    from app.models.branch_expense_category import BranchExpenseCategory
    from app.extensions import db
    
    try:
        # Query categories that are:
        # 1. Active globally (expense_category.is_active = true)
        # 2. Assigned to this branch (via branch_expense_categories) -> REMOVED
        # 3. Active for this branch (branch_expense_category.is_active = true) -> REMOVED
        
        # NEW LOGIC: Just active global categories
        categories = ExpenseCategory.query.filter_by(
            is_active=True
        ).order_by(ExpenseCategory.name.asc()).all()
        
        return jsonify([{
            'id': cat.id,
            'name': cat.name
        } for cat in categories]), 200
        
    except Exception as e:
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@mini_bp.route('/expenses', methods=['POST'])
@require_cashier
def create_expense():
    """Create a new expense record"""
    from app.models.expense import Expense
    from app.models.expense_category import ExpenseCategory
    from app.models.branch_expense_category import BranchExpenseCategory
    from app.models.employee import Employee
    from app.extensions import db
    from datetime import date
    
    try:
        data = request.get_json()
        
        # Extract fields
        expense_category_id = data.get('expense_category_id')
        amount = data.get('amount')
        notes = data.get('notes', '').strip() or None
        expense_date_str = data.get('expense_date')
        
        # Validation
        if not expense_category_id:
            return jsonify({"error": "expense_category_id is required"}), 400
        
        if not amount or amount <= 0:
            return jsonify({"error": "amount must be greater than 0"}), 400
        
        # Parse expense_date (default to today if not provided)
        if expense_date_str:
            try:
                expense_date = date.fromisoformat(expense_date_str)
            except ValueError:
                return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400
        else:
            expense_date = get_cairo_date()
        
        # Validate expense_date is not in the future
        if expense_date > get_cairo_date():
            return jsonify({"error": "expense_date cannot be in the future"}), 400
        
        # Verify category exists and is active
        category = ExpenseCategory.query.filter_by(
            id=expense_category_id,
            is_active=True
        ).first()
        
        if not category:
            return jsonify({"error": "Expense category not found or inactive"}), 404
        
        # Verify category is allowed for this branch -> REMOVED (Global Categories)
        # branch_category = BranchExpenseCategory.query.filter_by(...)
        
        # if not branch_category:
        #    return jsonify({"error": "This expense category is not allowed for your branch"}), 403
        
        # Resolve Cashier User ID directly from token (Secure & Robust)
        try:
            user_id = int(g.user_id)
        except (ValueError, TypeError):
             return jsonify({"error": "Invalid user identity in token"}), 401
            
        # ============================================================================
        # AUTHORIZATION & BRANCH SELECTION
        # ============================================================================
        
        target_branch_id = None
        
        # 1. Determine Target Branch based on Role
        if g.is_admin:
            # Admin Case
            payload_branch_id = data.get('branch_id')
            
            if g.role in ['SUPER_ADMIN', 'EXEC_ADMIN']:
                # Super Admin: usage of payload branch_id is required if token doesn't have it
                # (Though Admin tokens usually have branch_id=None for Super Admin)
                target_branch_id = payload_branch_id or g.branch_id
                
                if not target_branch_id:
                    return jsonify({"error": "branch_id is required for Global Admin"}), 400
                    
            elif g.role == 'BRANCH_MANAGER':
                # Branch Manager: Must match their assigned branch
                if not g.branch_id:
                     return jsonify({"error": "Branch Manager has no assigned branch"}), 403
                
                if payload_branch_id and int(payload_branch_id) != int(g.branch_id):
                     return jsonify({"error": "Access denied to other branch"}), 403
                     
                target_branch_id = g.branch_id
            
            else:
                 return jsonify({"error": "Role not supported"}), 403
                 
        else:
            # Cashier Case
            target_branch_id = g.branch_id
        
        print(f"DEBUG AUTH: Role={g.role}, User={user_id}, TargetBranch={target_branch_id}, IsAdmin={g.is_admin}")
        
        # NOTE: Shift enforcement removed as per simplified workflow (sa3don branch)
        
        # ── BUSINESS DAY ENFORCEMENT ──────────────────────────────────────────
        # SELECT FOR UPDATE serialises concurrent create_expense calls: only one
        # request holds the row-level lock on the OPEN day at a time.
        # expense.business_day_id is set from this lock; expense_date is kept
        # for historical display only and is NOT used for treasury calculations.
        from app.models.business_day import BusinessDay, BusinessDayStatus
        open_day = (
            BusinessDay.query
            .filter_by(branch_id=target_branch_id, status=BusinessDayStatus.OPEN)
            .with_for_update()
            .first()
        )
        if not open_day:
            return jsonify({
                "error": "Cannot create expense: no open business day."
            }), 400
        # ─────────────────────────────────────────────────────────────────────

        # Create expense — business_day_id anchors this record to the current
        # OPEN BusinessDay; expense_date is kept for display/audit only.
        expense = Expense(
            branch_id=target_branch_id,
            expense_category_id=expense_category_id,
            amount=amount,
            notes=notes,
            expense_date=expense_date,
            created_by=user_id,
            business_day_id=open_day.id,
        )
        
        db.session.add(expense)
        db.session.commit()
        
        # ============================================================================
        # TREASURY INTEGRATION: Create OUT transaction for expense
        # ============================================================================
          

        return jsonify(expense.to_dict()), 201
        
    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        print(f"❌ [create_expense] Exception: {e}")
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


# ============================================================================
# STAGE 2 – DUAL WRITE HELPER
# Writes a parallel record to employee_financial_actions inside the SAME
# db.session that the caller is already using. The caller is responsible
# for the final commit() — this helper only does session.add() + flush().
#
# On any exception the helper emits a warning log and re-raises so the
# caller's except block can rollback the whole transaction atomically.
# ============================================================================

def _dual_write_efa(
    employee_id: int,
    branch_id: int,
    action_type_str: str,
    amount,
    is_cash_event: bool,
    notes: str = None,
    created_by: int = None,
    related_invoice_id: int = None
):
    """
    Insert a record into employee_financial_actions using the current
    db.session (no commit — caller owns the transaction).

    action_type_str must be a valid EmployeeActionType value:
      ADVANCE | DEDUCTION | COMMISSION_WITHDRAWAL | OVERTIME | MANUAL_ADJUSTMENT
    """
    from app.models.employee_financial_action import EmployeeFinancialAction, EmployeeActionType

    efa = EmployeeFinancialAction(
        employee_id=employee_id,
        branch_id=branch_id,
        action_type=EmployeeActionType(action_type_str),
        amount=amount,
        is_cash_event=is_cash_event,
        notes=notes,
        created_by=created_by,
        related_invoice_id=related_invoice_id
    )
    db.session.add(efa)
    db.session.flush()  # Get ID without committing
    return efa


@mini_bp.route('/barbers/<int:barber_id>/financial-action', methods=['POST'])
@require_cashier
def create_financial_action(barber_id):
    """
    Record a financial action (Advance, Deduction, etc.) for a barber.
    Actions are recorded as Expenses.
    """
    from app.models.employee import Employee, EmployeeType
    from app.models.expense import Expense
    from app.models.expense_category import ExpenseCategory
    from app.models.branch_expense_category import BranchExpenseCategory
    from app.extensions import db
    from datetime import date
    from flask import request, jsonify, g
    # get_cairo_date imported at module level from app.utils.date_utils
    
    try:
        data = request.get_json()
        action_type = data.get('type')  # ADVANCE, DEDUCTION, COMMISSION_PAYOUT, OVERTIME
        amount = data.get('amount')
        notes = data.get('notes', '').strip()
        
        # 1. Validation
        if not action_type or not amount or amount <= 0:
            return jsonify({"error": "Valid type and amount > 0 are required"}), 400
            
        # Map Action Type to Category Name (Arabic) and Code
        CATEGORY_MAP = {
            'ADVANCE': {'name': 'سلفة', 'code': 'ADVANCE'},
            'DEDUCTION': {'name': 'خصم', 'code': 'DISCOUNT'},
            'COMMISSION_PAYOUT': {'name': 'نسبة يومية', 'code': 'DAILY_PERCENTAGE'},
            'OVERTIME': {'name': 'أوفر تايم', 'code': 'OVERTIME'}
        }
        
        category_info = CATEGORY_MAP.get(action_type)
        if not category_info:
             return jsonify({"error": f"Invalid action type. Allowed: {list(CATEGORY_MAP.keys())}"}), 400
        
        category_name = category_info['name']
        category_code = category_info['code']
             
        # 2. Verify Barber
        barber = Employee.query.get(barber_id)
        if not barber:
            return jsonify({"error": "Barber not found"}), 404
            
        if barber.branch_id != g.branch_id:
             return jsonify({"error": "Barber does not belong to your branch"}), 403
             
        if not barber.is_active:
             return jsonify({"error": "Barber is not active"}), 400
             
        # 3. Ensure Category Exists & Linked (Auto-Fix Logic)
        category = ExpenseCategory.query.filter_by(code=category_code).first()
        if not category:
            # Create Global Category with code
            category = ExpenseCategory(name=category_name, code=category_code, is_active=True)
            db.session.add(category)
            db.session.flush() # Get ID
            
        # Ensure Link to Branch Exists -> REMOVED (Global Categories)
        # link = BranchExpenseCategory.query.filter_by(...)
        # if not link: ...
            
        # 4. Create Expense Record
        # Append Barber Name to notes for Admin visibility
        full_notes = f"[{barber.full_name}]"
        if notes:
            full_notes += f" - {notes}"
        
        # Resolve Cashier Employee ID to User ID (needed for created_by field)
        from app.models.user import User
        cashier_employee = Employee.query.get(g.cashier_id)
        if not cashier_employee:
            return jsonify({"error": "Cashier employee not found"}), 500
            
        # Find user account by matching employee name and branch
        cashier_user = User.query.filter_by(
            full_name=cashier_employee.full_name,
            branch_id=g.branch_id
        ).first()
        
        if not cashier_user:
            return jsonify({"error": "Cashier user account not found. Please contact admin."}), 500
            
        # ── OVERTIME ENHANCEMENT: Now treated as cash expense ────────────────
        # OVERTIME now creates Expense for treasury + EmployeeOvertime record
        if action_type == 'OVERTIME':
            from app.models.employee_overtime import EmployeeOvertime
            overtime = EmployeeOvertime(
                employee_id=barber.id,
                amount=amount,
                reason=notes if notes else "أوفر تايم",
                date=get_cairo_date()
            )
            db.session.add(overtime)
            db.session.flush()
            
            # Note: OVERTIME will now continue to Expense creation below
            # and EFA creation via the unified handler (not early return)
            # This allows OVERTIME to affect treasury like ADVANCE/COMMISSION

        # ── PHASE 2 CLEAN: Skip Expense creation for DEDUCTION ────────────────
        # DEDUCTION is salary netting, not an actual expense transaction
        # It will only be recorded in EmployeeFinancialAction (for admin visibility)
        # ADVANCE and COMMISSION_PAYOUT still create Expense records for treasury
        
        if action_type != 'DEDUCTION':
            # ── Get current OPEN business day for treasury tracking ──────────────
            from app.models.business_day import BusinessDay, BusinessDayStatus
            current_business_day = BusinessDay.query.filter_by(
                branch_id=g.branch_id,
                status=BusinessDayStatus.OPEN
            ).first()
            
            # ── Determine if this is a cash event for treasury ──────────────────
            # ADVANCE and COMMISSION_PAYOUT are actual cash events, so is_cash_event=True
            is_cash_event = True
            
            expense = Expense(
                branch_id=g.branch_id,
                expense_category_id=category.id,
                amount=amount,
                notes=full_notes,
                expense_date=get_cairo_date(),
                created_by=cashier_user.id,  # Use user.id, not employee.id
                is_cash_event=is_cash_event,
                business_day_id=current_business_day.id if current_business_day else None
            )
            # Note: 'source' field is not on Expense model based on previous file reads.
            # Ideally, we would set source='BARBER_ACTION' but the model might not have it.
            # Admin API hardcodes source="Mini System" based on logic.
            # If we need to distinguish, we rely on Category and Notes.
            
            db.session.add(expense)
            db.session.flush()  # Get expense ID for treasury

        # ── DUAL WRITE: employee_financial_actions ────────────────────────
        # Map original Mini action type → EmployeeActionType enum value
        EFA_TYPE_MAP = {
            'ADVANCE':           ('ADVANCE',              True),   # cash leaves register
            'DEDUCTION':         ('DEDUCTION',            False),  # no cash today — salary netting
            'COMMISSION_PAYOUT': ('COMMISSION_WITHDRAWAL', True),  # cash commission payout
            'OVERTIME':          ('OVERTIME',             True),   # cash payout for overtime (now cash event)
        }
        efa_type_str, efa_is_cash = EFA_TYPE_MAP.get(action_type, (None, False))
        if efa_type_str:
            _dual_write_efa(
                employee_id=barber.id,
                branch_id=g.branch_id,
                action_type_str=efa_type_str,
                amount=amount,
                is_cash_event=efa_is_cash,
                notes=full_notes,
                created_by=cashier_user.id
            )
        # ─────────────────────────────────────────────────────────────────

        db.session.commit()

        return jsonify({"success": True}), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@mini_bp.route('/expenses/today', methods=['GET'])
@require_cashier
def get_today_expenses():
    """Get expenses for the current open business day for this branch"""
    from app.models.expense import Expense
    from app.models.business_day import BusinessDay, BusinessDayStatus
    from datetime import date
    from sqlalchemy import func
    from app.extensions import db
    from flask import jsonify, g
    # get_cairo_date imported at module level from app.utils.date_utils
    
    try:
        # Get the current OPEN business day for this branch
        current_business_day = BusinessDay.query.filter_by(
            branch_id=g.branch_id,
            status=BusinessDayStatus.OPEN
        ).first()
        
        # If no open business day, return empty list
        if not current_business_day:
            return jsonify([]), 200
        
        # Get expenses for the current business day only
        # Filter: branch must match, business_day_id must match, and NOT NULL
        expenses = Expense.query.filter(
            Expense.branch_id == g.branch_id,
            Expense.business_day_id == current_business_day.id,
            Expense.business_day_id.isnot(None)  # Exclude NULL business_day_id
        ).order_by(Expense.created_at.desc()).all()
        
        # Calculate total for this business day only
        total = db.session.query(func.sum(Expense.amount)).filter(
            Expense.branch_id == g.branch_id,
            Expense.business_day_id == current_business_day.id,
            Expense.business_day_id.isnot(None)
        ).scalar() or 0
        
        items = []
        for expense in expenses:
            try:
                items.append(expense.to_dict())
            except Exception as ser_error:
                print(f"Error serializing expense {expense.id}: {ser_error}")
                # Fallback or skip
                continue

        return jsonify(items), 200 # Return LIST directly to match App.tsx expectation!
        
    except Exception as e:
        print(f"GET /expenses/today failed: {e}")
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@mini_bp.route('/barbers/<int:barber_id>/daily-commission', methods=['GET'])
@require_cashier
def get_barber_daily_commission(barber_id):
    """
    Get commission wallet balance for a barber (Mini System).
    Returns cumulative commission balance, not just today's.
    """
    from app.models.employee import Employee
    from flask import jsonify, g
    
    try:
        # Verify barber belongs to cashier's branch
        barber = Employee.query.get_or_404(barber_id)
        if barber.branch_id != g.branch_id:
            return jsonify({"error": "Unauthorized access"}), 403
        
        # Return wallet balance
        return jsonify({
            "barber_id": barber_id,
            "wallet_balance": float(barber.commission_wallet_balance or 0)
        }), 200
        
    except Exception as e:
        print(f"Failed to fetch barber commission wallet: {e}")
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@mini_bp.route('/barbers/<int:barber_id>/withdraw-commission', methods=['POST'])
@require_cashier
def withdraw_barber_commission(barber_id):
    """
    Withdraw commission for a barber (Mini System) - Manual Input Mode.
    
    REQUEST BODY:
    {
      "amount": 200  // Manual input amount (overwrites wallet balance)
    }
    
    Records as expense and optionally updates wallet balance.
    Allows manual override - does not block if balance insufficient.
    """
    from app.models.employee import Employee
    from app.models.expense import Expense
    from app.models.expense_category import ExpenseCategory
    from app.models.user import User
    from app.extensions import db
    from flask import request, jsonify, g
    
    try:
        # 1. GET REQUEST DATA (Manual Input)
        data = request.get_json()
        amount = data.get('amount')
        
        # 2. VALIDATION
        if not amount or amount <= 0:
            return jsonify({"error": "Valid amount > 0 is required"}), 400
        
        # 3. VERIFY BARBER
        barber = Employee.query.get_or_404(barber_id)
        if barber.branch_id != g.branch_id:
            return jsonify({"error": "Unauthorized access"}), 403
        
        # 4. ENSURE CATEGORY EXISTS WITH CODE
        category = ExpenseCategory.query.filter_by(code='DAILY_PERCENTAGE').first()
        if not category:
            category = ExpenseCategory(name='نسبة يومية', code='DAILY_PERCENTAGE', is_active=True)
            db.session.add(category)
            db.session.flush()
        
        # 5. RESOLVE CASHIER USER ID
        cashier_employee = Employee.query.get(g.cashier_id)
        if not cashier_employee:
            return jsonify({"error": "Cashier employee not found"}), 500
            
        cashier_user = User.query.filter_by(
            full_name=cashier_employee.full_name,
            branch_id=g.branch_id
        ).first()
        
        if not cashier_user:
            return jsonify({"error": "Cashier user account not found"}), 500
        
        # ── MANUAL INPUT MODE (ENHANCED) ─────────────────────────────────
        # NEW: Amount comes from manual input, NOT from wallet balance
        # OPTIONAL: Still decrement wallet (for audit trail) but don't block
        withdrawal_amount = amount
        
        # Get current wallet balance (optional tracking)
        wallet_balance = barber.commission_wallet_balance or 0
        
        # 6. CREATE EXPENSE (with manual input amount)
        # ── Get current OPEN business day for treasury tracking ──────────────
        from app.models.business_day import BusinessDay, BusinessDayStatus
        current_business_day = BusinessDay.query.filter_by(
            branch_id=g.branch_id,
            status=BusinessDayStatus.OPEN
        ).first()
        
        notes = f"[{barber.full_name}] - سحب رصيد النسبة (يدوي)"
        
        expense = Expense(
            branch_id=g.branch_id,
            expense_category_id=category.id,
            amount=withdrawal_amount,  # ← NEW: Use manual input
            notes=notes,
            expense_date=get_cairo_date(),
            created_by=cashier_user.id,
            is_cash_event=True,  # Commission withdrawal is actual cash leaving register
            business_day_id=current_business_day.id if current_business_day else None
        )
        
        db.session.add(expense)
        db.session.flush()  # Get expense ID for treasury

        # 7. DUAL WRITE: employee_financial_actions
        # ── NEW: Use unified EFA handler (matching ADVANCE/COMMISSION pattern) ────
        _dual_write_efa(
            employee_id=barber.id,
            branch_id=g.branch_id,
            action_type_str='COMMISSION_WITHDRAWAL',
            amount=withdrawal_amount,  # ← NEW: Use manual input
            is_cash_event=True,   # cash physically leaves the register
            notes=notes,
            created_by=cashier_user.id
        )
        # ─────────────────────────────────────────────────────────────────

        # 8. OPTIONAL: DECREMENT WALLET BALANCE (but don't block if insufficient)
        # MANUAL OVERRIDE MODE: Withdrawal happens regardless of wallet state
        if wallet_balance > 0:
            # Decrement wallet (audit trail), but allow override
            barber.commission_wallet_balance = max(0, wallet_balance - withdrawal_amount)

        db.session.commit()
        
        return jsonify({
            "success": True,
            "amount_withdrawn": float(withdrawal_amount),
            "wallet_balance_before": float(wallet_balance),
            "wallet_balance_after": float(barber.commission_wallet_balance or 0),
            "message": "تم سحب الرصيد بنجاح"
        }), 201
        
    except Exception as e:
        db.session.rollback()
        print(f"Failed to withdraw barber commission: {e}")
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500



@mini_bp.route('/invoices/today', methods=['GET'])
@require_cashier
def get_today_invoices():
    """Get today's invoices for the current branch"""
    from datetime import date, datetime
    from app.models.invoice import Invoice, InvoiceStatus
    from flask import jsonify, g
    # get_cairo_date, to_iso_string imported at module level from app.utils.date_utils
    try:
        today = get_cairo_date()
        
        # Get all PAID or DRAFT invoices for today for this branch
        # Most operational history ignores CANCELED unless asked
        invoices = Invoice.query.filter(
            Invoice.branch_id == g.branch_id,
            Invoice.created_at >= datetime.combine(today, datetime.min.time()),
            Invoice.status != InvoiceStatus.CANCELED
        ).order_by(Invoice.created_at.desc()).all()
        
        results = []
        for inv in invoices:
            results.append({
                "invoice_number": inv.invoice_number,
                "time": to_iso_string(inv.created_at),
                "total_amount": inv.total_amount,
                "payment_method": inv.payment_method.value if inv.payment_method else None,
                "status": inv.status.value
            })
            
        return jsonify(results), 200
        
    except Exception as e:
        print(f"GET /invoices/today failed: {e}")
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


# ============================================================================
# Branch Supply Requests
# ============================================================================

def _generate_supply_request_ref():
    from app.utils.date_utils import get_utc_now
    return f"REQ-{get_utc_now().strftime('%Y%m%d-%H%M%S%f')[:-3]}"

def _serialize_supply_request_item(item):
    return {
        "id": item.id,
        "product_id": item.product_id,
        "product_name": item.product.name if item.product else f"منتج #{item.product_id}",
        "requested_quantity": item.requested_quantity,
        "final_quantity": item.final_quantity,
        "image_url": item.product.image_url if item.product else None,
        "unit": item.product.unit if item.product else ""
    }

def _serialize_supply_request(req):
    items = [_serialize_supply_request_item(item) for item in req.items]
    return {
        "id": req.id,
        "request_ref": req.request_ref,
        "branch_id": req.branch_id,
        "status": req.status,
        "note": req.note,
        "created_by_employee_id": req.created_by_employee_id,
        "created_by_employee_name": req.created_by_employee.full_name if req.created_by_employee else None,
        "shipment_id": req.shipment_id,
        "shipment_ref": req.shipment.shipment_ref if req.shipment else None,
        "shipment_status": req.shipment.status if req.shipment else None,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "sent_at": req.sent_at.isoformat() if req.sent_at else None,
        "items_count": len(items),
        "total_requested_quantity": sum(int(item.requested_quantity or 0) for item in req.items),
        "items": items,
    }


def _build_paginated_items_response(items, page, per_page, total):
    total_pages = (total + per_page - 1) // per_page if total > 0 else 0
    current_page = total_pages if total_pages > 0 and page > total_pages else page
    return {
        "items": items,
        "page": current_page,
        "per_page": per_page,
        "total": total,
        "total_pages": total_pages,
        "has_more": current_page < total_pages,
    }


def _generate_return_request_ref():
    return f"RET-{get_utc_now().strftime('%Y%m%d-%H%M%S%f')[:-3]}"


def _serialize_return_request(req):
    from app.models.supply_operations import RETURN_REQUEST_REASON_LABELS

    return {
        "id": req.id,
        "return_ref": req.return_ref,
        "branch_id": req.branch_id,
        "product_id": req.product_id,
        "product_name": req.product.name if req.product else f"منتج #{req.product_id}",
        "product_unit": req.product.unit if req.product else "",
        "product_image_url": req.product.image_url if req.product else None,
        "requested_quantity": int(req.requested_quantity or 0),
        "branch_stock_snapshot": int(req.branch_stock_snapshot or 0),
        "reason": req.reason,
        "reason_label": RETURN_REQUEST_REASON_LABELS.get(req.reason, req.reason),
        "notes": req.notes,
        "status": req.status,
        "created_by_employee_id": req.created_by_employee_id,
        "created_by_employee_name": req.created_by_employee.full_name if req.created_by_employee else None,
        "resolved_by_user_id": req.resolved_by_user_id,
        "resolved_by_user_name": req.resolved_by_user.full_name if req.resolved_by_user else None,
        "resolved_at": req.resolved_at.isoformat() if req.resolved_at else None,
        "resolution_note": req.resolution_note,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "updated_at": req.updated_at.isoformat() if req.updated_at else None,
    }

@mini_bp.route('/supply-requests', methods=['POST'])
@require_cashier
def create_supply_request():
    from app.models.product import Product
    from app.models.supply_operations import StockSupplyRequest, StockSupplyRequestItem
    try:
        if not g.branch_id:
            return jsonify({"error": "Branch context is missing"}), 400
        if not g.cashier_id:
            return jsonify({"error": "Cashier context is missing"}), 400

        data = request.get_json() or {}
        note = data.get('note')
        raw_items = data.get('items')

        if not raw_items or not isinstance(raw_items, list):
            return jsonify({"error": "يجب إضافة منتج واحد على الأقل للطلب."}), 400

        # Validate and aggregate items
        aggregated_items = {}
        for raw_item in raw_items:
            try:
                product_id = int(raw_item.get('product_id'))
                qty = int(raw_item.get('requested_quantity') or raw_item.get('quantity'))
            except (TypeError, ValueError):
                return jsonify({"error": "بيانات المنتج أو الكمية غير صحيحة."}), 400

            if qty <= 0:
                return jsonify({"error": "كمية كل منتج يجب أن تكون أكبر من الصفر."}), 400

            aggregated_items[product_id] = aggregated_items.get(product_id, 0) + qty

        product_ids = list(aggregated_items.keys())
        products = Product.query.filter(Product.id.in_(product_ids), Product.is_active == True).all()
        products_by_id = {p.id: p for p in products}

        missing = [p_id for p_id in product_ids if p_id not in products_by_id]
        if missing:
            return jsonify({"error": "بعض المنتجات المطلوبة غير متوفرة أو غير نشطة."}), 400

        request_ref = _generate_supply_request_ref()
        req_obj = StockSupplyRequest(
            request_ref=request_ref,
            branch_id=g.branch_id,
            status='PENDING',
            note=note.strip() if note else None,
            created_by_employee_id=g.cashier_id
        )
        db.session.add(req_obj)
        db.session.flush()

        for p_id, qty in aggregated_items.items():
            req_item = StockSupplyRequestItem(
                request_id=req_obj.id,
                product_id=p_id,
                requested_quantity=qty
            )
            db.session.add(req_item)

        db.session.commit()
        return jsonify(_serialize_supply_request(req_obj)), 201

    except Exception as e:
        db.session.rollback()
        print(f"Failed to create supply request: {e}")
        return jsonify({"error": "Failed to create request", "details": str(e)}), 500

@mini_bp.route('/supply-requests', methods=['GET'])
@require_cashier
def list_supply_requests():
    from app.models.employee import Employee
    from app.models.supply_operations import StockShipment, StockSupplyRequest, StockSupplyRequestItem
    try:
        if not g.branch_id:
            return jsonify({"error": "Branch context is missing"}), 400

        page = max(1, int(request.args.get('page', 1)))
        per_page = min(100, max(1, int(request.args.get('per_page', 10))))
        status_filter = (request.args.get('status') or 'ALL').strip().upper()

        if status_filter not in {'ALL', 'ACTIVE', 'PENDING', 'SENT', 'RECEIVED'}:
            return jsonify({"error": "Invalid status filter."}), 400

        items_summary = (
            db.session.query(
                StockSupplyRequestItem.request_id.label('request_id'),
                func.count(StockSupplyRequestItem.id).label('items_count'),
                func.coalesce(func.sum(StockSupplyRequestItem.requested_quantity), 0).label('total_requested_quantity'),
            )
            .group_by(StockSupplyRequestItem.request_id)
            .subquery()
        )

        query = (
            db.session.query(
                StockSupplyRequest.id,
                StockSupplyRequest.request_ref,
                StockSupplyRequest.branch_id,
                StockSupplyRequest.status,
                StockSupplyRequest.note,
                StockSupplyRequest.created_by_employee_id,
                Employee.full_name.label('created_by_employee_name'),
                StockSupplyRequest.shipment_id,
                StockShipment.shipment_ref.label('shipment_ref'),
                StockShipment.status.label('shipment_status'),
                StockSupplyRequest.created_at,
                StockSupplyRequest.sent_at,
                func.coalesce(items_summary.c.items_count, 0).label('items_count'),
                func.coalesce(items_summary.c.total_requested_quantity, 0).label('total_requested_quantity'),
            )
            .outerjoin(items_summary, items_summary.c.request_id == StockSupplyRequest.id)
            .outerjoin(Employee, Employee.id == StockSupplyRequest.created_by_employee_id)
            .outerjoin(StockShipment, StockShipment.id == StockSupplyRequest.shipment_id)
            .filter(StockSupplyRequest.branch_id == g.branch_id)
        )

        if status_filter == 'ACTIVE':
            query = query.filter(StockSupplyRequest.status.in_(['PENDING', 'SENT']))
        elif status_filter != 'ALL':
            query = query.filter(StockSupplyRequest.status == status_filter)

        total = query.order_by(None).count()
        total_pages = (total + per_page - 1) // per_page if total > 0 else 0
        if total_pages > 0 and page > total_pages:
            page = total_pages

        rows = (
            query
            .order_by(StockSupplyRequest.created_at.desc(), StockSupplyRequest.id.desc())
            .limit(per_page)
            .offset((page - 1) * per_page)
            .all()
        )

        items = [{
            "id": row.id,
            "request_ref": row.request_ref,
            "branch_id": row.branch_id,
            "status": row.status,
            "note": row.note,
            "created_by_employee_id": row.created_by_employee_id,
            "created_by_employee_name": row.created_by_employee_name,
            "shipment_id": row.shipment_id,
            "shipment_ref": row.shipment_ref,
            "shipment_status": row.shipment_status,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "sent_at": row.sent_at.isoformat() if row.sent_at else None,
            "items_count": int(row.items_count or 0),
            "total_requested_quantity": int(row.total_requested_quantity or 0),
        } for row in rows]

        return jsonify(_build_paginated_items_response(items, page, per_page, total)), 200
    except ValueError:
        return jsonify({"error": "Invalid pagination parameters."}), 400
    except Exception as e:
        print(f"Failed to list supply requests: {e}")
        return jsonify({"error": "Failed to list requests", "details": str(e)}), 500

@mini_bp.route('/supply-requests/<int:request_id>', methods=['GET'])
@require_cashier
def get_supply_request(request_id):
    from app.models.supply_operations import StockSupplyRequest
    try:
        if not g.branch_id:
            return jsonify({"error": "Branch context is missing"}), 400

        req_obj = StockSupplyRequest.query.filter_by(id=request_id, branch_id=g.branch_id).first()
        if not req_obj:
            return jsonify({"error": "الطلب غير موجود."}), 404

        return jsonify(_serialize_supply_request(req_obj)), 200
    except Exception as e:
        print(f"Failed to get supply request: {e}")
        return jsonify({"error": "Failed to get request details", "details": str(e)}), 500


@mini_bp.route('/returns', methods=['POST'])
@require_cashier
def create_return_request():
    from app.models.product import Product, ProductBranchStock
    from app.models.supply_operations import (
        RETURN_REQUEST_REASONS,
        StockReturnRequest,
    )

    try:
        if not g.branch_id:
            return jsonify({"error": "Branch context is missing"}), 400
        if not g.cashier_id:
            return jsonify({"error": "Cashier context is missing"}), 400

        branch = _get_request_branch()
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404
        if branch.is_main_warehouse:
            return jsonify({"error": "لا يمكن إنشاء مرتجع من المخزن الرئيسي داخل Mini."}), 403

        data = request.get_json() or {}

        try:
            product_id = int(data.get('product_id'))
            quantity = int(data.get('quantity'))
        except (TypeError, ValueError):
            return jsonify({"error": "بيانات المنتج أو الكمية غير صحيحة."}), 400

        reason = str(data.get('reason') or '').strip().upper()
        notes = _normalize_optional_text(data.get('notes') or data.get('note'))

        if quantity <= 0:
            return jsonify({"error": "الكمية يجب أن تكون أكبر من الصفر."}), 400
        if reason not in RETURN_REQUEST_REASONS:
            return jsonify({"error": "سبب المرتجع غير صحيح."}), 400

        product = Product.query.get(product_id)
        if not product or not product.is_active:
            return jsonify({"error": "المنتج غير موجود أو غير نشط."}), 404

        stock_row = ProductBranchStock.query.filter_by(
            product_id=product_id,
            branch_id=g.branch_id,
            is_available=True,
        ).first()
        current_stock = int(stock_row.stock_quantity or 0) if stock_row else 0
        if quantity > current_stock:
            return jsonify({"error": "الكمية الحالية غير كافية."}), 400

        req_obj = StockReturnRequest(
            return_ref=_generate_return_request_ref(),
            branch_id=g.branch_id,
            product_id=product_id,
            requested_quantity=quantity,
            branch_stock_snapshot=current_stock,
            reason=reason,
            notes=notes,
            status='PENDING',
            created_by_employee_id=g.cashier_id,
        )
        db.session.add(req_obj)
        db.session.flush()
        capture_return_cost(product_id=product_id, quantity=quantity, created_at=req_obj.created_at, return_request_id=req_obj.id)
        db.session.commit()

        return jsonify({
            "message": "تم إرسال طلب المرتجع",
            "request": _serialize_return_request(req_obj),
        }), 201
    except Exception as e:
        db.session.rollback()
        print(f"Failed to create return request: {e}")
        return jsonify({"error": "Failed to create return request", "details": str(e)}), 500


@mini_bp.route('/returns', methods=['GET'])
@require_cashier
def list_return_requests():
    from app.models.supply_operations import StockReturnRequest
    from sqlalchemy.orm import joinedload

    try:
        if not g.branch_id:
            return jsonify({"error": "Branch context is missing"}), 400

        page = max(1, int(request.args.get('page', 1)))
        per_page = min(100, max(1, int(request.args.get('per_page', 10))))
        status_filter = (request.args.get('status') or 'ALL').strip().upper()

        if status_filter not in {'ALL', 'PENDING', 'RETURNED_TO_MAIN', 'RETURNED_TO_SUPPLIER', 'REJECTED'}:
            return jsonify({"error": "Invalid status filter."}), 400

        query = (
            StockReturnRequest.query
            .options(
                joinedload(StockReturnRequest.product),
                joinedload(StockReturnRequest.created_by_employee),
                joinedload(StockReturnRequest.resolved_by_user),
            )
            .filter_by(branch_id=g.branch_id)
        )

        if status_filter != 'ALL':
            query = query.filter(StockReturnRequest.status == status_filter)

        total = query.order_by(None).count()
        total_pages = (total + per_page - 1) // per_page if total > 0 else 0
        if total_pages > 0 and page > total_pages:
            page = total_pages

        requests_list = (
            query
            .order_by(StockReturnRequest.created_at.desc(), StockReturnRequest.id.desc())
            .limit(per_page)
            .offset((page - 1) * per_page)
            .all()
        )
        items = [_serialize_return_request(req) for req in requests_list]
        return jsonify(_build_paginated_items_response(items, page, per_page, total)), 200
    except ValueError:
        return jsonify({"error": "Invalid pagination parameters."}), 400
    except Exception as e:
        print(f"Failed to list return requests: {e}")
        return jsonify({"error": "Failed to list return requests", "details": str(e)}), 500


@mini_bp.route('/returns/<int:request_id>', methods=['GET'])
@require_cashier
def get_return_request(request_id):
    from app.models.supply_operations import StockReturnRequest

    try:
        if not g.branch_id:
            return jsonify({"error": "Branch context is missing"}), 400

        req_obj = StockReturnRequest.query.filter_by(id=request_id, branch_id=g.branch_id).first()
        if not req_obj:
            return jsonify({"error": "طلب المرتجع غير موجود."}), 404

        return jsonify(_serialize_return_request(req_obj)), 200
    except Exception as e:
        print(f"Failed to get return request: {e}")
        return jsonify({"error": "Failed to get return request details", "details": str(e)}), 500

@mini_bp.route('/shipments/history', methods=['GET'])
@require_cashier
def get_shipment_history():
    from app.models.branch import Branch
    from app.models.supply_operations import StockShipment, StockShipmentItem
    from sqlalchemy.orm import joinedload
    from flask import request, jsonify, g

    try:
        if not g.branch_id:
            return jsonify({"error": "Branch context is missing"}), 400

        page, per_page = _parse_mini_bounded_pagination(default_per_page=10, max_per_page=50)
        status = request.args.get('status')

        query = (
            StockShipment.query
            .options(
                joinedload(StockShipment.source_branch),
                joinedload(StockShipment.destination_branch),
                joinedload(StockShipment.items).joinedload(StockShipmentItem.product)
            )
            .filter(StockShipment.destination_branch_id == g.branch_id)
        )

        if status:
            query = query.filter(StockShipment.status == status)

        pagination = query.order_by(StockShipment.created_at.desc(), StockShipment.id.desc()).paginate(
            page=page, per_page=per_page, error_out=False
        )

        serialized_shipments = []
        for shipment in pagination.items:
            items_list = [_serialize_shipment_item(item) for item in shipment.items]
            total_quantity = sum(int(item["quantity"] or 0) for item in items_list)
            
            serialized_shipments.append({
                "id": shipment.id,
                "shipment_ref": shipment.shipment_ref,
                "status": shipment.status,
                "created_at": shipment.created_at.isoformat() if shipment.created_at else None,
                "received_at": shipment.received_at.isoformat() if shipment.received_at else None,
                "source_branch_name": shipment.source_branch.name if shipment.source_branch else "المخزن الرئيسي",
                "destination_branch_name": shipment.destination_branch.name if shipment.destination_branch else f"فرع #{shipment.destination_branch_id}",
                "received_by_name": shipment.received_by_employee.full_name if shipment.received_by_employee else None,
                "items_count": len(items_list),
                "total_quantity": total_quantity,
                "note": shipment.note,
                "items_preview": items_list[:3]
            })

        return jsonify({
            "shipments": serialized_shipments,
            "pagination": {
                "page": pagination.page,
                "per_page": pagination.per_page,
                "total": pagination.total,
                "pages": pagination.pages,
                "has_next": pagination.has_next,
                "has_prev": pagination.has_prev
            }
        }), 200

    except Exception as e:
        return jsonify({"error": "Failed to fetch shipment history", "details": str(e)}), 500
