import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Banknote, CalendarDays, Clock3, Eye, Package, Scissors, Search, UserRoundCheck, UsersRound, WalletCards } from 'lucide-react';
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
import type { CashierEmployeeRow, EmployeeDrilldown, EmployeeReportData, EmployeeReportMode, NamedOption, ReportDateRange, ServiceEmployeeRow } from './types';

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

type ServiceSort = 'gross_service_value' | 'service_units' | 'service_commission_accrued' | 'identified_customer_count' | 'average_gross_per_unit' | 'attendance_hours' | 'growth';
type CashierSort = 'net_sales_finalized' | 'paid_invoices_finalized' | 'average_ticket_finalized' | 'business_days_closed' | 'deposit_collections';

const modeOptions: Array<{ value: EmployeeReportMode; label: string; detail: string }> = [
  { value: 'BARBER', label: 'المصففون', detail: 'نشاط الخدمات المسند' },
  { value: 'ASSISTANT', label: 'المساعدون', detail: 'المشاركة في الخدمات' },
  { value: 'CASHIER', label: 'عمليات الكاشير', detail: 'الفواتير المحصلة والتشغيل' },
];

const serviceSortOptions: Array<{ value: ServiceSort; label: string }> = [
  { value: 'gross_service_value', label: 'القيمة الإجمالية المسندة' },
  { value: 'service_units', label: 'وحدات الخدمة' },
  { value: 'service_commission_accrued', label: 'العمولة المستحقة المسجلة' },
  { value: 'identified_customer_count', label: 'العملاء المعروفون' },
  { value: 'average_gross_per_unit', label: 'متوسط القيمة للوحدة' },
  { value: 'attendance_hours', label: 'ساعات الحضور المكتملة' },
  { value: 'growth', label: 'التغير عن الفترة السابقة' },
];

const cashierSortOptions: Array<{ value: CashierSort; label: string }> = [
  { value: 'net_sales_finalized', label: 'صافي المبيعات المعالجة' },
  { value: 'paid_invoices_finalized', label: 'الفواتير المحصلة' },
  { value: 'average_ticket_finalized', label: 'متوسط الفاتورة' },
  { value: 'business_days_closed', label: 'أيام العمل المغلقة' },
  { value: 'deposit_collections', label: 'تحصيلات العربون' },
];

const selectClass = (dark: boolean) => `h-10 rounded-xl border px-3 text-xs font-bold outline-none ${dark ? 'border-white/10 bg-white/[0.04] text-white' : 'border-black/10 bg-[#FAFAFA] text-[#171717]'}`;
const isCashierRow = (row: ServiceEmployeeRow | CashierEmployeeRow): row is CashierEmployeeRow => 'net_sales_finalized' in row;

const downloadBlob = (data: Blob, filename: string) => {
  const href = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
};

const paymentLabel: Record<string, string> = { CASH: 'نقدي', VISA: 'فيزا', INSTAPAY: 'إنستا باي' };

