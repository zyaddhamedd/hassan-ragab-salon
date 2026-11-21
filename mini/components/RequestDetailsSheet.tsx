import React, { useEffect, useState } from 'react';
import { Loader2, Package2, Truck, CheckCircle2, Clipboard, X } from 'lucide-react';
import { apiClient } from '../src/api/client';
import { SupplyRequestSummary } from '../src/types/models';

interface RequestDetailsSheetProps {
  requestId: number | null;
  isOpen: boolean;
  onClose: () => void;
}

const RequestDetailsSheet: React.FC<RequestDetailsSheetProps> = ({ requestId, isOpen, onClose }) => {
  const [request, setRequest] = useState<SupplyRequestSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !requestId) return;

    const fetchDetails = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiClient.get(`/supply-requests/${requestId}`);
        setRequest(data);
      } catch (err: any) {
        setError(err.message || 'تعذر تحميل تفاصيل الطلب.');
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [isOpen, requestId]);

  if (!isOpen) return null;

  const formatDate = (dateStr: string) => {
    try {
      return new Intl.DateTimeFormat('ar-EG', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(dateStr));
    } catch {
      return dateStr;
    }
  };

  const getStatusIndex = (status: string) => {
    if (status === 'PENDING') return 0;
    if (status === 'SENT') return 1;
    if (status === 'RECEIVED') return 2;
    return 0;
  };

  const statusSteps = [
    { label: 'بانتظار المراجعة', desc: 'معلق لدى الإدارة' },
    { label: 'تم الشحن', desc: 'الشحنة قيد النقل' },
    { label: 'تم الاستلام', desc: 'أضيفت للمخزن' }
  ];

  const currentStep = request ? getStatusIndex(request.status) : 0;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 p-2 md:p-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-xl rounded-[2rem] border border-white/[0.06] bg-[#0e0e11] p-5 md:p-6 shadow-[0_32px_96px_rgba(0,0,0,0.65)] flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="mb-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02] text-white/60 hover:text-white hover:bg-white/[0.05] transition-all duration-300"
          >
            <X size={15} />
          </button>

          {request && (
            <div className="text-right">
              <p className="text-[10px] font-semibold tracking-wider text-[#E6D690]/80 uppercase">{request.request_ref}</p>
              <h3 className="mt-1 text-xl font-semibold text-white/95">تفاصيل طلب التوريد</h3>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="animate-spin text-[#E6D690]" size={24} />
            <p className="text-xs text-white/40">جارٍ تحميل تفاصيل الطلب...</p>
          </div>
        ) : error ? (
          <div className="py-12 text-center space-y-4">
            <p className="text-xs text-red-400 font-semibold">{error}</p>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-white/10 rounded-xl text-xs text-white bg-white/5"
            >
              إغلاق
            </button>
          </div>
        ) : request ? (
          <div className="space-y-5 overflow-y-auto pr-1 flex-1 text-right">
            
            {/* Elegant 3-Step Progress Tracker */}
            <div className="rounded-2xl bg-white/[0.015] border border-white/[0.03] p-4 text-center">
              <div className="relative flex justify-between items-center max-w-sm mx-auto mb-2">
                {/* Progress line background */}
                <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-white/10 -translate-y-1/2 z-0" />
                {/* Active progress line */}
                <div 
                  className="absolute top-1/2 left-0 h-[2px] bg-[#E6D690] -translate-y-1/2 z-0 transition-all duration-500" 
                  style={{ 
                    width: `${currentStep * 50}%`,
                    right: 'auto',
                    left: '50%',
                    transform: 'translate(-50%, -50%) scaleX(-1)' // align to RTL
                  }}
                />

                {statusSteps.map((step, idx) => {
                  const isActive = idx <= currentStep;
                  const isCurrent = idx === currentStep;
                  return (
                    <div key={idx} className="relative z-10 flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                        isCurrent 
                          ? 'bg-[#E6D690] text-[#121212] ring-4 ring-[#E6D690]/20'
                          : isActive
                            ? 'bg-[#E6D690]/20 text-[#E6D690] border border-[#E6D690]/40'
                            : 'bg-[#161619] text-white/30 border border-white/10'
                      }`}>
                        {idx === 0 && <Clipboard size={12} />}
                        {idx === 1 && <Truck size={12} />}
                        {idx === 2 && <CheckCircle2 size={12} />}
                      </div>
                      <span className={`mt-2 text-[10px] font-bold ${isActive ? 'text-white' : 'text-white/30'}`}>
                        {step.label}
                      </span>
                      <span className="text-[8px] text-white/20 mt-0.5">{step.desc}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Info Fields */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-white/[0.01] border border-white/[0.02] p-3">
                <span className="text-white/30 block mb-1">الموظف الطالب</span>
                <span className="font-semibold text-white/95">{request.created_by_employee_name || 'كاشير'}</span>
              </div>
              <div className="rounded-xl bg-white/[0.01] border border-white/[0.02] p-3">
                <span className="text-white/30 block mb-1">تاريخ الطلب</span>
                <span className="font-semibold text-white/95">{formatDate(request.created_at)}</span>
              </div>
            </div>

            {request.shipment_ref && (
              <div className="rounded-xl bg-amber-400/[0.03] border border-amber-400/10 p-3 text-xs flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex h-2 w-2 rounded-full ${
                    request.shipment_status === 'CANCELLED' ? 'bg-red-400' : request.shipment_status === 'RECEIVED' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                  }`} />
                  <span className="font-semibold text-[#E6D690]">
                    {request.shipment_status === 'CANCELLED' ? 'الشحنة ملغاة' : request.shipment_status === 'RECEIVED' ? 'تم استلام الشحنة' : 'الشحنة قيد النقل حالياً'}
                  </span>
                </div>
                <div>
                  <span className="text-white/40 ml-1">شحنة رقم:</span>
                  <span className="font-mono text-white font-bold">{request.shipment_ref}</span>
                </div>
              </div>
            )}

            {/* Note */}
            {request.note && (
              <div className="rounded-xl bg-white/[0.01] border border-white/[0.02] p-3 text-xs">
                <span className="text-white/30 block mb-1.5">ملاحظة الكاشير</span>
                <p className="text-white/80 leading-relaxed font-medium">{request.note}</p>
              </div>
            )}

            {/* Products Table */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold text-white/40 uppercase">المنتجات المطلوبة</label>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {request.items && request.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.015] border border-white/[0.03] p-3"
                  >
                    {/* Quantity comparison */}
                    <div className="text-left font-sans text-xs">
                      {request.status === 'PENDING' ? (
                        <div>
                          <span className="text-white/40">الكمية:</span>
                          <span className="font-bold text-white ml-1">{item.requested_quantity}</span>
                        </div>
                      ) : (
                        <div className="flex gap-3">
                          <div>
                            <span className="text-white/30 block text-[9px]">المطلوبة</span>
                            <span className="font-bold text-white/50">{item.requested_quantity}</span>
                          </div>
                          <div className="border-r border-white/5" />
                          <div>
                            <span className="text-[#E6D690]/60 block text-[9px]">المشحونة</span>
                            <span className="font-bold text-[#E6D690]">{item.final_quantity !== null ? item.final_quantity : '-'}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Product Name */}
                    <div className="text-right">
                      <span className="text-xs font-semibold text-white/95 block">{item.product_name}</span>
                      <span className="text-[10px] text-white/40">{item.unit || 'قطعة'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        ) : null}

      </div>
    </div>
  );
};

export default RequestDetailsSheet;
