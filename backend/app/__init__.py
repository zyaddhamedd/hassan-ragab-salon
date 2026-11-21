from flask import Flask, send_from_directory, jsonify, redirect
import os
from app.config import Config
from app.extensions import db, migrate, jwt
from flask_cors import CORS

def create_app(*, bootstrap=False):
    if not (getattr(Config, 'STAFF_IDENTITY_HR_RUNTIME', False) or getattr(Config, 'STAFF_IDENTITY_OMAR_RUNTIME', False)):
        raise RuntimeError('Use the dedicated standalone Hassan Ragab entry point; ambient Flask startup is disabled.')
    app = Flask(__name__)
    
    # Load config
    app.config.from_object(Config)
    
    # Validate config
    Config.validate()
    
    # Enable CORS for all API routes (Admin + Mini)
    CORS(app, resources={
        r"/api/*": {
            "origins": Config.API_CORS_ALLOWED_ORIGINS,
            "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
            "allow_headers": ["Content-Type", "Authorization", "X-Device-ID", "DPoP"],
            "expose_headers": ["Content-Disposition"],
            "supports_credentials": True
        },
        r"/api/dev/*": {
            "origins": "*",
            "methods": ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
            "allow_headers": ["Content-Type", "X-DEV-TOKEN"]
        }
    })
    
    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)


    try:
        import cloudinary
        if app.config.get('CLOUDINARY_CLOUD_NAME'):
            cloudinary.config(
                cloud_name=app.config.get('CLOUDINARY_CLOUD_NAME'),
                api_key=app.config.get('CLOUDINARY_API_KEY'),
                api_secret=app.config.get('CLOUDINARY_API_SECRET')
            )
            print("[INFO] Cloudinary Configured")
        else:
            print("[WARN] Cloudinary env vars missing")
    except Exception as e:
        print(f"[WARN] Cloudinary import/config failed: {e}")

    
    # CRITICAL: JWT Error Handlers - Return JSON, NOT HTML
    @jwt.unauthorized_loader
    def unauthorized_callback(error):
        """Return JSON error instead of HTML redirect when token is missing"""
        return jsonify({"error": "unauthorized", "message": "Missing or invalid token"}), 401
    
    @jwt.invalid_token_loader
    def invalid_token_callback(error):
        """Return JSON error instead of HTML redirect when token is invalid"""
        return jsonify({"error": "unauthorized", "message": "Invalid token"}), 401
    
    @jwt.expired_token_loader
    def expired_token_callback(jwt_header, jwt_payload):
        """Return JSON error instead of HTML redirect when token is expired"""
        return jsonify({"error": "unauthorized", "message": "Token has expired"}), 401

    # Initialize performance monitoring (if enabled)
    from app.performance import init_performance_monitoring
    init_performance_monitoring(app)

    # Import and register blueprints
    from app.api.mini import mini_bp
    from app.api.admin import admin_bp
    app.register_blueprint(mini_bp)
    app.register_blueprint(admin_bp)
    from app.api.admin_staff_identity import admin_staff_identity_bp
    app.register_blueprint(admin_staff_identity_bp)
    from app.api.staff import staff_bp
    app.register_blueprint(staff_bp)
    from app.api.admin_employee_shifts import admin_employee_shifts_bp
    app.register_blueprint(admin_employee_shifts_bp)
    from app.api.admin_staff_geofence import admin_staff_geofence_bp
    app.register_blueprint(admin_staff_geofence_bp)
    
    # Conditionally load dev routes
    if os.environ.get('ENABLE_DEV_ROUTES', 'False').lower() == 'true':
        from app.api.dev_routes import dev_bp
        app.register_blueprint(dev_bp)
        print("⚠️  Dev routes enabled")

    # Import models to ensure they are discovered by helpers like migrate
    from app import models
    
    if bootstrap:
        raise RuntimeError('Legacy bootstrap is unavailable in standalone Omar; use explicit guarded initialization.')

    # Serve uploaded files
    @app.route('/uploads/<path:filename>')
    def serve_upload(filename):
        upload_root = os.environ.get('UPLOAD_FOLDER')
        if upload_root:
            uploads_dir = upload_root
        else:
            uploads_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'uploads')
            
        file_path = os.path.join(uploads_dir, filename)
        if not os.path.exists(file_path):
            # Fallback for missing images to prevent 404 on frontend
            if filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif')):
                # Use UI Avatars as fallback service
                return redirect("https://ui-avatars.com/api/?name=Employee&background=random&color=fff")
            return jsonify({"error": "File not found"}), 404

        return send_from_directory(uploads_dir, filename)
    
    # Health endpoint
    @app.route('/health')
    def health():
        return jsonify({"status": "ok"}), 200

    # Register CLI commands
    from app.cli import register_cli_commands
    register_cli_commands(app)
    
    return app
