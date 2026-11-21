import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Inbox, Loader2, Package2, Truck, X } from 'lucide-react';
import { ShipmentDetailsPayload } from '../../types';
import { adminFetch } from '../../api/adminFetch';

interface ShipmentDetailsModalProps {
  shipmentId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onCancelled?: (message: string) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';

const resolveProductImage = (imageUrl?: string | null) => {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('http')) return imageUrl;
  return `${API_BASE}/uploads/${imageUrl.replace(/\\/g, '/')}`;
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

const formatCurrency = (value: number) => (
  `${Number(value || 0).toLocaleString('ar-EG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ج.م`
);

const ShipmentDetailsModal: React.FC<ShipmentDetailsModalProps> = ({ shipmentId, isOpen, onClose, onCancelled }) => {
  const [details, setDetails] = useState<ShipmentDetailsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!isOpen || !shipmentId) return;
    const controller = new AbortController();
    let active = true;
    setDetails(null);
    setConfirmingCancel(false);
    setReason('');

    const loadDetails = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await adminFetch(`${API_BASE}/api/admin/shipments/${shipmentId}`, {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
          },
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'تعذر تحميل بيانات الشحنة.');
        }
        if (active) setDetails(data);
      } catch (loadError: any) {
        if (active && loadError.name !== 'AbortError') {
          setError(loadError.message || 'تعذر تحميل بيانات الشحنة.');
          setDetails(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadDetails();
    return () => { active = false; controller.abort(); };
  }, [isOpen, shipmentId]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading && !cancelling) {
        if (confirmingCancel) setConfirmingCancel(false);
        else onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, loading, cancelling, confirmingCancel, onClose]);

  const cancelShipment = async () => {
    if (!details?.can_cancel || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      const response = await adminFetch(`${API_BASE}/api/admin/shipments/${shipmentId}/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر إلغاء الشحنة.');
      setDetails(current => current ? { ...current, ...data, status: 'CANCELLED', can_cancel: false } : current);
      setConfirmingCancel(false);
      onCancelled?.(data.message || 'تم إلغاء الشحنة وإعادة المخزون إلى المصدر.');
    } catch (cancelError: any) {
      setError(cancelError.message || 'تعذر إلغاء الشحنة.');
    } finally {
      setCancelling(false);
    }
  };

  if (!isOpen || !shipmentId) return null;

  const isInbound = details?.shipment_type === 'INBOUND_SUPPLY';
  const title = isInbound ? 'تفاصيل الشحنة الواردة' : 'تفاصيل التحويل';
  const sourceName = isInbound
    ? details?.supplier_name_snapshot || 'توريد خارجي'
    : details?.source_branch?.name || 'غير محدد';
  const destinationName = details?.destination_branch?.name || 'المخزن الرئيسي';
  const summaryProducts = details?.products_count || details?.items_count || 0;
  const summaryPieces = details?.pieces_count || details?.total_quantity || 0;
  const summaryCost = details?.total_cost_snapshot || details?.total_cost_amount || 0;

  return createPortal(
    <div className="admin-overlay-shell admin-overlay-shell--scroll z-[9999] bg-black/60 backdrop-blur-md" dir="rtl">
      <div className="admin-overlay-panel relative w-full max-w-3xl rounded-[2.2rem] border border-white/[0.06] bg-[#0e0e11] shadow-[0_32px_96px_rgba(0,0,0,0.65)]">
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.04] px-6 py-5">
          <button
            type="button"
            onClick={onClose}
            disabled={loading || cancelling}
            aria-label="إغلاق تفاصيل الشحنة"
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02] text-white/60 transition-all duration-300 hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-white disabled:opacity-50"
          >
            <X size={16} />
          </button>

          <div className="mr-auto text-right">
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold tracking-wider backdrop-blur-sm ${
              isInbound
                ? 'border-cyan-400/15 bg-cyan-400/10 text-cyan-200'
                : 'border-[#E6D690]/10 bg-[#E6D690]/5 text-[#E6D690]'
            }`}>
              {isInbound ? <Inbox size={12} /> : <Truck size={12} />}
              <span>{isInbound ? 'شحنة واردة' : 'تحويل'}</span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-white/95">{title}</h2>
            <p className="mt-2 text-[11px] font-medium text-white/40">
              {details ? `#${details.shipment_ref}` : 'جارٍ تحميل التفاصيل...'}
            </p>
          </div>
        </div>

        <div className="admin-overlay-body">
          {loading ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 px-6 py-10">
              <Loader2 size={26} className="animate-spin text-[#E6D690]" />
              <p className="text-sm font-medium text-white/45">جارٍ تحميل تفاصيل الشحنة...</p>
            </div>
          ) : details ? (
            <div className="space-y-6 px-6 py-6">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-2xl border border-white/[0.02] bg-white/[0.02] p-4 text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">من</p>
                  <p className="mt-1.5 text-sm font-bold text-white/90">{sourceName}</p>
                </div>
                <div className="rounded-2xl border border-white/[0.02] bg-white/[0.02] p-4 text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">إلى</p>
                  <p className="mt-1.5 text-sm font-bold text-white/90">{destinationName}</p>
                </div>
                <div className="rounded-2xl border border-white/[0.02] bg-white/[0.02] p-4 text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">المنتجات</p>
                  <p className="mt-1.5 text-sm font-bold text-white/90">{summaryProducts}</p>
                </div>
                <div className="rounded-2xl border border-white/[0.02] bg-white/[0.02] p-4 text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">إجمالي القطع</p>
                  <p className="mt-1.5 text-sm font-bold text-white/90">{summaryPieces}</p>
                </div>
              </div>

              <div className="space-y-1.5 rounded-2xl border border-white/[0.02] bg-white/[0.02] px-4 py-3 text-right text-[11px] font-medium text-white/50">
                <div className="flex items-center justify-between">
                  <span>{isInbound ? 'تاريخ التوريد' : 'تم الإرسال'}: {formatDate(details.created_at)}</span>
                  {details.status === 'RECEIVED' && details.received_at && (
                    <span className="text-emerald-400/80">تم الاستلام: {formatDate(details.received_at)}</span>
                  )}
                </div>

                {details.created_by?.full_name && (
                  <div className="pt-0.5 font-semibold text-white/40">
                    {isInbound ? 'سُجلت بواسطة' : 'أُنشئت بواسطة'}: <span className="text-white/60">{details.created_by.full_name}</span>
                  </div>
                )}

                {!isInbound && details.status === 'RECEIVED' && details.received_by?.name && (
                  <div className="pt-0.5 font-semibold text-emerald-400/60">
                    استُلمت بواسطة: <span className="text-emerald-400/90">{details.received_by.name}</span>
                  </div>
                )}

                <div className="pt-0.5 text-sm font-semibold text-[#E6D690]/80">
                  إجمالي تكلفة الشحنة: <span className="text-[#E6D690]">{formatCurrency(summaryCost)}</span>
                </div>
                {details.note && <div className="pt-1 text-white/35">• {details.note}</div>}
                {details.status === 'CANCELLED' && (
                  <div className="pt-2 text-red-300">
                    ملغاة: {formatDate(details.cancelled_at)}
                    {details.cancelled_by_name && <span> • بواسطة {details.cancelled_by_name}</span>}
                    {details.cancellation_reason && <p>{details.cancellation_reason}</p>}
                  </div>
                )}
              </div>

              <div className="custom-scrollbar max-h-[300px] space-y-3 overflow-y-auto">
                {details.items.map((item) => {
                  const imageSrc = resolveProductImage(item.image_url);
                  const unitCost = item.unit_cost_snapshot ?? 0;
                  const lineCostTotal = item.line_cost_total ?? unitCost * item.quantity;

                  return (
                    <div
                      key={`${details.id}-${item.product_id}`}
                      className="flex items-center gap-4 rounded-2xl border border-white/[0.03] bg-white/[0.015] p-4 transition-all duration-300 hover:bg-white/[0.025]"
                    >
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
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
                        <p className="mt-2 text-sm font-medium text-white/45">الكمية: {item.quantity} قطعة</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold">
                          <span className="text-white/45">تكلفة الوحدة: <span className="text-white/72">{formatCurrency(unitCost)}</span></span>
                          <span className="text-white/20">•</span>
                          <span className="text-[#E6D690]/85">إجمالي البند: {formatCurrency(lineCostTotal)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {error && (
                <div role="alert" className="rounded-2xl border border-[#E53935]/10 bg-[#E53935]/5 px-4 py-3 text-right text-sm font-semibold text-[#ffb1ad]">
                  {error}
                </div>
              )}

              <div className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-sm font-semibold ${
                details.status === 'CANCELLED'
                  ? 'border border-red-500/20 bg-red-500/10 text-red-300'
                  : details.status === 'RECEIVED'
                  ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                  : 'border border-amber-500/20 bg-amber-500/10 text-amber-400'
              }`}>
                {details.status === 'RECEIVED' ? <CheckCircle2 size={16} /> : <Truck size={16} />}
                {details.status === 'CANCELLED' ? 'ملغاة' : details.status === 'RECEIVED' ? 'تم الاستلام' : 'قيد النقل'}
              </div>
              {details.can_cancel && details.status === 'IN_TRANSIT' && details.shipment_type === 'OUTBOUND_TRANSFER' && (
                confirmingCancel ? (
                  <div role="alertdialog" aria-modal="true" aria-labelledby="cancel-shipment-title" aria-describedby="cancel-shipment-description"
                    onKeyDown={event => {
                      if (event.key !== 'Tab') return;
                      const controls = (event.currentTarget as HTMLDivElement).querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button:not(:disabled), textarea:not(:disabled)');
                      const first = controls[0]; const last = controls[controls.length - 1];
                      if (!first) { event.preventDefault(); return; }
                      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
                    }}
                    className="space-y-3 rounded-2xl border border-red-400/30 bg-red-500/5 p-4 text-right">
                    <h3 id="cancel-shipment-title" className="font-bold text-white">تأكيد إلغاء الشحنة</h3>
                    <p id="cancel-shipment-description" className="text-sm text-white/70">سيتم إلغاء الشحنة وإعادة كامل كمياتها إلى مخزون {sourceName}، ولن يتمكن الفرع من استلامها. سيبقى سجل الشحنة محفوظاً.</p>
                    <label className="block text-sm text-white/70" htmlFor="shipment-cancellation-reason">سبب الإلغاء (اختياري)</label>
                    <textarea id="shipment-cancellation-reason" maxLength={2000} rows={2} value={reason} disabled={cancelling} onChange={event => setReason(event.target.value)} className="w-full rounded-xl border border-white/15 bg-black/20 p-3 text-white" />
                    <div className="flex gap-3">
                      <button type="button" autoFocus disabled={cancelling} onClick={() => setConfirmingCancel(false)} className="rounded-xl border border-white/15 px-4 py-2 text-white disabled:opacity-50">رجوع</button>
                      <button type="button" disabled={cancelling} onClick={() => void cancelShipment()} className="rounded-xl bg-red-600 px-4 py-2 font-bold text-white disabled:opacity-50">{cancelling ? 'جارٍ الإلغاء...' : 'تأكيد إلغاء الشحنة'}</button>
                    </div>
                  </div>
                ) : <button type="button" onClick={() => { setError(null); setConfirmingCancel(true); }} className="w-full rounded-2xl border border-red-400/30 px-5 py-3 font-semibold text-red-300">إلغاء الشحنة</button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ShipmentDetailsModal;
