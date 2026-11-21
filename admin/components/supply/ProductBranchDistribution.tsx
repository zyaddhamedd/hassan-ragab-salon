import React, { useId } from 'react';
import { Store } from 'lucide-react';
import { ProductWorkspaceBranchStock } from '../../types';
import { workspaceFocus, workspaceStyles } from './productWorkspaceStyles';
import StockStatusBadge from './StockStatusBadge';

interface ProductBranchDistributionProps {
  branches: ProductWorkspaceBranchStock[];
  selectedBranchId: number | null;
  unit: string;
  onSelectBranch: (branchId: number | null) => void;
  isDarkMode?: boolean;
}

export default function ProductBranchDistribution({ branches, selectedBranchId, unit, onSelectBranch, isDarkMode = true }: ProductBranchDistributionProps) {
  const id = useId();
  const tone = workspaceStyles(isDarkMode);
  return (
    <section aria-labelledby={`${id}-title`} className={`${tone.panel} overflow-hidden`}>
      <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5 ${tone.divider}`}>
        <div><h2 id={`${id}-title`} className="text-sm font-black">توزيع المخزون على المواقع</h2><p className={`mt-1 text-xs ${tone.muted}`}>اختار موقعًا لعرض حركته المسجلة.</p></div>
        {selectedBranchId !== null && <button type="button" onClick={() => onSelectBranch(null)} className={tone.button}>إلغاء التصفية</button>}
      </div>
      {branches.length === 0 ? <p className={`px-4 py-6 text-sm ${tone.muted}`}>لا توجد مواقع مخزون مسجلة لهذا المنتج.</p> : <ul>
        {branches.map((branch) => {
          const active = selectedBranchId === branch.branch_id;
          const stockStatus = branch.stock_status || (branch.status === 'AVAILABLE' ? 'AVAILABLE' : branch.status === 'LOW' ? 'LOW_STOCK' : 'UNKNOWN');
          return <li key={branch.branch_id} className={`border-b last:border-b-0 ${tone.divider}`}>
            <button type="button" aria-pressed={active} aria-label={`عرض حركة ${branch.branch_name}`} aria-describedby={`${id}-${branch.branch_id}-quantity ${id}-${branch.branch_id}-status`} onClick={() => onSelectBranch(active ? null : branch.branch_id)} className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 text-right sm:grid-cols-[minmax(0,1fr)_auto_minmax(150px,auto)] sm:px-5 ${workspaceFocus} ${active ? 'bg-[#E53935]/10' : isDarkMode ? 'hover:bg-white/[0.03]' : 'hover:bg-gray-50'}`}>
              <span className="min-w-0"><span className="block break-words text-sm font-bold">{branch.branch_name}</span>{branch.is_main_warehouse && <span className={`mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${tone.warehouse}`}><Store size={12} aria-hidden="true" /> المخزن الرئيسي</span>}</span>
              <span id={`${id}-${branch.branch_id}-quantity`} className="text-left text-base font-black tabular-nums"><bdi>{branch.stock_quantity}</bdi> <span className={`text-xs font-normal ${tone.muted}`}>{unit}</span></span>
              <span id={`${id}-${branch.branch_id}-status`} className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-end"><StockStatusBadge status={stockStatus} isDarkMode={isDarkMode} /><span className={`text-[11px] ${tone.muted}`}>{branch.is_available ? 'متاح في العمليات' : 'مخفي تشغيليًا'}</span></span>
            </button>
          </li>;
        })}
      </ul>}
    </section>
  );
}
