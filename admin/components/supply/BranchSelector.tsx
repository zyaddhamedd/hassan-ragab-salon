import React from 'react';
import { Building2, CheckCircle2 } from 'lucide-react';
import { Branch } from '../../types';

interface BranchSelectorProps {
  branches: Branch[];
  selectedBranchId: number | null;
  onSelect: (branchId: number) => void;
  disabled?: boolean;
}

const BranchSelector: React.FC<BranchSelectorProps> = ({ branches, selectedBranchId, onSelect, disabled }) => {
  return (
    <div className="space-y-3 text-right">
      <div>
        <h3 className="text-sm font-black text-white">إلى أي فرع؟</h3>
        <p className="mt-1 text-[11px] font-bold text-white/45">اختر الفرع الذي ستنتقل إليه الشحنة مباشرة من المستودع الرئيسي.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {branches.map((branch) => {
          const isSelected = selectedBranchId === branch.id;
          return (
            <button
              key={branch.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(branch.id)}
              className={`group rounded-[1.35rem] border p-4 text-right transition-all ${
                isSelected
                  ? 'border-[#E6D690] bg-[#E6D690]/8 shadow-[0_0_0_1px_rgba(230,214,144,0.22)]'
                  : disabled
                    ? 'border-white/5 bg-white/[0.005] opacity-40 cursor-not-allowed'
                    : 'border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
                    isSelected ? 'border-[#E6D690]/30 bg-[#E6D690]/10 text-[#E6D690]' : 'border-white/10 bg-white/[0.03] text-white/55'
                  }`}>
                    <Building2 size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-white">{branch.name}</p>
                    <p className="mt-1 text-[11px] font-bold text-white/40">{branch.city || 'Cairo'}</p>
                  </div>
                </div>

                <div className={`mt-1 shrink-0 ${isSelected ? 'text-[#E6D690]' : 'text-white/20 group-hover:text-white/35'}`}>
                  <CheckCircle2 size={16} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default BranchSelector;
