import React, { useDeferredValue, useMemo, useState } from 'react';
import { Check, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { BulkTransferProduct } from '../../types';
import { ProductImageFrame } from './productVisuals.tsx';

type SearchableProduct = BulkTransferProduct & {
  barcode?: string | null;
  cost_price?: number | null;
  sku?: string | null;
};

interface ProductSearchPickerProps {
  products: SearchableProduct[];
  selectedProductIds: Set<number>;
  onAdd: (product: SearchableProduct) => void;
  onSelectExisting?: (product: SearchableProduct) => void;
  title?: string;
  description?: string;
  placeholder?: string;
  disableOutOfStock?: boolean;
  outOfStockLabel?: string;
  query?: string;
  onQueryChange?: (query: string) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

const ProductSearchPicker: React.FC<ProductSearchPickerProps> = ({
  products,
  selectedProductIds,
  onAdd,
  onSelectExisting,
  title = 'اختيار المنتجات',
  description = 'ابحث داخل المنتجات المتاحة ثم أضف ما تحتاجه إلى الشحنة.',
  placeholder = 'ابحث باسم المنتج أو الباركود',
  disableOutOfStock = true,
  outOfStockLabel = 'غير متاح',
  query,
  onQueryChange,
  loading = false,
  error = null,
  onRetry,
  emptyTitle = 'لا توجد نتائج مطابقة',
  emptyDescription,
}) => {
  const [localQuery, setLocalQuery] = useState('');
  const isRemoteMode = query !== undefined || typeof onQueryChange === 'function';
  const inputValue = isRemoteMode ? query ?? '' : localQuery;
  const deferredQuery = useDeferredValue(inputValue);

  const filteredProducts = useMemo(() => {
    if (isRemoteMode) {
      return products;
    }

    const normalizedQuery = deferredQuery.trim().toLowerCase();
    const visibleProducts = products.filter((product) => {
      if (!normalizedQuery) return true;

      return [
        product.name,
        product.category,
        product.unit,
        product.sku ?? '',
        product.barcode ?? '',
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    });

    return visibleProducts.slice(0, 18);
  }, [deferredQuery, isRemoteMode, products]);

  const showHeader = Boolean(title || description);
  const resolvedEmptyDescription =
    emptyDescription ||
    (inputValue.trim()
      ? 'جرّب اسمًا آخر أو امسح البحث لعرض نتائج مختلفة.'
      : isRemoteMode
        ? 'ابدأ بالكتابة لعرض نتائج البحث المتاحة.'
        : 'جرّب اسمًا آخر أو امسح البحث لعرض كل المنتجات.');

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 text-right">
      {showHeader && (
        <div className="flex items-start justify-between gap-3">
          <div>
            {title ? <h3 className="text-sm font-semibold text-white/92">{title}</h3> : null}
            {description ? <p className="mt-1 text-[11px] font-medium leading-6 text-white/42">{description}</p> : null}
          </div>

          <span className="rounded-full border border-white/[0.05] bg-white/[0.03] px-3 py-1 text-[11px] font-semibold text-white/55">
            {filteredProducts.length}
          </span>
        </div>
      )}

      <div className="relative">
        <Search size={15} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/25" />
        <input
          value={inputValue}
          onChange={(event) => {
            const nextValue = event.target.value;
            if (isRemoteMode) {
              onQueryChange?.(nextValue);
              return;
            }
            setLocalQuery(nextValue);
          }}
          placeholder={placeholder}
          className="h-12 w-full rounded-2xl border border-white/[0.05] bg-white/[0.02] pr-11 pl-4 text-sm font-medium text-white placeholder-white/20 outline-none transition focus:border-[#E6D690]/35 focus:bg-white/[0.04]"
        />
      </div>

      <div className="min-h-[320px] flex-1 overflow-hidden rounded-[1.75rem] border border-white/[0.05] bg-white/[0.015] shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <Loader2 size={22} className="animate-spin text-[#E6D690]" />
            <p className="text-sm font-semibold text-white/78">جارٍ تحميل المنتجات...</p>
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm font-semibold text-white/82">{error}</p>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-[11px] font-semibold text-white/80 transition-all hover:bg-white/[0.05] hover:text-white"
              >
                <RefreshCw size={13} />
                <span>إعادة المحاولة</span>
              </button>
            ) : null}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-semibold text-white/82">{emptyTitle}</p>
            <p className="text-[11px] font-medium text-white/38">{resolvedEmptyDescription}</p>
          </div>
        ) : (
          <div className="custom-scrollbar grid h-full grid-cols-1 gap-2.5 overflow-y-auto p-2.5 2xl:grid-cols-2">
            {filteredProducts.map((product) => {
              const isSelected = selectedProductIds.has(product.id);
              const isOutOfStock = product.main_store_stock <= 0;
              const isStockDisabled = disableOutOfStock && isOutOfStock;
              const canJumpToExisting = isSelected && Boolean(onSelectExisting);
              const isDisabled = isStockDisabled || (isSelected && !canJumpToExisting);
              const priceValue = Number(product.cost_price ?? product.selling_price ?? 0);

              return (
                <div
                  key={product.id}
                  className="grid min-h-[144px] grid-cols-[84px_minmax(0,1fr)] gap-3.5 rounded-[1.45rem] border border-white/[0.03] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-3.5 shadow-sm transition-all duration-300 hover:border-white/[0.06] hover:bg-white/[0.03]"
                >
                  <ProductImageFrame
                    imageUrl={product.image_url}
                    productName={product.name}
                    className="aspect-square h-[84px] w-[84px]"
                  />

                  <div className="flex min-w-0 flex-col">
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-semibold leading-6 text-white/95">{product.name}</p>
                      <p className="mt-1 truncate text-[11px] font-medium text-white/38">{product.category}</p>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/[0.05] bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold text-white/48">
                        المتاح: {product.main_store_stock} {product.unit}
                      </span>
                      <span className="rounded-full border border-[#E6D690]/12 bg-[#E6D690]/6 px-2.5 py-1 text-[10px] font-semibold text-[#E6D690]/88">
                        السعر: {priceValue.toFixed(2)} ج.م
                      </span>
                    </div>

                    <div className="mt-auto pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (isSelected && onSelectExisting) {
                            onSelectExisting(product);
                            return;
                          }

                          onAdd(product);
                        }}
                        disabled={isDisabled}
                        className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl px-4 text-[11px] font-semibold transition-all duration-300 ${
                          isStockDisabled
                            ? 'cursor-not-allowed border border-white/[0.04] bg-white/[0.01] text-white/28'
                            : isSelected
                              ? 'border border-white/[0.06] bg-white/[0.04] text-white/62 hover:bg-white/[0.055]'
                              : 'bg-[#E53935] text-white shadow-[0_8px_24px_rgba(229,57,53,0.22)] hover:bg-[#f43f36] hover:shadow-[0_10px_28px_rgba(229,57,53,0.3)]'
                        }`}
                      >
                        {isSelected ? <Check size={14} /> : <Plus size={14} />}
                        <span>{isSelected ? 'مضاف' : isStockDisabled ? outOfStockLabel : 'إضافة'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductSearchPicker;
