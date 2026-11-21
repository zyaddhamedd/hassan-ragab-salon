import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cell,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowLeft,
  Boxes,
  Building2,
  CircleAlert,
  Landmark,
  ReceiptText,
  Scissors,
  ShieldCheck,
  TrendingUp,
  UserRoundSearch,
  UsersRound,
} from 'lucide-react';
import adminApi from '../../api/client';
import { ComparisonLine, EmptyBlock, mutedText, ReportError, ReportFilterBar } from './ReportPrimitives';
import {
  errorMessage,
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatShortDate,
  type DatePreset,
} from './reportUtils';
import type {
  MetricComparison,
  NamedOption,
  OverviewDestination,
  OverviewReportData,
  ReportDateRange,
} from './types';

interface Props {
  isDarkMode: boolean;
  range: ReportDateRange;
  preset: DatePreset;
  branchId: string;
  branches: NamedOption[];
  fixedBranchScope: boolean;
  onRangeChange: (range: ReportDateRange) => void;
  onPresetChange: (preset: DatePreset) => void;
  onBranchChange: (branch: string) => void;
  onNavigate: (report: OverviewDestination, options?: { branchId?: string; focus?: string }) => void;
}

const directionClass = (comparison: MetricComparison) => {
  if (comparison.percent_change === null || Math.abs(comparison.percent_change) < 2) return 'opacity-50';
  return comparison.percent_change > 0 ? 'text-emerald-500' : 'text-red-400';
};

const levelLabel = (level: string) => ({ ATTENTION: 'انتباه', REVIEW: 'مراجعة', CONTEXT: 'سياق' }[level] || level);
const categoryLabel = (category: string) => ({
  COMMERCIAL: 'تجاري', FINANCIAL: 'مالي', BRANCH: 'فرع', CUSTOMER: 'عملاء', OPERATIONAL: 'تشغيلي', INVENTORY: 'مخزون',
}[category] || category);

const formatAsOf = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
}).format(new Date(value));

const TrendTooltip = ({ active, payload, isDarkMode }: { active?: boolean; payload?: Array<{ payload: OverviewReportData['trend'][number] }>; isDarkMode: boolean }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className={`min-w-56 rounded-2xl border p-4 text-right shadow-2xl ${isDarkMode ? 'border-white/10 bg-[#151515]/95 text-white' : 'border-black/10 bg-white/95 text-[#171717]'}`} dir="rtl">
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-black">{formatShortDate(row.date)}</span>
        <span className="text-sm font-black">{formatCurrency(row.net_sales)}</span>
      </div>
      <div className={`mt-3 space-y-1.5 border-t pt-3 text-[11px] ${isDarkMode ? 'border-white/[0.07] text-white/55' : 'border-black/[0.07] text-black/55'}`}>
        <p className="flex justify-between gap-4"><span>الفترة السابقة · {formatShortDate(row.previous_date)}</span><strong>{formatCurrency(row.previous_net_sales)}</strong></p>
        <p className="flex justify-between gap-4"><span>فواتير مدفوعة</span><strong>{formatNumber(row.paid_invoice_count)}</strong></p>
        <p className="flex justify-between gap-4"><span>متوسط الفاتورة</span><strong>{formatCurrency(row.average_ticket)}</strong></p>
        <p className="flex justify-between gap-4"><span>الإجمالي / الخصم</span><strong>{formatCurrency(row.gross_sales)} / {formatCurrency(row.discount_amount)}</strong></p>
      </div>
    </div>
  );
};

type MixDatum = {
  name: string;
  value: number;
  percentage: number;
  units: number;
  color: string;
};

const MixTooltip = ({ active, payload, isDarkMode }: { active?: boolean; payload?: Array<{ payload: MixDatum }>; isDarkMode: boolean }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className={`rounded-xl border px-3 py-2 text-right shadow-xl ${isDarkMode ? 'border-white/10 bg-[#151515]/95 text-white' : 'border-black/10 bg-white/95 text-[#171717]'}`} dir="rtl">
      <p className="text-xs font-black">{row.name} · {formatNumber(row.percentage)}%</p>
      <p className={`mt-1 text-[10px] ${isDarkMode ? 'text-white/60' : 'text-black/60'}`}>{formatCurrency(row.value)} · {formatNumber(row.units)} وحدة</p>
    </div>
  );
};

