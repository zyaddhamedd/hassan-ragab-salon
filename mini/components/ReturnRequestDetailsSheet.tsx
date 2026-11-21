import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, RotateCcw, ShieldCheck, X, XCircle } from 'lucide-react';
import { apiClient } from '../src/api/client';
import { ReturnRequestSummary } from '../src/types/models';

interface ReturnRequestDetailsSheetProps {
  requestId: number | null;
  isOpen: boolean;
  onClose: () => void;
}

const statusConfig: Record<
  ReturnRequestSummary['status'],
  { label: string; className: string; icon: React.ReactNode }
> = {
  PENDING: {
    label: 'قيد المراجعة',
    className: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
    icon: <Clock3 size={12} />,
  },
  RETURNED_TO_MAIN: {
    label: 'بالمخزن',
    className: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
    icon: <CheckCircle2 size={12} />,
  },
  RETURNED_TO_SUPPLIER: {
    label: 'بالمورد',
    className: 'bg-sky-500/10 border-sky-500/20 text-sky-300',
    icon: <RotateCcw size={12} />,
  },
  REJECTED: {
    label: 'مرفوض',
    className: 'bg-red-500/10 border-red-500/20 text-red-300',
    icon: <XCircle size={12} />,
  },
};

const ReturnRequestDetailsSheet: React.FC<ReturnRequestDetailsSheetProps> = ({ requestId, isOpen, onClose }) => {
  const [requestDetails, setRequestDetails] = useState<ReturnRequestSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !requestId) return;

    const fetchDetails = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiClient.get(`/returns/${requestId}`);
        setRequestDetails(data);
      } catch (loadError: any) {
        setError(loadError.message || 'تعذر تحميل تفاصيل المرتجع');
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [isOpen, requestId]);

  if (!isOpen) return null;

  const formatDate = (value?: string | null) => {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    } catch {
      return value;
    }
  };

  return (
    <div className="mini-modal-overlay">
      <div className="mini-modal-panel-static w-full max-w-2xl overflow-hidden rounded-[2rem] border border-white/[0.06] bg-[#0d0d10] shadow-[0_32px_96px_rgba(0,0,0,0.65)]">
        <div className="border-b border-white/[0.05] bg-[radial-gradient(circle_at_top,rgba(230,214,144,0.08),transparent_72%)] px-5 pb-5 pt-5 md:px-6">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02] text-white/60 hover:bg-white/[0.05] hover:text-white"
            >
              <X size={15} />
            </button>

            <div className="text-right">
              <p className="text-[10px] font-semibold tracking-[0.24em] text-[#E6D690]/80">
                {requestDetails?.return_ref || 'RETURN'}
              </p>
              <h3 className="mt-1 text-xl font-black text-white/95">تفاصيل المرتجع</h3>
            </div>
          </div>
        </div>

        <div className="mini-scroll-y custom-scrollbar space-y-4 px-5 py-5 text-right md:px-6 md:py-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Loader2 size={24} className="animate-spin text-[#E6D690]" />
              <p className="text-xs text-white/40">جارٍ تحميل التفاصيل...</p>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-500/10 bg-red-500/5 px-4 py-5 text-center text-sm font-semibold text-red-300">
              {error}
            </div>
          ) : requestDetails ? (
            <div className="space-y-4">
              <div className="rounded-[1.6rem] border border-white/[0.05] bg-white/[0.02] p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold ${statusConfig[requestDetails.status].className}`}>
                    {statusConfig[requestDetails.status].icon}
                    <span>{statusConfig[requestDetails.status].label}</span>
                  </span>

                  <div>
                    <p className="text-sm font-black text-white">{requestDetails.product_name}</p>
                    <p className="mt-1 text-[11px] text-white/40">
                      {requestDetails.requested_quantity} {requestDetails.product_unit}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[11px] font-semibold text-white/55">
                  <ShieldCheck size={14} className="text-[#E6D690]" />
                  <span>الرصيد وقت الطلب: {requestDetails.branch_stock_snapshot}</span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 text-xs">
                <div className="rounded-2xl border border-white/[0.04] bg-white/[0.02] p-4">
                  <span className="mb-1 block text-white/30">السبب</span>
                  <span className="font-semibold text-white/95">{requestDetails.reason_label}</span>
                </div>
                <div className="rounded-2xl border border-white/[0.04] bg-white/[0.02] p-4">
                  <span className="mb-1 block text-white/30">وقت الإنشاء</span>
                  <span className="font-semibold text-white/95">{formatDate(requestDetails.created_at)}</span>
                </div>
                <div className="rounded-2xl border border-white/[0.04] bg-white/[0.02] p-4">
                  <span className="mb-1 block text-white/30">أنشأه</span>
                  <span className="font-semibold text-white/95">{requestDetails.created_by_employee_name || 'كاشير'}</span>
                </div>
                <div className="rounded-2xl border border-white/[0.04] bg-white/[0.02] p-4">
                  <span className="mb-1 block text-white/30">رقم الطلب</span>
                  <span className="font-mono font-semibold text-white/95">{requestDetails.return_ref}</span>
                </div>
              </div>

              {requestDetails.notes && (
                <div className="rounded-2xl border border-white/[0.04] bg-white/[0.02] p-4 text-xs">
                  <span className="mb-1 block text-white/30">ملاحظة الفرع</span>
                  <p className="leading-relaxed text-white/85">{requestDetails.notes}</p>
                </div>
              )}

              {requestDetails.resolved_at && (
                <div className="rounded-2xl border border-white/[0.04] bg-white/[0.02] p-4 text-xs">
                  <span className="mb-1 block text-white/30">نتيجة المعالجة</span>
                  <p className="font-semibold text-white/90">{formatDate(requestDetails.resolved_at)}</p>
                  {requestDetails.resolved_by_user_name && (
                    <p className="mt-1 text-white/55">بواسطة: {requestDetails.resolved_by_user_name}</p>
                  )}
                  {requestDetails.resolution_note && (
                    <p className="mt-3 leading-relaxed text-white/75">{requestDetails.resolution_note}</p>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ReturnRequestDetailsSheet;
