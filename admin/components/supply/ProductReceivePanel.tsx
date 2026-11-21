import React, { useId, useMemo, useState } from 'react';
import { Loader2, PlusCircle, Store } from 'lucide-react';
import { ProductWorkspaceBranchStock } from '../../types';
import { workspaceStyles } from './productWorkspaceStyles';

interface ProductReceivePanelProps {
  isDarkMode?: boolean;
  branches: ProductWorkspaceBranchStock[];
  unit: string;
  submitting: boolean;
  onReceive: (payload: { branch_id: number; quantity: number; notes: string }) => Promise<void>;
}

const ProductReceivePanel: React.FC<ProductReceivePanelProps> = ({ branches, unit, submitting, onReceive, isDarkMode = true }) => {
  const fieldId = useId();
  const tone = workspaceStyles(isDarkMode);
  const [quantity, setQuantity] = useState<number>(0);
  const [notes, setNotes] = useState('');

  const mainStore = useMemo(
    () => branches.find((branch) => branch.is_main_warehouse) || null,
    [branches]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mainStore || quantity <= 0) return;

    await onReceive({
      branch_id: mainStore.branch_id,
      quantity: Number(quantity),
      notes: notes.trim(),
    });

    setQuantity(0);
    setNotes('');
  };

  return (
    <form onSubmit={handleSubmit} aria-label="توريد للمخزن الرئيسي" className="space-y-3">
      <p className={`flex flex-wrap items-center gap-2 text-xs ${tone.muted}`}><Store size={14} aria-hidden="true" /> الوجهة: <span className="font-bold">{mainStore?.branch_name || 'المخزن الرئيسي'}</span></p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-quantity`} className={`text-xs font-bold ${tone.muted}`}>الكمية</label>
          <input id={`${fieldId}-quantity`} type="number" min="1" step="1" value={quantity || ''} onChange={(event) => setQuantity(Number(event.target.value))} placeholder={`مثال: 20 ${unit}`} className={tone.field} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-notes`} className={`text-xs font-bold ${tone.muted}`}>ملاحظة تشغيلية</label>
          <textarea id={`${fieldId}-notes`} value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="سبب التوريد أو مصدره" className={`${tone.field} resize-y`} />
        </div>
      </div>
      <button type="submit" disabled={submitting || !mainStore || quantity <= 0} className={`${tone.button} border-transparent bg-[#c82e2b] !text-white hover:!bg-red-800 disabled:cursor-not-allowed disabled:opacity-50`}>
        {submitting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <PlusCircle size={15} aria-hidden="true" />} تأكيد التوريد
      </button>
    </form>
  );
};

export default ProductReceivePanel;
