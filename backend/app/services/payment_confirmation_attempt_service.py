import hashlib
import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.payment_confirmation_attempt import (
    PaymentConfirmationAttempt,
    PaymentConfirmationAttemptStatus,
)


class PaymentAttemptError(ValueError):
    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def normalize_attempt_id(raw_attempt_id) -> str:
    try:
        return str(UUID(str(raw_attempt_id)))
    except (TypeError, ValueError, AttributeError):
        raise PaymentAttemptError(
            "PAYMENT_ATTEMPT_ID_INVALID",
            "معرّف محاولة الدفع غير صالح.",
        )


def _decimal_string(value) -> str:
    try:
        decimal_value = Decimal(str(value if value is not None else 0))
    except (InvalidOperation, ValueError, TypeError):
        return str(value)
    if not decimal_value.is_finite():
        return str(value)
    return format(decimal_value.normalize(), "f")


def build_request_fingerprint(invoice_id: int, payload: dict) -> str:
    raw_payments = payload.get("payments")
    normalized_payments = None
    if isinstance(raw_payments, list):
        normalized_payments = [
            {
                "method": str(payment.get("method", "")).strip().upper(),
                "amount": _decimal_string(payment.get("amount")),
            }
            if isinstance(payment, dict)
            else payment
            for payment in raw_payments
        ]

    material_payload = {
        "invoice_id": int(invoice_id),
        "payment_method": (
            str(payload.get("payment_method")).strip().upper()
            if payload.get("payment_method") is not None
            else None
        ),
        "payments": normalized_payments,
        "discount_amount": _decimal_string(payload.get("discount_amount", 0)),
        "customer_name": payload.get("customer_name"),
        "customer_phone": payload.get("customer_phone"),
        "promo_code": payload.get("promo_code"),
        "quote_id": payload.get("quote_id"),
        "promo_version": payload.get("promo_version"),
    }
    if payload.get('appointment_id') is not None:
        material_payload.update(appointment_id=payload.get('appointment_id'), customer_id=payload.get('customer_id'),
            multi_customer=payload.get('multi_customer', False), expected_deposit_amount=_decimal_string(payload.get('expected_deposit_amount')))
    canonical = json.dumps(
        material_payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def claim_attempt(
    *,
    payment_attempt_id: str,
    invoice_id: int,
    branch_id: int,
    cashier_id: int,
    request_fingerprint: str,
) -> tuple[PaymentConfirmationAttempt, bool]:
    def validate_existing(existing_attempt):
        if (
            existing_attempt.invoice_id != invoice_id
            or existing_attempt.branch_id != branch_id
            or existing_attempt.cashier_id != cashier_id
            or existing_attempt.request_fingerprint != request_fingerprint
        ):
            raise PaymentAttemptError(
                "PAYMENT_ATTEMPT_PAYLOAD_MISMATCH",
                "تعذر استخدام محاولة الدفع نفسها ببيانات مختلفة.",
                409,
            )
        return existing_attempt, False

    existing = db.session.get(PaymentConfirmationAttempt, payment_attempt_id)
    if existing is not None:
        return validate_existing(existing)

    attempt = PaymentConfirmationAttempt(
        payment_attempt_id=payment_attempt_id,
        invoice_id=invoice_id,
        branch_id=branch_id,
        cashier_id=cashier_id,
        request_fingerprint=request_fingerprint,
        status=PaymentConfirmationAttemptStatus.PROCESSING,
    )
    db.session.add(attempt)
    try:
        # PROCESSING must be visible before the financial transaction starts so a
        # concurrent delivery of the same request cannot start a second confirm.
        db.session.commit()
        return attempt, True
    except IntegrityError:
        db.session.rollback()

    existing = db.session.get(PaymentConfirmationAttempt, payment_attempt_id)
    if existing is None:
        raise RuntimeError("Payment attempt conflict could not be resolved.")
    return validate_existing(existing)


def mark_attempt_failed(
    payment_attempt_id: str,
    *,
    failure_code: str,
    failure_message: str,
) -> PaymentConfirmationAttempt:
    attempt = (
        PaymentConfirmationAttempt.query
        .filter_by(payment_attempt_id=payment_attempt_id)
        .with_for_update()
        .first()
    )
    if attempt is None:
        raise RuntimeError("Payment attempt was not found while recording failure.")

    # Never overwrite a committed success. This also protects against an
    # exception raised after the financial commit but before the HTTP response.
    if attempt.status == PaymentConfirmationAttemptStatus.PROCESSING:
        attempt.status = PaymentConfirmationAttemptStatus.FAILED
        attempt.failure_code = failure_code[:64]
        attempt.failure_message = failure_message[:255]
        attempt.completed_at = datetime.now(timezone.utc)
        db.session.commit()
    return attempt
