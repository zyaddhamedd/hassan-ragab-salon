import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, PackagePlus, RefreshCw, Trash2, X } from 'lucide-react';
import { BulkTransferProduct } from '../../types';
import ProductSearchPicker from './ProductSearchPicker.tsx';
import { ProductImageFrame } from './productVisuals.tsx';
import { adminFetch } from '../../api/adminFetch';

interface ReceiveSupplyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';
const PRODUCT_SEARCH_LIMIT = 20;
const PRODUCT_SEARCH_DEBOUNCE_MS = 300;

type SupplyProduct = BulkTransferProduct & {
  barcode?: string | null;
  cost_price?: number | null;
  sku?: string | null;
};

const mapSupplyProduct = (product: any): SupplyProduct => ({
  barcode: product.barcode || null,
  category: product.category,
  cost_price: product.cost_price == null ? null : Number(product.cost_price || 0),
  id: Number(product.id),
  image_url: product.image_url || null,
  main_store_stock: Number(product.main_store_stock || 0),
  name: product.name,
  selling_price: Number(product.selling_price || 0),
  sku: product.sku || null,
  unit: product.unit,
});

interface ReceiveSupplyCartItem {
  product_id: number;
  quantity: number;
  expiration_date: string;
  purchase_date: string;
  product: SupplyProduct;
}

