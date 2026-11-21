import React from 'react';
import { Trash2 } from 'lucide-react';
import { BulkTransferCartItem } from '../../types';
import { ProductImageFrame } from './productVisuals.tsx';

interface TransferCartProps {
  items: BulkTransferCartItem[];
  onQuantityChange: (productId: number, quantity: number) => void;
  onRemove: (productId: number) => void;
}

const TransferCart: React.FC<TransferCartProps> = ({ items, onQuantityChange, onRemove }) => {
  return (
    <div className="space-y-3 text-right">
      <div>
        <h3 className="text-sm font-black text-white">الشحنة</h3>
        <p className="mt-1 text-[11px] font-bold text-white/45">حدد كمية كل منتج قبل إنشاء التحويل.</p>
      </div>

      {items.length === 0 ? (
          <div className="rounded-[1.45rem] border border-dashed border-white/[0.06] bg-white/[0.02] px-4 py-10 text-center text-[11px] font-bold text-white/40">
            لم يتم إضافة منتجات إلى الشحنة بعد.
          </div>
        ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.product_id}
              className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 rounded-[1.35rem] border border-white/8 bg-black/20 p-3"
            >
              <ProductImageFrame
                imageUrl={item.product.image_url}
                productName={item.product.name}
                className="aspect-square h-[84px] w-[84px]"
              />

              <div className="flex min-w-0 flex-col justify-between">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-black leading-6 text-white">{item.product.name}</p>
                    <p className="mt-1 text-[11px] font-bold text-white/40">
                      المتاح في المستودع الرئيسي: {item.product.main_store_stock} {item.product.unit}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRemove(item.product_id)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] text-white/45 transition hover:border-[#E53935]/30 hover:text-[#ff847f]"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <label className="text-[11px] font-bold text-white/45">الكمية</label>
                  <input
                    type="number"
                    min={1}
                    max={item.product.main_store_stock}
                    step={1}
                    value={item.quantity}
                    onChange={(event) => onQuantityChange(item.product_id, Number(event.target.value))}
                    className="h-11 w-28 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 text-center text-sm font-black text-white outline-none transition focus:border-[#E6D690]/40"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TransferCart;
