import PromoCodesPage from './components/PromoCodesPage';
import { canViewPromos } from './utils/promoCodes';

import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header.tsx';
import SideNav from './components/SideNav.tsx';
import BottomNav from './components/BottomNav.tsx';
import InsightsPanel from './components/InsightsPanel.tsx';
import AlertsSection from './components/AlertsSection.tsx';
import Dashboard from './components/Dashboard.tsx';
import LoginScreen from './components/LoginScreen.tsx';
import ServicesPage from './components/ServicesPage.tsx';
import EmployeesPage from './components/EmployeesPage.tsx';
import AddEmployeePage from './components/AddEmployeePage.tsx';
import ClientsPage from './components/ClientsPage.tsx';
import InvoicesPage from './components/InvoicesPage.tsx';
import ExpensesPage from './components/ExpensesPage.tsx';
import InventoryPage from './components/InventoryPage.tsx';
import ReportsPage from './components/ReportsPage.tsx';
import SettingsPage from './components/SettingsPage.tsx';
import AdminAttendanceDashboard from './components/AdminAttendanceDashboard.tsx';
import AdminTreasuryPage from './components/AdminTreasuryPage.tsx';
// Removed mock data imports
import { Sparkles, MapPin, CheckCircle2 } from 'lucide-react';
import { Employee } from './types.ts';
import { getCurrentUser, isAuthenticated, logout } from './api/auth';
import useSupplyCatalogNavigation from './hooks/useSupplyCatalogNavigation';
import { readSupplyNavigation } from './utils/supplyCatalogNavigation';

const STORE_MANAGER_ROLE = 'STORE_MANAGER';
const STORE_MANAGER_TAB = 'inventory';

