import React from 'react';
import { 
  AlertTriangle, 
  ArrowLeftRight, 
  DownloadCloud, 
  Scale, 
  ClipboardCheck 
} from 'lucide-react';

export interface CardData {
  id: string;
  type: 'low-stock' | 'pending-transfer' | 'pending-receive' | 'discrepancy' | 'count-reminder';
  title: string;
  subtext: string;
  primaryActionText: string;
  secondaryActionText: string;
  metadata?: any;
}

interface ActionCardProps {
  card: CardData;
  onPrimaryAction: (id: string) => void;
  onSecondaryAction: (id: string) => void;
}

const ActionCard: React.FC<ActionCardProps> = ({
  card,
  onPrimaryAction,
  onSecondaryAction
}) => {
  const getIcon = () => {
    const iconClass = "text-white opacity-85 shrink-0";
    switch (card.type) {
      case 'low-stock':
        return <AlertTriangle size={16} className="text-amber-500 shrink-0" />;
      case 'pending-transfer':
        return <ArrowLeftRight size={16} className="text-[#E6D690] shrink-0" />;
      case 'pending-receive':
        return <DownloadCloud size={16} className="text-emerald-500 shrink-0" />;
      case 'discrepancy':
        return <Scale size={16} className="text-[#E53935] shrink-0" />;
      case 'count-reminder':
        return <ClipboardCheck size={16} className="text-sky-500 shrink-0" />;
      default:
        return <AlertTriangle size={16} className={iconClass} />;
    }
  };

  return (
    <div 
      className="p-4 rounded-xl border border-white/5 bg-[#121316]/40 hover:bg-[#121316]/60 hover:border-white/10 hover:-translate-y-[1px] transition-all duration-200 flex flex-row items-center justify-between gap-4 w-full relative group overflow-hidden"
    >
      {/* Visual content (Right in RTL) */}
      <div className="flex items-center gap-3.5 relative z-10 w-full sm:w-auto text-right">
        <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5 flex items-center justify-center transition-transform group-hover:scale-105">
          {getIcon()}
        </div>
        <div className="flex flex-col gap-0.5 justify-center">
          <h4 className="text-xs font-bold text-white tracking-tight">
            {card.title}
          </h4>
          <p className="text-[11px] text-[#8E939E] font-medium leading-none">
            {card.subtext}
          </p>
        </div>
      </div>

      {/* Buttons (Left in RTL) */}
      <div className="flex items-center gap-3 relative z-10 w-full sm:w-auto justify-end sm:justify-start">
        {card.secondaryActionText && (
          <button
            onClick={() => onSecondaryAction(card.id)}
            className="text-[10px] font-bold text-[#8E939E] hover:text-white px-2 py-1.5 rounded transition-all duration-150"
          >
            {card.secondaryActionText}
          </button>
        )}
        <button
          onClick={() => onPrimaryAction(card.id)}
          className={`px-4 py-2 rounded-lg text-[10px] font-bold transition-all duration-150 active:scale-95 ${
            card.type === 'discrepancy'
              ? 'bg-[#E53935] hover:bg-[#FF3B30] text-white shadow-lg shadow-red-950/20'
              : card.type === 'pending-receive'
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/20'
              : 'border border-[#E6D690]/30 hover:border-[#E6D690] text-[#E6D690] hover:bg-[#E6D690]/5'
          }`}
        >
          {card.primaryActionText}
        </button>
      </div>
    </div>
  );
};

export default ActionCard;
