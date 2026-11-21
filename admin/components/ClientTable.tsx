
import React from 'react';
import { Client } from '../types';
import { ChevronLeft, Star, MapPin, Phone } from 'lucide-react';

interface ClientTableProps {
  clients: Client[];
  isDarkMode: boolean;
  selectedBranch: string;
  onViewDetails: (client: Client) => void;
  onToggleStar?: (client: Client) => void;
}

const ClientTable: React.FC<ClientTableProps> = ({ clients, isDarkMode, selectedBranch, onViewDetails, onToggleStar }) => {
  return (
    <div className="space-y-4">
      {/* Desktop View */}
      <div className={`hidden md:block rounded-[2.5rem] border theme-transition ${
        isDarkMode ? 'bg-[#121212] luxury-shadow border-white/5' : 'bg-white luxury-shadow-light border-black/5'
      }`}>
        <div className="overflow-x-auto">
          <table className="w-full text-right min-w-[800px]">
            <thead>
              <tr className={isDarkMode ? 'bg-white/[0.02]' : 'bg-gray-50'}>
                <th className="px-10 py-5 text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-transparent">العميل</th>
                <th className="px-10 py-5 text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-transparent text-center">التميز</th>
                <th className="px-10 py-5 text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-transparent text-center">الزيارات</th>
                <th className="px-10 py-5 text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-transparent">إجمالي الإنفاق</th>
                <th className="px-10 py-5 text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-transparent">الفرع الأساسي</th>
                <th className="px-10 py-5 text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-transparent text-center">إجراء</th>
              </tr>
            </thead>
            <tbody className={`divide-y theme-transition ${isDarkMode ? 'divide-white/5' : 'divide-black/5'}`}>
              {clients.map((client) => {
                const isStarredInContext = selectedBranch === 'All' 
                  ? client.starredBranches.length > 0 
                  : client.starredBranches.includes(selectedBranch);

                return (
                  <tr 
                    key={client.id} 
                    onClick={() => onViewDetails(client)}
                    className="hover:bg-red-500/[0.03] transition-colors group cursor-pointer"
                  >
                    <td className="px-10 py-6">
                      <div className="flex items-center gap-4">
                        {client.photoUrl ? (
                          <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/10 shadow-lg group-hover:scale-105 transition-transform">
                             <img src={client.photoUrl} alt={client.name} className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <div 
                            className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-lg group-hover:scale-105 transition-transform"
                            style={{ backgroundColor: client.avatarColor || '#E53935' }}
                          >
                            {client.name.charAt(0)}
                          </div>
                        )}
                        <div className="flex flex-col">
                           <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{client.name}</span>
                           <span className="text-[10px] font-bold opacity-40 tracking-widest">{client.phone}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-10 py-6 text-center">
                       <button 
                         onClick={(e) => { e.stopPropagation(); onToggleStar?.(client); }}
                         className={`p-2 transition-all transform hover:scale-125 active:scale-90 ${
                           isStarredInContext 
                            ? 'text-[#E6D690]' 
                            : 'text-gray-500 opacity-20 hover:opacity-100'
                         }`}
                       >
                          <Star 
                            size={20} 
                            fill={isStarredInContext ? 'currentColor' : 'none'} 
                            strokeWidth={isStarredInContext ? 0 : 2}
                          />
                       </button>
                    </td>
                    <td className="px-10 py-6 text-center">
                       <span className={`text-[11px] font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{client.visits} زيارة</span>
                    </td>
                    <td className="px-10 py-6">
                      <span className="text-[11px] font-bold text-[#E53935]">{client.totalSpend.toLocaleString()} ج.م</span>
                    </td>
                    <td className="px-10 py-6">
                      <div className="flex items-center gap-1.5 opacity-60">
                        <MapPin size={12} className="text-[#E6D690]" />
                        <span className="text-[10px] font-bold">{client.primaryBranch}</span>
                      </div>
                    </td>
                    <td className="px-10 py-6 text-center">
                      <div className="flex items-center justify-center">
                        <button className={`p-2.5 rounded-xl transition-all ${isDarkMode ? 'bg-white/5 text-gray-500 group-hover:text-white' : 'bg-gray-50 text-gray-400 group-hover:text-gray-900'}`}>
                          <ChevronLeft size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile View */}
      <div className="md:hidden space-y-4">
        {clients.map((client) => {
          const isStarredInContext = selectedBranch === 'All' 
            ? client.starredBranches.length > 0 
            : client.starredBranches.includes(selectedBranch);

          return (
            <div 
              key={client.id}
              onClick={() => onViewDetails(client)}
              className={`p-5 rounded-[2rem] border theme-transition active:scale-[0.98] ${
                isDarkMode ? 'bg-[#121212] border-white/5' : 'bg-white border-black/5 shadow-sm'
              }`}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div 
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm"
                    style={{ backgroundColor: client.avatarColor || '#E53935' }}
                  >
                    {client.name.charAt(0)}
                  </div>
                  <div>
                    <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{client.name}</p>
                    <div className="flex items-center gap-1 opacity-40">
                      <Phone size={10} className="text-[#E53935]" />
                      <span className="text-[9px] font-bold tracking-widest">{client.phone}</span>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); onToggleStar?.(client); }}
                  className={`p-2 ${isStarredInContext ? 'text-[#E6D690]' : 'text-gray-500 opacity-20'}`}
                >
                  <Star size={20} fill={isStarredInContext ? 'currentColor' : 'none'} strokeWidth={isStarredInContext ? 0 : 2} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4 py-4 border-y border-white/5">
                <div>
                  <span className="text-[8px] font-bold text-gray-500 uppercase tracking-widest block mb-1">إجمالي الإنفاق</span>
                  <span className="text-xs font-bold text-[#E53935]">{client.totalSpend.toLocaleString()} ج.م</span>
                </div>
                <div className="text-left">
                  <span className="text-[8px] font-bold text-gray-500 uppercase tracking-widest block mb-1">الزيارات</span>
                  <span className={`text-xs font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{client.visits} زيارة</span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-4">
                <div className="flex items-center gap-1.5 opacity-60">
                  <MapPin size={10} className="text-[#E6D690]" />
                  <span className="text-[9px] font-bold">{client.primaryBranch}</span>
                </div>
                <ChevronLeft size={16} className="text-[#E53935]" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ClientTable;
