
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
        <div className={`absolute -right-36 top-12 h-[520px] w-[520px] rounded-full blur-[150px] ${isDarkMode ? 'bg-red-700/[0.07]' : 'bg-red-200/25'}`} />
        <div className={`absolute -left-40 bottom-0 h-[480px] w-[480px] rounded-full blur-[160px] ${isDarkMode ? 'bg-amber-500/[0.04]' : 'bg-amber-100/25'}`} />
      </div>}

      <header className="mb-7 flex flex-col gap-5">
        <div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">التقارير</h1>
          <p className={`mt-2 max-w-3xl text-sm leading-7 ${mutedText(isDarkMode)}`}>قراءة إدارية موثوقة للمبيعات والخدمات والمنتجات والعملاء والأداء المالي والفروع، مبنية على الفواتير المدفوعة والبيانات التشغيلية الحالية.</p>
        </div>
        <div className={`flex w-full flex-wrap items-center gap-1.5 rounded-2xl border p-1.5 ${isDarkMode ? 'border-white/[0.08] bg-[#111]' : 'border-black/[0.07] bg-white shadow-sm'}`}>
          <button type="button" onClick={() => setSection('overview')} className={`inline-flex flex-1 min-w-fit items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition sm:px-5 ${section === 'overview' ? 'bg-[#E53935] text-white shadow-lg shadow-red-500/20' : mutedText(isDarkMode)}`}><LayoutDashboard size={16} /> نظرة تنفيذية</button>
          <button type="button" onClick={() => setSection('services')} className={`inline-flex flex-1 min-w-fit items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition sm:px-5 ${section === 'services' ? 'bg-[#E53935] text-white shadow-lg shadow-red-500/20' : mutedText(isDarkMode)}`}><Scissors size={16} /> الخدمات</button>
          <button type="button" onClick={() => setSection('products')} className={`inline-flex flex-1 min-w-fit items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition sm:px-5 ${section === 'products' ? 'bg-[#E53935] text-white shadow-lg shadow-red-500/20' : mutedText(isDarkMode)}`}><Boxes size={16} /> المنتجات</button>
          <button type="button" onClick={() => setSection('sales')} className={`inline-flex flex-1 min-w-fit items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition sm:px-5 ${section === 'sales' ? 'bg-[#E53935] text-white shadow-lg shadow-red-500/20' : mutedText(isDarkMode)}`}><ReceiptText size={16} /> المبيعات</button>
          <button type="button" onClick={() => setSection('finance')} className={`inline-flex flex-1 min-w-fit items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition sm:px-5 ${section === 'finance' ? 'bg-[#E53935] text-white shadow-lg shadow-red-500/20' : mutedText(isDarkMode)}`}><Landmark size={16} /> المالية والخزنة</button>
          <button type="button" onClick={() => setSection('branches')} className={`inline-flex flex-1 min-w-fit items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition sm:px-5 ${section === 'branches' ? 'bg-[#E53935] text-white shadow-lg shadow-red-500/20' : mutedText(isDarkMode)}`}><Building2 size={16} /> أداء الفروع</button>
          <button type="button" onClick={() => setSection('employees')} className={`inline-flex flex-1 min-w-fit items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition sm:px-5 ${section === 'employees' ? 'bg-[#E53935] text-white shadow-lg shadow-red-500/20' : mutedText(isDarkMode)}`}><UsersRound size={16} /> الموظفون</button>
          <button type="button" onClick={() => setSection('customers')} className={`inline-flex flex-1 min-w-fit items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition sm:px-5 ${section === 'customers' ? 'bg-[#E53935] text-white shadow-lg shadow-red-500/20' : mutedText(isDarkMode)}`}><UserRoundSearch size={16} /> العملاء</button>
          <button type="button" onClick={() => setSection('operations')} className={`inline-flex flex-1 min-w-fit items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition sm:px-5 ${section === 'operations' ? 'bg-[#E53935] text-white shadow-lg shadow-red-500/20' : mutedText(isDarkMode)}`}><ShieldCheck size={16} /> العمليات</button>
        </div>
      </header>

      {section === 'overview' ? <OverviewReport {...sharedProps} fixedBranchScope={fixedBranchScope} onNavigate={navigateToReport} /> : section === 'services' ? <ServicesReport {...sharedProps} /> : section === 'products' ? <ProductsReport {...sharedProps} /> : section === 'sales' ? <SalesReport {...sharedProps} /> : section === 'finance' ? <FinanceReport {...sharedProps} /> : section === 'branches' ? <BranchesReport {...sharedProps} /> : section === 'employees' ? <EmployeesReport {...sharedProps} /> : section === 'customers' ? <CustomersReport {...sharedProps} /> : <OperationsReport {...sharedProps} onNavigateFinance={() => navigateToReport('finance')} />}
    </main>
  );
};

export default ReportsPage;
