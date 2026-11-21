import React from 'react';
import { CalendarDays, Package2, Truck, Eye, Download, MapPin } from 'lucide-react';
import { IncomingShipmentSummary } from '../src/types/models';
import truckImage from '../src/assets/delivery_truck_night.png';

interface IncomingShipmentCardProps {
  shipment: IncomingShipmentSummary;
  onView: (shipmentId: number) => void;
  index?: number;
}

const formatDate = (value: string) => {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      dateStyle: 'medium',
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const IncomingShipmentCard: React.FC<IncomingShipmentCardProps> = ({ shipment, onView }) => {
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.04] bg-[#141416] p-4 flex flex-col sm:flex-row gap-4 text-right hover:border-white/[0.08] hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)] transition-all duration-300">
      
      {/* Shipment Image on the Right (RTL context) */}
      <div className="relative w-full sm:w-48 h-32 sm:h-auto rounded-lg overflow-hidden shrink-0 border border-white/[0.05] bg-white/[0.01]">
        <img
          src={truckImage}
          alt="الشحنة"
          className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
        />
        {/* Semi-transparent dark overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
      </div>

      {/* Shipment Details on the Left (RTL context) */}
      <div className="flex-1 flex flex-col justify-between min-w-0">
        
        {/* Top line: Ref, Status */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-black tracking-wider text-white">
              {shipment.shipment_ref}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-[#8B5CF6]/15 border border-[#8B5CF6]/20 text-[#A78BFA] px-2 py-0.5 text-[10px] font-bold">
              <Truck size={10} />
              <span>في الطريق</span>
            </span>
          </div>
        </div>

        {/* Middle: Source Branch */}
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-white/50 font-semibold">
          <MapPin size={13} className="text-[#E6D690]" />
          <span>من المخزن الرئيسي</span>
        </div>

        {/* Info Icons row */}
        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-semibold text-white/40">
          <div className="flex items-center gap-1">
            <Package2 size={13} className="text-white/20" />
            <span>{shipment.items_count} منتجات</span>
          </div>
          <div className="flex items-center gap-1">
            <Package2 size={13} className="text-white/20" />
            <span>{shipment.total_quantity} قطعة</span>
          </div>
          <div className="flex items-center gap-1">
            <CalendarDays size={13} className="text-white/20" />
            <span>{formatDate(shipment.created_at)}</span>
          </div>
        </div>

        {/* Bottom CTA buttons */}
        <div className="mt-4 flex items-center gap-2">
          {/* Main receive button */}
          <button
            type="button"
            onClick={() => onView(shipment.id)}
            className="flex-1 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#E6D690] to-[#cfa353] hover:from-[#f3e3a1] hover:to-[#e6d690] text-black text-xs font-black transition-all duration-300 shadow-[0_2px_8px_rgba(230,214,144,0.15)] active:scale-98"
          >
            <Download size={13} />
            <span>استلام الشحنة</span>
          </button>
          
          {/* Details eye button */}
          <button
            type="button"
            onClick={() => onView(shipment.id)}
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-white/10 hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.06] text-white/70 hover:text-white transition-all shrink-0"
          >
            <Eye size={14} />
          </button>
        </div>

      </div>

    </div>
  );
};

export default IncomingShipmentCard;
