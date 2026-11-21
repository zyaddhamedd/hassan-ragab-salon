
import React from 'react';
import { Service } from '../types';
import { MoreVertical, Edit2, Trash2, Copy } from 'lucide-react';

interface ServiceCardProps {
  service: Service;
  isDarkMode: boolean;
  onEdit: (service: Service) => void;
  onDelete: (id: string) => void;
}

const ServiceCard: React.FC<ServiceCardProps> = ({ service, isDarkMode, onEdit, onDelete }) => {
  const [showMenu, setShowMenu] = React.useState(false);

  return (
    <div className={`relative group p-6 rounded-[2rem] border theme-transition animate-fade-in-up ${isDarkMode
      ? 'bg-[#161616] border-white/5 hover:border-[#E6D690]/20 luxury-shadow'
      : 'bg-white border-black/5 hover:border-[#E6D690]/40 luxury-shadow-light'
      }`}>
      {/* Top Menu Trigger */}
      <div className="flex justify-end items-start mb-6">
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className={`p-2 rounded-xl transition-all ${isDarkMode ? 'hover:bg-white/5 text-gray-500' : 'hover:bg-black/5 text-gray-400'}`}
          >
            <MoreVertical size={18} />
          </button>

          {showMenu && (
            <>
              <div className="fixed inset-0 z-[70]" onClick={() => setShowMenu(false)}></div>
              <div className={`absolute left-0 top-10 w-40 rounded-2xl border z-[80] overflow-hidden theme-transition ${isDarkMode ? 'bg-[#1A1A1A] border-white/10 shadow-2xl' : 'bg-white border-black/10 shadow-xl'
                }`}>
                <button onClick={() => { onEdit(service); setShowMenu(false); }} className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-bold transition-all ${isDarkMode ? 'text-gray-300 hover:bg-white/5' : 'text-gray-600 hover:bg-black/5'}`}>
                  <Edit2 size={14} className="text-[#E6D690]" /> تعديل
                </button>
                <button onClick={() => setShowMenu(false)} className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-bold transition-all ${isDarkMode ? 'text-gray-300 hover:bg-white/5' : 'text-gray-600 hover:bg-black/5'}`}>
                  <Copy size={14} className="text-gray-500" /> تكرار
                </button>
                <div className={`h-[1px] w-full ${isDarkMode ? 'bg-white/5' : 'bg-black/5'}`}></div>
                <button onClick={() => { onDelete(service.id); setShowMenu(false); }} className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-bold transition-all text-[#E53935] ${isDarkMode ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}>
                  <Trash2 size={14} /> حذف الخدمة
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Info */}
      <div className="mb-6">
        <h3 className={`text-lg font-bold truncate mb-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{service.name}</h3>
        <p className={`text-[10px] font-bold opacity-40 uppercase tracking-widest ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {service.type || 'فردية'}
        </p>
      </div>

      {/* Pricing Section */}
      <div className={`flex items-end justify-between p-4 rounded-2xl ${isDarkMode ? 'bg-black/20' : 'bg-gray-50'}`}>
        <div>
          <p className={`text-[8px] font-bold uppercase tracking-widest mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>السعر النهائي</p>
          <span className={`text-xl font-bold tracking-tighter ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{service.price.toLocaleString()} <span className="text-[10px] font-normal opacity-50">ج.م</span></span>
        </div>
        <div className="text-left">
          <p className={`text-[8px] font-bold uppercase tracking-widest mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>العمولة</p>
          <span className="text-sm font-bold text-[#E6D690]">
            {(service.barber_commission_percent !== null && service.barber_commission_percent !== undefined)
              ? `${service.barber_commission_percent}%`
              : '—'}
          </span>
        </div>
      </div>

      {/* Simplified Action Bar */}
      <div className="mt-6 flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onEdit(service)}
          className={`text-[9px] font-bold uppercase tracking-widest transition-all ${isDarkMode ? 'text-[#E6D690] hover:text-white' : 'text-gray-600 hover:text-black'}`}
        >
          تعديل التفاصيل
        </button>
      </div>
    </div>
  );
};

export default ServiceCard;
