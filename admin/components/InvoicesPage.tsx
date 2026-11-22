import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import InvoiceTable, { InvoiceTableStaffEntry } from './InvoiceTable.tsx';
import InvoiceDetailsModal from './InvoiceDetailsModal.tsx';
import InvoiceExportModal from './invoices/InvoiceExportModal.tsx';
import {
  AlertCircle,
  Banknote,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  FileText,
  Filter,
  RefreshCw,
  Search,
  ServerCrash,
  Smartphone,
  TrendingUp,
  X
} from 'lucide-react';
import { Invoice, InvoiceExportErrorResponse, InvoiceExportPaymentMethodFilter, InvoiceExportRequestPayload, InvoiceExportTypeFilter } from '../types';
import adminApi from '../api/client';
import { downloadBlob, getFilenameFromContentDisposition } from '../utils/fileDownload';
import { getTodayISO } from '../utils/dateFormatter';
import { useVisiblePolling } from '../hooks/useVisiblePolling';

interface InvoicesPageProps {
  isDarkMode: boolean;
  selectedBranch: string;
  isSidebarCollapsed: boolean;
}

interface InvoiceFetchOptions {
  page?: number;
  pageCount?: number;
  append?: boolean;
  silent?: boolean;
}

const PAGE_SIZE = 50;
const INVOICE_LIST_POLL_INTERVAL_MS = 10_000;
const EMPTY_INVOICE_SUMMARY = {
  total_sales: 0,
  total_count: 0,
  paid_count: 0,
  pending_count: 0,
};

