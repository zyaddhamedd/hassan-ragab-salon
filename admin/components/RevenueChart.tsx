import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2 } from 'lucide-react';
import adminApi from '../api/client';
import { formatDate } from '../utils/dateFormatter';

interface RevenueChartProps {
    isDarkMode: boolean;
    selectedBranch: string | null;
}

const RevenueChart: React.FC<RevenueChartProps> = ({ isDarkMode, selectedBranch }) => {
    const [data, setData] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [range, setRange] = useState('30d');

    useEffect(() => {
        fetchData();
    }, [range, selectedBranch]);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const response = await adminApi.get(`/analytics/revenue`, {
                params: {
                    range,
                    branch_id: selectedBranch === 'all' ? null : selectedBranch
                }
            });
            setData(response.data);
        } catch (error) {
            console.error("Failed to fetch revenue analytics", error);
        } finally {
            setIsLoading(false);
        }
    };

    // Custom Tooltip
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const revenue = payload[0].value;
            const netProfit = payload[1].value;
            const margin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
            const isForecast = payload[0].payload.isForecast;

            return (
                <div className={`p-4 rounded-xl border backdrop-blur-xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.9),0_0_20px_rgba(230,214,144,0.12)] transition-all duration-300 scale-in-sm ${isDarkMode ? 'bg-[#121215]/95 border-[#E6D690]/30 text-white' : 'bg-white/95 border-[#C5A880]/30 text-gray-900'
                    }`} dir="rtl">
                    <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2 mb-3">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#E6D690]">
                            {formatDate(label)}
                        </span>
                        {isForecast && (
                            <span className="text-[9px] font-bold bg-[#E6D690]/10 text-[#E6D690] border border-[#E6D690]/20 px-1.5 py-0.5 rounded-full">
                                متوقع
                            </span>
                        )}
                    </div>
                    <div className="flex flex-col gap-2.5 min-w-[190px]">
                        {/* Revenue Item */}
                        <div className="flex justify-between items-center group">
                            <span className="text-xs font-semibold flex items-center gap-2 text-gray-300">
                                <span className="w-2 h-2 rounded-full bg-[#E6D690] shadow-[0_0_8px_rgba(230,214,144,0.8)] shrink-0" />
                                <span>الإيرادات</span>
                            </span>
                            <span className="font-bold font-mono text-sm tracking-tight text-white" dir="ltr">
                                {new Intl.NumberFormat('ar-EG').format(revenue)} <span className="text-[10px] text-[#E6D690]">ج.م</span>
                            </span>
                        </div>

                        {/* Net Profit Item */}
                        <div className="flex justify-between items-center group">
                            <span className="text-xs font-semibold flex items-center gap-2 text-gray-300">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] shrink-0" />
                                <span>صافي الربح</span>
                            </span>
                            <span className="font-bold font-mono text-sm tracking-tight text-emerald-400" dir="ltr">
                                {new Intl.NumberFormat('ar-EG').format(netProfit)} <span className="text-[10px] text-emerald-400/80">ج.م</span>
                            </span>
                        </div>

                        {/* Margin Separator */}
                        <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-[#E6D690]/20 to-transparent my-0.5" />

                        {/* Margin */}
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">هامش الربح</span>
                            <span
                                className={`text-xs font-black px-2 py-0.5 rounded-md ${
                                    margin >= 0
                                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                                        : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                                }`}
                                dir="ltr"
                            >
                                {margin.toFixed(1)}%
                            </span>
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className={`relative p-8 rounded-[32px] border transition-all duration-700 overflow-hidden group/chart
            ${isDarkMode
                ? 'bg-[#0c0c0c] border-white/[0.05] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.8)]'
                : 'bg-white border-black/[0.04] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)]'}`}>

            {/* Inner Glass Highlight Border */}
            <div className={`absolute inset-0 rounded-[32px] border border-white/[0.03] pointer-events-none z-20`}></div>

            {/* Subtle Hero Gradient Background */}
            <div className={`absolute inset-0 opacity-[0.04] pointer-events-none ${isDarkMode ? 'bg-gradient-to-br from-[#E6D690] via-transparent to-emerald-500' : 'bg-gradient-to-br from-[#C5A880] via-transparent to-emerald-200'}`}></div>

            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 relative z-10" dir="rtl">
                <div className="space-y-0.5">
                    <h3 className={`text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        ذكاء الإيرادات
                    </h3>
                    <div className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#E6D690] opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#E6D690]"></span>
                        </span>
                        <p className={`text-[10px] font-bold uppercase tracking-wider opacity-60 ${isDarkMode ? 'text-[#E6D690]' : 'text-gray-500'}`}>
                            الأداء المالي المباشر · صالون حسن رجب
                        </p>
                    </div>
                </div>

                {/* Range Switcher */}
                <div className={`flex p-1 rounded-xl border ${isDarkMode ? 'bg-black/30 border-white/5' : 'bg-gray-100 border-black/5'}`}>
                    {[
                        { val: '7d', label: '٧ أيام' },
                        { val: '30d', label: '٣٠ يوم' },
                        { val: '90d', label: '٩٠ يوم' }
                    ].map((opt) => (
                        <button
                            key={opt.val}
                            onClick={() => setRange(opt.val)}
                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 cursor-pointer ${range === opt.val
                                ? (isDarkMode ? 'bg-gradient-to-r from-[#C5A880] to-[#E6D690] text-black font-extrabold shadow-md' : 'bg-black text-white shadow-md')
                                : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-800')
                                }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Chart */}
            <div className="h-[220px] sm:h-[260px] lg:h-[280px] w-full relative z-10" style={{ marginLeft: '-10px' }} dir="ltr">
                {isLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className={`w-8 h-8 animate-spin ${isDarkMode ? 'text-white/20' : 'text-black/20'}`} />
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                            key={`${range}-${selectedBranch}-${data.length}`}
                            data={data}
                            margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
                        >
                            <defs>
                                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#E6D690" stopOpacity={0.3} />
                                    <stop offset="100%" stopColor="#C5A880" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                                </linearGradient>
                                <filter id="glowRevenue" x="-20%" y="-20%" width="140%" height="140%">
                                    <feGaussianBlur stdDeviation="6" result="blur" />
                                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                </filter>
                                <filter id="glowProfit" x="-20%" y="-20%" width="140%" height="140%">
                                    <feGaussianBlur stdDeviation="6" result="blur" />
                                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                </filter>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#ffffff03' : '#00000003'} />
                            {/* X Axis: LTR for chart logic, format date in Arabic */}
                            <XAxis
                                dataKey="date"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: isDarkMode ? '#525252' : '#a3a3a3', fontSize: 10, fontWeight: 700, fontFamily: 'Inter' }}
                                tickFormatter={(val) => {
                                    return formatDate(val);
                                }}
                                dy={15}
                                minTickGap={30}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                orientation="right" // Right axis for Arabic feel
                                tick={{ fill: isDarkMode ? '#525252' : '#a3a3a3', fontSize: 10, fontWeight: 700, fontFamily: 'Inter' }}
                                tickFormatter={(val) => new Intl.NumberFormat('en-US', { notation: "compact", compactDisplay: "short" }).format(val)}
                                dx={10}
                            />
                            <Tooltip
                                content={<CustomTooltip />}
                                cursor={{
                                    stroke: isDarkMode ? 'rgba(230,214,144,0.15)' : '#00000008',
                                    strokeWidth: 60,
                                    className: "transition-all duration-700"
                                }}
                                isAnimationActive={true}
                                animationDuration={500}
                            />

                            {/* Revenue Line Glow (Hover Only) */}
                            <Area
                                type="monotone"
                                dataKey="revenue"
                                stroke="#E6D690"
                                strokeWidth={8}
                                strokeOpacity={0.2}
                                fill="none"
                                filter="url(#glowRevenue)"
                                className="opacity-0 group-hover/chart:opacity-100 transition-opacity duration-1000 pointer-events-none"
                                isAnimationActive={true}
                                animationBegin={3200}
                                animationDuration={1000}
                            />

                            {/* Revenue Main Line */}
                            <Area
                                type="monotone"
                                dataKey="revenue"
                                stroke="#E6D690"
                                strokeWidth={3}
                                fill="url(#colorRevenue)"
                                isAnimationActive={true}
                                animationBegin={800}
                                animationDuration={3200}
                                animationEasing="cubic-bezier(0.65, 0, 0.35, 1)"
                                activeDot={{ r: 8, strokeWidth: 0, fill: '#E6D690', className: "transition-all duration-500 shadow-[0_0_15px_rgba(230,214,144,0.8)]" }}
                            />

                            {/* Net Profit Line Glow (Hover Only) */}
                            <Area
                                type="monotone"
                                dataKey="net_profit"
                                stroke="#10b981"
                                strokeWidth={8}
                                strokeOpacity={0.15}
                                fill="none"
                                filter="url(#glowProfit)"
                                className="opacity-0 group-hover/chart:opacity-100 transition-opacity duration-1000 pointer-events-none"
                                isAnimationActive={true}
                                animationBegin={3500}
                                animationDuration={1000}
                            />

                            {/* Net Profit Main Line */}
                            <Area
                                type="monotone"
                                dataKey="net_profit"
                                stroke="#10b981"
                                strokeWidth={3}
                                fill="url(#colorProfit)"
                                isAnimationActive={true}
                                animationBegin={1000}
                                animationDuration={3500}
                                animationEasing="cubic-bezier(0.65, 0, 0.35, 1)"
                                activeDot={{ r: 8, strokeWidth: 0, fill: '#10b981', className: "transition-all duration-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]" }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>

            {/* Background Ambient Glow */}
            <div className={`absolute -top-[20%] -right-[20%] w-[500px] h-[500px] bg-[#E6D690]/[0.06] blur-[120px] rounded-full pointer-events-none transition-opacity duration-1000 mix-blend-screen ${isLoading ? 'opacity-0' : 'opacity-100'}`}></div>
            <div className={`absolute -bottom-[20%] -left-[20%] w-[500px] h-[500px] bg-emerald-500/[0.08] blur-[120px] rounded-full pointer-events-none transition-opacity duration-1000 mix-blend-screen ${isLoading ? 'opacity-0' : 'opacity-100'}`}></div>
        </div>
    );
};

export default RevenueChart;
