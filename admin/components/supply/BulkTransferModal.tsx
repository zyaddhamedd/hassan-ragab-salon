import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { Branch, BulkTransferCartItem, BulkTransferProduct } from '../../types';
import BranchSelector from './BranchSelector.tsx';
import ProductSearchPicker from './ProductSearchPicker.tsx';
import TransferCart from './TransferCart.tsx';
import TransferSummary from './TransferSummary.tsx';
import { adminFetch } from '../../api/adminFetch';

interface BulkTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  requestContext?: {
    id: number;
    requestRef: string;
    branchId: number;
    items: {
      product_id: number;
      requested_quantity: number;
    }[];
    note?: string | null;
  } | null;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';
const PRODUCT_SEARCH_LIMIT = 20;
const PRODUCT_SEARCH_DEBOUNCE_MS = 300;

const mapTransferProduct = (product: any): BulkTransferProduct => ({
  id: Number(product.id),
  name: product.name,
  category: product.category,
  unit: product.unit,
  selling_price: Number(product.selling_price || 0),
  image_url: product.image_url || null,
  main_store_stock: Number(product.main_store_stock || 0),
});

const BulkTransferModal: React.FC<BulkTransferModalProps> = ({ isOpen, onClose, onSuccess, requestContext }) => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<BulkTransferProduct[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [cartItems, setCartItems] = useState<BulkTransferCartItem[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productSearchError, setProductSearchError] = useState<string | null>(null);
  const productCacheRef = useRef<Map<string, BulkTransferProduct[]>>(new Map());
  const searchRequestIdRef = useRef(0);

  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId) || null,
    [branches, selectedBranchId],
  );

  const resetState = () => {
    setSelectedBranchId(null);
    setCartItems([]);
    setNote('');
    setError(null);
    setProducts([]);
    setProductQuery('');
    setLoadingProducts(false);
    setProductSearchError(null);
    searchRequestIdRef.current = 0;
    productCacheRef.current = new Map();
  };

  const fetchTransferProducts = async (query: string, productIds: number[] = []) => {
    const params = new URLSearchParams({
      purpose: 'bulk_transfer',
      limit: String(Math.max(productIds.length, PRODUCT_SEARCH_LIMIT)),
    });
    const trimmedQuery = query.trim();
    if (trimmedQuery) {
      params.set('q', trimmedQuery);
    }
    if (productIds.length > 0) {
      params.set('product_ids', productIds.join(','));
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

    return Array.isArray(data) ? data.map(mapTransferProduct) : [];
  };

  const loadDependencies = async () => {
    setLoading(true);
    setError(null);
    setProductSearchError(null);

    try {
      const requestedProductIds = requestContext?.items.map((item) => item.product_id) || [];
      const [branchesResponse, initialProducts, requestProducts] = await Promise.all([
        adminFetch(`${API_BASE}/api/admin/branches?exclude_main_warehouse=true`, {
          headers: {
            Accept: 'application/json',
          },
        }),
        fetchTransferProducts(''),
        requestedProductIds.length > 0 ? fetchTransferProducts('', requestedProductIds) : Promise.resolve([]),
      ]);

      const branchesData = await branchesResponse.json();

      if (!branchesResponse.ok) {
        throw new Error(branchesData.error || 'تعذر تحميل الفروع.');
      }

      setBranches(branchesData);
      productCacheRef.current.set('', initialProducts);
      setProducts(initialProducts);

      if (requestContext) {
        const mappedProducts = new Map<number, BulkTransferProduct>();
        for (const product of initialProducts) {
          mappedProducts.set(product.id, product);
        }
        for (const product of requestProducts) {
          mappedProducts.set(product.id, product);
        }

        setSelectedBranchId(requestContext.branchId);
        if (requestContext.note) {
          setNote(requestContext.note);
        }
        const initialCart = requestContext.items.map((item) => {
          const prod = mappedProducts.get(item.product_id);
          return {
            product_id: item.product_id,
            // For requests, allow sending the requested quantity even if MW has 0 stock - MW stock check will warn during validation
            quantity: item.requested_quantity,
            product: prod || {
              id: item.product_id,
              name: `منتج #${item.product_id}`,
              category: '',
              unit: 'قطعة',
              selling_price: 0,
              image_url: null,
              main_store_stock: 0,
            },
          };
        });
        setCartItems(initialCart);
      }
    } catch (loadError: any) {
      setError(loadError.message || 'تعذر تحميل بيانات التحويل.');
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
      const nextProducts = await fetchTransferProducts(productQuery);
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
  };

  useEffect(() => {
    if (!isOpen) return;
    resetState();
    void loadDependencies();
  }, [isOpen, requestContext]);

  useEffect(() => {
    if (!isOpen || loading) return;

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
        const nextProducts = await fetchTransferProducts(productQuery);
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
  }, [isOpen, loading, productQuery]);

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

  if (!isOpen) return null;

  const handleAddProduct = (product: BulkTransferProduct) => {
    setError(null);
    setCartItems((current) => {
      if (current.some((item) => item.product_id === product.id)) {
        return current;
      }

      return [
        ...current,
        {
          product_id: product.id,
          quantity: product.main_store_stock > 0 ? 1 : 0,
          product,
        },
      ];
    });
  };

  const handleQuantityChange = (productId: number, quantity: number) => {
    setError(null);
    setCartItems((current) =>
      current.map((item) => {
        if (item.product_id !== productId) return item;

        const parsedQuantity = Number.isFinite(quantity) ? Math.floor(quantity) : 0;
        const safeQuantity = Math.min(item.product.main_store_stock, Math.max(0, parsedQuantity));
        return {
          ...item,
          quantity: safeQuantity,
        };
      }),
    );
  };

  const handleRemoveProduct = (productId: number) => {
    setError(null);
    setCartItems((current) => current.filter((item) => item.product_id !== productId));
  };

  const validateTransfer = () => {
    if (!selectedBranchId) {
      return 'يجب اختيار الفرع الوجهة أولاً.';
    }
    if (cartItems.length === 0) {
      return 'يجب إضافة منتج واحد على الأقل إلى الشحنة.';
    }

    for (const item of cartItems) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        return `كمية المنتج ${item.product.name} يجب أن تكون أكبر من الصفر.`;
      }
      if (item.quantity > item.product.main_store_stock) {
        return `الكمية المطلوبة للمنتج ${item.product.name} تتجاوز المتاح في المستودع الرئيسي.`;
      }
    }

    return null;
  };

  const handleSubmit = async () => {
    const validationError = validateTransfer();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const isEditRequest = !!requestContext;
      const url = isEditRequest
        ? `${API_BASE}/api/admin/supply-requests/${requestContext.id}/edit-and-send`
        : `${API_BASE}/api/admin/shipments`;

      const response = await adminFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(
          isEditRequest
            ? {
                items: cartItems.map((item) => ({
                  product_id: item.product_id,
                  quantity: item.quantity,
                })),
                note: note.trim() || null,
              }
            : {
                destination_branch_id: selectedBranchId,
                items: cartItems.map((item) => ({
                  product_id: item.product_id,
                  quantity: item.quantity,
                })),
                note: note.trim() || null,
              }
        ),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'تعذر إنشاء الشحنة.');
      }

      onSuccess(data.message || 'تم إرسال الشحنة إلى الفرع.');
      onClose();
    } catch (submitError: any) {
      setError(submitError.message || 'تعذر إنشاء الشحنة.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-overlay-shell admin-overlay-shell--scroll z-[130] bg-black/60 backdrop-blur-md">
      <div className="admin-overlay-panel w-full max-w-7xl rounded-[1.5rem] border border-white/[0.06] bg-[#0e0e11] shadow-[0_40px_120px_rgba(0,0,0,0.5)] md:rounded-[2.2rem]">
        <div className="flex items-start justify-between gap-4 border-b border-white/6 px-6 py-5 text-right">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] text-white/55 transition hover:text-white"
          >
            <X size={16} />
          </button>

          <div className="mr-auto text-right">
            <p className="text-[10px] font-black tracking-[0.22em] text-[#E6D690]">SUPPLY CENTER</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              {requestContext ? `معالجة طلب الفرع ${requestContext.requestRef}` : 'طلب تحويل مخزني'}
            </h2>
            <p className="mt-2 text-[11px] font-medium text-white/45">
              {requestContext 
                ? 'قم بتعديل الكميات المطلوبة أو إضافة منتجات إضافية قبل إصدار شحنة التوريد.' 
                : 'حضّر شحنة إلى الفرع المحدد. ستظهر المنتجات هناك بعد تأكيد الاستلام فقط.'}
            </p>
          </div>
        </div>

        <div className="admin-overlay-body">
        {loading ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 px-6 py-12">
            <Loader2 size={28} className="animate-spin text-[#E6D690]" />
            <p className="text-[11px] font-black tracking-[0.22em] text-white/45">جارٍ تجهيز بيانات الشحنة</p>
          </div>
        ) : error && branches.length === 0 && products.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 px-6 py-12 text-center">
            <p className="text-sm font-black text-white">{error}</p>
            <button
              type="button"
              onClick={loadDependencies}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[11px] font-black text-white"
            >
              <RefreshCw size={14} />
              <span>إعادة المحاولة</span>
            </button>
          </div>
        ) : (
          <div className="space-y-6 px-6 py-6">
            <BranchSelector
              branches={branches}
              selectedBranchId={selectedBranchId}
              onSelect={setSelectedBranchId}
              disabled={!!requestContext}
            />

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-[1.15fr_0.95fr]">
              <ProductSearchPicker
                products={products}
                selectedProductIds={new Set(cartItems.map((item) => item.product_id))}
                onAdd={handleAddProduct}
                query={productQuery}
                onQueryChange={setProductQuery}
                loading={loadingProducts}
                error={productSearchError}
                onRetry={() => void retryProductSearch()}
                placeholder="ابحث باسم المنتج أو القسم"
              />

              <div className="space-y-4">
                <TransferCart
                  items={cartItems}
                  onQuantityChange={handleQuantityChange}
                  onRemove={handleRemoveProduct}
                />

                <TransferSummary
                  items={cartItems}
                  selectedBranch={selectedBranch}
                  note={note}
                  onNoteChange={setNote}
                  error={error}
                  isSubmitting={submitting}
                  onSubmit={handleSubmit}
                />
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

export default BulkTransferModal;
