"""Error boundary used only by the new promo endpoints."""
from functools import wraps

from flask import current_app, jsonify
from werkzeug.exceptions import HTTPException

from app.extensions import db
from app.services.promo_code_service import PromoError


def promo_api_errors(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        try:
            return view(*args, **kwargs)
        except PromoError as error:
            db.session.rollback()
            return jsonify(error.to_dict()), error.status
        except HTTPException as error:
            db.session.rollback()
            failure = PromoError("PROMO_FORBIDDEN" if error.code == 403 else "PROMO_INVALID_CONFIGURATION", error.code)
            return jsonify(failure.to_dict()), failure.status
        except Exception:
            db.session.rollback()
            current_app.logger.exception("Promo request failed")
            failure = PromoError("PROMO_INTERNAL_ERROR", 500)
            return jsonify(failure.to_dict()), failure.status
    return wrapped
