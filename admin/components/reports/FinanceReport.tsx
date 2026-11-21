import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Banknote, Download, Eye, Landmark, ReceiptText, WalletCards } from 'lucide-react';
import adminApi from '../../api/client';
import {
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
import { errorMessage, formatCompactCurrency, formatCurrency, formatDate, formatNumber, formatShortDate, type DatePreset } from './reportUtils';
import type { FinanceBusinessDayDrilldown, FinanceReportData, NamedOption, ReportDateRange } from './types';

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

type DetailTab = 'performance' | 'expenses' | 'deposits';

const paymentLabel = (method: string) => ({ CASH: 'نقدي', VISA: 'فيزا', INSTAPAY: 'إنستا باي' }[method] || method);
const statusLabel = (status: string) => status === 'CLOSED' ? 'مغلق' : 'مفتوح';
const cashOutLabels: Record<string, string> = {
  operating: 'مصروفات نقدية تشغيلية',
  advance: 'سلف',
  commission_withdrawal: 'سحب عمولات',
  overtime: 'صرف ساعات إضافية',
  drawer_change: 'باقي ممول من الخزنة',
  other: 'حركات نقدية أخرى',
};
const selectClass = (dark: boolean) => `h-10 rounded-xl border px-3 text-xs font-bold outline-none ${dark ? 'border-white/10 bg-white/[0.04] text-white' : 'border-black/10 bg-[#FAFAFA] text-[#171717]'}`;

const downloadBlob = (data: Blob, filename: string) => {
  const href = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
};

const FinanceReport: React.FC<Props> = ({ isDarkMode, range, preset, branchId, branches, onRangeChange, onPresetChange, onBranchChange }) => {
  const [data, setData] = useState<FinanceReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [treasuryExporting, setTreasuryExporting] = useState(false);
  const [expenseExporting, setExpenseExporting] = useState(false);
  const [expenseCategoryId, setExpenseCategoryId] = useState('');
  const [businessDayStatus, setBusinessDayStatus] = useState('');
  const [detailTab, setDetailTab] = useState<DetailTab>('performance');
  const [performancePage, setPerformancePage] = useState(1);
  const [expensePage, setExpensePage] = useState(1);
  const [depositPage, setDepositPage] = useState(1);
  const [businessDayPage, setBusinessDayPage] = useState(1);
  const [selectedBusinessDay, setSelectedBusinessDay] = useState<number | null>(null);
  const [drilldown, setDrilldown] = useState<FinanceBusinessDayDrilldown | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const params = useMemo(() => ({
    date_from: range.dateFrom,
    date_to: range.dateTo,
    branch_id: branchId === 'All' ? undefined : branchId,
    expense_category_id: expenseCategoryId || undefined,
    business_day_status: businessDayStatus || undefined,
    page: performancePage,
    expense_page: expensePage,
    deposit_page: depositPage,
    business_day_page: businessDayPage,
    per_page: 12,
  }), [range, branchId, expenseCategoryId, businessDayStatus, performancePage, expensePage, depositPage, businessDayPage]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get<FinanceReportData>('/reports/finance', { params });
      setData(response.data);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { void fetchReport(); }, [fetchReport]);
  useEffect(() => {
    setPerformancePage(1);
    setExpensePage(1);
    setDepositPage(1);
    setBusinessDayPage(1);
  }, [range, branchId, expenseCategoryId, businessDayStatus]);

  useEffect(() => {
    if (!selectedBusinessDay) {
      setDrilldown(null);
      return;
    }
    const load = async () => {
      setDrillLoading(true);
      try {
        const response = await adminApi.get<FinanceBusinessDayDrilldown>(`/reports/finance/business-days/${selectedBusinessDay}`, { params });
        setDrilldown(response.data);
      } catch (requestError) {
        setError(errorMessage(requestError));
        setSelectedBusinessDay(null);
      } finally {
        setDrillLoading(false);
      }
    };
    void load();
  }, [selectedBusinessDay, params]);

  const exportReport = async () => {
    setExporting(true);
    try {
      const response = await adminApi.get('/reports/finance/export/xlsx', { params, responseType: 'blob' });
      downloadBlob(response.data, `finance-performance-${range.dateFrom}-${range.dateTo}.xlsx`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setExporting(false);
    }
  };

  const exportTreasury = async () => {
    setTreasuryExporting(true);
    try {
      const response = await adminApi.get('/reports/finance/treasury/export/xlsx', { params, responseType: 'blob' });
      downloadBlob(response.data, `treasury-business-days-${range.dateFrom}-${range.dateTo}.xlsx`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setTreasuryExporting(false);
    }
  };

  const exportExpenses = async () => {
    setExpenseExporting(true);
    try {
      const response = await adminApi.post('/expenses/export/xlsx', {
        date_from: range.dateFrom,
        date_to: range.dateTo,
        branch_id: branchId === 'All' ? 'All' : branchId,
        category_id: expenseCategoryId || undefined,
      }, { responseType: 'blob' });
      downloadBlob(response.data, `expenses-${range.dateFrom}-${range.dateTo}.xlsx`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setExpenseExporting(false);
    }
  };

  const currentTable = data ? ({
    performance: data.performance_table,
    expenses: data.expenses_table,
    deposits: data.deposits_table,
  }[detailTab]) : null;

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
        <select aria-label="فئة المصروف للأداء والتفاصيل" value={expenseCategoryId} onChange={(event) => setExpenseCategoryId(event.target.value)} className={selectClass(isDarkMode)}>
          <option value="">كل فئات المصروف · الأداء</option>
          {data?.filter_options.expense_categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select aria-label="حالة يوم العمل للخزنة" value={businessDayStatus} onChange={(event) => setBusinessDayStatus(event.target.value)} className={selectClass(isDarkMode)}>
          <option value="">كل أيام العمل · الخزنة</option>
          <option value="OPEN">مفتوح</option>
          <option value="CLOSED">مغلق</option>
        </select>
      </ReportFilterBar>

      {error && data && <div className="rounded-xl border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-xs font-bold text-red-500">{error}</div>}
      {loading && !data ? <ReportLoading isDarkMode={isDarkMode} /> : error && !data ? <ReportError isDarkMode={isDarkMode} message={error} onRetry={fetchReport} /> : data && (
        <>
          <section className={`${panelClass(isDarkMode)} overflow-hidden p-6 sm:p-8`}>
            <div className="grid gap-8 xl:grid-cols-[1.25fr_1.5fr] xl:items-end">
              <div>
                <div className="mb-5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-[#E53935]"><Landmark size={15} /> الأداء المالي</div>
                <p className={`mb-2 text-xs font-bold ${mutedText(isDarkMode)}`}>صافي مبيعات الفواتير المدفوعة</p>
                <h2 className="text-4xl font-black tracking-tight sm:text-6xl">{formatCompactCurrency(data.summary.net_sales)}</h2>
                <p className={`mt-2 text-[11px] ${mutedText(isDarkMode)}`}>{formatCurrency(data.summary.net_sales)} بالضبط</p>
                <div className="mt-4"><ComparisonLine comparison={data.comparison.net_sales} isDarkMode={isDarkMode} formatter={formatCurrency} /></div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ['المصروفات التشغيلية', data.summary.operating_expenses, data.comparison.operating_expenses],
                  ['تكلفة العمولات المسجلة', data.summary.recorded_commission_cost, data.comparison.recorded_commission_cost],
                  ['المساهمة التشغيلية', data.summary.operating_contribution, data.comparison.operating_contribution],
                ].map(([label, value, comparison]) => <div key={String(label)} className={`rounded-2xl p-4 ${isDarkMode ? 'bg-white/[0.025]' : 'bg-black/[0.025]'}`}><p className={`text-[10px] leading-5 ${mutedText(isDarkMode)}`}>{String(label)}</p><p className="mt-2 text-lg font-black">{formatCurrency(Number(value))}</p><div className="mt-2"><ComparisonLine comparison={comparison as FinanceReportData['comparison']['net_sales']} isDarkMode={isDarkMode} formatter={formatCurrency} /></div></div>)}
              </div>
            </div>
          </section>

          <InsightStrip insights={data.insights} isDarkMode={isDarkMode} />

          <div className="grid gap-6 xl:grid-cols-[1.45fr_0.8fr]">
            <section className={`${panelClass(isDarkMode)} p-6`}>
              <div className="mb-4"><h3 className="text-lg font-black">المبيعات والمصروفات التشغيلية</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>تقويم القاهرة: تاريخ الفاتورة وتاريخ المصروف</p></div>
              {data.trend.some((row) => row.net_sales || row.operating_expenses) ? <div className="h-[290px]" dir="ltr"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.trend} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}><defs><linearGradient id="financeSales" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E53935" stopOpacity={0.25} /><stop offset="100%" stopColor="#E53935" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 7" vertical={false} stroke={isDarkMode ? '#ffffff10' : '#00000010'} /><XAxis dataKey="date" tickFormatter={formatShortDate} axisLine={false} tickLine={false} tick={{ fill: isDarkMode ? '#ffffff55' : '#00000055', fontSize: 10 }} minTickGap={28} /><YAxis hide /><Tooltip formatter={(value, name) => [formatCurrency(Number(value)), name === 'net_sales' ? 'صافي المبيعات' : 'المصروفات التشغيلية']} labelFormatter={(label) => formatShortDate(String(label))} contentStyle={{ background: isDarkMode ? '#181818' : '#fff', border: 'none', borderRadius: 14, direction: 'rtl' }} /><Area type="monotone" dataKey="net_sales" stroke="#E53935" strokeWidth={2.5} fill="url(#financeSales)" /><Line type="monotone" dataKey="operating_expenses" stroke="#E6D690" strokeWidth={2} dot={false} /></AreaChart></ResponsiveContainer></div> : <EmptyBlock isDarkMode={isDarkMode} />}
            </section>

            <section className={`${panelClass(isDarkMode)} p-6`}>
              <h3 className="text-lg font-black">جسر المساهمة</h3>
              <p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>من صافي المبيعات إلى المساهمة التشغيلية</p>
              <div className="mt-5"><MetricLine label="صافي المبيعات" value={formatCurrency(data.summary.net_sales)} isDarkMode={isDarkMode} /><MetricLine label="ناقص تكلفة العمولات المسجلة" value={`− ${formatCurrency(data.summary.recorded_commission_cost)}`} isDarkMode={isDarkMode} /><MetricLine label="ناقص المصروفات التشغيلية" value={`− ${formatCurrency(data.summary.operating_expenses)}`} isDarkMode={isDarkMode} /><MetricLine label={`المساهمة التشغيلية · ${formatNumber(data.summary.contribution_ratio)}%`} value={formatCurrency(data.summary.operating_contribution)} isDarkMode={isDarkMode} /></div>
              <p className={`mt-5 border-r-2 border-[#E6D690]/50 pr-3 text-[10px] leading-6 ${mutedText(isDarkMode)}`}>مؤشر مبني على العمولات والمصروفات المسجلة. لا يشمل تكلفة المنتجات أو الرواتب أو كامل المصروفات العامة.</p>
            </section>
          </div>

          <section className={`${panelClass(isDarkMode)} p-6`}>
            <div className="mb-6"><h3 className="text-lg font-black">التحصيلات</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>تخصيص الفواتير والعربون كلٌ على حدة</p></div>
            <div className="grid gap-7 xl:grid-cols-3">
              <div><div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-black">تحصيلات الفواتير</p><p className="mt-1 text-xl font-black">{formatCurrency(data.collections.invoice_collections)}</p></div><ReceiptText size={20} className="text-[#E53935]" /></div>{data.collections.invoice_methods.map((row) => <MetricLine key={row.method} label={`${paymentLabel(row.method)} · ${formatNumber(row.share_percent)}%`} value={formatCurrency(row.amount)} isDarkMode={isDarkMode} />)}<p className={`mt-3 text-[10px] ${mutedText(isDarkMode)}`}>دفع مقسم: {formatNumber(data.collections.split_payment_invoice_count)} فاتورة · {formatNumber(data.collections.split_payment_rate)}%</p></div>
              <div><div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-black">تحصيلات عربون المواعيد</p><p className="mt-1 text-xl font-black">{formatCurrency(data.collections.deposit_collections)}</p></div><WalletCards size={20} className="text-[#E6D690]" /></div>{data.collections.deposit_methods.map((row) => <MetricLine key={row.method} label={`${paymentLabel(row.method)} · ${formatNumber(row.share_percent)}%`} value={formatCurrency(row.amount)} isDarkMode={isDarkMode} />)}{data.collections.deposit_trend.length > 0 && <div className="mt-4"><p className={`mb-2 text-[9px] ${mutedText(isDarkMode)}`}>مسار تحصيل العربون</p><div className="h-16" dir="ltr"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.collections.deposit_trend}><Area type="monotone" dataKey="amount" stroke="#E6D690" strokeWidth={1.8} fill="#E6D69018" /><Tooltip formatter={(value) => [formatCurrency(Number(value)), 'العربون']} labelFormatter={(label) => formatShortDate(String(label))} contentStyle={{ background: isDarkMode ? '#181818' : '#fff', border: 'none', borderRadius: 12, direction: 'rtl', fontSize: 10 }} /></AreaChart></ResponsiveContainer></div></div>}</div>
              <div className={`rounded-2xl p-5 ${isDarkMode ? 'bg-white/[0.025]' : 'bg-black/[0.025]'}`}><p className={`text-[10px] font-bold ${mutedText(isDarkMode)}`}>إجمالي التحصيلات</p><p className="mt-2 text-3xl font-black">{formatCompactCurrency(data.collections.total_collections)}</p><div className="mt-5"><MetricLine label="تحصيلات الفواتير" value={formatCurrency(data.collections.invoice_collections)} isDarkMode={isDarkMode} /><MetricLine label="تحصيلات العربون" value={formatCurrency(data.collections.deposit_collections)} isDarkMode={isDarkMode} /></div><p className={`mt-4 text-[10px] leading-5 ${mutedText(isDarkMode)}`}>إجمالي التحصيلات حركة نقدية، ولا يمثل الإيراد.</p></div>
            </div>
            <div className={`mt-6 flex flex-wrap gap-x-7 gap-y-2 border-t pt-4 text-[10px] ${isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'} ${mutedText(isDarkMode)}`}><span>خام فيزا الحديث: {formatCurrency(data.collections.raw_tender.visa)}</span><span>خام إنستا باي الحديث: {formatCurrency(data.collections.raw_tender.instapay)}</span><span>الباقي المستحق: {formatCurrency(data.collections.raw_tender.change_due)}</span></div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[0.75fr_1.5fr]">
            <section className={`${panelClass(isDarkMode)} p-6`}>
              <div className="mb-4 flex items-center justify-between"><div><h3 className="text-lg font-black">الخروج النقدي</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>مصروفات نقدية مرتبطة بأيام العمل</p></div><Banknote size={20} className="text-[#E6D690]" /></div>
              <p className="mb-4 text-3xl font-black">{formatCurrency(data.cash_out.total)}</p>
              {Object.entries(data.cash_out.breakdown).map(([key, value]) => <MetricLine key={key} label={cashOutLabels[key]} value={formatCurrency(value)} isDarkMode={isDarkMode} />)}
              <p className={`mt-4 text-[10px] leading-5 ${mutedText(isDarkMode)}`}>الخروج النقدي أوسع من المصروفات التشغيلية، ويُحتسب مرة واحدة من سجلات المصروفات المرتبطة بيوم العمل.</p>
            </section>

            <section className={`${panelClass(isDarkMode)} p-5 sm:p-6`}>
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-lg font-black">خزنة أيام العمل</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>رقابة نقدية بعضوية يوم العمل الدقيقة</p></div><button type="button" onClick={exportTreasury} disabled={treasuryExporting} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-black disabled:opacity-50 ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}><Download size={14} />{treasuryExporting ? 'جارٍ التجهيز' : 'تصدير الخزنة'}</button></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-right text-xs"><thead className={mutedText(isDarkMode)}><tr className={`border-b ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}><th className="px-3 py-4">اليوم</th><th className="px-3 py-4">الفرع</th><th className="px-3 py-4">الحالة</th><th className="px-3 py-4">البداية</th><th className="px-3 py-4">نقد الفواتير</th><th className="px-3 py-4">نقد العربون</th><th className="px-3 py-4">الخروج</th><th className="px-3 py-4">النظري</th><th className="px-3 py-4">المعدود</th><th className="px-3 py-4">الفرق</th><th className="px-3 py-4"></th></tr></thead><tbody>{data.business_days.items.map((row) => <tr key={row.business_day_id} onClick={() => setSelectedBusinessDay(row.business_day_id)} className={`cursor-pointer border-b transition last:border-b-0 ${isDarkMode ? 'border-white/[0.05] hover:bg-white/[0.03]' : 'border-black/[0.05] hover:bg-black/[0.02]'}`}><td className="px-3 py-4 font-black">{formatShortDate(row.business_date)}<p className={`mt-1 text-[9px] ${mutedText(isDarkMode)}`}>#{row.business_day_id}</p></td><td className="px-3 py-4">{row.branch_name}</td><td className="px-3 py-4"><span className={`rounded-full px-2 py-1 text-[9px] font-black ${row.status === 'CLOSED' ? 'bg-white/[0.05]' : 'bg-amber-500/10 text-amber-500'}`}>{statusLabel(row.status)}</span></td><td className="px-3 py-4">{formatCurrency(row.opening_balance)}</td><td className="px-3 py-4">{formatCurrency(row.cash_invoice_collections)}</td><td className="px-3 py-4">{formatCurrency(row.cash_deposit_collections)}</td><td className="px-3 py-4">{formatCurrency(row.cash_out)}</td><td className="px-3 py-4 font-black">{formatCurrency(row.theoretical_cash)}</td><td className="px-3 py-4">{row.counted_cash === null ? '—' : formatCurrency(row.counted_cash)}</td><td className={`px-3 py-4 font-black ${row.variance ? 'text-amber-500' : ''}`}>{row.variance === null ? '—' : formatCurrency(row.variance)}</td><td className="px-3 py-4"><Eye size={14} /></td></tr>)}</tbody></table>{!data.business_days.items.length && <EmptyBlock isDarkMode={isDarkMode} />}</div>
              <PaginationControls pagination={data.business_days.pagination} isDarkMode={isDarkMode} onPage={setBusinessDayPage} />
              <p className={`mt-4 text-[10px] leading-5 ${mutedText(isDarkMode)}`}>المغلق يعرض لقطة الإغلاق المخزنة؛ المفتوح يُعاد حسابه حيًا. قد تختلف الخزنة عن الفواتير لأنها تشمل العربون والخروج النقدي والعضوية الدقيقة ليوم العمل.</p>
            </section>
          </div>

          <AttentionList items={data.attention} isDarkMode={isDarkMode} onEntity={(id) => setSelectedBusinessDay(id)} />

          <section className={`${panelClass(isDarkMode)} p-5 sm:p-6`}>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-lg font-black">تفاصيل الفترة</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>تفاصيل مالية وتشغيلية قابلة للمراجعة</p></div><div className="flex flex-wrap items-center gap-2">{detailTab === 'expenses' && <button type="button" onClick={exportExpenses} disabled={expenseExporting} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-black disabled:opacity-50 ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}><Download size={14} />{expenseExporting ? 'جارٍ التجهيز' : 'تصدير سجل المصروفات'}</button>}<div className={`flex rounded-xl p-1 ${isDarkMode ? 'bg-black/30' : 'bg-black/[0.04]'}`}>{([['performance', 'الأداء'], ['expenses', 'المصروفات'], ['deposits', 'العربون']] as Array<[DetailTab, string]>).map(([key, label]) => <button key={key} type="button" onClick={() => setDetailTab(key)} className={`rounded-lg px-3 py-2 text-[11px] font-black ${detailTab === key ? 'bg-[#E53935] text-white' : mutedText(isDarkMode)}`}>{label}</button>)}</div></div></div>
            <div className="overflow-x-auto">
              {detailTab === 'performance' && <table className="w-full min-w-[780px] text-right text-xs"><thead className={mutedText(isDarkMode)}><tr><th className="px-3 py-3">التاريخ</th><th className="px-3 py-3">الفرع</th><th className="px-3 py-3">صافي المبيعات</th><th className="px-3 py-3">المصروفات التشغيلية</th><th className="px-3 py-3">العمولات المسجلة</th><th className="px-3 py-3">المساهمة التشغيلية</th></tr></thead><tbody>{data.performance_table.items.map((row) => <tr key={`${row.date}-${row.branch_id}`} className={`border-t ${isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'}`}><td className="px-3 py-4">{formatShortDate(row.date)}</td><td className="px-3 py-4">{row.branch_name}</td><td className="px-3 py-4 font-black">{formatCurrency(row.net_sales)}</td><td className="px-3 py-4">{formatCurrency(row.operating_expenses)}</td><td className="px-3 py-4">{formatCurrency(row.recorded_commission_cost)}</td><td className="px-3 py-4 font-black">{formatCurrency(row.operating_contribution)}</td></tr>)}</tbody></table>}
              {detailTab === 'expenses' && <table className="w-full min-w-[850px] text-right text-xs"><thead className={mutedText(isDarkMode)}><tr><th className="px-3 py-3">التاريخ</th><th className="px-3 py-3">الفرع</th><th className="px-3 py-3">الفئة</th><th className="px-3 py-3">القيمة</th><th className="px-3 py-3">مصروف تشغيلي؟</th><th className="px-3 py-3">حركة نقدية؟</th><th className="px-3 py-3">يوم العمل</th></tr></thead><tbody>{data.expenses_table.items.map((row) => <tr key={row.expense_id} className={`border-t ${isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'}`}><td className="px-3 py-4">{formatShortDate(row.date)}</td><td className="px-3 py-4">{row.branch_name}</td><td className="px-3 py-4 font-black">{row.category_name}</td><td className="px-3 py-4">{formatCurrency(row.amount)}</td><td className="px-3 py-4">{row.is_business_expense && !['ADVANCE', 'DISCOUNT', 'OVERTIME', 'DAILY_PERCENTAGE'].includes(row.category_code) ? 'نعم' : 'لا'}</td><td className="px-3 py-4">{row.is_cash_event ? 'نعم' : 'لا'}</td><td className="px-3 py-4">{row.business_day_id || '—'}</td></tr>)}</tbody></table>}
              {detailTab === 'deposits' && <table className="w-full min-w-[800px] text-right text-xs"><thead className={mutedText(isDarkMode)}><tr><th className="px-3 py-3">التاريخ</th><th className="px-3 py-3">الفرع</th><th className="px-3 py-3">الموعد</th><th className="px-3 py-3">العميل</th><th className="px-3 py-3">الطريقة</th><th className="px-3 py-3">القيمة</th><th className="px-3 py-3">يوم العمل</th></tr></thead><tbody>{data.deposits_table.items.map((row) => <tr key={row.transaction_id} className={`border-t ${isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'}`}><td className="px-3 py-4">{formatShortDate(row.date)}</td><td className="px-3 py-4">{row.branch_name}</td><td className="px-3 py-4">#{row.appointment_id}</td><td className="px-3 py-4 font-black">{row.customer_name}</td><td className="px-3 py-4">{paymentLabel(row.method)}</td><td className="px-3 py-4">{formatCurrency(row.amount)}</td><td className="px-3 py-4">{row.business_day_id}</td></tr>)}</tbody></table>}
              {currentTable && !currentTable.items.length && <EmptyBlock isDarkMode={isDarkMode} />}
            </div>
            {currentTable && <PaginationControls pagination={currentTable.pagination} isDarkMode={isDarkMode} onPage={detailTab === 'performance' ? setPerformancePage : detailTab === 'expenses' ? setExpensePage : setDepositPage} />}
          </section>

          <p className={`px-2 text-[11px] leading-6 ${mutedText(isDarkMode)}`}>الأداء المالي يستخدم تاريخ الفاتورة وتاريخ المصروف وفق تقويم القاهرة. رقابة الخزنة تستخدم الربط الدقيق بيوم العمل. المساهمة التشغيلية ليست ربحًا صافيًا.</p>
        </>
      )}

      {selectedBusinessDay && <ReportDrawer isDarkMode={isDarkMode} title={drilldown ? `يوم عمل #${drilldown.business_day.business_day_id}` : 'تفاصيل يوم العمل'} subtitle={drilldown ? `${drilldown.branch_name} · ${formatDate(drilldown.business_day.opened_at)}` : undefined} onClose={() => setSelectedBusinessDay(null)}>
        {drillLoading || !drilldown ? <ReportLoading isDarkMode={isDarkMode} /> : <div className="space-y-6">
          <section className={`${panelClass(isDarkMode)} p-5`}><div className="mb-3 flex items-center justify-between"><h3 className="font-black">تسوية الخزنة</h3><span className={`rounded-full px-2 py-1 text-[9px] font-black ${drilldown.business_day.status === 'OPEN' ? 'bg-amber-500/10 text-amber-500' : 'bg-white/[0.05]'}`}>{statusLabel(drilldown.business_day.status)}</span></div><MetricLine label="رصيد البداية" value={formatCurrency(drilldown.business_day.opening_balance)} isDarkMode={isDarkMode} /><MetricLine label="تحصيل فواتير نقدي" value={formatCurrency(drilldown.business_day.cash_invoice_collections)} isDarkMode={isDarkMode} /><MetricLine label="تحصيل عربون نقدي" value={formatCurrency(drilldown.business_day.cash_deposit_collections)} isDarkMode={isDarkMode} /><MetricLine label="الخروج النقدي" value={`− ${formatCurrency(drilldown.business_day.cash_out)}`} isDarkMode={isDarkMode} />{Math.abs(drilldown.business_day.recomputed_cash_out - drilldown.business_day.cash_out) >= 0.01 && <MetricLine label="الخروج النقدي المعاد تجميعه" value={formatCurrency(drilldown.business_day.recomputed_cash_out)} isDarkMode={isDarkMode} />}<MetricLine label="الرصيد النظري" value={formatCurrency(drilldown.business_day.theoretical_cash)} isDarkMode={isDarkMode} />{Math.abs(drilldown.business_day.recomputed_theoretical_cash - drilldown.business_day.theoretical_cash) >= 0.01 && <MetricLine label="الرصيد النظري المعاد حسابه" value={formatCurrency(drilldown.business_day.recomputed_theoretical_cash)} isDarkMode={isDarkMode} />}<MetricLine label="الرصيد المعدود" value={drilldown.business_day.counted_cash === null ? 'غير متاح ليوم مفتوح' : formatCurrency(drilldown.business_day.counted_cash)} isDarkMode={isDarkMode} /><MetricLine label="الفرق" value={drilldown.business_day.variance === null ? '—' : formatCurrency(drilldown.business_day.variance)} isDarkMode={isDarkMode} /><p className={`mt-3 text-[10px] ${mutedText(isDarkMode)}`}>{drilldown.business_day.calculation_basis === 'STORED_CLOSE_SNAPSHOT' ? 'لقطة إغلاق مخزنة' : 'حساب حي ليوم مفتوح'}</p></section>
          <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-3 font-black">التحصيل الإلكتروني</h3><MetricLine label="فيزا مخصص للفواتير" value={formatCurrency(drilldown.business_day.invoice_methods.VISA)} isDarkMode={isDarkMode} /><MetricLine label="إنستا باي مخصص للفواتير" value={formatCurrency(drilldown.business_day.invoice_methods.INSTAPAY)} isDarkMode={isDarkMode} /><MetricLine label="فيزا عربون" value={formatCurrency(drilldown.business_day.deposit_methods.VISA)} isDarkMode={isDarkMode} /><MetricLine label="إنستا باي عربون" value={formatCurrency(drilldown.business_day.deposit_methods.INSTAPAY)} isDarkMode={isDarkMode} /></section>
          <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-3 font-black">مصادر الخروج النقدي</h3>{Object.entries(drilldown.cash_out_breakdown).map(([key, value]) => <MetricLine key={key} label={cashOutLabels[key]} value={formatCurrency(value)} isDarkMode={isDarkMode} />)}</section>
          <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-3 font-black">الفواتير المرتبطة</h3>{drilldown.invoices.map((invoice) => <div key={invoice.invoice_id} className={`border-b py-3 last:border-0 ${isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'}`}><div className="flex justify-between gap-3 text-xs"><div><p className="font-black">فاتورة #{invoice.invoice_number ?? '—'}</p><p className={`mt-1 text-[10px] ${mutedText(isDarkMode)}`}>{invoice.payment_slices.map((slice) => `${paymentLabel(slice.method)} ${formatCurrency(slice.amount)}${slice.entered_amount !== null && Math.abs(slice.entered_amount - slice.amount) >= 0.01 ? ` (مُدخل ${formatCurrency(slice.entered_amount)})` : ''}`).join(' + ')}{invoice.change_due ? ` · باقي ${formatCurrency(invoice.change_due)}` : ''}</p></div><p className="font-black">{formatCurrency(invoice.net_sales)}</p></div></div>)}{!drilldown.invoices.length && <EmptyBlock isDarkMode={isDarkMode} />}</section>
          <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-3 font-black">المصروفات والحركات النقدية</h3>{drilldown.expenses.map((expense) => <MetricLine key={expense.expense_id} label={expense.category_name} value={formatCurrency(expense.amount)} isDarkMode={isDarkMode} />)}{!drilldown.expenses.length && <EmptyBlock isDarkMode={isDarkMode} />}</section>
          <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-3 font-black">تحصيلات العربون</h3>{drilldown.deposits.map((deposit) => <MetricLine key={deposit.transaction_id} label={`${deposit.customer_name} · ${paymentLabel(deposit.method)}`} value={formatCurrency(deposit.amount)} isDarkMode={isDarkMode} />)}{!drilldown.deposits.length && <EmptyBlock isDarkMode={isDarkMode} />}</section>
          <div className={`space-y-2 px-2 text-[10px] leading-5 ${mutedText(isDarkMode)}`}>{drilldown.notes.map((note) => <p key={note}>{note}</p>)}</div>
        </div>}
      </ReportDrawer>}
    </div>
  );
};

export default FinanceReport;
