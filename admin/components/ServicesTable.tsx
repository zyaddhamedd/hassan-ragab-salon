
import React from 'react';
import { Service } from '../types';
import { Edit2, Trash2 } from 'lucide-react';

interface ServicesTableProps {
  services: Service[];
  isDarkMode: boolean;
  onEdit: (service: Service) => void;
  onDelete: (id: string) => void;
}

const ServicesTable: React.FC<ServicesTableProps> = ({ services, isDarkMode, onEdit, onDelete }) => {
  return (
    <div className={`rounded-[2rem] border overflow-hidden theme-transition ${isDarkMode ? 'bg-[#181818] luxury-shadow border-white/5' : 'bg-white luxury-shadow-light border-black/5'
      }`}>
      <div className={`p-6 sm:p-10 border-b flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
        <div>
          <h2 className={`text-lg sm:text-xl font-bold ${isDarkMode ? 'text-[#F5F5F5]' : 'text-[#121212]'}`}>قائمة الخدمات الحالية</h2>
          <p className={`text-[10px] mt-1 font-bold uppercase tracking-widest opacity-40 ${isDarkMode ? 'text-[#9E9E9E]' : 'text-gray-500'}`}>
            الرقابة التشغيلية والتحكم بالسعر
          </p>
        </div>
        <div className={`px-4 py-2 rounded-full text-[10px] font-bold tracking-widest uppercase border ${isDarkMode ? 'bg-white/5 border-white/10 text-[#E6D690]' : 'bg-gray-50 border-gray-100 text-gray-600'
          }`}>
          إجمالي المنظومة: {services.length}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-right min-w-[700px]">
          <thead>
            <tr className={`theme-transition ${isDarkMode ? 'bg-white/2' : 'bg-gray-50'}`}>
              <th className="px-10 py-5 text-[10px] font-bold text-[#E6D690] uppercase tracking-[0.2em] border-b border-transparent">اسم الخدمة</th>
              <th className="px-10 py-5 text-[10px] font-bold text-[#E6D690] uppercase tracking-[0.2em] border-b border-transparent">سعر الخدمة</th>
              <th className="px-10 py-5 text-[10px] font-bold text-[#E6D690] uppercase tracking-[0.2em] border-b border-transparent">نسبة العمولة (%)</th>
              <th className="px-10 py-5 text-[10px] font-bold text-[#E6D690] uppercase tracking-[0.2em] border-b border-transparent text-center">إجراءات التحكم</th>
            </tr>
          </thead>
          <tbody className={`divide-y theme-transition ${isDarkMode ? 'divide-white/5' : 'divide-black/5'}`}>
            {services.map((service) => (
              <tr key={service.id} className="hover:bg-[#E53935]/[0.02] transition-colors group">
                <td className="px-10 py-7">
                  <div className="flex items-center gap-4">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#E6D690] shadow-[0_0_8px_#E6D690]"></div>
                    <span className={`text-sm font-bold group-hover:text-white transition-colors ${isDarkMode ? 'text-[#F5F5F5]' : 'text-[#121212]'}`}>{service.name}</span>
                  </div>
                </td>
                <td className="px-10 py-7">
                  <span className={`text-base font-medium tracking-tight ${isDarkMode ? 'text-[#F5F5F5]' : 'text-[#121212]'}`}>{service.price.toLocaleString()} ج.م</span>
                </td>
                <td className="px-10 py-7">
                  <span className={`text-sm font-bold ${isDarkMode ? 'text-[#9E9E9E]' : 'text-[#6E6E6E]'}`}>
                    {(service.barber_commission_percent !== null && service.barber_commission_percent !== undefined)
                      ? `${service.barber_commission_percent}%`
                      : '—'}
                  </span>
                </td>
                <td className="px-10 py-7">
                  <div className="flex items-center justify-center gap-4">
                    <button
                      onClick={() => onEdit(service)}
                      className={`p-3 rounded-xl transition-all border ${isDarkMode
                        ? 'border-white/5 bg-white/5 text-white/40 hover:text-white hover:border-[#E6D690]/40'
                        : 'border-black/5 bg-black/5 text-gray-400 hover:text-black hover:border-black/20'
                        }`}
                      title="تعديل الخدمة"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => onDelete(service.id)}
                      className={`p-3 rounded-xl transition-all border ${isDarkMode
                        ? 'border-white/5 bg-white/5 text-white/40 hover:text-[#E53935] hover:border-[#E53935]/40'
                        : 'border-black/5 bg-black/5 text-gray-400 hover:text-[#E53935] hover:border-[#E53935]/20'
                        }`}
                      title="حذف الخدمة"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ServicesTable;
