
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Clock,
  Calendar as CalendarIcon,
  User,
  Phone,
  Scissors,
  ChevronLeft,
  MapPin,
  Plus,
  X,
  Landmark,
  Tag,
  CheckCircle2,
  Search,
  ChevronRight,
  UserPlus,
  Lock,
  AlertCircle
} from 'lucide-react';
import {
  Appointment,
  AppointmentCreateResult,
  AppointmentDepositPaymentMethod,
  AppointmentDepositTransactionReceipt,
  AppointmentFormData,
  StaffMember,
  Cashier,
} from '../App';
import AppointmentDepositReceipt from './AppointmentDepositReceipt';
import { getTodayISO, formatDate } from '../src/utils/dateFormatter';
import { apiClient } from '../src/api/client';

interface AppointmentsScreenProps {
  appointments: Appointment[];
  staff: StaffMember[];
  cashier: Cashier | null;
  onAddAppointment: (data: AppointmentFormData) => Promise<AppointmentCreateResult | null>;
  onDeleteAppointment: (id: string) => void;
  onReadyForCashier: (id: number) => void;
  handoffPendingId: number | null;
  handoffFeedback: {id: number; message: string} | null;
}

interface CustomerSearchResult {
  id: number;
  full_name: string;
  phone: string;
  deposit_balance?: number;
}

