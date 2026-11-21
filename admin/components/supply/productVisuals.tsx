import React from 'react';
import { ImageIcon, Package2 } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export const resolveInventoryImage = (imageUrl?: string | null) => {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('http') || imageUrl.startsWith('blob:') || imageUrl.startsWith('data:')) {
    return imageUrl;
  }
  return `${API_BASE}/uploads/${imageUrl.replace(/\\/g, '/')}`;
};

interface ProductImageFrameProps {
  imageUrl?: string | null;
  productName: string;
  className?: string;
}

export const ProductImageFrame: React.FC<ProductImageFrameProps> = ({ imageUrl, productName, className = '' }) => {
  const resolvedImage = resolveInventoryImage(imageUrl);

  if (!resolvedImage) {
    return (
      <div className={`flex items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(230,214,144,0.12),rgba(255,255,255,0.02))] ${className}`}>
        <div className="flex flex-col items-center gap-2 text-white/55">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
            <Package2 size={18} />
          </div>
          <span className="text-[9px] font-black tracking-[0.18em] text-white/35">صورة المنتج</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] ${className}`}>
      <img
        src={resolvedImage}
        alt={productName}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={(event) => {
          const target = event.currentTarget;
          target.style.display = 'none';
          const fallback = target.nextElementSibling as HTMLDivElement | null;
          if (fallback) fallback.style.display = 'flex';
        }}
      />
      <div className="hidden h-full w-full items-center justify-center bg-[linear-gradient(135deg,rgba(230,214,144,0.12),rgba(255,255,255,0.02))] text-white/55">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
            <ImageIcon size={18} />
          </div>
          <span className="text-[9px] font-black tracking-[0.18em] text-white/35">صورة المنتج</span>
        </div>
      </div>
    </div>
  );
};
