"""
Admin Authentication Utilities

This module provides JWT-based authentication for Admin users.
Admin authentication is COMPLETELY SEPARATE from Mini (cashier) authentication.

Rules:
- Admin tokens include token_type = "admin"
- Mini endpoints MUST NOT accept admin tokens
- Admin endpoints MUST NOT accept mini tokens (if mini switches to JWT)
"""

from functools import wraps
from flask import request, jsonify, g, current_app
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    get_jwt_identity,
    verify_jwt_in_request,
    get_jwt
)
from app.models.user import User, UserRole


# ============================================================================
# Admin Role Definitions
# ============================================================================

ADMIN_ROLES = {
    UserRole.SUPER_ADMIN,
    UserRole.EXEC_ADMIN,
    UserRole.BRANCH_MANAGER,
    UserRole.STORE_MANAGER,
}

NON_ADMIN_ROLES = {
    UserRole.CASHIER,
    UserRole.EMPLOYEE
}

GLOBAL_BRANCH_SCOPE_ROLES = {
    UserRole.SUPER_ADMIN,
    UserRole.EXEC_ADMIN,
    UserRole.STORE_MANAGER,
}

# STORE_MANAGER is default-deny outside this allowlist.
# The keys are Flask endpoint names (<blueprint>.<view_function>).
STORE_MANAGER_SUPPLY_ENDPOINTS = {
    "admin.get_branches",
    "admin.get_branch_inventory_activity",
    "admin.get_branch_inventory_drilldown",
    "admin.get_branch_product_details",
    "admin.get_admin_inventory_overview_summary",
    "admin.get_supply_overview",
    "admin.get_supply_branch_comparison",
    "admin.get_admin_products_catalog",
    "admin.search_admin_products",
    "admin.create_admin_product",
    "admin.update_admin_product",
    "admin.delete_admin_product",
    "admin.list_admin_products",
    "admin.get_product_stock_levels",
    "admin.get_product_workspace",
    "admin.get_product_activity",
    "admin.get_product_batches",
    "admin.adjust_product_stock",
    "admin.receive_supply_into_main_warehouse",
    "admin.list_admin_shipments",
    "admin.create_bulk_transfer",
    "admin.get_admin_shipment_details",
    "admin.list_recent_bulk_transfers",
    "admin.list_admin_supply_requests",
    "admin.get_admin_supply_request",
    "admin.send_supply_request_as_is",
    "admin.edit_and_send_supply_request",
    "admin.list_admin_return_requests",
    "admin.get_admin_return_request",
    "admin.resolve_return_request_to_main",
    "admin.resolve_return_request_to_supplier",
    "admin.reject_return_request",
    "admin.create_direct_supplier_return",
    "admin.list_supplier_return_records",
    "admin.get_supplier_return_record",
}


def is_store_manager_endpoint_allowed(endpoint_name):
    return endpoint_name in STORE_MANAGER_SUPPLY_ENDPOINTS


def _admin_auth_debug_enabled() -> bool:
    try:
        return bool(current_app.debug or current_app.config.get("AUTH_DEBUG"))
    except Exception:
        return False


def _log_admin_auth_decision(*, role=None, endpoint=None, allowed=None, reason=None):
    if not _admin_auth_debug_enabled():
        return

    print(
        "[ADMIN_AUTH]"
        f" role={role or 'UNKNOWN'}"
        f" endpoint={endpoint or request.endpoint or 'UNKNOWN'}"
        f" path={request.path}"
        f" method={request.method}"
        f" decision={'ALLOW' if allowed else 'DENY'}"
        f" reason={reason or 'n/a'}"
    )


# ============================================================================
# Token Generation
# ============================================================================

def create_admin_token(user: User) -> str:
    """
    Create a JWT ACCESS token for an admin user.
    Token includes: user_id (identity), role, branch_id, token_type="admin".
    """
    additional_claims = {
        "role": user.role.value,
        "branch_id": user.branch_id,
        "token_type": "admin"
    }
    return create_access_token(
        identity=str(user.id),
        additional_claims=additional_claims
    )


