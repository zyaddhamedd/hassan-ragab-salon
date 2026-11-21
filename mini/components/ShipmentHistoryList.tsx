import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock, Inbox, Loader2, Package2, RefreshCw, Truck, User } from 'lucide-react';
import { ShipmentHistoryResponse, ShipmentHistorySummary } from '../src/types/models';
import { apiClient } from '../src/api/client';

interface ShipmentHistoryListProps {
    onSelectShipment: (id: number) => void;
}

const formatDateTime = (iso: string | null) => {
    if (!iso) return '—';
    try {
        return new Intl.DateTimeFormat('ar-EG', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        }).format(new Date(iso));
    } catch {
        return '—';
    }
};

const formatRelativeTime = (iso: string | null): string => {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return '—';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return `منذ ${Math.max(1, minutes)} دقيقة`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `منذ ${hours} ساعة`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `منذ ${days} يوم`;
    const months = Math.floor(days / 30);
    return `منذ ${months} شهر`;
};

const ShipmentHistoryList: React.FC<ShipmentHistoryListProps> = ({ onSelectShipment }) => {
    const [data, setData] = useState<ShipmentHistoryResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [showAll, setShowAll] = useState(false);
    const perPage = 10;

    const load = useCallback(async (p: number) => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiClient.get(`/shipments/history?page=${p}&per_page=${perPage}&status=RECEIVED`);
            setData(res);
        } catch (err: any) {
            setError(err.message || 'حدث خطأ غير متوقع.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load(page);
    }, [page, load]);

    if (loading && !data) {
        return (
            <div className="flex h-64 flex-col items-center justify-center gap-4">
                <Loader2 size={32} className="animate-spin text-white/50" />
                <p className="text-[11px] font-bold tracking-widest text-white/30 uppercase">جاري التحميل</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-red-500/10 bg-red-500/5 py-12 text-center">
                <AlertCircle size={32} className="text-red-400" />
                <p className="text-sm font-semibold text-white/80">{error}</p>
                <button
                    onClick={() => load(page)}
                    className="mt-2 inline-flex items-center gap-2 rounded-xl bg-white/5 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-white/10"
                >
                    <RefreshCw size={14} />
                    إعادة المحاولة
                </button>
            </div>
        );
    }

    const shipments = data?.shipments || [];
    const pagination = data?.pagination;

    if (shipments.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-white/5 py-16 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
                    <Inbox size={28} className="text-white/20" />
                </div>
                <div>
                    <p className="text-sm font-semibold text-white/60">سجل الشحنات فارغ</p>
                    <p className="mt-1 text-xs font-medium text-white/30">لم يتم استلام أي شحنات في هذا الفرع بعد.</p>
                </div>
                <button
                    onClick={() => load(1)}
                    className="mt-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-white/40 transition hover:bg-white/10 hover:text-white"
                >
                    <RefreshCw size={16} />
                </button>
            </div>
        );
    }

        const displayedShipments = showAll ? shipments : shipments.slice(0, 3);

        return (
            <div className="space-y-4" dir="rtl">
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.04]">
                    <div className="flex items-center gap-4">
                        <h3 className="text-xs font-bold text-white/50 tracking-wider">سجل الشحنات المستلمة</h3>
                        {shipments.length > 3 && (
                            <span
                                onClick={() => setShowAll(!showAll)}
                                className="text-[10px] text-[#E6D690] font-bold cursor-pointer hover:underline"
                            >
                                {showAll ? 'عرض أقل' : 'عرض الكل'}
                            </span>
                        )}
                    </div>
                    <button
                        onClick={() => load(page)}
                        disabled={loading}
                        className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-[10px] font-bold text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                    >
                        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                        تحديث
                    </button>
                </div>

                <div className="space-y-2.5">
                    {displayedShipments.map((shipment) => (
                        <div
                            key={shipment.id}
                            className="group relative overflow-hidden rounded-xl border border-white/[0.03] border-r-2 border-r-emerald-500/20 bg-white/[0.005] hover:bg-white/[0.015] py-3.5 px-4 transition-all duration-300 hover:border-white/[0.07] hover:border-r-emerald-500/40 hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:-translate-y-0.5"
                        >
                            {/* Right side: Ref, Status, and Date */}
                            <div className="flex items-center flex-wrap gap-4">
                                <span className="font-mono text-xs font-semibold text-white/60 group-hover:text-[#E6D690] transition-colors duration-200">
                                    {shipment.shipment_ref}
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/10 bg-emerald-500/5 px-2 py-0.5 text-[9px] font-semibold text-emerald-400/80">
                                    تم الاستلام
                                </span>
                                <span className="text-[10px] text-white/30 font-medium">
                                    {formatDateTime(shipment.received_at)}
                                </span>
                            </div>

                            {/* Left side: Count and view details */}
                            <div className="flex items-center justify-between sm:justify-end gap-6 mt-2.5 sm:mt-0">
                                <span className="text-[10px] text-white/35 font-medium">
                                    {shipment.items_count} أصناف ({shipment.total_quantity} قطعة)
                                </span>
                                
                                <button
                                    onClick={() => onSelectShipment(shipment.id)}
                                    className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/10 px-3.5 text-[10px] font-bold text-white/80 hover:text-white transition-all shadow-sm"
                                >
                                    <span>التفاصيل</span>
                                    <ChevronLeft size={12} className="text-white/40 group-hover:text-white transition-transform group-hover:-translate-x-0.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Pagination Controls */}
                {showAll && pagination && pagination.pages > 1 && (
                    <div className="flex items-center justify-between pt-6">
                        <span className="text-[11px] font-semibold text-white/40">
                            صفحة {pagination.page} من {pagination.pages}
                        </span>
                        <div className="flex gap-2">
                            <button
                                disabled={!pagination.has_next}
                                onClick={() => setPage(p => p + 1)}
                                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-white/5"
                            >
                                <ChevronRight size={16} />
                            </button>
                            <button
                                disabled={!pagination.has_prev}
                                onClick={() => setPage(p => p - 1)}
                                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-white/5"
                            >
                                <ChevronLeft size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
};

export default ShipmentHistoryList;
