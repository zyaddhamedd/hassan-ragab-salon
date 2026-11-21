import React, { useState } from 'react';
import { Users, Star, TrendingUp } from 'lucide-react';

interface EmployeePerformanceProps {
    employeeData: { name: string; revenue: number }[];
    isDarkMode: boolean;
}

const EmployeePerformance: React.FC<EmployeePerformanceProps> = ({ employeeData, isDarkMode }) => {
    // Find max revenue for progress bar calculation
    const maxRevenue = Math.max(...employeeData.map(e => e.revenue)) || 1;

    return (
        <div className={`p-6 rounded-2xl border transition-colors duration-300 ${isDarkMode ? 'bg-[#121212] border-white/5 hover:border-white/10' : 'bg-white border-black/5 shadow-sm hover:border-black/10'
            }`}>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div>
                        <h3 className={`text-lg font-bold mb-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            <Star className="text-[#E6D690]" size={20} />
                            أداء المصففين
                        </h3>
                        <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            ترتيب الموظفين حسب الإيرادات والإنتاجية
                        </p>
                    </div>
                </div>


            </div>

            <div className="space-y-5">
                {employeeData.map((emp, idx) => (
                    <div key={idx} className="group cursor-default">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-transform group-hover:scale-110 ${idx === 0
                                    ? 'bg-[#E6D690] text-black shadow-lg shadow-[#E6D690]/20'
                                    : isDarkMode ? 'bg-[#1E1E1E] text-white border border-white/5' : 'bg-gray-100 text-gray-700 border border-gray-200'
                                    }`}>
                                    {idx + 1}
                                </div>
                                <div>
                                    <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{emp.name}</p>
                                    <p className="text-[10px] opacity-50">مصفف أول</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className={`text-sm font-bold font-mono transition-colors ${isDarkMode ? 'text-[#E6D690] group-hover:text-white' : 'text-[#D4AF37] group-hover:text-black'
                                    }`}>
                                    {emp.revenue.toLocaleString()} ج.م
                                </p>
                                <div className="flex items-center justify-end gap-1 text-[10px] text-green-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <TrendingUp size={10} />
                                    <span>متميز</span>
                                </div>
                            </div>
                        </div>

                        {/* Progress Bar */}
                        <div className={`h-1.5 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1E1E1E]' : 'bg-gray-100'}`}>
                            <div
                                className={`h-full rounded-full transition-all duration-1000 group-hover:shadow-[0_0_10px_2px_rgba(230,214,144,0.3)] ${idx === 0 ? 'bg-gradient-to-r from-[#E6D690] to-[#BF953F]' : 'bg-[#E53935] opacity-80 group-hover:opacity-100'
                                    }`}
                                style={{ width: `${(emp.revenue / maxRevenue) * 100}%` }}
                            ></div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default EmployeePerformance;
