import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes, CalendarDays, ChevronLeft, Eye, ShieldCheck, Truck, WalletCards,
} from 'lucide-react';
import adminApi from '../../api/client';
import {
  AttentionList, ComparisonLine, EmptyBlock, MetricLine, mutedText, panelClass,
  ReportDrawer, ReportError, ReportFilterBar, ReportLoading,
} from './ReportPrimitives';
import { errorMessage, formatCompactCurrency, formatCurrency, formatNumber, formatShortDate, movementLabel, type DatePreset } from './reportUtils';
import type { NamedOption, OperationsDrilldown, OperationsPagination, OperationsReportData, ReportDateRange } from './types';

interface Props {
  isDarkMode: boolean;
  range: ReportDateRange;
  preset: DatePreset;
  branchId: string;
  branches: NamedOption[];
  onRangeChange: (range: ReportDateRange) => void;
  onPresetChange: (preset: DatePreset) => void;
  onBranchChange: (branch: string) => void;
  onNavigateFinance: () => void;
}

type View = 'control' | 'appointments' | 'inventory' | 'supply' | 'context';
type PageKey = 'business_days' | 'appointments' | 'inventory' | 'movements' | 'supply' | 'shipments' | 'returns';
type Selection = { type: 'business-day' | 'appointment' | 'inventory' | 'supply-request' | 'shipment' | 'return'; id: number; title: string };
const initialPages: Record<PageKey, number> = { business_days: 1, appointments: 1, inventory: 1, movements: 1, supply: 1, shipments: 1, returns: 1 };

const viewOptions: Array<{ key: View; label: string; icon: React.ReactNode }> = [
  { key: 'control', label: 'يوم العمل والحضور', icon: <ShieldCheck size={15}/> },
  { key: 'appointments', label: 'المواعيد', icon: <CalendarDays size={15}/> },
  { key: 'inventory', label: 'المخزون والحركة', icon: <Boxes size={15}/> },
  { key: 'supply', label: 'الإمداد والشحن', icon: <Truck size={15}/> },
  { key: 'context', label: 'العربون والبرومو', icon: <WalletCards size={15}/> },
];

const downloadBlob = (data: Blob, filename: string) => {
  const href = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
};

const cardTone = (kind: 'period' | 'snapshot' | 'control') => ({
  period: 'text-sky-400 bg-sky-500/10',
  snapshot: 'text-[#E6D690] bg-amber-500/10',
  control: 'text-violet-400 bg-violet-500/10',
}[kind]);

const kindLabel = { period: 'نشاط فترة', snapshot: 'لقطة حالية', control: 'مقياس رقابي' };

const HeroCard: React.FC<{ dark: boolean; label: string; value: string; kind: 'period' | 'snapshot' | 'control'; comparison?: OperationsReportData['comparison'][string]; primary?: boolean }> = ({ dark, label, value, kind, comparison, primary }) => (
  <article className={`${panelClass(dark)} ${primary ? 'md:col-span-2' : ''} p-5 sm:p-6`}>
    <div className="mb-5 flex items-start justify-between gap-3">
      <p className={`text-xs font-black ${mutedText(dark)}`}>{label}</p>
      <span className={`rounded-full px-2 py-1 text-[9px] font-black ${cardTone(kind)}`}>{kindLabel[kind]}</span>
    </div>
    <p className={`${primary ? 'text-4xl' : 'text-2xl'} font-black tracking-tight`}>{value}</p>
    {comparison ? <div className="mt-4"><ComparisonLine comparison={comparison} isDarkMode={dark}/></div> : null}
  </article>
);

const SectionTitle: React.FC<{ eyebrow: string; title: string; note?: string }> = ({ eyebrow, title, note }) => <div className="mb-5">
  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E53935]">{eyebrow}</p>
  <h3 className="mt-2 text-lg font-black">{title}</h3>
  {note ? <p className="mt-2 text-[10px] leading-5 text-current/45">{note}</p> : null}
</div>;

const statusArabic: Record<string, string> = {
  OPEN: 'مفتوح', CLOSED: 'مغلق', scheduled: 'مجدول', completed: 'مكتمل', cancelled: 'ملغي',
  CANCELLED: 'ملغاة', PENDING: 'معلق', SENT: 'مرسل', RECEIVED: 'مستلم', IN_TRANSIT: 'قيد النقل',
  RETURNED_TO_MAIN: 'عاد للمخزن', RETURNED_TO_SUPPLIER: 'عاد للمورد', REJECTED: 'مرفوض',
  HEALTHY: 'سليم', LOW: 'منخفض', OUT: 'نافد', NEGATIVE: 'سالب',
};

const hours = (value: number | null) => value === null ? 'غير متاح' : `${formatNumber(value)} ساعة`;

