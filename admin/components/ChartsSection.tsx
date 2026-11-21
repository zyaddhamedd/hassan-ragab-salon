
import React, { useMemo } from 'react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  BarChart, Bar, Cell, AreaChart, Area
} from 'recharts';
import { REVENUE_CHART_DATA, BRANCH_DATA } from '../constants';

interface ChartsSectionProps {
  isDarkMode: boolean;
  selectedBranch: string;
}

const CustomTooltip = ({ active, payload, label, isDarkMode }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className={`border p-3 sm:p-4 rounded-lg shadow-2xl backdrop-blur-md theme-transition ${
        isDarkMode ? 'bg-[#161616] border-[#E53935]/30' : 'bg-white border-gray-100'
      }`}>
        <p className={`text-[9px] sm:text-[10px] mb-1 uppercase tracking-widest font-bold ${isDarkMode ? 'text-[#7A7A7A]' : 'text-gray-500'}`}>{label}</p>
        <p className={`font-bold text-base sm:text-lg ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>{payload[0].value.toLocaleString()} ج.م</p>
      </div>
    );
  }
  return null;
};

const ChartsSection: React.FC<ChartsSectionProps> = ({ isDarkMode, selectedBranch }) => {
  const gridColor = isDarkMode ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)";
  const axisColor = isDarkMode ? "#444" : "#9E9E9E";

  const branchLabelMap: Record<string, string> = {
    'Cairo': 'فرع القاهرة - التجمع',
    'Giza': 'فرع الجيزة - الشيخ زايد',
    'Alex': 'فرع الإسكندرية - سموحة'
  };

  // Adjust chart data based on selected branch
  // In a real app, this would be a filtered fetch. Here we simulate.
  const filteredRevenueData = useMemo(() => {
    if (selectedBranch === 'All') return REVENUE_CHART_DATA;
    // Simulate branch-specific revenue (lower values for individual branches)
    return REVENUE_CHART_DATA.map(d => ({
      ...d,
      revenue: Math.floor(d.revenue * (0.3 + Math.random() * 0.2))
    }));
  }, [selectedBranch]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 sm:gap-8">
      {/* Revenue Area Chart - High Energy Red */}
      <div className={`xl:col-span-2 p-5 sm:p-8 rounded-xl border theme-transition ${
        isDarkMode ? 'bg-[#161616] border-white/5 luxury-shadow' : 'bg-white border-black/5 luxury-shadow-light'
      }`}>
        <div className="flex flex-col sm:flex-row justify-between items-start mb-6 sm:mb-10 gap-4">
          <div>
            <h2 className={`text-lg sm:text-xl font-bold uppercase tracking-tight ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>
              {selectedBranch === 'All' ? 'مسار الإيرادات الكلية' : `إيرادات ${branchLabelMap[selectedBranch]}`}
            </h2>
            <p className={`text-[10px] sm:text-xs font-light mt-1 italic ${isDarkMode ? 'text-[#B0B0B0]' : 'text-[#6E6E6E]'}`}>تحليل القوة المالية للعلامة التجارية</p>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
             <div className="flex items-center gap-2">
               <div className="w-2.5 h-2.5 sm:w-3 h-3 rounded bg-[#E53935] shadow-[0_0_8px_#E53935]"></div>
               <span className={`text-[9px] sm:text-[10px] uppercase tracking-widest font-bold ${isDarkMode ? 'text-[#B0B0B0]' : 'text-gray-500'}`}>النمو المحقق</span>
             </div>
          </div>
        </div>
        <div className="h-64 sm:h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={filteredRevenueData} margin={{ right: 20 }}>
              <defs>
                <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#E53935" stopOpacity={isDarkMode ? 0.3 : 0.1}/>
                  <stop offset="95%" stopColor="#E53935" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="0" stroke={gridColor} vertical={false} />
              <XAxis dataKey="name" stroke={axisColor} fontSize={9} tickLine={false} axisLine={false} dy={10} />
              <YAxis stroke={axisColor} fontSize={9} tickLine={false} axisLine={false} tickFormatter={(val) => `${val/1000}k`} />
              <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} cursor={{ stroke: '#E53935', strokeWidth: 1 }} />
              <Area 
                type="monotone" 
                dataKey="revenue" 
                stroke="#FF3B30" 
                strokeWidth={2} 
                fillOpacity={1} 
                fill="url(#colorRev)" 
                activeDot={{ r: 5, fill: '#E6D690', stroke: '#FF3B30', strokeWidth: 2 }} 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Branch Efficiency Bar Chart */}
      <div className={`p-5 sm:p-8 rounded-xl border theme-transition ${
        isDarkMode ? 'bg-[#161616] border-white/5 luxury-shadow' : 'bg-white border-black/5 luxury-shadow-light'
      }`}>
        <div className="mb-6 sm:mb-10">
          <h2 className={`text-lg sm:text-xl font-bold uppercase tracking-tight ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>كفاءة الفروع</h2>
          <p className={`text-[10px] sm:text-xs font-light mt-1 italic ${isDarkMode ? 'text-[#B0B0B0]' : 'text-[#6E6E6E]'}`}>تحليل التنافسية الداخلية</p>
        </div>
        <div className="h-64 sm:h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={BRANCH_DATA} layout="vertical" margin={{ left: -30 }}>
              <XAxis type="number" hide />
              <YAxis dataKey="branch" type="category" stroke={axisColor} fontSize={8} width={110} tickLine={false} axisLine={false} />
              <Tooltip cursor={{fill: isDarkMode ? 'rgba(255,59,48,0.03)' : 'rgba(0,0,0,0.03)'}} content={<CustomTooltip isDarkMode={isDarkMode} />} />
              <Bar dataKey="sales" radius={[0, 4, 4, 0]} barSize={10}>
                {BRANCH_DATA.map((entry, index) => {
                  const isCurrentBranch = selectedBranch !== 'All' && entry.branch === branchLabelMap[selectedBranch];
                  const highlightColor = isDarkMode ? '#E53935' : '#E53935';
                  const dimColor = isDarkMode ? '#2A2A2A' : '#E0E0E0';
                  
                  return (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={selectedBranch === 'All' ? (index === 0 ? highlightColor : dimColor) : (isCurrentBranch ? highlightColor : dimColor)} 
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default ChartsSection;
