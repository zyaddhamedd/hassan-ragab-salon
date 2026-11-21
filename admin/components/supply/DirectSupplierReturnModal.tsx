import React, { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Search, Store, X } from 'lucide-react';
import { adminFetch } from '../../api/adminFetch';

interface DirectSupplierReturnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

interface SupplierReturnProductOption {
  id: number;
  name: string;
  unit: string;
  main_store_stock: number;
  category?: string;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';
const PRODUCT_SEARCH_LIMIT = 20;
const PRODUCT_SEARCH_DEBOUNCE_MS = 300;

const REASON_OPTIONS = [
  'تالف',
  'منتهي',
  'شحنة خاطئة',
  'غير مطلوب',
  'عيب تصنيع',
  'أخرى',
];

const DirectSupplierReturnModal: React.FC<DirectSupplierReturnModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [products, setProducts] = useState<SupplierReturnProductOption[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<SupplierReturnProductOption | null>(null);
  const [productQuery, setProductQuery] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productSearchError, setProductSearchError] = useState<string | null>(null);
  const productCacheRef = useRef<Map<string, SupplierReturnProductOption[]>>(new Map());
  const searchRequestIdRef = useRef(0);

  const resetState = () => {
    setSelectedProduct(null);
    setProductQuery('');
    setQuantity(1);
    setReason('');
    setNotes('');
    setError(null);
    setLoadingProducts(false);
    setProductSearchError(null);
    setProducts([]);
    searchRequestIdRef.current = 0;
    productCacheRef.current = new Map();
  };

  const fetchProducts = async (query: string) => {
    const params = new URLSearchParams({
      purpose: 'supplier_return',
      limit: String(PRODUCT_SEARCH_LIMIT),
    });
    if (query.trim()) {
      params.set('q', query.trim());
    }

    const response = await adminFetch(`${API_BASE}/api/admin/products/search?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
      },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'تعذر تحميل المنتجات');
    }

    return Array.isArray(data)
      ? data.map((product: any) => ({
          id: Number(product.id),
          name: product.name,
          unit: product.unit,
          main_store_stock: Number(product.main_store_stock || 0),
          category: product.category,
        }))
      : [];
  };

  const loadInitialProducts = async () => {
    setLoading(true);
    setError(null);
    setProductSearchError(null);
    try {
      const initialProducts = await fetchProducts('');
      productCacheRef.current.set('', initialProducts);
      setProducts(initialProducts);
    } catch (loadError: any) {
      setError(loadError.message || 'تعذر تحميل المنتجات');
    } finally {
      setLoading(false);
    }
  };

  const retryProductSearch = async () => {
    const normalizedQuery = productQuery.trim().toLowerCase();
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setLoadingProducts(true);
    setProductSearchError(null);
    productCacheRef.current.delete(normalizedQuery);

    try {
      const nextProducts = await fetchProducts(productQuery);
      if (searchRequestIdRef.current !== requestId) return;

      productCacheRef.current.set(normalizedQuery, nextProducts);
      setProducts(nextProducts);
    } catch (searchError: any) {
      if (searchRequestIdRef.current !== requestId) return;
      setProductSearchError(searchError.message || 'تعذر تحميل المنتجات');
    } finally {
      if (searchRequestIdRef.current === requestId) {
        setLoadingProducts(false);
      }
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    resetState();
    void loadInitialProducts();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || loading) return;

    const normalizedQuery = productQuery.trim().toLowerCase();
    const cachedProducts = productCacheRef.current.get(normalizedQuery);
    if (cachedProducts) {
      setProducts(cachedProducts);
      setLoadingProducts(false);
      setProductSearchError(null);
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      const requestId = searchRequestIdRef.current + 1;
      searchRequestIdRef.current = requestId;
      setLoadingProducts(true);
      setProductSearchError(null);

      try {
        const nextProducts = await fetchProducts(productQuery);
        if (searchRequestIdRef.current !== requestId) return;

        productCacheRef.current.set(normalizedQuery, nextProducts);
        setProducts(nextProducts);
      } catch (searchError: any) {
        if (searchRequestIdRef.current !== requestId) return;
        setProductSearchError(searchError.message || 'تعذر تحميل المنتجات');
      } finally {
        if (searchRequestIdRef.current === requestId) {
          setLoadingProducts(false);
        }
      }
    }, PRODUCT_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isOpen, loading, productQuery]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, submitting]);

  useEffect(() => {
    if (!selectedProduct) return;
    if (quantity > selectedProduct.main_store_stock) {
      setQuantity(selectedProduct.main_store_stock);
    }
  }, [quantity, selectedProduct]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!selectedProduct) {
      setError('اختر المنتج');
      return;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError('أدخل كمية صحيحة');
      return;
    }

    if (!selectedProduct || quantity > selectedProduct.main_store_stock) {
      setError('الكمية غير متاحة في المخزن الرئيسي');
      return;
    }

    if (!reason.trim()) {
      setError('اختر السبب');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await adminFetch(`${API_BASE}/api/admin/supplier-returns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          product_id: selectedProduct.id,
          quantity,
          reason: reason.trim(),
          notes: notes.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'تعذر تسجيل المرتجع للمورد');
      }

