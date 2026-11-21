"""
NotificationService — payload builder only.
Socket.IO has been removed. This module no longer emits any events.
Real-time delivery is replaced by polling at GET /api/admin/notifications/recent.
"""
from flask import current_app
from datetime import datetime


class NotificationService:
    @staticmethod
    def broadcast_invoice(invoice):
        """
        Previously emitted a Socket.IO event.
        Now a no-op — polling endpoint delivers the same data on demand.
        Kept for call-site compatibility; callers do not need to change.
        """
        try:
            # Determine payment method display name (logic preserved for future use)
            payment_method_arabic = "غير معروف"
            if hasattr(invoice, 'invoice_payments') and len(invoice.invoice_payments) > 1:
                payment_method_arabic = "متعدد"
            elif hasattr(invoice, 'invoice_payments') and len(invoice.invoice_payments) == 1:
                method = invoice.invoice_payments[0].method.value if hasattr(invoice.invoice_payments[0].method, 'value') else str(invoice.invoice_payments[0].method)
                mapping = {"CASH": "كاش", "VISA": "فيزا", "INSTAPAY": "انستا"}
                payment_method_arabic = mapping.get(method, "غير معروف")
            elif invoice.payment_method:
                method = invoice.payment_method.value if hasattr(invoice.payment_method, 'value') else str(invoice.payment_method)
                mapping = {"CASH": "كاش", "VISA": "فيزا", "INSTAPAY": "انستا"}
                payment_method_arabic = mapping.get(method, "غير معروف")

            # Payload construction preserved (unused now, useful for future logging/audit)
            payload = {
                "type": "invoice_created",
                "priority": "important",
                "data": {
                    "id": invoice.id,
                    "invoiceNumber": invoice.invoice_number,
                    "branchName": invoice.branch.name if invoice.branch else "Unknown",
                    "total": float(invoice.total_amount),
                    "paymentMethod": payment_method_arabic,
                    "hasDiscount": float(invoice.discount_amount) > 0,
                    "discountAmount": float(invoice.discount_amount),
                    "clientName": invoice.customer_name or "عميل عام",
                    "createdAt": datetime.utcnow().isoformat() + "Z"
                }
            }

            # Socket emit REMOVED — no-op for now.
            # Polling endpoint: GET /api/admin/notifications/recent?since_id=<id>
            _ = payload  # Suppress unused variable warning

        except Exception as e:
            current_app.logger.warning(
                f"NOTIFICATION_BUILD_FAILED: invoice_id={getattr(invoice, 'id', 'unknown')}, error={e}"
            )
            # Flow continues — invoice is never blocked by notification logic
