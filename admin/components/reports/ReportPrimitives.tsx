import React from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Download, RefreshCw, X } from 'lucide-react';
import type { DatePreset } from './reportUtils';
import { rangeForPreset } from './reportUtils';
import { comparisonText, formatNumber } from './reportUtils';
import type { AttentionSignal, MetricComparison, NamedOption, Pagination, ReportDateRange, ReportInsight } from './types';

export const panelClass = (isDarkMode: boolean) =>
  `rounded-[28px] border transition-colors ${isDarkMode ? 'border-white/[0.07] bg-[#111111]' : 'border-black/[0.06] bg-white shadow-[0_18px_50px_rgba(20,20,20,0.06)]'}`;

export const mutedText = (isDarkMode: boolean) => isDarkMode ? 'text-white/45' : 'text-black/45';

interface FilterBarProps {
  isDarkMode: boolean;
  range: ReportDateRange;
  preset: DatePreset;
  branchId: string;
  branches: NamedOption[];
  onRangeChange: (range: ReportDateRange) => void;
  onPresetChange: (preset: DatePreset) => void;
  onBranchChange: (value: string) => void;
  onExport?: () => void;
  exporting?: boolean;
  hideBranch?: boolean;
  children?: React.ReactNode;
}

export const ReportFilterBar: React.FC<FilterBarProps> = ({
  isDarkMode,
  range,
  preset,
  branchId,
  branches,
  onRangeChange,
  onPresetChange,
  onBranchChange,
  onExport,
  exporting = false,
  hideBranch = false,
  children,
}) => {
  const presets: Array<{ value: DatePreset; label: string }> = [
    { value: 'today', label: 'اليوم' },
    { value: 'yesterday', label: 'أمس' },
    { value: 'week', label: 'هذا الأسبوع' },
    { value: 'month', label: 'هذا الشهر' },
    { value: 'custom', label: 'مخصص' },
  ];
  const fieldClass = `h-10 rounded-xl border px-3 text-xs font-bold outline-none transition ${isDarkMode ? 'border-white/10 bg-white/[0.04] text-white focus:border-[#E53935]/60' : 'border-black/10 bg-[#FAFAFA] text-[#171717] focus:border-[#E53935]/50'}`;

  return (
    <div className={`${panelClass(isDarkMode)} p-3 sm:p-4`}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className={`flex flex-wrap rounded-xl p-1 ${isDarkMode ? 'bg-black/30' : 'bg-[#F1F1F1]'}`}>
            {presets.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  onPresetChange(item.value);
                  if (item.value !== 'custom') onRangeChange(rangeForPreset(item.value));
                }}
                className={`rounded-lg px-3 py-2 text-[11px] font-black transition ${preset === item.value ? 'bg-[#E53935] text-white shadow-lg shadow-red-500/15' : mutedText(isDarkMode)}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <input
            aria-label="من تاريخ"
            type="date"
            value={range.dateFrom}
            onChange={(event) => {
              onPresetChange('custom');
              onRangeChange({ ...range, dateFrom: event.target.value });
            }}
            className={fieldClass}
          />
          <input
            aria-label="إلى تاريخ"
            type="date"
            value={range.dateTo}
            onChange={(event) => {
              onPresetChange('custom');
              onRangeChange({ ...range, dateTo: event.target.value });
            }}
            className={fieldClass}
          />
          {!hideBranch && <select aria-label="الفرع" value={branchId} onChange={(event) => onBranchChange(event.target.value)} className={`${fieldClass} min-w-36`}>
            <option value="All">كافة الفروع</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>}
          {children}
        </div>
        {onExport && <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-black transition disabled:opacity-50 ${isDarkMode ? 'border-white/10 text-white hover:bg-white/[0.05]' : 'border-black/10 text-black hover:bg-black/[0.03]'}`}
        >
          <Download size={15} />
          {exporting ? 'جارٍ التجهيز' : 'تصدير Excel'}
        </button>}
      </div>
    </div>
  );
};

export const ReportLoading: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => (
  <div className={`${panelClass(isDarkMode)} flex min-h-[360px] flex-col items-center justify-center gap-4`}>
    <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E53935]/20 border-t-[#E53935]" />
    <p className={`text-sm font-bold ${mutedText(isDarkMode)}`}>جارٍ قراءة البيانات التشغيلية…</p>
  </div>
);

export const ReportError: React.FC<{ isDarkMode: boolean; message: string; onRetry: () => void }> = ({ isDarkMode, message, onRetry }) => (
  <div className={`${panelClass(isDarkMode)} flex min-h-[320px] flex-col items-center justify-center gap-4 p-8 text-center`}>
    <AlertCircle size={36} className="text-[#E53935]" />
    <div>
      <h3 className="mb-1 font-black">تعذر فتح التقرير</h3>
      <p className={`text-sm ${mutedText(isDarkMode)}`}>{message}</p>
    </div>
    <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-xl bg-[#E53935] px-5 py-2.5 text-xs font-black text-white">
      <RefreshCw size={15} /> إعادة المحاولة
    </button>
  </div>
);

export const EmptyBlock: React.FC<{ isDarkMode: boolean; title?: string }> = ({ isDarkMode, title = 'لا توجد بيانات في هذه الفترة' }) => (
  <div className={`flex min-h-40 items-center justify-center rounded-2xl border border-dashed p-8 text-center text-sm font-bold ${isDarkMode ? 'border-white/10 text-white/35' : 'border-black/10 text-black/35'}`}>
    {title}
  </div>
);

export const PaginationControls: React.FC<{ pagination: Pagination; isDarkMode: boolean; onPage: (page: number) => void }> = ({ pagination, isDarkMode, onPage }) => (
  <div className="flex items-center justify-between gap-4 pt-4">
    <p className={`text-xs font-bold ${mutedText(isDarkMode)}`}>
      {pagination.total} نتيجة · صفحة {pagination.page} من {pagination.total_pages}
    </p>
    <div className="flex items-center gap-2" dir="ltr">
      <button type="button" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)} className={`rounded-lg border p-2 disabled:opacity-25 ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}><ChevronLeft size={16} /></button>
      <button type="button" disabled={!pagination.has_more} onClick={() => onPage(pagination.page + 1)} className={`rounded-lg border p-2 disabled:opacity-25 ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}><ChevronRight size={16} /></button>
    </div>
  </div>
);

