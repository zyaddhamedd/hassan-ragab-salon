import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Eye, Search, Sparkles, Users } from 'lucide-react';
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
import type { NamedOption, ReportDateRange, ServiceDrilldown, ServicesReportData } from './types';

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

const downloadBlob = (data: Blob, filename: string) => {
  const href = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
};

const ServicesReport: React.FC<Props> = ({ isDarkMode, range, preset, branchId, branches, onRangeChange, onPresetChange, onBranchChange }) => {
  const [data, setData] = useState<ServicesReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [barberId, setBarberId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('gross_value');
  const [exporting, setExporting] = useState(false);
  const [selectedService, setSelectedService] = useState<number | null>(null);
  const [drilldown, setDrilldown] = useState<ServiceDrilldown | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const params = useMemo(() => ({
    date_from: range.dateFrom,
    date_to: range.dateTo,
    branch_id: branchId === 'All' ? undefined : branchId,
    category_id: categoryId || undefined,
    service_id: serviceId || undefined,
    barber_id: barberId || undefined,
    search: search || undefined,
    page,
    per_page: 12,
    sort_by: sortBy,
    sort_dir: 'desc',
  }), [range, branchId, categoryId, serviceId, barberId, search, page, sortBy]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get<ServicesReportData>('/reports/services', { params });
      setData(response.data);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { void fetchReport(); }, [fetchReport]);
  useEffect(() => { setPage(1); }, [range, branchId, categoryId, serviceId, barberId, search, sortBy]);

  useEffect(() => {
    if (!selectedService) {
      setDrilldown(null);
      return;
    }
    const load = async () => {
      setDrillLoading(true);
      try {
        const response = await adminApi.get<ServiceDrilldown>(`/reports/services/${selectedService}`, { params });
        setDrilldown(response.data);
      } catch (requestError) {
        setError(errorMessage(requestError));
        setSelectedService(null);
      } finally {
        setDrillLoading(false);
      }
    };
    void load();
  }, [selectedService, params]);

  const exportReport = async () => {
    setExporting(true);
    try {
      const response = await adminApi.get('/reports/services/export/xlsx', { params, responseType: 'blob' });
      downloadBlob(response.data, `services-report-${range.dateFrom}-${range.dateTo}.xlsx`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setExporting(false);
    }
  };

  const maxServiceValue = Math.max(...(data?.service_ranking.map((item) => item.gross_value) || [1]), 1);
  const trendColor = isDarkMode ? '#E6D690' : '#B58A24';
  const trendPeak = data && data.trend.length ? data.trend.reduce((peak, row) => row.gross_value > peak.gross_value ? row : peak) : null;
  const activeFilters = [
    ...(branchId !== 'All' ? [{ key: 'branch', label: `الفرع: ${branches.find((item) => String(item.id) === branchId)?.name || branchId}`, onRemove: () => onBranchChange('All') }] : []),
    ...(categoryId ? [{ key: 'category', label: `الفئة: ${data?.filter_options.categories.find((item) => String(item.id) === categoryId)?.name || categoryId}`, onRemove: () => { setCategoryId(''); setServiceId(''); } }] : []),
    ...(serviceId ? [{ key: 'service', label: `الخدمة: ${data?.filter_options.services.find((item) => String(item.id) === serviceId)?.name || serviceId}`, onRemove: () => setServiceId('') }] : []),
    ...(barberId ? [{ key: 'barber', label: `المصفف: ${data?.filter_options.barbers.find((item) => String(item.id) === barberId)?.name || barberId}`, onRemove: () => setBarberId('') }] : []),
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
        <select aria-label="فئة الخدمة" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setServiceId(''); }} className={selectClass(isDarkMode)}>
          <option value="">كل الفئات</option>
          {data?.filter_options.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select aria-label="الخدمة" value={serviceId} onChange={(event) => setServiceId(event.target.value)} className={selectClass(isDarkMode)}>
          <option value="">كل الخدمات</option>
          {data?.filter_options.services.filter((item) => !categoryId || String(item.category_id) === categoryId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select aria-label="المصفف" value={barberId} onChange={(event) => setBarberId(event.target.value)} className={selectClass(isDarkMode)}>
          <option value="">كل المصففين</option>
          {data?.filter_options.barbers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </ReportFilterBar>

      <ActiveFilters filters={activeFilters} isDarkMode={isDarkMode} />

      {error && data && <div className="rounded-xl border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-xs font-bold text-red-500">{error}</div>}

      {loading && !data ? <ReportLoading isDarkMode={isDarkMode} /> : error && !data ? <ReportError isDarkMode={isDarkMode} message={error} onRetry={fetchReport} /> : data && (
        <>
          <section className={`${panelClass(isDarkMode)} overflow-hidden p-6 sm:p-8`}>
            <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-end">
              <div>
                <div className="mb-5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-[#E53935]"><Sparkles size={14} /> قيمة الخدمات المحققة</div>
                <p className={`mb-2 text-xs font-bold ${mutedText(isDarkMode)}`}>إجمالي سعر بنود الخدمات في الفواتير المدفوعة</p>
                <h2 className="text-4xl font-black tracking-tight sm:text-6xl" title={formatCurrency(data.summary.service_gross_value)}>{formatCompactCurrency(data.summary.service_gross_value)}</h2>
                <p className={`mt-3 text-[11px] ${mutedText(isDarkMode)}`}>{formatCurrency(data.summary.service_gross_value)} بالضبط</p>
                <div className="mt-4"><ComparisonLine comparison={data.comparison.service_gross_value} isDarkMode={isDarkMode} formatter={formatCurrency} /></div>
                <p className={`mt-2 text-[9px] ${mutedText(isDarkMode)}`}>فترة المقارنة: {formatShortDate(data.meta.previous_date_from)} – {formatShortDate(data.meta.previous_date_to)}</p>
              </div>
              <div className={`grid grid-cols-2 gap-5 rounded-2xl p-5 ${isDarkMode ? 'bg-white/[0.025]' : 'bg-black/[0.025]'}`}>
                <div><p className={`text-[10px] font-bold ${mutedText(isDarkMode)}`}>الخدمات المنفذة</p><p className="mt-1 text-xl font-black">{formatNumber(data.summary.service_units)}</p><div className="mt-1"><ComparisonLine comparison={data.comparison.service_units} isDarkMode={isDarkMode} /></div></div>
                <div><p className={`text-[10px] font-bold ${mutedText(isDarkMode)}`}>فواتير مدفوعة</p><p className="mt-1 text-xl font-black">{formatNumber(data.summary.paid_invoice_count)}</p><div className="mt-1"><ComparisonLine comparison={data.comparison.paid_invoice_count} isDarkMode={isDarkMode} /></div></div>
                <div><p className={`text-[10px] font-bold ${mutedText(isDarkMode)}`}>متوسط سعر الخدمة</p><p className="mt-1 text-lg font-black">{formatCurrency(data.summary.average_realized_service_price)}</p></div>
                <div><p className={`text-[10px] font-bold ${mutedText(isDarkMode)}`}>الخدمة الأقوى</p><p className="mt-1 text-sm font-black">{data.summary.top_service?.service_name || '—'}</p></div>
              </div>
            </div>
          </section>

          <InsightStrip insights={data.insights} isDarkMode={isDarkMode} />
          <AttentionList items={data.attention} isDarkMode={isDarkMode} onEntity={(id) => setServiceId(String(id))} />

          <div className="grid gap-6 xl:grid-cols-[1.05fr_1.4fr]">
            <section className={`${panelClass(isDarkMode)} p-6`}>
              <div className="mb-6">
                <h3 className="text-lg font-black">الخدمات القائدة</h3>
                <p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>الترتيب حسب قيمة بنود الخدمات</p>
              </div>
              <div className={`mb-6 grid grid-cols-3 gap-3 rounded-2xl p-3 text-center ${isDarkMode ? 'bg-white/[0.025]' : 'bg-black/[0.025]'}`}>
                <div><p className="text-base font-black">{formatNumber(data.concentration.top_one_service_share)}%</p><p className={`text-[9px] ${mutedText(isDarkMode)}`}>أعلى خدمة</p></div>
                <div><p className="text-base font-black">{formatNumber(data.concentration.top_three_services_share)}%</p><p className={`text-[9px] ${mutedText(isDarkMode)}`}>أعلى 3 خدمات</p></div>
                <div><p className="text-base font-black">{formatNumber(data.concentration.top_category_share)}%</p><p className={`text-[9px] ${mutedText(isDarkMode)}`}>أعلى تصنيف</p></div>
              </div>
              {data.service_ranking.length ? <div className="space-y-5">
                {data.service_ranking.map((item, index) => (
                  <div key={item.service_id} className="group">
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                      <button type="button" onClick={() => setServiceId(String(item.service_id))} className="font-black text-right"><span className="ml-2 text-[#E53935]">{String(index + 1).padStart(2, '0')}</span>{item.service_name}</button>
                      <div className="flex items-center gap-2"><span className="font-black">{formatCurrency(item.gross_value)}</span><button type="button" onClick={() => setSelectedService(item.service_id)} title="فتح التفاصيل" aria-label={`تفاصيل ${item.service_name}`} className={`rounded-lg border p-1.5 opacity-70 transition hover:opacity-100 ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}><Eye size={13} /></button></div>
                    </div>
                    <button type="button" aria-label={`تصفية حسب ${item.service_name}`} onClick={() => setServiceId(String(item.service_id))} className={`block h-1.5 w-full overflow-hidden rounded-full ${isDarkMode ? 'bg-white/[0.06]' : 'bg-black/[0.06]'}`}><span className="block h-full rounded-full bg-gradient-to-l from-[#E53935] to-[#E6D690]" style={{ width: `${Math.max(item.gross_value / maxServiceValue * 100, 3)}%` }} /></button>
                  </div>
                ))}
              </div> : <EmptyBlock isDarkMode={isDarkMode} />}
            </section>

            <section className={`${panelClass(isDarkMode)} p-6`}>
              <div className="mb-4">
                <h3 className="text-lg font-black">مسار قيمة الخدمات</h3>
                <p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>حسب تاريخ سداد الفاتورة بتوقيت القاهرة</p>
              </div>
              {data.trend.length ? <div className="h-[300px]" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.trend} margin={{ top: 15, right: 8, left: 0, bottom: 0 }}>
                    <defs><linearGradient id="serviceTrend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={trendColor} stopOpacity={0.36} /><stop offset="100%" stopColor={trendColor} stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 7" vertical={false} stroke={isDarkMode ? '#ffffff10' : '#00000010'} />
                    <XAxis dataKey="date" tickFormatter={formatShortDate} axisLine={false} tickLine={false} tick={{ fill: isDarkMode ? '#ffffff55' : '#00000055', fontSize: 10 }} minTickGap={28} />
                    <YAxis hide />
                    <Tooltip
                      formatter={(value, name) => [name === 'gross_value' ? formatCurrency(Number(value)) : formatNumber(Number(value)), name === 'gross_value' ? 'قيمة الخدمات' : name === 'units' ? 'الوحدات' : 'الفواتير المدفوعة']}
                      labelFormatter={(label) => `تاريخ القاهرة: ${formatShortDate(String(label))}`}
                      contentStyle={{ background: isDarkMode ? '#181818' : '#fff', border: 'none', borderRadius: 14, direction: 'rtl' }}
                    />
                    <Area type="monotone" dataKey="gross_value" stroke={trendColor} strokeWidth={2.5} fill="url(#serviceTrend)" />
                    <Line type="monotone" dataKey="units" stroke="transparent" dot={false} activeDot={false} />
                    <Line type="monotone" dataKey="paid_invoice_count" stroke="transparent" dot={false} activeDot={false} />
                    {trendPeak && <ReferenceDot x={trendPeak.date} y={trendPeak.gross_value} r={4} fill="#E53935" stroke="none" label={{ value: 'أعلى يوم', position: 'top', fill: isDarkMode ? '#ffffff88' : '#00000088', fontSize: 9 }} />}
                  </AreaChart>
                </ResponsiveContainer>
              </div> : <EmptyBlock isDarkMode={isDarkMode} />}
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className={`${panelClass(isDarkMode)} p-6`}>
              <h3 className="mb-5 text-base font-black">مزيج الفئات</h3>
              {data.categories.length ? data.categories.slice(0, 6).map((item) => <button type="button" key={item.category_id} onClick={() => { setCategoryId(String(item.category_id)); setServiceId(''); }} title="تصفية التقرير حسب الفئة" className="block w-full text-right"><MetricLine label={item.category_name} value={`${formatNumber(item.contribution_percent)}%`} isDarkMode={isDarkMode} /></button>) : <EmptyBlock isDarkMode={isDarkMode} />}
            </section>
            <section className={`${panelClass(isDarkMode)} p-6`}>
              <h3 className="mb-5 text-base font-black">مساهمة الفروع</h3>
              {data.branches.length ? data.branches.slice(0, 6).map((item) => <button type="button" key={item.branch_id} onClick={() => onBranchChange(String(item.branch_id))} title="تصفية التقرير حسب الفرع" className="block w-full text-right"><MetricLine label={item.branch_name} value={formatCurrency(item.gross_value)} isDarkMode={isDarkMode} /></button>) : <EmptyBlock isDarkMode={isDarkMode} />}
            </section>
            <section className={`${panelClass(isDarkMode)} p-6`}>
              <div className="mb-5 flex items-center justify-between"><h3 className="text-base font-black">إسناد المصففين</h3><Users size={17} className="text-[#E53935]" /></div>
              {data.barbers.length ? data.barbers.slice(0, 6).map((item) => <button type="button" key={item.barber_id} onClick={() => setBarberId(String(item.barber_id))} title="تصفية التقرير حسب المصفف" className="block w-full text-right"><MetricLine label={item.barber_name} value={formatCurrency(item.gross_attributed_value)} isDarkMode={isDarkMode} /></button>) : <EmptyBlock isDarkMode={isDarkMode} />}
            </section>
          </div>

          <section className={`${panelClass(isDarkMode)} p-6`}>
            <div className="mb-5"><h3 className="text-lg font-black">الخدمات الأقل نشاطاً</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>غياب النشاط، النشاط المحدود، أو انخفاض يتجاوز 25% بعد حد أدنى سابق</p></div>
            {data.weak_services.length ? <div className="grid gap-x-8 md:grid-cols-2">{data.weak_services.slice(0, 6).map((item) => <button type="button" key={item.service_id} onClick={() => setServiceId(String(item.service_id))} className={`flex items-center justify-between gap-4 border-b py-3 text-right ${isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'}`}><div><p className="text-xs font-black">{item.service_name}</p><p className={`mt-1 text-[10px] ${mutedText(isDarkMode)}`}>{item.reason === 'ZERO_ACTIVITY' ? 'بدون نشاط مدفوع' : item.reason === 'MATERIAL_DECLINE' ? `انخفاض ${formatNumber(Math.abs(item.percent_change || 0))}%` : 'نشاط محدود'}</p></div><span className="text-xs font-black">{formatNumber(item.current_units)} خدمة</span></button>)}</div> : <EmptyBlock isDarkMode={isDarkMode} title="لا توجد إشارات نشاط منخفض ضمن الفلاتر الحالية" />}
          </section>

          <section className={`${panelClass(isDarkMode)} p-5 sm:p-6`}>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><h3 className="text-lg font-black">تفاصيل الخدمات</h3><p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>اضغط على أي خدمة لفتح سجلها التحليلي</p></div>
              <div className="flex gap-2">
                <label className={`flex h-10 items-center gap-2 rounded-xl border px-3 ${isDarkMode ? 'border-white/10 bg-white/[0.03]' : 'border-black/10 bg-black/[0.02]'}`}><Search size={15} className={mutedText(isDarkMode)} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث" className="w-32 bg-transparent text-xs font-bold outline-none" /></label>
                <select aria-label="ترتيب" value={sortBy} onChange={(event) => setSortBy(event.target.value)} className={selectClass(isDarkMode)}><option value="gross_value">حسب القيمة</option><option value="units">حسب العدد</option><option value="average_price">حسب المتوسط</option><option value="name">حسب الاسم</option></select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-right text-xs">
                <thead className={mutedText(isDarkMode)}><tr className={`border-b ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}><th className="px-3 py-4">الخدمة</th><th className="px-3 py-4">الفئة</th><th className="px-3 py-4">العدد</th><th className="px-3 py-4">القيمة</th><th className="px-3 py-4">المتوسط</th><th className="px-3 py-4">المساهمة</th><th className="px-3 py-4">الفرع الأعلى</th><th className="px-3 py-4">المصفف الأعلى</th></tr></thead>
                <tbody>{data.table.items.map((item) => <tr key={item.service_id} onClick={() => setSelectedService(item.service_id)} className={`cursor-pointer border-b transition last:border-b-0 ${isDarkMode ? 'border-white/[0.05] hover:bg-white/[0.03]' : 'border-black/[0.05] hover:bg-black/[0.02]'}`}><td className="px-3 py-4 font-black">{item.service_name}</td><td className={`px-3 py-4 ${mutedText(isDarkMode)}`}>{item.category_name}</td><td className="px-3 py-4">{formatNumber(item.units)}</td><td className="px-3 py-4 font-black">{formatCurrency(item.gross_value)}</td><td className="px-3 py-4">{formatCurrency(item.average_price)}</td><td className="px-3 py-4">{formatNumber(item.contribution_percent)}%</td><td className="px-3 py-4">{item.top_branch?.name || '—'}</td><td className="px-3 py-4">{item.top_barber?.name || '—'}</td></tr>)}</tbody>
              </table>
              {!data.table.items.length && <EmptyBlock isDarkMode={isDarkMode} />}
            </div>
            <PaginationControls pagination={data.table.pagination} isDarkMode={isDarkMode} onPage={setPage} />
          </section>

          <p className={`px-2 text-[11px] leading-6 ${mutedText(isDarkMode)}`}>القيمة المعروضة هي إجمالي سعر بنود الخدمات قبل توزيع خصم الفاتورة. أسماء الخدمات والفئات تستخدم بيانات الكتالوج الحالية.</p>
        </>
      )}

      {selectedService && <ReportDrawer isDarkMode={isDarkMode} title={drilldown?.service.name || 'تفاصيل الخدمة'} subtitle={drilldown?.service.category_name} onClose={() => setSelectedService(null)}>
        {drillLoading || !drilldown ? <ReportLoading isDarkMode={isDarkMode} /> : <div className="space-y-6">
          <InsightStrip insights={drilldown.analysis.insights} isDarkMode={isDarkMode} />
          <section className={`${panelClass(isDarkMode)} p-5`}>
            <MetricLine label="قيمة الخدمة" value={formatCurrency(drilldown.summary.service_gross_value)} isDarkMode={isDarkMode} />
            <div className="py-2"><ComparisonLine comparison={drilldown.comparison.service_gross_value} isDarkMode={isDarkMode} formatter={formatCurrency} /></div>
            <MetricLine label="عدد مرات التنفيذ" value={formatNumber(drilldown.summary.service_units)} isDarkMode={isDarkMode} />
            <div className="py-2"><ComparisonLine comparison={drilldown.comparison.service_units} isDarkMode={isDarkMode} /></div>
            <MetricLine label="متوسط السعر" value={formatCurrency(drilldown.summary.average_realized_service_price)} isDarkMode={isDarkMode} />
            <MetricLine label="مساهمتها ضمن الفلاتر" value={`${formatNumber(drilldown.analysis.contribution_share)}%`} isDarkMode={isDarkMode} />
            <MetricLine label="حصة الفرع الأعلى" value={`${formatNumber(drilldown.analysis.top_branch_share)}%`} isDarkMode={isDarkMode} />
            <MetricLine label="حصة المصفف الأعلى" value={`${formatNumber(drilldown.analysis.top_barber_share)}%`} isDarkMode={isDarkMode} />
          </section>
          <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-4 font-black">المسار خلال الفترة</h3>{drilldown.trend.length ? <div className="h-36" dir="ltr"><ResponsiveContainer width="100%" height="100%"><AreaChart data={drilldown.trend}><XAxis dataKey="date" hide /><YAxis hide /><Tooltip formatter={(value) => formatCurrency(Number(value))} labelFormatter={(label) => formatShortDate(String(label))} contentStyle={{ background: isDarkMode ? '#181818' : '#fff', border: 'none', borderRadius: 12, direction: 'rtl' }} /><Area type="monotone" dataKey="gross_value" stroke="#E53935" strokeWidth={2} fill="#E5393522" /></AreaChart></ResponsiveContainer></div> : <EmptyBlock isDarkMode={isDarkMode} />}</section>
          <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-3 font-black">الفروع</h3>{drilldown.branches.map((item) => <MetricLine key={item.branch_id} label={item.branch_name} value={formatCurrency(item.gross_value)} isDarkMode={isDarkMode} />)}</section>
          <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-3 font-black">إسناد المصففين</h3>{drilldown.barbers.length ? drilldown.barbers.map((item) => <MetricLine key={item.barber_id} label={`${item.barber_name} · ${formatNumber(item.units)} خدمة`} value={formatCurrency(item.gross_attributed_value)} isDarkMode={isDarkMode} />) : <EmptyBlock isDarkMode={isDarkMode} title="لا يوجد إسناد لمصفف خلال الفترة" />}</section>
          <section className={`${panelClass(isDarkMode)} p-5`}><h3 className="mb-3 font-black">أحدث الفواتير</h3>{drilldown.recent_invoices.length ? drilldown.recent_invoices.map((item) => <div key={`${item.invoice_id}-${item.barber_name}`} className={`border-b py-3 last:border-0 ${isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'}`}><div className="flex justify-between text-xs font-black"><span>{item.invoice_number}</span><span>{formatCurrency(item.gross_value)}</span></div><p className={`mt-1 text-[11px] ${mutedText(isDarkMode)}`}>{item.branch_name} · {item.barber_name || 'بدون إسناد'} · {item.date || '—'}</p></div>) : <EmptyBlock isDarkMode={isDarkMode} />}</section>
        </div>}
      </ReportDrawer>}
    </div>
  );
};

export default ServicesReport;
