import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Minus, Plus, Search, Trash2, X } from 'lucide-react';
import { apiClient } from '../src/api/client';

const PRODUCT_SEARCH_LIMIT = 20;
const PRODUCT_SEARCH_DEBOUNCE_MS = 300;

interface SelectedItem {
  product_id: number;
  product_name: string;
  quantity: number;
  image_url: string | null;
  unit: string;
}

interface SupplyRequestSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const SupplyRequestSheet: React.FC<SupplyRequestSheetProps> = ({ isOpen, onClose, onSuccess }) => {
  const [products, setProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const productCacheRef = useRef<Map<string, any[]>>(new Map());
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    setProducts([]);
    setLoadingProducts(false);
    setSearchError(null);
    setSelectedItems([]);
    setNote('');
    setSearchQuery('');
    setError(null);
    productCacheRef.current = new Map();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      setProducts([]);
      setLoadingProducts(false);
      setSearchError(null);
      return;
    }

    const cachedProducts = productCacheRef.current.get(normalizedQuery);
    if (cachedProducts) {
      setProducts(cachedProducts);
      setLoadingProducts(false);
      setSearchError(null);
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      const requestId = searchRequestIdRef.current + 1;
      searchRequestIdRef.current = requestId;
      setLoadingProducts(true);
      setSearchError(null);

      try {
        const data = await apiClient.get(
          `/products/search?q=${encodeURIComponent(searchQuery.trim())}&include_zero_stock=true&limit=${PRODUCT_SEARCH_LIMIT}`,
        );
        if (searchRequestIdRef.current !== requestId) return;

        const nextProducts = Array.isArray(data) ? data : [];
        productCacheRef.current.set(normalizedQuery, nextProducts);
        setProducts(nextProducts);
      } catch (searchErr: any) {
        if (searchRequestIdRef.current !== requestId) return;
        setSearchError(searchErr.message || 'تعذر تحميل المنتجات.');
      } finally {
        if (searchRequestIdRef.current === requestId) {
          setLoadingProducts(false);
        }
      }
    }, PRODUCT_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isOpen, searchQuery]);

  const filteredProducts = useMemo(() => {
    const selectedProductIds = new Set(selectedItems.map((item) => item.product_id));
    return products.filter((product) => !selectedProductIds.has(product.id));
  }, [products, selectedItems]);

  const handleAddItem = (product: any) => {
    setSelectedItems((current) => {
      if (current.some((item) => item.product_id === product.id)) {
        return current;
      }
      return [
        ...current,
        {
          product_id: product.id,
          product_name: product.name,
          quantity: 1,
          image_url: product.image_url || null,
          unit: product.unit || 'قطعة',
        },
      ];
    });
    setSearchQuery('');
    setProducts([]);
    setSearchError(null);
  };

  const handleUpdateQuantity = (productId: number, amount: number) => {
    setSelectedItems((current) =>
      current.map((item) => {
        if (item.product_id !== productId) return item;
        const newQty = Math.max(1, item.quantity + amount);
        return { ...item, quantity: newQty };
      })
    );
  };

  const handleRemoveItem = (productId: number) => {
    setSelectedItems((current) => current.filter((item) => item.product_id !== productId));
  };

  const handleSubmit = async () => {
    if (selectedItems.length === 0) {
      setError('يجب إضافة منتج واحد على الأقل للطلب.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const payload = {
        note: note.trim() || null,
        items: selectedItems.map((item) => ({
          product_id: item.product_id,
          requested_quantity: item.quantity,
        })),
      };

      await apiClient.post('/supply-requests', payload);
      onSuccess('تم إرسال طلب التوريد بنجاح وجاري مراجعته.');
      onClose();
    } catch (err: any) {
      setError(err.message || 'تعذر إرسال الطلب.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 p-2 md:p-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-2xl rounded-[2rem] border border-white/[0.06] bg-[#0e0e11] p-5 md:p-6 shadow-[0_32px_96px_rgba(0,0,0,0.65)] flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="mb-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02] text-white/60 hover:text-white hover:bg-white/[0.05] transition-all duration-300"
          >
            <X size={15} />
          </button>

          <div className="text-right">
            <p className="text-[10px] font-semibold tracking-wider text-[#E6D690]/80 uppercase">NEW SUPPLY REQUEST</p>
            <h3 className="mt-1 text-xl font-semibold text-white/95">طلب توريد منتجات جديد</h3>
          </div>
        </div>

        {/* Body Container */}
        <div className="space-y-4 overflow-y-auto pr-1 flex-1 text-right">
          
          {/* Search bar & suggestion picker */}
          <div className="relative">
            <label className="mb-1.5 block text-[11px] font-semibold text-white/40 uppercase">البحث عن منتجات وإضافتها</label>
            <div className="relative">
              <Search size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث باسم المنتج..."
                className="h-11 w-full rounded-2xl border border-white/[0.05] bg-white/[0.02] pr-10 pl-4 text-xs font-medium text-white placeholder-white/20 outline-none focus:border-[#E6D690]/30 focus:bg-white/[0.04] transition-all duration-200"
              />
            </div>

            {/* Suggestions Overlay */}
            {searchQuery && (
              <div className="absolute z-10 mt-1.5 w-full max-h-48 overflow-y-auto rounded-2xl border border-white/10 bg-[#161619] p-2 shadow-2xl">
                {loadingProducts ? (
                  <div className="flex py-4 items-center justify-center text-white/40 text-xs">
                    <Loader2 size={14} className="animate-spin mr-2" />
                    <span>جارٍ تحميل المنتجات...</span>
                  </div>
                ) : searchError ? (
                  <div className="py-4 text-center text-xs text-[#ff9d99] font-medium">{searchError}</div>
                ) : filteredProducts.length > 0 ? (
                  filteredProducts.map((p) => {
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleAddItem(p)}
                        className="w-full text-right px-4 py-2.5 rounded-xl text-xs flex justify-between items-center transition-colors text-white hover:bg-white/[0.05]"
                      >
                        <span>{p.category}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{p.name}</span>
                          <span className="text-[10px] text-white/30">({p.stock_quantity || 0} {p.unit})</span>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="py-4 text-center text-xs text-white/30 font-medium">
                    {searchQuery.trim() ? 'لا توجد نتائج مطابقة.' : 'ابدأ بالكتابة للبحث عن المنتجات.'}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Selected Items */}
          <div className="flex-1 flex flex-col min-h-[160px]">
            <label className="mb-1.5 block text-[11px] font-semibold text-white/40 uppercase">المنتجات المطلوبة ({selectedItems.length})</label>
            {selectedItems.length > 0 ? (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {selectedItems.map((item) => (
                  <div
                    key={item.product_id}
                    className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.015] border border-white/[0.03] p-3 transition-colors hover:bg-white/[0.025]"
                  >
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.product_id)}
                      className="text-red-400 hover:text-red-300 p-1"
                    >
                      <Trash2 size={14} />
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(item.product_id, -1)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 text-white/80 hover:bg-white/10"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="w-10 text-center font-bold text-sm text-white">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(item.product_id, 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 text-white/80 hover:bg-white/10"
                      >
                        <Plus size={12} />
                      </button>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-semibold text-white/90">{item.product_name}</span>
                      <span className="block text-[10px] text-white/40">{item.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/5 py-8 text-center bg-white/[0.005]">
                <p className="text-xs text-white/30 font-medium">لم يتم تحديد منتجات بعد</p>
                <p className="text-[10px] text-white/20">استخدم شريط البحث بالأعلى لإضافة المنتجات.</p>
              </div>
            )}
          </div>

          {/* Note Input */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-white/40 uppercase">ملاحظة للطلب (اختياري)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="اكتب أي توضيحات للإدارة بخصوص هذا الطلب..."
              className="w-full rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 py-2.5 text-xs font-medium text-white placeholder-white/20 outline-none focus:border-[#E6D690]/30 focus:bg-white/[0.04] transition-all duration-200 resize-none"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-[#E53935]/10 bg-[#E53935]/5 px-4 py-2.5 text-[11px] font-semibold text-[#ff9d99]">
              {error}
            </div>
          )}

        </div>

        {/* Footer actions */}
        <div className="mt-4 pt-3 border-t border-white/5">
          <button
            type="button"
            disabled={isSubmitting || selectedItems.length === 0}
            onClick={handleSubmit}
            className={`flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-xs font-semibold transition-all duration-300 shadow-[0_6px_20px_rgba(230,214,144,0.15)] ${
              isSubmitting || selectedItems.length === 0
                ? 'cursor-not-allowed bg-[#E6D690]/50 text-[#121212]'
                : 'bg-[#E6D690] text-[#121212] hover:bg-[#d9c983]'
            }`}
          >
            {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : null}
            <span>{isSubmitting ? 'جارٍ إرسال الطلب...' : 'إرسال طلب التوريد'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};

export default SupplyRequestSheet;
