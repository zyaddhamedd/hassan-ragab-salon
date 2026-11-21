import React, { useState } from 'react';
import {
  Calendar,
  DollarSign,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  FileText,
  Clock,
  Layers,
  Save,
  ShieldCheck,
  RotateCcw,
  Sliders,
  Info,
  ChevronRight,
  ArrowRight,
} from 'lucide-react';
import {
  PayrollPreviewResponse,
  SettlementRecord,
  SettlementAdjustmentInput,
} from './settlementTypes';

interface SettlementControlsProps {
  employee: {
    id: number;
    name: string;
    role?: string;
    branch_id?: number;
    branch_name?: string;
    avatar_url?: string;
    base_salary?: number;
    wallet_balance?: number;
  };
  dateFrom: string;
  dateTo: string;
  onDateChange: (from: string, to: string) => void;
  preview: PayrollPreviewResponse | null;
  activeDraft: SettlementRecord | null;
  settlementHistory: SettlementRecord[];
  onSelectDraftOrHistory: (settlement: SettlementRecord | null) => void;
  baseSalaryAllocated: number;
  onBaseSalaryChange: (amount: number) => void;
  adjustments: SettlementAdjustmentInput[];
  onAdjustmentsChange: (adjustments: SettlementAdjustmentInput[]) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  isSaving: boolean;
  isApproving: boolean;
  isLoadingPreview: boolean;
  onSaveDraft: () => void;
  onUpdateDraft: () => void;
  onDiscardDraft: () => void;
  onApprove: () => void;
  onCancelSettlement: () => void;
  onOpenSourceInspector: () => void;
  conflictError: string | null;
  onRefreshData: () => void;
  isDarkMode: boolean;
  userRole?: string;
}

