import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Scissors } from 'lucide-react';

interface OperationsInsightsProps {
    serviceData: { name: string; value: number }[];
    isDarkMode: boolean;
}

const OperationsInsights: React.FC<OperationsInsightsProps> = ({ serviceData, isDarkMode }) => {
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className={`p-3 rounded-lg border shadow-lg ${isDarkMode ? 'bg-[#1E1E1E] border-white/10 text-white' : 'bg-white border-black/10 text-gray-900'
                    }`}>
                    <p className="font-bold mb-1">{label}</p>
                    <p className="text-sm text-[#E6D690]">
                        الإيراد: {payload[0].value.toLocaleString()} ج.م
                    </p>
                </div>
            );
        }
        return null;
    };

    return (
        <div className={`p-6 rounded-2xl border mb-8 transition-colors duration-300 ${isDarkMode ? 'bg-[#121212] border-white/5 hover:border-white/10' : 'bg-white border-black/5 shadow-sm hover:border-black/10'
            }`}>
            <div className="mb-6">
                <h3 className={`text-lg font-bold mb-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    <Scissors className="text-[#E6D690]" size={20} />
                    تحليل أداء الخدمات
                </h3>
                <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    أكثر الخدمات طلباً وتحقيقاً للأرباح خلال الفترة الحالية
                </p>
            </div>

            <div className="w-full h-[300px]" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={serviceData} layout="vertical" barSize={20}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke={isDarkMode ? '#ffffff10' : '#00000010'} />
                        <XAxis type="number" hide domain={[0, (dataMax: number) => (dataMax === 0 ? 100 : dataMax * 1.1)]} />
                        <YAxis
                            dataKey="name"
                            type="category"
                            width={120}
                            tick={{ fill: isDarkMode ? '#CCC' : '#333', fontSize: 11, fontWeight: 'bold' }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                            {serviceData.map((entry, index) => (
                                <Cell key={`cell-${index}`} cursor="pointer" fill={index === 0 ? '#E6D690' : '#E53935'} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default OperationsInsights;
