import React, { useId, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useProductInventoryHistory } from '../../hooks/useProductInventoryHistory';
import { ProductBatchHistoryResponse, lifecycleLabels, expiryLabels, historyDate } from './productHistoryTypes';
import ProductHistoryPagination from './ProductHistoryPagination';
import { workspaceStyles } from './productWorkspaceStyles';

interface Props { productId: number; unit: string; isDarkMode: boolean; enabled: boolean; }
export default function ProductBatchHistory({ productId, unit, isDarkMode, enabled }: Props) {
  const id = useId(); const tone = workspaceStyles(isDarkMode);
  const [filters, setFilters] = useState({ view: 'current', branch: 'all', lifecycle: 'ALL' });
  const scope = JSON.stringify([productId, filters]);
  const [paging, setPaging] = useState({ scope, page: 1 });
  const page = paging.scope === scope ? paging.page : 1;
  const query = new URLSearchParams({ view: filters.view, branch_id: filters.branch, lifecycle_status: filters.lifecycle, page: String(page), per_page: '20' });
  const { data, locations, error, loading, retry } = useProductInventoryHistory<ProductBatchHistoryResponse>(productId, 'batches', query.toString(), enabled);
  return <section aria-label="سجلات دفعات المخزون" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-black">دفعات المخزون</h2>
      <button type="button" className={tone.button} onClick={retry}><RefreshCw size={14} aria-hidden="true" /> تحديث الدفعات</button>
    </div>
    <p className={`text-xs leading-5 ${tone.muted}`}>كميات معلوماتية مسجلة للدفعات، وقد تختلف عن الرصيد التشغيلي المعروض في توزيع المواقع.</p>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label htmlFor={`${id}-view`} className={`space-y-1 text-xs ${tone.muted}`}><span className="block">العرض</span><select id={`${id}-view`} value={filters.view} onChange={(event) => setFilters({ ...filters, view: event.target.value, lifecycle: 'ALL' })} className={tone.field}><option value="current">الدفعات الحالية</option><option value="all">كل سجلات الدفعات</option></select></label>
      <label htmlFor={`${id}-location`} className={`space-y-1 text-xs ${tone.muted}`}><span className="block">الموقع</span><select id={`${id}-location`} value={filters.branch} onChange={(event) => setFilters({ ...filters, branch: event.target.value })} className={tone.field}><option value="all">كل المواقع المسموحة</option>{locations.map((location) => <option key={location.branch_id} value={location.branch_id}>{location.branch_name}{location.is_main_warehouse ? ' — المخزن الرئيسي' : ''}</option>)}</select></label>
      <label htmlFor={`${id}-status`} className={`space-y-1 text-xs ${tone.muted}`}><span className="block">حالة الدفعة أو سجل الموقع</span><select id={`${id}-status`} value={filters.lifecycle} onChange={(event) => setFilters({ ...filters, lifecycle: event.target.value, view: event.target.value === 'ALL' || event.target.value === 'ACTIVE' ? filters.view : 'all' })} className={tone.field}><option value="ALL">كل الحالات</option>{Object.entries(lifecycleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {loading && <p role="status" className={`py-4 text-sm ${tone.muted}`}>جاري تحميل سجلات الدفعات…</p>}
    {error && <div role="alert" className="space-y-2"><p>{error}</p><button type="button" className={tone.button} onClick={retry}>إعادة المحاولة</button></div>}
    {data && <>
      {data.items.length === 0 ? <p className={`rounded-xl border border-dashed p-5 text-center text-sm ${tone.divider} ${tone.muted}`}>لا توجد سجلات دفعات مطابقة للفلاتر.</p> : <ul className={`divide-y ${isDarkMode ? 'divide-white/10' : 'divide-gray-200'}`}>
        {data.items.map((batch) => <li key={batch.record_key} className="space-y-2 py-3 first:pt-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><h3 className="break-words font-mono text-sm font-bold"><bdi>{batch.batch_number}</bdi></h3><p className={`mt-1 text-xs ${tone.muted}`}>{batch.branch_record_id === null ? `دفعة بلا سجل موقع${batch.origin_branch_name ? ` · موقع الإنشاء: ${batch.origin_branch_name}` : ''}` : batch.branch_name}{batch.is_main_warehouse ? ' · المخزن الرئيسي' : ''}</p></div>
            <div className="flex flex-wrap gap-2">
              <span className={`rounded-md px-2 py-1 text-xs ${tone.subtle}`}>الدفعة: {lifecycleLabels[batch.batch_status]}</span>
              {batch.location_status && <span className={`rounded-md px-2 py-1 text-xs ${tone.subtle}`}>سجل الموقع: {lifecycleLabels[batch.location_status]}</span>}
              <span className={`rounded-md px-2 py-1 text-xs ${batch.expiry_status === 'EXPIRED' ? tone.expired : batch.expiry_status === 'EXPIRING_SOON' ? tone.low : tone.subtle}`}>{expiryLabels[batch.expiry_status]}</span>
              {batch.is_legacy && <span className={`rounded-md px-2 py-1 text-xs ${tone.warehouse}`}>رصيد Legacy مجمّع</span>}
            </div>
          </div>
          <dl className={`grid grid-cols-2 gap-3 rounded-xl p-3 text-xs sm:grid-cols-3 xl:grid-cols-4 ${tone.subtle}`}>
            <div><dt className={tone.muted}>المتبقي المسجل للدفعة</dt><dd className="mt-1 font-bold tabular-nums">{batch.remaining_quantity === null ? 'غير متاح' : <><bdi>{batch.remaining_quantity}</bdi> {unit}</>}</dd></div>
            <div><dt className={tone.muted}>الكمية الأصلية للدفعة</dt><dd className="mt-1 tabular-nums">{batch.initial_quantity === null ? 'غير متاح' : <><bdi>{batch.initial_quantity}</bdi> {unit}</>}</dd></div>
            <div><dt className={tone.muted}>تاريخ الشراء</dt><dd className="mt-1"><bdi>{historyDate(batch.purchase_date)}</bdi></dd></div>
            <div><dt className={tone.muted}>تاريخ الاستلام بالموقع</dt><dd className="mt-1"><bdi>{historyDate(batch.received_at)}</bdi></dd></div>
            <div><dt className={tone.muted}>الصلاحية</dt><dd className="mt-1"><bdi>{batch.expiration_date ? historyDate(batch.expiration_date) : 'بدون تاريخ انتهاء'}</bdi></dd></div>
            <div><dt className={tone.muted}>الأيام المتبقية</dt><dd className="mt-1">{batch.days_remaining === null ? 'غير محدد' : batch.days_remaining < 0 ? `منتهية منذ ${Math.abs(batch.days_remaining)} يوم` : batch.days_remaining === 0 ? 'تنتهي اليوم' : `${batch.days_remaining} يوم`}</dd></div>
            <div><dt className={tone.muted}>تاريخ إنشاء السجل</dt><dd className="mt-1"><bdi>{historyDate(batch.created_at)}</bdi></dd></div>
            <div><dt className={tone.muted}>آخر حركة مسجلة للدفعة</dt><dd className="mt-1"><bdi>{historyDate(batch.last_moved_at)}</bdi></dd></div>
          </dl>
          <p className={`break-words text-xs ${tone.muted}`}>المصدر: {batch.source_type === 'OPENING_BALANCE' ? 'رصيد افتتاحي' : batch.source_type === 'SUPPLY_RECEIPT' ? 'توريد' : batch.source_type}{batch.source_ref ? <> · <bdi>{batch.source_ref}</bdi></> : ''}</p>
        </li>)}
      </ul>}
      <ProductHistoryPagination pagination={data.pagination} count={data.items.length} label="صفحات سجلات الدفعات" isDarkMode={isDarkMode} onPage={(next) => setPaging({ scope, page: next })} />
    </>}
  </section>;
}
