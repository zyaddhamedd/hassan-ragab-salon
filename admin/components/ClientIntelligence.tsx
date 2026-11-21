import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Crown, UserPlus, Users } from 'lucide-react';

interface ClientIntelligenceProps {
    topClients: { name: string; spend: number }[];
    retentionData: { name: string; value: number }[];
    isDarkMode: boolean;
}

const ClientIntelligence: React.FC<ClientIntelligenceProps> = ({ topClients, retentionData, isDarkMode }) => {
    const COLORS = ['#E6D690', '#E53935'];

    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-[#121212] border-white/5' : 'bg-white border-black/5 shadow-sm'
            }`}>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className={`text-lg font-bold mb-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        <Crown className="text-[#E6D690]" size={20} />
                        ذكاء العملاء
                    </h3>
                    <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        تحليل ولاء العملاء وكبار الشخصيات
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Retention Chart */}
                <div className="flex flex-col items-center">
                    <div className="h-[180px] w-full relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={retentionData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={50}
                                    outerRadius={70}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {retentionData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <Users size={20} className={isDarkMode ? 'text-white' : 'text-gray-900'} />
                        </div>
                    </div>
                    <div className="flex gap-4 mt-2">
                        <div className="flex items-center gap-2 text-xs">
                            <div className="w-2 h-2 rounded-full bg-[#E6D690]"></div>
                            <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>عملاء دائمون</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                            <div className="w-2 h-2 rounded-full bg-[#E53935]"></div>
                            <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>جدد</span>
                        </div>
                    </div>
                </div>

                {/* Top Spenders List */}
                <div className="space-y-4">
                    <h4 className={`text-xs font-bold uppercase tracking-widest opacity-60 mb-2 ${isDarkMode ? 'text-white' : 'text-black'}`}>
                        عملاء النخبة
                    </h4>
                    {topClients.slice(0, 3).map((client, idx) => (
                        <div key={idx} className={`p-3 rounded-xl border flex items-center justify-between ${isDarkMode ? 'bg-[#1E1E1E] border-white/5' : 'bg-gray-50 border-gray-100'
                            }`}>
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-[#E6D690]/20 flex items-center justify-center text-[#E6D690] font-bold text-xs">
                                    {client.name.charAt(0)}
                                </div>
                                <div>
                                    <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{client.name}</p>
                                </div>
                            </div>
                            <span className={`text-sm font-bold font-mono ${isDarkMode ? 'text-[#E6D690]' : 'text-[#D4AF37]'}`}>
                                {client.spend.toLocaleString()}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ClientIntelligence;
