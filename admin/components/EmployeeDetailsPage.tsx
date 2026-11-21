
import React, { useState, useMemo, useEffect, useRef } from 'react';
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
    FileBarChart,
    Rocket,
    Clock,
    Users,
    ChevronLeft,
    Scissors,
    Phone,
    MoreVertical,
    Edit,
    Trash2,
    UserX,
    Sparkles
} from 'lucide-react';
import { SettlementStudio } from './settlement/SettlementStudio';
import {
    AdvanceRecord,
    DeductionRecord,
    Employee,
    EmployeeAdvancePageResponse,
    EmployeeDeductionPageResponse,
    EmployeeLedgerPageResponse,
    EmployeeLedgerSummaryResponse,
    EmployeeOvertimePageResponse,
    EmployeeSummaryResponse,
    EmployeeTransferPageResponse,
    OvertimeRecord,
    ROLE_LABELS,
    OperationLog,
    TransferRecord,
} from '../types';
import Logo from './Logo.tsx';
import adminApi from '../api/client';
import EmployeeReport, { ReportData } from './EmployeeReport';
import { formatDate, formatDateTime, formatTime, getTodayISO, getCairoNow } from '../utils/dateFormatter';

interface EmployeeDetailsPageProps {
    employee: Employee;
    isDarkMode: boolean;
    onBack: () => void;
    onOpenTransfer?: () => void;
    onEdit?: (employee: Employee) => void;
    onDelete?: (employee: Employee) => void;
    onToggleStatus?: (employee: Employee) => void;
    initialAreaTab?: 'record' | 'transfer' | 'financial' | 'documents';
    initialRecordSubTab?: 'ops' | 'stats';
    initialFinancialSubTab?: 'settlement' | 'salary' | 'advance' | 'deduction' | 'overtime' | 'daily_percentage';
}

const HISTORY_PAGE_SIZE = 20;

const EMPTY_PAGINATION = {
    page: 1,
    per_page: HISTORY_PAGE_SIZE,
    total: 0,
    total_pages: 0,
    has_more: false,
};

const EMPTY_LEDGER_SUMMARY: EmployeeLedgerSummaryResponse = {
    service_operations_count: 0,
    total_service_value: 0,
    total_service_share: 0,
    product_sales_count: 0,
    product_commission_total: 0,
};

const buildMonthRange = () => ({
    from: `${getTodayISO().substring(0, 8)}01`,
    to: getTodayISO(),
});

const buildEmployeePhotoUrl = (imageUrl?: string | null) => {
    if (!imageUrl) {
        return undefined;
    }

    if (imageUrl.startsWith('http')) {
        return imageUrl;
    }

    const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001';
    return `${apiBaseUrl}/uploads/${imageUrl.replace(/\\/g, '/')}`;
};

