import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Building2, CircleDollarSign, Eye, PackageSearch, ReceiptText, UsersRound, WalletCards } from 'lucide-react';
import adminApi from '../../api/client';
import {
  ActiveFilters,
  AttentionList,
  EmptyBlock,
  InsightStrip,
  MetricLine,
  mutedText,
  panelClass,
  ReportDrawer,
  ReportError,
  ReportFilterBar,
  ReportLoading,
} from './ReportPrimitives';
import { comparisonText, errorMessage, formatCompactCurrency, formatCurrency, formatNumber, formatShortDate, type DatePreset } from './reportUtils';
import type { BranchPerformanceRow, BranchReportData, MetricComparison, NamedOption, ReportDateRange } from './types';

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

type RankingMetric = 'net_sales' | 'paid_invoice_count' | 'average_ticket' | 'operating_expenses' | 'expense_ratio' | 'recorded_commission_cost' | 'commission_ratio' | 'operating_contribution' | 'contribution_ratio' | 'growth';

const rankingOptions: Array<{ value: RankingMetric; label: string }> = [
  { value: 'net_sales', label: 'صافي المبيعات' },
  { value: 'paid_invoice_count', label: 'الفواتير المدفوعة' },
  { value: 'average_ticket', label: 'متوسط الفاتورة' },
  { value: 'operating_expenses', label: 'المصروفات التشغيلية' },
  { value: 'expense_ratio', label: 'نسبة المصروفات' },
  { value: 'recorded_commission_cost', label: 'تكلفة العمولات' },
  { value: 'commission_ratio', label: 'نسبة العمولات' },
  { value: 'operating_contribution', label: 'المساهمة التشغيلية' },
  { value: 'contribution_ratio', label: 'نسبة المساهمة' },
  { value: 'growth', label: 'نمو صافي المبيعات' },
];

const ratioMetrics = new Set<RankingMetric>(['expense_ratio', 'commission_ratio', 'contribution_ratio', 'growth']);
const eligibilityKey: Partial<Record<RankingMetric, keyof BranchPerformanceRow['ranking_eligible']>> = {
  average_ticket: 'average_ticket', expense_ratio: 'expense_ratio', commission_ratio: 'commission_ratio', contribution_ratio: 'contribution_ratio', growth: 'growth',
};

const downloadBlob = (data: Blob, filename: string) => {
  const href = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
};

const metricValue = (row: BranchPerformanceRow, metric: RankingMetric) => metric === 'growth'
  ? row.comparison.net_sales.percent_change
  : row[metric as keyof BranchPerformanceRow] as number | null;

const formatMetric = (metric: RankingMetric, value: number | null) => {
  if (value === null) return 'غير متاح';
  if (ratioMetrics.has(metric)) return `${value > 0 && metric === 'growth' ? '+' : ''}${formatNumber(value)}%`;
  if (metric === 'paid_invoice_count') return `${formatNumber(value)} فاتورة`;
  return formatCurrency(value);
};

const ComparisonBadge: React.FC<{ value: MetricComparison; dark: boolean }> = ({ value, dark }) => (
  <span className={`text-[10px] font-bold ${dark ? 'text-white/45' : 'text-black/45'}`}>{comparisonText(value)}</span>
);

const CompactBar: React.FC<{ percent: number }> = ({ percent }) => (
  <div className="h-1.5 overflow-hidden rounded-full bg-current/10"><div className="h-full rounded-full bg-[#E53935]" style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }} /></div>
);

