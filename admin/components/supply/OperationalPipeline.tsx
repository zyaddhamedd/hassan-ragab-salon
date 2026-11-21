import React, { useState } from 'react';
import { Building2, ChevronDown, Package2, Truck, Warehouse } from 'lucide-react';
import BranchInventoryDrawer from './BranchInventoryDrawer';
import { OverviewBranch, SupplyOverviewData, formatOverviewMoney, overviewControl, overviewPanel } from './supplyOverviewTypes';

interface Props {
  data: SupplyOverviewData;
  isDarkMode: boolean;
  branchId: string;
  onSelectBranch: (id: string) => void;
  children?: React.ReactNode;
}

const OperationalPipeline: React.FC<Props> = ({ data, isDarkMode, branchId, onSelectBranch, children }) => {
  const [drawer, setDrawer] = useState<OverviewBranch | null>(null);
  const c = data.current;
  const selectedBranch = data.branches.find(branch => String(branch.id) === branchId);
  const muted = isDarkMode ? 'text-white/50' : 'text-gray-500';
  const divider = isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]';
  const cards = [
    { label: 'المخزن الرئيسي', value: c.warehouse_visible ? c.warehouse_units?.toLocaleString('ar-EG') : 'غير متاح', description: 'مجموع الأرصدة الموجبة حاليًا', icon: Warehouse, tone: isDarkMode ? 'bg-[#E6D690]/[0.07] text-[#E6D690]' : 'bg-amber-50 text-amber-700' },
    { label: 'شحنات قيد النقل حاليًا', value: c.outstanding_shipments, description: 'حسب الفرع المحدد • مستقل عن الفترة', icon: Truck, tone: isDarkMode ? 'bg-red-500/[0.07] text-red-300' : 'bg-red-50 text-red-700' },
    { label: 'الفروع التشغيلية النشطة', value: c.active_operational_branches, description: 'ضمن صلاحياتك • باستبعاد المخزن الرئيسي', icon: Building2, tone: isDarkMode ? 'bg-emerald-500/[0.07] text-emerald-300' : 'bg-emerald-50 text-emerald-700' },
  ];

  return <div className="space-y-4">
    <section aria-label="ملخص الوضع الحالي" className="grid gap-3 sm:grid-cols-3">
      {cards.map(({ label, value, description, icon: Icon, tone }) => <div key={label} className={`${overviewPanel(isDarkMode)} flex items-center gap-3 !p-4`}>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon size={18} aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2 className={`text-[11px] font-semibold ${muted}`}>{label}</h2>
          <p className="mt-1 text-2xl font-bold leading-none tabular-nums">{value}</p>
          <p className={`mt-2 text-[10px] leading-relaxed ${muted}`}>{description}</p>
        </div>
      </div>)}
    </section>

    <details className={`group/locations border-b pb-3 ${divider}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">مواقع المخزون</span>
        <span className={muted}>{branchId === 'all' ? 'كل الفروع' : selectedBranch?.name || `موقع #${branchId}`}</span>
        <ChevronDown size={13} aria-hidden="true" className={`mr-auto motion-safe:transition-transform group-open/locations:rotate-180 ${muted}`} />
      </summary>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={overviewControl(isDarkMode)} onClick={() => onSelectBranch('all')} aria-pressed={branchId === 'all'}>كل الفروع</button>
        <p className={`text-[10px] ${muted}`}>اختيار الفرع يغيّر النطاق، وزر المخزون يفتح تفاصيل الموقع.</p>
      </div>
      <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
        {data.branches.filter(branch => branch.is_active || String(branch.id) === branchId).map(branch => <div key={branch.id} className={`flex items-center justify-between gap-2 rounded-xl px-2 py-2 ${String(branch.id) === branchId ? isDarkMode ? 'bg-white/[0.05]' : 'bg-black/[0.04]' : ''}`}>
          <button type="button" aria-pressed={String(branch.id) === branchId} onClick={() => onSelectBranch(String(branch.id))} className="min-w-0 flex-1 rounded-lg text-right text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500">
            <span className={`block truncate ${String(branch.id) === branchId ? 'font-bold' : 'font-medium'}`}>{branch.name}{branch.is_main_warehouse ? ' • الرئيسي' : ''}</span>
            {!branch.is_main_warehouse && <span className={`mt-1 block text-[10px] ${muted}`}>بالطريق {branch.outstanding_shipments} • استلام اليوم {branch.received_today}</span>}
          </button>
          <button type="button" className={overviewControl(isDarkMode)} onClick={() => setDrawer(branch)} aria-label={`فتح مخزون ${branch.name}`}>المخزون</button>
        </div>)}
      </div>
    </details>

    <div className={children ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]' : ''}>
      {children && <div className="min-w-0" data-overview-area="period-activity">{children}</div>}
      <aside className={`${overviewPanel(isDarkMode)} min-w-0`} aria-label="مؤشرات الرصيد الحالي" data-overview-area="current-metrics">
        <div className="mb-4 flex items-center gap-2">
          <Package2 size={16} aria-hidden="true" className={isDarkMode ? 'text-[#E6D690]' : 'text-amber-700'} />
          <h2 className="text-sm font-semibold">الرصيد الحالي</h2>
        </div>
        <dl className={`divide-y ${isDarkMode ? 'divide-white/[0.06]' : 'divide-black/[0.06]'}`}>
          <div className="pb-4">
            <dt className={`text-[11px] ${muted}`}>المنتجات النشطة بالكتالوج</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">{c.active_catalog_products}</dd>
          </div>
          {c.warehouse_visible && <div className="py-4">
            <dt className={`text-[11px] leading-relaxed ${muted}`}>قيمة المخزن الرئيسي بالتكلفة الحالية</dt>
            <dd className={`mt-2 text-xl font-bold tabular-nums ${isDarkMode ? 'text-[#E6D690]' : 'text-amber-700'}`}>{formatOverviewMoney(c.warehouse_value)}</dd>
            <dd className={`mt-1 text-[10px] leading-relaxed ${muted}`}>{c.warehouse_name} • رصيد حالي للمنتجات النشطة؛ لا يتغير بفلتر الفترة أو الفرع، ولا يمثل قيمة تاريخية. الكميات تشمل وحدات منتجات مختلفة.</dd>
            {c.missing_cost_products > 0 && <dd role="status" className={`mt-2 text-[11px] leading-relaxed ${isDarkMode ? 'text-amber-200/80' : 'text-amber-800'}`}>تكلفة ناقصة أو غير صالحة لـ{c.missing_cost_products} منتج؛ الجزء المعروف فقط: {formatOverviewMoney(c.known_cost_subtotal)}.</dd>}
            {c.zero_cost_products > 0 && <dd className={`mt-2 text-[10px] ${muted}`}>{c.zero_cost_products} منتج بتكلفة مسجلة صفر.</dd>}
            {c.negative_balance_rows > 0 && <dd className={`mt-2 text-[10px] leading-relaxed ${muted}`}>استُبعدت {c.negative_balance_rows} أرصدة سالبة من جمع الأرصدة الموجبة والتقييم، وفق قاعدة الملخص الحالية.</dd>}
          </div>}
          <div className="pt-4">
            <dt className={`text-[11px] ${muted}`}>شحنات استُلمت اليوم بتوقيت القاهرة</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">{c.received_today}</dd>
          </div>
        </dl>
        <p className={`mt-4 text-[10px] leading-relaxed ${muted}`}>قيد النقل واستلام اليوم حسب الفرع المحدد، ومستقلان عن فترة التقرير. أعداد الكتالوج والفروع ضمن صلاحياتك.</p>
        <p className={`mt-2 text-[10px] ${muted}`}>آخر قراءة: {new Date(data.meta.as_of).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}</p>
      </aside>
    </div>
    {drawer && <BranchInventoryDrawer isOpen onClose={() => setDrawer(null)} branchId={drawer.id} branchName={drawer.name} isDarkMode={isDarkMode} />}
  </div>;
};
export default OperationalPipeline;