const EmployeeDetailsPage: React.FC<EmployeeDetailsPageProps> = ({ employee, isDarkMode, onBack, onOpenTransfer, onEdit, onDelete, onToggleStatus, initialAreaTab = 'record', initialRecordSubTab = 'ops', initialFinancialSubTab = 'settlement' }) => {
    const [activeAreaTab, setActiveAreaTab] = useState<'record' | 'transfer' | 'financial' | 'documents'>(initialAreaTab);
    const [isPhotoLightboxOpen, setIsPhotoLightboxOpen] = useState(false);
    const [previewDoc, setPreviewDoc] = useState<{ url: string; label: string } | null>(null);
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const isImage = (url: string) => /\.(jpg|jpeg|png|webp|avif|gif)$/i.test(url);
    const isPDF = (url: string) => /\.pdf$/i.test(url);

    const handleDownload = async (url: string, fileName: string) => {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = fileName || 'document';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
        } catch (error) {
            console.error("Download failed:", error);
            window.open(url, '_blank');
        }
    };

    const [viewMode, setViewMode] = useState<'standard' | 'payslip'>('standard');
    const [scrollPosition, setScrollPosition] = useState(0);
    const contentScrollRef = useRef<HTMLDivElement>(null);

    const [employeeProfile, setEmployeeProfile] = useState<Employee>(employee);
    const [headerStats, setHeaderStats] = useState({ totalServiceInvoices: 0, branchOptions: [] as string[] });
    const [isLoadingSummary, setIsLoadingSummary] = useState(true);
    const [summaryError, setSummaryError] = useState<string | null>(null);

    const [ledger, setLedger] = useState<OperationLog[]>([]);
    const [ledgerPagination, setLedgerPagination] = useState(EMPTY_PAGINATION);
    const [ledgerSummary, setLedgerSummary] = useState<EmployeeLedgerSummaryResponse>(EMPTY_LEDGER_SUMMARY);
    const [ledgerPage, setLedgerPage] = useState(1);
    const [isLoadingLedger, setIsLoadingLedger] = useState(false);
    const [hasLoadedLedger, setHasLoadedLedger] = useState(false);
    const [ledgerError, setLedgerError] = useState<string | null>(null);

    const [recordSummary, setRecordSummary] = useState<EmployeeLedgerSummaryResponse>(EMPTY_LEDGER_SUMMARY);
    const [isLoadingRecordSummary, setIsLoadingRecordSummary] = useState(false);
    const [recordSummaryError, setRecordSummaryError] = useState<string | null>(null);

    const [dailyLedger, setDailyLedger] = useState<OperationLog[]>([]);
    const [dailyLedgerPagination, setDailyLedgerPagination] = useState(EMPTY_PAGINATION);
    const [dailyLedgerSummary, setDailyLedgerSummary] = useState<EmployeeLedgerSummaryResponse>(EMPTY_LEDGER_SUMMARY);
    const [dailyLedgerPage, setDailyLedgerPage] = useState(1);
    const [isLoadingDailyLedger, setIsLoadingDailyLedger] = useState(false);
    const [hasLoadedDailyLedger, setHasLoadedDailyLedger] = useState(false);
    const [dailyLedgerError, setDailyLedgerError] = useState<string | null>(null);

    const [transfers, setTransfers] = useState<TransferRecord[]>([]);
    const [transferPagination, setTransferPagination] = useState(EMPTY_PAGINATION);
    const [transferPage, setTransferPage] = useState(1);
    const [isLoadingTransfers, setIsLoadingTransfers] = useState(false);
    const [hasLoadedTransfers, setHasLoadedTransfers] = useState(false);
    const [transfersError, setTransfersError] = useState<string | null>(null);

    // Financial Sub-tabs (Cleaned: Settlement & Salary moved to Studio)
    const initialFinTab = (initialFinancialSubTab === 'settlement' || initialFinancialSubTab === 'salary')
        ? 'advance'
        : initialFinancialSubTab;
    const [financialSubTab, setFinancialSubTab] = useState<'advance' | 'deduction' | 'overtime' | 'daily_percentage'>(initialFinTab as any);

    const [advances, setAdvances] = useState<AdvanceRecord[]>([]);
    const [advancePagination, setAdvancePagination] = useState(EMPTY_PAGINATION);
    const [advancePage, setAdvancePage] = useState(1);
    const [advanceTotal, setAdvanceTotal] = useState(0);
    const [isLoadingAdvances, setIsLoadingAdvances] = useState(false);
    const [hasLoadedAdvances, setHasLoadedAdvances] = useState(false);
    const [advancesError, setAdvancesError] = useState<string | null>(null);

    // Area 2 Sub-tabs
    const [recordSubTab, setRecordSubTab] = useState<'ops' | 'stats'>(initialRecordSubTab);
    const [selectedBranchForStats, setSelectedBranchForStats] = useState<string>('All');

    // Analytics Date Range Filter
    const [analyticsFromDate, setAnalyticsFromDate] = useState<string>(buildMonthRange().from);
    const [analyticsToDate, setAnalyticsToDate] = useState<string>(buildMonthRange().to);

    // Analytics Share Percentage (Admin Manual Input - No Default)
    const [sharePercentage, setSharePercentage] = useState<number | null>(null);

    // Settlement Date Range - Default to Current Month
    const [settlementRange, setSettlementRange] = useState(buildMonthRange);

    // Settlement Studio State
    const [isSettlementStudioOpen, setIsSettlementStudioOpen] = useState(false);

    // Overtime State
    const [overtimes, setOvertimes] = useState<OvertimeRecord[]>([]);
    const [overtimePagination, setOvertimePagination] = useState(EMPTY_PAGINATION);
    const [overtimePage, setOvertimePage] = useState(1);
    const [overtimeTotal, setOvertimeTotal] = useState(0);
    const [isLoadingOvertimes, setIsLoadingOvertimes] = useState(false);
    const [hasLoadedOvertimes, setHasLoadedOvertimes] = useState(false);
    const [overtimeError, setOvertimeError] = useState<string | null>(null);
    const [isAddOvertimeOpen, setIsAddOvertimeOpen] = useState(false);
    const [newOvertime, setNewOvertime] = useState({
        amount: '',
        reason: '',
        date: getTodayISO()
    });

    // Report State
    const [showReport, setShowReport] = useState(false);
    const [reportData, setReportData] = useState<ReportData | null>(null);
    const [isGeneratingReport, setIsGeneratingReport] = useState(false);

    const [deductions, setDeductions] = useState<DeductionRecord[]>([]);
    const [deductionPagination, setDeductionPagination] = useState(EMPTY_PAGINATION);
    const [deductionPage, setDeductionPage] = useState(1);
    const [deductionTotal, setDeductionTotal] = useState(0);
    const [isLoadingDeductions, setIsLoadingDeductions] = useState(false);
    const [hasLoadedDeductions, setHasLoadedDeductions] = useState(false);
    const [deductionsError, setDeductionsError] = useState<string | null>(null);
    const [isAddDeductionOpen, setIsAddDeductionOpen] = useState(false);
    const [newDeduction, setNewDeduction] = useState({
        amount: '',
        reason: '',
        date: getTodayISO(),
        notes: ''
    });

    const [selectedDailyDate, setSelectedDailyDate] = useState(getTodayISO());

    const summaryRequestSeqRef = useRef(0);
    const recordSummarySeqRef = useRef(0);
    const ledgerSeqRef = useRef(0);
    const dailyLedgerSeqRef = useRef(0);
    const transferSeqRef = useRef(0);
    const advanceSeqRef = useRef(0);
    const deductionSeqRef = useRef(0);
    const overtimeSeqRef = useRef(0);
    const loadedKeysRef = useRef({
        summary: '',
        recordSummary: '',
        ledger: '',
        dailyLedger: '',
        transfers: '',
        advances: '',
        deductions: '',
        overtime: '',
    });

    const commissionWalletBalance = employeeProfile.commission_wallet_balance || 0;

    const handleGenerateReport = async () => {
        setIsGeneratingReport(true);
        try {
            // Fetch Rendered HTML via Authenticated Request
            const response = await adminApi.get(`/employees/${employeeProfile.id}/report/print`, {
                params: {
                    start_date: settlementRange.from,
                    end_date: settlementRange.to
                },
                responseType: 'text'
            });

            // Create hidden iframe
            const iframe = document.createElement('iframe');
            iframe.style.position = 'fixed';
            iframe.style.right = '0';
            iframe.style.bottom = '0';
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = '0';

            // Append first
            document.body.appendChild(iframe);

            // Set onload handler with guard
            let hasPrinted = false;
            iframe.onload = () => {
                if (hasPrinted) return;
                hasPrinted = true;

                if (iframe.contentWindow) {
                    iframe.contentWindow.focus();
                    iframe.contentWindow.print();
                }
                // Cleanup
                setTimeout(() => {
                    if (document.body.contains(iframe)) {
                        document.body.removeChild(iframe);
                    }
                }, 1000);
            };

            // Inject HTML
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (doc) {
                doc.open();
                doc.write(response.data);
                doc.close();
            }

        } catch (err: any) {
            console.error("Failed to generate report:", err);
            const msg = err.response?.data?.message || err.message || "فشل إعداد التقرير للطباعة.";
            alert(msg);
        } finally {
            setIsGeneratingReport(false);
        }
    };

    const mapSummaryToEmployee = (data: EmployeeSummaryResponse): Employee => ({
        id: data.id.toString(),
        internalId: `EMP-${data.id.toString().padStart(3, '0')}`,
        name: data.full_name,
        phone: data.phone || '',
        role: data.role,
        branch: data.branch_name || 'غير محدد',
        branch_id: data.branch_id?.toString(),
        status: data.is_active ? 'نشط' : 'موقوف',
        is_deleted: data.is_deleted,
        employmentDate: data.created_at?.split('T')[0] || employee.employmentDate,
        baseSalary: data.base_salary || 0,
        commission_wallet_balance: data.commission_wallet_balance || 0,
        lastNetPaid: employee.lastNetPaid,
        lastPayDate: employee.lastPayDate,
        avatarColor: employee.avatarColor || '#E53935',
        photoUrl: buildEmployeePhotoUrl(data.image_url),
        documents: data.documents || [],
        createdAt: data.created_at || undefined,
    });

    const fetchEmployeeSummary = async () => {
        const requestKey = employee.id;
        if (loadedKeysRef.current.summary === requestKey && !summaryError) {
            return;
        }

        const requestSeq = ++summaryRequestSeqRef.current;
        setIsLoadingSummary(true);
        setSummaryError(null);
        try {
            const response = await adminApi.get<EmployeeSummaryResponse>(`/employees/${employee.id}/summary`);
            if (requestSeq !== summaryRequestSeqRef.current) {
                return;
            }
            setEmployeeProfile(mapSummaryToEmployee(response.data));
            setHeaderStats({
                totalServiceInvoices: response.data.header_stats?.total_service_invoices || 0,
                branchOptions: response.data.branch_options || [],
            });
            loadedKeysRef.current.summary = requestKey;
        } catch (err: any) {
            if (requestSeq !== summaryRequestSeqRef.current) {
                return;
            }
            console.error("Failed to fetch employee summary:", err);
            setSummaryError(err.response?.data?.error || err.message || 'Failed to load employee summary');
            setEmployeeProfile(employee);
            setHeaderStats({ totalServiceInvoices: 0, branchOptions: [] });
        } finally {
            if (requestSeq === summaryRequestSeqRef.current) {
                setIsLoadingSummary(false);
            }
        }
    };

    const fetchRecordSummary = async () => {
        const requestKey = JSON.stringify({
            employeeId: employee.id,
            date_from: analyticsFromDate,
            date_to: analyticsToDate,
            branch_name: selectedBranchForStats !== 'All' ? selectedBranchForStats : undefined,
        });
        if (loadedKeysRef.current.recordSummary === requestKey && !recordSummaryError) {
            return;
        }

        const requestSeq = ++recordSummarySeqRef.current;
        setIsLoadingRecordSummary(true);
        setRecordSummaryError(null);
        try {
            const response = await adminApi.get<EmployeeLedgerSummaryResponse>(`/employees/${employee.id}/ledger/summary`, {
                params: {
                    date_from: analyticsFromDate,
                    date_to: analyticsToDate,
                    branch_name: selectedBranchForStats !== 'All' ? selectedBranchForStats : undefined,
                },
            });
            if (requestSeq !== recordSummarySeqRef.current) {
                return;
            }
            setRecordSummary(response.data);
            loadedKeysRef.current.recordSummary = requestKey;
        } catch (err: any) {
            if (requestSeq !== recordSummarySeqRef.current) {
                return;
            }
            console.error("Failed to fetch employee record summary:", err);
            setRecordSummaryError(err.response?.data?.error || err.message || 'Failed to load analytics summary');
            setRecordSummary(EMPTY_LEDGER_SUMMARY);
        } finally {
            if (requestSeq === recordSummarySeqRef.current) {
                setIsLoadingRecordSummary(false);
            }
        }
    };

    const fetchLedgerPage = async (page: number) => {
        const requestKey = JSON.stringify({ employeeId: employee.id, page });
        if (loadedKeysRef.current.ledger === requestKey && hasLoadedLedger && !ledgerError) {
            return;
        }

        const requestSeq = ++ledgerSeqRef.current;
        setIsLoadingLedger(true);
        setLedgerError(null);
        try {
            const response = await adminApi.get<EmployeeLedgerPageResponse>(`/employees/${employee.id}/ledger`, {
                params: {
                    page,
                    per_page: HISTORY_PAGE_SIZE,
                },
            });
            if (requestSeq !== ledgerSeqRef.current) {
                return;
            }
            setLedger(response.data.items || []);
            setLedgerPagination({
                page: response.data.page,
                per_page: response.data.per_page,
                total: response.data.total,
                total_pages: response.data.total_pages,
                has_more: response.data.has_more,
            });
            setLedgerSummary(response.data.summary || EMPTY_LEDGER_SUMMARY);
            setLedgerPage(response.data.page || page);
            setHasLoadedLedger(true);
            loadedKeysRef.current.ledger = requestKey;
        } catch (err: any) {
            if (requestSeq !== ledgerSeqRef.current) {
                return;
            }
            console.error("Failed to fetch employee ledger:", err);
            setLedgerError(err.response?.data?.error || err.message || 'Failed to load employee ledger');
            setLedger([]);
            setLedgerPagination(EMPTY_PAGINATION);
            setLedgerSummary(EMPTY_LEDGER_SUMMARY);
        } finally {
            if (requestSeq === ledgerSeqRef.current) {
                setIsLoadingLedger(false);
            }
        }
    };

    const fetchDailyLedgerPage = async (page: number) => {
        const requestKey = JSON.stringify({ employeeId: employee.id, page, selectedDailyDate });
        if (loadedKeysRef.current.dailyLedger === requestKey && hasLoadedDailyLedger && !dailyLedgerError) {
            return;
        }

        const requestSeq = ++dailyLedgerSeqRef.current;
        setIsLoadingDailyLedger(true);
        setDailyLedgerError(null);
        try {
            const response = await adminApi.get<EmployeeLedgerPageResponse>(`/employees/${employee.id}/ledger`, {
                params: {
                    page,
                    per_page: HISTORY_PAGE_SIZE,
                    item_type: 'SERVICE_ITEM',
                    date_from: selectedDailyDate,
                    date_to: selectedDailyDate,
                },
            });
            if (requestSeq !== dailyLedgerSeqRef.current) {
                return;
            }
            setDailyLedger(response.data.items || []);
            setDailyLedgerPagination({
                page: response.data.page,
                per_page: response.data.per_page,
                total: response.data.total,
                total_pages: response.data.total_pages,
                has_more: response.data.has_more,
            });
            setDailyLedgerSummary(response.data.summary || EMPTY_LEDGER_SUMMARY);
            setDailyLedgerPage(response.data.page || page);
            setHasLoadedDailyLedger(true);
            loadedKeysRef.current.dailyLedger = requestKey;
        } catch (err: any) {
            if (requestSeq !== dailyLedgerSeqRef.current) {
                return;
            }
            console.error("Failed to fetch daily employee ledger:", err);
            setDailyLedgerError(err.response?.data?.error || err.message || 'Failed to load daily percentages');
            setDailyLedger([]);
            setDailyLedgerPagination(EMPTY_PAGINATION);
            setDailyLedgerSummary(EMPTY_LEDGER_SUMMARY);
        } finally {
            if (requestSeq === dailyLedgerSeqRef.current) {
                setIsLoadingDailyLedger(false);
            }
        }
    };

    const fetchTransfersPage = async (page: number) => {
        const requestKey = JSON.stringify({ employeeId: employee.id, page });
        if (loadedKeysRef.current.transfers === requestKey && hasLoadedTransfers && !transfersError) {
            return;
        }

        const requestSeq = ++transferSeqRef.current;
        setIsLoadingTransfers(true);
        setTransfersError(null);
        try {
            const response = await adminApi.get<EmployeeTransferPageResponse>(`/employees/${employee.id}/transfers`, {
                params: { page, per_page: HISTORY_PAGE_SIZE },
            });
            if (requestSeq !== transferSeqRef.current) {
                return;
            }
            setTransfers(response.data.items || []);
            setTransferPagination({
                page: response.data.page,
                per_page: response.data.per_page,
                total: response.data.total,
                total_pages: response.data.total_pages,
                has_more: response.data.has_more,
            });
            setTransferPage(response.data.page || page);
            setHasLoadedTransfers(true);
            loadedKeysRef.current.transfers = requestKey;
        } catch (err: any) {
            if (requestSeq !== transferSeqRef.current) {
                return;
            }
            console.error("Failed to fetch employee transfers:", err);
            setTransfersError(err.response?.data?.error || err.message || 'Failed to load transfer history');
            setTransfers([]);
            setTransferPagination(EMPTY_PAGINATION);
        } finally {
            if (requestSeq === transferSeqRef.current) {
                setIsLoadingTransfers(false);
            }
        }
    };

    const fetchAdvancesPage = async (page: number) => {
        const requestKey = JSON.stringify({ employeeId: employee.id, page });
        if (loadedKeysRef.current.advances === requestKey && hasLoadedAdvances && !advancesError) {
            return;
        }

        const requestSeq = ++advanceSeqRef.current;
        setIsLoadingAdvances(true);
        setAdvancesError(null);
        try {
            const response = await adminApi.get<EmployeeAdvancePageResponse>(`/employees/${employee.id}/advances`, {
                params: { page, per_page: HISTORY_PAGE_SIZE },
            });
            if (requestSeq !== advanceSeqRef.current) {
                return;
            }
            setAdvances(response.data.items || []);
            setAdvancePagination({
                page: response.data.page,
                per_page: response.data.per_page,
                total: response.data.total,
                total_pages: response.data.total_pages,
                has_more: response.data.has_more,
            });
            setAdvanceTotal(response.data.summary?.total_amount || 0);
            setAdvancePage(response.data.page || page);
            setHasLoadedAdvances(true);
            loadedKeysRef.current.advances = requestKey;
        } catch (err: any) {
            if (requestSeq !== advanceSeqRef.current) {
                return;
            }
            console.error("Failed to fetch employee advances:", err);
            setAdvancesError(err.response?.data?.error || err.message || 'Failed to load advances');
            setAdvances([]);
            setAdvancePagination(EMPTY_PAGINATION);
            setAdvanceTotal(0);
        } finally {
            if (requestSeq === advanceSeqRef.current) {
                setIsLoadingAdvances(false);
            }
        }
    };

    const fetchDeductionsPage = async (page: number) => {
        const requestKey = JSON.stringify({ employeeId: employee.id, page });
        if (loadedKeysRef.current.deductions === requestKey && hasLoadedDeductions && !deductionsError) {
            return;
        }

        const requestSeq = ++deductionSeqRef.current;
        setIsLoadingDeductions(true);
        setDeductionsError(null);
        try {
            const response = await adminApi.get<EmployeeDeductionPageResponse>(`/employees/${employee.id}/deductions`, {
                params: { page, per_page: HISTORY_PAGE_SIZE },
            });
            if (requestSeq !== deductionSeqRef.current) {
                return;
            }
            setDeductions(response.data.items || []);
            setDeductionPagination({
                page: response.data.page,
                per_page: response.data.per_page,
                total: response.data.total,
                total_pages: response.data.total_pages,
                has_more: response.data.has_more,
            });
            setDeductionTotal(response.data.summary?.total_amount || 0);
            setDeductionPage(response.data.page || page);
            setHasLoadedDeductions(true);
            loadedKeysRef.current.deductions = requestKey;
        } catch (err: any) {
            if (requestSeq !== deductionSeqRef.current) {
                return;
            }
            console.error("Failed to fetch employee deductions:", err);
            setDeductionsError(err.response?.data?.error || err.message || 'Failed to load deductions');
            setDeductions([]);
            setDeductionPagination(EMPTY_PAGINATION);
            setDeductionTotal(0);
        } finally {
            if (requestSeq === deductionSeqRef.current) {
                setIsLoadingDeductions(false);
            }
        }
    };

    const fetchOvertimePage = async (page: number) => {
        const requestKey = JSON.stringify({ employeeId: employee.id, page });
        if (loadedKeysRef.current.overtime === requestKey && hasLoadedOvertimes && !overtimeError) {
            return;
        }

        const requestSeq = ++overtimeSeqRef.current;
        setIsLoadingOvertimes(true);
        setOvertimeError(null);
        try {
            const response = await adminApi.get<EmployeeOvertimePageResponse>(`/employees/${employee.id}/overtime`, {
                params: { page, per_page: HISTORY_PAGE_SIZE },
            });
            if (requestSeq !== overtimeSeqRef.current) {
                return;
            }
            setOvertimes(response.data.items || []);
            setOvertimePagination({
                page: response.data.page,
                per_page: response.data.per_page,
                total: response.data.total,
                total_pages: response.data.total_pages,
                has_more: response.data.has_more,
            });
            setOvertimeTotal(response.data.summary?.total_amount || 0);
            setOvertimePage(response.data.page || page);
            setHasLoadedOvertimes(true);
            loadedKeysRef.current.overtime = requestKey;
        } catch (err: any) {
            if (requestSeq !== overtimeSeqRef.current) {
                return;
            }
            console.error("Failed to fetch employee overtime:", err);
            setOvertimeError(err.response?.data?.error || err.message || 'Failed to load overtime');
            setOvertimes([]);
            setOvertimePagination(EMPTY_PAGINATION);
            setOvertimeTotal(0);
        } finally {
            if (requestSeq === overtimeSeqRef.current) {
                setIsLoadingOvertimes(false);
            }
        }
    };

    useEffect(() => {
        setEmployeeProfile(employee);
        setHeaderStats({ totalServiceInvoices: 0, branchOptions: [] });
        setActiveAreaTab('record');
        setRecordSubTab('stats');
        setFinancialSubTab('advance');
        setSelectedBranchForStats('All');
        setAnalyticsFromDate(buildMonthRange().from);
        setAnalyticsToDate(buildMonthRange().to);
        setSettlementRange(buildMonthRange());
        setSelectedDailyDate(getTodayISO());
        setSharePercentage(null);

        setLedger([]);
        setLedgerPagination(EMPTY_PAGINATION);
        setLedgerSummary(EMPTY_LEDGER_SUMMARY);
        setLedgerPage(1);
        setHasLoadedLedger(false);
        setLedgerError(null);

        setRecordSummary(EMPTY_LEDGER_SUMMARY);
        setRecordSummaryError(null);

        setDailyLedger([]);
        setDailyLedgerPagination(EMPTY_PAGINATION);
        setDailyLedgerSummary(EMPTY_LEDGER_SUMMARY);
        setDailyLedgerPage(1);
        setHasLoadedDailyLedger(false);
        setDailyLedgerError(null);

        setTransfers([]);
        setTransferPagination(EMPTY_PAGINATION);
        setTransferPage(1);
        setHasLoadedTransfers(false);
        setTransfersError(null);

        setAdvances([]);
        setAdvancePagination(EMPTY_PAGINATION);
        setAdvancePage(1);
        setAdvanceTotal(0);
        setHasLoadedAdvances(false);
        setAdvancesError(null);

        setDeductions([]);
        setDeductionPagination(EMPTY_PAGINATION);
        setDeductionPage(1);
        setDeductionTotal(0);
        setHasLoadedDeductions(false);
        setDeductionsError(null);

        setOvertimes([]);
        setOvertimePagination(EMPTY_PAGINATION);
        setOvertimePage(1);
        setOvertimeTotal(0);
        setHasLoadedOvertimes(false);
        setOvertimeError(null);

        loadedKeysRef.current = {
            summary: '',
            recordSummary: '',
            ledger: '',
            dailyLedger: '',
            transfers: '',
            advances: '',
            deductions: '',
            overtime: '',
        };
    }, [employee.id]);

    useEffect(() => {
        fetchEmployeeSummary();
    }, [employee.id]);

    useEffect(() => {
        if (selectedBranchForStats !== 'All' && !headerStats.branchOptions.includes(selectedBranchForStats)) {
            setSelectedBranchForStats('All');
        }
    }, [headerStats.branchOptions, selectedBranchForStats]);

    useEffect(() => {
        if (activeAreaTab === 'record' && recordSubTab === 'stats') {
            fetchRecordSummary();
        }
    }, [activeAreaTab, recordSubTab, analyticsFromDate, analyticsToDate, selectedBranchForStats, employee.id]);

    useEffect(() => {
        if (activeAreaTab === 'record' && recordSubTab === 'ops') {
            fetchLedgerPage(ledgerPage);
        }
    }, [activeAreaTab, recordSubTab, ledgerPage, employee.id]);

    useEffect(() => {
        if (activeAreaTab === 'transfer') {
            fetchTransfersPage(transferPage);
        }
    }, [activeAreaTab, transferPage, employee.id]);

    useEffect(() => {
        if (activeAreaTab === 'financial' && financialSubTab === 'advance') {
            fetchAdvancesPage(advancePage);
        }
    }, [activeAreaTab, financialSubTab, advancePage, employee.id]);

    useEffect(() => {
        if (activeAreaTab === 'financial' && financialSubTab === 'deduction') {
            fetchDeductionsPage(deductionPage);
        }
    }, [activeAreaTab, financialSubTab, deductionPage, employee.id]);

    useEffect(() => {
        if (activeAreaTab === 'financial' && financialSubTab === 'overtime') {
            fetchOvertimePage(overtimePage);
        }
    }, [activeAreaTab, financialSubTab, overtimePage, employee.id]);

    useEffect(() => {
        if (activeAreaTab === 'financial' && financialSubTab === 'daily_percentage') {
            fetchDailyLedgerPage(dailyLedgerPage);
        }
    }, [activeAreaTab, financialSubTab, dailyLedgerPage, selectedDailyDate, employee.id]);

    // Scroll Handler for Header Collapse
    useEffect(() => {
        const handleScroll = (e: Event) => {
            const target = e.target as HTMLDivElement;
            setScrollPosition(target.scrollTop);
        };

        const scrollContainer = contentScrollRef.current;
        if (scrollContainer) {
            scrollContainer.addEventListener('scroll', handleScroll);
            return () => scrollContainer.removeEventListener('scroll', handleScroll);
        }
    }, []);

    // Calculate header collapse state (0 = expanded, 1 = collapsed)
    const headerCollapseRatio = Math.min(scrollPosition / 120, 1);

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

    const serviceLedger = useMemo(
        () => ledger.filter(op => op.itemType !== 'PRODUCT_ITEM'),
        [ledger]
    );

    const productSummary = useMemo(() => ({
        count: ledgerSummary.product_sales_count,
        totalCommission: ledgerSummary.product_commission_total,
    }), [ledgerSummary]);

    const handleAddDeduction = () => {
        if (!newDeduction.amount || !newDeduction.reason) return;

        const deductionEntry = {
            id: Date.now().toString(), // temporary ID
            date: newDeduction.date,
            amount: parseFloat(newDeduction.amount),
            reason: newDeduction.reason,
            note: newDeduction.notes,
            notes: newDeduction.notes
        };

        setDeductions((current) => [deductionEntry, ...current]);
        setDeductionTotal((current) => current + deductionEntry.amount);
        setIsAddDeductionOpen(false);
        setNewDeduction({
            amount: '',
            reason: '',
            date: getTodayISO(),
            notes: ''
        });
    };

    const handleAddOvertime = async () => {
        if (!newOvertime.amount || !newOvertime.reason) return;

        try {
            await adminApi.post(`/employees/${employee.id}/overtime`, {
                amount: parseFloat(newOvertime.amount),
                reason: newOvertime.reason,
                date: newOvertime.date
            });
            loadedKeysRef.current.overtime = '';
            setHasLoadedOvertimes(false);
            await fetchOvertimePage(overtimePage);
            setIsAddOvertimeOpen(false);
            setNewOvertime({
                amount: '',
                reason: '',
                date: getTodayISO()
            });
        } catch (err) {
            console.error("Failed to add overtime:", err);
            alert("فشل إضافة الأوفر تايم. يرجى المحاولة مرة أخرى.");
        }
    };

    // -------------------------------------------------------------------------
    // DAILY STATS LOGIC
    // -------------------------------------------------------------------------
    const dailyStats = useMemo(() => {
        return {
            ops: dailyLedger,
            count: dailyLedgerSummary.service_operations_count,
            totalShare: dailyLedgerSummary.total_service_share,
            totalValue: dailyLedgerSummary.total_service_value
        };
    }, [dailyLedger, dailyLedgerSummary]);

    // -------------------------------------------------------------------------
    // SETTLEMENT ACCOUNTING LOGIC
    // -------------------------------------------------------------------------
    const settlementStats = useMemo(() => {
        const from = new Date(settlementRange.from);
        const to = new Date(settlementRange.to);
        to.setHours(23, 59, 59, 999);

        // 1. Filter and Sum Service Earnings
        const filteredOps = serviceLedger.filter(op => {
            const d = new Date(op.date);
            return d >= from && d <= to;
        });
        const totalEarnings = filteredOps.reduce((acc, op) => acc + op.share, 0);

        // 2. Filter and Sum Deductions (Use Fetched State)
        const filteredDeductions = deductions.filter(d => {
            const date = parseArabicDate(d.date);
            return date >= from && date <= to;
        });
        const totalDeductions = filteredDeductions.reduce((acc, d) => acc + d.amount, 0);

        // 3. Filter and Sum Advances (Use Fetched State)
        const filteredAdvances = advances.filter(a => {
            const date = parseArabicDate(a.date);
            return date >= from && date <= to;
        });
        const totalAdvances = filteredAdvances.reduce((acc, a) => acc + a.amount, 0);

        // 4. Filter and Sum Overtime (Use Fetched State)
        const filteredOvertime = overtimes.filter(o => {
            const d = new Date(o.date);
            return d >= from && d <= to;
        });
        const totalOvertime = filteredOvertime.reduce((acc, o) => acc + o.amount, 0);

        return {
            earnings: totalEarnings,
            deductions: totalDeductions,
            advances: totalAdvances,
            overtime: totalOvertime,
            net: totalEarnings + totalOvertime - totalDeductions - totalAdvances,
            opsCount: filteredOps.length
        };
    }, [serviceLedger, settlementRange, deductions, advances, overtimes]); // Fixed dependency

    // General Stats for Record Tab with Date Range Filtering
    const branchStats = useMemo(() => {
        const totalValue = recordSummary.total_service_value;
        const totalShare = sharePercentage !== null && sharePercentage !== undefined
            ? totalValue * (sharePercentage / 100)
            : null;

        return {
            count: recordSummary.service_operations_count,
            totalValue,
            totalShare,
        };
    }, [recordSummary, sharePercentage]);

    const uniqueClientsCount = headerStats.totalServiceInvoices;

    const renderPaginationControls = (
        pagination: typeof EMPTY_PAGINATION,
        onPrevious: () => void,
        onNext: () => void,
        loading: boolean
    ) => {
        if (pagination.total_pages <= 1) {
            return null;
        }

        return (
            <div className={`px-6 py-4 border-t flex items-center justify-between gap-4 ${isDarkMode ? 'border-white/5 bg-white/[0.015]' : 'border-black/5 bg-gray-50/70'}`}>
                <button
                    type="button"
                    disabled={pagination.page <= 1 || loading}
                    onClick={onPrevious}
                    className={`rounded-xl px-4 py-2 text-[10px] font-bold uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40 ${isDarkMode ? 'bg-white/5 text-white border border-white/10' : 'bg-white text-gray-900 border border-black/5'}`}
                >
                    السابق
                </button>
                <span className={`text-xs font-bold ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`}>
                    صفحة {pagination.page} من {Math.max(1, pagination.total_pages)}
                </span>
                <button
                    type="button"
                    disabled={!pagination.has_more || loading}
                    onClick={onNext}
                    className={`rounded-xl px-4 py-2 text-[10px] font-bold uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40 ${isDarkMode ? 'bg-white/5 text-white border border-white/10' : 'bg-white text-gray-900 border border-black/5'}`}
                >
                    التالي
                </button>
            </div>
        );
    };

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
                            <ChevronLeft size={20} />
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
                            <span className="text-xl font-bold text-gray-900">{employeeProfile.name}</span>
                        </div>
                        <div className="space-y-1 text-left">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">الفرع التشغيلي</span>
                            <span className="text-xl font-bold text-gray-900">{employeeProfile.branch}</span>
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
                                <tr className="text-sm font-bold text-green-600">
                                    <td className="py-8 px-2">إجمالي الأوفر تايم المعتمد</td>
                                    <td className="py-8 px-2 text-left">+{settlementStats.overtime.toLocaleString()} ج.م</td>
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
                            تم استخراج هذا المستند آلياً بتاريخ {formatDateTime(getCairoNow())} • المعرف المالي: {employeeProfile.internalId}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    const content = (
        <div className={`relative w-full h-full flex flex-col animate-fade-in theme-transition ${isDarkMode ? 'bg-[#0B0B0E]' : 'bg-[#F7F7F8]'}`}>

            {/* 1. COMPACT EXECUTIVE IDENTITY HEADER */}
            <header className={`border-b z-40 flex flex-col shrink-0 select-none ${
                isDarkMode ? 'bg-[#111114] border-white/[0.08] shadow-lg' : 'bg-white border-black/10 shadow-sm'
            }`}>
                {/* Top Bar: Identity & Primary Actions */}
                <div className="px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-4">
                    {/* Right Area (RTL start): Employee Badge & Identity */}
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        {/* Portrait Avatar */}
                        <button
                            onClick={() => setIsPhotoLightboxOpen(true)}
                            className="relative group w-11 sm:w-12 h-11 sm:h-12 rounded-xl overflow-hidden border border-white/15 bg-[#141417] shrink-0 cursor-pointer active:scale-95 transition-all shadow-sm ring-1 ring-white/10"
                            title="عرض الصورة كاملة"
                        >
                            {employeeProfile.photoUrl ? (
                                <img
                                    src={employeeProfile.photoUrl}
                                    alt={employeeProfile.name}
                                    className="w-full h-full object-cover object-top"
                                />
                            ) : (
                                <div
                                    className="w-full h-full flex items-center justify-center font-extrabold text-base text-[#E6D690] bg-[#18181C]"
                                >
                                    {employeeProfile.name.charAt(0)}
                                </div>
                            )}
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <Maximize2 size={13} className="text-white" />
                            </div>
                        </button>

                        {/* Name and Meta */}
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h1
                                    className={`text-base sm:text-lg lg:text-xl font-black truncate max-w-[200px] sm:max-w-[320px] md:max-w-md lg:max-w-lg tracking-tight leading-tight ${
                                        isDarkMode ? 'text-white' : 'text-gray-900'
                                    } ${employeeProfile.is_deleted ? 'line-through opacity-50' : ''}`}
                                    title={employeeProfile.name}
                                >
                                    {employeeProfile.name}
                                </h1>

                                <span
                                    className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase border shrink-0 ${
                                        isDarkMode
                                            ? 'bg-[#E6D690]/10 border-[#E6D690]/25 text-[#E6D690]'
                                            : 'bg-gray-100 border-gray-200 text-gray-800'
                                    }`}
                                >
                                    {ROLE_LABELS[employeeProfile.role] || employeeProfile.role}
                                </span>
                            </div>

                            <div className="flex items-center gap-2.5 text-[11px] font-medium text-gray-400 mt-0.5 flex-wrap">
                                <span className="flex items-center gap-1 text-gray-300">
                                    <Building2 size={11} className="text-[#B33939] shrink-0" />
                                    <span className="truncate max-w-[120px]">{employeeProfile.branch}</span>
                                </span>

                                <span className="opacity-30">•</span>

                                <span
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${
                                        employeeProfile.status === 'نشط'
                                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                            : 'bg-orange-500/10 border-orange-500/30 text-orange-400'
                                    }`}
                                >
                                    <span
                                        className={`w-1.5 h-1.5 rounded-full ${
                                            employeeProfile.status === 'نشط' ? 'bg-emerald-400 animate-pulse' : 'bg-orange-400'
                                        }`}
                                    />
                                    <span>{employeeProfile.status}</span>
                                </span>

                                {employeeProfile.phone && (
                                    <>
                                        <span className="opacity-30 hidden sm:inline">•</span>
                                        <span className="hidden sm:flex items-center gap-1 font-mono text-[10px] text-gray-400" dir="ltr">
                                            <Phone size={10} className="text-gray-500" />
                                            <span>{employeeProfile.phone}</span>
                                        </span>
                                    </>
                                )}

                                {employeeProfile.internalId && (
                                    <>
                                        <span className="opacity-30 hidden md:inline">•</span>
                                        <span className="hidden md:inline-block font-mono text-[9px] font-bold text-gray-400 bg-white/5 px-1.5 py-0.5 rounded border border-white/5" dir="ltr">
                                            #{employeeProfile.internalId}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Center Metric Strip (Desktop & Tablet) */}
                    <div className="hidden lg:flex items-center gap-5 px-4 py-2 rounded-xl border bg-white/[0.02] border-white/5 shrink-0">
                        <div className="flex flex-col items-end">
                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">الراتب الأساسي</span>
                            <span className={`font-mono text-xs font-bold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                                {employeeProfile.baseSalary.toLocaleString()} <span className="text-[9px] font-sans opacity-60">ج.م</span>
                            </span>
                        </div>

                        <div className={`w-[1px] h-6 ${isDarkMode ? 'bg-white/10' : 'bg-black/10'}`} />

                        <div className="flex flex-col items-end">
                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">الرصيد الحالي</span>
                            <div className="flex items-center gap-1.5">
                                <CreditCard size={12} className="text-[#E6D690]" />
                                <span className={`font-mono text-xs font-bold text-[#E6D690]`}>
                                    {commissionWalletBalance.toLocaleString()} <span className="text-[9px] font-sans opacity-60">ج.م</span>
                                </span>
                            </div>
                        </div>

                        <div className={`w-[1px] h-6 ${isDarkMode ? 'bg-white/10' : 'bg-black/10'}`} />

                        <div className="flex flex-col items-end">
                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">فواتير الخدمات</span>
                            <div className="flex items-center gap-1.5">
                                <Receipt size={12} className="text-gray-400" />
                                <span className={`font-mono text-xs font-bold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                                    {uniqueClientsCount.toLocaleString()}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Left Actions Area: Transfer, Report, Menu, Close (Physical LEFT in RTL) */}
                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                        {onOpenTransfer && (
                            <button
                                onClick={onOpenTransfer}
                                className={`h-9 px-3 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5 cursor-pointer ${
                                    isDarkMode
                                        ? 'bg-white/5 border-white/10 text-gray-300 hover:text-white hover:bg-white/10'
                                        : 'bg-gray-100 border-black/5 text-gray-700 hover:text-black hover:bg-gray-200'
                                }`}
                                title="نقل الموظف لفرع آخر"
                            >
                                <ArrowLeftRight size={13} className="text-[#E53935]" />
                                <span className="hidden sm:inline">نقل الفرع</span>
                            </button>
                        )}

                        {/* Studio Entry Action Button */}
                        <button
                            onClick={() => setIsSettlementStudioOpen(true)}
                            className="h-9 px-3.5 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-2 cursor-pointer bg-gradient-to-r from-[#1C1D24] via-[#14151B] to-[#0E0F14] hover:from-[#262832] hover:to-[#171822] text-[#F8FAFC] border border-[#C5A880]/30 hover:border-[#C5A880]/60 ring-1 ring-white/5"
                            title="استوديو التسويات المالية - فتح دفتر الأستاذ والمطابقة"
                        >
                            <span className="w-2 h-2 rounded-full bg-[#8B0000] animate-pulse" />
                            <span className="font-serif tracking-wide">استوديو التسوية</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/5 text-[#C5A880] border border-white/10 hidden md:inline">
                                STUDIO
                            </span>
                        </button>
                        <div className="relative">
                            <button
                                onClick={() => setIsMenuOpen(!isMenuOpen)}
                                className={`h-9 w-9 rounded-xl transition-all border flex items-center justify-center cursor-pointer ${
                                    isDarkMode
                                        ? 'bg-white/5 border-white/10 text-gray-300 hover:text-white hover:bg-white/10'
                                        : 'bg-gray-100 border-black/5 text-gray-600 hover:text-black hover:bg-gray-200'
                                }`}
                                title="خيارات إضافية"
                                aria-label="خيارات الموظف"
                            >
                                <MoreVertical size={16} />
                            </button>

                            {isMenuOpen && (
                                <div
                                    className={`absolute top-full left-0 mt-1.5 w-48 rounded-xl shadow-2xl border overflow-hidden z-[100] animate-fade-in ${
                                        isDarkMode ? 'bg-[#18181A] border-white/10' : 'bg-white border-black/10'
                                    }`}
                                >
                                    {onEdit && (
                                        <button
                                            onClick={() => {
                                                setIsMenuOpen(false);
                                                onEdit(employeeProfile);
                                            }}
                                            className={`w-full text-right px-3.5 py-2.5 text-xs font-bold flex items-center gap-2.5 transition-colors cursor-pointer ${
                                                isDarkMode ? 'text-gray-200 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'
                                            }`}
                                        >
                                            <Edit size={13} className="text-[#E6D690]" />
                                            <span>تعديل البيانات</span>
                                        </button>
                                    )}

                                    {onToggleStatus && (
                                        <button
                                            onClick={() => {
                                                setIsMenuOpen(false);
                                                onToggleStatus(employeeProfile);
                                            }}
                                            className={`w-full text-right px-3.5 py-2.5 text-xs font-bold flex items-center gap-2.5 transition-colors cursor-pointer border-t ${
                                                isDarkMode ? 'border-white/5 text-gray-200 hover:bg-white/5' : 'border-black/5 text-gray-700 hover:bg-gray-50'
                                            }`}
                                        >
                                            {employeeProfile.status === 'نشط' ? (
                                                <>
                                                    <UserX size={13} className="text-orange-400" />
                                                    <span>إيقاف الحساب</span>
                                                </>
                                            ) : (
                                                <>
                                                    <UserCheck size={13} className="text-emerald-400" />
                                                    <span>تنشيط الحساب</span>
                                                </>
                                            )}
                                        </button>
                                    )}

                                    {onDelete && (
                                        <button
                                            onClick={() => {
                                                setIsMenuOpen(false);
                                                onDelete(employeeProfile);
                                            }}
                                            className="w-full text-right px-3.5 py-2.5 text-xs font-bold flex items-center gap-2.5 transition-colors cursor-pointer border-t border-rose-500/20 text-rose-400 hover:bg-rose-500/10"
                                        >
                                            <Trash2 size={13} />
                                            <span>حذف الموظف</span>
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Close Button: matches exact Invoice Workspace UX */}
                        <button
                            type="button"
                            onClick={onBack}
                            title="إغلاق"
                            aria-label="إغلاق"
                            className={`h-9 w-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                                isDarkMode
                                    ? 'hover:bg-white/10 text-gray-400 hover:text-white'
                                    : 'hover:bg-black/5 text-gray-400 hover:text-gray-900'
                            }`}
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>
{/* 2. REFINED PRIMARY NAVIGATION TABS */}
                <div className={`px-4 sm:px-6 lg:px-8 flex items-center gap-1 sm:gap-2 border-t overflow-x-auto custom-scrollbar ${
                    isDarkMode ? 'border-white/10 bg-[#0E0E10]' : 'border-black/5 bg-gray-50'
                }`}>
                    {[
                        { id: 'record', label: 'سجل العمليات', icon: <Receipt size={14} /> },
                        { id: 'financial', label: 'السجل المالي', icon: <Wallet size={14} /> },
                        { id: 'transfer', label: 'التنقلات', icon: <ArrowLeftRight size={14} /> },
                        { id: 'documents', label: 'ملفات الموظف', icon: <FileText size={14} /> },
                    ].map((tab) => {
                        const isActive = activeAreaTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveAreaTab(tab.id as any)}
                                className={`relative flex items-center gap-2 py-3 px-3.5 text-xs font-bold transition-all outline-none whitespace-nowrap cursor-pointer border-b-2 ${
                                    isActive
                                        ? 'text-white border-[#E53935] bg-red-500/[0.04]'
                                        : 'text-gray-400 hover:text-gray-200 border-transparent hover:bg-white/[0.02]'
                                }`}
                            >
                                <span className={isActive ? 'text-[#E53935]' : 'text-gray-500'}>
                                    {tab.icon}
                                </span>
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
            </header>

            {/* 3. SCROLLABLE CONTENT AREA */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 lg:p-8 w-full overscroll-contain" ref={contentScrollRef}>
                <div className="max-w-7xl mx-auto w-full space-y-6">

                    {/* AREA 2 – OPERATIONS & PERFORMANCE WORKSPACE */}
                    {activeAreaTab === 'record' && (
                        <div className="space-y-5 animate-fade-in-up">
                            {/* 1. Sub-View Segmented Control Bar */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
                                <div className={`inline-flex p-1 rounded-xl border ${
                                    isDarkMode ? 'bg-[#121215] border-white/10' : 'bg-gray-100 border-black/5'
                                }`}>
                                    <button
                                        type="button"
                                        onClick={() => setRecordSubTab('ops')}
                                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                                            recordSubTab === 'ops'
                                                ? isDarkMode ? 'bg-white/10 text-white shadow-sm border border-white/10' : 'bg-white shadow-sm text-gray-900'
                                                : 'text-gray-400 hover:text-white'
                                        }`}
                                    >
                                        <Receipt size={13} className={recordSubTab === 'ops' ? 'text-[#E53935]' : 'text-gray-500'} />
                                        <span>سجل العمليات التشغيلي</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setRecordSubTab('stats')}
                                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                                            recordSubTab === 'stats'
                                                ? isDarkMode ? 'bg-white/10 text-white shadow-sm border border-white/10' : 'bg-white shadow-sm text-gray-900'
                                                : 'text-gray-400 hover:text-white'
                                        }`}
                                    >
                                        <TrendingUp size={13} className={recordSubTab === 'stats' ? 'text-[#E53935]' : 'text-gray-500'} />
                                        <span>تحليل الأداء والإحصائيات</span>
                                    </button>
                                </div>

                                <div className="text-xs text-gray-400 flex items-center gap-2 font-medium">
                                    {recordSubTab === 'ops' ? (
                                        <span className="font-mono text-[11px] text-gray-400">
                                            {ledgerPagination.total > 0 ? `إجمالي العمليات: ${ledgerPagination.total.toLocaleString()}` : 'سجل العمليات المعتمد'}
                                        </span>
                                    ) : (
                                        <span className="font-mono text-[11px] text-gray-400">
                                            فترة التحليل: {analyticsFromDate} إلى {analyticsToDate}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* 2. Operational Ledger Sub-View */}
                            {recordSubTab === 'ops' ? (
                                <div className="space-y-4">
                                    {/* Compact Product Sales & Commission Strip */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className={`p-3.5 rounded-xl border flex items-center justify-between ${
                                            isDarkMode ? 'bg-[#121215] border-white/10' : 'bg-white border-black/10 shadow-sm'
                                        }`}>
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-[#E53935] shrink-0">
                                                    <Receipt size={14} />
                                                </div>
                                                <div>
                                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">مبيعات المنتجات</span>
                                                    <span className="font-mono text-base font-extrabold text-white">
                                                        {productSummary.count} <span className="text-[10px] text-gray-400 font-sans">عملية</span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className={`p-3.5 rounded-xl border flex items-center justify-between ${
                                            isDarkMode ? 'bg-[#121215] border-white/10' : 'bg-white border-black/10 shadow-sm'
                                        }`}>
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-[#E6D690]/10 border border-[#E6D690]/20 flex items-center justify-center text-[#E6D690] shrink-0">
                                                    <TrendingUp size={14} />
                                                </div>
                                                <div>
                                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">عمولة المنتجات المستحقة</span>
                                                    <span className="font-mono text-base font-extrabold text-[#E6D690]">
                                                        {productSummary.totalCommission.toLocaleString()} <span className="text-[10px] font-sans opacity-70">ج.م</span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Error Banner if any */}
                                    {ledgerError && (
                                        <div className={`p-3.5 rounded-xl text-xs font-bold ${
                                            isDarkMode ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-red-50 text-red-600 border border-red-100'
                                        }`}>
                                            {ledgerError}
                                        </div>
                                    )}

                                    {/* Linear-Style High Density Operational Table */}
                                    <div className={`rounded-xl border overflow-hidden ${
                                        isDarkMode ? 'bg-[#121215] border-white/10' : 'bg-white border-black/10 shadow-sm'
                                    }`}>
                                        <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-b gap-2 ${
                                            isDarkMode ? 'border-white/5 bg-white/[0.02]' : 'border-black/5 bg-gray-50'
                                        }`}>
                                            <div className="text-right flex items-center gap-2">
                                                <span className="text-xs font-extrabold text-white">سجل العمليات</span>
                                                <span className="text-[11px] text-gray-400 font-mono">
                                                    (عرض {ledger.length.toLocaleString()} من أصل {ledgerPagination.total.toLocaleString()} عملية)
                                                </span>
                                            </div>
                                            <span className="text-[10px] font-mono font-bold text-gray-400">
                                                صفحة {ledgerPagination.page} من {Math.max(1, ledgerPagination.total_pages || 1)}
                                            </span>
                                        </div>

                                        <div className="overflow-x-auto custom-scrollbar">
                                            <table className="w-full text-right border-collapse">
                                                <thead>
                                                    <tr className={`text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b ${
                                                        isDarkMode ? 'bg-white/[0.015] border-white/5' : 'bg-gray-50 border-black/5'
                                                    }`}>
                                                        <th className="px-4 sm:px-6 py-3">التاريخ والتوقيت</th>
                                                        <th className="px-4 sm:px-6 py-3">الخدمة / المنتج</th>
                                                        <th className="px-4 sm:px-6 py-3">رقم الفاتورة</th>
                                                        <th className="px-4 sm:px-6 py-3">الفرع</th>
                                                        <th className="px-4 sm:px-6 py-3 text-left">القيمة / العمولة</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5 text-xs font-medium">
                                                    {isLoadingLedger ? (
                                                        <tr>
                                                            <td colSpan={5} className="px-6 py-12 text-center text-gray-400 text-xs">
                                                                <div className="inline-flex items-center gap-2">
                                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                                    <span>جاري تحميل سجل العمليات...</span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        ledger.map((op) => (
                                                            <tr
                                                                key={op.id}
                                                                className={`h-[48px] transition-colors ${
                                                                    isDarkMode ? 'hover:bg-white/[0.025]' : 'hover:bg-gray-50'
                                                                }`}
                                                            >
                                                                <td className="px-4 sm:px-6 py-3 text-gray-400 font-mono text-[11px] whitespace-nowrap">
                                                                    {formatDateTime(op.date)}
                                                                </td>
                                                                <td className="px-4 sm:px-6 py-3">
                                                                    {op.itemType === 'PRODUCT_ITEM' ? (
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                                                                                منتج
                                                                            </span>
                                                                            <span className="font-bold text-gray-200 truncate max-w-[200px]" title={op.productName || 'منتج'}>
                                                                                {op.productName || 'منتج'}
                                                                            </span>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="font-bold text-gray-200 truncate max-w-[220px]" title={op.serviceName}>
                                                                                {op.serviceName}
                                                                            </span>
                                                                            {op.role && (
                                                                                <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider shrink-0">
                                                                                    [{ROLE_LABELS[op.role] || op.role}]
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className="px-4 sm:px-6 py-3 font-mono text-xs text-gray-400">
                                                                    #{op.invoiceNumber}
                                                                </td>
                                                                <td className="px-4 sm:px-6 py-3">
                                                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/5 border border-white/5 text-gray-300">
                                                                        {op.branch}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 sm:px-6 py-3 text-left">
                                                                    <span className="font-mono text-xs sm:text-sm font-extrabold text-white">
                                                                        {op.itemType === 'PRODUCT_ITEM'
                                                                            ? `عمولة: ${op.value.toLocaleString()} ج.م`
                                                                            : `${op.value.toLocaleString()} ج.م`}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )}
                                                    {!isLoadingLedger && ledger.length === 0 && (
                                                        <tr>
                                                            <td colSpan={5} className="px-6 py-12 text-center text-gray-500 text-xs">
                                                                لا يوجد سجل عمليات مسجل لهذا الموظف في النظام
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                        {renderPaginationControls(
                                            ledgerPagination,
                                            () => setLedgerPage((current) => Math.max(1, current - 1)),
                                            () => setLedgerPage((current) => current + 1),
                                            isLoadingLedger
                                        )}
                                    </div>
                                </div>
                            ) : (
                                /* 3. Performance Analytics Sub-View */
                                <div className="space-y-4">
                                    {/* Compact, Grouped Filter Rail */}
                                    <div className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                                        isDarkMode ? 'bg-[#121215] border-white/10' : 'bg-white border-black/5 shadow-sm'
                                    }`}>
                                        {/* Date Range Inputs */}
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <div className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-gray-400 shrink-0">
                                                <Calendar size={13} />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">من:</span>
                                                <input
                                                    type="date"
                                                    value={analyticsFromDate}
                                                    onChange={(e) => setAnalyticsFromDate(e.target.value)}
                                                    className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold outline-none border transition-colors ${
                                                        isDarkMode
                                                            ? 'bg-white/5 border-white/10 text-white focus:border-[#E53935]/40'
                                                            : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-gray-300'
                                                    }`}
                                                />
                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">إلى:</span>
                                                <input
                                                    type="date"
                                                    value={analyticsToDate}
                                                    onChange={(e) => setAnalyticsToDate(e.target.value)}
                                                    className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold outline-none border transition-colors ${
                                                        isDarkMode
                                                            ? 'bg-white/5 border-white/10 text-white focus:border-[#E53935]/40'
                                                            : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-gray-300'
                                                    }`}
                                                />
                                            </div>
                                        </div>

                                        {/* Branch Selector and Share Percentage */}
                                        <div className="flex items-center gap-3 flex-wrap">
                                            {/* Branch Selector */}
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">الفرع:</span>
                                                <select
                                                    value={selectedBranchForStats}
                                                    onChange={(e) => setSelectedBranchForStats(e.target.value)}
                                                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold outline-none border transition-colors ${
                                                        isDarkMode
                                                            ? 'bg-[#18181B] border-white/10 text-white focus:border-[#E53935]/40'
                                                            : 'bg-gray-50 border-gray-200 text-gray-900'
                                                    }`}
                                                >
                                                    <option value="All">جميع الفروع</option>
                                                    {headerStats.branchOptions.map((branch) => (
                                                        <option key={branch} value={branch}>{branch}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            {/* Employee Share Percentage Manual Input */}
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">نسبة الموظف:</span>
                                                <div className="flex items-center gap-1">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="100"
                                                        value={sharePercentage ?? ''}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            if (val === '') {
                                                                setSharePercentage(null);
                                                            } else {
                                                                const num = parseInt(val);
                                                                if (!isNaN(num)) {
                                                                    setSharePercentage(Math.max(0, Math.min(100, num)));
                                                                }
                                                            }
                                                        }}
                                                        placeholder="0"
                                                        className={`px-2 py-1.5 rounded-lg text-xs font-mono font-bold outline-none border transition-colors w-14 text-center ${
                                                            isDarkMode
                                                                ? 'bg-white/5 border-white/10 text-white focus:border-[#E53935]/40'
                                                                : 'bg-gray-50 border-gray-200 text-gray-900'
                                                        }`}
                                                    />
                                                    <span className="text-xs font-mono text-gray-400">%</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Error Banner if any */}
                                    {recordSummaryError && (
                                        <div className={`p-3.5 rounded-xl text-xs font-bold ${
                                            isDarkMode ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-red-50 text-red-600 border border-red-100'
                                        }`}>
                                            {recordSummaryError}
                                        </div>
                                    )}

                                    {/* Compact, Dignified KPI Cards (Linear Style) */}
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        {/* Card 1: Total Operations Count */}
                                        <div className={`p-4 rounded-xl border flex flex-col justify-between ${
                                            isDarkMode ? 'bg-[#121215] border-white/10' : 'bg-white border-black/10 shadow-sm'
                                        }`}>
                                            <div className="flex justify-between items-center text-gray-400 mb-3">
                                                <span className="text-[10px] font-bold uppercase tracking-wider">إجمالي العمليات المنفذة</span>
                                                <Receipt size={14} className="text-[#E53935]" />
                                            </div>
                                            <span className="font-mono text-2xl font-black text-white">
                                                {isLoadingRecordSummary ? '...' : branchStats.count.toLocaleString()}
                                            </span>
                                        </div>

                                        {/* Card 2: Total Service Value */}
                                        <div className={`p-4 rounded-xl border flex flex-col justify-between ${
                                            isDarkMode ? 'bg-[#121215] border-white/10' : 'bg-white border-black/10 shadow-sm'
                                        }`}>
                                            <div className="flex justify-between items-center text-gray-400 mb-3">
                                                <span className="text-[10px] font-bold uppercase tracking-wider">إجمالي القيمة المنفذة</span>
                                                <TrendingUp size={14} />
                                            </div>
                                            <span className="font-mono text-2xl font-black text-white">
                                                {isLoadingRecordSummary ? '...' : `${branchStats.totalValue.toLocaleString()} ج.م`}
                                            </span>
                                        </div>

                                        {/* Card 3: Employee Share Value */}
                                        <div className={`p-4 rounded-xl border flex flex-col justify-between ${
                                            isDarkMode ? 'bg-[#121215] border-white/10' : 'bg-white border-black/10 shadow-sm'
                                        }`}>
                                            <div className="flex justify-between items-center text-gray-400 mb-3">
                                                <span className="text-[10px] font-bold uppercase tracking-wider">
                                                    {sharePercentage !== null ? `حصة الموظف (${sharePercentage}%)` : 'حصة الموظف التقديرية'}
                                                </span>
                                                <Wallet size={14} className={branchStats.totalShare !== null ? 'text-[#E6D690]' : 'text-gray-400'} />
                                            </div>
                                            <span className={`font-mono text-2xl font-black ${
                                                branchStats.totalShare !== null ? 'text-[#E6D690]' : 'text-gray-400 text-base font-normal'
                                            }`}>
                                                {isLoadingRecordSummary
                                                    ? '...'
                                                    : branchStats.totalShare !== null
                                                    ? `${branchStats.totalShare.toLocaleString()} ج.م`
                                                    : 'أدخل النسبة'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* AREA 4 – FINANCIAL COMMAND CENTER WORKSPACE */}
                    {activeAreaTab === 'financial' && (
                        <div className="space-y-4 animate-fade-in-up">
                            {/* 1. Single Compact Financial Overview Strip */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
                                {/* Metric 1: Base Salary */}
                                <div className={`p-3 rounded-xl border flex flex-col justify-between ${
                                    isDarkMode ? 'bg-[#121216] border-white/[0.08]' : 'bg-white border-black/10 shadow-sm'
                                }`}>
                                    <div className="flex justify-between items-center text-gray-400 mb-1.5">
                                        <span className="text-[10px] font-bold uppercase tracking-wider">الراتب الأساسي</span>
                                        <CreditCard size={13} className="text-gray-400" />
                                    </div>
                                    <div className="flex items-baseline gap-1">
                                        <span className="font-mono text-base sm:text-lg font-bold text-white">
                                            {employeeProfile.baseSalary.toLocaleString()}
                                        </span>
                                        <span className="text-[10px] font-sans text-gray-400">ج.م</span>
                                    </div>
                                </div>

                                {/* Metric 2: Current Commission Balance */}
                                <div className={`p-3 rounded-xl border flex flex-col justify-between ${
                                    isDarkMode ? 'bg-[#121216] border-white/[0.08]' : 'bg-white border-black/10 shadow-sm'
                                }`}>
                                    <div className="flex justify-between items-center text-gray-400 mb-1.5">
                                        <span className="text-[10px] font-bold uppercase tracking-wider">الرصيد الحالي</span>
                                        <Wallet size={13} className="text-gray-400" />
                                    </div>
                                    <div className="flex items-baseline gap-1">
                                        <span className="font-mono text-base sm:text-lg font-bold text-[#E6D690]">
                                            {commissionWalletBalance.toLocaleString()}
                                        </span>
                                        <span className="text-[10px] font-sans text-gray-400">ج.م</span>
                                    </div>
                                </div>

                                {/* Metric 3: Total Advances */}
                                <div className={`p-3 rounded-xl border flex flex-col justify-between ${
                                    isDarkMode ? 'bg-[#121216] border-white/[0.08]' : 'bg-white border-black/10 shadow-sm'
                                }`}>
                                    <div className="flex justify-between items-center text-gray-400 mb-1.5">
                                        <span className="text-[10px] font-bold uppercase tracking-wider">إجمالي السلفيات</span>
                                        <Wallet size={13} className="text-gray-400" />
                                    </div>
                                    <div className="flex items-baseline gap-1">
                                        <span className="font-mono text-base sm:text-lg font-bold text-white">
                                            {advanceTotal.toLocaleString()}
                                        </span>
                                        <span className="text-[10px] font-sans text-gray-400">ج.م</span>
                                    </div>
                                </div>

                                {/* Metric 4: Total Deductions */}
                                <div className={`p-3 rounded-xl border flex flex-col justify-between ${
                                    isDarkMode ? 'bg-[#121216] border-white/[0.08]' : 'bg-white border-black/10 shadow-sm'
                                }`}>
                                    <div className="flex justify-between items-center text-gray-400 mb-1.5">
                                        <span className="text-[10px] font-bold uppercase tracking-wider">إجمالي الخصومات</span>
                                        <ShieldCheck size={13} className="text-gray-400" />
                                    </div>
                                    <div className="flex items-baseline gap-1">
                                        <span className="font-mono text-base sm:text-lg font-bold text-white">
                                            {deductionTotal.toLocaleString()}
                                        </span>
                                        <span className="text-[10px] font-sans text-gray-400">ج.م</span>
                                    </div>
                                </div>

                                {/* Metric 5: Total Overtime */}
                                <div className={`p-3 rounded-xl border flex flex-col justify-between col-span-2 sm:col-span-1 ${
                                    isDarkMode ? 'bg-[#121216] border-white/[0.08]' : 'bg-white border-black/10 shadow-sm'
                                }`}>
                                    <div className="flex justify-between items-center text-gray-400 mb-1.5">
                                        <span className="text-[10px] font-bold uppercase tracking-wider">الأوفر تايم</span>
                                        <Clock size={13} className="text-gray-400" />
                                    </div>
                                    <div className="flex items-baseline gap-1">
                                        <span className="font-mono text-base sm:text-lg font-bold text-white">
                                            {overtimeTotal.toLocaleString()}
                                        </span>
                                        <span className="text-[10px] font-sans text-gray-400">ج.م</span>
                                    </div>
                                </div>
                            </div>


                            {/* 2. Compact Financial Sub-View Navigation Bar */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-white/5">
                                <div className={`inline-flex p-1 rounded-xl border overflow-x-auto custom-scrollbar max-w-full ${
                                    isDarkMode ? 'bg-[#121216] border-white/10' : 'bg-gray-100 border-black/5'
                                }`}>
                                    {[
                                        { id: 'advance', label: 'السلفيات', icon: <Wallet size={13} />, count: advancePagination.total || advances.length },
                                        { id: 'deduction', label: 'الخصومات', icon: <ShieldCheck size={13} />, count: deductionPagination.total || deductions.length },
                                        { id: 'overtime', label: 'الأوفر تايم', icon: <Clock size={13} />, count: overtimePagination.total || overtimes.length },
                                        { id: 'daily_percentage', label: 'النِسَب اليومية', icon: <TrendingUp size={13} /> },
                                    ].map((tab) => {
                                        const isActive = financialSubTab === tab.id;
                                        return (
                                            <button
                                                key={tab.id}
                                                type="button"
                                                onClick={() => setFinancialSubTab(tab.id as any)}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                                                    isActive
                                                        ? isDarkMode
                                                            ? 'bg-[#E53935]/15 text-white shadow-sm border border-[#E53935]/30'
                                                            : 'bg-white shadow-sm text-gray-900 border border-gray-200'
                                                        : 'text-gray-400 hover:text-white'
                                                }`}
                                            >
                                                <span className={isActive ? 'text-[#E53935]' : 'text-gray-500'}>
                                                    {tab.icon}
                                                </span>
                                                <span>{tab.label}</span>
                                                {typeof tab.count === 'number' && tab.count > 0 && (
                                                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                                                        isActive
                                                            ? 'bg-[#E53935]/30 text-white'
                                                            : 'bg-white/5 text-gray-400'
                                                    }`}>
                                                        {tab.count}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Contextual Subview Actions */}
                                <div className="flex items-center gap-2">
                                    {financialSubTab === 'deduction' && (
                                        <button
                                            type="button"
                                            onClick={() => setIsAddDeductionOpen(true)}
                                            className="bg-[#E53935] hover:bg-[#D32F2F] text-white px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                                        >
                                            <Plus size={13} />
                                            <span>إضافة خصم جديد</span>
                                        </button>
                                    )}

                                    {financialSubTab === 'overtime' && (
                                        <button
                                            type="button"
                                            onClick={() => setIsAddOvertimeOpen(true)}
                                            className="bg-[#E53935] hover:bg-[#D32F2F] text-white px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                                        >
                                            <Plus size={13} />
                                            <span>تسجيل أوفر تايم</span>
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* 5. SUBVIEW 3: ADVANCES WORKSPACE */}
                            {financialSubTab === 'advance' && (
                                <div className="space-y-4 animate-fade-in-up">
                                    <div className={`rounded-xl border overflow-hidden ${
                                        isDarkMode ? 'bg-[#121216] border-white/[0.08]' : 'bg-white border-black/10 shadow-sm'
                                    }`}>
                                        <div className={`flex items-center justify-between px-4 py-3 border-b gap-2 ${
                                            isDarkMode ? 'border-white/5 bg-white/[0.02]' : 'border-black/5 bg-gray-50'
                                        }`}>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-extrabold text-white">سجل السلفيات</span>
                                                <span className="text-[11px] text-gray-400 font-mono">
                                                    (إجمالي: {advanceTotal.toLocaleString()} ج.م)
                                                </span>
                                            </div>
                                            <span className="text-[10px] font-mono font-bold text-gray-400">
                                                صفحة {advancePagination.page} من {Math.max(1, advancePagination.total_pages || 1)}
                                            </span>
                                        </div>

                                        <div className="overflow-x-auto custom-scrollbar">
                                            <table className="w-full text-right border-collapse">
                                                <thead>
                                                    <tr className={`text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b ${
                                                        isDarkMode ? 'bg-white/[0.015] border-white/5' : 'bg-gray-50 border-black/5'
                                                    }`}>
                                                        <th className="px-4 sm:px-6 py-3">تاريخ الطلب</th>
                                                        <th className="px-4 sm:px-6 py-3">نوع السلفة</th>
                                                        <th className="px-4 sm:px-6 py-3">المبلغ</th>
                                                        <th className="px-4 sm:px-6 py-3 text-left">ملاحظات</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5 text-xs font-medium">
                                                    {isLoadingAdvances ? (
                                                        <tr>
                                                            <td colSpan={4} className="px-6 py-12 text-center text-gray-400 text-xs">
                                                                <div className="inline-flex items-center gap-2">
                                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                                    <span>جاري تحميل السلفيات...</span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        advances.map((adv) => (
                                                            <tr
                                                                key={adv.id}
                                                                className={`h-[48px] transition-colors ${
                                                                    isDarkMode ? 'hover:bg-white/[0.025]' : 'hover:bg-gray-50'
                                                                }`}
                                                            >
                                                                <td className="px-4 sm:px-6 py-3 text-gray-400 font-mono text-[11px] whitespace-nowrap">
                                                                    {formatDate(adv.date)}
                                                                </td>
                                                                <td className="px-4 sm:px-6 py-3">
                                                                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-white/5 border border-white/10 text-gray-300">
                                                                        سلفة على الراتب
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 sm:px-6 py-3 font-mono text-xs sm:text-sm font-bold text-white">
                                                                    {adv.amount.toLocaleString()} ج.م
                                                                </td>
                                                                <td className="px-4 sm:px-6 py-3 text-left text-gray-400 text-xs">
                                                                    {adv.note || '-'}
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )}
                                                    {!isLoadingAdvances && advances.length === 0 && (
                                                        <tr>
                                                            <td colSpan={4} className="px-6 py-12 text-center text-gray-500 text-xs">
                                                                لا توجد سلفيات مسجلة لهذا الموظف
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        {renderPaginationControls(
                                            advancePagination,
                                            () => setAdvancePage((current) => Math.max(1, current - 1)),
                                            () => setAdvancePage((current) => current + 1),
                                            isLoadingAdvances
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 6. SUBVIEW 4: DEDUCTIONS WORKSPACE */}
                            {financialSubTab === 'deduction' && (
                                <div className="space-y-4 animate-fade-in-up">
                                    <div className={`rounded-xl border overflow-hidden ${
                                        isDarkMode ? 'bg-[#121216] border-white/[0.08]' : 'bg-white border-black/10 shadow-sm'
                                    }`}>
                                        <div className={`flex items-center justify-between px-4 py-3 border-b gap-2 ${
                                            isDarkMode ? 'border-white/5 bg-white/[0.02]' : 'border-black/5 bg-gray-50'
                                        }`}>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-extrabold text-white">سجل الخصومات والجزاءات</span>
                                                <span className="text-[11px] text-gray-400 font-mono">
                                                    (إجمالي: {deductionTotal.toLocaleString()} ج.م)
                                                </span>
                                            </div>
                                            <span className="text-[10px] font-mono font-bold text-gray-400">
                                                صفحة {deductionPagination.page} من {Math.max(1, deductionPagination.total_pages || 1)}
                                            </span>
                                        </div>

                                        <div className="overflow-x-auto custom-scrollbar">
                                            <table className="w-full text-right border-collapse">
                                                <thead>
                                                    <tr className={`text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b ${
                                                        isDarkMode ? 'bg-white/[0.015] border-white/5' : 'bg-gray-50 border-black/5'
                                                    }`}>
                                                        <th className="px-4 sm:px-6 py-3">تاريخ الخصم</th>
                                                        <th className="px-4 sm:px-6 py-3">سبب الخصم</th>
                                                        <th className="px-4 sm:px-6 py-3">المبلغ</th>
                                                        <th className="px-4 sm:px-6 py-3">مرتبط براتب شهر</th>
                                                        <th className="px-4 sm:px-6 py-3 text-left">ملاحظات إدارية</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5 text-xs font-medium">
                                                    {isLoadingDeductions ? (
                                                        <tr>
                                                            <td colSpan={5} className="px-6 py-12 text-center text-gray-400 text-xs">
                                                                <div className="inline-flex items-center gap-2">
                                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                                    <span>جاري تحميل الخصومات...</span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        deductions.map((ded) => (
                                                            <tr
                                                                key={ded.id}
                                                                className={`h-[48px] transition-colors ${
                                                                    isDarkMode ? 'hover:bg-white/[0.025]' : 'hover:bg-gray-50'
                                                                }`}
                                                            >
                                                                <td className="px-4 sm:px-6 py-3 text-gray-400 font-mono text-[11px] whitespace-nowrap">
                                                                    {formatDate(ded.date)}
                                                                </td>
                                                                <td className="px-4 sm:px-6 py-3 font-medium text-gray-300">
                                                                    {ded.reason || 'جزاء إداري'}
                                                                </td>
                                                                <td className="px-4 sm:px-6 py-3 font-mono text-xs sm:text-sm font-bold text-white">
                                                                    -{ded.amount.toLocaleString()} ج.م
                                                                </td>
                                                                <td className="px-4 sm:px-6 py-3 font-mono text-gray-400 text-xs">
                                                                    {formatDate(ded.date)}
                                                                </td>
                                                                <td className="px-4 sm:px-6 py-3 text-left text-gray-400 text-xs">
                                                                    {ded.notes || '-'}
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )}
                                                    {!isLoadingDeductions && deductions.length === 0 && (
                                                        <tr>
                                                            <td colSpan={5} className="px-6 py-12 text-center text-gray-500 text-xs">
                                                                سجل نظيف: لا توجد خصومات مسجلة
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        {renderPaginationControls(
                                            deductionPagination,
                                            () => setDeductionPage((current) => Math.max(1, current - 1)),
                                            () => setDeductionPage((current) => current + 1),
                                            isLoadingDeductions
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 7. SUBVIEW 5: OVERTIME WORKSPACE */}
                            {financialSubTab === 'overtime' && (
                                <div className="space-y-4 animate-fade-in-up">
                                    <div className={`rounded-xl border overflow-hidden ${
                                        isDarkMode ? 'bg-[#121216] border-white/[0.08]' : 'bg-white border-black/10 shadow-sm'
                                    }`}>
                                        <div className={`flex items-center justify-between px-4 py-3 border-b gap-2 ${
                                            isDarkMode ? 'border-white/5 bg-white/[0.02]' : 'border-black/5 bg-gray-50'
                                        }`}>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-extrabold text-white">سجل الأوفر تايم</span>
                                                <span className="text-[11px] text-gray-400 font-mono">
                                                    (إجمالي: {overtimeTotal.toLocaleString()} ج.م)
                                                </span>
                                            </div>
                                            <span className="text-[10px] font-mono font-bold text-gray-400">
                                                صفحة {overtimePagination.page} من {Math.max(1, overtimePagination.total_pages || 1)}
                                            </span>
                                        </div>

                                        <div className="overflow-x-auto custom-scrollbar">
                                            <table className="w-full text-right border-collapse">
                                                <thead>
                                                    <tr className={`text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b ${
                                                        isDarkMode ? 'bg-white/[0.015] border-white/5' : 'bg-gray-50 border-black/5'
                                                    }`}>
                                                        <th className="px-4 sm:px-6 py-3">تاريخ العمل</th>
                                                        <th className="px-4 sm:px-6 py-3">السبب / نوع العمل</th>
                                                        <th className="px-4 sm:px-6 py-3">المبلغ</th>
                                                        <th className="px-4 sm:px-6 py-3 text-left">تاريخ التسجيل</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5 text-xs font-medium">
                                                    {isLoadingOvertimes ? (
                                                        <tr>
                                                            <td colSpan={4} className="px-6 py-12 text-center text-gray-400 text-xs">
                                                                <div className="inline-flex items-center gap-2">
                                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                                    <span>جاري تحميل الأوفر تايم...</span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        overtimes.map((ot) => (
                                                            <tr
                                                                key={ot.id}
                                                                className={`h-[48px] transition-colors ${
                                                                    isDarkMode ? 'hover:bg-white/[0.025]' : 'hover:bg-gray-50'
                                                                }`}
                                                            >
                                                                <td className="px-4 sm:px-6 py-3 text-gray-400 font-mono text-[11px] whitespace-nowrap">
                                                                    {formatDate(ot.date)}
                                                                </td>
                                                                <td className="px-4 sm:px-6 py-3 font-medium text-gray-300">
                                                                    {ot.reason || 'عمل إضافي'}
                                                                </td>
                                                                <td className="px-4 sm:px-6 py-3 font-mono text-xs sm:text-sm font-bold text-white">
                                                                    +{ot.amount.toLocaleString()} ج.م
                                                                </td>
                                                                <td className="px-4 sm:px-6 py-3 text-left text-gray-400 font-mono text-[11px]">
                                                                    {formatDateTime(ot.created_at)}
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )}
                                                    {!isLoadingOvertimes && overtimes.length === 0 && (
                                                        <tr>
                                                            <td colSpan={4} className="px-6 py-12 text-center text-gray-500 text-xs">
                                                                لا يوجد سجل أوفر تايم لهذا الموظف
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        {renderPaginationControls(
                                            overtimePagination,
                                            () => setOvertimePage((current) => Math.max(1, current - 1)),
                                            () => setOvertimePage((current) => current + 1),
                                            isLoadingOvertimes
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 8. SUBVIEW 6: DAILY PERCENTAGES WORKSPACE */}
                            {financialSubTab === 'daily_percentage' && (
                                <div className="space-y-4 animate-fade-in-up">
                                    {/* Top Control Rail */}
                                    <div className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                                        isDarkMode ? 'bg-[#121216] border-white/[0.08]' : 'bg-white border-black/10 shadow-sm'
                                    }`}>
                                        <div className="flex items-center gap-2.5">
                                            <Calendar size={13} className="text-[#E53935]" />
                                            <span className="text-xs font-bold text-gray-300">تاريخ اليوم المختار:</span>
                                            <input
                                                type="date"
                                                value={selectedDailyDate}
                                                onChange={(e) => setSelectedDailyDate(e.target.value)}
                                                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold outline-none border transition-colors ${
                                                    isDarkMode
                                                        ? 'bg-white/5 border-white/10 text-white focus:border-[#E53935]/40'
                                                        : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-gray-300'
                                                }`}
                                            />
                                        </div>

                                        <div className="flex items-center gap-4 text-xs">
                                            <span className="text-gray-400">
                                                الخدمات: <span className="font-mono font-bold text-white">{dailyStats.count}</span>
                                            </span>
                                            <span className="text-gray-400">
                                                إجمالي النسبة: <span className="font-mono font-bold text-white">+{dailyStats.totalShare.toLocaleString()} ج.م</span>
                                            </span>
                                        </div>
                                    </div>

                                    {/* High Density Table */}
                                    <div className={`rounded-xl border overflow-hidden ${
                                        isDarkMode ? 'bg-[#121216] border-white/[0.08]' : 'bg-white border-black/10 shadow-sm'
                                    }`}>
                                        <div className={`flex items-center justify-between px-4 py-3 border-b gap-2 ${
                                            isDarkMode ? 'border-white/5 bg-white/[0.02]' : 'border-black/5 bg-gray-50'
                                        }`}>
                                            <span className="text-xs font-extrabold text-white">تفاصيل النِسَب اليومية</span>
                                            <span className="text-[10px] font-mono font-bold text-gray-400">
                                                صفحة {dailyLedgerPagination.page} من {Math.max(1, dailyLedgerPagination.total_pages || 1)}
                                            </span>
                                        </div>

                                        <div className="overflow-x-auto custom-scrollbar">
                                            <table className="w-full text-right border-collapse">
                                                <thead>
                                                    <tr className={`text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b ${
                                                        isDarkMode ? 'bg-white/[0.015] border-white/5' : 'bg-gray-50 border-black/5'
                                                    }`}>
                                                        <th className="px-4 sm:px-6 py-3">التوقيت</th>
                                                        <th className="px-4 sm:px-6 py-3">الخدمة المُنفذة</th>
                                                        <th className="px-4 sm:px-6 py-3">سعر الخدمة</th>
                                                        <th className="px-4 sm:px-6 py-3">نسبة الموظف (%)</th>
                                                        <th className="px-4 sm:px-6 py-3 text-left">قيمة النسبة</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5 text-xs font-medium">
                                                    {isLoadingDailyLedger ? (
                                                        <tr>
                                                            <td colSpan={5} className="px-6 py-12 text-center text-gray-400 text-xs">
                                                                <div className="inline-flex items-center gap-2">
                                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                                    <span>جاري تحميل نسب اليوم...</span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        dailyStats.ops.map((op) => {
                                                            const rate = op.value > 0 ? Math.round((op.share / op.value) * 100) : 0;
                                                            return (
                                                                <tr
                                                                    key={op.id}
                                                                    className={`h-[48px] transition-colors ${
                                                                        isDarkMode ? 'hover:bg-white/[0.025]' : 'hover:bg-gray-50'
                                                                    }`}
                                                                >
                                                                    <td className="px-4 sm:px-6 py-3 text-gray-400 font-mono text-[11px] whitespace-nowrap">
                                                                        {formatTime(op.date)}
                                                                    </td>
                                                                    <td className="px-4 sm:px-6 py-3 font-medium text-gray-300">
                                                                        {op.serviceName}
                                                                    </td>
                                                                    <td className="px-4 sm:px-6 py-3 font-mono text-gray-400 text-xs">
                                                                        {op.value.toLocaleString()} ج.م
                                                                    </td>
                                                                    <td className="px-4 sm:px-6 py-3 font-mono text-xs">
                                                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-white/5 border border-white/5 text-gray-300">
                                                                            {rate}%
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-4 sm:px-6 py-3 text-left font-mono text-xs sm:text-sm font-bold text-white">
                                                                        +{op.share.toLocaleString()} ج.م
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })
                                                    )}
                                                    {!isLoadingDailyLedger && dailyStats.ops.length === 0 && (
                                                        <tr>
                                                            <td colSpan={5} className="px-6 py-12 text-center text-gray-500 text-xs">
                                                                لا توجد عمليات مسجلة في هذا التاريخ
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        {renderPaginationControls(
                                            dailyLedgerPagination,
                                            () => setDailyLedgerPage((current) => Math.max(1, current - 1)),
                                            () => setDailyLedgerPage((current) => current + 1),
                                            isLoadingDailyLedger
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
{/* AREA 5 – TRANSFERS WORKSPACE */}
                    {activeAreaTab === 'transfer' && (
                        <div className="space-y-4 animate-fade-in-up">
                            {/* Control Bar: Title & Action */}
                            <div className={`p-4 sm:p-5 rounded-xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                                isDarkMode ? 'bg-[#121216] border-white/[0.08]' : 'bg-white border-black/10 shadow-sm'
                            }`}>
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <ArrowLeftRight size={14} className="text-[#E53935]" />
                                        <h3 className={`text-sm sm:text-base font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                            سجل التنقلات الوظيفية
                                        </h3>
                                    </div>
                                    <p className="text-xs text-gray-400">
                                        تتبع التاريخ الزمني لحركة تعيين الموظف وتنقله بين فروع النادي
                                    </p>
                                </div>

                                {onOpenTransfer && (
                                    <button
                                        type="button"
                                        onClick={onOpenTransfer}
                                        className="bg-[#E53935] hover:bg-[#D32F2F] text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto shrink-0"
                                    >
                                        <ArrowLeftRight size={13} />
                                        <span>نقل لفرع آخر</span>
                                    </button>
                                )}
                            </div>

                            {/* Chronological Transfer Ledger Table */}
                            <div className={`rounded-xl border overflow-hidden ${
                                isDarkMode ? 'bg-[#121216] border-white/[0.08]' : 'bg-white border-black/10 shadow-sm'
                            }`}>
                                <div className={`flex items-center justify-between px-4 py-3 border-b gap-2 ${
                                    isDarkMode ? 'border-white/5 bg-white/[0.02]' : 'border-black/5 bg-gray-50'
                                }`}>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-extrabold text-white">بيان الفترات والتعيينات</span>
                                        {transferPagination.total > 0 && (
                                            <span className="text-[11px] text-gray-400 font-mono">
                                                ({transferPagination.total} تعيين)
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-[10px] font-mono font-bold text-gray-400">
                                        صفحة {transferPagination.page} من {Math.max(1, transferPagination.total_pages || 1)}
                                    </span>
                                </div>

                                <div className="overflow-x-auto custom-scrollbar">
                                    <table className="w-full text-right border-collapse">
                                        <thead>
                                            <tr className={`text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b ${
                                                isDarkMode ? 'bg-white/[0.015] border-white/5' : 'bg-gray-50 border-black/5'
                                            }`}>
                                                <th className="px-4 sm:px-6 py-3">الفرع</th>
                                                <th className="px-4 sm:px-6 py-3">فترة التعيين</th>
                                                <th className="px-4 sm:px-6 py-3">حالة التعيين</th>
                                                <th className="px-4 sm:px-6 py-3">العمليات المنفذة</th>
                                                <th className="px-4 sm:px-6 py-3 text-left">الأرباح المحققة</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5 text-xs font-medium">
                                            {isLoadingTransfers ? (
                                                <tr>
                                                    <td colSpan={5} className="px-6 py-12 text-center text-gray-400 text-xs">
                                                        <div className="inline-flex items-center gap-2">
                                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                            <span>جاري تحميل سجل التنقلات...</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ) : transfers && transfers.length > 0 ? (
                                                transfers.map((transfer) => {
                                                    const isCurrent = transfer.endDate === 'مستمر';
                                                    return (
                                                        <tr
                                                            key={transfer.id}
                                                            className={`h-[48px] transition-colors ${
                                                                isDarkMode ? 'hover:bg-white/[0.025]' : 'hover:bg-gray-50'
                                                            }`}
                                                        >
                                                            <td className="px-4 sm:px-6 py-3">
                                                                <div className="flex items-center gap-2">
                                                                    <Building2 size={13} className={isCurrent ? 'text-[#E53935]' : 'text-gray-400'} />
                                                                    <span className="font-bold text-gray-200">
                                                                        {transfer.branch}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 sm:px-6 py-3 font-mono text-[11px] text-gray-400 whitespace-nowrap">
                                                                <span>{formatDate(transfer.startDate)}</span>
                                                                <span className="mx-1.5 opacity-40">←</span>
                                                                <span>{isCurrent ? 'حتى الآن' : formatDate(transfer.endDate)}</span>
                                                            </td>
                                                            <td className="px-4 sm:px-6 py-3 whitespace-nowrap">
                                                                {isCurrent ? (
                                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/10 text-white border border-white/20 inline-flex items-center gap-1">
                                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                                                        <span>الفرع الحالي</span>
                                                                    </span>
                                                                ) : (
                                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/5 text-gray-400 border border-white/5">
                                                                        فترة سابقة
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 sm:px-6 py-3 font-mono text-gray-300 text-xs">
                                                                {transfer.operationsCount.toLocaleString()} عملية
                                                            </td>
                                                            <td className="px-4 sm:px-6 py-3 text-left font-mono text-xs sm:text-sm font-bold text-white">
                                                                {transfer.totalEarnings > 0
                                                                    ? `${transfer.totalEarnings.toLocaleString()} ج.م`
                                                                    : '—'}
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            ) : (
                                                <tr>
                                                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500 text-xs">
                                                        لا يوجد سجل تنقلات سابق لهذا الموظف
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                {renderPaginationControls(
                                    transferPagination,
                                    () => setTransferPage((current) => Math.max(1, current - 1)),
                                    () => setTransferPage((current) => current + 1),
                                    isLoadingTransfers
                                )}
                            </div>
                        </div>
                    )}

                    {/* AREA 6 – DOCUMENTS VAULT */}
                    {activeAreaTab === 'documents' && (
                        <div className="space-y-4 animate-fade-in-up">
                            {/* Section Header */}
                            <div className={`p-4 sm:p-5 rounded-xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                                isDarkMode ? 'bg-[#121216] border-white/[0.08]' : 'bg-white border-black/10 shadow-sm'
                            }`}>
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <FileText size={14} className="text-[#E53935]" />
                                        <h3 className={`text-sm sm:text-base font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                            أرشيف ملفات الموظف
                                        </h3>
                                    </div>
                                    <p className="text-xs text-gray-400">
                                        المستندات الثبوتية والملفات الإدارية الرسمية المسجلة في ملف الموظف
                                    </p>
                                </div>
                            </div>

                            {/* Documents Vault Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                                {(['بطاقة شخصية', 'فيش وتشبيه', 'مستندات إدارية أخرى'] as const).map((docType, idx) => {
                                    const realDoc = (employeeProfile.documents || []).find(d => d.type === docType);
                                    const devIcon = docType === 'بطاقة شخصية'
                                        ? <UserCheck size={16} />
                                        : docType === 'فيش وتشبيه'
                                        ? <ShieldCheck size={16} />
                                        : <FileText size={16} />;
                                    const isUploaded = Boolean(realDoc && realDoc.fileUrl);

                                    return (
                                        <div
                                            key={idx}
                                            className={`p-4 sm:p-5 rounded-xl border flex flex-col justify-between transition-all ${
                                                isDarkMode ? 'bg-[#121216] border-white/[0.08]' : 'bg-white border-black/10 shadow-sm'
                                            }`}
                                        >
                                            {/* Card Top: Icon & Status Badge */}
                                            <div className="flex items-center justify-between gap-2 mb-3">
                                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${
                                                    isUploaded
                                                        ? 'bg-white/5 border-white/10 text-white'
                                                        : 'bg-white/[0.02] border-white/5 text-gray-500'
                                                }`}>
                                                    {devIcon}
                                                </div>

                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1.5 ${
                                                    isUploaded
                                                        ? 'bg-white/10 text-white border-white/15'
                                                        : 'bg-white/[0.03] text-gray-500 border-white/5'
                                                }`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${isUploaded ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                                                    <span>{isUploaded ? 'تم الرفع' : 'غير متوفر'}</span>
                                                </span>
                                            </div>

                                            {/* Card Middle: Document Info without invented metadata */}
                                            <div className="space-y-1 mb-4">
                                                <h4 className="text-sm font-bold text-white">
                                                    {docType}
                                                </h4>
                                                <p className="text-xs text-gray-400 font-mono">
                                                    {isUploaded
                                                        ? (realDoc?.uploadDate ? `تاريخ الرفع: ${formatDate(realDoc.uploadDate)}` : 'مستند رقمي محفوظ')
                                                        : 'مطلوب الرفع'}
                                                </p>
                                            </div>

                                            {/* Card Bottom: Actions */}
                                            <div className="flex items-center gap-2 pt-3 border-t border-white/5">
                                                <button
                                                    type="button"
                                                    onClick={() => isUploaded && realDoc ? setPreviewDoc({ url: realDoc.fileUrl, label: docType }) : null}
                                                    disabled={!isUploaded}
                                                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                                                        isUploaded
                                                            ? isDarkMode
                                                                ? 'bg-white/5 hover:bg-white/10 text-white border border-white/10 cursor-pointer'
                                                                : 'bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-200 cursor-pointer'
                                                            : 'opacity-30 cursor-not-allowed bg-white/[0.02] border border-white/5 text-gray-500'
                                                    }`}
                                                >
                                                    <Eye size={13} />
                                                    <span>معاينة</span>
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => isUploaded && realDoc ? handleDownload(realDoc.fileUrl, `${employeeProfile.name}-${docType}`) : null}
                                                    disabled={!isUploaded}
                                                    title={isUploaded ? 'تحميل المستند' : 'المستند غير متوفر للتحميل'}
                                                    aria-label="تحميل المستند"
                                                    className={`h-8 w-8 rounded-lg flex items-center justify-center transition-all ${
                                                        isUploaded
                                                            ? isDarkMode
                                                                ? 'bg-white/5 hover:bg-white/10 text-white border border-white/10 cursor-pointer'
                                                                : 'bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-200 cursor-pointer'
                                                            : 'opacity-30 cursor-not-allowed bg-white/[0.02] border border-white/5 text-gray-500'
                                                    }`}
                                                >
                                                    <Download size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
{/* ADD OVERTIME MODAL */}
            {isAddOvertimeOpen && (
                <div className="admin-overlay-shell z-[150] backdrop-blur-sm bg-black/60 animate-fade-in" dir="rtl">
                    <div className="absolute inset-0" onClick={() => setIsAddOvertimeOpen(false)}></div>
                    <div className={`relative w-full max-w-lg p-8 rounded-3xl shadow-2xl animate-scale-in border ${isDarkMode ? 'bg-[#161616] border-white/10' : 'bg-white border-black/5'}`}>
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-3">
                                <div className="p-3 rounded-full bg-green-500/10 text-green-500">
                                    <Clock size={24} />
                                </div>
                                <div>
                                    <h3 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>تسجيل أوفر تايم (عمل إضافي)</h3>
                                    <p className="text-[10px] uppercase font-bold opacity-40 tracking-widest mt-1">إضافة مكافأة عمل خارج أوقات الدوام</p>
                                </div>
                            </div>
                            <button onClick={() => setIsAddOvertimeOpen(false)} className="opacity-50 hover:opacity-100 transition-opacity">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="space-y-6">
                            {/* Amount Input */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest opacity-60">مبلغ الأوفر تايم (ج.م)</label>
                                <div className={`flex items-center px-4 py-3 rounded-xl border transition-all focus-within:ring-1 focus-within:ring-green-500 ${isDarkMode ? 'bg-black/20 border-white/5' : 'bg-gray-50 border-black/5'}`}>
                                    <span className="text-green-500 font-bold ml-3">EGP</span>
                                    <input
                                        type="number"
                                        placeholder="0.00"
                                        value={newOvertime.amount}
                                        onChange={(e) => setNewOvertime({ ...newOvertime, amount: e.target.value })}
                                        className="bg-transparent border-none outline-none w-full font-bold text-lg h-full"
                                    />
                                </div>
                            </div>

                            {/* Date Input */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest opacity-60">تاريخ العمل</label>
                                <input
                                    type="date"
                                    value={newOvertime.date}
                                    onChange={(e) => setNewOvertime({ ...newOvertime, date: e.target.value })}
                                    className={`w-full px-4 py-4 rounded-xl border outline-none transition-all focus:border-green-500 ${isDarkMode ? 'bg-black/20 border-white/5 text-white' : 'bg-gray-50 border-black/5 text-gray-900'}`}
                                />
                            </div>

                            {/* Reason Input */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest opacity-60">السبب / التفاصيل</label>
                                <input
                                    type="text"
                                    placeholder="مثال: تغطية وردية مسائية، عمل يوم إجازة..."
                                    value={newOvertime.reason}
                                    onChange={(e) => setNewOvertime({ ...newOvertime, reason: e.target.value })}
                                    className={`w-full px-4 py-4 rounded-xl border outline-none transition-all focus:border-green-500 ${isDarkMode ? 'bg-black/20 border-white/5 text-white' : 'bg-gray-50 border-black/5 text-gray-900'}`}
                                />
                            </div>

                            {/* Actions */}
                            <button
                                onClick={handleAddOvertime}
                                disabled={!newOvertime.amount || !newOvertime.reason}
                                className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl text-xs font-bold uppercase tracking-[0.2em] shadow-lg shadow-green-900/20 transition-all active:scale-95 mt-4"
                            >
                                تأكيد تسجيل الأوفر تايم
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ADD DEDUCTION MODAL */}
            {isAddDeductionOpen && (
                <div className="admin-overlay-shell z-[150] backdrop-blur-sm bg-black/60 animate-fade-in" dir="rtl">
                    <div className="absolute inset-0" onClick={() => setIsAddDeductionOpen(false)}></div>
                    <div className={`relative w-full max-w-lg p-8 rounded-3xl shadow-2xl animate-scale-in border ${isDarkMode ? 'bg-[#161616] border-white/10' : 'bg-white border-black/5'}`}>
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-3">
                                <div className="p-3 rounded-full bg-red-500/10 text-red-500">
                                    <ShieldCheck size={24} />
                                </div>
                                <div>
                                    <h3 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>إضافة خصم جديد</h3>
                                    <p className="text-[10px] uppercase font-bold opacity-40 tracking-widest mt-1">تسجيل جزاء أو استقطاع مالي</p>
                                </div>
                            </div>
                            <button onClick={() => setIsAddDeductionOpen(false)} className="opacity-50 hover:opacity-100 transition-opacity">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="space-y-6">
                            {/* Amount Input */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest opacity-60">قيمة الخصم (ج.م)</label>
                                <div className={`flex items-center px-4 py-3 rounded-xl border transition-all focus-within:ring-1 focus-within:ring-red-500 ${isDarkMode ? 'bg-black/20 border-white/5' : 'bg-gray-50 border-black/5'}`}>
                                    <span className="text-red-500 font-bold ml-3">EGP</span>
                                    <input
                                        type="number"
                                        placeholder="0.00"
                                        value={newDeduction.amount}
                                        onChange={(e) => setNewDeduction({ ...newDeduction, amount: e.target.value })}
                                        className="bg-transparent border-none outline-none w-full font-bold text-lg h-full"
                                    />
                                </div>
                            </div>

                            {/* Reason Input */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest opacity-60">سبب الخصم</label>
                                <input
                                    type="text"
                                    placeholder="مثال: تأخير، غياب، تلفيات..."
                                    value={newDeduction.reason}
                                    onChange={(e) => setNewDeduction({ ...newDeduction, reason: e.target.value })}
                                    className={`w-full px-4 py-4 rounded-xl border outline-none transition-all focus:border-red-500 ${isDarkMode ? 'bg-black/20 border-white/5 text-white' : 'bg-gray-50 border-black/5 text-gray-900'}`}
                                />
                            </div>

                            {/* Notes Input (No Date) */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest opacity-60">ملاحظات (اختياري)</label>
                                <textarea
                                    rows={3}
                                    placeholder="تفاصيل إضافية..."
                                    value={newDeduction.notes}
                                    onChange={(e) => setNewDeduction({ ...newDeduction, notes: e.target.value })}
                                    className={`w-full px-4 py-3 rounded-xl border outline-none text-xs font-bold resize-none ${isDarkMode ? 'bg-black/20 border-white/5 text-white' : 'bg-gray-50 border-black/5 text-gray-900'}`}
                                />
                            </div>

                            {/* Actions */}
                            <button
                                onClick={handleAddDeduction}
                                disabled={!newDeduction.amount || !newDeduction.reason}
                                className="w-full bg-[#E53935] hover:bg-[#FF3B30] disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl text-xs font-bold uppercase tracking-[0.2em] shadow-lg shadow-red-900/20 transition-all active:scale-95 mt-4"
                            >
                                تأكيد الخصم
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <>
            {content}

            {showReport && reportData && (
                <EmployeeReport
                    data={reportData}
                    onClose={() => setShowReport(false)}
                />
            )}

            {/* Document Preview Modal */}
            {previewDoc && (
                <div className="admin-overlay-shell z-[9999] animate-fade-in">
                    <div
                        className="absolute inset-0 bg-black/95 backdrop-blur-2xl"
                        onClick={() => setPreviewDoc(null)}
                    ></div>

                    <div className={`admin-overlay-panel relative w-full max-w-5xl rounded-[3rem] shadow-[0_0_100px_rgba(0,0,0,0.5)] animate-zoom-in border ${isDarkMode ? 'bg-[#161616] border-white/10' : 'bg-white border-black/10'}`}>
                        {/* Status Bar */}
                        <div className="absolute top-0 left-0 right-0 h-1.5 bg-[#E53935]/20 overflow-hidden">
                            <div className="h-full bg-[#E53935] w-1/3 animate-loading-strip"></div>
                        </div>

                        {/* Modal Header */}
                        <div className="absolute top-8 left-8 right-8 z-20 flex justify-between items-center pointer-events-none">
                            <div className="bg-black/30 backdrop-blur-md px-6 py-3 rounded-2xl border border-white/10 pointer-events-auto">
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold text-white/40 uppercase tracking-[0.2em] mb-0.5">معاينة المستند</span>
                                    <span className="text-sm font-bold text-white mb-0">{previewDoc.label}</span>
                                </div>
                            </div>

                            <button
                                onClick={() => setPreviewDoc(null)}
                                className="w-14 h-14 rounded-2xl bg-[#E53935] hover:bg-[#FF3B30] text-white flex items-center justify-center transition-all shadow-2xl shadow-red-900/40 active:scale-90 pointer-events-auto"
                            >
                                <X size={24} />
                            </button>
                        </div>

                        {/* Content Area */}
                        <div className="w-full h-[85vh] flex items-center justify-center p-6 sm:p-10 pt-28 bg-transparent overflow-hidden">
                            {isImage(previewDoc.url) ? (
                                <div className="relative group w-full h-full flex flex-col items-center justify-center gap-6">
                                    <div className={`relative p-2 rounded-3xl border ${isDarkMode ? 'bg-white/5 border-white/5' : 'bg-gray-100 border-black/5'} shadow-2xl overflow-hidden`}>
                                        <img
                                            src={previewDoc.url}
                                            className="max-w-full max-h-[60vh] object-contain rounded-2xl shadow-inner cursor-zoom-in"
                                            alt="Document Preview"
                                            onClick={() => window.open(previewDoc.url, '_blank')}
                                        />
                                    </div>
                                    {/* Action Overlays */}
                                    <div className="flex items-center gap-4">
                                        <button
                                            onClick={() => handleDownload(previewDoc.url, `${employeeProfile.name}-${previewDoc.label}`)}
                                            className="bg-white/10 hover:bg-white/20 text-white backdrop-blur-xl px-8 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all border border-white/10 flex items-center gap-3 active:scale-95"
                                        >
                                            <Download size={18} strokeWidth={2.5} /> حفظ في الجهاز
                                        </button>
                                        <button
                                            onClick={() => window.open(previewDoc.url, '_blank')}
                                            className="bg-white/5 hover:bg-white/10 text-white/70 backdrop-blur-xl px-8 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all border border-white/5 flex items-center gap-3 active:scale-95"
                                        >
                                            <Maximize2 size={18} /> الحجم الكامل
                                        </button>
                                    </div>
                                </div>
                            ) : isPDF(previewDoc.url) ? (
                                <div className="w-full h-full flex flex-col gap-6">
                                    <div className="flex-1 w-full bg-black/20 rounded-[2rem] overflow-hidden border border-white/5 shadow-2xl relative">
                                        <object
                                            data={`${previewDoc.url}#toolbar=1&navpanes=0&scrollbar=1`}
                                            type="application/pdf"
                                            className="w-full h-full"
                                        >
                                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-10">
                                                <div className="w-20 h-20 bg-[#E53935]/10 text-[#E53935] rounded-3xl flex items-center justify-center mb-6">
                                                    <FileText size={32} />
                                                </div>
                                                <h4 className="text-xl font-bold text-white mb-2">تعذر عرض الملف تلقائياً</h4>
                                                <p className="text-white/40 text-sm max-w-sm mb-8">متصفحك لا يدعم معاينة ملفات PDF داخل المتصفح، يمكنك فتحه في نافذة مستقلة.</p>
                                                <button
                                                    onClick={() => window.open(previewDoc.url, '_blank')}
                                                    className="bg-[#E53935] text-white px-10 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-2xl shadow-red-900/40"
                                                >
                                                    فتح المستند الآن
                                                </button>
                                            </div>
                                        </object>
                                    </div>

                                    <div className="flex justify-center gap-4">
                                        <button
                                            onClick={() => handleDownload(previewDoc.url, `${employeeProfile.name}-${previewDoc.label}`)}
                                            className="bg-white/10 hover:bg-white/20 text-white backdrop-blur-xl px-10 py-5 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all border border-white/10 flex items-center gap-3"
                                        >
                                            <Download size={20} /> تحميل ملف الـ PDF
                                        </button>
                                        <button
                                            onClick={() => window.open(previewDoc.url, '_blank')}
                                            className="bg-white/5 hover:bg-white/10 text-white/50 backdrop-blur-xl px-6 py-5 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all border border-white/5"
                                        >
                                            فتح في صفحة مستقلة
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center p-12">
                                    <div className="w-24 h-24 bg-[#E53935]/10 text-[#E53935] rounded-[2rem] flex items-center justify-center mx-auto mb-6">
                                        <FileText size={48} />
                                    </div>
                                    <h3 className="text-2xl font-bold text-white mb-3">هذا النوع من الملفات لا يدعم المعاينة الفورية</h3>
                                    <p className="text-white/40 text-sm max-w-md mx-auto leading-relaxed">يرجى تحميل الملف على جهازك لمراجعته بشكل كامل وآمن.</p>
                                    <button
                                        onClick={() => handleDownload(previewDoc.url, `${employeeProfile.name}-${previewDoc.label}`)}
                                        className="mt-10 inline-flex items-center gap-3 bg-[#E53935] text-white px-10 py-5 rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-2xl shadow-red-900/30 transition-all hover:scale-105"
                                    >
                                        <Download size={20} /> تحميل المستند الآن
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* Settlement Studio Overlay */}
            {isSettlementStudioOpen && (
                <SettlementStudio
                    employee={{
                        id: employeeProfile.id,
                        name: employeeProfile.name,
                        role: employeeProfile.role,
                        branch_id: employeeProfile.branch_id,
                        branch_name: employeeProfile.branch_name,
                        avatar_url: employeeProfile.avatar_url,
                        base_salary: employeeProfile.base_salary,
                        wallet_balance: employeeProfile.commission_wallet_balance,
                    }}
                    isDarkMode={isDarkMode}
                    onClose={() => setIsSettlementStudioOpen(false)}
                />
            )}
        </>
    );
};

export default EmployeeDetailsPage;
