import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Eye, Package, Repeat2, Search, Scissors, UserRoundSearch, UsersRound } from 'lucide-react';
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
import { errorMessage, formatCompactCurrency, formatCurrency, formatNumber, formatShortDate, type DatePreset } from './reportUtils';
import type {
  CustomerCohort,
  CustomerDrilldown,
  CustomerRecencyBucket,
  CustomerRepeatFilter,
  CustomerReportData,
  CustomerReportRow,
  NamedOption,
  ReportDateRange,
} from './types';

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

type CustomerSort = 'net_spend' | 'recorded_lifetime_net_spend' | 'paid_invoice_count' | 'paid_date_count' | 'average_ticket' | 'recency_days' | 'last_paid_date' | 'customer_name';

const sortOptions: Array<{ value: CustomerSort; label: string }> = [
  { value: 'net_spend', label: 'صافي إنفاق الفترة' },
  { value: 'recorded_lifetime_net_spend', label: 'صافي العمر المسجل' },
  { value: 'paid_invoice_count', label: 'الفواتير المدفوعة' },
  { value: 'paid_date_count', label: 'تواريخ الدفع المميزة' },
  { value: 'average_ticket', label: 'متوسط الفاتورة' },
  { value: 'recency_days', label: 'الحداثة بالأيام' },
  { value: 'last_paid_date', label: 'آخر نشاط مدفوع' },
  { value: 'customer_name', label: 'اسم العميل' },
];

const recencyLabels: Record<CustomerRecencyBucket, string> = {
  '0_30': '0–30 يومًا',
  '31_60': '31–60 يومًا',
  '61_90': '61–90 يومًا',
  '91_PLUS': '91+ يومًا',
};

const frequencyLabels: Record<string, string> = { '1': 'تاريخ واحد', '2': 'تاريخان', '3_5': '3–5 تواريخ', '6_PLUS': '6+ تواريخ' };
const paymentLabels: Record<string, string> = { CASH: 'نقدي', VISA: 'فيزا', INSTAPAY: 'إنستا باي' };
const selectClass = (dark: boolean) => `h-10 rounded-xl border px-3 text-xs font-bold outline-none ${dark ? 'border-white/10 bg-white/[0.04] text-white' : 'border-black/10 bg-[#FAFAFA] text-[#171717]'}`;

const downloadBlob = (data: Blob, filename: string) => {
  const href = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
};

const DistributionBars: React.FC<{ values: Array<{ label: string; value: number }>; dark: boolean }> = ({ values, dark }) => {
  const maximum = Math.max(...values.map((item) => item.value), 1);
  return <div className="space-y-4">{values.map((item) => <div key={item.label}>
    <div className="mb-2 flex items-center justify-between gap-3 text-xs"><span className="font-bold">{item.label}</span><span className={mutedText(dark)}>{formatNumber(item.value)} سجل</span></div>
    <div className="h-1.5 overflow-hidden rounded-full bg-current/10"><div className="h-full rounded-full bg-[#E53935]" style={{ width: `${(item.value / maximum) * 100}%` }} /></div>
  </div>)}</div>;
};

