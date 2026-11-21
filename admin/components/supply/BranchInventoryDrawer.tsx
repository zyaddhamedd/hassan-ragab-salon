import React, { useEffect, useState, useRef } from 'react';
import { X, Search, AlertTriangle, CalendarClock, Package, RefreshCw, ChevronDown, ChevronUp, MapPin, ClipboardList, Info, Loader2 } from 'lucide-react';
import { adminFetch } from '../../api/adminFetch';

interface BranchInventoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  branchId: string | number;
  branchName: string;
  isDarkMode: boolean;
}

interface ProductInventory {
  product_id: number;
  name: string;
  category: string;
  image_url: string | null;
  selling_price: number;
  min_stock_threshold: number;
  unit: string;
  stock_quantity: number;
  status: 'AVAILABLE' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN' | 'NOT_APPLICABLE';
  nearest_expiry: string | null;
  days_remaining: number | null;
  latest_received_date: string | null;
}

interface BatchDetails {
  batch_number: string;
  remaining_quantity: number;
  purchase_date: string | null;
  received_date: string;
  expiry_date: string | null;
  days_remaining: number | null;
  status: string;
}

interface ActivityItem {
  id: number;
  product_id: number;
  product_name: string;
  movement_type: 'PRODUCT_SALE' | 'INTERNAL_CONSUMPTION';
  quantity: number;
  created_at: string;
  invoice_number: number | null;
  employee_name: string | null;
  notes: string | null;
}

interface SummaryStats {
  branch_id: number;
  branch_name: string;
  total_products: number;
  total_units: number;
  total_quantity?: number;
  total_cost_value?: number;
  low_stock_count: number;
  low_stock_products?: number;
  out_of_stock_products?: number;
  expired_products: number;
}

interface InventoryResponse {
  items?: ProductInventory[];
  products?: ProductInventory[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_more: boolean;
  summary: SummaryStats;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';
const INVENTORY_PAGE_SIZE = 12;

const BranchInventoryDrawer: React.FC<BranchInventoryDrawerProps> = ({
  isOpen,
  onClose,
  branchId,
  branchName,
  isDarkMode,
}) => {
  const [activeTab, setActiveTab] = useState<'products' | 'activity'>('products');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tab 1: Products States
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [products, setProducts] = useState<ProductInventory[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [stockFilter, setStockFilter] = useState('all'); // all, available, low_stock, out_of_stock
  const [expiryFilter, setExpiryFilter] = useState('all'); // all, expiring_soon, expired, no_expiry
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventoryPagination, setInventoryPagination] = useState({
    page: 1,
    perPage: INVENTORY_PAGE_SIZE,
    total: 0,
    totalPages: 0,
    hasMore: false,
  });

  // Batches Lazy-loading cache
  const [expandedProductId, setExpandedProductId] = useState<number | null>(null);
  const [batchesByProduct, setBatchesByProduct] = useState<Record<number, BatchDetails[]>>({});
  const [batchesLoading, setBatchesLoading] = useState<Record<number, boolean>>({});

  // Tab 2: Activity States
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activitySummary, setActivitySummary] = useState<{ total_sales_units: number; total_consumption_units: number } | null>(null);
  const [activityPage, setActivityPage] = useState(1);
  const [activityTotalPages, setActivityTotalPages] = useState(1);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activitySearch, setActivitySearch] = useState('');
  const [activityTypeFilter, setActivityTypeFilter] = useState('all'); // all, sales, consumption
  const [activityDateFilter, setActivityDateFilter] = useState('all'); // all, today, yesterday, last_7_days, this_month

  const drawerRef = useRef<HTMLDivElement>(null);
  const inventoryRequestIdRef = useRef(0);

  // Reset states on branch switch or open/close
  useEffect(() => {
    if (isOpen && branchId) {
      setActiveTab('products');
      setSummary(null);
      setProducts([]);
      setInventoryPage(1);
      setInventoryPagination({
        page: 1,
        perPage: INVENTORY_PAGE_SIZE,
        total: 0,
        totalPages: 0,
        hasMore: false,
      });
      setActivities([]);
      setExpandedProductId(null);
      setBatchesByProduct({});
      setActivityPage(1);
    }
  }, [isOpen, branchId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    if (!isOpen || !branchId || activeTab !== 'products') return;
    if (inventoryPage !== 1) {
      setInventoryPage(1);
    }
  }, [activeTab, branchId, debouncedSearchQuery, expiryFilter, isOpen, stockFilter]);

