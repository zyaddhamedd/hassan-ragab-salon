import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Edit2, ImageIcon, Package, Plus, RefreshCw, Search, Store, Upload, X } from 'lucide-react';
import { adminFetch } from '../../api/adminFetch';
import CatalogPagination from './CatalogPagination';
import useCatalogProducts from '../../hooks/useCatalogProducts';
import { restoreCatalogPosition } from '../../hooks/useSupplyCatalogNavigation';
import { CatalogQuery } from '../../utils/supplyCatalogNavigation';
import { LocationStockStatus, ProductStockAlerts } from './StockStatusBadge';

interface Product {
  id: number;
  name: string;
  category: string;
  unit: string;
  pieces_per_unit: number;
  supplier_name: string | null;
  expiry_date: string | null;
  selling_price: number;
  cost_price: number;
  sales_commission_percent: number;
  min_stock_threshold: number;
  is_active: boolean;
  image_url?: string | null;
  stock_quantity: number;
  total_stock?: number;
  main_store_stock?: number;
  low_stock_locations_count?: number;
  out_of_stock_locations_count?: number;
  stock_status?: LocationStockStatus;
}

interface ProductCatalogProps {
  isDarkMode: boolean;
  selectedBranch: string;
  refreshToken: number;
  onOpenWorkspace: (productId: number) => void;
  query: CatalogQuery;
  onQueryChange: (patch: Partial<CatalogQuery>, replace?: boolean) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';
const MAX_IMAGE_DIMENSION = 1400;
const COMPRESSED_IMAGE_QUALITY = 0.82;

const resolveProductImage = (imageUrl?: string | null) => {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('http') || imageUrl.startsWith('blob:') || imageUrl.startsWith('data:')) {
    return imageUrl;
  }
  return `${API_BASE}/uploads/${imageUrl.replace(/\\/g, '/')}`;
};

const loadImageElement = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

