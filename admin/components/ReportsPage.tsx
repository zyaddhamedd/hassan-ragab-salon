
import React, { useEffect, useRef, useState } from 'react';
import { Boxes, Building2, Landmark, LayoutDashboard, ReceiptText, Scissors, ShieldCheck, UserRoundSearch, UsersRound } from 'lucide-react';
import adminApi from '../api/client';
import { getCurrentUser } from '../api/auth';
import ProductsReport from './reports/ProductsReport';
import FinanceReport from './reports/FinanceReport';
import BranchesReport from './reports/BranchesReport';
import SalesReport from './reports/SalesReport';
import ServicesReport from './reports/ServicesReport';
import EmployeesReport from './reports/EmployeesReport';
import CustomersReport from './reports/CustomersReport';
import OperationsReport from './reports/OperationsReport';
import OverviewReport from './reports/OverviewReport';
import { mutedText } from './reports/ReportPrimitives';
import { rangeForPreset, type DatePreset } from './reports/reportUtils';
import type { NamedOption, ReportDateRange } from './reports/types';

interface ReportsPageProps {
  isDarkMode: boolean;
  selectedBranch: string;
}

type ReportSection = 'overview' | 'services' | 'products' | 'sales' | 'finance' | 'branches' | 'employees' | 'customers' | 'operations';

const reportSections: ReportSection[] = ['overview', 'services', 'products', 'sales', 'finance', 'branches', 'employees', 'customers', 'operations'];

const initialUrlState = (selectedBranch: string) => {
  const params = new URLSearchParams(window.location.search);
  const requestedSection = params.get('report') as ReportSection | null;
  const dateFrom = params.get('date_from');
  const dateTo = params.get('date_to');
  const validRange = Boolean(dateFrom && dateTo && dateFrom <= dateTo);
  return {
    section: requestedSection && reportSections.includes(requestedSection) ? requestedSection : 'overview' as ReportSection,
    range: validRange ? { dateFrom: dateFrom!, dateTo: dateTo! } : rangeForPreset('month'),
    preset: validRange ? 'custom' as DatePreset : 'month' as DatePreset,
    branchId: params.get('branch_id') || selectedBranch,
  };
};