export const AppointmentCard = React.memo(({ app, onDelete, onReady, pendingId, feedback }: {
  app: Appointment; onDelete: (id: string) => void; onReady: (id: number) => void;
  pendingId: number | null; feedback: {id: number; message: string} | null;
}) => {
  return (
    <div className="group relative flex flex-wrap items-center gap-6 overflow-hidden rounded-[2.5rem] border bg-[#1E1E1E] p-6 transition-all duration-500 hover:border-[#E6D690]/40 border-white/5">
      {/* Enhanced Time & Date Section */}
      <div className="flex flex-col items-center justify-center min-w-[110px] py-5 px-4 rounded-3xl border transition-all duration-300 bg-gradient-to-br from-[#1A1A1A] to-[#121212] border-white/10 group-hover:border-[#E6D690]/30 group-hover:shadow-[0_0_20px_rgba(230,214,144,0.1)]">
        {/* Time Display */}
        <div className="flex flex-col items-center mb-3">
          <Clock size={18} className="text-[#E6D690] mb-2 opacity-60" />
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-black text-white tracking-tight">{app.time.split(' ')[0]}</span>
            <span className="text-xs font-bold opacity-50 text-[#E6D690]">{app.time.split(' ')[1]}</span>
          </div>
        </div>

        {/* Date Display */}
        <div className="w-full pt-3 border-t border-white/10">
          <div className="text-center">
            <span className="text-[10px] font-bold opacity-40 text-[#BDBDBD] block mb-1">التاريخ</span>
            <span className="text-xs font-black text-[#E6D690]">{app.date}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 min-w-0">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-black transition-colors text-white group-hover:text-[#E6D690]">{app.customerName}</h3>
            <div className="flex items-center gap-2 text-xs mt-1 opacity-60 text-[#BDBDBD]">
              <Phone size={12} />
              <span className="tracking-widest">{app.phone}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="px-4 py-1.5 bg-[#E53935]/10 text-[#E53935] text-[10px] font-black rounded-full border border-[#E53935]/20 shadow-[0_0_10px_rgba(229,57,53,0.1)]">
              {app.status}
            </span>
            {app.deposit && (
              <span className="flex items-center gap-1.5 px-3 py-1 bg-[#E6D690]/10 text-[#E6D690] text-[9px] font-black rounded-lg border border-[#E6D690]/20">
                <Tag size={10} />
                عربون: {app.deposit} ج.م
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-white/5 pt-4 sm:grid-cols-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-white/5">
              <Scissors size={14} className="text-[#E6D690]" />
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] opacity-40 uppercase font-bold text-[#BDBDBD]">الخدمة</span>
              <span className="text-xs font-bold truncate max-w-[120px] text-white">{app.service}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-white/5">
              <User size={14} className="text-[#E6D690]" />
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] opacity-40 uppercase font-bold text-[#BDBDBD]">الحلاق</span>
              <span className="text-xs font-bold text-white">{app.barberName}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2 max-w-[12rem]">
        <button type="button" disabled={pendingId !== null || app.rawStatus !== 'scheduled'}
          onClick={() => onReady(Number(app.id))}
          className="min-h-11 rounded-xl border border-[#E6D690]/30 bg-[#E6D690]/10 px-4 py-2 text-xs font-bold text-[#E6D690] transition-colors hover:bg-[#E6D690]/20 disabled:opacity-50">
          {pendingId === Number(app.id) ? 'جارٍ التجهيز…' : 'جاهز للكاشير'}
        </button>
        {feedback?.id === Number(app.id) && <p role="status" className="text-xs text-amber-200">{feedback.message}</p>}
        {app.rawStatus !== 'scheduled' && <p className="text-xs text-white/50">الحجز غير متاح للكاشير</p>}
      </div>
      {/* Delete Button */}
      <button
        onClick={() => {
          if (confirm(`هل أنت متأكد من حذف موعد ${app.customerName}؟`)) {
            onDelete(app.id);
          }
        }}
        className="absolute top-4 left-4 p-2 rounded-xl bg-[#E53935]/10 text-[#E53935] hover:bg-[#E53935]/20 transition-colors opacity-0 group-hover:opacity-100"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18"></path>
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
        </svg>
      </button>
    </div>
  );
});

const SectionHeader: React.FC<{ title: string; count: number }> = ({ title, count }) => {
  return (
    <div className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-[#E6D690]/10 text-[#E6D690]">
          <CalendarIcon size={18} />
        </div>
        <h2 className="text-xl font-black">{title}</h2>
      </div>
      <div className="px-4 py-1 rounded-xl border bg-white/5 border-white/5">
        <span className="text-[10px] font-bold opacity-40 uppercase ml-2 text-[#BDBDBD]">عدد الحجوزات</span>
        <span className="text-sm font-black text-[#E6D690]">{count}</span>
      </div>
    </div>
  );
};

const TIME_SLOTS = [
  "10:00 ص", "10:30 ص", "11:00 ص", "11:30 ص", "12:00 م", "12:30 م",
  "01:00 م", "01:30 م", "02:00 م", "02:30 م", "03:00 م", "03:30 م",
  "04:00 م", "04:30 م", "05:00 م", "05:30 م", "06:00 م", "06:30 م",
  "07:00 م", "07:30 م", "08:00 م", "08:30 م", "09:00 م", "09:30 م",
  "10:00 م", "10:30 م", "11:00 م", "11:30 م"
];

const ARABIC_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
];

const AppointmentsScreen: React.FC<AppointmentsScreenProps> = React.memo(({ appointments, staff, cashier, onAddAppointment, onDeleteAppointment, onReadyForCashier, handoffPendingId, handoffFeedback }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isTimePickerOpen, setIsTimePickerOpen] = useState(false);
  const [depositReceipt, setDepositReceipt] = useState<AppointmentDepositTransactionReceipt | null>(null);

  // Calendar Logic State
  const [currentCalendarDate, setCurrentCalendarDate] = useState(new Date());

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null);
  const [customerResults, setCustomerResults] = useState<CustomerSearchResult[]>([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchRequestSeqRef = useRef(0);
  const customerContainerRef = useRef<HTMLDivElement>(null);
  const [newBooking, setNewBooking] = useState({
    customerName: '',
    phone: '',
    service: '',
    barberName: '',
    time: '',
    date: formatDate(new Date(), { day: 'numeric', month: 'long', year: 'numeric' }, 'ar-EG'),
    deposit: 0,
    depositPaymentMethod: undefined as AppointmentDepositPaymentMethod | undefined,
  });

  const todayApps = useMemo(() => appointments.filter(a => a.date === 'اليوم' || a.date.includes('اليوم')), [appointments]);
  const tomorrowApps = useMemo(() => appointments.filter(a => a.date === 'الغد' || a.date.includes('الغد')), [appointments]);
  const futureApps = useMemo(() => appointments.filter(a => !a.date.includes('اليوم') && !a.date.includes('الغد')), [appointments]);

  const barbers = useMemo(() => staff.filter(s => s.role === 'حلاق'), [staff]);

  // Calendar Helpers
  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const calendarDays = useMemo(() => {
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    const totalDays = daysInMonth(year, month);
    const startDay = firstDayOfMonth(year, month); // 0 (Sun) to 6 (Sat)

    const days = [];
    // Padding for RTL calendar (if needed based on grid flow, but standard grid works)
    // We'll just push nulls for empty slots before first day
    for (let i = 0; i < startDay; i++) {
      days.push(null);
    }
    for (let d = 1; d <= totalDays; d++) {
      days.push(new Date(year, month, d));
    }
    return days;
  }, [currentCalendarDate]);

  const changeMonth = (offset: number) => {
    setCurrentCalendarDate(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + offset);
      return d;
    });
  };

  const isDateDisabled = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  const isSlotLocked = (slotTime: string, targetDateStr?: string) => {
    if (!slotTime) return false;
    const dateToCheck = targetDateStr || newBooking.date;
    const targetISO = /^\d{4}-\d{2}-\d{2}$/.test(dateToCheck) ? dateToCheck : getTodayISO();
    const todayISO = getTodayISO();

    const norm = (t: string) => t.trim().replace(/\s+/g, ' ');
    const slotNorm = norm(slotTime);

    let slot24 = '';
    const parts = slotTime.split(' ');
    if (parts.length >= 2) {
      const [h, m] = parts[0].split(':');
      let hour = parseInt(h, 10);
      const period = parts[1];
      if (period === 'م' && hour !== 12) hour += 12;
      else if (period === 'ص' && hour === 12) hour = 0;
      slot24 = `${hour.toString().padStart(2, '0')}:${m}`;
    }

    return appointments.some(app => {
      if (app.rawStatus === 'cancelled') return false;
      if (!app.deposit || app.deposit <= 0) return false;

      const appISO = app.rawDate || (app.date === 'اليوم' ? todayISO : null);
      if (appISO) {
        if (appISO !== targetISO) return false;
      } else {
        if (app.date !== dateToCheck && !(app.date === 'اليوم' && targetISO === todayISO)) {
          return false;
        }
      }

      if (app.time && norm(app.time) === slotNorm) return true;
      if (app.rawTime && slot24 && app.rawTime.substring(0, 5) === slot24) return true;

      return false;
    });
  };

  const isSelectedTimeLocked = newBooking.time ? isSlotLocked(newBooking.time, newBooking.date) : false;

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const customerName = newBooking.customerName.trim();
    const phone = newBooking.phone.trim();
    if (!customerName || !phone || !newBooking.time) {
      alert('يرجى ملء اسم العميل ورقم الهاتف وتحديد وقت الحجز.');
      return;
    }
    if (isSlotLocked(newBooking.time, newBooking.date)) {
      alert('هذا الموعد محجوز ومؤكد بعربون. يرجى اختيار موعد آخر.');
      return;
    }
    if (newBooking.deposit > 0 && !newBooking.depositPaymentMethod) {
      alert('اختر وسيلة تحصيل العربون قبل تأكيد الحجز.');
      return;
    }

    const result = await onAddAppointment({
      ...newBooking,
      customerName,
      phone,
      deposit: newBooking.deposit > 0 ? newBooking.deposit : undefined,
      depositPaymentMethod: newBooking.deposit > 0 ? newBooking.depositPaymentMethod : undefined,
    });
    if (!result) return;
    setIsModalOpen(false);
    resetForm();
    if (result.depositTransaction) {
      setDepositReceipt(result.depositTransaction);
    }
  };

  const resetForm = () => {
    setNewBooking({
      customerName: '',
      phone: '',
      service: '',
      barberName: '',
      time: '',
      date: formatDate(new Date(), { day: 'numeric', month: 'long', year: 'numeric' }, 'ar-EG'),
      deposit: 0,
      depositPaymentMethod: undefined,
    });
    setSelectedCustomer(null);
    setCustomerResults([]);
    setCustomerSearchLoading(false);
    setCustomerSearchError('');
    setIsDropdownOpen(false);
    setHighlightedIndex(-1);
  };

  const handleSelectCustomer = (customer: CustomerSearchResult) => {
    setSelectedCustomer(customer);
    setNewBooking(prev => ({
      ...prev,
      customerName: customer.full_name,
      phone: customer.phone,
    }));
    setCustomerResults([]);
    setIsDropdownOpen(false);
    setHighlightedIndex(-1);
    setCustomerSearchError('');
  };

  const handleCustomerNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (selectedCustomer && val !== selectedCustomer.full_name) {
      setSelectedCustomer(null);
    }
    setNewBooking(prev => ({ ...prev, customerName: val }));
    setHighlightedIndex(-1);
  };

  const handleCustomerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isDropdownOpen || customerResults.length === 0) {
      if (e.key === 'ArrowDown' && customerResults.length > 0) {
        setIsDropdownOpen(true);
        setHighlightedIndex(0);
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev < customerResults.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev > 0 ? prev - 1 : customerResults.length - 1));
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && highlightedIndex < customerResults.length) {
        e.preventDefault();
        handleSelectCustomer(customerResults[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsDropdownOpen(false);
    }
  };

  // Close customer dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (customerContainerRef.current && !customerContainerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (newBooking.deposit <= 0 && newBooking.depositPaymentMethod) {
      setNewBooking(prev => ({ ...prev, depositPaymentMethod: undefined }));
    }
  }, [newBooking.deposit, newBooking.depositPaymentMethod]);

  // Unified customer search effect
  useEffect(() => {
    if (!isModalOpen) {
      setCustomerResults([]);
      setCustomerSearchLoading(false);
      setCustomerSearchError('');
      setIsDropdownOpen(false);
      return;
    }

    if (selectedCustomer) {
      setCustomerResults([]);
      setCustomerSearchLoading(false);
      setIsDropdownOpen(false);
      return;
    }

    const query = newBooking.customerName.trim();
    if (query.length < 2) {
      searchRequestSeqRef.current += 1;
      setCustomerResults([]);
      setCustomerSearchLoading(false);
      setCustomerSearchError('');
      setIsDropdownOpen(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      const requestSeq = ++searchRequestSeqRef.current;
      setCustomerSearchLoading(true);
      setCustomerSearchError('');

      try {
        const response = await apiClient.get(`/customers/search?q=${encodeURIComponent(query)}`);
        if (requestSeq !== searchRequestSeqRef.current) return;
        const list = Array.isArray(response) ? response : [];
        setCustomerResults(list);
        setIsDropdownOpen(true);
      } catch (error) {
        if (requestSeq !== searchRequestSeqRef.current) return;
        console.error('Appointment customer search failed:', error);
        setCustomerResults([]);
        setCustomerSearchError('تعذر تحميل نتائج العملاء الآن.');
      } finally {
        if (requestSeq !== searchRequestSeqRef.current) return;
        setCustomerSearchLoading(false);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [newBooking.customerName, selectedCustomer, isModalOpen]);

  return (
    <div className="mini-screen transition-colors duration-500 font-['Cairo'] bg-[#121212] text-[#F5F5F5]" dir="rtl">
      <header className="mini-page-header sticky top-0 z-50 flex min-h-[6rem] flex-wrap items-center justify-between gap-4 border-b border-white/5 bg-[#121212]/90 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-4">
          <div className="w-1.5 h-8 rounded-full shadow-[0_0_10px_#E6D690] bg-[#E6D690]"></div>
          <div className="flex flex-col">
            <h1 className="text-3xl font-black">المواعيد القادمة</h1>
            <div className="flex items-center gap-1 text-[10px] font-bold text-[#E6D690]">
              <MapPin size={10} />
              <span>{cashier?.branch_name || 'فرع غير محدد'}</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-6 py-2.5 bg-[#E6D690] text-[#121212] rounded-xl text-xs font-black hover:bg-[#ffed9e] transition-all active:scale-95 shadow-lg shadow-[#E6D690]/10"
        >
          <Plus size={16} />
          حجز يدوي
        </button>
      </header>

      <div className="mini-scroll-y mini-page-body custom-scrollbar w-full max-w-none mx-auto space-y-14 lg:space-y-20">
        <section>
          <SectionHeader title="مواعيد اليوم" count={todayApps.length} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {todayApps.length > 0 ? todayApps.map((app) => (
              <AppointmentCard key={app.id} app={app} onDelete={onDeleteAppointment} onReady={onReadyForCashier} pendingId={handoffPendingId} feedback={handoffFeedback} />
            )) : <p className="text-xs opacity-20 col-span-full text-center py-10">لا توجد مواعيد لليوم</p>}
          </div>
        </section>

        <section>
          <SectionHeader title="مواعيد الغد" count={tomorrowApps.length} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {tomorrowApps.length > 0 ? tomorrowApps.map((app) => (
              <AppointmentCard key={app.id} app={app} onDelete={onDeleteAppointment} onReady={onReadyForCashier} pendingId={handoffPendingId} feedback={handoffFeedback} />
            )) : <p className="text-xs opacity-20 col-span-full text-center py-10">لا توجد مواعيد للغد</p>}
          </div>
        </section>

        {futureApps.length > 0 && (
          <section className="pb-20">
            <SectionHeader title="الأيام القادمة" count={futureApps.length} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {futureApps.map((app) => (
                <AppointmentCard key={app.id} app={app} onDelete={onDeleteAppointment} onReady={onReadyForCashier} pendingId={handoffPendingId} feedback={handoffFeedback} />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Manual Booking Modal */}
      {isModalOpen && (
        <div className="mini-modal-overlay animate-in fade-in duration-300">
          <div className="mini-modal-panel-static bg-[#1E1E1E] border border-white/10 rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col p-6 lg:p-7 relative shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
              <h2 className="text-xl font-black flex items-center gap-2.5 text-white">
                <Plus size={20} className="text-[#E6D690]" />
                إضافة حجز يدوي جديد
              </h2>
              <button
                type="button"
                onClick={() => { setIsModalOpen(false); resetForm(); }}
                className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors"
                title="إغلاق"
              >
                <X size={18} />
              </button>
            </div>

            {/* Form Content */}
            <form onSubmit={handleBookingSubmit} className="mini-scroll-y custom-scrollbar overflow-y-auto pt-5 pb-1 space-y-4">
              {/* Row 1: Unified Customer Name & Phone */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Unified Customer Name & Search */}
                <div className="space-y-1.5 relative" ref={customerContainerRef}>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[#E6D690] flex items-center gap-1.5">
                      <User size={13} />
                      اسم العميل
                    </label>
                    {selectedCustomer ? (
                      <span className="text-[10px] font-bold text-[#E6D690] bg-[#E6D690]/15 border border-[#E6D690]/30 px-2 py-0.5 rounded-md flex items-center gap-1">
                        <CheckCircle2 size={10} />
                        عميل مسجل
                        {selectedCustomer.deposit_balance ? (
                          <span className="text-white/70 mr-1">({selectedCustomer.deposit_balance} ج.م)</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-[10px] text-white/35">ابحث أو اكتب عميل جديد</span>
                    )}
                  </div>

                  <div className="relative">
                    <input
                      required
                      type="text"
                      placeholder="ابحث بالاسم أو الهاتف، أو اكتب اسماً جديداً..."
                      value={newBooking.customerName}
                      onChange={handleCustomerNameChange}
                      onFocus={() => {
                        if (customerResults.length > 0 && !selectedCustomer) {
                          setIsDropdownOpen(true);
                        }
                      }}
                      onKeyDown={handleCustomerKeyDown}
                      className="w-full bg-[#121212] border border-white/10 rounded-xl py-2.5 pr-9 pl-8 outline-none focus:border-[#E6D690]/50 transition-all text-xs font-bold text-white placeholder:text-white/30"
                    />
                    <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />

                    {customerSearchLoading && (
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border border-white/20 border-t-[#E6D690] rounded-full animate-spin" />
                    )}

                    {!customerSearchLoading && newBooking.customerName && (
                      <button
                        type="button"
                        onClick={() => {
                          setNewBooking(prev => ({ ...prev, customerName: '', phone: selectedCustomer ? '' : prev.phone }));
                          setSelectedCustomer(null);
                          setCustomerResults([]);
                          setIsDropdownOpen(false);
                        }}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white p-0.5"
                        title="مسح"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  {/* Dropdown Results */}
                  {isDropdownOpen && newBooking.customerName.trim().length >= 2 && !selectedCustomer && (
                    <div className="absolute top-full right-0 left-0 mt-1 z-50 rounded-xl border border-white/10 bg-[#161616] shadow-2xl shadow-black/90 overflow-hidden max-h-48 overflow-y-auto custom-scrollbar">
                      {customerResults.length > 0 ? (
                        customerResults.map((cust, idx) => (
                          <button
                            key={cust.id}
                            type="button"
                            onClick={() => handleSelectCustomer(cust)}
                            onMouseEnter={() => setHighlightedIndex(idx)}
                            className={`w-full px-3.5 py-2.5 flex items-center justify-between text-right border-b border-white/5 last:border-b-0 transition-colors ${
                              highlightedIndex === idx ? 'bg-white/10' : 'hover:bg-white/5'
                            }`}
                          >
                            <div className="flex flex-col items-start min-w-0">
                              <span className="text-xs font-bold text-white truncate">{cust.full_name}</span>
                              {cust.deposit_balance ? (
                                <span className="text-[10px] text-[#E6D690] font-semibold">
                                  رصيد عربون: {cust.deposit_balance.toLocaleString('en-US')} ج.م
                                </span>
                              ) : null}
                            </div>
                            <span className="text-[11px] font-mono font-medium text-white/50 tracking-wider mr-2 shrink-0">
                              {cust.phone}
                            </span>
                          </button>
                        ))
                      ) : !customerSearchLoading ? (
                        <div className="px-3 py-2.5 text-[11px] text-white/40 flex items-center justify-between">
                          <span>{customerSearchError || 'لا يوجد عميل مسجل بهذا الاسم'}</span>
                          <span className="text-[#E6D690]/80 font-bold">سيُسجل كعميل جديد</span>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Customer Phone */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[#E6D690] flex items-center gap-1.5">
                      <Phone size={13} />
                      رقم الهاتف
                    </label>
                    {selectedCustomer && (
                      <span className="text-[10px] text-white/40">مسترجع تلقائياً من الملف</span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      required
                      type="tel"
                      placeholder="01012345678"
                      value={newBooking.phone}
                      onChange={e => setNewBooking({ ...newBooking, phone: e.target.value })}
                      className="w-full bg-[#121212] border border-white/10 rounded-xl py-2.5 pr-9 pl-3.5 outline-none focus:border-[#E6D690]/50 transition-all text-xs font-mono font-bold text-white placeholder:text-white/30 text-left"
                      dir="ltr"
                    />
                    <Phone size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Row 2: Date & Time */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Date Picker Button */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#E6D690] flex items-center gap-1.5">
                    <CalendarIcon size={13} />
                    تاريخ الموعد
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsDatePickerOpen(true)}
                    className="w-full bg-[#121212] border border-white/10 rounded-xl py-2.5 px-3.5 flex items-center justify-between hover:border-[#E6D690]/30 transition-all outline-none"
                  >
                    <div className="flex items-center gap-2">
                      <CalendarIcon size={15} className="text-[#E6D690]" />
                      <span className="text-xs font-bold text-white">{newBooking.date}</span>
                    </div>
                    <ChevronLeft size={14} className="opacity-40" />
                  </button>
                </div>

                {/* Time Picker Button */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#E6D690] flex items-center gap-1.5">
                    <Clock size={13} />
                    وقت الموعد
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsTimePickerOpen(true)}
                    className={`w-full bg-[#121212] border rounded-xl py-2.5 px-3.5 flex items-center justify-between transition-all outline-none ${
                      newBooking.time ? 'border-white/10 hover:border-[#E6D690]/30' : 'border-[#E6D690]/40 bg-[#E6D690]/5'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Clock size={15} className="text-[#E6D690]" />
                      <span className="text-xs font-bold text-white">{newBooking.time || 'اختر الوقت المطلوب'}</span>
                    </div>
                    <ChevronLeft size={14} className="opacity-40" />
                  </button>
                </div>
              </div>

              {/* Row 3: Service & Barber */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Service */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#E6D690] flex items-center gap-1.5">
                    <Scissors size={13} />
                    الخدمة
                  </label>
                  <div className="relative">
                    <input
                      placeholder="مثال: قصة شعر + ذقن"
                      value={newBooking.service}
                      onChange={e => setNewBooking({ ...newBooking, service: e.target.value })}
                      className="w-full bg-[#121212] border border-white/10 rounded-xl py-2.5 pr-9 pl-3.5 outline-none focus:border-[#E6D690]/50 transition-all text-xs font-bold text-white placeholder:text-white/30"
                    />
                    <Scissors size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  </div>
                </div>

                {/* Barber */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#E6D690] flex items-center gap-1.5">
                    <User size={13} />
                    الحلاق (اختياري)
                  </label>
                  <div className="relative">
                    <select
                      value={newBooking.barberName}
                      onChange={e => setNewBooking({ ...newBooking, barberName: e.target.value })}
                      className="w-full bg-[#121212] border border-white/10 rounded-xl py-2.5 pr-9 pl-3.5 text-xs font-bold text-white outline-none appearance-none cursor-pointer focus:border-[#E6D690]/50"
                    >
                      <option value="">أي حلاق متاح (غير محدد)</option>
                      {barbers.map(b => (
                        <option key={b.id} value={b.name} className="bg-[#1A1A1A] text-white">
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <User size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Row 4: Deposit & Payment Method */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3.5 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                  {/* Deposit Amount */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-[#E6D690] flex items-center gap-1.5">
                        <Landmark size={13} />
                        مبلغ العربون (اختياري)
                      </label>
                      <span className="text-[10px] text-white/40">اتركه 0 إذا لم يدفع</span>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        step="10"
                        placeholder="0"
                        value={newBooking.deposit || ''}
                        onChange={e => setNewBooking({ ...newBooking, deposit: Math.max(0, Number(e.target.value)) })}
                        className="w-full bg-[#121212] border border-white/10 rounded-xl py-2 pr-9 pl-12 outline-none focus:border-[#E6D690]/50 text-xs font-mono font-bold text-[#E6D690] placeholder:text-white/20"
                      />
                      <Landmark size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/40">ج.م</span>
                    </div>
                  </div>

                  {/* Payment Method (when deposit > 0) */}
                  <div className="space-y-1.5">
                    {newBooking.deposit > 0 ? (
                      <>
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-[#E6D690]">
                            طريقة تحصيل العربون <span className="text-[#EF4444]">*</span>
                          </label>
                          <span className="text-[10px] text-white/40">مطلوب</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                          {[
                            { value: 'CASH', label: 'كاش' },
                            { value: 'VISA_1', label: 'فيزا 1' },
                            { value: 'VISA_2', label: 'فيزا 2' },
                            { value: 'INSTAPAY', label: 'إنستا' },
                          ].map(method => {
                            const isSelected = newBooking.depositPaymentMethod === method.value;
                            return (
                              <button
                                key={method.value}
                                type="button"
                                onClick={() => setNewBooking({
                                  ...newBooking,
                                  depositPaymentMethod: method.value as AppointmentDepositPaymentMethod,
                                })}
                                className={`rounded-lg border py-2 px-1 text-center text-xs font-bold transition-all ${
                                  isSelected
                                    ? 'border-[#E6D690] bg-[#E6D690] text-[#121212] shadow-sm shadow-[#E6D690]/20'
                                    : 'border-white/10 bg-[#121212] text-white/70 hover:border-white/20'
                                }`}
                              >
                                {method.label}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="h-full flex items-center pt-5">
                        <span className="text-[11px] text-white/30">لا يوجد عربون مطلوب لهذا الموعد.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Deposit Lock Warning Banner */}
              {isSelectedTimeLocked && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400 font-bold flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0 text-red-400" />
                  <span>هذا الموعد محجوز ومؤكد بعربون. يرجى اختيار موعد آخر.</span>
                </div>
              )}

              {/* Footer Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => { setIsModalOpen(false); resetForm(); }}
                  className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 text-xs font-bold transition-all"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={!newBooking.customerName.trim() || !newBooking.phone.trim() || !newBooking.time || isSelectedTimeLocked}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#E6D690] to-[#C9B76E] text-[#121212] text-xs font-black transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center gap-2 shadow-lg shadow-[#E6D690]/15"
                >
                  <CheckCircle2 size={15} />
                  تأكيد الحجز
                </button>
              </div>
            </form>
          </div>

          {/* Full Calendar Date Picker Drawer */}
          {isDatePickerOpen && (
            <div className="absolute inset-0 z-[110] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
              <div className="max-h-[min(80vh,var(--mini-modal-max-height))] w-full max-w-sm overflow-y-auto rounded-[3rem] border border-white/10 bg-[#1E1E1E] p-8 shadow-2xl space-y-8 select-none">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => changeMonth(1)} className="p-2 hover:bg-white/5 rounded-xl transition-colors"><ChevronRight size={20} /></button>
                  <div className="flex flex-col items-center">
                    <h3 className="font-black text-white text-lg">{ARABIC_MONTHS[currentCalendarDate.getMonth()]}</h3>
                    <span className="text-[10px] font-bold opacity-30 uppercase tracking-widest">{currentCalendarDate.getFullYear()}</span>
                  </div>
                  <button type="button" onClick={() => changeMonth(-1)} className="p-2 hover:bg-white/5 rounded-xl transition-colors"><ChevronLeft size={20} /></button>
                </div>

                {/* Calendar Grid */}
                <div className="grid grid-cols-7 gap-1 text-center">
                  {['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'].map(day => (
                    <span key={day} className="text-[10px] font-black opacity-20 py-2">{day}</span>
                  ))}
                  {calendarDays.map((date, idx) => {
                    if (!date) return <div key={`empty-${idx}`} />;
                    const isSelected = newBooking.date === formatDate(date, { day: 'numeric', month: 'long', year: 'numeric' }, 'ar-EG');
                    const isDisabled = isDateDisabled(date);

                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => {
                          // Store date in ISO format (YYYY-MM-DD) for backend
                          const year = date.getFullYear();
                          const month = String(date.getMonth() + 1).padStart(2, '0');
                          const day = String(date.getDate()).padStart(2, '0');
                          const isoDate = `${year}-${month}-${day}`;
                          console.log(`📅 Calendar: Selected date ${day}/${month} → ISO: ${isoDate}`);
                          setNewBooking({ ...newBooking, date: isoDate });
                          setIsDatePickerOpen(false);
                        }}
                        className={`w-full aspect-square flex items-center justify-center text-xs font-bold rounded-xl transition-all ${isSelected
                          ? 'bg-[#E6D690] text-[#121212] shadow-[0_5px_15px_rgba(230,214,144,0.3)]'
                          : isDisabled
                            ? 'opacity-10 cursor-not-allowed'
                            : 'hover:bg-white/5 text-[#BDBDBD]'
                          }`}
                      >
                        {date.getDate()}
                      </button>
                    );
                  })}
                </div>

                <div className="pt-4 border-t border-white/5 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setIsDatePickerOpen(false)}
                    className="text-[10px] font-black text-[#E53935] uppercase tracking-widest hover:opacity-100 opacity-60 transition-opacity"
                  >
                    إلغاء التحديد
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Time Picker Drawer */}
          {isTimePickerOpen && (
            <div className="absolute inset-0 z-[110] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
              <div className="flex max-h-[min(80vh,var(--mini-modal-max-height))] w-full max-w-lg flex-col rounded-[3rem] border border-white/10 bg-[#1E1E1E] p-8 lg:p-10 shadow-2xl">
                <div className="flex items-center justify-between mb-8 shrink-0">
                  <h3 className="font-black text-white text-xl">اختر الوقت</h3>
                  <button onClick={() => setIsTimePickerOpen(false)} className="text-[#BDBDBD] hover:text-white transition-colors"><X size={20} /></button>
                </div>
                <div className="mini-scroll-y custom-scrollbar grid grid-cols-3 gap-3 pr-2 sm:grid-cols-4">
                  {TIME_SLOTS.map(t => {
                    const isLocked = isSlotLocked(t, newBooking.date);
                    const isSelected = newBooking.time === t;

                    return (
                      <button
                        key={t}
                        type="button"
                        disabled={isLocked}
                        onClick={() => {
                          if (isLocked) return;
                          setNewBooking({ ...newBooking, time: t });
                          setIsTimePickerOpen(false);
                        }}
                        className={`py-3 px-2 rounded-xl text-center text-[11px] font-black transition-all border flex flex-col items-center justify-center gap-1 ${
                          isLocked
                            ? 'bg-[#181414] border-red-500/30 text-red-400/60 cursor-not-allowed opacity-60'
                            : isSelected
                            ? 'bg-[#E6D690] text-[#121212] border-[#E6D690]'
                            : 'bg-[#121212] border-white/5 hover:border-[#E6D690]/20 text-[#BDBDBD]'
                        }`}
                      >
                        <span>{t}</span>
                        {isLocked && (
                          <span className="text-[9px] font-medium text-red-400 flex items-center gap-0.5">
                            <Lock size={10} />
                            محجوز بعربون
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(230, 214, 144, 0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #E6D690; }
      `}</style>

      {depositReceipt && (
        <AppointmentDepositReceipt
          receipt={depositReceipt}
          onClose={() => setDepositReceipt(null)}
        />
      )}
    </div>
  );
});

export default AppointmentsScreen;
