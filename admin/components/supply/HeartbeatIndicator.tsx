import React from 'react';

interface HeartbeatIndicatorProps {
  status: 'normal' | 'alert' | 'offline';
}

const HeartbeatIndicator: React.FC<HeartbeatIndicatorProps> = ({ status }) => {
  // Map status colors
  const statusConfig = {
    normal: {
      color: 'bg-emerald-500',
      label: 'متصل ومزامن',
      pulse: 'animate-pulse-subtle'
    },
    alert: {
      color: 'bg-amber-500',
      label: 'إجراءات مطلوبة',
      pulse: 'animate-pulse-subtle'
    },
    offline: {
      color: 'bg-rose-500',
      label: 'غير متصل بالخادم',
      pulse: ''
    }
  };

  const current = statusConfig[status] || statusConfig.normal;

  return (
    <div className="flex items-center gap-2 group cursor-default" title={current.label}>
      <span className="text-[11px] font-bold text-gray-500 opacity-60 transition-opacity group-hover:opacity-100 font-mono">
        {current.label}
      </span>
      <div className="relative flex items-center justify-center">
        <div className={`w-1.5 h-1.5 rounded-full ${current.color} ${current.pulse}`} />
        {status !== 'offline' && (
          <div className={`absolute inset-0 rounded-full animate-ping opacity-30 ${current.color}`} />
        )}
      </div>
      
      <style>{`
        @keyframes pulse-subtle {
          0% { opacity: 0.4; }
          50% { opacity: 0.8; }
          100% { opacity: 0.4; }
        }
        .animate-pulse-subtle {
          animation: pulse-subtle 5s linear infinite;
        }
      `}</style>
    </div>
  );
};

export default HeartbeatIndicator;