const BranchesReport: React.FC<Props> = ({ isDarkMode, range, preset, branchId, branches, onRangeChange, onPresetChange, onBranchChange }) => {
  const [data, setData] = useState<BranchReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [rankingMetric, setRankingMetric] = useState<RankingMetric>('net_sales');
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [drilldown, setDrilldown] = useState<BranchPerformanceRow | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const params = useMemo(() => ({ date_from: range.dateFrom, date_to: range.dateTo, branch_id: branchId === 'All' ? undefined : branchId }), [range, branchId]);
  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get<BranchReportData>('/reports/branches', { params });
      setData(response.data);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { void fetchReport(); }, [fetchReport]);
  useEffect(() => { setSelectedBranchId(null); setDrilldown(null); }, [range, branchId]);
  useEffect(() => {
    if (!selectedBranchId) return;
    const load = async () => {
      setDrillLoading(true);
      try {
        const response = await adminApi.get<BranchPerformanceRow>(`/reports/branches/${selectedBranchId}`, { params });
        setDrilldown(response.data);
      } catch (requestError) {
        setError(errorMessage(requestError));
        setSelectedBranchId(null);
      } finally {
        setDrillLoading(false);
      }
    };
    void load();
  }, [selectedBranchId, params]);

  const exportReport = async () => {
    setExporting(true);
    try {
      const response = await adminApi.get('/reports/branches/export/xlsx', { params, responseType: 'blob' });
      downloadBlob(response.data, `branch-performance-${range.dateFrom}-${range.dateTo}.xlsx`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setExporting(false);
    }
  };

  const ranked = useMemo(() => {
    if (!data) return [];
    const eligible = data.branches.filter((row) => {
      const key = eligibilityKey[rankingMetric];
      return !key || row.ranking_eligible[key];
    });
    return [...eligible].sort((a, b) => {
      const aValue = metricValue(a, rankingMetric) ?? Number.NEGATIVE_INFINITY;
      const bValue = metricValue(b, rankingMetric) ?? Number.NEGATIVE_INFINITY;
      return bValue - aValue || a.branch_name.localeCompare(b.branch_name, 'ar');
    });
  }, [data, rankingMetric]);

  const rankingMax = Math.max(...ranked.map((row) => Math.abs(metricValue(row, rankingMetric) || 0)), 1);
  const contextBranch = data?.branches.find((row) => row.branch_id === Number(branchId)) || data?.branches[0] || null;
  const activeFilters = branchId !== 'All' ? [{ key: 'branch', label: `الفرع: ${contextBranch?.branch_name || branchId}`, onRemove: () => onBranchChange('All') }] : [];

  return (
    <div className="space-y-6">
      <ReportFilterBar isDarkMode={isDarkMode} range={range} preset={preset} branchId={branchId} branches={branches} onRangeChange={onRangeChange} onPresetChange={onPresetChange} onBranchChange={onBranchChange} onExport={exportReport} exporting={exporting} />
      <ActiveFilters filters={activeFilters} isDarkMode={isDarkMode} />
      {error && data && <div className="rounded-xl border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-xs font-bold text-red-500">{error}</div>}
      {loading && !data ? <ReportLoading isDarkMode={isDarkMode} /> : error && !data ? <ReportError isDarkMode={isDarkMode} message={error} onRetry={fetchReport} /> : data && (
        <>
          <section className={`${panelClass(isDarkMode)} overflow-hidden p-6 sm:p-8`}>
            <div className="grid gap-8 xl:grid-cols-[1.15fr_1.65fr] xl:items-end">
              <div>
                <div className="mb-5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-[#E53935]"><Building2 size={15} /> مقارنة الفروع</div>
                <p className={`mb-2 text-xs font-bold ${mutedText(isDarkMode)}`}>صافي المبيعات ضمن النطاق المصرح</p>
                <h2 className="text-4xl font-black tracking-tight sm:text-6xl">{formatCompactCurrency(data.summary.net_sales)}</h2>
                <p className={`mt-3 text-[11px] ${mutedText(isDarkMode)}`}>{data.summary.branch_count} فرع · {formatNumber(data.summary.paid_invoice_count)} فاتورة مدفوعة</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ['المصروفات التشغيلية', data.summary.operating_expenses],
                  ['تكلفة العمولات المسجلة', data.summary.recorded_commission_cost],
                  ['المساهمة التشغيلية', data.summary.operating_contribution],
                ].map(([label, value]) => <div key={String(label)} className={`rounded-2xl p-4 ${isDarkMode ? 'bg-white/[0.025]' : 'bg-black/[0.025]'}`}><p className={`text-[10px] leading-5 ${mutedText(isDarkMode)}`}>{label}</p><p className="mt-2 text-lg font-black">{formatCurrency(Number(value))}</p></div>)}
              </div>
            </div>
          </section>

          <InsightStrip insights={data.insights} isDarkMode={isDarkMode} />

          <section className={`${panelClass(isDarkMode)} p-5 sm:p-7`}>
            <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E53935]">المقارنة التنفيذية</p><h3 className="mt-2 text-xl font-black">ترتيب وصفي حسب المقياس المختار</h3></div>
              <select aria-label="مقياس مقارنة الفروع" value={rankingMetric} onChange={(event) => setRankingMetric(event.target.value as RankingMetric)} className={`h-10 rounded-xl border px-3 text-xs font-bold outline-none ${isDarkMode ? 'border-white/10 bg-white/[0.04] text-white' : 'border-black/10 bg-[#FAFAFA]'}`}>{rankingOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            </div>
            <div className="space-y-3">
              {ranked.map((row, index) => {
                const value = metricValue(row, rankingMetric);
                return <div key={row.branch_id} className={`grid gap-3 rounded-2xl border p-4 md:grid-cols-[2rem_minmax(9rem,1fr)_minmax(12rem,2fr)_auto] md:items-center ${isDarkMode ? 'border-white/[0.07]' : 'border-black/[0.07]'}`}>
                  <span className={`text-xs font-black ${mutedText(isDarkMode)}`}>{index + 1}</span>
                  <button type="button" onClick={() => onBranchChange(String(row.branch_id))} className="text-right"><span className="text-sm font-black">{row.branch_name}</span>{!row.is_active && <span className="mr-2 rounded-full bg-white/5 px-2 py-1 text-[9px] text-amber-500">غير نشط حاليًا</span>}<p className={`mt-1 text-[10px] ${mutedText(isDarkMode)}`}>{row.low_base ? 'عينة محدودة · القيم معروضة دون ترتيب النسب' : `${formatNumber(row.scope_share_percent)}% من صافي النطاق`}</p></button>
                  <div><div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm font-black">{formatMetric(rankingMetric, value)}</span>{rankingMetric === 'net_sales' && <ComparisonBadge value={row.comparison.net_sales} dark={isDarkMode} />}</div><CompactBar percent={(Math.abs(value || 0) / rankingMax) * 100} /></div>
                  <button type="button" aria-label={`تفاصيل ${row.branch_name}`} onClick={() => setSelectedBranchId(row.branch_id)} className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}><Eye size={14} /> التفاصيل</button>
                </div>;
              })}
              {!ranked.length && <EmptyBlock isDarkMode={isDarkMode} title="لا توجد فروع مؤهلة لهذا الترتيب في الفترة" />}
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <div className={`${panelClass(isDarkMode)} p-5 sm:p-7`}><div className="mb-5 flex items-center gap-2"><BarChart3 size={17} className="text-[#E53935]" /><h3 className="font-black">محركات التغير</h3></div><div className="space-y-4">{data.branches.slice(0, 6).map((row) => <div key={row.branch_id} className={`border-b pb-4 last:border-0 ${isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'}`}><div className="mb-2 flex items-center justify-between gap-3"><span className="text-xs font-black">{row.branch_name}</span><ComparisonBadge value={row.comparison.net_sales} dark={isDarkMode} /></div><p className={`text-[11px] leading-6 ${mutedText(isDarkMode)}`}>{row.growth_driver}</p><p className={`mt-1 text-[10px] ${mutedText(isDarkMode)}`}>الفواتير: {comparisonText(row.comparison.paid_invoice_count)} · المتوسط: {comparisonText(row.comparison.average_ticket)}</p></div>)}</div></div>
            <div className={`${panelClass(isDarkMode)} p-5 sm:p-7`}><div className="mb-5 flex items-center gap-2"><CircleDollarSign size={17} className="text-[#E53935]" /><h3 className="font-black">التكلفة والمساهمة</h3></div>{contextBranch ? <div className="space-y-1"><p className={`mb-3 text-[10px] ${mutedText(isDarkMode)}`}>{contextBranch.branch_name}</p><MetricLine label="المصروفات التشغيلية" value={`${formatCurrency(contextBranch.operating_expenses)} · ${contextBranch.expense_ratio === null ? 'غير متاح' : `${formatNumber(contextBranch.expense_ratio)}%`}`} isDarkMode={isDarkMode} /><MetricLine label="تكلفة العمولات المسجلة" value={`${formatCurrency(contextBranch.recorded_commission_cost)} · ${contextBranch.commission_ratio === null ? 'غير متاح' : `${formatNumber(contextBranch.commission_ratio)}%`}`} isDarkMode={isDarkMode} /><MetricLine label="المساهمة التشغيلية" value={`${formatCurrency(contextBranch.operating_contribution)} · ${contextBranch.contribution_ratio === null ? 'غير متاح' : `${formatNumber(contextBranch.contribution_ratio)}%`}`} isDarkMode={isDarkMode} /><p className={`pt-3 text-[10px] leading-5 ${mutedText(isDarkMode)}`}>المساهمة التشغيلية مؤشر بعد المصروفات والعمولات المسجلة، ولا تمثل الربح.</p></div> : <EmptyBlock isDarkMode={isDarkMode} />}</div>
          </section>

          {contextBranch && <>
            <section className={`${panelClass(isDarkMode)} p-5 sm:p-7`}>
              <div className="mb-6"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E53935]">تركيب المبيعات</p><h3 className="mt-2 text-xl font-black">ما الذي بيع في {contextBranch.branch_name}؟</h3><p className={`mt-2 text-[11px] ${mutedText(isDarkMode)}`}>قيمة إجمالية للبنود قبل خصم مستوى الفاتورة.</p></div>
              <div className="grid gap-5 lg:grid-cols-3"><div className={`rounded-2xl p-5 ${isDarkMode ? 'bg-white/[0.025]' : 'bg-black/[0.025]'}`}><MetricLine label="الخدمات" value={`${formatCurrency(contextBranch.mix.service_gross_value)} · ${formatNumber(contextBranch.mix.service_share_percent)}%`} isDarkMode={isDarkMode} /><MetricLine label="وحدات الخدمات" value={formatNumber(contextBranch.mix.service_units)} isDarkMode={isDarkMode} /><MetricLine label="المنتجات" value={`${formatCurrency(contextBranch.mix.product_gross_value)} · ${formatNumber(contextBranch.mix.product_share_percent)}%`} isDarkMode={isDarkMode} /><MetricLine label="وحدات المنتجات" value={formatNumber(contextBranch.mix.product_units)} isDarkMode={isDarkMode} /></div><RankList title="الخدمات الأعلى" rows={contextBranch.mix.top_services} dark={isDarkMode} /><RankList title="المنتجات الأعلى" rows={contextBranch.mix.top_products} dark={isDarkMode} /></div>
              <div className={`mt-5 grid gap-3 rounded-2xl p-4 text-xs sm:grid-cols-3 ${isDarkMode ? 'bg-white/[0.02]' : 'bg-black/[0.02]'}`}><MetricLine label="حصة الخدمة الأعلى" value={`${formatNumber(contextBranch.mix.top_service_share)}%`} isDarkMode={isDarkMode} /><MetricLine label="حصة أعلى 3 خدمات" value={`${formatNumber(contextBranch.mix.top_three_service_share)}%`} isDarkMode={isDarkMode} /><MetricLine label="حصة المصفف الأعلى" value={`${formatNumber(contextBranch.mix.top_barber_share)}%`} isDarkMode={isDarkMode} /></div>
              {!!contextBranch.mix.categories.length && <div className="mt-4 flex flex-wrap gap-2">{contextBranch.mix.categories.slice(0, 6).map((category) => <span key={`${category.item_type}-${category.name}`} className={`rounded-full border px-3 py-1.5 text-[10px] font-bold ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}>{category.item_type === 'SERVICE' ? 'خدمات' : 'منتجات'} · {category.name} · {formatNumber(category.share_percent)}%</span>)}</div>}
            </section>

            <section className="grid gap-6 xl:grid-cols-3">
              <ContextPanel icon={<WalletCards size={17} />} title="التحصيل" dark={isDarkMode}><MetricLine label="نقدي" value={formatCurrency(contextBranch.payments.methods.CASH)} isDarkMode={isDarkMode} /><MetricLine label="فيزا" value={formatCurrency(contextBranch.payments.methods.VISA)} isDarkMode={isDarkMode} /><MetricLine label="إنستا باي" value={formatCurrency(contextBranch.payments.methods.INSTAPAY)} isDarkMode={isDarkMode} /><MetricLine label="نسبة الدفع المقسّم" value={`${formatNumber(contextBranch.payments.split_payment_rate)}%`} isDarkMode={isDarkMode} /></ContextPanel>
              <ContextPanel icon={<UsersRound size={17} />} title="العميل والقوى العاملة" dark={isDarkMode}><MetricLine label="فواتير بعميل معروف" value={`${formatNumber(contextBranch.customers.identified_invoice_share)}%`} isDarkMode={isDarkMode} /><MetricLine label="عملاء معروفون مميزون" value={formatNumber(contextBranch.identified_customers)} isDarkMode={isDarkMode} /><MetricLine label="عملاء أول ظهور مسجل" value={formatNumber(contextBranch.customers.first_known)} isDarkMode={isDarkMode} /><MetricLine label="ساعات حضور مكتملة" value={formatNumber(contextBranch.attendance.recorded_hours)} isDarkMode={isDarkMode} /></ContextPanel>
              <ContextPanel icon={<ReceiptText size={17} />} title="المواعيد" dark={isDarkMode}><MetricLine label="مجدولة" value={formatNumber(contextBranch.appointments.scheduled)} isDarkMode={isDarkMode} /><MetricLine label="مكتملة" value={formatNumber(contextBranch.appointments.completed)} isDarkMode={isDarkMode} /><MetricLine label="ملغاة" value={formatNumber(contextBranch.appointments.cancelled)} isDarkMode={isDarkMode} /><MetricLine label="تحصيلات عربون" value={formatCurrency(contextBranch.appointments.deposit_collections)} isDarkMode={isDarkMode} /></ContextPanel>
            </section>

            <section className="grid gap-6 xl:grid-cols-2">
              <ContextPanel icon={<CircleDollarSign size={17} />} title="رقابة الخزنة" dark={isDarkMode}><MetricLine label="أيام عمل مغلقة" value={formatNumber(contextBranch.treasury.closed_days)} isDarkMode={isDarkMode} /><MetricLine label="أيام بفارق مادي" value={formatNumber(contextBranch.treasury.material_variance_days)} isDarkMode={isDarkMode} /><MetricLine label="تكرار الفارق" value={contextBranch.treasury.variance_ranking_eligible ? `${formatNumber(contextBranch.treasury.variance_frequency)}%` : 'عينة غير كافية للترتيب'} isDarkMode={isDarkMode} /><MetricLine label="أيام سابقة مفتوحة" value={formatNumber(contextBranch.treasury.open_overdue_days)} isDarkMode={isDarkMode} /><p className={`pt-3 text-[10px] ${mutedText(isDarkMode)}`}>سياق رقابي منفصل ولا يدخل في المساهمة التشغيلية.</p></ContextPanel>
              <ContextPanel icon={<PackageSearch size={17} />} title="سياق المخزون الحالي" dark={isDarkMode}><MetricLine label="وحدات حالية" value={formatNumber(contextBranch.inventory.stock_units)} isDarkMode={isDarkMode} /><MetricLine label="منتجات منخفضة / نافدة" value={`${formatNumber(contextBranch.inventory.low_stock_products)} / ${formatNumber(contextBranch.inventory.out_of_stock_products)}`} isDarkMode={isDarkMode} /><MetricLine label="منتجات منخفضة الحركة" value={formatNumber(contextBranch.inventory.slow_moving_products)} isDarkMode={isDarkMode} /><MetricLine label="تحويلات واردة / صادرة" value={`${formatNumber(contextBranch.inventory.inbound_transfers)} / ${formatNumber(contextBranch.inventory.outbound_transfers)}`} isDarkMode={isDarkMode} /><MetricLine label="طلبات توريد / مرتجعات معلقة" value={`${formatNumber(contextBranch.inventory.pending_supply_requests)} / ${formatNumber(contextBranch.inventory.pending_returns)}`} isDarkMode={isDarkMode} /></ContextPanel>
            </section>
          </>}

          <AttentionList items={data.attention} isDarkMode={isDarkMode} onEntity={(id) => setSelectedBranchId(id)} />

          <section className={`${panelClass(isDarkMode)} overflow-hidden p-5 sm:p-7`}>
            <div className="mb-5"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E53935]">التفصيل</p><h3 className="mt-2 text-xl font-black">جدول مقارنة الفروع</h3></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-right text-xs"><thead className={mutedText(isDarkMode)}><tr className={`border-b ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}><th className="px-3 py-4">الفرع</th><th className="px-3 py-4">صافي المبيعات</th><th className="px-3 py-4">النمو</th><th className="px-3 py-4">الفواتير</th><th className="px-3 py-4">متوسط الفاتورة</th><th className="px-3 py-4">المصروفات</th><th className="px-3 py-4">نسبتها</th><th className="px-3 py-4">العمولات</th><th className="px-3 py-4">نسبتها</th><th className="px-3 py-4">المساهمة</th><th className="px-3 py-4">نسبتها</th><th></th></tr></thead><tbody>{data.branches.map((row) => <tr key={row.branch_id} className={`border-b last:border-0 ${isDarkMode ? 'border-white/[0.05]' : 'border-black/[0.05]'}`}><td className="px-3 py-4"><button type="button" className="font-black" onClick={() => onBranchChange(String(row.branch_id))}>{row.branch_name}</button>{row.low_base && <p className="mt-1 text-[9px] text-amber-500">عينة محدودة</p>}</td><td className="px-3 py-4 font-black">{formatCurrency(row.net_sales)}</td><td className="px-3 py-4">{row.comparison.net_sales.percent_change === null ? 'نشاط جديد/لا قاعدة' : `${row.comparison.net_sales.percent_change > 0 ? '+' : ''}${formatNumber(row.comparison.net_sales.percent_change)}%`}</td><td className="px-3 py-4">{formatNumber(row.paid_invoice_count)}</td><td className="px-3 py-4">{formatCurrency(row.average_ticket)}</td><td className="px-3 py-4">{formatCurrency(row.operating_expenses)}</td><td className="px-3 py-4">{row.expense_ratio === null ? '—' : `${formatNumber(row.expense_ratio)}%`}</td><td className="px-3 py-4">{formatCurrency(row.recorded_commission_cost)}</td><td className="px-3 py-4">{row.commission_ratio === null ? '—' : `${formatNumber(row.commission_ratio)}%`}</td><td className="px-3 py-4 font-black">{formatCurrency(row.operating_contribution)}</td><td className="px-3 py-4">{row.contribution_ratio === null ? '—' : `${formatNumber(row.contribution_ratio)}%`}</td><td className="px-3 py-4"><button type="button" onClick={() => setSelectedBranchId(row.branch_id)} aria-label={`تفاصيل ${row.branch_name}`}><Eye size={14} /></button></td></tr>)}</tbody></table>{!data.branches.length && <EmptyBlock isDarkMode={isDarkMode} />}</div>
          </section>

          <p className={`px-2 text-[11px] leading-6 ${mutedText(isDarkMode)}`}>يستخدم التقرير فرع المعاملة وقت تسجيلها. المساهمة التشغيلية ليست ربحًا، وقيم الخدمات والمنتجات والمصففين إجمالية قبل خصم الفاتورة.</p>
        </>
      )}

      {selectedBranchId && <ReportDrawer isDarkMode={isDarkMode} title={drilldown?.branch_name || 'تحليل الفرع'} subtitle={drilldown ? `${formatShortDate(range.dateFrom)} – ${formatShortDate(range.dateTo)}` : undefined} onClose={() => setSelectedBranchId(null)}>{drillLoading || !drilldown ? <ReportLoading isDarkMode={isDarkMode} /> : <BranchDrawer row={drilldown} dark={isDarkMode} />}</ReportDrawer>}
    </div>
  );
};

