
import React, { useState, useMemo } from 'react';
import {
  X,
  MapPin,
  ArrowLeftRight,
  History,
  Wallet,
  ShieldCheck,
  Calendar,
  Receipt,
  TrendingUp,
  CreditCard,
  Plus,
  Filter,
  UserCheck,
  Building2,
  Activity,
  FileText,
  Eye,
  Download,
  UploadCloud,
  FileBadge,
  Maximize2,
  Printer,
  ChevronLeft,
  FileBarChart,
  Users
} from 'lucide-react';
import { Employee, ROLE_LABELS } from '../types';
import Logo from './Logo.tsx';
import { getTodayISO, formatDateTime } from '../utils/dateFormatter';

interface EmployeeDetailsModalProps {
  employee: Employee;
  isDarkMode: boolean;
  onClose: () => void;
  onOpenTransfer?: () => void;
}

const EmployeeDetailsModal: React.FC<EmployeeDetailsModalProps> = ({ employee, isDarkMode, onClose, onOpenTransfer }) => {
  const [activeAreaTab, setActiveAreaTab] = useState<'record' | 'transfer' | 'financial' | 'documents'>('record');
  const [isPhotoLightboxOpen, setIsPhotoLightboxOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'standard' | 'payslip'>('standard');

  // Financial Sub-tabs
  const [financialSubTab, setFinancialSubTab] = useState<'salary' | 'advance' | 'deduction' | 'settlement'>('settlement');

  // Area 2 Sub-tabs
  const [recordSubTab, setRecordSubTab] = useState<'ops' | 'stats'>('ops');
  const [selectedBranchForStats, setSelectedBranchForStats] = useState<string>('All');

  // Settlement Date Range - Default to Current Month
  const [settlementRange, setSettlementRange] = useState({
    from: (() => { const t = getTodayISO().split('-'); return `${t[0]}-${t[1]}-01`; })(),
    to: getTodayISO()
  });

  // Helper to parse dates from the mock data strings for filtering
  const parseArabicDate = (dateStr: string): Date => {
    // If it's a standard ISO string from our state
    if (dateStr.includes('-')) return new Date(dateStr);

    // For mock data like "١٢ مايو" or similar
    // We treat them as current year "May" for the logic demo
    if (dateStr.includes('مايو')) return new Date('2025-05-12');
    if (dateStr.includes('أبريل')) return new Date('2025-04-12');
    return new Date();
  };

  // -------------------------------------------------------------------------
  // SETTLEMENT ACCOUNTING LOGIC
  // -------------------------------------------------------------------------
  const settlementStats = useMemo(() => {
    const from = new Date(settlementRange.from);
    const to = new Date(settlementRange.to);

    // 1. Filter and Sum Service Earnings
    const filteredOps = (employee.operationsLog || []).filter(op => {
      const d = parseArabicDate(op.date);
      return d >= from && d <= to;
    });
    const totalEarnings = filteredOps.reduce((acc, op) => acc + op.share, 0);

    // 2. Filter and Sum Deductions
    const filteredDeductions = (employee.deductions || []).filter(d => {
      const date = parseArabicDate(d.date);
      return date >= from && date <= to;
    });
    const totalDeductions = filteredDeductions.reduce((acc, d) => acc + d.amount, 0);

    // 3. Filter and Sum Advances
    const filteredAdvances = (employee.advances || []).filter(a => {
      const date = parseArabicDate(a.date);
      return date >= from && date <= to;
    });
    const totalAdvances = filteredAdvances.reduce((acc, a) => acc + a.amount, 0);

    return {
      earnings: totalEarnings,
      deductions: totalDeductions,
      advances: totalAdvances,
      net: totalEarnings - totalDeductions - totalAdvances,
      opsCount: filteredOps.length
    };
  }, [employee, settlementRange]);

  // General Stats for Record Tab
  const branchStats = useMemo(() => {
    const logs = employee.operationsLog || [];
    const filtered = selectedBranchForStats === 'All'
      ? logs
      : logs.filter(l => l.branch === selectedBranchForStats);

    return {
      count: filtered.length,
      totalValue: filtered.reduce((acc, l) => acc + l.value, 0),
      totalShare: filtered.reduce((acc, l) => acc + l.share, 0),
    };
  }, [employee.operationsLog, selectedBranchForStats]);

  // Calculate unique clients (estimated from operations)
  // Each operation represents a batch of client services
  // Using a conservative estimate: approximately 3-5 unique clients per operation on average
  const uniqueClientsCount = useMemo(() => {
    const totalOps = employee.operationsLog?.length || 0;
    // Conservative estimate: 4 unique clients per operation batch on average
    return Math.max(totalOps * 4, 0);
  }, [employee.operationsLog]);

  const handlePrint = () => {
    window.print();
  };

  // -------------------------------------------------------------------------
  // PAYSLIP VIEW (A4 Printable Component)
  // -------------------------------------------------------------------------
  if (viewMode === 'payslip') {
    return (
      <div className="admin-overlay-shell admin-overlay-shell--scroll z-[200] bg-black/95" dir="rtl">
        <div className="absolute inset-0" onClick={() => setViewMode('standard')}></div>
        <div className="relative w-full max-w-4xl bg-white text-black min-h-[1050px] p-12 sm:p-20 animate-scale-in font-['Tajawal'] print:p-0 print:m-0 print:shadow-none shadow-2xl rounded-sm">

          {/* Floating Print Tools (Hidden in Print) */}
          <div className="absolute top-8 left-8 flex gap-4 print:hidden">
            <button
              onClick={handlePrint}
              className="bg-[#E53935] text-white p-4 rounded-full shadow-2xl hover:scale-110 transition-transform flex items-center gap-2"
            >
              <Printer size={20} />
              <span className="text-xs font-bold uppercase tracking-widest">طباعة المستند</span>
            </button>
            <button
              onClick={() => setViewMode('standard')}
              className="bg-gray-100 text-gray-400 p-4 rounded-full shadow-lg hover:bg-gray-200"
            >
              <X size={20} />
            </button>
          </div>

          {/* Brand Identity */}
          <div className="flex flex-col items-center mb-16 pb-12 border-b-2 border-gray-100">
            <Logo size="lg" className="mb-6" />
            <h1 className="text-3xl font-black mb-1 uppercase tracking-tight text-gray-900">وصل تصفية حساب موظف</h1>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.4em]">Official Financial Settlement Document</p>
          </div>

          {/* Employee & Period Details */}
          <div className="grid grid-cols-2 gap-y-10 gap-x-16 mb-20 bg-gray-50 p-10 rounded-3xl">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">اسم الموظف المعتمد</span>
              <span className="text-xl font-bold text-gray-900">{employee.name}</span>
            </div>
            <div className="space-y-1 text-left">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">الفرع التشغيلي</span>
              <span className="text-xl font-bold text-gray-900">{employee.branch}</span>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">الفترة الزمنية</span>
              <span className="text-sm font-bold text-gray-700">{settlementRange.from} <span className="mx-2 opacity-30">إلى</span> {settlementRange.to}</span>
            </div>
            <div className="space-y-1 text-left">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">إجمالي العمليات المنفذة</span>
              <span className="text-sm font-bold text-gray-700">{settlementStats.opsCount} عملية</span>
            </div>
          </div>

          {/* Detailed Accounting Breakdown */}
          <div className="mb-20">
            <table className="w-full text-right">
              <thead>
                <tr className="border-b-2 border-gray-900 text-[11px] font-bold uppercase tracking-widest">
                  <th className="py-5 px-2">البنود المالية والتسويات</th>
                  <th className="py-5 px-2 text-left">المبلغ المستحق</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr className="text-sm font-bold">
                  <td className="py-8 px-2">مستحقات العمولات عن الخدمات (صافي)</td>
                  <td className="py-8 px-2 text-left text-gray-900">{settlementStats.earnings.toLocaleString()} ج.م</td>
                </tr>
                <tr className="text-sm font-bold text-red-500">
                  <td className="py-8 px-2">الخصومات الإدارية والجزاءات</td>
                  <td className="py-8 px-2 text-left">-{settlementStats.deductions.toLocaleString()} ج.م</td>
                </tr>
                <tr className="text-sm font-bold text-red-500">
                  <td className="py-8 px-2">إجمالي السلفيات المسحوبة خلال الفترة</td>
                  <td className="py-8 px-2 text-left">-{settlementStats.advances.toLocaleString()} ج.م</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Grand Total Settlement */}
          <div className="bg-gray-900 text-white p-12 rounded-[2.5rem] flex justify-between items-center mb-28 shadow-2xl relative overflow-hidden">
            <div className="space-y-1 relative z-10">
              <span className="text-[10px] font-bold uppercase tracking-[0.4em] opacity-40">الصافي النهائي المستحق للصرف</span>
              <p className="text-[9px] font-medium opacity-20 italic">تخضع هذه البيانات لتدقيق الإدارة المالية للنادي</p>
            </div>
            <span className="text-6xl font-black tracking-tighter relative z-10">{settlementStats.net.toLocaleString()} ج.م</span>
            <div className="absolute top-0 right-0 w-32 h-full bg-[#E53935]/10 -skew-x-12 translate-x-16"></div>
          </div>

          {/* Signatures Area */}
          <div className="grid grid-cols-2 gap-32">
            <div className="border-t-2 border-gray-100 pt-8 text-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-16 block">إقرار الموظف بالاستلام</span>
              <div className="h-[1px] bg-gray-200 w-2/3 mx-auto"></div>
            </div>
            <div className="border-t-2 border-gray-100 pt-8 text-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-16 block">اعتماد المدير المالي</span>
              <div className="h-[1px] bg-gray-200 w-2/3 mx-auto"></div>
            </div>
          </div>

          {/* Audit Footer */}
          <div className="mt-auto pt-24 flex flex-col items-center opacity-40">
            <div className="flex items-center gap-4 mb-4">
              <div className="h-[1px] w-12 bg-gray-300"></div>
              <p className="text-[9px] font-bold uppercase tracking-[0.6em] text-gray-400">THE SECRET MEN CLUB • FINANCE</p>
              <div className="h-[1px] w-12 bg-gray-300"></div>
            </div>
            <p className="text-[8px] font-bold uppercase tracking-widest text-gray-400">
              تم استخراج هذا المستند آلياً بتاريخ {formatDateTime(new Date())} • المعرف المالي: {employee.internalId}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-overlay-shell z-[110]" dir="rtl">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-xl" onClick={onClose}></div>
      <div className={`relative w-full max-w-5xl h-full sm:h-[90vh] sm:rounded-[3.5rem] border overflow-hidden flex flex-col animate-scale-in theme-transition ${isDarkMode ? 'bg-[#0F0F0F] border-white/10 shadow-2xl' : 'bg-white border-black/10 shadow-2xl'
        }`}>

        {/* HEADER */}
        <div className={`p-6 sm:p-8 border-b flex items-center justify-between ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-gray-50 border-black/5'}`}>
          <div className="flex items-center gap-4 sm:gap-6">
            <button
              onClick={() => setIsPhotoLightboxOpen(true)}
              className="relative group transition-transform active:scale-95"
            >
              {employee.photoUrl ? (
                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-[1.2rem] sm:rounded-[1.8rem] overflow-hidden border-2 sm:border-4 border-[#E53935] shadow-xl">
                  <img src={employee.photoUrl} alt={employee.name} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div
                  className="w-12 h-12 sm:w-16 sm:h-16 rounded-[1.2rem] sm:rounded-[1.8rem] flex items-center justify-center text-white font-bold text-lg sm:text-2xl shadow-xl border-2 sm:border-4 border-current"
                  style={{ backgroundColor: employee.avatarColor || '#E53935' }}
                >
                  {employee.name.charAt(0)}
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-[1.2rem] sm:rounded-[1.8rem]">
                <Maximize2 size={16} className="text-white" />
              </div>
            </button>
            <div className="flex flex-col">
              <h2 className={`text-xl sm:text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{employee.name}</h2>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-[#E53935] uppercase tracking-widest">{ROLE_LABELS[employee.role]}</span>
              </div>
            </div>
          </div>

          <button onClick={onClose} className={`p-2 sm:p-3 rounded-full transition-all ${isDarkMode ? 'hover:bg-white/5 text-gray-500' : 'hover:bg-black/5 text-gray-400'}`}>
            <X size={24} />
          </button>
        </div>

        {/* MAIN CONTENT AREA */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">

          {/* SUMMARY SECTION */}
          <div className={`p-6 sm:p-10 border-b flex flex-col lg:flex-row gap-8 justify-between items-start lg:items-center ${isDarkMode ? 'bg-white/[0.01] border-white/5' : 'bg-gray-50/50 border-black/5'}`}>
            <div className="flex flex-wrap gap-6 sm:gap-12">
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block">الفرع الحالي</span>
                <div className="flex items-center gap-2">
                  <Building2 size={14} className="text-[#E53935]" />
                  <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{employee.branch}</span>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block">الحالة</span>
                <div className="flex items-center gap-2">
                  <Activity size={14} className={employee.status === 'نشط' ? 'text-green-500' : 'text-red-500'} />
                  <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{employee.status}</span>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block">عدد العملاء</span>
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-[#E6D690]" />
                  <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{uniqueClientsCount.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-8 sm:gap-12 border-t lg:border-t-0 lg:border-r border-white/10 pt-6 lg:pt-0 lg:pr-12 w-full lg:w-auto">
              <div className="flex-1 sm:text-right">
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block mb-1">الراتب الأساسي</span>
                <span className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{employee.baseSalary.toLocaleString()} ج.م</span>
              </div>
              <div className="flex-1 sm:text-right">
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block mb-1">رصيد الفترة المفتوحة</span>
                <span className="text-lg font-bold text-[#E6D690]">{(employee.currentNetBalance || 0).toLocaleString()} ج.م</span>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="px-6 sm:px-10 border-b border-white/5 flex overflow-x-auto scrollbar-hide gap-6 sm:gap-10 sticky top-0 z-20 backdrop-blur-md bg-inherit">
            {[
              { id: 'record', label: 'ملف العمل', icon: <Receipt size={16} /> },
              { id: 'transfer', label: 'التنقلات', icon: <ArrowLeftRight size={16} /> },
              { id: 'financial', label: 'السجل المالي', icon: <Wallet size={16} /> },
              { id: 'documents', label: 'ملفات الموظف', icon: <FileText size={16} /> }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveAreaTab(tab.id as any)}
                className={`flex items-center gap-2 py-6 text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.2em] transition-all border-b-2 whitespace-nowrap ${activeAreaTab === tab.id
                  ? 'border-[#E53935] text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-400'
                  }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-6 sm:p-10">
            {/* AREA 2 – WORK RECORD */}
            {activeAreaTab === 'record' && (
              <div className="space-y-8 animate-fade-in">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className={`flex p-1 rounded-xl border w-full sm:w-auto ${isDarkMode ? 'bg-white/5 border-white/5' : 'bg-gray-50 border-black/5'}`}>
                    <button
                      onClick={() => setRecordSubTab('ops')}
                      className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${recordSubTab === 'ops' ? (isDarkMode ? 'bg-white/5 text-white' : 'bg-white shadow-sm text-gray-900') : 'text-gray-500'}`}
                    >سجل العمليات</button>
                    <button
                      onClick={() => setRecordSubTab('stats')}
                      className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${recordSubTab === 'stats' ? (isDarkMode ? 'bg-white/5 text-white' : 'bg-white shadow-sm text-gray-900') : 'text-gray-500'}`}
                    >إحصائيات الفروع</button>
                  </div>
                </div>

                {recordSubTab === 'ops' ? (
                  <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-white/[0.01] border-white/5' : 'bg-gray-50 border-black/5'}`}>
                    <table className="w-full text-right">
                      <thead>
                        <tr className={`text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b ${isDarkMode ? 'bg-white/5' : 'bg-white/50'}`}>
                          <th className="px-6 py-4">التاريخ</th>
                          <th className="px-6 py-4">الخدمة</th>
                          <th className="px-6 py-4">الفاتورة</th>
                          <th className="px-6 py-4">الفرع</th>
                          <th className="px-6 py-4 text-left">سعر الخدمة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-[11px] font-bold">
                        {employee.operationsLog?.map(op => (
                          <tr key={op.id} className="hover:bg-white/[0.02]">
                            <td className="px-6 py-4 opacity-50">{op.date}</td>
                            <td className="px-6 py-4">{op.serviceName}</td>
                            <td className="px-6 py-4 font-mono opacity-40">{op.invoiceNumber}</td>
                            <td className="px-6 py-4 opacity-60">{op.branch}</td>
                            <td className="px-6 py-4 text-left text-[#E53935]">{op.value.toLocaleString()} ج.م</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                      { label: 'إجمالي العمليات', val: branchStats.count, icon: <Receipt /> },
                      { label: 'إجمالي القيمة المنفذة', val: `${branchStats.totalValue.toLocaleString()} ج.م`, icon: <TrendingUp /> },
                      { label: 'إجمالي حصة الموظف', val: `${branchStats.totalShare.toLocaleString()} ج.م`, icon: <Wallet />, color: 'text-[#E6D690]' }
                    ].map((s, i) => (
                      <div key={i} className={`p-8 rounded-[2rem] border ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-gray-50 border-black/5'}`}>
                        <div className="flex justify-between items-center opacity-40 mb-4">
                          <span className="text-[10px] font-bold uppercase tracking-widest">{s.label}</span>
                          {s.icon}
                        </div>
                        <span className={`text-2xl font-bold ${s.color || 'text-white'}`}>{s.val}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* AREA 4 – FINANCIAL RECORDS & SETTLEMENT TOOL */}
            {activeAreaTab === 'financial' && (
              <div className="space-y-8 animate-fade-in">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className={`flex p-1 rounded-xl border w-full sm:w-auto overflow-x-auto ${isDarkMode ? 'bg-white/5 border-white/5' : 'bg-gray-50 border-black/5'}`}>
                    {[
                      { id: 'settlement', label: 'تصفية الحساب' },
                      { id: 'salary', label: 'الرواتب' },
                      { id: 'advance', label: 'السلفيات' },
                      { id: 'deduction', label: 'الخصومات' }
                    ].map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setFinancialSubTab(tab.id as any)}
                        className={`flex-1 sm:flex-none px-6 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${financialSubTab === tab.id ? (isDarkMode ? 'bg-white/5 text-white' : 'bg-white shadow-sm text-gray-900') : 'text-gray-500'}`}
                      >{tab.label}</button>
                    ))}
                  </div>
                  <button className={`p-2.5 rounded-xl border w-full sm:w-auto flex items-center justify-center transition-all ${isDarkMode ? 'bg-white/5 border-white/5 text-gray-400 hover:text-white' : 'bg-white border-black/5 text-gray-500 hover:text-black'}`}>
                    <Plus size={16} />
                  </button>
                </div>

                {financialSubTab === 'settlement' && (
                  <div className="space-y-10 animate-fade-in">
                    {/* Settlement Control Bar */}
                    <div className={`p-6 rounded-[2.5rem] border flex flex-col md:flex-row items-center justify-between gap-6 ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-gray-50 border-black/5 shadow-sm'}`}>
                      <div className="flex flex-col sm:flex-row items-center gap-6 w-full md:w-auto">
                        <div className="space-y-1 w-full sm:w-auto">
                          <label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mr-2">من تاريخ</label>
                          <div className="relative">
                            <Calendar size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-[#E53935]" />
                            <input
                              type="date"
                              value={settlementRange.from}
                              onChange={(e) => setSettlementRange({ ...settlementRange, from: e.target.value })}
                              className={`w-full pr-12 pl-4 py-3 rounded-xl border text-[10px] font-bold outline-none transition-all ${isDarkMode ? 'bg-[#161616] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-white border-gray-200 text-gray-900 focus:border-[#E53935]/40 shadow-sm'}`}
                            />
                          </div>
                        </div>
                        <div className="space-y-1 w-full sm:w-auto">
                          <label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mr-2">إلى تاريخ</label>
                          <div className="relative">
                            <Calendar size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-[#E53935]" />
                            <input
                              type="date"
                              value={settlementRange.to}
                              onChange={(e) => setSettlementRange({ ...settlementRange, to: e.target.value })}
                              className={`w-full pr-12 pl-4 py-3 rounded-xl border text-[10px] font-bold outline-none transition-all ${isDarkMode ? 'bg-[#161616] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-white border-gray-200 text-gray-900 focus:border-[#E53935]/40 shadow-sm'}`}
                            />
                          </div>
                        </div>
                      </div>
                      <button className="w-full md:w-auto bg-[#E6D690] text-black px-12 py-3.5 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-white transition-all active:scale-95 shadow-xl shadow-gold-500/10">
                        تصفية الحساب الحالية
                      </button>
                    </div>

                    {/* Accounting Dashboard Card */}
                    <div className={`p-8 sm:p-12 rounded-[3.5rem] border relative overflow-hidden group theme-transition ${isDarkMode ? 'bg-[#161616] border-white/5 luxury-shadow' : 'bg-white border-black/5 luxury-shadow-light'}`}>
                      <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 opacity-40">
                            <Receipt size={14} />
                            <span className="text-[9px] font-bold uppercase tracking-widest">إيراد العمولات</span>
                          </div>
                          <span className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{settlementStats.earnings.toLocaleString()} ج.م</span>
                        </div>
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 opacity-40">
                            <ShieldCheck size={14} className="text-red-500" />
                            <span className="text-[9px] font-bold uppercase tracking-widest">إجمالي الخصومات</span>
                          </div>
                          <span className="text-2xl font-bold text-red-500">-{settlementStats.deductions.toLocaleString()} ج.م</span>
                        </div>
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 opacity-40">
                            <Wallet size={14} className="text-red-500" />
                            <span className="text-[9px] font-bold uppercase tracking-widest">إجمالي السلفيات</span>
                          </div>
                          <span className="text-2xl font-bold text-red-500">-{settlementStats.advances.toLocaleString()} ج.م</span>
                        </div>
                        <div className="space-y-4 border-t lg:border-t-0 lg:border-r border-white/5 pt-8 lg:pt-0 lg:pr-12">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-[#E6D690] shadow-[0_0_8px_#E6D690]"></div>
                            <span className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>الصافي المستحق</span>
                          </div>
                          <span className="text-5xl font-black text-[#E6D690] tracking-tighter">{settlementStats.net.toLocaleString()} ج.م</span>
                        </div>
                      </div>
                      <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-[#E6D690] opacity-5 rounded-full blur-3xl group-hover:opacity-10 transition-opacity"></div>
                    </div>

                    {/* Action Footer */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-6 border-t border-white/5 pt-12">
                      <div className="flex items-center gap-3 opacity-40">
                        <FileBarChart size={18} />
                        <p className="text-[10px] font-bold uppercase tracking-widest">المخرجات المالية مبنية على سجلات العمليات والتدقيق المسجلة</p>
                      </div>
                      <button
                        onClick={() => setViewMode('payslip')}
                        className="w-full sm:w-auto bg-[#E53935] hover:bg-[#FF3B30] text-white px-14 py-4 rounded-2xl text-[11px] font-bold uppercase tracking-[0.2em] shadow-2xl shadow-red-900/30 transition-all active:scale-95 flex items-center justify-center gap-3"
                      >
                        <Printer size={20} />
                        إصدار وصل مرتب (Print)
                      </button>
                    </div>
                  </div>
                )}

                {financialSubTab === 'salary' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in">
                    {[
                      { label: 'الراتب الأساسي', val: `${employee.baseSalary.toLocaleString()} ج.م`, icon: <CreditCard /> },
                      { label: 'آخر صرف محقق', val: `${employee.lastNetPaid.toLocaleString()} ج.م`, icon: <TrendingUp />, color: 'text-[#E6D690]' },
                      { label: 'تاريخ الاستحقاق', val: employee.lastPayDate, icon: <Calendar /> }
                    ].map((s, i) => (
                      <div key={i} className={`p-8 rounded-[2rem] border ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-gray-50 border-black/5'}`}>
                        <div className="flex justify-between items-center opacity-40 mb-4">
                          <span className="text-[10px] font-bold uppercase tracking-widest">{s.label}</span>
                          {s.icon}
                        </div>
                        <span className={`text-2xl font-bold ${s.color || 'text-white'}`}>{s.val}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Fallbacks for other tabs */}
            {activeAreaTab === 'transfer' && (
              <div className="p-12 text-center opacity-30 animate-fade-in">
                <ArrowLeftRight size={48} className="mx-auto mb-4" />
                <p className="text-[11px] font-bold uppercase tracking-widest">تاريخ تنقلات الموظف بين الفروع</p>
              </div>
            )}
            {activeAreaTab === 'documents' && (
              <div className="p-12 text-center opacity-30 animate-fade-in">
                <FileText size={48} className="mx-auto mb-4" />
                <p className="text-[11px] font-bold uppercase tracking-widest">أرشيف المستندات والملفات الشخصية</p>
              </div>
            )}
          </div>
        </div>

        {/* FOOTER */}
        <div className={`p-6 sm:p-10 border-t flex flex-col md:flex-row justify-between items-center gap-6 ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-gray-50 border-black/5'}`}>
          <button className="text-red-500 text-[10px] font-bold uppercase tracking-[0.2em] hover:opacity-70 transition-all flex items-center gap-2">
            أرشفة سجل الموظف
          </button>
          <div className="flex gap-4 w-full md:w-auto">
            <button onClick={onClose} className={`flex-1 md:flex-none px-10 py-4 rounded-2xl text-[10px] font-bold border uppercase tracking-widest transition-all ${isDarkMode ? 'border-white/10 text-white hover:bg-white/5' : 'border-black/10 text-gray-900 hover:bg-black/5'}`}>إغلاق</button>
            <button className="flex-1 md:flex-none bg-[#E53935] hover:bg-[#FF3B30] text-white px-14 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-2xl transition-all">اعتماد الملف</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeDetailsModal;
