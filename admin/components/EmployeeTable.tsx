
import React, { useState } from 'react';
import { ChevronLeft, MapPin, ArrowLeftRight, User, MoreVertical, Edit, Trash2, UserX, UserCheck } from 'lucide-react';
import { Employee, ROLE_LABELS } from '../types';

interface EmployeeTableProps {
  employees: Employee[];
  isDarkMode: boolean;
  onViewDetails: (employee: Employee) => void;
  onTransfer?: (employee: Employee) => void;
  onEdit?: (employee: Employee) => void;
  onDelete?: (employee: Employee) => void;
  onToggleStatus?: (employee: Employee) => void;
}

const EmployeeTable: React.FC<EmployeeTableProps> = ({ employees, isDarkMode, onViewDetails, onTransfer, onEdit, onDelete, onToggleStatus }) => {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const toggleMenu = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setOpenMenuId(openMenuId === id ? null : id);
  };

  return (
    <div className="space-y-4">
      {/* Click outside to close menu */}
      {openMenuId && <div className="fixed inset-0 z-[50]" onClick={() => setOpenMenuId(null)}></div>}

      {/* Desktop/Tablet Table View */}
      <div className={`hidden md:block rounded-[2.5rem] border overflow-hidden theme-transition ${isDarkMode ? 'bg-[#121212] luxury-shadow border-white/5' : 'bg-white luxury-shadow-light border-black/5'
        }`}>
        <div className="overflow-x-auto">
          <table className="w-full text-right min-w-[700px]">
            <thead>
              <tr className={isDarkMode ? 'bg-white/[0.02]' : 'bg-gray-50'}>
                <th className="px-10 py-5 text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-transparent">الموظف</th>
                <th className="px-10 py-5 text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-transparent">الوظيفة</th>
                <th className="px-10 py-5 text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-transparent">الفرع</th>
                <th className="px-10 py-5 text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-transparent">الحالة</th>
                <th className="px-10 py-5 text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-transparent text-center">الإجراء</th>
              </tr>
            </thead>
            <tbody className={`divide-y theme-transition ${isDarkMode ? 'divide-white/5' : 'divide-black/5'}`}>
              {employees.map((emp) => (
                <tr
                  key={emp.id}
                  className="hover:bg-[#E53935]/[0.02] transition-colors group cursor-pointer"
                  onClick={() => onViewDetails(emp)}
                >
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-4">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-lg"
                        style={{ backgroundColor: emp.avatarColor || '#E53935' }}
                      >
                        {emp.name.charAt(0)}
                      </div>
                      <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'} ${emp.is_deleted ? 'line-through opacity-50' : ''}`}>{emp.name}</p>
                    </div>
                  </td>
                  <td className="px-10 py-6">
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border ${isDarkMode ? 'bg-white/5 border-white/5 text-gray-400' : 'bg-gray-50 border-black/5 text-gray-600'
                      }`}>
                      {ROLE_LABELS[emp.role]}
                    </span>
                  </td>
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold opacity-60">
                      <MapPin size={12} className="text-[#E53935]" />
                      {emp.branch}
                    </div>
                  </td>
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${emp.status === 'نشط' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                      <span className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {emp.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-10 py-6 text-center">
                    <div className="flex items-center justify-center gap-2 relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); onTransfer?.(emp); }}
                        className={`p-2.5 rounded-xl transition-all border ${isDarkMode ? 'bg-white/5 border-white/5 text-gray-500 hover:text-[#E6D690]' : 'bg-gray-50 border-black/5 text-gray-400 hover:text-[#E53935]'}`}
                        title="نقل الفرع"
                      >
                        <ArrowLeftRight size={16} />
                      </button>

                      <div className="relative">
                        <button
                          onClick={(e) => toggleMenu(e, emp.id)}
                          className={`p-2.5 rounded-xl transition-all border ${isDarkMode ? 'bg-white/5 border-white/5 text-gray-500 hover:text-white' : 'bg-gray-100 border-black/5 text-gray-500 hover:text-black'}`}
                        >
                          <MoreVertical size={16} />
                        </button>

                        {openMenuId === emp.id && (
                          <div className={`absolute top-full left-0 mt-2 w-48 rounded-xl shadow-xl border overflow-hidden z-[100] ${isDarkMode ? 'bg-[#1A1A1A] border-white/10' : 'bg-white border-gray-100'}`}>
                            {onEdit && (
                              <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); onEdit(emp); }} className={`w-full text-right px-4 py-3 text-[10px] font-bold flex items-center gap-3 hover:bg-white/5 border-b ${isDarkMode ? 'text-gray-300 border-white/5' : 'text-gray-700 border-gray-100'}`}>
                                <Edit size={14} /> تعديل
                              </button>
                            )}
                            {onToggleStatus && (
                              <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); onToggleStatus(emp); }} className={`w-full text-right px-4 py-3 text-[10px] font-bold flex items-center gap-3 hover:bg-white/5 border-b ${isDarkMode ? 'text-gray-300 border-white/5' : 'text-gray-700 border-gray-100'}`}>
                                {emp.status === 'نشط' ? <UserX size={14} className="text-orange-500" /> : <UserCheck size={14} className="text-green-500" />}
                                {emp.status === 'نشط' ? 'إيقاف' : 'تنشيط'}
                              </button>
                            )}
                            {onDelete && (
                              <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); onDelete(emp); }} className={`w-full text-right px-4 py-3 text-[10px] font-bold flex items-center gap-3 hover:bg-red-500/10 text-red-500 ${isDarkMode ? 'border-white/5' : 'border-gray-100'}`}>
                                <Trash2 size={14} /> حذف
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <button
                        className={`p-2.5 rounded-xl transition-all ${isDarkMode ? 'bg-white/5 text-gray-500 group-hover:text-white' : 'bg-gray-50 text-gray-400 group-hover:text-gray-900'}`}
                      >
                        <ChevronLeft size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card-Based View */}
      <div className="md:hidden space-y-4">
        {employees.map((emp) => (
          <div
            key={emp.id}
            onClick={() => onViewDetails(emp)}
            className={`p-5 rounded-[2rem] border theme-transition active:scale-[0.98] ${isDarkMode ? 'bg-[#121212] border-white/5' : 'bg-white border-black/5 shadow-sm'
              }`}
          >
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm"
                  style={{ backgroundColor: emp.avatarColor || '#E53935' }}
                >
                  {emp.name.charAt(0)}
                </div>
                <div>
                  <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'} ${emp.is_deleted ? 'line-through opacity-50' : ''}`}>{emp.name}</p>
                  <p className="text-[10px] font-bold text-[#E53935] uppercase tracking-widest">{ROLE_LABELS[emp.role]}</p>
                </div>
              </div>
              <div className={`px-2 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest border ${emp.status === 'نشط' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'
                }`}>
                {emp.status}
              </div>
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-white/5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold opacity-60">
                <MapPin size={10} className="text-[#E53935]" />
                {emp.branch}
              </div>
              <div className="flex gap-2 relative">
                <button
                  onClick={(e) => { e.stopPropagation(); onTransfer?.(emp); }}
                  className={`p-2 rounded-lg border ${isDarkMode ? 'bg-white/5 border-white/5 text-gray-400' : 'bg-gray-50 border-black/5 text-gray-500'}`}
                >
                  <ArrowLeftRight size={14} />
                </button>

                <div className="relative">
                  <button
                    onClick={(e) => toggleMenu(e, emp.id)}
                    className={`p-2 rounded-lg border ${isDarkMode ? 'bg-white/5 border-white/5 text-gray-400 hover:text-white' : 'bg-gray-100 border-black/5 text-gray-500 hover:text-black'}`}
                  >
                    <MoreVertical size={14} />
                  </button>

                  {openMenuId === emp.id && (
                    <div className={`absolute bottom-full left-0 mb-2 w-48 rounded-xl shadow-xl border overflow-hidden z-[100] ${isDarkMode ? 'bg-[#1A1A1A] border-white/10' : 'bg-white border-gray-100'}`}>
                      {onEdit && (
                        <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); onEdit(emp); }} className={`w-full text-right px-4 py-3 text-[10px] font-bold flex items-center gap-3 hover:bg-white/5 border-b ${isDarkMode ? 'text-gray-300 border-white/5' : 'text-gray-700 border-gray-100'}`}>
                          <Edit size={14} /> تعديل
                        </button>
                      )}
                      {onToggleStatus && (
                        <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); onToggleStatus(emp); }} className={`w-full text-right px-4 py-3 text-[10px] font-bold flex items-center gap-3 hover:bg-white/5 border-b ${isDarkMode ? 'text-gray-300 border-white/5' : 'text-gray-700 border-gray-100'}`}>
                          {emp.status === 'نشط' ? <UserX size={14} className="text-orange-500" /> : <UserCheck size={14} className="text-green-500" />}
                          {emp.status === 'نشط' ? 'إيقاف' : 'تنشيط'}
                        </button>
                      )}
                      {onDelete && (
                        <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); onDelete(emp); }} className={`w-full text-right px-4 py-3 text-[10px] font-bold flex items-center gap-3 hover:bg-red-500/10 text-red-500 ${isDarkMode ? 'border-white/5' : 'border-gray-100'}`}>
                          <Trash2 size={14} /> حذف
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <button className={`p-2 rounded-lg ${isDarkMode ? 'bg-white/5 text-gray-400' : 'bg-gray-50 text-gray-500'}`}>
                  <ChevronLeft size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
export default EmployeeTable;