const ReceiveSupplyModal: React.FC<ReceiveSupplyModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [products, setProducts] = useState<SupplyProduct[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [cartItems, setCartItems] = useState<ReceiveSupplyCartItem[]>([]);
  const [supplierName, setSupplierName] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productSearchError, setProductSearchError] = useState<string | null>(null);
  const [focusTargetId, setFocusTargetId] = useState<number | null>(null);
  const [flashProductId, setFlashProductId] = useState<number | null>(null);

  const quantityInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const productCacheRef = useRef<Map<string, SupplyProduct[]>>(new Map());
  const searchRequestIdRef = useRef(0);

  const selectedProductIds = useMemo(
    () => new Set(cartItems.map((item) => item.product_id)),
    [cartItems],
  );

  const totalQuantity = useMemo(
    () => cartItems.reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 0)), 0),
    [cartItems],
  );

  const invalidProductIds = useMemo(
    () => new Set(
      cartItems
        .filter((item) => !Number.isInteger(item.quantity) || item.quantity <= 0)
        .map((item) => item.product_id),
    ),
    [cartItems],
  );

  const hasInvalidQuantity = invalidProductIds.size > 0;

  const totalEstimatedCost = useMemo(() => {
    if (cartItems.length === 0) return 0;

    let hasMissingCost = false;
    let hasKnownCost = false;

    const total = cartItems.reduce((sum, item) => {
      const costPrice = item.product.cost_price;
      if (typeof costPrice !== 'number' || !Number.isFinite(costPrice)) {
        hasMissingCost = true;
        return sum;
      }

      hasKnownCost = true;
      return sum + (costPrice * Math.max(0, item.quantity));
    }, 0);

    if (!hasKnownCost || hasMissingCost) return null;
    return total;
  }, [cartItems]);

  const submitDisabled = submitting || cartItems.length === 0 || hasInvalidQuantity;

  const resetState = () => {
    setProducts([]);
    setProductQuery('');
    setCartItems([]);
    setSupplierName('');
    setNote('');
    setError(null);
    setLoadingProducts(false);
    setProductSearchError(null);
    setFocusTargetId(null);
    setFlashProductId(null);
    quantityInputRefs.current = {};
    cardRefs.current = {};
    searchRequestIdRef.current = 0;
    productCacheRef.current = new Map();
  };

  const fetchSupplyProducts = async (query: string) => {
    const params = new URLSearchParams({
      purpose: 'receive_supply',
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
      throw new Error(data.error || 'تعذر تحميل المنتجات.');
    }

    return Array.isArray(data) ? data.map(mapSupplyProduct) : [];
  };

  const loadInitialProducts = async () => {
    setLoading(true);
    setError(null);
    setProductSearchError(null);

    try {
      const initialProducts = await fetchSupplyProducts('');
      productCacheRef.current.set('', initialProducts);
      setProducts(initialProducts);
    } catch (loadError: any) {
      setError(loadError.message || 'تعذر تحميل بيانات التوريد.');
    } finally {
      setLoading(false);
    }
  };

  const revealSelectedProduct = (productId: number, focusQuantity: boolean) => {
    const card = cardRefs.current[productId];
    const input = quantityInputRefs.current[productId];

    setFlashProductId(productId);
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if (focusQuantity && input) {
      window.setTimeout(() => {
        input.focus();
        input.select();
      }, 180);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    resetState();
    void loadInitialProducts();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || loading || (error && products.length === 0)) return;

    const normalizedQuery = productQuery.trim().toLowerCase();
    const cachedProducts = productCacheRef.current.get(normalizedQuery);
    if (cachedProducts) {
      setProducts(cachedProducts);
      setProductSearchError(null);
      setLoadingProducts(false);
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      const requestId = searchRequestIdRef.current + 1;
      searchRequestIdRef.current = requestId;
      setLoadingProducts(true);
      setProductSearchError(null);

      try {
        const nextProducts = await fetchSupplyProducts(productQuery);
        if (searchRequestIdRef.current !== requestId) return;

        productCacheRef.current.set(normalizedQuery, nextProducts);
        setProducts(nextProducts);
      } catch (searchError: any) {
        if (searchRequestIdRef.current !== requestId) return;
        setProductSearchError(searchError.message || 'تعذر تحميل المنتجات.');
      } finally {
        if (searchRequestIdRef.current === requestId) {
          setLoadingProducts(false);
        }
      }
    }, PRODUCT_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isOpen, loading, productQuery, error, products.length]);

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
    if (focusTargetId == null) return;

    const frame = window.requestAnimationFrame(() => {
      revealSelectedProduct(focusTargetId, true);
      setFocusTargetId(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [cartItems, focusTargetId]);

  useEffect(() => {
    if (flashProductId == null) return;

    const timeout = window.setTimeout(() => {
      setFlashProductId(null);
    }, 1600);

    return () => window.clearTimeout(timeout);
  }, [flashProductId]);

  if (!isOpen) return null;

  const handleAddProduct = (product: SupplyProduct) => {
    setError(null);

    if (selectedProductIds.has(product.id)) {
      revealSelectedProduct(product.id, true);
      return;
    }

    setCartItems((current) => [
      ...current,
      {
        expiration_date: '',
        product,
        product_id: product.id,
        purchase_date: '',
        quantity: 1,
      },
    ]);
    setFocusTargetId(product.id);
    setFlashProductId(product.id);
  };

  const handleRemoveProduct = (productId: number) => {
    setError(null);
    setCartItems((current) => current.filter((item) => item.product_id !== productId));
  };

  const handleQuantityChange = (productId: number, quantity: number) => {
    setError(null);
    setCartItems((current) =>
      current.map((item) => {
        if (item.product_id !== productId) return item;

        const parsedQuantity = Number.isFinite(quantity) ? Math.floor(quantity) : 0;
        return {
          ...item,
          quantity: Math.max(0, parsedQuantity),
        };
      }),
    );
  };

  const handleExpirationDateChange = (productId: number, expirationDate: string) => {
    setError(null);
    setCartItems((current) =>
      current.map((item) => (
        item.product_id === productId
          ? { ...item, expiration_date: expirationDate }
          : item
      )),
    );
  };

  const handlePurchaseDateChange = (productId: number, purchaseDate: string) => {
    setError(null);
    setCartItems((current) =>
      current.map((item) => (
        item.product_id === productId
          ? { ...item, purchase_date: purchaseDate }
          : item
      )),
    );
  };

  const validateSupply = () => {
    if (cartItems.length === 0) {
      return 'يجب إضافة منتج واحد على الأقل إلى التوريد.';
    }

    for (const item of cartItems) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        return `الكمية المستلمة للمنتج ${item.product.name} يجب أن تكون أكبر من الصفر.`;
      }
    }

    return null;
  };

  const handleSubmit = async () => {
    const validationError = validateSupply();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await adminFetch(`${API_BASE}/api/admin/supply/receive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          items: cartItems.map((item) => ({
            expiration_date: item.expiration_date || null,
            product_id: item.product_id,
            purchase_date: item.purchase_date || null,
            quantity: item.quantity,
          })),
          note: note.trim() || null,
          supplier_name: supplierName.trim() || null,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'تعذر تسجيل التوريد.');
      }

      onSuccess(data.message || 'تم تسجيل التوريد في المخزن الرئيسي.');
      onClose();
    } catch (submitError: any) {
      setError(submitError.message || 'تعذر تسجيل التوريد.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-overlay-shell admin-overlay-shell--scroll z-[130] bg-black/60 pr-4 backdrop-blur-md sm:pr-6 lg:pr-[96px]">
      <div className="admin-overlay-panel flex h-[calc(100vh-24px)] max-h-[calc(100vh-24px)] w-full max-w-[1560px] flex-col overflow-hidden rounded-[2rem] border border-white/[0.06] bg-[#0d0d10] shadow-[0_32px_96px_rgba(0,0,0,0.68)]">
        <div className="flex items-center justify-start px-3 py-3 sm:px-4 sm:py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02] text-white/60 transition-all duration-300 hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-white disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="admin-overlay-body min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-0 sm:px-4 sm:pb-4">
          {loading ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-4">
              <Loader2 size={28} className="animate-spin text-[#E6D690]" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/45">جار تجهيز بيانات التوريد</p>
            </div>
          ) : error && products.length === 0 ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-4 text-center">
              <p className="text-sm font-semibold text-white/90">{error}</p>
              <button
                type="button"
                onClick={() => void loadInitialProducts()}
                className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 text-[11px] font-semibold text-white/82 transition-all duration-300 hover:bg-white/[0.05] hover:text-white"
              >
                <RefreshCw size={14} />
                <span>إعادة المحاولة</span>
              </button>
            </div>
          ) : (
            <div className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.94fr)_minmax(0,1.06fr)]">
              <div className="min-h-0 min-w-0">
                <ProductSearchPicker
                  products={products}
                  selectedProductIds={selectedProductIds}
                  onAdd={handleAddProduct}
                  onSelectExisting={handleAddProduct}
                  disableOutOfStock={false}
                  query={productQuery}
                  onQueryChange={setProductQuery}
                  loading={loadingProducts}
                  error={productSearchError}
                  emptyDescription="ابحث باسم المنتج أو القسم لإضافة ما تم استلامه."
                  placeholder="ابحث باسم المنتج أو القسم"
                />
              </div>

              <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-white/[0.05] bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.012))] shadow-[0_22px_60px_rgba(0,0,0,0.2)]">
                <div className="min-h-0 flex-1">
                  {cartItems.length === 0 ? (
                    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 px-5 text-center">
                      <PackagePlus size={28} className="text-white/24" />
                      <p className="text-sm font-semibold text-white/82">لا توجد منتجات مضافة</p>
                      <p className="max-w-md text-[11px] font-medium leading-6 text-white/38">ابدأ من قائمة البحث على اليمين، ثم أضف المنتجات التي وصلت لتظهر هنا مباشرة.</p>
                    </div>
                  ) : (
                    <div className="custom-scrollbar h-full overflow-y-auto px-4 py-3 sm:px-4 sm:py-4">
                      <div className="space-y-3.5">
                        {cartItems.map((item) => {
                          const isInvalid = invalidProductIds.has(item.product_id);
                          const isFlashing = flashProductId === item.product_id;

                          return (
                            <div
                              key={item.product_id}
                              ref={(node) => {
                                cardRefs.current[item.product_id] = node;
                              }}
                              className={`rounded-[1.45rem] border p-3.5 transition-all duration-300 lg:p-4 ${
                                isFlashing
                                  ? 'border-[#E6D690]/30 bg-[#E6D690]/[0.055] shadow-[0_18px_40px_rgba(230,214,144,0.08)]'
                                  : 'border-white/[0.03] bg-white/[0.02] hover:border-white/[0.05] hover:bg-white/[0.03]'
                              }`}
                            >
                              <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[96px_minmax(0,1fr)]">
                                <ProductImageFrame
                                  imageUrl={item.product.image_url}
                                  productName={item.product.name}
                                  className="aspect-square h-[96px] w-[96px]"
                                />

                                <div className="min-w-0">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="line-clamp-2 text-sm font-semibold leading-6 text-white/95">{item.product.name}</p>
                                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                        <span className="rounded-full border border-white/[0.05] bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold text-white/48">
                                          {item.product.category}
                                        </span>
                                        <span className="rounded-full border border-white/[0.05] bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold text-white/48">
                                          المخزون الحالي: {item.product.main_store_stock} {item.product.unit}
                                        </span>
                                      </div>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() => handleRemoveProduct(item.product_id)}
                                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/[0.05] bg-white/[0.015] text-white/42 transition-all duration-300 hover:border-red-500/35 hover:bg-red-500/6 hover:text-red-400"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>

                                  <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1fr)_minmax(0,1fr)]">
                                    <div>
                                      <label className="mb-2 block text-[11px] font-semibold text-white/48">الكمية المستلمة</label>
                                      <input
                                        ref={(node) => {
                                          quantityInputRefs.current[item.product_id] = node;
                                        }}
                                        type="number"
                                        min={1}
                                        step={1}
                                        inputMode="numeric"
                                        value={item.quantity || ''}
                                        onChange={(event) => handleQuantityChange(item.product_id, Number(event.target.value))}
                                        onFocus={(event) => event.currentTarget.select()}
                                        className={`h-12 w-full rounded-2xl border px-4 text-center text-lg font-bold outline-none transition-all duration-200 ${
                                          isInvalid
                                            ? 'border-[#E53935]/40 bg-[#E53935]/[0.06] text-white focus:border-[#ff7b77]'
                                            : 'border-white/[0.05] bg-white/[0.015] text-white focus:border-[#E6D690]/40 focus:bg-white/[0.03]'
                                        }`}
                                      />
                                      {isInvalid && (
                                        <p className="mt-2 text-[11px] font-semibold text-[#ff9d99]">أدخل كمية أكبر من الصفر.</p>
                                      )}
                                    </div>

                                    <div>
                                      <label className="mb-2 block text-[11px] font-semibold text-white/48">تاريخ الصلاحية</label>
                                      <input
                                        type="date"
                                        value={item.expiration_date}
                                        onChange={(event) => handleExpirationDateChange(item.product_id, event.target.value)}
                                        className="h-12 w-full rounded-2xl border border-white/[0.05] bg-white/[0.015] px-4 text-center text-sm font-semibold text-white outline-none transition-all duration-200 focus:border-[#E6D690]/40 focus:bg-white/[0.03]"
                                      />
                                    </div>

                                    <div>
                                      <label className="mb-2 block text-[11px] font-semibold text-white/48">تاريخ الشراء</label>
                                      <input
                                        type="date"
                                        value={item.purchase_date}
                                        onChange={(event) => handlePurchaseDateChange(item.product_id, event.target.value)}
                                        className="h-12 w-full rounded-2xl border border-white/[0.05] bg-white/[0.015] px-4 text-center text-sm font-semibold text-white outline-none transition-all duration-200 focus:border-[#E6D690]/40 focus:bg-white/[0.03]"
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-white/[0.05] bg-[#0d0d10]/92 px-4 py-3 backdrop-blur-sm sm:px-4">
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="rounded-2xl border border-white/[0.03] bg-white/[0.02] px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">عدد المنتجات</p>
                      <p className="mt-1.5 text-xl font-bold text-white/92">{cartItems.length}</p>
                    </div>
                    <div className="rounded-2xl border border-white/[0.03] bg-white/[0.02] px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">إجمالي القطع</p>
                      <p className="mt-1.5 text-xl font-bold text-white/92">{totalQuantity}</p>
                    </div>
                    <div className="rounded-2xl border border-white/[0.03] bg-white/[0.02] px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">إجمالي التكلفة</p>
                      <p className="mt-1.5 text-xl font-bold text-white/92">
                        {typeof totalEstimatedCost === 'number' ? `${totalEstimatedCost.toFixed(2)} ج.م` : 'غير متاح'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold text-white/44">اسم المورد</label>
                      <input
                        value={supplierName}
                        onChange={(event) => setSupplierName(event.target.value)}
                        placeholder="اسم المورد"
                        className="h-11 w-full rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 text-sm font-medium text-white placeholder-white/20 outline-none transition-all duration-200 focus:border-[#E6D690]/40 focus:bg-white/[0.04]"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold text-white/44">ملاحظة</label>
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        rows={2}
                        placeholder="أضف ملاحظة داخلية إذا لزم الأمر"
                        className="w-full rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-sm font-medium text-white placeholder-white/20 outline-none transition-all duration-200 focus:border-[#E6D690]/40 focus:bg-white/[0.04]"
                      />
                    </div>
                  </div>

                  {hasInvalidQuantity && (
                    <div className="mt-3 rounded-2xl border border-[#E53935]/10 bg-[#E53935]/5 px-4 py-3 text-[11px] font-semibold text-[#ff9d99]">
                      توجد منتجات بكمية غير صحيحة. راجع الحقول المميزة قبل التأكيد.
                    </div>
                  )}

                  {error && (
                    <div className="mt-3 rounded-2xl border border-[#E53935]/10 bg-[#E53935]/5 px-4 py-3 text-[11px] font-semibold text-[#ff9d99]">
                      {error}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitDisabled}
                    className={`mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold transition-all duration-300 ${
                      submitDisabled
                        ? 'cursor-not-allowed border border-white/[0.05] bg-white/[0.03] text-white/35'
                        : 'bg-[#E53935] text-white shadow-[0_10px_32px_rgba(229,57,53,0.24)] hover:bg-[#f43f36] hover:shadow-[0_12px_36px_rgba(229,57,53,0.3)]'
                    }`}
                  >
                    {submitting ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />}
                    <span>
                      {submitting
                        ? 'جار تسجيل التوريد...'
                        : cartItems.length === 0
                          ? 'أضف منتجات أولًا'
                          : hasInvalidQuantity
                            ? 'راجع الكميات'
                            : 'تأكيد تسجيل التوريد'}
                    </span>
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReceiveSupplyModal;
