import React from 'react';
import { ArrowDownToLine, Loader2, Package2, Truck, X } from 'lucide-react';
import { BACKEND_URL } from '../src/api/client';
import { IncomingShipmentDetails } from '../src/types/models';

interface ShipmentDetailsSheetProps {
  shipmentId: number | null;
  shipment: IncomingShipmentDetails | null;
  isLoading: boolean;
  isReceiving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

const resolveProductImage = (imageUrl?: string | null) => {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('http')) return imageUrl;
  return `${BACKEND_URL}/uploads/${imageUrl.replace(/\\/g, '/')}`;
};

const formatDate = (value?: string | null) => {
  if (!value) return 'غير محدد';
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const ShipmentDetailsSheet: React.FC<ShipmentDetailsSheetProps> = ({
  shipmentId,
  shipment,
  isLoading,
  isReceiving,
  error,
  onClose,
  onConfirm,
}) => {
  if (!shipmentId) return null;

  return (
    <div className="mini-modal-overlay !z-[140]" dir="rtl">
      <div className="mini-modal-panel-static w-full max-w-3xl overflow-hidden rounded-[2.2rem] border border-white/[0.06] bg-[#0e0e11] shadow-[0_32px_96px_rgba(0,0,0,0.65)]">
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.04] px-6 py-5">
          <button
            type="button"
            onClick={onClose}
            disabled={isReceiving}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02] text-white/60 hover:text-white hover:bg-white/[0.05] hover:border-white/[0.12] transition-all duration-300 disabled:opacity-50"
          >
            <X size={16} />
          </button>

          <div className="mr-auto text-right">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#E6D690]/10 bg-[#E6D690]/5 px-3 py-1 text-[10px] font-semibold tracking-wider text-[#E6D690] backdrop-blur-sm">
              <Truck size={12} />
              <span>شحنة واردة</span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-white/95">شحنة واردة</h2>
            <p className="mt-2 text-[11px] font-medium text-white/40">
              {shipment ? `#${shipment.shipment_ref}` : 'جارٍ تحميل التفاصيل...'}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 px-6 py-10">
            <Loader2 size={26} className="animate-spin text-[#E6D690]" />
            <p className="text-sm font-medium text-white/45">جارٍ تحميل تفاصيل الشحنة...</p>
          </div>
        ) : shipment ? (
          <div className="mini-scroll-y custom-scrollbar space-y-6 px-6 py-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/[0.02] bg-white/[0.02] p-4 text-right">
                <p className="text-[10px] font-semibold tracking-wider text-white/40 uppercase">من</p>
                <p className="mt-1.5 text-sm font-bold text-white/90">{shipment.source_branch_name}</p>
              </div>
              <div className="rounded-2xl border border-white/[0.02] bg-white/[0.02] p-4 text-right">
                <p className="text-[10px] font-semibold tracking-wider text-white/40 uppercase">إلى</p>
                <p className="mt-1.5 text-sm font-bold text-white/90">{shipment.destination_branch_name}</p>
              </div>
              <div className="rounded-2xl border border-white/[0.02] bg-white/[0.02] p-4 text-right">
                <p className="text-[10px] font-semibold tracking-wider text-white/40 uppercase">المنتجات</p>
                <p className="mt-1.5 text-sm font-bold text-white/90">{shipment.items_count}</p>
              </div>
              <div className="rounded-2xl border border-white/[0.02] bg-white/[0.02] p-4 text-right">
                <p className="text-[10px] font-semibold tracking-wider text-white/40 uppercase">إجمالي القطع</p>
                <p className="mt-1.5 text-sm font-bold text-white/90">{shipment.total_quantity}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/[0.02] bg-white/[0.02] px-4 py-3 text-right text-[11px] font-medium text-white/50 space-y-1.5">
              <div className="flex justify-between items-center">
                <span>تم الإرسال: {formatDate(shipment.created_at)}</span>
                {shipment.status === 'RECEIVED' && shipment.received_at && (
                  <span className="text-emerald-400/80">تم الاستلام: {formatDate(shipment.received_at)}</span>
                )}
              </div>
              {shipment.status === 'RECEIVED' && shipment.received_by_name && (
                <div className="text-emerald-400/60 font-semibold pt-0.5">
                  استُلمت بواسطة: <span className="text-emerald-400/90">{shipment.received_by_name}</span>
                </div>
              )}
              {shipment.note && <div className="text-white/35 pt-1">• {shipment.note}</div>}
            </div>

            <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar">
              {shipment.items.map((item) => {
                const imageSrc = resolveProductImage(item.image_url);
                return (
                  <div key={`${shipment.id}-${item.product_id}`} className="flex items-center gap-4 rounded-2xl border border-white/[0.03] bg-white/[0.015] hover:bg-white/[0.025] p-4 transition-all duration-300">
                    <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] flex items-center justify-center h-20 w-20">
                      {imageSrc ? (
                        <img src={imageSrc} alt={item.product_name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/35">
                          <Package2 size={18} />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1 text-right">
                      <p className="text-base font-semibold text-white/95">{item.product_name}</p>
                      <p className="mt-2 text-sm font-medium text-white/45">الكمية المرسلة: {item.quantity} قطعة</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {error && (
              <div className="rounded-2xl border border-[#E53935]/10 bg-[#E53935]/5 px-4 py-3 text-right text-sm font-semibold text-[#ffb1ad]">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={onConfirm}
              disabled={isReceiving || shipment.status !== 'IN_TRANSIT'}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#E53935] hover:bg-[#f43f36] px-5 py-4 text-sm font-semibold text-white transition-all duration-300 shadow-[0_6px_20px_rgba(229,57,53,0.25)] hover:shadow-[0_8px_32px_rgba(229,57,53,0.35)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {isReceiving ? <Loader2 size={16} className="animate-spin" /> : <ArrowDownToLine size={16} />}
              {shipment.status === 'CANCELLED' ? 'ملغاة' : shipment.status === 'IN_TRANSIT' ? 'تأكيد الاستلام' : 'تم استلام الشحنة'}
            </button>
          </div>
        ) : (
          <div className="px-6 py-10 text-center text-sm font-medium text-white/45">
            {error || 'تعذر تحميل بيانات الشحنة.'}
          </div>
        )}
      </div>
    </div>
  );
};

export default ShipmentDetailsSheet;
