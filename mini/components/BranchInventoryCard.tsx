import React from 'react';
import { CalendarClock, Package2, Truck, AlertTriangle, RotateCcw, Zap } from 'lucide-react';
import { BACKEND_URL } from '../src/api/client';
import { BranchInventoryProduct } from '../src/types/models';

interface BranchInventoryCardProps {
  product: BranchInventoryProduct;
  onConsume: (product: BranchInventoryProduct) => void;
  onReturn: (product: BranchInventoryProduct) => void;
}

const resolveProductImage = (imageUrl?: string | null) => {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('http')) return imageUrl;
  return `${BACKEND_URL}/uploads/${imageUrl.replace(/\\/g, '/')}`;
};

const statusConfig: Record<
  BranchInventoryProduct['status'],
  {
    label: string;
    cardBorder: string;
    dotClass: string;
    badgeBg: string;
    badgeText: string;
    accentLine: boolean;
  }
> = {
  AVAILABLE: {
    label: 'متوفر',
    cardBorder: 'border-white/[0.06]',
    dotClass: 'bg-emerald-400',
    badgeBg: 'bg-emerald-500/10 border-emerald-500/20',
    badgeText: 'text-emerald-400',
    accentLine: false,
  },
  LOW: {
    label: 'منخفض',
    cardBorder: 'border-amber-500/20',
    dotClass: 'bg-amber-400 animate-pulse',
    badgeBg: 'bg-amber-500/10 border-amber-500/20',
    badgeText: 'text-[#E6D690]',
    accentLine: true,
  },
  OUT: {
    label: 'نفد',
    cardBorder: 'border-red-500/15',
    dotClass: 'bg-red-400 animate-pulse',
    badgeBg: 'bg-red-500/10 border-red-500/15',
    badgeText: 'text-red-400',
    accentLine: false,
  },
  UNKNOWN: {
    label: 'غير مؤكد', cardBorder: 'border-white/[0.06]', dotClass: 'bg-gray-400',
    badgeBg: 'bg-white/5 border-white/10', badgeText: 'text-white/60', accentLine: false,
  },
  NOT_APPLICABLE: {
    label: 'غير مطبق', cardBorder: 'border-white/[0.06]', dotClass: 'bg-gray-400',
    badgeBg: 'bg-white/5 border-white/10', badgeText: 'text-white/60', accentLine: false,
  },
};

/** Returns a compact human-readable date like "08 Aug 2026" */
const formatShortDate = (iso?: string | null): string => {
  if (!iso) return 'غير محدد';
  try {
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
  } catch {
    return iso.split('T')[0];
  }
};