const App: React.FC = () => {
  const supplyNavigation = useSupplyCatalogNavigation();
  const getInitialActiveTab = () => {
    if (readSupplyNavigation(window.location.href).active) return STORE_MANAGER_TAB;
    const storedTab = localStorage.getItem('smc_active_tab') || 'dashboard';
    const currentUser = getCurrentUser();
    return currentUser?.role === STORE_MANAGER_ROLE ? STORE_MANAGER_TAB : storedTab;
  };

  // Check for existing authentication on mount
  const [isAuthenticatedState, setIsAuthenticatedState] = useState(() => isAuthenticated());
  const [selectedBranch, setSelectedBranch] = useState(() => {
    const url = readSupplyNavigation(window.location.href);
    return url.active ? url.location : localStorage.getItem('smc_selected_branch') || 'All';
  });
  const [activeTab, setActiveTab] = useState(getInitialActiveTab);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showBranchToast, setShowBranchToast] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeToEdit, setEmployeeToEdit] = useState<Employee | null>(null);

  const initialLoad = useRef(true);
  const currentUser = getCurrentUser();
  const isStoreManager = currentUser?.role === STORE_MANAGER_ROLE;

  const guardActiveTab = (nextTab: string) => {
    if (isStoreManager && nextTab !== STORE_MANAGER_TAB) {
      return STORE_MANAGER_TAB;
    }
    return nextTab;
  };

  const effectiveActiveTab = guardActiveTab(activeTab);

  useEffect(() => {
    if (supplyNavigation.state.active) {
      setActiveTab(STORE_MANAGER_TAB);
      setSelectedBranch(supplyNavigation.state.location);
    } else if (supplyNavigation.outsideTab) {
      setActiveTab(guardActiveTab(supplyNavigation.outsideTab));
    }
  }, [supplyNavigation.state, supplyNavigation.outsideTab, isStoreManager]);

  useEffect(() => {
    document.body.style.backgroundColor = isDarkMode ? '#0B0B0B' : '#F7F7F7';
    document.body.style.color = isDarkMode ? '#FFFFFF' : '#121212';
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem('smc_selected_branch', selectedBranch);

    // Don't show toast on initial app load
    if (initialLoad.current) {
      initialLoad.current = false;
      return;
    }

    setShowBranchToast(true);
    const timer = setTimeout(() => setShowBranchToast(false), 3000);
    return () => clearTimeout(timer);
  }, [selectedBranch]);

  // Persist Active Tab on Refresh (Routing Fix)
  useEffect(() => {
    const guardedTab = guardActiveTab(activeTab);

    if (guardedTab !== activeTab) {
      setActiveTab(guardedTab);
      return;
    }

    localStorage.setItem('smc_active_tab', guardedTab);
  }, [activeTab, isStoreManager]);

  useEffect(() => {
    if (!isAuthenticatedState) {
      return;
    }

    if (supplyNavigation.state.active) {
      setActiveTab(STORE_MANAGER_TAB);
      return;
    }

    if (isStoreManager) {
      if (activeTab !== STORE_MANAGER_TAB) {
        setActiveTab(STORE_MANAGER_TAB);
      }
      localStorage.setItem('smc_active_tab', STORE_MANAGER_TAB);
      return;
    }

    // A browser history entry takes precedence over the persisted tab too.
    if (supplyNavigation.outsideTab) return;

    const storedTab = localStorage.getItem('smc_active_tab');
    if (!storedTab || storedTab === STORE_MANAGER_TAB || activeTab === STORE_MANAGER_TAB) {
      const fallbackTab = storedTab || 'dashboard';
      if (activeTab !== fallbackTab) {
        setActiveTab(fallbackTab);
      }
    }
  }, [isAuthenticatedState, isStoreManager, supplyNavigation.state.active, supplyNavigation.outsideTab]);

  // Close sidebar on navigation (mobile)
  const handleNavigate = (id: string) => {
    const nextTab = guardActiveTab(id);
    supplyNavigation.selectAppTab(nextTab, effectiveActiveTab, selectedBranch);
    setActiveTab(nextTab);
    setIsSidebarOpen(false);
  };

  const handleAddEmployee = (newEmployee: Employee) => {
    setEmployees((prev: Employee[]) => [newEmployee, ...prev]);
    setActiveTab(guardActiveTab('employees'));
    setEmployeeToEdit(null); // Clear edit state
  };

  const handleEditEmployee = (employee: Employee) => {
    setEmployeeToEdit(employee);
    setActiveTab(guardActiveTab('add-employee'));
  };

  // Handle logout
  const handleLogout = () => {
    if (currentUser?.role === STORE_MANAGER_ROLE) {
      localStorage.removeItem('smc_active_tab');
      setActiveTab('dashboard');
    }
    logout();
    setIsAuthenticatedState(false);
  };

  const appLayoutStyle = {
    // Hover expansion overlays content; the reserved desktop rail never grows.
    ['--app-sidebar-offset' as string]: '72px',
  } as React.CSSProperties;


  if (!isAuthenticatedState) return <LoginScreen onLogin={() => setIsAuthenticatedState(true)} isDarkMode={isDarkMode} />;

  const pageTitles: Record<string, string> = {
    // ... pageTitles
    dashboard: 'مركز القيادة والتحكم',
    services: 'إدارة منظومة الخدمات',
    'promo-codes': 'أكواد الخصم',
    employees: 'إدارة الكادر البشري',
    'add-employee': employeeToEdit ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد',
    customers: 'سجلات النخبة',
    invoices: 'إدارة العمليات المالية',
    treasury: 'بوابة الخزينة والماليات',
    expenses: 'إدارة المصروفات',
    inventory: 'مركز الإمداد',
    finance: 'الحسابات والمرتبات',
    reports: 'التقارير الإستراتيجية',

    settings: 'إعدادات النظام التنفيذي',
    attendance: 'منصة تدقيق الحضور'
  };

  const branchLabels: Record<string, string> = {
    'All': 'كافة الفروع',
    'Cairo': 'فرع القاهرة - التجمع',
    'Giza': 'فرع الجيزة - الشيخ زايد',
    'Alex': 'فرع الإسكندرية - سموحة'
  };

  const renderContent = () => {
    if (isStoreManager) {
      return <InventoryPage isDarkMode={isDarkMode} selectedBranch={selectedBranch} navigation={supplyNavigation} />;
    }

    // ... renderContent implementation remains same, just ensuring no mock data usage here
    if (effectiveActiveTab === 'promo-codes' && canViewPromos(currentUser?.role)) return <PromoCodesPage isDarkMode={isDarkMode} selectedBranch={selectedBranch} user={currentUser} />;
    if (effectiveActiveTab === 'services') return <ServicesPage isDarkMode={isDarkMode} selectedBranch={selectedBranch} />;
    if (effectiveActiveTab === 'employees') return <EmployeesPage isDarkMode={isDarkMode} selectedBranch={selectedBranch} employeesList={employees} onNavigateToAdd={() => { setEmployeeToEdit(null); setActiveTab('add-employee'); }} setEmployeesList={setEmployees} onEdit={handleEditEmployee} />;
    if (effectiveActiveTab === 'add-employee') return <AddEmployeePage isDarkMode={isDarkMode} onSave={handleAddEmployee} onCancel={() => setActiveTab('employees')} employeeToEdit={employeeToEdit} />;
    if (effectiveActiveTab === 'customers') return <ClientsPage isDarkMode={isDarkMode} selectedBranch={selectedBranch} />;
    if (effectiveActiveTab === 'invoices') return <InvoicesPage isDarkMode={isDarkMode} selectedBranch={selectedBranch} isSidebarCollapsed />;
    if (effectiveActiveTab === 'expenses') return <ExpensesPage isDarkMode={isDarkMode} selectedBranch={selectedBranch} />;
    if (effectiveActiveTab === 'treasury') return <AdminTreasuryPage isDarkMode={isDarkMode} selectedBranch={selectedBranch} />;
    if (effectiveActiveTab === 'inventory') return <InventoryPage isDarkMode={isDarkMode} selectedBranch={selectedBranch} navigation={supplyNavigation} />;
    if (effectiveActiveTab === 'reports') return <ReportsPage isDarkMode={isDarkMode} selectedBranch={selectedBranch} />;
    if (effectiveActiveTab === 'settings') return <SettingsPage isDarkMode={isDarkMode} />;
    if (effectiveActiveTab === 'attendance') return <AdminAttendanceDashboard isDarkMode={isDarkMode} selectedBranch={selectedBranch} />;

    if (effectiveActiveTab !== 'dashboard') {
      return (
        <div className={`admin-page-shell admin-page-shell--narrow admin-page-state flex flex-col items-center justify-center text-center p-6 sm:p-12 rounded-2xl border theme-transition ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-white border-black/5 luxury-shadow-light'
          }`}>
          <div className="w-12 h-12 sm:w-16 sm:h-16 bg-[#E6D690]/10 rounded-full flex items-center justify-center text-[#E6D690] mb-6 animate-pulse">
            <Sparkles size={32} />
          </div>
          <h2 className={`text-xl sm:text-2xl font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>هذه الصفحة قيد التطوير</h2>
          <p className={`max-w-md font-bold text-sm sm:text-base ${isDarkMode ? 'text-[#9E9E9E]' : 'text-[#6E6E6E]'}`}>نعمل على تجهيز أدوات التحكم التشغيلية بأعلى المعايير.</p>
          <button onClick={() => setActiveTab('dashboard')} className="mt-8 text-[10px] font-bold text-[#E6D690] uppercase tracking-widest border border-[#E6D690]/30 px-6 sm:px-8 py-3 rounded hover:bg-[#E6D690]/10 transition-all">
            العودة لمركز القيادة
          </button>
        </div>
      );
    }

    return <Dashboard isDarkMode={isDarkMode} selectedBranch={selectedBranch} />;
  };

  return (
    <div className={`min-h-screen flex animate-fade-in theme-transition ${isDarkMode ? 'bg-[#0D0D0D]' : 'bg-[#F7F7F7]'}`} dir="rtl" style={appLayoutStyle}>
      {/* Branch Change Notification Toast */}
      <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] theme-transition transform ${showBranchToast ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0 pointer-events-none'}`}>
        <div className={`px-6 py-4 rounded-2xl flex items-center gap-4 shadow-2xl border ${isDarkMode ? 'bg-[#161616] border-white/10 text-white' : 'bg-white border-black/10 text-gray-900'}`}>
          <div className="w-8 h-8 rounded-full bg-[#E53935]/10 flex items-center justify-center text-[#E53935]">
            <CheckCircle2 size={18} />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-40 leading-none mb-1">تم تحديث النطاق</span>
            <span className="text-sm font-bold">{branchLabels[selectedBranch]}</span>
          </div>
        </div>
      </div>

      {/* Sidebar - Drawer on mobile, fixed on desktop */}
      <SideNav
        activeTab={effectiveActiveTab === 'add-employee' ? 'employees' : effectiveActiveTab}
        onNavigate={handleNavigate}
        isDarkMode={isDarkMode}
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        onLogout={handleLogout}
        userRole={currentUser?.role}
      />

      {/* Overlay for mobile drawer */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-[55] lg:hidden backdrop-blur-[2px] transition-opacity duration-300"
          onClick={() => setIsSidebarOpen(false)}
        ></div>
      )}

      {/* Mobile Bottom Navigation */}
      <BottomNav
        activeTab={effectiveActiveTab === 'add-employee' ? 'employees' : effectiveActiveTab}
        onNavigate={handleNavigate}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        isDarkMode={isDarkMode}
        userRole={currentUser?.role}
      />

      <div
        className="flex-1 min-w-0 flex flex-col mr-0 lg:mr-[72px] pb-[80px] lg:pb-0"
      >
        <Header
          selectedBranch={selectedBranch}
          onBranchChange={(branch) => { setSelectedBranch(branch); supplyNavigation.updateLocation(branch); }}
          pageTitle={pageTitles[effectiveActiveTab] || pageTitles.inventory}
          isDarkMode={isDarkMode}
          onToggleTheme={() => setIsDarkMode(!isDarkMode)}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isSidebarOpen={isSidebarOpen}
        />
        <div className="admin-main-content transition-all duration-500 ease-in-out">
          {renderContent()}
        </div>
      </div>


    </div>
  );
};

export default App;
