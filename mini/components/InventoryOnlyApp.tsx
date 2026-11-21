import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Loader2,
  LogOut,
  Package2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Store,
  Truck,
  X,
} from 'lucide-react';
import { Cashier } from '../App';
import { BACKEND_URL, apiClient, MiniDeviceContext } from '../src/api/client';
import {
  BranchInventoryActivity,
  BranchInventoryPayload,
  BranchInventoryProduct,
  BranchInventoryProductDetails,
  BranchInventorySummaryPayload,
  IncomingShipmentDetails,
  IncomingShipmentSummary,
  PaginatedListResponse,
  ProductActivityItem,
  ProductActivityResponse,
  ReturnRequestReason,
  ReturnRequestSummary,
  ShipmentHistoryResponse,
  ShipmentHistorySummary,
  SupplyRequestSummary,
} from '../src/types/models';
import { invalidateProductsCacheForBranch } from '../src/utils/productCache';
import { statusLabel, statusClass, searchableInventoryStatus } from '../src/utils/inventoryStatus';

type MobileInventoryTab = 'products' | 'supply' | 'shipments' | 'returns';

type SearchableProduct = {
  id: number;
  name: string;
  category: string;
  unit: string;
  image_url?: string | null;
  selling_price?: number;
  stock_quantity: number;
  min_stock_threshold?: number;
  status?: BranchInventoryProduct['status'];
};

interface InventoryOnlyAppProps {
  cashier: Cashier;
  deviceContext: MiniDeviceContext;
  onLogout: () => void;
}

const MINI_SUPPLY_REQUESTS_PAGE_SIZE = 10;
const MINI_RETURN_REQUESTS_PAGE_SIZE = 10;
const MOBILE_NAV_FALLBACK_HEIGHT = 96;

const RETURN_REASON_OPTIONS: Array<{ value: ReturnRequestReason; label: string }> = [
  { value: 'DAMAGED', label: 'تالف' },
  { value: 'EXPIRED', label: 'منتهي' },
  { value: 'WRONG_SHIPMENT', label: 'شحنة خاطئة' },
  { value: 'NOT_NEEDED', label: 'غير مطلوب' },
  { value: 'MANUFACTURING_DEFECT', label: 'عيب تصنيع' },
  { value: 'OTHER', label: 'أخرى' },
];

const shipmentStatusLabel: Record<IncomingShipmentSummary['status'], string> = {
  IN_TRANSIT: 'في الطريق',
  RECEIVED: 'تم الاستلام',
  CANCELLED: 'ملغاة',
};

const returnStatusLabel: Record<ReturnRequestSummary['status'], string> = {
  PENDING: 'قيد المراجعة',
  RETURNED_TO_MAIN: 'بالمخزن',
  RETURNED_TO_SUPPLIER: 'بالمورد',
  REJECTED: 'مرفوض',
};

