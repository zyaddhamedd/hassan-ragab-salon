import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, ClipboardList, Layers, Loader2, Package2, PlusCircle, RefreshCw, RotateCcw, Search, Truck } from 'lucide-react';
import { Cashier } from '../App';
import { apiClient } from '../src/api/client';
import { invalidateProductsCacheForBranch } from '../src/utils/productCache';
import {
  BranchInventoryActivity,
  BranchInventoryPayload,
  BranchInventoryProductDetails,
  BranchInventoryProduct,
  BranchInventorySummaryPayload,
  IncomingShipmentDetails,
  IncomingShipmentSummary,
  PaginatedListResponse,
  ReturnRequestSummary,
  SupplyRequestSummary,
} from '../src/types/models';
import BranchInventoryCard from './BranchInventoryCard';
import ConsumptionSheet from './ConsumptionSheet';
import IncomingShipmentCard from './IncomingShipmentCard';
import ReturnRequestDetailsSheet from './ReturnRequestDetailsSheet';
import ReturnRequestSheet from './ReturnRequestSheet';
import ShipmentDetailsSheet from './ShipmentDetailsSheet';
import ShipmentHistoryList from './ShipmentHistoryList';
import SupplyRequestSheet from './SupplyRequestSheet';
import RequestDetailsSheet from './RequestDetailsSheet';

const ProductActivityLog = lazy(() => import('./ProductActivityLog'));
const MINI_SUPPLY_REQUESTS_PAGE_SIZE = 6;
const MINI_RETURN_REQUESTS_PAGE_SIZE = 6;
const EMPTY_PAGINATION = {
  page: 1,
  per_page: 0,
  total: 0,
  total_pages: 0,
  has_more: false,
};

const formatRelativeTime = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return '—';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return `منذ ${Math.max(1, minutes)} دقيقة`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `منذ ${hours} ساعة`;
    const days = Math.floor(hours / 24);
    return `منذ ${days} يوم`;
  } catch {
    return '—';
  }
};

interface BranchInventoryScreenProps {
  cashier: Cashier;
}

const returnStatusLabelMap: Record<ReturnRequestSummary['status'], string> = {
  PENDING: 'قيد المراجعة',
  RETURNED_TO_MAIN: 'بالمخزن',
  RETURNED_TO_SUPPLIER: 'بالمورد',
  REJECTED: 'مرفوض',
};

const returnStatusClassMap: Record<ReturnRequestSummary['status'], string> = {
  PENDING: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  RETURNED_TO_MAIN: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  RETURNED_TO_SUPPLIER: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  REJECTED: 'bg-red-500/10 text-red-300 border-red-500/20',
};