const ReportsPage: React.FC<ReportsPageProps> = ({ isDarkMode, selectedBranch }) => {
  const currentUser = getCurrentUser();
  const fixedBranchScope = currentUser?.role === 'BRANCH_MANAGER';
  const initial = useRef(initialUrlState(selectedBranch));
  const [section, setSection] = useState<ReportSection>(initial.current.section);
  const [preset, setPreset] = useState<DatePreset>(initial.current.preset);
  const [range, setRange] = useState<ReportDateRange>(initial.current.range);
  const [branchId, setBranchId] = useState(fixedBranchScope && currentUser?.branch_id ? String(currentUser.branch_id) : initial.current.branchId);
  const [branches, setBranches] = useState<NamedOption[]>([]);
  const lastGlobalBranch = useRef(selectedBranch);

  useEffect(() => {
    if (fixedBranchScope && currentUser?.branch_id) {
      setBranchId(String(currentUser.branch_id));
      return;
    }
    if (lastGlobalBranch.current !== selectedBranch) setBranchId(selectedBranch);
    lastGlobalBranch.current = selectedBranch;
  }, [selectedBranch, fixedBranchScope, currentUser?.branch_id]);
  useEffect(() => {
    const loadBranches = async () => {
      try {
        const response = await adminApi.get<NamedOption[]>('/branches');
        setBranches(response.data.map((branch) => ({ id: branch.id, name: branch.name })));
      } catch {
        setBranches([]);
      }
    };
    void loadBranches();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('report', section);
    params.set('date_from', range.dateFrom);
    params.set('date_to', range.dateTo);
    if (branchId && branchId !== 'All') params.set('branch_id', branchId);
    else params.delete('branch_id');
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }, [section, range, branchId]);

  const navigateToReport = (target: Exclude<ReportSection, 'overview'>, options?: { branchId?: string; focus?: string }) => {
    if (options?.branchId) setBranchId(options.branchId);
    setSection(target);
  };

  const sharedProps = {
    isDarkMode,
    range,
    preset,
    branchId,
    branches,
    onRangeChange: setRange,
    onPresetChange: setPreset,
    onBranchChange: setBranchId,
  };

  return (
    <main className={`admin-page-shell min-h-[calc(100vh-var(--app-header-height))] overflow-x-hidden lg:px-8 ${isDarkMode ? 'text-white' : 'text-[#171717]'}`} dir="rtl">
      {section !== 'overview' && <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className={`absolute -right-36 top-12 h-[520px] w-[520px] rounded-full blur-[150px] ${isDarkMode ? 'bg-[#C5A880]/[0.04]' : 'bg-[#C5A880]/10'}`} />
        <div className={`absolute -left-40 bottom-0 h-[480px] w-[480px] rounded-full blur-[160px] ${isDarkMode ? 'bg-amber-500/[0.03]' : 'bg-amber-100/20'}`} />
      </div>}

      <header className="mb-7 space-y-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">التقارير</h1>
        </div>
        <div className={`w-full overflow-x-auto no-scrollbar rounded-2xl border p-1.5 ${isDarkMode ? 'border-white/[0.08] bg-[#111114]' : 'border-black/[0.07] bg-white shadow-sm'}`}>
          <div className="flex w-full items-center gap-1.5 min-w-max sm:min-w-0">
            <button
              type="button"
              onClick={() => setSection('overview')}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition whitespace-nowrap cursor-pointer ${
                section === 'overview'
                  ? 'bg-gradient-to-r from-[#C5A880] to-[#E6D690] text-black shadow-lg shadow-[#C5A880]/20'
                  : mutedText(isDarkMode) + ' hover:text-white hover:bg-white/5'
              }`}
            >
              <LayoutDashboard size={15} />
              <span>نظرة تنفيذية</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('services')}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition whitespace-nowrap cursor-pointer ${
                section === 'services'
                  ? 'bg-gradient-to-r from-[#C5A880] to-[#E6D690] text-black shadow-lg shadow-[#C5A880]/20'
                  : mutedText(isDarkMode) + ' hover:text-white hover:bg-white/5'
              }`}
            >
              <Scissors size={15} />
              <span>الخدمات</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('products')}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition whitespace-nowrap cursor-pointer ${
                section === 'products'
                  ? 'bg-gradient-to-r from-[#C5A880] to-[#E6D690] text-black shadow-lg shadow-[#C5A880]/20'
                  : mutedText(isDarkMode) + ' hover:text-white hover:bg-white/5'
              }`}
            >
              <Boxes size={15} />
              <span>المنتجات</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('sales')}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition whitespace-nowrap cursor-pointer ${
                section === 'sales'
                  ? 'bg-gradient-to-r from-[#C5A880] to-[#E6D690] text-black shadow-lg shadow-[#C5A880]/20'
                  : mutedText(isDarkMode) + ' hover:text-white hover:bg-white/5'
              }`}
            >
              <ReceiptText size={15} />
              <span>المبيعات</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('finance')}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition whitespace-nowrap cursor-pointer ${
                section === 'finance'
                  ? 'bg-gradient-to-r from-[#C5A880] to-[#E6D690] text-black shadow-lg shadow-[#C5A880]/20'
                  : mutedText(isDarkMode) + ' hover:text-white hover:bg-white/5'
              }`}
            >
              <Landmark size={15} />
              <span>المالية والخزنة</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('branches')}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition whitespace-nowrap cursor-pointer ${
                section === 'branches'
                  ? 'bg-gradient-to-r from-[#C5A880] to-[#E6D690] text-black shadow-lg shadow-[#C5A880]/20'
                  : mutedText(isDarkMode) + ' hover:text-white hover:bg-white/5'
              }`}
            >
              <Building2 size={15} />
              <span>أداء الفروع</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('employees')}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition whitespace-nowrap cursor-pointer ${
                section === 'employees'
                  ? 'bg-gradient-to-r from-[#C5A880] to-[#E6D690] text-black shadow-lg shadow-[#C5A880]/20'
                  : mutedText(isDarkMode) + ' hover:text-white hover:bg-white/5'
              }`}
            >
              <UsersRound size={15} />
              <span>الموظفون</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('customers')}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition whitespace-nowrap cursor-pointer ${
                section === 'customers'
                  ? 'bg-gradient-to-r from-[#C5A880] to-[#E6D690] text-black shadow-lg shadow-[#C5A880]/20'
                  : mutedText(isDarkMode) + ' hover:text-white hover:bg-white/5'
              }`}
            >
              <UserRoundSearch size={15} />
              <span>العملاء</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('operations')}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition whitespace-nowrap cursor-pointer ${
                section === 'operations'
                  ? 'bg-gradient-to-r from-[#C5A880] to-[#E6D690] text-black shadow-lg shadow-[#C5A880]/20'
                  : mutedText(isDarkMode) + ' hover:text-white hover:bg-white/5'
              }`}
            >
              <ShieldCheck size={15} />
              <span>العمليات</span>
            </button>
          </div>
        </div>
      </header>

      {section === 'overview' ? <OverviewReport {...sharedProps} fixedBranchScope={fixedBranchScope} onNavigate={navigateToReport} /> : section === 'services' ? <ServicesReport {...sharedProps} /> : section === 'products' ? <ProductsReport {...sharedProps} /> : section === 'sales' ? <SalesReport {...sharedProps} /> : section === 'finance' ? <FinanceReport {...sharedProps} /> : section === 'branches' ? <BranchesReport {...sharedProps} /> : section === 'employees' ? <EmployeesReport {...sharedProps} /> : section === 'customers' ? <CustomersReport {...sharedProps} /> : <OperationsReport {...sharedProps} onNavigateFinance={() => navigateToReport('finance')} />}
    </main>
  );
};

export default ReportsPage;
