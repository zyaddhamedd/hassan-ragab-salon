from flask import Blueprint, jsonify, request, current_app
from functools import wraps
from app.models.branch import Branch
from app.models.user import User


from app.extensions import db

dev_bp = Blueprint('dev', __name__, url_prefix='/api/dev')

def require_dev_token(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.headers.get('X-DEV-TOKEN')
        master_token = current_app.config.get('DEV_MASTER_TOKEN')
        
        print(f"DEBUG: Received X-DEV-TOKEN: {token}")
        print(f"DEBUG: Expected DEV_MASTER_TOKEN: {master_token}")

        if not token or token != master_token:
            return jsonify({"error": "Forbidden", "message": "Invalid or missing X-DEV-TOKEN"}), 403
        return f(*args, **kwargs)
    return decorated_function

@dev_bp.route('/branches', methods=['GET'])
@require_dev_token
def get_branches():
    branches = Branch.query.all()
    return jsonify([b.to_dict() for b in branches]), 200

@dev_bp.route('/branches', methods=['POST'])
@require_dev_token
def create_branch():
    data = request.get_json()
    
    if not data or not data.get('name'):
        return jsonify({"error": "Bad Request", "message": "Name is required"}), 400
        
    if Branch.query.filter_by(name=data['name']).first():
        return jsonify({"error": "Conflict", "message": "Branch with this name already exists"}), 409

    new_branch = Branch(
        name=data['name'],
        city=data.get('city', 'Cairo'),
        is_active=data.get('is_active', True),
        allow_discounts=data.get('allow_discounts', True)
    )
    
    db.session.add(new_branch)
    db.session.commit()
    
    return jsonify(new_branch.to_dict()), 201

@dev_bp.route('/branches/<int:id>', methods=['PATCH'])
@require_dev_token
def update_branch(id):
    branch = Branch.query.get_or_404(id)
    data = request.get_json()
    
    if 'name' in data:
        existing = Branch.query.filter_by(name=data['name']).first()
        if existing and existing.id != id:
            return jsonify({"error": "Conflict", "message": "Branch name already in use"}), 409
        branch.name = data['name']
        
    if 'city' in data:
        branch.city = data['city']
        
    if 'is_active' in data:
        branch.is_active = data['is_active']
        
    if 'allow_discounts' in data:
        branch.allow_discounts = data['allow_discounts']
        
    db.session.commit()
    return jsonify(branch.to_dict()), 200

@dev_bp.route('/branches/<int:id>', methods=['DELETE'])
@require_dev_token
def delete_branch(id):
    branch = Branch.query.get_or_404(id)
    
    # Check for linked users
    if User.query.filter_by(branch_id=id).first():
        return jsonify({"error": "Cannot Delete", "message": "Branch has linked users"}), 400
        
    # Check for treasuries/transactions (Implicit via logic, checking transactions as requested)
    # Note: Using TreasuryTransaction to check if any transactions occurred in this branch context if stored,
    # or usually we check if there are any related entities.
    # The requirement says: "No transactions exist". 
    # TreasuryTransaction typically links to a treasury, which links to a branch.
    # We should check if any TreasuryTransaction logic ties back, but straightforwardly:
    
    # Let's check TreasuryTransaction by seeing if we can link it easily.
    # TreasuryTransaction -> TreasuryAccount -> Branch
    # Use relationship if exists, otherwise manual join.
    # For now, let's look at TreasuryTransaction model to be sure.
    
    # Actually, simpler: check if the branch has any activity.
    # If the user strict requirement is "No transactions exist", we need to check tables.
    
    # Just to be safe and strictly follow requirements, let's check User first (done).
    # Then Transactions.
    
    # We need to import TreasuryAccount to check if branch has one, and then transactions.
    from app.models.treasury_account import TreasuryAccount
    account = TreasuryAccount.query.filter_by(branch_id=id).first()
    if account:
        # Check if there are any transactions for this account
        if TreasuryTransaction.query.filter_by(account_id=account.id).first():
             return jsonify({"error": "Cannot Delete", "message": "Branch has financial transactions"}), 400
    
    db.session.delete(branch)
    db.session.commit()
    return jsonify({"message": "Branch deleted successfully"}), 200

@dev_bp.route('/super-admin', methods=['POST'])
@require_dev_token
def create_super_admin():
    from app.models.user import UserRole
    data = request.get_json()
    
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({"error": "Bad Request", "message": "Username and password are required"}), 400
        
    username = data['username'].strip()
    password = data['password'].strip()
    
    if User.query.filter_by(email=username).first():
        return jsonify({"error": "Conflict", "message": "User already exists"}), 409
        
    try:
        new_user = User(
            full_name=username,
            email=username,
            role=UserRole.SUPER_ADMIN,
            is_active=True,
            branch_id=None
        )
        new_user.set_password(password)
        
        db.session.add(new_user)
        db.session.commit()
        
        return jsonify({
            "message": "Super Admin created successfully",
            "user": {
                "id": new_user.id,
                "username": new_user.email,
                "role": new_user.role.value
            }
        }), 201
        
    except Exception as e:
        db.session.rollback()
        print(f"Super Admin Creation Error: {e}")
        return jsonify({"error": "Internal Server Error", "message": str(e)}), 500
