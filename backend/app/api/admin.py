from flask import Blueprint, request, jsonify, g, send_file, abort, current_app
from app.extensions import db
from app.services.stock_movement_service import capture_stock_movement, lock_product_stocks
from app.services.inventory_stock_status import location_stock_states, location_alert_counts
from app.services.return_valuation import capture_return_cost, request_valuations, supplier_movement_valuation
from app.utils.admin_auth import (
    create_admin_token, create_admin_refresh_token,
    build_admin_access_token_from_refresh,
    require_admin, require_role,
    resolve_branch_scope, enforce_branch_isolation,
    ADMIN_ROLES, NON_ADMIN_ROLES
)
from app.models.user import User, UserRole
from app.models.branch import Branch
from app.models.employee import Employee, EmployeeType
from app.models.customer import Customer
from app.services.booking_deposit_service import serialize_settlement
from app.models.customer_balance import CustomerBalance
from app.models.invoice import Invoice, InvoiceStatus, InvoiceItem, PaymentMethod
from app.models.service import ServiceCategory, CommissionType, Service, BranchService
from app.models.expense_category import ExpenseCategory
from sqlalchemy import func, case, or_
from datetime import datetime, date, timedelta
from math import ceil
from typing import Dict, Optional, Tuple
from app.utils.date_utils import get_cairo_date, get_utc_now, to_iso_string
from app.utils.exports.clients import (
    CLIENT_EXPORT_COLUMNS,
    build_client_export_query,
    build_customer_recent_activity_ordering,
    build_client_export_rows,
    build_clients_export_filename,
    build_customer_filter_conditions,
    build_customer_stats_subquery,
    normalize_client_export_columns,
    normalize_customer_search,
    parse_starred_only,
)
from app.utils.exports.excel import ExcelColumn, ExcelSheet, build_xlsx_file, build_xlsx_workbook_file
from app.utils.exports.filenames import build_export_filename
from app.utils.exports.invoices import (
    INVOICE_EXPORT_MAX_ROWS,
    build_invoice_export_rows,
    build_invoice_export_workbook_columns,
    build_invoices_export_filename,
    count_invoice_export_rows,
    normalize_invoice_export_columns,
    normalize_invoice_export_filters,
    normalize_invoice_export_mode,
    parse_invoice_export_date_range,
)
from app.utils.exports.treasury_business_days import (
    TREASURY_BUSINESS_DAY_EXPORT_COLUMNS,
    build_treasury_business_day_export_filename,
    build_treasury_business_day_export_rows,
)
from app.utils.treasury_business_days import (
    build_business_day_collection_snapshot,
    fetch_admin_business_day_rows,
    normalize_business_day_status,
)
from app.utils.admin_attendance_workspace import (
    build_attendance_workspace_payload,
    build_legacy_attendance_payload,
)
from app.services.mini_device_service import (
    MiniAccessMode,
    MiniDeviceSecurityError,
    MiniDeviceType,
    approve_device_enrollment,
    authorize_registered_device_repair,
    build_branch_device_security_snapshot,
    reject_device_enrollment,
    revoke_branch_registered_devices,
    revoke_registered_device,
)
from app.services.invoice_audit import (
    AuditActorContext,
    InvoiceAuditEventType,
    append_invoice_event,
)
from app.services.invoice_audit_timeline import build_invoice_audit_timeline
from app.services.admin_invoice_visibility import (
    default_visible_invoice_condition,
    invoice_activity_date_condition,
    invoice_activity_sort_expression,
    load_emptied_draft_evidence,
    visible_pending_invoice_condition,
)
from decimal import Decimal
import re
from sqlalchemy.orm import joinedload
from werkzeug.exceptions import HTTPException

admin_bp = Blueprint('admin', __name__, url_prefix='/api/admin')

from app.api.promo_errors import promo_api_errors
from app.services import promo_code_service


@admin_bp.route('/promo-codes', methods=['GET'])
@require_admin
@require_role(UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN, UserRole.BRANCH_MANAGER)
@promo_api_errors
def list_promo_codes():
    page, per_page = _parse_admin_bounded_pagination(default_per_page=20, max_per_page=100)
    branch_filter = request.args.get('branch_id')
    scope = resolve_branch_scope(g.current_user, branch_filter)
    # Global administrators can also see all-branch codes before branches exist.
    if g.current_user.role in (UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN) and (not branch_filter or branch_filter.lower() == 'all'):
        scope = None
    active = request.args.get('is_active')
    if active is not None and active not in ('true', 'false'):
        raise promo_code_service.PromoError('PROMO_INVALID_CONFIGURATION')
    return jsonify(promo_code_service.list_promos(
        scope, page, per_page, search=request.args.get('search'),
        is_active=None if active is None else active == 'true',
    ))


@admin_bp.route('/promo-codes', methods=['POST'])
@require_admin
@require_role(UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN, UserRole.BRANCH_MANAGER)
@promo_api_errors
def create_promo_code():
    return jsonify(promo_code_service.save_promo(request.get_json(silent=True), g.current_user)), 201


@admin_bp.route('/promo-codes/<int:promo_id>', methods=['PATCH'])
@require_admin
@require_role(UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN, UserRole.BRANCH_MANAGER)
@promo_api_errors
def update_promo_code(promo_id):
    return jsonify(promo_code_service.save_promo(request.get_json(silent=True), g.current_user, promo_id))


@admin_bp.route('/promo-codes/<int:promo_id>', methods=['DELETE'])
@require_admin
@require_role(UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN, UserRole.BRANCH_MANAGER)
@promo_api_errors
def archive_promo_code(promo_id):
    return jsonify(promo_code_service.archive_promo(promo_id, g.current_user))


def _serialize_branch_with_optional_device_security(branch: Branch, *, include_device_security: bool) -> dict:
    payload = branch.to_dict()
    if include_device_security:
        payload["device_security"] = build_branch_device_security_snapshot(branch)
    return payload

# Additional imports for new supply operations
from app.models.supply_operations import (
    TransferRequest,
    StockAdjustment,
    StockShipment,
    StockShipmentItem,
    StockReturnRequest,
)
from sqlalchemy import func

# ============================================================================
# SERVICE CATEGORIES ENDPOINTS (Global)
# ============================================================================

@admin_bp.route('/service-categories', methods=['GET'])
@require_admin
def list_service_categories():
    """List all global service categories. No branch filtering."""
    categories = ServiceCategory.query.filter_by(is_active=True).order_by(ServiceCategory.created_at.desc()).all()
    # Ensure nested format if needed, but here simple list
    return jsonify([{
        "id": cat.id,
        "name": cat.name,
        "commission_type": cat.commission_type.value if hasattr(cat.commission_type, 'value') else "BARBER_ONLY",
        "is_active": cat.is_active
    } for cat in categories]), 200

@admin_bp.route('/service-categories', methods=['POST'])
@require_admin
def create_service_category():
    """
    RECOVERY MODE: Simple category creation.
    No complex validation, direct insert only.
    """
    try:
        data = request.get_json() or {}
        print("ADMIN RECOVERY MODE ACTIVE")
        print("CREATE CATEGORY PAYLOAD:", data)
        
        # Read data
        name = data.get('name', '').strip()
        comm_type_str = data.get('commission_type', 'BARBER_ONLY')
        
        # Validation
        if not name:
            return jsonify({"error": "Category name is required"}), 400

        # Try to parse enum
        try:
            commission_type = CommissionType(comm_type_str)
        except ValueError:
            commission_type = CommissionType.BARBER_ONLY

        # Simple insert
        category = ServiceCategory(
            name=name,
            commission_type=commission_type,
            is_active=True
        )
        db.session.add(category)
        db.session.commit()
        
        print(f"CATEGORY CREATED: ID={category.id}, Name={category.name}, CommType={category.commission_type}")
        
        return jsonify({
            "category": {
                "id": category.id, 
                "name": category.name,
                "commission_type": category.commission_type.value
            }
        }), 201

    except Exception as e:
        print("CATEGORY ERROR:", str(e))
        db.session.rollback()
        return jsonify({
            "error": "Failed to create category",
            "details": str(e)
        }), 500

@admin_bp.route('/service-categories/<int:category_id>', methods=['PUT', 'PATCH'])
@require_admin
def update_service_category(category_id):
    """Update service category and optionally sync all its services' commissions."""
    try:
        category = ServiceCategory.query.get_or_404(category_id)
        data = request.get_json() or {}
        
        old_comm_type = category.commission_type
        
        if 'name' in data:
            category.name = data['name'].strip()
            
        if 'commission_type' in data:
            try:
                category.commission_type = CommissionType(data['commission_type'])
            except ValueError:
                return jsonify({"error": "Invalid commission type"}), 400

        # If commission type changed, re-derive all child services
        if category.commission_type != old_comm_type:
            print(f"🔄 Category {category.id} Commission Type changed! Re-deriving services...")
            for service in category.services:
                total_input = service.barber_commission_percent + service.assistant_commission_percent
                service.derive_commissions(total_input)
                print(f"  Synced Service: {service.name}")

        db.session.commit()
        return jsonify({
            "id": category.id,
            "name": category.name,
            "commission_type": category.commission_type.value
        }), 200
        
    except Exception as e:
        print(f"CATEGORY UPDATE ERROR: {e}")
        db.session.rollback()
        return jsonify({"error": "Failed to update category", "details": str(e)}), 500

@admin_bp.route('/service-categories/<int:category_id>', methods=['DELETE'])
@require_admin
def delete_service_category(category_id):
    """Soft delete service category. Block if it has active services."""
    try:
        category = ServiceCategory.query.get_or_404(category_id)
        
        # Check for active services
        active_services_count = Service.query.filter_by(category_id=category_id, is_active=True).count()
        if active_services_count > 0:
            return jsonify({"error": "لا يمكن حذف تصنيف يحتوي على خدمات"}), 400
            
        category.is_active = False
        db.session.commit()
        
        print(f"CATEGORY DELETED: ID={category_id}")
        return jsonify({"status": "success", "message": "Category deleted"}), 200
    except Exception as e:
        print("CATEGORY DELETE ERROR:", str(e))
        db.session.rollback()
        return jsonify({"error": "Failed to delete category", "details": str(e)}), 500

# ============================================================================
# SERVICES ENDPOINTS (Admin)
# ============================================================================

@admin_bp.route('/services', methods=['GET'])
@require_admin
def list_services():
    """
    HARD DEBUG MODE: Maximum logging, zero filtering.
    Pure SELECT from services table.
    """
    print("🔥 ADMIN /services CALLED")
    
    # Absolute simplest query possible - Filter by is_active=True
    query = db.session.query(Service).filter(Service.is_active == True).order_by(Service.id.desc())
    services = query.all()
    
    print(f"🔥 SERVICES COUNT: {len(services)}")
    print(f"🔥 SERVICES RAW: {[(s.id, s.name, s.price) for s in services[:3]]}")  # First 3 only
    
    # Explicit response construction
    response = []
    for s in services:
        item = {
            "id": s.id,
            "name": s.name,
            "price": s.price if s.price is not None else 0.0,
            "barber_commission_percent": s.barber_commission_percent,
            "assistant_commission_percent": s.assistant_commission_percent,
            "duration_minutes": s.duration_minutes if s.duration_minutes is not None else 0,
            "category_id": s.category_id if s.category_id is not None else 0,
            "is_active": s.is_active if s.is_active is not None else True
        }
        response.append(item)
    
    print(f"🔥 RESPONSE JSON COUNT: {len(response)}")
    if len(response) > 0:
        print(f"🔥 FIRST ITEM: {response[0]}")
    
    return jsonify(response), 200

@admin_bp.route('/services', methods=['POST'])
@require_admin
def create_service():
    """
    RECOVERY MODE: Simple service creation.
    No branch propagation, direct insert only.
    """
    try:
        data = request.get_json() or {}
        print("ADMIN RECOVERY MODE ACTIVE")
        print("CREATE SERVICE PAYLOAD:", data)

        # Read data
        name = data.get('name', '').strip()
        price = data.get('price')
        category_id = data.get('category_id')

        # Validation
        if not name:
            return jsonify({"error": "Service name is required"}), 400

        if price is None:
            return jsonify({"error": "Price is required"}), 400

        # Commission logic - Explicit retrieval to preserve 0
        raw_comm = data.get('barber_commission_percent')
        if raw_comm is None:
            raw_comm = data.get('commission_percent') # Fallback to prompt's naming if used
            
        comm_val = float(raw_comm) if raw_comm is not None else 0.0
        
        print(f"🔥 CREATE SERVICE DEBUG:")
        print(f"   Raw payload: {data}")
        print(f"   raw_comm from payload: {raw_comm}")
        print(f"   comm_val to derive: {comm_val}")

        # Simple insert
        service = Service(
            name=name,
            price=float(price),
            category_id=int(category_id) if category_id else None,
            is_active=True
        )
        
        # CRITICAL: Add to session and flush to load relationships
        db.session.add(service)
        db.session.flush()  # This loads the category relationship
        
        # NOW derive split based on category (category relationship is loaded)
        service.derive_commissions(comm_val)

        # AUTO-LINK: Create BranchService for every active branch
        # Replaces hardcoded branch_id=1 — branches are fetched dynamically at runtime
        active_branches = Branch.query.filter_by(is_active=True).all()
        linked_branch_ids = []
        for branch in active_branches:
            existing = BranchService.query.filter_by(
                branch_id=branch.id,
                service_id=service.id
            ).first()
            if existing:
                if not existing.is_active:
                    existing.is_active = True
                    linked_branch_ids.append(branch.id)
            else:
                db.session.add(BranchService(
                    branch_id=branch.id,
                    service_id=service.id,
                    is_active=True
                ))
                linked_branch_ids.append(branch.id)

        db.session.commit()

        print(f"SERVICE CREATED & LINKED: ID={service.id}, Name={service.name}, Branches={linked_branch_ids}")

        return jsonify({
            "id": service.id,
            "name": service.name,
            "price": service.price,
            "barber_commission_percent": service.barber_commission_percent,
            "category_id": service.category_id,
            "status": "success"
        }), 201

    except Exception as e:
        print("SERVICE ERROR:", str(e))
        db.session.rollback()
        return jsonify({
            "error": "Failed to create service",
            "details": str(e)
        }), 400

@admin_bp.route('/services/<int:service_id>', methods=['DELETE'])
@require_admin
def delete_service(service_id):
    """Soft delete service and its branch assignments."""
    try:
        service = Service.query.get_or_404(service_id)
        
        # Soft delete service
        service.is_active = False
        
        # Soft delete for all branches
        BranchService.query.filter_by(service_id=service_id).update({"is_active": False})
        
        db.session.commit()
        print(f"SERVICE DELETED: ID={service_id}")
        return jsonify({"status": "success", "message": "Service deleted"}), 200
    except Exception as e:
        print("SERVICE DELETE ERROR:", str(e))
        db.session.rollback()
        return jsonify({"error": "Failed to delete service", "details": str(e)}), 500

@admin_bp.route('/services/<int:service_id>', methods=['PUT', 'PATCH'])
@require_admin
def update_service(service_id):
    """
    CRITICAL FIX: Update service details including commission.
    """
    try:
        service = Service.query.get_or_404(service_id)
        data = request.get_json() or {}
        
        print(f"🔥 UPDATING SERVICE {service_id} PAYLOAD: {data}")

        if 'name' in data:
            service.name = data['name'].strip()
            
        if 'price' in data:
            service.price = float(data['price'])
            
        if 'category_id' in data:
            # Handle string 'uncategorized' or number
            cat_val = data['category_id']
            if str(cat_val).isdigit():
                service.category_id = int(cat_val)

        # Commission Logic - specific handling for 0 vs None
        if 'barber_commission_percent' in data:
             val = data['barber_commission_percent']
             service.derive_commissions(float(val) if val is not None else 0.0)
        elif 'commission' in data: 
             val = data['commission']
             service.derive_commissions(float(val) if val is not None else 0.0)
        elif 'category_id' in data:
             # If category changed but commission didn't, re-derive split from reconstructed total
             total_input = service.barber_commission_percent + service.assistant_commission_percent
             service.derive_commissions(total_input)
             
        if 'is_active' in data:
            service.is_active = bool(data['is_active'])
            
        db.session.commit()
        
        return jsonify({
            "id": service.id,
            "name": service.name,
            "price": service.price,
            "barber_commission_percent": service.barber_commission_percent,
            "category_id": service.category_id,
            "status": "success"
        }), 200
        
    except Exception as e:
        print(f"❌ UPDATE ERROR: {e}")
        db.session.rollback()
        return jsonify({"error": "Failed to update service", "details": str(e)}), 500

@admin_bp.route('/branch-services', methods=['POST'])
@require_admin
def assign_service_to_branch_legacy_alias():
    """
    Handles the 2nd request from ServiceModal.tsx (Assignment & Price).
    Payload: { branch_id, service_id, price }
    """
    try:
        data = request.get_json() or {}
        bid = data.get('branch_id')
        sid = data.get('service_id')
        price = data.get('price', 0.0)

        if not bid or not sid:
            return jsonify({"error": "branch_id and service_id are required"}), 400

        # Check if exists, update or create
        existing = BranchService.query.filter_by(branch_id=bid, service_id=sid).first()
        if existing:
            existing.is_active = True
        else:
            db.session.add(BranchService(
                branch_id=bid,
                service_id=sid,
                is_active=True
            ))
        
        db.session.commit()
        return jsonify({"status": "success", "message": "Service assigned to branch"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to assign service", "details": str(e)}), 400

@admin_bp.route('/assign-service', methods=['POST'])
@require_admin
def assign_service_to_branch_v2():
    """Another alias for same logic."""
    return assign_service_to_branch_legacy_alias()

# ============================================================================
# AUTHENTICATION ENDPOINTS
# ============================================================================

@admin_bp.route('/auth/login', methods=['POST'])
def admin_login():
    """
    Authenticate admin user and return JWT token.
    
    Request body:
    {
        "username": "bebo",  // or "email": "bebo@admin.local"
        "password": "1234"
    }
    
    Response:
    {
        "access_token": "...",
        "user": {
            "id": 1,
            "username": "bebo@admin.local",
            "full_name": "Bebo (Super Admin)",
            "role": "SUPER_ADMIN",
            "branch_id": null
        }
    }
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "No input data provided"}), 400
        
        # Get credentials (support both 'username' and 'email' fields)
        username = data.get('username') or data.get('email')
        password = data.get('password')
        
        # Validation
        if not username or not password:
            return jsonify({"error": "Username and password are required"}), 400
        
        # Find user by email (username is stored as email)
        user = User.query.filter_by(email=username).first()
        
        if not user:
            return jsonify({"error": "Invalid credentials"}), 401
        
        # Check password
        if not user.check_password(password):
            return jsonify({"error": "Invalid credentials"}), 401
        
        # Check if user is active
        if not user.is_active:
            return jsonify({"error": "User account is inactive"}), 403
        
        # Check if user has admin role
        if user.role in NON_ADMIN_ROLES:
            return jsonify({
                "error": "Access denied. Admin privileges required.",
                "hint": "This account is not authorized to access the Admin system."
            }), 403
        
        # Verify user has an admin role
        if user.role not in ADMIN_ROLES:
            return jsonify({
                "error": "Access denied. Admin privileges required."
            }), 403
        
        # Generate JWT access + refresh tokens
        access_token  = create_admin_token(user)
        refresh_token = create_admin_refresh_token(user)

        print(f"[AUTH] Admin login OK: user_id={user.id}, role={user.role.value}")

        # Return tokens and user info
        return jsonify({
            "access_token":  access_token,
            "refresh_token": refresh_token,
            "user": {
                "id":        user.id,
                "username":  user.email,
                "full_name": user.full_name,
                "role":      user.role.value,
                "branch_id": user.branch_id
            }
        }), 200

    except Exception as e:
        print(f"Admin login error: {e}")
        return jsonify({"error": "Internal server error", "details": str(e)}), 500


@admin_bp.route('/auth/refresh', methods=['POST'])
def admin_refresh_token():
    """
    Exchange a valid admin refresh token for a new access token.
    Refresh token must be sent as: Authorization: Bearer <refresh_token>
    Returns a new access_token only — does NOT issue a new refresh token.
    """
    new_token, err = build_admin_access_token_from_refresh()
    if err:
        return err
    return jsonify({"access_token": new_token}), 200


# ============================================================================
# USER MANAGEMENT ENDPOINTS
# ============================================================================

@admin_bp.route('/users', methods=['POST'])
@require_admin
@require_role(UserRole.SUPER_ADMIN)
def create_user():
    """
    Create a new user account.
    
    Access: SUPER_ADMIN only.
    
    Payload:
    {
        "username": "...",
        "password": "...",
        "full_name": "...",  // optional, falls back to username
        "role": "CASHIER" | "SUPER_ADMIN" | "STORE_MANAGER",
        "branch_id": int | null,
        "is_active": true
    }
    """
    from sqlalchemy.exc import IntegrityError
    
    try:
        data = request.get_json() or {}
        
        # 1. Basic Extraction & Validation
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        full_name = (data.get('full_name') or data.get('display_name') or username).strip()
        role_str = data.get('role', '').strip()
        branch_id = data.get('branch_id')
        is_active = bool(data.get('is_active', True))
        
        if not username or not password or not role_str:
            return jsonify({"error": "Username, password, and role are required"}), 400
            
        # 2. Validate Role
        try:
            role = UserRole(role_str)
        except ValueError:
            return jsonify({"error": f"Invalid role. Allowed: {[r.value for r in UserRole]}"}), 400
            
        # 3. Role-Specific Logic
        final_branch_id = None
        
        if role == UserRole.CASHIER:
            # Cashier MUST have a branch
            if not branch_id:
                return jsonify({"error": "Branch is required for Cashier role"}), 400
            final_branch_id = int(branch_id)
            
            branch = Branch.query.get(final_branch_id)
            if not branch:
                return jsonify({"error": "Invalid branch ID"}), 400
            if branch.is_main_warehouse:
                return jsonify({"error": "لا يمكن ربط حساب كاشير بالمخزن الرئيسي."}), 400
                
        elif role in [UserRole.SUPER_ADMIN, UserRole.STORE_MANAGER]:
            # SUPER_ADMIN and STORE_MANAGER are global accounts with no branch binding.
            final_branch_id = None
            
        else:
            # Preserve the current narrow management scope for account creation.
            if role not in [UserRole.CASHIER, UserRole.SUPER_ADMIN, UserRole.STORE_MANAGER]:
                 return jsonify({"error": "Only CASHIER, SUPER_ADMIN, and STORE_MANAGER creation is currently supported"}), 400
            
            if branch_id:
                final_branch_id = int(branch_id)

        # 4. Check Username Uniqueness
        if User.query.filter_by(email=username).first():
            return jsonify({"error": "Username already exists"}), 409
            
        # 5. Create User
        new_user = User(
            full_name=full_name or username,
            email=username,     # Username is stored in email field
            role=role,
            branch_id=final_branch_id,
            is_active=is_active
        )
        new_user.set_password(password)
        
        db.session.add(new_user)
        db.session.flush() # Flush to get the ID (though not strictly needed for name-based link, good practice)

        # 6. Auto-create Employee for CASHIER (Critical Fix)
        if role == UserRole.CASHIER:
            from app.models.employee import Employee, EmployeeType
            
            # Note: We rely on full_name matching as per current mini.py login logic.
            # Employee model does not currently have user_id, so we skip that assignment.
            new_employee = Employee(
                full_name=new_user.full_name,
                branch_id=new_user.branch_id,
                employee_type=EmployeeType.CASHIER,
                is_active=True,
                # user_id=new_user.id # Skipped: Column does not exist in Employee model
            )
            db.session.add(new_employee)

        db.session.commit()
        
        return jsonify({
            "message": "User created successfully",
            "user": {
                "id": new_user.id,
                "username": new_user.email,
                "full_name": new_user.full_name,
                "role": new_user.role.value,
                "branch_id": new_user.branch_id,
                "is_active": new_user.is_active,
            }
        }), 201
        
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Database integrity error (possible duplicate)"}), 409
    except Exception as e:
        db.session.rollback()
        print(f"User creation error: {e}")
        return jsonify({"error": "Failed to create user", "details": str(e)}), 500

@admin_bp.route('/users', methods=['GET'])
@require_admin
@require_role(UserRole.SUPER_ADMIN)
def get_users():
    """
    Get all active users.
    Access: SUPER_ADMIN only.
    """
    try:
        users = User.query.filter_by(is_active=True).order_by(User.id.desc()).all()
        def serialize_user_branch(user):
            if user.role == UserRole.STORE_MANAGER:
                return "كل الفروع / مركز الإمداد"
            if user.role == UserRole.SUPER_ADMIN:
                return "صلاحية كاملة"
            if user.role == UserRole.EXEC_ADMIN:
                return "إدارة تنفيذية عامة"
            return user.branch.name if user.branch else None

        return jsonify([{
            "id":         u.id,
            "username":   u.email,
            "full_name":  u.full_name,
            "role":       u.role.value,
            "branch":     serialize_user_branch(u),
            "branch_id":  u.branch_id,
            "is_active":  u.is_active,
            "created_at": u.created_at.isoformat()
        } for u in users]), 200
    except Exception as e:
        return jsonify({"error": "Failed to fetch users", "details": str(e)}), 500


@admin_bp.route('/users/<int:user_id>', methods=['PUT'])
@require_admin
@require_role(UserRole.SUPER_ADMIN)
def update_user(user_id):
    """
    Edit an existing user.
    Access: SUPER_ADMIN only.
    Rules:
      - Cannot edit yourself.
      - Role cannot be changed.
      - Email must remain unique.
      - Password only updated when explicitly provided.
      - branch_id only applies to CASHIER role.
    """
    from datetime import datetime, timezone
    from sqlalchemy.exc import IntegrityError

    try:
        target = User.query.get(user_id)
        if not target:
            return jsonify({"error": "User not found"}), 404

        # Block self-edit
        if target.id == g.current_user.id:
            return jsonify({"error": "Cannot edit your own account"}), 400

        data = request.get_json() or {}

        # full_name
        if 'full_name' in data or 'display_name' in data:
            raw_name = data.get('full_name', data.get('display_name', ''))
            name = raw_name.strip()
            if not name:
                return jsonify({"error": "full_name cannot be empty"}), 400
            target.full_name = name

        # email (username)
        if 'email' in data:
            new_email = data['email'].strip()
            if not new_email:
                return jsonify({"error": "email cannot be empty"}), 400
            # Uniqueness check — exclude the current user
            conflict = User.query.filter(
                User.email == new_email,
                User.id != user_id
            ).first()
            if conflict:
                return jsonify({"error": "Email already in use by another account"}), 409
            target.email = new_email

        # password (optional — only hash when provided)
        if 'password' in data:
            new_pass = data['password'].strip()
            if not new_pass:
                return jsonify({"error": "password cannot be empty if provided"}), 400
            target.set_password(new_pass)

        # branch_id — only for CASHIER; ignored for all other roles
        if 'branch_id' in data:
            if target.role == UserRole.CASHIER:
                bid = data['branch_id']
                if bid is None:
                    return jsonify({"error": "Cashier must have a branch"}), 400
                branch = Branch.query.get(int(bid))
                if not branch:
                    return jsonify({"error": "Invalid branch_id"}), 400
                if branch.is_main_warehouse:
                    return jsonify({"error": "لا يمكن ربط حساب كاشير بالمخزن الرئيسي."}), 400
                target.branch_id = branch.id
            # For non-cashier roles, silently ignore branch_id changes

        # role changes are deliberately ignored

        target.updated_at = datetime.now(timezone.utc)
        db.session.commit()

        return jsonify({
            "id":        target.id,
            "username":  target.email,
            "full_name": target.full_name,
            "role":      target.role.value,
            "branch_id": target.branch_id,
            "is_active": target.is_active
        }), 200

    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Email already in use by another account"}), 409
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to update user", "details": str(e)}), 500


@admin_bp.route('/users/<int:user_id>', methods=['DELETE'])
@require_admin
@require_role(UserRole.SUPER_ADMIN)
def delete_user(user_id):
    """
    Soft-delete a user by setting is_active=False.
    Access: SUPER_ADMIN only.
    Rules:
      - Cannot delete yourself.
      - Cannot delete the last active SUPER_ADMIN.
      - No physical row removal.
      - Mini login fails automatically because require_cashier checks is_active indirectly
        and require_admin checks user.is_active before granting access.
    """
    from datetime import datetime, timezone

    try:
        target = User.query.get(user_id)
        if not target:
            return jsonify({"error": "User not found"}), 404

        # Block self-delete
        if target.id == g.current_user.id:
            return jsonify({"error": "Cannot deactivate your own account"}), 400

        # Guard: cannot remove the last active SUPER_ADMIN
        if target.role == UserRole.SUPER_ADMIN:
            active_super_admins = User.query.filter_by(
                role=UserRole.SUPER_ADMIN,
                is_active=True
            ).count()
            if active_super_admins <= 1:
                return jsonify({
                    "error": "Cannot deactivate the last active SUPER_ADMIN"
                }), 400

        target.is_active = False
        target.updated_at = datetime.now(timezone.utc)
        db.session.commit()

        return jsonify({"message": "User deactivated successfully"}), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to deactivate user", "details": str(e)}), 500


# ============================================================================
# EXPENSE CATEGORY ENDPOINTS (Admin)
# ============================================================================

@admin_bp.route('/expense-categories', methods=['GET'])
@require_admin
def get_all_expense_categories():
    """Get all expense categories (for Admin UI)"""
    from app.models.expense_category import ExpenseCategory
    
    try:
        categories = ExpenseCategory.query.filter_by(is_active=True).order_by(ExpenseCategory.name).all()
        return jsonify([cat.to_dict() for cat in categories]), 200
    except Exception as e:
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@admin_bp.route('/expense-categories', methods=['POST'])
@require_admin
def create_expense_category():
    """Create a new global expense category, linked to the admin's own branch."""
    from app.models.expense_category import ExpenseCategory
    from sqlalchemy.exc import IntegrityError
    import re

    try:
        data = request.get_json()
        name = data.get('name', '').strip()

        if not name:
            return jsonify({"error": "name is required"}), 400

        # ── Auto-generate a stable, unique code from the name ──────────────────
        # e.g. "صيانة شهرية" → "CAT" (non-latin fallback), "Maintenance Fee" → "MAINTENANCE_FEE"
        raw_code = re.sub(r'[^A-Z0-9_]', '', name.upper().replace(' ', '_'))[:50]
        if not raw_code:
            # Arabic / non-latin names produce empty string after stripping — use a generic prefix
            raw_code = 'CAT'
        # Ensure uniqueness by appending a counter if the code already exists
        final_code = raw_code
        counter = 1
        while ExpenseCategory.query.filter_by(code=final_code).first():
            final_code = f"{raw_code}_{counter}"
            counter += 1

        print(f"🔧 Creating ExpenseCategory: name='{name}', code='{final_code}'")

        # Create category with auto-generated code
        category = ExpenseCategory(name=name, code=final_code)
        db.session.add(category)
        db.session.flush()  # Flush to get ID before creating the branch link

        # ── Link to the admin's own branch only (branch isolation preserved) ───
        # SUPER_ADMIN / EXEC_ADMIN have g.branch_id = None — skip auto-link in that case.
        # BRANCH_MANAGER always has a branch_id set.
        from app.models.branch_expense_category import BranchExpenseCategory

        admin_branch_id = g.branch_id  # Set by require_admin from user.branch_id
        if admin_branch_id:
            # Idempotent: skip if link already exists
            existing_link = BranchExpenseCategory.query.filter_by(
                branch_id=admin_branch_id,
                expense_category_id=category.id
            ).first()
            if not existing_link:
                link = BranchExpenseCategory(
                    branch_id=admin_branch_id,
                    expense_category_id=category.id,
                    is_active=True
                )
                db.session.add(link)
                print(f"✅ Linked category '{name}' to branch_id={admin_branch_id}")
            else:
                print(f"ℹ️  Link already exists for category '{name}' → branch_id={admin_branch_id}")
        else:
            print(f"ℹ️  Admin has no branch_id (SUPER_ADMIN/EXEC_ADMIN) — no auto-link created for this category")

        db.session.commit()
        print(f"✅ ExpenseCategory created: id={category.id}, name='{name}', code='{final_code}'")

        return jsonify(category.to_dict()), 201

    except IntegrityError:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Expense category with this name already exists"}), 400
    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500




@admin_bp.route('/expense-categories/<int:category_id>', methods=['DELETE'])
@require_admin
def delete_expense_category(category_id):
    """Soft delete an expense category"""
    from app.models.expense_category import ExpenseCategory
    
    try:
        category = ExpenseCategory.query.get(category_id)
        if not category:
            return jsonify({"error": "Expense category not found"}), 404
        
        category.is_active = False
        db.session.commit()
        
        return jsonify({"message": "Category deleted successfully"}), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500

@admin_bp.route('/branches/<int:branch_id>/expense-categories', methods=['GET'])
@require_admin
def get_branch_expense_categories(branch_id):
    """Get expense categories assigned to a specific branch"""
    from app.models.branch_expense_category import BranchExpenseCategory
    from app.models.branch import Branch
    
    try:
        # Verify branch exists
        branch = Branch.query.get(branch_id)
        if not branch:
            return jsonify({"error": "Branch not found"}), 404
        
        # Get assigned categories
        assignments = BranchExpenseCategory.query.filter_by(
            branch_id=branch_id
        ).all()
        
        return jsonify([assignment.to_dict() for assignment in assignments]), 200
        
    except Exception as e:
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@admin_bp.route('/branches/<int:branch_id>/expense-categories', methods=['POST'])
@require_admin
def assign_category_to_branch(branch_id):
    """Assign an expense category to a branch"""
    from app.models.branch_expense_category import BranchExpenseCategory
    from app.models.expense_category import ExpenseCategory
    from app.models.branch import Branch
    from sqlalchemy.exc import IntegrityError
    
    try:
        data = request.get_json()
        expense_category_id = data.get('expense_category_id')
        
        if not expense_category_id:
            return jsonify({"error": "expense_category_id is required"}), 400
        
        # Verify branch exists
        branch = Branch.query.get(branch_id)
        if not branch:
            return jsonify({"error": "Branch not found"}), 404
        
        # Verify category exists and is active
        category = ExpenseCategory.query.filter_by(
            id=expense_category_id,
            is_active=True
        ).first()
        
        if not category:
            return jsonify({"error": "Expense category not found or inactive"}), 404
        
        # Create assignment
        assignment = BranchExpenseCategory(
            branch_id=branch_id,
            expense_category_id=expense_category_id
        )
        
        db.session.add(assignment)
        db.session.commit()
        
        return jsonify(assignment.to_dict()), 201
        
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "This category is already assigned to this branch"}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


# ============================================================================
# BRANCH MANAGEMENT ENDPOINTS
# ============================================================================

@admin_bp.route('/branches', methods=['GET'])
@require_admin
def get_branches():
    """
    Get branches based on user role.
    
    Roles:
    - SUPER_ADMIN / EXEC_ADMIN: Returns all branches (or filtered by query param if implemented later)
    - BRANCH_MANAGER: Returns ONLY assigned branch
    """
    from flask import g
    
    try:
        exclude_main_warehouse = request.args.get('exclude_main_warehouse', 'false').lower() == 'true'
        include_device_security = request.args.get('include_device_security', 'false').lower() == 'true'

        # Use resolve_branch_scope to get allowed IDs
        allowed_ids = resolve_branch_scope(g.current_user, 'all')
        
        if not allowed_ids:
                # Should practically not happen for valid users, but handles empty lists
            return jsonify([]), 200

        # Query branches
        query = Branch.query.filter(Branch.id.in_(allowed_ids))
        if exclude_main_warehouse:
            query = query.filter(Branch.is_main_warehouse == False)
        branches = query.order_by(Branch.id).all()
        
        return jsonify([
            _serialize_branch_with_optional_device_security(
                branch,
                include_device_security=include_device_security,
            )
            for branch in branches
        ]), 200
        
    except Exception as e:
        return jsonify({"error": "Failed to fetch branches", "details": str(e)}), 500


@admin_bp.route('/branches', methods=['POST'])
@require_admin
@require_role(UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN)
def create_branch():
    """
    Create a new branch.
    
    Access: SUPER_ADMIN, EXEC_ADMIN only.
    """
    from sqlalchemy.exc import IntegrityError
    
    try:
        data = request.get_json()
        name = data.get('name', '').strip()
        city = data.get('city', '').strip()
        
        if not name or not city:
            return jsonify({"error": "Name and city are required"}), 400
            
        branch = Branch(name=name, city=city)
        db.session.add(branch)
        db.session.commit()
        
        return jsonify(branch.to_dict()), 201
        
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Branch with this name already exists"}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to create branch", "details": str(e)}), 500


@admin_bp.route('/branches/<int:branch_id>', methods=['PUT'])
@require_admin
@require_role(UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN)
def update_branch(branch_id):
    """
    Update an existing branch.
    
    Access: SUPER_ADMIN, EXEC_ADMIN only.
    Allowed updates: name, city, is_active.
    """
    from sqlalchemy.exc import IntegrityError
    
    try:
        branch = Branch.query.get_or_404(branch_id)
        data = request.get_json()
        
        if 'name' in data:
            name = data['name'].strip()
            if not name:
                return jsonify({"error": "Name cannot be empty"}), 400
            branch.name = name
            
        if 'city' in data:
            city = data['city'].strip()
            if not city:
                return jsonify({"error": "City cannot be empty"}), 400
            branch.city = city
            
        if 'is_active' in data:
            branch.is_active = bool(data['is_active'])
            
        db.session.commit()
        return jsonify(branch.to_dict()), 200
        
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Branch with this name already exists"}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to update branch", "details": str(e)}), 500


# ============================================================================
# EMPLOYEE MANAGEMENT ENDPOINTS
# ============================================================================

@admin_bp.route('/employees', methods=['GET'])
@require_admin
def get_employees():
    """
    Get employees with optional filters.
    
    Query Params:
    - branch_id: Filter by branch (subject to scope resolution)
    - role: Filter by EmployeeType (BARBER, ASSISTANT, etc.)
    - is_active: Filter by active status (true/false)
    """
    from flask import g
    
    try:
        # 1. Resolve Branch Scope
        requested_branch = request.args.get('branch_id')
        allowed_branch_ids = resolve_branch_scope(g.current_user, requested_branch)
        
        if not allowed_branch_ids:
             return jsonify([]), 200

        # 2. Build Query
        query = Employee.query.filter(Employee.branch_id.in_(allowed_branch_ids))
        
        # Filter by role
        role_param = request.args.get('role')
        if role_param:
            try:
                role_enum = EmployeeType(role_param.upper())
                query = query.filter(Employee.employee_type == role_enum)
            except ValueError:
                pass # Ignore invalid role filter match nothing or all? ignoring for now
                
        # Filter by active status
        is_active_param = request.args.get('is_active')
        if is_active_param is not None:
             is_active = is_active_param.lower() == 'true'
             query = query.filter(Employee.is_active == is_active)

        # Filter by deleted status (Default: Exclude deleted)
        include_deleted = request.args.get('include_deleted', 'false').lower() == 'true'
        if not include_deleted:
            query = query.filter(Employee.is_deleted == False)

        # Execute
        # Sort by created_at DESC (newest first), with id DESC as fallback
        employees = query.order_by(Employee.created_at.desc(), Employee.id.desc()).all()
        
        return jsonify([emp.to_dict() for emp in employees]), 200
        
    except Exception as e:
        return jsonify({"error": "Failed to fetch employees", "details": str(e)}), 500


@admin_bp.route('/employees', methods=['POST'])
@require_admin
def create_employee():
    """
    Create a new employee.
    
    Body (JSON or FormData):
    - full_name (required)
    - branch_id (required)
    - role (required, Enum)
    - base_salary (optional, default 0)
    - phone (optional)
    - image (optional, File)
    """
    from flask import g
    from werkzeug.exceptions import HTTPException
    
    try:
        # data = request.get_json() # OLD
        
        # Handle both JSON and FormData
        if request.content_type and 'multipart/form-data' in request.content_type:
            data = request.form
            file = request.files.get('image')
        else:
            data = request.get_json() or {}
            file = None
        
        # Validate Required Fields
        full_name = data.get('full_name', '').strip()
        role_str = data.get('role', '').strip()
        branch_id = data.get('branch_id')
        
        if not full_name or not role_str or not branch_id:
            return jsonify({"error": "full_name, role, and branch_id are required"}), 400
            
        # Validate Role Enum
        try:
            employee_type = EmployeeType(role_str.upper())
        except ValueError:
            valid_roles = [e.value for e in EmployeeType]
            return jsonify({"error": f"Invalid role. Allowed: {valid_roles}"}), 400

        # Validate Branch Scope (Security Check)
        # Calling resolve_branch_scope with the target branch_id will raise 403 if not allowed
        resolve_branch_scope(g.current_user, branch_id)
        
        # Parse base_salary safely (FormData sends strings)
        base_salary_raw = data.get('base_salary', '0')
        try:
            base_salary = float(base_salary_raw) if base_salary_raw else 0.0
        except (ValueError, TypeError):
            base_salary = 0.0
        
        # Parse is_active safely (FormData sends 'true'/'false' strings)
        is_active_raw = data.get('is_active', 'true')
        if isinstance(is_active_raw, str):
            is_active = is_active_raw.lower() in ('true', '1', 'yes')
        else:
            is_active = bool(is_active_raw)
        
        # Parse branch_id safely (FormData sends strings)
        try:
            branch_id = int(branch_id)
        except (ValueError, TypeError):
            return jsonify({"error": "branch_id must be a valid integer"}), 400
        
        branch = Branch.query.get(branch_id)
        if not branch:
            return jsonify({"error": "branch_id must reference an existing branch"}), 400
        if employee_type == EmployeeType.CASHIER and branch.is_main_warehouse:
            return jsonify({"error": "لا يمكن تعيين موظف كاشير على المخزن الرئيسي."}), 400

        # Create Employee
        employee = Employee(
            full_name=full_name,
            employee_type=employee_type,
            branch_id=branch_id,
            phone=data.get('phone'),
            base_salary=base_salary,
            is_active=is_active
        )
        
        db.session.add(employee)
        db.session.commit() # Commit first to get ID
        
        # Handle Image Upload
        if file:
            try:
                from app.utils.upload_utils import save_employee_image
                image_path = save_employee_image(file, employee.id)
                employee.image_url = image_path
                db.session.commit()
            except Exception as e:
                print(f"Image upload failed for employee {employee.id}: {e}")
                # We continue without failing the employee creation
        
        # Handle Documents Upload
        try:
            from app.models.employee_document import EmployeeDocument
            from app.utils.upload_utils import save_employee_document
            
            # Iterate over files to find documents
            # Frontend should send: document_0_file (File) and document_0_type (Text)
            for key, file_storage in request.files.items():
                if key.startswith('document_') and key.endswith('_file'):
                    try:
                        # Extract index from key: document_{index}_file
                        parts = key.split('_')
                        if len(parts) >= 3:
                            index = parts[1]
                            type_key = f"document_{index}_type"
                            doc_type = request.form.get(type_key, "مستند إداري")
                            
                            if file_storage and file_storage.filename:
                                doc_path = save_employee_document(file_storage, employee.id, doc_type)
                                
                                new_doc = EmployeeDocument(
                                    employee_id=employee.id,
                                    document_type=doc_type,
                                    file_path=doc_path,
                                    original_name=file_storage.filename
                                )
                                db.session.add(new_doc)
                    except Exception as doc_error:
                         print(f"Failed to process document {key}: {doc_error}")

            db.session.commit()
        except Exception as e:
             print(f"Document upload process failed: {e}")
             # Non-critical, continue
        



        return jsonify(employee.to_dict()), 201

        
    except ValueError as ve:
         # Often from resolve_branch_scope 400s or float conversion
         return jsonify({"error": str(ve)}), 400
    except HTTPException:
        raise
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to create employee", "details": str(e)}), 500


@admin_bp.route('/employees/<int:employee_id>', methods=['PUT'])
@require_admin
def update_employee(employee_id):
    """
    Update employee details.
    
    Allowed scope:
    - Admin can only update employees in branches they have access to.
    """
    from flask import g
    from werkzeug.exceptions import HTTPException
    
    try:
        employee = Employee.query.get_or_404(employee_id)
        
        # Verify Branch Scope
        resolve_branch_scope(g.current_user, employee.branch_id)
        
        # data = request.get_json() # OLD
        
        # Handle both JSON and FormData
        if request.content_type and 'multipart/form-data' in request.content_type:
            data = request.form
            file = request.files.get('image')
        else:
            data = request.get_json() or {}
            file = None
        
        # Update Fields if Present
        if 'full_name' in data:
            employee.full_name = data['full_name'].strip()
            
        if 'phone' in data:
            employee.phone = data['phone']
            
        if 'base_salary' in data:
            employee.base_salary = float(data['base_salary'])
            
        if 'role' in data:
            try:
                employee.employee_type = EmployeeType(data['role'].upper())
            except ValueError:
                 return jsonify({"error": "Invalid role"}), 400
                 
        if 'is_active' in data:
            # Handle string vs bool
            val = data['is_active']
            if isinstance(val, str):
                val = val.lower() == 'true'
            employee.is_active = bool(val)
            # Sync status if needed
            if not employee.is_active:
                from app.models.employee import EmployeeStatus
                employee.status = EmployeeStatus.SUSPENDED
            else:
                from app.models.employee import EmployeeStatus
                employee.status = EmployeeStatus.ACTIVE

        if 'status' in data:
            from app.models.employee import EmployeeStatus
            try:
                new_status = EmployeeStatus(data['status'].upper())
                employee.status = new_status
                # Sync is_active
                if new_status == EmployeeStatus.SUSPENDED:
                    employee.is_active = False
                elif new_status == EmployeeStatus.ACTIVE:
                    employee.is_active = True
            except ValueError:
                return jsonify({"error": "Invalid status"}), 400

        if 'is_deleted' in data:
            val = data['is_deleted']
            if isinstance(val, str):
                val = val.lower() == 'true'
            employee.is_deleted = bool(val)
            # If an employee is marked as deleted, they should also be inactive
            if employee.is_deleted:
                employee.is_active = False
                from app.models.employee import EmployeeStatus
                employee.status = EmployeeStatus.SUSPENDED # Or a specific DELETED status if available
        
        if 'branch_id' in data:
            new_branch_id = int(data['branch_id'])
            # Verify new branch scope if changing branches
            if new_branch_id != employee.branch_id:
                resolve_branch_scope(g.current_user, new_branch_id)
                
                # Check consistency if user is moving themselves (edge case)
                # ... skipping specific edge case logic for brevity unless critical
                
                employee.branch_id = new_branch_id

        # Handle Image Upload (Update)
        if file:
            try:
                from app.utils.upload_utils import save_employee_image
                image_path = save_employee_image(file, employee.id)
                employee.image_url = image_path
            except Exception as e:
                print(f"Image update failed for employee {employee.id}: {e}")
                # Don't fail the whole update
        
        db.session.commit()
        
        # Handle Documents Upload (Update)
        try:
            from app.models.employee_document import EmployeeDocument
            from app.utils.upload_utils import save_employee_document
            
            # Iterate over files to find documents
            # Frontend should send: document_0_file (File) and document_0_type (Text)
            for key, file_storage in request.files.items():
                if key.startswith('document_') and key.endswith('_file'):
                    try:
                        # Extract index from key: document_{index}_file
                        parts = key.split('_')
                        if len(parts) >= 3:
                            index = parts[1]
                            type_key = f"document_{index}_type"
                            doc_type = request.form.get(type_key, "مستند إداري")
                            
                            if file_storage and file_storage.filename:
                                doc_path = save_employee_document(file_storage, employee.id, doc_type)
                                
                                new_doc = EmployeeDocument(
                                    employee_id=employee.id,
                                    document_type=doc_type,
                                    file_path=doc_path,
                                    original_name=file_storage.filename
                                )
                                db.session.add(new_doc)
                    except Exception as doc_error:
                         print(f"Failed to process document {key}: {doc_error}")

            db.session.commit()
        except Exception as e:
             print(f"Document upload process failed: {e}")
             # Non-critical, continue

        return jsonify(employee.to_dict()), 200
        
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 400
    except HTTPException:
        raise
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to update employee", "details": str(e)}), 500


@admin_bp.route('/employees/<int:employee_id>', methods=['DELETE'])
@require_admin
def delete_employee(employee_id):
    """
    Soft delete an employee.
    Sets is_deleted = True.
    Does NOT remove from DB to preserve history.
    """
    try:
        employee = Employee.query.get_or_404(employee_id)
        
        # Security check
        resolve_branch_scope(g.current_user, employee.branch_id)
        
        employee.is_deleted = True
        employee.is_active = False # Also deactivate
        # employee.status = EmployeeStatus.SUSPENDED # Optional: or keep as is? Maybe specific DELETED status?
        # User requested soft delete, keeping status logic simple for now. 
        # Mark as suspended makes sense if they are deleted? 
        # Actually usually deleted is a separate state. 
        # The prompt says: "Status Control (Active / Suspended) ... Soft Delete (is_deleted)".
        # So is_deleted is independent.
        
        db.session.commit()
        return jsonify({"message": "Employee soft deleted successfully", "id": employee.id}), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to delete employee", "details": str(e)}), 500


def _parse_employee_history_pagination(default_per_page: int = 20, max_per_page: int = 100):
    page = request.args.get('page', default=1, type=int) or 1
    per_page = request.args.get('per_page', default=default_per_page, type=int) or default_per_page
    return max(page, 1), min(max(per_page, 1), max_per_page)


def _parse_admin_bounded_pagination(default_per_page: int = 20, max_per_page: int = 100):
    raw_page = request.args.get('page', type=int)
    raw_per_page = request.args.get('per_page', type=int)

    page = raw_page if isinstance(raw_page, int) and raw_page > 0 else 1
    per_page = raw_per_page if isinstance(raw_per_page, int) and raw_per_page > 0 else default_per_page
    return page, min(per_page, max_per_page)


def _serialize_invoice_list_barbers(invoice_items):
    ordered_items = sorted(invoice_items or [], key=lambda item: (item.id is None, item.id or 0))

    barbers = []
    seen_barber_ids = set()
    for item in ordered_items:
        if getattr(item, 'item_type', None) == "PRODUCT_ITEM":
            continue

        barber = getattr(item, 'barber', None)
        barber_id = getattr(item, 'barber_id', None)
        if not barber or barber_id is None or barber_id in seen_barber_ids:
            continue

        seen_barber_ids.add(barber_id)
        barbers.append({
            "id": barber_id,
            "name": barber.full_name
        })

    return {
        "barber": barbers[0]["name"] if barbers else None,
        "barbers": barbers,
        "barber_count": len(barbers)
    }


def _parse_employee_history_date_arg(param_name: str):
    raw_value = request.args.get(param_name)
    if raw_value in (None, ''):
        return None

    try:
        return date.fromisoformat(raw_value)
    except ValueError as exc:
        raise ValueError(f"{param_name} must be in YYYY-MM-DD format") from exc


def _build_employee_history_page(items, page: int, per_page: int, total: int, extra: Optional[Dict] = None):
    payload = {
        "items": items,
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": ceil(total / per_page) if total else 0,
        "has_more": (page * per_page) < total,
    }
    if extra:
        payload.update(extra)
    return payload


def _get_scoped_employee_or_404(employee_id: int):
    employee = Employee.query.get_or_404(employee_id)
    resolve_branch_scope(g.current_user, employee.branch_id)
    return employee


def _build_employee_ledger_conditions(employee_id: int, *, date_from=None, date_to=None, branch_name=None, item_type=None):
    conditions = [
        Invoice.status == InvoiceStatus.PAID,
        or_(
            InvoiceItem.barber_id == employee_id,
            InvoiceItem.assistant_id == employee_id,
            InvoiceItem.assigned_employee_id == employee_id,
        ),
    ]

    if date_from is not None:
        conditions.append(Invoice.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to is not None:
        conditions.append(Invoice.created_at <= datetime.combine(date_to, datetime.max.time()))
    if branch_name:
        conditions.append(Invoice.branch.has(Branch.name == branch_name))
    if item_type in ('SERVICE_ITEM', 'PRODUCT_ITEM'):
        conditions.append(InvoiceItem.item_type == item_type)

    return conditions


def _serialize_employee_ledger_item(item: InvoiceItem, employee_id: int):
    if item.item_type == 'PRODUCT_ITEM':
        return {
            "id": str(item.id),
            "itemType": "PRODUCT_ITEM",
            "date": to_iso_string(item.invoice.paid_at or item.invoice.created_at or item.created_at),
            "serviceName": "بيع منتج",
            "productName": item.product.name if item.product else "منتج",
            "invoiceNumber": str(item.invoice.invoice_number) if item.invoice and item.invoice.invoice_number else "---",
            "branch": item.invoice.branch.name if item.invoice and item.invoice.branch else "Unknown",
            "value": float(item.sales_commission_amount or 0),
            "share": 0.0,
            "role": None,
        }

    is_barber = item.barber_id == employee_id
    share_percent = item.barber_commission_percent if is_barber else item.assistant_commission_percent
    share = (float(item.service_price or 0) * float(share_percent or 0)) / 100.0

    return {
        "id": str(item.id),
        "itemType": "SERVICE_ITEM",
        "date": to_iso_string(item.invoice.created_at if item.invoice else item.created_at),
        "serviceName": item.service.name if item.service else "Unknown",
        "productName": None,
        "invoiceNumber": str(item.invoice.invoice_number) if item.invoice and item.invoice.invoice_number else "---",
        "branch": item.invoice.branch.name if item.invoice and item.invoice.branch else "Unknown",
        "value": float(item.service_price or 0),
        "share": share,
        "role": "BARBER" if is_barber else "ASSISTANT",
    }


def _build_employee_ledger_summary(employee_id: int, conditions):
    share_expr = case(
        (InvoiceItem.barber_id == employee_id, InvoiceItem.service_price * (InvoiceItem.barber_commission_percent / 100.0)),
        else_=(InvoiceItem.service_price * (InvoiceItem.assistant_commission_percent / 100.0)),
    )

    service_count, total_value, total_share, product_count, product_commission = (
        db.session.query(
            func.coalesce(func.sum(case((InvoiceItem.item_type == 'SERVICE_ITEM', 1), else_=0)), 0),
            func.coalesce(func.sum(case((InvoiceItem.item_type == 'SERVICE_ITEM', InvoiceItem.service_price), else_=0)), 0),
            func.coalesce(func.sum(case((InvoiceItem.item_type == 'SERVICE_ITEM', share_expr), else_=0)), 0),
            func.coalesce(func.sum(case((InvoiceItem.item_type == 'PRODUCT_ITEM', 1), else_=0)), 0),
            func.coalesce(func.sum(case((InvoiceItem.item_type == 'PRODUCT_ITEM', InvoiceItem.sales_commission_amount), else_=0)), 0),
        )
        .select_from(InvoiceItem)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .filter(*conditions)
        .one()
    )

    return {
        "service_operations_count": int(service_count or 0),
        "total_service_value": float(total_value or 0),
        "total_service_share": float(total_share or 0),
        "product_sales_count": int(product_count or 0),
        "product_commission_total": float(product_commission or 0),
    }


@admin_bp.route('/employees/<int:employee_id>/summary', methods=['GET'])
@require_admin
def get_employee_summary(employee_id):
    try:
        employee = _get_scoped_employee_or_404(employee_id)

        total_service_invoices = (
            db.session.query(func.count(func.distinct(InvoiceItem.invoice_id)))
            .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
            .filter(
                Invoice.status == InvoiceStatus.PAID,
                InvoiceItem.item_type == 'SERVICE_ITEM',
                or_(
                    InvoiceItem.barber_id == employee.id,
                    InvoiceItem.assistant_id == employee.id,
                ),
            )
            .scalar()
            or 0
        )

        branch_options = [
            branch_name
            for (branch_name,) in (
                db.session.query(Branch.name)
                .join(Invoice, Invoice.branch_id == Branch.id)
                .join(InvoiceItem, InvoiceItem.invoice_id == Invoice.id)
                .filter(
                    Invoice.status == InvoiceStatus.PAID,
                    or_(
                        InvoiceItem.barber_id == employee.id,
                        InvoiceItem.assistant_id == employee.id,
                        InvoiceItem.assigned_employee_id == employee.id,
                    ),
                )
                .distinct()
                .order_by(Branch.name.asc())
                .all()
            )
            if branch_name
        ]

        return jsonify({
            "id": employee.id,
            "full_name": employee.full_name,
            "phone": employee.phone,
            "role": employee.employee_type.value if employee.employee_type else None,
            "branch_id": employee.branch_id,
            "branch_name": employee.branch.name if employee.branch else "Unknown",
            "base_salary": float(employee.base_salary or 0),
            "commission_wallet_balance": float(employee.commission_wallet_balance or 0),
            "is_active": employee.is_active,
            "status": employee.status.value if employee.status else None,
            "is_deleted": employee.is_deleted,
            "created_at": employee.created_at.isoformat() if employee.created_at else None,
            "image_url": employee.image_url,
            "documents": [doc.to_dict() for doc in employee.documents] if getattr(employee, 'documents', None) else [],
            "header_stats": {
                "total_service_invoices": int(total_service_invoices),
            },
            "branch_options": branch_options,
        }), 200
    except HTTPException:
        raise
    except Exception as e:
        return jsonify({"error": "Failed to fetch employee summary", "details": str(e)}), 500


@admin_bp.route('/employees/<int:employee_id>/ledger/summary', methods=['GET'])
@require_admin
def get_employee_ledger_summary(employee_id):
    try:
        employee = _get_scoped_employee_or_404(employee_id)
        date_from = _parse_employee_history_date_arg('date_from')
        date_to = _parse_employee_history_date_arg('date_to')
        if date_from and date_to and date_from > date_to:
            return jsonify({"error": "date_from cannot be after date_to"}), 400

        conditions = _build_employee_ledger_conditions(
            employee.id,
            date_from=date_from,
            date_to=date_to,
            branch_name=request.args.get('branch_name') or None,
        )

        return jsonify(_build_employee_ledger_summary(employee.id, conditions)), 200
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except HTTPException:
        raise
    except Exception as e:
        return jsonify({"error": "Failed to fetch employee ledger summary", "details": str(e)}), 500


@admin_bp.route('/employees/<int:employee_id>/ledger', methods=['GET'])
@require_admin
def get_employee_ledger(employee_id):
    """
    Fetch the operational and financial ledger for an employee.
    Source of truth: invoice_items table.
    """
    try:
        employee = _get_scoped_employee_or_404(employee_id)
        page, per_page = _parse_employee_history_pagination()
        date_from = _parse_employee_history_date_arg('date_from')
        date_to = _parse_employee_history_date_arg('date_to')
        if date_from and date_to and date_from > date_to:
            return jsonify({"error": "date_from cannot be after date_to"}), 400

        conditions = _build_employee_ledger_conditions(
            employee.id,
            date_from=date_from,
            date_to=date_to,
            branch_name=request.args.get('branch_name') or None,
            item_type=request.args.get('item_type') or None,
        )

        base_query = InvoiceItem.query.join(Invoice).filter(*conditions)
        total = base_query.order_by(None).count()
        items = (
            base_query
            .options(
                joinedload(InvoiceItem.invoice).joinedload(Invoice.branch),
                joinedload(InvoiceItem.service),
                joinedload(InvoiceItem.product),
            )
            .order_by(
                func.coalesce(Invoice.paid_at, Invoice.created_at, InvoiceItem.created_at).desc(),
                InvoiceItem.id.desc(),
            )
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )

        summary = _build_employee_ledger_summary(employee.id, conditions)
        return jsonify(_build_employee_history_page(
            [_serialize_employee_ledger_item(item, employee.id) for item in items],
            page,
            per_page,
            total,
            extra={"summary": summary},
        )), 200
    except Exception as e:
        return jsonify({"error": "Failed to fetch employee ledger", "details": str(e)}), 500


@admin_bp.route('/employees/<int:employee_id>/transfer', methods=['POST'])
@require_admin
def transfer_employee(employee_id):
    """
    Transfer an employee to a new branch.
    Logic:
    1. Update base branch_id.
    2. Close open attendance in OLD branch.
    3. Log transfer.
    """
    from werkzeug.exceptions import HTTPException
    from app.models.employee_transfer import EmployeeTransfer
    from datetime import datetime, timezone
    from flask import g
    
    try:
        data = request.get_json()
        new_branch_id = data.get('branch_id')
        
        if not new_branch_id:
            return jsonify({"error": "branch_id is required"}), 400
            
        employee = Employee.query.filter_by(id=employee_id).populate_existing().with_for_update().first_or_404()
        old_branch_id = employee.branch_id
        
        if int(old_branch_id) == int(new_branch_id):
            return jsonify({"error": "Employee is already in this branch"}), 400
            
        # Security: Check access to both branches
        resolve_branch_scope(g.current_user, old_branch_id)
        resolve_branch_scope(g.current_user, new_branch_id)
        
        now = datetime.now(timezone.utc)

        # Lock/recheck attendance BEFORE staging any employee or transfer mutations.
        from app.services.attendance_compatibility import close_transfer_attendance
        close_transfer_attendance(employee_id, old_branch_id, g.current_user,
                                  data.get('attendance_closure_review'), now)
        transfer = EmployeeTransfer(
            employee_id=employee_id, from_branch_id=old_branch_id,
            to_branch_id=new_branch_id, transfer_date=now)
        db.session.add(transfer)
        employee.branch_id = new_branch_id

        db.session.commit()
        
        return jsonify({
            "message": "Employee transferred successfully",
            "employee": employee.to_dict()
        }), 200
        
    except HTTPException as e:
        db.session.rollback()
        return jsonify({"error": e.description}), e.code
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Transfer failed", "details": str(e)}), 500


@admin_bp.route('/employees/<int:employee_id>/transfers', methods=['GET'])
@require_admin
def get_employee_transfers(employee_id):
    """
    Fetch the historical movement log for an employee.
    Reconstructs continuous history from transfer events.
    """
    from app.models.employee_transfer import EmployeeTransfer
    
    try:
        employee = _get_scoped_employee_or_404(employee_id)
        page, per_page = _parse_employee_history_pagination()

        # Helper function to calculate stats for a specific time window
        def calculate_period_stats(branch_id, start_date, end_date=None):
            """Calculate operations count and earnings for a specific period"""
            if not branch_id:
                return {'count': 0, 'earnings': 0}
            
            # Build query with date filters
            query = db.session.query(
                func.count(InvoiceItem.id).label('count'),
                func.coalesce(
                    func.sum(
                        InvoiceItem.service_price * (
                            case(
                                (InvoiceItem.barber_id == employee_id, InvoiceItem.barber_commission_percent),
                                else_=InvoiceItem.assistant_commission_percent
                            ) / 100.0
                        )
                    ),
                    0
                ).label('earnings')
            ).join(Invoice, Invoice.id == InvoiceItem.invoice_id)\
             .filter(
                Invoice.branch_id == branch_id,
                Invoice.status == InvoiceStatus.PAID,  # ✅ CRITICAL: Only PAID invoices
                or_(
                    InvoiceItem.barber_id == employee_id,
                    InvoiceItem.assistant_id == employee_id
                ),
                Invoice.created_at >= start_date
            )
            
            # Add end date filter if this is a historical period
            if end_date:
                query = query.filter(Invoice.created_at < end_date)
            
            result = query.first()
            return {
                'count': result.count if result.count else 0,
                'earnings': float(result.earnings) if result.earnings else 0.0
            }
        
        events_query = EmployeeTransfer.query.filter_by(employee_id=employee_id)
        historical_total = events_query.order_by(None).count()
        total = historical_total + 1
        total_pages = ceil(total / per_page) if total else 0
        if total_pages and page > total_pages:
            return jsonify(_build_employee_history_page([], page, per_page, total)), 200

        history = []

        if page == 1:
            most_recent_event = (
                events_query
                .order_by(EmployeeTransfer.transfer_date.desc(), EmployeeTransfer.id.desc())
                .first()
            )
            current_start = most_recent_event.transfer_date if most_recent_event else employee.created_at
            current_stats = calculate_period_stats(employee.branch_id, current_start, None)
            history.append({
                "id": f"curr-{employee.id}",
                "branch": employee.branch.name if employee.branch else "Unknown",
                "startDate": current_start.strftime("%Y-%m-%d"),
                "endDate": "مستمر",
                "operationsCount": current_stats['count'],
                "totalEarnings": current_stats['earnings'],
            })
            event_offset = 0
            display_limit = max(per_page - 1, 0)
        else:
            event_offset = ((page - 1) * per_page) - 1
            display_limit = per_page

        events = []
        if display_limit > 0:
            events = (
                events_query
                .options(
                    joinedload(EmployeeTransfer.from_branch),
                    joinedload(EmployeeTransfer.to_branch),
                )
                .order_by(EmployeeTransfer.transfer_date.desc(), EmployeeTransfer.id.desc())
                .offset(event_offset)
                .limit(display_limit + 1)
                .all()
            )

        visible_events = events[:display_limit]
        boundary_event = events[display_limit] if len(events) > display_limit else None

        for index, event in enumerate(visible_events):
            next_older_event = visible_events[index + 1] if index + 1 < len(visible_events) else boundary_event
            period_start = next_older_event.transfer_date if next_older_event else employee.created_at
            period_end = event.transfer_date
            period_stats = calculate_period_stats(event.from_branch_id, period_start, period_end)

            history.append({
                "id": str(event.id),
                "branch": event.from_branch.name if event.from_branch else "Unknown",
                "startDate": period_start.strftime("%Y-%m-%d"),
                "endDate": period_end.strftime("%Y-%m-%d"),
                "operationsCount": period_stats['count'],
                "totalEarnings": period_stats['earnings'],
            })

        return jsonify(_build_employee_history_page(history, page, per_page, total)), 200
    except Exception as e:
        return jsonify({"error": "Failed to fetch transfer history", "details": str(e)}), 500


# ============================================================================
# EXPENSE READ ENDPOINTS (Admin)
# ============================================================================

def _get_default_admin_expense_window() -> Tuple[date, date]:
    today = get_cairo_date()
    return today.replace(day=1), today


def _parse_admin_expense_date(param_name: str, raw_value: Optional[str]) -> Optional[date]:
    if not raw_value:
        return None

    try:
        return date.fromisoformat(raw_value)
    except ValueError as exc:
        raise ValueError(f"{param_name} must be in YYYY-MM-DD format") from exc


def _resolve_admin_expense_filters(source=None):
    from app.models.expense import Expense

    getter = source.get if source is not None else request.args.get

    requested_branch = getter('branch_id')
    allowed_branch_ids = resolve_branch_scope(g.current_user, requested_branch)

    raw_category_id = getter('category_id')
    category_id = None
    if raw_category_id not in (None, ''):
        try:
            category_id = int(raw_category_id)
        except ValueError as exc:
            raise ValueError("category_id must be an integer") from exc

    date_from = _parse_admin_expense_date('date_from', getter('date_from'))
    date_to = _parse_admin_expense_date('date_to', getter('date_to'))

    if date_from is None and date_to is None:
        date_from, date_to = _get_default_admin_expense_window()

    if date_from and date_to and date_from > date_to:
        raise ValueError("date_from cannot be after date_to")

    conditions = [
        Expense.is_business_expense == True,  # noqa: E712
    ]

    if allowed_branch_ids:
        conditions.append(Expense.branch_id.in_(allowed_branch_ids))
    else:
        conditions.append(False)

    if category_id is not None:
        conditions.append(Expense.expense_category_id == category_id)

    if date_from is not None:
        conditions.append(Expense.expense_date >= date_from)

    if date_to is not None:
        conditions.append(Expense.expense_date <= date_to)

    return {
        "conditions": conditions,
        "requested_branch": requested_branch,
        "category_id": category_id,
        "allowed_branch_ids": allowed_branch_ids,
        "date_from": date_from,
        "date_to": date_to,
    }


def _serialize_admin_expense(expense):
    return {
        "id": expense.id,
        "date": expense.expense_date.isoformat(),
        "branch": expense.branch.name if expense.branch else "Unknown",
        "type": expense.expense_category.name if expense.expense_category else "Unknown",
        "amount": float(expense.amount),
        "source": "نظام الكاشير",
        "createdBy": expense.cashier.full_name if expense.cashier else "Unknown",
        "notes": expense.notes or "",
    }


@admin_bp.route('/expenses', methods=['GET'])
@require_admin
def get_expenses():
    """
    Get paginated expenses formatted for the Admin Frontend.
    """
    from app.models.expense import Expense

    try:
        filters = _resolve_admin_expense_filters()

        page = max(request.args.get('page', default=1, type=int) or 1, 1)
        requested_per_page = request.args.get('per_page', default=25, type=int) or 25
        per_page = min(max(requested_per_page, 1), 100)

        base_query = Expense.query.filter(*filters["conditions"])
        total = base_query.count()
        total_pages = ceil(total / per_page) if total else 0

        expenses = (
            base_query
            .options(
                joinedload(Expense.branch),
                joinedload(Expense.expense_category),
                joinedload(Expense.cashier),
            )
            .order_by(Expense.expense_date.desc(), Expense.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )

        return jsonify({
            "items": [_serialize_admin_expense(expense) for expense in expenses],
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
            "has_more": page < total_pages,
        }), 200

    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except HTTPException:
        raise
    except Exception as e:
        return jsonify({"error": "Failed to fetch expenses", "details": str(e)}), 500


@admin_bp.route('/expenses/summary', methods=['GET'])
@require_admin
def get_expenses_summary():
    from app.models.expense import Expense

    try:
        filters = _resolve_admin_expense_filters()
        today = get_cairo_date()

        total_amount, today_amount, count = (
            db.session.query(
                func.coalesce(func.sum(Expense.amount), 0),
                func.coalesce(
                    func.sum(
                        case(
                            (Expense.expense_date == today, Expense.amount),
                            else_=0,
                        )
                    ),
                    0,
                ),
                func.count(Expense.id),
            )
            .filter(*filters["conditions"])
            .one()
        )

        return jsonify({
            "total_amount": float(total_amount or 0),
            "today_amount": float(today_amount or 0),
            "count": int(count or 0),
        }), 200
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except HTTPException:
        raise
    except Exception as e:
        return jsonify({"error": "Failed to fetch expense summary", "details": str(e)}), 500


@admin_bp.route('/expenses/export/xlsx', methods=['POST'])
@require_admin
def export_expenses_xlsx():
    from app.models.expense import Expense

    try:
        payload = request.get_json(silent=True) or {}
        filters = _resolve_admin_expense_filters(payload)

        export_query = (
            Expense.query
            .filter(*filters["conditions"])
            .options(
                joinedload(Expense.branch),
                joinedload(Expense.expense_category),
                joinedload(Expense.cashier),
            )
            .order_by(Expense.expense_date.desc(), Expense.id.desc())
            .yield_per(500)
        )

        workbook_columns = [
            ExcelColumn(title='التاريخ', width=18),
            ExcelColumn(title='الفرع', width=24),
            ExcelColumn(title='النوع', width=24),
            ExcelColumn(title='المبلغ', width=16),
            ExcelColumn(title='بواسطة', width=24),
            ExcelColumn(title='المصدر', width=18),
            ExcelColumn(title='ملاحظات', width=40),
        ]

        workbook_file = build_xlsx_file(
            sheet_name='Expenses',
            columns=workbook_columns,
            rows=(
                [
                    expense.expense_date.isoformat(),
                    expense.branch.name if expense.branch else 'Unknown',
                    expense.expense_category.name if expense.expense_category else 'Unknown',
                    float(expense.amount),
                    expense.cashier.full_name if expense.cashier else 'Unknown',
                    'نظام الكاشير',
                    expense.notes or '',
                ]
                for expense in export_query
            ),
        )

        qualifiers = []
        if filters["requested_branch"] and str(filters["requested_branch"]).lower() != 'all':
            qualifiers.append(f"branch_{filters['requested_branch']}")
        if filters["date_from"]:
            qualifiers.append(str(filters["date_from"]))
        if filters["date_to"]:
            qualifiers.append(str(filters["date_to"]))

        filename = build_export_filename(
            'Expenses',
            extension='xlsx',
            qualifiers=qualifiers,
            exported_on=get_cairo_date(),
        )

        return send_file(
            workbook_file,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=filename,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error exporting expenses: {e}")
        return jsonify({"error": "Failed to export expenses", "details": str(e)}), 500


# ============================================================================
# ATTENDANCE ENDPOINTS (Admin)
# ============================================================================

@admin_bp.route('/attendance/workspace', methods=['GET'])
@require_admin
def get_attendance_workspace():
    from app.models.business_day import BusinessDay

    try:
        business_day_id_raw = request.args.get('business_day_id')
        if business_day_id_raw is None:
            return jsonify({"error": "business_day_id is required"}), 400

        try:
            business_day_id = int(business_day_id_raw)
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid business_day_id"}), 400

        business_day = (
            BusinessDay.query
            .options(
                joinedload(BusinessDay.branch),
                joinedload(BusinessDay.opener),
                joinedload(BusinessDay.closer),
            )
            .filter(BusinessDay.id == business_day_id)
            .first()
        )
        if not business_day:
            return jsonify({"error": "Business day not found"}), 404

        allowed_branch_ids = resolve_branch_scope(g.current_user, None)
        if business_day.branch_id not in allowed_branch_ids:
            return jsonify({"error": "Access denied"}), 403

        return jsonify(build_attendance_workspace_payload(business_day)), 200

    except HTTPException as exc:
        return jsonify({"error": exc.description}), exc.code
    except Exception as e:
        print(f"Attendance workspace API Error: {e}")
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@admin_bp.route('/attendance/legacy', methods=['GET'])
@require_admin
def get_legacy_attendance():
    try:
        requested_branch = request.args.get('branch_id')
        date_str = request.args.get('date')
        if not date_str:
            return jsonify({"error": "date is required. Use YYYY-MM-DD"}), 400

        try:
            target_date = date.fromisoformat(date_str)
        except ValueError:
            return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400

        allowed_branch_ids = resolve_branch_scope(g.current_user, requested_branch)
        if not allowed_branch_ids:
            return jsonify({
                "metadata": {
                    "date": target_date.isoformat(),
                    "legacy_only": True,
                },
                "rows": [],
            }), 200

        return jsonify(
            build_legacy_attendance_payload(
                target_date=target_date,
                allowed_branch_ids=allowed_branch_ids,
            )
        ), 200

    except HTTPException as exc:
        return jsonify({"error": exc.description}), exc.code
    except Exception as e:
        print(f"Legacy attendance API Error: {e}")
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500

@admin_bp.route('/attendance', methods=['GET'])
@require_admin
def get_attendance():
    """
    Get attendance records for Admin tracking.
    Supports filters: date, branch_id.
    """
    from app.models.attendance import Attendance, AttendanceStatus
    from flask import g
    from datetime import date as date_obj, datetime, timezone

    try:
        # 1. Parse Filters
        date_str = request.args.get('date') # Expected: YYYY-MM-DD
        requested_branch = request.args.get('branch_id')

        # Default to today if no date provided
        target_date = date_obj.fromisoformat(date_str) if date_str else get_cairo_date()

        # 2. Resolve Branch Scope
        allowed_branch_ids = resolve_branch_scope(g.current_user, requested_branch)
        if not allowed_branch_ids:
            return jsonify({
                "records": [],
                "stats": {"present": 0, "absent": 0, "total": 0}
            }), 200

        # 3. Fetch Employees (Active only)
        employees = Employee.query.filter(
            Employee.is_active == True,
            Employee.branch_id.in_(allowed_branch_ids)
        ).order_by(Employee.id.desc()).all()
        employee_ids = [e.id for e in employees]

        # 4. Fetch Attendance Records for these employees on target_date
        attendance_records = Attendance.query.filter(
            Attendance.employee_id.in_(employee_ids),
            Attendance.date == target_date
        ).all()

        attendance_map = {a.employee_id: a for a in attendance_records}

        # 5. Build Result List
        results = []
        present_count = 0
        total_employees = len(employees)

        for emp in employees:
            att = attendance_map.get(emp.id)
            
            duration_minutes = 0
            # Default status is ABSENT (no record for date)
            status = "ABSENT"
            check_in_at = None
            check_out_at = None

            if att:
                # If record exists, they are at least "PRESENT" for some time today
                check_in_at = to_iso_string(att.check_in_time) if att.check_in_time else None
                check_out_at = to_iso_string(att.check_out_time) if att.check_out_time else None
                
                # Rule: If check_out_at is NULL -> employee is still present
                if not att.check_out_time:
                    status = "PRESENT"
                    present_count += 1
                    # Duration so far until now (if it's today)
                    if target_date == date_obj.today():
                        diff = datetime.now(timezone.utc) - att.check_in_time.replace(tzinfo=timezone.utc)
                        duration_minutes = int(diff.total_seconds() / 60)
                else:
                    # They have checked out
                    status = "LEFT"
                    present_count += 1
                    diff = att.check_out_time - att.check_in_time
                    duration_minutes = int(diff.total_seconds() / 60)

            results.append({
                "employee_id": emp.id,
                "employee_name": emp.full_name,
                "role": emp.employee_type.value,
                "branch": emp.branch.name if emp.branch else "Unknown",
                "check_in_at": check_in_at,
                "check_out_at": check_out_at,
                "duration_minutes": max(0, duration_minutes),
                "status": status
            })

        # 6. Global Stats
        stats = {
            "present": present_count,
            "absent": total_employees - present_count,
            "total": total_employees
        }

        return jsonify({
            "records": results,
            "stats": stats
        }), 200

    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400
    except Exception as e:
        print(f"Attendance API Error: {e}")
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@admin_bp.route('/employees/<int:employee_id>/advances', methods=['GET'])
@require_admin
def get_employee_advances(employee_id):
    """
    Fetch advances for an employee.
    Stage 3: Reads from employee_financial_actions using employee_id FK.
    No longer uses expense table or ILIKE name matching.
    """
    from app.models.employee_financial_action import EmployeeFinancialAction, EmployeeActionType

    try:
        employee = _get_scoped_employee_or_404(employee_id)
        page, per_page = _parse_employee_history_pagination()

        base_query = EmployeeFinancialAction.query.filter(
            EmployeeFinancialAction.employee_id == employee.id,
            EmployeeFinancialAction.action_type == EmployeeActionType.ADVANCE
        )
        total = base_query.order_by(None).count()
        actions = (
            base_query
            .order_by(EmployeeFinancialAction.created_at.desc(), EmployeeFinancialAction.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )
        total_amount = (
            db.session.query(func.coalesce(func.sum(EmployeeFinancialAction.amount), 0))
            .filter(
                EmployeeFinancialAction.employee_id == employee.id,
                EmployeeFinancialAction.action_type == EmployeeActionType.ADVANCE,
            )
            .scalar()
            or 0
        )

        advances = [{
                "id": f"EFA-{action.id}",
                "date": to_iso_string(action.created_at),
                "amount": float(action.amount),
                "status": "تم الصرف",
                "note": action.notes or ""
            } for action in actions]

        return jsonify(_build_employee_history_page(
            advances,
            page,
            per_page,
            total,
            extra={
                "summary": {
                    "total_amount": float(total_amount),
                }
            },
        )), 200

    except Exception as e:
        print(f"Failed to fetch employee advances: {e}")
        return jsonify({"error": "Failed to fetch advances", "details": str(e)}), 500


@admin_bp.route('/employees/<int:employee_id>/deductions', methods=['GET'])
@require_admin
def get_employee_deductions(employee_id):
    """
    Fetch deductions for an employee.
    Stage 3: Reads from employee_financial_actions using employee_id FK.
    No longer uses expense table or ILIKE name matching.
    """
    from app.models.employee_financial_action import EmployeeFinancialAction, EmployeeActionType

    try:
        employee = _get_scoped_employee_or_404(employee_id)
        page, per_page = _parse_employee_history_pagination()

        base_query = EmployeeFinancialAction.query.filter(
            EmployeeFinancialAction.employee_id == employee.id,
            EmployeeFinancialAction.action_type == EmployeeActionType.DEDUCTION
        )
        total = base_query.order_by(None).count()
        actions = (
            base_query
            .order_by(EmployeeFinancialAction.created_at.desc(), EmployeeFinancialAction.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )
        total_amount = (
            db.session.query(func.coalesce(func.sum(EmployeeFinancialAction.amount), 0))
            .filter(
                EmployeeFinancialAction.employee_id == employee.id,
                EmployeeFinancialAction.action_type == EmployeeActionType.DEDUCTION,
            )
            .scalar()
            or 0
        )

        deductions = [{
                "id": f"EFA-{action.id}",
                "date": to_iso_string(action.created_at),
                "amount": float(action.amount),
                "reason": action.notes or "خصم إداري",
                "note": action.notes or "",
                "notes": action.notes or ""
            } for action in actions]

        return jsonify(_build_employee_history_page(
            deductions,
            page,
            per_page,
            total,
            extra={
                "summary": {
                    "total_amount": float(total_amount),
                }
            },
        )), 200

    except Exception as e:
        print(f"Failed to fetch employee deductions: {e}")
        return jsonify({"error": "Failed to fetch deductions", "details": str(e)}), 500


@admin_bp.route('/employees/<int:employee_id>/overtime', methods=['GET'])
@require_admin
def get_employee_overtime(employee_id):
    """
    Fetch overtime records for an employee.
    Uses the dedicated employee_overtime table.
    """
    from app.models.employee_overtime import EmployeeOvertime
    try:
        employee = _get_scoped_employee_or_404(employee_id)
        page, per_page = _parse_employee_history_pagination()

        base_query = EmployeeOvertime.query.filter_by(employee_id=employee.id)
        total = base_query.order_by(None).count()
        overtimes = (
            base_query
            .order_by(EmployeeOvertime.date.desc(), EmployeeOvertime.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )
        total_amount = (
            db.session.query(func.coalesce(func.sum(EmployeeOvertime.amount), 0))
            .filter(EmployeeOvertime.employee_id == employee.id)
            .scalar()
            or 0
        )

        return jsonify(_build_employee_history_page(
            [ot.to_dict() for ot in overtimes],
            page,
            per_page,
            total,
            extra={
                "summary": {
                    "total_amount": float(total_amount),
                }
            },
        )), 200
        
    except Exception as e:
        print(f"Failed to fetch employee overtime: {e}")
        return jsonify({"error": "Failed to fetch overtime", "details": str(e)}), 500


@admin_bp.route('/employees/<int:employee_id>/payroll/preview', methods=['GET'])
@require_admin
def preview_employee_payroll(employee_id):
    """
    Read-only payroll calculation preview for an employee.
    Accepts arbitrary inclusive date range: ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
    Does not write to DB, mutate wallet balances, or create financial actions.
    """
    from app.services.payroll_calculation_service import calculate_employee_payroll_preview

    employee = _get_scoped_employee_or_404(employee_id)

    start_date_str = request.args.get('start_date') or request.args.get('date_from')
    end_date_str = request.args.get('end_date') or request.args.get('date_to')

    if not start_date_str or not end_date_str:
        today = get_cairo_date()
        start_date = today.replace(day=1)
        end_date = today
    else:
        try:
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
            end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({"error": "Invalid date format. Expected YYYY-MM-DD"}), 400

    if start_date > end_date:
        return jsonify({"error": "start_date must be less than or equal to end_date"}), 400

    try:
        preview_data = calculate_employee_payroll_preview(employee, start_date, end_date)
        return jsonify(preview_data), 200
    except Exception as e:
        return jsonify({"error": "Failed to calculate payroll preview", "details": str(e)}), 500


@admin_bp.route('/employees/<int:employee_id>/settlements', methods=['POST'])
@require_admin
def create_employee_settlement_draft(employee_id):
    """
    Creates a new DRAFT settlement with frozen snapshots and allocated source items.
    Items in DRAFT are not permanently locked until approved.
    """
    from app.services.payroll_settlement_service import (
        create_settlement_draft, SettlementError, SettlementValidationError
    )

    employee = _get_scoped_employee_or_404(employee_id)
    data = request.get_json() or {}

    start_date_str = data.get('date_from') or data.get('start_date')
    end_date_str = data.get('date_to') or data.get('end_date')

    if not start_date_str or not end_date_str:
        return jsonify({"error": "date_from and date_to are required (YYYY-MM-DD)"}), 400

    try:
        date_from = datetime.strptime(start_date_str, '%Y-%m-%d').date()
        date_to = datetime.strptime(end_date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({"error": "Invalid date format. Expected YYYY-MM-DD"}), 400

    base_salary_allocated = data.get('base_salary_allocated', 0.0)
    adjustments = data.get('adjustments', [])
    notes = data.get('notes')
    user_id = g.current_user.id if hasattr(g, 'current_user') and g.current_user else 1

    try:
        settlement = create_settlement_draft(
            employee_id=employee.id,
            date_from=date_from,
            date_to=date_to,
            base_salary_allocated=base_salary_allocated,
            adjustments=adjustments,
            notes=notes,
            user_id=user_id,
        )
        return jsonify({
            "success": True,
            "message": "تم إنشاء مسودة التسوية بنجاح",
            "settlement": settlement.to_dict()
        }), 201
    except SettlementValidationError as ve:
        return jsonify({"error": str(ve)}), 400
    except SettlementError as se:
        return jsonify({"error": str(se)}), 409
    except Exception as e:
        return jsonify({"error": "Failed to create settlement draft", "details": str(e)}), 500


@admin_bp.route('/employees/<int:employee_id>/settlements', methods=['GET'])
@require_admin
def list_employee_settlements_route(employee_id):
    """
    List historical settlements for an employee.
    """
    from app.services.payroll_settlement_service import list_employee_settlements

    employee = _get_scoped_employee_or_404(employee_id)
    status_filter = request.args.get('status')
    start_date_str = request.args.get('date_from') or request.args.get('start_date')
    end_date_str = request.args.get('date_to') or request.args.get('end_date')

    date_from = None
    date_to = None
    if start_date_str:
        try:
            date_from = datetime.strptime(start_date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({"error": "Invalid date_from format. Expected YYYY-MM-DD"}), 400
    if end_date_str:
        try:
            date_to = datetime.strptime(end_date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({"error": "Invalid date_to format. Expected YYYY-MM-DD"}), 400

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)

    result = list_employee_settlements(
        employee_id=employee.id,
        status=status_filter,
        date_from=date_from,
        date_to=date_to,
        page=page,
        per_page=per_page
    )
    return jsonify(result), 200


@admin_bp.route('/settlements/<int:settlement_id>', methods=['GET'])
@require_admin
def get_settlement_route(settlement_id):
    """
    Get full settlement details including allocated items, adjustments, and payments.
    """
    from app.services.payroll_settlement_service import get_settlement_by_id

    settlement_data = get_settlement_by_id(settlement_id)
    if not settlement_data:
        return jsonify({"error": "Settlement not found"}), 404

    resolve_branch_scope(g.current_user, settlement_data['branch_id'])
    return jsonify(settlement_data), 200


@admin_bp.route('/settlements/<int:settlement_id>', methods=['PUT'])
@require_admin
def update_settlement_draft_route(settlement_id):
    """
    Updates an existing DRAFT settlement (fixed salary, adjustments, notes).
    Recomputes financial totals on the backend.
    """
    from app.models.payroll_settlement import PayrollSettlement
    from app.services.payroll_settlement_service import (
        update_settlement_draft, SettlementValidationError, SettlementError
    )

    settlement = db.session.get(PayrollSettlement, settlement_id)
    if not settlement:
        return jsonify({"error": "Settlement not found"}), 404

    resolve_branch_scope(g.current_user, settlement.branch_id)

    data = request.get_json(silent=True) or {}
    base_salary_allocated = data.get('base_salary_allocated')
    adjustments = data.get('adjustments')
    notes = data.get('notes')
    user_id = g.current_user.id if hasattr(g, 'current_user') and g.current_user else 1

    try:
        updated = update_settlement_draft(
            settlement_id=settlement.id,
            base_salary_allocated=base_salary_allocated,
            adjustments=adjustments,
            notes=notes,
            user_id=user_id,
        )
        return jsonify({
            "success": True,
            "message": "تم تحديث مسودة التسوية بنجاح",
            "settlement": updated.to_dict()
        }), 200
    except SettlementValidationError as ve:
        return jsonify({"error": str(ve)}), 400
    except SettlementError as se:
        return jsonify({"error": str(se)}), 400
    except Exception as e:
        return jsonify({"error": "Failed to update settlement draft", "details": str(e)}), 500


@admin_bp.route('/settlements/<int:settlement_id>', methods=['DELETE'])
@require_admin
def discard_settlement_draft_route(settlement_id):
    """
    Discards an unapproved DRAFT settlement.
    """
    from app.models.payroll_settlement import PayrollSettlement
    from app.services.payroll_settlement_service import (
        discard_settlement_draft, SettlementValidationError, SettlementError
    )

    settlement = db.session.get(PayrollSettlement, settlement_id)
    if not settlement:
        return jsonify({"error": "Settlement not found"}), 404

    resolve_branch_scope(g.current_user, settlement.branch_id)
    user_id = g.current_user.id if hasattr(g, 'current_user') and g.current_user else 1

    try:
        discard_settlement_draft(settlement_id=settlement.id, user_id=user_id)
        return jsonify({
            "success": True,
            "message": "تم حذف مسودة التسوية بنجاح"
        }), 200
    except SettlementValidationError as ve:
        return jsonify({"error": str(ve)}), 400
    except SettlementError as se:
        return jsonify({"error": str(se)}), 400
    except Exception as e:
        return jsonify({"error": "Failed to discard settlement draft", "details": str(e)}), 500


@admin_bp.route('/settlements/<int:settlement_id>/approve', methods=['POST'])
@require_admin
def approve_settlement_route(settlement_id):
    """
    Approves a settlement draft. Enforces branch scoping, pessimistic locking, live revalidation, and conflict check.
    """
    from app.models.payroll_settlement import PayrollSettlement
    from app.services.payroll_settlement_service import (
        approve_settlement, SettlementConflictError, SettlementValidationError, SettlementError
    )

    settlement = db.session.get(PayrollSettlement, settlement_id)
    if not settlement:
        return jsonify({"error": "Settlement not found"}), 404

    resolve_branch_scope(g.current_user, settlement.branch_id)

    user_id = g.current_user.id if hasattr(g, 'current_user') and g.current_user else 1
    data = request.get_json(silent=True) or {}
    allow_override = bool(data.get('allow_overlapping_salary_override', False))
    override_reason = (data.get('salary_override_reason') or '').strip()

    current_role = getattr(g.current_user, 'role', None) if hasattr(g, 'current_user') else None
    role_value = current_role.value if hasattr(current_role, 'value') else str(current_role or '')

    if allow_override:
        if role_value not in ("SUPER_ADMIN", "EXEC_ADMIN"):
            return jsonify({
                "error": "Only SUPER_ADMIN and EXEC_ADMIN may explicitly override overlapping fixed salary allocations",
                "code": "FORBIDDEN_SALARY_OVERRIDE"
            }), 403

        if not override_reason:
            return jsonify({
                "error": "A non-empty reason is strictly required to override overlapping fixed salary allocations",
                "code": "MISSING_OVERRIDE_REASON"
            }), 400

    try:
        approved = approve_settlement(
            settlement_id=settlement.id,
            user_id=user_id,
            allow_overlapping_salary_override=allow_override,
            salary_override_reason=override_reason,
            user_role=role_value,
        )
        return jsonify({
            "success": True,
            "message": f"تم اعتماد التسوية #{approved.settlement_number} بنجاح وقفل بنودها",
            "settlement": approved.to_dict()
        }), 200
    except SettlementConflictError as ce:
        return jsonify({"error": str(ce), "code": "SETTLEMENT_ALLOCATION_CONFLICT"}), 409
    except SettlementValidationError as ve:
        return jsonify({"error": str(ve)}), 400
    except SettlementError as se:
        return jsonify({"error": str(se)}), 400
    except Exception as e:
        return jsonify({"error": "Failed to approve settlement", "details": str(e)}), 500


@admin_bp.route('/settlements/<int:settlement_id>/cancel', methods=['POST'])
@require_admin
def cancel_settlement_route(settlement_id):
    """
    Cancels an approved or draft settlement, releasing allocated items.
    """
    from app.models.payroll_settlement import PayrollSettlement
    from app.services.payroll_settlement_service import (
        cancel_settlement, SettlementValidationError, SettlementError
    )

    settlement = db.session.get(PayrollSettlement, settlement_id)
    if not settlement:
        return jsonify({"error": "Settlement not found"}), 404

    resolve_branch_scope(g.current_user, settlement.branch_id)

    user_id = g.current_user.id if hasattr(g, 'current_user') and g.current_user else 1
    data = request.get_json(silent=True) or {}
    reason = data.get('reason')

    if not reason or not reason.strip():
        return jsonify({"error": "Mandatory cancellation reason is required"}), 400

    try:
        cancelled = cancel_settlement(
            settlement_id=settlement.id,
            reason=reason.strip(),
            user_id=user_id
        )
        return jsonify({
            "success": True,
            "message": f"تم إلغاء التسوية #{cancelled.settlement_number} بنجاح وفك ارتباط بنودها",
            "settlement": cancelled.to_dict()
        }), 200
    except SettlementValidationError as ve:
        return jsonify({"error": str(ve)}), 400
    except SettlementError as se:
        return jsonify({"error": str(se)}), 400
    except Exception as e:
        return jsonify({"error": "Failed to cancel settlement", "details": str(e)}), 500


@admin_bp.route('/employees/<int:employee_id>/overtime', methods=['POST'])
@require_admin
def add_employee_overtime(employee_id):
    """
    [DISABLED — ARCHITECTURE ENFORCEMENT]

    Overtime entries must be created from the Mini (Cashier) system only.
    The Admin system is read-only for all payroll-related write actions.

    Original behaviour: Inserted an EmployeeOvertime record directly.
    This path was architecturally inconsistent — overtime initiated from Admin
    would bypass the employee_financial_actions ledger maintained by the Mini layer.

    To record overtime, use:
        POST /api/mini/barbers/{id}/financial-action   (type=OVERTIME, Cashier role)
    """

    return jsonify({
        "error": "Overtime entries must be created from the Mini system (Operational layer only)."
    }), 403


    from app.models.employee_overtime import EmployeeOvertime
    from datetime import datetime, date as date_obj
    
    try:
        data = request.get_json()
        amount = data.get('amount')
        reason = data.get('reason')
        date_str = data.get('date') # Expected: YYYY-MM-DD
        
        if not amount or not reason:
            return jsonify({"error": "amount and reason are required"}), 400
            
        employee = Employee.query.get_or_404(employee_id)
        # Security: Check branch scope
        resolve_branch_scope(g.current_user, employee.branch_id)
        
        # Parse date
        try:
            target_date = date_obj.fromisoformat(date_str) if date_str else get_cairo_date()
        except (ValueError, TypeError):
            target_date = get_cairo_date()
            
        new_overtime = EmployeeOvertime(
            employee_id=employee_id,
            amount=amount,
            reason=reason,
            date=target_date
        )
        
        db.session.add(new_overtime)
        db.session.commit()
        
        return jsonify(new_overtime.to_dict()), 201
        
    except Exception as e:
        db.session.rollback()
        print(f"Failed to add employee overtime: {e}")
        return jsonify({"error": "Failed to add overtime", "details": str(e)}), 500



@admin_bp.route('/employees/<int:employee_id>/daily-commission', methods=['GET'])
@require_admin
def get_employee_daily_commission(employee_id):
    """
    Get today's commission for an employee.
    Calculates from invoice_items for today only.
    """
    from app.models.invoice import Invoice, InvoiceItem
    from datetime import date as date_obj, datetime, time as dtime
    
    try:
        employee = Employee.query.get_or_404(employee_id)
        # Security: Check branch scope
        resolve_branch_scope(g.current_user, employee.branch_id)
        
        # Get today's date range
        today = date_obj.today()
        start = datetime.combine(today, dtime.min)
        end = datetime.combine(today, dtime.max)
        
        # Query invoice_items where employee is barber OR assistant for today
        items = InvoiceItem.query.join(Invoice).filter(
            (InvoiceItem.barber_id == employee_id) | 
            (InvoiceItem.assistant_id == employee_id),
            Invoice.created_at >= start,
            Invoice.created_at <= end
        ).all()
        
        # Calculate total commission
        total_commission = 0
        for item in items:
            is_barber = (item.barber_id == employee_id)
            pct = item.barber_commission_percent if is_barber else item.assistant_commission_percent
            share = (item.service_price * pct / 100.0)
            total_commission += share
        
        return jsonify({
            "employee_id": employee_id,
            "date": today.isoformat(),
            "total_commission": float(total_commission),
            "operations_count": len(items)
        }), 200
        
    except Exception as e:
        print(f"Failed to fetch daily commission: {e}")
        return jsonify({"error": "Failed to fetch daily commission", "details": str(e)}), 500


@admin_bp.route('/employees/<int:employee_id>/withdraw-commission', methods=['POST'])
@require_admin
def withdraw_employee_commission(employee_id):
    """
    [DISABLED — ARCHITECTURE ENFORCEMENT]

    Commission withdrawals must be performed from the Mini (Cashier) system only.
    The Admin system is read-only for all payroll-related write actions.

    Original behaviour: Recorded withdrawal as an Expense (category: 'سحب نسبة').
    This path was NOT dual-writing to employee_financial_actions, making it
    architecturally inconsistent. Disabled in favour of enforcing a single write source.

    To withdraw a barber's commission, use:
        POST /api/mini/barbers/{id}/withdraw-commission   (Cashier role)
    """
    return jsonify({
        "error": "Commission withdrawals must be performed from the Mini system (Cashier only)."
    }), 403




# ============================================================================
# CUSTOMER MANAGEMENT ENDPOINTS
# ============================================================================

@admin_bp.route('/customers', methods=['GET'])
@require_admin
def get_customers():
    """
    Get all customers formatted for the Admin Frontend.
    
    Response: [
      {
        "id": 1,
        "full_name": "Ahmed Ali",
        "phone": "01012345678",
        "last_visit": "2026-02-02",
        "visits_count": 5,
        "branch": "October 6",
        "total_spend": 1500.0,
        "is_active": True
      }
    ]
    """
    from flask import g
    
    try:
        # 1. Resolve Branch Scope
        requested_branch = request.args.get('branch_id')
        allowed_branch_ids = resolve_branch_scope(g.current_user, requested_branch)
        
        if not allowed_branch_ids:
            return jsonify([]), 200

        page = max(int(request.args.get('page', 1)), 1)
        per_page = min(max(int(request.args.get('per_page', 50)), 1), 100)
        search = normalize_customer_search(request.args.get('search'))
        starred_only = parse_starred_only(request.args.get('starred_only'))
        filter_conditions = build_customer_filter_conditions(
            allowed_branch_ids,
            search=search,
            starred_only=starred_only,
        )

        # 2. Build Query — eager-load branch and last_barber to avoid N+1
        from sqlalchemy.orm import joinedload as _jl
        stats_subquery = build_customer_stats_subquery(allowed_branch_ids)
        base_query = Customer.query.options(
            _jl(Customer.branch),
            _jl(Customer.last_barber)
        ).outerjoin(
            stats_subquery,
            stats_subquery.c.customer_id == Customer.id,
        ).filter(*filter_conditions)

        total_count = base_query.count()
        total_pages = max((total_count + per_page - 1) // per_page, 1) if total_count else 1
        customers = (
            base_query
            .order_by(*build_customer_recent_activity_ordering(stats_subquery))
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )

        customer_ids = [customer.id for customer in customers]

        # 3. Aggregate Visit Data
        # Only compute stats for the visible page to avoid scanning the full customer set.
        stats = []
        balance_map = {}
        if customer_ids:
            stats = db.session.query(
                stats_subquery.c.customer_id,
                stats_subquery.c.visits_count,
                stats_subquery.c.last_visit,
                stats_subquery.c.total_spend,
            ).filter(
                stats_subquery.c.customer_id.in_(customer_ids)
            ).all()
            balances = db.session.query(
                CustomerBalance.customer_id,
                CustomerBalance.branch_id,
                CustomerBalance.balance,
            ).filter(
                CustomerBalance.customer_id.in_(customer_ids),
                CustomerBalance.branch_id.in_(allowed_branch_ids),
            ).all()
            balance_map = {
                (row.customer_id, row.branch_id): float(row.balance or 0)
                for row in balances
            }

        stats_map = {s.customer_id: s for s in stats}

        # 4. Serialize
        results = []
        for customer in customers:
            c_stats = stats_map.get(customer.id)
            
            results.append({
                "id": customer.id,
                "full_name": customer.full_name or "Unknown",
                "phone": customer.phone,
                "last_visit": c_stats.last_visit.isoformat().split('T')[0] if c_stats and c_stats.last_visit else None,
                "visits_count": c_stats.visits_count if c_stats else 0,
                "total_spend": float(c_stats.total_spend) if c_stats and c_stats.total_spend else 0.0,
                "branch": customer.branch.name if customer.branch else "Unknown",
                "is_active": customer.is_active,
                "last_barber_name": customer.last_barber.full_name if customer.last_barber else None,
                "customer_since": to_iso_string(customer.created_at),
                "deposit_balance": balance_map.get((customer.id, customer.branch_id), 0),
            })

        return jsonify({
            "items": results,
            "total": total_count,
            "pages": total_pages,
            "current_page": page
        }), 200
        
    except Exception as e:
        print(f"Error fetching customers: {e}")
        return jsonify({"error": "Failed to fetch customers", "details": str(e)}), 500


@admin_bp.route('/customers/<int:customer_id>', methods=['GET'])
@require_admin
def get_customer_details(customer_id):
    try:
        allowed_branch_ids = resolve_branch_scope(g.current_user, 'all')

        customer = (
            Customer.query.options(
                joinedload(Customer.branch),
                joinedload(Customer.last_barber),
                joinedload(Customer.images),
            )
            .filter(
                Customer.id == customer_id,
                Customer.branch_id.in_(allowed_branch_ids),
            )
            .first()
        )

        if not customer:
            return jsonify({"error": "Customer not found"}), 404

        stats_subquery = build_customer_stats_subquery(allowed_branch_ids)
        customer_stats = db.session.query(
            stats_subquery.c.visits_count,
            stats_subquery.c.last_visit,
            stats_subquery.c.total_spend,
        ).filter(
            stats_subquery.c.customer_id == customer.id
        ).first()

        balance_row = db.session.query(
            CustomerBalance.balance,
        ).filter(
            CustomerBalance.customer_id == customer.id,
            CustomerBalance.branch_id == customer.branch_id,
        ).first()

        visits = db.session.query(
            Invoice.id,
            Invoice.invoice_date,
            Invoice.paid_at,
            Invoice.invoice_number,
            Invoice.total_amount,
            Invoice.discount_amount,
            Branch.name.label("branch_name"),
        ).join(
            Branch,
            Branch.id == Invoice.branch_id,
        ).filter(
            Invoice.customer_id == customer.id,
            Invoice.status == InvoiceStatus.PAID,
            Invoice.branch_id.in_(allowed_branch_ids),
        ).order_by(
            Invoice.invoice_date.desc().nullslast(),
            Invoice.paid_at.desc().nullslast(),
            Invoice.id.desc(),
        ).all()

        serialized_visits = []
        for visit in visits:
            visit_date = visit.invoice_date.isoformat() if visit.invoice_date else (
                visit.paid_at.date().isoformat() if visit.paid_at else None
            )
            net_total = float((visit.total_amount or 0) - (visit.discount_amount or 0))
            serialized_visits.append({
                "id": str(visit.id),
                "date": visit_date or "---",
                "branch": visit.branch_name or "Unknown",
                "employeeName": customer.last_barber.full_name if customer.last_barber else "",
                "services": [],
                "total": net_total,
                "invoice_number": str(visit.invoice_number) if visit.invoice_number is not None else None,
            })

        photo_url = None
        if getattr(customer, 'images', None):
            first_image = next((img for img in customer.images if getattr(img, 'image_url', None)), None)
            if first_image:
                image_path = first_image.image_url
                photo_url = image_path if image_path.startswith('http') else f"/uploads/{image_path.lstrip('/')}"

        return jsonify({
            "id": customer.id,
            "full_name": customer.full_name or "Unknown",
            "phone": customer.phone,
            "branch": customer.branch.name if customer.branch else "Unknown",
            "is_active": customer.is_active,
            "last_barber_name": customer.last_barber.full_name if customer.last_barber else None,
            "last_visit": customer_stats.last_visit.isoformat().split('T')[0] if customer_stats and customer_stats.last_visit else None,
            "visits_count": int(customer_stats.visits_count or 0) if customer_stats else 0,
            "total_spend": float(customer_stats.total_spend or 0) if customer_stats else 0.0,
            "customer_since": to_iso_string(customer.created_at),
            "deposit_balance": float(balance_row.balance or 0) if balance_row else 0,
            "photo_url": photo_url,
            "notes": None,
            "recent_visits": serialized_visits[:5],
            "all_visits": serialized_visits,
        }), 200
    except Exception as e:
        print(f"Error fetching customer details: {e}")
        return jsonify({"error": "Failed to fetch customer details", "details": str(e)}), 500


@admin_bp.route('/customers/export/xlsx', methods=['POST'])
@require_admin
def export_customers_xlsx():
    from flask import g

    try:
        payload = request.get_json(silent=True) or {}
        requested_branch = payload.get('branch_id')
        allowed_branch_ids = resolve_branch_scope(g.current_user, requested_branch)
        search = normalize_customer_search(payload.get('search'))
        starred_only = parse_starred_only(payload.get('starred_only'))
        column_ids = normalize_client_export_columns(payload.get('columns'))

        workbook_columns = [
            ExcelColumn(
                title=CLIENT_EXPORT_COLUMNS[column_id]["header"],
                width=CLIENT_EXPORT_COLUMNS[column_id]["width"],
            )
            for column_id in column_ids
        ]

        export_query = build_client_export_query(
            allowed_branch_ids,
            search=search,
            starred_only=starred_only,
        ).yield_per(500)

        workbook_file = build_xlsx_file(
            sheet_name="Clients",
            columns=workbook_columns,
            rows=build_client_export_rows(export_query, column_ids),
        )

        filename = build_clients_export_filename(
            requested_branch=requested_branch,
            allowed_branch_ids=allowed_branch_ids,
            search=search,
            starred_only=starred_only,
            exported_on=get_cairo_date(),
        )

        return send_file(
            workbook_file,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name=filename,
        )

    except Exception as e:
        print(f"Error exporting customers: {e}")
        return jsonify({"error": "Failed to export customers", "details": str(e)}), 500


@admin_bp.route('/invoices/export', methods=['POST'])
@require_admin
def export_invoices_xlsx():
    from flask import g

    try:
        payload = request.get_json(silent=True) or {}
        mode = normalize_invoice_export_mode(payload.get('mode'))
        date_from, date_to = parse_invoice_export_date_range(payload)
        filters = normalize_invoice_export_filters(payload)

        requested_branch = filters.branch_id
        allowed_branch_ids = resolve_branch_scope(g.current_user, requested_branch)
        if not allowed_branch_ids:
            return jsonify({"error": "No accessible branches for export."}), 403

        column_ids = normalize_invoice_export_columns(payload.get('columns'))
        export_row_count = count_invoice_export_rows(
            allowed_branch_ids,
            filters=filters,
            date_from=date_from,
            date_to=date_to,
        )

        if export_row_count > INVOICE_EXPORT_MAX_ROWS:
            return jsonify({
                "error": "Export exceeds the safe row limit.",
                "max_rows": INVOICE_EXPORT_MAX_ROWS,
                "matching_rows": export_row_count,
            }), 422

        workbook_file = build_xlsx_file(
            sheet_name="Invoices",
            columns=build_invoice_export_workbook_columns(column_ids),
            rows=build_invoice_export_rows(
                allowed_branch_ids,
                filters=filters,
                date_from=date_from,
                date_to=date_to,
                column_ids=column_ids,
            ),
        )

        response = send_file(
            workbook_file,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name=build_invoices_export_filename(
                requested_branch=requested_branch,
                allowed_branch_ids=allowed_branch_ids,
                date_from=date_from,
                date_to=date_to,
                exported_on=get_cairo_date(),
            ),
        )
        response.call_on_close(workbook_file.close)
        return response

    except ValueError as e:
        return jsonify({"error": str(e), "mode": "invoice_summary"}), 400
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error exporting invoices: {e}")
        return jsonify({"error": "Failed to export invoices", "details": str(e)}), 500


# ============================================================================
# INVOICE MANAGEMENT ENDPOINTS (Admin)
# ============================================================================

@admin_bp.route('/invoices', methods=['GET'])
@require_admin
def get_invoices():
    """
    List invoices with advanced filters and pagination.
    
    Query Params:
    - branch_id: Resolve scope
    - business_day_id: Filter by business day / journal number
    - cashier_id: Filter by cashier
    - payment_method: Filter by payment method
    - search: Filter by number or client name
    - type: "جميع الفواتير", "عادية", "بخصم", "معلقة"
    - date: Single date string (YYYY-MM-DD)
    - date_from/date_to: Range
    - page: Page number
    - per_page: Page size
    """
    from datetime import date as date_obj
    from sqlalchemy import or_
    from app.models.customer import Customer
    
    try:
        page, per_page = _parse_admin_bounded_pagination(default_per_page=50, max_per_page=100)

        # Status mapping for frontend
        STATUS_MAP = {
            InvoiceStatus.PAID: "مدفوعة",
            InvoiceStatus.DRAFT: "معلقة",
            InvoiceStatus.DRAFT_COMMITTED: "مسودة غير مكتملة",
            InvoiceStatus.CANCELED: "ملغاة"
        }

        # 1. Resolve Branch Scope
        requested_branch = request.args.get('branch_id')
        allowed_branch_ids = resolve_branch_scope(g.current_user, requested_branch)
        
        if not allowed_branch_ids:
            return jsonify({
                "items": [],
                "total": 0,
                "pages": 0,
                "current_page": 1,
                "per_page": per_page
            }), 200

        # 2. Build Query with Eager Loading to avoid N+1 queries
        from sqlalchemy.orm import joinedload, contains_eager
        from app.models.invoice import InvoiceItem
        # Eager-load related objects to avoid N+1: customer, cashier, branch, and invoice_items.barber
        query = Invoice.query.outerjoin(Customer)\
            .options(
                contains_eager(Invoice.customer),
                joinedload(Invoice.cashier),
                joinedload(Invoice.branch),
                joinedload(Invoice.invoice_items).joinedload(InvoiceItem.barber)
            )\
            .filter(Invoice.branch_id.in_(allowed_branch_ids))
        
        # Search: Number or Customer Name
        search = request.args.get('search', '').strip()
        if search:
            # Try to match invoice number (if numeric) or customer name
            search_filters = [
                Customer.full_name.ilike(f"%{search}%"),
                Invoice.customer_name.ilike(f"%{search}%")
            ]
            if search.isdigit():
                search_filters.append(Invoice.invoice_number == int(search))
            query = query.filter(or_(*search_filters))

        # Type Filtering (Mapping Arabic Tabs to logic)
        invoice_type = request.args.get('type', 'جميع الفواتير')
        if invoice_type == 'عادية':
            query = query.filter(Invoice.status == InvoiceStatus.PAID, Invoice.discount_amount == 0)
        elif invoice_type == 'بخصم':
            query = query.filter(Invoice.status == InvoiceStatus.PAID, Invoice.discount_amount > 0)
        elif invoice_type == 'معلقة':
            query = query.filter(visible_pending_invoice_condition())
        else: # جميع الفواتير
            query = query.filter(default_visible_invoice_condition())

        # Filter by Cashier
        cashier_id = request.args.get('cashier_id')
        if cashier_id:
            query = query.filter(Invoice.cashier_id == int(cashier_id))

        # Filter by Business Day / Journal Number
        business_day_id = request.args.get('business_day_id')
        if business_day_id:
            try:
                query = query.filter(Invoice.business_day_id == int(business_day_id))
            except ValueError:
                pass
            
        # Filter by Payment Method
        pm_str = request.args.get('payment_method')
        if pm_str:
            try:
                # Map Arabic values if passed, or use enum directly
                PM_REVERSE_MAP = {"كاش": "CASH", "فيزا": "VISA", "إنستا باي": "INSTAPAY"}
                pm_enum_str = PM_REVERSE_MAP.get(pm_str, pm_str).upper()
                pm_enum = PaymentMethod(pm_enum_str)
                query = query.filter(Invoice.payment_method == pm_enum)
            except ValueError:
                pass

        # Finalized rows keep invoice_date semantics. Draft-family rows have no
        # invoice_date, so their Cairo calendar day comes from created_at.
        date_str = request.args.get('date')
        if date_str and date_str != 'null' and date_str != '':
            try:
                # Accept YYYY-MM-DD only; ignore time component if present
                target_date = date_obj.fromisoformat(date_str[:10])
                query = query.filter(invoice_activity_date_condition(
                    date_from=target_date,
                    date_to=target_date,
                ))
            except ValueError:
                pass

        date_from = request.args.get('date_from')
        if date_from:
            try:
                df = date_obj.fromisoformat(date_from[:10])
                query = query.filter(invoice_activity_date_condition(date_from=df))
            except ValueError:
                pass

        date_to = request.args.get('date_to')
        if date_to:
            try:
                dt = date_obj.fromisoformat(date_to[:10])
                query = query.filter(invoice_activity_date_condition(date_to=dt))
            except ValueError:
                pass

        # 3. Calculate Summary for the WHOLE filtered set (ignoring pagination)
        from sqlalchemy import func
        # Use NET invoice total (after discount) instead of gross total_amount
        summary_query = query.with_entities(
            func.count(Invoice.id).label('total_count'),
            func.sum(
                Invoice.total_amount - func.coalesce(Invoice.discount_amount, 0)
            ).label('total_sales')
        ).filter(Invoice.status == InvoiceStatus.PAID).first()

        # Drafts count for summary card (include DRAFT_COMMITTED)
        pending_count = query.filter(visible_pending_invoice_condition()).count()

        total_sales = float(summary_query.total_sales or 0.0)
        paid_count = int(summary_query.total_count or 0)
        # The "paid invoices" KPI remains financial: drafts never inflate it.
        total_count = paid_count

        # 4. Pagination & Ordering
        pagination = query.order_by(
            invoice_activity_sort_expression().desc().nullslast(),
            Invoice.invoice_date.desc().nullslast(),
            Invoice.invoice_number.desc().nullslast(),
            Invoice.id.desc()
        ).paginate(
            page=page, per_page=per_page, error_out=False
        )
        
        # 5. Serialize
        results = []
        for inv in pagination.items:
            # Determine display type
            display_type = "عادية"
            if inv.status in (InvoiceStatus.DRAFT, InvoiceStatus.DRAFT_COMMITTED):
                display_type = "معلقة"
            elif inv.discount_amount > 0:
                display_type = "بخصم"

            barber_preview = _serialize_invoice_list_barbers(inv.invoice_items)

        # Batch load promo redemptions for the current page of invoices
        from app.models.promo_code import PromoRedemption
        invoice_ids = [inv.id for inv in pagination.items]
        emptied_draft_evidence = load_emptied_draft_evidence(pagination.items)
        redemption_map = {}
        if invoice_ids:
            redemptions = PromoRedemption.query.filter(PromoRedemption.invoice_id.in_(invoice_ids)).all()
            for r in redemptions:
                redemption_map[r.invoice_id] = {
                    "code": r.code_snapshot,
                    "discount_type": r.discount_type_snapshot.value,
                    "configured_value": str(r.discount_value_snapshot),
                    "eligible_subtotal": float(r.eligible_subtotal),
                    "discount_amount": float(r.promo_discount_amount),
                    "version": r.promo_version_snapshot,
                }

        results = []
        for inv in pagination.items:
            display_type = "عادية"
            if inv.status in (InvoiceStatus.DRAFT, InvoiceStatus.DRAFT_COMMITTED):
                display_type = "معلقة"
            elif inv.discount_amount > 0:
                display_type = "بخصم"

            barber_preview = _serialize_invoice_list_barbers(inv.invoice_items)
            promo_info = redemption_map.get(inv.id)
            draft_evidence = emptied_draft_evidence.get(inv.id)

            results.append({
                "id": inv.id,
                "number": str(inv.invoice_number) if inv.invoice_number else "---",
                "business_day_id": inv.business_day_id,
                "client": (inv.customer.full_name if inv.customer else (inv.customer_name or "عميل مفاجئ")),
                "cashier": inv.cashier.full_name if inv.cashier else "Unknown",
                **barber_preview,
                "branch": inv.branch.name if inv.branch else "Unknown",
                "method": inv.payment_method.value if inv.payment_method else "غير محدد",
                "status": STATUS_MAP.get(inv.status, "معلقة"),
                "status_code": inv.status.value,
                "draft_state": (
                    draft_evidence["draft_state"]
                    if draft_evidence
                    else ("ACTIVE_DRAFT" if inv.status == InvoiceStatus.DRAFT else None)
                ),
                "last_gross_before_emptying": (
                    draft_evidence["last_gross_before_emptying"] if draft_evidence else None
                ),
                "type": display_type,
                "amount": inv.total_amount,
                "discountAmount": inv.discount_amount,
                "deposit_settlement": serialize_settlement(inv),
                "promo": promo_info,
                "promo_code": promo_info["code"] if promo_info else None,
                "customer_name": inv.customer_name,
                "customer_phone": inv.customer_phone,
                "date": to_iso_string(inv.created_at)
            })
            
        return jsonify({
            "items": results,
            "summary": {
                "total_sales": total_sales,
                "total_count": total_count,
                "paid_count": paid_count,
                "pending_count": pending_count
            },
            "total": pagination.total,
            "pages": pagination.pages,
            "current_page": page,
            "per_page": per_page
        }), 200
        
    except Exception as e:
        print(f"Error fetching invoices: {e}")
        return jsonify({"error": "Failed to fetch invoices", "details": str(e)}), 500


@admin_bp.route('/invoices/<int:invoice_id>', methods=['GET'])
@require_admin
def get_invoice_details(invoice_id):
    """
    Get single invoice details with items.
    """
    try:
        # Status mapping for frontend
        STATUS_MAP = {
            InvoiceStatus.PAID: "مدفوعة",
            InvoiceStatus.DRAFT: "معلقة",
            InvoiceStatus.DRAFT_COMMITTED: "مسودة غير مكتملة",
            InvoiceStatus.CANCELED: "ملغاة"
        }

        invoice = Invoice.query.get_or_404(invoice_id)
        
        # Enforce branch isolation
        if not enforce_branch_isolation(invoice.branch_id):
            return jsonify({"error": "Unauthorized access to this invoice"}), 403

        emptied_draft_evidence = load_emptied_draft_evidence([invoice])
        draft_evidence = emptied_draft_evidence.get(invoice.id)
            
        # Serialize with items — handle both SERVICE_ITEM and PRODUCT_ITEM
        items = []
        for item in invoice.invoice_items:
            barber_share = (item.service_price * item.barber_commission_percent / 100.0)
            assistant_share = (item.service_price * item.assistant_commission_percent / 100.0)

            if getattr(item, 'item_type', 'SERVICE_ITEM') == 'PRODUCT_ITEM':
                # Product row: no barber, no commission, show product name
                items.append({
                    "id": str(item.id),
                    "item_type": "PRODUCT_ITEM",
                    "product_id": item.product_id,
                    "product_name": item.product.name if item.product else "منتج",
                    "service_id": None,
                    "category_id": None,
                    "serviceName": item.product.name if item.product else "منتج",
                    "price": item.service_price,
                    "quantity": item.quantity,
                    "employeeName": item.assigned_employee.full_name if item.assigned_employee else None,
                    "assigned_employee_id": item.assigned_employee_id,
                    "assigned_employee_name": item.assigned_employee.full_name if item.assigned_employee else None,
                    "barber_commission_percent": 0.0,
                    "assistant_commission_percent": 0.0,
                    "commission": 0.0,
                    "share": 0.0,
                    "sales_commission_percent": float(item.sales_commission_percent or 0),
                    "sales_commission_amount": float(item.sales_commission_amount or 0),
                    "participants": []
                })
            else:
                # Service row: standard serialization with barber/assistant
                items.append({
                    "id": str(item.id),
                    "item_type": "SERVICE_ITEM",
                    "service_id": str(item.service_id),
                    "category_id": str(item.service.category_id) if item.service else None,
                    "serviceName": item.service.name if item.service else "Unknown",
                    "product_id": None,
                    "product_name": None,
                    "price": item.service_price,
                    "quantity": item.quantity,
                    "employeeName": item.barber.full_name if item.barber else "Unknown",
                    "assigned_employee_id": None,
                    "assigned_employee_name": None,
                    "barber_commission_percent": item.barber_commission_percent,
                    "assistant_commission_percent": item.assistant_commission_percent,
                    "commission": item.barber_commission_percent + item.assistant_commission_percent,
                    "share": barber_share,
                    "sales_commission_percent": 0.0,
                    "sales_commission_amount": 0.0,
                    "participants": [
                        {
                            "id": f"b-{item.barber_id}",
                            "employeeName": item.barber.full_name if item.barber else "Unknown",
                            "role": "BARBER",
                            "commission": item.barber_commission_percent,
                            "share": barber_share,
                            "isPayable": True
                        }
                    ] + ([{
                            "id": f"a-{item.assistant_id}",
                            "employeeName": item.assistant.full_name if item.assistant else "Unknown",
                            "role": "ASSISTANT",
                            "commission": item.assistant_commission_percent,
                            "share": assistant_share,
                            "isPayable": item.assistant_commission_percent > 0
                        }] if item.assistant_id else [])
                })
            
        from app.models.promo_code import PromoRedemption
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

        result = {
            "id": str(invoice.id),
            "number": str(invoice.invoice_number) if invoice.invoice_number else "---",
            "business_day_id": invoice.business_day_id,
            "branch": invoice.branch.name if invoice.branch else "Unknown",
            "cashier": invoice.cashier.full_name if invoice.cashier else "Unknown",
            "client": (invoice.customer.full_name if invoice.customer else (invoice.customer_name or "عميل مفاجئ")),
            "amount": invoice.total_amount,
            "discountAmount": invoice.discount_amount,
            "netAmount": invoice.total_amount - invoice.discount_amount,
            "deposit_settlement": serialize_settlement(invoice),
            "promo": promo_data,
            "promo_code": promo_data["code"] if promo_data else None,
            "method": invoice.payment_method.value if invoice.payment_method else "غير محدد",
            "status": STATUS_MAP.get(invoice.status, "معلقة"),
            "status_code": invoice.status.value,
            "draft_state": (
                draft_evidence["draft_state"]
                if draft_evidence
                else ("ACTIVE_DRAFT" if invoice.status == InvoiceStatus.DRAFT else None)
            ),
            "last_gross_before_emptying": (
                draft_evidence["last_gross_before_emptying"] if draft_evidence else None
            ),
            "type": "بخصم" if invoice.discount_amount > 0 else ("معلقة" if invoice.status == InvoiceStatus.DRAFT else "عادية"),
            "date": to_iso_string(invoice.created_at),
            "items": items,
            "payments": [
                {
                    "method": p.method.value,
                    "amount": float(p.amount),
                    "entered_amount": float(p.entered_amount if p.entered_amount is not None else p.amount)
                }
                for p in invoice.invoice_payments
            ] if invoice.invoice_payments else [],
            "paymentDetails": {
                "method": invoice.payment_method.value if invoice.payment_method else None,
                "paidAt": to_iso_string(invoice.paid_at) if invoice.paid_at else None,
                "confirmedBy": invoice.confirmed_by_employee.full_name if hasattr(invoice, 'confirmed_by_employee') and invoice.confirmed_by_employee else None
            },
            "customer_name": invoice.customer_name,
            "customer_phone": invoice.customer_phone
        }
        
        return jsonify(result), 200
        
    except Exception as e:
        print(f"Error fetching invoice details: {e}")
        return jsonify({"error": "Failed to fetch invoice details", "details": str(e)}), 500


@admin_bp.route('/invoices/<int:invoice_id>/events', methods=['GET'])
@require_admin
def get_invoice_audit_events(invoice_id):
    """Return the read-only, presentation-safe event timeline for one invoice."""
    timeline = build_invoice_audit_timeline(invoice_id)
    if timeline is None:
        return jsonify({"error": "Invoice not found"}), 404

    if not enforce_branch_isolation(timeline["branch_id"]):
        return jsonify({"error": "Unauthorized access to this invoice"}), 403

    response = {key: value for key, value in timeline.items() if key != "branch_id"}
    return jsonify(response), 200



@admin_bp.route('/invoices/<int:invoice_id>', methods=['DELETE'])
@require_admin
def delete_invoice(invoice_id):
    """
    Delete an invoice and its items.
    
    Access: ADMIN only.
    """
    try:
        invoice = Invoice.query.get_or_404(invoice_id)
        
        # Enforce branch isolation
        if not enforce_branch_isolation(invoice.branch_id):
            return jsonify({"error": "Unauthorized access to this invoice"}), 403

        if invoice.status in (InvoiceStatus.PAID, InvoiceStatus.CANCELED):
            return jsonify({
                "error": "Paid or canceled invoices cannot be deleted because they are financial records."
            }), 409

        gross_amount = Decimal(str(invoice.total_amount or 0)).quantize(Decimal("0.01"))
        append_invoice_event(
            invoice_id=invoice.id,
            event_type=InvoiceAuditEventType.INVOICE_DELETED,
            actor=AuditActorContext.from_admin_request(),
            gross_before=gross_amount,
            gross_after=None,
            payload={
                "status": invoice.status.value,
                "invoice_number": invoice.invoice_number,
                "item_count": len(invoice.invoice_items),
                "gross_amount": gross_amount,
            },
        )
            
        # Delete invoice (cascade="all, delete-orphan" handles items)
        db.session.delete(invoice)
        db.session.commit()
        
        print(f"INVOICE DELETED: ID={invoice_id}")
        return jsonify({"status": "success", "message": "Invoice deleted successfully"}), 200
        
    except Exception as e:
        print(f"INVOICE DELETE ERROR: {e}")
        db.session.rollback()
        return jsonify({"error": "Failed to delete invoice", "details": str(e)}), 500


@admin_bp.route('/employees/<int:employee_id>/report', methods=['GET'])
@require_admin
def get_employee_report(employee_id):
    """
    Generate comprehensive employee report data.
    Aggregates data from Invoices, Attendance, Overtime, Expenses (Deductions/Advances).
    """
    from app.models.employee import Employee
    from app.models.invoice import Invoice, InvoiceItem, InvoiceStatus
    from app.models.attendance import Attendance
    from app.models.employee_overtime import EmployeeOvertime
    from app.models.expense import Expense
    from app.models.expense_category import ExpenseCategory
    from app.models.service import Service, ServiceCategory # Fixed import
    from app.models.branch import Branch
    from sqlalchemy import func, and_, or_
    from datetime import datetime, date, timedelta
    import traceback
    
    try:
        employee = Employee.query.get(employee_id)
        if not employee:
            return jsonify({"success": False, "message": "Employee not found"}), 404
        
        # 1. Date Range Handling
        start_date_str = request.args.get('start_date')
        end_date_str = request.args.get('end_date')
        
        today = get_cairo_date()
        try:
            if start_date_str:
                start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
            else:
                start_date = today.replace(day=1) # Default to 1st of current month
                
            if end_date_str:
                end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
            else:
                end_date = today
        except ValueError:
            return jsonify({"success": False, "message": "Invalid date format"}), 400
            
        # Convert to datetime for potential timestamp comparisons (end of day)
        start_dt = datetime.combine(start_date, datetime.min.time())
        end_dt = datetime.combine(end_date, datetime.max.time())
        
        # 2. SECTIONS CALCULATIONS
        
        # A. Services & Financials (Invoice Items)
        items_query = db.session.query(
            InvoiceItem, Service, Invoice
        ).join(Service, Service.id == InvoiceItem.service_id)\
         .join(Invoice, Invoice.id == InvoiceItem.invoice_id)\
         .filter(
            Invoice.status == InvoiceStatus.PAID,
            Invoice.created_at >= start_dt,
            Invoice.created_at <= end_dt,
            or_(
                InvoiceItem.barber_id == employee.id,
                InvoiceItem.assistant_id == employee.id
            )
        )
        
        invoice_items = items_query.all()
        
        total_services_count = 0
        total_revenue = 0.0
        total_commission = 0.0
        
        services_breakdown = {} # { "Type": { count, revenue, avg } }
        
        for item, service, invoice in invoice_items:
            # Determine role and share
            is_barber = (item.barber_id == employee.id)
            share_percent = item.barber_commission_percent if is_barber else item.assistant_commission_percent
            item_share = (float(item.service_price) * share_percent) / 100.0 if item.service_price and share_percent else 0.0
            
            item_revenue = float(item.service_price) if is_barber and item.service_price else 0.0
            
            total_services_count += 1
            total_revenue += item_revenue
            total_commission += item_share
            
            # Grouping - FIX: Use service.category.name instead of service.type.value
            s_type = service.category.name if service.category else "Other"
            
            if s_type not in services_breakdown:
                services_breakdown[s_type] = {'count': 0, 'revenue': 0.0, 'commission': 0.0}
            
            services_breakdown[s_type]['count'] += 1
            services_breakdown[s_type]['revenue'] += item_revenue
            services_breakdown[s_type]['commission'] += item_share

        # Format breakdown list
        services_list = []
        for stype, data in services_breakdown.items():
            avg_val = (data['revenue'] / data['count']) if data['count'] > 0 else 0
            services_list.append({
                "type": stype,
                "count": data['count'],
                "revenue": data['revenue'],
                "average_value": avg_val
            })
            
        # B. Branch Performance
        branch_stats = {}
        for item, service, invoice in invoice_items:
            b_name = invoice.branch.name if invoice.branch else "Unknown"
            if b_name not in branch_stats:
                branch_stats[b_name] = {'count': 0, 'revenue': 0.0}
            
            branch_stats[b_name]['count'] += 1
            # Revenue attribution logic
            item_revenue = float(item.service_price) if item.service_price and item.barber_id == employee.id else 0.0
            branch_stats[b_name]['revenue'] += item_revenue
            
        branch_list = [{"branch": k, "count": v['count'], "revenue": v['revenue']} for k,v in branch_stats.items()]
        
        # C. Attendance Summary
        attendance_records = Attendance.query.filter(
            Attendance.employee_id == employee.id,
            Attendance.date >= start_date,
            Attendance.date <= end_date
        ).all()
        
        days_worked = 0
        total_minutes_worked = 0
        late_days = 0 
        
        for att in attendance_records:
            if att.status and att.status.value in ['PRESENT', 'LEFT']:
                days_worked += 1
                if att.check_in_time and att.check_out_time:
                    diff = att.check_out_time - att.check_in_time
                    total_minutes_worked += int(diff.total_seconds() / 60)
        
        total_hours_worked = round(total_minutes_worked / 60, 2)
        
        # D. Financials
        # Stage 3: Read from employee_financial_actions via employee_id FK.
        # No ILIKE. date range uses created_at (datetime) aligned with start_dt / end_dt.
        from app.models.employee_financial_action import EmployeeFinancialAction, EmployeeActionType

        # 1. Deductions
        deductions = EmployeeFinancialAction.query.filter(
            EmployeeFinancialAction.employee_id == employee.id,
            EmployeeFinancialAction.action_type == EmployeeActionType.DEDUCTION,
            EmployeeFinancialAction.created_at >= start_dt,
            EmployeeFinancialAction.created_at <= end_dt
        ).all()
        total_deduction = sum(float(d.amount) for d in deductions if d.amount)

        # 2. Advances (Loans)
        advances = EmployeeFinancialAction.query.filter(
            EmployeeFinancialAction.employee_id == employee.id,
            EmployeeFinancialAction.action_type == EmployeeActionType.ADVANCE,
            EmployeeFinancialAction.created_at >= start_dt,
            EmployeeFinancialAction.created_at <= end_dt
        ).all()
        total_advances = sum(float(a.amount) for a in advances if a.amount)

        # 3. Overtime — unchanged: reads from employee_overtime via real employee_id FK
        overtimes = EmployeeOvertime.query.filter(
            EmployeeOvertime.employee_id == employee.id,
            EmployeeOvertime.date >= start_date,
            EmployeeOvertime.date <= end_date
        ).all()
        total_overtime = sum(float(ot.amount) for ot in overtimes if ot.amount)
        
        # 4. Final Net
        base_salary = float(employee.base_salary) if employee.base_salary else 0.0
        final_net = total_commission + total_overtime - total_deduction - total_advances
        
        result_data = {
            "meta": {
                "generated_at": get_utc_now().isoformat(),
                "period": {
                    "start": start_date.isoformat(),
                    "end": end_date.isoformat()
                },
                "employee": {
                    "name": employee.full_name,
                    "role": employee.employee_type.value if employee.employee_type else "Unknown",
                    "branch": employee.branch.name if employee.branch else "Unknown",
                    "id": employee.id
                }
            },
            "summary": {
                "total_services": total_services_count,
                "total_revenue": total_revenue,
                "total_commission": total_commission,
                "net_pay_variable": final_net,
                "total_hours": total_hours_worked
            },
            "services_breakdown": services_list,
            "branch_performance": branch_list,
            "attendance": {
                "days_worked": days_worked,
                "total_hours": total_hours_worked,
                "late_days": late_days,
                "absence_days": (end_date - start_date).days + 1 - days_worked
            },
            "financials": {
                "base_salary": base_salary,
                "total_commission": total_commission,
                "total_overtime": total_overtime,
                "total_deductions": total_deduction,
                "total_loans": total_advances,
                "final_net_with_salary": final_net + base_salary
            }
        }
        
        # Check for PDF format request
        if request.args.get('format') == 'pdf':
            try:
                from app.utils.pdf_generator import generate_employee_pdf
                from flask import send_file
                
                pdf_buffer = generate_employee_pdf(result_data)
                return send_file(
                    pdf_buffer,
                    mimetype='application/pdf',
                    as_attachment=False,
                    download_name=f"employee_report_{employee.id}.pdf"
                )
            except ImportError:
                print("ReportLab not found, falling back to JSON")
                return jsonify({"success": False, "message": "PDF generation library missing"}), 500
            except Exception as e:
                print(f"PDF Generation Error: {e}")
                traceback.print_exc()
                return jsonify({"success": False, "message": f"PDF generation failed: {str(e)}"}), 500
        
        return jsonify({"success": True, "data": result_data}), 200
        
    except Exception as e:
        print(f"Report Generation Error: {e}")
        traceback.print_exc() # Log full stack trace
        return jsonify({"success": False, "message": f"Report generation failed: {str(e)}"}), 500

@admin_bp.route('/employees/<int:employee_id>/report/print', methods=['GET'])
@require_admin
def get_employee_report_print(employee_id):
    """
    Render HTML print view for employee report.
    Uses exact same calculation logic as the JSON/PDF endpoint.
    """
    from app.models.employee import Employee
    from app.models.invoice import Invoice, InvoiceItem, InvoiceStatus
    from app.models.attendance import Attendance
    from app.models.employee_overtime import EmployeeOvertime
    from app.models.expense import Expense
    from app.models.expense_category import ExpenseCategory
    from app.models.service import Service, ServiceCategory
    from app.models.branch import Branch
    from sqlalchemy import func, and_, or_
    from datetime import datetime, date, timedelta
    from flask import render_template
    
    try:
        employee = Employee.query.get(employee_id)
        if not employee:
            return "Employee not found", 404
        
        # 1. Date Range
        start_date_str = request.args.get('start_date')
        end_date_str = request.args.get('end_date')
        
        today = get_cairo_date()
        if start_date_str:
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
        else:
            start_date = today.replace(day=1)
            
        if end_date_str:
            end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
        else:
            end_date = today
            
        start_dt = datetime.combine(start_date, datetime.min.time())
        end_dt = datetime.combine(end_date, datetime.max.time())
        
        # 2. Logic (Duplicated for Safety as per instructions)
        items_query = db.session.query(
            InvoiceItem, Service, Invoice
        ).join(Service, Service.id == InvoiceItem.service_id)\
         .join(Invoice, Invoice.id == InvoiceItem.invoice_id)\
         .filter(
            Invoice.status == InvoiceStatus.PAID,
            Invoice.created_at >= start_dt,
            Invoice.created_at <= end_dt,
            or_(
                InvoiceItem.barber_id == employee.id,
                InvoiceItem.assistant_id == employee.id
            )
        )
        
        invoice_items = items_query.all()
        
        total_services_count = 0
        total_revenue = 0.0
        total_commission = 0.0
        services_breakdown = {} 
        
        for item, service, invoice in invoice_items:
            is_barber = (item.barber_id == employee.id)
            share_percent = item.barber_commission_percent if is_barber else item.assistant_commission_percent
            item_share = (float(item.service_price) * share_percent) / 100.0 if item.service_price and share_percent else 0.0
            item_revenue = float(item.service_price) if is_barber and item.service_price else 0.0
            
            total_services_count += 1
            total_revenue += item_revenue
            total_commission += item_share
            
            s_type = service.category.name if service.category else "Other"
            if s_type not in services_breakdown:
                services_breakdown[s_type] = {'count': 0, 'revenue': 0.0, 'commission': 0.0}
            
            services_breakdown[s_type]['count'] += 1
            services_breakdown[s_type]['revenue'] += item_revenue
            services_breakdown[s_type]['commission'] += item_share

        services_list = []
        for stype, data in services_breakdown.items():
            avg_val = (data['revenue'] / data['count']) if data['count'] > 0 else 0
            services_list.append({
                "type": stype,
                "count": data['count'],
                "revenue": data['revenue'],
                "average_value": avg_val
            })
            
        # Attendance
        attendance_records = Attendance.query.filter(
            Attendance.employee_id == employee.id,
            Attendance.date >= start_date,
            Attendance.date <= end_date
        ).all()
        
        days_worked = 0
        total_minutes_worked = 0
        late_days = 0 
        
        for att in attendance_records:
            if att.status and att.status.value in ['PRESENT', 'LEFT']:
                days_worked += 1
                if att.check_in_time and att.check_out_time:
                    diff = att.check_out_time - att.check_in_time
                    total_minutes_worked += int(diff.total_seconds() / 60)
        
        total_hours_worked = round(total_minutes_worked / 60, 2)
        
        # Financials
        # Stage 3: Read from employee_financial_actions via employee_id FK.
        # No ILIKE. date range uses created_at (datetime) aligned with start_dt / end_dt.
        from app.models.employee_financial_action import EmployeeFinancialAction, EmployeeActionType

        total_deduction = 0.0
        deductions = EmployeeFinancialAction.query.filter(
            EmployeeFinancialAction.employee_id == employee.id,
            EmployeeFinancialAction.action_type == EmployeeActionType.DEDUCTION,
            EmployeeFinancialAction.created_at >= start_dt,
            EmployeeFinancialAction.created_at <= end_dt
        ).all()
        total_deduction = sum(float(d.amount) for d in deductions if d.amount)

        total_advances = 0.0
        advances = EmployeeFinancialAction.query.filter(
            EmployeeFinancialAction.employee_id == employee.id,
            EmployeeFinancialAction.action_type == EmployeeActionType.ADVANCE,
            EmployeeFinancialAction.created_at >= start_dt,
            EmployeeFinancialAction.created_at <= end_dt
        ).all()
        total_advances = sum(float(a.amount) for a in advances if a.amount)

        # Overtime — unchanged: reads from employee_overtime via real employee_id FK
        overtimes = EmployeeOvertime.query.filter(
            EmployeeOvertime.employee_id == employee.id,
            EmployeeOvertime.date >= start_date,
            EmployeeOvertime.date <= end_date
        ).all()
        total_overtime = sum(float(ot.amount) for ot in overtimes if ot.amount)

        base_salary = float(employee.base_salary) if employee.base_salary else 0.0
        final_net = total_commission + total_overtime - total_deduction - total_advances
        
        result_data = {
            "meta": {
                "generated_at": get_utc_now().isoformat(),
                "period": {
                    "start": start_date.isoformat(),
                    "end": end_date.isoformat()
                },
                "employee": {
                    "name": employee.full_name,
                    "role": employee.employee_type.value if employee.employee_type else "Unknown",
                    "branch": employee.branch.name if employee.branch else "Unknown",
                    "id": employee.id
                }
            },
            "summary": {
                "total_services": total_services_count,
                "total_revenue": total_revenue,
                "total_commission": total_commission,
                "net_pay_variable": final_net,
                "total_hours": total_hours_worked
            },
            "services_breakdown": services_list,
            "attendance": {
                "days_worked": days_worked,
                "total_hours": total_hours_worked,
                "late_days": late_days,
                "absence_days": (end_date - start_date).days + 1 - days_worked
            },
            "financials": {
                "base_salary": base_salary,
                "total_commission": total_commission,
                "total_overtime": total_overtime,
                "total_deductions": total_deduction,
                "total_loans": total_advances,
                "final_net_with_salary": final_net + base_salary
            }
        }
        
        return render_template('report_print.html', report=result_data)
        
    except Exception as e:
        print(f"Print Report Error: {e}")
        return f"Failed to generate report: {str(e)}", 500


# ============================================================================
# DASHBOARD V2 ENDPOINTS
# ============================================================================

@admin_bp.route('/dashboard-v2/overview', methods=['GET'])
@require_admin
def dashboard_v2_overview():
    """
    Dashboard V2 Overview Endpoint
    Returns executive summary, branch stats, employee performance, and operational metrics.
    Defaults to current month performance.
    
    Query Params:
    - start_date (YYYY-MM-DD)
    - end_date (YYYY-MM-DD)
    - branch_id (int, optional)
    """
    try:
        from app.models.invoice import Invoice, InvoiceItem, InvoiceStatus
        from app.models.attendance import Attendance
        from app.models.employee import Employee
        from app.models.branch import Branch
        from app.services.financial_service import (
            calculate_revenue, calculate_commissions, calculate_expenses,
            calculate_invoice_count, calculate_services_count,
            calculate_revenue_by_branch, calculate_commissions_by_branch,
            calculate_expenses_by_branch, cairo_day_window
        )
        from sqlalchemy import func
        from datetime import datetime, timedelta

        # 1. Parse params
        start_date_str = request.args.get('start_date')
        end_date_str   = request.args.get('end_date')
        branch_id_str  = request.args.get('branch_id')

        selected_branch_id = None
        if branch_id_str and branch_id_str.lower() not in ('all', 'null', ''):
            try:
                selected_branch_id = int(branch_id_str)
            except ValueError:
                pass

        today = get_cairo_date()
        try:
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date() if start_date_str else today.replace(day=1)
            end_date   = datetime.strptime(end_date_str,   '%Y-%m-%d').date() if end_date_str   else today
        except ValueError:
            return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400


        # Previous period window (for growth rate calculation)
        period_days = (end_date - start_date).days + 1
        lp_end   = start_date - timedelta(days=1)
        lp_start = lp_end - timedelta(days=period_days - 1)

        # --- EXECUTIVE SUMMARY (unified service, Cairo-safe UTC windows) ---
        total_revenue     = calculate_revenue(start_date, end_date, selected_branch_id)
        total_commissions = calculate_commissions(start_date, end_date, selected_branch_id)
        total_expenses    = calculate_expenses(start_date, end_date, selected_branch_id)
        net_profit        = (total_revenue - total_commissions) - total_expenses
        invoice_count     = calculate_invoice_count(start_date, end_date, selected_branch_id)
        services_count    = calculate_services_count(start_date, end_date, selected_branch_id)

        rev_last = calculate_revenue(lp_start, lp_end, selected_branch_id)
        if rev_last > 0:
            growth_rate = ((total_revenue / rev_last) - 1) * 100

        elif total_revenue > 0:
            growth_rate = 100.0
        else:
            growth_rate = 0.0

        executive = {
            "total_revenue":       total_revenue,
            "total_expenses":      total_expenses,
            "net_profit":          net_profit,
            "invoice_count":       invoice_count,
            "services_count":      services_count,
            "growth_rate_percent": round(growth_rate, 2)
        }

        # --- BRANCHES (single GROUP BY query per metric, commissions included) ---
        branches_q = Branch.query.filter_by(is_active=True)
        if selected_branch_id:
            branches_q = branches_q.filter(Branch.id == selected_branch_id)
        all_branches = branches_q.all()
        branch_ids   = [b.id for b in all_branches]

        rev_map  = calculate_revenue_by_branch(start_date, end_date, branch_ids)
        comm_map = calculate_commissions_by_branch(start_date, end_date, branch_ids)
        exp_map  = calculate_expenses_by_branch(start_date, end_date, branch_ids)

        branches_list = []
        for b in all_branches:
            rev_data  = rev_map.get(b.id, {"revenue": 0.0, "invoice_count": 0})
            rev_val   = rev_data["revenue"]
            comm_val  = comm_map.get(b.id, 0.0)
            exp_val   = exp_map.get(b.id, 0.0)
            branches_list.append({
                "branch_id":     b.id,
                "branch_name":   b.name,
                "revenue":       rev_val,
                "expenses":      exp_val,
                "net_profit":    (rev_val - comm_val) - exp_val,
                "invoice_count": rev_data["invoice_count"]
            })

        # --- EMPLOYEES ---
        emp_query = Employee.query.filter_by(is_active=True, is_deleted=False)
        if selected_branch_id:
            emp_query = emp_query.filter(Employee.branch_id == selected_branch_id)
        active_employees = emp_query.all()

        emp_performance = {emp.id: {
            "employee_id":       emp.id,
            "name":              emp.full_name,
            "revenue_generated": 0.0,
            "services_count":    0,
            "hours_worked":      0.0
        } for emp in active_employees}

        start_utc, end_utc = cairo_day_window(start_date, end_date)

        barber_stats_q = db.session.query(
            InvoiceItem.barber_id,
            func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label('rev'),
            func.count(InvoiceItem.id).label('cnt')
        ).join(Invoice).filter(
            Invoice.status == InvoiceStatus.PAID,
            Invoice.paid_at >= start_utc,
            Invoice.paid_at <= end_utc
        )
        if selected_branch_id:
            barber_stats_q = barber_stats_q.filter(Invoice.branch_id == selected_branch_id)
        for bid, rev, cnt in barber_stats_q.group_by(InvoiceItem.barber_id).all():
            if bid in emp_performance:
                emp_performance[bid]["revenue_generated"] += float(rev or 0.0)
                emp_performance[bid]["services_count"]    += int(cnt or 0)

        assistant_stats_q = db.session.query(
            InvoiceItem.assistant_id,
            func.count(InvoiceItem.id).label('cnt')
        ).join(Invoice).filter(
            InvoiceItem.assistant_id.isnot(None),
            Invoice.status == InvoiceStatus.PAID,
            Invoice.paid_at >= start_utc,
            Invoice.paid_at <= end_utc
        )
        if selected_branch_id:
            assistant_stats_q = assistant_stats_q.filter(Invoice.branch_id == selected_branch_id)
        for aid, cnt in assistant_stats_q.group_by(InvoiceItem.assistant_id).all():
            if aid in emp_performance:
                emp_performance[aid]["services_count"] += int(cnt or 0)

        att_query = Attendance.query.filter(
            Attendance.date >= start_date,
            Attendance.date <= end_date,
            Attendance.check_out_time.isnot(None),
            Attendance.check_in_time.isnot(None)
        )
        if selected_branch_id:
            att_query = att_query.filter(Attendance.branch_id == selected_branch_id)

        total_work_seconds = 0
        for att in att_query.all():
            if att.employee_id in emp_performance:
                seconds = (att.check_out_time - att.check_in_time).total_seconds()
                emp_performance[att.employee_id]["hours_worked"] += seconds / 3600.0
                total_work_seconds += seconds

        total_work_hours = total_work_seconds / 3600.0
        employees_list = sorted(
            [{"employee_id": d["employee_id"], "name": d["name"],
              "revenue_generated": round(d["revenue_generated"], 2),
              "services_count":    d["services_count"],
              "hours_worked":      round(d["hours_worked"], 2)}
             for d in emp_performance.values()],
            key=lambda x: x["revenue_generated"], reverse=True
        )

        operational = {
            "total_work_hours":  round(total_work_hours, 2),
            "revenue_per_hour":  round(total_revenue / total_work_hours, 2) if total_work_hours > 0 else 0.0
        }

        return jsonify({
            "executive":   executive,
            "branches":    branches_list,
            "employees":   employees_list,
            "operational": operational
        }), 200

    except Exception as e:
        print(f"DASHBOARD V2 ERROR: {e}")
        import traceback; traceback.print_exc()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@admin_bp.route('/analytics/revenue', methods=['GET'])
@require_admin
def get_revenue_analytics():
    """
    Get daily revenue and net profit analytics for a specified range.
    Net Profit = (Revenue - Commissions) - Expenses
    
    Query Params:
    - range: '7d', '30d', '90d' (default: '30d')
    - branch_id: Optional filter
    """
    try:
        from app.services.financial_service import calculate_daily_revenue
        from datetime import timedelta

        range_str     = request.args.get('range', '30d')
        branch_id_str = request.args.get('branch_id')

        today = get_cairo_date()
        days_count = {'7d': 7, '30d': 30, '90d': 90}.get(range_str, 30)
        start_date = today - timedelta(days=days_count - 1)

        selected_branch_id = None
        if branch_id_str and branch_id_str.lower() not in ('all', 'null', ''):
            try:
                selected_branch_id = int(branch_id_str)
            except ValueError:
                pass

        # Unified daily data from financial service (3 queries, Cairo-safe)
        daily = calculate_daily_revenue(start_date, today, selected_branch_id)

        # 5-day rolling-average forecast
        recent  = daily[-7:] if len(daily) >= 7 else daily
        avg_rev = sum(d['revenue']    for d in recent) / len(recent) if recent else 0.0
        avg_net = sum(d['net_profit'] for d in recent) / len(recent) if recent else 0.0

        result = [{"date": d["date"], "revenue": d["revenue"],
                   "net_profit": d["net_profit"], "isForecast": False}
                  for d in daily]

        for i in range(1, 6):
            future = today + timedelta(days=i)
            result.append({"date": future.isoformat(),
                           "revenue": round(avg_rev, 2),
                           "net_profit": round(avg_net, 2),
                           "isForecast": True})

        return jsonify(result), 200

    except Exception as e:
        print(f"Error in revenue analytics: {e}")
        import traceback; traceback.print_exc()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@admin_bp.route('/analytics/branch-performance', methods=['GET'])
@require_admin
def get_branch_performance_analytics():
    """
    Get detailed branch performance metrics.
    Accepts start_date / end_date (YYYY-MM-DD) OR range ('7d','30d','90d').
    Features: Revenue, Net Profit, Growth, Score, Rank, Trend (7d).
    """
    try:
        from app.models.invoice import Invoice, InvoiceStatus
        from app.models.branch import Branch
        from app.services.financial_service import (
            calculate_revenue_by_branch, calculate_commissions_by_branch,
            calculate_expenses_by_branch, cairo_day_window
        )
        from sqlalchemy import func
        from datetime import datetime, timedelta

        # Accept both start_date/end_date (from Dashboard filter) and range string
        start_date_str = request.args.get('start_date')
        end_date_str   = request.args.get('end_date')
        range_str      = request.args.get('range', '30d')

        today = get_cairo_date()

        if start_date_str and end_date_str:
            try:
                start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
                end_date   = datetime.strptime(end_date_str,   '%Y-%m-%d').date()
            except ValueError:
                return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400
        else:
            days_count = {'7d': 7, '30d': 30, '90d': 90}.get(range_str, 30)
            start_date = today - timedelta(days=days_count - 1)
            end_date   = today

        period_days = (end_date - start_date).days + 1
        prev_end    = start_date - timedelta(days=1)
        prev_start  = prev_end - timedelta(days=period_days - 1)

        # All active branches
        branches   = Branch.query.filter_by(is_active=True).all()
        branch_ids = [b.id for b in branches]

        # --- Current period: 3 grouped queries (eliminates N+1) ---
        rev_map      = calculate_revenue_by_branch(start_date, end_date, branch_ids)
        comm_map     = calculate_commissions_by_branch(start_date, end_date, branch_ids)
        exp_map      = calculate_expenses_by_branch(start_date, end_date, branch_ids)

        # --- Previous period revenue for growth (1 grouped query) ---
        prev_rev_map = calculate_revenue_by_branch(prev_start, prev_end, branch_ids)

        # --- Last 7-day trend: single grouped query across all branches ---
        trend_start = today - timedelta(days=6)
        trend_start_utc, trend_end_utc = cairo_day_window(trend_start, today)

        trend_rows = db.session.query(
            Invoice.branch_id,
            func.date(func.timezone('Africa/Cairo', Invoice.paid_at)).label('day'),
            func.sum(Invoice.total_amount).label('rev')
        ).filter(
            Invoice.status == InvoiceStatus.PAID,
            Invoice.paid_at >= trend_start_utc,
            Invoice.paid_at <= trend_end_utc,
            Invoice.branch_id.in_(branch_ids)
        ).group_by(
            Invoice.branch_id,
            func.date(func.timezone('Africa/Cairo', Invoice.paid_at))
        ).all()

        trend_map: dict = {}
        for row in trend_rows:
            trend_map.setdefault(row.branch_id, {})[str(row.day)] = float(row.rev or 0.0)

        # --- Assemble per-branch result ---
        result = []
        for b in branches:
            b_id = b.id

            rev_data   = rev_map.get(b_id, {"revenue": 0.0, "invoice_count": 0})
            revenue    = rev_data["revenue"]
            comm       = comm_map.get(b_id, 0.0)
            expenses   = exp_map.get(b_id, 0.0)
            net_profit = (revenue - comm) - expenses

            prev_rev = prev_rev_map.get(b_id, {}).get("revenue", 0.0)
            if prev_rev > 0:
                growth = ((revenue - prev_rev) / prev_rev) * 100
            elif revenue > 0:
                growth = 100.0
            else:
                growth = 0.0

            b_trend_map = trend_map.get(b_id, {})
            trend_data  = [
                b_trend_map.get((trend_start + timedelta(days=i)).isoformat(), 0.0)
                for i in range(7)
            ]

            margin_percent = (net_profit / revenue * 100) if revenue > 0 else 0
            raw_score      = 40 + min(40, margin_percent) + min(20, max(0, growth))
            final_score    = int(min(99, max(0, raw_score)))

            result.append({
                "branch_id":   b_id,
                "branch_name": b.name,
                "revenue":     revenue,
                "net_profit":  net_profit,
                "growth":      round(growth, 1),
                "score":       final_score,
                "trend":       trend_data
            })

        result.sort(key=lambda x: x['revenue'], reverse=True)
        for idx, item in enumerate(result):
            item['rank'] = idx + 1

        return jsonify(result), 200

    except Exception as e:
        print(f"Error in branch analytics: {e}")
        import traceback; traceback.print_exc()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


# ============================================================================
# TREASURY MONITORING ENDPOINTS
# ============================================================================

@admin_bp.route('/business-days', methods=['GET'])
@require_admin
def get_business_days():
    try:
        results = fetch_admin_business_day_rows(
            g.current_user,
            branch_id_param=request.args.get('branch_id'),
            start_date_str=request.args.get('start_date'),
            end_date_str=request.args.get('end_date'),
            status=request.args.get('status'),
        )
        return jsonify(results), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@admin_bp.route('/business-days/export/xlsx', methods=['GET'])
@require_admin
def export_business_days_xlsx():
    try:
        requested_branch = request.args.get('branch_id')
        start_date_str = request.args.get('start_date')
        end_date_str = request.args.get('end_date')
        status = normalize_business_day_status(request.args.get('status'))

        allowed_branch_ids = resolve_branch_scope(g.current_user, requested_branch)

        rows = fetch_admin_business_day_rows(
            g.current_user,
            branch_id_param=requested_branch,
            start_date_str=start_date_str,
            end_date_str=end_date_str,
            status=status,
        )

        workbook_columns = [
            ExcelColumn(title=column["header"], width=column["width"])
            for column in TREASURY_BUSINESS_DAY_EXPORT_COLUMNS
        ]
        workbook_file = build_xlsx_file(
            sheet_name="Treasury Business Days",
            columns=workbook_columns,
            rows=build_treasury_business_day_export_rows(rows),
        )
        filename = build_treasury_business_day_export_filename(
            requested_branch=requested_branch,
            allowed_branch_ids=allowed_branch_ids,
            start_date_str=start_date_str,
            end_date_str=end_date_str,
            status=status,
            exported_on=get_cairo_date(),
        )

        return send_file(
            workbook_file,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name=filename,
        )
    except Exception as e:
        print(f"Error exporting business days: {e}")
        return jsonify({"error": "Failed to export business days", "details": str(e)}), 500


# ============================================================================
# BRANCH SECURITY & DEVICE BINDING (Admin Only)
# ============================================================================

def _parse_admin_device_profile(device_type_raw: Optional[str], access_mode_raw: Optional[str]):
    try:
        device_type = MiniDeviceType((device_type_raw or "").strip().upper())
        access_mode = MiniAccessMode((access_mode_raw or "").strip().upper())
    except ValueError:
        raise MiniDeviceSecurityError(
            error="INVALID_DEVICE_PROFILE",
            details="نوع أو صلاحية الجهاز غير صحيحة.",
            status_code=400,
        )

    return device_type, access_mode


@admin_bp.route('/branches/<int:branch_id>/registered-devices/<int:registered_device_id>/revoke', methods=['POST'])
@require_admin
@require_role(UserRole.SUPER_ADMIN)
def revoke_branch_registered_device(branch_id, registered_device_id):
    try:
        branch = Branch.query.get(branch_id)
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404

        device = revoke_registered_device(
            branch,
            registered_device_id,
            revoked_by_user_id=g.current_user.id,
        )
        return jsonify({
            "status": "success",
            "message": "تم إلغاء الجهاز بنجاح",
            "device_id": device.id,
        }), 200
    except MiniDeviceSecurityError as device_error:
        payload = {"error": device_error.error}
        if device_error.details:
            payload["details"] = device_error.details
        if device_error.payload:
            payload.update(device_error.payload)
        return jsonify(payload), device_error.status_code
    except Exception as e:
        db.session.rollback()
        print(f"[SECURITY ERROR] Failed to revoke registered device: {e}")
        return jsonify({"error": "فشل في إلغاء الجهاز", "details": str(e)}), 500


@admin_bp.route('/branches/<int:branch_id>/registered-devices/<int:registered_device_id>/re-pair', methods=['POST'])
@require_admin
@require_role(UserRole.SUPER_ADMIN)
def authorize_branch_registered_device_repair(branch_id, registered_device_id):
    try:
        branch = db.session.get(Branch, branch_id)
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404

        device = authorize_registered_device_repair(
            branch,
            registered_device_id,
            authorized_by_user_id=g.current_user.id,
        )
        return jsonify({
            "status": "success",
            "message": "تم فتح إعادة الربط الآمن للجهاز. اطلب من الجهاز إعادة تسجيل الدخول خلال المهلة.",
            "device_id": device.id,
            "repair_expires_at": device.repair_expires_at.isoformat()
            if device.repair_expires_at
            else None,
            "device_security": build_branch_device_security_snapshot(branch),
        }), 200
    except MiniDeviceSecurityError as device_error:
        payload = {"error": device_error.error}
        if device_error.details:
            payload["details"] = device_error.details
        if device_error.payload:
            payload.update(device_error.payload)
        return jsonify(payload), device_error.status_code
    except Exception as error:
        db.session.rollback()
        print(f"[SECURITY ERROR] Failed to authorize device re-pair: {error}")
        return jsonify({"error": "فشل في بدء إعادة ربط الجهاز"}), 500


@admin_bp.route('/branches/<int:branch_id>/device-enrollments/<int:enrollment_id>/approve', methods=['POST'])
@require_admin
@require_role(UserRole.SUPER_ADMIN)
def approve_branch_device_enrollment(branch_id, enrollment_id):
    try:
        branch = Branch.query.get(branch_id)
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404

        data = request.get_json() or {}
        pairing_code = (data.get("pairing_code") or "").strip().upper()
        device_label = (data.get("device_label") or "").strip()
        device_type, access_mode = _parse_admin_device_profile(
            data.get("device_type"),
            data.get("access_mode"),
        )

        if not pairing_code:
            return jsonify({"error": "PAIRING_CODE_REQUIRED", "details": "رمز تسجيل الجهاز مطلوب."}), 400
        if not device_label:
            return jsonify({"error": "DEVICE_LABEL_REQUIRED", "details": "اسم الجهاز مطلوب."}), 400

        device = approve_device_enrollment(
            branch,
            enrollment_id,
            pairing_code=pairing_code,
            device_label=device_label,
            device_type=device_type,
            access_mode=access_mode,
            approved_by_user_id=g.current_user.id,
        )

        return jsonify({
            "status": "success",
            "message": "تم اعتماد الجهاز بنجاح",
            "device_context": build_branch_device_security_snapshot(branch),
            "approved_device_id": getattr(device, "id", None),
        }), 200
    except MiniDeviceSecurityError as device_error:
        payload = {"error": device_error.error}
        if device_error.details:
            payload["details"] = device_error.details
        if device_error.payload:
            payload.update(device_error.payload)
        return jsonify(payload), device_error.status_code
    except Exception as e:
        db.session.rollback()
        print(f"[SECURITY ERROR] Failed to approve device enrollment: {e}")
        return jsonify({"error": "فشل في اعتماد الجهاز", "details": str(e)}), 500


@admin_bp.route('/branches/<int:branch_id>/device-enrollments/<int:enrollment_id>/reject', methods=['POST'])
@require_admin
@require_role(UserRole.SUPER_ADMIN)
def reject_branch_device_enrollment(branch_id, enrollment_id):
    try:
        branch = Branch.query.get(branch_id)
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404

        reject_device_enrollment(branch, enrollment_id)
        return jsonify({
            "status": "success",
            "message": "تم رفض طلب تسجيل الجهاز",
            "device_context": build_branch_device_security_snapshot(branch),
        }), 200
    except MiniDeviceSecurityError as device_error:
        payload = {"error": device_error.error}
        if device_error.details:
            payload["details"] = device_error.details
        if device_error.payload:
            payload.update(device_error.payload)
        return jsonify(payload), device_error.status_code
    except Exception as e:
        db.session.rollback()
        print(f"[SECURITY ERROR] Failed to reject device enrollment: {e}")
        return jsonify({"error": "فشل في رفض طلب الجهاز", "details": str(e)}), 500

@admin_bp.route('/branches/<int:branch_id>/reset-device', methods=['POST'])
@require_admin
@require_role(UserRole.SUPER_ADMIN)
def reset_branch_device(branch_id):
    """
    Revoke all active Mini devices for a branch and clear the legacy binding.
    Any replacement device must go through the explicit enrollment approval flow.
    Access: SUPER_ADMIN only.
    """
    try:
        branch = Branch.query.get(branch_id)
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404
            
        old_device = branch.authorized_device_id
        
        revoked_count = revoke_branch_registered_devices(
            branch,
            revoked_by_user_id=g.current_user.id,
            clear_legacy_binding=True,
        )
        
        print(f"[SECURITY] Device binding RESET for branch {branch.id} ({branch.name}) by admin {g.current_user.id}")
        
        return jsonify({
            "status": "success",
            "message": f"تم إلغاء جميع أجهزة Mini النشطة للفرع {branch.name} بنجاح",
            "previous_device": old_device,
            "revoked_registered_devices": revoked_count,
        }), 200
        
    except Exception as e:
        db.session.rollback()
        print(f"[SECURITY ERROR] Failed to reset device binding: {e}")
        return jsonify({"error": "فشل في إعادة ضبط الجهاز", "details": str(e)}), 500


# ============================================================================
# POLLING NOTIFICATIONS ENDPOINT
# Replaces Socket.IO — safe, read-only, no side effects
# ============================================================================

@admin_bp.route('/notifications/recent', methods=['GET'])
@require_admin
def get_recent_notifications():
    """
    Safe polling endpoint — replaces Socket.IO real-time notifications.

    Query params:
      - since_id (int, optional): return only invoices with id > since_id
      - limit    (int, optional): max results, capped at 20 (default 20)

    Response:
      { "notifications": [ { id, type, invoice_id, invoice_number,
                              branch_id, branch_name, total, payment_method,
                              created_at }, ... ] }

    Guarantees:
      - Read-only (no DB writes)
      - No side effects
      - Single indexed query (Invoice.id IS the primary key index)
      - Hard cap of 20 rows — negligible performance impact
    """
    try:
        since_id = request.args.get('since_id', 0, type=int)
        limit = min(request.args.get('limit', 20, type=int), 20)

        query = (
            Invoice.query
            .filter(Invoice.id > since_id)
            .order_by(Invoice.id.desc())
            .limit(limit)
        )

        invoices = query.all()

        notifications = []
        for inv in invoices:
            # Determine payment method label
            if hasattr(inv, 'invoice_payments') and inv.invoice_payments:
                if len(inv.invoice_payments) > 1:
                    payment_label = "متعدد"
                else:
                    m = inv.invoice_payments[0].method
                    raw = m.value if hasattr(m, 'value') else str(m)
                    payment_label = {"CASH": "كاش", "VISA": "فيزا", "INSTAPAY": "انستا"}.get(raw, raw)
            elif inv.payment_method:
                raw = inv.payment_method.value if hasattr(inv.payment_method, 'value') else str(inv.payment_method)
                payment_label = {"CASH": "كاش", "VISA": "فيزا", "INSTAPAY": "انستا"}.get(raw, raw)
            else:
                payment_label = "غير معروف"

            notifications.append({
                "id": inv.id,
                "type": "invoice_created",
                "invoice_id": inv.id,
                "invoice_number": inv.invoice_number,
                "branch_id": inv.branch_id,
                "branch_name": inv.branch.name if inv.branch else "Unknown",
                "total": float(inv.total_amount),
                "payment_method": payment_label,
                "has_discount": float(inv.discount_amount) > 0,
                "discount_amount": float(inv.discount_amount),
                "client_name": inv.customer_name or "عميل عام",
                "created_at": inv.created_at.isoformat() + "Z" if inv.created_at else None,
            })

        return jsonify({"notifications": notifications}), 200

    except Exception as e:
        return jsonify({"error": "Failed to fetch notifications", "details": str(e)}), 500


# ============================================================================
# CLOSING REPORT ENDPOINT
# ============================================================================

@admin_bp.route('/business-days/<int:business_day_id>/closing-report', methods=['GET'])
@require_admin
def get_closing_report(business_day_id):
    """
    Admin view of a business day's closing report.
    Shows same data as mini's close-day modal, regardless of OPEN/CLOSED status.

    For OPEN days: shows expected values only.
    For CLOSED days: shows expected + actual values + reconciliation data.
    """
    from app.models.business_day import BusinessDay, BusinessDayStatus
    from app.models.expense import Expense
    from app.models.expense_category import ExpenseCategory
    from decimal import Decimal

    try:
        # ── 1. Fetch BusinessDay ──────────────────────────────────────────────
        business_day = BusinessDay.query.get(business_day_id)
        if not business_day:
            return jsonify({"error": "Business day not found"}), 404

        # Verify admin has access to this branch
        allowed_branch_ids = resolve_branch_scope(g.current_user, None)
        if business_day.branch_id not in allowed_branch_ids:
            return jsonify({"error": "Access denied"}), 403

        collection_snapshot = build_business_day_collection_snapshot(business_day_id)
        invoice_collections = collection_snapshot["invoice_collections"]
        deposit_collections = collection_snapshot["appointment_deposit_collections"]
        combined_collections = collection_snapshot["combined"]

        cash_in     = combined_collections["cash_in"]
        visa_in     = combined_collections["visa_in"]
        instapay_in = combined_collections["instapay_in"]
        visa_collected     = combined_collections["visa_collected"]
        instapay_collected = combined_collections["instapay_collected"]

        # ── 3. Cash OUT — cash-event expenses ─────────────────────────────────
        raw_cash_out = (
            db.session.query(func.sum(Expense.amount))
            .filter(
                Expense.business_day_id == business_day_id,
                Expense.is_cash_event   == True,        # noqa: E712
            )
            .scalar()
        )
        cash_out = Decimal(str(raw_cash_out)) if raw_cash_out is not None else Decimal('0.00')

        # ── 4. Expense breakdown by category ──────────────────────────────────
        def _sum_by_category(code):
            """Sum expenses where is_cash_event=TRUE and category.code matches"""
            amt = (
                db.session.query(func.sum(Expense.amount))
                .join(ExpenseCategory, ExpenseCategory.id == Expense.expense_category_id)
                .filter(
                    Expense.business_day_id == business_day_id,
                    Expense.is_cash_event   == True,        # noqa: E712
                    ExpenseCategory.code    == code,
                )
                .scalar()
            )
            return Decimal(str(amt)) if amt is not None else Decimal('0.00')

        advance_total      = _sum_by_category('ADVANCE')
        overtime_total     = _sum_by_category('OVERTIME')
        commission_total   = _sum_by_category('DAILY_PERCENTAGE')
        manual_expenses    = cash_out - advance_total - overtime_total - commission_total

        # ── 5. Theoretical balance ────────────────────────────────────────────
        opening_bal     = Decimal(str(business_day.opening_balance or '0.00'))
        theoretical_bal = opening_bal + cash_in - cash_out
        daily_income    = cash_in + visa_collected + instapay_collected

        # ── 6. Prepare response ───────────────────────────────────────────────
        response = {
            "business_day_id":     business_day.id,
            "status":              business_day.status.value,
            "opened_at":           business_day.opened_at.isoformat(),
            "closed_at":           business_day.closed_at.isoformat() if business_day.closed_at else None,
            "opening_balance":     float(opening_bal),
            
            # ── Income breakdown ──
            "cash_in":             float(cash_in),
            "visa_in":             float(visa_in),
            "instapay_in":         float(instapay_in),
            "visa_collected":      float(visa_collected),
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
            "manual_expenses_total": float(manual_expenses),
            
            # ── Register balance reconciliation ──
            "theoretical_balance": float(theoretical_bal),
        }

        # For CLOSED days only: add actual and reconciliation data
        if business_day.status == BusinessDayStatus.CLOSED:
            actual_balance = Decimal(str(business_day.closing_balance or '0.00'))
            variance       = Decimal(str(business_day.variance or '0.00'))

            response.update({
                "actual_balance":  float(actual_balance),
                "variance":        float(variance),
                # Per-method expected values (for display, not actual counts)
                "expected_cash":   float(cash_in - cash_out),  # net after expenses
                "expected_visa":   float(visa_collected),
                "expected_instapay": float(instapay_collected),
            })

        return jsonify(response), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to fetch closing report", "details": str(e)}), 500

# ============================================================================
# PRODUCT CATALOG ENDPOINTS (Admin)
# ============================================================================

def _normalize_required_text(value):
    if value is None:
        return ""
    return str(value).strip()

def _normalize_optional_text(value):
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None

def _get_main_warehouse_branch():
    main_branches = (
        Branch.query
        .filter_by(is_active=True, is_main_warehouse=True)
        .order_by(Branch.id.asc())
        .all()
    )
    if len(main_branches) == 1:
        return main_branches[0]
    if len(main_branches) > 1:
        raise ValueError("يوجد أكثر من مخزن رئيسي. يرجى مراجعة إعدادات الفروع.")
    return None


def _require_main_warehouse_branch():
    main_branch = _get_main_warehouse_branch()
    if not main_branch:
        raise ValueError("لم يتم إعداد المخزن الرئيسي بعد. يرجى مراجعة إعدادات الفروع.")
    return main_branch

def _get_or_create_product_branch_stock(product_id, branch_id):
    from app.models.product import ProductBranchStock

    pair = (int(product_id), int(branch_id))
    return lock_product_stocks([pair], create_missing=[pair])[pair]



def _resolve_stock_movement_created_by_employee_id():
    current_user = getattr(g, 'current_user', None)
    if not current_user:
        return None

    if hasattr(g, 'stock_movement_created_by_employee_id'):
        return g.stock_movement_created_by_employee_id

    from app.models.employee import Employee

    employee = db.session.get(Employee, current_user.id)
    resolved_employee_id = employee.id if employee else None
    g.stock_movement_created_by_employee_id = resolved_employee_id
    return resolved_employee_id


def _lock_product_branch_stock(product_id, branch_id):
    from app.models.product import ProductBranchStock

    pair = (int(product_id), int(branch_id))
    return lock_product_stocks([pair])[pair]


def _generate_stock_shipment_ref():
    return f"SHP-{get_utc_now().strftime('%Y%m%d-%H%M%S%f')[:-3]}"

def _generate_supply_receive_ref():
    return f"SUP-{get_utc_now().strftime('%Y%m%d-%H%M%S%f')[:-3]}"

def _generate_supplier_return_ref():
    return f"SUP-RET-{get_utc_now().strftime('%Y%m%d-%H%M%S%f')[:-3]}"

def _build_shipment_movement_note(shipment_ref, destination_branch_name, note=None):
    base_note = f"[{shipment_ref}] شحنة إلى {destination_branch_name}"
    if note:
        return f"{base_note} - {note}"
    return base_note

def _build_direct_supplier_return_note(return_ref, reason, note=None):
    base_note = f"[{return_ref}] مرتجع مباشر للمورد من المخزن الرئيسي"
    if reason:
        base_note = f"{base_note} - السبب: {reason}"
    if note:
        return f"{base_note} - {note}"
    return base_note

def _extract_shipment_ref(notes):
    if not notes:
        return None
    match = re.match(r'^\[(SHP-[^\]]+)\]', notes.strip())
    if not match:
        return None
    return match.group(1)

def _extract_bulk_transfer_ref(notes):
    if not notes:
        return None
    match = re.match(r'^\[(BTR-[^\]]+)\]', notes.strip())
    if not match:
        return None
    return match.group(1)

def _extract_supply_receive_ref(notes):
    if not notes:
        return None
    match = re.match(r'^\[(SUP-[^\]]+)\]', notes.strip())
    if not match:
        return None
    return match.group(1)

def _extract_direct_supplier_return_ref(notes):
    if not notes:
        return None
    match = re.match(r'^\[(SUP-RET-[^\]]+)\]', notes.strip())
    if not match:
        return None
    return match.group(1)

def _extract_reference_user_note(notes):
    if not notes:
        return None
    parts = notes.split(' - ', 1)
    if len(parts) == 2:
        return parts[1].strip() or None
    return None


RECENT_INVENTORY_ACTIVITY_DEFAULT_LIMIT = 18
RECENT_INVENTORY_ACTIVITY_MAX_LIMIT = 50
RECENT_INVENTORY_ACTIVITY_SHIPMENT_SOURCE_LIMIT = 50
RECENT_INVENTORY_ACTIVITY_RETURN_SOURCE_LIMIT = 50
RECENT_INVENTORY_ACTIVITY_MOVEMENT_SOURCE_LIMIT = 250


def _parse_admin_recent_activity_limit(
    default_limit=RECENT_INVENTORY_ACTIVITY_DEFAULT_LIMIT,
    max_limit=RECENT_INVENTORY_ACTIVITY_MAX_LIMIT,
):
    raw_limit = request.args.get('limit', default_limit)
    try:
        parsed_limit = int(raw_limit)
    except (TypeError, ValueError):
        parsed_limit = default_limit
    return min(max(parsed_limit, 1), max_limit)


def _serialize_recent_activity_timestamp(value):
    return value.isoformat() if value else None


def _sort_recent_inventory_activity_rows(rows, limit=None):
    ordered_rows = sorted(
        rows,
        key=lambda row: ((row.get("created_at") or ""), row["activity_key"]),
        reverse=True,
    )
    if limit is None:
        return ordered_rows
    return ordered_rows[:limit]


def _build_recent_shipment_activity_stub(candidate):
    activity_time = candidate.get("cancelled_at") or candidate.get("received_at") or candidate.get("created_at")
    return {
        "activity_key": f"shipment-{candidate['id']}-{candidate['status']}",
        "created_at": _serialize_recent_activity_timestamp(activity_time),
        "_source_type": "shipment",
        "_source_id": candidate["id"],
    }


def _build_recent_return_request_activity_stubs(candidate):
    rows = [{
        "activity_key": f"return-{candidate['id']}-created",
        "created_at": _serialize_recent_activity_timestamp(candidate.get("created_at")),
        "_source_type": "return_request",
        "_source_id": candidate["id"],
    }]

    resolved_at = candidate.get("resolved_at")
    if candidate.get("status") == 'RETURNED_TO_MAIN' and resolved_at:
        rows.append({
            "activity_key": f"return-{candidate['id']}-main",
            "created_at": _serialize_recent_activity_timestamp(resolved_at),
            "_source_type": "return_request",
            "_source_id": candidate["id"],
        })
    elif candidate.get("status") == 'RETURNED_TO_SUPPLIER' and resolved_at:
        rows.append({
            "activity_key": f"return-{candidate['id']}-supplier",
            "created_at": _serialize_recent_activity_timestamp(resolved_at),
            "_source_type": "return_request",
            "_source_id": candidate["id"],
        })
    elif candidate.get("status") == 'REJECTED' and resolved_at:
        rows.append({
            "activity_key": f"return-{candidate['id']}-rejected",
            "created_at": _serialize_recent_activity_timestamp(resolved_at),
            "_source_type": "return_request",
            "_source_id": candidate["id"],
        })

    return rows


def _fetch_recent_shipment_activity_candidates(allowed_branch_ids):
    query = (
        db.session.query(
            StockShipment.id.label("id"),
            StockShipment.status.label("status"),
            StockShipment.created_at.label("created_at"),
            StockShipment.received_at.label("received_at"),
            StockShipment.cancelled_at.label("cancelled_at"),
        )
        .order_by(func.coalesce(StockShipment.cancelled_at, StockShipment.received_at, StockShipment.created_at).desc(), StockShipment.id.desc())
    )

    if allowed_branch_ids:
        query = query.filter(StockShipment.destination_branch_id.in_(allowed_branch_ids))

    return [dict(row._mapping) for row in query.limit(RECENT_INVENTORY_ACTIVITY_SHIPMENT_SOURCE_LIMIT).all()]


def _fetch_recent_return_request_activity_candidates(allowed_branch_ids):
    query = (
        db.session.query(
            StockReturnRequest.id.label("id"),
            StockReturnRequest.status.label("status"),
            StockReturnRequest.created_at.label("created_at"),
            StockReturnRequest.resolved_at.label("resolved_at"),
        )
        .order_by(StockReturnRequest.created_at.desc(), StockReturnRequest.id.desc())
    )

    if allowed_branch_ids:
        query = query.filter(StockReturnRequest.branch_id.in_(allowed_branch_ids))

    return [dict(row._mapping) for row in query.limit(RECENT_INVENTORY_ACTIVITY_RETURN_SOURCE_LIMIT).all()]


def _fetch_recent_inventory_movement_candidates(allowed_branch_ids):
    from app.models.product import Product, StockMovement, StockMovementType

    query = (
        db.session.query(
            StockMovement.id.label("id"),
            StockMovement.product_id.label("product_id"),
            StockMovement.branch_id.label("branch_id"),
            StockMovement.movement_type.label("movement_type"),
            StockMovement.quantity.label("quantity"),
            StockMovement.notes.label("notes"),
            StockMovement.created_at.label("created_at"),
            Branch.name.label("branch_name"),
            Product.name.label("product_name"),
            Product.image_url.label("image_url"),
        )
        .outerjoin(Branch, Branch.id == StockMovement.branch_id)
        .outerjoin(Product, Product.id == StockMovement.product_id)
        .filter(
            StockMovement.movement_type.in_([
                StockMovementType.TRANSFER_IN,
                StockMovementType.INTERNAL_CONSUMPTION,
                StockMovementType.SUPPLY_IN,
                StockMovementType.RETURN_TO_SUPPLIER,
            ])
        )
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
    )

    if allowed_branch_ids:
        query = query.filter(StockMovement.branch_id.in_(allowed_branch_ids))

    return [dict(row._mapping) for row in query.limit(RECENT_INVENTORY_ACTIVITY_MOVEMENT_SOURCE_LIMIT).all()]


def _load_recent_shipment_activity_rows_by_key(allowed_branch_ids, shipment_ids):
    if not shipment_ids:
        return {}

    query = (
        StockShipment.query
        .options(
            joinedload(StockShipment.destination_branch),
            joinedload(StockShipment.items).joinedload(StockShipmentItem.product),
        )
        .filter(StockShipment.id.in_(shipment_ids))
    )

    if allowed_branch_ids:
        query = query.filter(StockShipment.destination_branch_id.in_(allowed_branch_ids))

    rows_by_key = {}
    for shipment in query.all():
        row = _build_shipment_activity_row(shipment)
        rows_by_key[row["activity_key"]] = row
    return rows_by_key


def _load_recent_return_request_activity_rows_by_key(allowed_branch_ids, return_request_ids):
    if not return_request_ids:
        return {}

    query = (
        StockReturnRequest.query
        .options(
            joinedload(StockReturnRequest.branch),
            joinedload(StockReturnRequest.product),
        )
        .filter(StockReturnRequest.id.in_(return_request_ids))
    )

    if allowed_branch_ids:
        query = query.filter(StockReturnRequest.branch_id.in_(allowed_branch_ids))

    rows_by_key = {}
    for return_request in query.all():
        for row in _build_return_request_activity_rows(return_request):
            rows_by_key[row["activity_key"]] = row
    return rows_by_key


def _dedupe_preserve_order(values):
    seen = set()
    ordered_values = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered_values.append(value)
    return ordered_values


def _build_recent_inventory_movement_activity_rows(movements, unique_limit):
    from app.models.product import StockMovementType

    grouped_transfers = {}
    grouped_supplies = {}
    activity_rows = []
    ordered_refs = []
    ordered_supply_refs = []

    for movement in movements:
        movement_type = movement.get("movement_type")
        product_id = movement.get("product_id")
        branch_id = movement.get("branch_id")
        product_name = movement.get("product_name") or f"منتج #{product_id}"
        branch_name = movement.get("branch_name") or f"فرع #{branch_id}"
        quantity = int(movement.get("quantity") or 0)
        image_url = movement.get("image_url")
        created_at = _serialize_recent_activity_timestamp(movement.get("created_at"))
        notes = movement.get("notes")

        if movement_type == StockMovementType.INTERNAL_CONSUMPTION:
            activity_rows.append({
                "activity_type": "INTERNAL_CONSUMPTION",
                "activity_key": f"consumption-{movement['id']}",
                "shipment_id": None,
                "branch_id": branch_id,
                "destination_branch_id": branch_id,
                "branch_name": branch_name,
                "created_at": created_at,
                "title": f"تم استهلاك {quantity} من {product_name} في {branch_name}.",
                "quantity": quantity,
                "items_count": 1,
                "note": notes,
                "transfer_ref": None,
                "shipment_ref": None,
                "shipment_status": None,
                "products": [{
                    "product_id": product_id,
                    "product_name": product_name,
                    "quantity": quantity,
                    "image_url": image_url,
                }],
            })
            continue

        if movement_type == StockMovementType.RETURN_TO_SUPPLIER:
            direct_return_ref = _extract_direct_supplier_return_ref(notes)
            if not direct_return_ref:
                continue

            activity_rows.append({
                "activity_type": "RETURN",
                "activity_key": f"direct-supplier-return-{movement['id']}",
                "shipment_id": None,
                "branch_id": branch_id,
                "branch_name": branch_name,
                "created_at": created_at,
                "title": f"مرتجع مباشر للمورد: {product_name}.",
                "quantity": quantity,
                "items_count": 1,
                "note": notes,
                "transfer_ref": None,
                "shipment_ref": None,
                "shipment_status": None,
                "return_ref": direct_return_ref,
                "return_status": "DIRECT_TO_SUPPLIER",
                "reason_label": None,
                "products": [{
                    "product_id": product_id,
                    "product_name": product_name,
                    "quantity": quantity,
                    "image_url": image_url,
                }],
            })
            continue

        if movement_type == StockMovementType.SUPPLY_IN:
            supply_ref = _extract_supply_receive_ref(notes)
            if not supply_ref:
                activity_rows.append({
                    "activity_type": "SUPPLY_IN",
                    "activity_key": f"supply-{movement['id']}",
                    "shipment_id": None,
                    "branch_id": branch_id,
                    "branch_name": branch_name,
                    "created_at": created_at,
                    "title": f"تم تسجيل توريد {quantity} من {product_name} في المخزن الرئيسي.",
                    "quantity": quantity,
                    "items_count": 1,
                    "note": notes,
                    "transfer_ref": None,
                    "shipment_ref": None,
                    "shipment_status": None,
                    "products": [{
                        "product_id": product_id,
                        "product_name": product_name,
                        "quantity": quantity,
                        "image_url": image_url,
                    }],
                })
                continue

            group = grouped_supplies.get(supply_ref)
            if not group:
                group = {
                    "supply_ref": supply_ref,
                    "branch_id": branch_id,
                    "branch_name": branch_name,
                    "created_at": created_at,
                    "total_quantity": 0,
                    "product_ids": set(),
                    "products": [],
                    "note": _extract_reference_user_note(notes),
                }
                grouped_supplies[supply_ref] = group
                ordered_supply_refs.append(supply_ref)

            group["total_quantity"] += quantity
            group["product_ids"].add(product_id)
            group["products"].append({
                "product_id": product_id,
                "product_name": product_name,
                "quantity": quantity,
                "image_url": image_url,
            })
            continue

        transfer_ref = _extract_bulk_transfer_ref(notes)
        if not transfer_ref:
            continue

        group = grouped_transfers.get(transfer_ref)
        if not group:
            group = {
                "transfer_ref": transfer_ref,
                "branch_id": branch_id,
                "destination_branch_name": branch_name,
                "created_at": created_at,
                "total_quantity": 0,
                "product_ids": set(),
                "products": [],
                "note": _extract_reference_user_note(notes),
            }
            grouped_transfers[transfer_ref] = group
            ordered_refs.append(transfer_ref)

        group["total_quantity"] += quantity
        group["product_ids"].add(product_id)
        group["products"].append({
            "product_id": product_id,
            "product_name": product_name,
            "quantity": quantity,
            "image_url": image_url,
        })

    for transfer_ref in ordered_refs[:unique_limit]:
        transfer = grouped_transfers[transfer_ref]
        activity_rows.append({
            "activity_type": "TRANSFER",
            "activity_key": transfer["transfer_ref"],
            "shipment_id": None,
            "branch_id": transfer["branch_id"],
            "branch_name": transfer["destination_branch_name"],
            "created_at": transfer["created_at"],
            "title": f"تم تحويل {len(transfer['product_ids'])} منتج بإجمالي {transfer['total_quantity']} قطعة إلى {transfer['destination_branch_name']}.",
            "quantity": transfer["total_quantity"],
            "items_count": len(transfer["product_ids"]),
            "note": transfer["note"],
            "transfer_ref": transfer["transfer_ref"],
            "shipment_ref": None,
            "shipment_status": "RECEIVED",
            "products": transfer["products"],
        })

    for supply_ref in ordered_supply_refs[:unique_limit]:
        supply = grouped_supplies[supply_ref]
        activity_rows.append({
            "activity_type": "SUPPLY_IN",
            "activity_key": supply["supply_ref"],
            "shipment_id": None,
            "branch_id": supply["branch_id"],
            "branch_name": supply["branch_name"],
            "created_at": supply["created_at"],
            "title": f"تم تسجيل توريد {len(supply['product_ids'])} منتج بإجمالي {supply['total_quantity']} قطعة في المخزن الرئيسي.",
            "quantity": supply["total_quantity"],
            "items_count": len(supply["product_ids"]),
            "note": supply["note"],
            "transfer_ref": supply["supply_ref"],
            "shipment_ref": None,
            "shipment_status": None,
            "products": supply["products"],
        })

    return activity_rows


def _build_recent_inventory_activity_response(allowed_branch_ids, unique_limit):
    # Keep the legacy candidate caps and source ordering, but hydrate only the
    # visible shipment/return rows after the top-N feed has been selected.
    shipment_candidates = _fetch_recent_shipment_activity_candidates(allowed_branch_ids)
    return_request_candidates = _fetch_recent_return_request_activity_candidates(allowed_branch_ids)
    movement_candidates = _fetch_recent_inventory_movement_candidates(allowed_branch_ids)

    activity_rows = [_build_recent_shipment_activity_stub(candidate) for candidate in shipment_candidates]
    for candidate in return_request_candidates:
        activity_rows.extend(_build_recent_return_request_activity_stubs(candidate))

    movement_rows = _build_recent_inventory_movement_activity_rows(movement_candidates, unique_limit)
    for row in movement_rows:
        activity_rows.append({
            "activity_key": row["activity_key"],
            "created_at": row.get("created_at"),
            "_source_type": "movement",
            "_payload": row,
        })

    visible_rows = _sort_recent_inventory_activity_rows(activity_rows, unique_limit)
    shipment_ids = _dedupe_preserve_order([
        row["_source_id"]
        for row in visible_rows
        if row.get("_source_type") == "shipment"
    ])
    return_request_ids = _dedupe_preserve_order([
        row["_source_id"]
        for row in visible_rows
        if row.get("_source_type") == "return_request"
    ])

    shipment_rows_by_key = _load_recent_shipment_activity_rows_by_key(allowed_branch_ids, shipment_ids)
    return_rows_by_key = _load_recent_return_request_activity_rows_by_key(allowed_branch_ids, return_request_ids)

    response = []
    for row in visible_rows:
        source_type = row.get("_source_type")
        if source_type == "movement":
            response.append(row["_payload"])
            continue

        if source_type == "shipment":
            materialized_row = shipment_rows_by_key.get(row["activity_key"])
        else:
            materialized_row = return_rows_by_key.get(row["activity_key"])

        if materialized_row:
            response.append(materialized_row)

    return response

def _build_supply_receive_note(supply_ref, supplier_name=None, note=None):
    base_note = f"[{supply_ref}] توريد إلى المخزن الرئيسي"
    details = []
    if supplier_name:
        details.append(f"المورد: {supplier_name}")
    if note:
        details.append(note)
    if details:
        return f"{base_note} - {' | '.join(details)}"
    return base_note

def _normalize_money_amount(value):
    return round(float(value or 0), 2)

def _resolve_shipment_item_unit_cost(item):
    if item.unit_cost_snapshot is not None:
        return _normalize_money_amount(item.unit_cost_snapshot)
    if item.product and item.product.cost_price is not None:
        return _normalize_money_amount(item.product.cost_price)
    return 0.0


def _build_shipment_summary_from_rows(rows):
    products_count = len(rows)
    pieces_count = sum(int(row.get('quantity') or 0) for row in rows)
    total_cost_snapshot = _normalize_money_amount(
        sum(
            int(row.get('quantity') or 0) * _normalize_money_amount(row.get('unit_cost_snapshot'))
            for row in rows
        )
    )

    return {
        'products_count': products_count,
        'pieces_count': pieces_count,
        'total_cost_snapshot': total_cost_snapshot,
    }

def _serialize_shipment_item(item):
    quantity = int(item.quantity or 0)
    unit_cost_snapshot = _resolve_shipment_item_unit_cost(item)
    line_cost_total = _normalize_money_amount(unit_cost_snapshot * quantity)

    return {
        "product_id": item.product_id,
        "product_name": item.product.name if item.product else f"منتج #{item.product_id}",
        "quantity": quantity,
        "image_url": item.product.image_url if item.product else None,
        "unit_cost_snapshot": unit_cost_snapshot,
        "line_cost_total": line_cost_total,
    }

def _serialize_shipment_items(shipment_items):
    return [_serialize_shipment_item(item) for item in shipment_items]


def _resolve_shipment_summary(shipment, items_list):
    computed_summary = _build_shipment_summary_from_rows(items_list)

    return {
        'products_count': int(
            shipment.products_count
            if getattr(shipment, 'products_count', None) is not None
            else computed_summary['products_count']
        ),
        'pieces_count': int(
            shipment.pieces_count
            if getattr(shipment, 'pieces_count', None) is not None
            else computed_summary['pieces_count']
        ),
        'total_cost_snapshot': _normalize_money_amount(
            shipment.total_cost_snapshot
            if getattr(shipment, 'total_cost_snapshot', None) is not None
            else computed_summary['total_cost_snapshot']
        ),
    }


def _serialize_shipment_branch(branch_id, branch_obj):
    if branch_id is None and branch_obj is None:
        return None
    return {
        'id': branch_id,
        'name': branch_obj.name if branch_obj else f"فرع #{branch_id}",
    }

def _build_shipment_activity_row(shipment):
    activity_time = shipment.cancelled_at or shipment.received_at or shipment.created_at
    branch_name = shipment.destination_branch.name if shipment.destination_branch else f"فرع #{shipment.destination_branch_id}"
    products = _serialize_shipment_items(shipment.items)
    summary = _resolve_shipment_summary(shipment, products)

    if shipment.status == 'CANCELLED':
        title = f"تم إلغاء الشحنة وإعادة كمياتها إلى المصدر الأصلي."
    elif shipment.shipment_type == 'INBOUND_SUPPLY':
        title = f"تم تسجيل شحنة واردة في {branch_name}."
    elif shipment.status == 'RECEIVED':
        title = f"تم استلام الشحنة في {branch_name}."
    else:
        title = f"شحنة إلى {branch_name} بانتظار الاستلام."

    return {
        "activity_type": "SHIPMENT",
        "activity_key": f"shipment-{shipment.id}-{shipment.status}",
        "shipment_id": shipment.id,
        "branch_id": shipment.destination_branch_id,
        "branch_name": branch_name,
        "created_at": activity_time.isoformat() if activity_time else None,
        "title": title,
        "quantity": summary['pieces_count'],
        "items_count": summary['products_count'],
        "note": shipment.note,
        "transfer_ref": shipment.shipment_ref,
        "shipment_ref": shipment.shipment_ref,
        "shipment_status": shipment.status,
        "products": products,
    }


def _serialize_admin_return_request(req, current_branch_stock=None, valuation=None):
    from app.models.supply_operations import RETURN_REQUEST_REASON_LABELS

    return {
        "id": req.id,
        "return_ref": req.return_ref,
        "branch_id": req.branch_id,
        "branch_name": req.branch.name if req.branch else f"فرع #{req.branch_id}",
        "product_id": req.product_id,
        "product_name": req.product.name if req.product else f"منتج #{req.product_id}",
        "product_unit": req.product.unit if req.product else "",
        "product_image_url": req.product.image_url if req.product else None,
        "requested_quantity": int(req.requested_quantity or 0),
        "branch_stock_snapshot": int(req.branch_stock_snapshot or 0),
        "current_branch_stock": current_branch_stock,
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
        "cost_valuation": valuation if valuation is not None else request_valuations([req])[req.id],
    }


def _build_return_request_resolution_note(return_ref, destination_label, note=None):
    base_note = f"[{return_ref}] {destination_label}"
    if note:
        return f"{base_note} - {note}"
    return base_note


def _build_return_request_activity_rows(req):
    from app.models.supply_operations import RETURN_REQUEST_REASON_LABELS

    branch_name = req.branch.name if req.branch else f"فرع #{req.branch_id}"
    product_name = req.product.name if req.product else f"منتج #{req.product_id}"
    reason_label = RETURN_REQUEST_REASON_LABELS.get(req.reason, req.reason)
    product_payload = [{
        "product_id": req.product_id,
        "product_name": product_name,
        "quantity": int(req.requested_quantity or 0),
        "image_url": req.product.image_url if req.product else None,
    }]

    rows = [{
        "activity_type": "RETURN",
        "activity_key": f"return-{req.id}-created",
        "shipment_id": None,
        "branch_id": req.branch_id,
        "branch_name": branch_name,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "title": f"تم إرسال طلب المرتجع: {product_name}.",
        "quantity": int(req.requested_quantity or 0),
        "items_count": 1,
        "note": req.notes,
        "transfer_ref": None,
        "shipment_ref": None,
        "shipment_status": None,
        "return_ref": req.return_ref,
        "return_status": "PENDING",
        "reason_label": reason_label,
        "products": product_payload,
    }]

    if req.status == 'RETURNED_TO_MAIN' and req.resolved_at:
        rows.append({
            "activity_type": "RETURN",
            "activity_key": f"return-{req.id}-main",
            "shipment_id": None,
            "branch_id": req.branch_id,
            "branch_name": branch_name,
            "created_at": req.resolved_at.isoformat(),
            "title": f"تمت الموافقة وإرجاعه للمخزن: {product_name}.",
            "quantity": int(req.requested_quantity or 0),
            "items_count": 1,
            "note": req.resolution_note,
            "transfer_ref": None,
            "shipment_ref": None,
            "shipment_status": None,
            "return_ref": req.return_ref,
            "return_status": req.status,
            "reason_label": reason_label,
            "products": product_payload,
        })
    elif req.status == 'RETURNED_TO_SUPPLIER' and req.resolved_at:
        rows.append({
            "activity_type": "RETURN",
            "activity_key": f"return-{req.id}-supplier",
            "shipment_id": None,
            "branch_id": req.branch_id,
            "branch_name": branch_name,
            "created_at": req.resolved_at.isoformat(),
            "title": f"تمت الموافقة وإرجاعه للمورد: {product_name}.",
            "quantity": int(req.requested_quantity or 0),
            "items_count": 1,
            "note": req.resolution_note,
            "transfer_ref": None,
            "shipment_ref": None,
            "shipment_status": None,
            "return_ref": req.return_ref,
            "return_status": req.status,
            "reason_label": reason_label,
            "products": product_payload,
        })
    elif req.status == 'REJECTED' and req.resolved_at:
        rows.append({
            "activity_type": "RETURN",
            "activity_key": f"return-{req.id}-rejected",
            "shipment_id": None,
            "branch_id": req.branch_id,
            "branch_name": branch_name,
            "created_at": req.resolved_at.isoformat(),
            "title": f"تم رفض الطلب: {product_name}.",
            "quantity": int(req.requested_quantity or 0),
            "items_count": 1,
            "note": req.resolution_note,
            "transfer_ref": None,
            "shipment_ref": None,
            "shipment_status": None,
            "return_ref": req.return_ref,
            "return_status": req.status,
            "reason_label": reason_label,
            "products": product_payload,
        })

    return rows

def _create_stock_shipment(destination_branch, prepared_items, note=None):
    from app.models.product import StockMovement, StockMovementType

    main_branch = _require_main_warehouse_branch()
    if not prepared_items:
        raise ValueError("يجب إضافة منتج واحد على الأقل إلى الشحنة.")

    shipment_ref = _generate_stock_shipment_ref()
    movement_note = _build_shipment_movement_note(shipment_ref, destination_branch.name, note)
    summary_rows = []
    for item in prepared_items:
        quantity = int(item["quantity"] or 0)
        if quantity <= 0:
            raise ValueError("كمية كل منتج يجب أن تكون أكبر من الصفر.")
        summary_rows.append({
            "quantity": quantity,
            "unit_cost_snapshot": _normalize_money_amount(item["product"].cost_price),
        })

    shipment_summary = _build_shipment_summary_from_rows(summary_rows)
    shipment = StockShipment(
        shipment_ref=shipment_ref,
        shipment_type='OUTBOUND_TRANSFER',
        source_branch_id=main_branch.id,
        destination_branch_id=destination_branch.id,
        status='IN_TRANSIT',
        note=note,
        products_count=shipment_summary["products_count"],
        pieces_count=shipment_summary["pieces_count"],
        total_cost_snapshot=shipment_summary["total_cost_snapshot"],
        created_by_user_id=g.current_user.id,
    )
    db.session.add(shipment)
    db.session.flush()

    for item in prepared_items:
        source_stock = item["source_stock"]
        if not source_stock:
            raise ValueError("تعذر تحديد رصيد المنتج في المستودع الرئيسي.")

        quantity = int(item["quantity"] or 0)
        if quantity <= 0:
            raise ValueError("كمية كل منتج يجب أن تكون أكبر من الصفر.")

        balance_before = source_stock.stock_quantity
        source_stock.stock_quantity -= quantity
        db.session.add(StockShipmentItem(
            shipment_id=shipment.id,
            product_id=item["product"].id,
            quantity=quantity,
            unit_cost_snapshot=_normalize_money_amount(item["product"].cost_price),
        ))
        db.session.add(capture_stock_movement(source_stock, balance_before,
            product_id=item["product"].id,
            branch_id=main_branch.id,
            movement_type=StockMovementType.TRANSFER_OUT,
            quantity=quantity,
            created_by=_resolve_stock_movement_created_by_employee_id(),
            notes=movement_note
        ))

    db.session.flush()
    return shipment, shipment_summary["pieces_count"]


def _resolve_return_request(req_obj, resolution_status, resolution_note=None):
    from app.models.product import StockMovement, StockMovementType

    if req_obj.status != 'PENDING':
        raise ValueError("تمت معالجة طلب المرتجع بالفعل.")

    main_branch = None
    main_error = None
    pairs = [(req_obj.product_id, req_obj.branch_id)]
    if resolution_status == 'RETURNED_TO_MAIN':
        try:
            main_branch = _require_main_warehouse_branch()
            pairs.append((req_obj.product_id, main_branch.id))
        except ValueError as error:
            main_error = error
    locked_stocks = lock_product_stocks(pairs, create_missing=pairs[1:])
    branch_stock = locked_stocks[(req_obj.product_id, req_obj.branch_id)]
    current_branch_stock = int(branch_stock.stock_quantity or 0) if branch_stock else 0
    requested_quantity = int(req_obj.requested_quantity or 0)

    if resolution_status in {'RETURNED_TO_MAIN', 'RETURNED_TO_SUPPLIER'} and current_branch_stock < requested_quantity:
        return None, current_branch_stock

    movement_note = None
    if resolution_status == 'RETURNED_TO_MAIN':
        if main_error:
            raise main_error
        main_stock = locked_stocks[(req_obj.product_id, main_branch.id)]
        movement_note = _build_return_request_resolution_note(
            req_obj.return_ref,
            'إرجاع للمخزن الرئيسي',
            resolution_note,
        )

        branch_before = branch_stock.stock_quantity
        branch_stock.stock_quantity -= requested_quantity
        branch_movement = capture_stock_movement(branch_stock, branch_before,
            product_id=req_obj.product_id,
            branch_id=req_obj.branch_id,
            movement_type=StockMovementType.TRANSFER_OUT,
            quantity=requested_quantity,
            created_by=_resolve_stock_movement_created_by_employee_id(),
            notes=movement_note,
        )
        # Capture each actual leg immediately. This also preserves sequential
        # evidence for a legacy request whose source happens to be main itself.
        main_before = main_stock.stock_quantity
        main_stock.stock_quantity += requested_quantity
        db.session.add(branch_movement)
        db.session.add(capture_stock_movement(main_stock, main_before,
            product_id=req_obj.product_id,
            branch_id=main_branch.id,
            movement_type=StockMovementType.TRANSFER_IN,
            quantity=requested_quantity,
            created_by=_resolve_stock_movement_created_by_employee_id(),
            notes=movement_note,
        ))
    elif resolution_status == 'RETURNED_TO_SUPPLIER':
        branch_before = branch_stock.stock_quantity
        branch_stock.stock_quantity -= requested_quantity
        movement_note = _build_return_request_resolution_note(
            req_obj.return_ref,
            'إرجاع للمورد',
            resolution_note,
        )
        db.session.add(capture_stock_movement(branch_stock, branch_before,
            product_id=req_obj.product_id,
            branch_id=req_obj.branch_id,
            movement_type=StockMovementType.RETURN_TO_SUPPLIER,
            quantity=requested_quantity,
            created_by=_resolve_stock_movement_created_by_employee_id(),
            notes=movement_note,
        ))

    req_obj.status = resolution_status
    req_obj.resolution_note = resolution_note
    req_obj.resolved_at = get_utc_now()
    req_obj.resolved_by_user_id = g.current_user.id if hasattr(g, 'current_user') and g.current_user else None

    db.session.flush()
    return movement_note, current_branch_stock

def _inventory_read_scope(product_id=None, *, include_history=False):
    """Scope Supply Center reads without changing inventory write permissions."""
    from app.models.product import ProductBranchStock

    allowed_ids = resolve_branch_scope(g.current_user, 'all')
    if not allowed_ids:
        abort(403, description="No authorized inventory branches.")
    # Validate explicit locations, but do not introduce new stock-filter semantics.
    for parameter in ('branch_id', 'location_id'):
        raw = request.args.get(parameter)
        if raw and raw.lower() != 'all':
            try:
                branch_id = int(raw)
            except (TypeError, ValueError):
                abort(400, description="Invalid branch ID.")
            if branch_id not in allowed_ids:
                abort(403, description="Access to this inventory branch is restricted.")
            if db.session.get(Branch, branch_id) is None:
                abort(404, description="Inventory branch not found.")

    if product_id is not None and g.current_user.role == UserRole.BRANCH_MANAGER:
        visible = ProductBranchStock.query.filter(
            ProductBranchStock.product_id == product_id,
            ProductBranchStock.branch_id.in_(allowed_ids),
        ).first()
        if visible is None and include_history:
            from app.models.product import StockMovement
            from app.models.inventory_batch import BranchInventoryBatch, InventoryBatch
            visible = (StockMovement.query.filter(StockMovement.product_id == product_id, StockMovement.branch_id.in_(allowed_ids)).first()
                       or BranchInventoryBatch.query.filter(BranchInventoryBatch.product_id == product_id, BranchInventoryBatch.branch_id.in_(allowed_ids)).first()
                       or InventoryBatch.query.filter(InventoryBatch.product_id == product_id, InventoryBatch.created_branch_id.in_(allowed_ids)).first())
        if visible is None:
            abort(404, description="Product not found in authorized inventory.")
    return allowed_ids


@admin_bp.route('/products', methods=['GET'])
@require_admin
def list_admin_products():
    from app.models.product import Product, ProductBranchStock
    try:
        allowed_ids = _inventory_read_scope()
        branch_id_str = request.args.get('branch_id')
        if branch_id_str and branch_id_str.lower() == 'all':
            branch_id_str = None
        main_branch = _get_main_warehouse_branch()
        main_branch_id = main_branch.id if main_branch else None
        
        query = Product.query
        if g.current_user.role == UserRole.BRANCH_MANAGER:
            query = query.filter(Product.branch_stocks.any(ProductBranchStock.branch_id.in_(allowed_ids)))
        products = query.order_by(Product.name.asc()).all()
        
        response = []
        for p in products:
            visible_stocks = [row for row in p.branch_stocks if row.branch_id in allowed_ids]
            total_stock = sum(int(s.stock_quantity or 0) for s in visible_stocks)
            main_store_stock = sum(
                int(s.stock_quantity or 0)
                for s in visible_stocks
                if s.branch_id == main_branch_id
            )
            stock_qty = total_stock
            if branch_id_str:
                stock_qty = 0
                stock_record = ProductBranchStock.query.filter_by(
                    product_id=p.id,
                    branch_id=int(branch_id_str)
                ).first()
                if stock_record:
                    stock_qty = stock_record.stock_quantity
            
            response.append({
                "id": p.id,
                "name": p.name,
                "category": p.category,
                "unit": p.unit,
                "pieces_per_unit": p.pieces_per_unit,
                "supplier_name": p.supplier_name,
                "expiry_date": p.expiry_date.isoformat() if p.expiry_date else None,
                "selling_price": p.selling_price,
                "cost_price": p.cost_price,
                "sales_commission_percent": float(p.sales_commission_percent or 0),
                "min_stock_threshold": p.min_stock_threshold,
                "is_active": p.is_active,
                "image_url": p.image_url,
                "stock_quantity": stock_qty,
                "total_stock": total_stock,
                "main_store_stock": main_store_stock,
            })
            
        return jsonify(response), 200
    except HTTPException as error:
        return jsonify({"error": error.description}), error.code
    except Exception as e:
        return jsonify({"error": "Failed to list products", "details": str(e)}), 500


def _build_product_stock_summary_subquery(main_branch_id, allowed_branch_ids=None):
    from app.models.product import ProductBranchStock

    return (
        db.session.query(
            ProductBranchStock.product_id.label('product_id'),
            func.coalesce(func.sum(ProductBranchStock.stock_quantity), 0).label('total_stock'),
            func.coalesce(
                func.sum(
                    case(
                        (ProductBranchStock.branch_id == main_branch_id, ProductBranchStock.stock_quantity),
                        else_=0,
                    )
                ),
                0,
            ).label('main_store_stock'),
        )
        .filter(ProductBranchStock.branch_id.in_(allowed_branch_ids) if allowed_branch_ids is not None else True)
        .group_by(ProductBranchStock.product_id)
        .subquery()
    )


def _parse_product_id_list(raw_value):
    if not raw_value:
        return []

    product_ids = []
    for raw_part in str(raw_value).split(','):
        part = raw_part.strip()
        if not part:
            continue
        try:
            product_ids.append(int(part))
        except (TypeError, ValueError):
            continue

    return sorted(set(product_ids))


@admin_bp.route('/products/catalog', methods=['GET'])
@require_admin
def get_admin_products_catalog():
    from app.models.product import Product, ProductBranchStock

    try:
        allowed_ids = _inventory_read_scope()
        page = max(1, int(request.args.get('page', 1)))
        per_page = min(100, max(1, int(request.args.get('per_page', 25))))
        status_filter = (request.args.get('status') or 'ALL').strip().upper()
        query_text = (request.args.get('q') or '').strip()
        sort = (request.args.get('sort') or 'name_asc').strip().lower()

        if status_filter not in {'ALL', 'SELLABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'NEAR_EXPIRY', 'ARCHIVED'}:
            return jsonify({"error": "Invalid status filter."}), 400

        main_branch = _get_main_warehouse_branch()
        main_branch_id = main_branch.id if main_branch else None
        stock_summary = _build_product_stock_summary_subquery(main_branch_id, allowed_ids)
        total_stock_expr = func.coalesce(stock_summary.c.total_stock, 0)
        main_store_stock_expr = func.coalesce(stock_summary.c.main_store_stock, 0)
        location = request.args.get('location_id') or request.args.get('branch_id') or 'all'
        if (request.args.get('location_id') and request.args.get('branch_id')
                and request.args['location_id'].lower() != request.args['branch_id'].lower()):
            return jsonify({'error': 'Conflicting inventory locations.'}), 400
        alert_ids = allowed_ids if location.lower() == 'all' else [int(location)]
        alerts = location_alert_counts(alert_ids)
        low_count = func.coalesce(alerts.c.low_stock_locations_count, 0)
        out_count = func.coalesce(alerts.c.out_of_stock_locations_count, 0)
        applicable_count = func.coalesce(alerts.c.applicable_locations_count, 0)
        unknown_count = func.coalesce(alerts.c.unknown_locations_count, 0)

        catalog_query = (
            db.session.query(
                Product.id,
                Product.name,
                Product.category,
                Product.unit,
                Product.pieces_per_unit,
                Product.supplier_name,
                Product.expiry_date,
                Product.selling_price,
                Product.cost_price,
                Product.sales_commission_percent,
                Product.min_stock_threshold,
                Product.is_active,
                Product.image_url,
                total_stock_expr.label('total_stock'),
                main_store_stock_expr.label('main_store_stock'),
                low_count.label('low_stock_locations_count'),
                out_count.label('out_of_stock_locations_count'),
                applicable_count.label('applicable_locations_count'),
                unknown_count.label('unknown_locations_count'),
            )
            .outerjoin(stock_summary, stock_summary.c.product_id == Product.id)
            .outerjoin(alerts, alerts.c.product_id == Product.id)
        )

        if g.current_user.role == UserRole.BRANCH_MANAGER:
            catalog_query = catalog_query.filter(Product.branch_stocks.any(
                ProductBranchStock.branch_id.in_(allowed_ids)
            ))

        if query_text:
            pattern = f"%{query_text}%"
            catalog_query = catalog_query.filter(
                or_(
                    Product.name.ilike(pattern),
                    Product.category.ilike(pattern),
                )
            )

        today = get_cairo_date()
        near_expiry_cutoff = today + timedelta(days=30)

        if status_filter == 'ALL':
            catalog_query = catalog_query.filter(Product.is_active.is_(True))
        elif status_filter == 'SELLABLE':
            catalog_query = catalog_query.filter(
                Product.is_active.is_(True),
                Product.selling_price > 0,
            )
        elif status_filter == 'LOW_STOCK':
            catalog_query = catalog_query.filter(
                Product.is_active.is_(True),
                low_count > 0,
            )
        elif status_filter == 'OUT_OF_STOCK':
            catalog_query = catalog_query.filter(Product.is_active.is_(True), out_count > 0)
        elif status_filter == 'NEAR_EXPIRY':
            catalog_query = catalog_query.filter(
                Product.is_active.is_(True),
                Product.expiry_date.isnot(None),
                Product.expiry_date >= today,
                Product.expiry_date <= near_expiry_cutoff,
            )
        elif status_filter == 'ARCHIVED':
            catalog_query = catalog_query.filter(Product.is_active.is_(False))

        sort_clauses = {
            'name_asc': [Product.name.asc(), Product.id.asc()],
            'name_desc': [Product.name.desc(), Product.id.desc()],
            'stock_desc': [total_stock_expr.desc(), Product.name.asc(), Product.id.asc()],
            'stock_asc': [total_stock_expr.asc(), Product.name.asc(), Product.id.asc()],
            'price_desc': [Product.selling_price.desc(), Product.name.asc(), Product.id.asc()],
            'price_asc': [Product.selling_price.asc(), Product.name.asc(), Product.id.asc()],
            'updated_desc': [Product.updated_at.desc(), Product.id.desc()],
        }
        catalog_query = catalog_query.order_by(*sort_clauses.get(sort, sort_clauses['name_asc']))

        total = catalog_query.order_by(None).count()
        total_pages = (total + per_page - 1) // per_page if total > 0 else 0
        page = min(page, max(1, total_pages))

        rows = (
            catalog_query
            .limit(per_page)
            .offset((page - 1) * per_page)
            .all()
        )

        items = [{
            "id": row.id,
            "name": row.name,
            "category": row.category,
            "unit": row.unit,
            "pieces_per_unit": int(row.pieces_per_unit or 1),
            "supplier_name": row.supplier_name,
            "expiry_date": row.expiry_date.isoformat() if row.expiry_date else None,
            "selling_price": float(row.selling_price or 0),
            "cost_price": float(row.cost_price or 0) if row.cost_price is not None else None,
            "sales_commission_percent": float(row.sales_commission_percent or 0),
            "min_stock_threshold": int(row.min_stock_threshold or 0),
            "is_active": bool(row.is_active),
            "image_url": row.image_url,
            "stock_quantity": int(row.total_stock or 0),
            "total_stock": int(row.total_stock or 0),
            "main_store_stock": int(row.main_store_stock or 0),
            "low_stock_locations_count": int(row.low_stock_locations_count),
            "out_of_stock_locations_count": int(row.out_of_stock_locations_count),
            "applicable_locations_count": int(row.applicable_locations_count),
            "unknown_locations_count": int(row.unknown_locations_count),
            "stock_status": ('OUT_OF_STOCK' if row.out_of_stock_locations_count else
                             'LOW_STOCK' if row.low_stock_locations_count else
                             'UNKNOWN' if row.unknown_locations_count or not row.applicable_locations_count else 'AVAILABLE'),
        } for row in rows]

        return jsonify({
            "items": items,
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
            "has_more": page < total_pages,
        }), 200
    except HTTPException as error:
        return jsonify({"error": error.description}), error.code
    except ValueError:
        return jsonify({"error": "Invalid pagination parameters."}), 400
    except Exception as e:
        return jsonify({"error": "Failed to load product catalog", "details": str(e)}), 500


@admin_bp.route('/products/search', methods=['GET'])
@require_admin
def search_admin_products():
    from app.models.product import Product

    try:
        purpose = (request.args.get('purpose') or '').strip().lower()
        if purpose not in {'receive_supply', 'bulk_transfer', 'supplier_return'}:
            return jsonify({"error": "Invalid search purpose."}), 400

        limit = min(50, max(1, int(request.args.get('limit', 20))))
        query_text = (request.args.get('q') or '').strip()
        product_ids = _parse_product_id_list(request.args.get('product_ids'))

        main_branch = _require_main_warehouse_branch()
        stock_summary = _build_product_stock_summary_subquery(main_branch.id)
        main_store_stock_expr = func.coalesce(stock_summary.c.main_store_stock, 0)

        selector_query = (
            db.session.query(
                Product.id,
                Product.name,
                Product.category,
                Product.unit,
                Product.image_url,
                Product.selling_price,
                Product.cost_price,
                Product.supplier_name,
                main_store_stock_expr.label('main_store_stock'),
            )
            .outerjoin(stock_summary, stock_summary.c.product_id == Product.id)
            .filter(Product.is_active.is_(True))
        )

        if product_ids:
            selector_query = selector_query.filter(Product.id.in_(product_ids))

        if query_text:
            pattern = f"%{query_text}%"
            selector_query = selector_query.filter(
                or_(
                    Product.name.ilike(pattern),
                    Product.category.ilike(pattern),
                )
            )

        if purpose == 'supplier_return':
            selector_query = selector_query.filter(main_store_stock_expr > 0)
        elif purpose == 'bulk_transfer' and not product_ids:
            selector_query = selector_query.filter(main_store_stock_expr > 0)

        rows = (
            selector_query
            .order_by(Product.name.asc(), Product.id.asc())
            .limit(limit)
            .all()
        )

        return jsonify([{
            "id": row.id,
            "name": row.name,
            "category": row.category,
            "unit": row.unit,
            "image_url": row.image_url,
            "selling_price": float(row.selling_price or 0),
            "cost_price": float(row.cost_price or 0) if row.cost_price is not None else None,
            "supplier_name": row.supplier_name,
            "main_store_stock": int(row.main_store_stock or 0),
        } for row in rows]), 200
    except ValueError:
        return jsonify({"error": "Invalid search parameters."}), 400
    except Exception as e:
        return jsonify({"error": "Failed to search products", "details": str(e)}), 500


@admin_bp.route('/inventory/overview', methods=['GET'])
@require_admin
@require_role(UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN, UserRole.STORE_MANAGER)
def get_supply_overview():
    from app.services.supply_overview import overview
    try:
        return jsonify(overview(g.current_user, request.args)), 200
    except ValueError as error:
        return jsonify(error=str(error)), 400
    except HTTPException as error:
        return jsonify(error=error.description), error.code


@admin_bp.route('/inventory/branch-comparison', methods=['GET'])
@require_admin
@require_role(UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN, UserRole.STORE_MANAGER)
def get_supply_branch_comparison():
    from app.services.supply_overview import comparison
    try:
        return jsonify(comparison(g.current_user, request.args)), 200
    except ValueError as error:
        return jsonify(error=str(error)), 400
    except HTTPException as error:
        return jsonify(error=error.description), error.code


@admin_bp.route('/inventory/overview-summary', methods=['GET'])
@require_admin
def get_admin_inventory_overview_summary():
    from app.models.product import Product, ProductBranchStock

    try:
        allowed_branch_ids = _inventory_read_scope()

        total_products = (
            db.session.query(func.count(Product.id))
            .filter(Product.is_active.is_(True))
            .filter(Product.branch_stocks.any(ProductBranchStock.branch_id.in_(allowed_branch_ids))
                    if g.current_user.role == UserRole.BRANCH_MANAGER else True)
            .scalar()
            or 0
        )

        total_units = 0
        total_cost_value = 0.0

        main_branch = _get_main_warehouse_branch()
        if main_branch and main_branch.id in allowed_branch_ids:
            main_stock_qty_expr = case(
                (ProductBranchStock.stock_quantity > 0, ProductBranchStock.stock_quantity),
                else_=0
            )
            cost_expr = func.coalesce(Product.cost_price, 0.0)

            main_warehouse_aggregates = (
                db.session.query(
                    func.coalesce(func.sum(main_stock_qty_expr), 0).label('total_units'),
                    func.coalesce(func.sum(main_stock_qty_expr * cost_expr), 0.0).label('total_cost_value'),
                )
                .join(Product, Product.id == ProductBranchStock.product_id)
                .filter(
                    ProductBranchStock.branch_id == main_branch.id,
                    Product.is_active.is_(True)
                )
                .first()
            )
            if main_warehouse_aggregates:
                total_units = int(main_warehouse_aggregates.total_units or 0)
                total_cost_value = round(float(main_warehouse_aggregates.total_cost_value or 0.0), 2)

        pending_returns_query = (
            db.session.query(func.count(StockReturnRequest.id))
            .filter(StockReturnRequest.status == 'PENDING')
        )
        if allowed_branch_ids:
            pending_returns_query = pending_returns_query.filter(
                StockReturnRequest.branch_id.in_(allowed_branch_ids)
            )

        pending_returns = pending_returns_query.scalar() or 0

        return jsonify({
            "total_products": int(total_products),
            "total_units": int(total_units),
            "total_cost_value": float(total_cost_value),
            "pending_returns": int(pending_returns),
        }), 200
    except HTTPException as error:
        return jsonify({"error": error.description}), error.code
    except Exception as e:
        return jsonify({"error": "Failed to load inventory overview summary", "details": str(e)}), 500

@admin_bp.route('/supply-requests/<int:request_id>/edit-and-send', methods=['POST'])
@require_admin
def edit_and_send_supply_request(request_id):
    from app.models.supply_operations import StockSupplyRequest, StockSupplyRequestItem, StockShipment, StockShipmentItem
    from app.models.product import Product

    try:
        req_obj = StockSupplyRequest.query.populate_existing().filter_by(id=request_id).with_for_update().first()
        if not req_obj:
            return jsonify({"error": "الطلب غير موجود."}), 404
        if req_obj.status != 'PENDING':
            return jsonify({"error": "هذا الطلب تم معالجته بالفعل."}), 400

        data = request.get_json() or {}
        raw_items = data.get('items')
        admin_note = _normalize_optional_text(data.get('note'))

        if not raw_items or not isinstance(raw_items, list):
            return jsonify({"error": "يجب إضافة منتج واحد على الأقل إلى الشحنة."}), 400

        main_branch = _require_main_warehouse_branch()
        destination_branch = req_obj.branch

        aggregated_items = {}
        for raw_item in raw_items:
            try:
                product_id = int(raw_item.get('product_id'))
                qty = int(raw_item.get('quantity'))
            except (TypeError, ValueError):
                return jsonify({"error": "بيانات المنتج أو الكمية غير صحيحة."}), 400

            if qty <= 0:
                return jsonify({"error": "كمية كل منتج يجب أن تكون أكبر من الصفر."}), 400

            aggregated_items[product_id] = aggregated_items.get(product_id, 0) + qty

        product_ids = sorted(aggregated_items.keys())
        products = Product.query.filter(Product.id.in_(product_ids)).all()
        products_by_id = {p.id: p for p in products}

        missing = [p_id for p_id in product_ids if p_id not in products_by_id]
        if missing:
            return jsonify({"error": "بعض المنتجات غير موجودة."}), 404

        prepared_items = []
        for p_id in product_ids:
            product = products_by_id[p_id]
            qty = aggregated_items[p_id]
            
            source_stock = _lock_product_branch_stock(p_id, main_branch.id)
            available_qty = int(source_stock.stock_quantity or 0) if source_stock else 0

            if qty > available_qty:
                return jsonify({
                    "error": f"الكمية المطلوبة للمنتج {product.name} ({qty}) تتجاوز المتاح في المستودع الرئيسي ({available_qty})."
                }), 400

            prepared_items.append({
                "product": product,
                "quantity": qty,
                "source_stock": source_stock,
                "available_quantity": available_qty
            })

        note_str = req_obj.note
        if admin_note:
            note_str = f"{note_str} | ملاحظة الإدارة: {admin_note}" if note_str else f"ملاحظة الإدارة: {admin_note}"

        shipment, total_qty = _create_stock_shipment(destination_branch, prepared_items, note_str)

        req_obj.status = 'SENT'
        req_obj.shipment_id = shipment.id
        req_obj.sent_at = get_utc_now()
        if admin_note:
            req_obj.note = note_str

        existing_items_by_product = {item.product_id: item for item in req_obj.items}

        for p_id in product_ids:
            qty = aggregated_items[p_id]
            if p_id in existing_items_by_product:
                existing_items_by_product[p_id].final_quantity = qty
            else:
                new_item = StockSupplyRequestItem(
                    request_id=req_obj.id,
                    product_id=p_id,
                    requested_quantity=0,
                    final_quantity=qty
                )
                db.session.add(new_item)

        for p_id, item in existing_items_by_product.items():
            if p_id not in aggregated_items:
                item.final_quantity = 0

        db.session.commit()

        return jsonify({
            "message": "تم تعديل الشحنة وإرسالها بنجاح.",
            "shipment_id": shipment.id,
            "shipment_ref": shipment.shipment_ref
        }), 200

    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to edit and send request", "details": str(e)}), 500


@admin_bp.route('/supply-requests', methods=['GET'])
@require_admin
def list_admin_supply_requests():
    from app.models.supply_operations import StockSupplyRequest, StockSupplyRequestItem
    from werkzeug.exceptions import HTTPException
    try:
        page = max(1, int(request.args.get('page', 1)))
        per_page = min(100, max(1, int(request.args.get('per_page', 20))))
        requested_branch = request.args.get('branch_id') or 'all'
        status_filter = (request.args.get('status') or 'ALL').strip().upper()
        date_from_value = _parse_admin_shipment_history_date(request.args.get('date_from'), 'date_from')
        date_to_value = _parse_admin_shipment_history_date(request.args.get('date_to'), 'date_to')
        q = _normalize_optional_text(request.args.get('q'))

        if date_from_value and date_to_value and date_from_value > date_to_value:
            return jsonify({"error": "date_from cannot be later than date_to."}), 400

        if requested_branch and str(requested_branch).lower() != 'all':
            try:
                requested_branch = int(requested_branch)
            except (TypeError, ValueError):
                return jsonify({"error": "Invalid branch_id."}), 400

            if not Branch.query.get(requested_branch):
                return jsonify({"error": "Invalid branch_id."}), 400

        allowed_branch_ids = resolve_branch_scope(g.current_user, requested_branch)

        if status_filter not in {'ALL', 'PENDING', 'SENT', 'RECEIVED'}:
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
                StockSupplyRequest.note,
                StockSupplyRequest.status,
                StockSupplyRequest.created_at,
                Branch.name.label('branch_name'),
                func.coalesce(items_summary.c.items_count, 0).label('items_count'),
                func.coalesce(items_summary.c.total_requested_quantity, 0).label('total_requested_quantity'),
            )
            .join(Branch, Branch.id == StockSupplyRequest.branch_id)
            .outerjoin(items_summary, items_summary.c.request_id == StockSupplyRequest.id)
        )

        if allowed_branch_ids:
            query = query.filter(StockSupplyRequest.branch_id.in_(allowed_branch_ids))

        if status_filter != 'ALL':
            query = query.filter(StockSupplyRequest.status == status_filter)

        if date_from_value:
            query = query.filter(
                StockSupplyRequest.created_at >= datetime.combine(date_from_value, datetime.min.time())
            )

        if date_to_value:
            query = query.filter(
                StockSupplyRequest.created_at < datetime.combine(date_to_value + timedelta(days=1), datetime.min.time())
            )

        if q:
            query = query.filter(
                or_(
                    StockSupplyRequest.request_ref.ilike(f"%{q}%"),
                    Branch.name.ilike(f"%{q}%"),
                )
            )

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

        return jsonify({
            "items": [{
                "id": row.id,
                "request_ref": row.request_ref,
                "branch_id": row.branch_id,
                "branch_name": row.branch_name or f"فرع #{row.branch_id}",
                "note": row.note,
                "status": row.status,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "items_count": int(row.items_count or 0),
                "total_requested_quantity": int(row.total_requested_quantity or 0),
            } for row in rows],
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
            "has_more": page < total_pages,
        }), 200
    except ValueError as e:
        return jsonify({"error": str(e) or "Invalid pagination parameters."}), 400
    except HTTPException:
        raise
    except Exception as e:
        print(f"Failed to list admin supply requests: {e}")
        return jsonify({"error": "Failed to list requests", "details": str(e)}), 500


@admin_bp.route('/supply-requests/<int:request_id>', methods=['GET'])
@require_admin
def get_admin_supply_request(request_id):
    from app.models.supply_operations import StockSupplyRequest
    from app.models.product import ProductBranchStock
    try:
        req = StockSupplyRequest.query.get(request_id)
        if not req:
            return jsonify({"error": "الطلب غير موجود."}), 404
            
        main_branch = _get_main_warehouse_branch()
        main_branch_id = main_branch.id if main_branch else None
        
        items_serialized = []
        for item in req.items:
            # Main Store Stock
            main_stock_row = None
            if main_branch_id:
                main_stock_row = ProductBranchStock.query.filter_by(
                    product_id=item.product_id,
                    branch_id=main_branch_id
                ).first()
            main_store_stock = int(main_stock_row.stock_quantity or 0) if main_stock_row else 0
            
            # Destination Branch Stock
            branch_stock_row = ProductBranchStock.query.filter_by(
                product_id=item.product_id,
                branch_id=req.branch_id
            ).first()
            branch_stock = int(branch_stock_row.stock_quantity or 0) if branch_stock_row else 0
            
            items_serialized.append({
                "product_id": item.product_id,
                "product_name": item.product.name if item.product else f"منتج #{item.product_id}",
                "requested_quantity": item.requested_quantity,
                "final_quantity": item.final_quantity,
                "main_store_stock": main_store_stock,
                "branch_stock": branch_stock,
                "is_shortage": main_store_stock < item.requested_quantity
            })
            
        response = {
            "id": req.id,
            "request_ref": req.request_ref,
            "branch_id": req.branch_id,
            "branch_name": req.branch.name if req.branch else f"فرع #{req.branch_id}",
            "note": req.note,
            "status": req.status,
            "created_at": req.created_at.isoformat() if req.created_at else None,
            "items_count": len(req.items),
            "total_requested_quantity": sum(item.requested_quantity for item in req.items),
            "items": items_serialized
        }
        
        return jsonify(response), 200
    except Exception as e:
        print(f"Failed to get admin supply request details: {e}")
        return jsonify({"error": "Failed to get request details", "details": str(e)}), 500


@admin_bp.route('/supply-requests/<int:request_id>', methods=['DELETE'])
@require_admin
def delete_admin_supply_request(request_id):
    from app.models.supply_operations import StockSupplyRequest

    try:
        req_obj = StockSupplyRequest.query.get(request_id)
        if not req_obj:
            return jsonify({"error": "الطلب غير موجود."}), 404

        allowed_branch_ids = resolve_branch_scope(g.current_user, req_obj.branch_id)
        if allowed_branch_ids and req_obj.branch_id not in allowed_branch_ids:
            return jsonify({"error": "Insufficient permissions", "details": "Unauthorized access to this request."}), 403

        if req_obj.status != 'PENDING':
            return jsonify({"error": "Only pending branch requests can be deleted."}), 409

        if req_obj.shipment_id is not None:
            return jsonify({"error": "Only pending branch requests without a shipment can be deleted."}), 409

        db.session.delete(req_obj)
        db.session.commit()

        return jsonify({"status": "success", "message": "Branch request deleted successfully"}), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to delete request", "details": str(e)}), 500


@admin_bp.route('/supply-requests/<int:request_id>/send', methods=['POST'])
@require_admin
def send_supply_request_as_is(request_id):
    from app.models.supply_operations import StockSupplyRequest, StockSupplyRequestItem
    from app.utils.date_utils import get_utc_now
    try:
        req_obj = StockSupplyRequest.query.populate_existing().filter_by(id=request_id).with_for_update().first()
        if not req_obj:
            return jsonify({"error": "الطلب غير موجود."}), 404
        if req_obj.status != 'PENDING':
            return jsonify({"error": "هذا الطلب تم معالجته بالفعل."}), 400

        main_branch = _require_main_warehouse_branch()
        destination_branch = req_obj.branch

        prepared_items = []
        locked_stocks = lock_product_stocks([(item.product_id, main_branch.id) for item in req_obj.items])
        for item in req_obj.items:
            source_stock = locked_stocks[(item.product_id, main_branch.id)]
            available_qty = int(source_stock.stock_quantity or 0) if source_stock else 0

            if item.requested_quantity > available_qty:
                return jsonify({
                    "error": f"الكمية المطلوبة للمنتج {item.product.name} ({item.requested_quantity}) تتجاوز المتاح في المستودع الرئيسي ({available_qty})."
                }), 400

            prepared_items.append({
                "product": item.product,
                "quantity": item.requested_quantity,
                "source_stock": source_stock,
                "available_quantity": available_qty
            })

        shipment, total_qty = _create_stock_shipment(destination_branch, prepared_items, req_obj.note)

        req_obj.status = 'SENT'
        req_obj.shipment_id = shipment.id
        req_obj.sent_at = get_utc_now()

        for item in req_obj.items:
            item.final_quantity = item.requested_quantity

        db.session.commit()

        return jsonify({
            "message": "تمت الموافقة وإرسال الشحنة بنجاح.",
            "shipment_id": shipment.id,
            "shipment_ref": shipment.shipment_ref
        }), 200

    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to send request", "details": str(e)}), 500


@admin_bp.route('/returns', methods=['GET'])
@require_admin
def list_admin_return_requests():
    from sqlalchemy.orm import joinedload
    from app.models.product import Product
    from werkzeug.exceptions import HTTPException

    try:
        requested_branch = request.args.get('branch_id') or 'all'
        date_from_value = _parse_admin_shipment_history_date(request.args.get('date_from'), 'date_from')
        date_to_value = _parse_admin_shipment_history_date(request.args.get('date_to'), 'date_to')

        if date_from_value and date_to_value and date_from_value > date_to_value:
            return jsonify({"error": "date_from cannot be later than date_to."}), 400

        if requested_branch and str(requested_branch).lower() != 'all':
            try:
                requested_branch = int(requested_branch)
            except (TypeError, ValueError):
                return jsonify({"error": "Invalid branch_id."}), 400

            if not Branch.query.get(requested_branch):
                return jsonify({"error": "Invalid branch_id."}), 400

        allowed_branch_ids = resolve_branch_scope(g.current_user, requested_branch)
        if not allowed_branch_ids:
            return jsonify({'error': 'No authorized return branches.'}), 403

        page = max(1, int(request.args.get('page', 1)))
        per_page = min(50, max(1, int(request.args.get('per_page', 15))))
        status_filter = (request.args.get('status') or 'all').strip().upper()
        q = _normalize_optional_text(request.args.get('q'))

        counts_query = StockReturnRequest.query
        if allowed_branch_ids:
            counts_query = counts_query.filter(StockReturnRequest.branch_id.in_(allowed_branch_ids))
        if date_from_value:
            counts_query = counts_query.filter(
                StockReturnRequest.created_at >= datetime.combine(date_from_value, datetime.min.time())
            )
        if date_to_value:
            counts_query = counts_query.filter(
                StockReturnRequest.created_at < datetime.combine(date_to_value + timedelta(days=1), datetime.min.time())
            )

        all_count = counts_query.count()
        pending_count = counts_query.filter_by(status='PENDING').count()
        returned_to_main_count = counts_query.filter_by(status='RETURNED_TO_MAIN').count()
        returned_to_supplier_count = counts_query.filter_by(status='RETURNED_TO_SUPPLIER').count()
        rejected_count = counts_query.filter_by(status='REJECTED').count()

        query = (
            StockReturnRequest.query
            .options(
                joinedload(StockReturnRequest.branch),
                joinedload(StockReturnRequest.product),
                joinedload(StockReturnRequest.created_by_employee),
                joinedload(StockReturnRequest.resolved_by_user),
            )
            .join(Product, Product.id == StockReturnRequest.product_id)
        )

        if allowed_branch_ids:
            query = query.filter(StockReturnRequest.branch_id.in_(allowed_branch_ids))
        if date_from_value:
            query = query.filter(
                StockReturnRequest.created_at >= datetime.combine(date_from_value, datetime.min.time())
            )
        if date_to_value:
            query = query.filter(
                StockReturnRequest.created_at < datetime.combine(date_to_value + timedelta(days=1), datetime.min.time())
            )
        if status_filter != 'ALL':
            query = query.filter(StockReturnRequest.status == status_filter)
        if q:
            query = query.filter(
                or_(
                    StockReturnRequest.return_ref.ilike(f"%{q}%"),
                    Product.name.ilike(f"%{q}%"),
                )
            )

        pagination = query.order_by(
            StockReturnRequest.created_at.desc(),
            StockReturnRequest.id.desc(),
        ).paginate(page=page, per_page=per_page, error_out=False)

        valuations = request_valuations(pagination.items)
        return jsonify({
            "requests": [_serialize_admin_return_request(req, valuation=valuations[req.id]) for req in pagination.items],
            "counts": {
                "all": all_count,
                "pending": pending_count,
                "returned_to_main": returned_to_main_count,
                "returned_to_supplier": returned_to_supplier_count,
                "rejected": rejected_count,
            },
            "pagination": {
                "page": pagination.page,
                "per_page": pagination.per_page,
                "total": pagination.total,
                "pages": pagination.pages,
                "has_next": pagination.has_next,
                "has_prev": pagination.has_prev,
            },
        }), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except HTTPException:
        raise
    except Exception as e:
        print(f"Failed to list return requests: {e}")
        return jsonify({"error": "Failed to list return requests", "details": str(e)}), 500


def _supplier_return_read_query():
    from app.models.product import Product, StockMovement, StockMovementType
    from app.models.return_valuation import ReturnItemValuation
    allowed = _inventory_read_scope()
    branch = request.args.get('branch_id') or 'all'
    scoped = allowed if branch.lower() == 'all' else [int(branch)]
    captured = db.session.query(ReturnItemValuation.id).filter(ReturnItemValuation.stock_movement_id == StockMovement.id).exists()
    # A request's approval movement is not a second independent return document.
    legacy_out = db.and_(StockMovement.quantity_delta < 0,
                         or_(StockMovement.notes.is_(None), ~StockMovement.notes.like('[RET-%')))
    query = (StockMovement.query.options(joinedload(StockMovement.product), joinedload(StockMovement.branch))
             .join(Product, Product.id == StockMovement.product_id)
             .filter(StockMovement.branch_id.in_(scoped), StockMovement.movement_type == StockMovementType.RETURN_TO_SUPPLIER,
                     or_(captured, StockMovement.notes.like('[SUP-RET-%'), legacy_out)))
    return query


def _serialize_supplier_return(movement):
    return dict(id=movement.id, return_ref=_extract_direct_supplier_return_ref(movement.notes) or f'MOV-{movement.id}',
                branch_id=movement.branch_id, branch_name=movement.branch.name if movement.branch else f'فرع #{movement.branch_id}',
                product_id=movement.product_id, product_name=movement.product.name if movement.product else f'منتج #{movement.product_id}',
                quantity=movement.quantity, product_unit=movement.product.unit if movement.product else '',
                created_at=movement.created_at.isoformat(), status='DIRECT_TO_SUPPLIER',
                cost_valuation=supplier_movement_valuation(movement))


@admin_bp.route('/supplier-returns', methods=['GET'])
@require_admin
def list_supplier_return_records():
    from app.models.product import Product, StockMovement
    try:
        query = _supplier_return_read_query()
        page = max(1, int(request.args.get('page', 1)))
        per_page = min(50, max(1, int(request.args.get('per_page', 10))))
        start = _parse_admin_shipment_history_date(request.args.get('date_from'), 'date_from')
        end = _parse_admin_shipment_history_date(request.args.get('date_to'), 'date_to')
        if start and end and start > end:
            return jsonify(error='date_from cannot be later than date_to.'), 400
        for parameter, is_end in [('date_from', False), ('date_to', True)]:
            value = _parse_admin_shipment_history_date(request.args.get(parameter), parameter)
            if value:
                bound = datetime.combine(value + timedelta(days=1) if is_end else value, datetime.min.time())
                query = query.filter(StockMovement.created_at < bound if is_end else StockMovement.created_at >= bound)
        term = (request.args.get('q') or '').strip()
        if term:
            query = query.filter(or_(Product.name.ilike(f'%{term}%'), StockMovement.notes.ilike(f'%{term}%')))
        result = query.order_by(StockMovement.created_at.desc(), StockMovement.id.desc()).paginate(page=page, per_page=per_page, error_out=False)
        return jsonify(items=[_serialize_supplier_return(row) for row in result.items],
                       pagination=dict(page=result.page, pages=result.pages, total=result.total, has_next=result.has_next, has_prev=result.has_prev)), 200
    except ValueError as error:
        return jsonify(error=str(error)), 400


@admin_bp.route('/supplier-returns/<int:movement_id>', methods=['GET'])
@require_admin
def get_supplier_return_record(movement_id):
    from app.models.product import StockMovement
    movement = _supplier_return_read_query().filter(StockMovement.id == movement_id).first_or_404()
    return jsonify(_serialize_supplier_return(movement)), 200


@admin_bp.route('/supplier-returns', methods=['POST'])
@require_admin
@require_role(UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN, UserRole.STORE_MANAGER)
def create_direct_supplier_return():
    from app.models.product import Product, StockMovement, StockMovementType

    try:
        data = request.get_json() or {}

        try:
            product_id = int(data.get('product_id'))
        except (TypeError, ValueError):
            return jsonify({"error": "اختر المنتج"}), 400

        try:
            quantity = int(data.get('quantity'))
        except (TypeError, ValueError):
            return jsonify({"error": "أدخل كمية صحيحة"}), 400

        reason = _normalize_required_text(data.get('reason'))
        notes = _normalize_optional_text(data.get('notes'))

        if not reason:
            return jsonify({"error": "السبب مطلوب"}), 400

        if quantity <= 0:
            return jsonify({"error": "أدخل كمية صحيحة"}), 400

        product = Product.query.filter_by(id=product_id, is_active=True).first()
        if not product:
            return jsonify({"error": "المنتج غير موجود أو غير نشط."}), 404

        main_branch = _require_main_warehouse_branch()
        main_stock = _lock_product_branch_stock(product.id, main_branch.id)
        current_main_stock = int(main_stock.stock_quantity or 0) if main_stock else 0

        if not main_stock or quantity > current_main_stock:
            return jsonify({"error": "الكمية غير متاحة في المخزن الرئيسي"}), 409

        return_ref = _generate_supplier_return_ref()
        movement_note = _build_direct_supplier_return_note(return_ref, reason, notes)

        main_stock_before = current_main_stock
        main_stock.stock_quantity -= quantity
        main_stock_after = int(main_stock.stock_quantity or 0)

        movement = capture_stock_movement(main_stock, main_stock_before,
            product_id=product.id,
            branch_id=main_branch.id,
            movement_type=StockMovementType.RETURN_TO_SUPPLIER,
            quantity=quantity,
            created_by=_resolve_stock_movement_created_by_employee_id(),
            notes=movement_note,
        )
        db.session.add(movement)
        db.session.flush()
        capture_return_cost(product_id=product.id, quantity=quantity, created_at=movement.created_at, stock_movement_id=movement.id)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "تم تسجيل المرتجع للمورد",
            "movement": {
                "id": movement.id,
                "product_id": movement.product_id,
                "product_name": product.name,
                "branch_id": movement.branch_id,
                "branch_name": main_branch.name,
                "movement_type": movement.movement_type.value,
                "quantity": int(movement.quantity or 0),
                "notes": movement.notes,
                "created_at": movement.created_at.isoformat() if movement.created_at else None,
                "reference": return_ref,
            },
            "main_stock_before": main_stock_before,
            "main_stock_after": main_stock_after,
            "cost_valuation": supplier_movement_valuation(movement),
        }), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": str(e) or "بيانات المرتجع غير صحيحة."}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to create direct supplier return", "details": str(e)}), 500


@admin_bp.route('/returns/<int:request_id>', methods=['GET'])
@require_admin
def get_admin_return_request(request_id):
    from sqlalchemy.orm import joinedload
    from app.models.product import ProductBranchStock

    try:
        allowed_branch_ids = resolve_branch_scope(g.current_user, 'all')
        if not allowed_branch_ids:
            return jsonify({'error': 'No authorized return branches.'}), 403
        req_obj = (
            StockReturnRequest.query
            .options(
                joinedload(StockReturnRequest.branch),
                joinedload(StockReturnRequest.product),
                joinedload(StockReturnRequest.created_by_employee),
                joinedload(StockReturnRequest.resolved_by_user),
            )
            .filter_by(id=request_id)
            .first()
        )
        if not req_obj:
            return jsonify({"error": "طلب المرتجع غير موجود."}), 404
        if allowed_branch_ids and req_obj.branch_id not in allowed_branch_ids:
            return jsonify({"error": "طلب المرتجع غير موجود."}), 404

        branch_stock_row = ProductBranchStock.query.filter_by(
            product_id=req_obj.product_id,
            branch_id=req_obj.branch_id,
        ).first()
        current_branch_stock = int(branch_stock_row.stock_quantity or 0) if branch_stock_row else 0

        return jsonify(_serialize_admin_return_request(req_obj, current_branch_stock=current_branch_stock)), 200
    except Exception as e:
        print(f"Failed to get return request: {e}")
        return jsonify({"error": "Failed to get return request details", "details": str(e)}), 500


@admin_bp.route('/returns/<int:request_id>/return-to-main', methods=['POST'])
@require_admin
def resolve_return_request_to_main(request_id):
    try:
        allowed_branch_ids = resolve_branch_scope(g.current_user, 'all')
        if not allowed_branch_ids:
            return jsonify({'error': 'No authorized return branches.'}), 403
        req_obj = (
            StockReturnRequest.query
            .filter_by(id=request_id)
            .with_for_update()
            .first()
        )
        if not req_obj:
            return jsonify({"error": "طلب المرتجع غير موجود."}), 404
        if allowed_branch_ids and req_obj.branch_id not in allowed_branch_ids:
            return jsonify({"error": "طلب المرتجع غير موجود."}), 404

        data = request.get_json() or {}
        resolution_note = _normalize_optional_text(data.get('resolution_note') or data.get('note'))

        if req_obj.status != 'PENDING':
            return jsonify({"error": "تمت معالجة طلب المرتجع بالفعل."}), 409

        _, current_branch_stock = _resolve_return_request(
            req_obj,
            'RETURNED_TO_MAIN',
            resolution_note=resolution_note,
        )
        if current_branch_stock < int(req_obj.requested_quantity or 0):
            db.session.rollback()
            return jsonify({
                "error": "الكمية الحالية غير كافية.",
                "current_branch_stock": current_branch_stock,
            }), 409

        db.session.commit()
        return jsonify({
            "message": "تمت الموافقة وإرجاعه للمخزن",
            "request": _serialize_admin_return_request(req_obj),
        }), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 409
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to resolve return request", "details": str(e)}), 500


@admin_bp.route('/returns/<int:request_id>/return-to-supplier', methods=['POST'])
@require_admin
def resolve_return_request_to_supplier(request_id):
    try:
        allowed_branch_ids = resolve_branch_scope(g.current_user, 'all')
        if not allowed_branch_ids:
            return jsonify({'error': 'No authorized return branches.'}), 403
        req_obj = (
            StockReturnRequest.query
            .filter_by(id=request_id)
            .with_for_update()
            .first()
        )
        if not req_obj:
            return jsonify({"error": "طلب المرتجع غير موجود."}), 404
        if allowed_branch_ids and req_obj.branch_id not in allowed_branch_ids:
            return jsonify({"error": "طلب المرتجع غير موجود."}), 404

        data = request.get_json() or {}
        resolution_note = _normalize_optional_text(data.get('resolution_note') or data.get('note'))

        if req_obj.status != 'PENDING':
            return jsonify({"error": "تمت معالجة طلب المرتجع بالفعل."}), 409

        _, current_branch_stock = _resolve_return_request(
            req_obj,
            'RETURNED_TO_SUPPLIER',
            resolution_note=resolution_note,
        )
        if current_branch_stock < int(req_obj.requested_quantity or 0):
            db.session.rollback()
            return jsonify({
                "error": "الكمية الحالية غير كافية.",
                "current_branch_stock": current_branch_stock,
            }), 409

        db.session.commit()
        return jsonify({
            "message": "تمت الموافقة وإرجاعه للمورد",
            "request": _serialize_admin_return_request(req_obj),
        }), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 409
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to resolve return request", "details": str(e)}), 500


@admin_bp.route('/returns/<int:request_id>/reject', methods=['POST'])
@require_admin
def reject_return_request(request_id):
    try:
        allowed_branch_ids = resolve_branch_scope(g.current_user, 'all')
        if not allowed_branch_ids:
            return jsonify({'error': 'No authorized return branches.'}), 403
        req_obj = (
            StockReturnRequest.query
            .filter_by(id=request_id)
            .with_for_update()
            .first()
        )
        if not req_obj:
            return jsonify({"error": "طلب المرتجع غير موجود."}), 404
        if allowed_branch_ids and req_obj.branch_id not in allowed_branch_ids:
            return jsonify({"error": "طلب المرتجع غير موجود."}), 404
        if req_obj.status != 'PENDING':
            return jsonify({"error": "تمت معالجة طلب المرتجع بالفعل."}), 409

        data = request.get_json() or {}
        resolution_note = _normalize_optional_text(data.get('resolution_note') or data.get('note'))

        req_obj.status = 'REJECTED'
        req_obj.resolution_note = resolution_note
        req_obj.resolved_at = get_utc_now()
        req_obj.resolved_by_user_id = g.current_user.id if hasattr(g, 'current_user') and g.current_user else None

        db.session.commit()
        return jsonify({
            "message": "تم رفض الطلب",
            "request": _serialize_admin_return_request(req_obj),
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to reject return request", "details": str(e)}), 500


# =========================================================================
# BRANCH INVENTORY DRILLDOWN ENDPOINTS (Read-Only)
# =========================================================================

@admin_bp.route('/branches/<int:branch_id>/inventory', methods=['GET'])
@require_admin
def get_branch_inventory_drilldown(branch_id):
    from app.models.branch import Branch
    from app.models.product import ProductBranchStock, Product
    from app.models.inventory_batch import BranchInventoryBatch, InventoryBatch, InventoryBatchStatus
    today = get_cairo_date()
    near_expiry_cutoff = today + timedelta(days=30)

    branch = Branch.query.get_or_404(branch_id)
    if not enforce_branch_isolation(branch_id):
        return jsonify({"message": "Forbidden: access to this branch is restricted."}), 403

    try:
        page = max(1, int(request.args.get('page', 1)))
        per_page = min(100, max(1, int(request.args.get('per_page', 25))))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid pagination parameters."}), 400

    search_query = (request.args.get('q') or request.args.get('search') or '').strip()
    stock_status_filter = (request.args.get('stock_status') or 'all').strip().lower()
    expiry_filter = (request.args.get('expiry') or 'all').strip().lower()
    category_filter = (request.args.get('category_id') or request.args.get('category') or '').strip()
    sort = (request.args.get('sort') or 'name_asc').strip().lower()

    if stock_status_filter not in {'all', 'available', 'low_stock', 'out_of_stock'}:
        return jsonify({"error": "Invalid stock_status filter."}), 400

    if expiry_filter not in {'all', 'expiring_soon', 'expired', 'no_expiry'}:
        return jsonify({"error": "Invalid expiry filter."}), 400

    batch_summary = (
        db.session.query(
            BranchInventoryBatch.product_id.label('product_id'),
            func.min(InventoryBatch.expiration_date).label('nearest_expiry'),
            func.max(BranchInventoryBatch.first_received_at).label('latest_received'),
        )
        .join(InventoryBatch, BranchInventoryBatch.batch_id == InventoryBatch.id)
        .filter(
            BranchInventoryBatch.branch_id == branch_id,
            BranchInventoryBatch.status == InventoryBatchStatus.ACTIVE,
            BranchInventoryBatch.remaining_quantity > 0,
        )
        .group_by(BranchInventoryBatch.product_id)
        .subquery()
    )

    stock_quantity_expr = func.coalesce(ProductBranchStock.stock_quantity, 0)
    nearest_expiry_expr = batch_summary.c.nearest_expiry
    latest_received_expr = batch_summary.c.latest_received
    states = location_stock_states([branch_id])
    low_stock_expr = states.c.stock_status
    sort_status_rank = case(
        (low_stock_expr == 'OUT_OF_STOCK', 0),
        (low_stock_expr == 'LOW_STOCK', 1),
        (low_stock_expr == 'AVAILABLE', 2),
        else_=3,
    )

    query = (
        db.session.query(
            ProductBranchStock.product_id.label('product_id'),
            Product.name.label('name'),
            Product.category.label('category'),
            Product.image_url.label('image_url'),
            Product.selling_price.label('selling_price'),
            Product.min_stock_threshold.label('min_stock_threshold'),
            Product.unit.label('unit'),
            stock_quantity_expr.label('stock_quantity'),
            nearest_expiry_expr.label('nearest_expiry'),
            latest_received_expr.label('latest_received'),
            low_stock_expr.label('status'),
        )
        .join(Product, Product.id == ProductBranchStock.product_id)
        .outerjoin(batch_summary, batch_summary.c.product_id == Product.id)
        .join(states, db.and_(states.c.product_id == ProductBranchStock.product_id,
                              states.c.branch_id == ProductBranchStock.branch_id))
        .filter(
            ProductBranchStock.branch_id == branch_id,
            Product.is_active.is_(True),
        )
    )

    if search_query:
        pattern = f"%{search_query}%"
        query = query.filter(
            or_(
                Product.name.ilike(pattern),
                Product.category.ilike(pattern),
            )
        )

    if category_filter:
        query = query.filter(Product.category == category_filter)

    if stock_status_filter == 'available':
        query = query.filter(low_stock_expr == 'AVAILABLE')
    elif stock_status_filter == 'low_stock':
        query = query.filter(
            stock_quantity_expr > 0,
            stock_quantity_expr <= Product.min_stock_threshold,
        )
    elif stock_status_filter == 'out_of_stock':
        query = query.filter(low_stock_expr == 'OUT_OF_STOCK')

    if expiry_filter == 'expiring_soon':
        query = query.filter(
            nearest_expiry_expr.isnot(None),
            nearest_expiry_expr >= today,
            nearest_expiry_expr <= near_expiry_cutoff,
        )
    elif expiry_filter == 'expired':
        query = query.filter(
            nearest_expiry_expr.isnot(None),
            nearest_expiry_expr < today,
        )
    elif expiry_filter == 'no_expiry':
        query = query.filter(nearest_expiry_expr.is_(None))

    summary_row = query.order_by(None).with_entities(
        func.count(ProductBranchStock.product_id).label('total_products'),
        func.coalesce(func.sum(stock_quantity_expr), 0).label('total_quantity'),
        func.coalesce(
            func.sum(
                case(
                    (stock_quantity_expr > 0, stock_quantity_expr),
                    else_=0
                ) * func.coalesce(Product.cost_price, 0.0)
            ),
            0.0
        ).label('total_cost_value'),
        func.coalesce(
            func.sum(
                case(
                    (
                        (stock_quantity_expr > 0) & (stock_quantity_expr <= Product.min_stock_threshold),
                        1,
                    ),
                    else_=0,
                )
            ),
            0,
        ).label('low_stock_products'),
        func.coalesce(
            func.sum(case((low_stock_expr == 'OUT_OF_STOCK', 1), else_=0)),
            0,
        ).label('out_of_stock_products'),
        func.coalesce(
            func.sum(
                case(
                    (
                        nearest_expiry_expr.isnot(None) & (nearest_expiry_expr < today),
                        1,
                    ),
                    else_=0,
                )
            ),
            0,
        ).label('expired_products'),
    ).first()

    sort_clauses = {
        'name_asc': [Product.name.asc(), ProductBranchStock.product_id.asc()],
        'name_desc': [Product.name.desc(), ProductBranchStock.product_id.desc()],
        'stock_desc': [stock_quantity_expr.desc(), Product.name.asc(), ProductBranchStock.product_id.asc()],
        'stock_asc': [stock_quantity_expr.asc(), Product.name.asc(), ProductBranchStock.product_id.asc()],
        'expiry_asc': [nearest_expiry_expr.asc().nullslast(), Product.name.asc(), ProductBranchStock.product_id.asc()],
        'expiry_desc': [nearest_expiry_expr.desc().nullslast(), Product.name.asc(), ProductBranchStock.product_id.asc()],
        'latest_received_desc': [latest_received_expr.desc().nullslast(), Product.name.asc(), ProductBranchStock.product_id.asc()],
        'latest_received_asc': [latest_received_expr.asc().nullslast(), Product.name.asc(), ProductBranchStock.product_id.asc()],
        'status_attention': [sort_status_rank.asc(), Product.name.asc(), ProductBranchStock.product_id.asc()],
    }
    query = query.order_by(*sort_clauses.get(sort, sort_clauses['name_asc']))

    total = int(summary_row.total_products or 0) if summary_row else 0
    total_pages = (total + per_page - 1) // per_page if total > 0 else 0
    if total_pages > 0 and page > total_pages:
        page = total_pages

    rows = query.limit(per_page).offset((page - 1) * per_page).all()

    items = []
    for row in rows:
        days_remaining = None
        if row.nearest_expiry:
            days_remaining = (row.nearest_expiry - today).days

        items.append({
            "product_id": row.product_id,
            "name": row.name,
            "category": row.category,
            "image_url": row.image_url,
            "selling_price": float(row.selling_price or 0),
            "min_stock_threshold": int(row.min_stock_threshold or 0),
            "unit": row.unit,
            "stock_quantity": int(row.stock_quantity or 0),
            "status": row.status,
            "nearest_expiry": row.nearest_expiry.isoformat() if row.nearest_expiry else None,
            "days_remaining": days_remaining,
            "latest_received_date": row.latest_received.isoformat() if row.latest_received else None,
        })

    summary_payload = {
        "branch_id": branch_id,
        "branch_name": branch.name,
        "total_products": int(summary_row.total_products or 0) if summary_row else 0,
        "total_quantity": int(summary_row.total_quantity or 0) if summary_row else 0,
        "total_units": int(summary_row.total_quantity or 0) if summary_row else 0,
        "total_cost_value": round(float(summary_row.total_cost_value or 0.0), 2) if summary_row else 0.0,
        "low_stock_products": int(summary_row.low_stock_products or 0) if summary_row else 0,
        "low_stock_count": int(summary_row.low_stock_products or 0) if summary_row else 0,
        "out_of_stock_products": int(summary_row.out_of_stock_products or 0) if summary_row else 0,
        "expired_products": int(summary_row.expired_products or 0) if summary_row else 0,
    }

    return jsonify({
        "items": items,
        "products": items,
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": total_pages,
        "has_more": page < total_pages,
        "summary": summary_payload,
    }), 200


@admin_bp.route('/branches/<int:branch_id>/inventory/products/<int:product_id>/details', methods=['GET'])
@require_admin
def get_branch_product_details(branch_id, product_id):
    from app.models.branch import Branch
    from app.models.product import Product
    from app.models.inventory_batch import BranchInventoryBatch, InventoryBatch, InventoryBatchStatus
    from datetime import date
    
    # 1. Authorize
    Branch.query.get_or_404(branch_id)
    if not enforce_branch_isolation(branch_id):
        return jsonify({"message": "Forbidden: access to this branch is restricted."}), 403
        
    product = Product.query.get_or_404(product_id)
    
    # 2. Get active batches of this product in this branch
    branch_batches = BranchInventoryBatch.query.join(InventoryBatch).filter(
        BranchInventoryBatch.branch_id == branch_id,
        BranchInventoryBatch.product_id == product_id,
        BranchInventoryBatch.status == InventoryBatchStatus.ACTIVE,
        BranchInventoryBatch.remaining_quantity > 0
    ).all()
    
    today = date.today()
    serialized_batches = []
    
    for bb in branch_batches:
        batch = bb.batch
        days_remaining = None
        if batch.expiration_date:
            days_remaining = (batch.expiration_date - today).days
            
        serialized_batches.append({
            "batch_number": batch.batch_number,
            "remaining_quantity": bb.remaining_quantity,
            "purchase_date": batch.purchase_date.isoformat() if batch.purchase_date else None,
            "received_date": bb.first_received_at.isoformat(),
            "expiry_date": batch.expiration_date.isoformat() if batch.expiration_date else None,
            "days_remaining": days_remaining,
            "status": bb.status.value
        })
        
    return jsonify({
        "product": {
            "id": product.id,
            "name": product.name,
            "category": product.category,
            "unit": product.unit
        },
        "batches": serialized_batches
    }), 200


@admin_bp.route('/branches/<int:branch_id>/inventory/activity', methods=['GET'])
@require_admin
def get_branch_inventory_activity(branch_id):
    from app.models.branch import Branch
    from app.models.product import StockMovement, StockMovementType, Product
    from datetime import datetime, timezone, timedelta
    
    # 1. Authorize
    Branch.query.get_or_404(branch_id)
    if not enforce_branch_isolation(branch_id):
        return jsonify({"message": "Forbidden: access to this branch is restricted."}), 403
        
    # 2. Get Filters and Pagination parameters
    date_filter = request.args.get('date_filter', 'all').strip()  # all, today, yesterday, last_7_days, this_month, custom
    start_date_str = request.args.get('start_date', '').strip()
    end_date_str = request.args.get('end_date', '').strip()
    movement_type_filter = request.args.get('type', 'all').strip()  # all, sales, consumption
    search_query = request.args.get('search', '').strip()
    
    page, per_page = _parse_admin_bounded_pagination(default_per_page=10, max_per_page=50)
        
    # 3. Base Query
    query = StockMovement.query.join(Product).filter(
        StockMovement.branch_id == branch_id,
        StockMovement.movement_type.in_([
            StockMovementType.PRODUCT_SALE,
            StockMovementType.INTERNAL_CONSUMPTION
        ])
    )
    
    # Apply filters
    if movement_type_filter == 'sales':
        query = query.filter(StockMovement.movement_type == StockMovementType.PRODUCT_SALE)
    elif movement_type_filter == 'consumption':
        query = query.filter(StockMovement.movement_type == StockMovementType.INTERNAL_CONSUMPTION)
        
    if search_query:
        query = query.filter(Product.name.ilike(f"%{search_query}%"))
        
    # Date filter
    now_utc = datetime.now(timezone.utc)
    if date_filter == 'today':
        start_date = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
        query = query.filter(StockMovement.created_at >= start_date)
    elif date_filter == 'yesterday':
        start_date = (now_utc - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = start_date + timedelta(days=1)
        query = query.filter(StockMovement.created_at >= start_date, StockMovement.created_at < end_date)
    elif date_filter == 'last_7_days':
        start_date = now_utc - timedelta(days=7)
        query = query.filter(StockMovement.created_at >= start_date)
    elif date_filter == 'this_month':
        start_date = now_utc.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        query = query.filter(StockMovement.created_at >= start_date)
    elif date_filter == 'custom' and start_date_str and end_date_str:
        try:
            start_date = datetime.fromisoformat(start_date_str).replace(tzinfo=timezone.utc)
            end_date = datetime.fromisoformat(end_date_str).replace(tzinfo=timezone.utc)
            query = query.filter(StockMovement.created_at >= start_date, StockMovement.created_at <= end_date)
        except ValueError:
            pass

    # 4. Calculate Summary (total sales units, total consumption units) BEFORE pagination
    summary_stats = db.session.query(
        StockMovement.movement_type,
        db.func.sum(StockMovement.quantity).label('total_qty')
    ).select_from(StockMovement).join(Product).filter(
        StockMovement.branch_id == branch_id,
        StockMovement.movement_type.in_([
            StockMovementType.PRODUCT_SALE,
            StockMovementType.INTERNAL_CONSUMPTION
        ])
    )
    
    # Re-apply same filters on summary
    if movement_type_filter == 'sales':
        summary_stats = summary_stats.filter(StockMovement.movement_type == StockMovementType.PRODUCT_SALE)
    elif movement_type_filter == 'consumption':
        summary_stats = summary_stats.filter(StockMovement.movement_type == StockMovementType.INTERNAL_CONSUMPTION)
        
    if search_query:
        summary_stats = summary_stats.filter(Product.name.ilike(f"%{search_query}%"))
        
    if date_filter == 'today':
        summary_stats = summary_stats.filter(StockMovement.created_at >= now_utc.replace(hour=0, minute=0, second=0, microsecond=0))
    elif date_filter == 'yesterday':
        start_date = (now_utc - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = start_date + timedelta(days=1)
        summary_stats = summary_stats.filter(StockMovement.created_at >= start_date, StockMovement.created_at < end_date)
    elif date_filter == 'last_7_days':
        summary_stats = summary_stats.filter(StockMovement.created_at >= now_utc - timedelta(days=7))
    elif date_filter == 'this_month':
        summary_stats = summary_stats.filter(StockMovement.created_at >= now_utc.replace(day=1, hour=0, minute=0, second=0, microsecond=0))
    elif date_filter == 'custom' and start_date_str and end_date_str:
        try:
            start_date = datetime.fromisoformat(start_date_str).replace(tzinfo=timezone.utc)
            end_date = datetime.fromisoformat(end_date_str).replace(tzinfo=timezone.utc)
            summary_stats = summary_stats.filter(StockMovement.created_at >= start_date, StockMovement.created_at <= end_date)
        except ValueError:
            pass
            
    summary_results = summary_stats.group_by(StockMovement.movement_type).all()
    
    total_sales_units = 0
    total_consumption_units = 0
    for row in summary_results:
        if row.movement_type == StockMovementType.PRODUCT_SALE:
            total_sales_units = int(row.total_qty or 0)
        elif row.movement_type == StockMovementType.INTERNAL_CONSUMPTION:
            total_consumption_units = int(row.total_qty or 0)
            
    # 5. Fetch paginated items
    pagination_obj = query.order_by(StockMovement.created_at.desc(), StockMovement.id.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )
    
    serialized_items = []
    for act in pagination_obj.items:
        invoice_number = None
        if act.invoice:
            invoice_number = act.invoice.invoice_number
            
        employee_name = None
        if act.employee:
            employee_name = act.employee.full_name
            
        serialized_items.append({
            "id": act.id,
            "product_id": act.product_id,
            "product_name": act.product.name,
            "movement_type": act.movement_type.value,
            "quantity": act.quantity,
            "created_at": act.created_at.isoformat(),
            "invoice_number": invoice_number,
            "employee_name": employee_name,
            "notes": act.notes
        })
        
    return jsonify({
        "items": serialized_items,
        "summary": {
            "total_sales_units": total_sales_units,
            "total_consumption_units": total_consumption_units
        },
        "pagination": {
            "page": pagination_obj.page,
            "per_page": pagination_obj.per_page,
            "total_items": pagination_obj.total,
            "total_pages": pagination_obj.pages,
            "has_next": pagination_obj.has_next,
            "has_prev": pagination_obj.has_prev,
        }
    }), 200


def _parse_admin_shipment_history_date(raw_value, param_name):
    if raw_value is None or str(raw_value).strip() == '':
        return None

    try:
        return date.fromisoformat(str(raw_value).strip()[:10])
    except ValueError:
        raise ValueError(f"Invalid {param_name}. Expected YYYY-MM-DD.")


def _apply_admin_shipment_history_filters(
    query,
    allowed_branch_ids,
    *,
    date_from_value=None,
    date_to_value=None,
    shipment_status=None,
    shipment_type=None,
    search_query=None,
):
    if allowed_branch_ids:
        query = query.filter(StockShipment.destination_branch_id.in_(allowed_branch_ids))

    if date_from_value:
        query = query.filter(
            StockShipment.created_at >= datetime.combine(date_from_value, datetime.min.time())
        )

    if date_to_value:
        query = query.filter(
            StockShipment.created_at < datetime.combine(date_to_value + timedelta(days=1), datetime.min.time())
        )

    if shipment_type:
        query = query.filter_by(shipment_type=shipment_type)

    if shipment_status and shipment_status != 'ALL':
        query = query.filter_by(status=shipment_status)

    if search_query:
        query = query.filter(StockShipment.shipment_ref.ilike(f"%{search_query}%"))

    return query


@admin_bp.route('/shipments', methods=['GET'])
@require_admin
def list_admin_shipments():
    from sqlalchemy.orm import joinedload
    from werkzeug.exceptions import HTTPException

    try:
        page, per_page = _parse_admin_bounded_pagination(default_per_page=15, max_per_page=50)
        requested_branch_id = request.args.get('branch_id') or 'all'
        raw_status = (request.args.get('status') or '').strip().upper()
        legacy_filter = (request.args.get('filter') or '').strip().upper()
        q = (request.args.get('q') or '').strip() or None
        date_from_raw = request.args.get('date_from')
        date_to_raw = request.args.get('date_to')

        if date_from_raw is None or str(date_from_raw).strip() == '':
            date_from_raw = request.args.get('start_date')
        if date_to_raw is None or str(date_to_raw).strip() == '':
            date_to_raw = request.args.get('end_date')

        date_from_value = _parse_admin_shipment_history_date(date_from_raw, 'date_from')
        date_to_value = _parse_admin_shipment_history_date(date_to_raw, 'date_to')

        if date_from_value and date_to_value and date_from_value > date_to_value:
            return jsonify({"error": "date_from cannot be later than date_to."}), 400

        if requested_branch_id and str(requested_branch_id).lower() != 'all':
            try:
                requested_branch_id = int(requested_branch_id)
            except (TypeError, ValueError):
                return jsonify({"error": "Invalid branch_id."}), 400

            if not Branch.query.get(requested_branch_id):
                return jsonify({"error": "Invalid branch_id."}), 400

            allowed_branch_ids = resolve_branch_scope(g.current_user, requested_branch_id)
        else:
            allowed_branch_ids = resolve_branch_scope(g.current_user, 'all')

        shipment_status = 'ALL'
        shipment_type = None

        if raw_status:
            if raw_status not in {'ALL', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'}:
                return jsonify({"error": "Invalid status filter."}), 400
            shipment_status = raw_status
        elif legacy_filter in {'IN_TRANSIT', 'RECEIVED', 'CANCELLED'}:
            shipment_status = legacy_filter
        elif legacy_filter in {'OUTBOUND_TRANSFER', 'INBOUND_SUPPLY'}:
            shipment_type = legacy_filter

        counts_query = _apply_admin_shipment_history_filters(
            StockShipment.query,
            allowed_branch_ids,
            date_from_value=date_from_value,
            date_to_value=date_to_value,
            search_query=q,
        )
        all_count = counts_query.count()
        outbound_transfer_count = counts_query.filter_by(shipment_type='OUTBOUND_TRANSFER').count()
        inbound_supply_count = counts_query.filter_by(shipment_type='INBOUND_SUPPLY').count()
        in_transit_count = counts_query.filter_by(status='IN_TRANSIT').count()
        received_count = counts_query.filter_by(status='RECEIVED').count()
        cancelled_count = counts_query.filter_by(status='CANCELLED').count()

        query = StockShipment.query.options(
            joinedload(StockShipment.source_branch),
            joinedload(StockShipment.destination_branch),
            joinedload(StockShipment.created_by_user),
            joinedload(StockShipment.received_by_employee),
            joinedload(StockShipment.items).joinedload(StockShipmentItem.product)
        )

        query = _apply_admin_shipment_history_filters(
            query,
            allowed_branch_ids,
            date_from_value=date_from_value,
            date_to_value=date_to_value,
            shipment_status=shipment_status,
            shipment_type=shipment_type,
            search_query=q,
        )

        query = query.order_by(StockShipment.created_at.desc(), StockShipment.id.desc())
        pagination = query.paginate(page=page, per_page=per_page, error_out=False)

        serialized_shipments = []
        for shipment in pagination.items:
            items_list = _serialize_shipment_items(shipment.items)
            summary = _resolve_shipment_summary(shipment, items_list)

            serialized_shipments.append({
                'id': shipment.id,
                'shipment_ref': shipment.shipment_ref,
                'shipment_type': shipment.shipment_type or 'OUTBOUND_TRANSFER',
                'status': shipment.status,
                'note': shipment.note,
                'supplier_name_snapshot': shipment.supplier_name_snapshot,
                'created_at': shipment.created_at.isoformat() if shipment.created_at else None,
                'received_at': shipment.received_at.isoformat() if shipment.received_at else None,
                'source_branch': _serialize_shipment_branch(shipment.source_branch_id, shipment.source_branch),
                'destination_branch': _serialize_shipment_branch(shipment.destination_branch_id, shipment.destination_branch),
                'created_by': {
                    'id': shipment.created_by_user_id,
                    'full_name': shipment.created_by_user.full_name if shipment.created_by_user else None,
                },
                'received_by': {
                    'id': shipment.received_by_employee_id,
                    'name': shipment.received_by_employee.full_name if shipment.received_by_employee else None,
                } if shipment.received_by_employee_id else None,
                'products_count': summary['products_count'],
                'pieces_count': summary['pieces_count'],
                'total_cost_snapshot': summary['total_cost_snapshot'],
                'items_count': summary['products_count'],
                'total_quantity': summary['pieces_count'],
                'total_cost_amount': summary['total_cost_snapshot'],
                'items_preview': items_list[:3],
            })

        return jsonify({
            'shipments': serialized_shipments,
            'counts': {
                'all': all_count,
                'outbound_transfer': outbound_transfer_count,
                'inbound_supply': inbound_supply_count,
                'in_transit': in_transit_count,
                'received': received_count,
                'cancelled': cancelled_count,
            },
            'pagination': {
                'page': pagination.page,
                'per_page': pagination.per_page,
                'total': pagination.total,
                'pages': pagination.pages,
                'has_next': pagination.has_next,
                'has_prev': pagination.has_prev,
            }
        }), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except HTTPException:
        raise
    except Exception as e:
        return jsonify({"error": "Failed to list shipments", "details": str(e)}), 500


@admin_bp.route('/shipments', methods=['POST'])
@admin_bp.route('/transfers/bulk', methods=['POST'])
@require_admin
def create_bulk_transfer():
    from app.models.product import Product

    try:
        data = request.get_json() or {}
        destination_branch_id = data.get('destination_branch_id')
        raw_items = data.get('items')
        note = _normalize_optional_text(data.get('note'))

        try:
            destination_branch_id = int(destination_branch_id)
        except (TypeError, ValueError):
            return jsonify({"error": "يجب اختيار الفرع الوجهة."}), 400

        if not isinstance(raw_items, list) or len(raw_items) == 0:
            return jsonify({"error": "يجب إضافة منتج واحد على الأقل إلى الشحنة."}), 400

        main_branch = _require_main_warehouse_branch()
        destination_branch = Branch.query.filter_by(id=destination_branch_id, is_active=True).first()

        if not destination_branch:
            return jsonify({"error": "الفرع الوجهة غير موجود."}), 404
        if destination_branch.is_main_warehouse:
            return jsonify({"error": "لا يمكن التحويل إلى المستودع الرئيسي."}), 400
        if int(destination_branch.id) == int(main_branch.id):
            return jsonify({"error": "لا يمكن التحويل إلى نفس مصدر المخزون."}), 400

        aggregated_items = {}
        for raw_item in raw_items:
            if not isinstance(raw_item, dict):
                return jsonify({"error": "بيانات الشحنة غير صحيحة."}), 400

            try:
                product_id = int(raw_item.get('product_id'))
                quantity = int(raw_item.get('quantity'))
            except (TypeError, ValueError):
                return jsonify({"error": "بيانات المنتج أو الكمية غير صحيحة."}), 400

            if quantity <= 0:
                return jsonify({"error": "كمية كل منتج يجب أن تكون أكبر من الصفر."}), 400

            aggregated_items[product_id] = aggregated_items.get(product_id, 0) + quantity

        product_ids = sorted(aggregated_items.keys())
        products = Product.query.filter(Product.id.in_(product_ids)).all()
        products_by_id = {product.id: product for product in products}
        missing_product_ids = [product_id for product_id in product_ids if product_id not in products_by_id]

        if missing_product_ids:
            return jsonify({"error": "بعض المنتجات المطلوبة غير موجودة."}), 404

        prepared_items = []
        for product_id in product_ids:
            product = products_by_id[product_id]
            requested_quantity = aggregated_items[product_id]
            source_stock = _lock_product_branch_stock(product_id, main_branch.id)
            available_quantity = int(source_stock.stock_quantity or 0) if source_stock else 0

            if requested_quantity > available_quantity:
                return jsonify({
                    "error": f"الكمية المطلوبة للمنتج {product.name} غير متاحة في المستودع الرئيسي."
                }), 400

            prepared_items.append({
                "product": product,
                "quantity": requested_quantity,
                "source_stock": source_stock,
                "available_quantity": available_quantity,
            })

        shipment, total_quantity = _create_stock_shipment(destination_branch, prepared_items, note)

        db.session.commit()

        return jsonify({
            "message": "تم إرسال الشحنة إلى الفرع.",
            "shipment_id": shipment.id,
            "shipment_ref": shipment.shipment_ref,
            "status": shipment.status,
            "transfer_ref": shipment.shipment_ref,
            "destination_branch": {
                "id": destination_branch.id,
                "name": destination_branch.name,
            },
            "items_count": len(prepared_items),
            "total_quantity": total_quantity,
            "items": [{
                "product_id": item["product"].id,
                "product_name": item["product"].name,
                "quantity": item["quantity"],
                "image_url": item["product"].image_url,
                "remaining_main_warehouse_stock": int(item["source_stock"].stock_quantity or 0),
            } for item in prepared_items]
        }), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": str(e) or "تعذر تنفيذ إنشاء الشحنة المخزنية."}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to create shipment", "details": str(e)}), 500

@admin_bp.route('/shipments/<int:shipment_id>/cancel', methods=['POST'])
@require_admin
@require_role(UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN)
def cancel_admin_shipment(shipment_id):
    from sqlalchemy.exc import IntegrityError
    from app.services.shipment_cancellation import cancel_shipment, ShipmentCancellationConflict

    try:
        data = request.get_json(silent=True)
        if (data is not None and not isinstance(data, dict)) or (request.get_data() and data is None):
            return jsonify({'error': 'بيانات الإلغاء غير صحيحة.'}), 400
        reason = (data or {}).get('reason')
        if reason is not None and (not isinstance(reason, str) or len(reason) > 2000):
            return jsonify({'error': 'سبب الإلغاء يجب أن يكون نصاً لا يتجاوز ٢٠٠٠ حرف.'}), 400
        reason = _normalize_optional_text(reason)
        shipment = (StockShipment.query.populate_existing().filter_by(id=shipment_id)
                    .with_for_update().first())
        if shipment is None:
            return jsonify({'error': 'الشحنة غير موجودة.'}), 404
        cancel_shipment(shipment, user_id=g.current_user.id, reason=reason)
        db.session.commit()
        return jsonify({
            'message': 'تم إلغاء الشحنة وإعادة الكميات إلى مخزون المصدر الأصلي.',
            'shipment_id': shipment.id, 'status': shipment.status,
            'cancelled_at': shipment.cancelled_at.isoformat(),
            'cancelled_by_user_id': shipment.cancelled_by_user_id,
            'cancellation_reason': shipment.cancellation_reason,
            'cancelled_by_name': g.current_user.full_name,
        }), 200
    except ShipmentCancellationConflict as error:
        db.session.rollback()
        return jsonify({'error': str(error)}), 409
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'تعذر الإلغاء بسبب تعارض في حركات المخزون؛ لم تتغير أي كميات.'}), 409
    except Exception:
        db.session.rollback()
        current_app.logger.exception('Shipment cancellation failed: %s', shipment_id)
        return jsonify({'error': 'تعذر إلغاء الشحنة؛ لم تتغير أي كميات.'}), 500


@admin_bp.route('/shipments/<int:shipment_id>', methods=['GET'])
@require_admin
def get_admin_shipment_details(shipment_id):
    from sqlalchemy.orm import joinedload

    try:
        allowed_branch_ids = resolve_branch_scope(g.current_user, 'all')
        shipment = (
            StockShipment.query
            .options(
                joinedload(StockShipment.source_branch),
                joinedload(StockShipment.destination_branch),
                joinedload(StockShipment.created_by_user),
                joinedload(StockShipment.received_by_employee),
                joinedload(StockShipment.items).joinedload(StockShipmentItem.product)
            )
            .filter_by(id=shipment_id)
            .first()
        )

        if not shipment:
            return jsonify({"error": "الشحنة غير موجودة."}), 404

        if allowed_branch_ids and shipment.destination_branch_id not in allowed_branch_ids:
            return jsonify({"error": "الشحنة غير موجودة."}), 404

        items = _serialize_shipment_items(shipment.items)
        summary = _resolve_shipment_summary(shipment, items)

        return jsonify({
            'id': shipment.id,
            'shipment_ref': shipment.shipment_ref,
            'shipment_type': shipment.shipment_type or 'OUTBOUND_TRANSFER',
            'status': shipment.status,
            'note': shipment.note,
            'supplier_name_snapshot': shipment.supplier_name_snapshot,
            'created_at': shipment.created_at.isoformat() if shipment.created_at else None,
            'received_at': shipment.received_at.isoformat() if shipment.received_at else None,
            'cancelled_at': shipment.cancelled_at.isoformat() if shipment.cancelled_at else None,
            'cancelled_by_user_id': shipment.cancelled_by_user_id,
            'cancelled_by_name': shipment.cancelled_by_user.full_name if shipment.cancelled_by_user else None,
            'cancellation_reason': shipment.cancellation_reason,
            'can_cancel': (g.current_user.role in {UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN}
                           and shipment.shipment_type == 'OUTBOUND_TRANSFER' and shipment.status == 'IN_TRANSIT'),
            'source_branch': _serialize_shipment_branch(shipment.source_branch_id, shipment.source_branch),
            'destination_branch': _serialize_shipment_branch(shipment.destination_branch_id, shipment.destination_branch),
            'created_by': {
                'id': shipment.created_by_user_id,
                'full_name': shipment.created_by_user.full_name if shipment.created_by_user else None,
            },
            'received_by': {
                'id': shipment.received_by_employee_id,
                'name': shipment.received_by_employee.full_name if shipment.received_by_employee else None,
            } if shipment.received_by_employee_id else None,
            'products_count': summary['products_count'],
            'pieces_count': summary['pieces_count'],
            'total_cost_snapshot': summary['total_cost_snapshot'],
            'items_count': summary['products_count'],
            'total_quantity': summary['pieces_count'],
            'total_cost_amount': summary['total_cost_snapshot'],
            'items': items,
        }), 200
    except ValueError as e:
        return jsonify({"error": str(e) or "تعذر تحميل بيانات الشحنة."}), 400
    except Exception as e:
        return jsonify({"error": "Failed to fetch shipment details", "details": str(e)}), 500

@admin_bp.route('/shipments/recent', methods=['GET'])
@admin_bp.route('/transfers/recent', methods=['GET'])
@require_admin
def list_recent_bulk_transfers():
    try:
        allowed_branch_ids = _inventory_read_scope()
        unique_limit = _parse_admin_recent_activity_limit()
        response = _build_recent_inventory_activity_response(allowed_branch_ids, unique_limit)
        return jsonify(response), 200
    except HTTPException as error:
        return jsonify({"error": error.description}), error.code
    except Exception as e:
        return jsonify({"error": "Failed to fetch recent transfers", "details": str(e)}), 500

@admin_bp.route('/products', methods=['POST'])
@require_admin
def create_admin_product():
    from app.models.product import Product, ProductBranchStock, StockMovement, StockMovementType
    from datetime import datetime, timezone
    try:
        if request.content_type and 'multipart/form-data' in request.content_type:
            data = request.form
            file = request.files.get('image')
        else:
            data = request.get_json() or {}
            file = None

        name = _normalize_required_text(data.get('name'))
        category = _normalize_required_text(data.get('category'))
        unit = _normalize_required_text(data.get('unit')) or 'pcs'
        raw_pieces_per_unit = data.get('pieces_per_unit')
        pieces_per_unit = int(1 if raw_pieces_per_unit is None else raw_pieces_per_unit)
        supplier_name = _normalize_optional_text(data.get('supplier_name'))
        expiry_date_str = data.get('expiry_date')
        selling_price = float(data.get('selling_price') or 0.0)
        cost_price = float(data.get('cost_price') or 0.0)
        sales_commission_percent = max(0.0, float(data.get('sales_commission_percent', 0.0) or 0.0))
        raw_min_stock_threshold = data.get('min_stock_threshold')
        min_stock_threshold = int(5 if raw_min_stock_threshold is None else raw_min_stock_threshold)
        opening_quantity = int(data.get('opening_quantity') or 0)
        image_url = _normalize_optional_text(data.get('image_url'))
        is_active_raw = data.get('is_active', True)
        if isinstance(is_active_raw, str):
            is_active = is_active_raw.lower() in ('true', '1', 'yes')
        else:
            is_active = bool(is_active_raw)
        main_branch = _require_main_warehouse_branch()
        
        if not name or not category:
            return jsonify({"error": "الاسم، القسم، والوحدة مطلوبة."}), 400
        if not main_branch:
            return jsonify({"error": "لم يتم تعيين المخزن الرئيسي بعد. يرجى مراجعة الفروع."}), 400
        if pieces_per_unit < 1 or min_stock_threshold < 0 or selling_price < 0 or cost_price < 0 or opening_quantity < 0:
            return jsonify({"error": "بيانات المنتج غير صحيحة. يرجى مراجعة القيم المدخلة."}), 400
            
        expiry_date = None
        if expiry_date_str:
            try:
                expiry_date = datetime.strptime(str(expiry_date_str).split('T')[0], "%Y-%m-%d").date()
            except ValueError:
                return jsonify({"error": "تنسيق تاريخ الصلاحية غير صحيح."}), 400

        purchase_date_str = data.get('purchase_date')
        purchase_date = None
        if purchase_date_str:
            try:
                purchase_date = datetime.strptime(str(purchase_date_str).split('T')[0], "%Y-%m-%d").date()
            except ValueError:
                return jsonify({"error": "تنسيق تاريخ الشراء غير صحيح."}), 400
            
        product = Product(
            name=name,
            category=category,
            unit=unit,
            pieces_per_unit=pieces_per_unit,
            supplier_name=supplier_name,
            expiry_date=expiry_date,
            selling_price=selling_price,
            cost_price=cost_price,
            sales_commission_percent=sales_commission_percent,
            min_stock_threshold=min_stock_threshold,
            is_active=is_active,
            image_url=image_url
        )
        db.session.add(product)
        db.session.flush() # Get product.id

        if file:
            from app.utils.upload_utils import save_product_image
            product.image_url = save_product_image(file, product.id)
        
        active_branches = Branch.query.all()
        # Product creation prepares branch rows, but opening stock belongs to main store only.
        for branch in active_branches:
            stock = ProductBranchStock(
                product_id=product.id,
                branch_id=branch.id,
                stock_quantity=opening_quantity if branch.id == main_branch.id else 0,
                is_available=True
            )
            db.session.add(stock)

        if opening_quantity > 0:
            current_user_id = g.current_user.id if hasattr(g, 'current_user') and g.current_user else None
            opening_stock = next(row for row in product.branch_stocks if row.branch_id == main_branch.id)
            db.session.add(capture_stock_movement(opening_stock, 0,
                product_id=product.id,
                branch_id=main_branch.id,
                movement_type=StockMovementType.SUPPLY_IN,
                quantity=opening_quantity,
                created_by=_resolve_stock_movement_created_by_employee_id(),
                notes="رصيد افتتاحي من إنشاء المنتج"
            ))
            
            from app.models.inventory_batch import InventoryBatch, BranchInventoryBatch, InventoryBatchSourceType
            import uuid
            
            batch_number = f"OPEN-{datetime.now(timezone.utc).strftime('%y%m%d%H%M')}-{product.id}-{uuid.uuid4().hex[:4].upper()}"
            
            new_batch = InventoryBatch(
                product_id=product.id,
                batch_number=batch_number,
                expiration_date=expiry_date,
                purchase_date=purchase_date,
                supplier_name_snapshot=supplier_name,
                initial_quantity=opening_quantity,
                source_type=InventoryBatchSourceType.OPENING_BALANCE,
                created_branch_id=main_branch.id,
                created_by_user_id=current_user_id
            )
            db.session.add(new_batch)
            db.session.flush()

            branch_batch = BranchInventoryBatch(
                batch_id=new_batch.id,
                branch_id=main_branch.id,
                product_id=product.id,
                remaining_quantity=opening_quantity
            )
            db.session.add(branch_batch)
            
        db.session.commit()
        return jsonify({
            "id": product.id,
            "name": product.name,
            "category": product.category,
            "unit": product.unit,
            "pieces_per_unit": product.pieces_per_unit,
            "supplier_name": product.supplier_name,
            "expiry_date": product.expiry_date.isoformat() if product.expiry_date else None,
            "selling_price": product.selling_price,
            "cost_price": product.cost_price,
            "sales_commission_percent": float(product.sales_commission_percent or 0),
            "min_stock_threshold": product.min_stock_threshold,
            "is_active": product.is_active,
            "image_url": product.image_url,
            "opening_quantity": opening_quantity,
            "main_store_branch_id": main_branch.id,
            "main_store_branch_name": main_branch.name
        }), 201
    except ValueError as e:
        db.session.rollback()
        if str(e):
            return jsonify({"error": str(e)}), 400
        return jsonify({"error": "بيانات المنتج غير صحيحة. يرجى مراجعة القيم المدخلة."}), 400
    except TypeError:
        db.session.rollback()
        return jsonify({"error": "بيانات المنتج غير صحيحة. يرجى مراجعة القيم المدخلة."}), 400
    except TypeError:
        db.session.rollback()
        return jsonify({"error": "بيانات المخزون غير صحيحة. يرجى مراجعة الكمية والفرع."}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "تعذر حفظ المنتج. حاول مرة أخرى.", "details": str(e)}), 500

@admin_bp.route('/products/<int:product_id>', methods=['PUT', 'PATCH'])
@require_admin
def update_admin_product(product_id):
    from app.models.product import Product
    try:
        product = Product.query.get_or_404(product_id)
        if request.content_type and 'multipart/form-data' in request.content_type:
            data = request.form
            file = request.files.get('image')
        else:
            data = request.get_json() or {}
            file = None
        
        updated_name = product.name
        updated_category = product.category
        updated_unit = product.unit
        updated_pieces_per_unit = product.pieces_per_unit
        updated_supplier_name = product.supplier_name
        updated_expiry_date = product.expiry_date
        updated_selling_price = product.selling_price
        updated_cost_price = product.cost_price
        updated_sales_commission_percent = product.sales_commission_percent
        updated_min_stock_threshold = product.min_stock_threshold
        updated_is_active = product.is_active
        updated_image_url = product.image_url

        if 'name' in data:
            updated_name = _normalize_required_text(data.get('name'))
        if 'category' in data:
            updated_category = _normalize_required_text(data.get('category'))
        if 'unit' in data:
            updated_unit = _normalize_required_text(data.get('unit')) or 'pcs'
        if 'pieces_per_unit' in data:
            updated_pieces_per_unit = int(data.get('pieces_per_unit'))
        if 'supplier_name' in data:
            updated_supplier_name = _normalize_optional_text(data.get('supplier_name'))
        if 'expiry_date' in data:
            expiry_date_str = data['expiry_date']
            if expiry_date_str:
                try:
                    updated_expiry_date = datetime.strptime(expiry_date_str.split('T')[0], "%Y-%m-%d").date()
                except ValueError:
                    return jsonify({"error": "تنسيق التاريخ غير صحيح."}), 400
            else:
                updated_expiry_date = None
        if 'selling_price' in data:
            updated_selling_price = float(data.get('selling_price') or 0.0)
        if 'cost_price' in data:
            updated_cost_price = float(data.get('cost_price') or 0.0)
        if 'sales_commission_percent' in data:
            updated_sales_commission_percent = max(0.0, float(data.get('sales_commission_percent') or 0.0))
        if 'min_stock_threshold' in data:
            updated_min_stock_threshold = int(data.get('min_stock_threshold'))
        if 'is_active' in data:
            is_active_raw = data['is_active']
            if isinstance(is_active_raw, str):
                updated_is_active = is_active_raw.lower() in ('true', '1', 'yes')
            else:
                updated_is_active = bool(is_active_raw)
        if 'image_url' in data:
            updated_image_url = _normalize_optional_text(data.get('image_url'))

        if not updated_name or not updated_category:
            return jsonify({"error": "الاسم، القسم، والوحدة مطلوبة."}), 400
        if (
            updated_pieces_per_unit < 1
            or updated_min_stock_threshold < 0
            or float(updated_selling_price or 0) < 0
            or float(updated_cost_price or 0) < 0
        ):
            return jsonify({"error": "بيانات المنتج غير صحيحة. يرجى مراجعة القيم المدخلة."}), 400

        product.name = updated_name
        product.category = updated_category
        product.unit = updated_unit
        product.pieces_per_unit = updated_pieces_per_unit
        product.supplier_name = updated_supplier_name
        product.expiry_date = updated_expiry_date
        product.selling_price = updated_selling_price
        product.cost_price = updated_cost_price
        product.sales_commission_percent = updated_sales_commission_percent
        product.min_stock_threshold = updated_min_stock_threshold
        product.is_active = updated_is_active
        product.image_url = updated_image_url

        if file:
            from app.utils.upload_utils import save_product_image
            product.image_url = save_product_image(file, product.id)
            
        db.session.commit()
        return jsonify({
            "id": product.id,
            "name": product.name,
            "category": product.category,
            "unit": product.unit,
            "pieces_per_unit": product.pieces_per_unit,
            "supplier_name": product.supplier_name,
            "expiry_date": product.expiry_date.isoformat() if product.expiry_date else None,
            "selling_price": product.selling_price,
            "cost_price": product.cost_price,
            "sales_commission_percent": float(product.sales_commission_percent or 0),
            "min_stock_threshold": product.min_stock_threshold,
            "is_active": product.is_active,
            "image_url": product.image_url
        }), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": "بيانات المنتج غير صحيحة. يرجى مراجعة القيم المدخلة."}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "تعذر تحديث المنتج. حاول مرة أخرى.", "details": str(e)}), 500

@admin_bp.route('/products/<int:product_id>', methods=['DELETE'])
@require_admin
def delete_admin_product(product_id):
    from app.models.product import Product
    try:
        product = Product.query.get_or_404(product_id)
        product.is_active = False
        db.session.commit()
        return jsonify({"status": "success", "message": "Product archived successfully"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to archive product", "details": str(e)}), 500

@admin_bp.route('/products/<int:product_id>/stock', methods=['GET'])
@require_admin
def get_product_stock_levels(product_id):
    from app.models.product import Product, ProductBranchStock
    try:
        allowed_ids = _inventory_read_scope(product_id)
        product = db.session.get(Product, product_id)
        if product is None:
            abort(404, description="المنتج غير موجود أو غير مسموح.")
        stocks = ProductBranchStock.query.filter(ProductBranchStock.product_id == product.id, ProductBranchStock.branch_id.in_(allowed_ids)).all()
        return jsonify([{
            "branch_id": s.branch_id,
            "branch_name": s.branch.name,
            "stock_quantity": s.stock_quantity,
            "is_available": s.is_available
        } for s in stocks]), 200
    except HTTPException as error:
        return jsonify({"error": error.description}), error.code
    except Exception as e:
        return jsonify({"error": "Failed to fetch stock levels", "details": str(e)}), 500

@admin_bp.route('/products/<int:product_id>/activity', methods=['GET'])
@require_admin
def get_product_activity(product_id):
    from app.models.product import Product
    from app.services.product_inventory_history import build_activity_history
    allowed_ids = _inventory_read_scope(product_id, include_history=True)
    db.get_or_404(Product, product_id)
    try:
        return jsonify(build_activity_history(product_id, allowed_ids)), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 400


@admin_bp.route('/products/<int:product_id>/batches', methods=['GET'])
@require_admin
def get_product_batches(product_id):
    from app.models.product import Product
    from app.services.product_inventory_history import build_batch_history
    allowed_ids = _inventory_read_scope(product_id, include_history=True)
    db.get_or_404(Product, product_id)
    try:
        return jsonify(build_batch_history(product_id, allowed_ids)), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 400


@admin_bp.route('/products/<int:product_id>/workspace', methods=['GET'])
@require_admin
def get_product_workspace(product_id):
    from app.services.product_inventory_history import snapshot_fields
    from sqlalchemy.orm import joinedload
    from app.models.product import Product, ProductBranchStock, StockMovement, StockMovementType

    def infer_product_type(product):
        # Temporary rule: product type is inferred from selling_price until an explicit field exists.
        return "RETAIL" if float(product.selling_price or 0) > 0 else "INTERNAL"

    def branch_status(stock_quantity, is_available, threshold):
        if not is_available or stock_quantity <= 0:
            return "UNAVAILABLE"
        if stock_quantity <= threshold:
            return "LOW"
        return "AVAILABLE"

    def movement_direction(movement_type):
        if movement_type in {StockMovementType.SUPPLY_IN, StockMovementType.TRANSFER_IN}:
            return "IN"
        if movement_type in {
            StockMovementType.PRODUCT_SALE,
            StockMovementType.INTERNAL_CONSUMPTION,
            StockMovementType.TRANSFER_OUT,
            StockMovementType.RETURN_TO_SUPPLIER,
        }:
            return "OUT"
        return "NEUTRAL"

    def movement_reference_label(movement):
        if movement.movement_type == StockMovementType.PRODUCT_SALE:
            if movement.invoice and movement.invoice.invoice_number:
                return f"فاتورة #{movement.invoice.invoice_number}"
            if movement.invoice_id:
                return f"فاتورة داخلية #{movement.invoice_id}"
            return "بيع منتج"
        if movement.movement_type == StockMovementType.SUPPLY_IN:
            return "توريد مخزني"
        if movement.movement_type == StockMovementType.INTERNAL_CONSUMPTION:
            return "استهلاك داخلي"
        if movement.movement_type == StockMovementType.TRANSFER_IN:
            return "تحويل وارد"
        if movement.movement_type == StockMovementType.TRANSFER_OUT:
            return "تحويل صادر"
        if movement.movement_type == StockMovementType.RETURN_TO_SUPPLIER:
            if _extract_direct_supplier_return_ref(movement.notes):
                return "مرتجع مباشر للمورد"
            return "إرجاع للمورد"
        if movement.movement_type == StockMovementType.STOCK_ADJUSTMENT:
            return "تعديل مخزني"
        return movement.movement_type.value

    try:
        allowed_ids = _inventory_read_scope(product_id)
        product = db.session.get(Product, product_id)
        if product is None:
            abort(404, description="المنتج غير موجود أو غير مسموح.")
        main_branch = _require_main_warehouse_branch()
        main_branch_id = main_branch.id if main_branch else None

        branch_rows = (
            ProductBranchStock.query
            .options(joinedload(ProductBranchStock.branch))
            .filter(ProductBranchStock.product_id == product.id, ProductBranchStock.branch_id.in_(allowed_ids))
            .order_by(ProductBranchStock.branch_id.asc())
            .all()
        )

        total_stock = sum(int(row.stock_quantity or 0) for row in branch_rows)
        main_store_stock = sum(
            int(row.stock_quantity or 0)
            for row in branch_rows
            if row.branch_id == main_branch_id
        )
        carrying_branches_count = sum(1 for row in branch_rows if int(row.stock_quantity or 0) > 0)
        states = location_stock_states(allowed_ids, [product.id])
        location_states = {row.branch_id: row for row in db.session.query(states).all()}
        low_stock_branches_count = sum(
            1 for row in location_states.values()
            if row.location_active and row.stock_status == 'LOW_STOCK'
        )

        recent_movements = (
            StockMovement.query
            .options(
                joinedload(StockMovement.branch),
                joinedload(StockMovement.invoice)
            )
            .filter(StockMovement.product_id == product.id, StockMovement.branch_id.in_(allowed_ids))
            .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
            .limit(20)
            .all()
        )

        activity_rows = []
        for movement in recent_movements:
            direction = movement_direction(movement.movement_type)
            signed_quantity = 0
            if direction == "IN":
                signed_quantity = int(movement.quantity or 0)
            elif direction == "OUT":
                signed_quantity = -int(movement.quantity or 0)

            activity_rows.append({
                "id": movement.id,
                "movement_type": movement.movement_type.value,
                "direction": direction,
                "signed_quantity": signed_quantity,
                "quantity": int(movement.quantity or 0),
                "branch_id": movement.branch_id,
                "branch_name": movement.branch.name if movement.branch else f"فرع #{movement.branch_id}",
                "created_at": movement.created_at.isoformat() if movement.created_at else None,
                "reference_label": movement_reference_label(movement),
                "notes": movement.notes,
                **snapshot_fields(movement),
            })

        from app.models.inventory_batch import InventoryBatch, BranchInventoryBatch, InventoryBatchStatus
        from sqlalchemy.orm import joinedload
        from datetime import date
        
        today = date.today()
        
        branch_batches = (
            BranchInventoryBatch.query
            .options(
                joinedload(BranchInventoryBatch.batch),
                joinedload(BranchInventoryBatch.branch)
            )
            .filter(
                BranchInventoryBatch.product_id == product.id,
                BranchInventoryBatch.branch_id.in_(allowed_ids),
                BranchInventoryBatch.status == InventoryBatchStatus.ACTIVE,
                BranchInventoryBatch.remaining_quantity > 0
            )
            .all()
        )
        
        batches_data = []
        nearest_expiry = None
        latest_received = None
        
        for bb in branch_batches:
            batch = bb.batch
            exp_date = batch.expiration_date
            
            days_remaining = None
            status_label = "NO_EXPIRY"
            if exp_date:
                days_remaining = (exp_date - today).days
                if days_remaining < 0:
                    status_label = "EXPIRED"
                elif days_remaining <= 30:
                    status_label = "EXPIRING_SOON"
                else:
                    status_label = "HEALTHY"
                    
                if nearest_expiry is None or exp_date < nearest_expiry:
                    nearest_expiry = exp_date
                    
            if latest_received is None or (bb.first_received_at and (not latest_received or bb.first_received_at > latest_received)):
                latest_received = bb.first_received_at
            
            batches_data.append({
                "batch_id": batch.id,
                "batch_number": batch.batch_number,
                "remaining_quantity": int(bb.remaining_quantity),
                "expiration_date": exp_date.isoformat() if exp_date else None,
                "purchase_date": batch.purchase_date.isoformat() if getattr(batch, 'purchase_date', None) else None,
                "received_at": bb.first_received_at.isoformat() if bb.first_received_at else None,
                "days_remaining": days_remaining,
                "status": status_label,
                "branch_id": bb.branch_id,
                "branch_name": bb.branch.name if bb.branch else None,
                "is_main_warehouse": bb.branch.is_main_warehouse if bb.branch else False,
            })
            
        nearest_expiration_days = (nearest_expiry - today).days if nearest_expiry else None

        return jsonify({
            "product": {
                "id": product.id,
                "name": product.name,
                "category": product.category,
                "unit": product.unit,
                "pieces_per_unit": product.pieces_per_unit,
                "supplier_name": product.supplier_name,
                "expiry_date": product.expiry_date.isoformat() if product.expiry_date else None,
                "selling_price": product.selling_price,
                "cost_price": product.cost_price,
                "sales_commission_percent": float(product.sales_commission_percent or 0),
                "min_stock_threshold": product.min_stock_threshold,
                "is_active": product.is_active,
                "image_url": product.image_url,
                "product_type": infer_product_type(product),
            },
            "summary": {
                "total_stock": total_stock,
                "main_store_stock": main_store_stock,
                "carrying_branches_count": carrying_branches_count,
                "low_stock_branches_count": low_stock_branches_count,
                "out_of_stock_locations_count": sum(1 for row in location_states.values() if row.location_active and row.stock_status == 'OUT_OF_STOCK'),
                "unknown_locations_count": sum(1 for row in location_states.values() if row.location_active and row.stock_status == 'UNKNOWN'),
                "nearest_expiration": nearest_expiry.isoformat() if nearest_expiry else None,
                "nearest_expiration_days": nearest_expiration_days,
                "latest_received_at": latest_received.isoformat() if latest_received else None,
            },
            "batches": batches_data,
            "branch_distribution": [{
                "branch_id": row.branch_id,
                "branch_name": row.branch.name if row.branch else f"فرع #{row.branch_id}",
                "is_main_warehouse": row.branch_id == main_branch_id,
                "stock_quantity": int(row.stock_quantity or 0),
                "is_available": bool(row.is_available),
                "stock_status": location_states[row.branch_id].stock_status,
                "status": branch_status(
                    int(row.stock_quantity or 0),
                    bool(row.is_available),
                    int(product.min_stock_threshold or 0)
                )
            } for row in branch_rows],
            "recent_activity": activity_rows
        }), 200
    except ValueError as e:
        return jsonify({"error": str(e) or "لم يتم إعداد المخزن الرئيسي بعد. يرجى مراجعة إعدادات الفروع."}), 400
    except HTTPException as error:
        return jsonify({"error": error.description}), error.code
    except Exception as e:
        return jsonify({"error": "Failed to load product workspace", "details": str(e)}), 500

def _authorize_inventory_write_branch(raw_branch_id):
    """Authorize every affected location before stock locks or mutations."""
    try:
        branch_id = int(raw_branch_id)
    except (TypeError, ValueError):
        abort(400, description="Invalid branch ID.")
    if branch_id <= 0 or isinstance(raw_branch_id, bool) or str(raw_branch_id) != str(branch_id):
        abort(400, description="Invalid branch ID.")
    allowed = resolve_branch_scope(g.current_user, str(branch_id))
    if branch_id not in allowed:
        abort(403, description="Access to this inventory branch is restricted.")
    if db.session.get(Branch, branch_id) is None:
        abort(404, description="Inventory branch not found.")
    return branch_id


@admin_bp.route('/products/<int:product_id>/stock', methods=['POST'])
@require_admin
def adjust_product_stock(product_id):
    from app.models.product import Product, ProductBranchStock, StockMovement, StockMovementType
    try:
        product = Product.query.get_or_404(product_id)
        data = request.get_json() or {}
        
        branch_id = data.get('branch_id')
        adjustment_qty = data.get('quantity')
        movement_type_str = data.get('movement_type', 'STOCK_ADJUSTMENT')
        source_branch_id = data.get('source_branch_id')
        
        if not branch_id or adjustment_qty is None:
            return jsonify({"error": "branch_id and quantity are required"}), 400

        branch_id = _authorize_inventory_write_branch(branch_id)
        if source_branch_id is not None:
            source_branch_id = _authorize_inventory_write_branch(source_branch_id)
            
        branch = Branch.query.get(branch_id)
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404
            
        try:
            m_type = StockMovementType(movement_type_str)
        except ValueError:
            m_type = StockMovementType.STOCK_ADJUSTMENT

        adjustment_qty = int(adjustment_qty)

        if m_type == StockMovementType.TRANSFER_IN:
            main_branch = _require_main_warehouse_branch()
            if not main_branch:
                return jsonify({"error": "لم يتم تعيين المخزن الرئيسي بعد. يرجى مراجعة الفروع."}), 400
            if not source_branch_id:
                return jsonify({"error": "فرع المصدر مطلوب لتنفيذ التوزيع."}), 400
            if int(source_branch_id) != int(main_branch.id):
                return jsonify({"error": "التوزيع إلى الفروع يجب أن يتم من المخزن الرئيسي فقط."}), 400
            if int(branch_id) == int(source_branch_id):
                return jsonify({"error": "لا يمكن التوزيع إلى نفس الفرع."}), 400

            source_branch = Branch.query.get(source_branch_id)
            if not source_branch:
                return jsonify({"error": "فرع المصدر غير موجود"}), 404

            source_stock = _get_or_create_product_branch_stock(product.id, int(source_branch_id))
            quantity_to_transfer = int(adjustment_qty)
            if quantity_to_transfer <= 0:
                return jsonify({"error": "الكمية يجب أن تكون أكبر من الصفر."}), 400
            if source_stock.stock_quantity < quantity_to_transfer:
                return jsonify({"error": "الكمية المطلوبة غير متاحة في المخزن الرئيسي."}), 400

            shipment, total_quantity = _create_stock_shipment(
                destination_branch=branch,
                prepared_items=[{
                    "product": product,
                    "quantity": quantity_to_transfer,
                    "source_stock": source_stock,
                    "available_quantity": int(source_stock.stock_quantity or 0),
                }],
                note=data.get('notes') or "توزيع من المخزن الرئيسي إلى الفرع"
            )
            db.session.commit()

            return jsonify({
                "message": "تم إرسال الشحنة إلى الفرع.",
                "shipment_id": shipment.id,
                "shipment_ref": shipment.shipment_ref,
                "status": shipment.status,
                "product_id": product.id,
                "branch_id": int(branch_id),
                "new_stock": 0,
                "source_branch_id": int(source_branch_id),
                "source_new_stock": source_stock.stock_quantity,
                "total_quantity": total_quantity,
            }), 200
            
        stock = _get_or_create_product_branch_stock(product.id, int(branch_id))
            
        new_qty = stock.stock_quantity + adjustment_qty
        if new_qty < 0:
            return jsonify({"error": f"الرصيد لا يمكن أن يكون سالباً. المتاح حالياً: {stock.stock_quantity}"}), 400
            
        balance_before = stock.stock_quantity
        stock.stock_quantity = new_qty
        
        movement = capture_stock_movement(stock, balance_before,
            product_id=product.id,
            branch_id=branch_id,
            movement_type=m_type,
            quantity=abs(adjustment_qty),
            created_by=_resolve_stock_movement_created_by_employee_id(),
            notes=data.get('notes')
        )
        db.session.add(movement)
        if m_type == StockMovementType.RETURN_TO_SUPPLIER and adjustment_qty < 0:
            db.session.flush()
            capture_return_cost(product_id=product.id, quantity=abs(adjustment_qty), created_at=movement.created_at, stock_movement_id=movement.id, direct=False)
        db.session.commit()
        
        return jsonify({
            "product_id": product.id,
            "branch_id": branch_id,
            "new_stock": stock.stock_quantity
        }), 200
    except HTTPException as error:
        db.session.rollback()
        return jsonify({"error": error.description}), error.code
    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": "بيانات المخزون غير صحيحة. يرجى مراجعة الكمية والفرع."}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to adjust stock", "details": str(e)}), 500

@admin_bp.route('/supply/receive', methods=['POST'])
@require_admin
def receive_supply_into_main_warehouse():
    from app.models.product import Product, StockMovement, StockMovementType
    from app.models.inventory_batch import InventoryBatch, BranchInventoryBatch, InventoryBatchSourceType
    import uuid

    try:
        data = request.get_json() or {}
        raw_items = data.get('items')
        supplier_name = _normalize_optional_text(data.get('supplier_name'))
        note = _normalize_optional_text(data.get('note'))

        if not isinstance(raw_items, list) or len(raw_items) == 0:
            return jsonify({"error": "يجب إضافة منتج واحد على الأقل إلى التوريد."}), 400

        main_branch = _require_main_warehouse_branch()
        parsed_items = []
        from datetime import datetime, timezone
        for raw_item in raw_items:
            if not isinstance(raw_item, dict):
                return jsonify({"error": "بيانات التوريد غير صحيحة."}), 400

            try:
                product_id = int(raw_item.get('product_id'))
                quantity = int(raw_item.get('quantity'))
            except (TypeError, ValueError):
                return jsonify({"error": "بيانات المنتج أو الكمية غير صحيحة."}), 400

            if quantity <= 0:
                return jsonify({"error": "الكمية يجب أن تكون أكبر من الصفر."}), 400

            if any(existing["product_id"] == product_id for existing in parsed_items):
                return jsonify({"error": "لا يمكن تكرار نفس المنتج داخل طلب التوريد الواحد."}), 400

            exp_str = raw_item.get('expiration_date')
            purch_str = raw_item.get('purchase_date')

            exp_date = None
            if exp_str:
                try:
                    exp_date = datetime.strptime(str(exp_str).split('T')[0], '%Y-%m-%d').date()
                except ValueError:
                    return jsonify({"error": f"تنسيق تاريخ الصلاحية غير صحيح: {exp_str}"}), 400

            purch_date = None
            if purch_str:
                try:
                    purch_date = datetime.strptime(str(purch_str).split('T')[0], '%Y-%m-%d').date()
                except ValueError:
                    return jsonify({"error": f"تنسيق تاريخ الشراء غير صحيح: {purch_str}"}), 400

            parsed_items.append({
                "product_id": product_id,
                "quantity": quantity,
                "expiration_date": exp_date,
                "purchase_date": purch_date
            })

        product_ids = sorted(list(set(item['product_id'] for item in parsed_items)))
        products = Product.query.filter(Product.id.in_(product_ids)).all()
        products_by_id = {product.id: product for product in products}
        missing_product_ids = [product_id for product_id in product_ids if product_id not in products_by_id]
        if missing_product_ids:
            return jsonify({"error": "بعض المنتجات المطلوبة غير موجودة."}), 404

        supply_ref = _generate_supply_receive_ref()
        movement_note = _build_supply_receive_note(supply_ref, supplier_name, note)

        current_user_id = g.current_user.id if hasattr(g, 'current_user') and g.current_user else None
        shipment_rows = [{
            "quantity": item["quantity"],
            "unit_cost_snapshot": _normalize_money_amount(products_by_id[item["product_id"]].cost_price),
        } for item in parsed_items]
        shipment_summary = _build_shipment_summary_from_rows(shipment_rows)
        shipment = StockShipment(
            shipment_ref=_generate_stock_shipment_ref(),
            shipment_type='INBOUND_SUPPLY',
            source_branch_id=None,
            destination_branch_id=main_branch.id,
            status='RECEIVED',
            note=note,
            supplier_name_snapshot=supplier_name,
            products_count=shipment_summary["products_count"],
            pieces_count=shipment_summary["pieces_count"],
            total_cost_snapshot=shipment_summary["total_cost_snapshot"],
            created_by_user_id=current_user_id,
            received_at=get_utc_now(),
        )
        db.session.add(shipment)
        db.session.flush()

        pairs = [(item["product_id"], main_branch.id) for item in parsed_items]
        locked_stocks = lock_product_stocks(pairs, create_missing=pairs)
        for item in parsed_items:
            product = products_by_id[item["product_id"]]
            quantity = item["quantity"]
            main_stock = locked_stocks[(product.id, main_branch.id)]
            balance_before = main_stock.stock_quantity
            main_stock.stock_quantity += quantity

            db.session.add(capture_stock_movement(main_stock, balance_before,
                product_id=product.id,
                branch_id=main_branch.id,
                movement_type=StockMovementType.SUPPLY_IN,
                quantity=quantity,
                created_by=_resolve_stock_movement_created_by_employee_id(),
                notes=movement_note,
            ))
            db.session.add(StockShipmentItem(
                shipment_id=shipment.id,
                product_id=product.id,
                quantity=quantity,
                unit_cost_snapshot=_normalize_money_amount(product.cost_price),
            ))

            batch_number = f"SUP-{datetime.now(timezone.utc).strftime('%y%m%d%H%M')}-{product.id}-{uuid.uuid4().hex[:4].upper()}"
            
            new_batch = InventoryBatch(
                product_id=product.id,
                batch_number=batch_number,
                expiration_date=item["expiration_date"],
                purchase_date=item["purchase_date"],
                supplier_name_snapshot=supplier_name,
                initial_quantity=quantity,
                source_type=InventoryBatchSourceType.SUPPLY_RECEIPT,
                source_ref=supply_ref,
                created_branch_id=main_branch.id,
                created_by_user_id=current_user_id
            )
            db.session.add(new_batch)
            db.session.flush()

            branch_batch = BranchInventoryBatch(
                batch_id=new_batch.id,
                branch_id=main_branch.id,
                product_id=product.id,
                remaining_quantity=quantity
            )
            db.session.add(branch_batch)

        db.session.commit()

        return jsonify({
            "message": "تم تسجيل التوريد في المخزن الرئيسي.",
            "supply_ref": supply_ref,
            "shipment_id": shipment.id,
            "shipment_ref": shipment.shipment_ref,
            "shipment_type": shipment.shipment_type,
            "status": shipment.status,
            "main_warehouse": {
                "id": main_branch.id,
                "name": main_branch.name,
            },
            "items_count": shipment_summary["products_count"],
            "total_quantity": shipment_summary["pieces_count"],
            "total_cost_snapshot": shipment_summary["total_cost_snapshot"],
            "supplier_name": supplier_name,
            "note": note,
            "items": [{
                "product_id": item["product_id"],
                "product_name": products_by_id[item["product_id"]].name,
                "quantity": item["quantity"],
                "image_url": products_by_id[item["product_id"]].image_url,
                "main_store_stock": int(_get_or_create_product_branch_stock(item["product_id"], main_branch.id).stock_quantity or 0),
            } for item in parsed_items],
        }), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": str(e) or "تعذر تسجيل التوريد في المخزن الرئيسي."}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to receive supply", "details": str(e)}), 500

@admin_bp.route('/products/consume', methods=['POST'])
@require_admin
def consume_admin_product():
    from app.models.product import Product, ProductBranchStock, StockMovement, StockMovementType
    try:
        data = request.get_json() or {}
        branch_id = data.get('branch_id')
        product_id = data.get('product_id')
        quantity = data.get('quantity')
        reason = data.get('reason', '').strip()
        
        if not branch_id or not product_id or quantity is None or quantity <= 0:
            return jsonify({"error": "الفرع، المنتج والكمية مطلوبة ويجب أن تكون أكبر من الصفر"}), 400

        branch_id = _authorize_inventory_write_branch(branch_id)
            
        product = Product.query.get(product_id)
        if not product or not product.is_active:
            return jsonify({"error": "المنتج غير موجود أو غير نشط"}), 404
            
        branch = Branch.query.get(branch_id)
        if not branch:
            return jsonify({"error": "الفرع غير موجود"}), 404
            
        stock = _lock_product_branch_stock(product_id, branch_id)
        
        if not stock or stock.stock_quantity < quantity:
            available_qty = stock.stock_quantity if stock else 0
            return jsonify({"error": f"الكمية غير متوفرة. المتاح: {available_qty}"}), 400
            
        balance_before = stock.stock_quantity
        stock.stock_quantity -= quantity
        
        movement = capture_stock_movement(stock, balance_before,
            product_id=product_id,
            branch_id=branch_id,
            movement_type=StockMovementType.INTERNAL_CONSUMPTION,
            quantity=quantity,
            created_by=_resolve_stock_movement_created_by_employee_id(),
            notes=reason if reason else None
        )
        db.session.add(movement)
        db.session.commit()
        
        return jsonify({
            "product_id": product_id,
            "branch_id": branch_id,
            "new_stock": stock.stock_quantity
        }), 200
    except HTTPException as error:
        db.session.rollback()
        return jsonify({"error": error.description}), error.code
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to record consumption", "details": str(e)}), 500


# ============================================================================
# REPORTS — SERVICES, PRODUCTS, SALES, FINANCE, AND BRANCH PERFORMANCE
# ============================================================================

def _report_request_context():
    """Parse shared report filters and enforce the caller's branch scope."""
    from app.services.reporting_service import build_report_filters

    filters = build_report_filters(request.args)
    requested_branch = request.args.get('branch_id')
    allowed_branch_ids = resolve_branch_scope(g.current_user, requested_branch)
    return filters, allowed_branch_ids


def _report_table_options():
    page = max(int(request.args.get('page', 1)), 1)
    per_page = min(max(int(request.args.get('per_page', 12)), 1), 100)
    return {
        'page': page,
        'per_page': per_page,
        'search': str(request.args.get('search') or '').strip(),
        'sort_by': str(request.args.get('sort_by') or '').strip(),
        'sort_dir': str(request.args.get('sort_dir') or 'desc').strip().lower(),
    }


@admin_bp.route('/reports/services', methods=['GET'])
@require_admin
def get_services_report():
    from app.services.reporting_service import build_services_report

    try:
        filters, allowed_branch_ids = _report_request_context()
        options = _report_table_options()
        if not options['sort_by']:
            options['sort_by'] = 'gross_value'
        return jsonify(build_services_report(allowed_branch_ids, filters, **options)), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching services report: {exc}")
        return jsonify({'error': 'Failed to fetch services report', 'details': str(exc)}), 500


@admin_bp.route('/reports/services/<int:service_id>', methods=['GET'])
@require_admin
def get_service_report_drilldown(service_id):
    from app.services.reporting_service import build_service_drilldown

    try:
        filters, allowed_branch_ids = _report_request_context()
        payload = build_service_drilldown(allowed_branch_ids, filters, service_id)
        if payload is None:
            return jsonify({'error': 'Service not found'}), 404
        return jsonify(payload), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching service report drilldown: {exc}")
        return jsonify({'error': 'Failed to fetch service report drilldown', 'details': str(exc)}), 500


@admin_bp.route('/reports/services/export/xlsx', methods=['GET'])
@require_admin
def export_services_report_xlsx():
    from app.services.reporting_service import service_export_rows

    try:
        filters, allowed_branch_ids = _report_request_context()
        workbook_file = build_xlsx_file(
            sheet_name='Services Report',
            columns=[
                ExcelColumn(title='الخدمة', width=28),
                ExcelColumn(title='الفئة', width=24),
                ExcelColumn(title='عدد الخدمات', width=16, cell_type='integer'),
                ExcelColumn(title='إجمالي القيمة', width=18, cell_type='amount'),
                ExcelColumn(title='متوسط سعر الخدمة', width=20, cell_type='amount'),
                ExcelColumn(title='نسبة المساهمة', width=16, cell_type='number'),
                ExcelColumn(title='الفرع الأعلى', width=24),
                ExcelColumn(title='الحلاق الأعلى', width=24),
            ],
            rows=(
                [
                    row['service_name'],
                    row['category_name'],
                    row['units'],
                    row['gross_value'],
                    row['average_price'],
                    row['contribution_percent'],
                    (row.get('top_branch') or {}).get('name', ''),
                    (row.get('top_barber') or {}).get('name', ''),
                ]
                for row in service_export_rows(allowed_branch_ids, filters)
            ),
        )
        filename = build_export_filename(
            'Services_Report',
            extension='xlsx',
            qualifiers=[filters.date_from.isoformat(), filters.date_to.isoformat()],
            exported_on=get_cairo_date(),
        )
        return send_file(
            workbook_file,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=filename,
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error exporting services report: {exc}")
        return jsonify({'error': 'Failed to export services report', 'details': str(exc)}), 500


@admin_bp.route('/reports/products', methods=['GET'])
@require_admin
def get_products_report():
    from app.services.reporting_service import build_products_report

    try:
        filters, allowed_branch_ids = _report_request_context()
        options = _report_table_options()
        if not options['sort_by']:
            options['sort_by'] = 'gross_sales_value'
        return jsonify(build_products_report(allowed_branch_ids, filters, **options)), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching products report: {exc}")
        return jsonify({'error': 'Failed to fetch products report', 'details': str(exc)}), 500


@admin_bp.route('/reports/products/<int:product_id>', methods=['GET'])
@require_admin
def get_product_report_drilldown(product_id):
    from app.services.reporting_service import build_product_drilldown

    try:
        filters, allowed_branch_ids = _report_request_context()
        payload = build_product_drilldown(allowed_branch_ids, filters, product_id)
        if payload is None:
            return jsonify({'error': 'Product not found'}), 404
        return jsonify(payload), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching product report drilldown: {exc}")
        return jsonify({'error': 'Failed to fetch product report drilldown', 'details': str(exc)}), 500


@admin_bp.route('/reports/products/export/xlsx', methods=['GET'])
@require_admin
def export_products_report_xlsx():
    from app.services.reporting_service import product_export_rows

    try:
        filters, allowed_branch_ids = _report_request_context()
        workbook_file = build_xlsx_file(
            sheet_name='Products Report',
            columns=[
                ExcelColumn(title='المنتج', width=28),
                ExcelColumn(title='الفئة', width=22),
                ExcelColumn(title='الوحدات المباعة', width=18, cell_type='integer'),
                ExcelColumn(title='إجمالي قيمة المبيعات', width=22, cell_type='amount'),
                ExcelColumn(title='متوسط سعر البيع', width=20, cell_type='amount'),
                ExcelColumn(title='المخزون الحالي', width=18, cell_type='integer'),
                ExcelColumn(title='حالة المخزون', width=18),
                ExcelColumn(title='فروع بها مخزون', width=18, cell_type='integer'),
                ExcelColumn(title='الفرع الأعلى مبيعاً', width=24),
                ExcelColumn(title='آخر حركة مخزون', width=24),
            ],
            rows=(
                [
                    row['product_name'],
                    row.get('category') or '',
                    row['units_sold'],
                    row['gross_sales_value'],
                    row['average_selling_price'],
                    row['current_stock'],
                    row['stock_state'],
                    row['branches_carrying_stock'],
                    (row.get('top_branch') or {}).get('name', ''),
                    row.get('recent_activity_at') or '',
                ]
                for row in product_export_rows(allowed_branch_ids, filters)
            ),
        )
        filename = build_export_filename(
            'Products_Report',
            extension='xlsx',
            qualifiers=[filters.date_from.isoformat(), filters.date_to.isoformat()],
            exported_on=get_cairo_date(),
        )
        return send_file(
            workbook_file,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=filename,
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error exporting products report: {exc}")
        return jsonify({'error': 'Failed to export products report', 'details': str(exc)}), 500


@admin_bp.route('/reports/sales', methods=['GET'])
@require_admin
def get_sales_report():
    from app.services.reporting_service import build_sales_report

    try:
        filters, allowed_branch_ids = _report_request_context()
        options = _report_table_options()
        if not options['sort_by']:
            options['sort_by'] = 'invoice_date'
        return jsonify(build_sales_report(allowed_branch_ids, filters, **options)), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching sales report: {exc}")
        return jsonify({'error': 'Failed to fetch sales report', 'details': str(exc)}), 500


@admin_bp.route('/reports/sales/<int:invoice_id>', methods=['GET'])
@require_admin
def get_sales_report_drilldown(invoice_id):
    from app.services.reporting_service import build_sales_drilldown

    try:
        filters, allowed_branch_ids = _report_request_context()
        payload = build_sales_drilldown(allowed_branch_ids, filters, invoice_id)
        if payload is None:
            return jsonify({'error': 'Paid invoice not found in the authorized report scope'}), 404
        return jsonify(payload), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching sales report drilldown: {exc}")
        return jsonify({'error': 'Failed to fetch sales report drilldown', 'details': str(exc)}), 500


@admin_bp.route('/reports/sales/export/xlsx', methods=['GET'])
@require_admin
def export_sales_report_xlsx():
    from app.services.reporting_service import sales_export_rows

    try:
        filters, allowed_branch_ids = _report_request_context()

        def payment_amount(row, method):
            return next((slice_['amount'] for slice_ in row['payment_slices'] if slice_['method'] == method), 0.0)

        workbook_file = build_xlsx_file(
            sheet_name='Sales Report',
            columns=[
                ExcelColumn(title='رقم الفاتورة', width=16),
                ExcelColumn(title='تاريخ السداد', width=16),
                ExcelColumn(title='الفرع', width=24),
                ExcelColumn(title='العميل', width=26),
                ExcelColumn(title='الكاشير', width=24),
                ExcelColumn(title='الإجمالي قبل الخصم', width=20, cell_type='amount'),
                ExcelColumn(title='الخصم', width=16, cell_type='amount'),
                ExcelColumn(title='الصافي', width=16, cell_type='amount'),
                ExcelColumn(title='المتحصل نقداً', width=18, cell_type='amount'),
                ExcelColumn(title='المتحصل فيزا', width=18, cell_type='amount'),
                ExcelColumn(title='المتحصل إنستا باي', width=20, cell_type='amount'),
                ExcelColumn(title='كود الخصم', width=18),
                ExcelColumn(title='قيمة بنود الخدمات الإجمالية', width=24, cell_type='amount'),
                ExcelColumn(title='قيمة بنود المنتجات الإجمالية', width=24, cell_type='amount'),
                ExcelColumn(title='وحدات الخدمات', width=16, cell_type='integer'),
                ExcelColumn(title='وحدات المنتجات', width=16, cell_type='integer'),
            ],
            rows=(
                [
                    row['invoice_number'] if row['invoice_number'] is not None else '',
                    row['invoice_date'] or '',
                    row['branch_name'],
                    row['customer_name'],
                    row['cashier_name'],
                    row['gross_sales'],
                    row['discount_amount'],
                    row['net_sales'],
                    payment_amount(row, 'CASH'),
                    payment_amount(row, 'VISA'),
                    payment_amount(row, 'INSTAPAY'),
                    row.get('promo_code') or '',
                    row['service_gross_value'],
                    row['product_gross_value'],
                    row['service_units'],
                    row['product_units'],
                ]
                for row in sales_export_rows(
                    allowed_branch_ids,
                    filters,
                    search=str(request.args.get('search') or '').strip(),
                )
            ),
        )
        filename = build_export_filename(
            'Sales_Report',
            extension='xlsx',
            qualifiers=[filters.date_from.isoformat(), filters.date_to.isoformat()],
            exported_on=get_cairo_date(),
        )
        return send_file(
            workbook_file,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=filename,
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error exporting sales report: {exc}")
        return jsonify({'error': 'Failed to export sales report', 'details': str(exc)}), 500


@admin_bp.route('/reports/finance', methods=['GET'])
@require_admin
def get_finance_report():
    from app.services.reporting_service import build_finance_report

    try:
        filters, allowed_branch_ids = _report_request_context()
        options = _report_table_options()
        return jsonify(build_finance_report(
            allowed_branch_ids,
            filters,
            page=options['page'],
            per_page=options['per_page'],
            expense_page=max(int(request.args.get('expense_page', 1)), 1),
            deposit_page=max(int(request.args.get('deposit_page', 1)), 1),
            business_day_page=max(int(request.args.get('business_day_page', 1)), 1),
        )), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching finance report: {exc}")
        return jsonify({'error': 'Failed to fetch finance report', 'details': str(exc)}), 500


@admin_bp.route('/reports/finance/business-days/<int:business_day_id>', methods=['GET'])
@require_admin
def get_finance_business_day_drilldown(business_day_id):
    from app.services.reporting_service import build_finance_business_day_drilldown

    try:
        filters, allowed_branch_ids = _report_request_context()
        payload = build_finance_business_day_drilldown(allowed_branch_ids, filters, business_day_id)
        if payload is None:
            return jsonify({'error': 'Business day not found in the authorized report scope'}), 404
        return jsonify(payload), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching finance business day: {exc}")
        return jsonify({'error': 'Failed to fetch finance business day', 'details': str(exc)}), 500


@admin_bp.route('/reports/finance/export/xlsx', methods=['GET'])
@require_admin
def export_finance_report_xlsx():
    from app.services.reporting_service import finance_performance_export_rows

    try:
        filters, allowed_branch_ids = _report_request_context()
        workbook_file = build_xlsx_file(
            sheet_name='Finance Performance',
            columns=[
                ExcelColumn(title='التاريخ', width=16),
                ExcelColumn(title='الفرع', width=26),
                ExcelColumn(title='صافي المبيعات', width=20, cell_type='amount'),
                ExcelColumn(title='المصروفات التشغيلية', width=22, cell_type='amount'),
                ExcelColumn(title='تكلفة العمولات المسجلة', width=24, cell_type='amount'),
                ExcelColumn(title='المساهمة التشغيلية', width=22, cell_type='amount'),
            ],
            rows=(
                [row['date'], row['branch_name'], row['net_sales'], row['operating_expenses'], row['recorded_commission_cost'], row['operating_contribution']]
                for row in finance_performance_export_rows(allowed_branch_ids, filters)
            ),
        )
        filename = build_export_filename('Finance_Performance', extension='xlsx', qualifiers=[filters.date_from.isoformat(), filters.date_to.isoformat()], exported_on=get_cairo_date())
        return send_file(workbook_file, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', as_attachment=True, download_name=filename)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error exporting finance report: {exc}")
        return jsonify({'error': 'Failed to export finance report', 'details': str(exc)}), 500


@admin_bp.route('/reports/finance/treasury/export/xlsx', methods=['GET'])
@require_admin
def export_finance_treasury_xlsx():
    from app.services.reporting_service import finance_treasury_export_rows

    try:
        filters, allowed_branch_ids = _report_request_context()
        workbook_file = build_xlsx_file(
            sheet_name='Treasury Business Days',
            columns=[
                ExcelColumn(title='يوم العمل', width=14, cell_type='integer'),
                ExcelColumn(title='التاريخ التشغيلي', width=18),
                ExcelColumn(title='الفرع', width=24),
                ExcelColumn(title='الحالة', width=14),
                ExcelColumn(title='رصيد البداية', width=18, cell_type='amount'),
                ExcelColumn(title='تحصيل فواتير نقدي', width=22, cell_type='amount'),
                ExcelColumn(title='تحصيل عربون نقدي', width=22, cell_type='amount'),
                ExcelColumn(title='الخروج النقدي', width=18, cell_type='amount'),
                ExcelColumn(title='الرصيد النظري', width=18, cell_type='amount'),
                ExcelColumn(title='الرصيد المعدود', width=18, cell_type='amount'),
                ExcelColumn(title='الفرق', width=16, cell_type='amount'),
                ExcelColumn(title='فواتير فيزا', width=18, cell_type='amount'),
                ExcelColumn(title='فواتير إنستا باي', width=20, cell_type='amount'),
                ExcelColumn(title='إجمالي العربون', width=18, cell_type='amount'),
                ExcelColumn(title='أساس الحساب', width=24),
            ],
            rows=(
                [
                    row['business_day_id'], row['business_date'], row['branch_name'], row['status'], row['opening_balance'],
                    row['cash_invoice_collections'], row['cash_deposit_collections'], row['cash_out'], row['theoretical_cash'],
                    row['counted_cash'] if row['counted_cash'] is not None else '', row['variance'] if row['variance'] is not None else '',
                    row['invoice_methods']['VISA'], row['invoice_methods']['INSTAPAY'], sum(row['deposit_methods'].values()), row['calculation_basis'],
                ]
                for row in finance_treasury_export_rows(allowed_branch_ids, filters)
            ),
        )
        filename = build_export_filename('Treasury_Business_Days', extension='xlsx', qualifiers=[filters.date_from.isoformat(), filters.date_to.isoformat()], exported_on=get_cairo_date())
        return send_file(workbook_file, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', as_attachment=True, download_name=filename)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error exporting finance treasury report: {exc}")
        return jsonify({'error': 'Failed to export finance treasury report', 'details': str(exc)}), 500


@admin_bp.route('/reports/branches', methods=['GET'])
@require_admin
def get_branch_performance_report():
    from app.services.reporting_service import build_branch_report

    try:
        filters, allowed_branch_ids = _report_request_context()
        return jsonify(build_branch_report(allowed_branch_ids, filters)), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching branch performance report: {exc}")
        return jsonify({'error': 'Failed to fetch branch performance report', 'details': str(exc)}), 500


@admin_bp.route('/reports/branches/<int:branch_id>', methods=['GET'])
@require_admin
def get_branch_performance_drilldown(branch_id):
    from app.services.reporting_service import build_branch_drilldown

    try:
        filters, allowed_branch_ids = _report_request_context()
        payload = build_branch_drilldown(allowed_branch_ids, filters, branch_id)
        if payload is None:
            return jsonify({'error': 'Branch not found in the authorized report scope'}), 404
        return jsonify(payload), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching branch performance drilldown: {exc}")
        return jsonify({'error': 'Failed to fetch branch performance drilldown', 'details': str(exc)}), 500


@admin_bp.route('/reports/branches/export/xlsx', methods=['GET'])
@require_admin
def export_branch_performance_xlsx():
    from app.services.reporting_service import build_branch_report

    try:
        filters, allowed_branch_ids = _report_request_context()
        report = build_branch_report(allowed_branch_ids, filters)
        rows = report['branches']
        mix_rows = []
        for row in rows:
            for item_type, items in (('خدمة', row['mix']['top_services']), ('منتج', row['mix']['top_products'])):
                for item in items:
                    mix_rows.append([row['branch_name'], item_type, item['name'], item['gross_value'], item['units'], item['share_percent']])
        workbook_file = build_xlsx_workbook_file(sheets=[
            ExcelSheet(
                name='Branch Comparison',
                columns=[ExcelColumn(title='الفرع', width=26), ExcelColumn(title='حالة الفرع الحالية', width=18), ExcelColumn(title='صافي المبيعات', width=20, cell_type='amount'), ExcelColumn(title='نسبة النطاق %', width=18, cell_type='number'), ExcelColumn(title='نمو صافي المبيعات %', width=22, cell_type='number'), ExcelColumn(title='الفواتير المدفوعة', width=18, cell_type='integer'), ExcelColumn(title='متوسط الفاتورة', width=20, cell_type='amount'), ExcelColumn(title='المصروفات التشغيلية', width=22, cell_type='amount'), ExcelColumn(title='نسبة المصروفات %', width=20, cell_type='number'), ExcelColumn(title='تكلفة العمولات المسجلة', width=24, cell_type='amount'), ExcelColumn(title='نسبة العمولات %', width=20, cell_type='number'), ExcelColumn(title='المساهمة التشغيلية', width=22, cell_type='amount'), ExcelColumn(title='نسبة المساهمة %', width=20, cell_type='number'), ExcelColumn(title='عينة محدودة', width=16)],
                rows=([row['branch_name'], 'نشط' if row['is_active'] else 'غير نشط', row['net_sales'], row['scope_share_percent'], row['comparison']['net_sales']['percent_change'] if row['comparison']['net_sales']['percent_change'] is not None else '', row['paid_invoice_count'], row['average_ticket'], row['operating_expenses'], row['expense_ratio'] if row['expense_ratio'] is not None else '', row['recorded_commission_cost'], row['commission_ratio'] if row['commission_ratio'] is not None else '', row['operating_contribution'], row['contribution_ratio'] if row['contribution_ratio'] is not None else '', 'نعم' if row['low_base'] else 'لا'] for row in rows),
            ),
            ExcelSheet(
                name='Daily Performance',
                columns=[ExcelColumn(title='التاريخ', width=16), ExcelColumn(title='الفرع', width=26), ExcelColumn(title='صافي المبيعات', width=20, cell_type='amount'), ExcelColumn(title='الفواتير', width=14, cell_type='integer'), ExcelColumn(title='متوسط الفاتورة', width=20, cell_type='amount'), ExcelColumn(title='المصروفات التشغيلية', width=22, cell_type='amount'), ExcelColumn(title='العمولات المسجلة', width=22, cell_type='amount'), ExcelColumn(title='المساهمة التشغيلية', width=22, cell_type='amount')],
                rows=([row['date'], row['branch_name'], row['net_sales'], row['paid_invoice_count'], row['average_ticket'], row['operating_expenses'], row['recorded_commission_cost'], row['operating_contribution']] for row in report['daily_performance']),
            ),
            ExcelSheet(
                name='Sales Mix',
                columns=[ExcelColumn(title='الفرع', width=26), ExcelColumn(title='النوع', width=14), ExcelColumn(title='البند', width=28), ExcelColumn(title='القيمة الإجمالية', width=20, cell_type='amount'), ExcelColumn(title='الوحدات', width=14, cell_type='integer'), ExcelColumn(title='الحصة %', width=14, cell_type='number')],
                rows=mix_rows,
            ),
            ExcelSheet(
                name='Supporting Context',
                columns=[ExcelColumn(title='الفرع', width=26), ExcelColumn(title='فواتير بعميل معروف %', width=22, cell_type='number'), ExcelColumn(title='عملاء معروفون', width=18, cell_type='integer'), ExcelColumn(title='أول ظهور مسجل', width=18, cell_type='integer'), ExcelColumn(title='ساعات حضور مكتملة', width=20, cell_type='number'), ExcelColumn(title='جلسات حضور مكتملة', width=20, cell_type='integer'), ExcelColumn(title='مواعيد مجدولة', width=18, cell_type='integer'), ExcelColumn(title='مواعيد مكتملة', width=18, cell_type='integer'), ExcelColumn(title='مواعيد ملغاة', width=18, cell_type='integer'), ExcelColumn(title='تحصيلات عربون', width=18, cell_type='amount')],
                rows=([row['branch_name'], row['customers']['identified_invoice_share'], row['identified_customers'], row['customers']['first_known'], row['attendance']['recorded_hours'], row['attendance']['completed_sessions'], row['appointments']['scheduled'], row['appointments']['completed'], row['appointments']['cancelled'], row['appointments']['deposit_collections']] for row in rows),
            ),
            ExcelSheet(
                name='Treasury Controls',
                columns=[ExcelColumn(title='الفرع', width=26), ExcelColumn(title='أيام مغلقة', width=16, cell_type='integer'), ExcelColumn(title='أيام سابقة مفتوحة', width=20, cell_type='integer'), ExcelColumn(title='أيام بفارق مادي', width=20, cell_type='integer'), ExcelColumn(title='تكرار الفارق %', width=18, cell_type='number'), ExcelColumn(title='إجمالي الفروق المطلقة', width=22, cell_type='amount'), ExcelColumn(title='أكبر فرق مطلق', width=18, cell_type='amount')],
                rows=([row['branch_name'], row['treasury']['closed_days'], row['treasury']['open_overdue_days'], row['treasury']['material_variance_days'], row['treasury']['variance_frequency'], row['treasury']['total_absolute_variance'], row['treasury']['largest_absolute_variance']] for row in rows),
            ),
            ExcelSheet(
                name='Inventory Context',
                columns=[ExcelColumn(title='الفرع', width=26), ExcelColumn(title='وحدات حالية', width=16, cell_type='integer'), ExcelColumn(title='منتجات منخفضة', width=18, cell_type='integer'), ExcelColumn(title='منتجات نافدة', width=18, cell_type='integer'), ExcelColumn(title='وحدات منتهية مسجلة', width=22, cell_type='integer'), ExcelColumn(title='وحدات قريبة الصلاحية', width=22, cell_type='integer'), ExcelColumn(title='طلبات توريد معلقة', width=20, cell_type='integer'), ExcelColumn(title='تحويلات واردة', width=18, cell_type='integer'), ExcelColumn(title='تحويلات صادرة', width=18, cell_type='integer'), ExcelColumn(title='مرتجعات معلقة', width=18, cell_type='integer')],
                rows=([row['branch_name'], row['inventory']['stock_units'], row['inventory']['low_stock_products'], row['inventory']['out_of_stock_products'], row['inventory']['expired_batch_units'], row['inventory']['near_expiry_batch_units'], row['inventory']['pending_supply_requests'], row['inventory']['inbound_transfers'], row['inventory']['outbound_transfers'], row['inventory']['pending_returns']] for row in rows),
            ),
        ])
        filename = build_export_filename('Branch_Performance', extension='xlsx', qualifiers=[filters.date_from.isoformat(), filters.date_to.isoformat()], exported_on=get_cairo_date())
        return send_file(workbook_file, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', as_attachment=True, download_name=filename)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error exporting branch performance: {exc}")
        return jsonify({'error': 'Failed to export branch performance report', 'details': str(exc)}), 500


def _employee_report_wallet_visible():
    return g.current_user.role in {UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN}


@admin_bp.route('/reports/employees', methods=['GET'])
@require_admin
def get_employee_intelligence_report():
    from app.services.reporting_service import build_employee_report

    try:
        filters, allowed_branch_ids = _report_request_context()
        options = _report_table_options()
        return jsonify(build_employee_report(
            allowed_branch_ids, filters, **options,
            include_wallet=_employee_report_wallet_visible(),
        )), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching employee intelligence report: {exc}")
        return jsonify({'error': 'Failed to fetch employee intelligence report', 'details': str(exc)}), 500


@admin_bp.route('/reports/employees/<int:employee_id>', methods=['GET'])
@require_admin
def get_employee_intelligence_drilldown(employee_id):
    from app.services.reporting_service import build_employee_drilldown

    try:
        filters, allowed_branch_ids = _report_request_context()
        payload = build_employee_drilldown(
            allowed_branch_ids, filters, employee_id,
            include_wallet=_employee_report_wallet_visible(),
        )
        if payload is None:
            return jsonify({'error': 'Employee activity not found in the authorized report scope'}), 404
        return jsonify(payload), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching employee intelligence drilldown: {exc}")
        return jsonify({'error': 'Failed to fetch employee intelligence drilldown', 'details': str(exc)}), 500


@admin_bp.route('/reports/employees/export/xlsx', methods=['GET'])
@require_admin
def export_employee_intelligence_xlsx():
    from app.services.reporting_service import employee_export_report

    try:
        filters, allowed_branch_ids = _report_request_context()
        report = employee_export_report(allowed_branch_ids, filters, include_wallet=_employee_report_wallet_visible())
        rows = report['table']['items']
        sheets = []
        if filters.employee_mode == 'CASHIER':
            sheets.append(ExcelSheet(
                name='Cashier Operations',
                columns=[ExcelColumn(title='الكاشير', width=28), ExcelColumn(title='الفرع الحالي', width=24), ExcelColumn(title='فروع المعاملات', width=32), ExcelColumn(title='الحالة الحالية', width=18), ExcelColumn(title='الفواتير المحصلة', width=18, cell_type='integer'), ExcelColumn(title='صافي المبيعات المعالجة', width=24, cell_type='amount'), ExcelColumn(title='متوسط الفاتورة', width=20, cell_type='amount'), ExcelColumn(title='فواتير دفع مختلط', width=20, cell_type='integer'), ExcelColumn(title='أكواد خصم مؤكدة', width=20, cell_type='integer'), ExcelColumn(title='تحصيلات العربون', width=20, cell_type='amount'), ExcelColumn(title='أيام مفتوحة', width=16, cell_type='integer'), ExcelColumn(title='أيام مغلقة', width=16, cell_type='integer'), ExcelColumn(title='إجمالي الفروق المطلقة', width=24, cell_type='amount'), ExcelColumn(title='أحداث تدقيق الفواتير', width=22, cell_type='integer')],
                rows=([row['employee_name'], row['current_branch_name'] or '', '، '.join(branch['branch_name'] for branch in row['transaction_branches']), row['current_status'], row['paid_invoices_finalized'], row['net_sales_finalized'], row['average_ticket_finalized'], row['payments']['split_payment_invoice_count'], row['operations']['promo_redemptions_confirmed'], row['operations']['deposit_collections'], row['operations']['business_days_opened'], row['operations']['business_days_closed'], row['operations']['closed_day_absolute_variance'], row['operations']['audit_event_count']] for row in rows),
            ))
        else:
            role_label = 'حلاق' if filters.employee_mode == 'BARBER' else 'مساعد'
            sheets.extend([
                ExcelSheet(
                    name='Employee Comparison',
                    columns=[ExcelColumn(title=role_label, width=28), ExcelColumn(title='الدور الحالي', width=18), ExcelColumn(title='الفرع الحالي', width=24), ExcelColumn(title='فروع المعاملات', width=32), ExcelColumn(title='الحالة الحالية', width=18), ExcelColumn(title='قيمة الخدمات الإجمالية المسندة', width=28, cell_type='amount'), ExcelColumn(title='وحدات الخدمة', width=18, cell_type='integer'), ExcelColumn(title='الفواتير المؤهلة', width=18, cell_type='integer'), ExcelColumn(title='العملاء المعروفون', width=18, cell_type='integer'), ExcelColumn(title='متوسط القيمة للوحدة', width=22, cell_type='amount'), ExcelColumn(title='العمولة المستحقة المسجلة', width=26, cell_type='amount'), ExcelColumn(title='عينة محدودة', width=16)],
                    rows=([row['employee_name'], row['current_role'], row['current_branch_name'] or '', '، '.join(branch['branch_name'] for branch in row['transaction_branches']), row['current_status'], row['gross_service_value'], row['service_units'], row['paid_invoice_count'], row['identified_customer_count'], row['average_gross_per_unit'], row['service_commission_accrued'], 'نعم' if row['low_base'] else 'لا'] for row in rows),
                ),
                ExcelSheet(
                    name='Service Activity',
                    columns=[ExcelColumn(title=role_label, width=28), ExcelColumn(title='الخدمة', width=28), ExcelColumn(title='الفئة', width=24), ExcelColumn(title='القيمة الإجمالية', width=20, cell_type='amount'), ExcelColumn(title='الوحدات', width=14, cell_type='integer'), ExcelColumn(title='الحصة %', width=14, cell_type='number')],
                    rows=([row['employee_name'], item['service_name'], item['category_name'], item['gross_value'], item['units'], item['share_percent']] for row in rows for item in row['top_services']),
                ),
                ExcelSheet(
                    name='Commission Context',
                    columns=[ExcelColumn(title=role_label, width=28), ExcelColumn(title='عمولة الخدمات المستحقة', width=24, cell_type='amount'), ExcelColumn(title='عمولة المنتجات المستحقة', width=24, cell_type='amount'), ExcelColumn(title='سحوبات العمولات', width=22, cell_type='amount'), ExcelColumn(title='الرصيد الحالي', width=20, cell_type='amount')],
                    rows=([row['employee_name'], row['service_commission_accrued'], row['products']['product_commission_accrued'], row['financial_actions']['COMMISSION_WITHDRAWAL']['amount'], row['current_wallet'] if row['current_wallet'] is not None else ''] for row in rows),
                ),
                ExcelSheet(
                    name='Product Sales',
                    columns=[ExcelColumn(title='الموظف', width=28), ExcelColumn(title='المنتج', width=28), ExcelColumn(title='القيمة الإجمالية المسندة', width=24, cell_type='amount'), ExcelColumn(title='الوحدات', width=14, cell_type='integer'), ExcelColumn(title='عمولة المنتج', width=20, cell_type='amount')],
                    rows=([row['employee_name'], item['product_name'], item['gross_value'], item['units'], item['commission_accrued']] for row in rows for item in row['products']['top_products']),
                ),
            ])
            if filters.employee_mode == 'BARBER':
                sheets.append(ExcelSheet(
                    name='Appointments',
                    columns=[ExcelColumn(title='الحلاق', width=28), ExcelColumn(title='المواعيد المسندة', width=18, cell_type='integer'), ExcelColumn(title='مجدولة', width=14, cell_type='integer'), ExcelColumn(title='مكتملة', width=14, cell_type='integer'), ExcelColumn(title='ملغاة', width=14, cell_type='integer'), ExcelColumn(title='مستقبلية', width=14, cell_type='integer'), ExcelColumn(title='بها عربون', width=16, cell_type='integer')],
                    rows=([row['employee_name'], row['appointments']['assigned'], row['appointments']['scheduled'], row['appointments']['completed'], row['appointments']['cancelled'], row['appointments']['future'], row['appointments']['with_deposit']] for row in rows),
                ))
        sheets.extend([
            ExcelSheet(
                name='Attendance',
                columns=[ExcelColumn(title='الموظف', width=28), ExcelColumn(title='جلسات مكتملة', width=18, cell_type='integer'), ExcelColumn(title='أيام حضور مسجلة', width=20, cell_type='integer'), ExcelColumn(title='ساعات مكتملة', width=18, cell_type='number'), ExcelColumn(title='متوسط الجلسة', width=18, cell_type='number'), ExcelColumn(title='جلسات غير مكتملة', width=20, cell_type='integer'), ExcelColumn(title='تغطية الحضور %', width=20, cell_type='number'), ExcelColumn(title='خروج يدوي', width=16, cell_type='integer'), ExcelColumn(title='إغلاق يوم عمل', width=18, cell_type='integer'), ExcelColumn(title='تصحيح إداري', width=18, cell_type='integer')],
                rows=([row['employee_name'], row['attendance']['completed_sessions'], row['attendance']['recorded_workdays'], row['attendance']['recorded_hours'], row['attendance']['average_session_hours'], row['attendance']['incomplete_sessions'], row['attendance']['attendance_coverage'], row['attendance']['checkout_sources'].get('MANUAL', 0), row['attendance']['checkout_sources'].get('BUSINESS_DAY_CLOSE', 0), row['attendance']['checkout_sources'].get('ADMIN_CORRECTION', 0)] for row in rows),
            ),
            ExcelSheet(
                name='Financial Actions',
                columns=[ExcelColumn(title='الموظف', width=28), ExcelColumn(title='سلف', width=18, cell_type='amount'), ExcelColumn(title='خصومات', width=18, cell_type='amount'), ExcelColumn(title='وقت إضافي', width=18, cell_type='amount'), ExcelColumn(title='سحب عمولة', width=18, cell_type='amount'), ExcelColumn(title='تسويات يدوية', width=18, cell_type='amount')],
                rows=([row['employee_name'], row['financial_actions']['ADVANCE']['amount'], row['financial_actions']['DEDUCTION']['amount'], row['financial_actions']['OVERTIME']['amount'], row['financial_actions']['COMMISSION_WITHDRAWAL']['amount'], row['financial_actions']['MANUAL_ADJUSTMENT']['amount']] for row in rows),
            ),
        ])
        workbook_file = build_xlsx_workbook_file(sheets=sheets)
        filename = build_export_filename(f"Employees_{filters.employee_mode}", extension='xlsx', qualifiers=[filters.date_from.isoformat(), filters.date_to.isoformat()], exported_on=get_cairo_date())
        return send_file(workbook_file, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', as_attachment=True, download_name=filename)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error exporting employee intelligence: {exc}")
        return jsonify({'error': 'Failed to export employee intelligence report', 'details': str(exc)}), 500


@admin_bp.route('/reports/customers', methods=['GET'])
@require_admin
def get_customer_intelligence_report():
    from app.services.reporting_service import build_customer_report

    try:
        filters, allowed_branch_ids = _report_request_context()
        return jsonify(build_customer_report(allowed_branch_ids, filters, **_report_table_options())), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching customer intelligence report: {exc}")
        return jsonify({'error': 'Failed to fetch customer intelligence report', 'details': str(exc)}), 500


@admin_bp.route('/reports/customers/<int:customer_id>', methods=['GET'])
@require_admin
def get_customer_intelligence_drilldown(customer_id):
    from app.services.reporting_service import build_customer_drilldown

    try:
        filters, allowed_branch_ids = _report_request_context()
        payload = build_customer_drilldown(allowed_branch_ids, filters, customer_id)
        if payload is None:
            return jsonify({'error': 'Customer paid activity not found in the authorized report scope'}), 404
        return jsonify(payload), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching customer intelligence drilldown: {exc}")
        return jsonify({'error': 'Failed to fetch customer intelligence drilldown', 'details': str(exc)}), 500


@admin_bp.route('/reports/customers/export/xlsx', methods=['GET'])
@require_admin
def export_customer_intelligence_xlsx():
    from app.models.appointment import Appointment
    from app.models.promo_code import PromoRedemption
    from app.services.reporting_service import (
        _customer_invoice_conditions,
        customer_export_report,
    )

    try:
        filters, allowed_branch_ids = _report_request_context()
        search = str(request.args.get('search') or '').strip()
        report = customer_export_report(allowed_branch_ids, filters, search=search)
        rows = report['table']['items']
        included_ids = [row['customer_id'] for row in rows]
        paid_activity = []
        if included_ids:
            paid_activity = (
                db.session.query(
                    Invoice.invoice_number, Invoice.invoice_date, Customer.id, Customer.full_name,
                    Branch.name, Invoice.total_amount, Invoice.discount_amount,
                )
                .join(Customer, Customer.id == Invoice.customer_id)
                .join(Branch, Branch.id == Invoice.branch_id)
                .filter(
                    *_customer_invoice_conditions(allowed_branch_ids, filters, identified_only=True),
                    Invoice.customer_id.in_(included_ids),
                )
                .order_by(Invoice.invoice_date.desc(), Invoice.id.desc()).all()
            )
        summary = report['summary']
        coverage = report['coverage']
        overview_rows = [
            ['من تاريخ', report['meta']['date_from']], ['إلى تاريخ', report['meta']['date_to']],
            ['سجلات عملاء بنشاط مدفوع', summary['identified_customers']],
            ['تغطية الفواتير المعروفة %', coverage['identified_invoice_share']],
            ['صافي إنفاق العملاء المعروفين', summary['identified_net_spend']],
            ['الفواتير المدفوعة المعروفة', summary['paid_invoice_count']],
            ['متوسط الفاتورة', summary['average_ticket'] if summary['average_ticket'] is not None else ''],
            ['أول نشاط مدفوع مسجل', summary['first_known_customers']],
            ['عملاء مدفوعون معروفون سابقًا', summary['previously_known_customers']],
            ['تكرار على أيام دفع مميزة', summary['repeat_paid_day_customers']],
            ['حصة التكرار %', summary['repeat_share']],
            ['حد عدم النشاط بالأيام', report['meta']['dormancy_days']],
        ]
        sheets = [
            ExcelSheet(
                name='Customer Overview',
                columns=[ExcelColumn(title='المقياس', width=38), ExcelColumn(title='القيمة', width=24)],
                rows=overview_rows,
            ),
            ExcelSheet(
                name='Customer Comparison',
                columns=[
                    ExcelColumn(title='معرف سجل العميل', width=18, cell_type='integer'), ExcelColumn(title='العميل', width=28),
                    ExcelColumn(title='فرع السجل', width=24), ExcelColumn(title='صافي إنفاق الفترة', width=22, cell_type='amount'),
                    ExcelColumn(title='الفواتير المدفوعة', width=18, cell_type='integer'), ExcelColumn(title='تواريخ الدفع المميزة', width=20, cell_type='integer'),
                    ExcelColumn(title='متوسط الفاتورة', width=20, cell_type='amount'), ExcelColumn(title='آخر تاريخ دفع', width=18),
                    ExcelColumn(title='الحداثة بالأيام', width=18, cell_type='integer'), ExcelColumn(title='الفئة التاريخية', width=26),
                    ExcelColumn(title='تكرار على أيام مميزة', width=22), ExcelColumn(title='أعلى خدمة بالوحدات', width=28),
                    ExcelColumn(title='أعلى حلاق مسجل', width=28), ExcelColumn(title='استردادات برومو', width=18, cell_type='integer'),
                    ExcelColumn(title='صافي العمر المسجل', width=22, cell_type='amount'),
                ],
                rows=([
                    row['customer_id'], row['customer_name'], row['record_branch_name'], row['net_spend'], row['paid_invoice_count'],
                    row['paid_date_count'], row['average_ticket'] if row['average_ticket'] is not None else '', row['last_paid_date'] or '',
                    row['recency_days'], 'أول نشاط مدفوع مسجل' if row['cohort'] == 'FIRST_KNOWN' else 'معروف مدفوعًا سابقًا',
                    'نعم' if row['behavioral_repeat'] else 'لا', row['top_service']['service_name'] if row['top_service'] else '',
                    row['top_barber_affinity']['barber_name'] if row['top_barber_affinity'] else '', row['promo']['redemption_count'],
                    row['recorded_lifetime_net_spend'],
                ] for row in rows),
            ),
            ExcelSheet(
                name='Paid Activity',
                columns=[ExcelColumn(title='رقم الفاتورة', width=16), ExcelColumn(title='تاريخ الدفع', width=16), ExcelColumn(title='معرف العميل', width=16, cell_type='integer'), ExcelColumn(title='العميل', width=28), ExcelColumn(title='فرع المعاملة', width=24), ExcelColumn(title='الإجمالي', width=18, cell_type='amount'), ExcelColumn(title='الخصم', width=18, cell_type='amount'), ExcelColumn(title='الصافي', width=18, cell_type='amount')],
                rows=([invoice_number, invoice_date.isoformat(), customer_id, customer_name or 'عميل غير مسمى', branch_name, gross, discount or 0, (gross or 0) - (discount or 0)] for invoice_number, invoice_date, customer_id, customer_name, branch_name, gross, discount in paid_activity),
            ),
            ExcelSheet(
                name='Service Preferences',
                columns=[ExcelColumn(title='معرف العميل', width=16, cell_type='integer'), ExcelColumn(title='العميل', width=28), ExcelColumn(title='الخدمة', width=28), ExcelColumn(title='الفئة', width=24), ExcelColumn(title='الوحدات', width=14, cell_type='integer'), ExcelColumn(title='القيمة الإجمالية', width=20, cell_type='amount'), ExcelColumn(title='الفواتير المحتوية', width=18, cell_type='integer')],
                rows=([row['customer_id'], row['customer_name'], item['service_name'], item['category_name'], item['units'], item['gross_value'], item['invoice_count']] for row in rows for item in row['service_preferences']),
            ),
            ExcelSheet(
                name='Product Preferences',
                columns=[ExcelColumn(title='معرف العميل', width=16, cell_type='integer'), ExcelColumn(title='العميل', width=28), ExcelColumn(title='المنتج', width=28), ExcelColumn(title='الوحدات', width=14, cell_type='integer'), ExcelColumn(title='القيمة الإجمالية', width=20, cell_type='amount'), ExcelColumn(title='الفواتير المحتوية', width=18, cell_type='integer')],
                rows=([row['customer_id'], row['customer_name'], item['product_name'], item['units'], item['gross_value'], item['invoice_count']] for row in rows for item in row['product_preferences']),
            ),
            ExcelSheet(
                name='Appointment Context',
                columns=[ExcelColumn(title='معرف العميل', width=16, cell_type='integer'), ExcelColumn(title='العميل', width=28), ExcelColumn(title='مجدولة', width=14, cell_type='integer'), ExcelColumn(title='مكتملة', width=14, cell_type='integer'), ExcelColumn(title='ملغاة', width=14, cell_type='integer'), ExcelColumn(title='مستقبلية مجدولة', width=18, cell_type='integer'), ExcelColumn(title='مواعيد بعربون', width=18, cell_type='integer'), ExcelColumn(title='تحصيلات عربون مسجلة', width=22, cell_type='amount'), ExcelColumn(title='الرصيد الحالي المسجل', width=22, cell_type='amount')],
                rows=([row['customer_id'], row['customer_name'], row['appointments']['scheduled'], row['appointments']['completed'], row['appointments']['cancelled'], row['appointments']['future_scheduled'], row['appointments']['with_deposit'], row['deposits']['collection_amount'], row['recorded_current_deposit_balance']] for row in rows),
            ),
            ExcelSheet(
                name='Promo Context',
                columns=[ExcelColumn(title='معرف العميل', width=16, cell_type='integer'), ExcelColumn(title='العميل', width=28), ExcelColumn(title='استردادات', width=16, cell_type='integer'), ExcelColumn(title='خصم البرومو', width=18, cell_type='amount'), ExcelColumn(title='صافي فواتير البرومو', width=22, cell_type='amount'), ExcelColumn(title='حصة فواتير البرومو %', width=22, cell_type='number')],
                rows=([row['customer_id'], row['customer_name'], row['promo']['redemption_count'], row['promo']['promo_discount_amount'], row['promo']['net_sales_on_promo_invoices'], row['promo']['invoice_share']] for row in rows),
            ),
        ]
        workbook_file = build_xlsx_workbook_file(sheets=sheets)
        filename = build_export_filename('Customer_Intelligence', extension='xlsx', qualifiers=[filters.date_from.isoformat(), filters.date_to.isoformat()], exported_on=get_cairo_date())
        return send_file(workbook_file, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', as_attachment=True, download_name=filename)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error exporting customer intelligence: {exc}")
        return jsonify({'error': 'Failed to export customer intelligence report', 'details': str(exc)}), 500


# ============================================================================
# EXECUTIVE OVERVIEW REPORT (PHASE 8)
# ============================================================================

@admin_bp.route('/reports/overview', methods=['GET'])
@require_admin
def get_executive_overview_report():
    from app.services.overview_reporting_service import build_executive_overview

    try:
        filters, allowed_branch_ids = _report_request_context()
        return jsonify(build_executive_overview(
            allowed_branch_ids,
            filters,
            fixed_branch_scope=g.current_user.role == UserRole.BRANCH_MANAGER,
        )), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching executive overview report: {exc}")
        return jsonify({'error': 'Failed to fetch executive overview report', 'details': str(exc)}), 500


# ============================================================================
# OPERATIONS INTELLIGENCE REPORT (PHASE 7)
# ============================================================================

@admin_bp.route('/reports/operations', methods=['GET'])
@require_admin
def get_operations_intelligence_report():
    from app.services.operations_reporting_service import build_operations_report

    try:
        filters, allowed_branch_ids = _report_request_context()
        page_keys = ('business_days', 'appointments', 'inventory', 'movements', 'supply', 'shipments', 'returns')
        pages = {
            key: max(request.args.get(f'{key}_page', default=1, type=int) or 1, 1)
            for key in page_keys
        }
        per_page = min(max(request.args.get('detail_per_page', default=20, type=int) or 20, 5), 50)
        return jsonify(build_operations_report(allowed_branch_ids, filters, pages=pages, per_page=per_page)), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching operations intelligence report: {exc}")
        return jsonify({'error': 'Failed to fetch operations intelligence report', 'details': str(exc)}), 500


@admin_bp.route('/reports/operations/<string:entity_type>/<int:entity_id>', methods=['GET'])
@require_admin
def get_operations_intelligence_drilldown(entity_type, entity_id):
    from app.services.operations_reporting_service import build_operations_drilldown

    try:
        filters, allowed_branch_ids = _report_request_context()
        payload = build_operations_drilldown(allowed_branch_ids, filters, entity_type, entity_id)
        if payload is None:
            return jsonify({'error': 'Operational record not found in the authorized report scope'}), 404
        return jsonify(payload), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching operations drilldown: {exc}")
        return jsonify({'error': 'Failed to fetch operations drilldown', 'details': str(exc)}), 500


@admin_bp.route('/reports/operations/export/xlsx', methods=['GET'])
@require_admin
def export_operations_intelligence_xlsx():
    from app.services.operations_reporting_service import build_operations_report

    try:
        filters, allowed_branch_ids = _report_request_context()
        # Export contains the complete authorized filtered detail, independent
        # from the paginated on-screen operational lists.
        report = build_operations_report(allowed_branch_ids, filters, per_page=1_000_000)
        summary = report['summary']
        attendance = report['attendance']
        sheets = [
            ExcelSheet(
                name='Operations Overview',
                columns=[ExcelColumn(title='المقياس', width=38), ExcelColumn(title='القيمة', width=24), ExcelColumn(title='النوع', width=22)],
                rows=[
                    ['جلسات الحضور المكتملة', summary['completed_sessions'], 'نشاط فترة'],
                    ['ساعات الحضور المسجلة', summary['recorded_hours'], 'نشاط فترة'],
                    ['عدد المواعيد', summary['appointment_count'], 'نشاط فترة'],
                    ['نسبة المواعيد المكتملة %', summary['appointment_completion_share'], 'نشاط فترة'],
                    ['عدد تحصيلات العربون', summary['deposit_collection_count'], 'نشاط فترة'],
                    ['قيمة تحصيلات العربون', summary['deposit_collection_amount'], 'نشاط فترة'],
                    ['أيام العمل القديمة المفتوحة', summary['old_open_business_days'], 'مقياس رقابي'],
                    ['منتجات منخفضة حاليًا', summary['current_low_stock_products'], 'لقطة حالية'],
                    ['منتجات نافدة حاليًا', summary['current_out_of_stock_products'], 'لقطة حالية'],
                ],
            ),
            ExcelSheet(
                name='Attendance',
                columns=[ExcelColumn(title='المقياس', width=38), ExcelColumn(title='القيمة', width=22)],
                rows=[
                    ['جلسات مكتملة', attendance['completed_sessions']], ['جلسات غير مكتملة', attendance['incomplete_sessions']],
                    ['ساعات مسجلة', attendance['recorded_hours']], ['متوسط مدة الجلسة بالساعات', attendance['average_session_hours']],
                    ['أيام عمل مسجلة', attendance['recorded_workdays']], ['أيام إرثية دون رابط يوم عمل', attendance['legacy_workdays']],
                    ['حاضرون الآن', attendance['present_now']], ['خروج يدوي', attendance['checkout_sources']['MANUAL']],
                    ['خروج عند غلق يوم العمل', attendance['checkout_sources']['BUSINESS_DAY_CLOSE']],
                    ['تصحيح إداري', attendance['checkout_sources']['ADMIN_CORRECTION']],
                ],
            ),
            ExcelSheet(
                name='Appointments',
                columns=[ExcelColumn(title='المعرف', width=14, cell_type='integer'), ExcelColumn(title='التاريخ', width=16), ExcelColumn(title='الوقت', width=14), ExcelColumn(title='الفرع', width=24), ExcelColumn(title='العميل', width=26), ExcelColumn(title='الحلاق', width=24), ExcelColumn(title='الخدمة المسجلة', width=28), ExcelColumn(title='الحالة الحالية', width=18), ExcelColumn(title='قيمة العربون المسجلة', width=20, cell_type='amount'), ExcelColumn(title='تحصيلات عربون', width=16, cell_type='integer')],
                rows=([row['appointment_id'], row['date'], row['time'], row['branch_name'], row['customer_name'], row['barber_name'] or '', row['service_name'] or '', row['status'], row['deposit_amount'], row['deposit_collection_count']] for row in report['appointments']['items']),
            ),
            ExcelSheet(
                name='Business-Day Control',
                columns=[ExcelColumn(title='يوم العمل', width=14, cell_type='integer'), ExcelColumn(title='التاريخ التشغيلي', width=18), ExcelColumn(title='الفرع', width=24), ExcelColumn(title='الحالة', width=14), ExcelColumn(title='مدة الفتح بالساعات', width=20, cell_type='number'), ExcelColumn(title='فاتح اليوم', width=24), ExcelColumn(title='مغلق اليوم', width=24), ExcelColumn(title='جلسات حضور مرتبطة', width=20, cell_type='integer'), ExcelColumn(title='خروج تلقائي', width=16, cell_type='integer'), ExcelColumn(title='تصحيحات إدارية', width=18, cell_type='integer'), ExcelColumn(title='حضور مفتوح', width=16, cell_type='integer'), ExcelColumn(title='يوم قديم مفتوح', width=18)],
                rows=([row['business_day_id'], row['business_date'], row['branch_name'], row['status'], row['duration_hours'], row['opened_by'], row['closed_by'] or '', row['attendance_sessions'], row['auto_checkouts'], row['admin_corrections'], row['active_attendance'], 'نعم' if row['old_open'] else 'لا'] for row in report['business_days']['items']),
            ),
            ExcelSheet(
                name='Inventory Health',
                columns=[ExcelColumn(title='الفرع', width=24), ExcelColumn(title='المنتج', width=28), ExcelColumn(title='الفئة', width=20), ExcelColumn(title='المخزون الحالي', width=18, cell_type='integer'), ExcelColumn(title='الحد الأدنى', width=16, cell_type='integer'), ExcelColumn(title='الحالة', width=16), ExcelColumn(title='متاح تشغيليًا', width=18), ExcelColumn(title='وحدات مباعة في الفترة', width=20, cell_type='integer'), ExcelColumn(title='بطيء الحركة', width=16), ExcelColumn(title='كمية دفعات متتبعة', width=20, cell_type='integer'), ExcelColumn(title='اختلاف تغطية الدفعات', width=22)],
                rows=([row['branch_name'], row['product_name'], row['category'] or '', row['current_stock'], row['min_stock_threshold'], row['state'], 'نعم' if row['is_available'] else 'لا', row['units_sold'], 'نعم' if row['slow_moving'] else 'لا', row['tracked_batch_quantity'], 'نعم' if row['batch_mismatch'] else 'لا'] for row in report['inventory']['items']),
            ),
            ExcelSheet(
                name='Stock Movements',
                columns=[ExcelColumn(title='المعرف', width=14, cell_type='integer'), ExcelColumn(title='التاريخ', width=24), ExcelColumn(title='الفرع', width=24), ExcelColumn(title='المنتج', width=28), ExcelColumn(title='النوع', width=24), ExcelColumn(title='الكمية المطلقة', width=18, cell_type='integer'), ExcelColumn(title='المنفذ', width=24), ExcelColumn(title='الفاتورة', width=14), ExcelColumn(title='ملاحظات', width=38)],
                rows=([row['movement_id'], row['date'], row['branch_name'], row['product_name'], row['type'], row['quantity'], row['actor_name'] or '', row['invoice_id'] or '', row['notes'] or ''] for row in report['movements']['items']),
            ),
            ExcelSheet(
                name='Supply and Shipments',
                columns=[ExcelColumn(title='النوع', width=18), ExcelColumn(title='المرجع', width=22), ExcelColumn(title='الحالة', width=18), ExcelColumn(title='الفرع أو المصدر', width=24), ExcelColumn(title='الوجهة', width=24), ExcelColumn(title='الوحدات', width=16, cell_type='integer'), ExcelColumn(title='الإنشاء', width=24), ExcelColumn(title='الإرسال أو الاستلام', width=24)],
                rows=(
                    [['طلب إمداد', row['request_ref'], row['status'], row['branch_name'], '', row['final_units'] or row['requested_units'], row['created_at'], row['sent_at'] or ''] for row in report['supply']['items']]
                    + [['شحنة', row['shipment_ref'], row['status'], row['source_name'] or 'توريد مورد', row['destination_name'], row['units'], row['created_at'], row['received_at'] or ''] for row in report['shipments']['items']]
                ),
            ),
            ExcelSheet(
                name='Returns',
                columns=[ExcelColumn(title='المرجع', width=22), ExcelColumn(title='الفرع', width=24), ExcelColumn(title='المنتج', width=28), ExcelColumn(title='الكمية', width=14, cell_type='integer'), ExcelColumn(title='السبب', width=24), ExcelColumn(title='الحالة', width=24), ExcelColumn(title='المنشئ', width=24), ExcelColumn(title='المعالج', width=24), ExcelColumn(title='الإنشاء', width=24), ExcelColumn(title='الحل', width=24), ExcelColumn(title='مدة الحل بالساعات', width=20, cell_type='number')],
                rows=([row['return_ref'], row['branch_name'], row['product_name'], row['quantity'], row['reason'], row['status'], row['creator_name'], row['resolver_name'] or '', row['created_at'], row['resolved_at'] or '', row['duration_hours'] if row['duration_hours'] is not None else ''] for row in report['returns']['items']),
            ),
            ExcelSheet(
                name='Promo and Deposits',
                columns=[ExcelColumn(title='السياق', width=24), ExcelColumn(title='البند', width=28), ExcelColumn(title='العدد', width=16, cell_type='integer'), ExcelColumn(title='القيمة', width=20, cell_type='amount'), ExcelColumn(title='ملاحظة المنهجية', width=42)],
                rows=(
                    [['عربون', row['method'], row['count'], row['amount'], 'تحصيلات فقط؛ لا يمثل تطبيقًا أو ردًا'] for row in report['deposits']['methods']]
                    + [['برومو', row['code'], row['redemptions'], row['discount_amount'], 'مرتبط بفواتير مدفوعة ويستخدم لقطة الاسترداد'] for row in report['promo']['codes']]
                ),
            ),
        ]
        workbook_file = build_xlsx_workbook_file(sheets=sheets)
        filename = build_export_filename('Operations_Intelligence', extension='xlsx', qualifiers=[filters.date_from.isoformat(), filters.date_to.isoformat()], exported_on=get_cairo_date())
        return send_file(workbook_file, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', as_attachment=True, download_name=filename)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error exporting operations intelligence: {exc}")
        return jsonify({'error': 'Failed to export operations intelligence report', 'details': str(exc)}), 500