// Local date formatter avoiding UTC shift
const formatLocalDate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const SettlementControls: React.FC<SettlementControlsProps> = ({
  employee,
  dateFrom,
  dateTo,
  onDateChange,
  preview,
  activeDraft,
  settlementHistory,
  onSelectDraftOrHistory,
  baseSalaryAllocated,
  onBaseSalaryChange,
  adjustments,
  onAdjustmentsChange,
  notes,
  onNotesChange,
  isSaving,
  isApproving,
  isLoadingPreview,
  onSaveDraft,
  onUpdateDraft,
  onDiscardDraft,
  onApprove,
  onCancelSettlement,
  onOpenSourceInspector,
  conflictError,
  onRefreshData,
  isDarkMode,
  userRole,
}) => {
  const [activeTab, setActiveTab] = useState<'adjustments' | 'history'>('adjustments');

  // Timezone-safe date preset application
  const applyPreset = (preset: 'last7' | 'last10' | 'last15' | 'currentMonth' | 'prevMonth') => {
    const now = new Date();
    let from = new Date(now);
    let to = new Date(now);

    if (preset === 'last7') {
      from.setDate(now.getDate() - 6);
    } else if (preset === 'last10') {
      from.setDate(now.getDate() - 9);
    } else if (preset === 'last15') {
      from.setDate(now.getDate() - 14);
    } else if (preset === 'currentMonth') {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (preset === 'prevMonth') {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 0);
    }

    onDateChange(formatLocalDate(from), formatLocalDate(to));
  };

  // Adjustments handling
  const handleAddAdjustment = (isAddition: boolean) => {
    const newAdj: SettlementAdjustmentInput = {
      id: `temp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      category: isAddition ? 'BONUS' : 'PENALTY',
      is_addition: isAddition,
      amount: 0,
      reason: '',
    };
    onAdjustmentsChange([...adjustments, newAdj]);
  };

  const handleUpdateAdjustment = (
    index: number,
    field: keyof SettlementAdjustmentInput,
    value: any
  ) => {
    const updated = [...adjustments];
    updated[index] = { ...updated[index], [field]: value };
    onAdjustmentsChange(updated);
  };

  const handleRemoveAdjustment = (index: number) => {
    const updated = adjustments.filter((_, i) => i !== index);
    onAdjustmentsChange(updated);
  };

  // Fixed salary suggestion
  const suggestedSalary = preview?.fixed_salary_info?.suggested_prorated_base_salary || 0;
  const configuredSalary = preview?.fixed_salary_info?.configured_base_salary ?? (employee.base_salary || 0);

  // Status checks
  const isApproved = activeDraft && ['APPROVED', 'PAID', 'PARTIALLY_PAID'].includes(activeDraft.status);
  const isCancelled = activeDraft && activeDraft.status === 'CANCELLED';
  const isPersistedDraft = activeDraft && activeDraft.status === 'DRAFT';
  const isLivePreview = !activeDraft;

  // Validation: Check if any adjustments have missing reasons
  const hasInvalidAdjustments = adjustments.some(
    (adj) => Number(adj.amount) > 0 && !adj.reason.trim()
  );

  return (
    <div
      className={`h-full flex flex-col overflow-y-auto custom-scrollbar select-none transition-colors duration-300 ${
        isDarkMode ? 'bg-[#0E0F12] text-[#E4E4E7]' : 'bg-[#F9FAFB] text-gray-900'
      }`}
      style={{ direction: 'rtl' }}
    >
      {/* ── 1. EMPLOYEE IDENTITY & MASTHEAD ───────────────────────────────── */}
      <div className={`p-4 sm:p-5 border-b backdrop-blur-md sticky top-0 z-20 ${
        isDarkMode ? 'bg-[#0E0F12]/95 border-white/[0.06]' : 'bg-white/95 border-gray-200'
      }`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {employee.avatar_url ? (
              <img
                src={employee.avatar_url}
                alt={employee.name}
                className="w-10 h-10 rounded-xl object-cover ring-1 ring-white/10 shadow-sm"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#8B0000] to-[#400000] text-amber-200 font-bold flex items-center justify-center text-sm shadow-sm">
                {employee.name.charAt(0)}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm tracking-wide text-white">{employee.name}</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold bg-white/5 border border-white/10 text-gray-300">
                  {employee.role || 'فني كوافير'}
                </span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {employee.branch_name || 'الفرع الرئيسي'} • المحفظة الحالية:{' '}
                <strong className="font-mono text-emerald-400">
                  {Number(employee.wallet_balance || 0).toLocaleString('en-US')} ج.م
                </strong>
              </p>
            </div>
          </div>

          {/* Mode Pill */}
          <div>
            {isLivePreview && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-500/10 border border-amber-500/25 text-amber-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                معاينة حية
              </span>
            )}
            {isPersistedDraft && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-500/10 border border-blue-500/25 text-blue-400">
                <FileText size={11} />
                مسودة #{activeDraft.settlement_number}
              </span>
            )}
            {isApproved && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
                <ShieldCheck size={11} />
                معتمدة #{activeDraft.settlement_number}
              </span>
            )}
            {isCancelled && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-500/10 border border-rose-500/25 text-rose-400">
                ملغاة #{activeDraft.settlement_number}
              </span>
            )}
          </div>
        </div>

        {/* Segmented Tab Switcher */}
        <div className="flex items-center gap-1 mt-3.5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.05]">
          <button
            type="button"
            onClick={() => setActiveTab('adjustments')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'adjustments'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Sliders size={12} />
            عناصر وإعدادات التسوية
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'history'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Layers size={12} />
            سجل التسويات ({settlementHistory.length})
          </button>
        </div>
      </div>

      {/* ── CONFLICT ALERT (HTTP 409) ────────────────────────────────────── */}
      {conflictError && (
        <div className="m-4 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5 shadow-lg">
          <AlertTriangle size={16} className="shrink-0 text-rose-400 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="font-bold text-rose-200">تعارض بيانات مالية (تحديث إلزامي)</p>
            <p className="leading-relaxed opacity-90">{conflictError}</p>
            <button
              onClick={onRefreshData}
              className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 font-semibold border border-rose-500/40 transition-colors cursor-pointer"
            >
              <RefreshCw size={11} className={isLoadingPreview ? 'animate-spin' : ''} />
              تحديث ومزامنة البيانات الآن
            </button>
          </div>
        </div>
      )}

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      {activeTab === 'history' ? (
        /* History & Draft Selector */
        <div className="p-4 sm:p-5 space-y-3 flex-1">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">
              تسويات الموظف المحفوظة
            </h3>
            {activeDraft && (
              <button
                type="button"
                onClick={() => onSelectDraftOrHistory(null)}
                className="text-xs text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus size={12} />
                بدء تسوية جديدة (معاينة)
              </button>
            )}
          </div>

          {settlementHistory.length === 0 ? (
            <div className="text-center py-12 text-gray-500 space-y-2">
              <Layers size={32} className="mx-auto opacity-30" />
              <p className="text-xs">لا توجد تسويات سابقة مسجلة لهذا الموظف</p>
            </div>
          ) : (
            <div className="space-y-2">
              {settlementHistory.map((s) => {
                const isSelected = activeDraft?.id === s.id;
                return (
                  <div
                    key={s.id}
                    onClick={() => onSelectDraftOrHistory(s)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-white/[0.06] border-[#C5A880]/50 ring-1 ring-[#C5A880]/30 shadow-md'
                        : 'bg-white/[0.02] border-white/[0.05] hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-xs font-bold text-[#C5A880]">
                        #{s.settlement_number}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                          s.status === 'APPROVED'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : s.status === 'DRAFT'
                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                            : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                        }`}
                      >
                        {s.status === 'APPROVED' ? 'معتمدة' : s.status === 'DRAFT' ? 'مسودة' : s.status}
                      </span>
                    </div>

                    <div className="text-xs flex items-center justify-between text-gray-400">
                      <span>{s.date_from} ← {s.date_to}</span>
                      <span className="font-mono font-bold text-white text-xs">
                        {Number(s.summary?.net_payable || 0).toLocaleString('en-US')} ج.م
                      </span>
                    </div>

                    {s.is_absorbed && (
                      <div className="mt-1.5 text-[10px] text-amber-400/90 flex items-center gap-1">
                        <Info size={10} />
                        تم ترحيل واستيعاب رصيدها في تسوية أحدث
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Settlement Controls Form */
        <div className="p-4 sm:p-5 space-y-5 flex-1">
          {/* Section A: Date Range & Presets */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                <Calendar size={13} className="text-[#C5A880]" />
                النطاق الزمني للتسوية (شامل)
              </label>
              {isLoadingPreview && (
                <span className="text-[11px] text-amber-400 flex items-center gap-1">
                  <RefreshCw size={11} className="animate-spin" />
                  جاري المزامنة...
                </span>
              )}
            </div>

            {/* Clean Presets Strip */}
            {!isApproved && (
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => applyPreset('currentMonth')}
                  className="text-[11px] px-2.5 py-1 rounded-lg border bg-white/[0.02] border-white/10 hover:bg-white/[0.06] text-gray-300 font-medium transition-all cursor-pointer"
                >
                  الشهر الحالي
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('last15')}
                  className="text-[11px] px-2.5 py-1 rounded-lg border bg-white/[0.02] border-white/10 hover:bg-white/[0.06] text-gray-300 font-medium transition-all cursor-pointer"
                >
                  آخر 15 يوماً
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('last10')}
                  className="text-[11px] px-2.5 py-1 rounded-lg border bg-white/[0.02] border-white/10 hover:bg-white/[0.06] text-gray-300 font-medium transition-all cursor-pointer"
                >
                  آخر 10 أيام
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('last7')}
                  className="text-[11px] px-2.5 py-1 rounded-lg border bg-white/[0.02] border-white/10 hover:bg-white/[0.06] text-gray-300 font-medium transition-all cursor-pointer"
                >
                  آخر 7 أيام
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('prevMonth')}
                  className="text-[11px] px-2.5 py-1 rounded-lg border bg-white/[0.02] border-white/10 hover:bg-white/[0.06] text-gray-300 font-medium transition-all cursor-pointer"
                >
                  الشهر السابق
                </button>
              </div>
            )}

            {/* Date Pickers Row */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">من تاريخ</label>
                <input
                  type="date"
                  value={dateFrom}
                  disabled={Boolean(isApproved)}
                  onChange={(e) => onDateChange(e.target.value, dateTo)}
                  className={`w-full px-3 py-1.5 text-xs rounded-xl border font-mono outline-none transition-all bg-[#141518] border-white/10 text-white focus:border-[#C5A880]/50 ${
                    isApproved ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">إلى تاريخ</label>
                <input
                  type="date"
                  value={dateTo}
                  disabled={Boolean(isApproved)}
                  onChange={(e) => onDateChange(dateFrom, e.target.value)}
                  className={`w-full px-3 py-1.5 text-xs rounded-xl border font-mono outline-none transition-all bg-[#141518] border-white/10 text-white focus:border-[#C5A880]/50 ${
                    isApproved ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                />
              </div>
            </div>

            {preview?.meta?.days_in_period && (
              <div className="text-[11px] text-gray-400 flex items-center justify-between pt-0.5">
                <span>المدة المحددة: {preview.meta.days_in_period} يوماً</span>
                {preview.meta.already_settled_items_excluded_count > 0 && (
                  <span className="text-amber-400/90 font-medium">
                    (استبعاد {preview.meta.already_settled_items_excluded_count} عمليات مسواة)
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Section B: Inspection Trigger */}
          <button
            type="button"
            onClick={onOpenSourceInspector}
            className="w-full py-2 px-3 rounded-xl border border-white/[0.08] hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.04] text-xs font-semibold flex items-center justify-between transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <FileText size={13} className="text-[#C5A880]" />
              <span>فحص ومطابقة تفاصيل المعاملات المصدرية</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#C5A880]/15 text-[#C5A880] font-mono">
              {preview?.line_items?.commissions?.length || 0} عملية
            </span>
          </button>

          {/* Section C: Manager Base Salary Allocation */}
          <div className="p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                <DollarSign size={13} className="text-[#C5A880]" />
                الراتب الأساسي المعتمد من المدير
              </label>
              {configuredSalary > 0 && (
                <span className="text-[10px] text-gray-400">
                  المثبت: {configuredSalary.toLocaleString('en-US')} ج.م
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="number"
                  min="0"
                  step="10"
                  disabled={Boolean(isApproved)}
                  value={baseSalaryAllocated || ''}
                  onChange={(e) => onBaseSalaryChange(Math.max(0, parseFloat(e.target.value) || 0))}
                  placeholder="0.00"
                  className={`w-full px-3 py-1.5 text-sm rounded-xl border font-mono font-bold outline-none transition-all bg-[#18191C] border-white/10 text-white focus:border-[#C5A880] ${
                    isApproved ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                  ج.م
                </span>
              </div>

              {!isApproved && suggestedSalary > 0 && (
                <button
                  type="button"
                  onClick={() => onBaseSalaryChange(suggestedSalary)}
                  className="px-2.5 py-1.5 rounded-xl bg-[#C5A880]/10 hover:bg-[#C5A880]/20 border border-[#C5A880]/30 text-[#C5A880] text-[11px] font-semibold transition-all whitespace-nowrap cursor-pointer"
                  title="تطبيق المبلغ التناسبي المقترح للفترة"
                >
                  تطبيق الاقتراح ({suggestedSalary.toLocaleString('en-US')})
                </button>
              )}
            </div>

            <p className="text-[10px] text-gray-400">
              يتطلب تخصيصاً صريحاً ولا يُضاف تلقائياً منعاً للتكرار.
            </p>
          </div>

          {/* Section D: Manual Adjustments */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                <Sliders size={13} className="text-[#C5A880]" />
                التسويات اليدوية (مكافآت وخصومات)
              </label>
              {!isApproved && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleAddAdjustment(true)}
                    className="text-[11px] px-2 py-0.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/20 transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Plus size={11} />
                    مكافأة (+)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddAdjustment(false)}
                    className="text-[11px] px-2 py-0.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-semibold border border-rose-500/20 transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Plus size={11} />
                    خصم (-)
                  </button>
                </div>
              )}
            </div>

            {adjustments.length === 0 ? (
              <div className="p-3 rounded-xl border border-dashed border-white/10 text-center text-[11px] text-gray-400">
                لا توجد تسويات يدوية. أضف مكافأة أو خصماً موثقاً بسبب إلزامي.
              </div>
            ) : (
              <div className="space-y-2">
                {adjustments.map((adj, index) => {
                  const isAddition = adj.is_addition;
                  const isMissingReason = Number(adj.amount) > 0 && !adj.reason.trim();

                  return (
                    <div
                      key={adj.id || index}
                      className={`p-2.5 rounded-xl border space-y-2 transition-all bg-[#141518] ${
                        isMissingReason
                          ? 'border-amber-500/60 ring-1 ring-amber-500/30'
                          : 'border-white/[0.08]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1">
                          <select
                            disabled={Boolean(isApproved)}
                            value={adj.category}
                            onChange={(e) => {
                              const cat = e.target.value as any;
                              const addition = ['BONUS', 'OTHER_ADDITION'].includes(cat);
                              handleUpdateAdjustment(index, 'category', cat);
                              handleUpdateAdjustment(index, 'is_addition', addition);
                            }}
                            className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-[#1A1C20] text-white font-medium outline-none"
                          >
                            <option value="BONUS">مكافأة تميز (+)</option>
                            <option value="OTHER_ADDITION">إضافة يدوية (+)</option>
                            <option value="PENALTY">جزاء مالي (-)</option>
                            <option value="ABSENCE">خصم غياب (-)</option>
                            <option value="OTHER_DEDUCTION">خصم إداري (-)</option>
                          </select>

                          <div className="relative w-24">
                            <input
                              type="number"
                              min="0"
                              step="5"
                              disabled={Boolean(isApproved)}
                              value={adj.amount || ''}
                              onChange={(e) =>
                                handleUpdateAdjustment(
                                  index,
                                  'amount',
                                  Math.max(0, parseFloat(e.target.value) || 0)
                                )
                              }
                              placeholder="0"
                              className={`w-full px-2 py-1 text-xs font-mono font-bold rounded-lg border border-white/10 bg-[#1A1C20] outline-none ${
                                isAddition ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            />
                            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-500">
                              ج.م
                            </span>
                          </div>
                        </div>

                        {!isApproved && (
                          <button
                            type="button"
                            onClick={() => handleRemoveAdjustment(index)}
                            className="p-1 text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                            title="حذف هذا البند"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>

                      {/* Mandatory Reason Input */}
                      <div>
                        <input
                          type="text"
                          disabled={Boolean(isApproved)}
                          value={adj.reason}
                          onChange={(e) => handleUpdateAdjustment(index, 'reason', e.target.value)}
                          placeholder="السبب التوثيقي الإلزامي (مطلوب)"
                          className={`w-full px-2.5 py-1 text-xs rounded-lg border outline-none transition-colors ${
                            isMissingReason
                              ? 'border-amber-500/70 bg-amber-500/5 text-amber-200 placeholder-amber-400/50'
                              : 'bg-[#18191C] border-white/10 text-gray-200 placeholder-gray-500'
                          }`}
                        />
                        {isMissingReason && (
                          <span className="text-[10px] text-amber-400 mt-0.5 block">
                            * مطلوب سبب صريح للمطابقة والاعتماد المحاسبي.
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section E: Accountant Internal Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
              <FileText size={13} className="text-[#C5A880]" />
              ملاحظات محاسبية داخلية
            </label>
            <textarea
              rows={2}
              disabled={Boolean(isApproved)}
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="ملاحظات توثيقية خاصة بهذه التسوية..."
              className={`w-full px-3 py-2 text-xs rounded-xl border outline-none transition-all resize-none bg-[#141518] border-white/10 text-white placeholder-gray-500 focus:border-[#C5A880]/50 ${
                isApproved ? 'opacity-60 cursor-not-allowed' : ''
              }`}
            />
          </div>
        </div>
      )}

      {/* ── 4. ACTION BUTTONS FOOTER ──────────────────────────────────────── */}
      <div className={`p-4 border-t sticky bottom-0 z-20 backdrop-blur-md ${
        isDarkMode ? 'bg-[#0E0F12]/95 border-white/[0.08]' : 'bg-white/95 border-gray-200'
      }`}>
        {hasInvalidAdjustments && (
          <div className="mb-2.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-2">
            <AlertCircle size={13} className="shrink-0" />
            <span>يرجى ملء أسباب جميع التعديلات اليدوية لحفظ أو اعتماد التسوية.</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          {/* Mode 1: Live Unsaved Preview */}
          {isLivePreview && (
            <button
              type="button"
              disabled={isSaving || hasInvalidAdjustments || !preview}
              onClick={onSaveDraft}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#8B0000] to-[#550000] hover:from-[#A00000] hover:to-[#650000] border border-[#C5A880]/40 disabled:opacity-50 text-white font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
            >
              <Save size={13} className={isSaving ? 'animate-spin' : ''} />
              {isSaving ? 'جاري حفظ المسودة...' : 'حفظ كمسودة تسوية'}
            </button>
          )}

          {/* Mode 2: Existing Draft */}
          {isPersistedDraft && (
            <>
              <button
                type="button"
                disabled={isSaving || hasInvalidAdjustments}
                onClick={onUpdateDraft}
                className="flex-1 py-2.5 px-3 rounded-xl bg-blue-600/90 hover:bg-blue-600 border border-blue-400/30 disabled:opacity-50 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98]"
              >
                <Save size={13} className={isSaving ? 'animate-spin' : ''} />
                {isSaving ? 'جاري التحديث...' : 'تحديث المسودة'}
              </button>

              <button
                type="button"
                disabled={isApproving || hasInvalidAdjustments}
                onClick={onApprove}
                className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600/90 hover:bg-emerald-600 border border-emerald-400/30 disabled:opacity-50 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98]"
              >
                <ShieldCheck size={13} className={isApproving ? 'animate-spin' : ''} />
                {isApproving ? 'جاري الاعتماد...' : 'اعتماد وقفل التسوية'}
              </button>

              <button
                type="button"
                disabled={isSaving || isApproving}
                onClick={onDiscardDraft}
                className="py-2.5 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                title="حذف هذه المسودة نهائياً"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}

          {/* Mode 3: Approved / Paid */}
          {isApproved && (
            <div className="flex items-center gap-2 w-full">
              <div className="flex-1 py-2 px-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-2">
                <CheckCircle2 size={14} />
                تسوية معتمدة رسمياً ومقفلة في دفتر الأستاذ
              </div>
              <button
                type="button"
                onClick={onCancelSettlement}
                className="py-2 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
                title="إلغاء التسوية المعتمدة"
              >
                <RotateCcw size={12} />
                إلغاء
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
