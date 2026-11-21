import React, { useEffect, useRef, useState } from 'react';
import { Plus, Search, Tags } from 'lucide-react';
import type { AdminUser } from '../api/auth';
import { promoApi } from '../api/promoCodes';
import type { PromoCode, PromoListResponse } from '../types';
import { canManagePromo, canViewPromos, promoDateLabel, promoErrorMessage, promoStatus, promoUsage, promoScopeLabel } from '../utils/promoCodes';
import PromoCodeModal from './PromoCodeModal';

export default function PromoCodesPage({ isDarkMode, selectedBranch, user }: { isDarkMode: boolean; selectedBranch: string; user: AdminUser | null }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<PromoListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [pending, setPending] = useState<number | null>(null);
  const busy = useRef(false);
  const [modal, setModal] = useState<{ promo: PromoCode | null } | null>(null);
  const [now, setNow] = useState(Date.now);
  const allowed = canViewPromos(user?.role);
  const branch = user?.role === 'BRANCH_MANAGER' ? String(user.branch_id || '') : selectedBranch;
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 350); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setPage(1); }, [branch]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    promoApi.list({ page, per_page: 12, search: query || undefined, is_active: active || undefined, branch_id: branch && branch.toLowerCase() !== 'all' ? branch : undefined }, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        if (page > Math.max(1, result.pages)) { setPage(Math.max(1, result.pages)); return; }
        setData(result);
      }).catch(err => { if (!controller.signal.aborted) setError(promoErrorMessage(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [allowed, page, query, active, branch, refresh]);
  const mutate = async (promo: PromoCode, archive: boolean) => {
    if (busy.current || !canManagePromo(user, promo)) return;
    if (archive && !window.confirm('سيتم إيقاف كود الخصم والاحتفاظ بسجل استخدامه السابق.')) return;
    busy.current = true; setPending(promo.id); setError('');
    try {
      if (archive) await promoApi.archive(promo.id); else await promoApi.update(promo.id, { is_active: !promo.is_active });
      setData(null); setLoading(true);
      setToast(archive ? 'تمت أرشفة كود الخصم' : 'تم تحديث حالة كود الخصم'); setRefresh(value => value + 1);
    } catch (err) { setError(promoErrorMessage(err)); }
    finally { busy.current = false; setPending(null); }
  };
  if (!allowed) return <p role="alert" dir="rtl">ليس لديك صلاحية لعرض أكواد الخصم</p>;
  const card = isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-white border-gray-200';
  const control = `rounded-xl border p-3 ${card}`;
  return <section dir="rtl" className={`admin-page-shell space-y-6 min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
    <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h1 className="text-2xl font-bold flex items-center gap-2"><Tags className="text-[#E53935]" />أكواد الخصم</h1><p className="text-sm opacity-60 mt-2">إدارة أكواد الخصم ونطاق صلاحيتها واستخدامها.</p></div>{canManagePromo(user) && <button disabled={pending !== null} onClick={() => setModal({ promo: null })} className="inline-flex items-center justify-center gap-2 bg-[#E53935] text-white rounded-xl px-5 py-3 disabled:opacity-50"><Plus size={18} />إنشاء كود خصم</button>}</header>
    {toast && <p role="status" className="rounded-xl bg-green-500/10 text-green-600 p-3">{toast}</p>}
    <div className="flex flex-col sm:flex-row gap-3"><label className={`flex items-center gap-2 flex-1 min-w-0 ${control}`}><Search size={18} className="opacity-50 shrink-0" /><input aria-label="البحث بكود الخصم" placeholder="ابحث بكود الخصم…" className="bg-transparent outline-none w-full min-w-0" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="تصفية حسب التفعيل" value={active} onChange={event => { setActive(event.target.value); setPage(1); }} className={control}><option value="">كل حالات التفعيل</option><option value="true">مفعّل</option><option value="false">غير مفعّل</option></select></div>
    {loading && <p role="status" className="opacity-60">{data ? 'جارٍ تحديث أكواد الخصم…' : 'جارٍ تحميل أكواد الخصم…'}</p>}
    {error && <div role="alert" className="p-4 rounded-xl bg-red-500/10 text-red-500">{error}<button onClick={() => setRefresh(value => value + 1)} className="underline mx-3 p-2">إعادة المحاولة</button></div>}
    {!error && data && <div aria-busy={loading}>
      {data.items.length === 0 ? <div className={`rounded-2xl border p-10 text-center ${card}`}><Tags className="mx-auto opacity-40 mb-3" /><p>{query || active || (branch && branch.toLowerCase() !== 'all') ? 'لا توجد أكواد خصم تطابق البحث أو التصفية' : 'لا توجد أكواد خصم حتى الآن'}</p></div> : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">{data.items.map(promo => <article key={promo.id} className={`rounded-2xl border p-4 min-w-0 space-y-3 ${card}`}>
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-start justify-between gap-2 min-w-0">
            <h2 dir="ltr" className="font-bold text-lg leading-snug text-right min-w-0 flex-1 [overflow-wrap:anywhere]">{promo.code}</h2>
            <span className={`text-xs leading-5 rounded-full px-2.5 py-0.5 shrink-0 ${promoStatus(promo, now) === 'نشط' ? 'bg-green-500/10 text-green-600' : 'bg-gray-500/10 opacity-70'}`}>{promoStatus(promo, now)}</span>
          </div>
          <p className="text-sm">نطاق الخصم: {promoScopeLabel(promo.discount_scope)}</p>
          <p className="text-[#E53935] font-bold text-2xl leading-tight min-w-0 [overflow-wrap:anywhere]">{Number(promo.discount_value).toLocaleString('ar-EG', { maximumFractionDigits: 2 })}{promo.discount_type === 'PERCENTAGE' ? '%' : ' ج.م'}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm leading-5 min-w-0 [overflow-wrap:anywhere]">
          <div className="min-w-0">
            <dt className="text-xs opacity-50">فئات الخدمات</dt>
            <dd>{promo.discount_scope === 'PRODUCTS_ONLY' ? 'لا تنطبق على المنتجات' : promo.category_scope === 'ALL_SERVICE_CATEGORIES' ? 'جميع فئات الخدمات' : `فئات محددة (${promo.category_ids.length})`}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs opacity-50">الفروع</dt>
            <dd>{promo.branch_scope === 'ALL_BRANCHES' ? 'جميع الفروع' : `فروع محددة (${promo.branch_ids.length})`}</dd>
          </div>
          <div className="col-span-2 min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <dt className="text-xs opacity-50">الاستخدام</dt>
            <dd className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {typeof promo.usage_count === 'number' ? <bdi>{promoUsage(promo)}</bdi> : <>
                <span>{promo.usage_limit === null ? 'غير محدود' : `الحد: ${promo.usage_limit}`}</span>
                <span className="text-xs opacity-60">الاستخدام الحالي: غير متاح</span>
              </>}
            </dd>
          </div>
          <div className="col-span-2 min-w-0">
            <dt className="text-xs opacity-50">الصلاحية</dt>
            <dd className="min-w-0 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs leading-5">
              {!promo.starts_at && !promo.expires_at ? 'غير محدد' : <>
                <span className="min-w-0"><span className="sr-only">البداية: </span>{promoDateLabel(promo.starts_at)}</span>
                <span aria-hidden="true" className="opacity-40">←</span>
                <span className="min-w-0"><span className="sr-only">ينتهي عند: </span>{promoDateLabel(promo.expires_at)}</span>
              </>}
            </dd>
          </div>
        </dl>
        {canManagePromo(user, promo) ? <div className="flex flex-wrap items-center gap-1 border-t border-gray-500/10 pt-2 text-xs">
          <button disabled={loading || pending !== null} onClick={() => setModal({ promo })} className="rounded-lg px-3 py-2 hover:bg-gray-500/10 disabled:opacity-40">تعديل</button>
          <button disabled={loading || pending !== null} onClick={() => mutate(promo, false)} className="rounded-lg px-3 py-2 hover:bg-gray-500/10 disabled:opacity-40">{promo.is_active ? 'إيقاف' : 'تفعيل'}</button>
          <button disabled={loading || pending !== null} onClick={() => mutate(promo, true)} className="rounded-lg text-red-500 px-3 py-2 hover:bg-red-500/10 disabled:opacity-40">أرشفة</button>
          {pending === promo.id && <span role="status" className="w-full opacity-60">جارٍ حفظ التغيير…</span>}
        </div> : <p className="text-xs leading-5 opacity-50 border-t border-gray-500/10 pt-2">{promo.archived_at ? 'مؤرشف — محفوظ في السجل' : 'للعرض فقط ضمن صلاحيات فرعك'}</p>}
      </article>)}</div>}
      <nav aria-label="صفحات أكواد الخصم" className="flex flex-wrap items-center justify-between gap-3 pt-5 text-sm"><span>{data.total} كود — صفحة {data.current_page} من {Math.max(1, data.pages)}</span><div className="flex gap-2"><button disabled={loading || page <= 1} className={`${control} disabled:opacity-40`} onClick={() => setPage(value => value - 1)}>السابق</button><button disabled={loading || page >= data.pages} className={`${control} disabled:opacity-40`} onClick={() => setPage(value => value + 1)}>التالي</button></div></nav>
    </div>}
    {modal && <PromoCodeModal promo={modal.promo} user={user} isDarkMode={isDarkMode} onClose={() => setModal(null)} onSaved={() => { setModal(null); setToast('تم حفظ كود الخصم'); setData(null); setRefresh(value => value + 1); }} />}
  </section>;
}
