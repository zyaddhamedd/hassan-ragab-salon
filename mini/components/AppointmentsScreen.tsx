
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
  UserPlus
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

  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<CustomerSearchResult[]>([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState('');
  const searchRequestSeqRef = useRef(0);
  const skipNextSearchRef = useRef(false);
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

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBooking.customerName || !newBooking.phone || !newBooking.time) return;
    if (newBooking.deposit > 0 && !newBooking.depositPaymentMethod) {
      alert('اختر وسيلة تحصيل العربون قبل تأكيد الحجز.');
      return;
    }

    const result = await onAddAppointment({
      ...newBooking,
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
      date: getTodayISO(),  // ISO format: YYYY-MM-DD
      deposit: 0,
      depositPaymentMethod: undefined,
    });
    setCustomerSearch('');
    setCustomerResults([]);
    setCustomerSearchError('');
  };

  const handleSelectCustomer = (customer: CustomerSearchResult) => {
    skipNextSearchRef.current = true;
    setNewBooking(prev => ({
      ...prev,
      customerName: customer.full_name,
      phone: customer.phone,
    }));
    setCustomerSearch(`${customer.full_name} - ${customer.phone}`);
    setCustomerResults([]);
    setCustomerSearchError('');
  };

  useEffect(() => {
    if (newBooking.deposit <= 0 && newBooking.depositPaymentMethod) {
      setNewBooking(prev => ({ ...prev, depositPaymentMethod: undefined }));
    }
  }, [newBooking.deposit, newBooking.depositPaymentMethod]);

  useEffect(() => {
    if (!isModalOpen) {
      setCustomerResults([]);
      setCustomerSearchLoading(false);
      setCustomerSearchError('');
      return;
    }

    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }

    const query = customerSearch.trim();
    if (query.length < 2) {
      searchRequestSeqRef.current += 1;
      setCustomerResults([]);
      setCustomerSearchLoading(false);
      setCustomerSearchError('');
      return;
    }

    const timer = window.setTimeout(async () => {
      const requestSeq = ++searchRequestSeqRef.current;
      setCustomerSearchLoading(true);
      setCustomerSearchError('');

      try {
        const response = await apiClient.get(`/customers/search?q=${encodeURIComponent(query)}`);
        if (requestSeq !== searchRequestSeqRef.current) return;
        setCustomerResults(Array.isArray(response) ? response : []);
      } catch (error) {
        if (requestSeq !== searchRequestSeqRef.current) return;
        console.error('Appointment customer search failed:', error);
        setCustomerResults([]);
        setCustomerSearchError('تعذر تحميل نتائج العملاء الآن.');
      } finally {
        if (requestSeq !== searchRequestSeqRef.current) return;
        setCustomerSearchLoading(false);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [customerSearch, isModalOpen]);

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
          <div className="mini-modal-panel-static bg-[#1E1E1E] border border-white/10 rounded-[3rem] w-full max-w-2xl p-8 lg:p-10 relative shadow-2xl">
            <button onClick={() => { setIsModalOpen(false); resetForm(); }} className="absolute top-8 left-8 text-[#BDBDBD] hover:text-[#E53935] z-50"><X size={20} /></button>
            <h2 className="text-2xl font-black mb-10 flex items-center gap-3">
              <Plus size={24} className="text-[#E6D690]" />
              إضافة حجز يدوي جديد
            </h2>

            <form onSubmit={handleBookingSubmit} className="mini-scroll-y custom-scrollbar space-y-10 pr-1">
              {/* 1. بيانات العميل */}
              <div className="space-y-4">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E6D690]">01. العميل</span>

                <div className="space-y-4">
                  <div className="space-y-3">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="ابحث عن عميل مسجل بالاسم أو رقم الهاتف"
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        className="w-full bg-[#121212] border border-white/5 rounded-2xl py-5 pr-14 pl-6 outline-none focus:border-[#E6D690]/40 transition-all text-sm"
                      />
                      <Search size={18} className="absolute right-6 top-1/2 -translate-y-1/2 text-white/20" />
                      {customerSearchLoading && (
                        <div className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 border border-white/20 border-t-[#E6D690] rounded-full animate-spin" />
                      )}
                    </div>

                    {customerSearch.trim().length >= 2 && (
                      <div className="rounded-2xl border border-white/5 bg-[#121212] overflow-hidden">
                        {customerResults.length > 0 ? (
                          customerResults.map((customer) => (
                            <button
                              key={customer.id}
                              type="button"
                              onClick={() => handleSelectCustomer(customer)}
                              className="w-full px-5 py-4 flex items-center justify-between text-right border-b border-white/5 last:border-b-0 hover:bg-white/5 transition-colors"
                            >
                              <div className="flex flex-col items-end">
                                <span className="text-sm font-bold text-white">{customer.full_name}</span>
                                <span className="text-[11px] text-[#E6D690]">
                                  رصيد العربون: {(customer.deposit_balance || 0).toLocaleString('en-US')} EGP
                                </span>
                              </div>
                              <span className="text-xs tracking-widest text-white/40">{customer.phone}</span>
                            </button>
                          ))
                        ) : !customerSearchLoading ? (
                          <div className="px-5 py-4 text-xs text-white/40">
                            {customerSearchError || 'لا توجد نتائج مطابقة.'}
                          </div>
                        ) : null}
                      </div>
                    )}

                    <p className="text-[11px] text-white/35">
                      ابحث لاختيار عميل مسجل أو اترك الحقول التالية لإضافة عميل جديد مع الموعد.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                  {/* Customer Name */}
                  <div className="relative">
                    <input
                      required
                      placeholder="اسم العميل"
                      value={newBooking.customerName}
                      onChange={e => setNewBooking({ ...newBooking, customerName: e.target.value })}
                      className="w-full bg-[#121212] border border-white/5 rounded-2xl py-5 pr-14 pl-6 outline-none focus:border-[#E6D690]/40 transition-all text-sm"
                    />
                    <User size={20} className="absolute right-6 top-1/2 -translate-y-1/2 text-white/20" />
                  </div>

                  {/* Customer Phone */}
                  <div className="relative">
                    <input
                      required
                      type="tel"
                      placeholder="رقم الهاتف (مثال: 01012345678)"
                      value={newBooking.phone}
                      onChange={e => setNewBooking({ ...newBooking, phone: e.target.value })}
                      className="w-full bg-[#121212] border border-white/5 rounded-2xl py-5 pr-14 pl-6 outline-none focus:border-[#E6D690]/40 transition-all text-sm"
                    />
                    <Phone size={20} className="absolute right-6 top-1/2 -translate-y-1/2 text-white/20" />
                  </div>
                </div>
                </div>
              </div>

              {/* 2. التاريخ والوقت */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E6D690]">02. التاريخ</span>
                  <button
                    type="button"
                    onClick={() => setIsDatePickerOpen(true)}
                    className="w-full bg-[#121212] border border-white/5 rounded-2xl py-5 px-6 flex items-center justify-between group hover:border-[#E6D690]/20 transition-all outline-none"
                  >
                    <div className="flex items-center gap-3">
                      <CalendarIcon size={18} className="text-[#E6D690]" />
                      <span className="text-sm font-bold">{newBooking.date}</span>
                    </div>
                    <ChevronLeft size={16} className="opacity-20 group-hover:opacity-100 transition-opacity" />
                  </button>
                </div>

                <div className="space-y-4">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E6D690]">03. الوقت</span>
                  <button
                    type="button"
                    onClick={() => setIsTimePickerOpen(true)}
                    className="w-full bg-[#121212] border border-white/5 rounded-2xl py-5 px-6 flex items-center justify-between group hover:border-[#E6D690]/20 transition-all outline-none"
                  >
                    <div className="flex items-center gap-3">
                      <Clock size={18} className="text-[#E6D690]" />
                      <span className="text-sm font-bold">{newBooking.time || '-- : --'}</span>
                    </div>
                    <ChevronLeft size={16} className="opacity-20 group-hover:opacity-100 transition-opacity" />
                  </button>
                </div>
              </div>

              {/* 3. الخدمة والحلاق */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E6D690]">04. الخدمة</span>
                  <input
                    placeholder="مثال: قصة شعر + ذقن"
                    value={newBooking.service}
                    onChange={e => setNewBooking({ ...newBooking, service: e.target.value })}
                    className="w-full bg-[#121212] border border-white/5 rounded-2xl py-5 px-6 outline-none focus:border-[#E6D690]/40 text-sm"
                  />
                </div>
                <div className="space-y-4">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E6D690]">05. الحلاق (اختياري)</span>
                  <select value={newBooking.barberName} onChange={e => setNewBooking({ ...newBooking, barberName: e.target.value })} className="w-full bg-[#121212] border border-white/5 rounded-2xl py-5 px-6 text-sm outline-none appearance-none cursor-pointer">
                    <option value="">اختر حلاق (اختياري)</option>
                    {barbers.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                  </select>
                </div>
              </div>

              {/* 4. العربون */}
              <div className="space-y-4 bg-white/5 p-6 rounded-[2rem] border border-white/5">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E6D690]">06. مبلغ العربون (Deposit)</span>
                <div className="relative">
                  <input
                    type="number"
                    placeholder="0"
                    value={newBooking.deposit || ''}
                    onChange={e => setNewBooking({ ...newBooking, deposit: Number(e.target.value) })}
                    className="w-full bg-[#121212] border border-white/10 rounded-2xl py-6 pr-14 pl-6 outline-none focus:border-[#E6D690]/40 text-lg font-black text-[#E6D690]"
                  />
                  <Landmark size={20} className="absolute right-6 top-1/2 -translate-y-1/2 text-white/20" />
                </div>

                {newBooking.deposit > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#E6D690]">
                        07. وسيلة تحصيل العربون
                      </span>
                      <span className="text-[10px] text-white/40">مطلوب</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { value: 'CASH', label: 'كاش' },
                        { value: 'VISA_1', label: 'فيزا 1' },
                        { value: 'VISA_2', label: 'فيزا 2' },
                        { value: 'INSTAPAY', label: 'إنستاباي' },
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
                            className={`rounded-2xl border px-4 py-4 text-sm font-black transition-all ${
                              isSelected
                                ? 'border-[#E6D690] bg-[#E6D690] text-[#121212] shadow-[0_0_20px_rgba(230,214,144,0.12)]'
                                : 'border-white/10 bg-[#121212] text-[#F5F5F5] hover:border-[#E6D690]/30'
                            }`}
                          >
                            {method.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <button type="submit" className="w-full py-6 bg-[#E6D690] text-[#121212] font-black rounded-[2rem] text-md transition-all hover:bg-[#ffed9e] active:scale-95 shadow-xl shadow-[#E6D690]/10 mt-6 flex items-center justify-center gap-3">
                <CheckCircle2 size={20} />
                تأكيد الموعد
              </button>
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
                  {TIME_SLOTS.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => { setNewBooking({ ...newBooking, time: t }); setIsTimePickerOpen(false); }}
                      className={`py-4 rounded-xl text-center text-[11px] font-black transition-all border ${newBooking.time === t ? 'bg-[#E6D690] text-[#121212] border-[#E6D690]' : 'bg-[#121212] border-white/5 hover:border-[#E6D690]/20 text-[#BDBDBD]'}`}
                    >
                      {t}
                    </button>
                  ))}
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
