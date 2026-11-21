import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle,
  ClipboardList,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Store,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import { AdminReturnRequest, AdminReturnRequestListResponse, AdminReturnRequestStatus } from '../../types';
import DirectSupplierReturnModal from './DirectSupplierReturnModal.tsx';
import { adminFetch } from '../../api/adminFetch';
import { buildSupplyWorkspaceQueryParams } from './supplyWorkspaceFilters.ts';
import { SupplyWorkspaceState } from './supplyWorkspaceTypes.ts';
import ReturnCostSummary from './ReturnCostSummary';
import SupplierReturnCosts from './SupplierReturnCosts';

interface ReturnsTabProps {
  filters: SupplyWorkspaceState;
  isDarkMode: boolean;
  onPendingCountChange?: (count: number) => void;
  onResolved?: () => void;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';

const STATUS_FILTERS: Array<{ value: 'ALL' | AdminReturnRequestStatus; label: string }> = [
  { value: 'ALL', label: 'الكل' },
  { value: 'PENDING', label: 'قيد المراجعة' },
  { value: 'RETURNED_TO_MAIN', label: 'بالمخزن' },
  { value: 'RETURNED_TO_SUPPLIER', label: 'بالمورد' },
  { value: 'REJECTED', label: 'مرفوض' },
];

const statusMeta: Record<AdminReturnRequestStatus, { label: string; className: string; icon: React.ReactNode }> = {
  PENDING: {
    label: 'قيد المراجعة',
    className: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
    icon: <RotateCcw size={12} className="text-amber-300" />,
  },
  RETURNED_TO_MAIN: {
    label: 'بالمخزن',
    className: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
    icon: <Truck size={12} className="text-emerald-300" />,
  },
  RETURNED_TO_SUPPLIER: {
    label: 'بالمورد',
    className: 'bg-sky-500/10 border-sky-500/20 text-sky-300',
    icon: <Store size={12} className="text-sky-300" />,
  },
  REJECTED: {
    label: 'مرفوض',
    className: 'bg-red-500/10 border-red-500/20 text-red-300',
    icon: <XCircle size={12} className="text-red-300" />,
  },
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const ReturnsTab: React.FC<ReturnsTabProps> = ({ filters, isDarkMode, onPendingCountChange, onResolved }) => {
  const [requests, setRequests] = useState<AdminReturnRequest[]>([]);
  const [counts, setCounts] = useState<AdminReturnRequestListResponse['counts']>({
    all: 0,
    pending: 0,
    returned_to_main: 0,
    returned_to_supplier: 0,
    rejected: 0,
  });
  const [pagination, setPagination] = useState<AdminReturnRequestListResponse['pagination']>({
    page: 1,
    per_page: 12,
    total: 0,
    pages: 0,
    has_next: false,
    has_prev: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<'ALL' | AdminReturnRequestStatus>('PENDING');
  const [searchQuery, setSearchQuery] = useState('');
  const [draftSearch, setDraftSearch] = useState('');
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [requestDetails, setRequestDetails] = useState<AdminReturnRequest | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<null | 'main' | 'supplier' | 'reject'>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isDirectReturnOpen, setIsDirectReturnOpen] = useState(false);
  const [supplierRefresh, setSupplierRefresh] = useState(0);

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToastMessage(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  const loadReturns = useCallback(async (page = 1, q = searchQuery, status = activeFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = buildSupplyWorkspaceQueryParams(filters);
      params.set('page', String(page));
      params.set('per_page', '12');
      params.set('status', status);
      if (q.trim()) {
        params.set('q', q.trim());
      }

      const response = await adminFetch(`${API_BASE}/api/admin/returns?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
        },
      });
      const data: AdminReturnRequestListResponse | { error?: string } = await response.json();
      if (!response.ok) {
        throw new Error((data as { error?: string }).error || 'تعذر تحميل طلبات المرتجع.');
      }
      if (!('requests' in data)) throw new Error('استجابة طلبات المرتجع غير مكتملة.');

      setRequests(Array.isArray(data.requests) ? data.requests : []);
      setCounts(data.counts);
      setPagination(data.pagination);
      setSupplierRefresh((value) => value + 1);
      onPendingCountChange?.(data.counts.pending);
    } catch (err: any) {
      setError(err.message || 'تعذر تحميل طلبات المرتجع.');
    } finally {
      setLoading(false);
    }
  }, [activeFilter, filters, onPendingCountChange, searchQuery]);

  const loadRequestDetails = async (requestId: number) => {
    setSelectedRequestId(requestId);
    setDetailsLoading(true);
    try {
      const response = await adminFetch(`${API_BASE}/api/admin/returns/${requestId}`, {
        headers: {
          Accept: 'application/json',
        },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'تعذر تحميل تفاصيل المرتجع.');
      }
      setRequestDetails(data);
      setResolutionNote(data.resolution_note || '');
    } catch (err: any) {
      setRequestDetails(null);
      setError(err.message || 'تعذر تحميل تفاصيل المرتجع.');
    } finally {
      setDetailsLoading(false);
    }
  };

  const workspaceFilterSignature = useMemo(() => buildSupplyWorkspaceQueryParams(filters).toString(), [filters]);
  const supplierFilterSignature = useMemo(() => {
    const params = new URLSearchParams(workspaceFilterSignature);
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    return params.toString();
  }, [workspaceFilterSignature, searchQuery]);

  useEffect(() => {
    loadReturns(1, searchQuery, activeFilter);
  }, [activeFilter, loadReturns, searchQuery, workspaceFilterSignature]);

  const summaryCards = useMemo(
    () => [
      { label: 'قيد المراجعة', value: counts.pending, className: 'text-amber-300' },
      { label: 'بالمخزن', value: counts.returned_to_main, className: 'text-emerald-300' },
      { label: 'بالمورد', value: counts.returned_to_supplier, className: 'text-sky-300' },
      { label: 'مرفوض', value: counts.rejected, className: 'text-red-300' },
    ],
    [counts],
  );

  const handleResolve = async (
    action: 'main' | 'supplier' | 'reject',
    endpoint: string,
    successMessage: string,
  ) => {
    if (!requestDetails) return;

    setActionLoading(action);
    try {
      const response = await adminFetch(`${API_BASE}/api/admin/returns/${requestDetails.id}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          resolution_note: resolutionNote.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || successMessage);
      }

      setToastMessage(data.message || successMessage);
      await loadReturns(pagination.page, searchQuery, activeFilter);
      await loadRequestDetails(requestDetails.id);
      onResolved?.();
    } catch (err: any) {
      setError(err.message || 'تعذر تنفيذ الإجراء على طلب المرتجع.');
    } finally {
      setActionLoading(null);
    }
  };

  const closeDetails = () => {
    setSelectedRequestId(null);
    setRequestDetails(null);
    setResolutionNote('');
  };

  return (
    <div className="space-y-6 text-right">
      {toastMessage && (
        <div className="fixed bottom-8 left-8 z-[150] animate-toast-in">
          <div
            className={`flex items-center gap-2.5 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-md ${
              isDarkMode ? 'border-white/10 bg-[#161618] text-white' : 'border-black/10 bg-white text-gray-900'
            }`}
          >
            <CheckCircle size={15} className="text-[#E6D690]" />
            <span className="text-[11px] font-semibold">{toastMessage}</span>
          </div>
        </div>
      )}

      <div className="rounded-[2rem] border border-white/[0.04] bg-white/[0.015] p-5 shadow-md">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="text-right">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/15 bg-amber-500/10 px-3 py-1 text-[10px] font-bold text-amber-200">
              <RotateCcw size={12} />
              <span>إدارة المرتجعات</span>
            </div>
            <h3 className="mt-3 text-xl font-black text-white">المرتجعات</h3>
            <p className="mt-1 text-[11px] font-medium text-white/40">
              مراجعة الطلبات الواردة من الفروع واعتماد القرار المناسب
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setIsDirectReturnOpen(true)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-sky-400/20 bg-sky-500/90 px-5 text-xs font-bold text-white transition-colors hover:bg-sky-500"
              >
                <Store size={14} />
                <span>مرتجع للمورد</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {summaryCards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-2xl border border-white/[0.04] bg-white/[0.02] px-4 py-3.5"
                >
                  <p className="text-[10px] font-semibold text-white/40">{card.label}</p>
                  <p className={`mt-2 text-2xl font-black ${card.className}`}>{card.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[2rem] border border-white/[0.04] bg-white/[0.015] p-5 shadow-md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setActiveFilter(filter.value)}
                className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
                  activeFilter === filter.value
                    ? 'border border-[#E6D690]/20 bg-[#E6D690]/10 text-[#F6E8AC]'
                    : 'border border-transparent bg-white/[0.01] text-white/50 hover:bg-white/5 hover:text-white'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-72">
              <Search size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/25" />
              <input
                value={draftSearch}
                onChange={(event) => setDraftSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setSearchQuery(draftSearch.trim());
                  }
                }}
                placeholder="بحث برقم المرتجع أو اسم المنتج"
                className="h-10 w-full rounded-xl border border-white/[0.06] bg-white/[0.02] pr-9 pl-3 text-xs font-medium text-white outline-none focus:border-[#E6D690]/30"
              />
            </div>

            <button
              type="button"
              onClick={() => setSearchQuery(draftSearch.trim())}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-[#E6D690] px-4 text-xs font-bold text-[#121212]"
            >
              بحث
            </button>

            <button
              type="button"
              onClick={() => loadReturns(pagination.page, searchQuery, activeFilter)}
              disabled={loading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 text-xs font-semibold text-white/80"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <span>تحديث</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/10 bg-red-500/5 px-4 py-3 text-sm font-semibold text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24">
          <Loader2 size={28} className="animate-spin text-[#E6D690]" />
          <p className="text-xs font-semibold text-white/40">جارٍ تحميل طلبات المرتجع...</p>
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] py-16 text-center">
          <ClipboardList size={28} className="mx-auto mb-3 text-white/20" />
          <p className="text-sm font-bold text-white/55">لا توجد طلبات مرتجع مطابقة</p>
          <p className="mt-1 text-[10px] text-white/30">ستظهر هنا الطلبات المرسلة من الفروع للمراجعة والاعتماد.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {requests.map((request) => (
              <div
                key={request.id}
                className="rounded-[1.8rem] border border-white/[0.04] bg-white/[0.015] p-5 shadow-md transition-all duration-300 hover:border-white/[0.08] hover:bg-white/[0.025]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusMeta[request.status].className}`}>
                    {statusMeta[request.status].icon}
                    <span>{statusMeta[request.status].label}</span>
                  </span>

                  <div className="text-right">
                    <span className="block font-mono text-xs font-black text-white/35">{request.return_ref}</span>
                    <span className="mt-1.5 block text-sm font-bold text-white">{request.branch_name}</span>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <p className="text-sm font-black text-white">{request.product_name}</p>
                  <p className="text-[11px] font-medium text-white/45">
                    {request.requested_quantity} {request.product_unit} • {request.reason_label}
                  </p>
                  <p className="text-[11px] font-medium text-white/35">أُنشئ في {formatDate(request.created_at)}</p>
                </div>

                {request.notes && (
                  <div className="mt-4 rounded-2xl border border-white/[0.03] bg-white/[0.02] p-3.5 text-[11px] text-white/60">
                    <span className="mb-1 block text-white/30">ملاحظة الفرع</span>
                    <p className="line-clamp-2">{request.notes}</p>
                  </div>
                )}

                <div className="mt-3"><ReturnCostSummary valuation={request.cost_valuation} isDarkMode={isDarkMode} compact /></div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
                  <div className="rounded-2xl border border-white/[0.03] bg-white/[0.02] p-3">
                    <span className="block text-white/30">رصيد الطلب</span>
                    <span className="mt-1 block font-bold text-white">{request.branch_stock_snapshot}</span>
                  </div>
                  <div className="rounded-2xl border border-white/[0.03] bg-white/[0.02] p-3">
                    <span className="block text-white/30">المنشئ</span>
                    <span className="mt-1 block font-bold text-white">{request.created_by_employee_name || 'كاشير'}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => loadRequestDetails(request.id)}
                  className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.03] text-xs font-semibold text-white transition-colors hover:bg-white/10"
                >
                  عرض التفاصيل
                </button>
              </div>
            ))}
          </div>

          {pagination.pages > 1 && (
            <div className="flex items-center justify-between rounded-2xl border border-white/[0.04] bg-white/[0.015] px-4 py-3 text-xs">
              <button
                type="button"
                disabled={!pagination.has_prev || loading}
                onClick={() => loadReturns(pagination.page - 1, searchQuery, activeFilter)}
                className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-2 text-white/80 disabled:cursor-not-allowed disabled:opacity-40"
              >
                السابق
              </button>
              <span className="font-semibold text-white/55">
                صفحة {pagination.page} من {Math.max(1, pagination.pages)}
              </span>
              <button
                type="button"
                disabled={!pagination.has_next || loading}
                onClick={() => loadReturns(pagination.page + 1, searchQuery, activeFilter)}
                className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-2 text-white/80 disabled:cursor-not-allowed disabled:opacity-40"
              >
                التالي
              </button>
            </div>
          )}
        </div>
      )}

