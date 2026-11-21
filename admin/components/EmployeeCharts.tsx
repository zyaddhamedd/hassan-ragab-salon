
import React from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { EMPLOYEE_PERFORMANCE_DATA } from '../constants';
import { Trophy, TrendingUp } from 'lucide-react';

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#161616] border border-[#E53935]/30 p-4 rounded-lg shadow-2xl backdrop-blur-md">
        <p className="text-[#7A7A7A] text-[10px] mb-1 uppercase tracking-widest font-bold">{label}</p>
        <p className="text-white font-bold text-lg">{payload[0].value.toLocaleString()} ج.م</p>
      </div>
    );
  }
  return null;
};

const EmployeeCharts: React.FC = () => {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-12">
      {/* High-Energy Red Ranking List */}
      <div className="bg-[#161616] p-10 rounded-2xl luxury-shadow border border-white/5 relative overflow-hidden">
        <div className="absolute top-10 left-10 opacity-10">
           <Trophy className="text-[#E6D690]" size={120} strokeWidth={1} />
        </div>
        
        <div className="mb-12 text-right relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-[1px] bg-[#E53935]"></div>
            <h2 className="text-3xl font-bold text-white uppercase tracking-tight">ترتيب النجوم</h2>
          </div>
          <p className="text-[#B0B0B0] text-[10px] font-bold uppercase tracking-[0.3em] opacity-60 italic">أعلى مستويات الإنتاجية والولاء</p>
        </div>

        <div className="space-y-4 relative z-10">
          {EMPLOYEE_PERFORMANCE_DATA.map((emp, index) => (
            <div key={index} className="flex items-center justify-between p-6 bg-[#202020] rounded-xl border border-white/5 hover:border-[#E53935]/40 transition-all group cursor-pointer shadow-lg shadow-black/40">
              {/* Value Side */}
              <div className="text-right">
                <span className="text-lg font-bold text-[#E53935] tracking-tight group-hover:scale-110 block transition-transform">
                  {emp.revenue.toLocaleString()} ج.م
                </span>
                <span className="text-[8px] text-[#7A7A7A] uppercase font-bold tracking-widest">إجمالي المبيعات</span>
              </div>
              
              {/* User Side */}
              <div className="flex items-center gap-6">
                <div className="text-left">
                  <span className="text-sm font-bold text-white group-hover:text-[#E6D690] transition-colors block">{emp.name}</span>
                  <div className="flex items-center gap-1 mt-1">
                    <TrendingUp size={10} className="text-[#E6D690]" />
                    <span className="text-[9px] text-[#7A7A7A] font-bold">نمو مستدام</span>
                  </div>
                </div>
                <div className={`text-2xl font-bold w-12 h-12 flex items-center justify-center rounded-lg ${index === 0 ? 'bg-[#E53935] text-white shadow-[0_0_15px_rgba(229,57,53,0.4)]' : 'bg-[#161616] text-[#7A7A7A] border border-white/5'}`}>
                  #{index + 1}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modern Bar Chart - Comparison */}
      <div className="bg-[#161616] p-10 rounded-2xl luxury-shadow border border-white/5">
        <div className="mb-12">
          <h2 className="text-xl font-bold text-white uppercase tracking-tight">تحليل الأثر المالي</h2>
          <p className="text-[#B0B0B0] text-xs font-light mt-1 italic">مساهمة الكوادر في الدخل التشغيلي</p>
        </div>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={EMPLOYEE_PERFORMANCE_DATA}>
              <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,0.03)" vertical={false} />
              <XAxis dataKey="name" stroke="#555" fontSize={10} tickLine={false} axisLine={false} dy={10} />
              <YAxis hide />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,59,48,0.04)' }} />
              <Bar dataKey="revenue" radius={[6, 6, 0, 0]} barSize={35}>
                {EMPLOYEE_PERFORMANCE_DATA.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index === 0 ? '#E53935' : '#2A2A2A'} className="hover:fill-[#FF3B30] transition-all" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default EmployeeCharts;
