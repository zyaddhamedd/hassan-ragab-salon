import { canViewPromos } from '../utils/promoCodes';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  LayoutDashboard, Scissors, Users, Contact, FileText, Package, Wallet,
  BarChart3, Settings, Clock, X, Menu, LogOut, Tags, Banknote,
} from 'lucide-react';
import Logo from './Logo.tsx';

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: <LayoutDashboard size={20} /> },
  { id: 'services', label: 'إدارة الخدمات', icon: <Scissors size={20} /> },
  { id: 'promo-codes', label: 'أكواد الخصم', icon: <Tags size={20} /> },
  { id: 'employees', label: 'إدارة الموظفين', icon: <Users size={20} /> },
  { id: 'attendance', label: 'متابعة الحضور', icon: <Clock size={20} /> },
  { id: 'customers', label: 'إدارة العملاء', icon: <Contact size={20} /> },
  { id: 'invoices', label: 'إدارة الفواتير', icon: <FileText size={20} /> },
  { id: 'treasury', label: 'الخزينة والماليات', icon: <Wallet size={20} /> },
  { id: 'inventory', label: 'مركز الإمداد', icon: <Package size={20} /> },
  { id: 'expenses', label: 'المصروفات', icon: <Banknote size={20} /> },
  { id: 'reports', label: 'التقارير', icon: <BarChart3 size={20} /> },
  { id: 'settings', label: 'الإعدادات', icon: <Settings size={20} /> },
];

interface SideNavProps {
  activeTab: string;
  onNavigate: (id: string) => void;
  isDarkMode: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onLogout: () => void;
  userRole?: string;
}

const DESKTOP_HOVER = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';

const SideNav: React.FC<SideNavProps> = ({ activeTab, onNavigate, isDarkMode, isOpen, onToggle, onLogout, userRole }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [hasKeyboardFocus, setHasKeyboardFocus] = useState(false);
  const [isTapExpanded, setIsTapExpanded] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const isExpanded = isHovered || hasKeyboardFocus || isTapExpanded;
  const visibleNavItems = userRole === 'STORE_MANAGER'
    ? navItems.filter((item) => item.id === 'inventory')
    : navItems.filter(item => item.id !== 'promo-codes' || canViewPromos(userRole));

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_HOVER);
    const resetPointerState = () => { setIsHovered(false); setIsTapExpanded(false); };
    media.addEventListener('change', resetPointerState);
    return () => media.removeEventListener('change', resetPointerState);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement;
    const sidebar = sidebarRef.current;
    closeRef.current?.focus();
    return () => {
      if (sidebar?.contains(document.activeElement) && previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [isOpen]);

  const navigation = (
    <aside
      id="admin-sidebar"
      aria-label="القائمة الرئيسية"
      ref={sidebarRef}
      data-open={isOpen}
      data-expanded={isExpanded}
      className={`admin-side-nav border-l ${isDarkMode ? 'bg-[#0B0B0B] border-white/5' : 'bg-white border-black/5 shadow-lg'}`}
      dir="rtl"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse' && window.matchMedia(DESKTOP_HOVER).matches) setIsHovered(true);
      }}
      onPointerLeave={() => setIsHovered(false)}
      onPointerDownCapture={(event) => {
        if (event.pointerType === 'mouse') setHasKeyboardFocus(false);
      }}
      onFocusCapture={(event) => {
        if (event.target.matches(':focus-visible')) setHasKeyboardFocus(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setHasKeyboardFocus(false);
          setIsTapExpanded(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) { event.stopPropagation(); onToggle(); }
      }}
    >
      <div className="admin-side-nav-controls">
        <button ref={closeRef} type="button" onClick={onToggle} aria-label="إغلاق القائمة" className="admin-side-nav-close admin-side-nav-control">
          <X size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setIsTapExpanded(value => !value)}
          aria-label={isTapExpanded ? 'تصغير القائمة' : 'توسيع القائمة'}
          aria-expanded={isExpanded}
          aria-controls="admin-sidebar-items"
          className="admin-side-nav-touch-toggle admin-side-nav-control"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="admin-side-nav-brand overflow-hidden">
        <div className={`shrink-0 w-12 h-12 rounded-full border flex items-center justify-center ${isDarkMode ? 'border-[#E6D690]/20 bg-black' : 'border-gray-100 bg-white'}`}>
          <Logo size="sm" />
        </div>
        <div className="admin-side-nav-label min-w-0">
          <h2 className={`text-[10px] font-bold leading-relaxed ${isDarkMode ? 'text-[#E6D690]' : 'text-gray-500'}`}>نظام القيادة التنفيذي</h2>
          <div className="w-12 h-px bg-[#E53935] mt-3" />
        </div>
      </div>

      <nav id="admin-sidebar-items" aria-label="صفحات الإدارة" className="admin-side-nav-items sidebar-scroll">
        {visibleNavItems.map((item) => {
          const isActive = item.id === activeTab;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-label={item.label}
              title={item.label}
              aria-current={isActive ? 'page' : undefined}
              className={`admin-side-nav-item group ${isActive
                ? `bg-[rgba(229,57,53,0.18)] ${isDarkMode ? 'text-white' : 'text-[#121212]'}`
                : `hover:text-[#E53935] hover:bg-[rgba(229,57,53,0.10)] ${isDarkMode ? 'text-[#9E9E9E]' : 'text-gray-500'}`}`}
            >
              {isActive && <span aria-hidden="true" className="absolute right-0 top-1/2 -translate-y-1/2 h-2/3 w-[2px] rounded-l-full bg-[#E53935]" />}
              <span aria-hidden="true" className={`admin-side-nav-icon ${isActive ? 'text-[#E53935]' : 'group-hover:text-[#E53935]'}`}>{item.icon}</span>
              <span className="admin-side-nav-label text-[13px] font-bold">{item.label}</span>
            </button>
          );
        })}
        <button type="button" onClick={onLogout} aria-label="تسجيل الخروج" title="تسجيل الخروج" className="admin-side-nav-item text-[#E53935] hover:bg-[#E53935]/10 mt-1">
          <span aria-hidden="true" className="admin-side-nav-icon"><LogOut size={20} /></span>
          <span className="admin-side-nav-label text-[13px] font-bold">تسجيل الخروج</span>
        </button>
      </nav>
    </aside>
  );
  // Escape page animation/transform and overflow contexts. Keep React ownership
  // here so hover, focus, navigation and logout handlers are unchanged.
  return typeof document === 'undefined' || !document.body ? navigation : createPortal(navigation, document.body);
};

export default SideNav;