const ComparisonBars: React.FC<{
  current: number;
  previous: number;
  currentLabel: string;
  previousLabel: string;
  isDarkMode: boolean;
}> = ({ current, previous, currentLabel, previousLabel, isDarkMode }) => {
  const maximum = Math.max(current, previous, 1);
  const width = (value: number) => `${Math.max(value > 0 ? 6 : 0, Math.min((value / maximum) * 100, 100))}%`;
  return (
    <div className="space-y-3">
      {[
        { label: currentLabel, value: current, color: 'bg-[#E53935]' },
        { label: previousLabel, value: previous, color: isDarkMode ? 'bg-white/25' : 'bg-black/25' },
      ].map((item) => (
        <div key={item.label}>
          <div className={`mb-1.5 flex items-center justify-between gap-3 text-[10px] ${isDarkMode ? 'text-white/55' : 'text-black/55'}`}>
            <span>{item.label}</span>
            <strong className={isDarkMode ? 'text-white/80' : 'text-black/80'}>{formatCompactCurrency(item.value)}</strong>
          </div>
          <div className={`h-1.5 overflow-hidden rounded-full ${isDarkMode ? 'bg-white/[0.055]' : 'bg-black/[0.06]'}`}>
            <span className={`block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${item.color}`} style={{ width: width(item.value) }} />
          </div>
        </div>
      ))}
    </div>
  );
};

const SectionHeading: React.FC<{ eyebrow: string; title: string; description: string; isDarkMode: boolean }> = ({ eyebrow, title, description, isDarkMode }) => (
  <div className="mb-5 max-w-2xl">
    <p className="mb-1.5 text-[9px] font-black tracking-[0.18em] text-[#E53935]/75">{eyebrow}</p>
    <h2 className="text-xl font-black tracking-tight sm:text-2xl">{title}</h2>
    <p className={`mt-1.5 text-xs leading-6 sm:text-sm ${isDarkMode ? 'text-white/55' : 'text-black/55'}`}>{description}</p>
  </div>
);

const OverviewSkeleton: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => (
  <div className="animate-pulse space-y-10">
    <div className={`h-14 rounded-2xl ${isDarkMode ? 'bg-white/[0.04]' : 'bg-black/[0.05]'}`} />
    <div className={`h-72 rounded-[26px] ${isDarkMode ? 'bg-white/[0.035]' : 'bg-black/[0.04]'}`} />
    <div className={`h-80 rounded-[26px] ${isDarkMode ? 'bg-white/[0.035]' : 'bg-black/[0.04]'}`} />
  </div>
);

