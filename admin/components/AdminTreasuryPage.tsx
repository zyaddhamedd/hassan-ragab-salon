import React, { useState, useEffect } from 'react';
import adminApi from '../api/client';
import { RefreshCw, Wallet, ArrowDownRight, ArrowUpRight, Scale, FilterX, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import { formatDateTime } from '../utils/dateFormatter';
import { downloadBlob, getFilenameFromContentDisposition } from '../utils/fileDownload';

interface AdminTreasuryPageProps {
    isDarkMode: boolean;
    selectedBranch: string;
}

interface BusinessDayData {
    id: number;
    branch_id: number;
    branch_name: string;
    status: 'OPEN' | 'CLOSED';
    opened_at: string;
    closed_at: string | null;
    opened_by: string;
    closed_by: string | null;
    opening_balance: number;
    cash_in: number;
    visa_in: number;
    instapay_in: number;
    visa_collected?: number;
    instapay_collected?: number;
    visa_1_in?: number;
    visa_1_collected?: number;
    visa_2_in?: number;
    visa_2_collected?: number;
    actual_visa_1?: number;
    actual_visa_2?: number;
    cash_out: number;
    theoretical_balance: number;
    actual_balance: number | null;
    variance: number | null;
}

interface ClosingReportData {
    business_day_id: number;
    status: 'OPEN' | 'CLOSED';
    opened_at: string;
    closed_at: string | null;
    opening_balance: number;
    cash_in: number;
    visa_in: number;
    instapay_in: number;
    visa_collected?: number;
    instapay_collected?: number;
    visa_1_in?: number;
    visa_1_collected?: number;
    visa_2_in?: number;
    visa_2_collected?: number;
    actual_visa_1?: number;
    actual_visa_2?: number;
    daily_income: number;
    total_expenses: number;
    advance_total: number;
    overtime_total: number;
    commission_total: number;
    manual_expenses_total: number;
    theoretical_balance: number;
    actual_balance?: number;
    variance?: number;
    expected_cash?: number;
    expected_visa?: number;
    expected_instapay?: number;
}

const AdminTreasuryPage: React.FC<AdminTreasuryPageProps> = ({ isDarkMode, selectedBranch }) => {
    const [loading, setLoading] = useState(true);
    const [days, setDays] = useState<BusinessDayData[]>([]);
    const [isExporting, setIsExporting] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Get today's date in YYYY-MM-DD format
    const getTodayDate = () => {
        const today = new Date();
        return today.toISOString().split('T')[0];
    };

    const [startDate, setStartDate] = useState(getTodayDate());
    const [endDate, setEndDate] = useState(getTodayDate());
    const [selectedBusinessDay, setSelectedBusinessDay] = useState<BusinessDayData | null>(null);
    const [closingReport, setClosingReport] = useState<ClosingReportData | null>(null);
    const [reportLoading, setReportLoading] = useState(false);

    const parseExportErrorMessage = async (error: any): Promise<string> => {
        const responseData = error?.response?.data;

        if (responseData instanceof Blob) {
            try {
                const text = await responseData.text();
                if (!text) {
                    return 'تعذر تصدير الأيام المالية. حاول مرة أخرى.';
                }

                try {
                    const parsed = JSON.parse(text);
                    return parsed.error || parsed.message || parsed.details || 'تعذر تصدير الأيام المالية. حاول مرة أخرى.';
                } catch {
                    return text;
                }
            } catch {
                return 'تعذر تصدير الأيام المالية. حاول مرة أخرى.';
            }
        }

        return error?.response?.data?.error || error?.response?.data?.message || error?.message || 'تعذر تصدير الأيام المالية. حاول مرة أخرى.';
    };

    const fetchDays = async () => {
        setLoading(true);
        try {
            let url = '/business-days';
            const params = new URLSearchParams();

            if (selectedBranch && selectedBranch !== 'All') {
                params.append('branch_id', selectedBranch);
            }

            if (startDate) params.append('start_date', startDate);
            if (endDate) params.append('end_date', endDate);

            if (params.toString()) {
                url += `?${params.toString()}`;
            }

            const response = await adminApi.get(url);
            setDays(response.data);
        } catch (error) {
            console.error('Failed to fetch business days:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDays();
    }, [selectedBranch, startDate, endDate]);

    useEffect(() => {
        if (!toast) return;
        const timeout = window.setTimeout(() => setToast(null), 2800);
        return () => window.clearTimeout(timeout);
    }, [toast]);

    const handleRowClick = async (day: BusinessDayData) => {
        setSelectedBusinessDay(day);
        setClosingReport(null);
        setReportLoading(true);
        try {
            const response = await adminApi.get(`/business-days/${day.id}/closing-report`);
            setClosingReport(response.data);
        } catch (error) {
            console.error('Failed to fetch closing report:', error);
        } finally {
            setReportLoading(false);
        }
    };

    const handleCloseReportModal = () => {
        setSelectedBusinessDay(null);
        setClosingReport(null);
    };

    // Aggregate metrics visually (only CLOSED days for Variance, ALL for cash in/out)
    const totalCashIn = days.reduce((sum, d) => sum + (d.cash_in || 0), 0);
    const totalVisaIn = days.reduce((sum, d) => sum + (d.visa_collected ?? d.visa_in ?? 0), 0);
    const totalInstapayIn = days.reduce((sum, d) => sum + (d.instapay_collected ?? d.instapay_in ?? 0), 0);
    const totalCashOut = days.reduce((sum, d) => sum + (d.cash_out || 0), 0);
    const totalVariance = days.filter(d => d.status === 'CLOSED').reduce((sum, d) => sum + (d.variance || 0), 0);

    const handleExport = async () => {
        if (isExporting) {
            return;
        }

        setIsExporting(true);
        try {
            const response = await adminApi.get('/business-days/export/xlsx', {
                params: {
                    branch_id: selectedBranch !== 'All' ? selectedBranch : undefined,
                    start_date: startDate || undefined,
                    end_date: endDate || undefined
                },
                responseType: 'blob'
            });

            const filename = getFilenameFromContentDisposition(response.headers['content-disposition']) || 'Treasury_Business_Days.xlsx';
            const blob = response.data instanceof Blob ? response.data : new Blob([response.data]);
            downloadBlob(blob, filename);
            setToast({ type: 'success', message: 'تم بدء تنزيل ملف Excel للأيام المالية.' });
        } catch (error: any) {
            console.error('Failed to export business days:', error);
            setToast({ type: 'error', message: await parseExportErrorMessage(error) });
        } finally {
            setIsExporting(false);
        }
    };


    return (
        <div className={`admin-page-shell min-h-[calc(100vh-var(--app-header-height))] sm:px-6 lg:px-8 ${isDarkMode ? 'text-white' : 'text-gray-900'}`} dir="rtl">
            {/* Header Info */}
            <div className="mb-8 flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-[#E53935]/10 text-[#E53935]' : 'bg-red-50 text-red-600'}`}>
                            <Wallet size={24} />
                        </div>
                        الرقابة المالية والخزينة
                    </h1>
                    <p className={`mt-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        متابعة حركة الأيام المالية، العجز، والزيادة عبر كافة الفروع.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${isDarkMode ? 'bg-[#1E1E1E] border-white/10' : 'bg-white border-gray-200'}`}>
                        <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>من:</span>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className={`bg-transparent outline-none text-sm font-mono ${isDarkMode ? '[color-scheme:dark]' : ''}`}
                        />
                    </div>
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${isDarkMode ? 'bg-[#1E1E1E] border-white/10' : 'bg-white border-gray-200'}`}>
                        <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>إلى:</span>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className={`bg-transparent outline-none text-sm font-mono ${isDarkMode ? '[color-scheme:dark]' : ''}`}
                        />
                    </div>
                    {(startDate || endDate) && (
                        <button
                            onClick={() => { setStartDate(''); setEndDate(''); }}
                            className={`p-2 rounded-xl border transition-colors ${isDarkMode ? 'border-white/10 hover:bg-white/5 text-gray-400' : 'border-gray-200 hover:bg-gray-50 text-gray-500'}`}
                            title="مسح الفلاتر"
                        >
                            <FilterX size={20} />
                        </button>
                    )}
                    <button
                        onClick={fetchDays}
                        className={`p-2 rounded-xl border transition-colors ${loading ? 'opacity-50' : ''} ${isDarkMode ? 'border-white/10 hover:bg-white/5 text-gray-400' : 'border-gray-200 hover:bg-gray-50 text-gray-500'}`}
                    >
                        <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className={`px-4 py-2 rounded-xl border transition-colors flex items-center gap-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${isDarkMode ? 'border-white/10 hover:bg-white/5 text-white bg-[#1E1E1E]' : 'border-gray-200 hover:bg-gray-50 text-gray-900 bg-white'}`}
                    >
                        {isExporting ? (
                            <>
                                <RefreshCw size={16} className="animate-spin" />
                                جاري التصدير...
                            </>
                        ) : (
                            <>
                                <Download size={16} />
                                Export Excel
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Aggregate KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className={`p-6 rounded-2xl border relative overflow-hidden flex flex-col justify-between h-32 ${isDarkMode ? 'bg-[#1E1E1E] border-white/5' : 'bg-white border-gray-100 shadow-sm'}`}>
                    <div className="absolute left-0 top-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl -translate-x-12 -translate-y-12"></div>
                    <div className="flex justify-between items-start z-10 relative">
                        <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>إجمالي الإيرادات (للفترة)</span>
                        <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
                            <ArrowDownRight size={18} />
                        </div>
                    </div>
                    <div className="z-10 relative text-2xl font-bold tracking-tight" dir="ltr">
                        {totalCashIn.toFixed(2)} <span className="text-sm font-normal text-gray-500">EGP</span>
                    </div>
                </div>

                <div className={`p-6 rounded-2xl border relative overflow-hidden flex flex-col justify-between h-32 ${isDarkMode ? 'bg-[#1E1E1E] border-white/5' : 'bg-white border-gray-100 shadow-sm'}`}>
                    <div className="absolute left-0 top-0 w-24 h-24 bg-orange-500/10 rounded-full blur-2xl -translate-x-12 -translate-y-12"></div>
                    <div className="flex justify-between items-start z-10 relative">
                        <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>إجمالي المصروفات النقدية</span>
                        <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-orange-500/10 text-orange-400' : 'bg-orange-50 text-orange-600'}`}>
                            <ArrowUpRight size={18} />
                        </div>
                    </div>
                    <div className="z-10 relative text-2xl font-bold tracking-tight" dir="ltr">
                        {totalCashOut.toFixed(2)} <span className="text-sm font-normal text-gray-500">EGP</span>
                    </div>
                </div>

                <div className={`p-6 rounded-2xl border relative overflow-hidden flex flex-col justify-between h-32 ${isDarkMode ? 'bg-[#1E1E1E] border-white/5' : 'bg-white border-gray-100 shadow-sm'}`}>
                    <div className={`absolute left-0 top-0 w-24 h-24 rounded-full blur-2xl -translate-x-12 -translate-y-12 ${totalVariance >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}></div>
                    <div className="flex justify-between items-start z-10 relative">
                        <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>صافي العجز / الزيادة (للأيام المغلقة)</span>
                        <div className={`p-2 rounded-lg ${totalVariance >= 0 ? (isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600') : (isDarkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600')}`}>
                            <Scale size={18} />
                        </div>
                    </div>
                    <div className={`z-10 relative text-2xl font-bold tracking-tight ${totalVariance > 0 ? 'text-emerald-500' : totalVariance < 0 ? 'text-red-500' : ''}`} dir="ltr">
                        {totalVariance > 0 ? '+' : ''}{totalVariance.toFixed(2)} <span className="text-sm font-normal text-gray-500">EGP</span>
                    </div>
                </div>
            </div>

            {/* Main Table */}
            <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-[#1E1E1E] border-white/5' : 'bg-white border-gray-100 shadow-sm'}`}>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs text-right">
                        <thead className={`text-xs uppercase bg-black/20 ${isDarkMode ? 'text-gray-400' : 'text-gray-500 bg-gray-50 border-b border-gray-100'}`}>
                            <tr>
                                <th className="px-3 py-2 font-semibold whitespace-nowrap">حالة</th>
                                <th className="px-3 py-2 font-semibold whitespace-nowrap">رقم اليومية</th>
                                <th className="px-3 py-2 font-semibold whitespace-nowrap">الفرع</th>
                                <th className="px-3 py-2 font-semibold whitespace-nowrap">اليوم</th>
                                <th className="px-3 py-2 font-semibold whitespace-nowrap">الكاشير</th>
                                <th className="px-3 py-2 font-semibold whitespace-nowrap text-left">النقد</th>
                                <th className="px-3 py-2 font-semibold whitespace-nowrap text-left">Visa (محصل)</th>
                                <th className="px-3 py-2 font-semibold whitespace-nowrap text-left">Instapay (محصل)</th>
                                <th className="px-3 py-2 font-semibold whitespace-nowrap text-left">المصروفات</th>
                                <th className="px-3 py-2 font-semibold whitespace-nowrap text-left">الدفتري</th>
                                <th className="px-3 py-2 font-semibold whitespace-nowrap text-left">الفعلي</th>
                                <th className="px-3 py-2 font-semibold whitespace-nowrap text-center">العجز / الزيادة</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {days.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={12} className="px-6 py-12 text-center text-gray-500">
                                        لا توجد أيام مالية مطابقة للبحث.
                                    </td>
                                </tr>
                            )}
                            {days.map((day) => {
                                const isOpen = day.status === 'OPEN';
                                const dayDate = new Date(day.opened_at);
                                const dayName = new Intl.DateTimeFormat('ar-EG', { weekday: 'long' }).format(dayDate);
                                const dateStr = dayDate.toLocaleDateString('ar-EG');

                                // Variance badge logic
                                let varBadgeColor = 'bg-gray-500/20 text-gray-400';
                                if (!isOpen) {
                                    if (day.variance === 0) varBadgeColor = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
                                    else if (Math.abs(day.variance || 0) <= 50) varBadgeColor = 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30';
                                    else varBadgeColor = 'bg-red-500/20 text-red-500 border border-red-500/30';
                                }

                                return (
                                    <tr
                                        key={day.id}
                                        onClick={() => handleRowClick(day)}
                                        className={`transition-colors cursor-pointer ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
                                    >
                                        <td className="px-3 py-2">
                                            {isOpen ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                                    <span className="w-1 h-1 rounded-full bg-blue-500 animate-pulse"></span>
                                                    Live
                                                </span>
                                            ) : (
                                                <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${isDarkMode ? 'bg-white/5 text-gray-400' : 'bg-gray-100 text-gray-600'}`}>
                                                    مغلق
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 font-mono font-bold whitespace-nowrap" dir="ltr">{day.id}</td>
                                        <td className="px-3 py-2 font-medium whitespace-nowrap">{day.branch_name}</td>
                                        <td className="px-3 py-2 text-xs font-mono whitespace-nowrap" dir="ltr">{dayName} {dateStr}</td>
                                        <td className="px-3 py-2 text-xs whitespace-nowrap">{day.opened_by}</td>
                                        <td className="px-3 py-2 text-left font-mono font-medium text-emerald-500 whitespace-nowrap" dir="ltr">{day.cash_in?.toFixed(2)}</td>
                                        <td className="px-3 py-2 text-left font-mono font-medium text-blue-500 whitespace-nowrap" dir="ltr">{(day.visa_collected ?? day.visa_in ?? 0).toFixed(2)}</td>
                                        <td className="px-3 py-2 text-left font-mono font-medium text-purple-500 whitespace-nowrap" dir="ltr">{(day.instapay_collected ?? day.instapay_in ?? 0).toFixed(2)}</td>
                                        <td className="px-3 py-2 text-left font-mono font-medium text-orange-500 whitespace-nowrap" dir="ltr">{day.cash_out?.toFixed(2)}</td>
                                        <td className="px-3 py-2 text-left font-mono font-bold whitespace-nowrap" dir="ltr">{day.theoretical_balance?.toFixed(2)}</td>
                                        <td className={`px-3 py-2 text-left font-mono font-bold whitespace-nowrap ${isOpen ? 'text-gray-500' : ''}`} dir="ltr">
                                            {isOpen ? '--' : day.actual_balance?.toFixed(2)}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            {isOpen ? (
                                                <span className="text-gray-500 font-mono text-xs">--</span>
                                            ) : (
                                                <span className={`inline-flex px-2 py-1 rounded text-xs font-mono font-bold w-[70px] justify-center ${varBadgeColor}`} dir="ltr">
                                                    {(day.variance || 0) > 0 ? '+' : ''}{(day.variance || 0).toFixed(2)}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Closing Report Modal */}
            {selectedBusinessDay && (
                <div
                    className="admin-overlay-shell admin-overlay-shell--scroll z-50 bg-black/60 backdrop-blur-sm"
                    onClick={handleCloseReportModal}
                    dir="rtl"
                >
                    <div
                        className={`admin-overlay-panel my-auto w-full max-w-3xl rounded-[2rem] border shadow-2xl ${isDarkMode ? 'bg-gray-900 border-white/10' : 'bg-white border-gray-200'}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className={`sticky top-0 z-10 border-b px-5 py-5 sm:px-6 ${isDarkMode ? 'border-red-700/30 bg-[#0b0b0b]/90' : 'border-red-200 bg-red-50/95'}`}>
                            <div className="flex justify-between items-start">
                                <div>
                                    <h2 className={`mb-2 text-lg font-bold sm:text-xl ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>تقرير إقفال الخزينة</h2>
                                    <p className={`text-sm ${isDarkMode ? 'text-red-300' : 'text-red-600'}`}>
                                        يومية #{selectedBusinessDay?.id} • {selectedBusinessDay?.branch_name} • {new Date(selectedBusinessDay?.opened_at || '').toLocaleDateString('ar-EG')}
                                    </p>
                                </div>
                                <button
                                    onClick={handleCloseReportModal}
                                    className={`rounded-full p-2 text-xl font-bold transition-colors ${isDarkMode ? 'text-red-300 hover:bg-white/5 hover:text-white' : 'text-red-600 hover:bg-red-100 hover:text-red-800'}`}
                                >
                                    ✕
                                </button>
                            </div>
                        </div>

                        {/* Modal Content */}
                        {reportLoading ? (
                            <div className="p-8 text-center">
                                <div className={`inline-block animate-spin rounded-full h-8 w-8 border-b-2 ${isDarkMode ? 'border-red-400' : 'border-red-600'}`}></div>
                                <p className="mt-2">جاري تحميل التقرير...</p>
                            </div>
                        ) : closingReport ? (
                            <div className="admin-overlay-body p-5 sm:p-6">
                                <div className="space-y-4 sm:space-y-6">
                                    {/* Daily Income Section */}
                                    <div className={`rounded-2xl p-4 sm:p-5 ${isDarkMode ? 'bg-[#0b0b0b]/60 border border-red-900/10' : 'bg-red-50'}`}>
                                        <h3 className="font-bold text-red-400 mb-3 flex items-center gap-2">📥 دخل اليوم</h3>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between">
                                                <span>النقد</span>
                                                <span className="font-mono font-bold text-red-300">{closingReport.cash_in?.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>إجمالي فيزا (محصل)</span>
                                                <span className="font-mono font-bold text-red-300">{(closingReport.visa_collected ?? closingReport.visa_in ?? 0).toFixed(2)}</span>
                                            </div>
                                            {((closingReport.visa_1_collected ?? closingReport.visa_1_in ?? 0) > 0 || (closingReport.visa_2_collected ?? closingReport.visa_2_in ?? 0) > 0) && (
                                                <div className="mr-3 space-y-1 text-xs opacity-75">
                                                    <div className="flex justify-between">
                                                        <span>- فيزا 1:</span>
                                                        <span className="font-mono">{(closingReport.visa_1_collected ?? closingReport.visa_1_in ?? 0).toFixed(2)}</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span>- فيزا 2:</span>
                                                        <span className="font-mono">{(closingReport.visa_2_collected ?? closingReport.visa_2_in ?? 0).toFixed(2)}</span>
                                                    </div>
                                                </div>
                                            )}
                                            <div className="flex justify-between">
                                                <span>إنستاباي (محصل)</span>
                                                <span className="font-mono font-bold text-red-300">{(closingReport.instapay_collected ?? closingReport.instapay_in ?? 0).toFixed(2)}</span>
                                            </div>
                                            <div className={`flex justify-between pt-2 border-t ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
                                                <span className="font-bold">إجمالي الدخل</span>
                                                <span className="font-mono font-bold text-lg text-red-400">{closingReport.daily_income?.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Expenses Section */}
                                    <div className={`rounded-2xl p-4 sm:p-5 ${isDarkMode ? 'bg-[#0b0b0b]/60 border border-red-900/10' : 'bg-red-50'}`}>
                                        <h3 className="font-bold text-red-400 mb-3 flex items-center gap-2">📤 المصروفات</h3>
                                        <div className="space-y-2 text-sm">
                                            {closingReport.advance_total > 0 && (
                                                <div className="flex justify-between">
                                                    <span>السلفيات</span>
                                                    <span className="font-mono">{closingReport.advance_total?.toFixed(2)}</span>
                                                </div>
                                            )}
                                            {closingReport.overtime_total > 0 && (
                                                <div className="flex justify-between">
                                                    <span>الإضافي</span>
                                                    <span className="font-mono">{closingReport.overtime_total?.toFixed(2)}</span>
                                                </div>
                                            )}
                                            {closingReport.commission_total > 0 && (
                                                <div className="flex justify-between">
                                                    <span>العمولة</span>
                                                    <span className="font-mono">{closingReport.commission_total?.toFixed(2)}</span>
                                                </div>
                                            )}
                                            {closingReport.manual_expenses_total > 0 && (
                                                <div className="flex justify-between">
                                                    <span>مصروفات أخرى</span>
                                                    <span className="font-mono">{closingReport.manual_expenses_total?.toFixed(2)}</span>
                                                </div>
                                            )}
                                            <div className={`flex justify-between pt-2 border-t ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
                                                <span className="font-bold">الإجمالي</span>
                                                <span className="font-mono font-bold text-red-400">{closingReport.total_expenses?.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Net Daily Section */}
                                    <div className={`rounded-2xl p-4 sm:p-5 ${isDarkMode ? 'bg-[#0b0b0b]/60 border border-red-900/10' : 'bg-red-50'}`}>
                                        <h3 className="font-bold text-red-400 mb-3 flex items-center gap-2">💰 صافي الدخل</h3>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between">
                                                <span>الدخل اليومي</span>
                                                <span className="font-mono font-bold">{closingReport.daily_income?.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>المصروفات</span>
                                                <span className="font-mono font-bold">- {closingReport.total_expenses?.toFixed(2)}</span>
                                            </div>
                                            <div className={`flex justify-between pt-2 border-t ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
                                                <span className="font-bold">الصافي</span>
                                                <span className="font-mono font-bold text-lg text-red-400">{(closingReport.daily_income - closingReport.total_expenses)?.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Register Balance Section removed per user request */}

                                    {/* Close Button */}
                                    <button
                                        onClick={handleCloseReportModal}
                                        className={`w-full rounded-xl px-4 py-3 font-bold transition-colors ${isDarkMode ? 'bg-red-700 hover:bg-red-600 text-white' : 'bg-red-600 hover:bg-red-700 text-white'}`}
                                    >
                                        إغلاق
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="p-8 text-center text-red-500">
                                فشل في تحميل التقرير. يرجى المحاولة مرة أخرى.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {toast && (
                <div className="fixed bottom-8 left-8 z-[160] animate-toast-in">
                    <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-[11px] font-black shadow-2xl ${toast.type === 'success'
                        ? isDarkMode
                            ? 'border-emerald-500/25 bg-[#101917] text-emerald-300'
                            : 'border-emerald-100 bg-white text-emerald-700'
                        : isDarkMode
                            ? 'border-red-500/25 bg-[#1A1111] text-red-300'
                            : 'border-red-100 bg-white text-red-600'
                        }`}
                    >
                        {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                        <span>{toast.message}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminTreasuryPage;
