import React, { useState, useMemo, useEffect } from 'react';
import { UserPlus, Search, Users, LayoutGrid, List, ArrowLeftRight, Filter } from 'lucide-react';
import { Employee, EmployeeRole, EmployeeStatus, ROLE_LABELS } from '../types';
import EmployeeCard from './EmployeeCard.tsx';
import EmployeeTable from './EmployeeTable.tsx';
import EmployeeDetailsPage from './EmployeeDetailsPage.tsx';
import TransferModal from './TransferModal.tsx';
import adminApi from '../api/client';
import { getTodayISO } from '../utils/dateFormatter';

interface EmployeesPageProps {
  isDarkMode: boolean;
  selectedBranch: string;
  employeesList: Employee[]; // Kept for prop interface compatibility, but ignored for internal data
  setEmployeesList: React.Dispatch<React.SetStateAction<Employee[]>>;
  onNavigateToAdd: () => void;
  onEdit?: (employee: Employee) => void;
}

const EmployeesPage: React.FC<EmployeesPageProps> = ({ isDarkMode, selectedBranch, employeesList, setEmployeesList, onNavigateToAdd, onEdit }) => {
  const [activeRole, setActiveRole] = useState<'All' | EmployeeRole>('All');
  const [activeStatus, setActiveStatus] = useState<'All' | EmployeeStatus>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [currentEmployees, setCurrentEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);

  // Deletion Modal State
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; employee: Employee | null }>({
    isOpen: false,
    employee: null
  });

  const [transferState, setTransferState] = useState<{ isOpen: boolean; preselectedEmployee: Employee | null }>({
    isOpen: false,
    preselectedEmployee: null
  });

  // Safe Scroll Isolation: lock background scroll while employee profile workspace is open
  useEffect(() => {
    if (!selectedEmployee) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [Boolean(selectedEmployee)]);

  const fetchEmployees = async () => {
    setIsLoading(true);
    try {
      const params: any = {};
      if (selectedBranch !== 'All') {
        params.branch_id = selectedBranch;
      }
      if (includeDeleted) {
        params.include_deleted = 'true';
      }

      const response = await adminApi.get('/employees', { params });
      const backendEmployees = response.data;

      const mappedEmployees: Employee[] = backendEmployees.map((e: any) => ({
        id: e.id.toString(),
        internalId: `EMP-${e.id.toString().padStart(3, '0')}`,
        name: e.full_name,
        phone: e.phone || '',
        role: (e.role as EmployeeRole) || 'ADMIN', // Default fallback
        branch: e.branch_name || 'غير محدد',
        branch_id: e.branch_id?.toString(),
        status: e.is_active ? 'نشط' : 'موقوف',
        is_deleted: e.is_deleted || false,
        employmentDate: e.created_at?.split('T')[0] || getTodayISO(),
        baseSalary: e.base_salary || 0,
        commission_wallet_balance: e.commission_wallet_balance || 0,
        lastNetPaid: 0,
        lastPayDate: '---',
        avatarColor: '#E53935',
        photoUrl: e.image_url ? (e.image_url.startsWith('http') ? e.image_url : `${import.meta.env.VITE_API_URL || 'http://localhost:5001'}/uploads/${e.image_url.replace(/\\/g, '/')}`) : undefined,
        documents: e.documents || [], // Map documents from backend
        createdAt: e.created_at
      }));

      setEmployeesList(mappedEmployees);
      setCurrentEmployees(mappedEmployees);

    } catch (error) {
      console.error("Failed to fetch employees:", error);
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    fetchEmployees();
  }, [selectedBranch, includeDeleted]);

  const handleDeleteEmployee = async () => {
    if (!deleteModal.employee) return;

    try {
      await adminApi.delete(`/employees/${deleteModal.employee.id}`);
      // Refresh list
      fetchEmployees();
      setDeleteModal({ isOpen: false, employee: null });
      // If detailed view was open, close it
      if (selectedEmployee?.id === deleteModal.employee.id) {
        setSelectedEmployee(null);
      }
    } catch (error) {
      console.error("Failed to delete employee", error);
      alert("فشل حذف الموظف");
    }
  };

  const handleToggleStatus = async (employee: Employee) => {
    try {
      // If active -> suspend. If suspended -> activate.
      const newStatus = employee.status === 'نشط' ? 'SUSPENDED' : 'ACTIVE'; // Send Enum value
      await adminApi.put(`/employees/${employee.id}`, { status: newStatus });
      fetchEmployees();
      // Update selectedEmployee if open
      if (selectedEmployee?.id === employee.id) {
        setSelectedEmployee(prev => prev ? ({ ...prev, status: newStatus === 'ACTIVE' ? 'نشط' : 'موقوف' }) : null);
      }
    } catch (error) {
      console.error("Failed to toggle status", error);
    }
  };

  const roles: ('All' | EmployeeRole)[] = ['All', 'BARBER', 'CASHIER', 'ADMIN', 'ASSISTANT', 'STAFF'];
  const statuses: ('All' | EmployeeStatus)[] = ['All', 'نشط', 'موقوف'];

  const filteredEmployees = useMemo(() => {
    return currentEmployees.filter(emp => {
      // Backend handles Branch Filtering now

      // 1. Search Query
      const matchesSearch = emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.phone.includes(searchQuery);

      if (!matchesSearch) return false;

      // 2. Role Filter
      const matchesRole = activeRole === 'All' || emp.role === activeRole;
      if (!matchesRole) return false;

      // 3. Status Filter (Bypassed if employee is deleted)
      if (emp.is_deleted) return true;

      const matchesStatus = activeStatus === 'All' || emp.status === activeStatus;
      return matchesStatus;
    }).sort((a, b) => {
      // Sort by createdAt descending
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (dateB !== dateA) return dateB - dateA;
      // Fallback to ID descending
      return parseInt(b.id) - parseInt(a.id);
    });
  }, [currentEmployees, activeRole, activeStatus, searchQuery]);


  const handleTransferConfirm = () => {
    fetchEmployees();
    setTransferState({ isOpen: false, preselectedEmployee: null });
    if (selectedEmployee) {
      setSelectedEmployee(null);
    }
  };

  return (
    <>
      <div className="admin-page-shell space-y-8 animate-fade-in-up">

      {/* 1) TOP ACTION BAR */}
      <div className="flex flex-col lg:flex-row justify-end items-start lg:items-center gap-6">
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          <button
            onClick={() => setTransferState({ isOpen: true, preselectedEmployee: null })}
            className="bg-[#E53935] hover:bg-[#FF3B30] text-white px-8 py-4 rounded-2xl text-[11px] font-bold uppercase tracking-widest shadow-xl shadow-red-900/20 transition-all flex items-center justify-center gap-2 active:scale-95"
          >
            <ArrowLeftRight size={18} />
            نقل لفرع آخر
          </button>

          <button
            onClick={onNavigateToAdd}
            className="flex-1 sm:flex-none bg-[#E53935] hover:bg-[#FF3B30] text-white px-8 py-4 rounded-2xl text-[11px] font-bold uppercase tracking-widest shadow-xl shadow-red-900/20 flex items-center justify-center gap-2 transition-all active:scale-95 border border-white/10"
          >
            <UserPlus size={18} />
            إضافة موظف
          </button>
        </div>
      </div>

      {/* 2) Toolbar / Filters */}
      <div className="space-y-6">

        {/* Search Input Bar */}
        <div className="relative group">
          <Search size={18} className={`absolute right-4 top-1/2 -translate-y-1/2 transition-colors ${isDarkMode ? 'text-gray-600 group-focus-within:text-[#E53935]' : 'text-gray-400 group-focus-within:text-[#E53935]'}`} />
          <input
            type="text"
            placeholder="ابحث عن موظف بالاسم أو الهاتف..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full px-12 py-4 rounded-2xl border text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#161616] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-white border-gray-200 text-gray-900 focus:border-[#E53935]/40 shadow-sm'
              }`}
          />
        </div>

        {/* Roles Filter Bar */}
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className={`flex flex-1 p-1 rounded-2xl border overflow-x-auto w-full scrollbar-hide ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-gray-50 border-black/5'}`}>
            {roles.map(role => (
              <button
                key={role}
                onClick={() => setActiveRole(role)}
                className={`px-6 py-3 rounded-xl whitespace-nowrap text-[10px] font-bold uppercase tracking-widest transition-all ${activeRole === role
                  ? (isDarkMode ? 'bg-white/10 text-[#E6D690]' : 'bg-white shadow-sm text-gray-900')
                  : 'text-gray-500 hover:text-gray-400'
                  }`}
              >
                {role === 'All' ? 'كافة الوظائف' : ROLE_LABELS[role]}
              </button>
            ))}
          </div>

          {/* Status Filter Bar */}
          <div className={`flex p-1 rounded-2xl border ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-gray-50 border-black/5'}`}>
            {statuses.map(status => (
              <button
                key={status}
                onClick={() => setActiveStatus(status)}
                className={`px-6 py-3 rounded-xl whitespace-nowrap text-[10px] font-bold uppercase tracking-widest transition-all ${activeStatus === status
                  ? (isDarkMode ? 'bg-white/10 text-[#E53935]' : 'bg-white shadow-sm text-[#E53935]')
                  : 'text-gray-500 hover:text-gray-400'
                  }`}
              >
                {status === 'All' ? 'كافة الحالات' : status}
              </button>
            ))}
          </div>
        </div>

        {/* Branch Filter & View Mode */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Branch Display */}
            <div className={`flex items-center gap-3 px-6 py-3.5 rounded-2xl border ${isDarkMode ? 'bg-[#161616] border-white/5 text-gray-400' : 'bg-gray-50 border-black/5 text-gray-500'}`}>
              <Filter size={14} className="text-[#E6D690]" />
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">الفرع النشط:</span>
                <span className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{selectedBranch === 'All' ? 'كافة الفروع' : `فرع #${selectedBranch}`}</span>
              </div>
            </div>

            {/* Show Deleted Switch */}
            <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border cursor-pointer select-none transition-all ${includeDeleted ? (isDarkMode ? 'bg-red-900/10 border-red-500/30' : 'bg-red-50 border-red-200') : (isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-gray-50 border-black/5')}`}
              onClick={() => setIncludeDeleted(!includeDeleted)}>
              <div className={`w-8 h-4 rounded-full relative transition-colors ${includeDeleted ? 'bg-[#E53935]' : 'bg-gray-500/30'}`}>
                <div className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-sm transition-all ${includeDeleted ? 'right-1' : 'right-4'}`}></div>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-widest ${includeDeleted ? 'text-[#E53935]' : 'text-gray-500'}`}>عرض المحذوفين</span>
            </div>
          </div>

          <div className={`flex p-1 rounded-2xl border ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-gray-50 border-black/5'}`}>
            <button
              onClick={() => setViewMode('cards')}
              className={`p-2 px-4 rounded-xl flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest transition-all ${viewMode === 'cards' ? (isDarkMode ? 'bg-white/5 text-white' : 'bg-white shadow-sm text-gray-900') : 'text-gray-500 hover:text-gray-400'
                }`}
            >
              <LayoutGrid size={14} /> بطاقات
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 px-4 rounded-xl flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest transition-all ${viewMode === 'list' ? (isDarkMode ? 'bg-white/5 text-white' : 'bg-white shadow-sm text-gray-900') : 'text-gray-500 hover:text-gray-400'
                }`}
            >
              <List size={14} /> قائمة
            </button>
          </div>
        </div>
      </div>

      {/* 3) Main View */}
      {filteredEmployees.length > 0 ? (
        viewMode === 'cards' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,275px))] gap-6 justify-center">
            {filteredEmployees.map(emp => (
              <EmployeeCard
                key={emp.id}
                employee={emp}
                isDarkMode={isDarkMode}
                onViewDetails={(e) => setSelectedEmployee(e)}
                onEdit={() => onEdit && onEdit(emp)}
                onFinancials={() => setTransferState({ isOpen: true, preselectedEmployee: emp })}
                onDelete={() => setDeleteModal({ isOpen: true, employee: emp })}
                onToggleStatus={() => handleToggleStatus(emp)}
              />
            ))}
          </div>
        ) : (
          <EmployeeTable
            employees={filteredEmployees}
            isDarkMode={isDarkMode}
            onViewDetails={(e) => setSelectedEmployee(e)}
            onTransfer={(e) => setTransferState({ isOpen: true, preselectedEmployee: e })}
            onEdit={onEdit}
            onDelete={(emp) => setDeleteModal({ isOpen: true, employee: emp })}
            onToggleStatus={(emp) => handleToggleStatus(emp)}
          />
        )
      ) : (
        <div className="py-24 text-center opacity-40">
          <Users size={48} className="mx-auto mb-4" />
          <p className="text-sm font-bold">
            {isLoading ? 'جاري تحميل البيانات...' : 'لا يوجد موظفين يطابقون خيارات البحث الحالية'}
          </p>
        </div>
      )}
      </div>

      {/* Employee Profile Overlay – Full Screen Workspace (Mounted Outside Transformed Shell) */}
      {selectedEmployee && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`الملف التعريفي للموظف: ${selectedEmployee.name}`}
          className="admin-workspace-shell admin-workspace-shell--with-sidebar fixed inset-[var(--app-header-height)_0_0_0] z-[110] lg:right-[var(--app-sidebar-offset)] overflow-hidden overscroll-contain"
          dir="rtl"
        >
          <EmployeeDetailsPage
            employee={selectedEmployee}
            isDarkMode={isDarkMode}
            onBack={() => setSelectedEmployee(null)}
            onOpenTransfer={() => {
              setTransferState({ isOpen: true, preselectedEmployee: selectedEmployee });
            }}
            onEdit={() => onEdit && onEdit(selectedEmployee)}
            onDelete={() => setDeleteModal({ isOpen: true, employee: selectedEmployee })}
            onToggleStatus={() => handleToggleStatus(selectedEmployee)}
          />
        </div>
      )}

      {transferState.isOpen && (
        <TransferModal
          employee={transferState.preselectedEmployee}
          allEmployees={currentEmployees}
          isDarkMode={isDarkMode}
          onClose={() => setTransferState({ isOpen: false, preselectedEmployee: null })}
          onConfirm={handleTransferConfirm}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.isOpen && deleteModal.employee && (
        <div className="admin-overlay-shell z-[200] bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className={`w-full max-w-md p-6 rounded-3xl border shadow-2xl transition-all scale-100 ${isDarkMode ? 'bg-[#161616] border-white/10' : 'bg-white border-black/10'}`}>
            <h3 className={`text-xl font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>تأكيد حذف الموظف</h3>
            <p className={`text-sm mb-6 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              هل أنت متأكد من حذف الموظف
              <span className="text-[#E53935] font-bold mx-1">{deleteModal.employee.name}</span>؟
              <br />
              لن يتم حذف بياناته المالية، وسيتم إخفاؤه فقط من القوائم النشطة.
            </p>

            <div className="flex gap-3">
              <button
                onClick={handleDeleteEmployee}
                className="flex-1 bg-[#E53935] hover:bg-[#D32F2F] text-white py-3 rounded-xl font-bold transition-all text-sm"
              >
                حذف نهائي
              </button>
              <button
                onClick={() => setDeleteModal({ isOpen: false, employee: null })}
                className={`flex-1 py-3 rounded-xl font-bold transition-all text-sm border ${isDarkMode ? 'border-white/10 hover:bg-white/5 text-gray-300' : 'border-gray-200 hover:bg-gray-50 text-gray-700'}`}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
export default EmployeesPage;
