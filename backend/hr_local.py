"""Hassan Ragab-only local entry point. Default action is offline validation only."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit


WORKSPACE = Path(__file__).resolve().parents[1]
UPLOADS = WORKSPACE / '.local/hassan/uploads'
FIXED = {
    'FLASK_ENV': 'development',
    'FLASK_DEBUG': 'false',
    'PORT': '5204',
    'ENABLE_DEV_ROUTES': 'false',
    'UPLOAD_FOLDER': str(UPLOADS),
    'MINI_EXTERNAL_API_BASE_URL': 'http://127.0.0.1:5204',
}
SECRET_KEYS = {'DATABASE_URL', 'SECRET_KEY', 'JWT_SECRET_KEY'}


def validate(settings):
    """Validate actual values without importing application code or opening sockets."""
    if not isinstance(settings, dict) or set(settings) != set(FIXED) | SECRET_KEYS:
        raise ValueError('Config must contain exactly the Hassan Ragab template keys; no inherited settings.')
    if any(not isinstance(v, str) for v in settings.values()):
        raise ValueError('All config values must be strings.')
    for key, value in FIXED.items():
        if settings[key] != value:
            raise ValueError(f'{key} must match the isolated Hassan Ragab local template.')
    if Path(settings['UPLOAD_FOLDER']).resolve() != UPLOADS:
        raise ValueError('Uploads must resolve to the dedicated Hassan directory (no symlink redirect).')
    try:
        url = urlsplit(settings['DATABASE_URL'])
        valid = (
            url.scheme == 'postgresql'
            and url.hostname == '127.0.0.1'
            and url.port == 55433
            and url.username == 'hassan_ragab_local'
            and url.path == '/hassan_ragab_local'
            and bool(url.password)
            and not url.query and not url.fragment
            and url.netloc.rsplit('@', 1)[-1] == '127.0.0.1:55433'
            and not any(c.isspace() for c in settings['DATABASE_URL'])
            and url.password != 'REPLACE_WITH_FRESH_PASSWORD'
        )
    except ValueError:
        valid = False
    if not valid:
        raise ValueError('DATABASE_URL must target postgresql://hassan_ragab_local:<fresh password>@127.0.0.1:55433/hassan_ragab_local with no URL options.')
    for key in ('SECRET_KEY', 'JWT_SECRET_KEY'):
        value = settings[key]
        if len(value) < 64 or any(c not in '0123456789abcdef' for c in value) or len(set(value)) < 8:
            raise ValueError(f'{key} requires a fresh random secret (at least 64 lowercase hex characters).')
    if settings['SECRET_KEY'] == settings['JWT_SECRET_KEY']:
        raise ValueError('Application and JWT secrets must be distinct.')
    return dict(settings)


def runtime_database_url(settings):
    """Select the installed DBAPI without changing any validated target values."""
    verified = validate(settings)
    from sqlalchemy.engine import make_url
    return make_url(verified['DATABASE_URL']).set(drivername='postgresql+psycopg2')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--start', action='store_true', help='Start after validation')
    args = parser.parse_args()
    try:
        if Path(__file__).resolve().parent.parent != WORKSPACE:
            raise ValueError('This entry point is restricted to the Hassan Ragab worktree.')
        settings = validate(json.loads(args.config.read_text()))
    except (OSError, ValueError):
        parser.exit(2, 'Hassan Ragab preflight rejected configuration. Check the exact local template, database target, uploads path and fresh secrets.\n')
    print('Hassan Ragab preflight accepted; no database connection or application import performed.')
    if not args.start:
        return
    os.environ.clear()
    os.environ.update(settings)
    database_url = runtime_database_url(settings)
    from app import create_app
    from app.config import Config
    Config.STAFF_IDENTITY_HR_RUNTIME = True
    Config.STAFF_IDENTITY_ENABLED = False
    Config.SQLALCHEMY_DATABASE_URI = database_url
    origins = ('http://127.0.0.1:3200', 'http://127.0.0.1:5276')
    Config.API_CORS_ALLOWED_ORIGINS = origins
    Config.MINI_FINALIZATION_TRUSTED_ORIGINS = origins
    Config.MINI_LEGACY_DEVICE_COMPATIBILITY_ENABLED = False
    Config.MINI_PROOF_ENROLLMENT_REQUIRED = True
    Config.MINI_PROOF_TRUSTED_ORIGINS = origins
    Config.MINI_PROOF_ALLOWED_API_BASE_URLS = (settings['MINI_EXTERNAL_API_BASE_URL'],) + origins
    Config.SESSION_COOKIE_NAME = 'hr_session'
    Config.MINI_DEVICE_COOKIE_NAME = 'hr_mini_device_credential'
    Config.MINI_ENROLLMENT_PROOF_COOKIE_NAME = 'hr_mini_enrollment_proof'
    Config.SQLALCHEMY_ENGINE_OPTIONS = dict(Config.SQLALCHEMY_ENGINE_OPTIONS, pool_size=5, max_overflow=0)
    app = create_app(bootstrap=False)
    app.run(host='127.0.0.1', port=int(settings['PORT']), debug=False, use_reloader=False, load_dotenv=False)


if __name__ == '__main__':
    main()
