
import React from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie
} from 'recharts';
import { TOP_CLIENTS_DATA, CLIENT_RETENTION_DATA } from '../constants';

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#181818] border border-white/10 p-4 rounded-lg shadow-2xl backdrop-blur-md">
        <p className="text-[#9E9E9E] text-[10px] mb-1 uppercase tracking-wider">{label || payload[0].name}</p>
        <p className="text-[#F5F5F5] font-bold text-lg">{payload[0].value.toLocaleString()} {payload[0].name === 'spend' ? 'ج.م' : '%'}</p>
      </div>
    );
  }
  return null;
};

const ClientCharts: React.FC = () => {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
      {/* Bar Chart: Top Clients by Revenue */}
      <div className="bg-[#181818] p-8 rounded-xl luxury-shadow border border-white/5">
        <div className="mb-10">
          <h2 className="text-xl font-bold text-[#F5F5F5]">قائمة الأكثر إنفاقاً</h2>
          <p className="text-[#9E9E9E] text-xs font-light mt-1 italic">تحليل القيمة الحيوية للعملاء الـ VIP</p>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={TOP_CLIENTS_DATA}>
              <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,0.03)" vertical={false} />
              <XAxis dataKey="name" stroke="#444" fontSize={10} tickLine={false} axisLine={false} dy={10} />
              <YAxis hide />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
              <Bar dataKey="spend" radius={[4, 4, 0, 0]} barSize={35}>
                {TOP_CLIENTS_DATA.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index === 0 ? '#E6D690' : '#444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pie Chart: Returning vs New Clients */}
      <div className="bg-[#181818] p-8 rounded-xl luxury-shadow border border-white/5">
        <div className="mb-10">
          <h2 className="text-xl font-bold text-[#F5F5F5]">معدل استبقاء العملاء</h2>
          <p className="text-[#9E9E9E] text-xs font-light mt-1 italic">نسبة العملاء العائدين مقابل الجدد</p>
        </div>
        <div className="h-64 w-full flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={CLIENT_RETENTION_DATA}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
                stroke="none"
              >
                {CLIENT_RETENTION_DATA.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index === 0 ? '#E6D690' : '#E53935'} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute flex flex-col items-center justify-center">
             <span className="text-[10px] text-[#9E9E9E] uppercase tracking-widest font-bold">الولاء</span>
             <span className="text-xl font-bold text-white">٦٥٪</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientCharts;
