import React from 'react';
import { ReturnCostSource, ReturnCostValuation } from '../../types';
import { workspaceStyles } from './productWorkspaceStyles';

const sourceLabels: Record<ReturnCostSource, string> = {
  RECORDED_AT_CREATION: 'مسجل وقت إنشاء المرتجع',
  CURRENT_COST_ESTIMATE: 'تقديري بالتكلفة الحالية',
  UNAVAILABLE: 'التكلفة غير متاحة',
};

export function formatReturnMoney(value?: string | null) {
  // The API supplies exact two-decimal strings. Never round via JS Number.
  if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) return 'التكلفة غير متاحة';
  const [whole, cents] = value.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents} ج.م`;
}

export default function ReturnCostSummary({ valuation, isDarkMode, compact = false }: { valuation?: ReturnCostValuation; isDarkMode: boolean; compact?: boolean }) {
  const tone = workspaceStyles(isDarkMode);
  const complete = valuation?.is_complete === true && valuation.return_cost_total !== null;
  return <section dir="rtl" aria-label="تقييم تكلفة المرتجع" className={`min-w-0 space-y-2 rounded-xl border p-3 text-xs ${tone.divider} ${tone.subtle} ${isDarkMode ? 'text-white/85' : 'text-gray-900'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-bold">إجمالي تكلفة المرتجع: <bdi>{formatReturnMoney(complete ? valuation.return_cost_total : null)}</bdi></span>
      <span className={tone.muted}>{sourceLabels[valuation?.valuation_source || 'UNAVAILABLE']}</span>
    </div>
    {!complete && valuation?.items.some((item) => item.line_cost_total !== null) && <p className={tone.muted}>
      إجمالي البنود المتاحة فقط: <bdi>{formatReturnMoney(valuation.known_cost_subtotal)}</bdi> · بنود بتكلفة غير متاحة: {valuation.unavailable_items_count}
    </p>}
    {!compact && valuation?.items.map((item) => <div key={item.item_key} className={`space-y-1 border-t pt-2 ${tone.divider}`}>
      <p className="break-words font-bold">{item.product_name} · الكمية: <bdi>{item.quantity ?? 'غير متاحة'}</bdi></p>
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <p>تكلفة الوحدة: <bdi>{formatReturnMoney(item.valuation_source === 'UNAVAILABLE' ? null : item.unit_cost)}</bdi></p>
        <p>إجمالي تكلفة البند: <bdi>{formatReturnMoney(item.valuation_source === 'UNAVAILABLE' ? null : item.line_cost_total)}</bdi></p>
      </div>
      <p className={tone.muted}>{sourceLabels[item.valuation_source]}</p>
    </div>)}
    {!compact && <p className={`text-[11px] leading-5 ${tone.muted}`}>تقييم بالتكلفة فقط؛ لا يثبت تنفيذ المرتجع أو أي قيد مالي.</p>}
  </section>;
}
