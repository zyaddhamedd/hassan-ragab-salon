
import React from 'react';
import { InventoryItem } from '../types';

interface InventoryTableProps {
  items: InventoryItem[];
  isDarkMode: boolean;
}

const InventoryTable: React.FC<InventoryTableProps> = ({ items, isDarkMode }) => {
  const getStatusStyle = (status: InventoryItem['status']) => {
    switch (status) {
      case 'جيد': return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'منخفض': return 'bg-[#E6D690]/10 text-[#E6D690] border-[#E6D690]/20';
      case 'حرج': return 'bg-[#E53935]/10 text-[#E53935] border-[#E53935]/20';
      default: return 'bg-white/5 text-white/40 border-white/10';
    }
  };

  return (
    <div className="space-y-4">
      {/* Desktop View */}
      <div className={`hidden md:block rounded-xl border theme-transition ${
        isDarkMode ? 'bg-[#181818] luxury-shadow border-white/5' : 'bg-white luxury-shadow-light border-black/5'
      }`}>
        <div className={`p-5 sm:p-8 border-b flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
          <h2 className={`text-base sm:text-xl font-bold ${isDarkMode ? 'text-[#F5F5F5]' : 'text-[#121212]'}`}>جرد المخزون العام</h2>
          <div className="flex gap-4">
             <span className={`text-[9px] sm:text-[10px] uppercase tracking-widest font-bold opacity-50 ${isDarkMode ? 'text-[#9E9E9E]' : 'text-gray-500'}`}>إجمالي الأصناف: {items.length}</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right min-w-[700px]">
            <thead>
              <tr className={isDarkMode ? 'bg-white/5' : 'bg-gray-50'}>
                <th className="px-6 sm:px-8 py-4 text-[9px] sm:text-[10px] font-bold text-[#E6D690] uppercase tracking-widest">اسم الصنف</th>
                <th className="px-6 sm:px-8 py-4 text-[9px] sm:text-[10px] font-bold text-[#E6D690] uppercase tracking-widest">التصنيف</th>
                <th className="px-6 sm:px-8 py-4 text-[9px] sm:text-[10px] font-bold text-[#E6D690] uppercase tracking-widest">الكمية المتوفرة</th>
                <th className="px-6 sm:px-8 py-4 text-[9px] sm:text-[10px] font-bold text-[#E6D690] uppercase tracking-widest">الحد الأدنى</th>
                <th className="px-6 sm:px-8 py-4 text-[9px] sm:text-[10px] font-bold text-[#E6D690] uppercase tracking-widest">الحالة</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? 'divide-white/5' : 'divide-black/5'}`}>
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-red-500/[0.03] transition-colors group">
                  <td className="px-6 sm:px-8 py-4 sm:py-6">
                    <span className={`text-xs sm:text-sm font-bold group-hover:text-[#E6D690] transition-colors ${isDarkMode ? 'text-[#F5F5F5]' : 'text-[#121212]'}`}>{item.name}</span>
                  </td>
                  <td className="px-6 sm:px-8 py-4 sm:py-6">
                    <span className={`text-[10px] sm:text-xs ${isDarkMode ? 'text-[#9E9E9E]' : 'text-[#6E6E6E]'}`}>{item.category}</span>
                  </td>
                  <td className="px-6 sm:px-8 py-4 sm:py-6">
                    <span className={`text-xs sm:text-sm font-bold ${item.status === 'حرج' ? 'text-[#E53935]' : (isDarkMode ? 'text-[#F5F5F5]' : 'text-[#121212]')}`}>
                      {item.quantity} قطعة
                    </span>
                  </td>
                  <td className="px-6 sm:px-8 py-4 sm:py-6">
                    <span className={`text-[10px] sm:text-xs opacity-50 ${isDarkMode ? 'text-[#9E9E9E]' : 'text-gray-500'}`}>{item.minLimit}</span>
                  </td>
                  <td className="px-6 sm:px-8 py-4 sm:py-6">
                    <span className={`text-[8px] sm:text-[10px] font-bold px-2.5 sm:px-3 py-1 rounded-full border ${getStatusStyle(item.status)}`}>
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile View */}
      <div className="md:hidden space-y-4">
        {items.map((item) => (
          <div 
            key={item.id}
            className={`p-6 rounded-2xl border theme-transition ${
              isDarkMode ? 'bg-[#181818] border-white/5' : 'bg-white border-black/5 shadow-sm'
            }`}
          >
            <div className="flex justify-between items-start mb-4">
              <div>
                <h4 className={`text-sm font-bold mb-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{item.name}</h4>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{item.category}</span>
              </div>
              <span className={`text-[9px] font-bold px-3 py-1 rounded-full border ${getStatusStyle(item.status)}`}>
                {item.status}
              </span>
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-white/5">
              <div>
                <span className="text-[8px] font-bold text-gray-500 uppercase tracking-widest block mb-1">الكمية المتوفرة</span>
                <span className={`text-sm font-bold ${item.status === 'حرج' ? 'text-[#E53935]' : (isDarkMode ? 'text-white' : 'text-gray-900')}`}>
                  {item.quantity} قطعة
                </span>
              </div>
              <div className="text-left">
                <span className="text-[8px] font-bold text-gray-500 uppercase tracking-widest block mb-1">الحد الأدنى</span>
                <span className={`text-sm font-bold opacity-60 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{item.minLimit}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default InventoryTable;