const formatDate = (value: string) => {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const sortInventoryProducts = (products: BranchInventoryProduct[]) => {
  const order = { LOW: 0, AVAILABLE: 1, OUT: 2, UNKNOWN: 3, NOT_APPLICABLE: 4 };
  return [...products].sort((a, b) => {
    if (order[a.status] !== order[b.status]) {
      return order[a.status] - order[b.status];
    }
    return a.name.localeCompare(b.name, 'ar');
  });
};

const BranchInventoryScreen: React.FC<BranchInventoryScreenProps> = ({ cashier }) => {
  const [inventory, setInventory] = useState<BranchInventoryPayload | null>(null);
  const [incomingShipments, setIncomingShipments] = useState<IncomingShipmentSummary[]>([]);
  const [summaryCounts, setSummaryCounts] = useState<BranchInventorySummaryPayload>({
    active_supply_requests: 0,
    pending_supply_requests: 0,
    pending_returns: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<BranchInventoryProduct | null>(null);
  const [selectedProductDetails, setSelectedProductDetails] = useState<BranchInventoryProductDetails | null>(null);
  const [productDetailsLoading, setProductDetailsLoading] = useState(false);
  const [productDetailsError, setProductDetailsError] = useState<string | null>(null);
  const [consumeError, setConsumeError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

    const [activeShipmentId, setActiveShipmentId] = useState<number | null>(null);
    const [selectedShipment, setSelectedShipment] = useState<IncomingShipmentDetails | null>(null);
    const [shipmentError, setShipmentError] = useState<string | null>(null);
    const [shipmentLoading, setShipmentLoading] = useState(false);
    const [isReceivingShipment, setIsReceivingShipment] = useState(false);
    const [activeShipmentsTab, setActiveShipmentsTab] = useState<'incoming' | 'history' | 'activity' | 'returns' | null>(null);
    const [isSupplyRequestsSectionOpen, setIsSupplyRequestsSectionOpen] = useState(false);
    const [supplyRequests, setSupplyRequests] = useState<SupplyRequestSummary[]>([]);
    const [supplyRequestsLoaded, setSupplyRequestsLoaded] = useState(false);
    const [supplyRequestsLoading, setSupplyRequestsLoading] = useState(false);
    const [supplyRequestsError, setSupplyRequestsError] = useState<string | null>(null);
    const [supplyRequestsPagination, setSupplyRequestsPagination] = useState(EMPTY_PAGINATION);
    const [returnRequests, setReturnRequests] = useState<ReturnRequestSummary[]>([]);
    const [returnRequestsLoaded, setReturnRequestsLoaded] = useState(false);
    const [returnRequestsLoading, setReturnRequestsLoading] = useState(false);
    const [returnRequestsError, setReturnRequestsError] = useState<string | null>(null);
    const [returnRequestsPagination, setReturnRequestsPagination] = useState(EMPTY_PAGINATION);
    const [isRequestSheetOpen, setIsRequestSheetOpen] = useState(false);
    const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
    const [selectedReturnProduct, setSelectedReturnProduct] = useState<BranchInventoryProduct | null>(null);
    const [selectedReturnRequestId, setSelectedReturnRequestId] = useState<number | null>(null);
    const [showAllIncoming, setShowAllIncoming] = useState(false);
    const hasLoadedScreenDataRef = useRef(false);

  const activeRequests = useMemo(() => supplyRequests, [supplyRequests]);
  const activeSupplyRequestsCount = summaryCounts.active_supply_requests;

  const recentReturnRequests = useMemo(() => {
    if (!returnRequestsLoaded) return [];
    return returnRequests;
  }, [returnRequests, returnRequestsLoaded]);

  const pendingReturnRequestsCount = summaryCounts.pending_returns;

  const resolvedReturnRequestsCount = useMemo(() => {
    if (!returnRequestsLoaded) return 0;
    return Math.max(0, returnRequestsPagination.total - pendingReturnRequestsCount);
  }, [pendingReturnRequestsCount, returnRequestsLoaded, returnRequestsPagination.total]);

  const fetchInventoryData = async () => {
    const inventoryData = await apiClient.get('/inventory');
    setInventory({
      ...inventoryData,
      products: sortInventoryProducts(inventoryData.products || []),
    });
  };

  const fetchIncomingShipments = async () => {
    const shipmentsData = await apiClient.get('/shipments/incoming');
    setIncomingShipments(shipmentsData || []);
  };

  const fetchInventorySummary = async () => {
    const summaryData = await apiClient.get('/inventory/summary');
    setSummaryCounts({
      active_supply_requests: Number(summaryData?.active_supply_requests || 0),
      pending_supply_requests: Number(summaryData?.pending_supply_requests || 0),
      pending_returns: Number(summaryData?.pending_returns || 0),
    });
  };

  const loadScreenData = async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchInventoryData(),
        fetchIncomingShipments(),
        fetchInventorySummary(),
      ]);
    } catch (loadError: any) {
      setError(loadError.message || 'تعذر تحميل بيانات المخزن.');
    } finally {
      setLoading(false);
    }
  };

  const loadSupplyRequests = async ({
    force = false,
    page = 1,
    append = false,
  }: {
    force?: boolean;
    page?: number;
    append?: boolean;
  } = {}) => {
    if (supplyRequestsLoading) return;
    if (!force && supplyRequestsLoaded && page === 1) return;

    setSupplyRequestsLoading(true);
    setSupplyRequestsError(null);

    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(MINI_SUPPLY_REQUESTS_PAGE_SIZE),
        status: 'ACTIVE',
      });
      const requestsData = await apiClient.get(`/supply-requests?${params.toString()}`) as PaginatedListResponse<SupplyRequestSummary>;
      const nextItems = Array.isArray(requestsData?.items) ? requestsData.items : [];
      setSupplyRequests((current) => {
        if (!append) return nextItems;
        const merged = [...current, ...nextItems];
        return merged.filter((item, index) => merged.findIndex((candidate) => candidate.id === item.id) === index);
      });
      setSupplyRequestsPagination({
        page: Number(requestsData?.page || page),
        per_page: Number(requestsData?.per_page || MINI_SUPPLY_REQUESTS_PAGE_SIZE),
        total: Number(requestsData?.total || 0),
        total_pages: Number(requestsData?.total_pages || 0),
        has_more: Boolean(requestsData?.has_more),
      });
      setSupplyRequestsLoaded(true);
    } catch (loadError: any) {
      setSupplyRequestsError(loadError.message || 'تعذر تحميل طلبات التوريد.');
    } finally {
      setSupplyRequestsLoading(false);
    }
  };

  const loadReturnRequests = async ({
    force = false,
    page = 1,
    append = false,
  }: {
    force?: boolean;
    page?: number;
    append?: boolean;
  } = {}) => {
    if (returnRequestsLoading) return;
    if (!force && returnRequestsLoaded && page === 1) return;

    setReturnRequestsLoading(true);
    setReturnRequestsError(null);

    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(MINI_RETURN_REQUESTS_PAGE_SIZE),
      });
      const returnRequestsData = await apiClient.get(`/returns?${params.toString()}`) as PaginatedListResponse<ReturnRequestSummary>;
      const nextItems = Array.isArray(returnRequestsData?.items) ? returnRequestsData.items : [];
      setReturnRequests((current) => {
        if (!append) return nextItems;
        const merged = [...current, ...nextItems];
        return merged.filter((item, index) => merged.findIndex((candidate) => candidate.id === item.id) === index);
      });
      setReturnRequestsPagination({
        page: Number(returnRequestsData?.page || page),
        per_page: Number(returnRequestsData?.per_page || MINI_RETURN_REQUESTS_PAGE_SIZE),
        total: Number(returnRequestsData?.total || 0),
        total_pages: Number(returnRequestsData?.total_pages || 0),
        has_more: Boolean(returnRequestsData?.has_more),
      });
      setReturnRequestsLoaded(true);
    } catch (loadError: any) {
      setReturnRequestsError(loadError.message || 'تعذر تحميل طلبات المرتجع.');
    } finally {
      setReturnRequestsLoading(false);
    }
  };

  const loadShipmentDetails = async (shipmentId: number) => {
    setActiveShipmentId(shipmentId);
    setShipmentLoading(true);
    setShipmentError(null);
    setSelectedShipment(null);

    try {
      const data = await apiClient.get(`/shipments/${shipmentId}`);
      setSelectedShipment(data);
    } catch (loadError: any) {
      setShipmentError(loadError.message || 'تعذر تحميل تفاصيل الشحنة.');
    } finally {
      setShipmentLoading(false);
    }
  };

  useEffect(() => {
    if (hasLoadedScreenDataRef.current) return;
    hasLoadedScreenDataRef.current = true;
    loadScreenData();
  }, []);

  useEffect(() => {
    if (activeShipmentsTab !== 'returns') return;
    void loadReturnRequests();
  }, [activeShipmentsTab]);

  useEffect(() => {
    if (!selectedProduct) {
      setSelectedProductDetails(null);
      setProductDetailsLoading(false);
      setProductDetailsError(null);
      return;
    }

    let isActive = true;
    setProductDetailsLoading(true);
    setProductDetailsError(null);
    setSelectedProductDetails(null);

    apiClient.get(`/inventory/products/${selectedProduct.product_id}/details`)
      .then((data) => {
        if (!isActive) return;
        setSelectedProductDetails(data);
      })
      .catch((loadError: any) => {
        if (!isActive) return;
        setProductDetailsError(loadError.message || 'تعذر تحميل تفاصيل الدفعات.');
      })
      .finally(() => {
        if (!isActive) return;
        setProductDetailsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [selectedProduct]);

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToastMessage(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const products = inventory?.products || [];
    if (!query) return products;

    return products.filter((product) =>
      product.name.toLowerCase().includes(query) ||
      product.category.toLowerCase().includes(query)
    );
  }, [inventory?.products, searchQuery]);

  const summary = useMemo(() => {
    const products = inventory?.products || [];
    return {
      productsCount: products.length,
      totalUnits: products.reduce((sum, product) => sum + product.stock_quantity, 0),
      lowStockCount: products.filter((product) => product.status === 'LOW').length,
    };
  }, [inventory?.products]);

  const handleConsume = async (payload: { product_id: number; quantity: number; reason: string; note?: string | null }) => {
    setConsumeError(null);

    if (!selectedProduct) return;
    if (!Number.isInteger(payload.quantity) || payload.quantity <= 0) {
      setConsumeError('الكمية يجب أن تكون أكبر من الصفر.');
      return;
    }
    if (payload.quantity > selectedProduct.stock_quantity) {
      setConsumeError('الكمية غير متاحة في هذا الفرع.');
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await apiClient.post('/products/consume', payload);
      const updatedProduct: BranchInventoryProduct = data.product;
      const newActivity: BranchInventoryActivity = data.activity;

      setInventory((current) => {
        if (!current) return current;

        const nextProducts = current.products.map((product) =>
          product.product_id === updatedProduct.product_id ? updatedProduct : product
        );

        return {
          ...current,
          products: sortInventoryProducts(nextProducts),
          recent_activity: [newActivity, ...(current.recent_activity || [])].slice(0, 8),
        };
      });

      setSelectedProduct(null);
    } catch (submitError: any) {
      setConsumeError(submitError.message || 'تعذر تسجيل الاستهلاك.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReceiveShipment = async () => {
    if (!activeShipmentId || !selectedShipment) return;

    setIsReceivingShipment(true);
    setShipmentError(null);
    try {
      const data = await apiClient.post(`/shipments/${activeShipmentId}/receive`, {});
      invalidateProductsCacheForBranch(cashier.branch_id);
      await Promise.all([
        fetchInventoryData(),
        fetchIncomingShipments(),
        fetchInventorySummary(),
        supplyRequestsLoaded ? loadSupplyRequests({ force: true, page: 1 }) : Promise.resolve(),
      ]);
      setToastMessage(data.message || 'تم استلام الشحنة وإضافتها لمخزن الفرع.');
      setActiveShipmentId(null);
      setSelectedShipment(null);
    } catch (receiveError: any) {
      setShipmentError(receiveError.message || 'تعذر استلام الشحنة.');
    } finally {
      setIsReceivingShipment(false);
    }
  };

  const handleToggleSupplyRequestsSection = () => {
    const nextIsOpen = !isSupplyRequestsSectionOpen;
    setIsSupplyRequestsSectionOpen(nextIsOpen);
    if (nextIsOpen) {
      void loadSupplyRequests();
    }
  };

  if (loading) {
    return (
      <div className="mini-screen items-center justify-center bg-[#121212]" dir="rtl">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={28} className="animate-spin text-[#E6D690]" />
          <p className="text-sm font-bold text-white/45">جارٍ تحميل مخزن الفرع...</p>
        </div>
      </div>
    );
  }

  if (error || !inventory) {
    return (
      <div className="mini-screen items-center justify-center bg-[#121212] px-4" dir="rtl">
        <div className="w-full max-w-md rounded-[2rem] border border-white/5 bg-[#191919] p-8 text-center">
          <p className="text-lg font-black text-white">{error || 'تعذر تحميل بيانات المخزن.'}</p>
          <button
            type="button"
            onClick={loadScreenData}
            className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-black text-white"
          >
            <RefreshCw size={14} />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mini-screen bg-[#0a0a0b] bg-[radial-gradient(circle_at_top,rgba(230,214,144,0.03),transparent_70%)] font-['Cairo'] text-[#F5F5F5]" dir="rtl">
      {toastMessage && (
        <div className="fixed left-6 bottom-6 z-[120] animate-fade-in-up">
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/10 bg-[#161618] px-4 py-3.5 text-xs font-semibold text-emerald-300 shadow-2xl backdrop-blur-md">
            <CheckCircle2 size={14} className="text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      <div className="mini-scroll-y mini-page-body custom-scrollbar">
      <div className="mx-auto max-w-6xl space-y-6 lg:space-y-8">
        


        {/* 2. Top Statistics Grid (4 Cards) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {/* Card 1: Active requests (Purple) */}
          <div className="bg-[#141416] border border-white/[0.04] rounded-2xl p-4 flex items-center justify-between shadow-sm">
            <div className="h-11 w-11 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <ClipboardList size={18} />
            </div>
            <div className="text-right">
              <span className="text-[10px] text-white/35 font-bold block">طلبات توريد نشطة</span>
              <span className="text-xl font-black text-white mt-1 block leading-none">{activeSupplyRequestsCount}</span>
              <span className="text-[9px] text-white/30 font-semibold block mt-1">طلبات</span>
            </div>
          </div>

          {/* Card 2: Shipments in transit (Green) */}
          <div className="bg-[#141416] border border-white/[0.04] rounded-2xl p-4 flex items-center justify-between shadow-sm">
            <div className="h-11 w-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Truck size={18} />
            </div>
            <div className="text-right">
              <span className="text-[10px] text-white/35 font-bold block">شحنات في الطريق</span>
              <span className="text-xl font-black text-white mt-1 block leading-none">{incomingShipments.length}</span>
              <span className="text-[9px] text-white/30 font-semibold block mt-1">شحنات</span>
            </div>
          </div>

          <div className="bg-[#141416] border border-white/[0.04] rounded-2xl p-4 flex items-center justify-between shadow-sm">
            <div className="h-11 w-11 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-300">
              <RefreshCw size={18} />
            </div>
            <div className="text-right">
              <span className="text-[10px] text-white/35 font-bold block">طلبات مرتجع قيد المراجعة</span>
              <span className="text-xl font-black text-white mt-1 block leading-none">{pendingReturnRequestsCount}</span>
              <span className="text-[9px] text-white/30 font-semibold block mt-1">طلبات</span>
            </div>
          </div>

          {/* Card 3: Total units (Yellow) */}
          <div className="bg-[#141416] border border-white/[0.04] rounded-2xl p-4 flex items-center justify-between shadow-sm">
            <div className="h-11 w-11 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Layers size={18} />
            </div>
            <div className="text-right">
              <span className="text-[10px] text-white/35 font-bold block">إجمالي الكمية</span>
              <span className="text-xl font-black text-white mt-1 block leading-none">{summary.totalUnits.toLocaleString('ar-EG')}</span>
              <span className="text-[9px] text-white/30 font-semibold block mt-1">قطعة</span>
            </div>
          </div>

          {/* Card 4: Active products count (Amber/Gold) */}
          <div className="bg-[#141416] border border-white/[0.04] rounded-2xl p-4 flex items-center justify-between shadow-sm">
            <div className="h-11 w-11 rounded-xl bg-[#E6D690]/10 border border-[#E6D690]/20 flex items-center justify-center text-[#E6D690]">
              <Package2 size={18} />
            </div>
            <div className="text-right">
              <span className="text-[10px] text-white/35 font-bold block">إجمالي المنتجات</span>
              <span className="text-xl font-black text-white mt-1 block leading-none">{summary.productsCount}</span>
              <span className="text-[9px] text-white/30 font-semibold block mt-1">منتج متاح</span>
            </div>
          </div>
        </div>

        {/* 3. Action Bar (Request Button & Tab Buttons Combined) */}
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
          {/* Tab Buttons (Right in RTL) */}
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => setActiveShipmentsTab(activeShipmentsTab === 'incoming' ? null : 'incoming')}
              className={`inline-flex h-11 items-center gap-2.5 px-5 rounded-xl text-xs font-black transition-all duration-300 border ${
                activeShipmentsTab === 'incoming'
                  ? 'border-transparent bg-gradient-to-r from-[#E6D690] to-[#cfa353] text-black shadow-[0_8px_20px_rgba(230,214,144,0.18)] scale-[1.02] active:scale-98'
                  : 'border-white/[0.05] bg-white/[0.02] text-white/45 hover:bg-white/[0.06] hover:text-white/80 hover:border-white/10 hover:shadow-[0_4px_12px_rgba(255,255,255,0.02)] active:scale-98'
              }`}
            >
              <Package2 size={14} />
              <span>الوارد</span>
              {incomingShipments.length > 0 && (
                <span className={`inline-flex items-center justify-center rounded-lg px-2 py-0.5 text-[9px] font-black ${
                  activeShipmentsTab === 'incoming'
                    ? 'bg-black/10 text-black'
                    : 'bg-amber-500/10 border border-amber-500/20 text-amber-300 animate-pulse'
                }`}>
                  {incomingShipments.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveShipmentsTab(activeShipmentsTab === 'history' ? null : 'history')}
              className={`inline-flex h-11 items-center gap-2.5 px-5 rounded-xl text-xs font-black transition-all duration-300 border ${
                activeShipmentsTab === 'history'
                  ? 'border-transparent bg-gradient-to-r from-[#E6D690] to-[#cfa353] text-black shadow-[0_8px_20px_rgba(230,214,144,0.18)] scale-[1.02] active:scale-98'
                  : 'border-white/[0.05] bg-white/[0.02] text-white/45 hover:bg-white/[0.06] hover:text-white/80 hover:border-white/10 hover:shadow-[0_4px_12px_rgba(255,255,255,0.02)] active:scale-98'
              }`}
            >
              <ClipboardList size={14} />
              <span>السجل</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveShipmentsTab(activeShipmentsTab === 'activity' ? null : 'activity')}
              className={`inline-flex h-11 items-center gap-2.5 px-5 rounded-xl text-xs font-black transition-all duration-300 border ${
                activeShipmentsTab === 'activity'
                  ? 'border-transparent bg-gradient-to-r from-[#E6D690] to-[#cfa353] text-black shadow-[0_8px_20px_rgba(230,214,144,0.18)] scale-[1.02] active:scale-98'
                  : 'border-white/[0.05] bg-white/[0.02] text-white/45 hover:bg-white/[0.06] hover:text-white/80 hover:border-white/10 hover:shadow-[0_4px_12px_rgba(255,255,255,0.02)] active:scale-98'
              }`}
            >
              <Activity size={14} />
              <span>حركة المنتجات</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveShipmentsTab(activeShipmentsTab === 'returns' ? null : 'returns')}
              className={`inline-flex h-11 items-center gap-2.5 px-5 rounded-xl text-xs font-black transition-all duration-300 border ${
                activeShipmentsTab === 'returns'
                  ? 'border-transparent bg-gradient-to-r from-[#E6D690] to-[#cfa353] text-black shadow-[0_8px_20px_rgba(230,214,144,0.18)] scale-[1.02] active:scale-98'
                  : 'border-white/[0.05] bg-white/[0.02] text-white/45 hover:bg-white/[0.06] hover:text-white/80 hover:border-white/10 hover:shadow-[0_4px_12px_rgba(255,255,255,0.02)] active:scale-98'
              }`}
            >
              <RotateCcw size={14} />
              <span>المرتجعات</span>
              {pendingReturnRequestsCount > 0 && (
                <span className={`inline-flex items-center justify-center rounded-lg px-2 py-0.5 text-[9px] font-black ${
                  activeShipmentsTab === 'returns'
                    ? 'bg-black/10 text-black'
                    : 'bg-sky-500/10 border border-sky-500/20 text-sky-300'
                }`}>
                  {pendingReturnRequestsCount}
                </span>
              )}
            </button>
          </div>

          {/* Request Button (Left in RTL) */}
          <div className="flex w-full justify-end xl:w-auto">
            <button
              type="button"
              onClick={() => setIsRequestSheetOpen(true)}
              className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#E6D690] to-[#cfa353] px-6 text-xs font-black text-black shadow-[0_4px_16px_rgba(230,214,144,0.15)] transition-all duration-300 hover:from-[#f3e3a1] hover:to-[#e6d690] active:scale-98 xl:w-auto"
            >
              <PlusCircle size={14} />
              <span>طلب توريد</span>
            </button>
          </div>
        </div>

        {/* 4. Active Supply Requests (Mini elegant summary carousel) */}
        {(activeSupplyRequestsCount > 0 || supplyRequestsLoaded || supplyRequestsLoading || supplyRequestsError) && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 justify-start">
                <span className="text-xs font-bold text-white/90">طلبات توريد نشطة</span>
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E6D690]/10 border border-[#E6D690]/20 px-1.5 text-[10px] font-bold text-[#E6D690]">
                  {activeSupplyRequestsCount}
                </span>
              </div>
              <button
                type="button"
                onClick={handleToggleSupplyRequestsSection}
                className="inline-flex h-8 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 text-[10px] font-bold text-white/70 transition-all hover:bg-white/[0.08] hover:text-white"
              >
                {isSupplyRequestsSectionOpen ? 'إخفاء الطلبات' : 'عرض الطلبات'}
              </button>
            </div>
            {isSupplyRequestsSectionOpen ? (
              supplyRequestsLoading && !supplyRequestsLoaded ? (
                <div className="flex flex-col items-center justify-center gap-3.5 rounded-xl border border-dashed border-white/[0.04] py-14 text-center bg-[#141416]/20">
                  <Loader2 size={20} className="animate-spin text-[#E6D690]" />
                  <p className="text-xs font-bold text-white/50">جارٍ تحميل طلبات التوريد...</p>
                </div>
              ) : supplyRequestsError ? (
                <div className="rounded-xl border border-[#E53935]/10 bg-[#E53935]/5 px-4 py-4 text-center">
                  <p className="text-xs font-semibold text-[#ff9d99]">{supplyRequestsError}</p>
                  <button
                    type="button"
                    onClick={() => void loadSupplyRequests({ force: true, page: 1 })}
                    className="mt-3 inline-flex h-9 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 text-[10px] font-bold text-white/75 transition-all hover:bg-white/[0.08] hover:text-white"
                  >
                    إعادة المحاولة
                  </button>
                </div>
              ) : activeRequests.length > 0 ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                    {activeRequests.map((req) => (
                      <div
                        key={req.id}
                        className="group relative overflow-hidden rounded-xl border border-white/[0.04] bg-[#141416] p-4 flex flex-col justify-between h-[110px] transition-all duration-300 hover:border-white/[0.08]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`inline-flex items-center rounded px-2 py-0.5 text-[8px] font-bold border leading-none ${
                            req.status === 'PENDING'
                              ? 'bg-amber-500/10 text-[#E6D690] border-amber-500/20'
                              : 'bg-[#8B5CF6]/15 text-[#A78BFA] border-[#8B5CF6]/20'
                          }`}>
                            {req.status === 'PENDING' ? 'قيد المراجعة' : 'قيد الشحن'}
                          </span>
                          <span className="text-[9px] text-white/30 font-semibold">{formatDate(req.created_at)}</span>
                        </div>

                        <div className="mt-2 text-right">
                          <span className="block font-mono text-xs font-black text-white group-hover:text-[#E6D690] transition-colors">{req.request_ref}</span>
                        </div>

                        <div className="mt-2.5 flex items-center justify-between gap-3">
                          <span className="text-[10px] text-white/40 font-medium">
                            {req.items_count || 0} منتجات • {formatRelativeTime(req.created_at)}
                          </span>
                          <button
                            onClick={() => setSelectedRequestId(req.id)}
                            className="inline-flex h-6 items-center justify-center rounded-md bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 px-2.5 text-[9px] font-bold text-white/70 hover:text-white transition-all shadow-sm active:scale-95"
                          >
                            تفاصيل
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {(supplyRequestsPagination.has_more || supplyRequestsLoading) && (
                    <div className="flex flex-col items-center gap-3">
                      <span className="text-[10px] font-medium text-white/35">
                        عرض {supplyRequests.length} من {supplyRequestsPagination.total} طلب
                      </span>
                      <button
                        type="button"
                        onClick={() => void loadSupplyRequests({
                          page: supplyRequestsPagination.page + 1,
                          append: true,
                        })}
                        disabled={supplyRequestsLoading || !supplyRequestsPagination.has_more}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 text-[10px] font-bold text-white/75 transition-all hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {supplyRequestsLoading && <Loader2 size={14} className="animate-spin text-[#E6D690]" />}
                        <span>تحميل المزيد</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3.5 rounded-xl border border-dashed border-white/[0.04] py-14 text-center bg-[#141416]/20">
                  <ClipboardList size={20} className="text-white/20" />
                  <div>
                    <p className="text-xs font-bold text-white/50">لا توجد طلبات توريد نشطة حالياً</p>
                    <p className="mt-1 text-[10px] text-white/30">أي طلبات جديدة أو قيد الشحن ستظهر هنا.</p>
                  </div>
                </div>
              )
            ) : null}
          </div>
        )}

        {false && (
        <div className="space-y-4">
          <div className="rounded-[1.8rem] border border-white/[0.05] bg-[#141416] p-4 md:p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-500/15 bg-sky-500/10 text-sky-300">
                <RotateCcw size={16} />
              </div>
              <div className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <span className="inline-flex min-w-6 items-center justify-center rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[10px] font-black text-sky-300">
                    {returnRequests.length}
                  </span>
                  <span className="text-sm font-black text-white/95">طلباتي المرتجعة</span>
                </div>
                <p className="mt-1 text-[11px] font-medium text-white/40">
                  متابعة سريعة للطلبات المرسلة إلى الإدارة
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-amber-500/10 bg-amber-500/[0.05] px-4 py-3 text-right">
                <span className="text-[10px] font-semibold text-amber-200/70">قيد المراجعة</span>
                <p className="mt-1 text-lg font-black text-amber-200">{pendingReturnRequestsCount}</p>
              </div>
              <div className="rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-right">
                <span className="text-[10px] font-semibold text-white/40">تمت معالجته</span>
                <p className="mt-1 text-lg font-black text-white/90">{resolvedReturnRequestsCount}</p>
              </div>
            </div>
          </div>

          {recentReturnRequests.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {recentReturnRequests.map((request) => (
                <div
                  key={request.id}
                  className="rounded-[1.6rem] border border-white/[0.05] bg-[#141416] p-4 transition-all duration-300 hover:border-white/[0.08] hover:bg-[#17171a]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[9px] font-bold ${returnStatusClassMap[request.status]}`}>
                      {returnStatusLabelMap[request.status]}
                    </span>
                    <div className="text-right">
                      <span className="block font-mono text-[11px] font-black text-white/50">{request.return_ref}</span>
                      <span className="mt-1 block text-[10px] font-semibold text-white/35">{formatDate(request.created_at)}</span>
                    </div>
                  </div>

                  <div className="mt-4 text-right">
                    <p className="text-sm font-black text-white">{request.product_name}</p>
                    <p className="mt-1 text-[11px] font-medium text-white/45">
                      {request.requested_quantity} {request.product_unit} • {request.reason_label}
                    </p>
                  </div>

                  {request.notes && (
                    <p className="mt-3 line-clamp-2 rounded-2xl border border-white/[0.04] bg-white/[0.02] px-3 py-2.5 text-[11px] font-medium text-white/55">
                      {request.notes}
                    </p>
                  )}

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="text-[10px] font-medium text-white/35">{formatRelativeTime(request.created_at)}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedReturnRequestId(request.id)}
                      className="inline-flex h-8 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 text-[10px] font-bold text-white/70 transition-all hover:bg-white/[0.08] hover:text-white"
                    >
                      التفاصيل
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[1.8rem] border border-dashed border-white/[0.07] bg-[#141416]/40 px-6 py-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.05] bg-white/[0.02] text-white/35">
                <AlertCircle size={18} />
              </div>
              <p className="mt-4 text-sm font-bold text-white/55">لا توجد طلبات مرتجع بعد</p>
              <p className="mt-1 text-[11px] text-white/30">استخدم زر مرتجع داخل بطاقة المنتج لإرسال الطلب</p>
            </div>
          )}
        </div>
        )}

        {/* 5. Operational Workspace Tab Contents */}
        {activeShipmentsTab && (
          <div className="space-y-6 animate-fadeIn">
            {activeShipmentsTab === 'incoming' ? (
              <div className="space-y-4">
                {/* Section Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-white/90">
                    <Package2 size={16} className="text-[#E6D690]" />
                    <h3 className="text-xs font-bold">شحنات واردة بانتظار الاستلام</h3>
                  </div>
                  {incomingShipments.length > 3 && (
                    <span
                      onClick={() => setShowAllIncoming(!showAllIncoming)}
                      className="text-[10px] text-[#E6D690] font-bold cursor-pointer hover:underline"
                    >
                      {showAllIncoming ? 'عرض أقل' : 'عرض الكل'}
                    </span>
                  )}
                </div>

                {incomingShipments.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {(showAllIncoming ? incomingShipments : incomingShipments.slice(0, 3)).map((shipment, index) => (
                      <IncomingShipmentCard
                        key={shipment.id}
                        shipment={shipment}
                        onView={loadShipmentDetails}
                        index={index}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3.5 rounded-xl border border-dashed border-white/[0.04] py-14 text-center bg-[#141416]/20">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.01]">
                      <Package2 size={20} className="text-white/20" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white/50">لا توجد شحنات واردة جديدة</p>
                      <p className="mt-1 text-[10px] text-white/30">جميع الشحنات المرسلة تم استلامها بالكامل.</p>
                    </div>
                  </div>
                )}
              </div>
            ) : activeShipmentsTab === 'history' ? (
              <ShipmentHistoryList onSelectShipment={loadShipmentDetails} />
            ) : activeShipmentsTab === 'activity' ? (
              <Suspense
                fallback={
                  <div className="flex items-center justify-center gap-2 py-12">
                    <Loader2 size={18} className="animate-spin text-[#E6D690]" />
                    <span className="text-xs font-bold text-white/30">جارٍ التحميل...</span>
                  </div>
                }
              >
                <ProductActivityLog branchId={inventory.branch.id} />
              </Suspense>
            ) : activeShipmentsTab === 'returns' ? (
              returnRequestsLoading && !returnRequestsLoaded ? (
                <div className="flex flex-col items-center justify-center gap-3.5 rounded-xl border border-dashed border-white/[0.04] py-14 text-center bg-[#141416]/20">
                  <Loader2 size={20} className="animate-spin text-[#E6D690]" />
                  <p className="text-xs font-bold text-white/50">جارٍ تحميل طلبات المرتجع...</p>
                </div>
              ) : returnRequestsError ? (
                <div className="rounded-xl border border-[#E53935]/10 bg-[#E53935]/5 px-4 py-4 text-center">
                  <p className="text-xs font-semibold text-[#ff9d99]">{returnRequestsError}</p>
                  <button
                    type="button"
                    onClick={() => void loadReturnRequests({ force: true, page: 1 })}
                    className="mt-3 inline-flex h-9 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 text-[10px] font-bold text-white/75 transition-all hover:bg-white/[0.08] hover:text-white"
                  >
                    إعادة المحاولة
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-[1.8rem] border border-white/[0.05] bg-[#141416] p-4 md:p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-500/15 bg-sky-500/10 text-sky-300">
                        <RotateCcw size={16} />
                      </div>
                      <div className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="inline-flex min-w-6 items-center justify-center rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[10px] font-black text-sky-300">
                            {returnRequestsPagination.total}
                          </span>
                          <span className="text-sm font-black text-white/95">طلبات المرتجع</span>
                        </div>
                        <p className="mt-1 text-[11px] font-medium text-white/40">
                          جميع طلبات المرتجع الخاصة بهذا الفرع
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-amber-500/10 bg-amber-500/[0.05] px-4 py-3 text-right">
                        <span className="text-[10px] font-semibold text-amber-200/70">قيد المراجعة</span>
                        <p className="mt-1 text-lg font-black text-amber-200">{pendingReturnRequestsCount}</p>
                      </div>
                      <div className="rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-right">
                        <span className="text-[10px] font-semibold text-white/40">تمت معالجته</span>
                        <p className="mt-1 text-lg font-black text-white/90">{resolvedReturnRequestsCount}</p>
                      </div>
                    </div>
                  </div>

                  {recentReturnRequests.length > 0 ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {recentReturnRequests.map((request) => (
                          <div
                            key={request.id}
                            className="rounded-[1.6rem] border border-white/[0.05] bg-[#141416] p-4 transition-all duration-300 hover:border-white/[0.08] hover:bg-[#17171a]"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[9px] font-bold ${returnStatusClassMap[request.status]}`}>
                                {returnStatusLabelMap[request.status]}
                              </span>
                              <div className="text-right">
                                <span className="block font-mono text-[11px] font-black text-white/50">{request.return_ref}</span>
                                <span className="mt-1 block text-[10px] font-semibold text-white/35">{formatDate(request.created_at)}</span>
                              </div>
                            </div>

                            <div className="mt-4 text-right">
                              <p className="text-sm font-black text-white">{request.product_name}</p>
                              <p className="mt-1 text-[11px] font-medium text-white/45">
                                {request.requested_quantity} {request.product_unit} • {request.reason_label}
                              </p>
                            </div>

                            {request.notes && (
                              <p className="mt-3 line-clamp-2 rounded-2xl border border-white/[0.04] bg-white/[0.02] px-3 py-2.5 text-[11px] font-medium text-white/55">
                                {request.notes}
                              </p>
                            )}

                            <div className="mt-4 flex items-center justify-between gap-3">
                              <span className="text-[10px] font-medium text-white/35">{formatRelativeTime(request.created_at)}</span>
                              <button
                                type="button"
                                onClick={() => setSelectedReturnRequestId(request.id)}
                                className="inline-flex h-8 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 text-[10px] font-bold text-white/70 transition-all hover:bg-white/[0.08] hover:text-white"
                              >
                                التفاصيل
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {(returnRequestsPagination.has_more || returnRequestsLoading) && (
                        <div className="flex flex-col items-center gap-3">
                          <span className="text-[10px] font-medium text-white/35">
                            عرض {returnRequests.length} من {returnRequestsPagination.total} طلب
                          </span>
                          <button
                            type="button"
                            onClick={() => void loadReturnRequests({
                              page: returnRequestsPagination.page + 1,
                              append: true,
                            })}
                            disabled={returnRequestsLoading || !returnRequestsPagination.has_more}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 text-[10px] font-bold text-white/75 transition-all hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {returnRequestsLoading && <Loader2 size={14} className="animate-spin text-[#E6D690]" />}
                            <span>تحميل المزيد</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-[1.8rem] border border-dashed border-white/[0.07] bg-[#141416]/40 px-6 py-12 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.05] bg-white/[0.02] text-white/35">
                        <AlertCircle size={18} />
                      </div>
                      <p className="mt-4 text-sm font-bold text-white/55">لا توجد طلبات مرتجع</p>
                      <p className="mt-1 text-[11px] text-white/30">طلبات المرتجع الخاصة بهذا الفرع ستظهر هنا.</p>
                    </div>
                  )}
                </div>
              )
            ) : null}
          </div>
        )}

        {/* 6. Product Catalog Browser (Moved lower, compact presentation) */}
        <div className="border-t border-white/[0.04] pt-8 space-y-4">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div className="flex items-center gap-2 text-white/90">
              <Package2 size={16} className="text-[#E6D690]" />
              <h3 className="text-xs font-bold whitespace-nowrap">المنتجات المتاحة</h3>
            </div>

            <div className="flex w-full items-center justify-end gap-3 lg:w-auto">
              <div className="relative w-full sm:w-64 md:w-80">
                <Search size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/25" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="ابحث عن منتج متاح..."
                  className="h-9 w-full rounded-xl border border-white/[0.05] bg-[#141416] pr-9 pl-4 text-xs font-semibold text-white placeholder-white/20 outline-none focus:border-[#E6D690]/30 focus:bg-[#18181b] transition-all duration-200"
                />
              </div>
              <span className="text-[10px] text-[#E6D690] font-bold cursor-pointer hover:underline whitespace-nowrap">عرض الكل</span>
            </div>
          </div>

          {filteredProducts.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {filteredProducts.map((product) => (
                <BranchInventoryCard
                  key={product.product_id}
                  product={product}
                  onConsume={(item) => {
                    setConsumeError(null);
                    setSelectedProduct(item);
                  }}
                  onReturn={(item) => {
                    setSelectedReturnProduct(item);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/[0.06] bg-[#141416]/20 px-6 py-14 text-center">
              <Package2 size={24} className="mx-auto text-white/15 animate-pulse" />
              <p className="mt-4 text-xs font-semibold text-white/50">لا توجد منتجات مطابقة لعملية البحث</p>
            </div>
          )}
        </div>

      </div>

      <ConsumptionSheet
        product={selectedProduct}
        details={selectedProductDetails}
        detailsLoading={productDetailsLoading}
        detailsError={productDetailsError}
        isSubmitting={isSubmitting}
        error={consumeError}
        onClose={() => {
          if (!isSubmitting) {
            setSelectedProduct(null);
            setSelectedProductDetails(null);
            setProductDetailsError(null);
            setConsumeError(null);
          }
        }}
        onSubmit={handleConsume}
      />

      <ShipmentDetailsSheet
        shipmentId={activeShipmentId}
        shipment={selectedShipment}
        isLoading={shipmentLoading}
        isReceiving={isReceivingShipment}
        error={shipmentError}
        onClose={() => {
          if (!isReceivingShipment) {
            setActiveShipmentId(null);
            setSelectedShipment(null);
            setShipmentError(null);
          }
        }}
        onConfirm={handleReceiveShipment}
      />

      <SupplyRequestSheet
        isOpen={isRequestSheetOpen}
        onClose={() => setIsRequestSheetOpen(false)}
        onSuccess={async (msg) => {
          setToastMessage(msg);
          await Promise.all([
            fetchInventorySummary(),
            supplyRequestsLoaded ? loadSupplyRequests({ force: true, page: 1 }) : Promise.resolve(),
          ]);
        }}
      />

      <ReturnRequestSheet
        product={selectedReturnProduct}
        isOpen={selectedReturnProduct !== null}
        onClose={() => setSelectedReturnProduct(null)}
        onSuccess={async (msg) => {
          setToastMessage(msg);
          await Promise.all([
            fetchInventorySummary(),
            returnRequestsLoaded ? loadReturnRequests({ force: true, page: 1 }) : Promise.resolve(),
          ]);
        }}
      />

      <RequestDetailsSheet
        requestId={selectedRequestId}
        isOpen={selectedRequestId !== null}
        onClose={() => setSelectedRequestId(null)}
      />

      <ReturnRequestDetailsSheet
        requestId={selectedReturnRequestId}
        isOpen={selectedReturnRequestId !== null}
        onClose={() => setSelectedReturnRequestId(null)}
      />
      </div>
    </div>
  );
};

export default BranchInventoryScreen;
