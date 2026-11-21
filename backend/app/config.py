import os
from datetime import timedelta

class Config:
    # Not enabled by ambient environment; Omar runtime must opt in explicitly.
    STAFF_IDENTITY_ENABLED = False
    STAFF_IDENTITY_OMAR_RUNTIME = False
    STAFF_TRUSTED_ORIGINS = ()  # Explicit HTTPS Staff origin required before enablement.
    # Enable only AFTER the additive metadata migration. No private-file runtime dependency.
    INVENTORY_RECOVERY_ENABLED = os.environ.get('INVENTORY_RECOVERY_ENABLED', 'false').lower() == 'true'
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL')
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY')
    SECRET_KEY = os.environ.get('SECRET_KEY')

    # JWT Token Expiry — Access: 14 hours, Refresh: 7 days
    JWT_ACCESS_TOKEN_EXPIRES  = timedelta(hours=14)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=7)
    # Developer Master Token
    DEV_MASTER_TOKEN = os.environ.get('DEV_MASTER_TOKEN')
    
    # Cloudinary Configuration
    CLOUDINARY_CLOUD_NAME = os.environ.get('CLOUDINARY_CLOUD_NAME')
    CLOUDINARY_API_KEY = os.environ.get('CLOUDINARY_API_KEY')
    CLOUDINARY_API_SECRET = os.environ.get('CLOUDINARY_API_SECRET')

    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Phase 1: Intermediate DB Tuning (Fixed for Gunicorn 12 threads)
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_size": 10,
        "max_overflow": 10,
        "pool_timeout": 30,
        "pool_recycle": 1800,
        "pool_pre_ping": True,
    }

    # Session Cookie Configuration
    # In development (HTTP): SameSite=Lax, Secure=False — cookies work without HTTPS
    # In production (HTTPS): SameSite=None, Secure=True — required for cross-origin cookies
    _is_dev = os.environ.get('FLASK_ENV') == 'development'
    SESSION_COOKIE_SAMESITE = "Lax" if _is_dev else "None"
    SESSION_COOKIE_SECURE = not _is_dev   # False locally, True in production
    SESSION_COOKIE_HTTPONLY = True

    # Mini is same-origin through Vite locally, but production Mini calls the
    # Railway API from secretmen-crm.com. Cross-site cookies therefore require
    # SameSite=None + Secure in production.
    MINI_DEVICE_COOKIE_NAME = "hr_mini_device_credential"
    MINI_ENROLLMENT_PROOF_COOKIE_NAME = "hr_mini_enrollment_proof"
    MINI_DEVICE_COOKIE_SECURE = not _is_dev
    MINI_DEVICE_COOKIE_SAMESITE = "Lax" if _is_dev else "None"
    MINI_DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365
    MINI_ENROLLMENT_PROOF_COOKIE_MAX_AGE = 60 * 15
    MINI_DEVICE_REPAIR_TTL_MINUTES = 15
    MINI_PROOF_ENROLLMENT_REQUIRED = (
        os.environ.get("MINI_PROOF_ENROLLMENT_REQUIRED", "true").lower()
        in {"1", "true", "yes", "on"}
    )
    MINI_PROOF_CHALLENGE_TTL_SECONDS = int(
        os.environ.get("MINI_PROOF_CHALLENGE_TTL_SECONDS", "120")
    )
    MINI_PROOF_FINALIZATION_TTL_SECONDS = int(
        os.environ.get("MINI_PROOF_FINALIZATION_TTL_SECONDS", "300")
    )
    MINI_PROOF_IAT_SKEW_SECONDS = int(
        os.environ.get("MINI_PROOF_IAT_SKEW_SECONDS", "60")
    )
    MINI_PROOF_REPLAY_TTL_SECONDS = int(
        os.environ.get("MINI_PROOF_REPLAY_TTL_SECONDS", "180")
    )
    # Production must use a configured, externally visible API base. Development
    # additionally accepts the trusted local frontend origins because Vite proxies
    # /api and the browser signs the URL it actually requested.
    MINI_EXTERNAL_API_BASE_URL = os.environ.get(
        "MINI_EXTERNAL_API_BASE_URL",
        "",
    ).rstrip("/")
    # Keep true during the branch-by-branch rollout. Set explicitly to false
    # only after the Admin fleet snapshot reports zero legacy devices.
    MINI_LEGACY_DEVICE_COMPATIBILITY_ENABLED = (
        os.environ.get("MINI_LEGACY_DEVICE_COMPATIBILITY_ENABLED", "true").lower()
        in {"1", "true", "yes", "on"}
    )
    API_CORS_ALLOWED_ORIGINS = ('http://127.0.0.1:3200', 'http://127.0.0.1:5276')
    MINI_FINALIZATION_TRUSTED_ORIGINS = ('http://127.0.0.1:3200', 'http://127.0.0.1:5276')
    MINI_PROOF_TRUSTED_ORIGINS = MINI_FINALIZATION_TRUSTED_ORIGINS
    MINI_PROOF_ALLOWED_API_BASE_URLS = tuple(
        dict.fromkeys(
            ([MINI_EXTERNAL_API_BASE_URL] if MINI_EXTERNAL_API_BASE_URL else [])
            + (list(MINI_FINALIZATION_TRUSTED_ORIGINS) if _is_dev else [])
        )
    )

    @staticmethod
    def validate():
        if not Config.SQLALCHEMY_DATABASE_URI:
            raise RuntimeError("DATABASE_URL is not set. Check your environment variables.")
        if not Config.JWT_SECRET_KEY:
            raise RuntimeError("JWT_SECRET_KEY is not set. Check your environment variables.")
