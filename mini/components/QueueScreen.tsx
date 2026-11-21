
import React, { useState, useEffect } from 'react';
import { Ticket, UserPlus, Volume2, RotateCcw, MapPin, Clock } from 'lucide-react';
import QueueTicket from './QueueTicket';
import { formatDate, formatTime } from '../src/utils/dateFormatter';

interface QueueData {
  lastIssued: number;
  currentCalled: number;
  date: string;
}

const QueueScreen: React.FC = React.memo(() => {
  const [queue, setQueue] = useState<QueueData>(() => {
    const saved = localStorage.getItem('smc_queue');
    const today = new Date().toLocaleDateString('en-US');

    if (saved) {
      const parsed: QueueData = JSON.parse(saved);
      if (parsed.date !== today) {
        return { lastIssued: 0, currentCalled: 0, date: today };
      }
      return parsed;
    }
    return { lastIssued: 0, currentCalled: 0, date: today };
  });

  const [isAnimating, setIsAnimating] = useState(false);
  const [lastPrintedTicket, setLastPrintedTicket] = useState<number | null>(null);

  useEffect(() => {
    localStorage.setItem('smc_queue', JSON.stringify(queue));
  }, [queue]);

  const issueNewTicket = () => {
    const newNumber = queue.lastIssued + 1;
    setQueue(prev => ({ ...prev, lastIssued: newNumber }));
    setLastPrintedTicket(newNumber);

    // الانتظار قليلاً للتأكد من تحديث الـ DOM ثم الطباعة
    setTimeout(() => {
      window.print();
    }, 100);
  };

  const callNext = () => {
    if (queue.currentCalled < queue.lastIssued) {
      setQueue(prev => ({ ...prev, currentCalled: prev.currentCalled + 1 }));
      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), 1000);
    }
  };

  const resetQueue = () => {
    if (window.confirm('هل أنت متأكد من تصفير عداد الانتظار بالكامل؟')) {
      setQueue(prev => ({ ...prev, lastIssued: 0, currentCalled: 0 }));
    }
  };

  const now = new Date();
  const dateStr = formatDate(now, {}, 'ar-EG');
  const timeStr = formatTime(now, { hour: '2-digit', minute: '2-digit' }, 'ar-EG');

  return (
    <div className="flex flex-col h-full bg-[#121212] font-['Cairo'] transition-all" dir="rtl">
      {/* Printable Area (Hidden in UI) */}
      <div className="hidden">
        {lastPrintedTicket && (
          <QueueTicket
            ticketNumber={lastPrintedTicket}
            date={dateStr}
            time={timeStr}
          />
        )}
      </div>

      {/* Header */}
      <header className="min-h-[5rem] px-4 lg:px-10 py-4 flex flex-wrap items-center justify-between gap-4 border-b bg-[#121212]/90 border-white/5 shrink-0 z-50">
        <div className="flex items-center gap-6">
          <div className="w-1 h-6 bg-[#E6D690] rounded-full shadow-[0_0_10px_#E6D690]"></div>
          <div className="flex flex-col">
            <h1 className="text-xl font-black text-white leading-none">نظام الانتظار</h1>
            <span className="text-[10px] font-bold text-[#E6D690] mt-1 opacity-70 tracking-tight flex items-center gap-1">
              <MapPin size={10} /> فرع الشيخ زايد
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right flex items-center gap-3 px-4 py-2 border border-white/5 bg-[#1E1E1E] rounded-xl">
            <Clock size={14} className="text-[#BDBDBD] opacity-40" />
            <span className="text-xs font-bold text-[#BDBDBD]">{formatDate(now, { weekday: 'long', day: 'numeric', month: 'long' }, 'ar-EG')}</span>
          </div>
          <button
            onClick={resetQueue}
            className="p-3 bg-white/5 border border-white/5 rounded-xl text-[#BDBDBD] hover:text-[#E53935] hover:bg-[#E53935]/5 transition-all"
            title="تصفير العداد"
          >
            <RotateCcw size={18} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 w-full max-w-5xl">

          {/* Now Serving Card */}
          <div className={`relative flex flex-col items-center justify-center p-12 rounded-[4rem] border transition-all duration-500 bg-[#1E1E1E] border-white/5 shadow-2xl overflow-hidden group ${isAnimating ? 'border-[#E6D690]/40 scale-[1.02]' : ''}`}>
            <div className="absolute top-0 right-0 w-48 h-48 bg-[#E6D690]/5 blur-[60px] rounded-full pointer-events-none"></div>
            <span className="text-xs font-black uppercase tracking-[0.3em] text-[#BDBDBD] opacity-40 mb-4">الرقم الحالي</span>
            <div className={`text-[12rem] font-black leading-none tracking-tighter transition-all duration-700 ${isAnimating ? 'text-[#E6D690] scale-110' : 'text-white'}`}>
              {queue.currentCalled.toString().padStart(2, '0')}
            </div>
            <div className="mt-8 flex items-center gap-3 px-8 py-3 bg-[#E6D690]/10 border border-[#E6D690]/20 rounded-2xl text-[#E6D690]">
              <Volume2 size={20} className={isAnimating ? 'animate-bounce' : ''} />
              <span className="text-sm font-black">نداء الرقم</span>
            </div>
          </div>

          {/* Latest Issued Card */}
          <div className="flex flex-col items-center justify-center p-12 rounded-[4rem] border transition-all duration-500 bg-[#1A1A1A]/50 border-white/5 group hover:border-white/10">
            <span className="text-xs font-black uppercase tracking-[0.3em] text-[#BDBDBD] opacity-40 mb-4">آخر تذكرة مسحوبة</span>
            <div className="text-[10rem] font-black leading-none tracking-tighter text-[#BDBDBD]/60 group-hover:text-[#BDBDBD] transition-colors">
              {queue.lastIssued.toString().padStart(2, '0')}
            </div>
            <div className="mt-8 text-xs font-bold text-[#BDBDBD] opacity-30 flex items-center gap-2">
              <Ticket size={14} />
              بانتظار {queue.lastIssued - queue.currentCalled} زبون
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-6 w-full max-w-2xl">
          <button
            onClick={issueNewTicket}
            className="flex-1 h-24 bg-[#1E1E1E] border border-white/5 hover:border-[#E6D690]/30 hover:bg-[#E6D690]/5 rounded-[2rem] flex items-center justify-center gap-4 transition-all active:scale-95 group"
          >
            <div className="p-4 bg-[#E6D690]/10 rounded-2xl group-hover:bg-[#E6D690] group-hover:text-[#121212] transition-colors">
              <UserPlus size={24} />
            </div>
            <div className="text-right">
              <p className="text-lg font-black text-white">سحب رقم جديد</p>
              <p className="text-[10px] font-bold text-[#BDBDBD] opacity-40">طباعة تذكرة الانتظار</p>
            </div>
          </button>

          <button
            onClick={callNext}
            disabled={queue.currentCalled >= queue.lastIssued}
            className={`flex-1 h-24 rounded-[2rem] flex items-center justify-center gap-4 transition-all active:scale-95 group ${queue.currentCalled >= queue.lastIssued ? 'bg-white/5 opacity-20 cursor-not-allowed' : 'bg-[#E53935] hover:bg-[#ff4040] shadow-[0_15px_30px_rgba(229,57,53,0.3)]'}`}
          >
            <div className="p-4 bg-black/20 rounded-2xl group-hover:bg-black/40 transition-colors">
              <Volume2 size={24} className="text-white" />
            </div>
            <div className="text-right">
              <p className="text-lg font-black text-white">نداء الرقم التالي</p>
              <p className="text-[10px] font-bold text-white/60">تحديث الرقم على الشاشة</p>
            </div>
          </button>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-only, .print-only * { visibility: visible; }
          .print-only { position: absolute; left: 0; top: 0; width: 100%; }
        }
        @keyframes pulse-glow {
          0% { box-shadow: 0 0 0 0 rgba(230, 214, 144, 0.4); }
          70% { box-shadow: 0 0 0 20px rgba(230, 214, 144, 0); }
          100% { box-shadow: 0 0 0 0 rgba(230, 214, 144, 0); }
        }
      `}</style>
    </div>
  );
});

export default QueueScreen;