const OperationsReport: React.FC<Props> = ({ isDarkMode, range, preset, branchId, branches, onRangeChange, onPresetChange, onBranchChange, onNavigateFinance }) => {
  const [data, setData] = useState<OperationsReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [view, setView] = useState<View>('control');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detail, setDetail] = useState<OperationsDrilldown | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pages, setPages] = useState<Record<PageKey, number>>(initialPages);

  const params = useMemo(() => ({
    date_from: range.dateFrom,
    date_to: range.dateTo,
    branch_id: branchId === 'All' ? undefined : branchId,
    detail_per_page: 20,
    ...Object.fromEntries(Object.entries(pages).map(([key, page]) => [`${key}_page`, page])),
  }), [range, branchId, pages]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get<OperationsReportData>('/reports/operations', { params });
      setData(response.data);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { void fetchReport(); }, [fetchReport]);
  useEffect(() => { setSelection(null); setDetail(null); setPages(initialPages); }, [range, branchId]);
  useEffect(() => {
    if (!selection) { setDetail(null); return; }
    const load = async () => {
      setDetailLoading(true);
      try {
        const response = await adminApi.get<OperationsDrilldown>(`/reports/operations/${selection.type}/${selection.id}`, { params });
        setDetail(response.data);
      } catch (requestError) {
        setError(errorMessage(requestError));
        setSelection(null);
      } finally { setDetailLoading(false); }
    };
    void load();
  }, [selection, params]);

  const exportReport = async () => {
    setExporting(true);
    try {
      const response = await adminApi.get('/reports/operations/export/xlsx', { params, responseType: 'blob' });
      downloadBlob(response.data, `operations-${range.dateFrom}-${range.dateTo}.xlsx`);
    } catch (requestError) { setError(errorMessage(requestError)); }
    finally { setExporting(false); }
  };
  const changePage = (key: PageKey, page: number) => setPages((current) => ({ ...current, [key]: Math.max(page, 1) }));

  return <div className="space-y-6">
    <ReportFilterBar isDarkMode={isDarkMode} range={range} preset={preset} branchId={branchId} branches={branches} onRangeChange={onRangeChange} onPresetChange={onPresetChange} onBranchChange={onBranchChange} onExport={exportReport} exporting={exporting}/>
    {error && !data ? <ReportError isDarkMode={isDarkMode} message={error} onRetry={fetchReport}/> : null}
    {loading && !data ? <ReportLoading isDarkMode={isDarkMode}/> : null}
    {data ? <>
      <section>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E53935]">Operations intelligence</p><h2 className="mt-2 text-2xl font-black">ما يحدث تشغيليًا الآن</h2></div>
          <p className={`max-w-xl text-[10px] leading-5 ${mutedText(isDarkMode)}`}>النشاط يقارن بفترة مساوية. المخزون والحالات المفتوحة لقطات حالية ولا تحمل مقارنة تاريخية مصطنعة.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <HeroCard dark={isDarkMode} label="جلسات الحضور المكتملة" value={formatNumber(data.summary.completed_sessions)} kind="period" comparison={data.comparison.completed_sessions} primary/>
          <HeroCard dark={isDarkMode} label="ساعات الحضور المسجلة" value={`${formatNumber(data.summary.recorded_hours)} س`} kind="period" comparison={data.comparison.recorded_hours}/>
          <HeroCard dark={isDarkMode} label="المواعيد" value={formatNumber(data.summary.appointment_count)} kind="period" comparison={data.comparison.appointment_count}/>
          <HeroCard dark={isDarkMode} label="حصة الحالة المكتملة" value={`${formatNumber(data.summary.appointment_completion_share)}%`} kind="period"/>
          <HeroCard dark={isDarkMode} label="تحصيلات العربون" value={`${formatNumber(data.summary.deposit_collection_count)} · ${formatCompactCurrency(data.summary.deposit_collection_amount)}`} kind="period" comparison={data.comparison.deposit_collection_amount}/>
          <HeroCard dark={isDarkMode} label="أيام عمل قديمة مفتوحة" value={formatNumber(data.summary.old_open_business_days)} kind="control"/>
          <HeroCard dark={isDarkMode} label="منخفض / نافد حاليًا" value={`${formatNumber(data.summary.current_low_stock_products)} / ${formatNumber(data.summary.current_out_of_stock_products)}`} kind="snapshot"/>
        </div>
      </section>

      <AttentionList items={data.attention} isDarkMode={isDarkMode}/>

      <nav className={`${panelClass(isDarkMode)} flex max-w-full gap-2 overflow-x-auto p-2`} aria-label="أقسام العمليات">
        {viewOptions.map((option) => <button key={option.key} type="button" onClick={() => setView(option.key)} className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 text-xs font-black transition ${view === option.key ? 'bg-[#E53935] text-white shadow-lg shadow-red-500/15' : mutedText(isDarkMode)}`}>{option.icon}{option.label}</button>)}
      </nav>

      {loading ? <p className={`text-center text-[10px] ${mutedText(isDarkMode)}`}>جارٍ تحديث الصفحة…</p> : null}
      {view === 'control' ? <ControlView data={data} dark={isDarkMode} open={setSelection} onPage={changePage} onNavigateFinance={onNavigateFinance}/> : null}
      {view === 'appointments' ? <AppointmentsView data={data} dark={isDarkMode} open={setSelection} onPage={changePage}/> : null}
      {view === 'inventory' ? <InventoryView data={data} dark={isDarkMode} open={setSelection} onPage={changePage}/> : null}
      {view === 'supply' ? <SupplyView data={data} dark={isDarkMode} open={setSelection} onPage={changePage}/> : null}
      {view === 'context' ? <ContextView data={data} dark={isDarkMode}/> : null}
    </> : null}

    {selection ? <ReportDrawer isDarkMode={isDarkMode} title={selection.title} subtitle="عرض تحليلي للقراءة فقط" onClose={() => setSelection(null)}>
      {detailLoading || !detail ? <ReportLoading isDarkMode={isDarkMode}/> : <DetailBody value={detail} dark={isDarkMode}/>}
    </ReportDrawer> : null}
  </div>;
};

const ControlView: React.FC<{ data: OperationsReportData; dark: boolean; open: (value: Selection) => void; onPage: (key: PageKey, page: number) => void; onNavigateFinance: () => void }> = ({ data, dark, open, onPage, onNavigateFinance }) => <div className="space-y-6">
  <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
    <div className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Workforce operations" title="الحضور المسجل" note="الساعات والجلسات المسجلة فقط؛ لا تمثل الغياب أو الالتزام بجدول."/>
      <div className="grid gap-3 sm:grid-cols-2"><MetricLine label="جلسات مكتملة" value={formatNumber(data.attendance.completed_sessions)} isDarkMode={dark}/><MetricLine label="جلسات غير مكتملة" value={formatNumber(data.attendance.incomplete_sessions)} isDarkMode={dark}/><MetricLine label="متوسط مدة الجلسة" value={hours(data.attendance.average_session_hours)} isDarkMode={dark}/><MetricLine label="أيام عمل مسجلة" value={formatNumber(data.attendance.recorded_workdays)} isDarkMode={dark}/><MetricLine label="حاضرون الآن" value={formatNumber(data.attendance.present_now)} isDarkMode={dark}/><MetricLine label="روابط يوم عمل مفقودة" value={formatNumber(data.attendance.controls.missing_business_day_link)} isDarkMode={dark}/></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">{Object.entries(data.attendance.checkout_sources).map(([source, count]) => <div key={source} className="rounded-2xl bg-current/[0.035] p-4"><p className="text-xl font-black">{formatNumber(count)}</p><p className={`mt-1 text-[10px] ${mutedText(dark)}`}>{source === 'MANUAL' ? 'خروج يدوي' : source === 'BUSINESS_DAY_CLOSE' ? 'عند غلق اليوم' : 'تصحيح إداري'}</p></div>)}</div>
    </div>
    <div className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Control conditions" title="استثناءات الحضور ويوم العمل"/>
      <MetricLine label="حضور مفتوح على يوم مغلق" value={formatNumber(data.attendance.controls.present_on_closed_day)} isDarkMode={dark}/><MetricLine label="جلسات متداخلة" value={formatNumber(data.attendance.controls.overlapping_sessions)} isDarkMode={dark}/><MetricLine label="مدة خروج غير صالحة" value={formatNumber(data.attendance.controls.invalid_duration_sessions)} isDarkMode={dark}/><MetricLine label="تصحيحات متكررة وفق الحد المعلن" value={formatNumber(data.attendance.controls.repeated_corrections.length)} isDarkMode={dark}/><MetricLine label="أيام بها تصحيح إداري" value={formatNumber(data.business_days.days_with_admin_corrections)} isDarkMode={dark}/>
    </div>
  </section>
  <section className={`${panelClass(dark)} overflow-hidden p-5 sm:p-7`}><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><SectionTitle eyebrow="Business-day control" title="أيام العمل" note="السياق المالي الكامل موجود في تقرير المالية والخزنة."/><button type="button" onClick={onNavigateFinance} className="shrink-0 rounded-xl border border-current/10 px-4 py-2 text-[10px] font-black">فتح المالية والخزنة</button></div>
    <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Mini label="افتتحت في الفترة" value={data.business_days.opened}/><Mini label="أغلقت" value={data.business_days.closed}/><Mini label="مفتوحة الآن" value={data.business_days.currently_open}/><Mini label="قديمة مفتوحة" value={data.business_days.old_open}/><Mini label="متوسط مدة المغلق" value={data.business_days.average_closed_duration_hours} suffix=" س"/></div>
    <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Mini label="رابط سابق مفقود" value={data.business_days.continuity.missing_previous_link || 0}/><Mini label="رابط سابق من فرع آخر" value={data.business_days.continuity.cross_branch_previous || 0}/><Mini label="تفرع في السلسلة" value={data.business_days.continuity.chain_forks || 0}/><Mini label="مغلق دون وقت غلق" value={data.business_days.continuity.closed_missing_closed_at || 0}/><Mini label="مفتوح وله وقت غلق" value={data.business_days.continuity.open_with_closed_at || 0}/><Mini label="حضور مفتوح على يوم مغلق" value={data.business_days.continuity.present_on_closed_day || 0}/></div><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-right text-xs"><thead><tr className={mutedText(dark)}><th className="p-3">اليوم</th><th className="p-3">الفرع</th><th className="p-3">الحالة</th><th className="p-3">المدة</th><th className="p-3">الفتح / الغلق</th><th className="p-3">الحضور</th><th className="p-3">خروج تلقائي</th><th className="p-3">تصحيح</th><th className="p-3"></th></tr></thead><tbody>{data.business_days.items.slice(0, 20).map((row) => <tr key={row.business_day_id} className="border-t border-current/[0.06]"><td className="p-3 font-black">{formatShortDate(row.business_date)}<small className={`block ${mutedText(dark)}`}>#{row.business_day_id}</small></td><td className="p-3">{row.branch_name}</td><td className="p-3">{statusArabic[row.status] || row.status}{row.old_open ? <span className="mr-2 text-amber-500">قديم</span> : null}</td><td className="p-3">{hours(row.duration_hours)}</td><td className="p-3">{row.opened_by}<small className={`block ${mutedText(dark)}`}>{row.closed_by || 'لم يغلق'}</small></td><td className="p-3">{row.attendance_sessions}</td><td className="p-3">{row.auto_checkouts}</td><td className="p-3">{row.admin_corrections}</td><td className="p-3"><OpenButton label="تفاصيل يوم العمل" onClick={() => open({ type: 'business-day', id: row.business_day_id, title: `يوم عمل #${row.business_day_id}` })}/></td></tr>)}</tbody></table></div>
    {!data.business_days.items.length ? <EmptyBlock isDarkMode={dark}/> : null}<Pager value={data.business_days.pagination} onChange={(page) => onPage('business_days', page)} dark={dark}/>
  </section>
</div>;

const AppointmentsView: React.FC<{ data: OperationsReportData; dark: boolean; open: (value: Selection) => void; onPage: (key: PageKey, page: number) => void }> = ({ data, dark, open, onPage }) => <div className="space-y-6">
  <section className="grid gap-6 xl:grid-cols-[1fr_1.15fr]">
    <div className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Current stored status" title="مزيج حالات المواعيد" note="الحالة المعروضة هي الحالة الحالية للسجل، وليست لقطة تاريخية وقت الفترة."/><MetricLine label="مجدولة" value={`${formatNumber(data.appointments.scheduled)} · ${formatNumber(data.appointments.scheduled_share)}%`} isDarkMode={dark}/><MetricLine label="مكتملة" value={`${formatNumber(data.appointments.completed)} · ${formatNumber(data.appointments.completed_share)}%`} isDarkMode={dark}/><MetricLine label="ملغاة" value={`${formatNumber(data.appointments.cancelled)} · ${formatNumber(data.appointments.cancelled_share)}%`} isDarkMode={dark}/><MetricLine label="مستقبلية مجدولة" value={formatNumber(data.appointments.future_scheduled)} isDarkMode={dark}/><MetricLine label="موعد سابق ما زال مجدولًا" value={formatNumber(data.appointments.past_still_scheduled)} isDarkMode={dark}/></div>
    <div className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Descriptive workload" title="المواعيد المسندة للمصففين" note="وصف للحمل المجدول فقط؛ لا يمثل استغلالًا أو سعة."/>
      <div className="space-y-3">{data.appointments.by_barber.map((row) => <div key={row.barber_id} className="rounded-2xl border border-current/[0.08] p-4"><div className="flex items-center justify-between"><strong className="text-xs">{row.barber_name}</strong><strong>{formatNumber(row.appointments)}</strong></div><p className={`mt-2 text-[10px] ${mutedText(dark)}`}>{row.completed} مكتمل · {row.cancelled} ملغي · {row.future_scheduled} مستقبلي</p></div>)}{!data.appointments.by_barber.length ? <EmptyBlock isDarkMode={dark}/> : null}</div>
    </div>
  </section>
  <section className={`${panelClass(dark)} overflow-hidden p-5 sm:p-7`}><SectionTitle eyebrow="Appointments" title="تفاصيل المواعيد في الفترة" note="لا توجد علاقة موثوقة بين الموعد والفاتورة؛ لا يعرض التقرير تحويلًا أو إيراد موعد."/><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-right text-xs"><thead><tr className={mutedText(dark)}><th className="p-3">التاريخ</th><th className="p-3">العميل</th><th className="p-3">المصفف</th><th className="p-3">الخدمة</th><th className="p-3">الفرع</th><th className="p-3">الحالة الحالية</th><th className="p-3">العربون</th><th className="p-3"></th></tr></thead><tbody>{data.appointments.items.map((row) => <tr key={row.appointment_id} className="border-t border-current/[0.06]"><td className="p-3 font-black">{formatShortDate(row.date)} · {row.time}</td><td className="p-3">{row.customer_name}</td><td className="p-3">{row.barber_name || 'غير مسند'}</td><td className="p-3">{row.service_name || 'غير مسجلة'}</td><td className="p-3">{row.branch_name}</td><td className="p-3">{statusArabic[row.status] || row.status}</td><td className="p-3">{row.deposit_collection_count ? `${row.deposit_collection_count} تحصيل` : 'لا يوجد تحصيل مسجل'}</td><td className="p-3"><OpenButton label="تفاصيل الموعد" onClick={() => open({ type: 'appointment', id: row.appointment_id, title: `موعد #${row.appointment_id}` })}/></td></tr>)}</tbody></table></div>{!data.appointments.items.length ? <EmptyBlock isDarkMode={dark}/> : null}<Pager value={data.appointments.pagination} onChange={(page) => onPage('appointments', page)} dark={dark}/></section>
</div>;

const InventoryView: React.FC<{ data: OperationsReportData; dark: boolean; open: (value: Selection) => void; onPage: (key: PageKey, page: number) => void }> = ({ data, dark, open, onPage }) => <div className="space-y-6">
  <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]"><div className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Current snapshot" title="حالة المخزون الحالية" note="لا توجد مقارنة بفترة سابقة لأن النظام لا يحتفظ بلقطات تاريخية."/><MetricLine label="إجمالي الوحدات الحالية" value={formatNumber(data.inventory.current_stock_units)} isDarkMode={dark}/><MetricLine label="سجلات منتج / فرع" value={formatNumber(data.inventory.tracked_rows)} isDarkMode={dark}/><MetricLine label="منخفض" value={formatNumber(data.inventory.low)} isDarkMode={dark}/><MetricLine label="نافد" value={formatNumber(data.inventory.out)} isDarkMode={dark}/><MetricLine label="سالب" value={formatNumber(data.inventory.negative)} isDarkMode={dark}/><MetricLine label="غير متاح تشغيليًا" value={formatNumber(data.inventory.unavailable)} isDarkMode={dark}/><MetricLine label="اختلاف تغطية الدفعات" value={formatNumber(data.inventory.batch_mismatch_count)} isDarkMode={dark}/></div>
    <div className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Period movements" title="حركات المخزون" note="الكميات موجبة مطلقة؛ الاتجاه من نوع الحركة. اتجاه التسويات غير محفوظ."/><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.movements.types.map((row) => <div key={row.type} className="rounded-2xl border border-current/[0.08] p-4"><p className="text-xl font-black">{formatNumber(row.absolute_quantity)}</p><p className="mt-1 text-[10px] font-black">{movementLabel(row.type)}</p><p className={`mt-1 text-[9px] ${mutedText(dark)}`}>{row.events} حركة</p></div>)}</div><p className={`mt-5 text-[10px] leading-5 ${mutedText(dark)}`}>التسويات: {data.movements.adjustment_events} حدث بكمية مطلقة {data.movements.adjustment_absolute_quantity}. لا يتم احتساب صافي اتجاه التسوية.</p></div></section>
  <section className={`${panelClass(dark)} overflow-hidden p-5 sm:p-7`}><SectionTitle eyebrow="Inventory health" title="المنتجات والفروع" note={`بطيء الحركة = مخزون حالي موجب ومبيعات الفترة ≤ ${data.inventory.slow_moving_max_units} وحدة. كمية الدفعات المتتبعة تخضع للمطابقة.`}/><div className="mb-5 grid gap-3 sm:grid-cols-3"><Mini label="بيع مدفوع دون حركة بيع" value={data.inventory.reconciliation.paid_sales_without_movement || 0}/><Mini label="حركة بيع دون فاتورة مدفوعة" value={data.inventory.reconciliation.sale_movements_without_paid_invoice || 0}/><Mini label="نشاط دون سجل مخزون" value={data.inventory.reconciliation.missing_stock_rows_with_activity || 0}/></div><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-right text-xs"><thead><tr className={mutedText(dark)}><th className="p-3">المنتج</th><th className="p-3">الفرع</th><th className="p-3">الحالي</th><th className="p-3">الحد</th><th className="p-3">الحالة</th><th className="p-3">مبيعات الفترة</th><th className="p-3">بطيء</th><th className="p-3">دفعات متتبعة</th><th className="p-3">مطابقة</th><th className="p-3"></th></tr></thead><tbody>{data.inventory.items.map((row) => <tr key={row.stock_id} className="border-t border-current/[0.06]"><td className="p-3 font-black">{row.product_name}<small className={`block ${mutedText(dark)}`}>{row.category}</small></td><td className="p-3">{row.branch_name}</td><td className="p-3">{row.current_stock}</td><td className="p-3">{row.min_stock_threshold}</td><td className="p-3">{statusArabic[row.state]}</td><td className="p-3">{row.units_sold}</td><td className="p-3">{row.slow_moving ? 'نعم' : 'لا'}</td><td className="p-3">{row.tracked_batch_quantity}</td><td className="p-3">{row.batch_mismatch ? 'تحتاج تسوية' : 'مطابق'}</td><td className="p-3"><OpenButton label="تفاصيل المنتج" onClick={() => open({ type: 'inventory', id: row.stock_id, title: `${row.product_name} · ${row.branch_name}` })}/></td></tr>)}</tbody></table></div>{!data.inventory.items.length ? <EmptyBlock isDarkMode={dark}/> : null}<Pager value={data.inventory.pagination} onChange={(page) => onPage('inventory', page)} dark={dark}/></section>
  <section className={`${panelClass(dark)} overflow-hidden p-5 sm:p-7`}><SectionTitle eyebrow="Operational stock usage" title="الاستهلاك الداخلي والحركات الحديثة" note="الاستهلاك استخدام تشغيلي للمخزون، وليس مصروفًا أو خسارة أو COGS."/><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-right text-xs"><thead><tr className={mutedText(dark)}><th className="p-3">التاريخ</th><th className="p-3">المنتج</th><th className="p-3">الفرع</th><th className="p-3">النوع</th><th className="p-3">الكمية</th><th className="p-3">المنفذ</th><th className="p-3">السبب</th></tr></thead><tbody>{data.movements.items.map((row) => <tr key={row.movement_id} className="border-t border-current/[0.06]"><td className="p-3">{new Date(row.date).toLocaleString('ar-EG')}</td><td className="p-3 font-black">{row.product_name}</td><td className="p-3">{row.branch_name}</td><td className="p-3">{movementLabel(row.type)}</td><td className="p-3">{row.quantity}</td><td className="p-3">{row.actor_name || '—'}</td><td className="p-3">{row.notes || '—'}</td></tr>)}</tbody></table></div><Pager value={data.movements.pagination} onChange={(page) => onPage('movements', page)} dark={dark}/></section>
</div>;

const SupplyView: React.FC<{ data: OperationsReportData; dark: boolean; open: (value: Selection) => void; onPage: (key: PageKey, page: number) => void }> = ({ data, dark, open, onPage }) => <div className="space-y-6">
  <section className="grid gap-6 xl:grid-cols-3"><div className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Supply requests" title="حالة الطلبات"/><MetricLine label="أنشئت في الفترة" value={formatNumber(data.supply.created)} isDarkMode={dark}/><MetricLine label="معلقة حاليًا" value={formatNumber(data.supply.current_pending)} isDarkMode={dark}/><MetricLine label="مرسلة في عينة الفترة" value={formatNumber(data.supply.sent)} isDarkMode={dark}/><MetricLine label="مستلمة في عينة الفترة" value={formatNumber(data.supply.received)} isDarkMode={dark}/><MetricLine label="وحدات مطلوبة" value={formatNumber(data.supply.requested_units)} isDarkMode={dark}/><MetricLine label="وحدات نهائية" value={formatNumber(data.supply.final_units)} isDarkMode={dark}/></div><div className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Recorded cycle time" title="الفترات الزمنية المتاحة" note="لا توجد مرحلة اعتماد منفصلة أو SLA مسجل."/><MetricLine label="متوسط الإنشاء إلى الإرسال" value={hours(data.supply.average_created_to_sent_hours)} isDarkMode={dark}/><MetricLine label="متوسط الإرسال إلى الاستلام" value={hours(data.supply.average_sent_to_received_hours)} isDarkMode={dark}/><MetricLine label="متوسط الإنشاء إلى الاستلام" value={hours(data.supply.average_created_to_received_hours)} isDarkMode={dark}/></div><div className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Directional shipments" title="الشحنات"/><MetricLine label="صادر أُنشئ" value={`${data.shipments.outbound_created} · ${data.shipments.outbound_units} وحدة`} isDarkMode={dark}/><MetricLine label="وارد أُنشئ" value={`${data.shipments.inbound_created} · ${data.shipments.inbound_units} وحدة`} isDarkMode={dark}/><MetricLine label="مستلم" value={`${formatNumber(data.shipments.received)} · ${formatNumber(data.shipments.received_units)} وحدة`} isDarkMode={dark}/><MetricLine label="قيد النقل حاليًا" value={formatNumber(data.shipments.current_in_transit)} isDarkMode={dark}/><MetricLine label="متوسط مدة الاستلام" value={hours(data.shipments.average_receipt_duration_hours)} isDarkMode={dark}/></div></section>
  <section className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Current in transit" title="شحنات قيد النقل" note="العمر وصفي فقط؛ لا يعني تأخيرًا أو تجاوز SLA."/><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.shipments.in_transit.map((row) => <button key={row.shipment_id} type="button" onClick={() => open({ type: 'shipment', id: row.shipment_id, title: row.shipment_ref })} className="rounded-2xl border border-current/[0.08] p-4 text-right"><div className="flex items-center justify-between"><strong>{row.shipment_ref}</strong><ChevronLeft size={15}/></div><p className={`mt-2 text-[10px] ${mutedText(dark)}`}>{row.source_name || 'مورد'} ← {row.destination_name}</p><p className="mt-3 text-xs font-black">قيد النقل منذ {formatNumber(row.age_days)} يومًا</p></button>)}{!data.shipments.in_transit.length ? <EmptyBlock isDarkMode={dark}/> : null}</div></section>
  <section className="grid gap-6 xl:grid-cols-2"><div className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Requests" title="طلبات الإمداد"/><div className="space-y-2">{data.supply.items.map((row) => <button key={row.request_id} type="button" onClick={() => open({ type: 'supply-request', id: row.request_id, title: row.request_ref })} className="flex w-full items-center justify-between rounded-2xl border border-current/[0.08] p-4 text-right"><span><strong className="block text-xs">{row.request_ref}</strong><small className={mutedText(dark)}>{row.branch_name} · {statusArabic[row.status] || row.status}</small></span><span className="text-xs font-black">{row.final_units || row.requested_units} وحدة</span></button>)}{!data.supply.items.length ? <EmptyBlock isDarkMode={dark}/> : null}</div><Pager value={data.supply.pagination} onChange={(page) => onPage('supply', page)} dark={dark}/></div><div className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Returns" title="طلبات المرتجعات" note="الكميات تشغيلية ولا تمثل خسارة مالية."/><div className="mb-4 grid grid-cols-2 gap-3"><Mini label="معلقة حاليًا" value={data.returns.current_pending}/><Mini label="وحدات مرتجعة" value={data.returns.returned_units}/><Mini label="عادت للمخزن" value={data.returns.returned_to_main}/><Mini label="عادت للمورد" value={data.returns.returned_to_supplier}/></div><div className="mb-4 flex flex-wrap gap-2">{data.returns.reason_mix.map((row) => <span key={row.reason} className="rounded-full bg-current/[0.05] px-3 py-2 text-[10px] font-black">{row.reason}: {row.requests} طلب · {row.units} وحدة</span>)}</div><div className="space-y-2">{data.returns.items.map((row) => <button key={row.return_id} type="button" onClick={() => open({ type: 'return', id: row.return_id, title: row.return_ref })} className="flex w-full items-center justify-between rounded-2xl border border-current/[0.08] p-4 text-right"><span><strong className="block text-xs">{row.product_name}</strong><small className={mutedText(dark)}>{row.reason} · {statusArabic[row.status] || row.status}</small></span><span className="text-xs font-black">{row.quantity} وحدة</span></button>)}{!data.returns.items.length ? <EmptyBlock isDarkMode={dark}/> : null}</div><Pager value={data.returns.pagination} onChange={(page) => onPage('returns', page)} dark={dark}/></div></section>
  <section className={`${panelClass(dark)} overflow-hidden p-5 sm:p-7`}><SectionTitle eyebrow="Shipment history" title="سجل الشحنات في الفترة"/><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-right text-xs"><thead><tr className={mutedText(dark)}><th className="p-3">المرجع</th><th className="p-3">المسار</th><th className="p-3">الحالة</th><th className="p-3">الوحدات</th><th className="p-3">الإنشاء</th><th className="p-3"></th></tr></thead><tbody>{data.shipments.items.map((row) => <tr key={row.shipment_id} className="border-t border-current/[0.06]"><td className="p-3 font-black">{row.shipment_ref}</td><td className="p-3">{row.source_name || 'مورد'} ← {row.destination_name}</td><td className="p-3">{statusArabic[row.status] || row.status}</td><td className="p-3">{row.units}</td><td className="p-3">{new Date(row.created_at).toLocaleString('ar-EG')}</td><td className="p-3"><OpenButton label="تفاصيل الشحنة" onClick={() => open({ type: 'shipment', id: row.shipment_id, title: row.shipment_ref })}/></td></tr>)}</tbody></table></div>{!data.shipments.items.length ? <EmptyBlock isDarkMode={dark}/> : null}<Pager value={data.shipments.pagination} onChange={(page) => onPage('shipments', page)} dark={dark}/></section>
</div>;

const ContextView: React.FC<{ data: OperationsReportData; dark: boolean }> = ({ data, dark }) => <div className="space-y-6">
  <div className="grid gap-6 xl:grid-cols-2">
    <section className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Deposit operations" title="تحصيلات العربون" note="تحصيلات فقط. لا يعرض التقرير تطبيق العربون أو رده أو تسويته."/><MetricLine label="عدد التحصيلات" value={formatNumber(data.deposits.collection_count)} isDarkMode={dark}/><MetricLine label="قيمة التحصيلات" value={formatCurrency(data.deposits.collection_amount)} isDarkMode={dark}/>{data.deposits.methods.map((row) => <MetricLine key={row.method} label={`${row.method} · ${row.count} تحصيل`} value={formatCurrency(row.amount)} isDarkMode={dark}/>)}</section>
    <section className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Paid promo operations" title="نشاط البرومو" note="فواتير مدفوعة فقط، باستخدام لقطة الاسترداد التاريخية. لا يمثل ROI أو تأثيرًا سببيًا."/><MetricLine label="الاستردادات" value={formatNumber(data.promo.redemption_count)} isDarkMode={dark}/><MetricLine label="حصة الفواتير" value={`${formatNumber(data.promo.promo_invoice_share)}%`} isDarkMode={dark}/><MetricLine label="خصم البرومو" value={formatCurrency(data.promo.discount_amount)} isDarkMode={dark}/><MetricLine label="صافي فواتير البرومو" value={formatCurrency(data.promo.net_sales)} isDarkMode={dark}/>{data.promo.codes.map((row) => <MetricLine key={row.code} label={`${row.code} · ${row.redemptions} استخدام`} value={formatCurrency(row.discount_amount)} isDarkMode={dark}/>)}</section>
  </div>
  <div className="grid gap-6 xl:grid-cols-3">
    <section className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Collection trend" title="اتجاه التحصيل اليومي"/>{data.deposits.trend.map((row) => <MetricLine key={row.date} label={`${formatShortDate(row.date)} · ${row.count} تحصيل`} value={formatCurrency(row.amount)} isDarkMode={dark}/>)}{!data.deposits.trend.length ? <EmptyBlock isDarkMode={dark}/> : null}</section>
    <section className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Customer context" title="سياق سجلات عملاء البرومو" note="تصنيف وصفي مبني على أول فاتورة مدفوعة مسجلة، ولا يثبت اكتسابًا أو عودة بسبب البرومو."/><MetricLine label="أول نشاط مدفوع مسجل" value={formatNumber(data.promo.customer_context.first_known)} isDarkMode={dark}/><MetricLine label="معروف مدفوعًا سابقًا" value={formatNumber(data.promo.customer_context.previously_known)} isDarkMode={dark}/><MetricLine label="دون سجل عميل" value={formatNumber(data.promo.customer_context.anonymous)} isDarkMode={dark}/>{data.promo.branches.slice(0, 4).map((row) => <MetricLine key={row.branch_id} label={`${row.branch_name} · ${row.redemptions} استخدام`} value={formatCurrency(row.discount_amount)} isDarkMode={dark}/>)}</section>
    <section className={`${panelClass(dark)} p-5 sm:p-7`}><SectionTitle eyebrow="Immutable eligibility snapshot" title="فئات الخدمات المؤهلة المسجلة"/>{data.promo.eligible_categories.slice(0, 8).map((row) => <MetricLine key={row.category_name} label={`${row.category_name} · ${row.eligible_units} وحدة`} value={formatCurrency(row.eligible_value)} isDarkMode={dark}/>)}{!data.promo.eligible_categories.length ? <EmptyBlock isDarkMode={dark} title="لا توجد بنود أهلية تفصيلية في لقطات الفترة"/> : null}</section>
  </div>
</div>;

const Mini: React.FC<{ label: string; value: number; suffix?: string }> = ({ label, value, suffix = '' }) => <div className="rounded-2xl bg-current/[0.035] p-4"><p className="text-xl font-black">{formatNumber(value)}{suffix}</p><p className="mt-1 text-[10px] text-current/45">{label}</p></div>;
const Pager: React.FC<{ value: OperationsPagination; onChange: (page: number) => void; dark: boolean }> = ({ value, onChange, dark }) => value.total_pages > 1 ? <div className="mt-5 flex items-center justify-between gap-3"><button type="button" disabled={value.page <= 1} onClick={() => onChange(value.page - 1)} className="rounded-xl border border-current/10 px-4 py-2 text-[10px] font-black disabled:opacity-30">السابق</button><span className={`text-[10px] ${mutedText(dark)}`}>صفحة {value.page} من {value.total_pages} · {value.total} سجل</span><button type="button" disabled={!value.has_more} onClick={() => onChange(value.page + 1)} className="rounded-xl border border-current/10 px-4 py-2 text-[10px] font-black disabled:opacity-30">التالي</button></div> : null;
const OpenButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => <button type="button" aria-label={label} onClick={onClick} className="rounded-lg border border-current/10 p-2"><Eye size={14}/></button>;

const DetailBody: React.FC<{ value: OperationsDrilldown; dark: boolean }> = ({ value, dark }) => <div className="space-y-4">{Object.entries(value).map(([key, item]) => {
  if (Array.isArray(item)) return <section key={key} className={`${panelClass(dark)} p-5`}><h3 className="mb-4 text-sm font-black">{detailLabel(key)}</h3><div className="space-y-2">{item.map((entry, index) => <div key={index} className="rounded-xl border border-current/[0.07] p-3"><DetailObject value={entry} dark={dark}/></div>)}{!item.length ? <EmptyBlock isDarkMode={dark}/>: null}</div></section>;
  if (item && typeof item === 'object') return <section key={key} className={`${panelClass(dark)} p-5`}><h3 className="mb-4 text-sm font-black">{detailLabel(key)}</h3><DetailObject value={item} dark={dark}/></section>;
  return <MetricLine key={key} label={detailLabel(key)} value={formatDetail(item)} isDarkMode={dark}/>;
})}</div>;

const DetailObject: React.FC<{ value: unknown; dark: boolean }> = ({ value, dark }) => {
  if (!value || typeof value !== 'object') return <span>{formatDetail(value)}</span>;
  return <>{Object.entries(value as Record<string, unknown>).map(([key, item]) => <MetricLine key={key} label={detailLabel(key)} value={formatDetail(item)} isDarkMode={dark}/>)}</>;
};

const detailLabel = (key: string) => ({ appointment_id: 'رقم الموعد', business_day_id: 'يوم العمل', branch_name: 'الفرع', customer_name: 'العميل', barber_name: 'المصفف', service_name: 'الخدمة', status: 'الحالة', date: 'التاريخ', time: 'الوقت', deposit_amount: 'قيمة العربون المسجلة', collections: 'تحصيلات العربون', current_stock: 'المخزون الحالي', min_stock_threshold: 'حد المخزون', is_available: 'متاح تشغيليًا', movements: 'الحركات', items: 'البنود', created_at: 'وقت الإنشاء', sent_at: 'وقت الإرسال', received_at: 'وقت الاستلام', resolved_at: 'وقت الحل', quantity: 'الكمية', reason: 'السبب', resolution_note: 'ملاحظة الحل' }[key] || key.replaceAll('_', ' '));
const formatDetail = (value: unknown): React.ReactNode => value === null || value === undefined || value === '' ? '—' : typeof value === 'boolean' ? (value ? 'نعم' : 'لا') : typeof value === 'object' ? JSON.stringify(value) : String(value);

export default OperationsReport;
