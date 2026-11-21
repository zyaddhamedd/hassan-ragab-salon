import React from 'react';
import {
  Users,
  Scissors,
  Calculator,
  Calendar,
  Wallet,
  Package,
  LogOut,
  Clock,
  Ticket,
  ChevronRight,
  ChevronLeft,
  DollarSign,
} from 'lucide-react';
import { PageType } from '../App';
import Logo from './Logo';

interface SidebarProps {
  activePage: PageType;
  setActivePage: (page: PageType) => void;
  onLogout: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

const Sidebar: React.FC<SidebarProps> = React.memo(({ activePage, setActivePage, onLogout, isOpen, onToggle }) => {
  const menuItems: { name: PageType; icon: React.ReactNode }[] = [
    { name: 'الانتظار', icon: <Ticket size={20} /> },
    { name: 'الكاشير', icon: <Calculator size={20} /> },
    { name: 'الحضور والانصراف', icon: <Clock size={20} /> },
    { name: 'العملاء', icon: <Users size={20} /> },
    { name: 'الحلاقين', icon: <Scissors size={20} /> },
    { name: 'المواعيد القادمة', icon: <Calendar size={20} /> },
    { name: 'المصروفات', icon: <Wallet size={20} /> },
    { name: 'الخزينة', icon: <DollarSign size={20} /> },
    { name: 'المخزن', icon: <Package size={20} /> },
  ];

  const sidebarWidth = 'min(var(--mini-sidebar-width), calc(100vw - 3rem))';

  return (
    <div className="pointer-events-none fixed inset-y-0 right-0 z-[120]">
      <button
        onClick={onToggle}
        aria-label={isOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
        aria-expanded={isOpen}
        className="group pointer-events-auto absolute top-1/2 z-[130] flex h-14 w-9 -translate-y-1/2 items-center justify-center rounded-l-xl border-y border-l border-white/10 bg-[#E6D690] text-[#121212] shadow-lg transition-all duration-300 ease-in-out hover:bg-white"
        style={{ right: isOpen ? sidebarWidth : '0px' }}
      >
        {isOpen ? (
          <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        ) : (
          <ChevronLeft size={16} className="transition-transform group-hover:-translate-x-0.5" />
        )}
      </button>

      <div
        className={`pointer-events-auto absolute inset-y-0 right-0 transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <aside
          className="relative flex h-full flex-col overflow-hidden border-l border-white/5 bg-[#1E1E1E] shadow-2xl"
          style={{ width: sidebarWidth }}
        >
          <div className="flex flex-col items-center p-8">
            <div className="group relative h-32 w-32">
              <div className="absolute inset-0 scale-75 rounded-full bg-[#E6D690]/5 blur-2xl transition-all duration-700 group-hover:bg-[#E6D690]/10" />
              <Logo />
            </div>
          </div>

          <nav className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto px-3 py-2">
            {menuItems.map((item) => (
              <button
                key={item.name}
                onClick={() => {
                  setActivePage(item.name);
                  onToggle();
                }}
                className={`group relative flex w-full items-center gap-4 rounded-2xl px-5 py-4 transition-all duration-300 ${
                  activePage === item.name
                    ? 'bg-[#E6D690] font-bold text-[#121212] shadow-[0_10px_20px_rgba(230,214,144,0.15)]'
                    : 'text-[#BDBDBD] hover:bg-white/5 hover:text-[#F5F5F5]'
                }`}
              >
                <span className={`flex-shrink-0 transition-transform duration-300 ${activePage === item.name ? '' : 'text-[#BDBDBD] group-hover:text-[#E6D690]'}`}>
                  {item.icon}
                </span>

                <span className="ml-0 whitespace-nowrap text-sm">{item.name}</span>

                {activePage === item.name && (
                  <div className="mr-auto h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#121212]" />
                )}
              </button>
            ))}
          </nav>

          <div className="border-t border-white/5 p-6">
            <button
              onClick={onLogout}
              className="group flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-[#BDBDBD] transition-all hover:bg-[#E53935]/5 hover:text-[#E53935]"
            >
              <LogOut size={20} className="flex-shrink-0 transition-transform group-hover:rotate-12" />
              <span className="whitespace-nowrap text-sm">تسجيل الخروج</span>
            </button>
          </div>

          <style>{`
            .custom-scrollbar::-webkit-scrollbar { width: 3px; }
            .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
            .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
          `}</style>
        </aside>
      </div>
    </div>
  );
});

export default Sidebar;
