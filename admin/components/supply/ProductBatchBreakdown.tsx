import React from 'react';
import { ProductWorkspaceBatch } from '../../types';
import { workspaceStyles } from './productWorkspaceStyles';

interface ProductBatchBreakdownProps {
  isDarkMode?: boolean;
  batches: ProductWorkspaceBatch[];
  unit: string;
}

const statusLabels: Record<ProductWorkspaceBatch['status'], string> = {
  HEALTHY: 'جيد', EXPIRING_SOON: 'قريب الانتهاء', EXPIRED: 'منتهي', NO_EXPIRY: 'بدون صلاحية',
};

const formatExpiry = (value?: string | null) => {
  if (!value) return 'بدون تاريخ انتهاء';
  return value.split('T')[0];
};

const formatSupplyDate = (value?: string | null) => {
  if (!value) return 'غير متوفر';
  return value.split('T')[0];
};

const formatDaysRemaining = (batch: ProductWorkspaceBatch) => {
  if (batch.days_remaining === null || batch.days_remaining === undefined) {
    return 'غير محدد';
  }
  if (batch.days_remaining < 0) {
    return `منتهي منذ ${Math.abs(batch.days_remaining)} يوم`;
  }
  if (batch.days_remaining === 0) {
    return 'ينتهي اليوم';
  }
  return `${batch.days_remaining} يوم`;
};

const ProductBatchBreakdown: React.FC<ProductBatchBreakdownProps> = ({ batches, unit, isDarkMode = true }) => {
  const tone = workspaceStyles(isDarkMode);
  return (
    <section aria-label="تفاصيل دفعات المخزون" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="text-sm font-black">دفعات المخزون</h2><p className={`mt-1 text-xs leading-5 ${tone.muted}`}>الكميات المسجلة لكل دفعة؛ رصيد المواقع موضح في توزيع المخزون.</p></div>
        <span className={`rounded-lg px-2 py-1 text-xs ${tone.subtle}`}>سجلات الدفعات: {batches.length}</span>
      </div>
      {batches.length === 0 ? (
        <p className={`rounded-xl border border-dashed px-4 py-6 text-center text-sm ${tone.divider} ${tone.muted}`}>لا توجد دفعات مخزنية متاحة لهذا المنتج حالياً.</p>
      ) : (
        <ul className={`divide-y ${isDarkMode ? 'divide-white/[0.08]' : 'divide-gray-200'}`}>
          {batches.map((batch) => {
            const badgeTone = batch.status === 'HEALTHY' ? tone.healthy : batch.status === 'EXPIRING_SOON' ? tone.low : batch.status === 'EXPIRED' ? tone.expired : tone.unavailable;
            return (
              <li key={`${batch.branch_id ?? 'unknown'}-${batch.batch_id}`} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><h3 className="break-words font-mono text-sm font-bold"><bdi>{batch.batch_number}</bdi></h3><p className={`mt-1 text-xs ${tone.muted}`}>{batch.branch_name}{batch.is_main_warehouse && <span className={`mr-2 inline-block rounded-md px-1.5 py-0.5 ${tone.warehouse}`}>المخزن الرئيسي</span>}</p></div>
                  <div className="flex flex-wrap items-center gap-2"><span className={`rounded-md px-2 py-1 text-xs font-bold ${badgeTone}`}>{statusLabels[batch.status]}</span><span className="text-sm font-black tabular-nums"><bdi>{batch.remaining_quantity}</bdi> <span className={`text-xs font-normal ${tone.muted}`}>{unit}</span></span></div>
                </div>
                <dl className={`grid grid-cols-2 gap-x-4 gap-y-2 text-xs lg:grid-cols-4 ${tone.muted}`}>
                  <div><dt>تاريخ الشراء</dt><dd className="mt-1"><bdi>{formatSupplyDate(batch.purchase_date)}</bdi></dd></div>
                  <div><dt>تاريخ الاستلام</dt><dd className="mt-1"><bdi>{formatSupplyDate(batch.received_at)}</bdi></dd></div>
                  <div><dt>الصلاحية</dt><dd className="mt-1"><bdi>{formatExpiry(batch.expiration_date)}</bdi></dd></div>
                  <div><dt>الأيام المتبقية</dt><dd className="mt-1">{formatDaysRemaining(batch)}</dd></div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default ProductBatchBreakdown;