      onSuccess(data.message || 'تم تسجيل المرتجع للمورد');
      onClose();
    } catch (submitError: any) {
      setError(submitError.message || 'تعذر تسجيل المرتجع للمورد');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-overlay-shell z-[145] bg-black/70 backdrop-blur-md">
      <div
        className="admin-overlay-panel w-full max-w-[920px] rounded-[2.2rem] border border-white/[0.06] bg-[#0d0d10] shadow-[0_32px_96px_rgba(0,0,0,0.65)]"
        style={{
          ['--app-dialog-width' as string]: '920px',
        }}
      >
        <div className="shrink-0 border-b border-white/[0.05] bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.08),transparent_72%)] px-4 py-4 text-right sm:px-6 sm:py-5">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02] text-white/60 transition-all hover:bg-white/[0.05] hover:text-white disabled:opacity-50"
            >
              <X size={16} />
            </button>

            <div className="mr-auto min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-300/80">SUPPLIER RETURN</p>
              <h3 className="mt-2 text-xl font-semibold text-white/95 sm:text-2xl">مرتجع للمورد</h3>
              <p className="mt-1 text-[11px] font-medium text-white/40 sm:text-xs">
                خصم مباشر من المخزن الرئيسي بدون التأثير على الفروع.
              </p>
            </div>
          </div>
        </div>

        <div className="admin-overlay-body overscroll-contain px-4 py-4 text-right sm:px-6 sm:py-6">
          {loading ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-4">
              <Loader2 size={24} className="animate-spin text-sky-300" />
              <p className="text-sm font-semibold text-white/45">جارٍ تحميل المنتجات...</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="xl:col-span-2">
                  <label className="mb-2 block text-xs font-semibold text-white/45">المنتج</label>
                  <div className="overflow-hidden rounded-[1.7rem] border border-white/[0.05] bg-white/[0.02]">
                    <div className="relative border-b border-white/[0.05]">
                      <Search size={15} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/25" />
                      <input
                        value={productQuery}
                        onChange={(event) => setProductQuery(event.target.value)}
                        placeholder="ابحث باسم المنتج أو القسم..."
                        className="h-12 w-full bg-transparent pr-11 pl-4 text-sm font-medium text-white placeholder-white/20 outline-none"
                      />
                    </div>

                    <div className="max-h-[260px] space-y-2 overflow-y-auto overscroll-contain p-3">
                      {loadingProducts ? (
                        <div className="flex min-h-[120px] items-center justify-center">
                          <Loader2 size={20} className="animate-spin text-sky-300" />
                        </div>
                      ) : productSearchError ? (
                        <div className="space-y-3 rounded-2xl border border-[#E53935]/15 bg-[#E53935]/5 px-4 py-5 text-center">
                          <p className="text-sm font-semibold text-[#ffb1ae]">{productSearchError}</p>
                          <button
                            type="button"
                            onClick={() => void retryProductSearch()}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-[11px] font-semibold text-white/80 transition-all hover:bg-white/[0.05] hover:text-white"
                          >
                            <RefreshCw size={13} />
                            <span>إعادة المحاولة</span>
                          </button>
                        </div>
                      ) : products.map((product) => {
                        const isSelected = product.id === selectedProduct?.id;

                        return (
                          <button
                            key={product.id}
                            type="button"
                            onClick={() => {
                              setSelectedProduct(product);
                              setQuantity((currentQuantity) => {
                                const nextQuantity = Math.min(currentQuantity, product.main_store_stock);
                                return nextQuantity > 0 ? nextQuantity : 1;
                              });
                            }}
                            className={`w-full rounded-2xl border px-4 py-3 text-right transition-all ${
                              isSelected
                                ? 'border-sky-400/30 bg-sky-500/[0.08] shadow-[0_12px_32px_rgba(14,165,233,0.08)]'
                                : 'border-white/[0.04] bg-white/[0.015] hover:border-white/[0.08] hover:bg-white/[0.03]'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-white/95">{product.name}</p>
                                <div className="mt-1 flex flex-wrap items-center justify-end gap-2 text-[11px] font-medium text-white/45">
                                  {product.category && <span>{product.category}</span>}
                                </div>
                              </div>

                              <div className="shrink-0 rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/75">
                                {product.main_store_stock} {product.unit}
                              </div>
                            </div>
                          </button>
                        );
                      })}

                      {!productSearchError && products.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] px-4 py-8 text-center text-sm font-semibold text-white/40">
                          لا توجد منتجات مطابقة
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold text-white/45">الكمية</label>
                  <input
                    type="number"
                    min={1}
                    max={selectedProduct?.main_store_stock || undefined}
                    value={quantity}
                    onChange={(event) => {
                      const nextQuantity = Math.max(0, Number(event.target.value || 0));
                      const maxQuantity = selectedProduct?.main_store_stock;
                      setQuantity(maxQuantity ? Math.min(nextQuantity, maxQuantity) : nextQuantity);
                    }}
                    className="h-12 w-full rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 text-sm font-medium text-white outline-none focus:border-[#E6D690]/30"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold text-white/45">السبب</label>
                  <select
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className="h-12 w-full rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 text-sm font-medium text-white outline-none focus:border-[#E6D690]/30"
                  >
                    <option value="">اختر السبب</option>
                    {REASON_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedProduct && (
                <div className="rounded-2xl border border-sky-500/10 bg-sky-500/[0.05] px-4 py-3 text-sm text-white/75">
                  <span className="font-semibold text-sky-200">الرصيد الحالي:</span>{' '}
                  {selectedProduct.main_store_stock} {selectedProduct.unit}
                </div>
              )}

              <div>
                <label className="mb-2 block text-xs font-semibold text-white/45">ملاحظات</label>
                <textarea
                  rows={4}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="ملاحظة اختيارية"
                  className="w-full rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-sm font-medium text-white outline-none resize-none focus:border-[#E6D690]/30"
                />
              </div>

              {products.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] px-4 py-10 text-center text-sm font-semibold text-white/40">
                  لا توجد منتجات متاحة في المخزن الرئيسي.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-white/[0.05] bg-[#0d0d10]/95 px-4 py-4 backdrop-blur sm:px-6">
          <div className="space-y-3">
            {error && (
              <div className="rounded-2xl border border-red-500/10 bg-red-500/5 px-4 py-3 text-sm font-semibold text-red-300">
                {error}
              </div>
            )}

            <div className="flex justify-start">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || loading || products.length === 0}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-sky-400/20 bg-sky-500 px-5 text-sm font-bold text-white transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[200px]"
              >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <Store size={15} />}
                <span>{submitting ? 'جارٍ الحفظ...' : 'تسجيل المرتجع'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DirectSupplierReturnModal;