const compressImageFile = async (file: File) => {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return file;
  }

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(sourceUrl);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height));
    const targetWidth = Math.max(1, Math.round(image.width * scale));
    const targetHeight = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }

    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', COMPRESSED_IMAGE_QUALITY);
    });

    if (!blob) {
      return file;
    }

    const compressedBaseName = file.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${compressedBaseName}.webp`, {
      type: 'image/webp',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
};

const ProductCatalog: React.FC<ProductCatalogProps> = ({
  isDarkMode,
  selectedBranch,
  refreshToken,
  onOpenWorkspace,
  query,
  onQueryChange,
}) => {
  const { page, q: searchQuery, status: filter, sort } = query;
  const { data, loading, error, refresh: fetchProducts } = useCatalogProducts<Product>(query, refreshToken, (nextPage) => onQueryChange({ page: nextPage }, true), selectedBranch);
  const products = data.items;
  const pagination = { page: data.page, perPage: data.per_page, total: data.total, totalPages: data.total_pages, hasMore: data.has_more };
  const catalogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!loading && !error && catalogRef.current) return restoreCatalogPosition(catalogRef.current);
  }, [loading, error, data]);

  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [selectedProductForStock, setSelectedProductForStock] = useState<Product | null>(null);

  const [branchesList, setBranchesList] = useState<any[]>([]);
  const [branchStocks, setBranchStocks] = useState<any[]>([]);
  const [loadingStocks, setLoadingStocks] = useState(false);
  const [selectedStockBranchId, setSelectedStockBranchId] = useState<number | ''>('');
  const [adjustmentQty, setAdjustmentQty] = useState<number>(0);
  const [movementType, setMovementType] = useState<'STOCK_RECEIPT' | 'STOCK_ADJUSTMENT'>('STOCK_RECEIPT');

  const [formImageUrl, setFormImageUrl] = useState('');
  const [formImageFile, setFormImageFile] = useState<File | null>(null);
  const [formImagePreview, setFormImagePreview] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formSupplierName, setFormSupplierName] = useState('');
  const [formExpiryDate, setFormExpiryDate] = useState('');
  const [formSellingPrice, setFormSellingPrice] = useState(0);
  const [formCostPrice, setFormCostPrice] = useState(0);
  const [formSalesCommissionPercent, setFormSalesCommissionPercent] = useState(0);
  const [formMinStock, setFormMinStock] = useState(5);
  const [formOpeningQuantity, setFormOpeningQuantity] = useState(0);
  const [formPurchaseDate, setFormPurchaseDate] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const [submittingProduct, setSubmittingProduct] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const syncChannel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel('salon_data_sync');
    syncChannel.current = channel;
    return () => {
      syncChannel.current = null;
      channel.close();
    };
  }, []);

  useEffect(() => {
    if (!successMessage) return;
    const timeout = window.setTimeout(() => setSuccessMessage(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  useEffect(() => {
    setImagePreviewFailed(false);
  }, [formImagePreview]);

  useEffect(() => {
    return () => {
      if (formImagePreview?.startsWith('blob:')) {
        URL.revokeObjectURL(formImagePreview);
      }
    };
  }, [formImagePreview]);

  const mainStoreName = useMemo(() => {
    const mainStore = branchesList.find((branch: any) => branch.is_main_warehouse);
    return mainStore?.name || 'المخزن الرئيسي';
  }, [branchesList]);

  const selectedStockBranch = useMemo(
    () => branchStocks.find((branch) => branch.branch_id === selectedStockBranchId) || null,
    [branchStocks, selectedStockBranchId],
  );

  const blocksDirectBranchReceipt =
    movementType === 'STOCK_RECEIPT' && !!selectedStockBranch && !selectedStockBranch.is_main_warehouse;

  const fetchBranches = async () => {
    try {
      const response = await adminFetch(`${API_BASE}/api/admin/branches`, {
        headers: {
          Accept: 'application/json',
        },
      });
      if (response.ok) {
        const data = await response.json();
        setBranchesList(data);
      }
    } catch (err) {
      console.error('Failed to fetch branches', err);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  const resetFormImageState = (imageUrl?: string | null) => {
    if (formImagePreview?.startsWith('blob:')) {
      URL.revokeObjectURL(formImagePreview);
    }
    setFormImageFile(null);
    setFormImageUrl(imageUrl || '');
    setFormImagePreview(resolveProductImage(imageUrl) || null);
    setImagePreviewFailed(false);
  };

  const openProductModal = (product: Product | null = null) => {
    if (product) {
      setEditingProduct(product);
      resetFormImageState(product.image_url || null);
      setFormName(product.name);
      setFormCategory(product.category);
      setFormSupplierName(product.supplier_name || '');
      setFormExpiryDate(product.expiry_date ? product.expiry_date.split('T')[0] : '');
      setFormSellingPrice(product.selling_price || 0);
      setFormCostPrice(product.cost_price || 0);
      setFormSalesCommissionPercent(product.sales_commission_percent || 0);
      setFormMinStock(product.min_stock_threshold ?? 5);
      setFormOpeningQuantity(0);
      setFormIsActive(product.is_active);
    } else {
      setEditingProduct(null);
      resetFormImageState(null);
      setFormName('');
      setFormCategory('');
      setFormSupplierName('');
      setFormExpiryDate('');
      setFormSellingPrice(0);
      setFormCostPrice(0);
      setFormSalesCommissionPercent(0);
      setFormMinStock(5);
      setFormOpeningQuantity(0);
      setFormPurchaseDate('');
      setFormIsActive(true);
    }
    setIsProductModalOpen(true);
  };

  const handleImageFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    const compressedFile = await compressImageFile(selectedFile);
    const previewUrl = URL.createObjectURL(compressedFile);

    if (formImagePreview?.startsWith('blob:')) {
      URL.revokeObjectURL(formImagePreview);
    }

    setFormImageFile(compressedFile);
    setFormImagePreview(previewUrl);
    setImagePreviewFailed(false);
  };

  const clearSelectedImageFile = () => {
    if (formImagePreview?.startsWith('blob:')) {
      URL.revokeObjectURL(formImagePreview);
    }
    setFormImageFile(null);
    const fallbackPreview = resolveProductImage(formImageUrl);
    setFormImagePreview(fallbackPreview || null);
    setImagePreviewFailed(false);
  };

  const handleImageUrlChange = (value: string) => {
    setFormImageUrl(value);
    if (!formImageFile) {
      setFormImagePreview(resolveProductImage(value) || null);
    }
  };

  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formName.trim() || !formCategory.trim()) {
      alert('يرجى ملء اسم المنتج والقسم');
      return;
    }

    const formData = new FormData();
    formData.append('name', formName.trim());
    formData.append('category', formCategory.trim());
    formData.append('unit', 'pcs');
    formData.append('pieces_per_unit', '1');
    formData.append('supplier_name', formSupplierName.trim());
    formData.append('expiry_date', formExpiryDate || '');
    formData.append('selling_price', String(Number(formSellingPrice || 0)));
    formData.append('cost_price', String(Number(formCostPrice || 0)));
    formData.append('sales_commission_percent', String(Number(formSalesCommissionPercent || 0)));
    formData.append('min_stock_threshold', String(Number(formMinStock || 5)));
    formData.append('is_active', String(formIsActive));
    formData.append('opening_quantity', String(editingProduct ? 0 : Number(formOpeningQuantity || 0)));
    formData.append('purchase_date', editingProduct ? '' : (formPurchaseDate || ''));
    formData.append('image_url', formImageUrl.trim());
    if (formImageFile) {
      formData.append('image', formImageFile);
    }

    try {
      setSubmittingProduct(true);
      const url = editingProduct
        ? `${API_BASE}/api/admin/products/${editingProduct.id}`
        : `${API_BASE}/api/admin/products`;
      const method = editingProduct ? 'PUT' : 'POST';

      const response = await adminFetch(url, {
        method,
        headers: {
          Accept: 'application/json',
        },
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'فشل حفظ المنتج');
      }

      setIsProductModalOpen(false);
      await fetchProducts();
      syncChannel.current?.postMessage({ type: 'REFETCH_DATA' });
      setSuccessMessage(editingProduct ? 'تم تحديث بيانات المنتج بنجاح.' : 'تم إضافة المنتج إلى المخزن الرئيسي.');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmittingProduct(false);
    }
  };

  const handleArchiveProduct = async (id: number) => {
    if (!window.confirm('هل أنت متأكد من أرشفة هذا المنتج؟')) return;
    try {
      const response = await adminFetch(`${API_BASE}/api/admin/products/${id}`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
        },
      });
      if (!response.ok) throw new Error('فشل أرشفة المنتج');
      await fetchProducts();
      syncChannel.current?.postMessage({ type: 'REFETCH_DATA' });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const openStockModal = async (product: Product) => {
    setSelectedProductForStock(product);
    setLoadingStocks(true);
    setIsStockModalOpen(true);
    setSelectedStockBranchId('');
    setAdjustmentQty(0);
    setMovementType('STOCK_RECEIPT');

    try {
      const response = await adminFetch(`${API_BASE}/api/admin/products/${product.id}/stock`, {
        headers: {
          Accept: 'application/json',
        },
      });
      if (!response.ok) throw new Error('فشل تحميل مستويات المخزون بالفروع');
      const data = await response.json();
      setBranchStocks(data);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoadingStocks(false);
    }
  };

  const handleStockAdjustmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductForStock || !selectedStockBranchId || !adjustmentQty) {
      alert('يرجى اختيار الفرع والكمية');
      return;
    }
    if (blocksDirectBranchReceipt) {
      alert('التوريد الجديد يتم إلى المخزن الرئيسي فقط. استخدم الشحنات لتغذية الفروع.');
      return;
    }

    const payload = {
      branch_id: Number(selectedStockBranchId),
      quantity: Number(adjustmentQty),
      movement_type: movementType === 'STOCK_RECEIPT' ? 'SUPPLY_IN' : 'STOCK_ADJUSTMENT',
    };

    try {
      const response = await adminFetch(`${API_BASE}/api/admin/products/${selectedProductForStock.id}/stock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'فشل تعديل الكمية');
      }

      await openStockModal(selectedProductForStock);
      await fetchProducts();
      syncChannel.current?.postMessage({ type: 'REFETCH_DATA' });
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div ref={catalogRef} className="space-y-8 animate-fade-in-up">
      {successMessage && (
        <div className="fixed bottom-8 left-8 z-[110]">
          <div className="rounded-2xl border border-emerald-500/20 bg-[#161616] px-4 py-3 text-[11px] font-black text-emerald-300 shadow-2xl">
            {successMessage}
          </div>
        </div>
      )}

      <div className="flex flex-col items-center justify-between gap-4 lg:flex-row">
        <div className={`flex flex-wrap rounded-2xl border p-1 ${isDarkMode ? 'border-white/5 bg-[#161616]' : 'border-black/5 bg-gray-50'}`}>
          {[
            ['ALL', 'الكل'],
            ['SELLABLE', 'متاح للبيع'],
            ['LOW_STOCK', 'منخفض المخزون'],
            ['OUT_OF_STOCK', 'نفد المخزون'],
            ['NEAR_EXPIRY', 'قريب الانتهاء'],
            ['ARCHIVED', 'مؤرشف'],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => onQueryChange({ status: value as typeof filter })}
              className={`rounded-xl px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-all ${
                filter === value
                  ? isDarkMode
                    ? 'bg-white/10 text-[#E6D690]'
                    : 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex w-full flex-wrap items-center justify-end gap-3 lg:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
            <input
              type="text"
              placeholder="البحث بالاسم أو القسم..."
              value={searchQuery}
              onChange={(e) => onQueryChange({ q: e.target.value }, true)}
              className={`w-full rounded-xl border py-2.5 pr-10 pl-4 text-xs font-bold outline-none transition-all focus:border-[#E6D690] ${
                isDarkMode ? 'border-white/5 bg-[#161616] text-white placeholder:text-gray-600' : 'border-black/5 bg-white text-gray-900'
              }`}
            />
          </div>
          <select
            value={sort}
            onChange={(event) => onQueryChange({ sort: event.target.value as typeof sort })}
            className={`h-[42px] rounded-xl border px-3 text-xs font-bold outline-none transition-all ${
              isDarkMode ? 'border-white/5 bg-[#161616] text-white' : 'border-black/5 bg-white text-gray-900'
            }`}
          >
            <option value="name_asc">الاسم</option>
            <option value="stock_desc">الأعلى مخزونًا</option>
            <option value="price_desc">الأعلى سعرًا</option>
            <option value="updated_desc">الأحدث تحديثًا</option>
          </select>
          <button
            onClick={() => openProductModal(null)}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-[#E53935] px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-white shadow-xl shadow-red-900/20 transition-all hover:bg-[#FF3B30]"
          >
            <Plus size={16} />
            إضافة منتج
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center gap-4 py-24 animate-pulse">
          <RefreshCw size={40} className="animate-spin text-[#E6D690]" />
          <p className={`text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            جاري تحميل كتالوج المنتجات...
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-center">
          <span className="font-bold text-red-500">{error}</span>
        </div>
      )}

      {!loading && !error && (
        <>
          {products.length > 0 ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {products.map((prod) => {
                const totalStock = prod.total_stock ?? prod.stock_quantity;
                const mainStoreStock = prod.main_store_stock ?? 0;
                const imageSrc = resolveProductImage(prod.image_url);
                const expDateObj = prod.expiry_date ? new Date(prod.expiry_date) : null;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const thirtyDaysLater = new Date(today);
                thirtyDaysLater.setDate(today.getDate() + 30);
                const isNearExpiry = !!expDateObj && expDateObj >= today && expDateObj <= thirtyDaysLater;

                return (
                  <div
                    key={prod.id}
                    id={`catalog-product-${prod.id}`}
                    className={`group relative overflow-hidden rounded-[2rem] border p-5 transition-all duration-300 ${
                      isDarkMode ? 'border-white/5 bg-[#161616] hover:border-white/10' : 'border-black/5 bg-white hover:shadow-lg'
                    }`}
                  >
                    <div className="mb-5 overflow-hidden rounded-[1.75rem] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(230,214,144,0.18),_transparent_65%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))]">
                      <div className="relative aspect-[4/3]">
                        {imageSrc ? (
                          <img src={imageSrc} alt={prod.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-white/40">
                            <div className="rounded-[1.5rem] bg-white/[0.05] p-4">
                              <ImageIcon size={30} />
                            </div>
                            <span className="text-[10px] font-black tracking-[0.2em] text-[#E6D690]">NO IMAGE</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-lg bg-white/[0.05] px-2.5 py-0.5 text-[9px] font-black text-white/55">
                            {prod.category}
                          </span>
                          <ProductStockAlerts low={prod.low_stock_locations_count} out={prod.out_of_stock_locations_count} status={prod.stock_status} isDarkMode={isDarkMode} />
                          {!prod.is_active && (
                            <span className="rounded-lg bg-gray-500/15 px-2.5 py-0.5 text-[9px] font-black text-gray-400">
                              مؤرشف
                            </span>
                          )}
                        </div>

                        <h4 className="mt-3 text-base font-black text-white transition-colors group-hover:text-[#E6D690]">
                          {prod.name}
                        </h4>

                        {isNearExpiry && (
                          <p className="mt-1 text-[11px] font-bold text-orange-400">
                            صلاحية قريبة: {prod.expiry_date?.split('T')[0]}
                          </p>
                        )}
                      </div>

                      {prod.selling_price > 0 && (
                        <div className="text-left">
                          <span className="text-xl font-black text-white">{prod.selling_price}</span>
                          <span className="ml-1 text-[9px] font-bold opacity-30">ج.م</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-5 space-y-3 border-t border-white/5 pt-4 text-[11px] font-medium">
                      <div className="flex items-center justify-between">
                        <span className="opacity-45">إجمالي المخزون</span>
                        <span className={`font-black ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                          {totalStock} {prod.unit}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="opacity-45">المخزن الرئيسي</span>
                        <span className="font-black text-white/85">
                          {mainStoreStock} {prod.unit}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="opacity-45">سعر البيع</span>
                        <span className={`font-black ${prod.selling_price > 0 ? 'text-[#E6D690]' : 'text-white/40'}`}>
                          {prod.selling_price > 0 ? `${prod.selling_price} ج.م` : 'غير محدد'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 pt-2">
                        <button
                          onClick={() => onOpenWorkspace(prod.id)}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/5 bg-white/5 py-2.5 text-[10px] font-bold transition-all hover:bg-white/10"
                        >
                          <Store size={12} />
                          إدارة المخزون
                        </button>
                        <button
                          onClick={() => openProductModal(prod)}
                          className="rounded-xl bg-white/5 p-2.5 text-gray-400 transition-all hover:bg-white/10 hover:text-white"
                          title="تعديل"
                        >
                          <Edit2 size={12} />
                        </button>
                        {prod.is_active && (
                          <button
                            onClick={() => handleArchiveProduct(prod.id)}
                            className="rounded-xl bg-white/5 p-2.5 text-gray-400 transition-all hover:bg-red-500/20 hover:text-[#E53935]"
                            title="أرشفة"
                          >
                            <Archive size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
                })}
              </div>

              <CatalogPagination page={pagination.page} perPage={pagination.perPage} total={pagination.total} totalPages={pagination.totalPages} count={products.length} isDarkMode={isDarkMode} onPage={(nextPage) => onQueryChange({ page: nextPage })} />
            </div>
          ) : (
            <div className="space-y-5">
            <div className={`flex flex-col items-center justify-center gap-4 rounded-[3rem] border-2 border-dashed py-24 text-center ${isDarkMode ? 'border-white/5 bg-white/[0.01]' : 'border-gray-100 bg-gray-50/50'}`}>
              <Package size={40} className="mb-2 text-gray-600" />
              <h3 className="text-base font-bold text-gray-400">لا توجد منتجات مطابقة لخيارات البحث</h3>
            </div>
            <CatalogPagination page={1} perPage={pagination.perPage} total={0} totalPages={0} count={0} isDarkMode={isDarkMode} onPage={() => {}} />
            </div>
          )}
        </>
      )}

      {isProductModalOpen && (
        <div className="admin-overlay-shell z-[100] bg-black/80 backdrop-blur-sm">
          <div className="admin-overlay-panel w-full max-w-2xl overflow-y-auto rounded-[2.5rem] border border-white/10 bg-[#121212] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 px-8 py-6">
              <h3 className="text-lg font-black text-white">
                {editingProduct ? 'تعديل بيانات منتج' : 'إضافة منتج جديد'}
              </h3>
              <button
                onClick={() => setIsProductModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/40 transition-all hover:bg-red-500 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleProductSubmit} className="space-y-5 p-8">
              <div className="space-y-3">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">صورة المنتج</label>
                <div className="flex flex-col gap-4 rounded-[2rem] border border-white/10 bg-white/[0.02] p-4 sm:flex-row">
                  <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-[1.5rem] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(230,214,144,0.18),_transparent_65%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))]">
                    {formImagePreview && !imagePreviewFailed ? (
                      <img
                        src={formImagePreview}
                        alt={formName || 'Product preview'}
                        className="h-full w-full object-cover"
                        onError={() => setImagePreviewFailed(true)}
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/45">
                        <div className="rounded-2xl bg-white/[0.05] p-3">
                          <ImageIcon size={24} />
                        </div>
                        <span className="text-[9px] font-black tracking-[0.16em] text-[#E6D690]">PREVIEW</span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 space-y-3">
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#E6D690]/35 bg-[#1A1A1A] px-4 py-3 text-xs font-bold text-white transition-all hover:border-[#E6D690] hover:bg-[#202020]">
                      <Upload size={16} className="text-[#E6D690]" />
                      اختر صورة من الجهاز
                      <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" className="hidden" onChange={handleImageFileChange} />
                    </label>

                    <div className="flex items-center gap-2 text-[11px] font-bold text-white/45">
                      <span>سيتم ضغط الصورة وتهيئتها قبل الرفع لتقليل الحجم.</span>
                      {formImageFile && (
                        <button
                          type="button"
                          onClick={clearSelectedImageFile}
                          className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-white/70 transition-all hover:border-white/20 hover:text-white"
                        >
                          إزالة الاختيار
                        </button>
                      )}
                    </div>

                    <div className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500">أو استخدم رابط صورة اختياري</label>
                      <input
                        type="url"
                        value={formImageUrl}
                        onChange={(e) => handleImageUrlChange(e.target.value)}
                        placeholder="https://example.com/product.jpg"
                        className="w-full rounded-xl border border-white/5 bg-[#1A1A1A] px-4 py-3 text-xs font-bold text-white outline-none transition-all focus:border-[#E6D690]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">اسم المنتج *</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded-xl border border-white/5 bg-[#1A1A1A] px-4 py-3 text-xs font-bold text-white outline-none transition-all focus:border-[#E6D690]"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">القسم *</label>
                <input
                  type="text"
                  required
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  placeholder="شامبو، شفرات، كريمات، عناية"
                  className="w-full rounded-xl border border-white/5 bg-[#1A1A1A] px-4 py-3 text-xs font-bold text-white outline-none transition-all focus:border-[#E6D690]"
                />
              </div>

              {!editingProduct && (
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    الكمية في {mainStoreName} *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={formOpeningQuantity}
                    onChange={(e) => setFormOpeningQuantity(Number(e.target.value))}
                    placeholder="مثال: 100"
                    className="w-full rounded-xl border border-white/5 bg-[#1A1A1A] px-4 py-3 text-xs font-bold text-white outline-none transition-all focus:border-[#E6D690]"
                  />
                  <p className="text-[11px] font-bold leading-5 text-white/55">
                    سيتم إضافة هذه الكمية إلى المخزن الرئيسي فقط.
                  </p>
                </div>
              )}

              {!editingProduct && formOpeningQuantity > 0 && (
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    تاريخ الشراء <span className="normal-case text-white/30">(اختياري)</span>
                  </label>
                  <input
                    type="date"
                    value={formPurchaseDate}
                    onChange={(e) => setFormPurchaseDate(e.target.value)}
                    className="w-full rounded-xl border border-white/[0.04] bg-[#1A1A1A] px-4 py-2.5 text-xs font-semibold text-white/80 outline-none transition-all focus:border-[#E6D690]/50"
                  />
                  <p className="text-[10px] font-semibold text-white/30">
                    سيُحفظ كتاريخ شراء الدفعة الافتتاحية.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">سعر التكلفة</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formCostPrice}
                    onChange={(e) => setFormCostPrice(Number(e.target.value))}
                    className="w-full rounded-xl border border-white/5 bg-[#1A1A1A] px-4 py-3 text-xs font-bold text-white outline-none transition-all focus:border-[#E6D690]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">سعر البيع للعميل</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formSellingPrice}
                    onChange={(e) => setFormSellingPrice(Number(e.target.value))}
                    placeholder="اتركه 0 إذا كان مخزني فقط"
                    className="w-full rounded-xl border border-white/5 bg-[#1A1A1A] px-4 py-3 text-xs font-bold text-white outline-none transition-all focus:border-[#E6D690]"
                  />
                  <p className="text-[11px] font-bold leading-5 text-white/45">
                    إذا كان سعر البيع 0 فسيبقى المنتج في المخزون فقط ولن يظهر في الكاشير حتى يتم تحديد سعر بيع.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">عمولة بيع المنتج %</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formSalesCommissionPercent}
                    onChange={(e) => setFormSalesCommissionPercent(Number(e.target.value))}
                    className="w-full rounded-xl border border-white/5 bg-[#1A1A1A] px-4 py-3 text-xs font-bold text-white outline-none transition-all focus:border-[#E6D690]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">حد التنبيه عند انخفاض الكمية</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={formMinStock}
                    onChange={(e) => setFormMinStock(Number(e.target.value))}
                    className="w-full rounded-xl border border-white/5 bg-[#1A1A1A] px-4 py-3 text-xs font-bold text-white outline-none transition-all focus:border-[#E6D690]"
                  />
                  <p className="text-[11px] font-bold leading-5 text-white/45">
                    عند وصول الكمية لهذا الرقم سيظهر المنتج كمخزون منخفض.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">اسم المورد</label>
                  <input
                    type="text"
                    value={formSupplierName}
                    onChange={(e) => setFormSupplierName(e.target.value)}
                    className="w-full rounded-xl border border-white/5 bg-[#1A1A1A] px-4 py-3 text-xs font-bold text-white outline-none transition-all focus:border-[#E6D690]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">تاريخ الصلاحية</label>
                  <input
                    type="date"
                    value={formExpiryDate}
                    onChange={(e) => setFormExpiryDate(e.target.value)}
                    className="w-full rounded-xl border border-white/5 bg-[#1A1A1A] px-4 py-3 text-xs font-bold text-white outline-none transition-all focus:border-[#E6D690]"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <input
                  type="checkbox"
                  id="formIsActive"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="h-4 w-4 accent-[#E53935]"
                />
                <label htmlFor="formIsActive" className="cursor-pointer select-none text-xs font-bold text-white">
                  نشط ومتاح في العمليات
                </label>
              </div>

              <button
                type="submit"
                disabled={submittingProduct}
                className="mt-4 w-full rounded-xl bg-[#E53935] py-4 text-xs font-bold uppercase tracking-widest text-white shadow-xl transition-all hover:bg-[#ff4343] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submittingProduct ? 'جاري الحفظ...' : editingProduct ? 'حفظ التعديلات' : 'إضافة المنتج'}
              </button>
            </form>
          </div>
        </div>
      )}

      {isStockModalOpen && selectedProductForStock && (
        <div className="admin-overlay-shell z-[100] bg-black/80 backdrop-blur-sm">
          <div className="admin-overlay-panel w-full max-w-2xl overflow-y-auto rounded-[2.5rem] border border-white/10 bg-[#121212] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 px-8 py-6">
              <div>
                <h3 className="text-lg font-black text-white">إدارة مخزون الفروع</h3>
                <p className="mt-1 text-[10px] font-bold text-[#E6D690]">{selectedProductForStock.name}</p>
              </div>
              <button
                onClick={() => setIsStockModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/40 transition-all hover:bg-red-500 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-8 p-8 md:grid-cols-2">
              <div className="space-y-4">
                <h4 className="text-xs font-black tracking-wider text-white/40">مستويات المخزون الحالية</h4>
                {loadingStocks ? (
                  <div className="flex justify-center py-8">
                    <RefreshCw size={24} className="animate-spin text-gray-600" />
                  </div>
                ) : branchStocks.length === 0 ? (
                  <p className="py-6 text-center text-xs text-gray-500">لا توجد سجلات مخزون للفروع</p>
                ) : (
                  <div className="max-h-[300px] space-y-2 overflow-y-auto">
                    {branchStocks.map((bs) => (
                      <div key={bs.branch_id} className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                        <span className="text-xs font-bold text-white">{bs.branch_name}</span>
                        <span className="text-xs font-black text-green-400">
                          {bs.stock_quantity} {selectedProductForStock.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <form onSubmit={handleStockAdjustmentSubmit} className="space-y-4">
                <h4 className="text-xs font-black tracking-wider text-white/40">تعديل المخزون</h4>

                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">الفرع المستهدف</label>
                  <select
                    required
                    value={selectedStockBranchId}
                    onChange={(e) => setSelectedStockBranchId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full rounded-xl border border-white/5 bg-[#1A1A1A] px-4 py-3 text-xs font-bold text-white outline-none transition-all focus:border-[#E6D690]"
                  >
                    <option value="">اختر الفرع...</option>
                    {branchStocks.map((bs) => (
                      <option key={bs.branch_id} value={bs.branch_id}>
                        {bs.branch_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">طبيعة الحركة</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setMovementType('STOCK_RECEIPT')}
                      className={`rounded-xl py-3.5 text-xs font-bold transition-all ${
                        movementType === 'STOCK_RECEIPT'
                          ? 'border border-green-500/40 bg-green-500/20 text-green-400'
                          : 'border border-white/5 bg-[#1A1A1A] text-gray-400 hover:text-white'
                      }`}
                    >
                      توريد مخزني (+)
                    </button>
                    <button
                      type="button"
                      onClick={() => setMovementType('STOCK_ADJUSTMENT')}
                      className={`rounded-xl py-3.5 text-xs font-bold transition-all ${
                        movementType === 'STOCK_ADJUSTMENT'
                          ? 'border border-[#E53935]/40 bg-[#E53935]/20 text-[#E53935]'
                          : 'border border-white/5 bg-[#1A1A1A] text-gray-400 hover:text-white'
                      }`}
                    >
                      تسوية مخزنية
                    </button>
                  </div>
                </div>

                {blocksDirectBranchReceipt && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[11px] font-semibold text-amber-200">
                    التوريد الجديد يتم إلى المخزن الرئيسي فقط، ثم يتم تغذية الفروع عبر الشحنات.
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    كمية التعديل (أدخل قيمة سالبة للخصم)
                  </label>
                  <input
                    type="number"
                    required
                    value={adjustmentQty || ''}
                    onChange={(e) => setAdjustmentQty(Number(e.target.value))}
                    placeholder="مثال: 50 أو -10"
                    className="w-full rounded-xl border border-white/5 bg-[#1A1A1A] px-4 py-3 text-center text-xs font-bold text-white outline-none transition-all focus:border-[#E6D690]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={blocksDirectBranchReceipt}
                  className="mt-4 w-full rounded-xl bg-[#E53935] py-4 text-xs font-bold uppercase tracking-widest text-white shadow-xl transition-all hover:bg-[#ff4343] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  تأكيد وحفظ الحركة
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductCatalog;