const InventoryOnlyApp: React.FC<InventoryOnlyAppProps> = ({
  cashier,
  deviceContext,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<MobileInventoryTab>('products');
  const [bottomNavHeight, setBottomNavHeight] = useState(MOBILE_NAV_FALLBACK_HEIGHT);
  const [inventory, setInventory] = useState<BranchInventoryPayload | null>(null);
  const [summaryCounts, setSummaryCounts] = useState<BranchInventorySummaryPayload>({
    active_supply_requests: 0,
    pending_supply_requests: 0,
    pending_returns: 0,
  });
  const [incomingShipments, setIncomingShipments] = useState<IncomingShipmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [supplyRequests, setSupplyRequests] = useState<SupplyRequestSummary[]>([]);
  const [supplyRequestsLoaded, setSupplyRequestsLoaded] = useState(false);
  const [supplyRequestsLoading, setSupplyRequestsLoading] = useState(false);
  const [supplyRequestsError, setSupplyRequestsError] = useState<string | null>(null);
  const [supplyRequestsHasMore, setSupplyRequestsHasMore] = useState(false);
  const [supplyRequestsPage, setSupplyRequestsPage] = useState(1);

  const [returnRequests, setReturnRequests] = useState<ReturnRequestSummary[]>([]);
  const [returnRequestsLoaded, setReturnRequestsLoaded] = useState(false);
  const [returnRequestsLoading, setReturnRequestsLoading] = useState(false);
  const [returnRequestsError, setReturnRequestsError] = useState<string | null>(null);
  const [returnRequestsHasMore, setReturnRequestsHasMore] = useState(false);
  const [returnRequestsPage, setReturnRequestsPage] = useState(1);

  const [shipmentHistory, setShipmentHistory] = useState<ShipmentHistorySummary[]>([]);
  const [shipmentHistoryLoaded, setShipmentHistoryLoaded] = useState(false);
  const [shipmentHistoryLoading, setShipmentHistoryLoading] = useState(false);
  const [shipmentHistoryError, setShipmentHistoryError] = useState<string | null>(null);
  const [shipmentHistoryPage, setShipmentHistoryPage] = useState(1);
  const [shipmentHistoryHasMore, setShipmentHistoryHasMore] = useState(false);
  const [shipmentsView, setShipmentsView] = useState<'incoming' | 'history'>('incoming');

  const [selectedProduct, setSelectedProduct] = useState<BranchInventoryProduct | null>(null);
  const [consumeProduct, setConsumeProduct] = useState<BranchInventoryProduct | null>(null);
  const [supplyComposerOpen, setSupplyComposerOpen] = useState(false);
  const [selectedSupplyRequestId, setSelectedSupplyRequestId] = useState<number | null>(null);
  const [selectedShipmentId, setSelectedShipmentId] = useState<number | null>(null);
  const [selectedReturnRequestId, setSelectedReturnRequestId] = useState<number | null>(null);
  const [returnComposerProduct, setReturnComposerProduct] = useState<BranchInventoryProduct | null>(null);
  const [returnComposerOpen, setReturnComposerOpen] = useState(false);
  const [activityPanelOpen, setActivityPanelOpen] = useState(false);

  const hasOpenPanel = Boolean(
    selectedProduct ||
    consumeProduct ||
    supplyComposerOpen ||
    selectedSupplyRequestId ||
    selectedShipmentId ||
    selectedReturnRequestId ||
    returnComposerOpen ||
    activityPanelOpen,
  );

  const fetchInventoryData = useCallback(async () => {
    const data = await apiClient.get('/inventory') as BranchInventoryPayload;
    setInventory({
      ...data,
      products: sortInventoryProducts(data.products || []),
    });
  }, []);

  const fetchIncomingShipments = useCallback(async () => {
    const data = await apiClient.get('/shipments/incoming') as IncomingShipmentSummary[];
    setIncomingShipments(Array.isArray(data) ? data : []);
  }, []);

  const fetchInventorySummary = useCallback(async () => {
    const data = await apiClient.get('/inventory/summary') as BranchInventorySummaryPayload;
    setSummaryCounts({
      active_supply_requests: Number(data?.active_supply_requests || 0),
      pending_supply_requests: Number(data?.pending_supply_requests || 0),
      pending_returns: Number(data?.pending_returns || 0),
    });
  }, []);

  const loadCoreData = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

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
      setRefreshing(false);
    }
  }, [fetchIncomingShipments, fetchInventoryData, fetchInventorySummary]);

  const loadSupplyRequests = useCallback(async ({
    page = 1,
    append = false,
    force = false,
  }: {
    page?: number;
    append?: boolean;
    force?: boolean;
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
      const data = await apiClient.get(`/supply-requests?${params.toString()}`) as PaginatedListResponse<SupplyRequestSummary>;
      const items = Array.isArray(data?.items) ? data.items : [];

      setSupplyRequests((current) => {
        if (!append) return items;
        const merged = [...current, ...items];
        return merged.filter((item, index) => merged.findIndex((candidate) => candidate.id === item.id) === index);
      });
      setSupplyRequestsPage(Number(data?.page || page));
      setSupplyRequestsHasMore(Boolean(data?.has_more));
      setSupplyRequestsLoaded(true);
    } catch (loadError: any) {
      setSupplyRequestsError(loadError.message || 'تعذر تحميل طلبات التوريد.');
    } finally {
      setSupplyRequestsLoading(false);
    }
  }, [supplyRequestsLoaded, supplyRequestsLoading]);

  const loadReturnRequests = useCallback(async ({
    page = 1,
    append = false,
    force = false,
  }: {
    page?: number;
    append?: boolean;
    force?: boolean;
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
      const data = await apiClient.get(`/returns?${params.toString()}`) as PaginatedListResponse<ReturnRequestSummary>;
      const items = Array.isArray(data?.items) ? data.items : [];

      setReturnRequests((current) => {
        if (!append) return items;
        const merged = [...current, ...items];
        return merged.filter((item, index) => merged.findIndex((candidate) => candidate.id === item.id) === index);
      });
      setReturnRequestsPage(Number(data?.page || page));
      setReturnRequestsHasMore(Boolean(data?.has_more));
      setReturnRequestsLoaded(true);
    } catch (loadError: any) {
      setReturnRequestsError(loadError.message || 'تعذر تحميل طلبات المرتجع.');
    } finally {
      setReturnRequestsLoading(false);
    }
  }, [returnRequestsLoaded, returnRequestsLoading]);

  const loadShipmentHistory = useCallback(async ({
    page = 1,
    append = false,
    force = false,
  }: {
    page?: number;
    append?: boolean;
    force?: boolean;
  } = {}) => {
    if (shipmentHistoryLoading) return;
    if (!force && shipmentHistoryLoaded && page === 1) return;

    setShipmentHistoryLoading(true);
    setShipmentHistoryError(null);
    try {
      const data = await apiClient.get(`/shipments/history?page=${page}&per_page=10&status=RECEIVED`) as ShipmentHistoryResponse;
      const items = Array.isArray(data?.shipments) ? data.shipments : [];
      setShipmentHistory((current) => {
        if (!append) return items;
        const merged = [...current, ...items];
        return merged.filter((item, index) => merged.findIndex((candidate) => candidate.id === item.id) === index);
      });
      setShipmentHistoryPage(Number(data?.pagination?.page || page));
      setShipmentHistoryHasMore(Boolean(data?.pagination?.has_next));
      setShipmentHistoryLoaded(true);
    } catch (loadError: any) {
      setShipmentHistoryError(loadError.message || 'تعذر تحميل سجل الشحنات.');
    } finally {
      setShipmentHistoryLoading(false);
    }
  }, [shipmentHistoryLoaded, shipmentHistoryLoading]);

  useEffect(() => {
    void loadCoreData();
  }, [loadCoreData]);

  useEffect(() => {
    if (activeTab === 'supply') {
      void loadSupplyRequests();
    }
  }, [activeTab, loadSupplyRequests]);

  useEffect(() => {
    if (activeTab === 'returns') {
      void loadReturnRequests();
    }
  }, [activeTab, loadReturnRequests]);

  useEffect(() => {
    if (activeTab === 'shipments' && shipmentsView === 'history') {
      void loadShipmentHistory();
    }
  }, [activeTab, shipmentsView, loadShipmentHistory]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    document.body.classList.add('inventory-mobile-active');
    return () => {
      document.body.classList.remove('inventory-mobile-active');
      document.body.style.removeProperty('position');
      document.body.style.removeProperty('top');
      document.body.style.removeProperty('left');
      document.body.style.removeProperty('right');
      document.body.style.removeProperty('width');
      window.scrollTo({ top: window.scrollY });
    };
  }, []);

  useEffect(() => {
    if (!hasOpenPanel) return;

    const scrollY = window.scrollY;
    const bodyStyle = document.body.style;
    const previousPosition = bodyStyle.position;
    const previousTop = bodyStyle.top;
    const previousLeft = bodyStyle.left;
    const previousRight = bodyStyle.right;
    const previousWidth = bodyStyle.width;

    bodyStyle.position = 'fixed';
    bodyStyle.top = `-${scrollY}px`;
    bodyStyle.left = '0';
    bodyStyle.right = '0';
    bodyStyle.width = '100%';

    return () => {
      bodyStyle.position = previousPosition;
      bodyStyle.top = previousTop;
      bodyStyle.left = previousLeft;
      bodyStyle.right = previousRight;
      bodyStyle.width = previousWidth;
      window.scrollTo(0, scrollY);
    };
  }, [hasOpenPanel]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const products = inventory?.products || [];
    if (!query) return products;

    return products.filter((product) => (
      product.name.toLowerCase().includes(query) ||
      product.category.toLowerCase().includes(query)
    ));
  }, [inventory?.products, searchQuery]);

  const summary = useMemo(() => {
    const products = inventory?.products || [];
    return {
      productsCount: products.length,
      totalUnits: products.reduce((sum, product) => sum + Number(product.stock_quantity || 0), 0),
      lowStockCount: products.filter((product) => product.status === 'LOW').length,
      outOfStockCount: products.filter((product) => product.status === 'OUT').length,
    };
  }, [inventory?.products]);

  const recentIncomingShipments = useMemo(
    () => incomingShipments.slice(0, 3),
    [incomingShipments],
  );

  const recentActivity = useMemo(
    () => (inventory?.recent_activity || []).slice(0, 5),
    [inventory?.recent_activity],
  );

  const handleCoreRefresh = async () => {
    await loadCoreData({ silent: true });
    if (activeTab === 'supply') {
      await loadSupplyRequests({ force: true, page: 1 });
    }
    if (activeTab === 'returns') {
      await loadReturnRequests({ force: true, page: 1 });
    }
    if (activeTab === 'shipments' && shipmentsView === 'history') {
      await loadShipmentHistory({ force: true, page: 1 });
    }
  };

  const handleConsumeSuccess = async (message: string) => {
    invalidateProductsCacheForBranch(cashier.branch_id);
    setConsumeProduct(null);
    setToastMessage(message);
    await loadCoreData({ silent: true });
  };

  const handleSupplySuccess = async (message: string) => {
    setSupplyComposerOpen(false);
    setToastMessage(message);
    await Promise.all([
      loadCoreData({ silent: true }),
      loadSupplyRequests({ force: true, page: 1 }),
    ]);
  };

  const handleReturnSuccess = async (message: string) => {
    setReturnComposerOpen(false);
    setReturnComposerProduct(null);
    setToastMessage(message);
    await Promise.all([
      loadCoreData({ silent: true }),
      loadReturnRequests({ force: true, page: 1 }),
    ]);
  };

  const handleShipmentReceiveSuccess = async (message: string) => {
    setToastMessage(message);
    await Promise.all([
      loadCoreData({ silent: true }),
      loadSupplyRequests({ force: true, page: 1 }),
      shipmentsView === 'history' ? loadShipmentHistory({ force: true, page: 1 }) : Promise.resolve(),
    ]);
  };

  if (loading) {
    return (
      <div className="inventory-mobile-shell inventory-mobile-shell--centered bg-[#09090b] text-white" dir="rtl">
        <div className="flex min-h-[var(--mini-shell-height)] items-center justify-center px-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-[1.6rem] border border-[#E53935]/20 bg-[#E53935]/10 text-[#E53935]">
              <Loader2 size={24} className="animate-spin" />
            </div>
            <div>
              <p className="text-base font-black text-white">جارٍ تجهيز مخزن الفرع</p>
              <p className="mt-1 text-sm font-medium text-white/45">يتم تحميل صلاحيات الجهاز وبيانات التشغيل</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !inventory) {
    return (
      <div className="inventory-mobile-shell inventory-mobile-shell--centered bg-[#09090b] text-white" dir="rtl">
        <div className="flex min-h-[var(--mini-shell-height)] items-center justify-center px-5">
          <div className="w-full max-w-sm rounded-[2rem] border border-white/5 bg-[#151518] p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1.4rem] border border-[#E53935]/15 bg-[#E53935]/10 text-[#E53935]">
              <AlertCircle size={24} />
            </div>
            <h2 className="mt-4 text-lg font-black text-white">تعذر فتح مخزن الفرع</h2>
            <p className="mt-2 text-sm font-medium leading-7 text-white/50">{error || 'حدثت مشكلة في تحميل البيانات.'}</p>
            <button
              type="button"
              onClick={() => void loadCoreData()}
              className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#E53935] px-4 text-sm font-black text-white"
            >
              <RefreshCw size={16} />
              <span>إعادة المحاولة</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="inventory-mobile-shell bg-[#09090b] font-['Cairo'] text-white"
      dir="rtl"
      style={({ ['--inventory-mobile-nav-height']: `${bottomNavHeight}px` } satisfies React.CSSProperties & { '--inventory-mobile-nav-height': string }) as React.CSSProperties}
    >
      {toastMessage && (
        <div
          className="pointer-events-none fixed left-4 right-4 top-4 z-[220] flex justify-center"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
        >
          <div className="inline-flex max-w-sm items-center gap-2 rounded-2xl border border-emerald-500/15 bg-[#141416] px-4 py-3 text-sm font-bold text-emerald-300 shadow-2xl">
            <CheckCircle2 size={16} />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      <div className="inventory-mobile-page">
        <div className="mx-auto w-full max-w-xl space-y-4">
          <header className="rounded-[2rem] border border-white/5 bg-[radial-gradient(circle_at_top,rgba(229,57,53,0.16),transparent_75%)] bg-[#141416] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={onLogout}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/70"
                aria-label="تسجيل الخروج"
              >
                <LogOut size={17} />
              </button>

              <div className="min-w-0 flex-1 text-right">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#E53935]/20 bg-[#E53935]/10 px-3 py-1 text-[11px] font-bold text-[#ff9a96]">
                  <ShieldCheck size={12} />
                  <span>وضع المخزن فقط</span>
                </div>
                <h1 className="mt-3 text-xl font-black text-white">{cashier.branch_name}</h1>
                <p className="mt-1 text-sm font-medium text-white/45">
                  {deviceContext.device_label || 'جهاز المخزن'} • {cashier.name}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2.5">
              <SummaryPill label="منتجات" value={summary.productsCount} accent="gold" />
              <SummaryPill label="كمية" value={summary.totalUnits} accent="red" />
              <SummaryPill label="منخفض / نفد" value={`${summary.lowStockCount} / ${summary.outOfStockCount}`} accent="gray" />
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('shipments');
                  setShipmentsView('incoming');
                }}
                className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-right"
              >
                <div className="flex items-center justify-between gap-2">
                  <Truck size={16} className="text-[#E6D690]" />
                  <span className="text-xs font-black text-white">{incomingShipments.length} شحنة واردة</span>
                </div>
                <p className="mt-1 text-[11px] font-medium text-white/40">افتح الوارد واستلم الشحنات الجديدة</p>
              </button>
              <button
                type="button"
                onClick={() => void handleCoreRefresh()}
                className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/70"
                aria-label="تحديث"
              >
                <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
              </button>
            </div>
          </header>

          {activeTab === 'products' && (
            <section className="space-y-4">
              <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
                <label className="mb-2 block text-right text-[11px] font-bold text-white/45">ابحث عن منتج</label>
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="اسم المنتج أو الفئة"
                    className="h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] pr-11 pl-4 text-sm font-semibold text-white placeholder-white/20 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {filteredProducts.length ? filteredProducts.map((product) => (
                  <ProductCard
                    key={product.product_id}
                    product={product}
                    onOpen={() => setSelectedProduct(product)}
                  />
                )) : (
                  <EmptyState
                    icon={<Package2 size={20} />}
                    title="لا توجد نتائج"
                    description="جرّب اسم منتج آخر أو افتح القائمة كاملة."
                  />
                )}
              </div>

              <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setActivityPanelOpen(true)}
                    className="text-xs font-bold text-[#E6D690]"
                  >
                    كل الحركة
                  </button>
                  <div className="text-right">
                    <h2 className="text-sm font-black text-white">آخر حركة بالمخزن</h2>
                    <p className="mt-1 text-[11px] font-medium text-white/40">استهلاك داخلي وتغييرات المخزون الأخيرة</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2.5">
                  {recentActivity.length ? recentActivity.map((item) => (
                    <ActivityListItem key={item.id} item={item} />
                  )) : (
                    <EmptyState
                      icon={<Activity size={18} />}
                      title="لا توجد حركة حديثة"
                      description="ستظهر هنا آخر العمليات المرتبطة بمخزن الفرع."
                      compact
                    />
                  )}
                </div>
              </div>
            </section>
          )}

          {activeTab === 'supply' && (
            <section className="space-y-4">
              <SectionCard
                title="طلبات التوريد"
                subtitle="أنشئ طلباً جديداً أو راجع الطلبات الحالية."
                action={(
                  <button
                    type="button"
                    onClick={() => setSupplyComposerOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#E6D690] px-3 py-2 text-[11px] font-black text-[#121212]"
                  >
                    <Plus size={14} />
                    <span>طلب جديد</span>
                  </button>
                )}
              />

              {supplyRequestsError && (
                <InlineError message={supplyRequestsError} onRetry={() => void loadSupplyRequests({ force: true, page: 1 })} />
              )}

              <div className="space-y-3">
                {supplyRequestsLoading && !supplyRequests.length ? (
                  <InlineLoading label="جارٍ تحميل طلبات التوريد..." />
                ) : supplyRequests.length ? (
                  <>
                    {supplyRequests.map((request) => (
                      <SupplyRequestListItem
                        key={request.id}
                        request={request}
                        onOpen={() => setSelectedSupplyRequestId(request.id)}
                      />
                    ))}
                    {supplyRequestsHasMore && (
                      <LoadMoreButton
                        loading={supplyRequestsLoading}
                        onClick={() => void loadSupplyRequests({ page: supplyRequestsPage + 1, append: true, force: true })}
                      />
                    )}
                  </>
                ) : (
                  <EmptyState
                    icon={<ClipboardList size={20} />}
                    title="لا توجد طلبات حالية"
                    description="يمكنك إنشاء أول طلب توريد من الزر بالأعلى."
                  />
                )}
              </div>
            </section>
          )}

          {activeTab === 'shipments' && (
            <section className="space-y-4">
              <SectionCard
                title="الوارد والسجل"
                subtitle="استلم الشحنات الجديدة أو راجع الشحنات المستلمة."
              />

              <div className="grid grid-cols-2 gap-2 rounded-[1.8rem] border border-white/5 bg-[#141416] p-2">
                <SegmentButton
                  active={shipmentsView === 'incoming'}
                  label="الوارد"
                  count={incomingShipments.length}
                  onClick={() => setShipmentsView('incoming')}
                />
                <SegmentButton
                  active={shipmentsView === 'history'}
                  label="السجل"
                  onClick={() => setShipmentsView('history')}
                />
              </div>

              {shipmentsView === 'incoming' ? (
                <div className="space-y-3">
                  {recentIncomingShipments.length ? recentIncomingShipments.map((shipment) => (
                    <ShipmentListItem
                      key={shipment.id}
                      shipment={shipment}
                      onOpen={() => setSelectedShipmentId(shipment.id)}
                    />
                  )) : (
                    <EmptyState
                      icon={<Truck size={20} />}
                      title="لا توجد شحنات واردة"
                      description="حين ترسل الإدارة شحنة جديدة ستظهر هنا."
                    />
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {shipmentHistoryError && (
                    <InlineError message={shipmentHistoryError} onRetry={() => void loadShipmentHistory({ force: true, page: 1 })} />
                  )}
                  {shipmentHistoryLoading && !shipmentHistory.length ? (
                    <InlineLoading label="جارٍ تحميل سجل الشحنات..." />
                  ) : shipmentHistory.length ? (
                    <>
                      {shipmentHistory.map((shipment) => (
                        <ShipmentHistoryListItem
                          key={shipment.id}
                          shipment={shipment}
                          onOpen={() => setSelectedShipmentId(shipment.id)}
                        />
                      ))}
                      {shipmentHistoryHasMore && (
                        <LoadMoreButton
                          loading={shipmentHistoryLoading}
                          onClick={() => void loadShipmentHistory({ page: shipmentHistoryPage + 1, append: true, force: true })}
                        />
                      )}
                    </>
                  ) : (
                    <EmptyState
                      icon={<ClipboardList size={20} />}
                      title="السجل فارغ"
                      description="لا توجد شحنات مستلمة حتى الآن."
                    />
                  )}
                </div>
              )}
            </section>
          )}

          {activeTab === 'returns' && (
            <section className="space-y-4">
              <SectionCard
                title="طلبات المرتجع"
                subtitle="تابع الحالات الحالية أو أنشئ طلباً جديداً."
                action={(
                  <button
                    type="button"
                    onClick={() => {
                      setReturnComposerProduct(null);
                      setReturnComposerOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#E6D690] px-3 py-2 text-[11px] font-black text-[#121212]"
                  >
                    <Plus size={14} />
                    <span>طلب جديد</span>
                  </button>
                )}
              />

              {returnRequestsError && (
                <InlineError message={returnRequestsError} onRetry={() => void loadReturnRequests({ force: true, page: 1 })} />
              )}

              <div className="space-y-3">
                {returnRequestsLoading && !returnRequests.length ? (
                  <InlineLoading label="جارٍ تحميل طلبات المرتجع..." />
                ) : returnRequests.length ? (
                  <>
                    {returnRequests.map((request) => (
                      <ReturnRequestListItem
                        key={request.id}
                        request={request}
                        onOpen={() => setSelectedReturnRequestId(request.id)}
                      />
                    ))}
                    {returnRequestsHasMore && (
                      <LoadMoreButton
                        loading={returnRequestsLoading}
                        onClick={() => void loadReturnRequests({ page: returnRequestsPage + 1, append: true, force: true })}
                      />
                    )}
                  </>
                ) : (
                  <EmptyState
                    icon={<RotateCcw size={20} />}
                    title="لا توجد طلبات مرتجع"
                    description="ابدأ طلباً جديداً من الزر بالأعلى عند الحاجة."
                  />
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      <BottomNav activeTab={activeTab} onChange={setActiveTab} onHeightChange={setBottomNavHeight} />

      <MobileInventoryProductPanel
        product={selectedProduct}
        recentActivity={inventory.recent_activity || []}
        onClose={() => setSelectedProduct(null)}
        onConsume={(product) => {
          setSelectedProduct(null);
          setConsumeProduct(product);
        }}
        onCreateReturn={(product) => {
          setSelectedProduct(null);
          setReturnComposerProduct(product);
          setReturnComposerOpen(true);
        }}
      />

      <MobileConsumePanel
        product={consumeProduct}
        onClose={() => setConsumeProduct(null)}
        onSuccess={handleConsumeSuccess}
      />

      <MobileSupplyRequestComposerPanel
        isOpen={supplyComposerOpen}
        onClose={() => setSupplyComposerOpen(false)}
        onSuccess={handleSupplySuccess}
      />

      <MobileSupplyRequestDetailsPanel
        requestId={selectedSupplyRequestId}
        onClose={() => setSelectedSupplyRequestId(null)}
      />

      <MobileShipmentDetailsPanel
        shipmentId={selectedShipmentId}
        onClose={() => setSelectedShipmentId(null)}
        onReceived={handleShipmentReceiveSuccess}
      />

      <MobileReturnRequestComposerPanel
        isOpen={returnComposerOpen}
        product={returnComposerProduct}
        onClose={() => {
          setReturnComposerOpen(false);
          setReturnComposerProduct(null);
        }}
        onSuccess={handleReturnSuccess}
      />

      <MobileReturnRequestDetailsPanel
        requestId={selectedReturnRequestId}
        onClose={() => setSelectedReturnRequestId(null)}
      />

      <MobileActivityPanel
        isOpen={activityPanelOpen}
        onClose={() => setActivityPanelOpen(false)}
      />
    </div>
  );
};

const BottomNav: React.FC<{
  activeTab: MobileInventoryTab;
  onChange: (tab: MobileInventoryTab) => void;
  onHeightChange: (height: number) => void;
}> = ({ activeTab, onChange, onHeightChange }) => {
  const navRef = useRef<HTMLElement | null>(null);
  const items: Array<{ id: MobileInventoryTab; label: string; icon: React.ReactNode }> = [
    { id: 'products', label: 'المخزون', icon: <Package2 size={17} /> },
    { id: 'supply', label: 'الطلبات', icon: <ClipboardList size={17} /> },
    { id: 'shipments', label: 'الوارد', icon: <Truck size={17} /> },
    { id: 'returns', label: 'المرتجع', icon: <RotateCcw size={17} /> },
  ];

  useEffect(() => {
    const node = navRef.current;
    if (!node) return;

    const measure = () => onHeightChange(Math.max(node.offsetHeight, MOBILE_NAV_FALLBACK_HEIGHT));
    measure();

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    resizeObserver?.observe(node);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [onHeightChange]);

  return (
    <nav
      ref={navRef}
      className="inventory-mobile-nav"
    >
      <div className="mx-auto grid max-w-xl grid-cols-4 gap-2">
        {items.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={`flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-3 text-[11px] font-black transition-all ${
                active
                  ? 'bg-[#E53935] text-white shadow-[0_12px_26px_rgba(229,57,53,0.22)]'
                  : 'bg-white/[0.03] text-white/50'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

const SummaryPill: React.FC<{
  label: string;
  value: number | string;
  accent: 'gold' | 'red' | 'gray';
}> = ({ label, value, accent }) => {
  const classes = {
    gold: 'border-[#E6D690]/14 bg-[#E6D690]/8 text-[#E6D690]',
    red: 'border-[#E53935]/14 bg-[#E53935]/8 text-[#ff9a96]',
    gray: 'border-white/8 bg-white/[0.03] text-white/70',
  }[accent];

  return (
    <div className={`rounded-2xl border px-3 py-3 text-right ${classes}`}>
      <span className="block text-[10px] font-bold">{label}</span>
      <span className="mt-1 block text-lg font-black">{value.toLocaleString('ar-EG')}</span>
    </div>
  );
};

const SectionCard: React.FC<{
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}> = ({ title, subtitle, action }) => (
  <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
    <div className="flex items-start justify-between gap-3">
      {action || <div />}
      <div className="text-right">
        <h2 className="text-sm font-black text-white">{title}</h2>
        <p className="mt-1 text-[11px] font-medium leading-6 text-white/40">{subtitle}</p>
      </div>
    </div>
  </div>
);

const SegmentButton: React.FC<{
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}> = ({ active, label, count, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-2xl px-3 py-3 text-sm font-black transition-all ${
      active ? 'bg-[#E6D690] text-[#121212]' : 'bg-white/[0.03] text-white/55'
    }`}
  >
    <span>{label}</span>
    {typeof count === 'number' && count > 0 && (
      <span className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${active ? 'bg-black/10 text-[#121212]' : 'bg-[#E53935]/12 text-[#ff9a96]'}`}>
        {count}
      </span>
    )}
  </button>
);

const ProductCard: React.FC<{
  product: BranchInventoryProduct;
  onOpen: () => void;
}> = ({ product, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    className="w-full rounded-[1.8rem] border border-white/5 bg-[#141416] p-3 text-right shadow-[0_12px_30px_rgba(0,0,0,0.18)]"
  >
    <div className="flex items-center gap-3">
      <ProductThumb src={resolveImageUrl(product.image_url)} alt={product.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="text-left">
            <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${statusClass(product.status)}`}>
              {statusLabel(product.status)}
            </span>
          </div>
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-black text-white">{product.name}</p>
            <p className="mt-1 text-[11px] font-medium text-white/40">{product.category}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] font-medium text-white/35">اضغط للتفاصيل</span>
          <div className="text-left">
            <p className="text-lg font-black text-white">{Number(product.stock_quantity || 0).toLocaleString('ar-EG')}</p>
            <p className="text-[10px] font-medium text-white/40">{product.unit}</p>
          </div>
        </div>
      </div>
    </div>
  </button>
);

const ActivityListItem: React.FC<{ item: BranchInventoryActivity }> = ({ item }) => (
  <div className="rounded-2xl border border-white/5 bg-white/[0.02] px-3 py-3 text-right">
    <div className="flex items-start justify-between gap-3">
      <div className="text-left">
        <span className="text-xs font-black text-white">{Number(item.quantity || 0).toLocaleString('ar-EG')}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-white">{item.product_name}</p>
        <p className="mt-1 text-[11px] font-medium text-white/45">{item.reason || 'حركة مخزون'}</p>
      </div>
    </div>
    <div className="mt-2 text-[10px] font-medium text-white/35">{formatRelativeTime(item.created_at)}</div>
  </div>
);

const SupplyRequestListItem: React.FC<{
  request: SupplyRequestSummary;
  onOpen: () => void;
}> = ({ request, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    className="w-full rounded-[1.8rem] border border-white/5 bg-[#141416] p-4 text-right"
  >
    <div className="flex items-start justify-between gap-3">
      <ArrowRight size={16} className="shrink-0 text-white/35" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-300">
            {request.shipment_status === 'CANCELLED' ? 'الشحنة ملغاة' : request.status === 'PENDING' ? 'بانتظار المراجعة' : request.status === 'SENT' ? 'تم الشحن' : 'تم الاستلام'}
          </span>
          <p className="font-mono text-xs font-bold text-[#E6D690]">{request.request_ref}</p>
        </div>
        <p className="mt-3 text-sm font-black text-white">{request.items_count || request.items?.length || 0} صنف</p>
        <p className="mt-1 text-[11px] font-medium text-white/40">
          {request.total_requested_quantity || 0} قطعة • {formatRelativeTime(request.created_at)}
        </p>
      </div>
    </div>
  </button>
);

const ShipmentListItem: React.FC<{
  shipment: IncomingShipmentSummary;
  onOpen: () => void;
}> = ({ shipment, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    className="w-full rounded-[1.8rem] border border-white/5 bg-[#141416] p-4 text-right"
  >
    <div className="flex items-start justify-between gap-3">
      <ArrowRight size={16} className="shrink-0 text-white/35" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full border border-[#E53935]/20 bg-[#E53935]/10 px-2.5 py-1 text-[10px] font-bold text-[#ff9a96]">
            {shipmentStatusLabel[shipment.status]}
          </span>
          <p className="font-mono text-xs font-bold text-[#E6D690]">{shipment.shipment_ref}</p>
        </div>
        <p className="mt-3 text-sm font-black text-white">{shipment.items_count} أصناف • {shipment.total_quantity} قطعة</p>
        <p className="mt-1 text-[11px] font-medium text-white/40">{shipment.source_branch_name} • {formatRelativeTime(shipment.created_at)}</p>
      </div>
    </div>
  </button>
);

const ShipmentHistoryListItem: React.FC<{
  shipment: ShipmentHistorySummary;
  onOpen: () => void;
}> = ({ shipment, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    className="w-full rounded-[1.8rem] border border-white/5 bg-[#141416] p-4 text-right"
  >
    <div className="flex items-start justify-between gap-3">
      <ArrowRight size={16} className="shrink-0 text-white/35" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">
            تم الاستلام
          </span>
          <p className="font-mono text-xs font-bold text-[#E6D690]">{shipment.shipment_ref}</p>
        </div>
        <p className="mt-3 text-sm font-black text-white">{shipment.items_count} أصناف • {shipment.total_quantity} قطعة</p>
        <p className="mt-1 text-[11px] font-medium text-white/40">{formatDateTime(shipment.received_at || shipment.created_at)}</p>
      </div>
    </div>
  </button>
);

const ReturnRequestListItem: React.FC<{
  request: ReturnRequestSummary;
  onOpen: () => void;
}> = ({ request, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    className="w-full rounded-[1.8rem] border border-white/5 bg-[#141416] p-4 text-right"
  >
    <div className="flex items-start justify-between gap-3">
      <ArrowRight size={16} className="shrink-0 text-white/35" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${returnStatusClass(request.status)}`}>
            {returnStatusLabel[request.status]}
          </span>
          <p className="font-mono text-xs font-bold text-[#E6D690]">{request.return_ref}</p>
        </div>
        <p className="mt-3 truncate text-sm font-black text-white">{request.product_name}</p>
        <p className="mt-1 text-[11px] font-medium text-white/40">
          {request.requested_quantity} {request.product_unit} • {request.reason_label}
        </p>
      </div>
    </div>
  </button>
);

const MobilePanel: React.FC<{
  isOpen: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ isOpen, title, subtitle, onClose, children, footer }) => {
  if (!isOpen) return null;

  return (
    <div className="inventory-mobile-panel" dir="rtl">
      <div className="inventory-mobile-panel-frame">
        <div className="flex items-center justify-between gap-4 border-b border-white/5 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/70"
          >
            <X size={18} />
          </button>
          <div className="min-w-0 flex-1 text-right">
            <h2 className="truncate text-base font-black text-white">{title}</h2>
            {subtitle && <p className="mt-1 text-[11px] font-medium text-white/40">{subtitle}</p>}
          </div>
        </div>

        <div className="inventory-mobile-panel-body">{children}</div>
        {footer && <div className="inventory-mobile-panel-footer">{footer}</div>}
      </div>
    </div>
  );
};

const MobileInventoryProductPanel: React.FC<{
  product: BranchInventoryProduct | null;
  recentActivity: BranchInventoryActivity[];
  onClose: () => void;
  onConsume: (product: BranchInventoryProduct) => void;
  onCreateReturn: (product: BranchInventoryProduct) => void;
}> = ({ product, recentActivity, onClose, onConsume, onCreateReturn }) => {
  const [details, setDetails] = useState<BranchInventoryProductDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!product) return;

    let isActive = true;
    setLoading(true);
    setError(null);
    setDetails(null);

    apiClient.get(`/inventory/products/${product.product_id}/details`)
      .then((data) => {
        if (!isActive) return;
        setDetails(data as BranchInventoryProductDetails);
      })
      .catch((loadError: any) => {
        if (!isActive) return;
        setError(loadError.message || 'تعذر تحميل تفاصيل المنتج.');
      })
      .finally(() => {
        if (!isActive) return;
        setLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [product]);

  if (!product) return null;

  const productActivity = recentActivity.filter((item) => item.product_id === product.product_id).slice(0, 4);

  return (
    <MobilePanel
      isOpen={Boolean(product)}
      title={product.name}
      subtitle={product.category}
      onClose={onClose}
      footer={(
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onCreateReturn(product)}
            className="h-12 rounded-2xl border border-[#E6D690]/20 bg-[#E6D690]/10 text-sm font-black text-[#E6D690]"
          >
            طلب مرتجع
          </button>
          <button
            type="button"
            onClick={() => onConsume(product)}
            className="h-12 rounded-2xl bg-[#E53935] text-sm font-black text-white"
          >
            تسجيل استهلاك
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
          <div className="flex items-center gap-3">
            <ProductThumb src={resolveImageUrl(product.image_url)} alt={product.name} size="lg" />
            <div className="min-w-0 flex-1 text-right">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass(product.status)}`}>
                {statusLabel(product.status)}
              </span>
              <p className="mt-3 text-3xl font-black text-white">{Number(product.stock_quantity || 0).toLocaleString('ar-EG')}</p>
              <p className="mt-1 text-sm font-medium text-white/45">{product.unit} متاحة الآن</p>
            </div>
          </div>
        </div>

        {loading ? (
          <InlineLoading label="جارٍ تحميل تفاصيل المنتج..." />
        ) : error ? (
          <InlineError message={error} />
        ) : details ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <InfoCard label="الحد الأدنى" value={`${details.product.min_stock_threshold} ${details.product.unit}`} />
              <InfoCard label="آخر توريد" value={formatDateTime(details.latest_received_at)} />
              <InfoCard label="أقرب صلاحية" value={formatDateTime(details.nearest_expiration)} />
              <InfoCard label="عدد الدفعات" value={String(details.batches.length)} />
            </div>

            <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
              <h3 className="text-sm font-black text-white">الدفعات الحالية</h3>
              <div className="mt-3 space-y-2.5">
                {details.batches.length ? details.batches.map((batch) => (
                  <div key={batch.batch_id} className="rounded-2xl border border-white/5 bg-white/[0.02] p-3 text-right">
                    <div className="flex items-center justify-between gap-3">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${batchStatusClass(batch.status)}`}>
                        {batchStatusLabel(batch.status)}
                      </span>
                      <p className="font-mono text-xs font-bold text-[#E6D690]">{batch.batch_number}</p>
                    </div>
                    <p className="mt-2 text-sm font-black text-white">{batch.remaining_quantity} {product.unit}</p>
                    <p className="mt-1 text-[11px] font-medium text-white/40">الصلاحية: {formatDateTime(batch.expiration_date)}</p>
                  </div>
                )) : (
                  <EmptyState
                    icon={<Package2 size={18} />}
                    title="لا توجد دفعات"
                    description="لم يتم العثور على تفاصيل دفعات لهذا المنتج."
                    compact
                  />
                )}
              </div>
            </div>
          </>
        ) : null}

        <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium text-white/35">{productActivity.length} حركة</span>
            <h3 className="text-sm font-black text-white">آخر حركة لهذا المنتج</h3>
          </div>
          <div className="mt-3 space-y-2.5">
            {productActivity.length ? productActivity.map((item) => (
              <ActivityListItem key={item.id} item={item} />
            )) : (
              <EmptyState
                icon={<Activity size={18} />}
                title="لا توجد حركة حديثة"
                description="ستظهر هنا أحدث العمليات المرتبطة بهذا المنتج."
                compact
              />
            )}
          </div>
        </div>
      </div>
    </MobilePanel>
  );
};

const MobileConsumePanel: React.FC<{
  product: BranchInventoryProduct | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}> = ({ product, onClose, onSuccess }) => {
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('استخدام داخلي');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!product) return;
    setQuantity(product.stock_quantity > 0 ? 1 : 0);
    setReason('استخدام داخلي');
    setNote('');
    setError(null);
    setSubmitting(false);
  }, [product]);

  if (!product) return null;

  const submit = async () => {
    setError(null);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError('أدخل كمية صحيحة أكبر من الصفر.');
      return;
    }
    if (quantity > product.stock_quantity) {
      setError('الكمية المطلوبة أكبر من المتاح حالياً.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiClient.post('/products/consume', {
        product_id: product.product_id,
        quantity,
        reason,
        note: note.trim() || null,
      });
      await onSuccess(response.message || 'تم تسجيل الاستهلاك بنجاح.');
    } catch (submitError: any) {
      setError(submitError.message || 'تعذر تسجيل الاستهلاك.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MobilePanel
      isOpen={Boolean(product)}
      title="تسجيل استهلاك"
      subtitle={product.name}
      onClose={onClose}
      footer={(
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="h-12 w-full rounded-2xl bg-[#E53935] text-sm font-black text-white disabled:opacity-60"
        >
          {submitting ? 'جارٍ الحفظ...' : 'تأكيد التسجيل'}
        </button>
      )}
    >
      <div className="space-y-4">
        <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4 text-right">
          <p className="text-sm font-black text-white">{product.name}</p>
          <p className="mt-1 text-[11px] font-medium text-white/40">
            المتاح: {product.stock_quantity} {product.unit}
          </p>
        </div>

        <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
          <label className="mb-2 block text-right text-[11px] font-bold text-white/45">الكمية</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQuantity((current) => Math.max(1, current - 1))}
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-xl font-black text-white"
            >
              -
            </button>
            <input
              type="number"
              min={1}
              max={product.stock_quantity}
              value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Math.min(product.stock_quantity, Number(event.target.value || 1))))}
              className="h-12 flex-1 rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-center text-lg font-black text-white outline-none"
            />
            <button
              type="button"
              onClick={() => setQuantity((current) => Math.min(product.stock_quantity, current + 1))}
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-xl font-black text-white"
            >
              +
            </button>
          </div>
        </div>

        <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
          <label className="mb-2 block text-right text-[11px] font-bold text-white/45">السبب</label>
          <div className="grid grid-cols-2 gap-2">
            {['استخدام داخلي', 'تالف', 'تنظيف', 'أخرى'].map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setReason(option)}
                className={`rounded-2xl px-3 py-3 text-sm font-bold ${reason === option ? 'bg-[#E6D690] text-[#121212]' : 'bg-white/[0.03] text-white/60'}`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        {reason === 'أخرى' && (
          <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
            <label className="mb-2 block text-right text-[11px] font-bold text-white/45">ملاحظة</label>
            <textarea
              rows={4}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="اكتب ملاحظة مختصرة"
              className="w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm font-medium text-white outline-none"
            />
          </div>
        )}

        {error && <InlineError message={error} />}
      </div>
    </MobilePanel>
  );
};

const MobileSupplyRequestComposerPanel: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}> = ({ isOpen, onClose, onSuccess }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchableProduct[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Array<{ product_id: number; product_name: string; quantity: number; unit: string }>>([]);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery('');
    setSearchResults([]);
    setSearchLoading(false);
    setSearchError(null);
    setSelectedItems([]);
    setNote('');
    setSubmitting(false);
    setError(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const data = await apiClient.get(`/products/search?q=${encodeURIComponent(query)}&include_zero_stock=true&limit=20`);
        setSearchResults(Array.isArray(data) ? data as SearchableProduct[] : []);
      } catch (loadError: any) {
        setSearchError(loadError.message || 'تعذر تحميل المنتجات.');
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [isOpen, searchQuery]);

  const availableResults = useMemo(() => {
    const selectedIds = new Set(selectedItems.map((item) => item.product_id));
    return searchResults.filter((product) => !selectedIds.has(product.id));
  }, [searchResults, selectedItems]);

  const submit = async () => {
    if (!selectedItems.length) {
      setError('أضف منتجاً واحداً على الأقل.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/supply-requests', {
        note: note.trim() || null,
        items: selectedItems.map((item) => ({
          product_id: item.product_id,
          requested_quantity: item.quantity,
        })),
      });
      await onSuccess('تم إرسال طلب التوريد بنجاح.');
    } catch (submitError: any) {
      setError(submitError.message || 'تعذر إرسال الطلب.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MobilePanel
      isOpen={isOpen}
      title="طلب توريد جديد"
      subtitle="أضف المنتجات والكميات المطلوبة للمخزن."
      onClose={onClose}
      footer={(
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="h-12 w-full rounded-2xl bg-[#E6D690] text-sm font-black text-[#121212] disabled:opacity-60"
        >
          {submitting ? 'جارٍ الإرسال...' : 'إرسال الطلب'}
        </button>
      )}
    >
      <div className="space-y-4">
        <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
          <label className="mb-2 block text-right text-[11px] font-bold text-white/45">ابحث عن منتج</label>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="ابحث باسم المنتج"
              className="h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] pr-11 pl-4 text-sm font-semibold text-white outline-none"
            />
          </div>
          {searchLoading ? (
            <div className="mt-3 text-center text-xs font-medium text-white/40">جارٍ البحث...</div>
          ) : searchError ? (
            <div className="mt-3 text-center text-xs font-medium text-[#ff9a96]">{searchError}</div>
          ) : availableResults.length ? (
            <div className="mt-3 space-y-2">
              {availableResults.slice(0, 8).map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => {
                    setSelectedItems((current) => [
                      ...current,
                      {
                        product_id: product.id,
                        product_name: product.name,
                        quantity: 1,
                        unit: product.unit || 'قطعة',
                      },
                    ]);
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                  className="flex w-full items-center justify-between rounded-2xl border border-white/5 bg-white/[0.02] px-3 py-3 text-right"
                >
                  <span className="text-[11px] font-medium text-white/35">{product.stock_quantity} {product.unit}</span>
                  <div>
                    <p className="text-sm font-bold text-white">{product.name}</p>
                    <p className="mt-1 text-[11px] font-medium text-white/40">{product.category}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : queryHasValue(searchQuery) ? (
            <div className="mt-3 text-center text-xs font-medium text-white/35">لا توجد نتائج مطابقة.</div>
          ) : null}
        </div>

        <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-black text-white">{selectedItems.length}</span>
            <h3 className="text-sm font-black text-white">المنتجات المطلوبة</h3>
          </div>
          <div className="mt-3 space-y-2.5">
            {selectedItems.length ? selectedItems.map((item) => (
              <div key={item.product_id} className="rounded-2xl border border-white/5 bg-white/[0.02] p-3 text-right">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedItems((current) => current.filter((entry) => entry.product_id !== item.product_id))}
                    className="text-[#ff9a96]"
                  >
                    <X size={16} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-white">{item.product_name}</p>
                    <p className="mt-1 text-[11px] font-medium text-white/40">{item.unit}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedItems((current) => current.map((entry) => entry.product_id === item.product_id ? { ...entry, quantity: Math.max(1, entry.quantity - 1) } : entry))}
                    className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(event) => setSelectedItems((current) => current.map((entry) => entry.product_id === item.product_id ? { ...entry, quantity: Math.max(1, Number(event.target.value || 1)) } : entry))}
                    className="h-10 flex-1 rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-center text-sm font-black text-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedItems((current) => current.map((entry) => entry.product_id === item.product_id ? { ...entry, quantity: entry.quantity + 1 } : entry))}
                    className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white"
                  >
                    +
                  </button>
                </div>
              </div>
            )) : (
              <EmptyState
                icon={<Plus size={18} />}
                title="لم تتم إضافة منتجات بعد"
                description="ابدأ بالبحث ثم أضف المنتجات المطلوبة."
                compact
              />
            )}
          </div>
        </div>

        <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
          <label className="mb-2 block text-right text-[11px] font-bold text-white/45">ملاحظة</label>
          <textarea
            rows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="ملاحظة اختيارية للإدارة"
            className="w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm font-medium text-white outline-none"
          />
        </div>

        {error && <InlineError message={error} />}
      </div>
    </MobilePanel>
  );
};

const MobileSupplyRequestDetailsPanel: React.FC<{
  requestId: number | null;
  onClose: () => void;
}> = ({ requestId, onClose }) => {
  const [request, setRequest] = useState<SupplyRequestSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requestId) return;
    let isActive = true;
    setLoading(true);
    setError(null);
    setRequest(null);

    apiClient.get(`/supply-requests/${requestId}`)
      .then((data) => {
        if (!isActive) return;
        setRequest(data as SupplyRequestSummary);
      })
      .catch((loadError: any) => {
        if (!isActive) return;
        setError(loadError.message || 'تعذر تحميل تفاصيل الطلب.');
      })
      .finally(() => {
        if (!isActive) return;
        setLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [requestId]);

  return (
    <MobilePanel
      isOpen={Boolean(requestId)}
      title="تفاصيل طلب التوريد"
      subtitle={request?.request_ref}
      onClose={onClose}
    >
      {loading ? (
        <InlineLoading label="جارٍ تحميل التفاصيل..." />
      ) : error ? (
        <InlineError message={error} />
      ) : request ? (
        <div className="space-y-4">
          <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4 text-right">
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-300">
                {request.shipment_status === 'CANCELLED' ? 'الشحنة ملغاة' : request.status === 'PENDING' ? 'بانتظار المراجعة' : request.status === 'SENT' ? 'تم الشحن' : 'تم الاستلام'}
              </span>
              <p className="font-mono text-xs font-bold text-[#E6D690]">{request.request_ref}</p>
            </div>
            <p className="mt-3 text-sm font-medium text-white/45">{formatDateTime(request.created_at)}</p>
            {request.note && <p className="mt-3 text-sm leading-7 text-white/75">{request.note}</p>}
          </div>

          <div className="space-y-2.5">
            {(request.items || []).map((item) => (
              <div key={item.id || `${item.product_id}-${item.product_name}`} className="rounded-2xl border border-white/5 bg-[#141416] p-3 text-right">
                <p className="text-sm font-black text-white">{item.product_name}</p>
                <p className="mt-1 text-[11px] font-medium text-white/40">
                  المطلوبة: {item.requested_quantity} {item.unit || 'قطعة'}
                </p>
                {item.final_quantity !== null && item.final_quantity !== undefined && (
                  <p className="mt-1 text-[11px] font-medium text-[#E6D690]">
                    المشحونة: {item.final_quantity} {item.unit || 'قطعة'}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </MobilePanel>
  );
};

const MobileShipmentDetailsPanel: React.FC<{
  shipmentId: number | null;
  onClose: () => void;
  onReceived: (message: string) => void;
}> = ({ shipmentId, onClose, onReceived }) => {
  const [shipment, setShipment] = useState<IncomingShipmentDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!shipmentId) return;
    let isActive = true;
    setLoading(true);
    setError(null);
    setShipment(null);

    apiClient.get(`/shipments/${shipmentId}`)
      .then((data) => {
        if (!isActive) return;
        setShipment(data as IncomingShipmentDetails);
      })
      .catch((loadError: any) => {
        if (!isActive) return;
        setError(loadError.message || 'تعذر تحميل بيانات الشحنة.');
      })
      .finally(() => {
        if (!isActive) return;
        setLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [shipmentId]);

  const confirmReceive = async () => {
    if (!shipmentId || !shipment || shipment.status !== 'IN_TRANSIT') return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiClient.post(`/shipments/${shipmentId}/receive`, {});
      await onReceived(data.message || 'تم استلام الشحنة بنجاح.');
      onClose();
    } catch (submitError: any) {
      setError(submitError.message || 'تعذر استلام الشحنة.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MobilePanel
      isOpen={Boolean(shipmentId)}
      title="تفاصيل الشحنة"
      subtitle={shipment?.shipment_ref}
      onClose={onClose}
      footer={shipment && shipment.status === 'IN_TRANSIT' ? (
        <button
          type="button"
          onClick={() => void confirmReceive()}
          disabled={submitting}
          className="h-12 w-full rounded-2xl bg-[#E53935] text-sm font-black text-white disabled:opacity-60"
        >
          {submitting ? 'جارٍ التأكيد...' : 'تأكيد استلام الشحنة'}
        </button>
      ) : undefined}
    >
      {loading ? (
        <InlineLoading label="جارٍ تحميل تفاصيل الشحنة..." />
      ) : error ? (
        <InlineError message={error} />
      ) : shipment ? (
        <div className="space-y-4">
          <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4 text-right">
            <div className="flex items-center justify-between gap-3">
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${shipment.status === 'RECEIVED' ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border border-[#E53935]/20 bg-[#E53935]/10 text-[#ff9a96]'}`}>
                {shipmentStatusLabel[shipment.status]}
              </span>
              <p className="font-mono text-xs font-bold text-[#E6D690]">{shipment.shipment_ref}</p>
            </div>
            <p className="mt-3 text-sm font-medium text-white/70">من {shipment.source_branch_name}</p>
            <p className="mt-1 text-[11px] font-medium text-white/40">أُرسلت {formatDateTime(shipment.created_at)}</p>
            {shipment.note && <p className="mt-3 text-sm leading-7 text-white/75">{shipment.note}</p>}
          </div>

          <div className="space-y-2.5">
            {shipment.items.map((item) => (
              <div key={`${shipment.id}-${item.product_id}`} className="rounded-2xl border border-white/5 bg-[#141416] p-3 text-right">
                <div className="flex items-center gap-3">
                  <ProductThumb src={resolveImageUrl(item.image_url)} alt={item.product_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-white">{item.product_name}</p>
                    <p className="mt-1 text-[11px] font-medium text-white/40">{item.quantity} قطعة</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {shipment.status === 'IN_TRANSIT' && (
            <div className="rounded-[1.8rem] border border-[#E6D690]/14 bg-[#E6D690]/8 px-4 py-3 text-right text-[11px] font-medium leading-6 text-[#E6D690]">
              تأكد من مطابقة الأصناف والكميات قبل تأكيد الاستلام. لا تضغط الزر مرتين.
            </div>
          )}
        </div>
      ) : null}
    </MobilePanel>
  );
};

const MobileReturnRequestComposerPanel: React.FC<{
  isOpen: boolean;
  product: BranchInventoryProduct | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}> = ({ isOpen, product, onClose, onSuccess }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchableProduct[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<BranchInventoryProduct | null>(product);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<ReturnRequestReason | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedProduct(product);
    setSearchQuery('');
    setSearchResults([]);
    setSearchLoading(false);
    setSearchError(null);
    setQuantity(1);
    setReason('');
    setNotes('');
    setSubmitting(false);
    setError(null);
  }, [isOpen, product]);

  useEffect(() => {
    if (!isOpen || selectedProduct) return;
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const data = await apiClient.get(`/products/search?q=${encodeURIComponent(query)}&include_zero_stock=true&limit=20`);
        const mapped = Array.isArray(data) ? (data as SearchableProduct[]).map((entry) => toBranchInventoryProduct(entry)) : [];
        setSearchResults(mapped.map((entry) => ({
          id: entry.product_id,
          name: entry.name,
          category: entry.category,
          unit: entry.unit,
          image_url: entry.image_url,
          stock_quantity: entry.stock_quantity,
          min_stock_threshold: entry.min_stock_threshold,
          status: entry.status,
        })));
      } catch (loadError: any) {
        setSearchError(loadError.message || 'تعذر تحميل المنتجات.');
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [isOpen, searchQuery, selectedProduct]);

  const submit = async () => {
    if (!selectedProduct) {
      setError('اختر منتجاً أولاً.');
      return;
    }
    if (!reason) {
      setError('اختر سبب المرتجع.');
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError('أدخل كمية صحيحة.');
      return;
    }
    if (quantity > selectedProduct.stock_quantity) {
      setError('الكمية المطلوبة أكبر من الرصيد الحالي.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await apiClient.post('/returns', {
        product_id: selectedProduct.product_id,
        quantity,
        reason,
        notes: notes.trim() || null,
      });
      await onSuccess(response.message || 'تم إرسال طلب المرتجع.');
    } catch (submitError: any) {
      setError(submitError.message || 'تعذر إرسال الطلب.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MobilePanel
      isOpen={isOpen}
      title="طلب مرتجع"
      subtitle={selectedProduct?.name || 'اختر المنتج أولاً'}
      onClose={onClose}
      footer={selectedProduct ? (
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="h-12 w-full rounded-2xl bg-[#E6D690] text-sm font-black text-[#121212] disabled:opacity-60"
        >
          {submitting ? 'جارٍ الإرسال...' : 'إرسال الطلب'}
        </button>
      ) : undefined}
    >
      <div className="space-y-4">
        {!selectedProduct ? (
          <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
            <label className="mb-2 block text-right text-[11px] font-bold text-white/45">ابحث عن المنتج</label>
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="اسم المنتج"
                className="h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] pr-11 pl-4 text-sm font-semibold text-white outline-none"
              />
            </div>
            {searchLoading ? (
              <div className="mt-3 text-center text-xs font-medium text-white/40">جارٍ البحث...</div>
            ) : searchError ? (
              <div className="mt-3 text-center text-xs font-medium text-[#ff9a96]">{searchError}</div>
            ) : searchResults.length ? (
              <div className="mt-3 space-y-2">
                {searchResults.map((entry) => {
                  const nextProduct = toBranchInventoryProduct(entry);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setSelectedProduct(nextProduct)}
                      className="flex w-full items-center justify-between rounded-2xl border border-white/5 bg-white/[0.02] px-3 py-3 text-right"
                    >
                      <span className="text-[11px] font-medium text-white/35">{entry.stock_quantity} {entry.unit}</span>
                      <div>
                        <p className="text-sm font-bold text-white">{entry.name}</p>
                        <p className="mt-1 text-[11px] font-medium text-white/40">{entry.category}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : queryHasValue(searchQuery) ? (
              <div className="mt-3 text-center text-xs font-medium text-white/35">لا توجد نتائج مطابقة.</div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4 text-right">
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedProduct(null)}
                  className="text-xs font-bold text-[#E6D690]"
                >
                  تغيير
                </button>
                <div>
                  <p className="text-sm font-black text-white">{selectedProduct.name}</p>
                  <p className="mt-1 text-[11px] font-medium text-white/40">
                    المتاح: {selectedProduct.stock_quantity} {selectedProduct.unit}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
                <label className="mb-2 block text-right text-[11px] font-bold text-white/45">الكمية</label>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, selectedProduct.stock_quantity)}
                  value={quantity}
                  onChange={(event) => setQuantity(Math.max(1, Number(event.target.value || 1)))}
                  className="h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-center text-lg font-black text-white outline-none"
                />
              </div>

              <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
                <label className="mb-2 block text-right text-[11px] font-bold text-white/45">السبب</label>
                <select
                  value={reason}
                  onChange={(event) => setReason(event.target.value as ReturnRequestReason)}
                  className="h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm font-semibold text-white outline-none"
                >
                  <option value="">اختر السبب</option>
                  {RETURN_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4">
              <label className="mb-2 block text-right text-[11px] font-bold text-white/45">ملاحظة</label>
              <textarea
                rows={4}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="ملاحظة اختيارية"
                className="w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm font-medium text-white outline-none"
              />
            </div>
          </>
        )}

        {error && <InlineError message={error} />}
      </div>
    </MobilePanel>
  );
};

const MobileReturnRequestDetailsPanel: React.FC<{
  requestId: number | null;
  onClose: () => void;
}> = ({ requestId, onClose }) => {
  const [request, setRequest] = useState<ReturnRequestSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requestId) return;
    let isActive = true;
    setLoading(true);
    setError(null);
    setRequest(null);

    apiClient.get(`/returns/${requestId}`)
      .then((data) => {
        if (!isActive) return;
        setRequest(data as ReturnRequestSummary);
      })
      .catch((loadError: any) => {
        if (!isActive) return;
        setError(loadError.message || 'تعذر تحميل تفاصيل المرتجع.');
      })
      .finally(() => {
        if (!isActive) return;
        setLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [requestId]);

  return (
    <MobilePanel
      isOpen={Boolean(requestId)}
      title="تفاصيل المرتجع"
      subtitle={request?.return_ref}
      onClose={onClose}
    >
      {loading ? (
        <InlineLoading label="جارٍ تحميل التفاصيل..." />
      ) : error ? (
        <InlineError message={error} />
      ) : request ? (
        <div className="space-y-4">
          <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4 text-right">
            <div className="flex items-center justify-between gap-3">
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${returnStatusClass(request.status)}`}>
                {returnStatusLabel[request.status]}
              </span>
              <p className="font-mono text-xs font-bold text-[#E6D690]">{request.return_ref}</p>
            </div>
            <p className="mt-3 text-sm font-black text-white">{request.product_name}</p>
            <p className="mt-1 text-[11px] font-medium text-white/40">
              {request.requested_quantity} {request.product_unit} • الرصيد وقت الطلب {request.branch_stock_snapshot}
            </p>
          </div>

          <InfoCard label="السبب" value={request.reason_label} />
          <InfoCard label="وقت الإنشاء" value={formatDateTime(request.created_at)} />
          {request.notes && <InfoCard label="ملاحظة الفرع" value={request.notes} />}
          {request.resolution_note && <InfoCard label="ملاحظة المعالجة" value={request.resolution_note} />}
        </div>
      ) : null}
    </MobilePanel>
  );
};

const MobileActivityPanel: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const [items, setItems] = useState<ProductActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let isActive = true;
    setLoading(true);
    setError(null);

    apiClient.get('/inventory/activity?page=1&per_page=20&type=all')
      .then((data) => {
        if (!isActive) return;
        const payload = data as ProductActivityResponse;
        setItems(Array.isArray(payload?.items) ? payload.items : []);
      })
      .catch((loadError: any) => {
        if (!isActive) return;
        setError(loadError.message || 'تعذر تحميل حركة المخزون.');
      })
      .finally(() => {
        if (!isActive) return;
        setLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [isOpen]);

  return (
    <MobilePanel
      isOpen={isOpen}
      title="حركة المخزون"
      subtitle="آخر عمليات البيع والاستهلاك الداخلي"
      onClose={onClose}
    >
      {loading ? (
        <InlineLoading label="جارٍ تحميل حركة المخزون..." />
      ) : error ? (
        <InlineError message={error} />
      ) : items.length ? (
        <div className="space-y-2.5">
          {items.map((item) => (
            <ProductActivityListItem key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Activity size={20} />}
          title="لا توجد حركة"
          description="حين تتم عمليات بيع أو استهلاك ستظهر هنا."
        />
      )}
    </MobilePanel>
  );
};

const ProductActivityListItem: React.FC<{ item: ProductActivityItem }> = ({ item }) => (
  <div className="rounded-2xl border border-white/5 bg-[#141416] p-3 text-right">
    <div className="flex items-start gap-3">
      <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${item.type === 'PRODUCT_SALE' ? 'bg-sky-500/10 text-sky-300' : 'bg-[#E53935]/10 text-[#ff9a96]'}`}>
        {item.type === 'PRODUCT_SALE' ? <Store size={16} /> : <Activity size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <span className="text-[11px] font-medium text-white/35">{formatTimeOnly(item.created_at)}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-white">{item.product_name}</p>
            <p className="mt-1 text-[11px] font-medium text-white/40">
              {item.quantity} {item.product_unit} • {item.type === 'PRODUCT_SALE' ? 'مبيعات' : (item.reason || 'استهلاك داخلي')}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const InlineLoading: React.FC<{ label: string }> = ({ label }) => (
  <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] px-4 py-10 text-center">
    <Loader2 size={20} className="mx-auto animate-spin text-[#E6D690]" />
    <p className="mt-3 text-sm font-medium text-white/45">{label}</p>
  </div>
);

const InlineError: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="rounded-[1.8rem] border border-[#E53935]/12 bg-[#E53935]/6 px-4 py-4 text-right">
    <p className="text-sm font-semibold leading-7 text-[#ffb4af]">{message}</p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#E53935]/20 bg-[#E53935]/10 px-3 py-2 text-xs font-black text-[#ff9a96]"
      >
        <RefreshCw size={14} />
        <span>إعادة المحاولة</span>
      </button>
    )}
  </div>
);

const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  compact?: boolean;
}> = ({ icon, title, description, compact = false }) => (
  <div className={`rounded-[1.8rem] border border-dashed border-white/5 bg-[#141416] text-center ${compact ? 'px-4 py-6' : 'px-4 py-10'}`}>
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/5 bg-white/[0.03] text-white/30">
      {icon}
    </div>
    <h3 className="mt-3 text-sm font-black text-white">{title}</h3>
    <p className="mt-1 text-[11px] font-medium leading-6 text-white/40">{description}</p>
  </div>
);

const LoadMoreButton: React.FC<{
  loading: boolean;
  onClick: () => void;
}> = ({ loading, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={loading}
    className="h-11 w-full rounded-2xl border border-white/8 bg-white/[0.03] text-sm font-black text-white/75 disabled:opacity-60"
  >
    {loading ? 'جارٍ التحميل...' : 'تحميل المزيد'}
  </button>
);

const InfoCard: React.FC<{
  label: string;
  value: string;
}> = ({ label, value }) => (
  <div className="rounded-[1.8rem] border border-white/5 bg-[#141416] p-4 text-right">
    <p className="text-[11px] font-bold text-white/35">{label}</p>
    <p className="mt-2 text-sm font-black leading-7 text-white">{value}</p>
  </div>
);

const ProductThumb: React.FC<{
  src: string | null;
  alt: string;
  size?: 'sm' | 'lg';
}> = ({ src, alt, size = 'sm' }) => {
  const dimensions = size === 'lg' ? 'h-24 w-24 rounded-[1.6rem]' : 'h-16 w-16 rounded-[1.2rem]';
  return (
    <div className={`shrink-0 overflow-hidden border border-white/6 bg-white/[0.03] ${dimensions}`}>
      {src ? (
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white/25">
          <Package2 size={20} />
        </div>
      )}
    </div>
  );
};

function sortInventoryProducts(products: BranchInventoryProduct[]) {
  const order: Record<BranchInventoryProduct['status'], number> = {
    LOW: 0,
    AVAILABLE: 1,
    OUT: 2,
    UNKNOWN: 3,
    NOT_APPLICABLE: 4,
  };

  return [...products].sort((a, b) => {
    if (order[a.status] !== order[b.status]) {
      return order[a.status] - order[b.status];
    }
    return a.name.localeCompare(b.name, 'ar');
  });
}

function resolveImageUrl(imageUrl?: string | null) {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  const normalized = imageUrl.startsWith('/') ? imageUrl : `/uploads/${imageUrl.replace(/\\/g, '/')}`;
  return `${BACKEND_URL}${normalized}`;
}

function returnStatusClass(status: ReturnRequestSummary['status']) {
  if (status === 'PENDING') return 'border border-amber-500/20 bg-amber-500/10 text-amber-300';
  if (status === 'REJECTED') return 'border border-[#E53935]/20 bg-[#E53935]/10 text-[#ff9a96]';
  if (status === 'RETURNED_TO_SUPPLIER') return 'border border-sky-500/20 bg-sky-500/10 text-sky-300';
  return 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300';
}

function batchStatusLabel(status: BranchInventoryProductDetails['batches'][number]['status']) {
  if (status === 'EXPIRING_SOON') return 'قريب';
  if (status === 'EXPIRED') return 'منتهي';
  if (status === 'NO_EXPIRY') return 'بدون صلاحية';
  return 'جيد';
}

function batchStatusClass(status: BranchInventoryProductDetails['batches'][number]['status']) {
  if (status === 'EXPIRING_SOON') return 'border border-amber-500/20 bg-amber-500/10 text-amber-300';
  if (status === 'EXPIRED') return 'border border-[#E53935]/20 bg-[#E53935]/10 text-[#ff9a96]';
  if (status === 'NO_EXPIRY') return 'border border-white/10 bg-white/[0.04] text-white/60';
  return 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300';
}

function formatDateTime(value?: string | null) {
  if (!value) return 'غير متاح';
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatTimeOnly(value: string) {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatRelativeTime(iso?: string | null) {
  if (!iso) return 'الآن';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return 'الآن';
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `منذ ${Math.max(1, minutes)} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

function queryHasValue(value: string) {
  return Boolean(value.trim());
}

function toBranchInventoryProduct(entry: SearchableProduct): BranchInventoryProduct {
  return {
    product_id: entry.id,
    name: entry.name,
    image_url: entry.image_url || null,
    category: entry.category,
    selling_price: Number(entry.selling_price || 0),
    unit: entry.unit || 'قطعة',
    stock_quantity: Number(entry.stock_quantity || 0),
    min_stock_threshold: entry.min_stock_threshold ?? 0,
    status: searchableInventoryStatus(entry),
  };
}

export default InventoryOnlyApp;
