import React from 'react';
import { Loader2, PackageCheck, Send } from 'lucide-react';
import { Branch, BulkTransferCartItem } from '../../types';

interface TransferSummaryProps {
  items: BulkTransferCartItem[];
  selectedBranch: Branch | null;
  note: string;
  onNoteChange: (value: string) => void;
  error: string | null;
  isSubmitting: boolean;
  onSubmit: () => void;
}

const TransferSummary: React.FC<TransferSummaryProps> = ({
  items,
  selectedBranch,
  note,
  onNoteChange,
  error,
  isSubmitting,
  onSubmit,
}) => {
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="space-y-4 rounded-[1.5rem] md:rounded-[2.2rem] border border-white/[0.06] bg-[#0e0e11] shadow-[0_20px_80px_rgba(0,0,0,0.4)] p-5 text-right">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-white">مراجعة الشحنة</h3>
          <p className="mt-1 text-[11px] font-bold text-white/45">راجع التفاصيل النهائية قبل إنشاء التحويل.</p>
        </div>

        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#E6D690]/20 bg-[#E6D690]/8 text-[#E6D690]">
          <PackageCheck size={18} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-[1.4rem] border border-white/[0.06] bg-[#0e0e11] p-4">
          <p className="text-[11px] font-bold tracking-[0.15em] text-white/40">عدد المنتجات</p>
          <p className="mt-2 text-2xl font-black text-[#E6D690]">{items.length}</p>
        </div>
        <div className="rounded-[1.4rem] border border-white/[0.06] bg-[#0e0e11] p-4">
          <p className="text-[11px] font-bold tracking-[0.15em] text-white/40">إجمالي القطع</p>
          <p className="mt-2 text-2xl font-black text-[#E6D690]">{totalQuantity}</p>
        </div>
      </div>

      <div className="rounded-[1.4rem] border border-white/[0.06] bg-[#0e0e11] p-4">
        <p className="text-[11px] font-bold tracking-[0.15em] text-white/40">الفرع الوجهة</p>
        <p className="mt-2 text-sm font-black text-white">{selectedBranch?.name || 'لم يتم اختيار فرع بعد'}</p>
      </div>

      <div>
        <label className="mb-2 block text-[11px] font-bold text-white/45">ملاحظة اختيارية</label>
        <textarea
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={3}
          placeholder="أضف ملاحظة داخلية للشحنة إذا لزم الأمر"
          className="w-full rounded-2xl border border-white/[0.06] bg-[#0e0e11] px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-[#E6D690]/40"
        />
      </div>

      {error && (
        <div className="rounded-[1.4rem] border border-[#E53935]/20 bg-[#E53935]/8 px-4 py-3 text-[11px] font-bold text-[#ff9d99]">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={isSubmitting}
        className={`flex h-12 w-full items-center justify-center gap-2 rounded-[1.5rem] text-sm font-black transition ${
            isSubmitting ? 'cursor-wait bg-[#E53935]/70 text-white' : 'bg-[#E53935] text-white hover:bg-[#f04a45]'
          }`}
      >
        {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        <span>{isSubmitting ? 'جارٍ إنشاء التحويل...' : 'إنشاء التحويل'}</span>
      </button>
    </div>
  );
};

export default TransferSummary;
