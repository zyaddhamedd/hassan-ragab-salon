import React, { useState } from 'react';
import { formatDateTime } from '../src/utils/dateFormatter';
import { MapPin, Power, Search, X, Loader2 } from 'lucide-react';
import { Cashier, StaffMember } from '../App';
import { BACKEND_URL } from '../src/api/client';

interface AttendanceScreenProps {
  staff: StaffMember[];
  onToggleAttendance: (id: number) => Promise<void>;
  cashier: Cashier | null;
}

const AttendanceScreen: React.FC<AttendanceScreenProps> = ({ staff, onToggleAttendance, cashier }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const handleToggle = async (emp: StaffMember) => {
    if (togglingId === emp.id) return;
    setTogglingId(emp.id);
    try {
      await onToggleAttendance(emp.id);
    } catch (error) {
      console.error('Failed to toggle attendance:', error);
    } finally {
      setTogglingId(null);
    }
  };

  // Filter by search
  const filtered = staff.filter(e => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return e.name.toLowerCase().includes(q) || (e.phone && e.phone.includes(q));
  });

  const barbers = filtered.filter(e => e.role === 'حلاق');
  const assistants = filtered.filter(e => e.role === 'مساعد');

  return (
    <div
      className="mini-screen transition-colors duration-500 font-['Cairo'] bg-[#121212] text-[#F5F5F5]"
      dir="rtl"
    >
      {/* Header */}
      <header className="mini-page-header min-h-[6rem] flex flex-wrap items-center justify-between gap-4 border-b sticky top-0 backdrop-blur-xl z-50 bg-[#121212]/90 border-white/5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="w-1.5 h-8 rounded-full shadow-[0_0_10px_#E6D690] bg-[#E6D690]" />
          <div className="flex min-w-0 flex-col">
            <h1 className="text-3xl font-black">الحضور والانصراف</h1>
            <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold text-[#E6D690]">
              <MapPin size={10} />
              <span>
                {cashier?.branch_name || 'فرع غير محدد'} –{' '}
                {formatDateTime(new Date())}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="mini-scroll-y mini-page-body custom-scrollbar w-full max-w-none mx-auto space-y-12 lg:space-y-16 pb-20">
        {/* Search */}
        <div className="relative mx-auto w-full max-w-sm group">
          <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none">
            <Search size={14} className="text-[#E6D690]/30 group-focus-within:text-[#E6D690] transition-colors" />
          </div>
          <input
            type="text"
            placeholder="البحث بالاسم أو الهاتف..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#1E1E1E]/80 backdrop-blur-xl border border-white/5 rounded-full py-2.5 pr-10 pl-10 text-xs text-white placeholder-white/20 outline-none transition-all duration-500 focus:border-[#E6D690]/40 focus:shadow-[0_0_30px_rgba(230,214,144,0.08)] group-hover:border-white/10"
            dir="rtl"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 left-0 flex items-center pl-4 text-white/20 hover:text-[#E6D690] transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Barbers */}
        <section className="space-y-8">
          <div className="flex items-center gap-3">
            <div className="w-1 h-5 rounded-full bg-[#E6D690]" />
            <h2 className="text-xl font-black">طاقم الحلاقين</h2>
            <span className="text-xs text-[#E6D690]/50 font-bold">
              ({barbers.filter(b => b.isPresent).length}/{barbers.length} حاضر)
            </span>
          </div>
          {barbers.length === 0 ? (
            <p className="text-sm text-white/30 font-bold py-8 text-center">لا يوجد حلاقين مسجلين في هذا الفرع</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {barbers.map(emp => (
                <StaffCard
                  key={emp.id}
                  emp={emp}
                  isToggling={togglingId === emp.id}
                  onToggle={() => handleToggle(emp)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Assistants */}
        <section className="space-y-8">
          <div className="flex items-center gap-3">
            <div className="w-1 h-5 rounded-full bg-[#E6D690]" />
            <h2 className="text-xl font-black">طاقم المساعدين</h2>
            <span className="text-xs text-[#E6D690]/50 font-bold">
              ({assistants.filter(a => a.isPresent).length}/{assistants.length} حاضر)
            </span>
          </div>
          {assistants.length === 0 ? (
            <p className="text-sm text-white/30 font-bold py-8 text-center">لا يوجد مساعدين مسجلين في هذا الفرع</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {assistants.map(emp => (
                <StaffCard
                  key={emp.id}
                  emp={emp}
                  isToggling={togglingId === emp.id}
                  onToggle={() => handleToggle(emp)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

const StaffCard: React.FC<{
  emp: StaffMember;
  isToggling: boolean;
  onToggle: () => void;
}> = ({ emp, isToggling, onToggle }) => {
  const isPresent = emp.isPresent;

  const avatarSrc = emp.avatar && emp.avatar.length > 1
    ? (emp.avatar.startsWith('http') ? emp.avatar : `${BACKEND_URL}/uploads/${emp.avatar.replace(/\\/g, '/')}`)
    : null;

  return (
    <div
      className={`group relative flex h-full flex-col items-center gap-6 overflow-hidden rounded-[2.5rem] border border-white/[0.03] p-6 transition-all duration-[0.4s] ease-[cubic-bezier(.22,1,.36,1)] hover:-translate-y-[8px] hover:scale-[1.02] lg:p-8 ${isPresent
        ? 'bg-gradient-to-br from-[#08120E] to-[#050807] hover:shadow-[0_40px_80px_-15px_rgba(16,185,129,0.3)] hover:border-emerald-500/20'
        : 'bg-gradient-to-br from-[#1A0D0D] to-[#0F0808] hover:shadow-[0_40px_80px_-15px_rgba(239,68,68,0.3)] hover:border-red-500/20'
        }`}
    >
      {/* Status Bar */}
      <div className={`absolute top-0 left-0 w-1.5 h-full transition-all duration-500 ${isPresent ? 'bg-emerald-500 shadow-[0_0_20px_#10b981]' : 'bg-red-500 shadow-[0_0_20px_#ef4444]'}`} />

      <div className="flex flex-col items-center gap-5 relative z-10">
        {/* Avatar */}
        <div className={`w-20 h-20 rounded-full flex items-center justify-center text-2xl font-black border transition-all duration-700 relative overflow-hidden ${isPresent
          ? 'bg-[#0A1A12] border-emerald-500/40 text-emerald-500 shadow-[0_0_40px_rgba(16,185,129,0.25)]'
          : 'bg-[#1A0A0A] border-red-500/40 text-red-500 shadow-[0_0_40px_rgba(239,68,68,0.25)]'
          }`}>
          {avatarSrc ? (
            <img src={avatarSrc} alt={emp.name} className="w-full h-full object-cover rounded-full" />
          ) : (
            emp.name[0]
          )}
        </div>

        <div className="text-center min-w-0">
          <h3 className="text-lg font-black leading-tight text-white/90 transition-all duration-300 group-hover:text-white lg:text-xl">{emp.name}</h3>
          <p className="text-[9px] font-bold opacity-30 uppercase tracking-[0.3em] mt-2 text-[#BDBDBD]">
            {emp.role}
          </p>
        </div>
      </div>

      {/* Status Badge */}
      <div className="flex items-center gap-3 py-2 px-6 rounded-2xl bg-white/[0.03] border border-white/[0.05] relative z-10">
        <div className={`w-1.5 h-1.5 rounded-full ${isPresent ? 'bg-emerald-500' : 'bg-red-500'}`} />
        <span className={`text-[9px] font-black uppercase tracking-[0.25em] ${isPresent ? 'text-emerald-500' : 'text-red-500'}`}>
          {isPresent ? 'حاضر الآن' : 'غائب'}
        </span>
      </div>

      {/* Toggle Button */}
      <button
        onClick={onToggle}
        disabled={isToggling}
        className={`relative z-10 flex w-full items-center justify-center gap-3 overflow-hidden rounded-[1.4rem] border border-white/5 py-4 text-sm font-black shadow-xl transition-all duration-300 active:scale-95 disabled:opacity-50 lg:py-5 ${isPresent
          ? 'bg-gradient-to-br from-red-600 to-red-800 text-white shadow-red-900/30 hover:scale-[1.04]'
          : 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-emerald-900/30 hover:scale-[1.04]'
          }`}
      >
        {isToggling ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <Power size={18} />
        )}
        <span>{isPresent ? 'تسجيل انصراف' : 'تسجيل حضور'}</span>
      </button>
    </div>
  );
};

export default AttendanceScreen;
