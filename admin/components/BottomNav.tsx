import React from 'react';
import {
    LayoutDashboard,
    Users,
    Scissors,
    Wallet,
    Menu,
    Package
} from 'lucide-react';

interface BottomNavProps {
    activeTab: string;
    onNavigate: (id: string) => void;
    onToggleSidebar: () => void;
    isDarkMode: boolean;
    userRole?: string;
}

const BottomNav: React.FC<BottomNavProps> = ({
    activeTab,
    onNavigate,
    onToggleSidebar,
    isDarkMode,
    userRole
}) => {
    const navItems = [
        { id: 'dashboard', label: 'الرئيسية', icon: <LayoutDashboard size={20} /> },
        { id: 'employees', label: 'الموظفين', icon: <Users size={20} /> },
        { id: 'services', label: 'الخدمات', icon: <Scissors size={20} /> },
        { id: 'invoices', label: 'المالية', icon: <Wallet size={20} /> },
    ];
    const visibleNavItems = userRole === 'STORE_MANAGER'
        ? [{ id: 'inventory', label: 'مركز الإمداد', icon: <Package size={20} /> }]
        : navItems;

    return (
        <div
            className={`
        fixed bottom-0 left-0 right-0 z-[80] lg:hidden 
        border-t backdrop-blur-md transition-all duration-300
        padding-safe-bottom
        ${isDarkMode
                    ? 'bg-[#0D0D0D]/90 border-white/5 shadow-[0_-4px_20px_rgba(0,0,0,0.4)]'
                    : 'bg-white/90 border-black/5 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]'
                }
      `}
        >
            <div className="flex items-center justify-between px-2 sm:px-6 h-[72px] max-w-md mx-auto w-full">
                {visibleNavItems.map((item) => {
                    const isActive = activeTab === item.id;
                    return (
                        <button
                            key={item.id}
                            onClick={() => onNavigate(item.id)}
                            className={`
                flex flex-col items-center justify-center gap-1.5 
                w-full h-full relative group
                ${isActive
                                    ? 'text-[#E53935]'
                                    : (isDarkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600')
                                }
              `}
                        >
                            <div
                                className={`
                  p-1.5 rounded-xl transition-all duration-250 cubic-bezier(0.4, 0, 0.2, 1)
                  ${isActive
                                        ? (isDarkMode ? 'bg-[#E53935]/15' : 'bg-[#E53935]/10')
                                        : 'bg-transparent'
                                    }
                `}
                            >
                                {item.icon}
                            </div>
                            <span className="text-[10px] font-bold tracking-wide transition-colors">
                                {item.label}
                            </span>

                            {isActive && (
                                <div className="absolute top-1 w-1 h-1 rounded-full bg-[#E53935] shadow-[0_0_4px_#E53935]"></div>
                            )}
                        </button>
                    );
                })}

                {userRole !== 'STORE_MANAGER' && (
                    <button
                        onClick={onToggleSidebar}
                        className={`
            flex flex-col items-center justify-center gap-1.5 
            w-full h-full relative group
            ${isDarkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}
          `}
                    >
                        <div className="p-1.5 rounded-xl bg-transparent">
                            <Menu size={20} />
                        </div>
                        <span className="text-[10px] font-bold tracking-wide">المزيد</span>
                    </button>
                )}
            </div>
        </div>
    );
};

export default BottomNav;
