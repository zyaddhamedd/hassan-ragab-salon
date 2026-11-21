import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, TrendingDown, Award } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import adminApi from '../api/client';

interface BranchPerformanceProps {
    isDarkMode: boolean;
    dateRange: { start: string; end: string };
}

const BranchPerformance: React.FC<BranchPerformanceProps> = ({ isDarkMode, dateRange }) => {
    const [branches, setBranches] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        fetchData();
    }, [dateRange]);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const response = await adminApi.get('/analytics/branch-performance', {
                params: {
                    start_date: dateRange.start,
                    end_date: dateRange.end
                }
            });
            setBranches(response.data);
        } catch (error) {
            console.error("Failed to fetch branch performance", error);
        } finally {
            setIsLoading(false);
        }
    };

    // Circular Progress Component
    const PerformanceRing = ({ score }: { score: number }) => {
        const radius = 28;
        const stroke = 6;
        const normalizedRadius = radius - stroke * 2;
        const circumference = normalizedRadius * 2 * Math.PI;
        const strokeDashoffset = circumference - (score / 100) * circumference;

        // Determine color based on score
        let color = '#ef4444'; // Red < 60
        if (score >= 80) color = '#10b981'; // Green
        else if (score >= 60) color = '#fbbf24'; // Yellow

        return (
            <div className="relative flex items-center justify-center">
                <svg
                    height={radius * 2}
                    width={radius * 2}
                    className="transform -rotate-90"
                >
                    <circle
                        stroke={isDarkMode ? '#333' : '#e5e7eb'}
                        strokeWidth={stroke}
                        fill="transparent"
                        r={normalizedRadius}
                        cx={radius}
                        cy={radius}
                    />
                    <circle
                        stroke={color}
                        strokeWidth={stroke}
                        strokeDasharray={circumference + ' ' + circumference}
                        style={{ strokeDashoffset, transition: 'stroke-dashoffset 1s ease-in-out' }}
                        strokeLinecap="round"
                        fill="transparent"
                        r={normalizedRadius}
                        cx={radius}
                        cy={radius}
                    />
                </svg>
                <div className="absolute flex flex-col items-center">
                    <span className={`text-xs font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{score}</span>
                </div>
            </div>
        );
    };


    if (isLoading && branches.length === 0) {
        return (
            <div className={`p-8 rounded-3xl border w-full h-full min-h-[420px] ${isDarkMode ? 'bg-[#0a0a0a] border-white/5' : 'bg-slate-50 border-black/5 shadow-xl shadow-black/5'}`}>
                <div className="animate-pulse space-y-4">
                    <div className="h-6 bg-gray-500/10 rounded w-1/4"></div>
                    <div className="h-32 bg-gray-500/5 rounded-2xl w-full"></div>
                    <div className="h-32 bg-gray-500/5 rounded-2xl w-full"></div>
                </div>
            </div>
        );
    }

    return (
        <div className={`p-8 rounded-3xl border w-full h-full min-h-[420px] transition-all duration-300 ${isDarkMode ? 'bg-[#0a0a0a] border-white/5' : 'bg-slate-50 border-black/5 shadow-xl shadow-black/5'}`}>
            <div className="flex items-center justify-between mb-8">
                <h3 className={`text-xl font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    <BarChart3 className="text-[#E53935]" size={24} />
                    أداء الفروع
                </h3>
                <span className="px-3 py-1 bg-[#E53935]/10 text-[#E53935] rounded-full text-[10px] font-bold uppercase tracking-wider">
                    تصنيف الكفاءة
                </span>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {branches.map((branch) => {
                    const isTop = branch.rank === 1;
                    const ringColor = branch.score >= 80 ? '#10b981' : (branch.score >= 60 ? '#fbbf24' : '#ef4444');

                    return (
                        <div
                            key={branch.branch_id}
                            className={`relative p-5 rounded-2xl border transition-all duration-300 hover:-translate-y-1 hover:shadow-lg group
                                ${isDarkMode
                                    ? 'bg-[#0a0a0a] border-white/5 hover:border-white/10 hover:shadow-2xl hover:shadow-black/40'
                                    : 'bg-slate-50 border-transparent hover:bg-white hover:border-black/5 hover:shadow-2xl hover:shadow-black/5'}`}
                        >
                            {isTop && (
                                <div className="absolute -top-3 -right-3">
                                    <div className="relative">
                                        <div className="absolute inset-0 bg-yellow-400 blur-lg opacity-40 rounded-full animate-pulse"></div>
                                        <div className="w-8 h-8 bg-gradient-to-br from-yellow-300 to-yellow-600 rounded-full flex items-center justify-center text-white shadow-lg border-2 border-white/20">
                                            <Award size={16} />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="flex flex-col sm:flex-row items-center justify-between gap-6" dir="rtl">
                                {/* Left: Rank & Info */}
                                <div className="flex items-center gap-4 w-full sm:w-auto">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black transition-all duration-500
                                        ${isTop ? 'bg-gradient-to-br from-[#E53935] to-[#FF5252] text-white ring-2 ring-yellow-500/50 shadow-[0_0_20px_rgba(229,57,53,0.3)]' : 'bg-gray-500/10 text-gray-500'}`}>
                                        #{branch.rank}
                                    </div>
                                    <div>
                                        <h4 className={`text-lg font-black transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'} ${isTop ? 'text-yellow-500/90' : ''}`}>{branch.branch_name}</h4>
                                        <div className="flex items-center gap-2 mt-1">
                                            {branch.growth >= 0 ? (
                                                <span className="flex items-center text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                                    <TrendingUp size={10} className="mr-1" /> {branch.growth}%
                                                </span>
                                            ) : (
                                                <span className="flex items-center text-[10px] font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">
                                                    <TrendingDown size={10} className="mr-1" /> {Math.abs(branch.growth)}%
                                                </span>
                                            )}
                                            <span className="text-[10px] text-gray-400">مقارنة بالفترة السابقة</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Middle: Metrics */}
                                <div className="flex items-center gap-8 w-full sm:w-auto justify-between sm:justify-center px-4 border-r border-l border-gray-500/10">
                                    <div className="text-center">
                                        <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">الإيرادات</p>
                                        <p className={`text-sm font-black font-mono ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                            {new Intl.NumberFormat('ar-EG').format(branch.revenue)}
                                        </p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">صافي الربح</p>
                                        <p className={`text-sm font-black font-mono ${branch.net_profit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                            {new Intl.NumberFormat('ar-EG').format(branch.net_profit)}
                                        </p>
                                    </div>
                                </div>

                                {/* Right: Score & Trend */}
                                <div className="flex items-center gap-6 w-full sm:w-auto justify-end">
                                    <div className="flex flex-col items-center gap-2">
                                        <PerformanceRing score={branch.score} />
                                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">مؤشر الأداء</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default BranchPerformance;
