import React from 'react';
import { ArrowLeft, CheckCircle2, Clock, Inbox, Package2, Truck, User } from 'lucide-react';
import { ShipmentHistoryItem } from '../../types';

interface ShipmentHistoryCardProps {
  shipment: ShipmentHistoryItem;
  onView: (id: number) => void;
}

const formatRelativeTime = (iso: string | null): string => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return '—';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `منذ ${Math.max(1, minutes)} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `منذ ${days} يوم`;
  const months = Math.floor(days / 30);
  return `منذ ${months} شهر`;
};

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '—';
  }
};

const formatCurrency = (value: number): string => (
  `${Number(value || 0).toLocaleString('ar-EG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ج.م`
);

const ShipmentHistoryCard: React.FC<ShipmentHistoryCardProps> = ({ shipment, onView }) => {
  const isInbound = shipment.shipment_type === 'INBOUND_SUPPLY';
  const isInTransit = shipment.status === 'IN_TRANSIT';
  const isCancelled = shipment.status === 'CANCELLED';

  const badgeConfig = isInbound
    ? {
        label: 'شحنة واردة',
        icon: <Inbox size={11} />,
        classes: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200',
        dot: 'bg-cyan-300',
      }
    : {
        label: 'تحويل',
        icon: <Truck size={11} />,
        classes: 'border-[#E6D690]/20 bg-[#E6D690]/10 text-[#E6D690]',
        dot: 'bg-[#E6D690]',
      };

  const statusConfig = isCancelled
    ? { label: 'ملغاة', icon: <Clock size={11} />, classes: 'border-red-400/20 bg-red-400/10 text-red-300', dot: 'bg-red-400' }
    : isInTransit
    ? {
        label: 'قيد النقل',
        icon: <Truck size={11} />,
        classes: 'border-amber-400/20 bg-amber-400/8 text-amber-300',
        dot: 'bg-amber-400 animate-pulse',
      }
    : {
        label: 'تم الاستلام',
        icon: <CheckCircle2 size={11} />,
        classes: 'border-emerald-400/20 bg-emerald-400/8 text-emerald-300',
        dot: 'bg-emerald-400',
      };

  const sourceName = isInbound
    ? shipment.supplier_name_snapshot || 'توريد خارجي'
    : shipment.source_branch?.name || 'غير محدد';
  const destinationName = shipment.destination_branch?.name || 'المخزن الرئيسي';
  const actorName = isInbound
    ? shipment.created_by?.full_name
    : isInTransit || isCancelled
      ? shipment.created_by?.full_name
      : shipment.received_by?.name || shipment.created_by?.full_name;
  const actorLabel = isInbound
    ? 'سُجلت بواسطة'
    : isInTransit || isCancelled
      ? 'أُنشئت بواسطة'
      : 'استُلمت بواسطة';
  const primaryDate = isInbound
    ? shipment.created_at
    : isInTransit || isCancelled
      ? shipment.created_at
      : (shipment.received_at || shipment.created_at);
  const dateLabel = isInbound
    ? 'تاريخ التوريد'
    : isInTransit || isCancelled
      ? 'تاريخ الإرسال'
      : 'تاريخ الاستلام';
  const productsCount = shipment.products_count || shipment.items_count;
  const piecesCount = shipment.pieces_count || shipment.total_quantity;
  const totalCost = shipment.total_cost_snapshot || shipment.total_cost_amount;

  return (
    <div
      className="group relative overflow-hidden rounded-[1.75rem] border border-white/[0.04] bg-white/[0.015] p-5 transition-all duration-300 hover:border-white/[0.07] hover:bg-white/[0.025]"
      dir="rtl"
    >
      <div className="pointer-events-none absolute inset-0 rounded-[1.75rem] bg-[radial-gradient(ellipse_at_top_left,rgba(230,214,144,0.04),transparent_60%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="rounded-full border border-[#E6D690]/10 bg-[#E6D690]/5 px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-[#E6D690]/80">
              {shipment.shipment_ref}
            </span>

            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${badgeConfig.classes}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${badgeConfig.dot}`} />
              {badgeConfig.icon}
              {badgeConfig.label}
            </span>

            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusConfig.classes}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statusConfig.dot}`} />
              {statusConfig.icon}
              {statusConfig.label}
            </span>

            <span className="flex items-center gap-1 text-[10px] font-medium text-white/35">
              <Clock size={10} />
              {formatRelativeTime(primaryDate)}
            </span>
          </div>

          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="max-w-[150px] truncate text-white/65">{sourceName}</span>
            <ArrowLeft size={13} className="shrink-0 text-white/20" />
            <span className="max-w-[170px] truncate text-white/95">{destinationName}</span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] font-medium text-white/40">
            <span className="flex items-center gap-1.5">
              <Package2 size={11} className="text-white/25" />
              <span>{productsCount} {productsCount === 1 ? 'منتج' : 'منتجات'}</span>
            </span>
            <span className="text-white/20">·</span>
            <span>{piecesCount} قطعة</span>
            <span className="text-white/20">·</span>
            <span className="text-[13px] font-semibold text-[#E6D690]/90">إجمالي التكلفة: {formatCurrency(totalCost)}</span>
            {actorName && (
              <>
                <span className="text-white/20">·</span>
                <span className="flex items-center gap-1">
                  <User size={11} className="text-white/25" />
                  <span className="text-white/40">{actorLabel}:</span>
                  <span className="font-semibold text-white/65">{actorName}</span>
                </span>
              </>
            )}
          </div>

          {shipment.note && (
            <p className="line-clamp-1 rounded-xl border border-white/[0.03] bg-white/[0.02] px-3 py-1.5 text-[11px] font-medium text-white/38">
              {shipment.note}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-row items-center gap-3 lg:flex-col lg:items-start lg:gap-2">
          <div className="hidden text-right lg:block">
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-white/28">
              {dateLabel}
            </p>
            <p className="whitespace-nowrap text-[11px] font-semibold text-white/55">
              {formatDate(primaryDate)}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onView(shipment.id)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-[11px] font-semibold text-white/65 shadow-sm transition-all duration-200 hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-white"
          >
            عرض التفاصيل
            <ArrowLeft size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShipmentHistoryCard;
