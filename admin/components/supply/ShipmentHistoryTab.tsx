import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FilterX, Inbox, Loader2, RefreshCw, Search } from 'lucide-react';
import { ShipmentHistoryItem, ShipmentListResponse } from '../../types';
import ShipmentHistoryCard from './ShipmentHistoryCard.tsx';
import { adminFetch } from '../../api/adminFetch';
import { buildShipmentHistoryFilterSignature, buildShipmentHistoryQueryParams } from './supplyWorkspaceFilters.ts';
import { SupplyWorkspaceState } from './supplyWorkspaceTypes.ts';

interface ShipmentHistoryTabProps {
  filters: SupplyWorkspaceState;
  onOpenShipment: (id: number) => void;
  refreshToken?: number;
}

type ShipmentFilter = 'all' | 'OUTBOUND_TRANSFER' | 'INBOUND_SUPPLY' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';
const PAGE_SIZE = 15;

const FILTER_TABS: { id: ShipmentFilter; label: string }[] = [
  { id: 'all', label: 'الكل' },
  { id: 'OUTBOUND_TRANSFER', label: 'التحويلات' },
  { id: 'INBOUND_SUPPLY', label: 'الشحنات الواردة' },
  { id: 'IN_TRANSIT', label: 'قيد النقل' },
  { id: 'RECEIVED', label: 'تم الاستلام' },
  { id: 'CANCELLED', label: 'ملغاة' },
];

