
import React, { useState, useEffect } from 'react';
import { Filter, UserCircle, Sun, Moon, Menu, MapPin, ChevronDown } from 'lucide-react';
import { getCurrentUser } from '../api/auth';
import adminApi from '../api/client';
import { Branch } from '../types';

interface HeaderProps {
  selectedBranch: string;
  onBranchChange: (branch: string) => void;
  pageTitle: string;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
}

const Header: React.FC<HeaderProps> = ({
  selectedBranch,
  onBranchChange,
  pageTitle,
  isDarkMode,
  onToggleTheme,
  onToggleSidebar,
  isSidebarOpen
}) => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const user = getCurrentUser();
  const roleLabel = (() => {
    switch (user?.role) {
      case 'STORE_MANAGER':
        return 'مدير المخزن';
      case 'SUPER_ADMIN':
        return 'إدارة عليا';
      case 'EXEC_ADMIN':
        return 'مدير تنفيذي';
      case 'BRANCH_MANAGER':
        return 'مدير فرع';
      default:
        return user?.role?.replace('_', ' ') || 'Admin';
    }
  })();

  // Fetch branches on mount
  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const response = await adminApi.get('/branches');
        setBranches(response.data);
      } catch (error) {
        console.error('Failed to fetch branches:', error);
      }
    };

    fetchBranches();
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 lg:right-[72px] z-50 border-b theme-transition ${isDarkMode ? 'bg-[#000000] border-white/5' : 'bg-white border-black/5 shadow-sm'
        }`}
      dir="rtl"
      style={{ height: 'var(--app-header-height)' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 h-full flex items-center justify-between gap-2">

        {/* Left Section: Profile & Actions */}
        <div className="flex items-center gap-2 sm:gap-4 flex-1">
          {/* Mobile Menu Trigger */}
          <button
            onClick={onToggleSidebar}
            aria-label="فتح القائمة الرئيسية"
            aria-controls="admin-sidebar"
            aria-expanded={isSidebarOpen}
            className={`flex lg:hidden p-2 rounded-lg ${isDarkMode ? 'text-[#E53935] hover:bg-white/5' : 'text-[#E53935] hover:bg-black/5'}`}
          >
            <Menu size={22} />
          </button>

          <div className={`flex items-center gap-2 sm:gap-3 group cursor-pointer border-l pr-2 sm:pr-0 sm:pl-6 ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
            <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full border flex items-center justify-center transition-all relative ${isDarkMode ? 'bg-[#161616] border-[#E53935]/20 text-[#E53935] group-hover:border-[#E53935]' : 'bg-gray-100 border-gray-200 text-[#E53935] group-hover:border-[#E53935]'
              }`}>
              <UserCircle size={20} className="sm:size-[22px]" />
              <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#E6D690] rounded-full border-2 border-current"></div>
            </div>
            <div className="text-right hidden sm:block">
              <p className={`text-[8px] uppercase font-bold tracking-tighter leading-none ${isDarkMode ? 'text-[#7A7A7A]' : 'text-[#9E9E9E]'}`}>
                {roleLabel}
              </p>
              <p className={`text-[10px] sm:text-xs font-bold leading-none mt-1 uppercase tracking-tight ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>
                {user?.full_name || 'Admin User'}
              </p>
            </div>
          </div>

          <button
            onClick={onToggleTheme}
            className={`p-2 rounded-lg transition-all ${isDarkMode ? 'bg-white/5 text-[#E6D690] hover:bg-white/10' : 'bg-black/5 text-gray-600 hover:bg-black/10'
              }`}
          >
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        {/* Center Section: Page Title */}
        <div className="flex flex-col items-center justify-center flex-1 text-center truncate">
          <h1 className={`text-sm sm:text-base font-bold tracking-tight sm:tracking-[0.1em] uppercase truncate max-w-full ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>
            {pageTitle}
          </h1>
          <div className="flex items-center gap-1 sm:gap-2 mt-0.5 sm:mt-1 opacity-60 overflow-hidden">
            <div className="hidden xs:block w-2 h-[1px] bg-[#E6D690]"></div>
            <p className="text-[#E53935] text-[7px] sm:text-[8px] font-bold uppercase tracking-[0.2em] sm:tracking-[0.3em] whitespace-nowrap">نادي الرجال السري</p>
            <div className="hidden xs:block w-2 h-[1px] bg-[#E6D690]"></div>
          </div>
        </div>

        {/* Right Section: Global Branch Selector */}
        <div className="flex items-center justify-end gap-3 sm:gap-6 flex-1">
          <div className={`
            relative flex items-center rounded-lg px-3 py-1.5 gap-2 border transition-all group min-w-[140px]
            ${isDarkMode ? 'bg-[#0B0B0B] border-white/10 hover:border-[#E53935]/50' : 'bg-white border-gray-200 hover:border-[#E53935]/50'}
          `}>
            <MapPin size={14} className="text-[#E53935]" />

            <div className="relative w-full">
              <select
                value={selectedBranch}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onBranchChange(e.target.value)}
                className={`
                  w-full bg-transparent text-[11px] font-bold outline-none cursor-pointer appearance-none 
                  pl-4 border-none p-0 h-auto
                  ${isDarkMode ? 'text-white' : 'text-[#121212]'}
                `}
              >
                <option value="All" className={isDarkMode ? 'bg-[#1A1A1A] text-white' : ''}>كافة الفروع</option>
                {branches.map((branch: Branch) => (
                  <option
                    key={branch.id}
                    value={branch.id}
                    className={isDarkMode ? 'bg-[#1A1A1A] text-white' : ''}
                  >
                    {branch.name} {branch.city ? `- ${branch.city}` : ''}
                  </option>
                ))}
              </select>

              {/* Custom Minimal Arrow */}
              <div className={`absolute left-0 top-1/2 -translate-y-1/2 pointer-events-none transition-transform group-hover:translate-y-[0px] ${isDarkMode ? 'text-white/40' : 'text-black/40'}`}>
                <ChevronDown size={10} strokeWidth={2} />
              </div>
            </div>
          </div>
        </div>

      </div>
    </header>
  );
};

export default Header;
