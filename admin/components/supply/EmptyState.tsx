import React from 'react';
import { ShieldCheck } from 'lucide-react';

interface EmptyStateProps {
  onStartAudit: () => void;
  onViewHistory: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ onStartAudit, onViewHistory }) => {
  return (
    <div className="p-8 rounded-2xl border border-white/5 bg-[#121316]/20 text-center flex flex-col items-center justify-center min-h-[260px] relative overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-emerald-500/5 blur-3xl rounded-full pointer-events-none" />

      {/* Verified Shield Icon */}
      <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 mb-4">
        <ShieldCheck size={22} />
      </div>

      <h3 className="text-sm font-bold text-white mb-1">كل شيء مستقر.</h3>
      <p className="text-[11px] text-gray-500 font-medium mb-6">
        لا توجد إجراءات مطلوبة الآن.
      </p>

      {/* Operations shortcuts */}
      <div className="flex flex-row gap-3 relative z-10">
        <button
          onClick={onStartAudit}
          className="px-4 py-2 rounded-lg border border-white/10 hover:border-white/20 bg-white/[0.01] hover:bg-white/[0.04] text-[10px] font-bold text-gray-300 hover:text-white transition-all active:scale-95"
        >
          جرد استثنائي
        </button>
        <button
          onClick={onViewHistory}
          className="px-4 py-2 rounded-lg border border-white/10 hover:border-white/20 bg-white/[0.01] hover:bg-white/[0.04] text-[10px] font-bold text-gray-300 hover:text-white transition-all active:scale-95"
        >
          عرض سجل الحركة
        </button>
      </div>
    </div>
  );
};

export default EmptyState;