const RankList: React.FC<{ title: string; rows: BranchPerformanceRow['mix']['top_services']; dark: boolean }> = ({ title, rows, dark }) => <div className={`rounded-2xl p-5 ${dark ? 'bg-white/[0.025]' : 'bg-black/[0.025]'}`}><h4 className="mb-4 text-xs font-black">{title}</h4>{rows.slice(0, 4).map((row) => <div key={row.id} className="mb-3 last:mb-0"><div className="mb-1 flex justify-between gap-3 text-[11px]"><span className="font-bold">{row.name}</span><span>{formatNumber(row.share_percent)}%</span></div><CompactBar percent={row.share_percent} /><p className={`mt-1 text-[9px] ${mutedText(dark)}`}>{formatCurrency(row.gross_value)} · {formatNumber(row.units)} وحدة</p></div>)}{!rows.length && <p className={`text-xs ${mutedText(dark)}`}>لا توجد بيانات</p>}</div>;

const ContextPanel: React.FC<{ icon: React.ReactNode; title: string; dark: boolean; children: React.ReactNode }> = ({ icon, title, dark, children }) => <section className={`${panelClass(dark)} p-5 sm:p-6`}><div className="mb-4 flex items-center gap-2 text-[#E53935]">{icon}<h3 className={`font-black ${dark ? 'text-white' : 'text-black'}`}>{title}</h3></div>{children}</section>;

