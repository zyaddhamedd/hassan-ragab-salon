import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  RefreshCw,
  FileText,
  Sliders,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Maximize2,
  Sparkles,
  Lock,
  Layers,
  Calendar,
} from 'lucide-react';
import { adminFetch } from '../../api/adminFetch';
import {
  PayrollPreviewResponse,
  SettlementRecord,
  SettlementAdjustmentInput,
} from './settlementTypes';
import { SettlementControls } from './SettlementControls';
import { SettlementDocument } from './SettlementDocument';
import { SettlementErrorBoundary } from './SettlementErrorBoundary';
import { SettlementSourceInspector } from './SettlementSourceInspector';
import { SettlementOverrideModal } from './SettlementOverrideModal';

const API_BASE =
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:5001`
    : 'http://localhost:5001');

interface SettlementStudioProps {
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
  isDarkMode: boolean;
  onClose: () => void;
}

// Local date formatter avoiding timezone shift
const formatLocalDate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const SettlementStudio: React.FC<SettlementStudioProps> = ({
  employee,
  isDarkMode,
  onClose,
}) => {
  // Current user role from localStorage
  const userRole = (() => {
    try {
      const userStr = localStorage.getItem('admin_user');
      if (userStr) {
        const u = JSON.parse(userStr);
        return u.role;
      }
    } catch {
      // ignore
    }
    return undefined;
  })();

  // Initial date range: current month (timezone-safe)
  const getDefaultDates = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      from: formatLocalDate(firstDay),
      to: formatLocalDate(lastDay),
    };
  };

  const defaultDates = getDefaultDates();
  const [dateFrom, setDateFrom] = useState(defaultDates.from);
  const [dateTo, setDateTo] = useState(defaultDates.to);

  // Core State
  const [preview, setPreview] = useState<PayrollPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [activeDraft, setActiveDraft] = useState<SettlementRecord | null>(null);
  const [settlementHistory, setSettlementHistory] = useState<SettlementRecord[]>([]);

  // Accountant interactive inputs
  const [baseSalaryAllocated, setBaseSalaryAllocated] = useState<number>(0);
  const [adjustments, setAdjustments] = useState<SettlementAdjustmentInput[]>([]);
  const [notes, setNotes] = useState<string>('');

  // UI state
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [isSourceInspectorOpen, setIsSourceInspectorOpen] = useState<boolean>(false);
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState<boolean>(false);
  const [overrideConflictDetails, setOverrideConflictDetails] = useState<string>('');
  const [successAnimation, setSuccessAnimation] = useState<boolean>(false);
  const [mobileTab, setMobileTab] = useState<'document' | 'controls'>('document');

  // Load Settlements History
  const fetchSettlementHistory = useCallback(async () => {
    try {
      const res = await adminFetch(`${API_BASE}/api/admin/employees/${employee.id}/settlements`);
      if (res.ok) {
        const data = await res.json();
        setSettlementHistory(data.settlements || data.items || []);
      }
    } catch (err) {
      console.error('Failed to load settlement history', err);
    }
  }, [employee.id]);

  // Load Preview
  const fetchPreview = useCallback(
    async (from: string, to: string) => {
      if (!from || !to) return;
      setIsLoadingPreview(true);
      setPreviewError(null);
      setConflictError(null);
      try {
        const res = await adminFetch(
          `${API_BASE}/api/admin/employees/${employee.id}/payroll/preview?start_date=${from}&end_date=${to}&date_from=${from}&date_to=${to}`
        );
        if (res.ok) {
          const data: PayrollPreviewResponse = await res.json();
          setPreview(data);
          setPreviewError(null);
        } else {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error || errData.message || `فشل استرداد بيانات المعاينة (${res.status})`;
          setPreviewError(errMsg);
          console.error('Preview error:', errMsg);
        }
      } catch (err: any) {
        const errMsg = err?.message || 'تعذر الاتصال بالخادم لاسترداد بيان التسوية';
        setPreviewError(errMsg);
        console.error('Failed to load payroll preview', err);
      } finally {
        setIsLoadingPreview(false);
      }
    },
    [employee.id]
  );

  // Initial load
  useEffect(() => {
    fetchSettlementHistory();
    fetchPreview(dateFrom, dateTo);
  }, [fetchSettlementHistory, fetchPreview, dateFrom, dateTo]);

  // Select historical draft or settlement
  const handleSelectDraftOrHistory = async (record: SettlementRecord | null) => {
    if (!record) {
      // Return to new live preview
      setActiveDraft(null);
      setBaseSalaryAllocated(0);
      setAdjustments([]);
      setNotes('');
      setConflictError(null);
      fetchPreview(dateFrom, dateTo);
      return;
    }

    try {
      setIsLoadingPreview(true);
      const res = await adminFetch(`${API_BASE}/api/admin/settlements/${record.id}`);
      if (res.ok) {
        const data = await res.json();
        const detailed: SettlementRecord = (data as any)?.settlement || data;
        setActiveDraft(detailed);
        setDateFrom(detailed.date_from);
        setDateTo(detailed.date_to);
        setBaseSalaryAllocated(detailed.summary?.base_salary_allocated || 0);
        setNotes(detailed.notes || '');

        if (detailed.adjustments && detailed.adjustments.length > 0) {
          setAdjustments(
            detailed.adjustments.map((a) => ({
              id: a.id,
              category: a.category as any,
              is_addition: a.is_addition,
              amount: a.amount,
              reason: a.reason,
            }))
          );
        } else {
          setAdjustments([]);
        }

        // Fetch corresponding preview for line-item inspection
        fetchPreview(detailed.date_from, detailed.date_to);
      }
    } catch (err) {
      console.error('Failed to load settlement details', err);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // Date Change Handler
  const handleDateChange = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
    if (!activeDraft) {
      fetchPreview(from, to);
    }
  };

  // Save Draft (POST)
  const handleSaveDraft = async () => {
    setIsSaving(true);
    setConflictError(null);
    try {
      const payload = {
        date_from: dateFrom,
        date_to: dateTo,
        base_salary_allocated: baseSalaryAllocated,
        notes: notes,
        adjustments: adjustments
          .filter((a) => Number(a.amount) > 0)
          .map((a) => ({
            category: a.category,
            is_addition: a.is_addition,
            amount: Number(a.amount),
            reason: a.reason.trim(),
          })),
      };

      const res = await adminFetch(
        `${API_BASE}/api/admin/employees/${employee.id}/settlements`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (res.status === 201) {
        const data = await res.json();
        const created: SettlementRecord = (data as any)?.settlement || data;
        setActiveDraft(created);
        await fetchSettlementHistory();
      } else if (res.status === 409) {
        const err = await res.json().catch(() => ({}));
        setConflictError(
          err.message ||
            'تعارض بيانات مالية: تغيرت بعض المصادر المالية أو العمولات منذ تحميل المعاينة. يرجى التحديث والمراجعة.'
        );
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || err.error || 'حدث خطأ أثناء حفظ المسودة');
      }
    } catch (err) {
      console.error('Save draft error', err);
      alert('تعذر الاتصال بالخادم لحفظ المسودة');
    } finally {
      setIsSaving(false);
    }
  };

  // Update Draft (PUT)
  const handleUpdateDraft = async () => {
    if (!activeDraft) return;
    setIsSaving(true);
    setConflictError(null);
    try {
      const payload = {
        base_salary_allocated: baseSalaryAllocated,
        notes: notes,
        adjustments: adjustments
          .filter((a) => Number(a.amount) > 0)
          .map((a) => ({
            category: a.category,
            is_addition: a.is_addition,
            amount: Number(a.amount),
            reason: a.reason.trim(),
          })),
      };

      const res = await adminFetch(`${API_BASE}/api/admin/settlements/${activeDraft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        const updated: SettlementRecord = (data as any)?.settlement || data;
        setActiveDraft(updated);
        await fetchSettlementHistory();
      } else if (res.status === 409) {
        const err = await res.json().catch(() => ({}));
        setConflictError(
          err.message || 'تعارض في بيانات المسودة. يرجى إعادة تحديث الصفحة ومراجعة القيود.'
        );
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || err.error || 'فشل تحديث المسودة');
      }
    } catch (err) {
      console.error('Update draft error', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Discard Draft (DELETE)
  const handleDiscardDraft = async () => {
    if (!activeDraft) return;
    if (!window.confirm('هل أنت متأكد من حذف هذه المسودة نهائياً؟')) return;

    setIsSaving(true);
    try {
      const draftId = activeDraft.id;
      const res = await adminFetch(`${API_BASE}/api/admin/settlements/${draftId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setActiveDraft(null);
        setAdjustments([]);
        setNotes('');
        setBaseSalaryAllocated(0);
        await fetchSettlementHistory();
        await fetchPreview(dateFrom, dateTo);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || err.error || 'تعذر حذف المسودة');
      }
    } catch (err) {
      console.error('Discard draft error', err);
      alert('حدث خطأ أثناء محاولة حذف المسودة');
    } finally {
      setIsSaving(false);
    }
  };

  // Approve Settlement (POST /approve)
  const executeApprove = async (allowOverride = false, overrideReason = '') => {
    if (!activeDraft) return;
    setIsApproving(true);
    setConflictError(null);
    try {
      const payload = {
        allow_overlapping_salary_override: allowOverride,
        salary_override_reason: overrideReason,
      };

      const res = await adminFetch(
        `${API_BASE}/api/admin/settlements/${activeDraft.id}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (res.ok) {
        const data = await res.json();
        const approved: SettlementRecord = (data as any)?.settlement || data;
        setActiveDraft(approved);
        setIsOverrideModalOpen(false);
        setSuccessAnimation(true);
        setTimeout(() => setSuccessAnimation(false), 3500);
        await fetchSettlementHistory();
      } else if (res.status === 409) {
        const err = await res.json().catch(() => ({}));
        setConflictError(
          err.message ||
            'تعارض بيانات مالية (HTTP 409): تغيرت المصادر المصاحبة لهذه المسودة أو تم إلغاؤها على السيرفر. تم إيقاف الاعتماد لضمان السلامة المالية.'
        );
      } else if (res.status === 400) {
        const err = await res.json().catch(() => ({}));
        const msg = err.message || err.error || '';
        if (msg.includes('راتب أساسي') || msg.includes('تداخل') || msg.includes('salary')) {
          if (['SUPER_ADMIN', 'EXEC_ADMIN'].includes(userRole || '')) {
            setOverrideConflictDetails(msg);
            setIsOverrideModalOpen(true);
          } else {
            alert(
              `تنبيه تدقيق مالي: ${msg}\n\nعفواً: فقط الإدارة العليا (Super Admin / Exec Admin) مخولة باعتماد التخصيص الاستثنائي للراتب الأساسي.`
            );
          }
        } else {
          alert(msg);
        }
      } else if (res.status === 403) {
        const err = await res.json().catch(() => ({}));
        alert(`رفض الوصول (HTTP 403): ${err.message || err.error || 'غير مصرح لك بإتمام هذه العملية.'}`);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || err.error || 'فشل اعتماد التسوية');
      }
    } catch (err) {
      console.error('Approve error', err);
    } finally {
      setIsApproving(false);
    }
  };

  // Cancel Settlement
  const handleCancelSettlement = async () => {
    if (!activeDraft) return;
    const reason = window.prompt('يرجى إدخال سبب رسمي لإلغاء هذه التسوية المعتمدة:');
    if (!reason || !reason.trim()) return;

    try {
      const res = await adminFetch(
        `${API_BASE}/api/admin/settlements/${activeDraft.id}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const cancelled: SettlementRecord = (data as any)?.settlement || data;
        setActiveDraft(cancelled);
        await fetchSettlementHistory();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || err.error || 'تعذر إلغاء التسوية');
      }
    } catch (err) {
      console.error('Cancel error', err);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[150] flex flex-col overflow-hidden animate-fade-in ${
        isDarkMode ? 'bg-[#0B0C0E] text-[#E4E4E7]' : 'bg-gray-100 text-gray-900'
      }`}
      style={{ direction: 'rtl' }}
    >
      {/* ── ATMOSPHERIC LUXURY MASTHEAD ───────────────────────────────────── */}
      <header
        className={`px-5 py-3 border-b flex items-center justify-between shrink-0 select-none backdrop-blur-xl ${
          isDarkMode
            ? 'bg-[#0B0C0E]/95 border-white/[0.06]'
            : 'bg-white/95 border-gray-200'
        }`}
      >
        <div className="flex items-center gap-3.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#8B0000] to-[#3a0000] border border-[#C5A880]/30 flex items-center justify-center text-amber-200 font-serif font-black text-xs shadow-md">
            S
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-serif font-bold text-xs sm:text-sm tracking-wide text-white">
                استوديو التسويات المالية السرية
              </h1>
              <span className="text-[10px] text-gray-400">• دفتر الأستاذ المعتمد</span>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.2">
              الموظف: <strong className="text-gray-200 font-medium">{employee.name}</strong>
            </p>
          </div>
        </div>

        {/* Mobile View Switcher */}
        <div className="flex lg:hidden items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
          <button
            type="button"
            onClick={() => setMobileTab('document')}
            className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
              mobileTab === 'document'
                ? 'bg-[#C5A880] text-black shadow-sm'
                : 'text-gray-400'
            }`}
          >
            البيان المالي
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('controls')}
            className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
              mobileTab === 'controls'
                ? 'bg-[#C5A880] text-black shadow-sm'
                : 'text-gray-400'
            }`}
          >
            لوحة الإدخال
          </button>
        </div>

        {/* Header Right Controls */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              fetchPreview(dateFrom, dateTo);
              fetchSettlementHistory();
            }}
            className="p-1.5 px-2.5 rounded-lg border border-white/10 hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.06] text-xs text-gray-300 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer"
            title="مزامنة وتحديث البيانات"
          >
            <RefreshCw size={12} className={isLoadingPreview ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">مزامنة</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 px-2.5 rounded-lg bg-white/[0.04] hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-all cursor-pointer flex items-center gap-1.5"
            title="إغلاق والعودة لملف الموظف"
          >
            <span className="hidden sm:inline text-xs font-semibold">إغلاق الاستوديو</span>
            <X size={14} />
          </button>
        </div>
      </header>

      {/* ── MAIN DUAL-PANE ATELIER CANVAS ─────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Pane (Living Financial Document - Visual Centerpiece) */}
        <div
          className={`w-full lg:w-[54%] xl:w-[55%] h-full overflow-y-auto p-4 sm:p-6 lg:p-7 custom-scrollbar border-l border-white/[0.06] transition-all flex justify-center items-start ${
            mobileTab === 'document' ? 'block' : 'hidden lg:flex'
          } ${
            isDarkMode
              ? 'bg-gradient-to-b from-[#0D0E11] to-[#090A0C]'
              : 'bg-gray-100'
          }`}
        >
          <div className="w-full max-w-2xl my-auto">
            <SettlementErrorBoundary
              fallbackTitle="تعذر عرض مستند التسوية المالية"
              onReset={() => {
                setActiveDraft(null);
                fetchPreview(dateFrom, dateTo);
              }}
            >
              <SettlementDocument
                preview={preview}
                activeDraft={activeDraft}
                baseSalaryAllocated={baseSalaryAllocated}
                adjustments={adjustments}
                notes={notes}
                isDarkMode={isDarkMode}
                onOpenSourceInspector={() => setIsSourceInspectorOpen(true)}
                isLoading={isLoadingPreview}
                previewError={previewError}
                onRetryPreview={() => fetchPreview(dateFrom, dateTo)}
              />
            </SettlementErrorBoundary>
          </div>
        </div>

        {/* Right Pane (Accountant Workspace Controls) */}
        <div
          className={`w-full lg:w-[46%] xl:w-[45%] h-full border-r border-white/[0.06] ${
            mobileTab === 'controls' ? 'block' : 'hidden lg:block'
          }`}
        >
          <SettlementControls
            employee={employee}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateChange={handleDateChange}
            preview={preview}
            activeDraft={activeDraft}
            settlementHistory={settlementHistory}
            onSelectDraftOrHistory={handleSelectDraftOrHistory}
            baseSalaryAllocated={baseSalaryAllocated}
            onBaseSalaryChange={setBaseSalaryAllocated}
            adjustments={adjustments}
            onAdjustmentsChange={setAdjustments}
            notes={notes}
            onNotesChange={setNotes}
            isSaving={isSaving}
            isApproving={isApproving}
            isLoadingPreview={isLoadingPreview}
            onSaveDraft={handleSaveDraft}
            onUpdateDraft={handleUpdateDraft}
            onDiscardDraft={handleDiscardDraft}
            onApprove={() => executeApprove(false, '')}
            onCancelSettlement={handleCancelSettlement}
            onOpenSourceInspector={() => setIsSourceInspectorOpen(true)}
            conflictError={conflictError}
            onRefreshData={() => {
              setConflictError(null);
              fetchPreview(dateFrom, dateTo);
            }}
            isDarkMode={isDarkMode}
            userRole={userRole}
          />
        </div>
      </div>

      {/* Slide-out Source Breakdown Inspector Drawer */}
      <SettlementSourceInspector
        isOpen={isSourceInspectorOpen}
        onClose={() => setIsSourceInspectorOpen(false)}
        lineItems={preview?.line_items || null}
        employeeName={employee.name}
        isDarkMode={isDarkMode}
        excludedCount={preview?.meta?.already_settled_items_excluded_count || 0}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />

      {/* Salary Override Authorization Modal */}
      <SettlementOverrideModal
        isOpen={isOverrideModalOpen}
        onClose={() => setIsOverrideModalOpen(false)}
        onConfirm={(reason) => executeApprove(true, reason)}
        conflictDetails={overrideConflictDetails}
        isSubmitting={isApproving}
        isDarkMode={isDarkMode}
      />

      {/* Luxury Approval Stamp Sequence Overlay */}
      {successAnimation && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-lg animate-fade-in pointer-events-none">
          <div className="text-center space-y-4 p-8 rounded-3xl border border-[#C5A880]/50 bg-gradient-to-b from-[#18191E] to-[#0B0C0E] shadow-2xl max-w-md transform animate-scale-up">
            <div className="w-18 h-18 mx-auto rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center text-emerald-400 shadow-[0_0_50px_rgba(16,185,129,0.3)]">
              <ShieldCheck size={40} />
            </div>
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#C5A880]">
                Official Secret Men Club Stamp
              </span>
              <h2 className="text-lg font-bold font-serif text-white">
                تم اعتماد وقفل التسوية بنجاح
              </h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                تم ترحيل وقفل العمليات في دفتر الأستاذ المالي المعتمد برقم رسمي:{' '}
                <strong className="text-emerald-400 font-mono">
                  #{activeDraft?.settlement_number}
                </strong>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