      {(activeFilter === 'ALL' || activeFilter === 'RETURNED_TO_SUPPLIER') && <SupplierReturnCosts filters={supplierFilterSignature} isDarkMode={isDarkMode} refreshToken={supplierRefresh} />}

      {selectedRequestId !== null && (
        <div className="admin-overlay-shell admin-overlay-shell--with-sidebar z-[140] bg-black/75 backdrop-blur-md">
          <div
            className="admin-overlay-panel w-full max-w-4xl rounded-[2.2rem] border border-white/[0.06] bg-[#0c0c0f] shadow-2xl text-right"
            style={{
              ['--app-dialog-width' as string]: '896px',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 p-6 pb-4 shrink-0">
              <button
                type="button"
                onClick={closeDetails}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 bg-white/[0.01] text-white/50 hover:text-white"
              >
                <X size={15} />
              </button>

              <div>
                <span className="block font-mono text-[10px] font-bold tracking-widest text-[#E6D690]">
                  {requestDetails?.return_ref || 'RETURN'}
                </span>
                <h3 className="mt-1 text-lg font-bold text-white">مراجعة طلب المرتجع</h3>
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="admin-overlay-body p-6 pt-2 overflow-y-auto overscroll-contain text-right">
              {detailsLoading ? (
                <div className="flex flex-col items-center justify-center gap-4 py-16">
                  <Loader2 size={24} className="animate-spin text-[#E6D690]" />
                  <p className="text-xs text-white/40">جارٍ تحميل التفاصيل...</p>
                </div>
              ) : requestDetails ? (
                <div className="space-y-5">
                  <div className="rounded-[1.8rem] border border-white/[0.04] bg-white/[0.02] p-4">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusMeta[requestDetails.status].className}`}>
                        {statusMeta[requestDetails.status].icon}
                        <span>{statusMeta[requestDetails.status].label}</span>
                      </span>
                      <div className="text-right">
                        <p className="text-sm font-black text-white">{requestDetails.product_name}</p>
                        <p className="mt-1 text-[11px] text-white/40">
                          {requestDetails.requested_quantity} {requestDetails.product_unit}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 text-xs">
                      <div className="rounded-2xl border border-white/[0.03] bg-white/[0.02] p-3 text-right">
                        <span className="block text-white/30">الفرع</span>
                        <span className="mt-1 block font-bold text-white">{requestDetails.branch_name}</span>
                      </div>
                      <div className="rounded-2xl border border-white/[0.03] bg-white/[0.02] p-3 text-right">
                        <span className="block text-white/30">الكمية</span>
                        <span className="mt-1 block font-bold text-white">
                          {requestDetails.requested_quantity} {requestDetails.product_unit}
                        </span>
                      </div>
                      <div className="rounded-2xl border border-white/[0.03] bg-white/[0.02] p-3 text-right">
                        <span className="block text-white/30">السبب</span>
                        <span className="mt-1 block font-bold text-white">{requestDetails.reason_label}</span>
                      </div>
                      <div className="rounded-2xl border border-white/[0.03] bg-white/[0.02] p-3 text-right font-mono">
                        <span className="block text-white/30 font-sans">المرجع</span>
                        <span className="mt-1 block font-bold text-white">{requestDetails.return_ref}</span>
                      </div>
                    </div>
                  </div>

                  <ReturnCostSummary valuation={requestDetails.cost_valuation} isDarkMode={isDarkMode} />

                  <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
                    <div className="rounded-2xl border border-white/[0.03] bg-white/[0.02] p-4 text-right">
                      <span className="block text-white/30">رصيد الفرع وقت الطلب</span>
                      <span className="mt-1 block font-bold text-white">{requestDetails.branch_stock_snapshot}</span>
                    </div>
                    <div className="rounded-2xl border border-white/[0.03] bg-white/[0.02] p-4 text-right">
                      <span className="block text-white/30">الرصيد الحالي في الفرع</span>
                      <span className="mt-1 block font-bold text-white">{requestDetails.current_branch_stock ?? '—'}</span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/[0.03] bg-white/[0.02] p-4 text-xs text-right">
                    <span className="block text-white/30">تفاصيل الإنشاء</span>
                    <p className="mt-1 font-semibold text-white/85">
                      {requestDetails.created_by_employee_name || 'كاشير'} • {formatDate(requestDetails.created_at)}
                    </p>
                    {requestDetails.notes && (
                      <p className="mt-2 leading-relaxed text-white/65">{requestDetails.notes}</p>
                    )}
                  </div>

                  {requestDetails.status !== 'PENDING' && (
                    <div className="rounded-2xl border border-white/[0.03] bg-white/[0.02] p-4 text-xs text-right">
                      <span className="block text-white/30">نتيجة المعالجة</span>
                      <p className="mt-1 font-semibold text-white/85">
                        {statusMeta[requestDetails.status].label} • {formatDate(requestDetails.resolved_at)}
                      </p>
                      {requestDetails.resolved_by_user_name && (
                        <p className="mt-1 text-white/55">بواسطة: {requestDetails.resolved_by_user_name}</p>
                      )}
                      {requestDetails.resolution_note && (
                        <p className="mt-2 leading-relaxed text-white/65">{requestDetails.resolution_note}</p>
                      )}
                    </div>
                  )}

                  <div className="text-right">
                    <label className="mb-2 block text-xs font-semibold text-white/45">
                      ملاحظة الإدارة
                    </label>
                    <textarea
                      rows={3}
                      value={resolutionNote}
                      onChange={(event) => setResolutionNote(event.target.value)}
                      disabled={requestDetails.status !== 'PENDING'}
                      placeholder="ملاحظة اختيارية لتوضيح القرار..."
                      className="w-full rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-xs font-medium text-white outline-none resize-none focus:border-[#E6D690]/30 disabled:cursor-not-allowed disabled:opacity-60 text-right"
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {/* Sticky Action Footer */}
            {requestDetails && requestDetails.status === 'PENDING' && !detailsLoading && (
              <div className="border-t border-white/5 p-6 pt-4 shrink-0 grid grid-cols-1 gap-3 lg:grid-cols-3">
                <button
                  type="button"
                  disabled={actionLoading !== null}
                  onClick={() => handleResolve('main', 'return-to-main', 'تمت الموافقة وإرجاعه للمخزن')}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/90 px-4 py-3.5 text-xs font-bold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionLoading === 'main' ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
                  <span>إرجاع للمخزن</span>
                </button>
                <button
                  type="button"
                  disabled={actionLoading !== null}
                  onClick={() => handleResolve('supplier', 'return-to-supplier', 'تمت الموافقة وإرجاعه للمورد')}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-sky-400/20 bg-sky-500/90 px-4 py-3.5 text-xs font-bold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionLoading === 'supplier' ? <Loader2 size={14} className="animate-spin" /> : <Store size={14} />}
                  <span>إرجاع للمورد</span>
                </button>
                <button
                  type="button"
                  disabled={actionLoading !== null}
                  onClick={() => handleResolve('reject', 'reject', 'تم رفض الطلب')}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-400/20 bg-red-500/90 px-4 py-3.5 text-xs font-bold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionLoading === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                  <span>رفض</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <DirectSupplierReturnModal
        isOpen={isDirectReturnOpen}
        onClose={() => setIsDirectReturnOpen(false)}
        onSuccess={(message) => {
          setToastMessage(message);
          onResolved?.();
          loadReturns(pagination.page, searchQuery, activeFilter);
        }}
      />
    </div>
  );
};

export default ReturnsTab;
