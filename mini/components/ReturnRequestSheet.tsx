import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Package2, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { apiClient } from '../src/api/client';
import { BranchInventoryProduct, ReturnRequestReason } from '../src/types/models';

interface ReturnRequestSheetProps {
  product: BranchInventoryProduct | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const REASON_OPTIONS: Array<{ value: ReturnRequestReason; label: string }> = [
  { value: 'DAMAGED', label: 'تالف' },
  { value: 'EXPIRED', label: 'منتهي' },
  { value: 'WRONG_SHIPMENT', label: 'شحنة خاطئة' },
  { value: 'NOT_NEEDED', label: 'غير مطلوب' },
  { value: 'MANUFACTURING_DEFECT', label: 'عيب تصنيع' },
  { value: 'OTHER', label: 'أخرى' },
];

const ReturnRequestSheet: React.FC<ReturnRequestSheetProps> = ({ product, isOpen, onClose, onSuccess }) => {
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<ReturnRequestReason | ''>('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !product) return;
    setQuantity(1);
    setReason('');
    setNotes('');
    setError(null);
  }, [isOpen, product]);

  const maxQuantity = useMemo(() => Math.max(0, intOrZero(product?.stock_quantity)), [product?.stock_quantity]);

  const handleSubmit = async () => {
    if (!product) return;

    if (!reason) {
      setError('اختر سبب المرتجع');
      return;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError('الكمية يجب أن تكون أكبر من الصفر');
      return;
    }

    if (quantity > maxQuantity) {
      setError('الكمية الحالية غير كافية');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await apiClient.post('/returns', {
        product_id: product.product_id,
        quantity,
        reason,
        notes: notes.trim() || null,
      });

      onSuccess(response.message || 'تم إرسال طلب المرتجع');
      onClose();
    } catch (submitError: any) {
      setError(submitError.message || 'تعذر إرسال طلب المرتجع');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !product) return null;

  return (
    <div className="mini-modal-overlay">
      <div className="mini-modal-panel-static w-full max-w-xl overflow-hidden rounded-[2rem] border border-white/[0.06] bg-[#0d0d10] shadow-[0_32px_96px_rgba(0,0,0,0.65)]">
        <div className="border-b border-white/[0.05] bg-[radial-gradient(circle_at_top,rgba(230,214,144,0.08),transparent_72%)] px-5 pb-5 pt-5 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02] text-white/60 transition-all duration-300 hover:bg-white/[0.05] hover:text-white"
            >
              <X size={15} />
            </button>

            <div className="text-right">
              <p className="text-[10px] font-semibold tracking-[0.24em] text-[#E6D690]/80">RETURN</p>
              <h3 className="mt-1 text-xl font-black text-white/95">طلب مرتجع</h3>
              <p className="mt-1 text-[11px] font-medium text-white/40">يراجَع من الإدارة قبل التنفيذ</p>
            </div>
          </div>

          <div className="mt-4 rounded-[1.6rem] border border-white/[0.05] bg-white/[0.02] p-4 text-right">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#E6D690]/15 bg-[#E6D690]/8 text-[#E6D690]">
                <Package2 size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-white/35">المنتج</p>
                <p className="mt-1 text-sm font-black text-white">{product.name}</p>
                <p className="mt-1 text-[11px] font-medium text-white/40">
                  المتاح الآن: {product.stock_quantity} {product.unit}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.05] px-3 py-2 text-[11px] font-semibold text-emerald-300">
              <ShieldCheck size={14} className="shrink-0" />
              <span>لا يخصم المخزون الآن</span>
            </div>
          </div>
        </div>

        <div className="mini-scroll-y custom-scrollbar space-y-4 px-5 py-5 text-right md:px-6 md:py-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-[11px] font-semibold text-white/45">الكمية</label>
              <input
                type="number"
                min={1}
                max={Math.max(1, maxQuantity)}
                value={quantity}
                onChange={(event) => setQuantity(Math.max(1, Number(event.target.value || 1)))}
                className="h-12 w-full rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 text-sm font-semibold text-white outline-none transition-all focus:border-[#E6D690]/30 focus:bg-white/[0.04]"
              />
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-semibold text-white/45">السبب</label>
              <select
                value={reason}
                onChange={(event) => setReason(event.target.value as ReturnRequestReason)}
                className="h-12 w-full rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 text-sm font-semibold text-white outline-none transition-all focus:border-[#E6D690]/30 focus:bg-white/[0.04]"
              >
                <option value="">اختر السبب</option>
                {REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold text-white/45">ملاحظة</label>
            <textarea
              rows={4}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="ملاحظة للإدارة"
              className="w-full rounded-[1.4rem] border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-sm font-medium text-white placeholder-white/20 outline-none transition-all focus:border-[#E6D690]/30 focus:bg-white/[0.04] resize-none"
            />
          </div>

          {maxQuantity <= 0 && (
            <div className="rounded-2xl border border-amber-500/10 bg-amber-500/[0.05] px-4 py-3 text-[11px] font-semibold text-amber-200">
              لا يمكن إنشاء مرتجع لهذا المنتج حالياً
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-[#E53935]/10 bg-[#E53935]/5 px-4 py-3 text-[11px] font-semibold text-[#ff9d99]">
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={isSubmitting || maxQuantity <= 0}
            onClick={handleSubmit}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-[1.2rem] text-sm font-bold transition-all duration-300 ${
              isSubmitting || maxQuantity <= 0
                ? 'cursor-not-allowed bg-[#E6D690]/45 text-[#121212]'
                : 'bg-[#E6D690] text-[#121212] hover:bg-[#dccb84]'
            }`}
          >
            {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
            <span>{isSubmitting ? 'جارٍ إرسال الطلب...' : 'إرسال الطلب'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

function intOrZero(value?: number | null) {
  return Number.isFinite(value) ? Number(value) : 0;
}

export default ReturnRequestSheet;
