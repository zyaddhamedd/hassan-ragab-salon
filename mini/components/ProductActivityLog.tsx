import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  Clock,
  Hash,
  Loader2,
  Package2,
  Receipt,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { apiClient } from '../src/api/client';
import {
  ProductActivityItem,
  ProductActivityPagination,
  ProductActivityResponse,
  ProductActivitySummary,
  ProductActivityType,
} from '../src/types/models';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toYYYYMMDD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const formatTime = (iso: string): string => {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return '—';
  }
};

const formatDateLabel = (iso: string): string => {
  try {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const dStr = toYYYYMMDD(d);
    const todayStr = toYYYYMMDD(today);
    const yStr = toYYYYMMDD(yesterday);

    if (dStr === todayStr) return 'اليوم';
    if (dStr === yStr) return 'أمس';

    return new Intl.DateTimeFormat('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d);
  } catch {
    return iso.slice(0, 10);
  }
};

// ─── Date preset helpers ──────────────────────────────────────────────────────

type DatePreset = 'today' | 'yesterday' | 'last7' | 'month' | 'custom';

const getPresetDates = (preset: DatePreset): { start: string; end: string } => {
  const now = new Date();
  const today = toYYYYMMDD(now);

  if (preset === 'today') {
    return { start: today, end: today };
  }
  if (preset === 'yesterday') {
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    const yStr = toYYYYMMDD(y);
    return { start: yStr, end: yStr };
  }
  if (preset === 'last7') {
    const d = new Date(now);
    d.setDate(now.getDate() - 6);
    return { start: toYYYYMMDD(d), end: today };
  }
  if (preset === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: toYYYYMMDD(d), end: today };
  }
  return { start: today, end: today };
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: number | string;
  unit?: string;
  color: 'gold' | 'blue' | 'purple';
  icon: React.ReactNode;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, unit, color, icon }) => {
  const colors = {
    gold: {
      bg: 'bg-[#E6D690]/10',
      border: 'border-[#E6D690]/20',
      text: 'text-[#E6D690]',
    },
    blue: {
      bg: 'bg-sky-500/10',
      border: 'border-sky-500/20',
      text: 'text-sky-400',
    },
    purple: {
      bg: 'bg-purple-500/10',
      border: 'border-purple-500/20',
      text: 'text-purple-400',
    },
  }[color];

  return (
    <div className="bg-[#141416] border border-white/[0.04] rounded-2xl p-4 flex items-center gap-3 shadow-sm">
      <div className={`h-10 w-10 rounded-xl ${colors.bg} border ${colors.border} flex items-center justify-center ${colors.text} shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <span className="text-[10px] text-white/35 font-bold block leading-tight">{label}</span>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span className="text-xl font-black text-white leading-none">{value}</span>
          {unit && <span className="text-[10px] text-white/30 font-semibold">{unit}</span>}
        </div>
      </div>
    </div>
  );
};

// ─── Activity Card ────────────────────────────────────────────────────────────

const ActivityCard: React.FC<{ item: ProductActivityItem }> = ({ item }) => {
  const isSale = item.type === 'PRODUCT_SALE';

  return (
    <div className="group relative flex items-center gap-3.5 rounded-xl border border-white/[0.04] bg-[#141416] px-4 py-3.5 transition-all duration-200 hover:border-white/[0.08] hover:bg-[#18181b]">
      {/* Product image or placeholder */}
      <div className="relative shrink-0">
        {item.product_image_url ? (
          <img
            src={item.product_image_url}
            alt={item.product_name}
            className="h-11 w-11 rounded-xl object-cover border border-white/[0.06]"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="h-11 w-11 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
            <Package2 size={16} className="text-white/20" />
          </div>
        )}
        {/* Type dot indicator */}
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#141416] ${
            isSale ? 'bg-sky-400' : 'bg-orange-400'
          }`}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-bold text-white truncate">{item.product_name}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {/* Type badge */}
              <span
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[8px] font-black border leading-none ${
                  isSale
                    ? 'bg-sky-500/10 text-sky-300 border-sky-500/20'
                    : 'bg-orange-500/10 text-orange-300 border-orange-500/20'
                }`}
              >
                {isSale ? <ShoppingCart size={8} /> : <Trash2 size={8} />}
                {isSale ? 'مبيعات' : 'استهلاك داخلي'}
              </span>

              {/* Quantity */}
              <span className="text-[10px] font-black text-white">
                {item.quantity.toLocaleString('ar-EG')}
                <span className="text-white/40 font-medium mr-0.5">{item.product_unit}</span>
              </span>

              {/* Invoice number for sales */}
              {isSale && item.invoice_number != null && (
                <span className="flex items-center gap-0.5 text-[10px] text-[#E6D690]/70 font-semibold">
                  <Receipt size={9} />
                  #{item.invoice_number}
                </span>
              )}

              {/* Reason for consumption */}
              {!isSale && item.reason && (
                <span className="text-[10px] text-white/40 font-medium truncate max-w-[140px]" title={item.reason}>
                  {item.reason}
                </span>
              )}
            </div>
          </div>

          {/* Right side: time + actor */}
          <div className="shrink-0 text-left flex flex-col items-end gap-1">
            <span className="flex items-center gap-1 text-[10px] text-white/30 font-semibold">
              <Clock size={9} />
              {formatTime(item.created_at)}
            </span>
            {item.actor_name && (
              <span className="flex items-center gap-0.5 text-[9px] text-white/25 font-medium">
                <User size={8} />
                {item.actor_name}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Grouped date section ──────────────────────────────────────────────────────

const DateGroup: React.FC<{ dateLabel: string; items: ProductActivityItem[] }> = ({ dateLabel, items }) => (
  <div className="space-y-2.5">
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-black text-white/40 shrink-0">{dateLabel}</span>
      <div className="flex-1 h-px bg-white/[0.04]" />
      <span className="text-[9px] text-white/25 font-semibold shrink-0">{items.length} حركة</span>
    </div>
    {items.map((item) => (
      <ActivityCard key={item.id} item={item} />
    ))}
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

interface ProductActivityLogProps {
  /** Used only to scope fetch, not rendered */
  branchId: number;
}

const ProductActivityLog: React.FC<ProductActivityLogProps> = ({ branchId: _branchId }) => {
  // ── Filter state ──
  const [preset, setPreset] = useState<DatePreset>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [activityType, setActivityType] = useState<'all' | 'sales' | 'consumption'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // ── Data state ──
  const [items, setItems] = useState<ProductActivityItem[]>([]);
  const [pagination, setPagination] = useState<ProductActivityPagination | null>(null);
  const [summary, setSummary] = useState<ProductActivitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  // Debounce search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  // ── Derive date range from preset ──
  const getDateRange = useCallback((): { start: string; end: string } => {
    if (preset === 'custom') {
      return { start: customStart, end: customEnd };
    }
    return getPresetDates(preset);
  }, [preset, customStart, customEnd]);

  // ── Fetch ──
  const fetchActivity = useCallback(async (page: number, append: boolean) => {
    const { start, end } = getDateRange();
    if (preset === 'custom' && (!start || !end)) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    append ? setLoadingMore(true) : setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      start_date: start,
      end_date: end,
      type: activityType,
      page: String(page),
      per_page: '20',
    });
    if (debouncedSearch) params.set('q', debouncedSearch);

    try {
      const data: ProductActivityResponse = await apiClient.get(`/inventory/activity?${params.toString()}`);
      if (requestId !== requestIdRef.current) {
        return;
      }
      if (append) {
        setItems((prev) => [...prev, ...data.items]);
      } else {
        setItems(data.items);
        setSummary(data.summary);
      }
      setPagination(data.pagination);
      // Always refresh summary on first page
      if (!append && data.summary) setSummary(data.summary);
    } catch (err: any) {
      if (requestId === requestIdRef.current) {
        setError(err.message || 'تعذر تحميل سجل الحركات.');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [getDateRange, activityType, debouncedSearch, preset, customStart, customEnd]);

  // Reset & refetch when filters change
  useEffect(() => {
    fetchActivity(1, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customStart, customEnd, activityType, debouncedSearch]);

  const handleLoadMore = () => {
    if (pagination && pagination.has_next) {
      fetchActivity(pagination.page + 1, true);
    }
  };

  // ── Group items by date label ──
  const grouped = React.useMemo(() => {
    const map = new Map<string, ProductActivityItem[]>();
    for (const item of items) {
      const label = formatDateLabel(item.created_at);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(item);
    }
    return Array.from(map.entries());
  }, [items]);

  // ── Date preset labels ──
  const presetLabels: { key: DatePreset; label: string }[] = [
    { key: 'today', label: 'اليوم' },
    { key: 'yesterday', label: 'أمس' },
    { key: 'last7', label: 'آخر 7 أيام' },
    { key: 'month', label: 'هذا الشهر' },
    { key: 'custom', label: 'تخصيص' },
  ];

  const typeLabels: { key: 'all' | 'sales' | 'consumption'; label: string }[] = [
    { key: 'all', label: 'الكل' },
    { key: 'sales', label: 'مبيعات' },
    { key: 'consumption', label: 'استهلاك' },
  ];

  // ── Render ──
  return (
    <div className="space-y-6 pb-6">

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          label="المنتجات المباعة"
          value={summary ? summary.total_sales_qty.toLocaleString('ar-EG') : '—'}
          unit="قطعة"
          color="blue"
          icon={<ShoppingCart size={16} />}
        />
        <SummaryCard
          label="المستهلك داخلياً"
          value={summary ? summary.total_consumption_qty.toLocaleString('ar-EG') : '—'}
          unit="قطعة"
          color="gold"
          icon={<Trash2 size={16} />}
        />
        <SummaryCard
          label="إجمالي الحركات"
          value={summary ? summary.total_movements.toLocaleString('ar-EG') : '—'}
          unit="حركة"
          color="purple"
          icon={<Hash size={16} />}
        />
      </div>

      {/* Filters */}
      <div className="space-y-3">
        {/* Date presets row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {presetLabels.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPreset(key)}
              className={`h-8 rounded-lg px-3 text-[11px] font-bold transition-all duration-200 border ${
                preset === key
                  ? 'bg-[#E6D690]/10 border-[#E6D690]/30 text-[#E6D690]'
                  : 'bg-transparent border-white/[0.05] text-white/40 hover:text-white/70 hover:border-white/10'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Custom date range inputs */}
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="h-9 flex-1 rounded-xl border border-white/[0.06] bg-[#141416] px-3 text-xs font-semibold text-white placeholder-white/20 outline-none focus:border-[#E6D690]/30 transition-all"
            />
            <span className="text-white/30 text-xs font-bold shrink-0">—</span>
            <input
              type="date"
              value={customEnd}
              min={customStart}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="h-9 flex-1 rounded-xl border border-white/[0.06] bg-[#141416] px-3 text-xs font-semibold text-white placeholder-white/20 outline-none focus:border-[#E6D690]/30 transition-all"
            />
          </div>
        )}

        {/* Type filter + search row */}
        <div className="flex items-center gap-2">
          {/* Type toggle pills */}
          <div className="flex items-center gap-1 bg-[#141416] border border-white/[0.05] rounded-xl p-1">
            {typeLabels.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActivityType(key)}
                className={`h-7 rounded-lg px-3 text-[11px] font-bold transition-all duration-200 ${
                  activityType === key
                    ? 'bg-white/10 text-white shadow-sm'
                    : 'text-white/35 hover:text-white/60'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Product search */}
          <div className="relative flex-1 min-w-0">
            <Search size={12} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/25" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث عن منتج..."
              className="h-9 w-full rounded-xl border border-white/[0.05] bg-[#141416] pr-9 pl-3 text-xs font-semibold text-white placeholder-white/20 outline-none focus:border-[#E6D690]/30 focus:bg-[#18181b] transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Refresh */}
          <button
            onClick={() => fetchActivity(1, false)}
            disabled={loading}
            className="h-9 w-9 shrink-0 rounded-xl border border-white/[0.05] bg-[#141416] flex items-center justify-center text-white/40 hover:text-white/80 hover:border-white/10 transition-all disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Content area */}
      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <Loader2 size={24} className="animate-spin text-[#E6D690]" />
          <p className="text-xs font-bold text-white/30">جارٍ تحميل سجل الحركات...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-500/10 bg-red-500/5 py-12 text-center">
          <AlertCircle size={22} className="text-red-400" />
          <p className="text-xs font-bold text-red-300">{error}</p>
          <button
            onClick={() => fetchActivity(1, false)}
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-bold text-white/70 hover:text-white transition-colors"
          >
            <RefreshCw size={12} />
            إعادة المحاولة
          </button>
        </div>
      ) : grouped.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-white/[0.05] bg-[#141416]/30 py-16 text-center">
          <div className="h-14 w-14 rounded-2xl bg-white/[0.02] border border-white/[0.04] flex items-center justify-center">
            <Package2 size={22} className="text-white/15" />
          </div>
          <div>
            <p className="text-sm font-bold text-white/40">لا توجد حركة منتجات خلال هذه الفترة</p>
            <p className="mt-1 text-[11px] text-white/25">جرّب تغيير نطاق التاريخ أو فلتر النوع</p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([label, groupItems]) => (
            <DateGroup key={label} dateLabel={label} items={groupItems} />
          ))}

          {/* Load more */}
          {pagination?.has_next && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-[#141416] py-3.5 text-xs font-bold text-white/50 hover:text-white hover:border-white/10 hover:bg-[#18181b] transition-all duration-200 disabled:opacity-50"
            >
              {loadingMore ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>جارٍ التحميل...</span>
                </>
              ) : (
                <>
                  <ChevronDown size={13} />
                  <span>تحميل المزيد</span>
                  <span className="text-white/25">
                    ({pagination.total - items.length} متبقية)
                  </span>
                </>
              )}
            </button>
          )}

          {/* Pagination info */}
          {pagination && pagination.total > 0 && (
            <p className="text-center text-[10px] text-white/20 font-semibold">
              عرض {items.length.toLocaleString('ar-EG')} من {pagination.total.toLocaleString('ar-EG')} حركة
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default ProductActivityLog;