export const ReportDrawer: React.FC<{ isDarkMode: boolean; title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }> = ({ isDarkMode, title, subtitle, onClose, children }) => (
  <div className="fixed inset-0 z-[10000] bg-black/65 backdrop-blur-sm" role="dialog" aria-modal="true" dir="rtl">
    <button type="button" aria-label="إغلاق" className="absolute inset-0 cursor-default" onClick={onClose} />
    <aside className={`absolute inset-y-0 left-0 w-full max-w-xl overflow-y-auto border-r p-5 shadow-2xl sm:p-7 ${isDarkMode ? 'border-white/10 bg-[#0D0D0D] text-white' : 'border-black/10 bg-[#F8F8F8] text-[#171717]'}`}>
      <div className={`sticky top-0 z-10 mb-7 flex items-start justify-between border-b pb-5 backdrop-blur-xl ${isDarkMode ? 'border-white/10 bg-[#0D0D0D]/95' : 'border-black/10 bg-[#F8F8F8]/95'}`}>
        <div>
          <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-[#E53935]">تفاصيل التقرير</p>
          <h2 className="text-2xl font-black">{title}</h2>
          {subtitle && <p className={`mt-1 text-xs ${mutedText(isDarkMode)}`}>{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} className={`rounded-xl border p-2 ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}><X size={18} /></button>
      </div>
      {children}
    </aside>
  </div>
);

export const MetricLine: React.FC<{ label: string; value: React.ReactNode; isDarkMode: boolean }> = ({ label, value, isDarkMode }) => (
  <div className={`flex items-end justify-between gap-4 border-b py-3 last:border-b-0 ${isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'}`}>
    <span className={`text-xs font-bold ${mutedText(isDarkMode)}`}>{label}</span>
    <span className="text-sm font-black">{value}</span>
  </div>
);

export const ComparisonLine: React.FC<{
  comparison: MetricComparison;
  isDarkMode: boolean;
  formatter?: (value: number) => string;
}> = ({ comparison, isDarkMode, formatter = formatNumber }) => (
  <div className={`text-[10px] font-bold leading-5 ${mutedText(isDarkMode)}`}>
    <p className="text-xs">{comparisonText(comparison)}</p>
    <p>السابق {formatter(comparison.previous)} · الفرق {comparison.absolute_change > 0 ? '+' : ''}{formatter(comparison.absolute_change)}</p>
  </div>
);

export const InsightStrip: React.FC<{ insights: ReportInsight[]; isDarkMode: boolean }> = ({ insights, isDarkMode }) => {
  if (!insights.length) return null;
  return (
    <section className={`rounded-2xl border px-5 py-4 ${isDarkMode ? 'border-white/[0.07] bg-white/[0.018]' : 'border-black/[0.06] bg-black/[0.018]'}`}>
      <div className="grid gap-3 md:grid-cols-2">
        {insights.map((insight) => (
          <p key={`${insight.code}-${insight.text}`} className={`border-r-2 border-[#E6D690]/50 pr-3 text-xs font-bold leading-6 ${isDarkMode ? 'text-white/75' : 'text-black/70'}`}>{insight.text}</p>
        ))}
      </div>
    </section>
  );
};

export const ActiveFilters: React.FC<{
  filters: Array<{ key: string; label: string; onRemove: () => void }>;
  isDarkMode: boolean;
}> = ({ filters, isDarkMode }) => {
  if (!filters.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`text-[10px] font-black ${mutedText(isDarkMode)}`}>الفلاتر النشطة</span>
      {filters.map((filter) => (
        <button key={filter.key} type="button" onClick={filter.onRemove} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black transition ${isDarkMode ? 'border-white/10 bg-white/[0.04] hover:border-white/20' : 'border-black/10 bg-black/[0.025] hover:border-black/20'}`}>
          {filter.label}<X size={11} />
        </button>
      ))}
    </div>
  );
};

export const AttentionList: React.FC<{
  items: AttentionSignal[];
  isDarkMode: boolean;
  onEntity?: (id: number) => void;
}> = ({ items, isDarkMode, onEntity }) => {
  if (!items.length) return null;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-black">إشارات تحتاج نظرة</h3>
        <span className={`text-[10px] ${mutedText(isDarkMode)}`}>قواعد تشغيلية وصفية</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item, index) => (
          <button
            key={`${item.code}-${item.entity_id || index}`}
            type="button"
            disabled={!item.entity_id || !onEntity}
            onClick={() => item.entity_id && onEntity?.(item.entity_id)}
            className={`rounded-2xl border p-4 text-right transition disabled:cursor-default ${item.tone === 'attention' ? 'border-amber-500/20 bg-amber-500/[0.05]' : isDarkMode ? 'border-white/[0.07] bg-white/[0.02]' : 'border-black/[0.06] bg-black/[0.015]'}`}
          >
            <p className="mb-1 text-[11px] font-black text-[#E6D690]">{item.label}</p>
            <p className={`text-xs leading-6 ${isDarkMode ? 'text-white/65' : 'text-black/65'}`}>{item.detail}</p>
          </button>
        ))}
      </div>
    </section>
  );
};
