import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Boxes, Eye, PackageCheck, Search, Truck } from 'lucide-react';
import adminApi from '../../api/client';
import {
  ActiveFilters,
  AttentionList,
  ComparisonLine,
  EmptyBlock,
  InsightStrip,
  MetricLine,
  mutedText,
  PaginationControls,
  panelClass,
  ReportDrawer,
  ReportError,
  ReportFilterBar,
  ReportLoading,
} from './ReportPrimitives';
import { errorMessage, formatCompactCurrency, formatCurrency, formatDate, formatNumber, formatShortDate, movementLabel, type DatePreset } from './reportUtils';
import type { NamedOption, ProductDrilldown, ProductsReportData, ReportDateRange } from './types';

interface Props {
  isDarkMode: boolean;
  range: ReportDateRange;
  preset: DatePreset;
  branchId: string;
  branches: NamedOption[];
  onRangeChange: (range: ReportDateRange) => void;
  onPresetChange: (preset: DatePreset) => void;
  onBranchChange: (branch: string) => void;
}

const selectClass = (dark: boolean) => `h-10 rounded-xl border px-3 text-xs font-bold outline-none ${dark ? 'border-white/10 bg-white/[0.04] text-white' : 'border-black/10 bg-[#FAFAFA] text-[#171717]'}`;

const stockLabel = (state: string) => ({ HEALTHY: 'مستقر', LOW: 'منخفض', OUT: 'نافد' }[state] || state);
const stockTone = (state: string) => state === 'HEALTHY' ? 'bg-emerald-500/10 text-emerald-500' : state === 'LOW' ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500';

const downloadBlob = (data: Blob, filename: string) => {
  const href = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
};

