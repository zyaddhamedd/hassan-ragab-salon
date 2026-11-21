
import React, { useState } from 'react';
import {
  Scissors,
  Phone,
  UserCheck,
  X,
  Wallet,
  MinusCircle,
  ArrowDownCircle,
  Search,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  Award,
  Sparkles
} from 'lucide-react';
import { StaffMember, Expense } from '../App';
import { apiClient } from '../src/api/client';


interface BarbersScreenProps {
  staff: StaffMember[];
  onAddExpense: (data: Omit<Expense, 'id'>) => void;
  onBarberAction?: (barberId: number, action: { type: string; amount: number; notes?: string }) => Promise<void>;
  currentCashier: string;
}

type ActionType = 'menu' | 'loan' | 'deduction' | 'withdraw' | 'overtime';

// 🖨️ Action Type to Arabic Label Mapping
const actionLabels: Record<string, string> = {
  'ADVANCE': 'سلفة',
  'COMMISSION': 'سحب نسبة',
  'OVERTIME': 'أوفر تايم',
  'DEDUCTION': 'خصم'
};

// 🖨️ Build Receipt HTML for 80mm Thermal Printer (CENTERED, PROPERLY FORMATTED)
function buildReceiptHTML(data: {
  barber_name: string;
  action_type: string;
  amount: number;
  datetime: string;
  user: string;
  notes?: string;
}): string {
  const receiptHTML = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * {
          box-sizing: border-box;
        }

        html, body {
          margin: 0;
          padding: 0;
          background: white;
          color: black;
          direction: rtl;
          font-family: monospace;
          font-size: 12px;
          line-height: 1.6;
          width: 100%;
        }

        .receipt-container {
          width: 100%;
          max-width: 260px;
          margin: 0 auto;
          padding: 4px;
          text-align: center;
        }

        table {
          width: auto;
          margin: 0 auto;
          border-collapse: collapse;
          text-align: right;
        }

        td {
          padding: 3px 6px;
          vertical-align: top;
          border: none;
        }

        .label {
          text-align: right;
          padding-right: 0;
          font-weight: normal;
        }

        .value {
          text-align: left;
          padding-left: 0;
        }

        .separator {
          border: none;
          border-top: 1px dashed #000;
          height: 0;
          padding: 0;
          margin: 6px 0;
        }

        .amount-row .label {
          font-weight: bold;
        }

        .amount-row .value {
          font-weight: bold;
          font-size: 14px;
        }

        @media print {
          @page {
            size: 80mm auto;
            margin: 0;
          }

          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .receipt-container {
            width: 100%;
            max-width: 260px;
            margin: 0 auto !important;
            padding: 4px !important;
          }

          table {
            width: auto !important;
            margin: 0 auto !important;
          }

          td {
            padding: 3px 6px !important;
          }
        }
      </style>
    </head>
    <body>
      <div class="receipt-container">
        <table>
          <tr>
            <td class="label">الحلاق:</td>
            <td class="value">${data.barber_name}</td>
          </tr>
          <tr>
            <td class="label">العملية:</td>
            <td class="value">${data.action_type}</td>
          </tr>
          <tr class="separator">
            <td colspan="2"></td>
          </tr>
          <tr class="amount-row">
            <td class="label">المبلغ:</td>
            <td class="value">${data.amount.toFixed(2)} ج.م</td>
          </tr>
          <tr class="separator">
            <td colspan="2"></td>
          </tr>
          <tr>
            <td class="label">التاريخ:</td>
            <td class="value">${data.datetime}</td>
          </tr>
          <tr>
            <td class="label">الكاشير:</td>
            <td class="value">${data.user}</td>
          </tr>
        </table>
      </div>
    </body>
    </html>
  `;
  return receiptHTML;
}

// 🖨️ Print Receipt (Immediate, iframe-based)
function printReceipt(data: {
  barber_name: string;
  action_type: string;
  amount: number;
  datetime: string;
  user: string;
  notes?: string;
}): void {
  try {
    const receiptHTML = buildReceiptHTML(data);
    
    // Create hidden iframe for printing
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';

    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(receiptHTML);
      doc.close();

      // Wait for content to load then print
      iframe.contentWindow?.focus();
      if (iframe.contentWindow) {
        iframe.contentWindow.print();
      }

      // Remove iframe after print dialog closes
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
    }
  } catch (error) {
    console.error('🖨️ Print Error (non-blocking):', error);
    // Silently fail - do not interrupt user workflow
  }
}

const BarbersScreen: React.FC<BarbersScreenProps> = ({ staff, onAddExpense, onBarberAction, currentCashier }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBarber, setSelectedBarber] = useState<StaffMember | null>(null);
  const [activeAction, setActiveAction] = useState<ActionType>('menu');

  // Filter staff based on search query
  const filteredStaff = staff.filter(s => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return s.name.toLowerCase().includes(query) || (s.phone && s.phone.includes(query));
  });

  const barbers = filteredStaff.filter(s => s.role === 'حلاق');
  const assistants = filteredStaff.filter(s => s.role === 'مساعد');

  // حالات نماذج الإدخال
  const [amount, setAmount] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Daily commission state
  const [dailyCommission, setDailyCommission] = useState<number>(0);
  const [isLoadingCommission, setIsLoadingCommission] = useState(false);

  const handleBarberClick = async (barber: StaffMember) => {
    setSelectedBarber(barber);
    setActiveAction('menu');
    setAmount(0);
    setNotes('');

    // Fetch daily commission
    setIsLoadingCommission(true);
    try {
      console.log('🔵 [START] Fetching commission for barber:', barber.name, barber.id);
      
      const data = await apiClient.get(`/barbers/${barber.id}/daily-commission`);
      console.log('[Commission] Data received:', data);
      setDailyCommission(data.wallet_balance || 0);
    } catch (error) {
      console.error('[Commission] Failed to fetch daily commission:', error);
      setDailyCommission(0);
    } finally {
      setIsLoadingCommission(false);
    }
  };

  const closePopup = () => {
    setSelectedBarber(null);
    setActiveAction('menu');
  };

  const handleActionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBarber || !onBarberAction) return;

    setIsSubmitting(true);
    try {
      // ✅ Handle commission withdrawal with manual input (enhanced)
      if (activeAction === 'withdraw') {
        if (!amount || amount <= 0) {
          alert('يرجى إدخال مبلغ صحيح');
          setIsSubmitting(false);
          return;
        }

        try {
          const result = await apiClient.post(`/barbers/${selectedBarber.id}/withdraw-commission`, {
            amount: amount,  // ← NEW: Manual input amount
            notes: notes || ''  // ✅ Send notes to backend
          });
          alert(`تم سحب ${result.amount_withdrawn} ج.م بنجاح`);

          // 🖨️ Print receipt (async, non-blocking)
          printReceipt({
            barber_name: selectedBarber.name,
            action_type: actionLabels['COMMISSION'],
            amount: amount,
            datetime: new Date().toLocaleString('ar-EG'),
            user: currentCashier,
            notes: notes || undefined
          });

          // Reset form and refresh
          setAmount(0);
          setNotes('');
          setDailyCommission(0);
          closePopup();
          return;
        } catch (error: any) {
          console.error("Withdraw Commission Error:", error);
          alert(`فشل: ${error.message || "خطأ غير معروف"}`);
          return;
        } finally {
          setIsSubmitting(false);
        }
      }

      // Handle other actions (ADVANCE, DEDUCTION, OVERTIME)
      let type = '';
      let finalAmount = amount;

      if (activeAction === 'loan') type = 'ADVANCE';
      if (activeAction === 'deduction') type = 'DEDUCTION';
      if (activeAction === 'overtime') type = 'OVERTIME';

      await onBarberAction(selectedBarber.id, {
        type,
        amount: finalAmount,
        notes
      });

      // 🖨️ Print receipt (async, non-blocking)
      printReceipt({
        barber_name: selectedBarber.name,
        action_type: actionLabels[type],
        amount: finalAmount,
        datetime: new Date().toLocaleString('ar-EG'),
        user: currentCashier,
        notes: notes || undefined
      });

      closePopup();
    } catch (error: any) {
      console.error("Barber Action Error:", error);
      alert(`فشل: ${error.message || "خطأ غير معروف"}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mini-screen transition-colors duration-500 font-['Cairo'] bg-[#121212] text-[#F5F5F5]" dir="rtl">
      {/* هيدر الصفحة */}
      <header className="mini-page-header min-h-[6rem] flex flex-wrap items-center justify-between gap-4 border-b border-white/5 bg-[#121212]/90 sticky top-0 backdrop-blur-xl z-50">
        <div className="flex min-w-0 items-center gap-4">
          <div className="w-1.5 h-8 rounded-full shadow-[0_0_10px_#E6D690] bg-[#E6D690]"></div>
          <h1 className="text-3xl font-black">الحلاقين</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-4">
          <div className="px-5 py-2 rounded-full border bg-[#1E1E1E] border-white/5 flex items-center gap-2">
            <span className="text-[10px] opacity-40 uppercase tracking-widest">إجمالي الطاقم</span>
            <span className="font-bold text-[#E6D690]">{barbers.length + assistants.length}</span>
          </div>
        </div>
      </header>

      <div className="mini-scroll-y mini-page-body custom-scrollbar w-full max-w-none mx-auto space-y-12 lg:space-y-16 pb-24 lg:pb-32">
        {/* Unified Luxury Search Bar */}
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

        {/* قسم الحلاقين */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-[#E6D690]/10">
              <Scissors size={20} className="text-[#E6D690]" />
            </div>
            <div>
              <h2 className="text-xl font-black">طاقم الحلاقين</h2>
              <p className="text-xs opacity-50 mt-1 text-[#BDBDBD]">اضغط على كارت الحلاق لإدارة العمليات المالية</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {barbers.map((barber) => (
              <button
                key={barber.id}
                onClick={() => handleBarberClick(barber)}
                className="group relative overflow-hidden rounded-[2.5rem] border border-white/5 bg-[#1E1E1E] p-6 text-right outline-none transition-all duration-500 hover:border-[#E6D690]/30 lg:p-8"
              >
                <div className="absolute top-6 left-6">
                  <span className={`px-3 py-1 text-[9px] font-bold uppercase tracking-widest rounded-lg border ${barber.isPresent ? 'bg-[#E6D690]/10 text-[#E6D690] border-[#E6D690]/20' : 'bg-white/5 text-[#BDBDBD]/40 border-white/5'}`}>
                    {barber.isPresent ? 'متواجد' : 'غير متواجد'}
                  </span>
                </div>

                <div className="flex flex-col items-center text-center space-y-5">
                  <div className="w-20 h-20 rounded-3xl border flex items-center justify-center transition-all duration-500 shadow-inner bg-[#121212] border-white/5 text-[#E6D690] group-hover:bg-[#E6D690] group-hover:text-[#121212] overflow-hidden">
                    {barber.avatar && typeof barber.avatar === 'string' ? (
                      <img src={barber.avatar} alt={barber.name} className="w-full h-full object-cover" />
                    ) : (
                      <UserCheck size={32} />
                    )}
                  </div>

                  <div className="min-w-0 space-y-1">
                    <h3 className="text-xl font-black transition-colors group-hover:text-[#E6D690] break-words">{barber.name}</h3>
                    <div className="flex items-center justify-center gap-2 opacity-40 text-[#BDBDBD]">
                      <Phone size={12} />
                      <span className="text-xs tracking-wider">{barber.phone || '---'}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* قسم المساعدين */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[#E53935]/10 rounded-2xl">
              <Sparkles size={20} className="text-[#E53935]" />
            </div>
            <div>
              <h2 className="text-xl font-black">المساعدين</h2>
              <p className="text-xs opacity-50 mt-1 text-[#BDBDBD]">طاقم الخدمة المساندة</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {assistants.map((assistant) => (
              <div
                key={assistant.id}
                className="rounded-[2rem] p-6 border border-white/5 bg-[#1E1E1E]/60 transition-all duration-500 group relative hover:border-[#E53935]/20"
              >
                <div className="flex items-center gap-5">
                  <div className="w-16 h-16 rounded-2xl border flex items-center justify-center transition-colors bg-[#121212] border-white/5 text-[#BDBDBD] group-hover:text-[#E53935] overflow-hidden">
                    {assistant.avatar && typeof assistant.avatar === 'string' ? (
                      <img src={assistant.avatar} alt={assistant.name} className="w-full h-full object-cover" />
                    ) : (
                      <Award size={24} />
                    )}
                  </div>

                    <div className="min-w-0 space-y-1">
                    <h3 className="text-lg font-black transition-colors group-hover:text-white break-words">{assistant.name}</h3>
                    <div className="flex items-center gap-2 opacity-40 text-[#BDBDBD]">
                      <Phone size={12} />
                      <span className="text-xs tracking-wider">{assistant.phone || '---'}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Barber Action Popup */}
      {selectedBarber && (
        <div className="mini-modal-overlay animate-in fade-in duration-300">
          <div className="mini-modal-panel bg-[#1E1E1E] border border-white/10 rounded-[3rem] w-full max-w-md p-8 lg:p-10 relative shadow-2xl space-y-8 overflow-hidden">
            <button onClick={closePopup} className="absolute top-8 left-8 text-[#BDBDBD] hover:text-[#E53935] z-10"><X size={20} /></button>

            {/* Header */}
            <div className="flex flex-col items-center text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-[#E6D690]/10 flex items-center justify-center text-[#E6D690] border border-[#E6D690]/20 overflow-hidden">
                {selectedBarber.avatar && typeof selectedBarber.avatar === 'string' ? (
                  <img src={selectedBarber.avatar} alt={selectedBarber.name} className="w-full h-full object-cover" />
                ) : (
                  <UserCheck size={32} />
                )}
              </div>
              <h2 className="text-2xl font-black">{selectedBarber.name}</h2>
            </div>

            {/* Content Logic */}
            {activeAction === 'menu' && (
              <div className="space-y-8">
                {/* Commission Display */}
                <div className="p-6 bg-[#121212] border border-white/5 rounded-2xl flex flex-col items-center">
                  <span className="text-[10px] font-black opacity-30 uppercase tracking-[0.2em] mb-1">نسبة الحلاق اليوم</span>
                  {isLoadingCommission ? (
                    <div className="text-xl font-black text-[#BDBDBD] opacity-50">جاري التحميل...</div>
                  ) : (
                    <div className="text-3xl font-black text-[#E6D690]">{dailyCommission.toLocaleString()} ج.م</div>
                  )}
                  <p className="text-[10px] text-[#BDBDBD] opacity-40 mt-3 text-center px-4 leading-relaxed font-bold">محسوبة من فواتير اليوم</p>
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-1 gap-3">
                  <button
                    onClick={() => setActiveAction('loan')}
                    className="w-full p-5 rounded-2xl border border-white/5 bg-[#252525] flex items-center justify-between hover:border-[#E6D690]/30 transition-all group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-[#E6D690]/5 rounded-xl text-[#E6D690] group-hover:bg-[#E6D690] group-hover:text-[#121212] transition-colors"><Wallet size={18} /></div>
                      <span className="text-sm font-black">تسجيل سلفة</span>
                    </div>
                    <ChevronLeft size={16} className="opacity-20" />
                  </button>

                  <button
                    onClick={() => setActiveAction('deduction')}
                    className="w-full p-5 rounded-2xl border border-white/5 bg-[#252525] flex items-center justify-between hover:border-[#E53935]/30 transition-all group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-[#E53935]/5 rounded-xl text-[#E53935] group-hover:bg-[#E53935] group-hover:text-white transition-colors"><MinusCircle size={18} /></div>
                      <span className="text-sm font-black">تسجيل خصم</span>
                    </div>
                    <ChevronLeft size={16} className="opacity-20" />
                  </button>

                  <button
                    onClick={() => setActiveAction('overtime')}
                    className="w-full p-5 rounded-2xl border border-white/5 bg-[#252525] flex items-center justify-between hover:border-[#4CAF50]/30 transition-all group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-[#4CAF50]/5 rounded-xl text-[#4CAF50] group-hover:bg-[#4CAF50] group-hover:text-white transition-colors"><Award size={18} /></div>
                      <span className="text-sm font-black">تسجيل أوفر تايم</span>
                    </div>
                    <ChevronLeft size={16} className="opacity-20" />
                  </button>

                  <button
                    onClick={() => setActiveAction('withdraw')}
                    className="w-full p-5 rounded-2xl border border-[#E6D690]/20 bg-[#E6D690]/5 flex items-center justify-between hover:bg-[#E6D690]/10 transition-all group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-[#E6D690]/10 rounded-xl text-[#E6D690]"><ArrowDownCircle size={18} /></div>
                      <span className="text-sm font-black text-[#E6D690]">سحب نسبة اليوم</span>
                    </div>
                    <ChevronLeft size={16} className="opacity-20" />
                  </button>
                </div>
              </div>
            )}

            {/* Forms */}
            {(activeAction === 'loan' || activeAction === 'deduction' || activeAction === 'overtime') && (
              <form onSubmit={handleActionSubmit} className="space-y-6 animate-in slide-in-from-left-4 duration-300">
                <div className="flex items-center gap-4 mb-4">
                  <button type="button" onClick={() => setActiveAction('menu')} className="text-[#BDBDBD] hover:text-white"><ChevronRight size={20} /></button>
                  <h3 className="font-black text-lg">
                    {activeAction === 'loan' ? 'سلفة جديدة' : activeAction === 'deduction' ? 'خصم جديد' : 'أوفر تايم جديد'}
                  </h3>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#E6D690]">المبلغ (ج.م)</label>
                  <input
                    required
                    type="number"
                    placeholder="0"
                    min="1"
                    value={amount || ''}
                    onChange={e => setAmount(Number(e.target.value))}
                    className="w-full bg-[#121212] border border-white/5 rounded-2xl py-5 px-6 outline-none focus:border-[#E6D690]/40 text-xl font-black text-white"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#E6D690]">السبب (اختياري)</label>
                  <input
                    placeholder="اكتب ملاحظة..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="w-full bg-[#121212] border border-white/5 rounded-2xl py-4 px-6 outline-none focus:border-[#E6D690]/40 text-sm"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-6 bg-[#E6D690] text-[#121212] font-black rounded-[2rem] text-md transition-all hover:bg-[#ffed9e] active:scale-95 shadow-xl shadow-[#E6D690]/10 flex items-center justify-center gap-3 disabled:opacity-50">
                  <CheckCircle2 size={20} />
                  {isSubmitting ? 'جاري التنفيذ...' : 'تأكيد العملية'}
                </button>
              </form>
            )}

            {/* Withdraw Commission Form (Enhanced - now matches ADVANCE/OVERTIME) */}
            {activeAction === 'withdraw' && (
              <form onSubmit={handleActionSubmit} className="space-y-6 animate-in slide-in-from-left-4 duration-300">
                <div className="flex items-center gap-4 mb-4">
                  <button type="button" onClick={() => setActiveAction('menu')} className="text-[#BDBDBD] hover:text-white"><ChevronRight size={20} /></button>
                  <h3 className="font-black text-lg">سحب نسبة جديدة</h3>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#E6D690]">المبلغ (ج.م)</label>
                  <input
                    required
                    type="number"
                    placeholder="0"
                    min="1"
                    value={amount || ''}
                    onChange={e => setAmount(Number(e.target.value))}
                    className="w-full bg-[#121212] border border-white/5 rounded-2xl py-5 px-6 outline-none focus:border-[#E6D690]/40 text-xl font-black text-white"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#E6D690]">ملاحظة (اختياري)</label>
                  <input
                    placeholder="اكتب ملاحظة..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="w-full bg-[#121212] border border-white/5 rounded-2xl py-4 px-6 outline-none focus:border-[#E6D690]/40 text-sm"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-6 bg-[#E6D690] text-[#121212] font-black rounded-[2rem] text-md transition-all hover:bg-[#ffed9e] active:scale-95 shadow-xl shadow-[#E6D690]/10 flex items-center justify-center gap-3 disabled:opacity-50">
                  <CheckCircle2 size={20} />
                  {isSubmitting ? 'جاري التنفيذ...' : 'تأكيد العملية'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #121212; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1E1E1E; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #E6D690; }
      `}</style>
    </div>
  );
};

export default BarbersScreen;