const OverviewReport: React.FC<Props> = ({
  isDarkMode,
  range,
  preset,
  branchId,
  branches,
  fixedBranchScope,
  onRangeChange,
  onPresetChange,
  onBranchChange,
  onNavigate,
}) => {
  const [data, setData] = useState<OverviewReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const hasLoaded = useRef(false);

  const params = useMemo(() => ({
    date_from: range.dateFrom,
    date_to: range.dateTo,
    branch_id: branchId === 'All' ? undefined : branchId,
  }), [range, branchId]);

  const fetchOverview = useCallback(async () => {
    if (hasLoaded.current) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const response = await adminApi.get<OverviewReportData>('/reports/overview', { params });
      setData(response.data);
      hasLoaded.current = true;
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [params]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (hasLoaded.current) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        const response = await adminApi.get<OverviewReportData>('/reports/overview', { params });
        if (active) {
          setData(response.data);
          hasLoaded.current = true;
        }
      } catch (requestError) {
        if (active) setError(errorMessage(requestError));
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };
    void load();
    return () => { active = false; };
  }, [params]);

  const peak = data?.trend.length
    ? data.trend.reduce((highest, row) => row.net_sales > highest.net_sales ? row : highest)
    : null;

  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const trendLength = data?.trend.length || 0;
  const shortTrend = trendLength <= 4;
  const trendHeight = shortTrend ? 230 : trendLength <= 10 ? 280 : 330;
  const singleBranch = Boolean(data && (data.branch_count === 1 || data.branches.length === 1));
  const mixTotal = data ? data.mix.service_gross_value + data.mix.product_gross_value : 0;
  const mixData: MixDatum[] = data ? [
    { name: 'الخدمات', value: data.mix.service_gross_value, percentage: data.mix.service_share_percent, units: data.mix.service_units, color: '#E53935' },
    { name: 'المنتجات', value: data.mix.product_gross_value, percentage: data.mix.product_share_percent, units: data.mix.product_units, color: '#E6D690' },
  ] : [];

  const explore: Array<{ report: OverviewDestination; title: string; description: string; icon: React.ReactNode }> = [
    { report: 'sales', title: 'المبيعات', description: 'الاتجاهات والخصومات وطرق الدفع والفواتير', icon: <ReceiptText size={17} /> },
    { report: 'finance', title: 'المالية والخزنة', description: 'المساهمة والمصروفات والتحصيلات وأيام العمل', icon: <Landmark size={17} /> },
    { report: 'branches', title: 'أداء الفروع', description: 'توزيع النشاط والحركة والسياق التشغيلي', icon: <Building2 size={17} /> },
    { report: 'customers', title: 'العملاء', description: 'التكرار والتغطية وسجل النشاط المدفوع', icon: <UserRoundSearch size={17} /> },
    { report: 'services', title: 'الخدمات', description: 'القيمة الإجمالية والوحدات والتصنيفات', icon: <Scissors size={17} /> },
    { report: 'products', title: 'المنتجات', description: 'المبيعات الإجمالية والحركة وحالة المخزون', icon: <Boxes size={17} /> },
    { report: 'employees', title: 'الموظفون', description: 'إسناد الخدمات والعمولات وسياق الحضور', icon: <UsersRound size={17} /> },
    { report: 'operations', title: 'العمليات', description: 'الحضور والمواعيد وأيام العمل وحركة المخزون', icon: <ShieldCheck size={17} /> },
  ];

  return (
    <div className="space-y-10 pb-10">
      <ReportFilterBar
        isDarkMode={isDarkMode}
        range={range}
        preset={preset}
        branchId={branchId}
        branches={branches}
        onRangeChange={onRangeChange}
        onPresetChange={onPresetChange}
        onBranchChange={onBranchChange}
        hideBranch={fixedBranchScope}
      >
        {fixedBranchScope && <span className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-bold ${isDarkMode ? 'border-white/10 bg-white/[0.025] text-white/70' : 'border-black/10 bg-black/[0.025] text-black/70'}`}><Building2 size={14} /> نطاق الفرع المصرح</span>}
      </ReportFilterBar>

      {loading && !data ? <OverviewSkeleton isDarkMode={isDarkMode} /> : error && !data ? (
        <ReportError isDarkMode={isDarkMode} message={error} onRetry={fetchOverview} />
      ) : data && (
        <div className={`relative space-y-10 transition-opacity duration-300 lg:space-y-12 [&_button]:rounded-sm [&_button]:focus-visible:outline-none [&_button]:focus-visible:ring-2 [&_button]:focus-visible:ring-[#E53935]/60 [&_button]:focus-visible:ring-offset-2 ${isDarkMode ? '[&_button]:focus-visible:ring-offset-[#101010]' : '[&_button]:focus-visible:ring-offset-white'} ${refreshing ? 'opacity-60' : 'opacity-100'}`}>
          {refreshing && <div className="pointer-events-none absolute -top-5 left-0 text-[10px] font-bold text-[#E6D690]">جارٍ تحديث القراءة…</div>}
          {error && <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3 text-xs font-bold text-red-400">{error}</div>}

          {/* 1. Executive Pulse */}
          <section className={`overflow-hidden rounded-[28px] border ${isDarkMode ? 'border-white/[0.075] bg-white/[0.018]' : 'border-black/[0.075] bg-black/[0.018]'}`}>
            <div className="grid lg:grid-cols-[1.2fr_0.8fr]">
              <button type="button" onClick={() => onNavigate('sales')} className={`group p-5 text-right sm:p-7 lg:p-8 ${isDarkMode ? 'hover:bg-white/[0.014]' : 'hover:bg-black/[0.014]'}`}>
                <div className="mb-4 flex items-center gap-2 text-[10px] font-black text-[#E53935]"><TrendingUp size={15} /> النبض التجاري</div>
                <p className={`mb-2 text-[11px] font-bold ${isDarkMode ? 'text-white/55' : 'text-black/55'}`}>صافي المبيعات</p>
                <div className="flex flex-wrap items-end gap-x-2 gap-y-1" dir="rtl">
                  <span className="text-[clamp(2.2rem,5vw,4.25rem)] font-black leading-none tracking-[-0.045em]" title={formatCurrency(data.summary.net_sales)}>{formatCompactCurrency(data.summary.net_sales).replace(' ج.م', '')}</span>
                  <span className={`pb-1 text-xs font-black sm:pb-2 sm:text-sm ${isDarkMode ? 'text-white/50' : 'text-black/50'}`}>ج.م</span>
                </div>
                <div className={`mt-4 max-w-xl text-xs ${directionClass(data.comparison.net_sales)}`}><ComparisonLine comparison={data.comparison.net_sales} isDarkMode={isDarkMode} formatter={formatCurrency} /></div>
                <span className={`mt-4 inline-flex items-center gap-1 text-[10px] font-black transition group-hover:gap-2 ${isDarkMode ? 'text-white/48 group-hover:text-white/75' : 'text-black/48 group-hover:text-black/75'}`}>عرض تقرير المبيعات <ArrowLeft size={12} /></span>
              </button>

              <div className={`border-t p-5 sm:p-7 lg:border-r lg:border-t-0 lg:p-8 ${isDarkMode ? 'border-white/[0.07]' : 'border-black/[0.07]'}`}>
                <p className={`mb-4 text-[10px] font-bold ${isDarkMode ? 'text-white/50' : 'text-black/50'}`}>مقارنة صافي المبيعات</p>
                <ComparisonBars
                  current={data.summary.net_sales}
                  previous={data.comparison.net_sales.previous}
                  currentLabel={`${formatShortDate(data.meta.date_from)} – ${formatShortDate(data.meta.date_to)}`}
                  previousLabel={`${formatShortDate(data.meta.previous_date_from)} – ${formatShortDate(data.meta.previous_date_to)}`}
                  isDarkMode={isDarkMode}
                />
                <p className={`mt-5 border-r-2 border-[#E6D690]/50 pr-3 text-xs font-bold leading-6 ${isDarkMode ? 'text-white/68' : 'text-black/68'}`}>{data.drivers.text}</p>
              </div>
            </div>

            <div className={`grid border-t sm:grid-cols-3 ${isDarkMode ? 'border-white/[0.07]' : 'border-black/[0.07]'}`}>
              {[
                { label: 'فواتير مدفوعة', value: formatNumber(data.summary.paid_invoice_count), comparison: data.comparison.paid_invoice_count, formatter: formatNumber, action: () => onNavigate('sales'), note: '' },
                { label: 'متوسط الفاتورة', value: formatCompactCurrency(data.summary.average_ticket), comparison: data.comparison.average_ticket, formatter: formatCurrency, action: () => onNavigate('sales'), note: '' },
                { label: 'المساهمة التشغيلية', value: formatCompactCurrency(data.summary.operating_contribution), comparison: data.comparison.operating_contribution, formatter: formatCurrency, action: () => onNavigate('finance'), note: 'بعد العمولات والمصروفات المسجلة' },
              ].map((metric, index) => (
                <button key={metric.label} type="button" onClick={metric.action} className={`p-5 text-right transition sm:p-6 ${index ? 'border-t sm:border-r sm:border-t-0' : ''} ${isDarkMode ? 'border-white/[0.065] hover:bg-white/[0.014]' : 'border-black/[0.065] hover:bg-black/[0.014]'}`}>
                  <p className={`text-[10px] font-bold ${isDarkMode ? 'text-white/52' : 'text-black/52'}`}>{metric.label}</p>
                  <p className="mt-1 text-xl font-black tabular-nums sm:text-2xl">{metric.value}</p>
                  <div className={`mt-1 text-[9px] ${directionClass(metric.comparison)}`}><ComparisonLine comparison={metric.comparison} isDarkMode={isDarkMode} formatter={metric.formatter} /></div>
                  {metric.note && <p className={`mt-1.5 text-[9px] ${isDarkMode ? 'text-white/42' : 'text-black/42'}`}>{metric.note}</p>}
                </button>
              ))}
            </div>
          </section>

          {/* 2. Daily Performance */}
          <section>
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <SectionHeading eyebrow="DAILY PERFORMANCE" title="الأداء اليومي" description="صافي المبيعات اليومية مقارنة بالفترة السابقة المساوية لها." isDarkMode={isDarkMode} />
              <p className={`mb-5 text-[10px] ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}>الفترة السابقة: {formatShortDate(data.meta.previous_date_from)} – {formatShortDate(data.meta.previous_date_to)}</p>
            </div>
            {data.summary.paid_invoice_count === 0 ? (
              <EmptyBlock isDarkMode={isDarkMode} title="لا توجد مبيعات مدفوعة مسجلة خلال الفترة المحددة." />
            ) : (
              <button type="button" onClick={() => onNavigate('sales')} className={`block w-full rounded-[24px] border px-1 py-3 text-right transition sm:px-4 ${isDarkMode ? 'border-white/[0.055] bg-white/[0.012] hover:bg-white/[0.02]' : 'border-black/[0.055] bg-black/[0.012] hover:bg-black/[0.02]'}`} style={{ height: trendHeight }} aria-label="عرض تقرير المبيعات">
                <div dir="ltr" className="h-full w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.trend} margin={{ top: 18, right: 14, left: 6, bottom: 4 }}>
                      <CartesianGrid vertical={false} strokeDasharray="2 10" stroke={isDarkMode ? '#ffffff0f' : '#00000010'} />
                      <XAxis dataKey="date" tickFormatter={formatShortDate} axisLine={false} tickLine={false} minTickGap={28} tick={{ fill: isDarkMode ? '#ffffff65' : '#00000060', fontSize: 11 }} />
                      <YAxis hide domain={['auto', 'auto']} />
                      <Tooltip content={<TrendTooltip isDarkMode={isDarkMode} />} cursor={{ stroke: isDarkMode ? '#ffffff25' : '#00000020', strokeDasharray: '3 5' }} />
                      <Line type="monotone" dataKey="previous_net_sales" stroke={isDarkMode ? '#ffffff38' : '#00000035'} strokeWidth={1.5} strokeDasharray="5 7" dot={false} activeDot={false} isAnimationActive={!reduceMotion} />
                      <Line type="monotone" dataKey="net_sales" stroke="#E53935" strokeWidth={2.6} dot={shortTrend ? { r: 3, fill: '#E53935', strokeWidth: 0 } : false} activeDot={{ r: 4, fill: '#E53935', stroke: isDarkMode ? '#111' : '#fff', strokeWidth: 2 }} isAnimationActive={!reduceMotion} />
                      {peak && peak.net_sales > 0 && <ReferenceDot x={peak.date} y={peak.net_sales} r={4} fill="#E6D690" stroke={isDarkMode ? '#111' : '#fff'} strokeWidth={2} />}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </button>
            )}
            <div className={`mt-4 grid gap-3 border-t pt-4 md:grid-cols-2 ${isDarkMode ? 'border-white/[0.07]' : 'border-black/[0.07]'}`}>
              {data.insights.map((insight) => <p key={insight.code} className={`border-r-2 border-[#E6D690]/45 pr-4 text-xs font-bold leading-6 ${isDarkMode ? 'text-white/68' : 'text-black/68'}`}>{insight.text}</p>)}
            </div>
          </section>

          {/* 3. Where Activity Came From */}
          <section>
            <SectionHeading eyebrow="ACTIVITY DISTRIBUTION" title="من أين جاء النشاط؟" description="مساهمة الفروع وما اشتراه العملاء، دون تحويل القسم إلى مقارنة أداء كاملة." isDarkMode={isDarkMode} />
            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <div className={`rounded-[24px] border p-5 sm:p-6 ${isDarkMode ? 'border-white/[0.065] bg-white/[0.014]' : 'border-black/[0.065] bg-black/[0.014]'}`}>
                <div className="mb-4 flex items-end justify-between gap-4">
                  <div><h3 className="text-base font-black">{singleBranch ? 'لقطة الفرع' : 'مساهمة الفروع'}</h3><p className={`mt-1 text-[10px] ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}>{singleBranch ? 'قراءة مباشرة للنطاق المحدد' : 'مرتبة حسب صافي المبيعات'}</p></div>
                  <button type="button" onClick={() => onNavigate('branches')} className={`inline-flex items-center gap-1 text-[10px] font-black transition hover:gap-2 ${isDarkMode ? 'text-white/50 hover:text-white/75' : 'text-black/50 hover:text-black/75'}`}>عرض التقرير <ArrowLeft size={12} /></button>
                </div>
                {data.branches.length ? singleBranch ? (() => {
                  const branch = data.branches[0];
                  return (
                    <button type="button" onClick={() => onNavigate('branches', { branchId: String(branch.branch_id) })} className={`grid w-full gap-5 border-t pt-5 text-right sm:grid-cols-[1fr_auto] sm:items-end ${isDarkMode ? 'border-white/[0.07]' : 'border-black/[0.07]'}`}>
                      <div>
                        <p className={`flex items-center gap-2 text-[10px] font-bold ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}><span>{branch.branch_name}</span><span className={`rounded-full px-2 py-0.5 text-[8px] ${isDarkMode ? 'bg-white/[0.05] text-white/55' : 'bg-black/[0.05] text-black/55'}`}>100% من النطاق</span></p>
                        <p className="mt-1 text-3xl font-black">{formatCompactCurrency(branch.net_sales)}</p>
                        <p className={`mt-2 text-[10px] ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}>صافي المبيعات ضمن نطاق الفرع</p>
                      </div>
                      <div className="grid grid-cols-2 gap-6 sm:text-left">
                        <div><p className={`text-[10px] ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}>الفواتير</p><strong className="mt-1 block text-lg">{formatNumber(branch.paid_invoice_count)}</strong></div>
                        <div><p className={`text-[10px] ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}>الحركة</p><strong className={`mt-1 block text-sm ${directionClass(branch.comparison)}`}>{branch.comparison.percent_change === null ? 'دون قاعدة' : `${branch.comparison.percent_change > 0 ? '+' : ''}${formatNumber(branch.comparison.percent_change)}%`}</strong></div>
                      </div>
                    </button>
                  );
                })() : <div className="space-y-1">
                  {data.branches.map((branch, index) => (
                    <button key={branch.branch_id} type="button" onClick={() => onNavigate('branches', { branchId: String(branch.branch_id) })} title={`السابق: ${formatCurrency(branch.comparison.previous)} · التغير: ${branch.comparison.percent_change === null ? 'دون قاعدة مقارنة' : `${formatNumber(branch.comparison.percent_change)}%`}`} className={`group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b py-3.5 text-right transition last:border-b-0 ${isDarkMode ? 'border-white/[0.055] hover:bg-white/[0.014]' : 'border-black/[0.055] hover:bg-black/[0.014]'}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-3"><span className={`text-[9px] tabular-nums ${isDarkMode ? 'text-white/38' : 'text-black/38'}`}>{String(index + 1).padStart(2, '0')}</span><p className="truncate text-xs font-black sm:text-sm">{branch.branch_name}</p></div>
                        <div className={`mr-7 mt-2 h-2 overflow-hidden rounded-full ${isDarkMode ? 'bg-white/[0.05]' : 'bg-black/[0.06]'}`}><span className="block h-full rounded-full bg-[#E53935]/78 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${Math.min(branch.contribution_percent, 100)}%` }} /></div>
                      </div>
                      <div className="text-left"><p className="text-xs font-black tabular-nums sm:text-sm">{formatCompactCurrency(branch.net_sales)}</p><p className={`mt-1 text-[9px] ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}>{formatNumber(branch.contribution_percent)}% · {branch.comparison.percent_change === null ? 'دون قاعدة' : `${branch.comparison.percent_change > 0 ? '+' : ''}${formatNumber(branch.comparison.percent_change)}%`}</p></div>
                    </button>
                  ))}
                  {data.branch_count > data.branches.length && <p className={`pt-3 text-[9px] ${isDarkMode ? 'text-white/45' : 'text-black/45'}`}>يظهر أعلى {data.branches.length} فروع من أصل {data.branch_count}.</p>}
                </div> : <EmptyBlock isDarkMode={isDarkMode} title="لا توجد مساهمة فروع مسجلة خلال الفترة." />}
              </div>

              <div className={`rounded-[24px] border p-5 sm:p-6 ${isDarkMode ? 'border-white/[0.065] bg-white/[0.014]' : 'border-black/[0.065] bg-black/[0.014]'}`}>
                <h3 className="text-base font-black">الخدمات والمنتجات</h3>
                <p className={`mt-1 text-[10px] ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}>مساهمة إجمالية قبل خصم مستوى الفاتورة</p>
                {mixTotal > 0 ? (
                  <>
                    <div className="relative mx-auto mt-3 h-48 max-w-[260px]" aria-label={`الخدمات ${formatNumber(data.mix.service_share_percent)}% والمنتجات ${formatNumber(data.mix.product_share_percent)}%`}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={mixData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={56} outerRadius={76} paddingAngle={2} stroke="none" className="cursor-pointer" onClick={(_, index) => onNavigate(index === 0 ? 'services' : 'products')} isAnimationActive={!reduceMotion}>
                            {mixData.map((item) => <Cell key={item.name} fill={item.color} />)}
                          </Pie>
                          <Tooltip content={<MixTooltip isDarkMode={isDarkMode} />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"><span className={`text-[9px] ${isDarkMode ? 'text-white/45' : 'text-black/45'}`}>إجمالي المساهمة</span><strong className="mt-1 text-sm">{formatCompactCurrency(mixTotal)}</strong></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      {mixData.map((item) => (
                        <button key={item.name} type="button" onClick={() => onNavigate(item.name === 'الخدمات' ? 'services' : 'products')} className="text-right">
                          <p className="flex items-center gap-2 text-[10px] font-black"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />{item.name} · {formatNumber(item.percentage)}%</p>
                          <p className="mt-1 text-base font-black">{formatCompactCurrency(item.value)}</p>
                          <p className={`mt-0.5 text-[9px] ${isDarkMode ? 'text-white/45' : 'text-black/45'}`}>{formatNumber(item.units)} وحدة</p>
                        </button>
                      ))}
                    </div>
                  </>
                ) : <EmptyBlock isDarkMode={isDarkMode} title="لا توجد مساهمة خدمات أو منتجات خلال الفترة." />}
                <div className={`mt-5 space-y-3 border-t pt-4 ${isDarkMode ? 'border-white/[0.07]' : 'border-black/[0.07]'}`}>
                  {data.mix.top_service && <button type="button" onClick={() => onNavigate('services')} className="flex w-full items-center justify-between gap-4 text-right"><span className={`text-[10px] ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}>الخدمة الأعلى إجمالياً</span><strong className="truncate text-[11px]">{data.mix.top_service.name}</strong></button>}
                  {data.mix.top_product && <button type="button" onClick={() => onNavigate('products')} className="flex w-full items-center justify-between gap-4 text-right"><span className={`text-[10px] ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}>المنتج الأعلى إجمالياً</span><strong className="truncate text-[11px]">{data.mix.top_product.name}</strong></button>}
                </div>
              </div>
            </div>
          </section>

          {/* 4. Customer & Team Context */}
          <section>
            <SectionHeading eyebrow="CUSTOMER & TEAM CONTEXT" title="سياق العملاء والفريق" description="مؤشرات محدودة تساعد على قراءة جودة النشاط دون إنشاء تقارير مصغرة." isDarkMode={isDarkMode} />
            <div className="grid gap-6 lg:grid-cols-2">
              <div className={`rounded-[24px] border p-5 sm:p-6 ${isDarkMode ? 'border-white/[0.065] bg-white/[0.014]' : 'border-black/[0.065] bg-black/[0.014]'}`}>
                <div className="mb-4 flex items-center justify-between"><h3 className="text-base font-black">العملاء</h3><button type="button" onClick={() => onNavigate('customers')} className={`inline-flex items-center gap-1 text-[10px] font-black transition hover:gap-2 ${isDarkMode ? 'text-white/50 hover:text-white/75' : 'text-black/50 hover:text-black/75'}`}>عرض التقرير <ArrowLeft size={12} /></button></div>
                <div className="grid items-center gap-5 sm:grid-cols-[150px_1fr]">
                  <button type="button" onClick={() => onNavigate('customers')} className="relative mx-auto h-36 w-36" aria-label={`نشاط مدفوع متكرر ${formatNumber(data.customers.repeat_paid_day_share)}%`}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={[{ value: data.customers.repeat_paid_day_share, fill: '#E53935' }, { value: Math.max(100 - data.customers.repeat_paid_day_share, 0), fill: isDarkMode ? '#ffffff10' : '#00000012' }]} dataKey="value" cx="50%" cy="50%" innerRadius={48} outerRadius={61} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={!reduceMotion}>
                          <Cell fill="#E53935" />
                          <Cell fill={isDarkMode ? '#ffffff10' : '#00000012'} />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><strong className="text-2xl">{formatNumber(data.customers.repeat_paid_day_share)}%</strong><span className={`mt-0.5 text-[8px] ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}>نشاط متكرر</span></div>
                  </button>
                  <div>
                    <p className={`text-[10px] font-bold ${isDarkMode ? 'text-white/50' : 'text-black/50'}`}>نشاط الأيام المدفوعة المتكرر</p>
                    <div className="mt-1 text-[9px]"><ComparisonLine comparison={data.customers.comparison.repeat_paid_day_share} isDarkMode={isDarkMode} /></div>
                    <button type="button" onClick={() => onNavigate('customers')} title={`${formatNumber(data.summary.identified_customer_invoice_count)} من ${formatNumber(data.summary.paid_invoice_count)} فاتورة مدفوعة`} className="mt-5 w-full text-right">
                      <div className="flex items-center justify-between gap-3"><span className={`text-[10px] font-bold ${isDarkMode ? 'text-white/50' : 'text-black/50'}`}>تغطية هوية الفواتير</span><strong className="text-sm">{formatNumber(data.customers.identified_invoice_coverage)}%</strong></div>
                      <div className={`mt-2 h-2 overflow-hidden rounded-full ${isDarkMode ? 'bg-white/[0.055]' : 'bg-black/[0.06]'}`}><span className="block h-full rounded-full bg-[#E6D690] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${Math.min(data.customers.identified_invoice_coverage, 100)}%` }} /></div>
                      <div className="mt-1 text-[9px]"><ComparisonLine comparison={data.customers.comparison.identified_invoice_coverage} isDarkMode={isDarkMode} /></div>
                    </button>
                  </div>
                </div>
                <p className={`mt-4 border-t pt-4 text-[10px] leading-5 ${isDarkMode ? 'border-white/[0.07] text-white/48' : 'border-black/[0.07] text-black/48'}`}>{formatNumber(data.summary.identified_customer_invoice_count)} من {formatNumber(data.summary.paid_invoice_count)} فاتورة مدفوعة مرتبطة بعميل، عبر {formatNumber(data.customers.identified_customers)} سجل عميل داخل النطاق.</p>
              </div>

              <div className={`rounded-[24px] border p-5 sm:p-6 ${isDarkMode ? 'border-white/[0.065] bg-white/[0.014]' : 'border-black/[0.065] bg-black/[0.014]'}`}>
                <div className="mb-4 flex items-center justify-between"><h3 className="text-base font-black">الفريق</h3><button type="button" onClick={() => onNavigate('employees')} className={`inline-flex items-center gap-1 text-[10px] font-black transition hover:gap-2 ${isDarkMode ? 'text-white/50 hover:text-white/75' : 'text-black/50 hover:text-black/75'}`}>عرض التقرير <ArrowLeft size={12} /></button></div>
                {data.team.leading_barber ? (
                  <button type="button" onClick={() => onNavigate('employees')} className="w-full text-right">
                    <p className={`text-[10px] ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}>أعلى إسناد خدمات خلال الفترة</p>
                    <div className="mt-2 flex items-end justify-between gap-4"><div><strong className="text-lg">{data.team.leading_barber.employee_name}</strong><p className={`mt-1 text-[9px] ${isDarkMode ? 'text-white/45' : 'text-black/45'}`}>من قيمة نشاط الخدمات المسندة</p></div><strong className="text-2xl tabular-nums">{formatNumber(data.team.leading_barber.share_percent)}%</strong></div>
                    <div className={`mt-4 h-2 overflow-hidden rounded-full ${isDarkMode ? 'bg-white/[0.055]' : 'bg-black/[0.06]'}`}><span className="block h-full rounded-full bg-[#E53935]/80 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${Math.min(data.team.leading_barber.share_percent, 100)}%` }} /></div>
                    <div className={`mt-3 flex items-center justify-between gap-4 text-[10px] ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}><span>قيمة الخدمات الإجمالية المسندة</span><strong className={isDarkMode ? 'text-white/78' : 'text-black/78'}>{formatCompactCurrency(data.team.leading_barber.gross_service_value)}</strong></div>
                    <p className={`mt-4 text-[9px] leading-5 ${isDarkMode ? 'text-white/42' : 'text-black/42'}`}>وصف للإسناد التشغيلي، ولا يمثل إيرادًا صافيًا أو تقييم أداء.</p>
                  </button>
                ) : <p className={`py-8 text-sm ${isDarkMode ? 'text-white/50' : 'text-black/50'}`}>لا توجد خدمات مسندة لفريق التصفيف خلال الفترة.</p>}
                <button type="button" onClick={() => onNavigate('finance')} className={`mt-5 flex w-full items-center justify-between gap-4 border-t pt-4 text-right ${isDarkMode ? 'border-white/[0.07]' : 'border-black/[0.07]'}`}><span className={`text-[10px] ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}>تكلفة العمولات المسجلة</span><strong className="text-sm">{formatCompactCurrency(data.team.recorded_commission_cost)}</strong></button>
              </div>
            </div>
          </section>

          {/* 5. Signals & Current Conditions */}
          <section>
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <SectionHeading eyebrow="EXECUTIVE SIGNALS" title="ما يحتاج مراجعة" description="إشارات محددة ومزالة التكرار، مرتبة وفق العقد التنفيذي." isDarkMode={isDarkMode} />
              <p className={`mb-5 inline-flex items-center gap-2 text-[10px] ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}><span className="rounded-full bg-amber-500/10 px-2 py-1 font-black text-amber-400">حالي</span> لقطة {formatAsOf(data.current_conditions.as_of)}</p>
            </div>
            {data.signals.length ? <div className={`border-y ${isDarkMode ? 'border-white/[0.08]' : 'border-black/[0.08]'}`}>
              {data.signals.map((signal) => (
                <button key={signal.code} type="button" onClick={() => onNavigate(signal.destination)} className={`group grid w-full gap-2.5 border-b py-3.5 text-right transition last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-center ${isDarkMode ? 'border-white/[0.055] hover:bg-white/[0.018]' : 'border-black/[0.055] hover:bg-black/[0.018]'}`}>
                  <div className="flex flex-wrap items-center gap-1.5"><CircleAlert size={13} className={signal.level === 'ATTENTION' ? 'text-amber-400' : isDarkMode ? 'text-white/35' : 'text-black/35'} /><span className={`rounded-full px-2 py-1 text-[9px] font-black ${signal.level === 'ATTENTION' ? 'bg-amber-500/10 text-amber-400' : isDarkMode ? 'bg-white/[0.045] text-white/50' : 'bg-black/[0.045] text-black/50'}`}>{levelLabel(signal.level)} · {categoryLabel(signal.category)}</span>{signal.snapshot && <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[9px] font-black text-amber-400">حالي · تشغيلي</span>}</div>
                  <div><p className="text-xs font-black sm:text-sm">{signal.title}</p><p className={`mt-0.5 text-[11px] leading-5 ${isDarkMode ? 'text-white/52' : 'text-black/52'}`}>{signal.detail}</p></div>
                  <span className={`inline-flex items-center gap-1 text-[9px] font-black transition group-hover:gap-2 ${isDarkMode ? 'text-white/45' : 'text-black/45'}`}>التفاصيل <ArrowLeft size={11} /></span>
                </button>
              ))}
            </div> : <EmptyBlock isDarkMode={isDarkMode} title="لا توجد حالات بارزة تحتاج للمراجعة ضمن النطاق الحالي." />}
          </section>

          {/* 6. Explore Reports */}
          <section>
            <SectionHeading eyebrow="EXPLORE REPORTS" title="انتقل إلى التحليل المتخصص" description="التفاصيل والجداول والتصدير موجودة في التقارير المرجعية لكل مجال." isDarkMode={isDarkMode} />
            <div className="grid gap-x-10 md:grid-cols-2">
              {explore.map((item) => (
                <button key={item.report} type="button" onClick={() => onNavigate(item.report)} className={`group flex items-start gap-3 border-b py-4 text-right transition ${isDarkMode ? 'border-white/[0.06] hover:border-white/15' : 'border-black/[0.06] hover:border-black/15'}`}>
                  <span className={`mt-0.5 rounded-xl p-2 ${item.report === 'sales' ? 'bg-[#E53935]/10 text-[#E53935]' : 'bg-[#E6D690]/10 text-[#C2A34D]'}`}>{item.icon}</span>
                  <span className="min-w-0 flex-1"><strong className="flex items-center justify-between gap-3 text-sm">{item.title}<ArrowLeft size={13} className="opacity-30 transition group-hover:-translate-x-1 group-hover:opacity-80" /></strong><span className={`mt-1.5 block text-[10px] leading-5 ${isDarkMode ? 'text-white/48' : 'text-black/48'}`}>{item.description}</span></span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default OverviewReport;
