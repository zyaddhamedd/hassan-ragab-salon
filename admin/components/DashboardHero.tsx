import React from 'react';
import { Wallet, TrendingUp, Users, Activity, ArrowUpRight, ArrowDownRight, DollarSign } from 'lucide-react';
import { KPIData } from '../types';

interface DashboardHeroProps {
    kpiData: KPIData[];
    isDarkMode: boolean;
}

const DashboardHero: React.FC<DashboardHeroProps> = ({ kpiData, isDarkMode }) => {
    const getIcon = (index: number) => {
        switch (index) {
            case 0: return <Wallet className="w-6 h-6" />;
            case 1: return <DollarSign className="w-6 h-6" />;
            case 2: return <Users className="w-6 h-6" />;
            case 3: return <Activity className="w-6 h-6" />;
            default: return <Activity className="w-6 h-6" />;
        }
    };

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {kpiData.map((kpi, idx) => (
                <div
                    key={idx}
                    className={`relative overflow-hidden group p-6 rounded-2xl transition-all duration-300 ease-out hover:-translate-y-1 ${isDarkMode
                        ? 'bg-[#121212] border border-white/5 hover:border-[#E53935]/50 hover:shadow-[0_4px_20px_-10px_rgba(229,57,53,0.3)]'
                        : 'bg-white border border-black/5 hover:border-[#E53935]/30 hover:shadow-[0_10px_30px_-10px_rgba(229,57,53,0.15)]'
                        }`}
                >
                    {/* Subtle Background Gradient on Hover */}
                    <div className={`absolute inset-0 transition-opacity duration-300 opacity-0 group-hover:opacity-100 ${isDarkMode ? 'bg-gradient-to-br from-[#E53935]/5 to-transparent' : 'bg-gradient-to-br from-[#E53935]/5 to-transparent'
                        }`}></div>

                    <div className="flex justify-between items-start mb-4 relative z-10">
                        <div className={`p-3 rounded-xl transition-colors duration-300 ${isDarkMode
                            ? 'bg-[#1E1E1E] text-white group-hover:bg-[#E53935] group-hover:text-white'
                            : 'bg-[#F5F5F5] text-gray-900 group-hover:bg-[#E53935] group-hover:text-white'
                            }`}>
                            {getIcon(idx)}
                        </div>

                        <div className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg transition-colors ${kpi.isPositive
                            ? (isDarkMode ? 'bg-green-500/10 text-green-400' : 'bg-green-100 text-green-700')
                            : (isDarkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-100 text-red-700')
                            }`}>
                            {kpi.change}
                            {kpi.isPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                        </div>
                    </div>

                    <div className="relative z-10">
                        <h3 className={`text-sm font-medium mb-1 transition-colors ${isDarkMode ? 'text-gray-400 group-hover:text-gray-300' : 'text-gray-500 group-hover:text-gray-600'}`}>
                            {kpi.label}
                        </h3>
                        <div className="flex items-baseline gap-2">
                            <span className={`text-2xl lg:text-3xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                {kpi.value}
                            </span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default DashboardHero;
