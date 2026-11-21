import type { AdminUser } from '../api/auth';
import type { PromoCode, PromoCodePayload } from '../types';

export const canViewPromos = (role?: string) => ['SUPER_ADMIN', 'EXEC_ADMIN', 'BRANCH_MANAGER'].includes(role || '');
export const canManagePromo = (user: AdminUser | null, promo?: PromoCode) => {
  if (!user || !canViewPromos(user.role) || promo?.archived_at) return false;
  if (user.role !== 'BRANCH_MANAGER') return true;
  return !!user.branch_id && (!promo || (promo.branch_scope === 'SELECTED_BRANCHES' && promo.branch_ids.length === 1 && promo.branch_ids[0] === user.branch_id));
};
export const promoStatus = (promo: PromoCode, now = Date.now()) => {
  if (promo.archived_at) return 'مؤرشف';
  if (!promo.is_active) return 'غير نشط';
  if (promo.expires_at && now >= Date.parse(promo.expires_at)) return 'منتهي';
  if (promo.starts_at && now < Date.parse(promo.starts_at)) return 'لم يبدأ';
  return 'نشط';
};
export const promoUsage = (promo: PromoCode) => typeof promo.usage_count === 'number'
  ? promo.usage_limit === null ? `${promo.usage_count} استخدام — غير محدود` : `${promo.usage_count} / ${promo.usage_limit}`
  : promo.usage_limit === null ? 'العدد غير متاح — غير محدود' : `العدد غير متاح — الحد ${promo.usage_limit}`;
export const cairoDateInput = (value: string | null, expiry = false) => {
  if (!value) return '';
  const date = new Date(Date.parse(value) - (expiry ? 1 : 0));
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
};
export const promoDateLabel = (value: string | null) => value ? new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'غير محدد';

const errors: Record<string, string> = {
  PROMO_DUPLICATE_CODE: 'كود الخصم مستخدم بالفعل',
  PROMO_INVALID_CONFIGURATION: 'بيانات كود الخصم غير صحيحة',
  PROMO_FORBIDDEN: 'ليس لديك صلاحية لتنفيذ هذا الإجراء',
  PROMO_ARCHIVED: 'هذا الكود مؤرشف ولا يمكن تعديله',
  PROMO_NOT_FOUND: 'كود الخصم غير موجود. حدّث القائمة وحاول مرة أخرى',
  PROMO_CODE_IMMUTABLE: 'لا يمكن تغيير كود خصم سبق استخدامه',
};
export function promoErrorMessage(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { error?: string } } })?.response;
  if (response?.status === 403) return errors.PROMO_FORBIDDEN;
  const code = response?.data?.error;
  return typeof code === 'string' && Object.hasOwn(errors, code) ? errors[code] : 'تعذر تنفيذ الطلب. حاول مرة أخرى';
}

export const promoScopeLabel = (scope: PromoCode["discount_scope"]) => ({ SERVICES_ONLY: "الخدمات فقط", PRODUCTS_ONLY: "المنتجات فقط", SERVICES_AND_PRODUCTS: "الخدمات والمنتجات" }[scope ?? "SERVICES_ONLY"]);