def create_admin_refresh_token(user: User) -> str:
    """
    Create a JWT REFRESH token for an admin user.
    Only used during login — the refresh endpoint issues a new access token, not a new refresh token.
    """
    additional_claims = {
        "role": user.role.value,
        "branch_id": user.branch_id,
        "token_type": "admin"
    }
    return create_refresh_token(
        identity=str(user.id),
        additional_claims=additional_claims
    )


def build_admin_access_token_from_refresh() -> tuple:
    """
    Validate the incoming refresh token and issue a fresh access token.
    Returns (new_access_token, None) on success, (None, error_response_tuple) on failure.
    Must be called inside a request context.
    """
    # Verify JWT token (Natively surfaces expired tokens via extensions.py handlers)
    verify_jwt_in_request(refresh=True)

    claims = get_jwt()

    # Ensure this is an admin-type refresh token
    if claims.get("token_type") != "admin":
        return None, (jsonify({"error": "Invalid token type for admin refresh"}), 403)

    user_id = get_jwt_identity()
    new_claims = {
        "role":       claims.get("role"),
        "branch_id":  claims.get("branch_id"),
        "token_type": "admin"
    }
    new_access_token = create_access_token(identity=user_id, additional_claims=new_claims)
    print(f"[AUTH] Admin token refreshed for user_id={user_id}")
    return new_access_token, None


# ============================================================================
# Authorization Decorators
# ============================================================================

def require_admin(f):
    """
    Decorator to require admin authentication.
    
    Validates:
    - JWT token is present and valid
    - token_type is "admin"
    - User role is one of ADMIN_ROLES
    - User is active
    
    Sets g.current_user with the authenticated user.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Verify JWT token (Natively surfaces expired tokens via extensions.py handlers)
        verify_jwt_in_request()
        
        # Get token claims
        claims = get_jwt()
        user_id_str = get_jwt_identity()
        
        # Verify token type is "admin"
        if claims.get("token_type") != "admin":
            _log_admin_auth_decision(
                role=claims.get("role"),
                endpoint=request.endpoint,
                allowed=False,
                reason=f"invalid_token_type:{claims.get('token_type')}",
            )
            return jsonify({
                "error": "Invalid token type. Admin access required.",
                "details": f"Expected admin, got {claims.get('token_type')}"
            }), 403
        
        # Get user from database (convert string identity to int)
        user_id = int(user_id_str)
        user = User.query.get(user_id)
        
        if not user:
            _log_admin_auth_decision(
                role=claims.get("role"),
                endpoint=request.endpoint,
                allowed=False,
                reason="user_not_found",
            )
            return jsonify({"error": "User not found"}), 401
        
        # Verify user is active
        if not user.is_active:
            _log_admin_auth_decision(
                role=user.role.value,
                endpoint=request.endpoint,
                allowed=False,
                reason="inactive_user",
            )
            return jsonify({"error": "User account is inactive"}), 403
        
        # Verify user has admin role
        if user.role not in ADMIN_ROLES:
            _log_admin_auth_decision(
                role=user.role.value,
                endpoint=request.endpoint,
                allowed=False,
                reason="non_admin_role",
            )
            return jsonify({"error": "Admin access required"}), 403
        
        # Set current user in request context
        g.current_user = user
        g.user_id = user.id
        g.user_role = user.role
        g.branch_id = user.branch_id
        g.admin_endpoint = request.endpoint

        if user.role == UserRole.STORE_MANAGER and not is_store_manager_endpoint_allowed(request.endpoint):
            _log_admin_auth_decision(
                role=user.role.value,
                endpoint=request.endpoint,
                allowed=False,
                reason="endpoint_not_in_store_manager_allowlist",
            )
            return jsonify({
                "error": "Insufficient permissions",
                "details": "STORE_MANAGER access is limited to Supply Center endpoints only.",
                "endpoint": request.endpoint
            }), 403

        _log_admin_auth_decision(
            role=user.role.value,
            endpoint=request.endpoint,
            allowed=True,
            reason="authorized",
        )

        return f(*args, **kwargs)
    
    return decorated_function


def require_role(*allowed_roles):
    """
    Decorator to require specific admin roles.
    
    Must be used AFTER @require_admin.
    
    Example:
        @require_admin
        @require_role(UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN)
        def some_endpoint():
            ...
    
    Args:
        *allowed_roles: Variable number of UserRole enum values
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Assumes @require_admin has already set g.current_user
            if not hasattr(g, 'current_user'):
                print("DEBUG AUTH: require_role failed because g.current_user is missing. Check decorator order.")
                return jsonify({"error": "Authentication required (missing context)"}), 401
            
            if g.current_user.role not in allowed_roles:
                return jsonify({
                    "error": "Insufficient permissions",
                    "required_roles": [role.value for role in allowed_roles]
                }), 403
            
            return f(*args, **kwargs)
        
        return decorated_function
    return decorator


