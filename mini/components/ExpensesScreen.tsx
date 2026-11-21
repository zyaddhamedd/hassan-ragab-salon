import React, { useState, useMemo, useEffect } from 'react';
import {
  Wallet,
  Receipt,
  Calendar as CalendarIcon,
  User,
  Plus,
  X,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  // Fix: Removed duplicate TrendingDown and added missing Clock import
  TrendingDown,
  Clock
} from 'lucide-react';
import { Expense, Cashier } from '../App';
import { apiClient } from '../src/api/client';
import { getTodayISO, formatDate, formatTime } from '../src/utils/dateFormatter';

interface ExpensesScreenProps {
  expenses: Expense[];
  onAddExpense: (data: Omit<Expense, 'id'>) => void;
  cashier: Cashier;
}

interface ExpenseCategory {
  id: number;
  name: string;
}

const ARABIC_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
];

const ExpensesScreen: React.FC<ExpensesScreenProps> = ({ expenses, onAddExpense, cashier }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [currentCalendarDate, setCurrentCalendarDate] = useState(new Date());
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);

  const [formData, setFormData] = useState<Omit<Expense, 'id' | 'time' | 'cashierName'>>({
    type: '',
    categoryId: undefined,
    amount: 0,
    notes: '',
    date: getTodayISO()
  });

  // Fetch expense categories from backend
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const data = await apiClient.get('/expenses/categories');
        setCategories(data);
        // Set first category as default if available
        if (data.length > 0) {
          setFormData(prev => ({
            ...prev,
            type: data[0].name,
            categoryId: data[0].id
          }));
        }
      } catch (error) {
        console.error('Failed to fetch expense categories:', error);
      }
    };

    fetchCategories();
  }, []);

  const todayStr = getTodayISO();
  const todayTotal = useMemo(() => {
    return expenses
      .filter(e => e.date === todayStr)
      .reduce((acc, curr) => acc + curr.amount, 0);
  }, [expenses, todayStr]);

  const sortedExpenses = useMemo(() => {
    return [...expenses].sort((a, b) => {
      const dateA = new Date(`${a.date} ${a.time.replace(' ص', ' AM').replace(' م', ' PM')}`).getTime();
      const dateB = new Date(`${b.date} ${b.time.replace(' ص', ' AM').replace(' م', ' PM')}`).getTime();
      return dateB - dateA;
    });
  }, [expenses]);

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.amount <= 0 || !formData.categoryId) return;

    const now = new Date();
    const timeStr = formatTime(now, { hour: '2-digit', minute: '2-digit' }, 'ar-EG');

    onAddExpense({
      ...formData,
      time: timeStr,
      cashierName: cashier.name
    });

    setIsModalOpen(false);
    // Reset to first category
    setFormData({
      type: categories[0]?.name || '',
      categoryId: categories[0]?.id,
      amount: 0,
      notes: '',
      date: getTodayISO()
    });
  };

  // Calendar Helpers
  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const calendarDays = useMemo(() => {
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    const totalDays = daysInMonth(year, month);
    const startDay = firstDayOfMonth(year, month);
    const days = [];
    for (let i = 0; i < startDay; i++) days.push(null);
    for (let d = 1; d <= totalDays; d++) days.push(new Date(year, month, d));
    return days;
  }, [currentCalendarDate]);

  const changeMonth = (offset: number) => {
    setCurrentCalendarDate(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + offset);
      return d;
    });
  };

  const formatDateForDisplay = (dateStr: string) => {
    return formatDate(dateStr, { day: 'numeric', month: 'long', year: 'numeric' }, 'ar-EG');
  };

  return (
    <div className="mini-screen transition-colors duration-500 font-['Cairo'] bg-[#121212] text-[#F5F5F5]" dir="rtl">
      {/* هيدر الصفحة */}
      <header className="mini-page-header min-h-[6rem] flex flex-wrap items-center justify-between gap-4 border-b border-white/5 bg-[#121212]/90 sticky top-0 backdrop-blur-xl z-50">
        <div className="flex min-w-0 items-center gap-4">
          <div className="w-1.5 h-8 rounded-full shadow-[0_0_10px_#E6D690] bg-[#E6D690]"></div>
          <h1 className="text-3xl font-black">المصروفات</h1>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-6 py-2.5 bg-[#E6D690] text-[#121212] rounded-xl text-xs font-black hover:bg-[#ffed9e] transition-all active:scale-95 shadow-lg shadow-[#E6D690]/10"
        >
          <Plus size={16} />
          إضافة مصروف
        </button>
      </header>

      <div className="mini-scroll-y mini-page-body custom-scrollbar w-full max-w-none mx-auto space-y-12 pb-24 lg:space-y-16 lg:pb-32">

        {/* إجمالي مصروفات اليوم */}
        <section className="group flex flex-col items-start justify-between gap-6 rounded-[2.5rem] border border-white/5 bg-[#1E1E1E] p-6 transition-all sm:flex-row sm:items-center lg:p-8">
          <div className="flex flex-col">
            <span className="text-[10px] font-black opacity-30 uppercase tracking-[0.2em] mb-1">إجمالي مصروفات اليوم</span>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black text-[#E6D690] tracking-tighter">{todayTotal}</span>
              <span className="text-sm font-bold text-white/40">ج.م</span>
            </div>
          </div>
          <div className="w-14 h-14 rounded-2xl bg-[#121212] flex items-center justify-center text-[#E6D690] border border-white/5 group-hover:border-[#E6D690]/30 transition-all">
            <TrendingDown size={24} />
          </div>
        </section>

        {/* قائمة العمليات */}
        <section className="space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <Receipt size={18} className="text-[#E6D690] opacity-50" />
            <h3 className="text-sm font-black opacity-40 uppercase tracking-widest">سجل العمليات الأحدث</h3>
          </div>

          <div className="space-y-4">
            {sortedExpenses.length > 0 ? sortedExpenses.map((expense) => (
              <div
                key={expense.id}
                className="flex flex-col gap-4 rounded-[2rem] border border-white/5 bg-[#1E1E1E]/40 p-5 transition-all hover:bg-[#1E1E1E] sm:flex-row sm:items-center sm:justify-between sm:p-6"
              >
                <div className="flex min-w-0 items-center gap-5">
                  <div className="w-12 h-12 rounded-xl bg-[#121212] flex items-center justify-center text-[#E6D690] border border-white/5">
                    <Wallet size={18} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="mb-0.5 text-sm font-black text-white break-words">{expense.type}</h4>
                    <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold text-[#BDBDBD] opacity-40">
                      <span className="flex items-center gap-1.5"><Clock size={10} /> {expense.time}</span>
                      <span className="flex items-center gap-1.5"><User size={10} /> {expense.cashierName}</span>
                    </div>
                  </div>
                </div>

                <div className="shrink-0 self-end text-left sm:self-auto">
                  <span className="text-lg font-black text-[#E6D690]">{expense.amount}</span>
                  <span className="text-[9px] font-bold opacity-30 mr-1">ج.م</span>
                  {expense.notes && (
                    <div className="mt-1 max-w-[12rem] truncate text-[10px] opacity-20">{expense.notes}</div>
                  )}
                </div>
              </div>
            )) : (
              <div className="py-20 flex flex-col items-center justify-center border border-dashed border-white/5 rounded-[3rem] opacity-20">
                <Receipt size={40} className="mb-4" />
                <p className="text-xs font-bold">لا توجد عمليات مسجلة</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Add Expense Modal */}
      {isModalOpen && (
        <div className="mini-modal-overlay animate-in fade-in duration-300">
          <div className="mini-modal-panel bg-[#1E1E1E] border border-white/10 rounded-[3rem] w-full max-w-md p-8 lg:p-10 relative shadow-2xl space-y-8">
            <button onClick={() => setIsModalOpen(false)} className="absolute top-8 left-8 text-[#BDBDBD] hover:text-[#E53935]"><X size={20} /></button>

            <h2 className="text-2xl font-black flex items-center gap-3">
              <Plus size={24} className="text-[#E6D690]" />
              إضافة مصروف جديد
            </h2>

            <form onSubmit={handleAddSubmit} className="space-y-6">
              {/* النوع */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#E6D690] mr-4">نوع المصروف</label>
                <select
                  required
                  value={formData.categoryId || ''}
                  onChange={e => {
                    const selectedId = parseInt(e.target.value);
                    const selectedCategory = categories.find(c => c.id === selectedId);
                    setFormData({
                      ...formData,
                      categoryId: selectedId,
                      type: selectedCategory?.name || ''
                    });
                  }}
                  className="w-full bg-[#121212] border border-white/5 rounded-2xl py-4 px-6 text-sm outline-none focus:border-[#E6D690]/40 transition-all appearance-none cursor-pointer"
                >
                  {categories.length === 0 ? (
                    <option value="">لا توجد فئات متاحة</option>
                  ) : (
                    categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)
                  )}
                </select>
              </div>

              {/* المبلغ */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#E6D690] mr-4">المبلغ (ج.م)</label>
                <input
                  required
                  type="number"
                  placeholder="0"
                  value={formData.amount || ''}
                  onChange={e => setFormData({ ...formData, amount: Number(e.target.value) })}
                  className="w-full bg-[#121212] border border-white/5 rounded-2xl py-5 px-6 outline-none focus:border-[#E6D690]/40 text-xl font-black text-white"
                />
              </div>

              {/* ملاحظات */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#E6D690] mr-4">ملاحظات (اختياري)</label>
                <input
                  placeholder="تفاصيل إضافية..."
                  value={formData.notes}
                  // Fix: Explicitly provide value for shorthand property 'notes' from e.target.value
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full bg-[#121212] border border-white/5 rounded-2xl py-4 px-6 outline-none focus:border-[#E6D690]/40 text-sm"
                />
              </div>

              {/* التاريخ */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#E6D690] mr-4">التاريخ</label>
                <button
                  type="button"
                  onClick={() => setIsDatePickerOpen(true)}
                  className="w-full bg-[#121212] border border-white/5 rounded-2xl py-4 px-6 flex items-center justify-between group hover:border-[#E6D690]/20 transition-all outline-none"
                >
                  <div className="flex items-center gap-3">
                    <CalendarIcon size={18} className="text-[#E6D690]" />
                    <span className="text-sm font-bold">{formatDateForDisplay(formData.date)}</span>
                  </div>
                  <ChevronLeft size={16} className="opacity-20 group-hover:opacity-100" />
                </button>
              </div>

              {/* الكاشير (عرض فقط) */}
              <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                <span className="text-[10px] font-black text-[#BDBDBD] uppercase tracking-widest">بواسطة الكاشير</span>
                <span className="text-xs font-bold text-white opacity-60">{cashier.name}</span>
              </div>

              <button type="submit" className="w-full py-6 bg-[#E6D690] text-[#121212] font-black rounded-[2rem] text-md transition-all hover:bg-[#ffed9e] active:scale-95 shadow-xl shadow-[#E6D690]/10 mt-6 flex items-center justify-center gap-3">
                <CheckCircle2 size={20} />
                تأكيد وحفظ
              </button>
            </form>
          </div>

          {/* Calendar Picker Drawer */}
          {isDatePickerOpen && (
            <div className="absolute inset-0 z-[110] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
              <div className="bg-[#1E1E1E] border border-white/10 rounded-[3rem] w-full max-w-sm p-8 shadow-2xl space-y-8 select-none">
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => changeMonth(1)} className="p-2 hover:bg-white/5 rounded-xl transition-colors"><ChevronRight size={20} /></button>
                  <div className="flex flex-col items-center">
                    <h3 className="font-black text-white text-lg">{ARABIC_MONTHS[currentCalendarDate.getMonth()]}</h3>
                    <span className="text-[10px] font-bold opacity-30 uppercase tracking-widest">{currentCalendarDate.getFullYear()}</span>
                  </div>
                  <button type="button" onClick={() => changeMonth(-1)} className="p-2 hover:bg-white/5 rounded-xl transition-colors"><ChevronLeft size={20} /></button>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center">
                  {['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'].map(day => (
                    <span key={day} className="text-[10px] font-black opacity-20 py-2">{day}</span>
                  ))}
                  {calendarDays.map((date, idx) => {
                    if (!date) return <div key={`empty-${idx}`} />;
                    const dateStrVal = date.toISOString().split('T')[0];
                    const isSelected = formData.date === dateStrVal;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setFormData({ ...formData, date: dateStrVal });
                          setIsDatePickerOpen(false);
                        }}
                        className={`w-full aspect-square flex items-center justify-center text-xs font-bold rounded-xl transition-all ${isSelected
                          ? 'bg-[#E6D690] text-[#121212] shadow-[0_5px_15px_rgba(230,214,144,0.3)]'
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
                    إغلاق التقويم
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ExpensesScreen;