export interface PromoForm {
  discount_scope: NonNullable<PromoCode["discount_scope"]>;
  code: string;
  discount_type: PromoCode['discount_type'];
  discount_value: string;
  category_scope: PromoCode['category_scope'];
  category_ids: number[];
  branch_scope: PromoCode['branch_scope'];
  branch_ids: number[];
  is_active: boolean;
  starts_at: string;
  expires_at: string;
  usage_limit: string;
}
export function initialPromoForm(promo: PromoCode | null, user: AdminUser | null): PromoForm {
  return {
    discount_scope: promo?.discount_scope ?? 'SERVICES_ONLY',
    code: promo?.code || '', discount_type: promo?.discount_type || 'PERCENTAGE', discount_value: promo?.discount_value || '',
    category_scope: promo?.category_scope || 'ALL_SERVICE_CATEGORIES', category_ids: promo?.category_ids || [],
    branch_scope: user?.role === 'BRANCH_MANAGER' ? 'SELECTED_BRANCHES' : promo?.branch_scope || 'ALL_BRANCHES',
    branch_ids: user?.role === 'BRANCH_MANAGER' && user.branch_id ? [user.branch_id] : promo?.branch_ids || [],
    is_active: promo?.is_active ?? true, starts_at: cairoDateInput(promo?.starts_at || null),
    expires_at: cairoDateInput(promo?.expires_at || null, true), usage_limit: promo?.usage_limit?.toString() || '',
  };
}
export function buildPromoPayload(form: PromoForm, user: AdminUser | null, original: PromoCode | null): PromoCodePayload {
  if (!canManagePromo(user, original || undefined)) throw new Error(errors.PROMO_FORBIDDEN);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(form.code.trim())) throw new Error('اكتب كودًا من حروف إنجليزية أو أرقام أو - أو _، بحد أقصى 64 حرفًا');
  if (!/^\d+(\.\d{1,2})?$/.test(form.discount_value) || Number(form.discount_value) <= 0 || Number(form.discount_value) > 9999999999.99 || (form.discount_type === 'PERCENTAGE' && Number(form.discount_value) > 100)) throw new Error('أدخل قيمة خصم صحيحة أكبر من صفر، والنسبة لا تتجاوز 100%');
  if (!['SERVICES_ONLY', 'PRODUCTS_ONLY', 'SERVICES_AND_PRODUCTS'].includes(form.discount_scope)) throw new Error('نطاق الخصم غير صحيح');
  if (form.discount_scope !== 'PRODUCTS_ONLY' && form.category_scope === 'SELECTED_SERVICE_CATEGORIES' && !form.category_ids.length) throw new Error('اختر فئة خدمات واحدة على الأقل');
  const branchIds = user?.role === 'BRANCH_MANAGER' ? [user.branch_id!] : form.branch_ids;
  if (form.branch_scope === 'SELECTED_BRANCHES' && !branchIds.length) throw new Error('اختر فرعًا واحدًا على الأقل');
  if (form.usage_limit && (!/^\d+$/.test(form.usage_limit) || Number(form.usage_limit) < 1 || Number(form.usage_limit) > 2147483647)) throw new Error('حد الاستخدام يجب أن يكون عددًا صحيحًا موجبًا');
  const result: PromoCodePayload = {
    discount_scope: form.discount_scope,
    discount_type: form.discount_type, discount_value: form.discount_value,
    category_scope: form.category_scope, category_ids: form.category_scope === 'SELECTED_SERVICE_CATEGORIES' ? form.category_ids : [],
    branch_scope: user?.role === 'BRANCH_MANAGER' ? 'SELECTED_BRANCHES' : form.branch_scope,
    branch_ids: user?.role === 'BRANCH_MANAGER' || form.branch_scope === 'SELECTED_BRANCHES' ? branchIds : [],
    is_active: form.is_active, usage_limit: form.usage_limit ? Number(form.usage_limit) : null,
  };
  if (form.discount_scope === 'PRODUCTS_ONLY') {
    // Hidden service controls never erase saved memberships or send incomplete state.
    result.category_scope = original?.category_scope ?? 'ALL_SERVICE_CATEGORIES';
    result.category_ids = original?.category_ids ?? [];
  }
  if (!original) result.code = form.code.trim();
  // Preserve exact saved instants if the corresponding calendar control was not changed.
  for (const key of ['starts_at', 'expires_at'] as const) {
    if (!original || form[key] !== cairoDateInput(original[key], key === 'expires_at')) result[key] = form[key] || null;
  }
  if (form.starts_at && form.expires_at && form.starts_at > form.expires_at) throw new Error('تاريخ الانتهاء يجب ألا يسبق تاريخ البداية');
  return result;
}