const BranchDrawer: React.FC<{ row: BranchPerformanceRow; dark: boolean }> = ({ row, dark }) => <div className="space-y-5">
  <section className={`${panelClass(dark)} p-5`}><h3 className="mb-3 font-black">الأداء</h3><MetricLine label="إجمالي قبل الخصم" value={formatCurrency(row.gross_sales)} isDarkMode={dark} /><MetricLine label="الخصومات" value={formatCurrency(row.discount_amount)} isDarkMode={dark} /><MetricLine label="صافي المبيعات" value={formatCurrency(row.net_sales)} isDarkMode={dark} /><MetricLine label="الفواتير المدفوعة" value={formatNumber(row.paid_invoice_count)} isDarkMode={dark} /><MetricLine label="متوسط الفاتورة" value={formatCurrency(row.average_ticket)} isDarkMode={dark} /><p className={`pt-3 text-[10px] leading-5 ${mutedText(dark)}`}>{row.growth_driver}</p></section>
  <section className={`${panelClass(dark)} p-5`}><h3 className="mb-3 font-black">التكلفة والمساهمة</h3><MetricLine label="المصروفات التشغيلية" value={`${formatCurrency(row.operating_expenses)} · ${row.expense_ratio === null ? 'غير متاح' : `${formatNumber(row.expense_ratio)}%`}`} isDarkMode={dark} /><MetricLine label="العمولات المسجلة" value={`${formatCurrency(row.recorded_commission_cost)} · ${row.commission_ratio === null ? 'غير متاح' : `${formatNumber(row.commission_ratio)}%`}`} isDarkMode={dark} /><MetricLine label="المساهمة التشغيلية" value={`${formatCurrency(row.operating_contribution)} · ${row.contribution_ratio === null ? 'غير متاح' : `${formatNumber(row.contribution_ratio)}%`}`} isDarkMode={dark} /></section>
  <section className={`${panelClass(dark)} p-5`}><h3 className="mb-3 font-black">المزيج والتحصيل</h3><MetricLine label="الخدمات الإجمالية" value={formatCurrency(row.mix.service_gross_value)} isDarkMode={dark} /><MetricLine label="المنتجات الإجمالية" value={formatCurrency(row.mix.product_gross_value)} isDarkMode={dark} /><MetricLine label="نقدي / فيزا / إنستا باي" value={`${formatCurrency(row.payments.methods.CASH)} / ${formatCurrency(row.payments.methods.VISA)} / ${formatCurrency(row.payments.methods.INSTAPAY)}`} isDarkMode={dark} /></section>
  <section className={`${panelClass(dark)} p-5`}><h3 className="mb-3 font-black">السياق التشغيلي</h3><MetricLine label="عملاء معروفون" value={formatNumber(row.identified_customers)} isDarkMode={dark} /><MetricLine label="ساعات حضور مكتملة" value={formatNumber(row.attendance.recorded_hours)} isDarkMode={dark} /><MetricLine label="المواعيد مكتملة / ملغاة" value={`${formatNumber(row.appointments.completed)} / ${formatNumber(row.appointments.cancelled)}`} isDarkMode={dark} /><MetricLine label="أيام فرق نقدي / أيام سابقة مفتوحة" value={`${formatNumber(row.treasury.material_variance_days)} / ${formatNumber(row.treasury.open_overdue_days)}`} isDarkMode={dark} /><MetricLine label="مخزون منخفض / نافد" value={`${formatNumber(row.inventory.low_stock_products)} / ${formatNumber(row.inventory.out_of_stock_products)}`} isDarkMode={dark} /></section>
</div>;

export default BranchesReport;