/** Expiry pill: colour based on days remaining */
const ExpiryPill: React.FC<{ days?: number | null; dateStr?: string | null }> = ({ days, dateStr }) => {
  if (!dateStr) return null;

  let cls = 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
  let dayLabel = '';
  let expired = false;

  if (days !== null && days !== undefined) {
    if (days < 0) {
      cls = 'bg-red-500/10 text-red-400 border-red-500/20';
      dayLabel = `منتهي منذ ${Math.abs(days)}ي`;
      expired = true;
    } else if (days === 0) {
      cls = 'bg-red-500/10 text-red-400 border-red-500/20';
      dayLabel = 'ينتهي اليوم';
      expired = true;
    } else if (days <= 30) {
      cls = 'bg-amber-500/10 text-amber-300 border-amber-500/20';
      dayLabel = `${days}ي متبقية`;
    } else {
      dayLabel = `${days}ي متبقية`;
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold leading-none tracking-wide ${cls}`}
    >
      {expired ? <AlertTriangle size={9} /> : <CalendarClock size={9} />}
      <span>{formatShortDate(dateStr)}</span>
      {dayLabel && <span className="opacity-60">· {dayLabel}</span>}
    </span>
  );
};

const BranchInventoryCard: React.FC<BranchInventoryCardProps> = ({ product, onConsume, onReturn }) => {
  const cfg = statusConfig[product.status];
  const imageSrc = resolveProductImage(product.image_url);
  const isOut = product.stock_quantity <= 0;
  const hasExpiry = !!product.nearest_expiration;
  const hasReceived = !!product.latest_received_at;

  return (
    <div
      onClick={() => !isOut && onConsume(product)}
      className={[
        'group relative flex flex-col overflow-hidden rounded-2xl border text-right',
        'transition-all duration-300 select-none',
        cfg.cardBorder,
        isOut
          ? 'opacity-40 cursor-not-allowed bg-[#111113]'
          : 'cursor-pointer bg-[#141416] hover:bg-[#18181b] hover:border-white/[0.1] hover:shadow-[0_12px_40px_rgba(0,0,0,0.5)] hover:-translate-y-1 active:scale-[0.985] active:shadow-none',
      ].join(' ')}
    >
      {/* LOW stock top accent line */}
      {cfg.accentLine && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400/60 to-transparent z-10" />
      )}

      {/* ── Image Banner (16:9) ── */}
      <div className="relative w-full overflow-hidden shrink-0" style={{ paddingBottom: '56.25%' }}>
        <div className="absolute inset-0 bg-white/[0.015]">
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={product.name}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Package2 size={28} className="text-white/10" />
            </div>
          )}

          {/* Gradient overlay – bottom of image bleeds into card body */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#141416] via-[#141416]/20 to-transparent" />
        </div>

        {/* Status badge – top right */}
        <div className="absolute top-2.5 right-2.5 z-10">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold leading-none backdrop-blur-sm ${cfg.badgeBg} ${cfg.badgeText}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${cfg.dotClass}`} />
            {cfg.label}
          </span>
        </div>

        {/* Stock qty – top left */}
        <div className="absolute top-2.5 left-2.5 z-10">
          <span className="inline-flex items-baseline gap-1 rounded-full border border-white/10 bg-black/50 backdrop-blur-sm px-2.5 py-1 text-[11px] font-black text-white leading-none">
            {product.stock_quantity}
            <span className="text-[9px] font-semibold text-white/50">{product.unit}</span>
          </span>
        </div>
      </div>

      {/* ── Card Body ── */}
      <div className="flex flex-col gap-2.5 p-3.5 flex-1">

        {/* Name + category */}
        <div className="min-w-0">
          <h4 className="text-[13px] font-black text-white/95 leading-snug line-clamp-2 group-hover:text-[#E6D690] transition-colors duration-200">
            {product.name}
          </h4>
          <span className="text-[10px] text-white/35 font-semibold mt-0.5 block">{product.category || 'عام'}</span>
        </div>

        {/* Thin divider */}
        <div className="h-px bg-white/[0.04]" />

        {/* Meta info */}
        <div className="flex flex-col gap-1.5 flex-1">
          {hasExpiry && (
            <ExpiryPill days={product.nearest_expiration_days} dateStr={product.nearest_expiration} />
          )}

          {hasReceived && (
            <span className="inline-flex items-center gap-1.5 text-[9px] text-white/30 font-semibold">
              <Truck size={9} className="shrink-0 text-white/20" />
              <span>آخر استلام: {formatShortDate(product.latest_received_at)}</span>
            </span>
          )}

          {!hasExpiry && !hasReceived && (
            <span className="text-[9px] text-white/20 font-semibold">لا توجد دفعات مسجلة</span>
          )}
        </div>

        {/* Inline actions */}
        {!isOut && (
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onConsume(product);
              }}
              className={[
                'flex items-center justify-center gap-1.5 rounded-xl py-2.5',
                'text-[11px] font-black tracking-wide',
                'border border-[#E6D690]/15 bg-[#E6D690]/8 text-[#E6D690]',
                'transition-all duration-200',
                'hover:bg-[#E6D690]/14 hover:border-[#E6D690]/30',
              ].join(' ')}
            >
              <Zap size={11} />
              <span>استهلاك</span>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onReturn(product);
              }}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-sky-400/15 bg-sky-400/[0.06] py-2.5 text-[11px] font-black tracking-wide text-sky-300/90 transition-all duration-200 hover:border-sky-300/30 hover:bg-sky-400/[0.1] hover:text-sky-200"
            >
              <RotateCcw size={11} />
              <span>مرتجع</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BranchInventoryCard;
