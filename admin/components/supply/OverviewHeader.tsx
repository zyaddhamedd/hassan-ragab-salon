import React from 'react';
import HeartbeatIndicator from './HeartbeatIndicator.tsx';

interface OverviewHeaderProps {
  hasAlerts: boolean;
}

const OverviewHeader: React.FC<OverviewHeaderProps> = ({ hasAlerts }) => {
  return (
    <div className="flex flex-row items-center justify-between pb-6 border-b border-white/[0.04] mb-8">
      {/* Title & Subtitle */}
      <div className="text-right">
        <h1 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">مركز الإمداد</h1>
        <p className="text-xs text-white/40 mt-1.5 font-medium">تابع المخزون والتحويلات بين الفروع بسهولة.</p>
      </div>

      {/* Heartbeat Status */}
      <div className="flex items-center">
        <HeartbeatIndicator status={hasAlerts ? 'alert' : 'normal'} />
      </div>
    </div>
  );
};

export default OverviewHeader;
