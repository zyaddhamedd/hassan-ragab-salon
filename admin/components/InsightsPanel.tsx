
import React from 'react';
import { Insight } from '../types';
import { ShieldCheck } from 'lucide-react';

interface InsightsPanelProps {
  insights: Insight[];
  isDarkMode: boolean;
}

const InsightsPanel: React.FC<InsightsPanelProps> = ({ insights, isDarkMode }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
      {insights.map((insight, idx) => (
        <div key={idx} className={`p-5 sm:p-6 rounded-xl border transition-all group theme-transition ${
          isDarkMode ? 'bg-[#181818] border-white/5 luxury-shadow hover:border-[#E6D690]/20' : 'bg-white border-black/5 luxury-shadow-light hover:border-[#E6D690]/40'
        }`}>
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div className={`p-2 rounded-lg text-[#E6D690] group-hover:scale-110 transition-transform ${isDarkMode ? 'bg-white/5' : 'bg-black/5'}`}>
              {/* Fix: Explicitly cast to React.ReactElement<any> so that cloneElement accepts 'size' and other props */}
              {React.cloneElement(insight.icon as React.ReactElement<any>, { size: 18 })}
            </div>
            <ShieldCheck size={14} className={`${isDarkMode ? 'text-[#9E9E9E]' : 'text-gray-400'} opacity-20`} />
          </div>
          <p className={`text-[9px] sm:text-[10px] uppercase tracking-widest mb-1 ${isDarkMode ? 'text-[#9E9E9E]' : 'text-[#6E6E6E]'}`}>{insight.label}</p>
          <p className={`font-bold text-base sm:text-lg leading-tight ${isDarkMode ? 'text-[#F5F5F5]' : 'text-[#121212]'}`}>
            {insight.value}
          </p>
        </div>
      ))}
    </div>
  );
};

export default InsightsPanel;