  useEffect(() => {
    if (!isOpen || !branchId || activeTab !== 'products') return;
    void fetchInventoryData(inventoryPage);
  }, [activeTab, branchId, debouncedSearchQuery, expiryFilter, inventoryPage, isOpen, stockFilter]);

  // Fetch Activity when tab changes or filters change
  useEffect(() => {
    if (isOpen && branchId && activeTab === 'activity') {
      fetchActivityData(1, false);
    }
  }, [activeTab, activityTypeFilter, activityDateFilter, branchId]);

  // Handle outside click to close
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (isOpen && drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  const fetchInventoryData = async (targetPage: number = inventoryPage) => {
    const requestId = inventoryRequestIdRef.current + 1;
    inventoryRequestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const urlParams = new URLSearchParams({
        page: String(targetPage),
        per_page: String(INVENTORY_PAGE_SIZE),
        q: debouncedSearchQuery,
        stock_status: stockFilter,
        expiry: expiryFilter,
      });

      const response = await adminFetch(`${API_BASE}/api/admin/branches/${branchId}/inventory?${urlParams}`, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('غير مصرح لك بعرض بيانات هذا الفرع.');
        }
        throw new Error('تعذر تحميل بيانات مخزن الفرع.');
      }

      const data: InventoryResponse = await response.json();
      if (requestId !== inventoryRequestIdRef.current) {
        return;
      }

      setSummary(data.summary);
      setProducts(Array.isArray(data.items) ? data.items : (data.products || []));
      setInventoryPage(Number(data.page || targetPage || 1));
      setInventoryPagination({
        page: Number(data.page || targetPage || 1),
        perPage: Number(data.per_page || INVENTORY_PAGE_SIZE),
        total: Number(data.total || 0),
        totalPages: Number(data.total_pages || 0),
        hasMore: Boolean(data.has_more),
      });
    } catch (err: any) {
      if (requestId === inventoryRequestIdRef.current) {
        setError(err.message || 'حدث خطأ غير متوقع.');
      }
    } finally {
      if (requestId === inventoryRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  const loadProductBatches = async (productId: number) => {
    if (batchesByProduct[productId]) return; // already loaded

    setBatchesLoading((prev) => ({ ...prev, [productId]: true }));
    try {
      const response = await adminFetch(`${API_BASE}/api/admin/branches/${branchId}/inventory/products/${productId}/details`, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error();
      }

      const data = await response.json();
      setBatchesByProduct((prev) => ({ ...prev, [productId]: data.batches || [] }));
    } catch (err) {
      // quiet fallback
    } finally {
      setBatchesLoading((prev) => ({ ...prev, [productId]: false }));
    }
  };

  const fetchActivityData = async (page: number, append = false) => {
    setActivityLoading(true);
    try {
      const urlParams = new URLSearchParams({
        page: String(page),
        per_page: '15',
        type: activityTypeFilter,
        date_filter: activityDateFilter,
        search: activitySearch,
      });

      const response = await adminFetch(`${API_BASE}/api/admin/branches/${branchId}/inventory/activity?${urlParams}`, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) return;

      const data = await response.json();
      setActivitySummary(data.summary);
      setActivityTotalPages(data.pagination.total_pages);
      setActivityPage(data.pagination.page);

      if (append) {
        setActivities((prev) => [...prev, ...(data.items || [])]);
      } else {
        setActivities(data.items || []);
      }
    } catch (err) {
      // quiet fail
    } finally {
      setActivityLoading(false);
    }
  };

  const handleProductSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inventoryPage === 1) {
      void fetchInventoryData(1);
      return;
    }
    setInventoryPage(1);
  };

