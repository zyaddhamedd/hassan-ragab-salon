
import React from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { COLLECTIONS_DAILY_DATA, PAYMENT_METHODS_DATA } from '../constants';

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#181818] border border-white/10 p-4 rounded-lg shadow-2xl backdrop-blur-md">
        <p className="text-[#9E9E9E] text-[10px] mb-1 uppercase tracking-wider">{label || payload[0].name}</p>
        <p className="text-[#F5F5F5] font-bold text-lg">{payload[0].value.toLocaleString()} {payload[0].name === 'value' ? '%' : 'ر.س'}</p>
      </div>
    );
  }
  return null;
};

const InvoiceCharts: React.FC = () => {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
      {/* Area Chart: Daily Collections Flow */}
      <div className="xl:col-span-2 bg-[#181818] p-8 rounded-xl luxury-shadow border border-white/5">
        <div className="mb-10">
          <h2 className="text-xl font-bold text-[#F5F5F5]">تدفق التحصيلات اليومي</h2>
          <p className="text-[#9E9E9E] text-xs font-light mt-1 italic">مراقبة السيولة النقدية على مدار اليوم</p>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={COLLECTIONS_DAILY_DATA}>
              <defs>
                <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#E53935" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#E53935" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,0.03)" vertical={false} />
              <XAxis dataKey="name" stroke="#444" fontSize={10} tickLine={false} axisLine={false} dy={10} />
              <YAxis hide />
              <Tooltip content={<CustomTooltip />} />
              <Area 
                type="monotone" 
                dataKey="amount" 
                stroke="#E53935" 
                fillOpacity={1} 
                fill="url(#colorAmount)" 
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pie Chart: Payment Methods Breakdown */}
      <div className="bg-[#181818] p-8 rounded-xl luxury-shadow border border-white/5">
        <div className="mb-10">
          <h2 className="text-xl font-bold text-[#F5F5F5]">وسائل الدفع</h2>
          <p className="text-[#9E9E9E] text-xs font-light mt-1 italic">توزيع طرق الدفع المفضلة للعملاء</p>
        </div>
        <div className="h-64 w-full flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={PAYMENT_METHODS_DATA}
                cx="50%"
                cy="50%"
                innerRadius={65}
                outerRadius={85}
                paddingAngle={8}
                dataKey="value"
                stroke="none"
              >
                {PAYMENT_METHODS_DATA.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={index === 0 ? '#E6D690' : index === 1 ? '#F5F5F5' : index === 2 ? '#E53935' : '#333'} 
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute flex flex-col items-center justify-center">
             <span className="text-[10px] text-[#9E9E9E] uppercase tracking-widest font-bold">الرقمية</span>
             <span className="text-xl font-bold text-white">٨٥٪</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceCharts;
