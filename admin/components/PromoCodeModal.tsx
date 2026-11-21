import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { AdminUser } from '../api/auth';
import { promoApi } from '../api/promoCodes';
import type { PromoCode, PromoCodePayload, PromoOption } from '../types';
import { buildPromoPayload, initialPromoForm, promoErrorMessage } from '../utils/promoCodes';

interface Props { promo: PromoCode | null; user: AdminUser | null; isDarkMode: boolean; onClose: () => void; onSaved: () => void }
export default function PromoCodeModal({ promo, user, isDarkMode, onClose, onSaved }: Props) {
  const [form, setForm] = useState(() => initialPromoForm(promo, user));
  const [options, setOptions] = useState<{ categories: PromoOption[]; branches: PromoOption[] }>({ categories: [], branches: [] });
  const [loading, setLoading] = useState(true);
  const [optionError, setOptionError] = useState('');
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setOptionError('');
    promoApi.options(controller.signal).then(result => { if (!controller.signal.aborted) setOptions(result); }).catch(err => {
      if (!controller.signal.aborted) setOptionError(promoErrorMessage(err));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus();
  }, []);
  const field = `w-full min-w-0 rounded-xl border p-3 ${isDarkMode ? 'bg-[#202020] border-white/10' : 'bg-white border-gray-200'}`;
  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) => setForm(current => ({ ...current, [key]: value }));
  const toggle = (key: 'category_ids' | 'branch_ids', id: number) => setForm(current => ({ ...current, [key]: current[key].includes(id) ? current[key].filter(value => value !== id) : [...current[key], id] }));
  const withSaved = (items: PromoOption[], ids: number[], label: string) => [...items, ...ids.filter(id => !items.some(item => item.id === id)).map(id => ({ id, name: `${label} #${id}` }))];
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current || loading || optionError) return;
    let payload: PromoCodePayload;
    try { payload = buildPromoPayload(form, user, promo); } catch (err) { setError((err as Error).message); return; }
    busy.current = true; setSaving(true); setError('');
    try { if (promo) await promoApi.update(promo.id, payload); else await promoApi.create(payload); onSaved(); }
    catch (err) { setError(promoErrorMessage(err)); }
    finally { busy.current = false; setSaving(false); }
  };
  return <div className="admin-overlay-shell z-[110] bg-black/60 backdrop-blur-sm" dir="rtl">
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="promo-dialog-title" className={`admin-overlay-panel max-w-2xl rounded-2xl border shadow-2xl ${isDarkMode ? 'bg-[#161616] text-white border-white/10' : 'bg-white text-gray-900 border-gray-200'}`} onKeyDown={event => {
      if (event.key === 'Escape' && !busy.current) onClose();
      if (event.key === 'Tab') {
        const elements = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]');
        const focusable = Array.from<HTMLElement>(elements || []).filter(element => !element.closest('fieldset:disabled'));
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <header className="flex items-center justify-between p-5 border-b border-gray-500/20"><h2 id="promo-dialog-title" className="font-bold text-lg">{promo ? 'تعديل كود الخصم' : 'إنشاء كود خصم'}</h2><button aria-label="إغلاق" disabled={saving} onClick={onClose} className="p-2"><X size={20} /></button></header>
      <form onSubmit={submit} className="flex flex-col min-h-0">
        <div className="admin-overlay-body p-5 space-y-4">
          {loading && <p role="status">جارٍ تحميل الفئات والفروع…</p>}
          {optionError && <div role="alert" className="text-red-500">{optionError} <button type="button" className="underline p-2" onClick={() => setRetry(value => value + 1)}>إعادة المحاولة</button></div>}
          {error && <p role="alert" className="text-red-500">{error}</p>}
          <fieldset disabled={saving} className="space-y-4 min-w-0">
            <label className="block space-y-2"><span>كود الخصم</span><input className={field} dir="ltr" value={form.code} onChange={event => update('code', event.target.value)} readOnly={!!promo} required maxLength={64} placeholder="VIP20" />{promo && <small className="block opacity-60">الكود للقراءة فقط. يمكنك تعديل شروط الخصم أدناه.</small>}</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-2"><span>نوع الخصم</span><select className={field} value={form.discount_type} onChange={event => update('discount_type', event.target.value as typeof form.discount_type)}><option value="PERCENTAGE">نسبة مئوية %</option><option value="FIXED">مبلغ ثابت ج.م</option></select></label>
              <label className="space-y-2"><span>قيمة الخصم ({form.discount_type === 'PERCENTAGE' ? '%' : 'ج.م'})</span><input className={field} type="number" min="0.01" max={form.discount_type === 'PERCENTAGE' ? '100' : '9999999999.99'} step="0.01" required value={form.discount_value} onChange={event => update('discount_value', event.target.value)} /></label>
            </div>
            <label className="block space-y-2"><span>نطاق الخصم</span><select className={field} value={form.discount_scope} onChange={event => update('discount_scope', event.target.value as typeof form.discount_scope)}><option value="SERVICES_ONLY">الخدمات فقط</option><option value="PRODUCTS_ONLY">المنتجات فقط</option><option value="SERVICES_AND_PRODUCTS">الخدمات والمنتجات</option></select></label>
            {form.discount_scope !== 'PRODUCTS_ONLY' && <>
            <label className="block space-y-2"><span>فئات الخدمات</span><select className={field} value={form.category_scope} onChange={event => update('category_scope', event.target.value as typeof form.category_scope)}><option value="ALL_SERVICE_CATEGORIES">جميع فئات الخدمات</option><option value="SELECTED_SERVICE_CATEGORIES">فئات محددة</option></select></label>
            {form.category_scope === 'SELECTED_SERVICE_CATEGORIES' && <fieldset className="max-h-40 overflow-y-auto border border-gray-500/20 rounded-xl p-3 space-y-2"><legend>اختر فئة واحدة على الأقل</legend>{withSaved(options.categories, form.category_ids, 'فئة').map(item => <label key={item.id} className="flex gap-2 items-start break-words"><input type="checkbox" checked={form.category_ids.includes(item.id)} onChange={() => toggle('category_ids', item.id)} className="mt-1 accent-[#E53935]" />{item.name}</label>)}{!loading && !options.categories.length && !form.category_ids.length && <p>لا توجد فئات خدمات متاحة</p>}</fieldset>}
            </>}
            {user?.role === 'BRANCH_MANAGER' ? <p className="p-3 rounded-xl border border-gray-500/20">الفرع: {options.branches.find(branch => branch.id === user.branch_id)?.name || `فرع #${user.branch_id ?? 'غير محدد'}`} — نطاق ثابت لفرعك</p> : <><label className="block space-y-2"><span>نطاق الفروع</span><select className={field} value={form.branch_scope} onChange={event => update('branch_scope', event.target.value as typeof form.branch_scope)}><option value="ALL_BRANCHES">جميع الفروع</option><option value="SELECTED_BRANCHES">فروع محددة</option></select></label>{form.branch_scope === 'SELECTED_BRANCHES' && <fieldset className="max-h-40 overflow-y-auto border border-gray-500/20 rounded-xl p-3 space-y-2"><legend>اختر فرعًا واحدًا على الأقل</legend>{withSaved(options.branches, form.branch_ids, 'فرع').map(item => <label key={item.id} className="flex gap-2 items-start break-words"><input type="checkbox" checked={form.branch_ids.includes(item.id)} onChange={() => toggle('branch_ids', item.id)} className="mt-1 accent-[#E53935]" />{item.name}</label>)}</fieldset>}</>}
            <label className="flex gap-2 items-center"><input type="checkbox" checked={form.is_active} onChange={event => update('is_active', event.target.checked)} className="accent-[#E53935]" />كود نشط</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{(['starts_at', 'expires_at'] as const).map(key => <label key={key} className="min-w-0 space-y-2"><span>{key === 'starts_at' ? 'تاريخ البداية (اختياري)' : 'تاريخ الانتهاء (اختياري)'}</span><input type="date" className={field} value={form[key]} onChange={event => update(key, event.target.value)} /></label>)}</div>
            <p className="text-sm opacity-60">يشمل تاريخ الانتهاء اليوم المحدد بالكامل.</p>
            <label className="flex gap-2 items-center"><input type="checkbox" checked={form.usage_limit === ''} onChange={event => update('usage_limit', event.target.checked ? '' : '1')} className="accent-[#E53935]" />استخدام غير محدود</label>
            {form.usage_limit !== '' && <label className="block space-y-2"><span>حد الاستخدام</span><input className={field} type="number" min="1" max="2147483647" step="1" required value={form.usage_limit} onChange={event => update('usage_limit', event.target.value || '0')} /></label>}
          </fieldset>
        </div>
        <footer className="flex gap-3 p-5 border-t border-gray-500/20 shrink-0"><button type="submit" disabled={saving || loading || !!optionError} className="bg-[#E53935] text-white rounded-xl px-5 py-3 disabled:opacity-50">{saving ? 'جارٍ الحفظ…' : 'حفظ كود الخصم'}</button><button type="button" disabled={saving} onClick={onClose} className="rounded-xl border border-gray-500/20 px-5 py-3">إلغاء</button></footer>
      </form>
    </div>
  </div>;
}
