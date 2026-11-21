
import React from 'react';
import { AlertCircle, ChevronLeft } from 'lucide-react';
import { Alert } from '../types';

interface AlertsSectionProps {
  alerts: Alert[];
  isDarkMode: boolean;
}

const AlertsSection: React.FC<AlertsSectionProps> = ({ alerts, isDarkMode }) => {
  return (
    <div className={`rounded-xl p-5 sm:p-8 border theme-transition ${
      isDarkMode ? 'bg-[#181818] luxury-shadow border-white/5' : 'bg-white luxury-shadow-light border-black/5'
    }`}>
      <div className="flex justify-between items-center mb-6 sm:mb-8">
        <h2 className={`text-base sm:text-lg font-bold flex items-center gap-2 ${isDarkMode ? 'text-[#F5F5F5]' : 'text-[#121212]'}`}>
          نظام التنبيهات الذكي
        </h2>
        <span className={`text-[8px] sm:text-[10px] uppercase tracking-widest font-bold opacity-40 ${isDarkMode ? 'text-[#9E9E9E]' : 'text-gray-400'}`}>تحديث تلقائي</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {alerts.map((alert) => (
          <div 
            key={alert.id} 
            className="group relative"
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 p-1.5 rounded-full flex-shrink-0 ${alert.type === 'critical' ? 'bg-[#E53935]/20 text-[#E53935] animate-breathing-red shadow-[0_0_8px_rgba(229,57,53,0.3)]' : 'bg-[#E6D690]/20 text-[#E6D690]'}`}>
                <AlertCircle size={14} />
              </div>
              <div className="flex-1">
                <h4 className={`text-[11px] sm:text-xs font-bold mb-1 uppercase tracking-tight ${alert.type === 'critical' ? 'text-[#E53935]' : 'text-[#E6D690]'}`}>
                  {alert.title}
                </h4>
                <p className={`text-[9px] sm:text-[10px] leading-relaxed line-clamp-2 opacity-80 font-bold ${isDarkMode ? 'text-[#9E9E9E]' : 'text-[#6E6E6E]'}`}>
                  {alert.description}
                </p>
                <div className="mt-2 sm:mt-3 flex items-center gap-2 lg:opacity-0 group-hover:opacity-100 transition-all cursor-pointer transform translate-x-2 group-hover:translate-x-0">
                  <span className={`text-[8px] sm:text-[9px] uppercase tracking-wider font-bold ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>مراجعة التفاصيل</span>
                  <ChevronLeft size={10} className="text-[#E53935]" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AlertsSection;
