import React from 'react';
import { Plus, ArrowLeftRight } from 'lucide-react';

interface QuickActionsProps {
  isDarkMode?: boolean;
  onReceiveShipment: () => void;
  onNewTransfer: () => void;
}

const QuickActions: React.FC<QuickActionsProps> = ({
  isDarkMode = true,
  onReceiveShipment,
  onNewTransfer
}) => {
  return (
    <div className="flex items-center gap-3 w-full md:w-auto justify-end">
      {/* Action 1: Receive Shipment */}
      <button
        onClick={onReceiveShipment}
        className="flex-1 md:flex-none bg-[#E53935] hover:bg-[#F44336] text-white px-5 py-2.5 rounded-2xl text-xs font-semibold shadow-[0_4px_12px_rgba(229,57,53,0.2)] hover:shadow-[0_6px_20px_rgba(229,57,53,0.3)] transition-all duration-300 active:scale-95 flex items-center justify-center gap-2"
      >
        <Plus size={14} />
        <span>تسجيل توريد</span>
      </button>

      {/* Action 2: New Transfer */}
      <button
        onClick={onNewTransfer}
        className={`flex-1 md:flex-none border px-5 py-2.5 rounded-2xl text-xs font-semibold transition-colors flex items-center justify-center gap-2 ${isDarkMode ? 'border-white/10 bg-white/[0.02] text-white hover:bg-white/10' : 'border-black/10 bg-white text-gray-900 hover:bg-gray-50'}`}
      >
        <ArrowLeftRight size={14} />
        <span>طلب تحويل</span>
      </button>
    </div>
  );
};

export default QuickActions;