const EmployeesReport: React.FC<Props> = ({ isDarkMode, range, preset, branchId, branches, onRangeChange, onPresetChange, onBranchChange }) => {
  const [mode, setMode] = useState<EmployeeReportMode>('BARBER');
  const [data, setData] = useState<EmployeeReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<string>('gross_service_value');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<number | null>(null);
  const [drilldown, setDrilldown] = useState<EmployeeDrilldown | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const params = useMemo(() => ({
    date_from: range.dateFrom,
    date_to: range.dateTo,
    branch_id: branchId === 'All' ? undefined : branchId,
    employee_mode: mode,
    employee_id: employeeId || undefined,
    service_id: mode === 'CASHIER' ? undefined : serviceId || undefined,
    category_id: mode === 'CASHIER' ? undefined : categoryId || undefined,
    search: search || undefined,
    sort_by: sortBy,
    sort_dir: 'desc',
    page,
    per_page: 12,
  }), [range, branchId, mode, employeeId, serviceId, categoryId, search, sortBy, page]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get<EmployeeReportData>('/reports/employees', { params });
      setData(response.data);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { void fetchReport(); }, [fetchReport]);
  useEffect(() => { setPage(1); setSelectedEmployee(null); setDrilldown(null); }, [range, branchId, mode, employeeId, serviceId, categoryId, search, sortBy]);
  useEffect(() => {
    if (!selectedEmployee) {
      setDrilldown(null);
      return;
    }
    const load = async () => {
      setDrillLoading(true);
      try {
        const response = await adminApi.get<EmployeeDrilldown>(`/reports/employees/${selectedEmployee}`, { params });
        setDrilldown(response.data);
      } catch (requestError) {
        setError(errorMessage(requestError));
        setSelectedEmployee(null);
      } finally {
        setDrillLoading(false);
      }
    };
    void load();
  }, [selectedEmployee, params]);

  const changeMode = (nextMode: EmployeeReportMode) => {
    setData(null);
    setMode(nextMode);
    setEmployeeId('');
    setServiceId('');
    setCategoryId('');
    setSearch('');
    setSortBy(nextMode === 'CASHIER' ? 'net_sales_finalized' : 'gross_service_value');
  };

  const exportReport = async () => {
    setExporting(true);
    try {
      const response = await adminApi.get('/reports/employees/export/xlsx', { params, responseType: 'blob' });
      downloadBlob(response.data, `employees-${mode.toLowerCase()}-${range.dateFrom}-${range.dateTo}.xlsx`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setExporting(false);
    }
  };

  const employees = data?.table.items || [];
  const serviceRows = employees.filter((row): row is ServiceEmployeeRow => !isCashierRow(row));
  const cashierRows = employees.filter(isCashierRow);
  const referenceServiceEmployee = serviceRows[0] || null;
  const sortOptions = mode === 'CASHIER' ? cashierSortOptions : serviceSortOptions;
  const branchName = branches.find((item) => String(item.id) === branchId)?.name || branchId;
  const activeFilters = [
    ...(branchId !== 'All' ? [{ key: 'branch', label: `الفرع: ${branchName}`, onRemove: () => onBranchChange('All') }] : []),
    ...(employeeId ? [{ key: 'employee', label: `الموظف: ${data?.filter_options.employees.find((item) => String(item.id) === employeeId)?.name || employeeId}`, onRemove: () => setEmployeeId('') }] : []),
    ...(serviceId ? [{ key: 'service', label: `الخدمة: ${data?.filter_options.services.find((item) => String(item.id) === serviceId)?.name || serviceId}`, onRemove: () => setServiceId('') }] : []),
    ...(categoryId ? [{ key: 'category', label: `الفئة: ${data?.filter_options.categories.find((item) => String(item.id) === categoryId)?.name || categoryId}`, onRemove: () => setCategoryId('') }] : []),
  ];

  const trendKey = mode === 'CASHIER' ? 'net_sales_finalized' : 'gross_service_value';
  const trendLabel = mode === 'CASHIER' ? 'صافي المبيعات المعالجة' : mode === 'BARBER' ? 'قيمة الخدمات المسندة' : 'قيمة الخدمات المشارك بها';

  return (
    <div className="space-y-6">
      <section className={`${panelClass(isDarkMode)} p-2`} aria-label="نوع تحليل الموظفين">
        <div className="grid gap-2 md:grid-cols-3">
          {modeOptions.map((option) => (
            <button key={option.value} type="button" onClick={() => changeMode(option.value)} className={`rounded-2xl px-4 py-3 text-right transition ${mode === option.value ? 'bg-[#E53935] text-white shadow-lg shadow-red-500/20' : isDarkMode ? 'hover:bg-white/[0.04]' : 'hover:bg-black/[0.03]'}`}>
              <span className="block text-sm font-black">{option.label}</span>
              <span className={`mt-1 block text-[10px] ${mode === option.value ? 'text-white/70' : mutedText(isDarkMode)}`}>{option.detail}</span>
            </button>
          ))}
        </div>
      </section>

      <ReportFilterBar isDarkMode={isDarkMode} range={range} preset={preset} branchId={branchId} branches={branches} onRangeChange={onRangeChange} onPresetChange={onPresetChange} onBranchChange={onBranchChange} onExport={exportReport} exporting={exporting}>
        <select aria-label="الموظف" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className={`${selectClass(isDarkMode)} min-w-40`}><option value="">كل الموظفين</option>{data?.filter_options.employees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        {mode !== 'CASHIER' ? <>
          <select aria-label="فئة الخدمة" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setServiceId(''); }} className={`${selectClass(isDarkMode)} min-w-36`}><option value="">كل الفئات</option>{data?.filter_options.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select aria-label="الخدمة" value={serviceId} onChange={(event) => setServiceId(event.target.value)} className={`${selectClass(isDarkMode)} min-w-40`}><option value="">كل الخدمات</option>{data?.filter_options.services.filter((item) => !categoryId || String(item.category_id) === categoryId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </> : null}
      </ReportFilterBar>
      <ActiveFilters filters={activeFilters} isDarkMode={isDarkMode} />

      {error && data ? <div className="rounded-xl border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-xs font-bold text-red-500">{error}</div> : null}
      {loading && !data ? <ReportLoading isDarkMode={isDarkMode} /> : error && !data ? <ReportError isDarkMode={isDarkMode} message={error} onRetry={fetchReport} /> : data ? <>
        <section className={`${panelClass(isDarkMode)} overflow-hidden p-6 sm:p-8`}>
          <div className="grid gap-8 xl:grid-cols-[1.25fr_1.75fr] xl:items-end">
            <div>
              <div className="mb-5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-[#E53935]"><UsersRound size={15} /> {modeOptions.find((item) => item.value === mode)?.label}</div>
              <p className={`mb-2 text-xs font-bold ${mutedText(isDarkMode)}`}>{trendLabel}</p>
              <h2 className="text-4xl font-black tracking-tight sm:text-6xl">{formatCompactCurrency(Number(data.summary[trendKey] || 0))}</h2>
              <div className="mt-4"><ComparisonLine comparison={data.comparison[trendKey]} isDarkMode={isDarkMode} formatter={formatCurrency} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(mode === 'CASHIER' ? [
                ['الفواتير المحصلة', data.summary.paid_invoices_finalized, 'فاتورة'],
                ['متوسط الفاتورة', data.summary.average_ticket_finalized, 'currency'],
                ['تحصيلات العربون', data.summary.deposit_collections, 'currency'],
                ['أيام العمل المغلقة', data.summary.business_days_closed, 'يوم'],
              ] : [
                ['وحدات الخدمة', data.summary.service_units, 'وحدة'],
                ['الفواتير المؤهلة', data.summary.paid_invoice_count, 'فاتورة'],
                ['العملاء المعروفون', data.summary.identified_customer_count, 'عميل'],
                ['العمولة المستحقة', data.summary.service_commission_accrued, 'currency'],
              ]).map(([label, value, unit]) => <div key={String(label)} className={`rounded-2xl p-4 ${isDarkMode ? 'bg-white/[0.025]' : 'bg-black/[0.025]'}`}><p className={`text-[10px] leading-5 ${mutedText(isDarkMode)}`}>{label}</p><p className="mt-2 text-lg font-black">{unit === 'currency' ? formatCurrency(Number(value)) : `${formatNumber(Number(value))} ${unit}`}</p></div>)}
            </div>
          </div>
        </section>

        <InsightStrip insights={data.insights} isDarkMode={isDarkMode} />

        <section className={`${panelClass(isDarkMode)} p-5 sm:p-7`}>
          <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E53935]">مقارنة داخل الدور</p><h3 className="mt-2 text-xl font-black">ترتيب وصفي حسب المقياس المختار</h3></div>
            <select aria-label="مقياس ترتيب الموظفين" value={sortBy} onChange={(event) => setSortBy(event.target.value)} className={selectClass(isDarkMode)}>{sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          </div>
          <div className="space-y-3">
            {employees.slice(0, 8).map((row, index) => {
              const value = isCashierRow(row) ? (sortBy === 'business_days_closed' || sortBy === 'deposit_collections' ? row.operations[sortBy] : row[sortBy as keyof Pick<CashierEmployeeRow, 'net_sales_finalized' | 'paid_invoices_finalized' | 'average_ticket_finalized'>]) : sortBy === 'attendance_hours' ? row.attendance.recorded_hours : sortBy === 'growth' ? row.comparison.gross_service_value.percent_change : row[sortBy as keyof Pick<ServiceEmployeeRow, 'gross_service_value' | 'service_units' | 'service_commission_accrued' | 'identified_customer_count' | 'average_gross_per_unit'>];
              const currency = ['gross_service_value', 'service_commission_accrued', 'average_gross_per_unit', 'net_sales_finalized', 'average_ticket_finalized', 'deposit_collections'].includes(sortBy);
              return <div key={row.employee_id} className={`grid gap-3 rounded-2xl border p-4 md:grid-cols-[2rem_minmax(10rem,1fr)_minmax(10rem,1fr)_auto] md:items-center ${isDarkMode ? 'border-white/[0.07]' : 'border-black/[0.07]'}`}>
                <span className={`text-xs font-black ${mutedText(isDarkMode)}`}>{index + 1}</span>
                <button type="button" onClick={() => setEmployeeId(String(row.employee_id))} className="text-right"><span className="text-sm font-black">{row.employee_name}</span><p className={`mt-1 text-[10px] ${mutedText(isDarkMode)}`}>{row.current_status !== 'ACTIVE' ? 'الحالة الحالية: غير نشط' : `الدور الحالي: ${row.current_role || 'غير محدد'}`}</p></button>
                <div><p className="text-sm font-black">{value === null ? 'غير متاح' : sortBy === 'growth' ? `${Number(value) > 0 ? '+' : ''}${formatNumber(Number(value))}%` : currency ? formatCurrency(Number(value)) : formatNumber(Number(value))}</p>{!isCashierRow(row) && row.low_base ? <p className="mt-1 text-[10px] text-amber-500">عينة محدودة</p> : null}</div>
                <button type="button" aria-label={`تفاصيل ${row.employee_name}`} onClick={() => setSelectedEmployee(row.employee_id)} className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}><Eye size={14} /> التفاصيل</button>
              </div>;
            })}
            {!employees.length ? <EmptyBlock isDarkMode={isDarkMode} /> : null}
          </div>
        </section>

        <section className={`${panelClass(isDarkMode)} p-5 sm:p-7`}>
          <div className="mb-5"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E53935]">الاتجاه اليومي</p><h3 className="mt-2 text-lg font-black">{trendLabel}</h3></div>
          <div className="h-72" dir="ltr">
            {data.trend.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={data.trend}><defs><linearGradient id="employeeTrend" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#E53935" stopOpacity={0.28}/><stop offset="95%" stopColor="#E53935" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#ffffff12' : '#00000010'} vertical={false}/><XAxis dataKey="date" tickFormatter={(value) => formatShortDate(value)} tick={{ fontSize: 10, fill: isDarkMode ? '#ffffff66' : '#00000066' }} axisLine={false} tickLine={false}/><YAxis tickFormatter={(value) => formatNumber(value)} tick={{ fontSize: 10, fill: isDarkMode ? '#ffffff66' : '#00000066' }} axisLine={false} tickLine={false}/><Tooltip contentStyle={{ background: isDarkMode ? '#151515' : '#fff', border: '1px solid rgba(128,128,128,.2)', borderRadius: 14 }} formatter={(value) => formatCurrency(Number(value))} labelFormatter={(value) => formatShortDate(String(value))}/><Area type="monotone" dataKey={trendKey} stroke="#E53935" strokeWidth={2.5} fill="url(#employeeTrend)"/></AreaChart></ResponsiveContainer> : <EmptyBlock isDarkMode={isDarkMode} />}
          </div>
        </section>

        {mode !== 'CASHIER' ? <>
          <section className="grid gap-6 xl:grid-cols-2">
            <div className={`${panelClass(isDarkMode)} p-5 sm:p-7`}><div className="mb-5 flex items-center gap-2"><Scissors size={17} className="text-[#E53935]"/><h3 className="font-black">مزيج الخدمات</h3></div>{referenceServiceEmployee ? <><p className={`mb-4 text-[11px] ${mutedText(isDarkMode)}`}>سياق {referenceServiceEmployee.employee_name} · انقر الاسم في المقارنة لتغيير النطاق</p><div className="space-y-4">{referenceServiceEmployee.top_services.map((item) => <button key={item.service_id} type="button" onClick={() => setServiceId(String(item.service_id))} className="block w-full text-right"><div className="mb-2 flex items-center justify-between gap-3"><span className="text-xs font-black">{item.service_name}</span><span className={`text-[10px] ${mutedText(isDarkMode)}`}>{formatNumber(item.share_percent)}% · {formatNumber(item.units)} وحدة</span></div><div className="h-1.5 overflow-hidden rounded-full bg-current/10"><div className="h-full rounded-full bg-[#E53935]" style={{ width: `${Math.min(item.share_percent, 100)}%` }}/></div></button>)}</div></> : <EmptyBlock isDarkMode={isDarkMode}/>}</div>
            <div className={`${panelClass(isDarkMode)} p-5 sm:p-7`}><div className="mb-5 flex items-center gap-2"><WalletCards size={17} className="text-[#E53935]"/><h3 className="font-black">سياق العمولة</h3></div>{referenceServiceEmployee ? <><MetricLine label="عمولة الخدمات المستحقة المسجلة" value={formatCurrency(referenceServiceEmployee.service_commission_accrued)} isDarkMode={isDarkMode}/><MetricLine label="عمولة المنتجات المستحقة" value={formatCurrency(referenceServiceEmployee.products.product_commission_accrued)} isDarkMode={isDarkMode}/><MetricLine label="سحوبات العمولة في الفترة" value={formatCurrency(referenceServiceEmployee.financial_actions.COMMISSION_WITHDRAWAL.amount)} isDarkMode={isDarkMode}/>{referenceServiceEmployee.current_wallet !== null ? <MetricLine label="الرصيد الحالي للمحفظة" value={formatCurrency(referenceServiceEmployee.current_wallet)} isDarkMode={isDarkMode}/> : null}<p className={`mt-4 text-[10px] leading-5 ${mutedText(isDarkMode)}`}>عمولة الخدمة تتبع السلوك المسجل حاليًا: لا تضرب الكمية، وتُستبعد الفواتير المجانية بالكامل. السحب تسوية نقدية منفصلة.</p></> : <EmptyBlock isDarkMode={isDarkMode}/>}</div>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <div className={`${panelClass(isDarkMode)} p-5 sm:p-7`}><div className="mb-5 flex items-center gap-2"><UserRoundCheck size={17} className="text-[#E53935]"/><h3 className="font-black">سياق العملاء</h3></div>{referenceServiceEmployee ? <><MetricLine label="عملاء معروفون مسجلون" value={formatNumber(referenceServiceEmployee.identified_customer_count)} isDarkMode={isDarkMode}/><MetricLine label="تكرار داخل الفترة" value={formatNumber(referenceServiceEmployee.customer_context.repeat_identified_customers)} isDarkMode={isDarkMode}/><MetricLine label="مسجلون سابقًا مع الموظف" value={formatNumber(referenceServiceEmployee.customer_context.previously_recorded_customers)} isDarkMode={isDarkMode}/><p className={`mt-4 text-[10px] leading-5 ${mutedText(isDarkMode)}`}>هوية العميل مرتبطة بالفرع، والفاتورة لا تمثل زيارة دقيقة عند مشاركة أكثر من موظف.</p></> : <EmptyBlock isDarkMode={isDarkMode}/>}</div>
            <div className={`${panelClass(isDarkMode)} p-5 sm:p-7`}><div className="mb-5 flex items-center gap-2"><Clock3 size={17} className="text-[#E53935]"/><h3 className="font-black">سياق الحضور</h3></div>{referenceServiceEmployee ? <><MetricLine label="جلسات مكتملة" value={formatNumber(referenceServiceEmployee.attendance.completed_sessions)} isDarkMode={isDarkMode}/><MetricLine label="أيام حضور مسجلة" value={formatNumber(referenceServiceEmployee.attendance.recorded_workdays)} isDarkMode={isDarkMode}/><MetricLine label="ساعات مكتملة" value={`${formatNumber(referenceServiceEmployee.attendance.recorded_hours)} ساعة`} isDarkMode={isDarkMode}/><MetricLine label="تغطية أيام النشاط" value={`${formatNumber(referenceServiceEmployee.attendance.attendance_coverage)}%`} isDarkMode={isDarkMode}/></> : <EmptyBlock isDarkMode={isDarkMode}/>}</div>
          </section>

          {serviceRows.some((row) => row.products.product_units > 0) ? <section className={`${panelClass(isDarkMode)} p-5 sm:p-7`}><div className="mb-5 flex items-center gap-2"><Package size={17} className="text-[#E53935]"/><h3 className="font-black">بيع المنتجات المسند</h3></div><div className="grid gap-3 md:grid-cols-3">{serviceRows.filter((row) => row.products.product_units > 0).slice(0, 6).map((row) => <button key={row.employee_id} type="button" onClick={() => setSelectedEmployee(row.employee_id)} className={`rounded-2xl border p-4 text-right ${isDarkMode ? 'border-white/[0.07]' : 'border-black/[0.07]'}`}><p className="text-xs font-black">{row.employee_name}</p><p className="mt-3 text-lg font-black">{formatCurrency(row.products.gross_product_value)}</p><p className={`mt-1 text-[10px] ${mutedText(isDarkMode)}`}>{formatNumber(row.products.product_units)} وحدة · عمولة {formatCurrency(row.products.product_commission_accrued)}</p></button>)}</div></section> : null}

          {mode === 'BARBER' && serviceRows.some((row) => row.appointments.assigned > 0) ? <section className={`${panelClass(isDarkMode)} p-5 sm:p-7`}><div className="mb-5 flex items-center gap-2"><CalendarDays size={17} className="text-[#E53935]"/><h3 className="font-black">سياق المواعيد</h3></div><div className="grid gap-3 md:grid-cols-3">{serviceRows.filter((row) => row.appointments.assigned > 0).slice(0, 6).map((row) => <button key={row.employee_id} type="button" onClick={() => setSelectedEmployee(row.employee_id)} className={`rounded-2xl border p-4 text-right ${isDarkMode ? 'border-white/[0.07]' : 'border-black/[0.07]'}`}><p className="text-xs font-black">{row.employee_name}</p><p className="mt-3 text-lg font-black">{formatNumber(row.appointments.assigned)} موعد</p><p className={`mt-1 text-[10px] ${mutedText(isDarkMode)}`}>{row.appointments.completed} مكتمل · {row.appointments.cancelled} ملغي · {row.appointments.with_deposit} بعربون</p></button>)}</div></section> : null}
        </> : <section className="grid gap-6 xl:grid-cols-2">
          <div className={`${panelClass(isDarkMode)} p-5 sm:p-7`}><div className="mb-5 flex items-center gap-2"><Banknote size={17} className="text-[#E53935]"/><h3 className="font-black">طرق تحصيل الفواتير</h3></div><div className="space-y-4">{data.payments?.methods.map((item) => <div key={item.method}><div className="mb-2 flex items-center justify-between text-xs"><span className="font-black">{paymentLabel[item.method]}</span><span>{formatCurrency(item.amount)} · {formatNumber(item.share_percent)}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-current/10"><div className="h-full rounded-full bg-[#E53935]" style={{ width: `${item.share_percent}%` }}/></div></div>)}</div><p className={`mt-5 text-[10px] leading-5 ${mutedText(isDarkMode)}`}>{data.meta.cashier_basis}</p></div>
          <div className={`${panelClass(isDarkMode)} p-5 sm:p-7`}><div className="mb-5 flex items-center gap-2"><CalendarDays size={17} className="text-[#E53935]"/><h3 className="font-black">سياق التشغيل</h3></div><MetricLine label="أكواد خصم مؤكدة" value={formatNumber(Number(data.summary.promo_redemptions_confirmed || 0))} isDarkMode={isDarkMode}/><MetricLine label="تحصيلات العربون" value={formatCurrency(Number(data.summary.deposit_collections || 0))} isDarkMode={isDarkMode}/><MetricLine label="أيام عمل مفتوحة" value={formatNumber(Number(data.summary.business_days_opened || 0))} isDarkMode={isDarkMode}/><MetricLine label="أيام عمل مغلقة" value={formatNumber(Number(data.summary.business_days_closed || 0))} isDarkMode={isDarkMode}/><MetricLine label="إجمالي الفروق المطلقة" value={formatCurrency(Number(data.summary.closed_day_absolute_variance || 0))} isDarkMode={isDarkMode}/><p className={`mt-4 text-[10px] leading-5 ${mutedText(isDarkMode)}`}>الفروق مرتبطة بأيام أغلقها الكاشير ولا تثبت سبب الفارق أو المسؤولية عنه.</p></div>
        </section>}

        <AttentionList items={data.attention} isDarkMode={isDarkMode} onEntity={setSelectedEmployee}/>

        <section className={`${panelClass(isDarkMode)} overflow-hidden p-5 sm:p-7`}>
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E53935]">التفاصيل</p><h3 className="mt-2 text-lg font-black">جدول المقارنة داخل الدور</h3></div><div className="relative"><Search size={14} className={`absolute right-3 top-3 ${mutedText(isDarkMode)}`}/><input aria-label="بحث باسم الموظف" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث باسم الموظف" className={`${selectClass(isDarkMode)} w-56 pr-9`}/></div></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-right text-xs"><thead><tr className={`border-b ${isDarkMode ? 'border-white/[0.07] text-white/40' : 'border-black/[0.07] text-black/40'}`}><th className="px-3 py-3">الموظف</th>{mode === 'CASHIER' ? <><th className="px-3 py-3">الفواتير المحصلة</th><th className="px-3 py-3">صافي المعالجة</th><th className="px-3 py-3">متوسط الفاتورة</th><th className="px-3 py-3">دفع مختلط</th></> : <><th className="px-3 py-3">القيمة الإجمالية</th><th className="px-3 py-3">الوحدات</th><th className="px-3 py-3">الفواتير</th><th className="px-3 py-3">العملاء</th><th className="px-3 py-3">العمولة</th></>}<th className="px-3 py-3">التفاصيل</th></tr></thead><tbody>{employees.map((row) => <tr key={row.employee_id} className={`border-b last:border-0 ${isDarkMode ? 'border-white/[0.05]' : 'border-black/[0.05]'}`}><td className="px-3 py-4"><p className="font-black">{row.employee_name}</p><p className={`mt-1 text-[9px] ${mutedText(isDarkMode)}`}>{row.current_status}</p></td>{isCashierRow(row) ? <><td className="px-3 py-4">{formatNumber(row.paid_invoices_finalized)}</td><td className="px-3 py-4 font-black">{formatCurrency(row.net_sales_finalized)}</td><td className="px-3 py-4">{formatCurrency(row.average_ticket_finalized)}</td><td className="px-3 py-4">{formatNumber(row.payments.split_payment_invoice_count)}</td></> : <><td className="px-3 py-4 font-black">{formatCurrency(row.gross_service_value)}</td><td className="px-3 py-4">{formatNumber(row.service_units)}</td><td className="px-3 py-4">{formatNumber(row.paid_invoice_count)}</td><td className="px-3 py-4">{formatNumber(row.identified_customer_count)}</td><td className="px-3 py-4">{formatCurrency(row.service_commission_accrued)}</td></>}<td className="px-3 py-4"><button type="button" onClick={() => setSelectedEmployee(row.employee_id)} className="rounded-lg border border-current/10 p-2"><Eye size={14}/></button></td></tr>)}</tbody></table></div>
          <PaginationControls pagination={data.table.pagination} isDarkMode={isDarkMode} onPage={setPage}/>
        </section>
      </> : null}

      {selectedEmployee ? <ReportDrawer isDarkMode={isDarkMode} title={drilldown?.employee.employee_name || 'تفاصيل الموظف'} subtitle={modeOptions.find((item) => item.value === mode)?.detail} onClose={() => setSelectedEmployee(null)}>{drillLoading || !drilldown ? <ReportLoading isDarkMode={isDarkMode}/> : isCashierRow(drilldown.employee) ? <CashierDrawer row={drilldown.employee} dark={isDarkMode}/> : <ServiceEmployeeDrawer row={drilldown.employee} dark={isDarkMode} mode={mode}/>}</ReportDrawer> : null}
    </div>
  );
};

const ServiceEmployeeDrawer: React.FC<{ row: ServiceEmployeeRow; dark: boolean; mode: EmployeeReportMode }> = ({ row, dark, mode }) => <div className="space-y-5">
  <section className={`${panelClass(dark)} p-5`}><p className="mb-4 text-[10px] font-black uppercase tracking-[0.18em] text-[#E53935]">الحالة الحالية</p><MetricLine label="الدور الحالي" value={row.current_role || 'غير محدد'} isDarkMode={dark}/><MetricLine label="الحالة الحالية" value={row.current_status} isDarkMode={dark}/><MetricLine label="الفرع الحالي" value={row.current_branch_name || 'غير محدد'} isDarkMode={dark}/></section>
  <section className={`${panelClass(dark)} p-5`}><p className="mb-4 text-[10px] font-black uppercase tracking-[0.18em] text-[#E53935]">نشاط الفترة</p><MetricLine label={mode === 'BARBER' ? 'قيمة الخدمات الإجمالية المسندة' : 'قيمة الخدمات المشارك بها'} value={formatCurrency(row.gross_service_value)} isDarkMode={dark}/><MetricLine label="وحدات الخدمة" value={formatNumber(row.service_units)} isDarkMode={dark}/><MetricLine label="الفواتير المؤهلة" value={formatNumber(row.paid_invoice_count)} isDarkMode={dark}/><MetricLine label="العملاء المعروفون" value={formatNumber(row.identified_customer_count)} isDarkMode={dark}/><MetricLine label="العمولة المستحقة المسجلة" value={formatCurrency(row.service_commission_accrued)} isDarkMode={dark}/>{row.current_wallet !== null ? <MetricLine label="رصيد المحفظة الحالي" value={formatCurrency(row.current_wallet)} isDarkMode={dark}/> : null}</section>
  <section className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">الخدمات وفروع النشاط</h3>{row.transaction_branches.map((branch) => <MetricLine key={branch.branch_id} label={branch.branch_name} value={`${formatCurrency(branch.gross_value)} · ${formatNumber(branch.units)} وحدة`} isDarkMode={dark}/>)}{row.top_services.map((item) => <MetricLine key={item.service_id} label={`${item.service_name} · ${item.units} وحدة`} value={`${formatCurrency(item.gross_value)} · ${formatNumber(item.share_percent)}%`} isDarkMode={dark}/>)}</section>
  <section className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">الحضور المسجل</h3><MetricLine label="جلسات مكتملة" value={formatNumber(row.attendance.completed_sessions)} isDarkMode={dark}/><MetricLine label="أيام مسجلة" value={formatNumber(row.attendance.recorded_workdays)} isDarkMode={dark}/><MetricLine label="ساعات مكتملة" value={`${formatNumber(row.attendance.recorded_hours)} ساعة`} isDarkMode={dark}/><MetricLine label="تغطية أيام النشاط" value={`${formatNumber(row.attendance.attendance_coverage)}%`} isDarkMode={dark}/>{row.gross_per_recorded_hour !== null ? <MetricLine label="القيمة الإجمالية لكل ساعة مسجلة" value={formatCurrency(row.gross_per_recorded_hour)} isDarkMode={dark}/> : null}</section>
  {row.products.product_units > 0 ? <section className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">المنتجات المسندة</h3><MetricLine label="القيمة الإجمالية" value={formatCurrency(row.products.gross_product_value)} isDarkMode={dark}/><MetricLine label="الوحدات" value={formatNumber(row.products.product_units)} isDarkMode={dark}/><MetricLine label="عمولة المنتجات" value={formatCurrency(row.products.product_commission_accrued)} isDarkMode={dark}/></section> : null}
  <section className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">الإجراءات المالية</h3><MetricLine label="سلف" value={formatCurrency(row.financial_actions.ADVANCE.amount)} isDarkMode={dark}/><MetricLine label="خصومات" value={formatCurrency(row.financial_actions.DEDUCTION.amount)} isDarkMode={dark}/><MetricLine label="وقت إضافي" value={formatCurrency(row.financial_actions.OVERTIME.amount)} isDarkMode={dark}/><MetricLine label="سحوبات عمولة" value={formatCurrency(row.financial_actions.COMMISSION_WITHDRAWAL.amount)} isDarkMode={dark}/></section>
</div>;

const CashierDrawer: React.FC<{ row: CashierEmployeeRow; dark: boolean }> = ({ row, dark }) => <div className="space-y-5">
  <section className={`${panelClass(dark)} p-5`}><p className="mb-4 text-[10px] font-black uppercase tracking-[0.18em] text-[#E53935]">الحالة الحالية</p><MetricLine label="الدور الحالي" value={row.current_role || 'غير محدد'} isDarkMode={dark}/><MetricLine label="الحالة الحالية" value={row.current_status} isDarkMode={dark}/><MetricLine label="الفرع الحالي" value={row.current_branch_name || 'غير محدد'} isDarkMode={dark}/></section>
  <section className={`${panelClass(dark)} p-5`}><p className="mb-4 text-[10px] font-black uppercase tracking-[0.18em] text-[#E53935]">الفواتير المحصلة</p><MetricLine label="الفواتير المدفوعة" value={formatNumber(row.paid_invoices_finalized)} isDarkMode={dark}/><MetricLine label="صافي المبيعات المعالجة" value={formatCurrency(row.net_sales_finalized)} isDarkMode={dark}/><MetricLine label="متوسط الفاتورة" value={formatCurrency(row.average_ticket_finalized)} isDarkMode={dark}/><MetricLine label="فواتير دفع مختلط" value={formatNumber(row.payments.split_payment_invoice_count)} isDarkMode={dark}/></section>
  <section className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">طرق الدفع</h3>{Object.entries(row.payments.methods).map(([method, amount]) => <MetricLine key={method} label={paymentLabel[method] || method} value={formatCurrency(amount)} isDarkMode={dark}/>)}</section>
  <section className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">فروع النشاط</h3>{row.transaction_branches.map((branch) => <MetricLine key={branch.branch_id} label={branch.branch_name} value={`${formatCurrency(branch.net_sales_finalized)} · ${formatNumber(branch.paid_invoice_count)} فاتورة`} isDarkMode={dark}/>)}</section>
  <section className={`${panelClass(dark)} p-5`}><h3 className="mb-4 font-black">سياق التشغيل</h3><MetricLine label="أكواد خصم مؤكدة" value={formatNumber(row.operations.promo_redemptions_confirmed)} isDarkMode={dark}/><MetricLine label="تحصيلات عربون" value={formatCurrency(row.operations.deposit_collections)} isDarkMode={dark}/><MetricLine label="أيام مفتوحة" value={formatNumber(row.operations.business_days_opened)} isDarkMode={dark}/><MetricLine label="أيام مغلقة" value={formatNumber(row.operations.business_days_closed)} isDarkMode={dark}/><MetricLine label="الفروق المطلقة" value={formatCurrency(row.operations.closed_day_absolute_variance)} isDarkMode={dark}/><MetricLine label="أحداث تدقيق الفواتير" value={formatNumber(row.operations.audit_event_count)} isDarkMode={dark}/></section>
</div>;

export default EmployeesReport;
