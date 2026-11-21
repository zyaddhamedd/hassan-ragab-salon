
import React from 'react';
import { KPIData } from '../types';

interface KPICardProps {
  data: KPIData;
  index?: number;
  isDarkMode: boolean;
}

const KPICard: React.FC<KPICardProps> = ({ data, index = 0, isDarkMode }) => {
  const isRevenue = data.label.includes('إيرادات') || data.label.includes('أرباح');
  const staggerClass = index < 4 ? `entry-stagger-${index + 1}` : 'animate-fade-in-up';
  
  return (
    <div className={`p-5 sm:p-8 rounded-xl relative overflow-hidden group transition-all duration-500 border theme-transition ${
      isDarkMode 
        ? 'bg-[#161616] luxury-shadow border-white/5 hover:border-[#E53935]/30' 
        : 'bg-white luxury-shadow-light border-black/5 hover:border-[#E53935]/30'
    } ${staggerClass}`}>
      <div className="flex justify-between items-center mb-6 sm:mb-8">
        <h3 className={`text-[9px] sm:text-[10px] font-bold tracking-[0.1em] sm:tracking-[0.2em] uppercase opacity-70 ${isDarkMode ? 'text-[#B0B0B0]' : 'text-gray-500'}`}>{data.label}</h3>
        {data.change && (
          <span className={`text-[8px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded border ${data.isPositive ? 'text-[#E6D690] border-[#E6D690]/20 bg-[#E6D690]/5' : 'text-[#E53935] border-[#E53935]/20 bg-[#E53935]/5'}`}>
            {data.change}
          </span>
        )}
      </div>
      <div className="flex flex-col relative">
        <span className={`text-2xl sm:text-3xl lg:text-4xl font-light tracking-tight transition-colors duration-500 value-reveal ${
          isRevenue ? 'text-[#E53935]' : (isDarkMode ? 'text-white' : 'text-[#121212]')
        }`}>
          {data.value}
        </span>
        <div className={`w-8 h-1 mt-3 sm:mt-4 transition-all duration-700 ${isRevenue ? 'bg-[#E53935] w-12 sm:w-16 group-hover:w-20 sm:group-hover:w-24' : 'bg-[#E6D690] group-hover:w-16'}`}></div>
        <p className={`text-[7px] sm:text-[8px] mt-4 sm:mt-5 uppercase tracking-[0.2em] sm:tracking-[0.3em] font-bold opacity-30 ${isDarkMode ? 'text-[#7A7A7A]' : 'text-gray-400'}`}>تزامن حيّ فائق الدقة</p>
      </div>
      
      {/* Background glow for revenue cards */}
      {isRevenue && (
        <div className={`absolute -bottom-10 -left-10 w-24 h-24 sm:w-32 sm:h-32 rounded-full blur-3xl group-hover:opacity-20 opacity-10 transition-colors ${
          isDarkMode ? 'bg-[#E53935]' : 'bg-[#E53935]/40'
        }`}></div>
      )}
    </div>
  );
};

export default KPICard;