const CustomersReport: React.FC<Props> = ({ isDarkMode, range, preset, branchId, branches, onRangeChange, onPresetChange, onBranchChange }) => {
  const [data, setData] = useState<CustomerReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<CustomerSort>('net_spend');
  const [cohort, setCohort] = useState<CustomerCohort | ''>('');
  const [recency, setRecency] = useState<CustomerRecencyBucket | ''>('');
  const [repeatFilter, setRepeatFilter] = useState<CustomerRepeatFilter | ''>('');
  const [dormancyDays, setDormancyDays] = useState('90');
  const [categoryId, setCategoryId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [productId, setProductId] = useState('');
  const [barberId, setBarberId] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<number | null>(null);
  const [drilldown, setDrilldown] = useState<CustomerDrilldown | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const params = useMemo(() => ({
    date_from: range.dateFrom,
    date_to: range.dateTo,
    branch_id: branchId === 'All' ? undefined : branchId,
    customer_cohort: cohort || undefined,
    customer_recency_bucket: recency || undefined,
    customer_repeat: repeatFilter || undefined,
    dormancy_days: dormancyDays,
    category_id: categoryId || undefined,
    service_id: serviceId || undefined,
    product_id: productId || undefined,
    barber_id: barberId || undefined,
    promo_code: promoCode || undefined,
    search: search || undefined,
    sort_by: sortBy,
    sort_dir: sortBy === 'recency_days' || sortBy === 'customer_name' ? 'asc' : 'desc',
    page,
    per_page: 12,
  }), [range, branchId, cohort, recency, repeatFilter, dormancyDays, categoryId, serviceId, productId, barberId, promoCode, search, sortBy, page]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get<CustomerReportData>('/reports/customers', { params });
      setData(response.data);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { void fetchReport(); }, [fetchReport]);
  useEffect(() => { setPage(1); setSelectedCustomer(null); setDrilldown(null); }, [range, branchId, cohort, recency, repeatFilter, dormancyDays, categoryId, serviceId, productId, barberId, promoCode, search, sortBy]);
  useEffect(() => {
    if (!selectedCustomer) {
      setDrilldown(null);
      return;
    }
    const load = async () => {
      setDrillLoading(true);
      try {
        const response = await adminApi.get<CustomerDrilldown>(`/reports/customers/${selectedCustomer}`, { params });
        setDrilldown(response.data);
      } catch (requestError) {
        setError(errorMessage(requestError));
        setSelectedCustomer(null);
      } finally {
        setDrillLoading(false);
      }
    };
    void load();
  }, [selectedCustomer, params]);

  const exportReport = async () => {
    setExporting(true);
    try {
      const response = await adminApi.get('/reports/customers/export/xlsx', { params, responseType: 'blob' });
      downloadBlob(response.data, `customers-${range.dateFrom}-${range.dateTo}.xlsx`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setExporting(false);
    }
  };

  const branchName = branches.find((item) => String(item.id) === branchId)?.name || branchId;
  const activeFilters = [
    ...(branchId !== 'All' ? [{ key: 'branch', label: `الفرع: ${branchName}`, onRemove: () => onBranchChange('All') }] : []),
    ...(cohort ? [{ key: 'cohort', label: cohort === 'FIRST_KNOWN' ? 'أول نشاط مدفوع مسجل' : 'معروف مدفوعًا سابقًا', onRemove: () => setCohort('') }] : []),
    ...(recency ? [{ key: 'recency', label: `الحداثة: ${recencyLabels[recency]}`, onRemove: () => setRecency('') }] : []),
    ...(repeatFilter ? [{ key: 'repeat', label: repeatFilter === 'BEHAVIORAL' ? 'تكرار بأيام مميزة' : repeatFilter === 'TRANSACTION' ? 'تكرار فواتير' : 'دون تكرار سلوكي', onRemove: () => setRepeatFilter('') }] : []),
    ...(categoryId ? [{ key: 'category', label: `الفئة: ${data?.filter_options.categories.find((item) => String(item.id) === categoryId)?.name || categoryId}`, onRemove: () => setCategoryId('') }] : []),
    ...(serviceId ? [{ key: 'service', label: `الخدمة: ${data?.filter_options.services.find((item) => String(item.id) === serviceId)?.name || serviceId}`, onRemove: () => setServiceId('') }] : []),
    ...(productId ? [{ key: 'product', label: `المنتج: ${data?.filter_options.products.find((item) => String(item.id) === productId)?.name || productId}`, onRemove: () => setProductId('') }] : []),
    ...(barberId ? [{ key: 'barber', label: `المصفف: ${data?.filter_options.barbers.find((item) => String(item.id) === barberId)?.name || barberId}`, onRemove: () => setBarberId('') }] : []),
    ...(promoCode ? [{ key: 'promo', label: `البرومو: ${promoCode}`, onRemove: () => setPromoCode('') }] : []),
  ];

  const rows = data?.table.items || [];
  const recencyValues = data ? (Object.entries(data.recency_distribution) as Array<[CustomerRecencyBucket, number]>).map(([key, value]) => ({ label: recencyLabels[key], value })) : [];
  const frequencyValues = data ? Object.entries(data.frequency_distribution).map(([key, value]) => ({ label: frequencyLabels[key], value })) : [];

  return <div className="space-y-6">
    <ReportFilterBar isDarkMode={isDarkMode} range={range} preset={preset} branchId={branchId} branches={branches} onRangeChange={onRangeChange} onPresetChange={onPresetChange} onBranchChange={onBranchChange} onExport={exportReport} exporting={exporting}>
      <select aria-label="فئة العميل المسجلة" value={cohort} onChange={(event) => setCohort(event.target.value as CustomerCohort | '')} className={`${selectClass(isDarkMode)} min-w-44`}><option value="">كل الفئات التاريخية</option><option value="FIRST_KNOWN">أول نشاط مدفوع مسجل</option><option value="PREVIOUSLY_KNOWN">معروف مدفوعًا سابقًا</option></select>
      <select aria-label="تكرار النشاط" value={repeatFilter} onChange={(event) => setRepeatFilter(event.target.value as CustomerRepeatFilter | '')} className={`${selectClass(isDarkMode)} min-w-40`}><option value="">كل أنماط التكرار</option><option value="BEHAVIORAL">تكرار بأيام مميزة</option><option value="TRANSACTION">تكرار فواتير</option><option value="NON_REPEAT">دون تكرار سلوكي</option></select>
      <select aria-label="حد عدم النشاط" value={dormancyDays} onChange={(event) => setDormancyDays(event.target.value)} className={`${selectClass(isDarkMode)} min-w-40`}>{(data?.filter_options.dormancy_options || [30, 60, 90, 180]).map((days) => <option key={days} value={days}>دون نشاط لأكثر من {days} يومًا</option>)}</select>
    </ReportFilterBar>

    <section className={`${panelClass(isDarkMode)} p-3 sm:p-4`} aria-label="فلاتر سلوك العميل">
      <div className="flex flex-wrap gap-2">
        <select aria-label="شريحة الحداثة" value={recency} onChange={(event) => setRecency(event.target.value as CustomerRecencyBucket | '')} className={selectClass(isDarkMode)}><option value="">كل شرائح الحداثة</option>{Object.entries(recencyLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select aria-label="فئة الخدمة" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setServiceId(''); }} className={selectClass(isDarkMode)}><option value="">كل فئات الخدمات</option>{data?.filter_options.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label="الخدمة" value={serviceId} onChange={(event) => setServiceId(event.target.value)} className={selectClass(isDarkMode)}><option value="">كل الخدمات</option>{data?.filter_options.services.filter((item) => !categoryId || String(item.category_id) === categoryId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label="المنتج" value={productId} onChange={(event) => setProductId(event.target.value)} className={selectClass(isDarkMode)}><option value="">كل المنتجات</option>{data?.filter_options.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label="المصفف" value={barberId} onChange={(event) => setBarberId(event.target.value)} className={selectClass(isDarkMode)}><option value="">كل المصففين</option>{data?.filter_options.barbers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label="كود البرومو" value={promoCode} onChange={(event) => setPromoCode(event.target.value)} className={selectClass(isDarkMode)}><option value="">كل أكواد البرومو</option>{data?.filter_options.promo_codes.map((code) => <option key={code} value={code}>{code}</option>)}</select>
      </div>
    </section>
    <ActiveFilters filters={activeFilters} isDarkMode={isDarkMode} />

    {error && data ? <div className="rounded-xl border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-xs font-bold text-red-500">{error}</div> : null}
    {loading && !data ? <ReportLoading isDarkMode={isDarkMode} /> : error && !data ? <ReportError isDarkMode={isDarkMode} message={error} onRetry={fetchReport} /> : data ? <>
      <section className={`${panelClass(isDarkMode)} overflow-hidden p-6 sm:p-8`}>
        <div className="grid gap-8 xl:grid-cols-[1.25fr_1.75fr] xl:items-end">
          <div>
            <div className="mb-5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-[#E53935]"><UsersRound size={15} /> Customer intelligence</div>
            <p className={`mb-2 text-xs font-bold ${mutedText(isDarkMode)}`}>صافي الإنفاق المرتبط بسجلات عملاء معروفة</p>
            <h2 className="text-4xl font-black tracking-tight sm:text-6xl">{formatCompactCurrency(data.summary.identified_net_spend)}</h2>
            <div className="mt-4"><ComparisonLine comparison={data.comparison.identified_net_spend} isDarkMode={isDarkMode} formatter={formatCurrency} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard dark={isDarkMode} label="سجلات بنشاط مدفوع" value={`${formatNumber(data.summary.identified_customers)} سجل`} comparison={data.comparison.identified_customers} />
            <SummaryCard dark={isDarkMode} label="الفواتير المدفوعة المعروفة" value={`${formatNumber(data.summary.paid_invoice_count)} فاتورة`} comparison={data.comparison.paid_invoice_count} />
            <SummaryCard dark={isDarkMode} label="متوسط الفاتورة" value={data.summary.average_ticket === null ? 'غير متاح' : formatCurrency(data.summary.average_ticket)} comparison={data.comparison.average_ticket} />
            <SummaryCard dark={isDarkMode} label="تكرار على أيام دفع مميزة" value={`${formatNumber(data.summary.repeat_share)}%`} comparison={data.comparison.repeat_share} />
          </div>
        </div>
      </section>

      <section className={`${panelClass(isDarkMode)} p-5 sm:p-6`}>
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr_1fr] lg:items-center">
          <div><p className="text-sm font-black">مقاييس العملاء تغطي {formatNumber(data.coverage.identified_invoice_share)}% من الفواتير المدفوعة في الفترة.</p><p className={`mt-2 text-[11px] leading-6 ${mutedText(isDarkMode)}`}>الهوية هي سجل عميل داخل الفرع. الفواتير المجهولة تبقى في تقارير المبيعات ولا تدخل تحليل العملاء.</p></div>
          <MetricLine label="فواتير مجهولة" value={formatNumber(data.coverage.anonymous_invoice_count)} isDarkMode={isDarkMode} />
          <MetricLine label="حصة صافي المبيعات المعروفة" value={`${formatNumber(data.coverage.identified_net_sales_share)}%`} isDarkMode={isDarkMode} />
        </div>
      </section>

      <InsightStrip insights={data.insights} isDarkMode={isDarkMode} />

      <section className="grid gap-6 xl:grid-cols-3">
        <div className={`${panelClass(isDarkMode)} p-5 sm:p-7`}><div className="mb-5 flex items-center gap-2"><UserRoundSearch size={17} className="text-[#E53935]"/><h3 className="font-black">السجل الأول مقابل المعروف سابقًا</h3></div><MetricLine label="أول نشاط مدفوع مسجل" value={formatNumber(data.cohorts.first_known)} isDarkMode={isDarkMode}/><MetricLine label="معروف مدفوعًا سابقًا" value={formatNumber(data.cohorts.previously_known)} isDarkMode={isDarkMode}/><p className={`mt-4 text-[10px] leading-5 ${mutedText(isDarkMode)}`}>التصنيف يعتمد على أول فاتورة مدفوعة موجودة في التاريخ المخزن، ولا يثبت اكتساب عميل جديد.</p></div>
        <div className={`${panelClass(isDarkMode)} p-5 sm:p-7`}><div className="mb-5 flex items-center gap-2"><CalendarClock size={17} className="text-[#E53935]"/><h3 className="font-black">الحداثة حتى {formatShortDate(data.meta.date_to)}</h3></div><DistributionBars values={recencyValues} dark={isDarkMode}/></div>
        <div className={`${panelClass(isDarkMode)} p-5 sm:p-7`}><div className="mb-5 flex items-center gap-2"><Repeat2 size={17} className="text-[#E53935]"/><h3 className="font-black">تكرار تواريخ الدفع</h3></div><DistributionBars values={frequencyValues} dark={isDarkMode}/><p className={`mt-4 text-[10px] ${mutedText(isDarkMode)}`}>المقياس يستخدم تواريخ دفع مميزة ولا يمثل عدد الزيارات الفعلية.</p></div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <div className={`${panelClass(isDarkMode)} p-5 sm:p-7`}>
          <div className="mb-5"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E53935]">القيمة المسجلة</p><h3 className="mt-2 text-lg font-black">أعلى صافي إنفاق في الفترة</h3></div>
          <div className="space-y-3">{data.rankings.selected_period_net_spend.slice(0, 6).map((row, index) => <button key={row.customer_id} type="button" onClick={() => setSelectedCustomer(row.customer_id)} className={`grid w-full grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-2xl border p-4 text-right ${isDarkMode ? 'border-white/[0.07]' : 'border-black/[0.07]'}`}><span className={mutedText(isDarkMode)}>{index + 1}</span><span><strong className="block text-xs">{row.customer_name}</strong><small className={mutedText(isDarkMode)}>{row.record_branch_name} · {row.paid_date_count} تاريخ دفع</small></span><strong className="text-sm">{formatCurrency(row.net_spend)}</strong></button>)}{!data.rankings.selected_period_net_spend.length ? <EmptyBlock isDarkMode={isDarkMode}/> : null}</div>
        </div>
        <div className={`${panelClass(isDarkMode)} p-5 sm:p-7`}>
          <div className="mb-5"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E53935]">التركّز</p><h3 className="mt-2 text-lg font-black">حصة أعلى سجلات العملاء</h3></div>
          <MetricLine label="أعلى سجل" value={`${formatNumber(data.concentration.top_one_share)}%`} isDarkMode={isDarkMode}/><MetricLine label="أعلى 5 سجلات" value={`${formatNumber(data.concentration.top_five_share)}%`} isDarkMode={isDarkMode}/><MetricLine label="أعلى 10 سجلات" value={`${formatNumber(data.concentration.top_ten_share)}%`} isDarkMode={isDarkMode}/>
          <div className={`mt-5 rounded-2xl p-4 ${isDarkMode ? 'bg-white/[0.025]' : 'bg-black/[0.025]'}`}><p className="text-xs font-black">{formatNumber(data.dormancy.dormant_count)} سجل معروف حتى نهاية الفترة</p><p className={`mt-2 text-[10px] leading-5 ${mutedText(isDarkMode)}`}>دون نشاط مدفوع مسجل لأكثر من {data.dormancy.threshold_days} يومًا. هذا وصف زمني فقط.</p></div>
          <div className="mt-4 space-y-2">{data.dormancy.customers.slice(0, 4).map((row) => <button key={row.customer_id} type="button" onClick={() => setSelectedCustomer(row.customer_id)} className={`flex w-full items-center justify-between gap-3 rounded-xl p-3 text-right ${isDarkMode ? 'hover:bg-white/[0.04]' : 'hover:bg-black/[0.03]'}`}><span><strong className="block text-xs">{row.customer_name}</strong><small className={mutedText(isDarkMode)}>{row.recency_days} يومًا منذ آخر دفع</small></span><span className="text-xs font-black">{formatCurrency(row.recorded_lifetime_net_spend)}</span></button>)}</div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <PreferencePanel dark={isDarkMode} icon={<Scissors size={17}/>} title="الخدمات الأكثر تسجيلًا" items={data.preferences.services.slice(0, 6).map((item) => ({ id: item.service_id, label: item.service_name, value: `${formatNumber(item.units)} وحدة`, detail: formatCurrency(item.gross_value), action: () => setServiceId(String(item.service_id)) }))}/>
        <PreferencePanel dark={isDarkMode} icon={<Package size={17}/>} title="المنتجات الأكثر تسجيلًا" items={data.preferences.products.slice(0, 6).map((item) => ({ id: item.product_id, label: item.product_name, value: `${formatNumber(item.units)} وحدة`, detail: formatCurrency(item.gross_value), action: () => setProductId(String(item.product_id)) }))}/>
        <PreferencePanel dark={isDarkMode} icon={<UsersRound size={17}/>} title="المصففون في نشاط الخدمات" items={data.preferences.barbers.slice(0, 6).map((item) => ({ id: item.barber_id, label: item.barber_name, value: `${formatNumber(item.service_units)} وحدة`, detail: `${formatNumber(item.customer_count)} سجل عميل`, action: () => setBarberId(String(item.barber_id)) }))}/>
      </section>

      <section className={`${panelClass(isDarkMode)} p-5 sm:p-7`}>
        <div className="mb-5"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E53935]">تقسيمات شفافة</p><h3 className="mt-2 text-lg font-black">قواعد سلوكية معلنة</h3></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{data.segments.map((segment) => <div key={segment.code} className={`rounded-2xl border p-4 ${isDarkMode ? 'border-white/[0.07]' : 'border-black/[0.07]'}`}><p className="text-xl font-black">{formatNumber(segment.count)}</p><p className="mt-2 text-xs font-black">{segment.label}</p><p className={`mt-2 text-[9px] leading-5 ${mutedText(isDarkMode)}`}>{segment.rule}</p></div>)}</div>
      </section>

      <AttentionList items={data.attention} isDarkMode={isDarkMode} onEntity={setSelectedCustomer}/>

      <section className={`${panelClass(isDarkMode)} overflow-hidden p-5 sm:p-7`}>
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E53935]">التفاصيل</p><h3 className="mt-2 text-lg font-black">مقارنة سجلات العملاء ذات النشاط المدفوع</h3></div><div className="flex flex-wrap gap-2"><div className="relative"><Search size={14} className={`absolute right-3 top-3 ${mutedText(isDarkMode)}`}/><input aria-label="بحث باسم العميل أو الهاتف" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث باسم العميل أو الهاتف" className={`${selectClass(isDarkMode)} w-60 pr-9`}/></div><select aria-label="ترتيب العملاء" value={sortBy} onChange={(event) => setSortBy(event.target.value as CustomerSort)} className={selectClass(isDarkMode)}>{sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1150px] text-right text-xs"><thead><tr className={`border-b ${isDarkMode ? 'border-white/[0.07] text-white/40' : 'border-black/[0.07] text-black/40'}`}><th className="px-3 py-3">العميل</th><th className="px-3 py-3">فرع السجل</th><th className="px-3 py-3">صافي الفترة</th><th className="px-3 py-3">الفواتير</th><th className="px-3 py-3">تواريخ الدفع</th><th className="px-3 py-3">متوسط الفاتورة</th><th className="px-3 py-3">آخر دفع</th><th className="px-3 py-3">الفئة</th><th className="px-3 py-3">أعلى خدمة</th><th className="px-3 py-3">صافي العمر المسجل</th><th className="px-3 py-3">التفاصيل</th></tr></thead><tbody>{rows.map((row) => <CustomerTableRow key={row.customer_id} row={row} dark={isDarkMode} onOpen={setSelectedCustomer}/>)}</tbody></table></div>
        {!rows.length ? <EmptyBlock isDarkMode={isDarkMode}/> : null}
        <PaginationControls pagination={data.table.pagination} isDarkMode={isDarkMode} onPage={setPage}/>
      </section>
    </> : null}

    {selectedCustomer ? <ReportDrawer isDarkMode={isDarkMode} title={drilldown?.customer.customer_name || 'تفاصيل سجل العميل'} subtitle="تحليل مدفوع مسجل داخل نطاق الفرع" onClose={() => setSelectedCustomer(null)}>{drillLoading || !drilldown ? <ReportLoading isDarkMode={isDarkMode}/> : <CustomerDrawer data={drilldown} dark={isDarkMode}/>}</ReportDrawer> : null}
  </div>;
};

const SummaryCard: React.FC<{ dark: boolean; label: string; value: string; comparison: CustomerReportData['comparison'][string] }> = ({ dark, label, value, comparison }) => <div className={`rounded-2xl p-4 ${dark ? 'bg-white/[0.025]' : 'bg-black/[0.025]'}`}><p className={`text-[10px] leading-5 ${mutedText(dark)}`}>{label}</p><p className="mt-2 text-lg font-black">{value}</p><p className={`mt-2 text-[9px] ${mutedText(dark)}`}>{comparison.percent_change === null ? 'لا توجد قاعدة مقارنة' : `${comparison.percent_change > 0 ? '+' : ''}${formatNumber(comparison.percent_change)}% عن السابق`}</p></div>;

const PreferencePanel: React.FC<{ dark: boolean; icon: React.ReactNode; title: string; items: Array<{ id: number; label: string; value: string; detail: string; action: () => void }> }> = ({ dark, icon, title, items }) => <div className={`${panelClass(dark)} p-5 sm:p-7`}><div className="mb-5 flex items-center gap-2 text-[#E53935]">{icon}<h3 className="text-sm font-black text-current">{title}</h3></div><div className="space-y-2">{items.map((item) => <button key={item.id} type="button" onClick={item.action} className={`flex w-full items-center justify-between gap-3 rounded-xl p-3 text-right transition ${dark ? 'hover:bg-white/[0.04]' : 'hover:bg-black/[0.03]'}`}><span><strong className="block text-xs">{item.label}</strong><small className={mutedText(dark)}>{item.detail}</small></span><span className="text-xs font-black">{item.value}</span></button>)}{!items.length ? <EmptyBlock isDarkMode={dark}/> : null}</div></div>;

const CustomerTableRow: React.FC<{ row: CustomerReportRow; dark: boolean; onOpen: (id: number) => void }> = ({ row, dark, onOpen }) => <tr className={`border-b last:border-0 ${dark ? 'border-white/[0.05]' : 'border-black/[0.05]'}`}><td className="px-3 py-4"><p className="font-black">{row.customer_name}</p><p className={`mt-1 text-[9px] ${mutedText(dark)}`}>{row.operational_status === 'ACTIVE' ? 'نشط تشغيليًا' : 'غير نشط تشغيليًا'}</p></td><td className="px-3 py-4">{row.record_branch_name}</td><td className="px-3 py-4 font-black">{formatCurrency(row.net_spend)}</td><td className="px-3 py-4">{formatNumber(row.paid_invoice_count)}{row.transaction_repeat ? <span className="mr-1 text-[9px] text-[#E53935]">متكرر</span> : null}</td><td className="px-3 py-4">{formatNumber(row.paid_date_count)}{row.behavioral_repeat ? <span className="mr-1 text-[9px] text-emerald-500">أيام مميزة</span> : null}</td><td className="px-3 py-4">{row.average_ticket === null ? 'غير متاح' : formatCurrency(row.average_ticket)}{row.low_base ? <p className="mt-1 text-[9px] text-amber-500">عينة محدودة</p> : null}</td><td className="px-3 py-4">{row.last_paid_date ? formatShortDate(row.last_paid_date) : '—'}<p className={`mt-1 text-[9px] ${mutedText(dark)}`}>{row.recency_days ?? '—'} يوم</p></td><td className="px-3 py-4">{row.cohort === 'FIRST_KNOWN' ? 'أول نشاط مسجل' : 'معروف سابقًا'}</td><td className="px-3 py-4">{row.top_service?.service_name || '—'}</td><td className="px-3 py-4">{formatCurrency(row.recorded_lifetime_net_spend)}</td><td className="px-3 py-4"><button type="button" aria-label={`تفاصيل ${row.customer_name}`} onClick={() => onOpen(row.customer_id)} className="rounded-lg border border-current/10 p-2"><Eye size={14}/></button></td></tr>;

const CustomerDrawer: React.FC<{ data: CustomerDrilldown; dark: boolean }> = ({ data, dark }) => {
  const row = data.customer;
  return <div className="space-y-5">
    <section className={`${panelClass(dark)} p-5`}><p className="mb-4 text-[10px] font-black uppercase tracking-[0.18em] text-[#E53935]">هوية سجل الفرع</p><MetricLine label="الهاتف" value={row.phone || 'غير مسجل'} isDarkMode={dark}/><MetricLine label="فرع السجل الحالي" value={row.record_branch_name} isDarkMode={dark}/><MetricLine label="الحالة التشغيلية" value={row.operational_status === 'ACTIVE' ? 'نشط' : 'غير نشط'} isDarkMode={dark}/><p className={`mt-4 text-[10px] leading-5 ${mutedText(dark)}`}>هذا سجل هوية داخل الفرع ولا يتم دمجه مع أرقام مماثلة في فروع أخرى.</p></section>
    <section className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">نشاط الفترة</h3><MetricLine label="صافي الإنفاق" value={formatCurrency(row.net_spend)} isDarkMode={dark}/><MetricLine label="فواتير مدفوعة" value={formatNumber(row.paid_invoice_count)} isDarkMode={dark}/><MetricLine label="تواريخ دفع مميزة" value={formatNumber(row.paid_date_count)} isDarkMode={dark}/><MetricLine label="متوسط الفاتورة" value={row.average_ticket === null ? 'غير متاح' : formatCurrency(row.average_ticket)} isDarkMode={dark}/><MetricLine label="الحداثة" value={row.recency_days === null ? 'غير متاح' : `${formatNumber(row.recency_days)} يوم`} isDarkMode={dark}/><MetricLine label="متوسط الفاصل بين أيام الدفع" value={row.average_paid_day_interval === null ? 'غير متاح' : `${formatNumber(row.average_paid_day_interval)} يوم`} isDarkMode={dark}/></section>
    <section className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">العمر المسجل حتى نهاية الفترة</h3><MetricLine label="أول تاريخ دفع مسجل" value={row.first_paid_date ? formatShortDate(row.first_paid_date) : 'غير متاح'} isDarkMode={dark}/><MetricLine label="آخر تاريخ دفع مسجل" value={row.last_paid_date ? formatShortDate(row.last_paid_date) : 'غير متاح'} isDarkMode={dark}/><MetricLine label="صافي العمر المسجل" value={formatCurrency(row.recorded_lifetime_net_spend)} isDarkMode={dark}/><MetricLine label="فواتير العمر المسجل" value={formatNumber(row.lifetime_paid_invoice_count)} isDarkMode={dark}/><MetricLine label="أيام الدفع المسجلة" value={formatNumber(row.lifetime_paid_date_count)} isDarkMode={dark}/><MetricLine label="متوسط فاصل العمر المسجل" value={data.lifetime_average_paid_day_interval === null ? 'غير متاح' : `${formatNumber(data.lifetime_average_paid_day_interval)} يوم`} isDarkMode={dark}/></section>
    <section className="grid gap-5 md:grid-cols-2"><div className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">الخدمات والفئات</h3>{row.service_preferences.map((item) => <MetricLine key={item.service_id} label={`${item.service_name} · ${item.units} وحدة`} value={formatCurrency(item.gross_value)} isDarkMode={dark}/>)}{!row.service_preferences.length ? <EmptyBlock isDarkMode={dark}/> : null}</div><div className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">المنتجات</h3>{row.product_preferences.map((item) => <MetricLine key={item.product_id} label={`${item.product_name} · ${item.units} وحدة`} value={formatCurrency(item.gross_value)} isDarkMode={dark}/>)}{!row.product_preferences.length ? <EmptyBlock isDarkMode={dark}/> : null}</div></section>
    <section className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">ألفة المصفف المسجلة</h3>{row.barber_affinity.map((item) => <MetricLine key={item.barber_id} label={`${item.barber_name} · ${item.service_units} وحدة`} value={item.eligible ? `${formatNumber(item.affinity_share)}%` : 'عينة محدودة'} isDarkMode={dark}/>)}{!row.barber_affinity.length ? <EmptyBlock isDarkMode={dark}/> : null}<p className={`mt-4 text-[10px] leading-5 ${mutedText(dark)}`}>الحصة مبنية على وحدات الخدمات المسندة، وتبقى الوحدات غير المسندة داخل المقام.</p></section>
    <section className="grid gap-5 md:grid-cols-3"><div className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">المواعيد</h3><MetricLine label="مجدولة" value={formatNumber(row.appointments.scheduled)} isDarkMode={dark}/><MetricLine label="مكتملة" value={formatNumber(row.appointments.completed)} isDarkMode={dark}/><MetricLine label="ملغاة" value={formatNumber(row.appointments.cancelled)} isDarkMode={dark}/><MetricLine label="مستقبلية" value={formatNumber(row.appointments.future_scheduled)} isDarkMode={dark}/></div><div className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">البرومو</h3><MetricLine label="استردادات مدفوعة" value={formatNumber(row.promo.redemption_count)} isDarkMode={dark}/><MetricLine label="خصم البرومو" value={formatCurrency(row.promo.promo_discount_amount)} isDarkMode={dark}/>{data.promo_codes.map((item) => <MetricLine key={item.code} label={item.code} value={`${item.redemption_count} استخدام`} isDarkMode={dark}/>)}</div><div className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">العربون المسجل</h3><MetricLine label="تحصيلات الفترة" value={formatCurrency(row.deposits.collection_amount)} isDarkMode={dark}/><MetricLine label="الرصيد الحالي المسجل" value={formatCurrency(row.recorded_current_deposit_balance)} isDarkMode={dark}/>{data.deposit_methods.map((item) => <MetricLine key={item.method} label={paymentLabels[item.method] || item.method} value={formatCurrency(item.collection_amount)} isDarkMode={dark}/>)}<p className={`mt-3 text-[9px] leading-5 ${mutedText(dark)}`}>العربون سياق مالي منفصل ولا يدخل صافي إنفاق العميل.</p></div></section>
    <section className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">الفواتير المدفوعة في الفترة</h3><div className="space-y-2">{data.paid_activity.map((invoice) => <div key={invoice.invoice_id} className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${dark ? 'border-white/[0.07]' : 'border-black/[0.07]'}`}><span><strong className="block text-xs">فاتورة {invoice.invoice_number}</strong><small className={mutedText(dark)}>{formatShortDate(invoice.date)} · {invoice.branch_name}</small></span><span className="text-xs font-black">{formatCurrency(invoice.net)}</span></div>)}{!data.paid_activity.length ? <EmptyBlock isDarkMode={dark}/> : null}</div></section>
  </div>;
};

export default CustomersReport;
