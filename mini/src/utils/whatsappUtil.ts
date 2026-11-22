/**
 * WhatsApp Invoice Sharing Utility
 * 
 * Handles:
 * - Egyptian mobile phone normalization
 * - Invoice message building
 * - WhatsApp Web URL generation
 * 
 * NO WhatsApp API credentials, auto-send, or Meta integration.
 * Simple frontend-only URL builder for manual cashier send.
 */

/**
 * Normalize Egyptian mobile phone to WhatsApp international format
 * 
 * Accepts common representations:
 * - 01065766357
 * - +201065766357
 * - 00201065766357
 * - 201065766357
 * - 010 6576 6357
 * - 010-6576-6357
 * - (010) 65766357
 * 
 * Returns: 201065766357 (digits only, country code, no +)
 * Returns: null if invalid
 */
export function normalizeEgyptianPhone(phone: string | null | undefined): string | null {
  if (!phone || typeof phone !== 'string') return null;

  // Remove all whitespace, dashes, parentheses
  let normalized = phone
    .trim()
    .replace(/[\s\-()]/g, '');

  // Remove leading +
  if (normalized.startsWith('+')) {
    normalized = normalized.substring(1);
  }

  // Remove leading 00 (international prefix alternative)
  if (normalized.startsWith('00')) {
    normalized = normalized.substring(2);
  }

  // Handle local Egyptian format: 01xxxxxxxx → 201xxxxxxxx
  if (normalized.startsWith('0')) {
    normalized = '2' + normalized;
  }

  // Validate structure:
  // Must be exactly 12 digits: 20 + 10 + 8 more
  // Must start with 20 (Egypt)
  // Must have mobile prefix: 10, 11, 12, or 15
  if (!/^20(10|11|12|15)\d{8}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

// Shared presentation fallback; persisted invoice subtotal always takes priority.
// Keep the existing WhatsApp item-price fallback in one place for all receipt views.
export function resolveInvoiceGrossSubtotal(data: {
  subtotal?: number;
  groups?: Array<{ services: Array<{ price: number }> }>;
}): number {
  return typeof data.subtotal === 'number' ? data.subtotal : (
    data.groups ? data.groups.reduce((acc, g) => acc + (g.services?.reduce((sAcc, s) => sAcc + (s.price || 0), 0) || 0), 0) : 0
  );
}

/**
 * Build invoice message for WhatsApp
 * 
 * Uses actual invoice data from Receipt props.
 * Never hard-codes test data.
 * Only renders fields that exist and have real values.
 */
export function buildInvoiceWhatsAppMessage(data: {
  invoiceId?: string | number;
  payerName?: string;
  branchName?: string;
  groups?: Array<{ services: Array<{ name: string; price: number }> }>;
  subtotal?: number;
  total?: number;
  discountAmount?: number;
  depositApplied?: number;
  promo?: { code: string; discount_amount?: number; [key: string]: any } | null;
  payments?: Array<{ method: string; amount: number; entered_amount?: number }>;
}): string {
  const lines: string[] = [];

  // Greeting with customer name if available and meaningful
  const customerName = data.payerName?.trim();
  if (customerName && customerName !== 'ضيف' && customerName !== 'Guest') {
    lines.push(`أهلاً ${customerName} 👋`);
  } else {
    lines.push('أهلاً 👋');
  }

  // Thank you with salon and branch
  lines.push('شكرًا لزيارتك صالون نادي الرجال السري فرع oct 🤍');

  lines.push(''); // blank line

  if (data.depositApplied) {
    lines.push(`عربون مدفوع سابقًا: ${data.depositApplied} ج`);
    lines.push(`التحصيل الجديد: ${Math.max(0, Number(data.total || 0) - data.depositApplied)} ج`);
    lines.push('المتبقي غير المدفوع: 0 ج');
  }
  // Invoice number (bold)
  if (data.invoiceId) {
    lines.push(`*فاتورة #${data.invoiceId}*`);
    lines.push('──────────────');
  }

  // Services/Items
  if (data.groups && data.groups.length > 0) {
    for (const group of data.groups) {
      if (group.services && group.services.length > 0) {
        for (const service of group.services) {
          if (service.name && typeof service.price === 'number') {
            lines.push(`${service.name} — ${service.price} ج`);
          }
        }
      }
    }
  }

  // Divider
  lines.push('──────────────');

  // Resolve authoritative discount and net
  const grossSubtotal = resolveInvoiceGrossSubtotal(data);
  const appliedDiscount = data.promo?.discount_amount ?? (typeof data.discountAmount === 'number' ? data.discountAmount : 0);
  const authoritativeNet = typeof data.total === 'number' && (appliedDiscount === 0 || data.total <= grossSubtotal - appliedDiscount)
    ? data.total
    : Math.max(0, grossSubtotal - appliedDiscount);

  // Subtotal if promo is applied
  if (data.promo && grossSubtotal > 0) {
    lines.push(`الإجمالي قبل الخصم: ${grossSubtotal} ج`);
  }

  // Discount / Promo (only if > 0 or promo is present)
  if (data.promo && data.promo.code) {
    lines.push(`كود الخصم: ${data.promo.code}`);
    lines.push(`خصم الكود: -${appliedDiscount} ج`);
  } else if (appliedDiscount > 0) {
    lines.push(`الخصم — ${appliedDiscount} ج`);
  }

  // Total (bold)
  lines.push(`*الإجمالي — ${authoritativeNet} ج*`);

  lines.push(''); // blank line

  // Payment details (simplified - no "طريقة الدفع:" header)
  if (data.payments && data.payments.length > 0) {
    const validPayments = data.payments.filter(
      p => p && p.amount && p.amount > 0 && p.method
    );

    if (validPayments.length > 0) {
      for (const payment of validPayments) {
        const method = normalizePaymentMethod(payment.method);
        const amount = payment.entered_amount ?? payment.amount;
        if (method && amount > 0) {
          lines.push(`${method} — ${amount} ج`);
        }
      }
    }
  }

  lines.push(''); // blank line

  // Rating section
  lines.push('⭐ *ما مدى رضاك عن الخدمة؟*');
  lines.push('رد علينا برقم من 1 إلى 5');
  lines.push('');
  lines.push('1️⃣  2️⃣  3️⃣  4️⃣  5️⃣');

  lines.push(''); // blank line

  // Footer
  lines.push('نتشرف بزيارتك دائمًا 🤍');

  return lines.join('\n');
}

/**
 * Normalize payment method to Arabic display name
 */
function normalizePaymentMethod(method: string): string | null {
  if (!method) return null;
  const upper = method.toUpperCase().trim();
  if (upper === 'CASH') return 'نقدي';
  if (upper === 'VISA_1') return 'فيزا 1';
  if (upper === 'VISA_2') return 'فيزا 2';
  if (upper === 'VISA') return 'Visa';
  if (upper === 'INSTAPAY') return 'InstaPay';
  // Return the method as-is if not a known type
  return method;
}

/**
 * Build WhatsApp Web URL and open it
 * 
 * Uses standard WhatsApp Web click-to-chat:
 * https://web.whatsapp.com/send?phone={PHONE}&text={ENCODED_MESSAGE}
 * 
 * Opens via window.open with noopener,noreferrer for safety
 */
export function openInvoiceInWhatsApp(phone: string, message: string): void {
  const encodedMessage = encodeURIComponent(message);
  const url = `https://web.whatsapp.com/send?phone=${phone}&text=${encodedMessage}`;

  // Open with security params to prevent window reference
  window.open(url, '_blank', 'noopener,noreferrer');
}
