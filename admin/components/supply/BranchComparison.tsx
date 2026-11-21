import React, { useState } from 'react';
import useSupplyOverviewRead from '../../hooks/useSupplyOverviewRead';
import ComparisonProductPicker from './ComparisonProductPicker';
import { BranchComparisonData, ComparisonProduct, formatOverviewMoney, overviewControl, overviewPanel } from './supplyOverviewTypes';

interface Props { query: string; isDarkMode: boolean; version: number }
const BranchComparison: React.FC<Props> = ({ query, isDarkMode, version }) => {
  const [product, setProduct] = useState<ComparisonProduct | null>(null);
  const [retry, setRetry] = useState(0);
  const params = new URLSearchParams(query);
  params.set('view', 'branches');
  if (product) params.set('product_id', String(product.id));
  const result = useSupplyOverviewRead<BranchComparisonData>(`branch-comparison?${params}`, version + retry);
  const muted = isDarkMode ? 'text-white/45' : 'text-gray-500';
  const divider = isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]';
  const selected = result.data?.mode === 'selected_product';
  const showUnverified = result.data?.rows.some(row => row.historical_unverified_movement_count > 0);

  return <section className={`${overviewPanel(isDarkMode)} !mt-6`} aria-label="مقارنة الفروع حسب المنتج">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold">مقارنة الفروع</h2>
        <p className={`mt-1 text-[11px] ${muted}`}>{product ? 'كميات منتج واحد وقيمة بيعه حسب الفرع' : 'قيمة بيع المنتجات وعدد عمليات الاستهلاك المؤكدة حسب الفرع'}</p>
      </div>
      <details className={`max-w-lg text-[10px] leading-relaxed ${muted}`}>
        <summary className="cursor-pointer rounded-lg py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500">تعريف الأرقام وحدود التسجيل</summary>
        <p className="mt-2">مبيعات بنود المنتجات بفواتير PAID فقط حسب تاريخ الفاتورة؛ القيمة قبل خصم الفاتورة، وليست صافي إيراد أو ربحًا. المخزن الرئيسي مستبعد.</p>
        <p className="mt-1">في كل المنتجات: كل قيد INTERNAL_CONSUMPTION بأرصدة مسجلة متوافقة وفرق سالب يُحسب عملية مؤكدة واحدة، وليس عدد وحدات. لا تُجمع كميات المنتجات المختلفة.</p>
        <p className="mt-1">مع منتج محدد: الاستهلاك المؤكد بوحدة المنتج من الفرق السالب المسجل. السجلات التاريخية غير المؤكدة والتصحيحات منفصلة ومستبعدة من الاستهلاك المؤكد. الصفر لا يثبت اكتمال التسجيل التاريخي.</p>
      </details>
    </header>
    <div className={`mt-3 flex flex-wrap items-center gap-3 border-b pb-3 ${divider}`}>
      <ComparisonProductPicker query={query} version={version} isDarkMode={isDarkMode} selected={product} onSelect={setProduct} />
      {result.data?.product && <p className={`text-[11px] ${muted}`}>الوحدة: {result.data.product.unit || 'غير مسجلة'}</p>}
    </div>
    {result.loading && <p role="status" className="py-6 text-xs">جاري تحميل المقارنة…</p>}
    {result.error && <div role="alert" className="mt-3 text-xs">{result.error} <button type="button" className={overviewControl(isDarkMode)} onClick={() => setRetry(value => value + 1)}>إعادة المحاولة</button></div>}
    {result.data && <>
      {!result.data.rows.length ? <p className={`py-6 text-center text-xs ${muted}`}>النطاق المحدد لا يشمل فروعًا تشغيلية للمقارنة. اختر فرعًا أو كل الفروع.</p> : <div className="mt-3 overflow-x-auto">
        <table className={`w-full text-right text-xs ${selected ? 'min-w-[600px]' : 'min-w-[420px]'}`} aria-label={selected ? `مقارنة ${result.data.product?.name}` : 'مقارنة كل المنتجات بين الفروع'}>
          <thead className={isDarkMode ? 'bg-white/[0.02] text-white/45' : 'bg-gray-50 text-gray-500'}><tr>
            <th scope="col" className="px-3 py-2 font-semibold">الفرع</th>
            {selected && <th scope="col" className="px-3 py-2 font-semibold">الوحدات المباعة</th>}
            <th scope="col" className="px-3 py-2 font-semibold">قيمة المبيعات قبل خصم الفاتورة (ج.م)</th>
            <th scope="col" className="px-3 py-2 font-semibold">{selected ? 'وحدات الاستهلاك المؤكدة' : 'عمليات الاستهلاك المؤكدة'}</th>
            {selected && showUnverified && <th scope="col" className="px-3 py-2 font-semibold">سجلات استهلاك غير مؤكدة</th>}
          </tr></thead>
          <tbody>{result.data.rows.map(row => <tr key={row.branch_id} className={`border-t ${isDarkMode ? 'border-white/[0.03]' : 'border-black/[0.04]'}`}>
            <th scope="row" className="px-3 py-2 font-normal">{row.branch_name}{!row.branch_active && <span className="opacity-60"> (غير نشط)</span>}</th>
            {selected && <td className="px-3 py-2 tabular-nums">{row.units_sold ?? '—'}</td>}
            <td className="px-3 py-2 tabular-nums">{formatOverviewMoney(row.gross_sales_value)}</td>
            <td className="px-3 py-2 tabular-nums">
              {selected ? row.confirmed_consumption_units ?? '—' : row.confirmed_consumption_operations}
              {!selected && row.historical_unverified_movement_count > 0 && <span className={`mt-1 block text-[10px] ${muted}`}>سجلات غير مؤكدة: {row.historical_unverified_movement_count}</span>}
              {row.excluded_correction_count > 0 && <span className={`mt-1 block text-[10px] ${muted}`}>تصحيحات مستبعدة: {row.excluded_correction_count}</span>}
            </td>
            {selected && showUnverified && <td className="px-3 py-2 tabular-nums">{row.historical_unverified_movement_count}</td>}
          </tr>)}</tbody>
        </table>
      </div>}
      {result.data.rows.length > 0 && !result.data.meta.has_recorded_activity && <p className={`mt-3 text-[11px] ${muted}`}>لا توجد مبيعات منتجات أو قيود استهلاك مطابقة للفترة والنطاق؛ الأصفار تعني عدم وجود تسجيل مطابق، وليس إثبات اكتمال التاريخ.</p>}
      {!selected && result.data.rows.length > 0 && <p className={`mt-3 text-[10px] ${muted}`}>الاستهلاك هنا عدد عمليات مسجلة مؤكدة، وليس وحدات أو تكلفة استهلاك. السجلات غير المؤكدة لا تدخل في العدد.</p>}
    </>}
  </section>;
};
export default BranchComparison;
