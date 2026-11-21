import type { PromoPreviewResult } from '../types/promo.ts';

export const PROMO_UI_ERRORS: Record<string, string> = {
    PROMO_NOT_FOUND: 'كود الخصم غير صحيح',
    PROMO_INACTIVE: 'كود الخصم غير مفعل',
    PROMO_ARCHIVED: 'كود الخصم لم يعد متاحًا',
    PROMO_NOT_STARTED: 'كود الخصم لم يبدأ بعد',
    PROMO_EXPIRED: 'انتهت صلاحية كود الخصم',
    PROMO_BRANCH_NOT_ALLOWED: 'كود الخصم غير متاح لهذا الفرع',
    PROMO_USAGE_LIMIT_REACHED: 'تم الوصول للحد الأقصى لاستخدام الكود',
    PROMO_NO_ELIGIBLE_ITEMS: 'لا توجد بنود مؤهلة لهذا الكود',
    PROMO_DISCOUNTS_DISABLED: 'الخصومات غير متاحة في هذا الفرع',
    PROMO_MANUAL_DISCOUNT_CONFLICT: 'لا يمكن الجمع بين كود الخصم والخصم اليدوي',
    PROMO_QUOTE_STALE: 'تم تحديث الفاتورة، يرجى إعادة تطبيق كود الخصم',
    PROMO_ALREADY_REDEEMED: 'تم استخدام كود خصم على هذه الفاتورة بالفعل',
    PROMO_INVALID_INVOICE_STATE: 'يمكن تطبيق كود الخصم على فاتورة مسودة فقط',
    PROMO_INVALID_CONFIGURATION: 'بيانات كود الخصم غير صالحة',
    PROMO_INTERNAL_ERROR: 'تعذر تنفيذ طلب كود الخصم، حاول مرة أخرى',
};

export const getPromoErrorMessage = (err: any): string => {
    if (!err) return 'تعذر تطبيق كود الخصم، حاول مرة أخرى';
    const code = err.code || err.error;
    if (typeof code === 'string' && PROMO_UI_ERRORS[code]) {
        return PROMO_UI_ERRORS[code];
    }
    if (typeof err.message === 'string' && err.message.trim()) {
        // If message is a known code
        if (PROMO_UI_ERRORS[err.message]) {
            return PROMO_UI_ERRORS[err.message];
        }
        return err.message;
    }
    return 'تعذر تطبيق كود الخصم، حاول مرة أخرى';
};

export const formatPromoBadgeLabel = (promo: PromoPreviewResult): string => {
    if (promo.discount_type === 'PERCENTAGE') {
        return `خصم ${promo.configured_value}%`;
    }
    return `خصم ${promo.configured_value} ج.م`;
};
