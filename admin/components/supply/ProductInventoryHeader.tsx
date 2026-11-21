import React from 'react';
import { ArrowRight, ImageIcon } from 'lucide-react';
import { ProductWorkspaceProduct } from '../../types';
import { workspaceStyles } from './productWorkspaceStyles';

interface ProductInventoryHeaderProps {
  product: ProductWorkspaceProduct;
  onBack: () => void;
  isDarkMode?: boolean;
}
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';
const resolveProductImage = (imageUrl?: string | null) => {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('http')) return imageUrl;
  return `${API_BASE}/uploads/${imageUrl.replace(/\\/g, '/')}`;
};

export default function ProductInventoryHeader({ product, onBack, isDarkMode = true }: ProductInventoryHeaderProps) {
  const tone = workspaceStyles(isDarkMode);
  const productImage = resolveProductImage(product.image_url);
  return (
    <header className={`${tone.panel} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className={`flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl sm:h-20 sm:w-20 ${tone.subtle}`}>
            {productImage ? <img src={productImage} alt={product.name} className="h-full w-full object-cover" /> : <ImageIcon size={24} className={tone.muted} aria-hidden="true" />}
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${tone.muted}`}>
              <span>{product.category}</span>
              <span>مرجع المنتج <bdi dir="ltr">#{product.id}</bdi></span>
              <span>{product.unit}</span>
              <span className={`rounded-lg px-2 py-0.5 font-bold ${product.is_active ? tone.healthy : tone.unavailable}`}>{product.is_active ? 'نشط' : 'مؤرشف'}</span>
            </div>
            <h1 className="break-words text-xl font-black sm:text-2xl">{product.name}</h1>
            <dl className={`flex flex-wrap gap-x-4 gap-y-1 text-xs ${tone.muted}`}>
              {product.supplier_name && <div className="flex gap-1"><dt>المورد:</dt><dd className="break-words">{product.supplier_name}</dd></div>}
              {product.expiry_date && <div className="flex gap-1"><dt>الصلاحية:</dt><dd><bdi>{product.expiry_date.split('T')[0]}</bdi></dd></div>}
              {product.selling_price > 0 && <div className="flex gap-1"><dt>سعر البيع:</dt><dd className="font-bold tabular-nums">{product.selling_price} ج.م</dd></div>}
              <div><dt className="sr-only">إتاحة البيع</dt><dd>{product.selling_price > 0 ? 'متاح للبيع' : 'مخزني فقط'}</dd></div>
            </dl>
          </div>
        </div>
        <button type="button" onClick={onBack} className={`${tone.button} shrink-0`}>
          <ArrowRight size={15} aria-hidden="true" /> العودة إلى الكتالوج
        </button>
      </div>
    </header>
  );
}
