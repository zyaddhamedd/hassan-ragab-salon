
import React from 'react';

interface PagePlaceholderProps {
  title: string;
}

const PagePlaceholder: React.FC<PagePlaceholderProps> = ({ title }) => {
  return (
    <div className="h-full flex flex-col p-10 font-['Cairo'] transition-colors duration-500 bg-[#121212] text-white">
      <header className="mb-10 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-1.5 h-8 rounded-full shadow-[0_0_10px_#E6D690] bg-[#E6D690]"></div>
          <h1 className="text-3xl font-black">{title}</h1>
        </div>
      </header>
      
      <div className="flex-1 flex flex-col items-center justify-center border rounded-[3rem] p-10 border-white/5 bg-[#1E1E1E]/30 transition-colors">
        <div className="w-24 h-24 rounded-full flex items-center justify-center mb-6 bg-white/5">
           <div className="w-12 h-1 rounded-full bg-[#E6D690]/20"></div>
        </div>
        <p className="text-lg opacity-40 font-medium text-[#BDBDBD]">هذه الصفحة قيد التطوير حالياً</p>
        <p className="text-sm opacity-20 mt-2 tracking-widest uppercase text-[#BDBDBD]">نادي الرجال السري - نظام الإدارة</p>
      </div>
    </div>
  );
};

export default PagePlaceholder;
