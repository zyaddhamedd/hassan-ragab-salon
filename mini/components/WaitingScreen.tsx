import React, { useState, useEffect } from 'react';
import { waitingClient } from '../src/api/client';
import { Ticket, RefreshCw, RotateCcw, Calendar, MapPin } from 'lucide-react';
import Logo from './Logo';
import { Cashier } from '../App';
import { getTodayISO, getCairoNow, formatDate, formatTime } from '../src/utils/dateFormatter';

interface WaitingScreenProps {
    cashier?: Cashier;
}

export default function WaitingScreen({ cashier }: WaitingScreenProps) {
    const [currentNumber, setCurrentNumber] = useState(0);
    const [lastTicket, setLastTicket] = useState<{ number: number, date: string } | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchCurrent();
    }, []);

    const fetchCurrent = async () => {
        try {
            const data = await waitingClient.getCurrent();
            setCurrentNumber(data.current_number);
        } catch (error) {
            console.error('Failed to fetch current number:', error);
        }
    };

    const handleDrawTicket = async () => {
        setLoading(true);
        try {
            const ticket = await waitingClient.draw();
            setLastTicket(ticket);
            setCurrentNumber(ticket.number);

            // Print logic
            setTimeout(() => {
                window.print();
            }, 100);

        } catch (error) {
            console.error('Failed to draw ticket:', error);
            alert('فشل سحب الرقم. حاول مرة أخرى.');
        } finally {
            setLoading(false);
        }
    };

    const handleReset = async () => {
        if (window.confirm('هل أنت متأكد من تصفير عداد الانتظار للكاشير والفرع الحالي؟')) {
            try {
                await waitingClient.reset();
                setCurrentNumber(0);
                setLastTicket(null);
                fetchCurrent();
            } catch (error) {
                console.error('Failed to reset:', error);
                alert('فشل تصفير العداد');
            }
        }
    };

    const now = new Date();
    const dateStr = formatDate(now, { weekday: 'long', day: 'numeric', month: 'long' }, 'ar-EG');

    return (
        <div className="flex flex-col h-full bg-[#121212] text-white p-10 font-['Cairo'] relative overflow-hidden">
            {/* Screen Content - Hidden when printing */}
            <div className="flex-1 flex flex-col items-center justify-center gap-10 z-10 print:hidden">

                <div className="text-center space-y-4">
                    <h1 className="text-4xl font-black text-[#E6D690] uppercase tracking-widest">نظام الانتظار</h1>

                    {/* Branch & Date Display */}
                    <div className="flex flex-col items-center gap-2">
                        <span className="text-sm font-bold text-[#E6D690] opacity-80 flex items-center gap-1 bg-[#E6D690]/10 px-3 py-1 rounded-full">
                            <MapPin size={12} /> {cashier?.branch_name || 'الفرع الرئيسي'}
                        </span>
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                            <Calendar size={12} /> {dateStr}
                        </span>
                    </div>
                </div>

                <div className="relative group">
                    <div className="absolute -inset-4 bg-gradient-to-r from-[#E6D690]/20 to-[#E6D690]/5 rounded-full blur-xl opacity-50 group-hover:opacity-100 transition-opacity"></div>
                    <div className="w-64 h-64 rounded-full border-4 border-[#E6D690] flex items-center justify-center bg-[#1E1E1E] shadow-2xl relative z-10">
                        <span className="text-9xl font-black text-white drop-shadow-[0_0_15px_rgba(230,214,144,0.3)]">
                            {currentNumber}
                        </span>
                    </div>
                </div>

                <div className="flex gap-4">
                    <button
                        onClick={handleDrawTicket}
                        disabled={loading}
                        className="py-4 px-12 bg-[#E6D690] text-[#121212] font-black rounded-2xl text-xl shadow-lg shadow-[#E6D690]/20 hover:bg-[#ffed9e] active:scale-95 transition-all flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? <RefreshCw className="animate-spin" /> : <Ticket size={24} />}
                        سحب رقم جديد
                    </button>

                    <button
                        onClick={fetchCurrent}
                        disabled={loading}
                        className="p-4 bg-[#1E1E1E] text-[#BDBDBD] rounded-2xl border border-white/5 hover:text-white hover:border-white/10 transition-all disabled:opacity-50"
                        title="تحديث"
                    >
                        <RefreshCw size={24} />
                    </button>

                    <button
                        onClick={handleReset}
                        disabled={loading}
                        className="p-4 bg-[#1E1E1E] text-[#BDBDBD] rounded-2xl border border-white/5 hover:text-[#E53935] hover:border-[#E53935]/30 hover:bg-[#E53935]/5 transition-all disabled:opacity-50"
                        title="تصفير العداد"
                    >
                        <RotateCcw size={24} />
                    </button>
                </div>

            </div>

            {/* Print Template - Visible ONLY when printing */}
            <div className="hidden print:flex flex-col items-center justify-start p-0 text-black bg-white fixed top-0 left-0 w-full h-screen z-[9999] print-template">
                <div className="w-[78mm] text-center flex flex-col items-center pt-2">
                    <div className="flex justify-center mb-1 filter grayscale scale-75">
                        <Logo />
                    </div>
                    <div className="mb-4">
                        <h2 className="text-xl font-bold font-['Cairo'] text-black">نادي الرجال السري</h2>
                        <p className="text-[10px] uppercase tracking-widest text-black">Nady El Regal El Serry</p>
                        {cashier?.branch_name && (
                            <p className="text-xs font-bold text-black mt-1">{cashier.branch_name}</p>
                        )}
                    </div>

                    <div className="w-full border-2 border-dashed border-black rounded-xl p-4 my-2 flex flex-col items-center justify-center">
                        <p className="text-lg font-bold mb-0 text-black">رقم الانتظار</p>
                        <p className="text-[80px] leading-tight font-black my-2 text-black">{lastTicket?.number || currentNumber}</p>
                        <p className="text-xs font-bold text-black">Waiting Ticket</p>
                    </div>

                    <div className="text-xs space-y-1 mt-2 text-black">
                        <p className="text-black">{lastTicket?.date || getTodayISO()}</p>
                        <p className="text-[10px] text-black">{formatTime(new Date(), { hour: '2-digit', minute: '2-digit' }, 'en-US')}</p>
                        <p className="mt-4 font-bold text-sm text-black">يرجى الانتظار حتى يتم استدعاء رقمك</p>
                    </div>

                    <p className="text-[10px] mt-6 opacity-60 text-black">شكراً لزيارتكم</p>
                </div>
            </div>

            <style>{`
                @media print {
                    @page { margin: 0; size: 80mm auto; }
                    body { visibility: hidden; background-color: white !important; }
                    .print-template { 
                        visibility: visible; 
                        position: fixed; 
                        left: 0; 
                        top: 0; 
                        width: 100%; 
                        height: 100%; 
                        justify-content: start; 
                        align-items: center; 
                        background: white; 
                        padding-top: 10px; 
                    }
                    .print-template * { 
                        visibility: visible; 
                        color: black !important; 
                    }
                }
            `}</style>
        </div>
    );
}
