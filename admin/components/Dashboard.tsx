import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    TrendingUp, TrendingDown, DollarSign, Receipt, BarChart3,
    Users, Clock, Zap, Award, Target, LayoutDashboard,
    ArrowUpRight, ArrowDownRight, RefreshCw, AlertCircle, Calendar, Filter, ChevronRight, X
} from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell
} from 'recharts';
import adminApi from '../api/client';
import RevenueChart from './RevenueChart';
import BranchPerformance from './BranchPerformance';
import { getTodayISO } from '../utils/dateFormatter';

interface DashboardProps {
    isDarkMode: boolean;
    selectedBranch: string;
}

const Dashboard: React.FC<DashboardProps> = ({ isDarkMode, selectedBranch }) => {
    // 1. Date Filter State
    const [activePreset, setActivePreset] = useState('today');
    const [dateRange, setDateRange] = useState({
        start: getTodayISO(),
        end: getTodayISO()
    });

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<any>(null);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
    const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // 2. Popover & Local Filter State
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [tempActivePreset, setTempActivePreset] = useState(activePreset);
    const [tempDateRange, setTempDateRange] = useState(dateRange);
    const popoverRef = useRef<HTMLDivElement>(null);

    // 3. Draggable Button State
    const filterBtnRef = useRef<HTMLButtonElement>(null);
    const isDragging = useRef(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    const hasDragged = useRef(false);

    // Click outside handler
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                setIsFilterOpen(false);
            }
        };
        if (isFilterOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        } else {
            document.removeEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isFilterOpen]);

    // Drag Logic
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging.current || !filterBtnRef.current) return;

            e.preventDefault();
            hasDragged.current = true;

            const element = filterBtnRef.current;
            const rect = element.getBoundingClientRect();

            // Calculate new position
            let newX = e.clientX - dragOffset.current.x;
            let newY = e.clientY - dragOffset.current.y;

            // Clamp within viewport (10px padding)
            const padding = 10;
            const maxWidth = window.innerWidth - rect.width - padding;
            const maxHeight = window.innerHeight - rect.height - padding;

            newX = Math.min(Math.max(newX, padding), maxWidth);
            newY = Math.min(Math.max(newY, padding), maxHeight);

            // Apply new position
            element.style.left = `${newX}px`;
            element.style.top = `${newY}px`;
            element.style.bottom = 'auto';
            element.style.right = 'auto';
        };

        const handleMouseUp = () => {
            if (isDragging.current && filterBtnRef.current) {
                filterBtnRef.current.style.cursor = 'grab';
            }
            isDragging.current = false;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    // Helpers for date calculations
    const getRangeFromPreset = (preset: string) => {
        // All dates are Cairo-local via getTodayISO() — never raw UTC toISOString()
        const todayISO = getTodayISO(); // e.g. "2026-02-25" (Cairo)

        // Parse Cairo today as a plain date (avoid timezone drift)
        const [y, m, d] = todayISO.split('-').map(Number);
        const addDays = (days: number): string => {
            const dt = new Date(y, m - 1, d + days);
            const yy = dt.getFullYear();
            const mm = String(dt.getMonth() + 1).padStart(2, '0');
            const dd = String(dt.getDate()).padStart(2, '0');
            return `${yy}-${mm}-${dd}`;
        };

        switch (preset) {
            case 'today':
                return { start: todayISO, end: todayISO };
            case 'yesterday':
                return { start: addDays(-1), end: addDays(-1) };
            case '7days':
                return { start: addDays(-6), end: todayISO };
            case '30days':
                return { start: addDays(-29), end: todayISO };
            case 'month': {
                const firstOfMonth = `${y}-${String(m).padStart(2, '0')}-01`;
                return { start: firstOfMonth, end: todayISO };
            }
            case 'year': {
                const firstOfYear = `${y}-01-01`;
                return { start: firstOfYear, end: todayISO };
            }
            default:
                return null;
        }
    };

    const handlePresetChange = (preset: string) => {
        setActivePreset(preset);
        if (preset !== 'custom') {
            const range = getRangeFromPreset(preset);
            if (range) setDateRange(range);
        }
    };

    const handleTempPresetChange = (preset: string) => {
        setTempActivePreset(preset);
        if (preset !== 'custom') {
            const range = getRangeFromPreset(preset);
            if (range) setTempDateRange(range);
        }
    };

    const handleApplyFilter = () => {
        setActivePreset(tempActivePreset);
        setDateRange(tempDateRange);
        setIsFilterOpen(false);
    };

    const handleResetFilter = () => {
        const defaultPreset = 'month';
        setTempActivePreset(defaultPreset);
        const range = getRangeFromPreset(defaultPreset);
        if (range) setTempDateRange(range);
    };

    const fetchDashboardData = useCallback(async (isBackground = false) => {
        if (!isBackground) setIsLoading(true);
        setError(null);
        try {
            const response = await adminApi.get('/dashboard-v2/overview', {
                params: {
                    start_date: dateRange.start,
                    end_date: dateRange.end,
                    branch_id: selectedBranch !== 'All' ? selectedBranch : undefined
                }
            });
            setData(response.data);
            setLastUpdated(new Date());
        } catch (err: any) {
            console.error("Failed to fetch Dashboard V2 data:", err);
            setError("عذراً، حدث خطأ أثناء تحميل البيانات");
        } finally {
            if (!isBackground) setIsLoading(false);
        }
    }, [dateRange.start, dateRange.end, selectedBranch]);

    const handleManualRefresh = () => {
        fetchDashboardData();
        setupRefreshTimer();
    };

    const setupRefreshTimer = useCallback(() => {
        if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);

        const isLiveMode = activePreset === 'today' || activePreset === '7days';
        if (isLiveMode) {
            refreshIntervalRef.current = setInterval(() => {
                fetchDashboardData(true);
            }, 60000);
        }
    }, [activePreset, fetchDashboardData]);

    useEffect(() => {
        fetchDashboardData();
        setupRefreshTimer();

        return () => {
            if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
        };
    }, [fetchDashboardData, setupRefreshTimer]);

    if (isLoading && !data) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="w-12 h-12 border-4 border-[#E53935]/20 border-t-[#E53935] rounded-full animate-spin"></div>
                <p className="text-gray-500 animate-pulse font-medium">جاري تحضير التحليلات الفورية...</p>
            </div>
        );
    }

    if (error && !data) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4 text-center">
                <div className="p-4 bg-red-500/10 rounded-full">
                    <AlertCircle size={48} className="text-red-500" />
                </div>
                <div>
                    <h2 className="text-xl font-bold mb-2">فشل الاتصال بالنظام</h2>
                    <p className="text-gray-500 max-w-md">{error}</p>
                </div>
                <button
                    onClick={fetchDashboardData}
                    className="flex items-center gap-2 px-6 py-3 bg-[#E53935] text-white rounded-xl font-bold hover:bg-[#D32F2F] transition-all shadow-lg shadow-red-500/20"
                >
                    <RefreshCw size={18} />
                    إعادة المحاولة
                </button>
            </div>
        );
    }

    const { executive, branches, employees, operational } = data || {};

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('ar-EG', {
            style: 'decimal',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(val) + " ج.م";
    };

    const formatNumber = (val: number) => {
        return new Intl.NumberFormat('en-US').format(val);
    };

    // Calculate derived metrics
    const expenseRatio = executive?.total_revenue > 0
        ? (executive.total_expenses / executive.total_revenue) * 100
        : 0;
    const netMargin = executive?.total_revenue > 0
        ? (executive.net_profit / executive.total_revenue) * 100
        : 0;


    // Chart Data Preparation
    const branchChartData = (branches || []).map((b: any) => ({
        name: b.branch_name,
        revenue: b.revenue,
        expenses: b.expenses,
        profit: b.net_profit
    }));

    return (
        <main className={`admin-page-shell min-h-[calc(100vh-var(--app-header-height))] overflow-x-hidden relative pb-[40px] transition-colors duration-700 lg:px-8 ${isDarkMode ? 'bg-[#080808]' : 'bg-gray-50'}`}>
            {/* Background Cinematic Depth & Directional Lighting */}
            <div className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden">
                {/* Directional Lighting: Warm Right / Cool Left */}
                <div className={`absolute top-0 right-0 w-[40%] h-full blur-[160px] opacity-[0.06] ${isDarkMode ? 'bg-amber-600' : 'bg-amber-100'}`}></div>
                <div className={`absolute bottom-0 left-0 w-[40%] h-full blur-[160px] opacity-[0.06] ${isDarkMode ? 'bg-cyan-600' : 'bg-cyan-100'}`}></div>

                {/* Existing Auras */}
                <div className={`absolute top-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full blur-[120px] opacity-[0.05] ${isDarkMode ? 'bg-red-500' : 'bg-red-100'}`}></div>
                <div className={`absolute bottom-[-10%] left-[-10%] w-[600px] h-[600px] rounded-full blur-[120px] opacity-[0.05] ${isDarkMode ? 'bg-blue-500' : 'bg-blue-100'}`}></div>

                {/* Technical Grid Overlay */}
                <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full opacity-[0.02] ${isDarkMode ? 'bg-[radial-gradient(circle,rgba(255,255,255,0.1)_1px,transparent_1px)]' : 'bg-[radial-gradient(circle,rgba(0,0,0,0.05)_1px,transparent_1px)]'} bg-[size:32px_32px]`}></div>
            </div>

            <div className="max-w-[1600px] mx-auto w-full space-y-8">

                {/* 1) Executive Summary Row - Staggered 1 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 animate-in fade-in slide-in-from-bottom-3 duration-700 delay-0 fill-mode-both">
                    <StatCard
                        label="إجمالي الإيرادات"
                        value={executive?.total_revenue}
                        icon={<DollarSign className="text-white" />}
                        color="#E53935"
                        suffix=" ج.م"
                        growth={executive?.growth_rate_percent}
                        isDarkMode={isDarkMode}
                        insight="مقارنة بالفترة السابقة"
                    />
                    <StatCard
                        label="صافي الأرباح"
                        value={executive?.net_profit}
                        icon={<Target className="text-white" />}
                        color="#4CAF50"
                        suffix=" ج.م"
                        isDarkMode={isDarkMode}
                        insight={<>هامش الربح <span className="text-emerald-500 font-bold" dir="ltr">{netMargin.toFixed(1)}%</span></>}
                    />
                    <StatCard
                        label="عدد الفواتير"
                        value={executive?.invoice_count}
                        icon={<Receipt className="text-white" />}
                        color="#2196F3"
                        isDarkMode={isDarkMode}
                        insight="عدد العمليات المكتملة"
                    />
                    <StatCard
                        label="عدد الخدمات"
                        value={executive?.services_count}
                        icon={<Zap className="text-white" />}
                        color="#FFC107"
                        isDarkMode={isDarkMode}
                        insight="إجمالي الخدمات المنفذة"
                    />
                </div>

                {/* 2) Revenue Intelligence (Full Width) - Staggered 2 */}
                <div className="w-full animate-in fade-in slide-in-from-bottom-3 duration-700 delay-150 fill-mode-both">
                    <RevenueChart isDarkMode={isDarkMode} selectedBranch={selectedBranch} />
                </div>

                {/* 3) Split Section: Branch Intelligence & Top Professionals - Staggered 3 */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-8 pb-8 animate-in fade-in slide-in-from-bottom-3 duration-700 delay-300 fill-mode-both">

                    {/* Right: Branch Intelligence (7 cols on desktop, 6 on tablet) */}
                    <div className="md:col-span-6 lg:col-span-7 flex flex-col h-full min-h-[420px]">
                        <BranchPerformance isDarkMode={isDarkMode} dateRange={dateRange} />
                    </div>

                    {/* Left: Employee Leaderboard (5 cols on desktop, 6 on tablet) */}
                    <div className={`md:col-span-6 lg:col-span-5 p-8 rounded-3xl border h-full min-h-[420px] overflow-y-auto custom-scrollbar transition-all duration-500 ${isDarkMode ? 'bg-[#0a0a0a] border-white/5 hover:border-white/10' : 'bg-white border-black/5 shadow-xl shadow-black/5'}`}>
                        <div className="flex items-center justify-between mb-8 sticky top-0 z-10 p-1 backdrop-blur-md rounded-xl">
                            <div>
                                <h3 className={`text-xl font-bold mb-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>أفضل ٥ محترفين</h3>
                                <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>الترتيب حسب حجم المبيعات</p>
                            </div>
                            <div className="flex items-center gap-2 p-1.5 bg-gray-500/5 rounded-xl border border-white/5">
                                <Award size={16} className="text-[#E53935]" />
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-right" dir="rtl">
                                <thead>
                                    <tr className={`text-[10px] uppercase tracking-widest ${isDarkMode ? 'text-gray-500' : 'text-gray-400'} border-b ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
                                        <th className="pb-4 font-black pr-4">الموظف</th>
                                        <th className="pb-4 font-black">المبيعات</th>
                                        <th className="pb-4 font-black pl-4">الخدمات</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {(employees || []).slice(0, 5).map((emp: any, idx: number) => {
                                        const revPerHour = emp.hours_worked > 0 ? emp.revenue_generated / emp.hours_worked : 0;
                                        return (
                                            <tr key={emp.employee_id} className="group hover:bg-gray-500/5 transition-colors">
                                                <td className="py-4 pr-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold relative transition-all duration-500 ${idx === 0 ? 'bg-gradient-to-br from-[#E53935] to-[#FF5252] text-white ring-2 ring-yellow-500/50 shadow-[0_0_20px_rgba(229,57,53,0.3)]' : (isDarkMode ? 'bg-[#1A1A1A] text-gray-400' : 'bg-gray-100 text-gray-600')}`}>
                                                            {emp.name.substring(0, 2)}
                                                            {idx === 0 && <Award size={14} className="absolute -top-1.5 -right-1.5 text-yellow-500 drop-shadow-lg animate-pulse" />}
                                                        </div>
                                                        <div>
                                                            <p className={`text-sm font-bold transition-colors ${isDarkMode ? 'text-white/80' : 'text-gray-800'} ${idx === 0 ? 'text-yellow-500/90' : ''}`}>{emp.name}</p>
                                                            <p className={`text-[10px] font-medium transition-opacity duration-500 ${isDarkMode ? 'opacity-30' : 'opacity-40'}`}>محترف رئيسي</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className={`py-4 text-sm font-bold font-mono ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{formatNumber(emp.revenue_generated)} ج.م</td>
                                                <td className={`py-4 text-sm font-bold pl-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>{emp.services_count}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>


                </div>
            </div>
            {/* FLOATING FILTER DRAWER & BUTTON */}
            {/* 1. Floating Button (Draggable, Bottom-Left) */}
            <button
                ref={filterBtnRef}
                onMouseDown={(e) => {
                    if (!filterBtnRef.current) return;
                    isDragging.current = true;
                    hasDragged.current = false;
                    const rect = filterBtnRef.current.getBoundingClientRect();
                    dragOffset.current = {
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top
                    };
                    filterBtnRef.current.style.cursor = 'grabbing';
                }}
                onClick={() => {
                    if (hasDragged.current) return;
                    setTempActivePreset(activePreset);
                    setTempDateRange(dateRange);
                    setIsFilterOpen(true);
                }}
                className="fixed bottom-5 left-5 z-[9999] w-14 h-14 bg-[#0d0d0d]/80 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl flex items-center justify-center group transition-transform duration-100 cursor-grab"
                style={{ boxShadow: '0 0 40px rgba(0,0,0,0.5)' }}
            >
                <div className="absolute inset-0 bg-gradient-to-tr from-[#E53935]/20 to-transparent rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <Filter size={24} className="text-white group-hover:text-[#E53935] transition-colors" />
                <div className="absolute top-0 right-0 w-3 h-3 bg-[#E53935] rounded-full border-2 border-black"></div>
            </button>

            {/* 2. Filter Drawer */}
            {isFilterOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] animate-in fade-in duration-300"
                        onClick={() => setIsFilterOpen(false)}
                    ></div>

                    {/* Drawer Panel - MODERN ARABIC GLASS */}
                    <div className="fixed top-0 left-0 h-full w-full sm:w-[380px] bg-[#0f0f0f]/95 backdrop-blur-2xl border-r border-white/5 shadow-[20px_0_50px_rgba(0,0,0,0.5)] z-[10000] animate-in slide-in-from-left duration-500 ease-out overflow-y-auto">

                        <div className="p-8 relative">
                            {/* Modern Header */}
                            <div className="flex items-start justify-between mb-10 pl-2">
                                <div className="text-right w-full pr-4">
                                    <h1 className="text-3xl font-black text-white mb-1 tracking-tight">
                                        فلتر البيانات
                                    </h1>
                                    <p className="text-xs text-gray-400 font-bold opacity-60">
                                        تخصيص عرض التحليلات
                                    </p>
                                </div>
                                <button
                                    onClick={() => setIsFilterOpen(false)}
                                    className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all hover:scale-105 active:scale-95"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            {/* Modern Presets Grid */}
                            <div className="mb-10">
                                <div className="flex items-center justify-between mb-4 px-1">
                                    <span className="text-[10px] font-black text-[#E53935] uppercase tracking-widest bg-[#E53935]/10 px-2 py-1 rounded-lg">سريع</span>
                                    <h3 className="text-gray-400 text-xs font-bold text-right">الفترة الزمنية</h3>
                                </div>
                                <div className="grid grid-cols-2 gap-3" dir="rtl">
                                    {[
                                        { id: 'today', label: 'اليوم' },
                                        { id: 'yesterday', label: 'أمس' },
                                        { id: '7days', label: 'أخر ٧ أيام' },
                                        { id: '30days', label: 'أخر ٣٠ يوم' },
                                        { id: 'month', label: 'هذا الشهر' },
                                        { id: 'year', label: 'هذا العام' },
                                        { id: 'custom', label: 'فترة مخصصة' }
                                    ].map((period) => (
                                        <button
                                            key={period.id}
                                            onClick={() => handleTempPresetChange(period.id)}
                                            className={`relative overflow-hidden p-4 rounded-2xl text-xs font-bold transition-all duration-300 border flex items-center justify-center group ${tempActivePreset === period.id
                                                ? 'bg-gradient-to-br from-[#E53935] to-[#C62828] border-[#E53935] text-white shadow-[0_4px_20px_rgba(229,57,53,0.3)] transform scale-[1.02]'
                                                : 'bg-white/[0.03] border-white/[0.05] text-gray-400 hover:bg-white/[0.08] hover:text-white hover:border-white/10 hover:shadow-lg hover:shadow-black/20'
                                                }`}
                                        >
                                            <span className="relative z-10">{period.label}</span>
                                            {tempActivePreset !== period.id && (
                                                <div className="absolute inset-0 bg-gradient-to-tr from-white/[0.05] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Modern Custom Range Inputs */}
                            <div className={`overflow-hidden transition-all duration-500 ease-in-out ${tempActivePreset === 'custom' ? 'max-h-[300px] opacity-100 mb-10' : 'max-h-0 opacity-0'}`}>
                                <div className="p-1 rounded-3xl bg-gradient-to-br from-white/[0.05] to-transparent p-[1px]">
                                    <div className="bg-[#121212] rounded-[23px] p-5 text-right relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-20 h-20 bg-[#E53935]/10 blur-2xl rounded-full -mr-10 -mt-10 pointer-events-none"></div>

                                        <h3 className="text-gray-400 text-[10px] font-bold mb-4 relative z-10">تخصيص التاريخ</h3>
                                        <div className="space-y-4 relative z-10">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-bold text-gray-500 block">من تاريخ</label>
                                                <div className="relative group">
                                                    <input
                                                        type="date"
                                                        value={tempDateRange.start}
                                                        onChange={(e) => setTempDateRange(prev => ({ ...prev, start: e.target.value }))}
                                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs font-mono text-white focus:border-[#E53935] focus:bg-[#E53935]/5 outline-none transition-all text-right group-hover:border-white/20"
                                                    />
                                                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 w-4 h-4 pointer-events-none group-hover:text-[#E53935] transition-colors" />
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-bold text-gray-500 block">إلى تاريخ</label>
                                                <div className="relative group">
                                                    <input
                                                        type="date"
                                                        value={tempDateRange.end}
                                                        onChange={(e) => setTempDateRange(prev => ({ ...prev, end: e.target.value }))}
                                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs font-mono text-white focus:border-[#E53935] focus:bg-[#E53935]/5 outline-none transition-all text-right group-hover:border-white/20"
                                                    />
                                                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 w-4 h-4 pointer-events-none group-hover:text-[#E53935] transition-colors" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Modern Actions Footer */}
                            <div className="pt-4 mt-auto">
                                <button
                                    onClick={handleApplyFilter}
                                    className="relative w-full py-4 bg-gradient-to-r from-[#E53935] to-[#D32F2F] text-white rounded-2xl font-black text-sm hover:shadow-[0_8px_30px_rgba(229,57,53,0.4)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 mb-4 overflow-hidden group"
                                >
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-shimmer" />
                                    <span className="relative z-10">تطبيق الفلتر</span>
                                </button>

                                <button
                                    onClick={() => {
                                        handleResetFilter();
                                        setIsFilterOpen(false);
                                    }}
                                    className="w-full py-3 text-gray-500 hover:text-white font-bold text-xs transition-colors flex items-center justify-center gap-2 group rounded-xl hover:bg-white/5"
                                >
                                    <span>إعادة تعيين للافتراضي</span>
                                    <RefreshCw size={14} className="group-hover:-rotate-180 transition-transform duration-500 text-gray-600 group-hover:text-white" />
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </main>
    );
};

// --- Sub-Components ---

const StatCard = ({ label, value, icon, color, suffix = '', growth, isDarkMode, insight }: any) => {
    // Determine status for positive/negative growth
    const isPositive = growth !== undefined ? growth >= 0 : true;
    const trendColor = isPositive ? 'text-emerald-500' : 'text-red-500';

    // Determine Aura Color based on label/color
    const auraColor = useMemo(() => {
        // Special override: Revenue (even if Red prop) gets Green Aura
        if (label?.includes('الإيرادات')) return '16, 185, 129'; // Emerald
        if (color === '#4CAF50') return '16, 185, 129'; // Emerald
        if (color === '#2196F3') return '59, 130, 246'; // Blue
        if (color === '#FFC107') return '245, 158, 11'; // Amber
        if (growth !== undefined) return isPositive ? '16, 185, 129' : '239, 68, 68';
        return '156, 163, 175'; // Gray
    }, [color, label, growth, isPositive]);

    // 1. Kinetic Number Animation (CountUp)
    const [displayValue, setDisplayValue] = useState(0);

    useEffect(() => {
        const start = 0;
        const end = value || 0;
        const duration = 2000;
        const startTime = performance.now();

        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease Out Quint
            const ease = 1 - Math.pow(1 - progress, 5);

            setDisplayValue(start + (end - start) * ease);

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        requestAnimationFrame(animate);
    }, [value]);

    // 2. Parallax & 3D Tilt Effect
    const cardRef = useRef<HTMLDivElement>(null);
    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        // Max 2 degrees tilt for subtle effect
        const rotateX = ((y - centerY) / centerY) * -2;
        const rotateY = ((x - centerX) / centerX) * 2;

        cardRef.current.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.07) translateY(-6px)`;
        cardRef.current.style.zIndex = '50';
    };

    const handleMouseLeave = () => {
        if (!cardRef.current) return;
        cardRef.current.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1) translateY(0)`;
        cardRef.current.style.zIndex = '1';
    };

    return (
        <div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className={`relative p-6 rounded-[24px] border transition-all duration-400 ease-out group 
            ${isDarkMode
                    ? 'bg-[#151515] border-white/5 hover:border-[#E53935]/60 hover:shadow-[0_20px_50px_rgba(229,57,53,0.35)]'
                    : 'bg-white border-black/[0.04] hover:border-[#E53935]/40 hover:shadow-[0_20px_50px_rgba(229,57,53,0.25)]'
                }`}
            style={{
                willChange: 'transform',
                transformStyle: 'preserve-3d'
            }}
        >
            {/* Activation Overlay */}
            <div className="absolute inset-0 bg-[#E53935]/[0.08] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>

            {/* 0. Hover Cinematic Red Light Sweep */}
            {/* 0. Hover Cinematic Red Light Sweep */}
            <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
                <div className="light-sweep absolute top-0 left-0 w-[50%] h-full bg-gradient-to-r from-transparent via-[#E53935]/10 to-transparent skew-x-[-15deg] translate-x-[-100%]"></div>
            </div>

            {/* Hover Ambient Red Glow */}
            <div className="absolute -inset-1 bg-gradient-to-br from-[#E53935]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-2xl pointer-events-none"></div>
            {/* 0. Animated Background Aura */}
            <div
                className="absolute -inset-[50%] opacity-[0.12] pointer-events-none mix-blend-screen transition-opacity duration-1000"
                style={{
                    background: `radial-gradient(circle at center, rgba(${auraColor}, 0.8) 0%, transparent 60%)`,
                    backgroundSize: '120% 120%',
                    animation: 'auraMove 15s ease-in-out infinite alternate',
                    filter: 'blur(60px)',
                }}
            ></div>

            {/* Ambient Performance Glow */}
            {growth !== undefined && (
                <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
                    style={{
                        background: `radial-gradient(circle at center, ${isPositive ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'} 0%, transparent 70%)`
                    }}
                ></div>
            )}

            {/* Animated Subtle Gradient Border */}
            <div className="absolute inset-0 rounded-[24px] p-[1px] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                <div className={`absolute inset-0 rounded-[24px] opacity-20 ${isPositive ? 'bg-gradient-to-br from-emerald-500 to-transparent' : 'bg-gradient-to-br from-red-500 to-transparent'}`}></div>
            </div>

            {/* 1. Header: Label & Icon */}
            <div className="flex justify-between items-start mb-6 relative z-10 translate-z-[10px]">
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                        {/* Pulsing Status Dot */}
                        <div className="relative">
                            <div className={`w-1.5 h-1.5 rounded-full ${growth !== undefined ? (isPositive ? 'bg-emerald-500' : 'bg-red-500') : 'bg-gray-500'}`}></div>
                            <div className={`absolute inset-0 rounded-full animate-ping opacity-50 pulse-anim ${growth !== undefined ? (isPositive ? 'bg-emerald-500' : 'bg-red-500') : 'bg-gray-500'}`}></div>
                        </div>
                        <h3 className={`text-[10px] font-black uppercase tracking-[0.15em] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            {label}
                        </h3>
                    </div>
                </div>

                {/* Floating Icon with Background Light */}
                <div className="relative">
                    <div className={`absolute inset-0 blur-xl opacity-20 scale-150 ${isDarkMode ? 'bg-white' : 'bg-black'}`}></div>
                    <div className={`relative p-2 rounded-xl transition-all duration-500 group-hover:scale-110 group-hover:rotate-6
                        ${isDarkMode ? 'bg-white/[0.02] group-hover:bg-[#E53935]/20' : 'bg-gray-100/50 group-hover:bg-[#E53935]/10'} 
                        `}>
                        {React.cloneElement(icon as React.ReactElement, {
                            size: 16,
                            className: `transition-all duration-500 group-hover:text-[#E53935] group-hover:animate-icon-pulse ${isDarkMode ? 'text-gray-600 group-hover:drop-shadow-[0_0_8px_rgba(229,57,53,0.5)]' : 'text-gray-400 group-hover:drop-shadow-[0_0_8px_rgba(229,57,53,0.3)]'}`
                        })}
                    </div>
                </div>
            </div>

            {/* 2. Main Metric Number - Animated CountUp */}
            <div className="flex items-baseline gap-1 mb-3 relative z-10 translate-z-[15px]">
                <span
                    className={`text-4xl sm:text-5xl font-black tracking-tighter tabular-nums transition-all duration-300 group-hover:scale-[1.1] group-hover:text-[#E53935] group-hover:drop-shadow-[0_0_20px_rgba(229,57,53,0.5)] ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
                    style={{ fontFamily: 'Inter, sans-serif', transformOrigin: 'right center' }}
                >
                    {new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(displayValue)}
                </span>
                {suffix && <span className={`text-sm font-bold opacity-30 transition-all duration-500 group-hover:text-[#E53935] group-hover:opacity-60 ${isDarkMode ? 'text-white' : 'text-black'}`}>{suffix}</span>}
            </div>

            {/* 3. Trend Badge */}
            <div className="flex items-center gap-2 min-h-[20px] relative z-10 translate-z-[5px]">
                {growth !== undefined && (
                    <div className={`flex items-center gap-1 text-[10px] font-bold ${trendColor} ${isPositive ? 'bg-emerald-500/5' : 'bg-red-500/5'} px-2 py-0.5 rounded-full border border-opacity-10 border-current`}>
                        {isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        <span>{Math.abs(growth)}%</span>
                    </div>
                )}
            </div>

            {/* 4. Animated Energy Bar */}
            <div className="absolute bottom-0 left-0 w-full h-[2px] overflow-hidden bg-gray-500/5">
                {/* Flowing Energy Beam */}
                <div
                    className={`absolute top-0 left-0 h-full rounded-full 
                    ${growth !== undefined
                            ? (isPositive ? 'bg-gradient-to-r from-transparent via-emerald-500 to-emerald-300' : 'bg-gradient-to-r from-transparent via-red-500 to-red-300')
                            : 'bg-gradient-to-r from-transparent via-gray-500 to-gray-300'}`}
                    style={{
                        width: '100%',
                        transform: 'translateX(-100%)',
                        animation: 'energyFlow 3s infinite cubic-bezier(0.4, 0, 0.2, 1)'
                    }}
                ></div>
                {/* Static Baseline */}
                <div
                    className={`absolute top-0 left-0 h-full rounded-full opacity-30 transition-all duration-1000
                     ${growth !== undefined
                            ? (isPositive ? 'w-[70%] bg-emerald-500' : 'w-[40%] bg-red-500')
                            : 'w-[100%] bg-gray-500'}`}
                ></div>
            </div>

            <style>
                {`
                @keyframes energyFlow {
                    0% { transform: translateX(-100%); opacity: 0; }
                    50% { opacity: 0.8; }
                    100% { transform: translateX(100%); opacity: 0; }
                }
                @keyframes auraMove {
                    0% { transform: translate(-5%, -5%) scale(1); }
                    100% { transform: translate(5%, 5%) scale(1.15); }
                }
                @keyframes pulseStatus {
                    0% { transform: scale(1); opacity: 0.5; }
                    50% { transform: scale(1.5); opacity: 0; }
                    100% { transform: scale(1); opacity: 0.5; }
                }
                @keyframes iconPulse {
                    0% { transform: scale(1) rotate(6deg); }
                    50% { transform: scale(1.2) rotate(6deg); }
                    100% { transform: scale(1) rotate(6deg); }
                }
                .group-hover\\:animate-icon-pulse {
                    animation: iconPulse 0.4s ease-out;
                }
                @keyframes lightSweep {
                    0% { transform: translateX(-150%) skewX(-15deg); }
                    100% { transform: translateX(250%) skewX(-15deg); }
                }
                .group:hover .light-sweep {
                    animation: lightSweep 0.8s cubic-bezier(0.23, 1, 0.32, 1) forwards;
                }
                .pulse-anim {
                    animation: pulseStatus 2s infinite ease-out;
                }
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 10px;
                }
                .custom-scrollbar:hover::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.1);
                }
            `}
            </style>
        </div>
    );
};


export default Dashboard;