  const handleActivitySearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchActivityData(1, false);
  };

  const toggleProductExpand = (productId: number) => {
    if (expandedProductId === productId) {
      setExpandedProductId(null);
    } else {
      setExpandedProductId(productId);
      loadProductBatches(productId);
    }
  };

  const getStockStatusLabel = (status: string) => {
    switch (status) {
      case 'OUT_OF_STOCK':
        return 'نفد';
      case 'LOW_STOCK':
        return 'منخفض';
      case 'UNKNOWN':
        return 'غير مؤكد';
      case 'NOT_APPLICABLE':
        return 'غير مطبق';
      default:
        return 'متوفر';
    }
  };

  const getStockStatusColor = (status: string) => {
    switch (status) {
      case 'OUT_OF_STOCK':
        return 'border-[#E53935]/20 bg-[#E53935]/8 text-[#FF8A80]';
      case 'LOW_STOCK':
        return 'border-[#E6D690]/20 bg-[#E6D690]/8 text-[#F2E4AB]';
      case 'UNKNOWN':
      case 'NOT_APPLICABLE':
        return 'border-gray-400/20 bg-gray-500/10 text-gray-400';
      default:
        return 'border-emerald-500/20 bg-emerald-500/8 text-emerald-300';
    }
  };

  const formatDate = (isoStr: string) => {
    if (!isoStr) return '';
    const dateObj = new Date(isoStr);
    return dateObj.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatEGP = (value?: number | null) => {
    const safeVal = Number(value || 0);
    return `${safeVal.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ج.م`;
  };

  const formatDateTime = (isoStr: string) => {
    if (!isoStr) return '';
    const dateObj = new Date(isoStr);
    return dateObj.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleInventoryPageChange = (targetPage: number) => {
    if (targetPage < 1 || targetPage === inventoryPage) return;
    if (inventoryPagination.totalPages > 0 && targetPage > inventoryPagination.totalPages) return;
    setInventoryPage(targetPage);
  };

  return (
    <div
      className={`admin-workspace-shell z-[150] flex justify-end transition-opacity duration-300 ${
        isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* Background overlay */}
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] transition-opacity" onClick={onClose} />

      {/* Drawer Body */}
      <div
        ref={drawerRef}
        className={`relative h-full w-full max-w-md sm:max-w-lg md:max-w-xl bg-[#0a0b0e] border-r border-white/[0.08] shadow-2xl flex flex-col transition-transform duration-300 transform ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        dir="rtl"
      >
        {/* Header */}
        <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="text-[#E6D690] h-5 w-5" />
            <div>
              <h2 className="text-base font-bold text-white leading-tight">{branchName}</h2>
              <span className="text-[11px] text-white/40 font-medium">مخزن وتدقيق فرعي للمخزون</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/[0.08] text-white/50 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-white/[0.06] bg-[#0c0d12]">
          <button
            onClick={() => setActiveTab('products')}
            className={`flex-1 py-3 text-center text-xs font-semibold tracking-wide transition-all border-b-2 ${
              activeTab === 'products'
                ? 'border-[#E6D690] text-[#E6D690]'
                : 'border-transparent text-white/40 hover:text-white/60'
            }`}
          >
            المنتجات والمخزون
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`flex-1 py-3 text-center text-xs font-semibold tracking-wide transition-all border-b-2 ${
              activeTab === 'activity'
                ? 'border-[#E6D690] text-[#E6D690]'
                : 'border-transparent text-white/40 hover:text-white/60'
            }`}
          >
            حركة المخازن الأخيرة
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4">
          {error && (
            <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-right flex items-center gap-3">
              <AlertTriangle className="text-red-400 shrink-0" size={18} />
              <p className="text-xs text-red-300 font-medium">{error}</p>
            </div>
          )}

          {activeTab === 'products' ? (
            // ==========================================
            // TAB 1: PRODUCTS INVENTORY
            // ==========================================
            <>
              {/* Summary Stats Strip */}
              {summary && (
                <div className="grid grid-cols-5 gap-1.5 border border-white/[0.06] rounded-xl bg-white/[0.01] p-3 text-center">
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] font-medium text-white/40">المنتجات</span>
                    <span className="text-sm font-bold text-white mt-1">{summary.total_products}</span>
                  </div>
                  <div className="flex flex-col items-center border-r border-white/[0.06]">
                    <span className="text-[10px] font-medium text-white/40">الوحدات</span>
                    <span className="text-sm font-bold text-white mt-1">{summary.total_units}</span>
                  </div>
                  <div className="flex flex-col items-center border-r border-white/[0.06]">
                    <span className="text-[10px] font-medium text-[#E6D690]/70">قيمة المخزون</span>
                    <span className="text-xs font-bold text-[#E6D690] mt-1 whitespace-nowrap">
                      {formatEGP(summary.total_cost_value)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center border-r border-white/[0.06]">
                    <span className="text-[10px] font-medium text-white/40">نواقص</span>
                    <span className={`text-sm font-bold mt-1 ${summary.low_stock_count > 0 ? 'text-[#FF8A80]' : 'text-white'}`}>
                      {summary.low_stock_count}
                    </span>
                  </div>
                  <div className="flex flex-col items-center border-r border-white/[0.06]">
                    <span className="text-[10px] font-medium text-white/40">المنتهية</span>
                    <span className="text-sm font-bold text-white mt-1">
                      {summary.expired_products}
                    </span>
                  </div>
                </div>
              )}

              {/* Filters Form */}
              <form onSubmit={handleProductSearchSubmit} className="space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ابحث باسم المنتج..."
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] pl-10 pr-4 py-2 text-right text-xs text-white placeholder-white/20 focus:border-[#E6D690] focus:outline-none transition-colors"
                  />
                  <button type="submit" className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-[#E6D690]">
                    <Search size={14} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-white/40 font-medium">حالة التوفر</label>
                    <select
                      value={stockFilter}
                      onChange={(e) => setStockFilter(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-[#0e0f13] text-white text-xs px-3 py-2 text-right focus:outline-none focus:border-[#E6D690]"
                    >
                      <option value="all">كل الكميات</option>
                      <option value="available">المتوفر فقط</option>
                      <option value="low_stock">المنخفض فقط</option>
                      <option value="out_of_stock">المنتهي فقط</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-white/40 font-medium">تاريخ الصلاحية</label>
                    <select
                      value={expiryFilter}
                      onChange={(e) => setExpiryFilter(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-[#0e0f13] text-white text-xs px-3 py-2 text-right focus:outline-none focus:border-[#E6D690]"
                    >
                      <option value="all">جميع التواريخ</option>
                      <option value="expiring_soon">ينتهي قريباً (30 يوم)</option>
                      <option value="expired">منتهى الصلاحية</option>
                      <option value="no_expiry">بدون صلاحية</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-2 bg-white/[0.04] hover:bg-white/[0.08] rounded-xl border border-white/10 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCw size={12} className={loading ? 'animate-spin text-[#E6D690]' : ''} />
                  <span>تحديث وتصفية القائمة</span>
                </button>
              </form>

              {/* Product Cards List */}
              {loading ? (
                <div className="py-20 flex flex-col items-center justify-center text-white/40 gap-3">
                  <Loader2 className="animate-spin text-[#E6D690]" size={28} />
                  <span className="text-xs">جاري تحميل المخزن الحقيقي...</span>
                </div>
              ) : products.length === 0 ? (
                <div className="py-16 text-center text-white/30 flex flex-col items-center gap-2">
                  <Package size={24} className="opacity-40" />
                  <span className="text-xs">لا توجد منتجات مطابقة في هذا الفرع.</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {products.map((product) => {
                    const isExpanded = expandedProductId === product.product_id;
                    const statusColor = getStockStatusColor(product.status);
                    const statusLabel = getStockStatusLabel(product.status);

                    return (
                      <div
                        key={product.product_id}
                        className={`rounded-xl border transition-all duration-200 bg-[#0d0e12] overflow-hidden ${
                          isExpanded ? 'border-white/10 ring-1 ring-white/5' : 'border-white/[0.05] hover:border-white/10'
                        }`}
                      >
                        {/* Main product summary card */}
                        <div
                          onClick={() => toggleProductExpand(product.product_id)}
                          className="p-3 flex items-center justify-between cursor-pointer"
                        >
                          <div className="flex items-center gap-3">
                            {/* Product Info */}
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.02] text-white/50 overflow-hidden">
                              {product.image_url ? (
                                <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
                              ) : (
                                <Package size={18} />
                              )}
                            </div>

                            <div className="text-right">
                              <h4 className="text-xs font-bold text-white line-clamp-1">{product.name}</h4>
                              <p className="text-[10px] text-white/30 mt-0.5">{product.category}</p>
                              {product.nearest_expiry && (
                                <p className="text-[9px] text-[#FF8A80] flex items-center gap-1 mt-1">
                                  <CalendarClock size={10} />
                                  <span>
                                    تنتهي الصلاحية: {formatDate(product.nearest_expiry)}
                                    {product.days_remaining !== null && (
                                      <span className="mr-1">({product.days_remaining <= 0 ? 'منتهي' : `متبقي ${product.days_remaining} يوم`})</span>
                                    )}
                                  </span>
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-left">
                              <p className="text-xs font-bold text-white">
                                {product.stock_quantity} <span className="text-[10px] font-normal text-white/40">{product.unit}</span>
                              </p>
                              <span className={`inline-block px-2 py-0.5 text-[8px] font-bold rounded-full border mt-1 ${statusColor}`}>
                                {statusLabel}
                              </span>
                            </div>
                            {isExpanded ? <ChevronUp size={14} className="text-white/40" /> : <ChevronDown size={14} className="text-white/40" />}
                          </div>
                        </div>

                        {/* Expanded details (Lazy-loaded batches) */}
                        {isExpanded && (
                          <div className="px-3 pb-3 pt-1 border-t border-white/[0.04] bg-white/[0.01]">
                            <div className="py-2 text-[10px] font-semibold text-[#E6D690] border-b border-white/[0.04] mb-2">
                              تفاصيل التشغيلات والباتشات (batches):
                            </div>

                            {batchesLoading[product.product_id] ? (
                              <div className="py-4 flex items-center justify-center text-white/35 gap-2">
                                <Loader2 className="animate-spin text-[#E6D690]" size={14} />
                                <span className="text-[10px]">جاري جلب الباتشات من المخزن...</span>
                              </div>
                            ) : !batchesByProduct[product.product_id] || batchesByProduct[product.product_id].length === 0 ? (
                              <div className="text-[10px] text-white/30 text-center py-2">
                                لا توجد باتشات تشغيل نشطة لهذا المنتج.
                              </div>
                            ) : (
                              <div className="space-y-1.5">
                                {batchesByProduct[product.product_id].map((batch, index) => (
                                  <div
                                    key={index}
                                    className="p-2 border border-white/[0.04] rounded-lg bg-black/20 text-[10px] space-y-1"
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold text-white/90">{batch.batch_number}</span>
                                      <span className="font-bold text-[#E6D690]">
                                        {batch.remaining_quantity} {product.unit}
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-white/40 pt-1 text-[9px]">
                                      <span>الشراء: {formatDate(batch.purchase_date || '') || 'غير محدد'}</span>
                                      <span>الاستلام: {formatDate(batch.received_date)}</span>
                                      {batch.expiry_date && (
                                        <span className="col-span-2 text-[#FF8A80]">
                                          الصلاحية: {formatDate(batch.expiry_date)} ({batch.days_remaining !== null && batch.days_remaining <= 0 ? 'منتهي' : `متبقي ${batch.days_remaining} يوم`})
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div className="flex flex-col items-center gap-3 border-t border-white/[0.04] pt-4">
                    <span className="text-[11px] font-medium text-white/35">
                      عرض {Math.min(inventoryPagination.total, (inventoryPage - 1) * inventoryPagination.perPage + products.length)} من {inventoryPagination.total} منتج
                    </span>
                    {inventoryPagination.totalPages > 1 && (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleInventoryPageChange(inventoryPage - 1)}
                          disabled={inventoryPage <= 1 || loading}
                          className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 text-[11px] font-semibold text-white/70 transition-all duration-200 hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          السابق
                        </button>
                        <span className="text-[11px] font-medium text-white/45">
                          صفحة {inventoryPage} من {Math.max(1, inventoryPagination.totalPages)}
                        </span>
                        <button
                          onClick={() => handleInventoryPageChange(inventoryPage + 1)}
                          disabled={!inventoryPagination.hasMore || loading}
                          className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 text-[11px] font-semibold text-white/70 transition-all duration-200 hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          التالي
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            // ==========================================
            // TAB 2: STOCK MOVEMENT / ACTIVITY TIMELINE
            // ==========================================
            <>
              {/* Activity Summary Strip */}
              {activitySummary && (
                <div className="grid grid-cols-2 gap-2 border border-white/[0.06] rounded-xl bg-white/[0.01] p-3 text-center">
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] font-medium text-white/40">إجمالي الوحدات المباعة</span>
                    <span className="text-sm font-bold text-emerald-400 mt-1">{activitySummary.total_sales_units}</span>
                  </div>
                  <div className="flex flex-col items-center border-r border-white/[0.06]">
                    <span className="text-[10px] font-medium text-white/40">الوحدات المستهلكة داخلياً</span>
                    <span className="text-sm font-bold text-orange-400 mt-1">{activitySummary.total_consumption_units}</span>
                  </div>
                </div>
              )}

              {/* Filters Form */}
              <form onSubmit={handleActivitySearchSubmit} className="space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    value={activitySearch}
                    onChange={(e) => setActivitySearch(e.target.value)}
                    placeholder="ابحث باسم المنتج في السجلات..."
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] pl-10 pr-4 py-2 text-right text-xs text-white placeholder-white/20 focus:border-[#E6D690] focus:outline-none transition-colors"
                  />
                  <button type="submit" className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-[#E6D690]">
                    <Search size={14} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-white/40 font-medium">نوع الحركة</label>
                    <select
                      value={activityTypeFilter}
                      onChange={(e) => setActivityTypeFilter(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-[#0e0f13] text-white text-xs px-3 py-2 text-right focus:outline-none focus:border-[#E6D690]"
                    >
                      <option value="all">كل العمليات</option>
                      <option value="sales">المبيعات فقط</option>
                      <option value="consumption">الاستهلاك الداخلي فقط</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-white/40 font-medium">الفترة الزمنية</label>
                    <select
                      value={activityDateFilter}
                      onChange={(e) => setActivityDateFilter(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-[#0e0f13] text-white text-xs px-3 py-2 text-right focus:outline-none focus:border-[#E6D690]"
                    >
                      <option value="all">كل الفترات</option>
                      <option value="today">اليوم</option>
                      <option value="yesterday">أمس</option>
                      <option value="last_7_days">آخر 7 أيام</option>
                      <option value="this_month">هذا الشهر</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-2 bg-white/[0.04] hover:bg-white/[0.08] rounded-xl border border-white/10 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCw size={12} className={activityLoading ? 'animate-spin text-[#E6D690]' : ''} />
                  <span>تحديث السجلات والبحث</span>
                </button>
              </form>

              {/* Activity Timeline List */}
              {activityLoading && activityPage === 1 ? (
                <div className="py-20 flex flex-col items-center justify-center text-white/40 gap-3">
                  <Loader2 className="animate-spin text-[#E6D690]" size={28} />
                  <span className="text-xs">جاري تحميل سجلات المخزن...</span>
                </div>
              ) : activities.length === 0 ? (
                <div className="py-16 text-center text-white/30 flex flex-col items-center gap-2">
                  <ClipboardList size={24} className="opacity-40" />
                  <span className="text-xs">لا توجد سجلات حركة مطابقة.</span>
                </div>
              ) : (
                <div className="space-y-3 relative pr-3 border-r border-white/5">
                  {activities.map((act) => {
                    const isSale = act.movement_type === 'PRODUCT_SALE';

                    return (
                      <div key={act.id} className="relative group text-right">
                        {/* Timeline dot */}
                        <div
                          className={`absolute -right-[17.5px] top-1 h-2.5 w-2.5 rounded-full border bg-[#0a0b0e] transition-transform duration-200 group-hover:scale-125 ${
                            isSale ? 'border-emerald-500 text-emerald-400' : 'border-orange-500 text-orange-400'
                          }`}
                        />

                        {/* Activity Card */}
                        <div className="p-3 border border-white/[0.04] bg-[#0d0e12] rounded-xl space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white">{act.product_name}</span>
                            <span className={`text-xs font-bold ${isSale ? 'text-emerald-400' : 'text-orange-400'}`}>
                              {isSale ? '-' : ''}{act.quantity} قطعة
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-white/40">
                            <span>
                              {isSale ? 'عملية بيع' : 'استهلاك داخلي'}
                              {act.invoice_number && <span className="mr-1"> (فاتورة #{act.invoice_number})</span>}
                            </span>
                            <span>{formatDateTime(act.created_at)}</span>
                          </div>

                          {act.employee_name && (
                            <div className="text-[9px] text-white/30 pt-1 border-t border-white/[0.04] flex items-center gap-1.5">
                              <Info size={10} className="shrink-0" />
                              <span>بواسطة الموظف: {act.employee_name}</span>
                            </div>
                          )}

                          {act.notes && (
                            <div className="text-[9.5px] text-white/40 mt-1 bg-black/20 p-2 rounded-lg leading-relaxed">
                              {act.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Load More Button */}
                  {activityPage < activityTotalPages && (
                    <button
                      onClick={() => fetchActivityData(activityPage + 1, true)}
                      disabled={activityLoading}
                      className="w-full py-2 bg-white/[0.03] hover:bg-white/[0.06] rounded-xl border border-white/[0.06] text-white/60 hover:text-white text-[11px] font-semibold transition-all flex items-center justify-center gap-2"
                    >
                      {activityLoading && <Loader2 className="animate-spin text-[#E6D690]" size={12} />}
                      <span>تحميل المزيد من السجلات</span>
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BranchInventoryDrawer;
