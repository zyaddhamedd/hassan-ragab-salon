import React, { useEffect, useId, useMemo, useState } from 'react';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import { ProductWorkspaceBranchStock } from '../../types';
import { workspaceStyles } from './productWorkspaceStyles';

interface ProductDistributionPanelProps {
  isDarkMode?: boolean;
  branches: ProductWorkspaceBranchStock[];
  unit: string;
  submitting: boolean;
  onDistribute: (payload: { branch_id: number; quantity: number; notes: string }) => Promise<void>;
}

const ProductDistributionPanel: React.FC<ProductDistributionPanelProps> = ({
  branches,
  unit,
  submitting,
  onDistribute,
  isDarkMode = true,
}) => {
  const fieldId = useId();
  const tone = workspaceStyles(isDarkMode);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [quantity, setQuantity] = useState<number>(0);
  const [notes, setNotes] = useState('');

  const mainStore = useMemo(
    () => branches.find((branch) => branch.is_main_warehouse) || null,
    [branches]
  );

  const destinationBranches = useMemo(
    () => branches.filter((branch) => !branch.is_main_warehouse),
    [branches]
  );

  useEffect(() => {
    if (destinationBranches.length === 0) {
      setBranchId('');
      return;
    }
    setBranchId(destinationBranches[0].branch_id);
  }, [destinationBranches]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!branchId || quantity <= 0) return;

    await onDistribute({
      branch_id: Number(branchId),
      quantity: Number(quantity),
      notes: notes.trim(),
    });

    setQuantity(0);
    setNotes('');
  };

  return (
    <form onSubmit={handleSubmit} aria-label="إرسال شحنة إلى فرع" className="space-y-3">
      <p className={`text-xs leading-5 ${tone.muted}`}>سيتم خصم الكمية الآن، ولن تظهر داخل الفرع إلا بعد تأكيد الاستلام في Mini.</p>
      <p className={`text-xs ${tone.muted}`}>المتاح في المخزن الرئيسي: {mainStore ? <span className="font-bold tabular-nums">{mainStore.stock_quantity} {unit}</span> : 'غير محدد'}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-branch`} className={`text-xs font-bold ${tone.muted}`}>الفرع</label>
          <select id={`${fieldId}-branch`} value={branchId} onChange={(event) => setBranchId(Number(event.target.value))} className={tone.field}>
            {destinationBranches.map((branch) => <option key={branch.branch_id} value={branch.branch_id}>{branch.branch_name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-quantity`} className={`text-xs font-bold ${tone.muted}`}>الكمية</label>
          <input id={`${fieldId}-quantity`} type="number" min="1" max={mainStore?.stock_quantity || 1} step="1" value={quantity || ''} onChange={(event) => setQuantity(Number(event.target.value))} placeholder={`مثال: 20 ${unit}`} className={tone.field} />
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-notes`} className={`text-xs font-bold ${tone.muted}`}>ملاحظة</label>
        <textarea id={`${fieldId}-notes`} value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="سبب الشحنة أو أي ملاحظة للفرع" className={`${tone.field} resize-y`} />
      </div>
      <button type="submit" disabled={submitting || !branchId || quantity <= 0 || !mainStore || quantity > mainStore.stock_quantity} className={`${tone.button} disabled:cursor-not-allowed disabled:opacity-50`}>
        {submitting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ArrowLeftRight size={15} aria-hidden="true" />} إرسال الشحنة
      </button>
    </form>
  );
};

export default ProductDistributionPanel;
