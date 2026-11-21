import React, { useState } from 'react';
import { History, Package2, RotateCcw, Truck } from 'lucide-react';
import { SupplyOverviewData, overviewControl, overviewPanel } from './supplyOverviewTypes';

interface Props {
  activity: SupplyOverviewData['activity'];
  period?: SupplyOverviewData['period'];
  isDarkMode: boolean;
  onOpenShipment: (id: number) => void;
}

const RecentActivity: React.FC<Props> = ({ activity, period, isDarkMode, onOpenShipment }) => {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? activity.items : activity.items.slice(0, 4);
  const muted = isDarkMode ? 'text-white/45' : 'text-gray-500';
  const divider = isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]';

  return <section className={overviewPanel(isDarkMode)} aria-label="أحداث الفترة الأخيرة">
    <header className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isDarkMode ? 'bg-red-500/[0.07] text-red-300' : 'bg-red-50 text-red-700'}`}><History size={16} aria-hidden="true" /></span>
        <div>
          <h2 className="text-base font-semibold">العمليات الأخيرة</h2>
          <p className={`mt-1 text-[11px] ${muted}`}>أحداث وقيود الفترة المحددة • بتوقيت القاهرة</p>
        </div>
      </div>
      {activity.items.length > 4 && <button type="button" className={`${overviewControl(isDarkMode)} shrink-0`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'عرض أقل' : 'عرض المزيد'}</button>}
    </header>

    {period && <section className={`mt-4 border-y py-3 ${divider}`} aria-label="مستندات الفترة">
      <h3 className="mb-3 text-[11px] font-semibold">نشاط الفترة</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
        {[
          ['شحنات أُرسلت خلال الفترة', period.dispatched_shipments],
          ['شحنات استُلمت خلال الفترة', period.received_shipments],
          ['مستندات توريد استُلمت خلال الفترة', period.supply_receipts],
          ['طلبات مرتجع حُسمت خلال الفترة', period.resolved_return_events],
        ].map(([label, value]) => <div key={label}>
          <dt className={`text-[10px] leading-relaxed ${muted}`}>{label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
        </div>)}
      </dl>
      <p className={`mt-3 text-[10px] leading-relaxed ${muted}`}>عداد حسم المرتجعات يشمل التنفيذ والرفض؛ الأرقام مستندات مستقلة عن حد قائمة الأحداث.</p>
    </section>}

    <div className="mt-4 space-y-2.5">
      {rows.map(row => {
        const Icon = row.event_kind === 'CANCELLED' || row.activity_type === 'RETURN' ? RotateCcw : row.activity_type === 'SHIPMENT' ? Truck : Package2;
        return <article key={row.activity_key} className={`rounded-2xl p-3.5 ${isDarkMode ? 'bg-white/[0.02]' : 'bg-gray-50/80'}`}>
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${isDarkMode ? 'bg-white/[0.03] text-[#E6D690]/80' : 'bg-white text-amber-700'}`}><Icon size={14} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h3 className="text-xs font-semibold leading-relaxed">{row.title}</h3>
                <time dateTime={row.created_at} className={`text-[10px] ${muted}`}>{new Date(row.created_at).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}</time>
              </div>
              <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] ${muted}`}>
                <span>{row.branch_name}</span>
                {(row.shipment_ref || row.return_ref) && <span>• {row.shipment_ref || row.return_ref}</span>}
                {row.record_basis && <span>• قيد مخزني غير مرتبط بمستند</span>}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className={`min-w-0 text-[11px] leading-relaxed ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>{row.products.slice(0, 3).map(product => `${product.product_name} (${product.quantity})`).join('، ')}{row.products.length > 3 ? `، و${row.products.length - 3} منتجات أخرى` : ''}</p>
                {row.shipment_id != null && <button type="button" className={`${overviewControl(isDarkMode)} shrink-0 !min-h-8 !py-1`} onClick={() => onOpenShipment(row.shipment_id!)}>عرض الشحنة</button>}
              </div>
            </div>
          </div>
        </article>;
      })}
    </div>
    {!rows.length && <p className={`py-8 text-center text-xs ${muted}`}>لا توجد أحداث مسجلة مطابقة للفرع والفترة.</p>}
    <footer className={`mt-4 border-t pt-3 text-[10px] leading-relaxed ${divider} ${muted}`}>
      <p>عرض {rows.length} من {activity.total_events} حدث أو قيد مطابق؛ حد التحميل {activity.limit}</p>
      <p className="mt-1">{activity.stock_records_notice}</p>
      {activity.has_more && <p className="mt-1">توجد أحداث أقدم ضمن الفترة؛ استخدم سجل الشحنات أو حركة المنتج للتصفح الكامل.</p>}
    </footer>
  </section>;
};
export default RecentActivity;
