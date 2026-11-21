import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  PackageCheck,
  ShieldAlert,
  X,
  Zap,
} from 'lucide-react';
import {
  BranchInventoryProduct,
  BranchInventoryProductDetails,
  InventoryBatchBreakdown,
} from '../src/types/models';

interface ConsumptionSheetProps {
  product: BranchInventoryProduct | null;
  details: BranchInventoryProductDetails | null;
  detailsLoading: boolean;
  detailsError: string | null;
  isSubmitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: { product_id: number; quantity: number; reason: string; note?: string | null }) => void;
}

const reasonOptions = ['استخدام داخلي', 'تالف', 'تنظيف', 'أخرى'] as const;

const batchStatusMap: Record<InventoryBatchBreakdown['status'], { label: string; className: string }> = {
  HEALTHY: { label: 'جيد', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' },
  EXPIRING_SOON: { label: 'قريب الانتهاء', className: 'border-amber-500/20 bg-amber-500/10 text-amber-300' },
  EXPIRED: { label: 'منتهي', className: 'border-red-500/20 bg-red-500/10 text-red-300' },
  NO_EXPIRY: { label: 'بدون صلاحية', className: 'border-white/10 bg-white/[0.05] text-white/60' },
};

const formatDisplayDate = (value?: string | null) => {
  if (!value) return 'غير محدد';
  try {
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
  } catch {
    return value.split('T')[0];
  }
};

const formatDaysRemaining = (days?: number | null) => {
  if (days === null || days === undefined) return 'غير محدد';
  if (days < 0) return `منتهي منذ ${Math.abs(days)} يوم`;
  if (days === 0) return 'ينتهي اليوم';
  return `${days} يوم`;
};

const ConsumptionSheet: React.FC<ConsumptionSheetProps> = ({
  product,
  details,
  detailsLoading,
  detailsError,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}) => {
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<(typeof reasonOptions)[number]>('استخدام داخلي');
  const [note, setNote] = useState('');

  const orderedBatches = useMemo(() => {
    if (!details?.batches?.length) return [];
    const fefoEligible = details.batches.filter((b) => b.status !== 'EXPIRED');
    const expired = details.batches.filter((b) => b.status === 'EXPIRED');
    return [...fefoEligible, ...expired];
  }, [details]);

  const firstFefoBatch = useMemo(
    () => orderedBatches.find((b) => b.status !== 'EXPIRED') || null,
    [orderedBatches],
  );

  const hasExpiredBatches = useMemo(
    () => orderedBatches.some((b) => b.status === 'EXPIRED'),
    [orderedBatches],
  );

  useEffect(() => {
    if (!product) return;
    setQuantity(product.stock_quantity > 0 ? 1 : 0);
    setReason('استخدام داخلي');
    setNote('');
  }, [product]);

  if (!product) return null;

  return (
    /* ── Full-screen overlay ── */
    <div
      className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5"
      onClick={(e) => { if (e.target === e.currentTarget && !isSubmitting) onClose(); }}
    >
      {/* ── Dialog panel ── wide, fixed height, no outer scroll ── */}
      <div
        className="relative w-full flex flex-col rounded-3xl border border-white/[0.07] bg-[#0e0e11] shadow-[0_32px_96px_rgba(0,0,0,0.8)]"
        style={{ maxWidth: 1000, height: 'min(92dvh, 680px)' }}
      >
        {/* ══ TOP HEADER ══ */}
        <div className="shrink-0 flex items-center justify-between gap-4 border-b border-white/[0.05] px-5 py-4 sm:px-7">
          {/* Close btn */}
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.02] text-white/50 transition-all hover:bg-white/[0.06] hover:text-white"
          >
            <X size={15} />
          </button>

          {/* Product info */}
          <div className="flex-1 text-right min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#E6D690]/70">تسجيل استهلاك</p>
            <h2 className="mt-0.5 text-base font-black text-white/95 truncate">{product.name}</h2>
          </div>

          {/* Stock pill */}
          <div className="shrink-0 text-left">
            <span className="inline-flex items-baseline gap-1 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-sm font-black text-white">
              {product.stock_quantity}
              <span className="text-[10px] font-semibold text-white/40">{product.unit}</span>
            </span>
            <p className="mt-0.5 text-[9px] text-white/30 font-semibold text-center">متاح</p>
          </div>
        </div>

        {/* ══ BODY: two-column layout ══ */}
        <div className="flex flex-col sm:flex-row flex-1 min-h-0 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-white/[0.04]">

          {/* ── LEFT PANEL: Action Form ── */}
          <div className="shrink-0 sm:w-72 flex flex-col justify-between gap-4 p-5 sm:p-6 overflow-y-auto" dir="rtl">

            {/* FEFO banner */}
            <div className="rounded-2xl border border-[#E6D690]/10 bg-[linear-gradient(135deg,rgba(230,214,144,0.07),rgba(255,255,255,0.01))] p-4">
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-[#E6D690]/70">Nearest Expiry · FEFO</p>
              <p className="mt-2 text-lg font-black text-white leading-tight">
                {firstFefoBatch ? formatDisplayDate(firstFefoBatch.expiration_date) : '—'}
              </p>
              <p className="mt-1 text-[11px] font-semibold text-white/50">
                {firstFefoBatch
                  ? firstFefoBatch.expiration_date
                    ? formatDaysRemaining(firstFefoBatch.days_remaining)
                    : 'Consumed last'
                  : hasExpiredBatches
                    ? 'لن يصرف من المنتهية تلقائياً'
                    : 'لا توجد دفعات متاحة'}
              </p>
            </div>

            {/* Quantity */}
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-white/35">الكمية المستهلكة</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="h-11 w-11 shrink-0 flex items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] text-white/60 text-xl font-black hover:bg-white/[0.06] hover:text-white transition-all"
                >−</button>
                <input
                  type="number"
                  min={1}
                  max={product.stock_quantity}
                  step={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.min(product.stock_quantity, Math.max(1, Number(e.target.value))))}
                  className="h-11 flex-1 rounded-xl border border-white/[0.05] bg-white/[0.02] text-center text-lg font-black text-white outline-none focus:border-[#E6D690]/40 focus:bg-white/[0.04] transition-all"
                />
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(product.stock_quantity, q + 1))}
                  className="h-11 w-11 shrink-0 flex items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] text-white/60 text-xl font-black hover:bg-white/[0.06] hover:text-white transition-all"
                >+</button>
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-white/35">سبب الاستهلاك</label>
              <div className="grid grid-cols-2 gap-2">
                {reasonOptions.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setReason(opt)}
                    className={`rounded-xl border px-3 py-2.5 text-xs font-bold transition-all duration-200 ${
                      reason === opt
                        ? 'border-[#E6D690]/35 bg-[#E6D690]/8 text-[#E6D690]'
                        : 'border-white/[0.05] bg-white/[0.01] text-white/50 hover:bg-white/[0.04] hover:text-white'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* Note (only for أخرى) */}
            {reason === 'أخرى' && (
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-white/35">ملاحظة</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="اكتب ملاحظة مختصرة..."
                  className="w-full rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-sm font-medium text-white outline-none focus:border-[#E6D690]/40 transition-all resize-none"
                />
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-xl border border-red-500/15 bg-red-500/5 px-3 py-2.5 text-[11px] font-semibold text-red-300">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => onSubmit({
                product_id: product.product_id,
                quantity,
                reason,
                note: reason === 'أخرى' ? (note.trim() || null) : null,
              })}
              className={`flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-black transition-all duration-300 ${
                isSubmitting
                  ? 'cursor-wait bg-[#E53935]/60 text-white'
                  : 'bg-[#E53935] text-white hover:bg-[#f43f36] shadow-[0_6px_20px_rgba(229,57,53,0.25)] hover:shadow-[0_8px_32px_rgba(229,57,53,0.35)]'
              }`}
            >
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={15} />}
              <span>{isSubmitting ? 'جارٍ التسجيل...' : 'تسجيل الاستهلاك'}</span>
            </button>
          </div>

          {/* ── RIGHT PANEL: Batch Details (scrollable) ── */}
          <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-3" dir="rtl">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 mb-4">تفاصيل الدفعات المخزنية</p>

            {detailsLoading ? (
              <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-white/[0.05] bg-white/[0.01] py-16 text-white/40">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-xs font-semibold">جارٍ تحميل الدفعات...</span>
              </div>
            ) : detailsError ? (
              <div className="rounded-2xl border border-red-500/10 bg-red-500/5 px-4 py-3 text-xs font-semibold text-red-300">
                {detailsError}
              </div>
            ) : details && orderedBatches.length > 0 ? (
              <>
                {hasExpiredBatches && (
                  <div className="flex items-start gap-3 rounded-2xl border border-red-500/12 bg-red-500/[0.05] p-3.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-300">
                      <ShieldAlert size={14} />
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-black text-red-200">يوجد دفعات منتهية الصلاحية</p>
                      <p className="mt-0.5 text-[10px] font-semibold text-red-200/60">لن يتم الصرف منها تلقائياً.</p>
                    </div>
                  </div>
                )}

                {orderedBatches.map((batch) => {
                  const badge = batchStatusMap[batch.status];
                  const isFirst = !!firstFefoBatch && batch.batch_id === firstFefoBatch.batch_id;
                  const isNoExpiry = batch.status === 'NO_EXPIRY';

                  return (
                    <div
                      key={batch.batch_id}
                      className={`rounded-2xl border p-4 transition-all duration-200 ${
                        isFirst
                          ? 'border-[#E6D690]/20 bg-[linear-gradient(135deg,rgba(230,214,144,0.06),rgba(0,0,0,0.2))]'
                          : 'border-white/[0.05] bg-black/20'
                      }`}
                    >
                      {/* Batch header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-left">
                          <div className="flex items-center gap-1.5">
                            {isFirst && (
                              <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-black text-emerald-300">
                                <CheckCircle2 size={10} />
                                FEFO
                              </span>
                            )}
                            <span className={`inline-flex rounded-lg border px-2 py-0.5 text-[10px] font-black ${badge.className}`}>
                              {badge.label}
                            </span>
                          </div>
                          <p className="mt-2 text-2xl font-black text-white leading-none">
                            {batch.remaining_quantity}
                            <span className="mr-1.5 text-[10px] font-bold text-white/35">{product.unit}</span>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-sm font-black text-white">{batch.batch_number}</p>
                          <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-white/25">Batch</p>
                        </div>
                      </div>

                      {/* Batch stats grid */}
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {[
                          { label: 'تاريخ الشراء', value: formatDisplayDate(batch.purchase_date) },
                          { label: 'تاريخ الاستلام', value: formatDisplayDate(batch.received_at) },
                          { label: 'الصلاحية', value: batch.expiration_date ? formatDisplayDate(batch.expiration_date) : 'بدون صلاحية' },
                          { label: 'الأيام المتبقية', value: isNoExpiry ? 'بدون صلاحية' : formatDaysRemaining(batch.days_remaining) },
                        ].map((item) => (
                          <div key={item.label} className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-2.5 text-right">
                            <p className="text-[8px] font-black uppercase tracking-wider text-white/25">{item.label}</p>
                            <p className="mt-1 text-xs font-black text-white">{item.value}</p>
                          </div>
                        ))}
                      </div>

                      {/* FEFO / Consumed last note */}
                      {(isFirst || isNoExpiry) && (
                        <div className={`mt-2.5 rounded-xl px-3 py-2 text-[11px] font-bold text-center ${
                          isFirst
                            ? 'border border-emerald-500/15 bg-emerald-500/[0.07] text-emerald-300'
                            : 'border border-white/[0.07] bg-white/[0.03] text-white/50'
                        }`}>
                          {isFirst ? '↑ الصرف يبدأ من هنا' : 'Consumed last'}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/[0.06] bg-black/10 py-20 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.02]">
                  <PackageCheck size={22} className="text-white/20" />
                </div>
                <p className="text-xs font-semibold text-white/40">لا توجد دفعات مخزنية مسجلة لهذا المنتج.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConsumptionSheet;