def enforce_branch_isolation(branch_id: int) -> bool:
    """
    Enforce branch-level data isolation for admin roles.
    
    Rules:
    - SUPER_ADMIN / EXEC_ADMIN / STORE_MANAGER: Can access all branches
    - BRANCH_MANAGER: Can ONLY access their assigned branch
    
    Args:
        branch_id: The branch_id being accessed
        
    Returns:
        True if access is allowed, False otherwise
        
    Raises:
        ValueError if called without authentication context
    """
    if not hasattr(g, 'current_user'):
        raise ValueError("enforce_branch_isolation called without authentication context")
    
    user = g.current_user
    
    # Global-scope admin roles have access to all branches.
    if user.role in GLOBAL_BRANCH_SCOPE_ROLES:
        return True
    
    # BRANCH_MANAGER can only access their own branch
    if user.role == UserRole.BRANCH_MANAGER:
        return user.branch_id == branch_id
    
    # Other roles should not reach here (blocked by @require_admin)
    return False


def resolve_branch_scope(user: User, branch_id_param=None):
    """
    Resolve the allowed branch scope for a user.
    
    Args:
        user: The authenticated user
        branch_id_param: Optional branch_id from query params ('all', '1', etc.)
        
    Returns:
        List of allowed branch IDs (integers)
        
    Raises:
        ValueError (403): If user attempts to access unauthorized branch
    """
    # 1. BRANCH_MANAGER Context
    if user.role == UserRole.BRANCH_MANAGER:
        if not user.branch_id:
            # Should technically not happen if data is consistent
            return []
            
        # If they requested a specific branch, it MUST match theirs
        if branch_id_param and str(branch_id_param).lower() != 'all':
            try:
                requested_id = int(branch_id_param)
                if requested_id != user.branch_id:
                    from flask import abort
                    abort(403, description="Access denied. You can only access your assigned branch.")
            except ValueError:
                from flask import abort
                abort(400, description="Invalid branch ID format.")
                
        # If they requested 'all', they still only get theirs
        return [user.branch_id]

    # 2. Global-scope admin context (SUPER_ADMIN / EXEC_ADMIN / STORE_MANAGER)
    if user.role in GLOBAL_BRANCH_SCOPE_ROLES:
        # If no param or 'all', return None (meaning 'all' in query context)
        # OR return list of all IDs? 
        # Better: Return None to signal "No filtering needed" to the caller,
        # OR let the caller handle the query construction.
        # But this function contract says "List of allowed branch IDs".
        
        if not branch_id_param or str(branch_id_param).lower() == 'all':
            # Return special value or all current IDs?
            # Returning None usually implies "Query all" in SQLAlchemy logic if handled right.
            # But let's follow the requirement "List of allowed branch_ids".
            # Actually, returning valid IDs is safer.
            from app.models.branch import Branch
            return [b.id for b in Branch.query.all()]
            
        try:
            return [int(branch_id_param)]
        except ValueError:
            from flask import abort
            abort(400, description="Invalid branch ID format.")
            
    return []
