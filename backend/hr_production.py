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
    "true",
)
Config.MINI_PROOF_ENROLLMENT_REQUIRED = _env_flag(
    "MINI_PROOF_ENROLLMENT_REQUIRED",
    "true",
)
Config.MINI_DEVICE_COOKIE_NAME = "hr_mini_device_credential"
Config.MINI_ENROLLMENT_PROOF_COOKIE_NAME = "hr_mini_enrollment_proof"
Config.SESSION_COOKIE_NAME = "hr_session"

frontend_url = os.environ.get("FRONTEND_URL", "").strip().rstrip("/")
cors_env = os.environ.get("CORS_ALLOWED_ORIGINS", "").strip()
if not cors_env and frontend_url:
    cors_env = frontend_url
elif not cors_env:
    cors_env = "http://127.0.0.1:3200,http://127.0.0.1:5276"
cors_origins = _parse_origins(cors_env)

mini_trusted_env = os.environ.get("MINI_TRUSTED_ORIGINS", "").strip()
if not mini_trusted_env:
    mini_trusted_origins = cors_origins
else:
    mini_trusted_origins = _parse_origins(mini_trusted_env)

external_api_base = os.environ.get("MINI_EXTERNAL_API_BASE_URL", "").strip().rstrip("/")
if not external_api_base and frontend_url:
    external_api_base = frontend_url
elif not external_api_base and cors_origins and not cors_origins[0].startswith("http://127.0.0.1"):
    external_api_base = cors_origins[0]

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
