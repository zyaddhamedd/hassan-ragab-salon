import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Loader2, RefreshCw, AlertTriangle, CheckCircle, Clock, Eye, Send, Edit, ArrowLeft, X, Truck, Trash2 } from 'lucide-react';
import { AdminSupplyRequest, AdminSupplyRequestListResponse } from '../../types';
import BulkTransferModal from './BulkTransferModal.tsx';
import { adminFetch } from '../../api/adminFetch';
import { buildSupplyWorkspaceFilterSignature, buildSupplyWorkspaceQueryParams } from './supplyWorkspaceFilters.ts';
import { SupplyWorkspaceState } from './supplyWorkspaceTypes.ts';

interface BranchRequestsTabProps {
  filters: SupplyWorkspaceState;
  isDarkMode: boolean;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';
const BRANCH_REQUESTS_PAGE_SIZE = 9;

const BranchRequestsTab: React.FC<BranchRequestsTabProps> = ({ filters, isDarkMode }) => {
  const [requests, setRequests] = useState<AdminSupplyRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'PENDING' | 'SENT' | 'RECEIVED'>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    perPage: BRANCH_REQUESTS_PAGE_SIZE,
    total: 0,
    totalPages: 0,
    hasMore: false,
  });
  
  // Details Modal state
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [requestDetails, setRequestDetails] = useState<any | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  
  // Edit & Send modal context
  const [editRequestContext, setEditRequestContext] = useState<any | null>(null);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminSupplyRequest | null>(null);
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const workspaceFilterSignature = useMemo(() => buildSupplyWorkspaceFilterSignature(filters), [filters]);

  const fetchRequests = useCallback(async (
    statusFilter: 'ALL' | 'PENDING' | 'SENT' | 'RECEIVED' = activeFilter,
    targetPage: number = 1,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const params = buildSupplyWorkspaceQueryParams(filters);
      if (statusFilter !== 'ALL') {
        params.set('status', statusFilter);
      }
      params.set('page', String(targetPage));
      params.set('per_page', String(BRANCH_REQUESTS_PAGE_SIZE));

      const response = await adminFetch(`${API_BASE}/api/admin/supply-requests?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
        },
      });
      const data: AdminSupplyRequestListResponse = await response.json();
      if (!response.ok) {
        throw new Error((data as { error?: string }).error || 'تعذر تحميل طلبات الفروع.');
      }
      setRequests(Array.isArray(data.items) ? data.items : []);
      setCurrentPage(Number(data.page || 1));
      setPagination({
        page: Number(data.page || 1),
        perPage: Number(data.per_page || BRANCH_REQUESTS_PAGE_SIZE),
        total: Number(data.total || 0),
        totalPages: Number(data.total_pages || 0),
        hasMore: Boolean(data.has_more),
      });
    } catch (err: any) {
      setError(err.message || 'تعذر الاتصال بالخادم.');
    } finally {
      setLoading(false);
    }
  }, [activeFilter, filters]);

  const fetchDetails = async (id: number) => {
    setLoadingDetails(true);
    try {
      const response = await adminFetch(`${API_BASE}/api/admin/supply-requests/${id}`, {
        headers: {
          Accept: 'application/json',
        },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'تعذر تحميل تفاصيل الطلب.');
      }
      setRequestDetails(data);
      return data;
    } catch (err: any) {
      alert(err.message || 'خطأ في تحميل البيانات.');
      return null;
    } finally {
      setLoadingDetails(false);
    }
  };

  useEffect(() => {
    void fetchRequests(activeFilter, 1);
  }, [activeFilter, fetchRequests, workspaceFilterSignature]);

  const handleOpenDetails = (id: number) => {
    setSelectedRequestId(id);
    fetchDetails(id);
  };

  const handleCloseDetails = () => {
    setSelectedRequestId(null);
    setRequestDetails(null);
    setDeleteTarget(null);
  };

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleApproveAsIs = async (req: AdminSupplyRequest) => {
    if (!window.confirm(`هل أنت متأكد من الموافقة وإرسال الطلب ${req.request_ref} للفرع ${req.branch_name} كما هو؟`)) {
      return;
    }

    setActionInProgress(true);
    try {
      const response = await adminFetch(`${API_BASE}/api/admin/supply-requests/${req.id}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'تعذر الموافقة على الطلب.');
      }

      triggerToast('تمت الموافقة وإرسال الشحنة بنجاح.');
      void fetchRequests(activeFilter, currentPage);
      handleCloseDetails();
    } catch (err: any) {
      alert(err.message || 'فشلت معالجة الطلب.');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleOpenEditModal = (req: any) => {
    const context = {
      id: req.id,
      requestRef: req.request_ref,
      branchId: req.branch_id,
      note: req.note || '',
      items: req.items.map((item: any) => ({
        product_id: item.product_id,
        requested_quantity: item.requested_quantity,
      })),
    };
    setEditRequestContext(context);
  };

  const handleEditSuccess = (msg: string) => {
    triggerToast(msg);
    void fetchRequests(activeFilter, currentPage);
    handleCloseDetails();
  };

  const openDeleteDialog = (req: AdminSupplyRequest) => {
    setDeleteTarget(req);
  };

  const closeDeleteModal = () => {
    if (deleteInProgress) return;
    setDeleteTarget(null);
  };

  const handleDeleteRequest = async () => {
    if (!deleteTarget || deleteInProgress) {
      return;
    }

    setDeleteInProgress(true);
    try {
      const response = await adminFetch(`${API_BASE}/api/admin/supply-requests/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
        },
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'تعذر حذف الطلب.');
      }

      triggerToast(data.message || 'تم حذف طلب الفرع بنجاح.');
      setDeleteTarget(null);
      handleCloseDetails();
      void fetchRequests(activeFilter, currentPage);
    } catch (err: any) {
      triggerToast(err.message || 'تعذر حذف الطلب.');
      void fetchRequests(activeFilter, currentPage);
    } finally {
      setDeleteInProgress(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Intl.DateTimeFormat('ar-EG', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(dateStr));
    } catch {
      return dateStr;
    }
  };

  const getStatusLabel = (status: string) => {
    if (status === 'PENDING') return 'بانتظار المراجعة';
    if (status === 'SENT') return 'تم الشحن';
    if (status === 'RECEIVED') return 'تم الاستلام';
    return status;
  };

  const getStatusIcon = (status: string) => {
    if (status === 'PENDING') return <Clock size={12} className="text-amber-400" />;
    if (status === 'SENT') return <Send size={12} className="text-blue-400" />;
    return <CheckCircle size={12} className="text-emerald-400" />;
  };

  const getStatusColorClass = (status: string) => {
    if (status === 'PENDING') return 'bg-amber-400/10 border-amber-400/20 text-amber-300';
    if (status === 'SENT') return 'bg-blue-400/10 border-blue-400/20 text-blue-300';
    return 'bg-emerald-400/10 border-emerald-400/20 text-emerald-300';
  };

  return (
    <div className="space-y-6 text-right">
      {toastMessage && (
        <div className="fixed bottom-8 left-8 z-[150] animate-toast-in">
          <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-[#161618] px-4 py-3 shadow-2xl backdrop-blur-md text-white">
            <CheckCircle size={15} className="text-[#E6D690]" />
            <span className="text-[11px] font-semibold">{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Filter and stats row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/[0.04] pb-4">
        <div className="flex flex-wrap gap-2">
          {(['ALL', 'PENDING', 'SENT', 'RECEIVED'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
                activeFilter === filter
                  ? 'bg-white/10 text-white border border-white/10'
                  : 'bg-white/[0.01] text-white/50 border border-transparent hover:text-white hover:bg-white/5'
              }`}
            >
              {filter === 'ALL' && 'الكل'}
              {filter === 'PENDING' && 'معلقة'}
              {filter === 'SENT' && 'تم الشحن'}
              {filter === 'RECEIVED' && 'تم الاستلام'}
            </button>
          ))}
        </div>

        <button
          onClick={() => void fetchRequests(activeFilter, currentPage)}
          disabled={loading}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 text-xs font-semibold text-white/80 hover:text-white transition-all"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          <span>تحديث القائمة</span>
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col py-24 items-center justify-center gap-4">
          <Loader2 size={28} className="animate-spin text-[#E6D690]" />
          <p className="text-xs font-semibold text-white/40">جارٍ تحميل طلبات الفروع...</p>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/10 bg-red-500/5 p-6 text-center">
          <p className="text-sm font-semibold text-red-400">{error}</p>
          <button
            onClick={() => void fetchRequests(activeFilter, currentPage)}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] py-16 text-center">
          <ClipboardList size={28} className="mx-auto text-white/20 mb-3" />
          <p className="text-sm font-bold text-white/55">لا توجد طلبات توريد حالية</p>
          <p className="text-[10px] text-white/30 mt-1">تظهر هنا الطلبات المرسلة من الفروع كاشير Mini.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {requests.map((req) => (
            <div
              key={req.id}
              className="rounded-2xl border border-white/[0.04] bg-white/[0.015] hover:bg-white/[0.025] hover:border-white/[0.08] p-5 flex flex-col justify-between transition-all duration-300 shadow-md"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${getStatusColorClass(req.status)}`}>
                    {getStatusIcon(req.status)}
                    <span>{getStatusLabel(req.status)}</span>
                  </span>
                  <div className="text-right">
                    <span className="text-xs font-black text-white/35 font-mono block leading-none">{req.request_ref}</span>
                    <span className="text-sm font-bold text-white mt-1.5 block">{req.branch_name}</span>
                  </div>
                </div>

                <div className="border-t border-white/[0.03] pt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-white/30 block">المنتجات</span>
                    <span className="font-bold text-white/95 mt-0.5 block">{req.items_count} أصناف</span>
                  </div>
                  <div>
                    <span className="text-white/30 block">إجمالي القطع</span>
                    <span className="font-bold text-white/95 mt-0.5 block">{req.total_requested_quantity} قطعة</span>
                  </div>
                  <div className="col-span-2 mt-1">
                    <span className="text-white/30 block">تاريخ الإنشاء</span>
                    <span className="font-bold text-white/80 mt-0.5 block">{formatDate(req.created_at)}</span>
                  </div>
                </div>

                {req.note && (
                  <div className="rounded-xl bg-white/[0.01] border border-white/[0.02] p-3 text-[11px] text-white/60">
                    <span className="text-white/30 block mb-1">ملاحظة الفرع:</span>
                    <p className="line-clamp-2 truncate">{req.note}</p>
                  </div>
                )}
              </div>

              <div className="mt-5 pt-4 border-t border-white/[0.03] flex flex-col gap-2">
                <button
                  onClick={() => handleOpenDetails(req.id)}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/5 py-2 text-xs font-semibold text-white hover:bg-white/10 transition-colors"
                >
                  <Eye size={13} />
                  <span>عرض وتدقيق الطلب</span>
                </button>

                {req.status === 'PENDING' && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleApproveAsIs(req)}
                      disabled={actionInProgress}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#E6D690] py-2 text-xs font-semibold text-[#121212] hover:bg-[#d9c983] disabled:opacity-50 transition-colors"
                    >
                      <CheckCircle size={13} />
                      <span>موافقة وإرسال</span>
                    </button>
                    <button
                      onClick={() => {
                        // Prefetch detailed items to pass to BulkTransferModal
                        void fetchDetails(req.id).then((fullRequest) => {
                          if (!fullRequest) return;
                          handleOpenEditModal(fullRequest);
                        });
                      }}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.02] py-2 text-xs font-semibold text-white hover:bg-white/5 transition-colors"
                    >
                      <Edit size={13} />
                      <span>تعديل وإرسال</span>
                    </button>
                  </div>
                )}

                {req.status === 'PENDING' && (
                  <button
                    onClick={() => openDeleteDialog(req)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/[0.06] py-2 text-xs font-semibold text-red-300 hover:bg-red-500/[0.12] transition-colors"
                  >
                    <Trash2 size={13} />
                    <span>حذف الطلب</span>
                  </button>
                )}
              </div>
            </div>
            ))}
          </div>

          <div className="flex flex-col items-center gap-4 border-t border-white/[0.04] pt-5">
            <span className="text-[11px] font-medium text-white/35">
              عرض {requests.length} من {pagination.total} طلب
            </span>

            {pagination.totalPages > 1 && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => void fetchRequests(activeFilter, currentPage - 1)}
                  disabled={currentPage <= 1 || loading}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 text-[11px] font-semibold text-white/70 transition-all duration-200 hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  السابق
                </button>
                <span className="text-[11px] font-medium text-white/45">
                  صفحة {currentPage} من {Math.max(1, pagination.totalPages)}
                </span>
                <button
                  onClick={() => void fetchRequests(activeFilter, currentPage + 1)}
                  disabled={!pagination.hasMore || loading}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 text-[11px] font-semibold text-white/70 transition-all duration-200 hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  التالي
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Details & Action Modal */}
      {selectedRequestId && (
        <div className="admin-overlay-shell admin-overlay-shell--with-sidebar z-[140] bg-black/75 backdrop-blur-md">
          <div
            className="admin-overlay-panel w-full max-w-3xl rounded-[2.2rem] border border-white/[0.06] bg-[#0c0c0f] shadow-2xl text-right"
            style={{
              ['--app-dialog-width' as string]: '768px',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 p-6 pb-4 shrink-0">
              <button
                onClick={handleCloseDetails}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 bg-white/[0.01] text-white/50 hover:text-white"
              >
                <X size={15} />
              </button>

              <div>
                <span className="text-[10px] font-bold text-[#E6D690] tracking-widest block font-mono">
                  {requestDetails?.request_ref || 'REQ-ID'}
                </span>
                <h3 className="text-lg font-bold text-white mt-1">تدقيق طلب توريد الفرع</h3>
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="admin-overlay-body p-6 pt-2 overflow-y-auto overscroll-contain text-right">
              {loadingDetails ? (
                <div className="flex flex-col py-16 items-center justify-center gap-4">
                  <Loader2 size={24} className="animate-spin text-[#E6D690]" />
                  <p className="text-xs text-white/40">جارٍ تحميل بنود الطلب...</p>
                </div>
              ) : requestDetails ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div className="rounded-xl bg-white/[0.01] border border-white/[0.02] p-3 text-right">
                      <span className="text-white/30 block mb-1">الفرع طالب التوريد</span>
                      <span className="font-bold text-white">{requestDetails.branch_name}</span>
                    </div>
                    <div className="rounded-xl bg-white/[0.01] border border-white/[0.02] p-3 text-right">
                      <span className="text-white/30 block mb-1">تاريخ الإنشاء</span>
                      <span className="font-bold text-white">{formatDate(requestDetails.created_at)}</span>
                    </div>
                    <div className="rounded-xl bg-white/[0.01] border border-white/[0.02] p-3 text-right">
                      <span className="text-white/30 block mb-1">الوضع الحالي للطلب</span>
                      <span className="font-bold text-white">{getStatusLabel(requestDetails.status)}</span>
                    </div>
                  </div>

                  {requestDetails.note && (
                    <div className="rounded-xl bg-white/[0.01] border border-white/[0.02] p-3 text-xs text-white/80 text-right">
                      <span className="text-white/30 block mb-1">ملاحظة الفرع</span>
                      <p className="leading-relaxed font-semibold">{requestDetails.note}</p>
                    </div>
                  )}

                  {requestDetails.shipment_ref && (
                    <div className="rounded-xl bg-blue-500/[0.03] border border-blue-500/10 p-3 text-xs flex justify-between items-center text-[#90c6ff] text-right">
                      <span>تم شحن هذا الطلب كـ شحنة رقم {requestDetails.shipment_ref} ({requestDetails.shipment_status === 'CANCELLED' ? 'ملغاة' : requestDetails.shipment_status === 'RECEIVED' ? 'تم الاستلام' : 'قيد النقل'})</span>
                      <Truck size={14} />
                    </div>
                  )}

                  <div>
                    <h4 className="text-xs font-bold text-white/40 mb-2 text-right">بنود الطلب وتدقيق مستويات المخزون</h4>
                    <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.005]">
                      <div className="max-h-64 overflow-y-auto">
                        <table className="w-full text-right border-collapse">
                          <thead>
                            <tr className="border-b border-white/5 bg-white/[0.01] text-[10px] text-white/40 font-bold">
                              <th className="py-2.5 px-4 text-right">اسم المنتج</th>
                              <th className="py-2.5 px-4 text-center">الكمية المطلوبة</th>
                              {requestDetails.status !== 'PENDING' && (
                                <th className="py-2.5 px-4 text-center">الكمية المشحونة</th>
                              )}
                              <th className="py-2.5 px-4 text-center">المستودع الرئيسي</th>
                              <th className="py-2.5 px-4 text-center">رصيد الفرع الحالي</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 text-xs">
                            {requestDetails.items.map((item: any) => (
                              <tr key={item.product_id} className="hover:bg-white/[0.01]">
                                <td className="py-3 px-4 font-bold text-white/90 text-right">{item.product_name}</td>
                                <td className="py-3 px-4 text-center font-bold text-white">{item.requested_quantity}</td>
                                {requestDetails.status !== 'PENDING' && (
                                  <td className="py-3 px-4 text-center font-bold text-[#E6D690]">{item.final_quantity !== null ? item.final_quantity : '-'}</td>
                                )}
                                <td className={`py-3 px-4 text-center font-bold ${
                                  item.is_shortage ? 'text-red-400' : 'text-emerald-400'
                                }`}>
                                  {item.main_store_stock}
                                </td>
                                <td className="py-3 px-4 text-center text-white/50">{item.branch_stock}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Sticky Action Footer */}
            {requestDetails && requestDetails.status === 'PENDING' && !loadingDetails && (
              <div className="flex gap-3 justify-end p-6 pt-4 border-t border-white/5 shrink-0">
                <button
                  onClick={() => openDeleteDialog(requestDetails)}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-5 py-2.5 text-xs font-semibold text-red-300 hover:bg-red-500/[0.12] transition-all"
                >
                  <Trash2 size={14} />
                  <span>حذف الطلب</span>
                </button>
                <button
                  onClick={() => handleOpenEditModal(requestDetails)}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-5 py-2.5 text-xs font-semibold text-white hover:bg-white/5 transition-all"
                >
                  <Edit size={14} />
                  <span>تعديل وتخصيص البنود</span>
                </button>
                <button
                  onClick={() => handleApproveAsIs(requestDetails)}
                  disabled={actionInProgress}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#E6D690] px-6 py-2.5 text-xs font-semibold text-[#121212] hover:bg-[#d9c983] disabled:opacity-50 transition-all"
                >
                  <CheckCircle size={14} />
                  <span>موافقة وإرسال كما هو</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="admin-overlay-shell admin-overlay-shell--with-sidebar z-[170] bg-black/80 backdrop-blur-md">
          <div className="admin-overlay-panel w-full max-w-lg rounded-[2rem] border border-white/[0.06] bg-[#0c0c0f] shadow-2xl text-right">
            <div className="border-b border-white/5 p-6 pb-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-300">
                  <Trash2 size={18} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-white">حذف طلب الفرع؟</h3>
                  <p className="text-xs text-white/55">
                    {deleteTarget.request_ref} · {deleteTarget.branch_name}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 pt-4">
              <p className="text-sm leading-6 text-white/75">
                سيتم حذف هذا الطلب نهائيًا لأنه لم يتم إرساله بعد.
                لا يمكن التراجع عن هذه العملية.
              </p>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  onClick={closeDeleteModal}
                  disabled={deleteInProgress}
                  className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] px-5 py-2.5 text-xs font-semibold text-white hover:bg-white/5 transition-all disabled:cursor-not-allowed disabled:opacity-50"
                >
                  إلغاء
                </button>
                <button
                  onClick={() => void handleDeleteRequest()}
                  disabled={deleteInProgress}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500 px-5 py-2.5 text-xs font-semibold text-white hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50 transition-all"
                >
                  {deleteInProgress ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  <span>{deleteInProgress ? 'جارٍ الحذف...' : 'حذف الطلب'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit & Send Modal */}
      {editRequestContext && (
        <BulkTransferModal
          isOpen={editRequestContext !== null}
          onClose={() => setEditRequestContext(null)}
          onSuccess={handleEditSuccess}
          requestContext={editRequestContext}
        />
      )}
    </div>
  );
};

export default BranchRequestsTab;
