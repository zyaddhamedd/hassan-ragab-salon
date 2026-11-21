import React from 'react';
import { ProductWorkspaceSummary } from '../../types';
import { workspaceStyles } from './productWorkspaceStyles';

interface ProductAvailabilitySummaryProps {
  summary: ProductWorkspaceSummary;
  branchQuantity: number;
  unit: string;
  isDarkMode?: boolean;
}

export default function ProductAvailabilitySummary({ summary, branchQuantity, unit, isDarkMode = true }: ProductAvailabilitySummaryProps) {
  const tone = workspaceStyles(isDarkMode);
  const days = summary.nearest_expiration_days;
  const expiryDays = days === null || days === undefined ? 'غير محدد' : days < 0 ? `منتهي منذ ${Math.abs(days)} يوم` : days === 0 ? 'ينتهي اليوم' : `${days} يوم`;
  return (
    <section aria-label="ملخص المخزون" className={`${tone.panel} overflow-hidden`}>
      <dl className={`grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-y-0 ${isDarkMode ? 'divide-white/[0.08]' : 'divide-gray-200'}`}>
        {[
          { label: 'المخزن الرئيسي', value: summary.main_store_stock, suffix: unit },
          { label: 'كمية الفروع', value: branchQuantity, suffix: unit },
          // The server counts positive shortages independently at each location.
          { label: 'مواقع منخفضة المخزون', value: summary.low_stock_branches_count, suffix: 'موقع' },
        ].map(({ label, value, suffix }) => <div key={label} className="px-4 py-3 sm:px-5">
          <dt className={`text-xs font-bold ${tone.muted}`}>{label}</dt>
          <dd className="mt-1 flex flex-wrap items-baseline gap-2"><bdi className="text-2xl font-black tabular-nums">{value}</bdi><span className={`text-xs ${tone.muted}`}>{suffix}</span></dd>
        </div>)}
      </dl>
      <dl className={`flex flex-wrap gap-x-5 gap-y-2 border-t px-4 py-3 text-xs sm:px-5 ${tone.divider} ${tone.muted}`}>
        <div className="flex gap-1"><dt>إجمالي المخزون:</dt><dd className="font-bold tabular-nums">{summary.total_stock} {unit}</dd></div>
        <div className="flex gap-1"><dt>مواقع بها رصيد:</dt><dd className="tabular-nums">{summary.carrying_branches_count}</dd></div>
        <div className="flex flex-wrap gap-1"><dt>أقرب صلاحية مسجلة:</dt><dd>{summary.nearest_expiration ? <bdi>{summary.nearest_expiration.split('T')[0]}</bdi> : 'بدون صلاحية'}</dd><dd>· {expiryDays}</dd></div>
      </dl>
    </section>
  );
}