const ShipmentHistoryTab: React.FC<ShipmentHistoryTabProps> = ({ filters, onOpenShipment, refreshToken = 0 }) => {
  const [data, setData] = useState<ShipmentListResponse | null>(null);
  const [shipments, setShipments] = useState<ShipmentHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shipmentFilter, setShipmentFilter] = useState<ShipmentFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const filterSignature = useMemo(
    () => `${buildShipmentHistoryFilterSignature(filters)}::${shipmentFilter}::${appliedSearch}::${startDate}::${endDate}`,
    [filters, shipmentFilter, appliedSearch, startDate, endDate],
  );

  const load = useCallback(
    async (nextPage: number, filter: ShipmentFilter, mode: 'replace' | 'append' = 'replace') => {
      if (mode === 'append') {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(null);
      }

      try {
        const params = buildShipmentHistoryQueryParams(filters);
        params.set('page', String(nextPage));
        params.set('per_page', String(PAGE_SIZE));

        if (filter !== 'all') {
          params.set('filter', filter);
        }
        if (appliedSearch) {
          params.set('q', appliedSearch);
        }
        if (startDate) {
          params.set('date_from', startDate);
        }
        if (endDate) {
          params.set('date_to', endDate);
        }

        const res = await adminFetch(`${API_BASE}/api/admin/shipments?${params.toString()}`, {
          headers: { Accept: 'application/json' },
        });
        const json = await res.json();

        if (!res.ok) {
          throw new Error(json.error || 'تعذر تحميل سجل الشحنات.');
        }

        const nextData = json as ShipmentListResponse;
        setData(nextData);
        setShipments((current) => (mode === 'append' ? [...current, ...nextData.shipments] : nextData.shipments));
      } catch (err: any) {
        setError(err.message || 'حدث خطأ أثناء تحميل البيانات.');
      } finally {
        if (mode === 'append') {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [appliedSearch, endDate, filters, startDate],
  );

  useEffect(() => {
    setShipments([]);
    load(1, shipmentFilter, 'replace');
  }, [filterSignature, load, shipmentFilter, refreshToken]);

  const handleRefresh = () => {
    load(1, shipmentFilter, 'replace');
  };

  const handleLoadMore = () => {
    if (!data?.pagination.has_next || loadingMore) return;
    load(data.pagination.page + 1, shipmentFilter, 'append');
  };

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setAppliedSearch(searchInput.trim());
  };

  const clearSearch = () => {
    setSearchInput('');
    setAppliedSearch('');
    searchRef.current?.focus();
  };

  const clearDateFilter = () => {
    setStartDate('');
    setEndDate('');
  };

  const counts = data?.counts;
  const pagination = data?.pagination;

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1 rounded-2xl border border-white/[0.05] bg-white/[0.02] p-1">
          {FILTER_TABS.map((tab) => {
            const count = tab.id === 'all'
              ? counts?.all
              : tab.id === 'OUTBOUND_TRANSFER'
                ? counts?.outbound_transfer
                : tab.id === 'INBOUND_SUPPLY'
                  ? counts?.inbound_supply
                  : tab.id === 'IN_TRANSIT'
                    ? counts?.in_transit
                    : tab.id === 'CANCELLED' ? counts?.cancelled : counts?.received;

            return (
              <button
                key={tab.id}
                onClick={() => setShipmentFilter(tab.id)}
                className={`relative flex items-center gap-2 rounded-xl px-4 py-2 text-[11px] font-semibold transition-all duration-200 ${
                  shipmentFilter === tab.id
                    ? 'bg-white/[0.08] text-white shadow-sm'
                    : 'text-white/40 hover:text-white/65'
                }`}
              >
                {tab.label}
                {count !== undefined && (
                  <span
                    className={`text-[10px] font-bold tabular-nums ${
                      shipmentFilter === tab.id ? 'text-[#E6D690]/80' : 'text-white/25'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <form onSubmit={handleSearch} className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
            <span className="text-[11px] font-medium text-white/45">من</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent text-[12px] font-medium text-white/80 outline-none [color-scheme:dark]"
            />
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
            <span className="text-[11px] font-medium text-white/45">إلى</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent text-[12px] font-medium text-white/80 outline-none [color-scheme:dark]"
            />
          </div>
          {(startDate || endDate) && (
            <button
              type="button"
              onClick={clearDateFilter}
              className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.02] px-3 text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all duration-200"
              title="مسح الفترة"
            >
              <FilterX size={14} />
            </button>
          )}
          <div className="relative">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="البحث برقم الشحنة..."
              className="h-10 w-56 rounded-2xl border border-white/[0.07] bg-white/[0.03] pr-9 pl-4 text-[12px] font-medium text-white/80 placeholder:text-white/25 focus:outline-none focus:border-white/[0.14] focus:bg-white/[0.05] transition-all duration-200"
              dir="rtl"
            />
          </div>
          {appliedSearch && (
            <button
              type="button"
              onClick={clearSearch}
              className="text-[10px] font-semibold text-white/40 hover:text-white/70 transition-colors"
            >
              مسح
            </button>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.02] px-3 text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all duration-200"
          >
            <RefreshCw size={14} className={loading && !loadingMore ? 'animate-spin' : ''} />
          </button>
        </form>
      </div>

      {loading && shipments.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 size={32} className="animate-spin text-[#E6D690]" />
            <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/35">جاري تحميل السجل</p>
          </div>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-[2rem] border border-[#E53935]/15 bg-[#E53935]/5 py-16 text-center">
          <AlertTriangle size={28} className="text-[#E53935]" />
          <p className="text-sm font-semibold text-white">{error}</p>
          <button
            onClick={handleRefresh}
            className="mt-2 inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-2.5 text-[11px] font-semibold text-white/65 transition-all hover:bg-white/[0.06] hover:text-white"
          >
            <RefreshCw size={13} />
            إعادة المحاولة
          </button>
        </div>
      ) : shipments.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-[2rem] border border-dashed border-white/[0.06] py-20 text-center">
          <Inbox size={36} className="text-white/15" />
          <div>
            <p className="text-sm font-semibold text-white/50">
              {appliedSearch
                ? `لا توجد شحنات تطابق "${appliedSearch}"`
                : startDate || endDate
                  ? 'لا توجد شحنات ضمن الفترة المحددة'
                  : 'لا توجد شحنات ضمن الفلاتر الحالية.'}
            </p>
            <p className="mt-1.5 text-[11px] font-medium text-white/28">
              {appliedSearch || startDate || endDate ? 'جرّب تعديل البحث أو الفترة المحددة' : 'جرّب تغيير الفلتر المحلي أو إعادة ضبط أدوات العرض.'}
            </p>
          </div>
          {(appliedSearch || startDate || endDate) && (
            <div className="mt-2 flex items-center gap-3">
              {appliedSearch && (
                <button
                  onClick={clearSearch}
                  className="text-[11px] font-semibold text-[#E6D690]/60 hover:text-[#E6D690] transition-colors"
                >
                  مسح البحث
                </button>
              )}
              {(startDate || endDate) && (
                <button
                  onClick={clearDateFilter}
                  className="text-[11px] font-semibold text-[#E6D690]/60 hover:text-[#E6D690] transition-colors"
                >
                  مسح الفترة
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {shipments.map((shipment) => (
              <ShipmentHistoryCard
                key={shipment.id}
                shipment={shipment}
                onView={onOpenShipment}
              />
            ))}
          </div>

          {pagination && (
            <div className="flex flex-col items-center gap-4 border-t border-white/[0.04] pt-5">
              <span className="text-[11px] font-medium text-white/35">
                عرض {shipments.length} من {pagination.total} شحنة
              </span>

              {pagination.has_next && (
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-5 text-[11px] font-semibold text-white/70 transition-all duration-200 hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loadingMore ? <Loader2 size={15} className="animate-spin" /> : null}
                  <span>{loadingMore ? 'جاري التحميل...' : 'عرض المزيد'}</span>
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ShipmentHistoryTab;
