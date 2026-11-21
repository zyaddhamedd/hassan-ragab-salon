import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Banknote, Eye, ReceiptText, Search, Split } from 'lucide-react';
import adminApi from '../../api/client';
import {
  ActiveFilters,
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
import { comparisonText, errorMessage, formatCompactCurrency, formatCurrency, formatNumber, formatShortDate, type DatePreset } from './reportUtils';
import type { NamedOption, ReportDateRange, ReportInsight, SalesDrilldown, SalesReportData } from './types';

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
const paymentLabel = (method: string) => ({ CASH: 'نقدي', VISA: 'فيزا', INSTAPAY: 'إنستا باي' }[method] || method);

const downloadBlob = (data: Blob, filename: string) => {
  const href = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
};

const SalesReport: React.FC<Props> = ({ isDarkMode, range, preset, branchId, branches, onRangeChange, onPresetChange, onBranchChange }) => {
  const [data, setData] = useState<SalesReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [cashierId, setCashierId] = useState('');
  const [itemType, setItemType] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('invoice_date');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<number | null>(null);
  const [drilldown, setDrilldown] = useState<SalesDrilldown | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const params = useMemo(() => ({
    date_from: range.dateFrom,
    date_to: range.dateTo,
    branch_id: branchId === 'All' ? undefined : branchId,
    payment_method: paymentMethod || undefined,
    promo_code: promoCode || undefined,
    cashier_id: cashierId || undefined,
    sales_item_type: itemType || undefined,
    search: search || undefined,
    sort_by: sortBy,
    sort_dir: 'desc',
    page,
    per_page: 12,
  }), [range, branchId, paymentMethod, promoCode, cashierId, itemType, search, sortBy, page]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get<SalesReportData>('/reports/sales', { params });
      setData(response.data);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { void fetchReport(); }, [fetchReport]);
  useEffect(() => { setPage(1); }, [range, branchId, paymentMethod, promoCode, cashierId, itemType, search, sortBy]);

  useEffect(() => {
    if (!selectedInvoice) {
      setDrilldown(null);
      return;
    }
    const load = async () => {
      setDrillLoading(true);
      try {
        const response = await adminApi.get<SalesDrilldown>(`/reports/sales/${selectedInvoice}`, { params });
        setDrilldown(response.data);
      } catch (requestError) {
        setError(errorMessage(requestError));
        setSelectedInvoice(null);
      } finally {
        setDrillLoading(false);
      }
    };
    void load();
  }, [selectedInvoice, params]);

  const exportReport = async () => {
    setExporting(true);
    try {
      const response = await adminApi.get('/reports/sales/export/xlsx', { params, responseType: 'blob' });
      downloadBlob(response.data, `sales-report-${range.dateFrom}-${range.dateTo}.xlsx`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setExporting(false);
    }
  };

  const trendPeak = data?.trend.length ? data.trend.reduce((peak, row) => row.net_sales > peak.net_sales ? row : peak) : null;
  const driverInsight = data?.insights.find((item) => item.code === 'SALES_DRIVERS' || item.code === 'NET_STABLE');
  const editorialInsights: ReportInsight[] = data ? [
    ...data.insights.filter((item) => item.code !== 'SALES_DRIVERS' && item.code !== 'NET_STABLE').slice(0, 2),
    ...data.attention
      .filter((item) => ['FULLY_DISCOUNTED', 'DISCOUNT_RATE_INCREASE'].includes(item.code))
      .slice(0, 1)
      .map((item) => ({ code: item.code, text: `${item.label}: ${item.detail}` })),
  ].slice(0, 3) : [];
  const activeFilters = [
    ...(branchId !== 'All' ? [{ key: 'branch', label: `الفرع: ${branches.find((item) => String(item.id) === branchId)?.name || branchId}`, onRemove: () => onBranchChange('All') }] : []),
    ...(paymentMethod ? [{ key: 'payment', label: `الدفع: ${paymentLabel(paymentMethod)}`, onRemove: () => setPaymentMethod('') }] : []),
    ...(promoCode ? [{ key: 'promo', label: `الكود: ${promoCode}`, onRemove: () => setPromoCode('') }] : []),
    ...(cashierId ? [{ key: 'cashier', label: `الكاشير: ${data?.filter_options.cashiers.find((item) => String(item.id) === cashierId)?.name || cashierId}`, onRemove: () => setCashierId('') }] : []),
    ...(itemType ? [{ key: 'item', label: itemType === 'SERVICE_ITEM' ? 'فواتير تحتوي خدمات' : 'فواتير تحتوي منتجات', onRemove: () => setItemType('') }] : []),
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
        <select aria-label="طريقة الدفع" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className={selectClass(isDarkMode)}>
          <option value="">كل طرق الدفع</option>
          {data?.filter_options.payment_methods.map((method) => <option key={method} value={method}>{paymentLabel(method)}</option>)}
        </select>
        <select aria-label="كود الخصم" value={promoCode} onChange={(event) => setPromoCode(event.target.value)} className={selectClass(isDarkMode)}>
          <option value="">كل أكواد الخصم</option>
          {data?.filter_options.promo_codes.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
        <select aria-label="الكاشير" value={cashierId} onChange={(event) => setCashierId(event.target.value)} className={selectClass(isDarkMode)}>
          <option value="">كل المحصلين</option>
          {data?.filter_options.cashiers.map((cashier) => <option key={cashier.id} value={cashier.id}>{cashier.name}</option>)}
        </select>
      </ReportFilterBar>

      <ActiveFilters filters={activeFilters} isDarkMode={isDarkMode} />
      {error && data && <div className="rounded-xl border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-xs font-bold text-red-500">{error}</div>}

      {loading && !data ? <ReportLoading isDarkMode={isDarkMode} /> : error && !data ? <ReportError isDarkMode={isDarkMode} message={error} onRetry={fetchReport} /> : data && (
        <>
          <section className={`${panelClass(isDarkMode)} overflow-hidden p-6 sm:p-8`}>
            <div className="grid gap-8 lg:grid-cols-[1.45fr_1fr] lg:items-end">
              <div>
                <div className="mb-5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-[#E53935]"><ReceiptText size={15} /> صافي المبيعات</div>
                <p className={`mb-2 text-xs font-bold ${mutedText(isDarkMode)}`}>الفواتير المدفوعة بعد خصم مستوى الفاتورة</p>
                <h2 className="text-4xl font-black tracking-tight sm:text-6xl" title={formatCurrency(data.summary.net_sales)}>{formatCompactCurrency(data.summary.net_sales)}</h2>
                <p className={`mt-3 text-[11px] ${mutedText(isDarkMode)}`}>{formatCurrency(data.summary.net_sales)} بالضبط</p>
                <div className="mt-4"><ComparisonLine comparison={data.comparison.net_sales} isDarkMode={isDarkMode} formatter={formatCurrency} /></div>
                <p className={`mt-2 text-[9px] ${mutedText(isDarkMode)}`}>فترة المقارنة: {formatShortDate(data.meta.previous_date_from)} – {formatShortDate(data.meta.previous_date_to)}</p>
              </div>
              <div className={`rounded-2xl p-5 ${isDarkMode ? 'bg-white/[0.025]' : 'bg-black/[0.025]'}`}>
                <div className="grid grid-cols-2 gap-5">
                  <div><p className={`text-[10px] ${mutedText(isDarkMode)}`}>فواتير مدفوعة</p><p className="mt-1 text-xl font-black">{formatNumber(data.summary.paid_invoice_count)}</p><ComparisonLine comparison={data.comparison.paid_invoice_count} isDarkMode={isDarkMode} /></div>
                  <div><p className={`text-[10px] ${mutedText(isDarkMode)}`}>متوسط الفاتورة</p><p className="mt-1 text-xl font-black">{formatCurrency(data.summary.average_ticket)}</p><ComparisonLine comparison={data.comparison.average_ticket} isDarkMode={isDarkMode} formatter={formatCurrency} /></div>
                </div>
                <div className={`mt-5 flex flex-wrap gap-x-5 gap-y-1 border-t pt-4 text-[10px] ${isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'} ${mutedText(isDarkMode)}`}><span>قبل الخصم: <strong className="text-inherit">{formatCurrency(data.summary.gross_sales)}</strong></span><span>الخصم: <strong className="text-inherit">{formatCurrency(data.summary.discount_amount)}</strong></span></div>
              </div>
            </div>
          </section>

          <InsightStrip insights={editorialInsights} isDarkMode={isDarkMode} />

          <div className="grid gap-6 xl:grid-cols-[0.8fr_1.55fr]">
            <section className={`${panelClass(isDarkMode)} p-6`}>
              <h3 className="text-lg font-black">ما الذي تغير؟</h3>
              <p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>عدد الفواتير ومتوسط قيمتها</p>
              <div className={`mt-5 grid grid-cols-2 divide-x divide-x-reverse ${isDarkMode ? 'divide-white/[0.07]' : 'divide-black/[0.07]'}`}>
                <div className="pl-4"><p className={`text-[10px] ${mutedText(isDarkMode)}`}>عدد الفواتير</p><p className="mt-1 text-xl font-black">{formatNumber(data.summary.paid_invoice_count)}</p><div className="mt-2"><ComparisonLine comparison={data.drivers.invoice_count} isDarkMode={isDarkMode} /></div></div>
                <div className="pr-4"><p className={`text-[10px] ${mutedText(isDarkMode)}`}>متوسط الفاتورة</p><p className="mt-1 text-xl font-black">{formatCurrency(data.summary.average_ticket)}</p><div className="mt-2"><ComparisonLine comparison={data.drivers.average_ticket} isDarkMode={isDarkMode} formatter={formatCurrency} /></div></div>
              </div>
              {driverInsight && <p className={`mt-5 border-r-2 border-[#E6D690]/50 pr-3 text-xs font-bold leading-6 ${isDarkMode ? 'text-white/70' : 'text-black/65'}`}>{driverInsight.text}</p>}
            </section>

            <section className={`${panelClass(isDarkMode)} p-6`}>
              <div className="mb-4"><h3 className="text-lg font-black">مسار صافي المبيعات</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>حسب تاريخ السداد بتوقيت القاهرة</p></div>
              {data.trend.length ? <div className="h-[290px]" dir="ltr"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.trend} margin={{ top: 15, right: 8, left: 0, bottom: 0 }}><defs><linearGradient id="salesTrend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E53935" stopOpacity={0.34} /><stop offset="100%" stopColor="#E53935" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 7" vertical={false} stroke={isDarkMode ? '#ffffff10' : '#00000010'} /><XAxis dataKey="date" tickFormatter={formatShortDate} axisLine={false} tickLine={false} tick={{ fill: isDarkMode ? '#ffffff55' : '#00000055', fontSize: 10 }} minTickGap={28} /><YAxis hide /><Tooltip formatter={(value, name) => [name === 'paid_invoice_count' ? formatNumber(Number(value)) : formatCurrency(Number(value)), { net_sales: 'صافي المبيعات', gross_sales: 'قبل الخصم', discount_amount: 'الخصومات', paid_invoice_count: 'الفواتير', average_ticket: 'متوسط الفاتورة' }[String(name)] || String(name)]} labelFormatter={(label) => `تاريخ القاهرة: ${formatShortDate(String(label))}`} contentStyle={{ background: isDarkMode ? '#181818' : '#fff', border: 'none', borderRadius: 14, direction: 'rtl' }} /><Area type="monotone" dataKey="net_sales" stroke="#E53935" strokeWidth={2.6} fill="url(#salesTrend)" /><Area type="monotone" dataKey="gross_sales" stroke="transparent" fill="transparent" activeDot={false} /><Area type="monotone" dataKey="discount_amount" stroke="transparent" fill="transparent" activeDot={false} /><Area type="monotone" dataKey="paid_invoice_count" stroke="transparent" fill="transparent" activeDot={false} /><Area type="monotone" dataKey="average_ticket" stroke="transparent" fill="transparent" activeDot={false} />{trendPeak && <ReferenceDot x={trendPeak.date} y={trendPeak.net_sales} r={4} fill="#E6D690" stroke="none" label={{ value: 'أعلى يوم', position: 'top', fill: isDarkMode ? '#ffffff88' : '#00000088', fontSize: 9 }} />}</AreaChart></ResponsiveContainer></div> : <EmptyBlock isDarkMode={isDarkMode} />}
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.85fr_1.4fr]">
            <section className={`${panelClass(isDarkMode)} p-6`}>
              <div className="mb-5"><h3 className="text-lg font-black">من الإجمالي إلى الصافي</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>أثر الخصم على قيمة الفواتير</p></div>
              <MetricLine label="إجمالي المبيعات" value={formatCurrency(data.summary.gross_sales)} isDarkMode={isDarkMode} />
              <MetricLine label={`الخصومات · ${formatNumber(data.discounts.discount_rate)}%`} value={`− ${formatCurrency(data.discounts.total_discount_amount)}`} isDarkMode={isDarkMode} />
              <MetricLine label="صافي المبيعات" value={formatCurrency(data.summary.net_sales)} isDarkMode={isDarkMode} />
              <div className="mt-3"><ComparisonLine comparison={data.comparison.discount_amount} isDarkMode={isDarkMode} formatter={formatCurrency} /></div>
              {data.promo.paid_redemption_count > 0 && <button type="button" onClick={() => data.promo.top_codes[0] && setPromoCode(data.promo.top_codes[0].code)} className={`mt-4 w-full border-t pt-4 text-right text-[10px] leading-5 ${isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'} ${mutedText(isDarkMode)}`}>خصم الأكواد {formatCurrency(data.promo.promo_discount_total)} عبر {formatNumber(data.promo.promo_invoice_share_percent)}% من الفواتير{data.promo.top_codes[0] ? ` · الأكثر استخداماً ${data.promo.top_codes[0].code}` : ''}</button>}
            </section>

            <section className={`${panelClass(isDarkMode)} p-6`}>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-lg font-black">مساهمة الفروع</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>مرتبة حسب صافي المبيعات</p></div><p className={`text-[10px] ${mutedText(isDarkMode)}`}>أعلى 3 فروع: {formatNumber(data.concentration.top_three_branches_share)}%</p></div>
              {data.branches.length ? <div>{data.branches.map((branch, index) => <button type="button" key={branch.branch_id} onClick={() => onBranchChange(String(branch.branch_id))} className={`block w-full border-b py-3 text-right transition last:border-0 ${isDarkMode ? 'border-white/[0.06] hover:bg-white/[0.02]' : 'border-black/[0.06] hover:bg-black/[0.02]'}`}><div className="flex items-center justify-between gap-4"><div className="min-w-0 flex-1"><p className="truncate text-xs font-black"><span className="ml-2 text-[#E53935]">{String(index + 1).padStart(2, '0')}</span>{branch.branch_name}</p><div className={`mt-1 h-1 overflow-hidden rounded-full ${isDarkMode ? 'bg-white/[0.06]' : 'bg-black/[0.06]'}`}><span className="block h-full rounded-full bg-[#E53935]" style={{ width: `${branch.contribution_percent}%` }} /></div></div><div className="shrink-0 text-left"><p className="text-xs font-black">{formatCurrency(branch.net_sales)}</p><p className={`mt-1 text-[9px] ${mutedText(isDarkMode)}`}>{formatNumber(branch.contribution_percent)}% · {comparisonText(branch.comparison)}</p></div></div></button>)}</div> : <EmptyBlock isDarkMode={isDarkMode} />}
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className={`${panelClass(isDarkMode)} p-6`}>
              <div className="mb-5 flex items-start justify-between gap-4"><div><h3 className="text-lg font-black">كيف تم التحصيل؟</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>تحصيلات الفواتير فقط</p></div><div className="text-left"><div className="flex items-center gap-1.5 text-[10px] font-bold"><Split size={13} /> دفع مقسم</div><p className="mt-1 text-sm font-black">{formatNumber(data.payments.split_payment_invoice_count)} · {formatNumber(data.payments.split_payment_rate)}%</p></div></div>
              <div className="space-y-4">{data.payments.methods.map((method) => <button type="button" key={method.method} onClick={() => setPaymentMethod(method.method)} className="w-full text-right"><div className="mb-1.5 flex justify-between text-xs"><span className="flex items-center gap-2 font-black"><Banknote size={13} className="text-[#E6D690]" />{paymentLabel(method.method)}</span><span>{formatCurrency(method.amount)} · {formatNumber(method.share_percent)}%</span></div><div className={`h-1.5 overflow-hidden rounded-full ${isDarkMode ? 'bg-white/[0.06]' : 'bg-black/[0.06]'}`}><span className="block h-full rounded-full bg-[#E6D690]" style={{ width: `${method.share_percent}%` }} /></div></button>)}</div>
              {Math.abs(data.payments.reconciliation_difference) >= 0.01 && <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 text-[10px] leading-5 text-amber-500">فرق التحصيل المسجل: {formatCurrency(Math.abs(data.payments.reconciliation_difference))}</p>}
            </section>

            <section className={`${panelClass(isDarkMode)} p-6`}>
              <div className="mb-5"><h3 className="text-lg font-black">الخدمات والمنتجات</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>مساهمة إجمالية قبل خصم الفاتورة</p></div>
              <div className={`flex h-2.5 overflow-hidden rounded-full ${isDarkMode ? 'bg-white/[0.05]' : 'bg-black/[0.05]'}`}><button type="button" aria-label="تصفية الفواتير التي تحتوي خدمات" onClick={() => setItemType('SERVICE_ITEM')} className="h-full bg-[#E53935]" style={{ width: `${data.mix.service_share_percent}%` }} /><button type="button" aria-label="تصفية الفواتير التي تحتوي منتجات" onClick={() => setItemType('PRODUCT_ITEM')} className="h-full bg-[#E6D690]" style={{ width: `${data.mix.product_share_percent}%` }} /></div>
              <div className={`mt-5 grid grid-cols-2 divide-x divide-x-reverse ${isDarkMode ? 'divide-white/[0.07]' : 'divide-black/[0.07]'}`}><button type="button" onClick={() => setItemType('SERVICE_ITEM')} className="pl-4 text-right"><p className="text-[10px] text-[#E53935]">الخدمات · {formatNumber(data.mix.service_share_percent)}%</p><p className="mt-1 text-lg font-black">{formatCurrency(data.mix.service_gross_value)}</p><p className={`mt-1 text-[10px] ${mutedText(isDarkMode)}`}>{formatNumber(data.mix.service_units)} وحدة</p></button><button type="button" onClick={() => setItemType('PRODUCT_ITEM')} className="pr-4 text-right"><p className="text-[10px] text-[#B58A24]">المنتجات · {formatNumber(data.mix.product_share_percent)}%</p><p className="mt-1 text-lg font-black">{formatCurrency(data.mix.product_gross_value)}</p><p className={`mt-1 text-[10px] ${mutedText(isDarkMode)}`}>{formatNumber(data.mix.product_units)} وحدة</p></button></div>
              {(data.top_service || data.top_product) && <p className={`mt-5 border-t pt-4 text-[10px] leading-5 ${isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'} ${mutedText(isDarkMode)}`}>{data.top_service ? `الخدمة الأعلى: ${data.top_service.name}` : ''}{data.top_service && data.top_product ? ' · ' : ''}{data.top_product ? `المنتج الأعلى: ${data.top_product.name}` : ''}</p>}
            </section>
          </div>

          <section className={`${panelClass(isDarkMode)} p-5 sm:p-6`}>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-lg font-black">الفواتير المدفوعة</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>تفاصيل قابلة للبحث مع قيم إجمالية وصافية وشرائح التحصيل</p></div><div className="flex flex-wrap gap-2"><label className={`flex h-10 items-center gap-2 rounded-xl border px-3 ${isDarkMode ? 'border-white/10 bg-white/[0.03]' : 'border-black/10 bg-black/[0.02]'}`}><Search size={15} className={mutedText(isDarkMode)} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="رقم، عميل، فرع..." className="w-36 bg-transparent text-xs font-bold outline-none" /></label><select aria-label="ترتيب" value={sortBy} onChange={(event) => setSortBy(event.target.value)} className={selectClass(isDarkMode)}><option value="invoice_date">الأحدث</option><option value="net_sales">صافي المبيعات</option><option value="gross_sales">الإجمالي</option><option value="discount_amount">الخصم</option><option value="invoice_number">رقم الفاتورة</option></select></div></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-right text-xs"><thead className={mutedText(isDarkMode)}><tr className={`border-b ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}><th className="px-3 py-4">الفاتورة</th><th className="px-3 py-4">التاريخ</th><th className="px-3 py-4">الفرع</th><th className="px-3 py-4">العميل</th><th className="px-3 py-4">الكاشير</th><th className="px-3 py-4">الإجمالي</th><th className="px-3 py-4">الخصم</th><th className="px-3 py-4">الصافي</th><th className="px-3 py-4">التحصيل</th><th className="px-3 py-4">الكود</th><th className="px-3 py-4">الوحدات</th><th className="px-3 py-4"></th></tr></thead><tbody>{data.table.items.map((invoice) => <tr key={invoice.invoice_id} onClick={() => setSelectedInvoice(invoice.invoice_id)} className={`cursor-pointer border-b transition last:border-b-0 ${isDarkMode ? 'border-white/[0.05] hover:bg-white/[0.03]' : 'border-black/[0.05] hover:bg-black/[0.02]'}`}><td className="px-3 py-4 font-black">#{invoice.invoice_number ?? '—'}</td><td className="px-3 py-4">{invoice.invoice_date ? formatShortDate(invoice.invoice_date) : '—'}</td><td className="px-3 py-4">{invoice.branch_name}</td><td className="px-3 py-4">{invoice.customer_name}</td><td className="px-3 py-4">{invoice.cashier_name}</td><td className="px-3 py-4">{formatCurrency(invoice.gross_sales)}</td><td className="px-3 py-4 text-amber-500">{formatCurrency(invoice.discount_amount)}</td><td className="px-3 py-4 font-black">{formatCurrency(invoice.net_sales)}</td><td className="px-3 py-4">{invoice.payment_slices.map((slice) => `${paymentLabel(slice.method)} ${formatCurrency(slice.amount)}`).join(' + ') || '—'}</td><td className="px-3 py-4">{invoice.promo_code || '—'}</td><td className="px-3 py-4">خ {formatNumber(invoice.service_units)} · م {formatNumber(invoice.product_units)}</td><td className="px-3 py-4"><Eye size={14} /></td></tr>)}</tbody></table>{!data.table.items.length && <EmptyBlock isDarkMode={isDarkMode} />}</div>
            <PaginationControls pagination={data.table.pagination} isDarkMode={isDarkMode} onPage={setPage} />
          </section>

          <p className={`px-2 text-[11px] leading-6 ${mutedText(isDarkMode)}`}>تاريخ التقرير هو تاريخ الفاتورة المدفوعة بتوقيت القاهرة. مزيج الخدمات والمنتجات إجمالي قبل خصم مستوى الفاتورة، ولا يمثل صافي إيراد البنود أو الربح.</p>
        </>
      )}

      {selectedInvoice && <ReportDrawer isDarkMode={isDarkMode} title={drilldown ? `فاتورة #${drilldown.invoice.invoice_number ?? '—'}` : 'تفاصيل الفاتورة'} subtitle={drilldown ? `${drilldown.invoice.branch_name} · ${drilldown.invoice.invoice_date ? formatShortDate(drilldown.invoice.invoice_date) : '—'}` : undefined} onClose={() => setSelectedInvoice(null)}>
        {drillLoading || !drilldown ? <ReportLoading isDarkMode={isDarkMode} /> : <div className="space-y-6">
          <section className={`${panelClass(isDarkMode)} p-5`}><MetricLine label="تاريخ السداد" value={drilldown.invoice.invoice_date ? formatShortDate(drilldown.invoice.invoice_date) : '—'} isDarkMode={isDarkMode} /><MetricLine label="العميل" value={drilldown.invoice.customer_name} isDarkMode={isDarkMode} /><MetricLine label="هاتف العميل" value={drilldown.invoice.customer_phone || '—'} isDarkMode={isDarkMode} /><MetricLine label="الكاشير" value={drilldown.invoice.cashier_name} isDarkMode={isDarkMode} /><MetricLine label="رقم يوم العمل" value={drilldown.invoice.business_day_id || '—'} isDarkMode={isDarkMode} /><MetricLine label="إجمالي قبل الخصم" value={formatCurrency(drilldown.invoice.gross_sales)} isDarkMode={isDarkMode} /><MetricLine label="الخصم" value={formatCurrency(drilldown.invoice.discount_amount)} isDarkMode={isDarkMode} /><MetricLine label="الصافي" value={formatCurrency(drilldown.invoice.net_sales)} isDarkMode={isDarkMode} /></section>
          <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-3 font-black">شرائح التحصيل</h3>{drilldown.payments.slices.map((slice) => <MetricLine key={slice.method} label={paymentLabel(slice.method)} value={formatCurrency(slice.amount)} isDarkMode={isDarkMode} />)}{!drilldown.payments.slices.length && <EmptyBlock isDarkMode={isDarkMode} />}<p className={`mt-3 text-[10px] ${mutedText(isDarkMode)}`}>{drilldown.payments.basis === 'invoice_payments' ? 'شرائح الدفع المسجلة على الفاتورة' : 'قيمة صافي الفاتورة وفق طريقة الدفع القديمة'}</p></section>
          {drilldown.promo && <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-3 font-black">كود الخصم</h3><MetricLine label="الكود" value={drilldown.promo.code} isDarkMode={isDarkMode} /><MetricLine label="خصم الكود" value={formatCurrency(drilldown.promo.discount_amount)} isDarkMode={isDarkMode} /><MetricLine label="المبلغ المؤهل" value={formatCurrency(drilldown.promo.eligible_subtotal)} isDarkMode={isDarkMode} /></section>}
          <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-3 font-black">بنود الفاتورة</h3>{drilldown.items.map((item) => <div key={item.id} className={`border-b py-3 last:border-0 ${isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'}`}><div className="flex justify-between gap-3 text-xs"><div><p className="font-black">{item.name}</p><p className={`mt-1 text-[10px] ${mutedText(isDarkMode)}`}>{item.item_type === 'SERVICE_ITEM' ? 'خدمة' : 'منتج'} · {formatNumber(item.quantity)} × {formatCurrency(item.unit_price)}{item.barber_name ? ` · ${item.barber_name}` : ''}</p></div><p className="font-black">{formatCurrency(item.gross_value)}</p></div></div>)}</section>
        </div>}
      </ReportDrawer>}
    </div>
  );
};

export default SalesReport;