const parseInvoiceExportErrorMessage = async (error: any): Promise<string> => {
  const responseData = error?.response?.data;
  let payload: InvoiceExportErrorResponse | null = null;

  if (responseData instanceof Blob) {
    try {
      const text = await responseData.text();
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
  } else if (responseData && typeof responseData === 'object') {
    payload = responseData as InvoiceExportErrorResponse;
  }

  const statusCode = error?.response?.status;

  if (statusCode === 403) {
    return 'ليس لديك صلاحية لتصدير هذا النطاق من الفواتير.';
  }

  if (statusCode === 422) {
    if (payload?.matching_rows && payload?.max_rows) {
      return `عدد الفواتير (${payload.matching_rows.toLocaleString('en-US')}) أكبر من الحد المسموح (${payload.max_rows.toLocaleString('en-US')}). اختر فترة أقصر أو استخدم فلاتر إضافية.`;
    }

    return 'عدد الفواتير أكبر من الحد المسموح للتصدير مرة واحدة. اختر فترة زمنية أقصر أو استخدم فلاتر إضافية.';
  }

  if (payload?.error) {
    return payload.error;
  }

  if (payload?.details) {
    return payload.details;
  }

  return error?.message || 'تعذر تصدير الفواتير. حاول مرة أخرى.';
};

const InvoicesPage: React.FC<InvoicesPageProps> = ({ isDarkMode, selectedBranch, isSidebarCollapsed }) => {
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>(getTodayISO());
  const [activeType, setActiveType] = useState<'جميع الفواتير' | 'عادية' | 'بخصم' | 'معلقة'>('جميع الفواتير');
  const [activePayment, setActivePayment] = useState<'' | 'CASH' | 'VISA' | 'VISA_1' | 'VISA_2' | 'INSTAPAY'>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [businessDayFilter, setBusinessDayFilter] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [debouncedBusinessDayFilter, setDebouncedBusinessDayFilter] = useState('');
  // Premium Invoice Workspace Motion Controller
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);
  const [workspaceMotionState, setWorkspaceMotionState] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed');
  const [workspaceOriginY, setWorkspaceOriginY] = useState(35);
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const openRafRef = useRef<number | null>(null);

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportToast, setExportToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportButtonRef = useRef<HTMLButtonElement | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const currentPageRef = useRef(1);
  const isMountedRef = useRef(true);

  // Backend Summary State
  const [backendSummary, setBackendSummary] = useState(EMPTY_INVOICE_SUMMARY);

  // Staff Photo Directory Lookup Map (Loaded once on mount, cached in memory)
  const [staffMap, setStaffMap] = useState<Record<number, InvoiceTableStaffEntry>>({});

  // Data State
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenInvoice = useCallback((invoice: Invoice, event?: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    // Guard against rapid duplicate triggers or interrupting transitions
    if (workspaceMotionState === 'opening' || workspaceMotionState === 'closing') {
      return;
    }

    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    if (openRafRef.current) {
      window.cancelAnimationFrame(openRafRef.current);
      openRafRef.current = null;
    }

    // Capture triggering element for focus restoration
    const target = (event?.currentTarget as HTMLElement) || (document.activeElement as HTMLElement) || null;
    triggerElementRef.current = target;

    // Calculate vertical transform-origin relative to viewport
    let originPercent = 35;
    if (target && typeof target.getBoundingClientRect === 'function') {
      const rect = target.getBoundingClientRect();
      if (rect.height > 0) {
        const centerY = rect.top + rect.height / 2;
        const vh = window.innerHeight || 800;
        originPercent = Math.max(5, Math.min(95, Math.round((centerY / vh) * 100)));
      }
    }
    setWorkspaceOriginY(originPercent);
    setActiveInvoice(invoice);

    const prefersReducedMotion = typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setWorkspaceMotionState('open');
      return;
    }

    // Set initial collapsed frame
    setWorkspaceMotionState('opening');

    // Double-RAF ensures the initial 'opening' styles are committed before transitioning to 'open'
    openRafRef.current = window.requestAnimationFrame(() => {
      openRafRef.current = window.requestAnimationFrame(() => {
        setWorkspaceMotionState('open');
        openRafRef.current = null;
      });
    });
  }, [workspaceMotionState]);

  const handleCloseInvoice = useCallback(() => {
    if (workspaceMotionState === 'closing' || workspaceMotionState === 'closed') {
      return;
    }

    if (openRafRef.current) {
      window.cancelAnimationFrame(openRafRef.current);
      openRafRef.current = null;
    }

    const restoreFocus = () => {
      window.requestAnimationFrame(() => {
        const trigger = triggerElementRef.current;
        if (trigger && typeof trigger.focus === 'function') {
          try {
            if (document.contains(trigger)) {
              trigger.focus({ preventScroll: true });
            }
          } catch {
            // Ignore focus errors
          }
        }
      });
    };

    const prefersReducedMotion = typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setWorkspaceMotionState('closed');
      setActiveInvoice(null);
      restoreFocus();
      return;
    }

    setWorkspaceMotionState('closing');

    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
    }

    // Smooth exit animation duration: 350ms
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = null;
      setWorkspaceMotionState('closed');
      setActiveInvoice(null);
      restoreFocus();
    }, 350);
  }, [workspaceMotionState]);

  // Escape key dismisses the workspace
  useEffect(() => {
    if (workspaceMotionState !== 'open') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseInvoice();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [workspaceMotionState, handleCloseInvoice]);

  // Surgical scroll lock: active while opening, open, or closing
  useEffect(() => {
    const isVisible = workspaceMotionState !== 'closed';
    if (!isVisible) return;

    const scrollY = window.scrollY;
    const { body, documentElement } = document;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverflow = documentElement.style.overflow;

    body.style.overflow = 'hidden';
    documentElement.style.overflow = 'hidden';

    return () => {
      body.style.overflow = prevBodyOverflow;
      documentElement.style.overflow = prevHtmlOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [workspaceMotionState !== 'closed']);

  useEffect(() => {
    let isSubscribed = true;
    adminApi.get('/employees', { params: { include_deleted: 'true' } })
      .then((res) => {
        if (!isSubscribed || !Array.isArray(res.data)) return;
        const map: Record<number, InvoiceTableStaffEntry> = {};
        const baseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:5001').replace(/\/+$/, '');
        for (const emp of res.data) {
          if (!emp || emp.id == null) continue;
          let photoUrl: string | undefined = undefined;
          if (emp.image_url) {
            photoUrl = emp.image_url.startsWith('http')
              ? emp.image_url
              : `${baseUrl}/uploads/${emp.image_url.replace(/\\/g, '/').replace(/^\/+/, '')}`;
          }
          map[emp.id] = {
            photoUrl,
            name: emp.full_name || emp.name || '',
          };
        }
        setStaffMap(map);
      })
      .catch((err) => {
        console.warn('Could not load staff directory for avatars:', err);
      });

    return () => {
      isSubscribed = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedBusinessDayFilter(businessDayFilter);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [businessDayFilter]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      activeRequestRef.current?.abort();
      if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
      if (openRafRef.current) window.cancelAnimationFrame(openRafRef.current);
    };
  }, []);

  const buildInvoiceParams = useCallback((page: number) => ({
    page,
    per_page: PAGE_SIZE,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    branch_id: selectedBranch !== 'All' ? selectedBranch : undefined,
    search: debouncedSearchQuery || undefined,
    business_day_id: debouncedBusinessDayFilter || undefined,
    type: activeType !== 'جميع الفواتير' ? activeType : undefined,
    payment_method: activePayment || undefined,
  }), [
    activePayment,
    activeType,
    dateFrom,
    dateTo,
    debouncedBusinessDayFilter,
    debouncedSearchQuery,
    selectedBranch,
  ]);

  const fetchInvoices = useCallback(async ({
    page = 1,
    pageCount = 1,
    append = false,
    silent = false,
  }: InvoiceFetchOptions = {}) => {
    if (activeRequestRef.current) {
      if (silent) return false;
      activeRequestRef.current.abort();
    }

    const controller = new AbortController();
    activeRequestRef.current = controller;
    if (append) {
      setIsRefreshing(false);
      setIsLoadingMore(true);
    } else if (!silent && !hasLoadedOnceRef.current) {
      setIsLoadingMore(false);
      setIsLoading(true);
    } else if (!silent) {
      setIsLoadingMore(false);
      setIsRefreshing(true);
    }
    if (!silent) setError(null);

    try {
      const requestedPages = append
        ? [page]
        : Array.from({ length: Math.max(1, pageCount) }, (_, index) => index + 1);
      const responses = await Promise.all(requestedPages.map(requestedPage => (
        adminApi.get('/invoices', {
          params: buildInvoiceParams(requestedPage),
          signal: controller.signal,
        })
      )));

      if (!isMountedRef.current || controller.signal.aborted) return false;

      const firstPayload = responses[0]?.data || {};
      const nextInvoices: Invoice[] = responses.flatMap(response => response.data.items || []);
      const seenInvoiceIds = new Set<string | number>();
      const uniqueInvoices = nextInvoices.filter((invoice: Invoice) => {
        if (seenInvoiceIds.has(invoice.id)) return false;
        seenInvoiceIds.add(invoice.id);
        return true;
      });
      setInvoices(previousInvoices => {
        if (!append) return uniqueInvoices;
        const existingIds = new Set(previousInvoices.map(invoice => invoice.id));
        return [
          ...previousInvoices,
          ...uniqueInvoices.filter(invoice => !existingIds.has(invoice.id)),
        ];
      });
      setBackendSummary(firstPayload.summary || EMPTY_INVOICE_SUMMARY);
      const nextTotalPages = Math.max(1, firstPayload.pages || 1);
      const nextCurrentPage = append
        ? (firstPayload.current_page || page)
        : Math.min(Math.max(1, pageCount), nextTotalPages);
      setTotalPages(nextTotalPages);
      setCurrentPage(nextCurrentPage);
      currentPageRef.current = nextCurrentPage;
      hasLoadedOnceRef.current = true;
      setError(null);
      return true;
    } catch (err: any) {
      if (controller.signal.aborted) return false;
      if (!silent) console.error('Failed to fetch invoices:', err);
      if (!silent && !hasLoadedOnceRef.current) {
        setError(err.response?.status === 404
          ? 'Backend Endpoint Missing: GET /api/admin/invoices'
          : err.message || 'Failed to load invoices');
        setInvoices([]);
      }
      return false;
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        if (isMountedRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
          setIsLoadingMore(false);
        }
      }
    }
  }, [buildInvoiceParams]);

  useEffect(() => {
    void fetchInvoices({ pageCount: 1 });
  }, [fetchInvoices]);

  const pollInvoices = useCallback(() => fetchInvoices({
    pageCount: currentPageRef.current,
    silent: true,
  }).then(() => undefined), [fetchInvoices]);

  useVisiblePolling(pollInvoices, INVOICE_LIST_POLL_INTERVAL_MS);

  useEffect(() => {
    if (!exportToast) {
      return;
    }

    const timeout = window.setTimeout(() => setExportToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [exportToast]);

  const filteredInvoices = useMemo(() => {
    return invoices;
  }, [invoices]);

  // Verified Financial Summary Metrics
  const summary = useMemo(() => {
    return {
      totalCount: backendSummary.total_count,
      totalSales: backendSummary.total_sales,
      pendingCount: backendSummary.pending_count,
    };
  }, [backendSummary]);

  // Average Ticket Value (Accurately calculated from totalSales / totalCount)
  const averageTicket = useMemo(() => {
    if (!summary.totalCount || summary.totalCount <= 0) return 0;
    return Math.round(summary.totalSales / summary.totalCount);
  }, [summary.totalCount, summary.totalSales]);

  const handleCloseExportModal = () => {
    setIsExportModalOpen(false);
    setExportError(null);

    window.requestAnimationFrame(() => {
      exportButtonRef.current?.focus();
    });
  };

  const handleExport = async (payload: InvoiceExportRequestPayload) => {
    if (isExporting) {
      return;
    }

    setIsExporting(true);
    setExportError(null);
    try {
      const response = await adminApi.post('/invoices/export', payload, {
        responseType: 'blob',
      });

      const filename = getFilenameFromContentDisposition(response.headers['content-disposition']) || `Invoices_${getTodayISO()}.xlsx`;
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data]);

      downloadBlob(blob, filename);
      setIsExportModalOpen(false);
      setExportToast({ type: 'success', message: 'تم تجهيز ملف الفواتير وبدأ تنزيله بنجاح.' });
    } catch (err: any) {
      console.error('Failed to export invoices:', err);
      setExportError(await parseInvoiceExportErrorMessage(err));
    } finally {
      setIsExporting(false);
    }
  };

  const handleLoadMore = () => {
    if (isLoadingMore || currentPage >= totalPages) {
      return;
    }

    void fetchInvoices({ page: currentPage + 1, append: true });
  };

  const handleManualRefresh = () => {
    void fetchInvoices({ pageCount: currentPageRef.current });
  };

  const hasActiveFilters = Boolean(
    searchQuery || businessDayFilter || activeType !== 'جميع الفواتير' || activePayment || dateFrom || dateTo !== getTodayISO()
  );

  const handleResetFilters = () => {
    setSearchQuery('');
    setBusinessDayFilter('');
    setActiveType('جميع الفواتير');
    setActivePayment('');
    setDateFrom('');
    setDateTo(getTodayISO());
  };

  // --------------------------------------------------------------------------
  // ERROR STATE
  // --------------------------------------------------------------------------
  if (error) {
    return (
      <div className="admin-page-shell animate-fade-in-up">
        <div className={`p-8 sm:p-12 rounded-3xl border-2 border-dashed flex flex-col items-center justify-center text-center gap-6 ${isDarkMode ? 'border-red-500/20 bg-red-500/5' : 'border-red-500/20 bg-red-50'
          }`}>
          <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center">
            <ServerCrash size={28} />
          </div>
          <div className="max-w-md">
            <h2 className={`text-xl font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              تعذر الاتصال بمركز البيانات المالية
            </h2>
            <p className={`font-mono text-xs opacity-70 mb-6 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {error}
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => void fetchInvoices({ pageCount: 1 })}
                className="px-6 py-2.5 rounded-xl bg-[#E53935] text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 hover:bg-[#FF3B30] transition-colors"
              >
                <RefreshCw size={14} />
                إعادة المحاولة
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // INITIAL LOADING STATE
  // --------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="admin-page-shell admin-page-state flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 opacity-60">
          <RefreshCw size={28} className="animate-spin text-[#E53935]" />
          <span className="text-xs font-bold font-mono tracking-widest uppercase">
            جاري مزامنة السجلات المالية...
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="admin-page-shell xl:max-w-[1400px] 2xl:max-w-[1536px] space-y-6 animate-fade-in-up">

        {/* 1) EXECUTIVE PAGE HEADER */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-white/[0.06]">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className={`text-xl sm:text-2xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                إدارة العمليات المالية
              </h1>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                مباشر
              </span>
            </div>
            <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              سجل التدقيق والمبيعات المباشرة لكافة الفروع ومراجعة المسودات
            </p>
          </div>

          {/* Header Action Cluster: Refresh & Export */}
          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing || isLoadingMore}
              title="تحديث البيانات لحظياً"
              aria-label="تحديث البيانات لحظياً"
              className={`h-10 px-3.5 rounded-xl border flex items-center gap-2 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
                  ? 'bg-[#161616] border-white/10 text-gray-200 hover:bg-white/5 hover:border-white/20'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm'
                }`}
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-[#E53935]' : ''} />
              <span className="hidden xs:inline">تحديث</span>
            </button>

            <button
              ref={exportButtonRef}
              type="button"
              onClick={() => {
                setExportError(null);
                setIsExportModalOpen(true);
              }}
              disabled={isExporting}
              className={`h-10 px-4 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed ${isDarkMode
                  ? 'bg-[#181818] border-[#E6D690]/30 text-[#E6D690] hover:bg-[#E6D690]/10 hover:border-[#E6D690]/50'
                  : 'bg-gray-900 border-gray-900 text-white hover:bg-black shadow-sm'
                }`}
            >
              <Download size={14} className={isExporting ? 'animate-pulse' : ''} />
              <span>{isExporting ? 'جارٍ التصدير...' : 'تصدير إكسل'}</span>
            </button>
          </div>
        </header>

        {/* 2) COMPACT EXECUTIVE FINANCIAL KPI STRIP (4 Accurate Cards) */}
        <section aria-label="مؤشرات الأداء المالي" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* KPI 1: Net Total Sales */}
          <div className={`p-4 sm:p-5 rounded-2xl border transition-all hover:border-white/15 flex flex-col justify-between ${isDarkMode ? 'bg-[#131313] border-white/5 shadow-lg' : 'bg-white border-black/5 shadow-sm'
            }`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                إجمالي المبيعات
              </span>
              <div className="w-8 h-8 rounded-xl bg-[#E6D690]/10 border border-[#E6D690]/20 flex items-center justify-center text-[#E6D690]">
                <CreditCard size={15} />
              </div>
            </div>
            <div className="space-y-1">
              <span className={`text-xl sm:text-2xl font-bold font-mono tracking-tight block ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>
                {summary.totalSales.toLocaleString()} <span className="text-xs font-normal text-gray-400">ج.م</span>
              </span>
              <span className="text-[10px] text-gray-500 block">
                الصافي الفعلي بعد الخصومات
              </span>
            </div>
          </div>

          {/* KPI 2: Paid Invoices */}
          <div className={`p-4 sm:p-5 rounded-2xl border transition-all hover:border-white/15 flex flex-col justify-between ${isDarkMode ? 'bg-[#131313] border-white/5 shadow-lg' : 'bg-white border-black/5 shadow-sm'
            }`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                الفواتير المدفوعة
              </span>
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <CheckCircle2 size={15} />
              </div>
            </div>
            <div className="space-y-1">
              <span className={`text-xl sm:text-2xl font-bold font-mono tracking-tight block ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>
                {summary.totalCount.toLocaleString()}
              </span>
              <span className="text-[10px] text-gray-500 block">
                معاملة ناجحة ومحصلة
              </span>
            </div>
          </div>

          {/* KPI 3: Average Ticket (Calculated) */}
          <div className={`p-4 sm:p-5 rounded-2xl border transition-all hover:border-white/15 flex flex-col justify-between ${isDarkMode ? 'bg-[#131313] border-white/5 shadow-lg' : 'bg-white border-black/5 shadow-sm'
            }`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                متوسط الفاتورة
              </span>
              <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <TrendingUp size={15} />
              </div>
            </div>
            <div className="space-y-1">
              <span className={`text-xl sm:text-2xl font-bold font-mono tracking-tight block ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>
                {averageTicket.toLocaleString()} <span className="text-xs font-normal text-gray-400">ج.م</span>
              </span>
              <span className="text-[10px] text-gray-500 block">
                معدل الصرف لكل عميل
              </span>
            </div>
          </div>

          {/* KPI 4: Pending / Drafts */}
          <div className={`p-4 sm:p-5 rounded-2xl border transition-all hover:border-white/15 flex flex-col justify-between ${isDarkMode ? 'bg-[#131313] border-white/5 shadow-lg' : 'bg-white border-black/5 shadow-sm'
            }`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                مسودات ومعلقة
              </span>
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <Clock size={15} />
              </div>
            </div>
            <div className="space-y-1">
              <span className={`text-xl sm:text-2xl font-bold font-mono tracking-tight block ${summary.pendingCount > 0 ? 'text-amber-400' : isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>
                {summary.pendingCount.toLocaleString()}
              </span>
              <span className="text-[10px] text-gray-500 block">
                بانتظار التحصيل أو الإغلاق
              </span>
            </div>
          </div>
        </section>

        {/* 3) UNIFIED COMMAND & FILTER TOOLBAR */}
        <section aria-label="أدوات التصفية والبحث" className={`p-3.5 sm:p-4 rounded-2xl border transition-all ${isDarkMode ? 'bg-[#131313] border-white/5 shadow-xl' : 'bg-white border-black/5 shadow-sm'
          }`}>
          <div className="space-y-3">
            {/* Row 1: Search + Daily # Filter + Date Range */}
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2.5">
              {/* Search Input */}
              <div className="relative flex-1 group">
                <Search
                  size={16}
                  className={`absolute right-3.5 top-1/2 -translate-y-1/2 transition-colors pointer-events-none ${isDarkMode ? 'text-gray-500 group-focus-within:text-[#E53935]' : 'text-gray-400 group-focus-within:text-[#E53935]'
                    }`}
                />
                <input
                  type="text"
                  placeholder="البحث برقم الفاتورة أو اسم العميل..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`w-full h-10 pr-10 pl-9 rounded-xl border text-xs font-semibold outline-none transition-all ${isDarkMode
                      ? 'bg-black/30 border-white/10 text-white placeholder-gray-500 focus:border-[#E53935]/50 focus:ring-1 focus:ring-[#E53935]/50'
                      : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-[#E53935]/50 focus:bg-white focus:ring-1 focus:ring-[#E53935]/50'
                    }`}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="مسح البحث"
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5 rounded transition-colors"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Business Day # Filter */}
              <div className="relative w-full lg:w-44 group">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="رقم اليومية (#)..."
                  value={businessDayFilter}
                  onChange={(e) => setBusinessDayFilter(e.target.value.replace(/\D/g, ''))}
                  className={`w-full h-10 px-3 pl-8 rounded-xl border text-xs font-mono font-semibold outline-none transition-all ${isDarkMode
                      ? 'bg-black/30 border-white/10 text-white placeholder-gray-500 focus:border-[#E53935]/50 focus:ring-1 focus:ring-[#E53935]/50'
                      : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-[#E53935]/50 focus:bg-white focus:ring-1 focus:ring-[#E53935]/50'
                    }`}
                />
                {businessDayFilter && (
                  <button
                    type="button"
                    onClick={() => setBusinessDayFilter('')}
                    aria-label="مسح فلتر اليومية"
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5 rounded transition-colors"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Date Range Inputs */}
              <div className="flex items-center gap-1.5 w-full lg:w-auto">
                <div className="relative flex-1 lg:flex-none">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                    className={`w-full lg:w-36 h-10 pl-3 pr-8 rounded-xl border outline-none text-xs font-semibold font-mono transition-all ${isDarkMode
                        ? 'bg-black/30 border-white/10 text-white focus:border-[#E53935]/50'
                        : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/50'
                      }`}
                  />
                  <Calendar size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500" />
                </div>

                <span className="text-[11px] font-bold text-gray-500 px-0.5">إلى</span>

                <div className="relative flex-1 lg:flex-none">
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                    className={`w-full lg:w-36 h-10 pl-3 pr-8 rounded-xl border outline-none text-xs font-semibold font-mono transition-all ${isDarkMode
                        ? 'bg-black/30 border-white/10 text-white focus:border-[#E53935]/50'
                        : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/50'
                      }`}
                  />
                  <Calendar size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500" />
                </div>

                {(dateFrom || dateTo !== getTodayISO()) && (
                  <button
                    type="button"
                    onClick={() => {
                      setDateFrom('');
                      setDateTo(getTodayISO());
                    }}
                    title="استعادة تاريخ اليوم"
                    aria-label="استعادة تاريخ اليوم"
                    className={`h-10 w-10 flex items-center justify-center rounded-xl border transition-colors shrink-0 ${isDarkMode
                        ? 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:bg-white/10'
                        : 'bg-gray-100 border-gray-200 text-gray-600 hover:text-gray-900'
                      }`}
                  >
                    <RefreshCw size={13} />
                  </button>
                )}
              </div>
            </div>

            {/* Row 2: Type Filters & Payment Method Segmented Controls */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2.5 border-t border-white/[0.05]">
              {/* Invoice Type Pills */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-hide">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider ml-1 hidden md:inline">
                  النوع:
                </span>
                {(['جميع الفواتير', 'عادية', 'بخصم', 'معلقة'] as const).map((type) => {
                  const isActive = activeType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setActiveType(type)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${isActive
                          ? isDarkMode
                            ? 'bg-[#E53935] text-white shadow-sm'
                            : 'bg-gray-900 text-white shadow-sm'
                          : isDarkMode
                            ? 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                    >
                      {type}
                    </button>
                  );
                })}
              </div>

              {/* Payment Method Pills */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-hide">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider ml-1 hidden md:inline">
                  الدفع:
                </span>
                <button
                  type="button"
                  onClick={() => setActivePayment('')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${!activePayment
                      ? isDarkMode
                        ? 'bg-white/10 text-white font-black'
                        : 'bg-gray-200 text-gray-900 font-black'
                      : isDarkMode
                        ? 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  الكل
                </button>

                <button
                  type="button"
                  onClick={() => setActivePayment('CASH')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${activePayment === 'CASH'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : isDarkMode
                        ? 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  <Banknote size={12} />
                  كاش
                </button>

                <button
                  type="button"
                  onClick={() => setActivePayment('VISA')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${activePayment === 'VISA'
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : isDarkMode
                        ? 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  <CreditCard size={12} />
                  فيزا (الكل)
                </button>

                <button
                  type="button"
                  onClick={() => setActivePayment('VISA_1')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${activePayment === 'VISA_1'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : isDarkMode
                        ? 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  <CreditCard size={12} />
                  فيزا 1
                </button>

                <button
                  type="button"
                  onClick={() => setActivePayment('VISA_2')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${activePayment === 'VISA_2'
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      : isDarkMode
                        ? 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  <CreditCard size={12} />
                  فيزا 2
                </button>

                <button
                  type="button"
                  onClick={() => setActivePayment('INSTAPAY')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${activePayment === 'INSTAPAY'
                      ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                      : isDarkMode
                        ? 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  <Smartphone size={12} />
                  إنستاباي
                </button>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    title="إعادة ضبط الفلاتر"
                    className={`mr-2 px-2 py-1 rounded-md text-[10px] font-bold transition-colors ${isDarkMode
                        ? 'text-[#E53935] hover:bg-red-500/10'
                        : 'text-[#E53935] hover:bg-red-50'
                      }`}
                  >
                    إعادة ضبط
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 4) MAIN INVOICE LEDGER TABLE */}
        {filteredInvoices.length > 0 ? (
          <div className="space-y-4">
            <InvoiceTable
              invoices={filteredInvoices}
              isDarkMode={isDarkMode}
              onRowClick={handleOpenInvoice}
              staffMap={staffMap}
            />

            {/* Modernized Load More Pagination Footer */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-gray-500">
              <span className="font-mono">
                عرض <strong className="text-gray-300">{filteredInvoices.length}</strong> من إجمالي{' '}
                <strong className="text-gray-300">{summary.totalCount || filteredInvoices.length}</strong> فاتورة
                {totalPages > 1 && ` • صفحة ${currentPage} من ${totalPages}`}
              </span>

              {currentPage < totalPages && (
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className={`min-w-[190px] h-10 px-5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed ${isDarkMode
                      ? 'bg-[#161616] border-white/10 text-white hover:bg-white/5 hover:border-white/20 shadow-md'
                      : 'bg-white border-gray-200 text-gray-900 hover:bg-gray-50 shadow-sm'
                    }`}
                >
                  {isLoadingMore ? (
                    <>
                      <RefreshCw size={13} className="animate-spin text-[#E53935]" />
                      <span>جاري تحميل المزيد...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw size={13} />
                      <span>تحميل المزيد ({currentPage}/{totalPages})</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className={`py-24 text-center rounded-3xl border transition-all ${isDarkMode ? 'bg-[#131313] border-white/5' : 'bg-white border-black/5 shadow-sm'
            }`}>
            <div className="w-14 h-14 rounded-2xl bg-white/5 text-gray-500 mx-auto flex items-center justify-center mb-3">
              <FileText size={28} className="opacity-40" />
            </div>
            <h3 className={`text-base font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              لا توجد فواتير مطابقة
            </h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              لم نتمكن من العثور على أي فواتير تطابق شروط البحث أو الفلاتر المحددة حالياً.
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="mt-4 px-4 py-2 rounded-xl text-xs font-bold bg-[#E53935]/10 text-[#E53935] hover:bg-[#E53935]/20 border border-[#E53935]/30 transition-all"
              >
                مسح كافة الفلاتر
              </button>
            )}
          </div>
        )}

        {/* Footer Branding */}
        <footer className="pt-8 text-center opacity-30">
          <p className={`text-[10px] font-bold font-mono uppercase tracking-[0.4em] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            The Secret Men Club • Financial Audit Workspace
          </p>
        </footer>
      </div>

      {/* 5) FULL SCREEN INVOICE DETAILS WORKSPACE OVERLAY */}
      {workspaceMotionState !== 'closed' && activeInvoice && (
        <div
          id="invoice-workspace-portal"
          role="dialog"
          aria-modal="true"
          aria-label={`تفاصيل الفاتورة #${activeInvoice.number || ''}`}
          style={{
            transition: workspaceMotionState === 'closing'
              ? 'opacity 350ms cubic-bezier(0.32, 0, 0.67, 0), transform 350ms cubic-bezier(0.32, 0, 0.67, 0), right 240ms cubic-bezier(0.4, 0.0, 0.2, 1)'
              : 'opacity 450ms cubic-bezier(0.16, 1, 0.3, 1), transform 450ms cubic-bezier(0.16, 1, 0.3, 1), right 240ms cubic-bezier(0.4, 0.0, 0.2, 1)',
            willChange: workspaceMotionState === 'open' ? 'auto' : 'transform, opacity',
          }}
          className={`fixed inset-[var(--app-header-height)_0_0_0] z-[100] lg:right-[var(--app-sidebar-offset)] overflow-hidden motion-reduce:transition-none ${workspaceMotionState === 'open'
              ? 'opacity-100 translate-x-0'
              : workspaceMotionState === 'closing'
                ? 'opacity-0 translate-x-[60px] pointer-events-none'
                : 'opacity-0 translate-x-[60px]'
            } ${isDarkMode ? 'bg-[#0B0B0B]' : 'bg-[#F7F7F7]'}`}
          dir="rtl"
        >
          <InvoiceDetailsModal
            invoice={activeInvoice}
            isDarkMode={isDarkMode}
            onClose={handleCloseInvoice}
            viewMode="full"
            staffMap={staffMap}
          />
        </div>
      )}

      {/* 6) EXPORT MODAL */}
      <InvoiceExportModal
        isOpen={isExportModalOpen}
        isDarkMode={isDarkMode}
        selectedBranch={selectedBranch}
        initialDateFrom={dateFrom}
        initialDateTo={dateTo}
        initialSearch={searchQuery}
        initialBusinessDayId={businessDayFilter}
        initialType={activeType as InvoiceExportTypeFilter}
        initialPaymentMethod={activePayment as '' | InvoiceExportPaymentMethodFilter}
        isSubmitting={isExporting}
        submitError={exportError}
        onClose={handleCloseExportModal}
        onSubmit={handleExport}
      />

      {/* 7) EXPORT TOAST */}
      {exportToast && (
        <div className="fixed bottom-8 left-8 z-[160] animate-toast-in">
          <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-xs font-bold shadow-2xl ${exportToast.type === 'success'
              ? isDarkMode
                ? 'border-emerald-500/25 bg-[#101917] text-emerald-300'
                : 'border-emerald-100 bg-white text-emerald-700'
              : isDarkMode
                ? 'border-red-500/25 bg-[#1A1111] text-red-300'
                : 'border-red-100 bg-white text-red-600'
            }`}>
            {exportToast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{exportToast.message}</span>
          </div>
        </div>
      )}
    </>
  );
};

export default InvoicesPage;