const ProductsReport: React.FC<Props> = ({ isDarkMode, range, preset, branchId, branches, onRangeChange, onPresetChange, onBranchChange }) => {
  const [data, setData] = useState<ProductsReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('');
  const [productId, setProductId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('gross_sales_value');
  const [exporting, setExporting] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<number | null>(null);
  const [drilldown, setDrilldown] = useState<ProductDrilldown | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const params = useMemo(() => ({
    date_from: range.dateFrom,
    date_to: range.dateTo,
    branch_id: branchId === 'All' ? undefined : branchId,
    product_category: category || undefined,
    product_id: productId || undefined,
    search: search || undefined,
    page,
    per_page: 12,
    sort_by: sortBy,
    sort_dir: 'desc',
  }), [range, branchId, category, productId, search, page, sortBy]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get<ProductsReportData>('/reports/products', { params });
      setData(response.data);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { void fetchReport(); }, [fetchReport]);
  useEffect(() => { setPage(1); }, [range, branchId, category, productId, search, sortBy]);

  useEffect(() => {
    if (!selectedProduct) {
      setDrilldown(null);
      return;
    }
    const load = async () => {
      setDrillLoading(true);
      try {
        const response = await adminApi.get<ProductDrilldown>(`/reports/products/${selectedProduct}`, { params });
        setDrilldown(response.data);
      } catch (requestError) {
        setError(errorMessage(requestError));
        setSelectedProduct(null);
      } finally {
        setDrillLoading(false);
      }
    };
    void load();
  }, [selectedProduct, params]);

  const exportReport = async () => {
    setExporting(true);
    try {
      const response = await adminApi.get('/reports/products/export/xlsx', { params, responseType: 'blob' });
      downloadBlob(response.data, `products-report-${range.dateFrom}-${range.dateTo}.xlsx`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setExporting(false);
    }
  };

  const maxProductValue = Math.max(...(data?.sales_ranking.map((item) => item.gross_sales_value) || [1]), 1);
  const health = data?.inventory_health;
  const healthTotal = Math.max(health?.tracked_products || 0, 1);
  const trendPeak = data && data.sales_trend.length ? data.sales_trend.reduce((peak, row) => row.gross_sales_value > peak.gross_sales_value ? row : peak) : null;
  const activeFilters = [
    ...(branchId !== 'All' ? [{ key: 'branch', label: `الفرع: ${branches.find((item) => String(item.id) === branchId)?.name || branchId}`, onRemove: () => onBranchChange('All') }] : []),
    ...(category ? [{ key: 'category', label: `الفئة: ${category}`, onRemove: () => { setCategory(''); setProductId(''); } }] : []),
    ...(productId ? [{ key: 'product', label: `المنتج: ${data?.filter_options.products.find((item) => String(item.id) === productId)?.name || productId}`, onRemove: () => setProductId('') }] : []),
  ];

  return (
    <div className="space-y-6">
      <ReportFilterBar
        isDarkMode={isDarkMode}
        range={range}
        preset={preset}
        branchId={branchId}
        branches={branches}
        onRangeChange={onRangeChange}
        onPresetChange={onPresetChange}
        onBranchChange={onBranchChange}
        onExport={exportReport}
        exporting={exporting}
      >
        <select aria-label="فئة المنتج" value={category} onChange={(event) => { setCategory(event.target.value); setProductId(''); }} className={selectClass(isDarkMode)}>
          <option value="">كل الفئات</option>
          {data?.filter_options.categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select aria-label="المنتج" value={productId} onChange={(event) => setProductId(event.target.value)} className={selectClass(isDarkMode)}>
          <option value="">كل المنتجات</option>
          {data?.filter_options.products.filter((item) => !category || item.category === category).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </ReportFilterBar>

      <ActiveFilters filters={activeFilters} isDarkMode={isDarkMode} />

      {error && data && <div className="rounded-xl border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-xs font-bold text-red-500">{error}</div>}

      {loading && !data ? <ReportLoading isDarkMode={isDarkMode} /> : error && !data ? <ReportError isDarkMode={isDarkMode} message={error} onRetry={fetchReport} /> : data && (
        <>
          <section className={`${panelClass(isDarkMode)} overflow-hidden p-6 sm:p-8`}>
            <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-end">
              <div>
                <div className="mb-5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-[#E53935]"><Boxes size={15} /> مبيعات المنتجات</div>
                <p className={`mb-2 text-xs font-bold ${mutedText(isDarkMode)}`}>إجمالي قيمة بنود المنتجات في الفواتير المدفوعة</p>
                <h2 className="text-4xl font-black tracking-tight sm:text-6xl" title={formatCurrency(data.summary.product_gross_sales_value)}>{formatCompactCurrency(data.summary.product_gross_sales_value)}</h2>
                <p className={`mt-3 text-[11px] ${mutedText(isDarkMode)}`}>{formatCurrency(data.summary.product_gross_sales_value)} بالضبط</p>
                <div className="mt-4"><ComparisonLine comparison={data.comparison.product_gross_sales_value} isDarkMode={isDarkMode} formatter={formatCurrency} /></div>
                <p className={`mt-2 text-[9px] ${mutedText(isDarkMode)}`}>فترة المقارنة: {formatShortDate(data.meta.previous_date_from)} – {formatShortDate(data.meta.previous_date_to)}</p>
              </div>
              <div className={`rounded-2xl p-5 ${isDarkMode ? 'bg-white/[0.025]' : 'bg-black/[0.025]'}`}>
                <div className="grid grid-cols-2 gap-4 border-b border-white/[0.06] pb-4">
                  <div><p className={`text-[10px] ${mutedText(isDarkMode)}`}>الوحدات المباعة</p><p className="mt-1 text-lg font-black">{formatNumber(data.summary.product_units_sold)}</p><ComparisonLine comparison={data.comparison.product_units_sold} isDarkMode={isDarkMode} /></div>
                  <div><p className={`text-[10px] ${mutedText(isDarkMode)}`}>فواتير مدفوعة</p><p className="mt-1 text-lg font-black">{formatNumber(data.summary.paid_invoice_count)}</p><ComparisonLine comparison={data.comparison.paid_invoice_count} isDarkMode={isDarkMode} /></div>
                </div>
                <MetricLine label="المنتج الأقوى" value={data.summary.strongest_product?.product_name || '—'} isDarkMode={isDarkMode} />
                <MetricLine label="منتجات منخفضة" value={formatNumber(data.summary.low_stock_products)} isDarkMode={isDarkMode} />
                <MetricLine label="منتجات نافدة" value={formatNumber(data.summary.out_of_stock_products)} isDarkMode={isDarkMode} />
              </div>
            </div>
          </section>

          <InsightStrip insights={data.insights} isDarkMode={isDarkMode} />
          <AttentionList items={data.attention} isDarkMode={isDarkMode} onEntity={(id) => setProductId(String(id))} />

          <div className="grid gap-6 xl:grid-cols-[1.05fr_1.4fr]">
            <section className={`${panelClass(isDarkMode)} p-6`}>
              <div className="mb-6"><h3 className="text-lg font-black">المنتجات القائدة</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>الترتيب حسب قيمة المبيعات</p></div>
              <div className={`mb-6 grid grid-cols-3 gap-3 rounded-2xl p-3 text-center ${isDarkMode ? 'bg-white/[0.025]' : 'bg-black/[0.025]'}`}><div><p className="text-base font-black">{formatNumber(data.concentration.top_one_product_share)}%</p><p className={`text-[9px] ${mutedText(isDarkMode)}`}>أعلى منتج</p></div><div><p className="text-base font-black">{formatNumber(data.concentration.top_three_products_share)}%</p><p className={`text-[9px] ${mutedText(isDarkMode)}`}>أعلى 3 منتجات</p></div><div><p className="text-base font-black">{formatNumber(data.concentration.top_branch_share)}%</p><p className={`text-[9px] ${mutedText(isDarkMode)}`}>الفرع الأعلى</p></div></div>
              {data.sales_ranking.length ? <div className="space-y-5">{data.sales_ranking.map((item, index) => <div key={item.product_id}><div className="mb-2 flex items-center justify-between gap-3 text-xs"><button type="button" onClick={() => setProductId(String(item.product_id))} className="font-black text-right"><span className="ml-2 text-[#E53935]">{String(index + 1).padStart(2, '0')}</span>{item.product_name}</button><div className="flex items-center gap-2"><span className="font-black">{formatCurrency(item.gross_sales_value)}</span><button type="button" onClick={() => setSelectedProduct(item.product_id)} title="فتح التفاصيل" aria-label={`تفاصيل ${item.product_name}`} className={`rounded-lg border p-1.5 opacity-70 transition hover:opacity-100 ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}><Eye size={13} /></button></div></div><button type="button" aria-label={`تصفية حسب ${item.product_name}`} onClick={() => setProductId(String(item.product_id))} className={`block h-1.5 w-full overflow-hidden rounded-full ${isDarkMode ? 'bg-white/[0.06]' : 'bg-black/[0.06]'}`}><span className="block h-full rounded-full bg-gradient-to-l from-[#E53935] to-[#E6D690]" style={{ width: `${Math.max(item.gross_sales_value / maxProductValue * 100, 3)}%` }} /></button></div>)}</div> : <EmptyBlock isDarkMode={isDarkMode} />}
            </section>
            <section className={`${panelClass(isDarkMode)} p-6`}>
              <div className="mb-4"><h3 className="text-lg font-black">مسار مبيعات المنتجات</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>حسب تاريخ سداد الفاتورة بتوقيت القاهرة</p></div>
              {data.sales_trend.length ? <div className="h-[300px]" dir="ltr"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.sales_trend} margin={{ top: 15, right: 8, left: 0, bottom: 0 }}><defs><linearGradient id="productTrend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E53935" stopOpacity={0.36} /><stop offset="100%" stopColor="#E53935" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 7" vertical={false} stroke={isDarkMode ? '#ffffff10' : '#00000010'} /><XAxis dataKey="date" tickFormatter={formatShortDate} axisLine={false} tickLine={false} tick={{ fill: isDarkMode ? '#ffffff55' : '#00000055', fontSize: 10 }} minTickGap={28} /><YAxis hide /><Tooltip formatter={(value, name) => [name === 'gross_sales_value' ? formatCurrency(Number(value)) : formatNumber(Number(value)), name === 'gross_sales_value' ? 'قيمة مبيعات المنتجات' : 'الوحدات المباعة']} labelFormatter={(label) => `تاريخ القاهرة: ${formatShortDate(String(label))}`} contentStyle={{ background: isDarkMode ? '#181818' : '#fff', border: 'none', borderRadius: 14, direction: 'rtl' }} /><Area type="monotone" dataKey="gross_sales_value" stroke="#E53935" strokeWidth={2.5} fill="url(#productTrend)" /><Area type="monotone" dataKey="units_sold" stroke="transparent" fill="transparent" dot={false} activeDot={false} />{trendPeak && <ReferenceDot x={trendPeak.date} y={trendPeak.gross_sales_value} r={4} fill="#E6D690" stroke="none" label={{ value: 'أعلى يوم', position: 'top', fill: isDarkMode ? '#ffffff88' : '#00000088', fontSize: 9 }} />}</AreaChart></ResponsiveContainer></div> : <EmptyBlock isDarkMode={isDarkMode} />}
            </section>
          </div>

          <section className={`${panelClass(isDarkMode)} p-6`}>
            <div className="mb-5"><h3 className="text-lg font-black">مصدر مبيعات المنتجات</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>مساهمة الفروع في قيمة مبيعات الفترة</p></div>
            {data.branches.length ? <div className="grid gap-x-8 md:grid-cols-2 xl:grid-cols-3">{data.branches.map((item) => <button type="button" key={item.branch_id} onClick={() => onBranchChange(String(item.branch_id))} title="تصفية التقرير حسب الفرع" className="block w-full text-right"><MetricLine label={`${item.branch_name} · ${formatNumber(item.contribution_percent)}%`} value={formatCurrency(item.gross_sales_value)} isDarkMode={isDarkMode} /></button>)}</div> : <EmptyBlock isDarkMode={isDarkMode} />}
          </section>

          <section className={`${panelClass(isDarkMode)} p-6 sm:p-8`}>
            <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr]">
              <div>
                <div className="mb-6 flex items-center justify-between"><div><h3 className="text-lg font-black">صحة المخزون الحالية</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>موضع حي الآن، لا يتغير بنطاق تاريخ المبيعات</p></div><PackageCheck size={22} className="text-emerald-500" /></div>
                <div className={`flex h-4 overflow-hidden rounded-full ${isDarkMode ? 'bg-white/[0.05]' : 'bg-black/[0.05]'}`}>
                  <div className="bg-emerald-500" style={{ width: `${(health.healthy / healthTotal) * 100}%` }} />
                  <div className="bg-amber-500" style={{ width: `${(health.low / healthTotal) * 100}%` }} />
                  <div className="bg-red-500" style={{ width: `${(health.out / healthTotal) * 100}%` }} />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3 text-center"><div><p className="text-xl font-black text-emerald-500">{health.healthy}</p><p className={`text-[11px] ${mutedText(isDarkMode)}`}>مستقر</p></div><div><p className="text-xl font-black text-amber-500">{health.low}</p><p className={`text-[11px] ${mutedText(isDarkMode)}`}>منخفض</p></div><div><p className="text-xl font-black text-red-500">{health.out}</p><p className={`text-[11px] ${mutedText(isDarkMode)}`}>نافد</p></div></div>
              </div>
              <div className={`rounded-2xl p-5 ${isDarkMode ? 'bg-white/[0.025]' : 'bg-black/[0.025]'}`}>
                <div className="mb-2 flex items-center gap-2 text-amber-500"><AlertTriangle size={17} /><span className="text-xs font-black">تعرض الصلاحية</span></div>
                <MetricLine label="وحدات منتهية" value={formatNumber(health.expired_units)} isDarkMode={isDarkMode} />
                <MetricLine label="تنتهي خلال 30 يوماً" value={formatNumber(health.expiring_within_30_days_units)} isDarkMode={isDarkMode} />
                <p className={`mt-3 text-[10px] leading-5 ${mutedText(isDarkMode)}`}>من كميات الدفعات الحالية ذات تاريخ صلاحية مسجل.</p>
              </div>
            </div>
          </section>

          <section className={`${panelClass(isDarkMode)} p-6 sm:p-8`}>
            <div className="mb-6"><h3 className="text-lg font-black">مصفوفة الحركة والمخزون</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>الحركة المرتفعة تبدأ من وسيط الوحدات المباعة الموجبة: {formatNumber(data.inventory_matrix.sales_units_threshold)} وحدة</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.inventory_matrix.quadrants.map((quadrant) => <div key={quadrant.key} className={`min-h-36 rounded-2xl border p-4 ${quadrant.key === 'HIGH_SALES_LOW_STOCK' ? 'border-amber-500/20 bg-amber-500/[0.04]' : isDarkMode ? 'border-white/[0.07] bg-white/[0.018]' : 'border-black/[0.06] bg-black/[0.015]'}`}><div className="mb-3 flex items-center justify-between gap-3"><p className="text-xs font-black">{quadrant.label}</p><span className={`text-lg font-black ${mutedText(isDarkMode)}`}>{quadrant.count}</span></div>{quadrant.items.length ? <div className="flex flex-wrap gap-2">{quadrant.items.map((item) => <button type="button" key={item.product_id} onClick={() => setProductId(String(item.product_id))} className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}>{item.product_name}</button>)}</div> : <p className={`text-[10px] ${mutedText(isDarkMode)}`}>لا توجد منتجات في هذا النطاق</p>}</div>)}
            </div>
          </section>

          <section className={`${panelClass(isDarkMode)} p-6`}>
            <div className="mb-5"><h3 className="text-lg font-black">منتجات منخفضة الحركة</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>مخزون حالي أكبر من صفر مع وحدة واحدة مباعة أو أقل خلال الفترة</p></div>
            {data.slow_movers.length ? <div className="grid gap-x-8 md:grid-cols-2">{data.slow_movers.slice(0, 6).map((item) => <button type="button" key={item.product_id} onClick={() => setProductId(String(item.product_id))} className={`flex items-center justify-between gap-4 border-b py-3 text-right ${isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'}`}><div><p className="text-xs font-black">{item.product_name}</p><p className={`mt-1 text-[10px] ${mutedText(isDarkMode)}`}>{formatNumber(item.units_sold)} مباعة خلال الفترة</p></div><span className="text-xs font-black">{formatNumber(item.current_stock)} بالمخزون</span></button>)}</div> : <EmptyBlock isDarkMode={isDarkMode} title="لا توجد منتجات منخفضة الحركة ضمن الفلاتر الحالية" />}
          </section>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <section className={`${panelClass(isDarkMode)} p-6`}>
              <div className="mb-5"><h3 className="text-lg font-black">حركة المخزون خلال الفترة</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>كميات الحركة، وليست قيمة مالية</p></div>
              {data.movements.length ? <div className="grid gap-3 sm:grid-cols-2">{data.movements.map((item) => <div key={item.type} className={`rounded-2xl border p-4 ${isDarkMode ? 'border-white/[0.06] bg-white/[0.02]' : 'border-black/[0.06] bg-black/[0.015]'}`}><p className={`text-[11px] font-bold ${mutedText(isDarkMode)}`}>{movementLabel(item.type)}</p><p className="mt-2 text-2xl font-black">{formatNumber(item.quantity)}</p></div>)}</div> : <EmptyBlock isDarkMode={isDarkMode} title="لا توجد حركات مخزون في الفترة" />}
            </section>
            <section className={`${panelClass(isDarkMode)} p-6`}>
              <div className="mb-5 flex items-center justify-between"><div><h3 className="text-lg font-black">سياق الإمداد</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>حالات تشغيلية مفتوحة الآن</p></div><Truck size={20} className="text-[#E53935]" /></div>
              <MetricLine label="طلبات توريد مفتوحة" value={formatNumber(data.supply_context.pending_supply_requests)} isDarkMode={isDarkMode} />
              <MetricLine label="شحنات في الطريق" value={formatNumber(data.supply_context.in_transit_shipments)} isDarkMode={isDarkMode} />
              <MetricLine label="مرتجعات معلقة" value={formatNumber(data.supply_context.pending_returns)} isDarkMode={isDarkMode} />
            </section>
          </div>

          <section className={`${panelClass(isDarkMode)} p-5 sm:p-6`}>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-lg font-black">تفاصيل المنتجات</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>المبيعات خلال الفترة مع موضع المخزون الحالي</p></div><div className="flex gap-2"><label className={`flex h-10 items-center gap-2 rounded-xl border px-3 ${isDarkMode ? 'border-white/10 bg-white/[0.03]' : 'border-black/10 bg-black/[0.02]'}`}><Search size={15} className={mutedText(isDarkMode)} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث" className="w-32 bg-transparent text-xs font-bold outline-none" /></label><select aria-label="ترتيب" value={sortBy} onChange={(event) => setSortBy(event.target.value)} className={selectClass(isDarkMode)}><option value="gross_sales_value">حسب المبيعات</option><option value="units_sold">حسب الوحدات</option><option value="current_stock">حسب المخزون</option><option value="name">حسب الاسم</option></select></div></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-right text-xs"><thead className={mutedText(isDarkMode)}><tr className={`border-b ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}><th className="px-3 py-4">المنتج</th><th className="px-3 py-4">الفئة</th><th className="px-3 py-4">الوحدات</th><th className="px-3 py-4">قيمة المبيعات</th><th className="px-3 py-4">المخزون</th><th className="px-3 py-4">الحالة</th><th className="px-3 py-4">فروع متاحة</th><th className="px-3 py-4">الفرع الأعلى</th><th className="px-3 py-4">آخر حركة</th></tr></thead><tbody>{data.table.items.map((item) => <tr key={item.product_id} onClick={() => setSelectedProduct(item.product_id)} className={`cursor-pointer border-b transition last:border-b-0 ${isDarkMode ? 'border-white/[0.05] hover:bg-white/[0.03]' : 'border-black/[0.05] hover:bg-black/[0.02]'}`}><td className="px-3 py-4 font-black">{item.product_name}</td><td className={`px-3 py-4 ${mutedText(isDarkMode)}`}>{item.category || '—'}</td><td className="px-3 py-4">{formatNumber(item.units_sold)}</td><td className="px-3 py-4 font-black">{formatCurrency(item.gross_sales_value)}</td><td className="px-3 py-4">{formatNumber(item.current_stock)}</td><td className="px-3 py-4"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${stockTone(item.stock_state)}`}>{stockLabel(item.stock_state)}</span></td><td className="px-3 py-4">{item.branches_carrying_stock}</td><td className="px-3 py-4">{item.top_branch?.name || '—'}</td><td className="px-3 py-4">{formatDate(item.recent_activity_at)}</td></tr>)}</tbody></table>{!data.table.items.length && <EmptyBlock isDarkMode={isDarkMode} />}</div>
            <PaginationControls pagination={data.table.pagination} isDarkMode={isDarkMode} onPage={setPage} />
          </section>

          <p className={`px-2 text-[11px] leading-6 ${mutedText(isDarkMode)}`}>قيمة المبيعات إجمالية لبنود المنتجات، والأسماء والفئات من الكتالوج الحالي. لا يعرض التقرير الربح أو الهامش لأن تكلفة المنتج وقت البيع غير محفوظة تاريخياً.</p>
        </>
      )}

      {selectedProduct && <ReportDrawer isDarkMode={isDarkMode} title={drilldown?.product.name || 'تفاصيل المنتج'} subtitle={drilldown ? `${drilldown.product.category} · ${drilldown.product.unit}` : undefined} onClose={() => setSelectedProduct(null)}>
        {drillLoading || !drilldown ? <ReportLoading isDarkMode={isDarkMode} /> : <div className="space-y-6">
          <InsightStrip insights={drilldown.insights} isDarkMode={isDarkMode} />
          <AttentionList items={drilldown.attention} isDarkMode={isDarkMode} />
          <section className={`${panelClass(isDarkMode)} p-5`}>
            <MetricLine label="قيمة المبيعات" value={formatCurrency(drilldown.summary.product_gross_sales_value)} isDarkMode={isDarkMode} />
            <div className="py-2"><ComparisonLine comparison={drilldown.comparison.product_gross_sales_value} isDarkMode={isDarkMode} formatter={formatCurrency} /></div>
            <MetricLine label="الوحدات المباعة" value={formatNumber(drilldown.summary.product_units_sold)} isDarkMode={isDarkMode} />
            <div className="py-2"><ComparisonLine comparison={drilldown.comparison.product_units_sold} isDarkMode={isDarkMode} /></div>
            <MetricLine label="المخزون الحالي" value={formatNumber(drilldown.stock_context.current_stock)} isDarkMode={isDarkMode} />
            <MetricLine label="حالة المخزون" value={<span className={`rounded-full px-2.5 py-1 text-[10px] ${stockTone(drilldown.stock_context.stock_state)}`}>{stockLabel(drilldown.stock_context.stock_state)}</span>} isDarkMode={isDarkMode} />
            <MetricLine label="حد المخزون المنخفض" value={formatNumber(drilldown.stock_context.min_stock_threshold)} isDarkMode={isDarkMode} />
          </section>
          <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-4 font-black">مسار المبيعات</h3>{drilldown.sales_trend.length ? <div className="h-36" dir="ltr"><ResponsiveContainer width="100%" height="100%"><AreaChart data={drilldown.sales_trend}><XAxis dataKey="date" hide /><YAxis hide /><Tooltip formatter={(value) => formatCurrency(Number(value))} labelFormatter={(label) => formatShortDate(String(label))} contentStyle={{ background: isDarkMode ? '#181818' : '#fff', border: 'none', borderRadius: 12, direction: 'rtl' }} /><Area type="monotone" dataKey="gross_sales_value" stroke="#E53935" strokeWidth={2} fill="#E5393522" /></AreaChart></ResponsiveContainer></div> : <EmptyBlock isDarkMode={isDarkMode} />}</section>
          <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-3 font-black">المخزون حسب الفرع</h3>{drilldown.branch_stock.length ? drilldown.branch_stock.map((item) => <MetricLine key={item.branch_id} label={item.branch_name} value={`${formatNumber(item.stock_quantity)} ${drilldown.product.unit}`} isDarkMode={isDarkMode} />) : <EmptyBlock isDarkMode={isDarkMode} />}</section>
          <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-3 font-black">سياق الإمداد الحالي</h3><MetricLine label="طلبات توريد مفتوحة" value={formatNumber(drilldown.supply_context.pending_supply_requests)} isDarkMode={isDarkMode} /><MetricLine label="شحنات في الطريق" value={formatNumber(drilldown.supply_context.in_transit_shipments)} isDarkMode={isDarkMode} /><MetricLine label="مرتجعات معلقة" value={formatNumber(drilldown.supply_context.pending_returns)} isDarkMode={isDarkMode} /></section>
          <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-3 font-black">أحدث حركات المخزون</h3>{drilldown.recent_movements.length ? drilldown.recent_movements.map((item) => <div key={item.id} className={`border-b py-3 last:border-0 ${isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'}`}><div className="flex justify-between text-xs font-black"><span>{movementLabel(item.type)}</span><span>{formatNumber(item.quantity)}</span></div><p className={`mt-1 text-[11px] ${mutedText(isDarkMode)}`}>{item.branch_name} · {formatDate(item.created_at)}</p></div>) : <EmptyBlock isDarkMode={isDarkMode} />}</section>
        </div>}
      </ReportDrawer>}
    </div>
  );
};

export default ProductsReport;
