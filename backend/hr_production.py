"""Production entry point for the standalone Hassan Ragab Salon deployment."""

import os

from app import create_app
from app.config import Config


def _parse_origins(value):
    return tuple(dict.fromkeys(
        origin.strip().rstrip("/")
        for origin in value.split(",")
        if origin.strip()
    ))


def _env_flag(name, default):
    return os.environ.get(name, default).strip().lower() in {"1", "true", "yes", "on"}


database_url = os.environ.get("DATABASE_URL", "")
if database_url.startswith("postgres://"):
    database_url = "postgresql+psycopg2://" + database_url[len("postgres://"):]
elif database_url.startswith("postgresql://") and "+psycopg2" not in database_url:
    database_url = "postgresql+psycopg2://" + database_url[len("postgresql://"):]
if database_url:
    Config.SQLALCHEMY_DATABASE_URI = database_url

Config.STAFF_IDENTITY_HR_RUNTIME = True
Config.STAFF_IDENTITY_ENABLED = _env_flag("STAFF_IDENTITY_ENABLED", "false")

Config.MINI_LEGACY_DEVICE_COMPATIBILITY_ENABLED = _env_flag(
    "MINI_LEGACY_DEVICE_COMPATIBILITY_ENABLED",
    "false",
)
Config.MINI_PROOF_ENROLLMENT_REQUIRED = _env_flag(
    "MINI_PROOF_ENROLLMENT_REQUIRED",
    "true",
)
Config.MINI_DEVICE_COOKIE_NAME = "hr_mini_device_credential"
Config.MINI_ENROLLMENT_PROOF_COOKIE_NAME = "hr_mini_enrollment_proof"
Config.SESSION_COOKIE_NAME = "hr_session"

external_api_base = os.environ.get("MINI_EXTERNAL_API_BASE_URL", "").strip().rstrip("/")
cors_origins = _parse_origins(
    os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        "http://127.0.0.1:3200,http://127.0.0.1:5276",
    )
)
mini_trusted_origins = _parse_origins(
    os.environ.get(
        "MINI_TRUSTED_ORIGINS",
        "http://127.0.0.1:3200,http://127.0.0.1:5276",
    )
)

Config.API_CORS_ALLOWED_ORIGINS = cors_origins
Config.MINI_FINALIZATION_TRUSTED_ORIGINS = mini_trusted_origins
Config.MINI_PROOF_TRUSTED_ORIGINS = mini_trusted_origins
Config.MINI_EXTERNAL_API_BASE_URL = external_api_base
Config.MINI_PROOF_ALLOWED_API_BASE_URLS = tuple(dict.fromkeys(
    ([external_api_base] if external_api_base else []) + list(mini_trusted_origins)
))

Config.SQLALCHEMY_ENGINE_OPTIONS = dict(
    Config.SQLALCHEMY_ENGINE_OPTIONS,
    pool_size=5,
    max_overflow=0,
)

app = create_app(bootstrap=False)
