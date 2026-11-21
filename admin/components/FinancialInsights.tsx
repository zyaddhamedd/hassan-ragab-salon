import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { RevenueData } from '../types';

interface FinancialInsightsProps {
    revenueData: RevenueData[];
    paymentData: { name: string; value: number }[];
    isDarkMode: boolean;
}

const FinancialInsights: React.FC<FinancialInsightsProps> = ({ revenueData, paymentData, isDarkMode }) => {
    const COLORS = ['#E53935', '#E6D690', '#4CAF50'];

    // Custom Tooltip
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className={`p-4 rounded-xl border shadow-xl ${isDarkMode ? 'bg-[#1E1E1E] border-white/10 text-white' : 'bg-white border-black/10 text-gray-900'}`}>
                    <p className="font-bold mb-2">{label}</p>
                    {payload.map((entry: any, index: number) => (
                        <div key={index} className="flex items-center gap-2 text-sm">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                            <span className="opacity-70">{entry.name}:</span>
                            <span className="font-bold">{entry.value.toLocaleString()} ج.م</span>
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            {/* Revenue Trend Chart - Spans 2 columns */}
            <div className={`lg:col-span-2 p-6 rounded-2xl border transition-colors ${isDarkMode ? 'bg-[#121212] border-white/5 hover:border-white/10' : 'bg-white border-black/5 shadow-sm hover:border-black/10'}`}>

                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h3 className={`text-lg font-bold mb-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            تحليل الإيرادات اليومية
                        </h3>
                        <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            متابعة الأداء المالي للأسبوع الحالي مقارنة بالسابق
                        </p>
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${isDarkMode ? 'bg-green-500/10 text-green-400' : 'bg-green-100 text-green-700'}`}>
                        <TrendingUp size={14} />
                        <span>+١٢٪ نمو</span>
                    </div>
                </div>



                {/* Chart Container */}
                <div style={{ width: '100%', height: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={revenueData} margin={{ right: 30, left: -20 }}>
                            <defs>
                                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#E53935" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#E53935" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#ffffff10' : '#00000010'} />
                            <XAxis
                                dataKey="name"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: isDarkMode ? '#888' : '#666', fontSize: 12 }}
                                dy={10}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: isDarkMode ? '#888' : '#666', fontSize: 12 }}
                                tickFormatter={(value) => `${value / 1000}k`}
                                domain={[0, (dataMax: number) => (dataMax === 0 ? 1000 : dataMax * 1.1)]}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                                type="monotone"
                                dataKey="revenue"
                                name="الإيرادات"
                                stroke="#E53935"
                                strokeWidth={3}
                                fillOpacity={1}
                                fill="url(#colorRevenue)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Payment Methods Card */}
            <div className={`p-6 rounded-2xl border flex flex-col transition-colors ${isDarkMode ? 'bg-[#121212] border-white/5 hover:border-white/10' : 'bg-white border-black/5 shadow-sm hover:border-black/10'}`}>
                <h3 className={`text-lg font-bold mb-6 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    طرق الدفع والتحصيل
                </h3>

                <div style={{ width: '100%', height: 200, position: 'relative' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={paymentData}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {paymentData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                        </PieChart>
                    </ResponsiveContainer>

                    {/* Center Text */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {paymentData.reduce((acc, curr) => acc + curr.value, 0)}%
                        </span>
                        <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>مكتمل</span>
                    </div>
                </div>

                <div className="mt-6 space-y-3">
                    {paymentData.map((item, index) => (
                        <div key={index} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                                <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>{item.name}</span>
                            </div>
                            <span className="font-bold font-mono dir-ltr">{item.value}%</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default FinancialInsights;
