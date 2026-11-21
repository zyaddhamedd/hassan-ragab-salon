
import React from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie
} from 'recharts';
import { SERVICE_CHART_DATA } from '../constants';

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#181818] border border-white/10 p-4 rounded-lg shadow-2xl backdrop-blur-md">
        <p className="text-[#9E9E9E] text-[10px] mb-1 uppercase tracking-wider">{label || payload[0].name}</p>
        <p className="text-[#F5F5F5] font-bold text-lg">{payload[0].value.toLocaleString()} ج.م</p>
      </div>
    );
  }
  return null;
};

const ServicesCharts: React.FC = () => {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
      {/* Bar Chart: Revenue by Service */}
      <div className="bg-[#181818] p-8 rounded-xl luxury-shadow border border-white/5">
        <div className="mb-10">
          <h2 className="text-xl font-bold text-[#F5F5F5]">الإيرادات حسب الخدمة</h2>
          <p className="text-[#9E9E9E] text-xs font-light mt-1 italic">تحليل مالي للخدمات الأكثر ربحية</p>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={SERVICE_CHART_DATA}>
              <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,0.03)" vertical={false} />
              <XAxis dataKey="name" stroke="#444" fontSize={10} tickLine={false} axisLine={false} dy={10} />
              <YAxis hide />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={40}>
                {SERVICE_CHART_DATA.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index === 0 ? '#E53935' : index % 2 === 0 ? '#E6D690' : '#444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pie Chart: Contribution to Total Revenue */}
      <div className="bg-[#181818] p-8 rounded-xl luxury-shadow border border-white/5">
        <div className="mb-10">
          <h2 className="text-xl font-bold text-[#F5F5F5]">توزيع حصة الخدمات</h2>
          <p className="text-[#9E9E9E] text-xs font-light mt-1 italic">نسبة مساهمة كل خدمة في الدخل الإجمالي</p>
        </div>
        <div className="h-64 w-full flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={SERVICE_CHART_DATA}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
                stroke="none"
              >
                {SERVICE_CHART_DATA.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index === 0 ? '#E53935' : index % 2 === 0 ? '#E6D690' : '#333'} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute flex flex-col items-center justify-center">
             <span className="text-[10px] text-[#9E9E9E] uppercase tracking-widest font-bold">الأداء</span>
             <span className="text-xl font-bold text-white">ممتاز</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServicesCharts;
