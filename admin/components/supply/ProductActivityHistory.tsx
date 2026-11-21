import React, { useId, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useProductInventoryHistory } from '../../hooks/useProductInventoryHistory';
import { ProductActivityHistoryResponse, movementLabels, historyDate } from './productHistoryTypes';
import ProductHistoryPagination from './ProductHistoryPagination';
import { workspaceStyles } from './productWorkspaceStyles';
import ProductMovementBadge from './ProductMovementBadge';
import ProductMovementLegend from './ProductMovementLegend';

interface Props {
  productId: number; activeBranchId: number | null; onSelectBranch: (id: number | null) => void;
  unit: string; isDarkMode: boolean; enabled: boolean;
}
export default function ProductActivityHistory({ productId, activeBranchId, onSelectBranch, unit, isDarkMode, enabled }: Props) {
  const id = useId(); const tone = workspaceStyles(isDarkMode);
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', type: 'all' });
  // Local opt-in, reset when navigating to a different product. Never persisted.
  const [conditional, setConditional] = useState({ productId, enabled: false });
  if (conditional.productId !== productId) setConditional({ productId, enabled: false });
  const showConditional = conditional.productId === productId && conditional.enabled;
  const scope = JSON.stringify([productId, activeBranchId, filters]);
  const [paging, setPaging] = useState<{ scope: string; page: number; asOfId?: number }>({ scope, page: 1 });
  const page = paging.scope === scope ? paging.page : 1;
  const query = new URLSearchParams({ branch_id: activeBranchId === null ? 'all' : String(activeBranchId), movement_type: filters.type, page: String(page), per_page: '20' });
  if (showConditional) query.set('include_conditional', 'true');
  if (filters.dateFrom) query.set('date_from', filters.dateFrom);
  if (filters.dateTo) query.set('date_to', filters.dateTo);
  if (paging.scope === scope && paging.asOfId !== undefined) query.set('as_of_id', String(paging.asOfId));
  const { data, locations, error, loading, retry } = useProductInventoryHistory<ProductActivityHistoryResponse>(productId, 'activity', query.toString(), enabled);
  const invalidDates = Boolean(filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo);
  const goToPage = (next: number) => setPaging({ scope, page: next, asOfId: data?.as_of_id });
  return <section aria-label="سجل حركة المنتج" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-sm font-black">حركة المنتج</h2><p className={`mt-1 text-xs ${tone.muted}`}>التواريخ بتوقيت القاهرة. كل رصيد موضح بمصدره ودرجة التحقق منه.</p></div>
      <button type="button" className={tone.button} onClick={() => { setPaging({ scope, page: 1 }); retry(); }}><RefreshCw size={14} aria-hidden="true" /> تحديث الحركة</button>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label htmlFor={`${id}-from`} className={`space-y-1 text-xs ${tone.muted}`}><span className="block">من تاريخ</span><input id={`${id}-from`} type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} className={tone.field} /></label>
      <label htmlFor={`${id}-to`} className={`space-y-1 text-xs ${tone.muted}`}><span className="block">إلى تاريخ</span><input id={`${id}-to`} type="date" value={filters.dateTo} aria-invalid={invalidDates || undefined} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} className={tone.field} /></label>
      <label htmlFor={`${id}-branch`} className={`space-y-1 text-xs ${tone.muted}`}><span className="block">الموقع</span><select id={`${id}-branch`} value={activeBranchId ?? 'all'} onChange={(event) => onSelectBranch(event.target.value === 'all' ? null : Number(event.target.value))} className={tone.field}><option value="all">كل المواقع المسموحة</option>{locations.map((location) => <option key={location.branch_id} value={location.branch_id}>{location.branch_name}{location.is_main_warehouse ? ' — المخزن الرئيسي' : ''}</option>)}</select></label>
      <label htmlFor={`${id}-type`} className={`space-y-1 text-xs ${tone.muted}`}><span className="block">نوع الحركة</span><select id={`${id}-type`} value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })} className={tone.field}><option value="all">كل الأنواع</option>{Object.entries(movementLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <p className={`text-xs ${tone.muted}`}>مرتجعات المخزن الرئيسي مسجلة ضمن التحويلات الواردة والصادرة.</p>
    <label className={`flex items-center gap-2 text-xs ${tone.muted}`}>
      <input type="checkbox" checked={showConditional} aria-describedby={`${id}-conditional-help`} onChange={(event) => setConditional({ productId, enabled: event.target.checked })} />
      عرض الأرصدة التاريخية المحسوبة
    </label>
    <p id={`${id}-conditional-help`} className={`text-[11px] ${tone.muted}`}>{showConditional ? 'الأرصدة المحسوبة غير مؤكدة؛ بتعتمد على اكتمال الحركات وافتراض اتجاه العملية وترتيب التنفيذ.' : 'الحسابات التاريخية المشروطة مخفية افتراضيًا؛ الحركات نفسها بتفضل ظاهرة.'}</p>
    {invalidDates && <p role="alert" className={isDarkMode ? 'text-red-300' : 'text-red-700'}>تاريخ البداية لازم يكون قبل تاريخ النهاية أو نفس اليوم.</p>}
    {loading && <p role="status" className={`py-4 text-sm ${tone.muted}`}>جاري تحميل الحركة…</p>}
    {error && <div role="alert" className="space-y-2"><p>{error}</p><button type="button" className={tone.button} onClick={retry}>إعادة المحاولة</button></div>}
    <ProductMovementLegend isDarkMode={isDarkMode} />
    {data && <>
      {data.items.length === 0 ? <p className={`rounded-xl border border-dashed p-5 text-center text-sm ${tone.divider} ${tone.muted}`}>لا توجد حركات مطابقة للفلاتر.</p> : <ol className={`divide-y ${isDarkMode ? 'divide-white/10' : 'divide-gray-200'}`}>
        {data.items.map((movement) => {
          const recorded = movement.snapshot_status === 'RECORDED';
          // Preserve operation snapshots even if an older/inconsistent backend
          // accidentally supplies a conflicting historical representation.
          const balance = recorded ? { status: 'RECORDED', before: movement.balance_before, delta: movement.quantity_delta, after: movement.balance_after, unavailable_reason: null } : movement.balance;
          const status = balance?.status || 'UNAVAILABLE';
          const calculated = status === 'CONDITIONAL_RECONSTRUCTION';
          const visible = status === 'RECORDED' || status === 'VERIFIED_HISTORICAL' || (calculated && showConditional);
          const delta = calculated && !showConditional ? null : balance?.delta ?? null;
          const reasons: Record<string, string> = {
            UNKNOWN_ADJUSTMENT_SIGN: 'إشارة التعديل الأصلي غير معروفة.', UNKNOWN_STARTING_BALANCE: 'رصيد بداية المقطع غير مثبت.',
            SOURCE_MOVEMENT_CHANGED: 'الحركة مختلفة عن مصدر الحساب التاريخي.', SOURCE_EVIDENCE_CHANGED: 'أدلة الحساب التاريخي اتغيرت أو لم تعد مطابقة.',
            AMBIGUOUS_ORDER: 'ترتيب العمليات غير محسوم.', NO_HISTORICAL_RESULT: 'مفيش رصيد تاريخي متحقق متاح للحركة دي.',
            UNKNOWN_DIRECTION: 'اتجاه الحركة التاريخي غير مثبت.', DIRECTION_UNCONFIRMED: 'اتجاه الحركة التاريخي غير مثبت بشكل مستقل.',
            UNVERIFIED_SOURCE_REFERENCE: 'مرجع العملية التاريخي غير متحقق.', CONFLICTING_HISTORY: 'أدلة التاريخ فيها تعارض.', INCOMPLETE_HISTORY: 'تسلسل العمليات غير مكتمل.',
          };
          return <li key={movement.id} className="space-y-2 py-3 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2"><ProductMovementBadge type={movement.movement_type} isDarkMode={isDarkMode} /><span className="break-words text-sm font-bold">{movement.reference_label}</span></div>
              <time dateTime={movement.created_at} className={`text-xs ${tone.muted}`}>{historyDate(movement.created_at, true)}</time>
            </div>
            <p className={`text-xs ${tone.muted}`}>{movement.branch_name} · الكمية المسجلة: <bdi>{movement.quantity}</bdi> {unit}</p>
            <dl className={`grid grid-cols-3 gap-2 rounded-xl p-3 text-xs ${tone.subtle}`}>
              <div><dt className={tone.muted}>الرصيد قبل</dt><dd className="mt-1 font-bold tabular-nums"><bdi>{visible && balance?.before != null ? balance.before : 'غير متاح'}</bdi></dd></div>
              <div><dt className={tone.muted}>التغيير (+/−)</dt><dd className={`mt-1 font-bold tabular-nums ${delta !== null && delta > 0 ? (isDarkMode ? 'text-emerald-300' : 'text-emerald-800') : delta !== null && delta < 0 ? (isDarkMode ? 'text-red-300' : 'text-red-700') : ''}`}><bdi dir="ltr">{delta === null ? 'غير متاح' : delta > 0 ? `+${delta}` : delta}</bdi></dd></div>
              <div><dt className={tone.muted}>الرصيد بعد</dt><dd className="mt-1 font-bold tabular-nums"><bdi>{visible && balance?.after != null ? balance.after : 'غير متاح'}</bdi></dd></div>
            </dl>
            <p className={`text-[11px] ${tone.muted}`}>
              {status === 'RECORDED' ? 'مسجل وقت العملية' : status === 'VERIFIED_HISTORICAL' ? 'متحقق تاريخيًا' : calculated ?
                showConditional ? 'محسوب تاريخيًا — غير مؤكد' : 'حساب تاريخي مشروط متاح — العرض اختياري' : 'غير متاح'}
              {calculated && showConditional && ' · بافتراض اكتمال الحركات واتجاه العملية وترتيب التنفيذ.'}
              {status === 'UNAVAILABLE' && ` · ${reasons[balance?.unavailable_reason || ''] || 'الرصيد قبل وبعد غير مثبت تاريخيًا.'}`}
            </p>
            {movement.notes && <p className={`whitespace-pre-wrap break-words text-xs ${tone.muted}`}>{movement.notes}</p>}
          </li>;
        })}
      </ol>}
      <ProductHistoryPagination pagination={data.pagination} count={data.items.length} label="صفحات حركة المنتج" isDarkMode={isDarkMode} onPage={goToPage} />
    </>}
  </section>;
}
