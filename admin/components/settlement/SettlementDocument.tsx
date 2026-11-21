import React from 'react';
import {
  FileText,
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  AlertCircle,
  Receipt,
  Scissors,
  ShoppingBag,
  TrendingUp,
  Wallet,
  MinusCircle,
  PlusCircle,
  Hash,
  Building,
  UserCheck,
  Calendar,
  Lock,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  PayrollPreviewResponse,
  SettlementRecord,
  SettlementAdjustmentInput,
} from './settlementTypes';

interface SettlementDocumentProps {
  preview: PayrollPreviewResponse | null;
  activeDraft: SettlementRecord | null;
  baseSalaryAllocated: number;
  adjustments: SettlementAdjustmentInput[];
  notes: string;
  isDarkMode: boolean;
  onOpenSourceInspector: () => void;
  isLoading?: boolean;
  previewError?: string | null;
  onRetryPreview?: () => void;
}

export const SettlementDocument: React.FC<SettlementDocumentProps> = ({
  preview,
  activeDraft,
  baseSalaryAllocated,
  adjustments,
  notes,
  isDarkMode,
  onOpenSourceInspector,
  isLoading = false,
  previewError = null,
  onRetryPreview,
}) => {
  // 1. Error state — show clear, actionable, retryable state instead of an infinite skeleton
  if (previewError && !activeDraft) {
    return (
      <div className="w-full relative group transition-all duration-300">
        <div
          className="relative z-10 rounded-2xl bg-[#FBF9F4] text-[#191C21] shadow-2xl border border-red-200/80 overflow-hidden p-8 sm:p-12 text-center"
          style={{ fontFamily: "'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}
        >
          <div className="w-14 h-14 rounded-2xl bg-red-100/80 text-[#8B0000] border border-red-200 flex items-center justify-center mx-auto mb-4 shadow-sm">
            <AlertCircle size={28} />
          </div>
          <h3 className="font-serif font-black text-xl text-[#111317] tracking-tight mb-2">
            تعذر استرداد بيان التسوية المالية
          </h3>
          <p className="text-sm text-[#5D5548] max-w-md mx-auto leading-relaxed mb-6 font-medium">
            {previewError}
          </p>
          {onRetryPreview && (
            <button
              type="button"
              onClick={onRetryPreview}
              className="inline-flex items-center gap-2.5 px-6 py-2.5 rounded-xl bg-[#8B0000] hover:bg-[#700000] text-white font-serif font-bold text-sm shadow-lg hover:shadow-xl transition-all cursor-pointer"
            >
              <RefreshCw size={15} />
              <span>إعادة محاولة جلب السجلات</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // 2. Loading state — render warm ivory document skeleton only while actively loading or initial load
  if (isLoading || (!preview && !activeDraft)) {
    return (
      <div className="w-full relative group transition-all duration-300">
        <div className="relative z-10 rounded-2xl bg-[#FBF9F4] text-[#191C21] shadow-2xl border border-[#E8E2D5] overflow-hidden"
          style={{ fontFamily: "'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}
        >
          {/* Top Decorative Band */}
          <div className="h-2 bg-gradient-to-r from-[#191C21] via-[#8B0000] to-[#C5A880]" />

          <div className="p-6 sm:p-8 space-y-6">
            {/* Skeleton Header */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-[#E3DCCE]">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#8B0000]" />
                  <span className="text-[11px] font-mono font-bold tracking-[0.2em] text-[#8B0000] uppercase">
                    SECRET MEN CLUB
                  </span>
                </div>
                <h1 className="text-xl sm:text-2xl font-black font-serif text-[#111317]">
                  بيان التسوية المالية للموظف
                </h1>
                <div className="h-3 w-48 bg-[#E7E2D6] rounded animate-pulse" />
              </div>
              <div className="text-left space-y-1 sm:self-start">
                <div className="h-6 w-28 bg-[#E7E2D6] rounded-full animate-pulse" />
                <div className="h-3 w-20 bg-[#E7E2D6] rounded animate-pulse mt-1" />
              </div>
            </div>

            {/* Skeleton Metadata Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-[#F4F0E6] border border-[#E5DFCE]">
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-[#6B7280] block">الموظف والفرع</span>
                <div className="h-3.5 w-32 bg-[#E0D9C8] rounded animate-pulse" />
              </div>
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-[#6B7280] block">نطاق فترة التسوية</span>
                <div className="h-3.5 w-28 bg-[#E0D9C8] rounded animate-pulse" />
              </div>
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <span className="text-[10px] font-bold text-[#6B7280] block">حالة العمليات</span>
                <div className="h-3.5 w-24 bg-[#E0D9C8] rounded animate-pulse" />
              </div>
            </div>

            {/* Skeleton Section 1: Earnings */}
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-1.5 border-b border-[#E3DCCE]">
                <div className="h-4 w-40 bg-[#E7E2D6] rounded animate-pulse" />
                <div className="h-3 w-20 bg-[#E7E2D6] rounded animate-pulse" />
              </div>
              <div className="space-y-2.5">
                <div className="flex justify-between items-center py-1.5">
                  <div className="h-3.5 w-48 bg-[#EFECE4] rounded animate-pulse" />
                  <div className="h-4 w-20 bg-[#EFECE4] rounded animate-pulse" />
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <div className="h-3.5 w-36 bg-[#EFECE4] rounded animate-pulse" />
                  <div className="h-4 w-16 bg-[#EFECE4] rounded animate-pulse" />
                </div>
              </div>
            </div>

            {/* Skeleton Section 2: Deductions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-1.5 border-b border-[#E3DCCE]">
                <div className="h-4 w-44 bg-[#E7E2D6] rounded animate-pulse" />
                <div className="h-3 w-20 bg-[#E7E2D6] rounded animate-pulse" />
              </div>
              <div className="space-y-2.5">
                <div className="flex justify-between items-center py-1.5">
                  <div className="h-3.5 w-40 bg-[#EFECE4] rounded animate-pulse" />
                  <div className="h-4 w-16 bg-[#EFECE4] rounded animate-pulse" />
                </div>
              </div>
            </div>

            {/* Skeleton Net Payable Box */}
            <div className="p-6 rounded-2xl bg-[#EFECE4] border border-[#E3DCCE] flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-3 w-32 bg-[#E2DDCF] rounded animate-pulse" />
                <div className="h-5 w-52 bg-[#D8D2C2] rounded animate-pulse" />
              </div>
              <div className="h-10 w-28 bg-[#D8D2C2] rounded-xl animate-pulse" />
            </div>

            {/* Loading Indicator Stamp */}
            <div className="pt-2 text-center text-xs text-[#8A7968] flex items-center justify-center gap-2 font-medium">
              <RefreshCw size={14} className="animate-spin text-[#8B0000]" />
              <span>جاري استرداد ومطابقة سجلات الأستاذ والعمليات مع الخادم...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Calculate live numbers
  const isPersistedDraft = Boolean(activeDraft && activeDraft.status === 'DRAFT');
  const isApproved = Boolean(
    activeDraft && ['APPROVED', 'PAID', 'PARTIALLY_PAID', 'CANCELLED'].includes(activeDraft.status)
  );

  const employeeName = activeDraft ? activeDraft.employee_name : preview?.meta?.employee_name || 'موظف';
  const branchName = activeDraft ? activeDraft.branch_name : preview?.meta?.home_branch || 'الفرع الرئيسي';
  const dateFrom = activeDraft ? activeDraft.date_from : preview?.meta?.date_from || '';
  const dateTo = activeDraft ? activeDraft.date_to : preview?.meta?.date_to || '';
  const daysInPeriod = activeDraft ? 15 : preview?.meta?.days_in_period || 0;

  // Commissions
  const barberCommissions = isApproved
    ? activeDraft?.summary?.total_barber_commission ?? 0
    : preview?.summary?.barber_commissions ?? activeDraft?.summary?.total_barber_commission ?? 0;

  const assistantCommissions = isApproved
    ? activeDraft?.summary?.total_assistant_commission ?? 0
    : preview?.summary?.assistant_commissions ?? activeDraft?.summary?.total_assistant_commission ?? 0;

  const productCommissions = isApproved
    ? activeDraft?.summary?.total_product_commission ?? 0
    : preview?.summary?.product_commissions ?? activeDraft?.summary?.total_product_commission ?? 0;

  const totalCommissions = isApproved
    ? activeDraft?.summary?.total_commissions_earned ?? 0
    : preview?.summary?.gross_commissions ?? activeDraft?.summary?.total_commissions_earned ?? 0;

  const overtime = isApproved
    ? activeDraft?.summary?.total_overtime ?? 0
    : preview?.summary?.overtime ?? activeDraft?.summary?.total_overtime ?? 0;

  // Manual Adjustments Breakdown
  const totalManualAdditions = isApproved
    ? activeDraft?.summary?.total_manual_additions ?? 0
    : adjustments
        .filter((a) => a.is_addition && Number(a.amount) > 0)
        .reduce((sum, a) => sum + Number(a.amount), 0);

  const totalManualDeductions = isApproved
    ? activeDraft?.summary?.total_manual_deductions ?? 0
    : adjustments
        .filter((a) => !a.is_addition && Number(a.amount) > 0)
        .reduce((sum, a) => sum + Number(a.amount), 0);

  // Manager base salary
  const baseSalary = isApproved
    ? activeDraft?.summary?.base_salary_allocated ?? 0
    : Number(baseSalaryAllocated || 0);

  // Total Gross Earnings
  const totalGross = isApproved
    ? activeDraft?.summary?.total_gross_earnings ?? 0
    : Number((totalCommissions + overtime + baseSalary + totalManualAdditions).toFixed(2));

  // Deductions & Advances
  const advances = isApproved
    ? activeDraft?.summary?.total_advances ?? 0
    : preview?.summary?.advances ?? activeDraft?.summary?.total_advances ?? 0;

  const commissionWithdrawals = isApproved
    ? activeDraft?.summary?.total_commission_withdrawals ?? 0
    : preview?.summary?.commission_withdrawals ?? activeDraft?.summary?.total_commission_withdrawals ?? 0;

  const adminDeductions = isApproved
    ? activeDraft?.summary?.total_administrative_deductions ?? 0
    : preview?.summary?.administrative_deductions ?? activeDraft?.summary?.total_administrative_deductions ?? 0;

  const totalDeductions = isApproved
    ? activeDraft?.summary?.total_deductions ?? 0
    : Number(
        (
          advances +
          commissionWithdrawals +
          adminDeductions +
          totalManualDeductions
        ).toFixed(2)
      );

  const carriedBalance = isApproved
    ? activeDraft?.summary?.carried_balance_applied ?? 0
    : preview?.summary?.carried_balance_applied ?? activeDraft?.summary?.carried_balance_applied ?? 0;

  const finalNetPayable = isApproved
    ? activeDraft?.summary?.net_payable ?? 0
    : Number((totalGross - totalDeductions + carriedBalance).toFixed(2));

  const isDebt = finalNetPayable < 0;

  // Absorbed / Carried Provenance
  const absorbedSettlementIds = isApproved
    ? activeDraft?.absorbed_settlement_ids || (activeDraft?.absorbed_settlement_id ? [activeDraft.absorbed_settlement_id] : [])
    : preview?.meta?.absorbed_settlement_ids || (preview?.meta?.absorbed_settlement_id ? [preview.meta.absorbed_settlement_id] : []);

  const totalOpsCount =
    (preview?.line_items?.commissions?.length || 0) +
    (preview?.line_items?.advances?.length || 0) +
    (preview?.line_items?.commission_withdrawals?.length || 0) +
    (preview?.line_items?.deductions?.length || 0) +
    (preview?.line_items?.overtimes?.length || 0);

  return (
    <div className="w-full relative group transition-all duration-300">
      {/* Outer Paper Mat / Soft Ambient Halo */}
      <div className="absolute -inset-1 bg-gradient-to-b from-[#C5A880]/15 via-black/30 to-black/70 rounded-3xl blur-lg opacity-50 pointer-events-none" />

      {/* The Physical Luxury Ivory Sheet */}
      <div
        className="relative z-10 rounded-2xl bg-[#FBF9F4] text-[#191C21] shadow-2xl border border-[#E8E2D5] overflow-hidden"
        style={{
          fontFamily:
            "'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        {/* Subtle Watermark Guilloche Pattern / Header Band */}
        <div className="h-1.5 bg-gradient-to-r from-[#191C21] via-[#8B0000] to-[#C5A880]" />

        <div className="p-6 sm:p-7 md:p-8 space-y-5">
          {/* ── ATELIER HEADER ──────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-[#E3DCCE]">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#8B0000]" />
                <span className="text-[11px] font-mono font-bold tracking-[0.2em] text-[#8B0000] uppercase">
                  SECRET MEN CLUB
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black font-serif text-[#111317] tracking-tight">
                بيان التسوية المالية للموظف
              </h1>
              <p className="text-xs text-[#6B7280]">
                كشف الحساب المالي المعتمد لتدقيق المستحقات والأرباح
              </p>
            </div>

            {/* Document Status Stamp */}
            <div className="text-left sm:self-start">
              {activeDraft ? (
                <div
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                    activeDraft.status === 'APPROVED'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                      : activeDraft.status === 'DRAFT'
                      ? 'bg-blue-50 text-blue-800 border-blue-300'
                      : 'bg-gray-100 text-gray-800 border-gray-300'
                  }`}
                >
                  <Hash size={12} />
                  <span>
                    {activeDraft.status === 'APPROVED'
                      ? 'معتمدة ومقفلة'
                      : activeDraft.status === 'DRAFT'
                      ? 'مسودة رسمية'
                      : activeDraft.status}
                  </span>
                  <span className="font-mono">#{activeDraft.settlement_number}</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  <span>معاينة حية تفاعلية</span>
                </div>
              )}
              <span className="block text-[10px] text-gray-500 font-mono mt-1 text-left dir-ltr">
                {new Date().toLocaleDateString('ar-EG', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>
          </div>

          {/* ── METADATA STRIP ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-[#F4F0E6] border border-[#E5DFCE]">
            <div>
              <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block mb-0.5">
                الموظف والفرع
              </span>
              <span className="text-xs font-bold text-[#111317] block">
                {employeeName}
              </span>
              <span className="text-[11px] text-gray-600 flex items-center gap-1 mt-0.5">
                <Building size={11} className="text-[#8B0000]" />
                {branchName}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block mb-0.5">
                نطاق فترة التسوية
              </span>
              <span className="text-xs font-mono font-bold text-[#111317] dir-ltr inline-block">
                {dateFrom} <span className="text-gray-400">→</span> {dateTo}
              </span>
              <span className="text-[11px] text-gray-600 block mt-0.5">
                {daysInPeriod} يوماً عمل
              </span>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <span className="text-[10px] font-bold text-[#6B7280] block mb-0.5">
                المعاملات المالية
              </span>
              <button
                type="button"
                onClick={onOpenSourceInspector}
                className="text-xs font-bold text-[#8B0000] hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <FileText size={12} />
                <span>{totalOpsCount} مصدراً ماليّاً</span>
              </button>
              <span className="text-[10px] text-gray-500 block mt-0.5">
                فحص ومطابقة تفصيلية
              </span>
            </div>
          </div>

          {/* ── SECTION 1: GROSS EARNINGS ─────────────────────────────────── */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between pb-1 border-b border-[#E3DCCE]">
              <span className="text-xs font-bold text-[#1F2937] flex items-center gap-1.5">
                <PlusCircle size={14} className="text-emerald-700" />
                المستحقات والأرباح المكتسبة
              </span>
            </div>

            <div className="divide-y divide-[#EFECE4] text-xs font-medium">
              {/* Barber Services */}
              <div className="py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scissors size={13} className="text-gray-500" />
                  <span className="text-[#2A2E35]">عمولات الخدمات الأساسية (حلاقة وتصفيف)</span>
                </div>
                <span className="font-mono font-bold text-[#111317] tabular-nums">
                  +{barberCommissions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                  <span className="text-[10px] font-sans font-normal text-gray-500">ج.م</span>
                </span>
              </div>

              {/* Assistant Commissions */}
              {assistantCommissions > 0 && (
                <div className="py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UserCheck size={13} className="text-gray-500" />
                    <span className="text-[#2A2E35]">عمولات المساعد (مساعد خدمات)</span>
                  </div>
                  <span className="font-mono font-bold text-[#111317] tabular-nums">
                    +{assistantCommissions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                    <span className="text-[10px] font-sans font-normal text-gray-500">ج.م</span>
                  </span>
                </div>
              )}

              {/* Product Commissions */}
              {(productCommissions > 0 || barberCommissions === 0) && (
                <div className="py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShoppingBag size={13} className="text-gray-500" />
                    <span className="text-[#2A2E35]">عمولات مبيعات المنتجات</span>
                  </div>
                  <span className="font-mono font-bold text-[#111317] tabular-nums">
                    +{productCommissions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                    <span className="text-[10px] font-sans font-normal text-gray-500">ج.م</span>
                  </span>
                </div>
              )}

              {/* Overtime */}
              {overtime > 0 && (
                <div className="py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock size={13} className="text-gray-500" />
                    <span className="text-[#2A2E35]">الأوفر تايم الإضافي المعتمد</span>
                  </div>
                  <span className="font-mono font-bold text-[#111317] tabular-nums">
                    +{overtime.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                    <span className="text-[10px] font-sans font-normal text-gray-500">ج.م</span>
                  </span>
                </div>
              )}

              {/* Manager Allocated Fixed Salary */}
              <div className="py-2 flex items-center justify-between bg-[#F8F6EE] px-2.5 rounded-lg">
                <div className="flex items-center gap-2">
                  <Calendar size={13} className="text-[#8B0000]" />
                  <span className="text-[#111317] font-bold">الراتب الأساسي المعتمد من الإدارة</span>
                </div>
                <span className="font-mono font-bold text-[#111317] tabular-nums">
                  +{baseSalary.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                  <span className="text-[10px] font-sans font-normal text-gray-500">ج.م</span>
                </span>
              </div>

              {/* Manual Additions */}
              {adjustments
                .filter((a) => a.is_addition && Number(a.amount) > 0)
                .map((adj, idx) => (
                  <div key={adj.id || idx} className="py-2 flex items-center justify-between text-emerald-900 bg-emerald-50/60 px-2.5 rounded-lg">
                    <div className="flex items-center gap-2">
                      <PlusCircle size={13} className="text-emerald-700" />
                      <span className="font-semibold">
                        مكافأة: {adj.reason || 'إضافة يدوية'}
                      </span>
                    </div>
                    <span className="font-mono font-bold tabular-nums">
                      +{Number(adj.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                      <span className="text-[10px] font-sans font-normal">ج.م</span>
                    </span>
                  </div>
                ))}
            </div>

            {/* Total Gross Row */}
            <div className="pt-2 flex items-center justify-between font-bold text-xs bg-[#EFECE4] px-3 py-2 rounded-lg">
              <span className="text-[#1F2937]">إجمالي المستحقات المكتسبة</span>
              <span className="font-mono text-sm text-[#0F3823] tabular-nums">
                +{totalGross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                <span className="text-[10px] font-sans font-normal text-gray-600">ج.م</span>
              </span>
            </div>
          </div>

          {/* ── SECTION 2: DEDUCTIONS & ADVANCES ──────────────────────────── */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between pb-1 border-b border-[#E3DCCE]">
              <span className="text-xs font-bold text-[#1F2937] flex items-center gap-1.5">
                <MinusCircle size={14} className="text-[#8B0000]" />
                الاستقطاعات والمبالغ المسحوبة
              </span>
            </div>

            <div className="divide-y divide-[#EFECE4] text-xs font-medium">
              {/* Cash Advances */}
              <div className="py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet size={13} className="text-[#8B0000]" />
                  <span className="text-[#2A2E35]">السلفيات النقدية المسحوبة</span>
                </div>
                <span className="font-mono font-bold text-[#8B0000] tabular-nums">
                  -{advances.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                  <span className="text-[10px] font-sans font-normal text-gray-500">ج.م</span>
                </span>
              </div>

              {/* Commission Withdrawals */}
              <div className="py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Receipt size={13} className="text-[#8B0000]" />
                  <span className="text-[#2A2E35]">سحوبات النِسَب اليومية المسبقة</span>
                </div>
                <span className="font-mono font-bold text-[#8B0000] tabular-nums">
                  -{commissionWithdrawals.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                  <span className="text-[10px] font-sans font-normal text-gray-500">ج.م</span>
                </span>
              </div>

              {/* Administrative Deductions */}
              {adminDeductions > 0 && (
                <div className="py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={13} className="text-gray-500" />
                    <span className="text-[#2A2E35]">الخصومات الإدارية المعتمدة</span>
                  </div>
                  <span className="font-mono font-bold text-[#8B0000] tabular-nums">
                    -{adminDeductions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                    <span className="text-[10px] font-sans font-normal text-gray-500">ج.م</span>
                  </span>
                </div>
              )}

              {/* Manual Penalties */}
              {adjustments
                .filter((a) => !a.is_addition && Number(a.amount) > 0)
                .map((adj, idx) => (
                  <div key={adj.id || idx} className="py-2 flex items-center justify-between text-rose-950 bg-rose-50/60 px-2.5 rounded-lg">
                    <div className="flex items-center gap-2">
                      <MinusCircle size={13} className="text-rose-700" />
                      <span className="font-semibold">
                        خصم: {adj.reason || 'خصم إداري'}
                      </span>
                    </div>
                    <span className="font-mono font-bold tabular-nums">
                      -{Number(adj.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                      <span className="text-[10px] font-sans font-normal">ج.م</span>
                    </span>
                  </div>
                ))}
            </div>

            {/* Deductions Total Row */}
            <div className="pt-2 flex items-center justify-between font-bold text-xs bg-[#EFECE4] px-3 py-2 rounded-lg">
              <span className="text-[#1F2937]">إجمالي الاستقطاعات</span>
              <span className="font-mono text-sm text-[#8B0000] tabular-nums">
                -{totalDeductions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                <span className="text-[10px] font-sans font-normal text-[#8B0000]">ج.م</span>
              </span>
            </div>
          </div>

          {/* ── SECTION 3: CARRIED PROVENANCE ─────────────────────────────── */}
          {carriedBalance !== 0 && (
            <div className={`p-3 rounded-xl border text-xs ${
              carriedBalance < 0
                ? 'bg-rose-50/80 border-rose-200 text-rose-950'
                : 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={15} className={carriedBalance < 0 ? 'text-rose-700' : 'text-emerald-700'} />
                  <div>
                    <span className="font-bold block">
                      {carriedBalance < 0
                        ? 'ترحيل مديونية سابقة غير مسددة (خصم من الصافي)'
                        : 'ترحيل رصيد مستحق سابق غير منصرف (إضافة للصافي)'}
                    </span>
                    <span className="text-[11px] opacity-80">
                      مستمدة من التسوية السابقة{' '}
                      {preview?.meta?.absorbed_settlements && preview.meta.absorbed_settlements.length > 0
                        ? preview.meta.absorbed_settlements.map((s) => s.settlement_number || `#${s.id}`).join('، ')
                        : absorbedSettlementIds.length > 0
                        ? absorbedSettlementIds.map((id) => `#${id}`).join('، ')
                        : 'المعتمدة'}
                    </span>
                  </div>
                </div>
                <span className="font-mono text-sm font-black tabular-nums">
                  {carriedBalance > 0 ? '+' : ''}
                  {carriedBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                  <span className="text-[10px] font-sans font-normal">ج.م</span>
                </span>
              </div>
            </div>
          )}

          {/* ── SECTION 4: UNMISTAKABLE NET PAYABLE TOTAL ─────────────────── */}
          <div
            className={`p-5 sm:p-6 rounded-2xl border transition-all duration-300 relative overflow-hidden ${
              isDebt
                ? 'bg-[#FFF2F2] border-[#8B0000]/30 text-[#8B0000]'
                : 'bg-[#F2F7F2] border-emerald-800/25 text-[#0F3823]'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
              <div className="space-y-0.5">
                <span className="text-base font-black block">
                  {isDebt
                    ? 'صافي مديونية مستحقة على الموظف (ترحيل كدين)'
                    : 'صافي المبلغ النهائي المستحق للصرف للموظف'}
                </span>
                <span className="text-xs text-gray-500 block">
                  المبلغ النهائي القابل للصرف بعد احتساب كافة الأرباح والمسحوبات
                </span>
              </div>

              <div className="flex items-baseline gap-1.5 self-end sm:self-center">
                <span
                  className={`font-mono text-3xl sm:text-4xl font-black tracking-tight tabular-nums ${
                    isDebt ? 'text-[#8B0000]' : 'text-[#065F46]'
                  }`}
                >
                  {isDebt ? '' : '+'}
                  {finalNetPayable.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="font-sans font-bold text-xs text-gray-600">
                  ج.م
                </span>
              </div>
            </div>
          </div>

          {/* ── SECTION 5: NOTES & AUDIT FOOTER ──────────────────────────── */}
          <div className="pt-2 border-t border-[#E3DCCE] text-xs space-y-2">
            {notes && (
              <div className="p-2.5 rounded-lg bg-[#F3EFE6] border border-[#E0DBCF] text-[#4B5259]">
                <strong className="text-[#1F2937] block mb-0.5">ملاحظات المحاسب:</strong>
                <p className="leading-relaxed">{notes}</p>
              </div>
            )}

            <div className="flex items-center justify-between text-[10px] text-gray-500 pt-1">
              <div className="flex items-center gap-1.5">
                <ShieldCheck size={12} className="text-[#8B0000]" />
                <span>النادي السري للرجال • دفتر أستاذ الرواتب المعتمد</span>
              </div>
              <span className="font-mono">نظام الحسابات المالية المركزي</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
