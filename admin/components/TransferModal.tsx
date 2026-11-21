
import React, { useState, useEffect } from 'react';
import { X, ArrowLeftRight, Calendar, MapPin, CheckCircle2, User } from 'lucide-react';
import { Employee, Branch } from '../types';
import adminApi from '../api/client';
import { getTodayISO } from '../utils/dateFormatter';

interface TransferModalProps {
  employee: Employee | null;
  allEmployees: Employee[];
  isDarkMode: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const TransferModal: React.FC<TransferModalProps> = ({ employee, allEmployees, isDarkMode, onClose, onConfirm }) => {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(employee?.id || '');
  const [newBranch, setNewBranch] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(getTodayISO());
  const [isSuccess, setIsSuccess] = useState(false);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const response = await adminApi.get('/branches');
        setBranches(response.data);
      } catch (err) {
        console.error("Failed to fetch branches:", err);
      }
    };
    fetchBranches();
  }, []);

  useEffect(() => {
    if (employee) {
      setSelectedEmployeeId(employee.id);
    }
  }, [employee]);

  const currentEmployee = allEmployees.find(e => e.id === selectedEmployeeId);

  const availableBranches = branches.filter(b => b.name !== currentEmployee?.branch);

  const handleConfirm = async () => {
    if (!selectedEmployeeId || !newBranch) return;

    setIsLoading(true);
    setError(null);
    try {
      await adminApi.post(`/employees/${selectedEmployeeId}/transfer`, {
        branch_id: newBranch
      });
      setIsSuccess(true);
      setTimeout(() => {
        onConfirm();
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.response?.data?.error || "حدث خطأ أثناء تنفيذ عملية النقل");
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="admin-overlay-shell z-[150]">
        <div className="absolute inset-0 bg-black/90 backdrop-blur-md"></div>
        <div className={`relative w-full max-w-sm p-12 rounded-[3rem] border text-center animate-scale-in ${isDarkMode ? 'bg-[#0F0F0F] border-white/10' : 'bg-white border-black/10 shadow-2xl'
          }`}>
          <div className="w-20 h-20 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={40} className="animate-bounce" />
          </div>
          <h3 className={`text-xl font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>تم النقل بنجاح</h3>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">تم تحديث سجلات التنقلات والنشاط</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-overlay-shell z-[140]" dir="rtl">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-md" onClick={onClose}></div>
      <div className={`admin-overlay-panel relative w-full max-w-lg rounded-[3rem] border animate-scale-in theme-transition ${isDarkMode ? 'bg-[#0F0F0F] border-white/10 shadow-2xl' : 'bg-white border-black/10 shadow-2xl'
        }`}>
        <div className={`p-8 border-b flex items-center justify-between ${isDarkMode ? 'bg-white/5 border-white/5' : 'bg-gray-50 border-black/5'}`}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/10 text-white/40 flex items-center justify-center">
              <ArrowLeftRight size={22} />
            </div>
            <div>
              <h3 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>نقل الموظف</h3>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-1">تعديل النطاق الجغرافي للعمل</p>
            </div>
          </div>
          <button onClick={onClose} className={`p-2 rounded-full transition-all ${isDarkMode ? 'hover:bg-white/5 text-gray-500' : 'hover:bg-black/5 text-gray-400'}`}>
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border-b border-red-500/20 px-8 py-3 text-red-500 text-[10px] font-bold text-center uppercase tracking-widest">
            {error}
          </div>
        )}

        <div className="p-10 space-y-8">
          {/* 1. Employee Selection (Mode dependent) */}
          {!employee ? (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest px-2">
                <User size={12} className="text-[#E6D690]" />
                اختيار الموظف
              </label>
              <select
                value={selectedEmployeeId}
                onChange={(e) => {
                  setSelectedEmployeeId(e.target.value);
                  setNewBranch(''); // Reset branch when employee changes
                }}
                className={`w-full px-5 py-4 rounded-2xl border text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#161616] border-white/5 text-white focus:border-[#E6D690]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E6D690]/40'
                  }`}
              >
                <option value="">حدد الموظف...</option>
                {allEmployees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name} ({emp.branch})</option>
                ))}
              </select>
            </div>
          ) : (
            <div className={`p-5 rounded-2xl border flex items-center gap-4 ${isDarkMode ? 'bg-white/5 border-white/5' : 'bg-gray-50 border-black/5'}`}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: employee.avatarColor }}>
                {employee.name.charAt(0)}
              </div>
              <div>
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block">الموظف المختار</span>
                <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{employee.name}</span>
              </div>
            </div>
          )}

          {/* 2. New Branch Selection */}
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest px-2">
              <MapPin size={12} className="text-[#E6D690]" />
              الفرع الجديد
            </label>
            <select
              disabled={!selectedEmployeeId}
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              className={`w-full px-5 py-4 rounded-2xl border text-sm font-bold outline-none transition-all ${!selectedEmployeeId ? 'opacity-30 cursor-not-allowed' : ''
                } ${isDarkMode ? 'bg-[#161616] border-white/5 text-white focus:border-[#E6D690]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E6D690]/40'
                }`}
            >
              <option value="">حدد الفرع الجديد...</option>
              {availableBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          {/* 3. Date Selection */}
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest px-2">
              <Calendar size={12} className="text-[#E53935]" />
              تاريخ النقل الفعلي
            </label>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className={`w-full px-5 py-4 rounded-2xl border text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#161616] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                }`}
            />
          </div>

          <div className="pt-6 flex gap-4">
            <button onClick={onClose} className={`flex-1 py-4 rounded-2xl text-[11px] font-bold border uppercase tracking-widest ${isDarkMode ? 'border-white/10 text-white hover:bg-white/5' : 'border-black/10 text-gray-900 hover:bg-black/5'}`}>إلغاء</button>
            <button
              onClick={handleConfirm}
              disabled={!newBranch || !selectedEmployeeId || isLoading}
              className={`flex-[2] py-4 rounded-2xl text-[11px] font-bold uppercase tracking-widest shadow-xl transition-all ${!newBranch || !selectedEmployeeId || isLoading
                ? 'bg-gray-500/20 text-gray-500 cursor-not-allowed'
                : 'bg-[#E53935] hover:bg-[#FF3B30] text-white shadow-red-900/20 active:scale-95'
                }`}
            >
              {isLoading ? 'جاري التنفيذ...' : 'تأكيد النقل التشغيلي'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransferModal;
