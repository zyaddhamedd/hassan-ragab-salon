import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import InlineCards from '../src/studio/InlineCards';
import { appearanceFor, emptyPreferences, preferenceKey, readPreferences, writePreferences, orderedItems, defaultServices, changeAppearance, type Appearance, type Preferences } from '../src/studio/preferences';
import { createStudioBoundary, isStudioShortcut } from '../src/studio/safety';
import type { MiniDeviceContext } from '../src/api/client';
import '../src/studio/studio.css';
import {
  User,
  UserX,
  Phone,
  CheckCircle2,
  ArrowRight,
  Users,
  Wallet,
  CreditCard,
  Landmark,
  Tag,
  Percent,
  X,
  Plus,
  Check,
  ArrowDownCircle,
  Sparkles,
  ArrowLeft,
  Scissors,
  Layers,
  DollarSign,
  ImageIcon,
  Search
} from 'lucide-react';
import Receipt, { ReceiptGroup } from './Receipt';
import InvoiceSection from './InvoiceSection';
import CustomerInfoBadges, { normalizeVisitCount } from './CustomerInfoBadges';
import { StaffMember, AdminSettings, Appointment } from '../App';
import { apiClient, BACKEND_URL, isUnknownPaymentOutcomeError } from '../src/api/client';
import { Grid } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { getProductsForBranch, invalidateProductsCacheForBranch } from '../src/utils/productCache';


const BRANCH_NAME = "فرع الشيخ زايد";

const resolveProductImage = (imageUrl?: string | null) => {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('http')) return imageUrl;
  return `${BACKEND_URL}/uploads/${imageUrl.replace(/\\/g, '/')}`;
};

import { PaymentMethod } from '../src/types/payment';

import { Invoice, Category, Service, BookingHandoffRequest, BookingHandoffContext } from '../src/types/models';
import { SessionedInvoiceItem } from '../src/types/session';
import { PromoPreviewResult } from '../src/types/promo';
import { getPromoErrorMessage } from '../src/utils/promo';
import {
  paymentFailureMessage,
  PaymentAttemptResult,
  PaymentPhase,
  resolvePaymentAttempt,
  tryBeginPaymentAttempt,
} from '../src/utils/paymentAttempt';

const ignoreStudioClick = () => {};
let servicesCache: Category[] | null = null;
let servicesCacheBranchId: number | null = null;
let servicesCachePromise: Promise<Category[]> | null = null;
let servicesCachePromiseBranchId: number | null = null;
const ACTIVE_PAYMENT_ATTEMPT_STORAGE_KEY = 'mini_active_payment_attempt';

const clearStoredPaymentAttempt = () => {
  try {
    sessionStorage.removeItem(ACTIVE_PAYMENT_ATTEMPT_STORAGE_KEY);
  } catch {}
};

const storePaymentAttempt = (attempt: unknown) => {
  try {
    sessionStorage.setItem(ACTIVE_PAYMENT_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
  } catch {}
};

const readStoredPaymentAttempt = (): string | null => {
  try {
    return sessionStorage.getItem(ACTIVE_PAYMENT_ATTEMPT_STORAGE_KEY);
  } catch {
    return null;
  }
};

interface CashierProps {
  isActive?: boolean;
  sidebarOpen?: boolean;
  deviceContext?: MiniDeviceContext | null;
  handoffRequest?: BookingHandoffRequest | null;
  onHandoffResult?: (appointmentId: number, error?: string) => void;
  presentBarbers: StaffMember[];
  presentAssistants: StaffMember[];
  adminSettings: AdminSettings;
  appointments: Appointment[];
  cashier: {
    id: number;
    name: string;
    branch_id: number;
    branch_name: string;
    email?: string;
  };
}

const MemoizedServiceCard = React.memo(({
  service,
  isInInvoice,
  isPending,
  onClick,
  appearance
}: {
  service: Service,
  isInInvoice: boolean,
  isPending: boolean,
  onClick: (service: Service) => void,
  appearance?: Appearance
}) => {
  console.log(`[RENDER] ServiceCard: ${service.name} (id: ${service.id}) | isInInvoice: ${isInInvoice} | isPending: ${isPending}`);
  return (
    <button
      onClick={() => !isInInvoice && onClick(service)}
      disabled={isInInvoice || isPending}
      className={`group relative flex h-full flex-col overflow-hidden rounded-[2rem] border p-6 transition-all duration-300 ${isInInvoice
        ? 'bg-[#E53935]/10 border-[#E53935]/30 cursor-default ring-1 ring-[#E53935]/20'
        : 'bg-[#1A1A1A] border-white/5 text-[#BDBDBD] hover:border-white/20 hover:bg-[#222]'
        }`}
    >
      {appearance?.popular && <span className="omar-studio-badge" dir="ltr">POPULAR</span>}
      <div className="z-10 mb-8 flex items-start justify-between">
        <div className={`rounded-2xl p-3 ${isInInvoice ? 'bg-[#E53935] text-white shadow-lg shadow-[#E53935]/20' : 'bg-black/40 text-white/20 transition-colors group-hover:text-[#E53935]'}`}>
          {isInInvoice ? <CheckCircle2 size={18} /> : (isPending ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Plus size={18} />)}
        </div>
        <div className="text-left">
          <span className={`text-2xl font-black transition-colors ${isInInvoice ? 'text-white' : 'text-white group-hover:text-[#E6D690]'}`}>{service.price}</span>
          <span className="text-[10px] font-bold opacity-40 ml-1">ج.م</span>
        </div>
      </div>
      <div className="z-10 mt-auto">
        <h4 className={`text-sm font-black tracking-tight transition-colors ${isInInvoice ? 'text-[#E53935]' : 'text-[#F5F5F5] group-hover:text-white'}`}>{service.name}</h4>
        <div className={`w-8 h-1 mt-3 rounded-full transition-all duration-500 ${isInInvoice ? 'bg-[#E53935] w-12' : 'bg-white/5 group-hover:bg-[#E6D690] group-hover:w-16'}`} />
      </div>
      <div className={`absolute bottom-0 left-0 w-24 h-24 bg-[#E53935]/5 blur-2xl rounded-full -translate-x-1/2 translate-y-1/2 transition-all duration-500 opacity-0 group-hover:opacity-100`} />
    </button>
  );
});


const ServiceCell = React.memo(({ columnIndex, rowIndex, style, services, columnCount, selectedServiceIds, pendingServiceIds, handleServiceClick, studioPreferences }: any) => {
  const itemIndex = rowIndex * columnCount + columnIndex;
  const service = services[itemIndex];

  if (!service) {
    return <div style={style} />;
  }

  const isInInvoice = selectedServiceIds.has(service.id);
  const isPending = pendingServiceIds.has(service.id);

  return (
    <div style={{
      ...style,
      padding: '8px'
    }}>
      <div className="h-full w-full [&>button]:h-full [&>button]:w-full">
        <MemoizedServiceCard
          service={service}
          isInInvoice={isInInvoice}
          isPending={isPending}
          onClick={handleServiceClick}
          appearance={studioPreferences ? appearanceFor(studioPreferences, service.id) : undefined}
        />
      </div>
    </div>
  );
});


const CustomerSection = React.memo(({
  isGroupMode,
  isLocked,
  onCustomerDataChange, prefill, studioBusy
}: {
  isGroupMode: boolean;
  studioBusy?: React.MutableRefObject<boolean>;
  prefill?: {id: number; full_name: string; phone: string; requestId: number} | null;
  isLocked: boolean;
  onCustomerDataChange: (phone: string, name: string, isValid: boolean, customerId: number | null) => void;
}) => {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerLookup, setCustomerLookup] = useState('');
  const [activeLookupSource, setActiveLookupSource] = useState<'lookup' | 'name'>('lookup');
  const [existingCustomerId, setExistingCustomerId] = useState<number | null>(null);
  const [customerDepositBalance, setCustomerDepositBalance] = useState<number | null>(null);
  const [customerVisitSnapshot, setCustomerVisitSnapshot] = useState<{customerId: number; count: number | null} | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRequestSeqRef = useRef(0);
  const latestLookupQueryRef = useRef('');
  const skipNextLookupRef = useRef(false);
  if (studioBusy) studioBusy.current = isLookingUp || searchLoading || showDropdown;

  useEffect(() => {
    const hasPhone = customerPhone.length >= 8;
    const hasName = isGroupMode ? customerName.trim().length > 0 : true;
    onCustomerDataChange(customerPhone, customerName, hasPhone && hasName, existingCustomerId);
  }, [customerPhone, customerName, existingCustomerId, isGroupMode, onCustomerDataChange]);

  const applySelectedCustomer = useCallback((customer: any) => {
    searchRequestSeqRef.current += 1;
    latestLookupQueryRef.current = customer.phone || '';
    skipNextLookupRef.current = true;
    setCustomerLookup(customer.phone || '');
    setCustomerPhone(customer.phone || '');
    setCustomerName(customer.full_name || '');
    setExistingCustomerId(customer.id);
    setCustomerDepositBalance(Number(customer.deposit_balance || 0));
    setSearchResults([]);
    setShowDropdown(false);
    setActiveIndex(-1);
    setIsLookingUp(false);
    setSearchLoading(false);
    setActiveLookupSource('lookup');
  }, []);

  useEffect(() => {
    if (prefill) applySelectedCustomer(prefill);
  }, [prefill, applySelectedCustomer]);

  useEffect(() => {
    let current = true;
    setCustomerVisitSnapshot(null);
    if (!existingCustomerId || !customerPhone) return;
    // Reuse the Customers page's authoritative PAID-invoice visit statistic.
    // Search and booking-context responses do not currently include this field.
    apiClient.get(`/customers?q=${encodeURIComponent(customerPhone)}&per_page=50`).then(result => {
      if (!current) return;
      const customer = result.items?.find((item: any) => item.id === existingCustomerId);
      setCustomerVisitSnapshot({customerId: existingCustomerId, count: normalizeVisitCount(customer?.visits_count)});
    }).catch(() => { if (current) setCustomerVisitSnapshot(null); });
    return () => { current = false; };
  }, [existingCustomerId, customerPhone]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || searchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) =>
        prev < searchResults.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) =>
        prev > 0 ? prev - 1 : searchResults.length - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) {
        applySelectedCustomer(searchResults[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }, [activeIndex, applySelectedCustomer, searchResults, showDropdown]);

  const searchDropdown = !isLocked && showDropdown && searchResults.length > 0 && (
    <div className="absolute top-full right-0 left-0 mt-1 z-50 bg-[#1C1C1C] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
      {searchResults.map((customer, index) => {
        const isActive = index === activeIndex;
        return (
          <button
            key={customer.id}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              applySelectedCustomer(customer);
            }}
            style={isActive ? { backgroundColor: 'rgba(255,255,255,0.08)', borderRight: '3px solid #E53935' } : {}}
            className={`w-full flex items-center justify-between px-4 py-3 text-right transition-colors border-b border-white/5 last:border-0 ${isActive ? '' : 'hover:bg-white/5'}`}
          >
            <span className="text-xs text-white/40 font-mono tracking-wider">{customer.phone}</span>
            <span className="text-sm font-semibold text-white/90">{customer.full_name || 'بدون اسم'}</span>
          </button>
        );
      })}
    </div>
  );

  // ─── UNIFIED CUSTOMER SEARCH: Single input, single endpoint ───────────────────
  useEffect(() => {
    if (isLocked) return;
    if (existingCustomerId) { skipNextLookupRef.current = false; return; }
    if (skipNextLookupRef.current) {
      skipNextLookupRef.current = false;
      return;
    }

    const searchQuery = activeLookupSource === 'name'
      ? customerName.trim()
      : customerLookup.trim();
    const isPhoneQuery = /^\d+$/.test(searchQuery);
    const minLength = isPhoneQuery ? 3 : 2;
    latestLookupQueryRef.current = searchQuery;

    if (!searchQuery || searchQuery.length < minLength) {
      setIsLookingUp(false);
      setSearchLoading(false);
      setExistingCustomerId(null);
      setCustomerDepositBalance(null);
      setSearchResults([]);
      setShowDropdown(false);
      setActiveIndex(-1);
      return;
    }

    // Treat the debounce window as busy, before any asynchronous request starts.
    if (studioBusy) studioBusy.current = true;
    // Debounced unified search (400ms)
    const timer = setTimeout(async () => {
      const requestSeq = ++searchRequestSeqRef.current;
      const requestQuery = searchQuery;
      setIsLookingUp(true);
      setSearchLoading(true);

      try {
        const searchResults = await apiClient.get(
          `/customers/search?q=${encodeURIComponent(requestQuery)}`
        );

        if (requestSeq !== searchRequestSeqRef.current || latestLookupQueryRef.current !== requestQuery) return;

        setExistingCustomerId(null);
        setCustomerDepositBalance(null);
        const results = Array.isArray(searchResults) ? searchResults : [];
        setSearchResults(results);
        setShowDropdown(results.length > 0);
        setActiveIndex(-1);
      } catch (error) {
        if (requestSeq !== searchRequestSeqRef.current || latestLookupQueryRef.current !== requestQuery) return;
        console.error('Customer search failed:', error);
        setExistingCustomerId(null);
        setCustomerDepositBalance(null);
        setSearchResults([]);
        setShowDropdown(false);
      } finally {
        if (requestSeq !== searchRequestSeqRef.current || latestLookupQueryRef.current !== requestQuery) return;
        setIsLookingUp(false);
        setSearchLoading(false);
      }
    }, 400);

    return () => { clearTimeout(timer); if (studioBusy) studioBusy.current = false; };
  }, [activeLookupSource, customerLookup, customerName, isLocked, existingCustomerId]);

  return (
    <>
      {/* Customer Inputs */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="relative flex-1 rounded-2xl border border-[#E53935]/30 bg-gradient-to-br from-[#121212] to-[#1A1A1A] transition-all duration-300 hover:border-[#E53935]/60 focus-within:border-[#E53935]">
            <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[#E53935]/5 opacity-0 transition-all duration-300 focus-within:opacity-100" />
            <input
              type="text"
              disabled={isLocked}
              placeholder={isGroupMode ? "ابحث باسم العميل أو رقم الجوال (إجباري)" : "ابحث باسم العميل أو رقم الجوال"}
              value={customerLookup}
              onChange={(e) => {
                const value = e.target.value;
                const trimmedValue = value.trim();
                const isDigitsOnly = trimmedValue === '' || /^\d+$/.test(trimmedValue);

                setActiveLookupSource('lookup');
                latestLookupQueryRef.current = trimmedValue;
                setCustomerLookup(value);
                setShowDropdown(false);
                setActiveIndex(-1);

                if (existingCustomerId) {
                  setCustomerName('');
                }

                setExistingCustomerId(null);
                setCustomerDepositBalance(null);

                if (isDigitsOnly) {
                  setCustomerPhone(value);
                } else {
                  setCustomerPhone('');
                }
              }}
              onFocus={() => {
                if (activeLookupSource === 'lookup' && searchResults.length > 0) setShowDropdown(true);
              }}
              onBlur={() => {
                // Delay hide so click on dropdown item registers first
                setTimeout(() => setShowDropdown(false), 150);
              }}
              onKeyDown={handleSearchKeyDown}
              className="w-full bg-transparent py-4 px-5 text-sm font-bold text-white outline-none placeholder:text-white/30"
            />
            <Phone size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 transition-colors duration-300 ${customerLookup ? 'text-[#E53935]' : 'text-white/10'}`} />
            {/* Search/Lookup spinner */}
            {activeLookupSource === 'lookup' && (isLookingUp || searchLoading) && (
              <div className="absolute left-4 top-1/2 -translate-y-1/2">
                <div className="w-3 h-3 border border-white/20 border-t-white/60 rounded-full animate-spin" />
              </div>
            )}
            {/* Search results dropdown */}
            {activeLookupSource === 'lookup' && searchDropdown}
          </div>
          <div className="relative flex-1 rounded-2xl border border-[#E53935]/30 bg-gradient-to-br from-[#121212] to-[#1A1A1A] transition-all duration-300 hover:border-[#E53935]/60 focus-within:border-[#E53935]">
            <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[#E53935]/5 opacity-0 transition-all duration-300 focus-within:opacity-100" />
            <input
              type="text"
              disabled={isLocked}
              placeholder={isGroupMode ? "اسم العميل (إجباري)" : "اسم العميل"}
              value={customerName}
              onChange={(e) => {
                const value = e.target.value;

                setActiveLookupSource('name');
                latestLookupQueryRef.current = value.trim();
                setCustomerName(value);
                setExistingCustomerId(null);
                setCustomerDepositBalance(null);
                setShowDropdown(false);
                setActiveIndex(-1);
              }}
              onFocus={() => {
                if (activeLookupSource === 'name' && searchResults.length > 0) setShowDropdown(true);
              }}
              onBlur={() => {
                setTimeout(() => setShowDropdown(false), 150);
              }}
              onKeyDown={handleSearchKeyDown}
              className="w-full bg-transparent py-4 px-5 text-sm font-bold text-white outline-none placeholder:text-white/30"
            />
            <User size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 transition-colors duration-300 ${customerName ? 'text-[#E53935]' : 'text-white/10'}`} />
            {activeLookupSource === 'name' && (isLookingUp || searchLoading) && (
              <div className="absolute left-4 top-1/2 -translate-y-1/2">
                <div className="w-3 h-3 border border-white/20 border-t-white/60 rounded-full animate-spin" />
              </div>
            )}
            {activeLookupSource === 'name' && searchDropdown}
          </div>
        </div>
        {existingCustomerId && !isLookingUp && !showDropdown && (
          <CustomerInfoBadges depositBalance={customerDepositBalance} visitCount={customerVisitSnapshot?.customerId === existingCustomerId ? customerVisitSnapshot.count : null} />
        )}
      </div>


    </>
  );
});



const ReceiptModal = React.memo(({
  showReceipt,
  currentInvoice,
  cashier,
  customerDataRef,
  finalTotal,
  subtotal,
  discountAmount,
  payments,
  changeAmount,
  handleReceiptClose
}: any) => {
  // Authoritative values from persisted paid invoice, with safe fallback to props
  const receiptSubtotal = currentInvoice
    ? Number(currentInvoice.total_amount ?? subtotal ?? 0)
    : Number(subtotal ?? 0);

  const receiptDiscount = currentInvoice
    ? Number(currentInvoice.promo?.discount_amount ?? currentInvoice.discount_amount ?? discountAmount ?? 0)
    : Number(discountAmount ?? 0);

  const receiptNet = currentInvoice
    ? (typeof currentInvoice.net_amount === 'number'
        ? Number(currentInvoice.net_amount)
        : Math.max(0, receiptSubtotal - receiptDiscount))
    : Number(finalTotal ?? Math.max(0, receiptSubtotal - receiptDiscount));

  const receiptGroups = useMemo(() => {
    if (!currentInvoice) return [];
    return [{
      customerName: customerDataRef.current.name,
      services: currentInvoice.items.map((i: any) => ({
        name: i.item_type === 'PRODUCT_ITEM'
          ? (i.product_name || i.service_name || 'منتج')
          : (i.service_name || i.product_name || '---'),
        price: i.price,
        itemType: i.item_type,
        barberName: i.barber_name
      })),
      barber: currentInvoice.items[0]?.barber_name || '-',
      subtotal: receiptNet
    }];
  }, [currentInvoice, receiptNet, customerDataRef]);

  if (!showReceipt || !currentInvoice) return null;

  return (
    <Receipt
      invoiceId={currentInvoice.invoice_number || 'DRAFT'}
      branchName={cashier.branch_name}
      payerName={customerDataRef.current.name}
      payerPhone={customerDataRef.current.phone}
      groups={receiptGroups}
      total={receiptNet}
      subtotal={receiptSubtotal}
      discountAmount={receiptDiscount}
      promo={currentInvoice.promo}
      depositApplied={currentInvoice.deposit_settlement?.applied_amount || 0}
      payments={currentInvoice.payments ?? payments}
      changeAmount={typeof currentInvoice.change_amount === 'number' ? currentInvoice.change_amount : changeAmount}
      onClose={handleReceiptClose}
    />
  );
});


const CashierScreen: React.FC<CashierProps> = React.memo(({ presentBarbers, presentAssistants, adminSettings, appointments, cashier, handoffRequest, onHandoffResult, isActive = false, sidebarOpen = false, deviceContext }) => {
  console.log('[RENDER] CashierScreen');
  const studioBoundary = useRef(createStudioBoundary()).current;
  const studioCustomerBusyRef = useRef(false);
  const [studioPhase, setStudioPhase] = useState<'NORMAL' | 'EDITING' | 'SAVING'>('NORMAL');
  const [studioPreferences, setStudioPreferences] = useState<Preferences>(emptyPreferences);
  const [studioInitial, setStudioInitial] = useState<Preferences>(emptyPreferences);
  const [studioDraft, setStudioDraft] = useState<Preferences>(emptyPreferences);
  const serviceScrollRef = useRef(0);
  const restoreServiceScroll = useCallback((api: {element: HTMLDivElement | null} | null) => { if (api?.element) api.element.scrollTop = serviceScrollRef.current; }, []);
  const [studioWarning, setStudioWarning] = useState('');
  const [studioError, setStudioError] = useState('');
  const studioScope = deviceContext?.is_active && deviceContext.access_mode === 'FULL_MINI' && deviceContext.device_id
    ? preferenceKey(cashier.branch_id, deviceContext.device_id) : null;
  const studioScopeRef = useRef(studioScope);
  const studioSessionScopeRef = useRef<string | null>(null);
  const studioSavedRawRef = useRef<string | null>(null);
  studioScopeRef.current = studioScope;
  useEffect(() => {
    studioBoundary.leave(); setStudioPhase('NORMAL');
    try { setStudioPreferences(studioScope ? readPreferences(window.localStorage, studioScope).preferences : emptyPreferences()); }
    catch { setStudioPreferences(emptyPreferences()); }
  }, [studioScope, studioBoundary]);
  const [isGroupMode, setIsGroupMode] = useState(false);
  const bookingStorageKey = `mini_booking_handoff:${cashier.branch_id}:${cashier.id}:${cashier.email || ''}`;
  const [activeBookingId, setActiveBookingId] = useState<number | null>(null);
  const activeBookingRef = useRef<number | null>(null);
  const [customerPrefill, setCustomerPrefill] = useState<any>(null);
  const [handoffNotice, setHandoffNotice] = useState('');
  const [handoffProcessing, setHandoffProcessing] = useState(false);
  const handoffProcessingRef = useRef(false);
  const pendingTenderInputRef = useRef(false);
  const handlePendingInputChange = useCallback((dirty: boolean) => { pendingTenderInputRef.current = dirty; }, []);
  const consumedHandoffRef = useRef<number | null>(null);
  const [restoreRequest, setRestoreRequest] = useState<BookingHandoffRequest | null>(() => {
    try {
      const id = Number(sessionStorage.getItem(bookingStorageKey));
      return Number.isSafeInteger(id) && id > 0 ? {appointmentId: id, requestId: -1} : null;
    } catch { return null; }
  });

  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [showStaffOverlay, setShowStaffOverlay] = useState<'barber' | 'assistant' | 'product_employee' | null>(null);

  // API Models
  const [categories, setCategories] = useState<Category[]>([]);
  const [currentInvoice, setCurrentInvoice] = useState<Invoice | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [paymentPhase, setPaymentPhase] = useState<PaymentPhase>('IDLE');
  const [canRetryPaymentVerification, setCanRetryPaymentVerification] = useState(false);
  const paymentPhaseRef = useRef<PaymentPhase>('IDLE');
  const activePaymentAttemptRef = useRef<{
    id: string;
    invoiceId: number;
    branchId: number;
    cashierId: number;
    payload: Record<string, any>;
  } | null>(null);
  const reconciliationRunningRef = useRef(false);
  // draftCreating: prevents double-creation when first service is clicked rapidly
  const [draftCreating, setDraftCreating] = useState(false);
  const [isCommittingDraft, setIsCommittingDraft] = useState(false);
  const commitInFlightInvoiceIdRef = useRef<number | null>(null);
  // pendingServiceIds: tracks services currently being saved to backend
  const [pendingServiceIds, setPendingServiceIds] = useState<Set<number>>(new Set());
  // selectedServiceIds: tracks independent UI selection state to prevent reconciliation flicker
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<number>>(new Set());
  console.log(`[RENDER] CashierScreen - selectedServiceIds:`, Array.from(selectedServiceIds));



  // Ref-based Customer Data Isolation
  const customerDataRef = useRef({ name: '', phone: '' });
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [depositAmbiguous, setDepositAmbiguous] = useState(false);
  const [depositBookings, setDepositBookings] = useState<{appointment_id: number; date: string; time: string; available_amount: number}[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState('');
  React.useEffect(() => {
    let current = true;
    setDepositBookings([]); setSelectedBookingId(null); setDepositError('');
    if (!selectedCustomerId || depositAmbiguous || isGroupMode) { setDepositLoading(false); return; }
    setDepositLoading(true);
    apiClient.get(`/customers/${selectedCustomerId}/eligible-booking-deposits`).then(result => {
      if (!current) return;
      const bookings = result.bookings || [];
      setDepositBookings(bookings);
      setSelectedBookingId(activeBookingRef.current
        ? (bookings.some((b: any) => b.appointment_id === activeBookingRef.current) ? activeBookingRef.current : null)
        : bookings.length === 1 ? bookings[0].appointment_id : null);
    }).catch(() => { if (current) setDepositError('تعذر التحقق من العربون. أعد اختيار العميل للمحاولة.'); })
      .finally(() => { if (current) setDepositLoading(false); });
    return () => { current = false; };
  }, [selectedCustomerId, cashier.branch_id, depositAmbiguous, isGroupMode, activeBookingId]);
  const [isCustomerValid, setIsCustomerValid] = useState(false);
  // Key used to force-remount CustomerSection on reset, clearing internal name/phone state
  const [customerSectionKey, setCustomerSectionKey] = useState(0);

  const handleCustomerDataChange = useCallback((phone: string, name: string, isValid: boolean, customerId: number | null) => {
    if (studioBoundary.editing) return;
    setSelectedCustomerId(customerId);
    customerDataRef.current = { phone, name };
    setIsCustomerValid(isValid);
  }, []);

  // Selection State
  const [selectedBarberId, setSelectedBarberId] = useState<number | null>(null);
  const [selectedAssistantId, setSelectedAssistantId] = useState<number | null>(null);
  const [selectedProductEmployeeId, setSelectedProductEmployeeId] = useState<number | null>(null);

  const productEmployees = useMemo(() => {
    const employees = [...presentBarbers, ...presentAssistants];
    return employees.filter(
      (employee, index, arr) => arr.findIndex(candidate => candidate.id === employee.id) === index
    );
  }, [presentAssistants, presentBarbers]);

  useEffect(() => {
    if (selectedBarberId && !selectedAssistantId) {
      setSelectedProductEmployeeId(selectedBarberId);
      return;
    }
    if (selectedAssistantId && !selectedBarberId) {
      setSelectedProductEmployeeId(selectedAssistantId);
    }
  }, [selectedAssistantId, selectedBarberId]);

  useEffect(() => {
    if (
      selectedProductEmployeeId &&
      !productEmployees.some(employee => employee.id === selectedProductEmployeeId)
    ) {
      setSelectedProductEmployeeId(null);
    }
  }, [productEmployees, selectedProductEmployeeId]);

  // ── SESSION MANAGEMENT ────────────────────────────────────────────────────
  // Each logical customer session gets a unique ID generated on the frontend.
  // sessionTempId is attached to optimistic items and preserved through
  // reconciliation. It is NEVER sent to the backend in any API payload.
  const [currentSessionId, setCurrentSessionId] = useState<string>(
    () => 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2)
  );
  // ─────────────────────────────────────────────────────────────────────────

  const stateRefs = useRef({
    selectedBarberId,
    selectedAssistantId,
    presentAssistants,
    presentBarbers,
    cashier,
    currentInvoiceId: currentInvoice?.id,
    invoiceStatus: currentInvoice?.status,
    currentSessionId
  });

  useEffect(() => {
    stateRefs.current = {
      selectedBarberId,
      selectedAssistantId,
      presentAssistants,
      presentBarbers,
      cashier,
      currentInvoiceId: currentInvoice?.id,
      invoiceStatus: currentInvoice?.status,
      currentSessionId
    };
  });












  const [payments, setPayments] = useState<{ method: string; amount: number }[]>([]);
  const [showReceipt, setShowReceipt] = useState(false);

  const transitionPaymentPhase = useCallback((nextPhase: PaymentPhase) => {
    paymentPhaseRef.current = nextPhase;
    setPaymentPhase(nextPhase);
    if (nextPhase !== 'VERIFYING') {
      setCanRetryPaymentVerification(false);
    }
  }, []);

  const isPaymentLocked = paymentPhase !== 'IDLE' || handoffProcessing;

  const handlePaymentsChange = useCallback((nextPayments: { method: string; amount: number }[]) => {
    if (paymentPhaseRef.current === 'IDLE') {
      setPayments(nextPayments);
    }
  }, []);


  // Discount & Promo State (UI & Integration Layer)
  const [isDiscountOpen, setIsDiscountOpen] = useState(false);
  const [discountInput, setDiscountInput] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('fixed');
  const [appliedDiscount, setAppliedDiscount] = useState<{ value: number; type: 'percentage' | 'fixed' } | null>(null);
  const [appliedPromo, setAppliedPromo] = useState<PromoPreviewResult | null>(null);
  const [promoNotice, setPromoNotice] = useState<string | null>(null);
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);
  const [activeTab, setActiveTab] = useState<'services' | 'products'>('services');
  const [products, setProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');

  const filteredProducts = useMemo(() => {
    if (!productSearchQuery.trim()) return products;
    const query = productSearchQuery.toLowerCase();
    return products.filter(prod => 
      prod.name?.toLowerCase().includes(query) || 
      prod.barcode?.toLowerCase().includes(query)
    );
  }, [products, productSearchQuery]);

  // -- Computed (Authoritative backend promo precedence) --
  const subtotal = currentInvoice?.total_amount || 0;

  const discountAmount = useMemo(() => {
    if (appliedPromo) {
      return parseFloat(appliedPromo.promo_discount) || 0;
    }
    if (!appliedDiscount) return 0;
    if (appliedDiscount.type === 'percentage') {
      return (subtotal * appliedDiscount.value) / 100;
    }
    return appliedDiscount.value;
  }, [subtotal, appliedDiscount, appliedPromo]);

  const finalTotal = useMemo(() => {
    if (appliedPromo) {
      return parseFloat(appliedPromo.projected_net_total) || 0;
    }
    return Math.max(0, subtotal - discountAmount);
  }, [subtotal, discountAmount, appliedPromo]);

  const selectedDepositBooking = !depositAmbiguous && !isGroupMode
    ? depositBookings.find(booking => booking.appointment_id === selectedBookingId) : undefined;
  const depositApplied = Math.min(finalTotal, selectedDepositBooking?.available_amount || 0);
  const collectionDue = Math.round((finalTotal - depositApplied) * 100) / 100;
  const depositReady = !depositLoading && !depositError;

  const totalPaidLocal = payments.reduce((acc, p) => acc + p.amount, 0);

  // Promo Handlers
  const handleApplyPromo = useCallback(async (code: string) => {
    return studioBoundary.run(async () => {
    if (paymentPhaseRef.current !== 'IDLE') return;
    if (appliedDiscount) {
      alert("يوجد خصم يدوي مطبق. احذفه أولاً لاستخدام كود الخصم.");
      return;
    }
    if (pendingServiceIds.size > 0 || isLoading) {
      alert("يرجى الانتظار حتى اكتمال إضافة العناصر الحالية.");
      return;
    }
    if (!currentInvoice || currentInvoice.items.length === 0) {
      alert("أضف عناصر إلى الفاتورة أولاً لتطبيق كود الخصم.");
      return;
    }

    setIsApplyingPromo(true);
    setPromoNotice(null);
    try {
      const preview: PromoPreviewResult = await apiClient.post(`/invoice/${currentInvoice.id}/promo/validate`, {
        code: code.trim()
      });
      setAppliedPromo(preview);
    } catch (err: any) {
      const userMsg = getPromoErrorMessage(err);
      throw new Error(userMsg);
    } finally {
      setIsApplyingPromo(false);
    }

    });
  }, [appliedDiscount, pendingServiceIds.size, isLoading, currentInvoice]);

  const handleRemovePromo = useCallback(() => {
    setAppliedPromo(null);
    setPromoNotice(null);
  }, []);

  // 1. Fetch Categories & Services
  const fetchServices = useCallback(async (forceRefresh = false) => {
    let request: Promise<Category[]> | null = null;
    try {
      if (!forceRefresh && servicesCache && servicesCacheBranchId === cashier.branch_id) {
        setCategories(servicesCache);
        return;
      }

      if (!forceRefresh && servicesCachePromise && servicesCachePromiseBranchId === cashier.branch_id) {
        const cachedCategories = await servicesCachePromise;
        setCategories(cachedCategories);
        return;
      }

      console.log("MINI: FETCHING SERVICES...");
      request = (async () => {
        const data = await apiClient.get('/services');
        console.log("MINI SERVICES RAW RESPONSE", data);

        if (data.debug) {
          console.warn("BACKEND DEBUG MODE ACTIVE: Zero services returned for this branch.");
        }

        return [...(data.categories || [])].sort((a: any, b: any) => a.id - b.id);
      })();

      servicesCachePromise = request;
      servicesCachePromiseBranchId = cashier.branch_id;
      const sortedCats = await request;
      servicesCache = sortedCats;
      servicesCacheBranchId = cashier.branch_id;
      setCategories(sortedCats);
    } catch (e) {
      console.error("Failed to fetch services", e);
    } finally {
      if (servicesCachePromise === request) {
        servicesCachePromise = null;
        servicesCachePromiseBranchId = null;
      }
    }
  }, [cashier.branch_id]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const fetchProducts = useCallback(async (forceRefresh = false) => {
    setLoadingProducts(true);
    try {
      const data = await getProductsForBranch(
        cashier.branch_id,
        async () => {
          return await apiClient.get('/products');
        },
        { forceRefresh }
      );
      setProducts(data);
    } catch (e) {
      console.error('Failed to fetch products', e);
    } finally {
      setLoadingProducts(false);
    }
  }, [cashier.branch_id]);

  useEffect(() => {
    fetchProducts(true);
  }, [fetchProducts]);

  // Sync Channel
  useEffect(() => {
    const syncChannel = new BroadcastChannel('salon_data_sync');
    syncChannel.onmessage = (event) => {
      if (event.data.type === 'REFETCH_DATA') {
        console.log("📢 MINI SYNC: Refetching services...");
        servicesCache = null;
        servicesCacheBranchId = null;
        fetchServices(true);
        invalidateProductsCacheForBranch(cashier.branch_id);
        fetchProducts(true);
      }
    };
    return () => syncChannel.close();
  }, [cashier.branch_id, fetchProducts, fetchServices]);

  // 6. Lazy Draft Creation — draft is created ONLY when the first service is added.
  //    No draft is created on screen load. Empty invoices never reach the DB.
  const ensureDraft = async (): Promise<Invoice | null> => {
    return studioBoundary.run(async () => {
    if (currentInvoice) return currentInvoice; // Already have a draft
    if (draftCreating) return null;            // Prevent double-creation
    setDraftCreating(true);
    try {
      const invoice = await apiClient.post('/invoice/draft', {
        branch_id: cashier.branch_id,
        cashier_id: cashier.id,
        ...(activeBookingRef.current ? {booking_appointment_id: activeBookingRef.current, booking_multi_customer: depositAmbiguous || isGroupMode} : {})
      });
      console.log("[STATE OVERRIDE DETECTED] ensureDraft", invoice);
      setCurrentInvoice(invoice);
      return invoice;
    } catch (e) {
      console.error('Failed to create draft invoice', e);
      return null;
    } finally {
      setDraftCreating(false);
    }

    });
  };


  // Logic for enabling assistant selection
  const canSelectAssistant = useMemo(() => {
    // Logic could be refined if we want to restrict based on selected service category
    // For now, allow selection if any services are available
    return true;
  }, []);


  // --- Event Handlers ---

  const handleBarberSelect = React.useCallback((id: number) => {
    setSelectedBarberId(id);
    setShowStaffOverlay(null);
  }, []);

  const handleAssistantSelect = React.useCallback((id: number) => {
    setSelectedAssistantId(prev => prev === id ? null : id);
    setShowStaffOverlay(null);
  }, []);

  // Start a new customer session: resets barber/assistant selection without
  // clearing invoice items. The new sessionId will tag all upcoming items.
  // selectedServiceIds is also cleared so services from the previous session
  // are not shown as selected in the new session.
  const handleAddCustomer = React.useCallback(async () => {
    return studioBoundary.run(async () => {
    if (paymentPhaseRef.current !== 'IDLE' || handoffProcessingRef.current) return;
    if (activeBookingRef.current && currentInvoice) {
      handoffProcessingRef.current = true; setHandoffProcessing(true);
      try {
        const updated = await apiClient.post(`/invoice/${currentInvoice.id}/booking-multi-customer`, {});
        setCurrentInvoice(prev => prev ? {...prev, booking_multi_customer: updated.booking_multi_customer} : prev);
      } catch (error: any) { setHandoffNotice(error.message || 'تعذر حفظ حالة تعدد العملاء'); return; }
      finally { handoffProcessingRef.current = false; setHandoffProcessing(false); }
    }
    setDepositAmbiguous(true);
    const newId = 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    setCurrentSessionId(newId);
    setSelectedBarberId(null);
    setSelectedAssistantId(null);
    setSelectedServiceIds(new Set()); // ← Session-scope: clear optimistic selection

    });
  }, [currentInvoice]);

  const handleServiceClick = React.useCallback(async (service: Service, bookingPrefill = false) => {
    return studioBoundary.run(async () => {
    if (paymentPhaseRef.current !== 'IDLE' || (handoffProcessingRef.current && !bookingPrefill)) return;
    const { selectedBarberId, selectedAssistantId, presentAssistants, presentBarbers, cashier, currentInvoiceId, invoiceStatus, currentSessionId: capturedSessionId } = stateRefs.current;

    if (!selectedBarberId) {
      setShowStaffOverlay('barber');
      return;
    }
    if (service.has_assistant && !selectedAssistantId && presentAssistants.length > 0) {
      const confirmNoAssistant = window.confirm("This service typically has an assistant. Add without one?");
      if (!confirmNoAssistant) return;
    }

    // Prevent double clicking the same service
    if (pendingServiceIds.has(service.id)) return;

    // Invalidate applied promo on cart change
    if (appliedPromo) {
      setAppliedPromo(null);
      setPromoNotice("تم تحديث الفاتورة، يرجى إعادة تطبيق كود الخصم.");
    }

    // --- IMMEDIATELY ADD TO SELECTION STATE ---
    setSelectedServiceIds(prev => {
      const next = new Set(prev);
      next.add(service.id);
      return next;
    });

    // --- LOCK CHECK & OPTIMISTIC UI UPDATE ---
    const tempItemId = "temp-" + Date.now(); // String temp ID for explicit frontend tracking
    let isLocked = false;

    // --- ENSURE DRAFT FIRST ---
    let localDraftId: number | null = currentInvoice?.id || null;

    if (!localDraftId || localDraftId === -1) {
      const draft = await ensureDraft();
      if (!draft) return; // Prevent proceeding without strict draft ID
      localDraftId = draft.id;
      if (bookingPrefill && draft.booking_draft_created === false) return;
    }

    setPendingServiceIds(prev => new Set(prev).add(service.id));

    console.log("[STATE OVERRIDE DETECTED] handleServiceClick (Optimistic)");
    flushSync(() => {
      setCurrentInvoice(prev => {
        // 1. Status Hard Lock
        if (prev && prev.status !== 'DRAFT') {
          isLocked = true;
          return prev;
        }

        if (prev) localDraftId = prev.id;

        const barberName = presentBarbers.find(b => b.id === selectedBarberId)?.name || 'غير معروف';
        const assistantName = selectedAssistantId ? presentAssistants.find(a => a.id === selectedAssistantId)?.name : null;

        const tempItem = {
          id: tempItemId,
          service_id: service.id,
          service_name: service.name,
          barber_id: selectedBarberId,
          barber_name: barberName,
          assistant_id: service.has_assistant ? selectedAssistantId : null,
          assistant_name: assistantName,
          price: service.price,
          quantity: 1,
          total: service.price,
          barber_commission: 0,
          assistant_commission: 0,
          // Frontend-only — never sent to backend
          sessionTempId: capturedSessionId
        };

        const newTotal = (prev?.total_amount || 0) + service.price;

        return prev
          ? {
            ...prev,
            total_amount: newTotal,
            net_amount: newTotal - (prev.discount_amount || 0),
            items: [...prev.items, tempItem as any]
          }
          : {
            id: localDraftId, // Explicitly use our confirmed lazy draft ID here
            invoice_number: null,
            branch_id: cashier.branch_id,
            cashier_id: cashier.id,
            status: 'DRAFT',
            total_amount: newTotal,
            discount_amount: 0,
            net_amount: newTotal,
            payment_method: null,
            target_date: null,
            items: [tempItem as any],
            customer_name: null,
            customer_phone: null,
            created_at: new Date().toISOString()
          };
      });
    });

    if (isLocked) {
      setPendingServiceIds(prev => {
        const next = new Set(prev);
        next.delete(service.id);
        return next;
      });
      return;
    }

    try {
      // ✅ Draft was guaranteed on mount. Only fire actual API silently.
      const updatedInvoice = await apiClient.post(`/invoice/${localDraftId}/items`, {
        service_id: service.id,
        barber_id: selectedBarberId,
        assistant_id: service.has_assistant ? selectedAssistantId : null,
        quantity: 1,
        ...(bookingPrefill ? {booking_prefill: true} : {})
      });

      console.log("[RECONCILIATION] Backend response items:", updatedInvoice?.items);

      // --- SERVER RECONCILIATION (SAFE MERGE) ---
      // Re-apply sessionTempId from local state to each server item so visual
      // grouping survives the round-trip to the backend.
      // Rule:
      //   • Item already in local state (real ID matched) → preserve its sessionTempId
      //   • Newly confirmed item (no prior local entry)   → assign capturedSessionId
      console.log("[STATE OVERRIDE DETECTED] handleServiceClick (Reconciliation)");
      setCurrentInvoice(prev => {
        const prevItems = (prev?.items || []) as SessionedInvoiceItem[];

        const serverItemsWithSession: SessionedInvoiceItem[] = (updatedInvoice.items as any[]).map(
          (serverItem: any) => {
            const existing = prevItems.find(i => i.id === serverItem.id);
            return existing?.sessionTempId
              ? { ...serverItem, sessionTempId: existing.sessionTempId }
              : { ...serverItem, sessionTempId: capturedSessionId };
          }
        );

        // Preserve other temp items still in-flight
        const otherTempItems = prevItems.filter(i =>
          typeof i.id === "string" &&
          String(i.id).startsWith("temp-") &&
          i.id !== tempItemId
        );

        const finalItems = [...serverItemsWithSession, ...otherTempItems];

        const mergedTotal = finalItems.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0
        );

        return {
          ...updatedInvoice,
          items: finalItems,
          total_amount: mergedTotal,
          net_amount: Math.max(
            0,
            mergedTotal - (updatedInvoice.discount_amount || 0)
          )
        };
      });
    } catch (e) {
      console.error('Failed to add item', e);
      // --- SAFE ROLLBACK PER ITEM ---
      console.log("[STATE OVERRIDE DETECTED] handleServiceClick (Rollback)");
      setCurrentInvoice(prev => {
        if (!prev) return prev;
        const newTotal = prev.total_amount - service.price;
        return {
          ...prev,
          total_amount: Math.max(0, newTotal),
          net_amount: Math.max(0, newTotal - (prev.discount_amount || 0)),
          items: prev.items.filter(i => String(i.id) !== tempItemId)
        };
      });
      // Revert selection on API failure
      setSelectedServiceIds(prev => {
        const next = new Set(prev);
        next.delete(service.id);
        return next;
      });
      alert('فشل إضافة الخدمة');
    } finally {
      setPendingServiceIds(prev => {
        const next = new Set(prev);
        next.delete(service.id);
        return next;
      });
    }

    });
  }, [pendingServiceIds, ensureDraft, appliedPromo]);


  const handleProductClick = React.useCallback(async (product: any, targetQuantity?: number) => {
    return studioBoundary.run(async () => {
    if (paymentPhaseRef.current !== 'IDLE' || handoffProcessingRef.current) return;
    // Invalidate applied promo on cart change
    if (appliedPromo) {
      setAppliedPromo(null);
      setPromoNotice("تم تحديث الفاتورة، يرجى إعادة تطبيق كود الخصم.");
    }

    const existingItem = currentInvoice?.items.find(item => item.product_id === product.id && item.item_type === 'PRODUCT_ITEM');
    const assignedEmployeeId = selectedProductEmployeeId ?? existingItem?.assigned_employee_id ?? null;
    let qty = 1;
    if (targetQuantity !== undefined) {
      qty = targetQuantity;
    } else if (existingItem) {
      qty = (existingItem.quantity || 1) + 1;
    }

    if (!assignedEmployeeId) {
      alert("اختر الموظف المسؤول عن بيع المنتج.");
      return;
    }

    let localDraftId: number | null = currentInvoice?.id || null;
    if (!localDraftId || localDraftId === -1) {
      const draft = await ensureDraft();
      if (!draft) return;
      localDraftId = draft.id;
    }

    setIsLoading(true);
    try {
      const updatedInvoice = await apiClient.post(`/invoice/${localDraftId}/products`, {
        product_id: product.id,
        quantity: qty,
        assigned_employee_id: assignedEmployeeId
      });
      setCurrentInvoice(updatedInvoice);
    } catch (e: any) {
      alert(e.message || "حدث خطأ أثناء إضافة المنتج");
    } finally {
      setIsLoading(false);
    }

    });
  }, [currentInvoice, ensureDraft, selectedProductEmployeeId, appliedPromo]);

  const handleRemoveItem = React.useCallback(async (itemId: number) => {
    return studioBoundary.run(async () => {
    if (paymentPhaseRef.current !== 'IDLE' || handoffProcessingRef.current) return;
    if (!currentInvoice) return;

    // Invalidate applied promo on cart change
    if (appliedPromo) {
      setAppliedPromo(null);
      setPromoNotice("تم تحديث الفاتورة، يرجى إعادة تطبيق كود الخصم.");
    }

    const previousInvoiceState = { ...currentInvoice };

    // --- OPTIMISTIC REMOVE ---
    const updatedItems = currentInvoice.items.filter(i => i.id !== itemId);
    const removedItem = currentInvoice.items.find(i => i.id === itemId);
    const amountToDeduct = removedItem ? removedItem.total : 0;

    // Remove from UI selection immediately
    if (removedItem) {
      setSelectedServiceIds(prev => {
        const next = new Set(prev);
        next.delete(removedItem.service_id);
        return next;
      });
    }

    const newTotal = Math.max(0, currentInvoice.total_amount - amountToDeduct);

    console.log("[STATE OVERRIDE DETECTED] handleRemoveItem (Optimistic)", {
      ...currentInvoice,
      items: updatedItems,
      total_amount: newTotal,
      net_amount: newTotal - (currentInvoice.discount_amount || 0)
    });
    setCurrentInvoice({
      ...currentInvoice,
      items: updatedItems,
      total_amount: newTotal,
      net_amount: newTotal - (currentInvoice.discount_amount || 0)
    });

    try {
      // Background sync
      const response = await apiClient.delete(`/invoice/${currentInvoice.id}/items/${itemId}`);
      console.log("[STATE OVERRIDE DETECTED] handleRemoveItem (Success)", response);
      // Re-apply sessionTempId from previous local state — the DELETE response
      // contains plain server items without frontend session metadata.
      setCurrentInvoice(prev => {
        const prevItems = (prev?.items || []) as SessionedInvoiceItem[];
        const serverItemsWithSession: SessionedInvoiceItem[] = (response.items as any[]).map(
          (serverItem: any) => {
            const existing = prevItems.find(i => i.id === serverItem.id);
            return existing?.sessionTempId
              ? { ...serverItem, sessionTempId: existing.sessionTempId }
              : serverItem;
          }
        );
        return { ...response, items: serverItemsWithSession };
      });
    } catch (e) {
      console.error("Failed to remove item", e);
      console.log("[STATE OVERRIDE DETECTED] handleRemoveItem (Rollback)", previousInvoiceState);
      setCurrentInvoice(previousInvoiceState); // Revert on failure

      // Re-add to selection if save/delete failed
      const removedItemOriginal = previousInvoiceState.items.find(i => i.id === itemId);
      if (removedItemOriginal) {
        setSelectedServiceIds(prev => {
          const next = new Set(prev);
          next.add(removedItemOriginal.service_id);
          return next;
        });
      }
    }

    });
  }, [currentInvoice, appliedPromo]);

  const completePaymentSuccess = useCallback(async (paidInvoice: Invoice) => {
    activePaymentAttemptRef.current = null;
    clearStoredPaymentAttempt();
    transitionPaymentPhase('IDLE');
    setCurrentInvoice(paidInvoice);
    setShowReceipt(true);
    setAppliedPromo(null);
    setPromoNotice(null);
    invalidateProductsCacheForBranch(cashier.branch_id);
    await fetchProducts(true);
  }, [cashier.branch_id, fetchProducts, transitionPaymentPhase]);

  const handleDefinitePaymentFailure = useCallback((error: any) => {
    activePaymentAttemptRef.current = null;
    clearStoredPaymentAttempt();
    transitionPaymentPhase('IDLE');

    if (error?.code === 'PROMO_QUOTE_STALE' || error?.error === 'PROMO_QUOTE_STALE') {
      setAppliedPromo(null);
      setPromoNotice("تم تحديث بيانات الفاتورة أو كود الخصم. يرجى تطبيق الكود مرة أخرى.");
      alert("تم تحديث بيانات الفاتورة أو كود الخصم. يرجى تطبيق الكود مرة أخرى.");
      return;
    }

    const promoMsg = (error?.code?.startsWith('PROMO_') || error?.error?.startsWith('PROMO_'))
      ? getPromoErrorMessage(error)
      : null;
    alert(promoMsg || paymentFailureMessage(error));
  }, [transitionPaymentPhase]);

  const reconcilePaymentAttempt = useCallback(async () => {
    if (reconciliationRunningRef.current) return;
    const activeAttempt = activePaymentAttemptRef.current;
    if (!activeAttempt) return;

    reconciliationRunningRef.current = true;
    transitionPaymentPhase('VERIFYING');
    setCanRetryPaymentVerification(false);

    try {
      const outcome = await resolvePaymentAttempt<Invoice>({
        check: () => apiClient.get(`/payment-attempt/${activeAttempt.id}`) as Promise<PaymentAttemptResult>,
        resend: () => apiClient.post(
          `/invoice/${activeAttempt.invoiceId}/confirm`,
          activeAttempt.payload,
        ),
        isUnknownError: isUnknownPaymentOutcomeError,
        wait: () => new Promise(resolve => window.setTimeout(resolve, 1500)),
      });

      if (outcome.status === 'SUCCEEDED') {
        await completePaymentSuccess(outcome.invoice);
        return;
      }
      if (outcome.status === 'FAILED') {
        const failure = outcome.error as any;
        handleDefinitePaymentFailure({
          code: failure?.code,
          error: failure?.code || failure?.error,
          message: failure?.message,
        });
        return;
      }

      setCanRetryPaymentVerification(true);
      alert("لم نتمكن من تأكيد نتيجة الدفع بعد. لا تعد الدفع، واستخدم «إعادة التحقق».");
    } finally {
      reconciliationRunningRef.current = false;
    }
  }, [completePaymentSuccess, handleDefinitePaymentFailure, transitionPaymentPhase]);

  useEffect(() => {
    if (activePaymentAttemptRef.current) return;
    const storedAttempt = readStoredPaymentAttempt();
    if (!storedAttempt) return;

    try {
      const parsed = JSON.parse(storedAttempt);
      if (
        typeof parsed?.id !== 'string'
        || typeof parsed?.invoiceId !== 'number'
        || parsed?.branchId !== cashier.branch_id
        || parsed?.cashierId !== cashier.id
        || !parsed?.payload
        || parsed.payload.payment_attempt_id !== parsed.id
      ) {
        clearStoredPaymentAttempt();
        return;
      }
      activePaymentAttemptRef.current = parsed;
      customerDataRef.current = {
        name: parsed.payload.customer_name || '',
        phone: parsed.payload.customer_phone || '',
      };
      transitionPaymentPhase('VERIFYING');
      void reconcilePaymentAttempt();
    } catch {
      clearStoredPaymentAttempt();
    }
  }, [cashier.branch_id, cashier.id, reconcilePaymentAttempt, transitionPaymentPhase]);

  const handleConfirm = async () => {
    return studioBoundary.run(async () => {
    if (paymentPhaseRef.current === 'VERIFYING') {
      await reconcilePaymentAttempt();
      return;
    }
    // Synchronous guard: React state does not need to render before a second click.
    if (paymentPhaseRef.current !== 'IDLE' || handoffProcessingRef.current) return;

    const isFreeInvoice = finalTotal === 0 && subtotal > 0;
    const hasRequiredPayments = (collectionDue === 0 ? totalPaidLocal === 0 : payments.length > 0 && totalPaidLocal >= collectionDue);

    console.log("🚀 [CONFIRM] CLICKED", { isFreeInvoice, finalTotal, paymentsCount: payments.length, hasPromo: !!appliedPromo });

    if (!currentInvoice) {
      console.warn("❌ [CONFIRM] No current invoice found.");
      return;
    }

    if (!depositReady || (!isFreeInvoice && !hasRequiredPayments)) {
      console.warn("❌ [CONFIRM] Blocked: Revenue invoice requires valid payments.");
      alert("يرجى إدخال مبلغ الدفع كاملاً");
      return;
    }

    const paymentAttemptId = tryBeginPaymentAttempt(paymentPhaseRef);
    if (!paymentAttemptId) return;
    const confirmPayload: Record<string, any> = {
      payment_attempt_id: paymentAttemptId,
      payments: payments,
      confirmed_by: cashier.id,
      customer_name: customerDataRef.current.name,
      customer_phone: customerDataRef.current.phone,
      discount_amount: appliedPromo ? 0.0 : discountAmount,
    };

    if (selectedDepositBooking) {
      confirmPayload.appointment_id = selectedDepositBooking.appointment_id;
      confirmPayload.customer_id = selectedCustomerId;
      confirmPayload.expected_deposit_amount = depositApplied;
      confirmPayload.multi_customer = depositAmbiguous || isGroupMode;
    }
    if (appliedPromo) {
      confirmPayload.promo_code = appliedPromo.code;
      confirmPayload.quote_id = appliedPromo.quote_id;
      confirmPayload.promo_version = appliedPromo.version;
    }

    activePaymentAttemptRef.current = {
      id: paymentAttemptId,
      invoiceId: currentInvoice.id,
      branchId: cashier.branch_id,
      cashierId: cashier.id,
      payload: confirmPayload,
    };
    storePaymentAttempt(activePaymentAttemptRef.current);
    transitionPaymentPhase('SUBMITTING');

    try {
      const result = await apiClient.post(`/invoice/${currentInvoice.id}/confirm`, confirmPayload);
      if (result?.status === 'PROCESSING') {
        transitionPaymentPhase('VERIFYING');
        await reconcilePaymentAttempt();
        return;
      }
      await completePaymentSuccess(result as Invoice);
    } catch (error: any) {
      if (isUnknownPaymentOutcomeError(error)) {
        transitionPaymentPhase('VERIFYING');
        await reconcilePaymentAttempt();
        return;
      }
      handleDefinitePaymentFailure(error);
    }

    });
  };

  const handoffStateRef = useRef<any>(null);
  handoffStateRef.current = {currentInvoice, selectedCustomerId, payments, appliedDiscount, appliedPromo,
    isGroupMode, depositAmbiguous, draftCreating, isCommittingDraft, isLoading, pendingServiceIds, isDiscountOpen, isApplyingPromo,
    selectedBarberId, selectedAssistantId, selectedProductEmployeeId, customer: customerDataRef.current};

  useEffect(() => {
    const request = handoffRequest || restoreRequest;
    if (!request || consumedHandoffRef.current === request.requestId) return;
    // Leave a new handoff unconsumed until the editor is closed.
    if (studioBoundary.editing) return;
    // Payment outcome recovery owns the screen until the existing attempt resolves.
    if (readStoredPaymentAttempt() || paymentPhaseRef.current !== 'IDLE') {
      if (handoffRequest) onHandoffResult?.(request.appointmentId, 'انتظر التحقق من عملية الدفع الحالية');
      setRestoreRequest(null); return;
    }
    consumedHandoffRef.current = request.requestId;
    const blocked = () => {
      const state = handoffStateRef.current;
      return state.draftCreating || state.isCommittingDraft || state.isLoading || state.isApplyingPromo || state.pendingServiceIds.size > 0
        || paymentPhaseRef.current !== 'IDLE'
        || (activeBookingRef.current !== request.appointmentId && (
          !!state.currentInvoice || state.selectedCustomerId || state.customer.phone || state.customer.name
          || state.payments.length || pendingTenderInputRef.current || state.appliedDiscount || state.appliedPromo || state.isGroupMode
          || state.depositAmbiguous || state.isDiscountOpen || state.selectedBarberId || state.selectedAssistantId || state.selectedProductEmployeeId));
    };
    if (blocked() || handoffProcessingRef.current) {
      onHandoffResult?.(request.appointmentId, 'الفاتورة الحالية قيد العمل؛ أكملها أو استخدم فاتورة جديدة أولًا');
      setRestoreRequest(null); return;
    }
    handoffProcessingRef.current = true; setHandoffProcessing(true);
    let mounted = true;
    (async () => {
      try {
        const context: BookingHandoffContext = await apiClient.get(`/appointments/${request.appointmentId}/cashier-context`);
        if (!mounted) return;
        if (blocked()) throw new Error('الفاتورة الحالية قيد العمل؛ أكملها أولًا');
        if (context.appointment.branch_id !== cashier.branch_id || context.appointment.status !== 'scheduled')
          throw new Error('الحجز غير متاح لهذا الفرع');
        if (activeBookingRef.current === request.appointmentId) {
          onHandoffResult?.(request.appointmentId); return;
        }
        activeBookingRef.current = request.appointmentId;
        setActiveBookingId(request.appointmentId);
        setSelectedCustomerId(context.customer.id);
        customerDataRef.current = {name: context.customer.full_name, phone: context.customer.phone};
        setCustomerPrefill({...context.customer, requestId: request.requestId});
        setIsCustomerValid(context.customer.phone.length >= 8);
        const ambiguous = !!context.invoice?.booking_multi_customer;
        setDepositAmbiguous(ambiguous);
        setDepositBookings(context.eligible_deposit ? [context.eligible_deposit as any] : []);
        setSelectedBookingId(context.eligible_deposit && !ambiguous ? request.appointmentId : null);
        const barber = stateRefs.current.presentBarbers.find(b => b.id === context.prefill_barber_id)
          || (context.prefill_barber ? {...context.prefill_barber, avatar: context.prefill_barber.name[0], role: 'حلاق', isPresent: true} : undefined);
        setSelectedBarberId(barber?.id ?? null);
        if (context.invoice) {
          setCurrentInvoice(context.invoice);
          setHandoffNotice('');
        } else setHandoffNotice('');
        try { sessionStorage.setItem(bookingStorageKey, String(request.appointmentId)); } catch {}
        // Keep mutable customer-session state local. A restored ambiguous invoice
        // never regains automatic deposit eligibility.
        stateRefs.current = {...stateRefs.current, selectedBarberId: barber?.id ?? null,
          presentBarbers: barber && !stateRefs.current.presentBarbers.some(b => b.id === barber.id)
            ? [...stateRefs.current.presentBarbers, barber as StaffMember] : stateRefs.current.presentBarbers};
        const service = context.prefill_service;
        if (!context.invoice && service && barber && !service.has_assistant) {
          await handleServiceClick(service, true);
        }
        if (mounted) onHandoffResult?.(request.appointmentId);
      } catch (error: any) {
        if (mounted) {
          const message = error.message || 'تعذر تجهيز الحجز للكاشير';
          setHandoffNotice(message);
          onHandoffResult?.(request.appointmentId, message);
          if (restoreRequest) { try { sessionStorage.removeItem(bookingStorageKey); } catch {} }
        }
      } finally {
        if (mounted) { handoffProcessingRef.current = false; setHandoffProcessing(false); setRestoreRequest(null); }
      }
    })();
    return () => {
      mounted = false;
      if (handoffProcessingRef.current) { consumedHandoffRef.current = null; handoffProcessingRef.current = false; }
    };
    // Request identity is the trigger. Catalog, staff and cart updates must never
    // replay a consumed handoff or automatically add a service again.
  }, [handoffRequest, restoreRequest, studioPhase]);

  // Central reset — clears ALL invoice state. No draft is created here.
  // The next draft will be created lazily when the first service is added.
  const resetInvoiceState = React.useCallback(() => {
    console.log("[STATE OVERRIDE DETECTED] resetInvoiceState", null);
    setCurrentInvoice(null);
    activeBookingRef.current = null; setActiveBookingId(null); setCustomerPrefill(null); setHandoffNotice('');
    try { sessionStorage.removeItem(bookingStorageKey); } catch {}
    setSelectedServiceIds(new Set()); // CLEAR SELECTION
    setSelectedBarberId(null);
    setSelectedAssistantId(null);
    setActiveCategoryId(null);

    setPayments([]);
    setShowReceipt(false);
    setAppliedDiscount(null);
    setAppliedPromo(null);
    setPromoNotice(null);
    setIsApplyingPromo(false);
    setDiscountInput('');
    setDiscountType('fixed');
    setIsDiscountOpen(false);
    activePaymentAttemptRef.current = null;
    clearStoredPaymentAttempt();
    reconciliationRunningRef.current = false;
    transitionPaymentPhase('IDLE');
    // Fresh session for the next invoice
    setCurrentSessionId('session-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    // Reset customer data ref and validity — CustomerSection remounts via key
    customerDataRef.current = { name: '', phone: '' };
    setIsCustomerValid(false);
    setSelectedCustomerId(null); setSelectedBookingId(null); setDepositBookings([]); setDepositAmbiguous(false);
    setCustomerSectionKey(k => k + 1); // Forces CustomerSection to remount → clears inputs
  }, [transitionPaymentPhase]);

  const handleReceiptClose = React.useCallback(() => {
    // Invoice is already PAID — just reset state. Next draft created on first service.
    resetInvoiceState();
  }, [resetInvoiceState]);

  const handleNewInvoice = async () => {
    return studioBoundary.run(async () => {
    if (paymentPhaseRef.current !== 'IDLE' || handoffProcessingRef.current) return;
    // If current draft has items → commit as DRAFT_COMMITTED ("معلقة" in Admin)
    if (currentInvoice && currentInvoice.items && currentInvoice.items.length > 0) {
      if (isCommittingDraft || commitInFlightInvoiceIdRef.current === currentInvoice.id) {
        return;
      }

      commitInFlightInvoiceIdRef.current = currentInvoice.id;
      setIsCommittingDraft(true);
      try {
        await apiClient.post(`/invoice/${currentInvoice.id}/commit-draft`, {});
        console.log('✅ Draft committed as معلقة');
      } catch (error: any) {
        console.error('❌ Commit draft failed:', error);
        const discard = window.confirm('فشل حفظ الفاتورة الحالية كمعلقة.\nهل تريد تجاهلها والمتابعة؟');
        if (!discard) return;
      } finally {
        commitInFlightInvoiceIdRef.current = null;
        setIsCommittingDraft(false);
      }
    }
    // If empty → nothing to save in DB. Just reset state.
    resetInvoiceState();

    });
  };



  const canConfirm = useMemo(() => {
    const hasItems = (currentInvoice?.items.length || 0) > 0;
    const totalPaidLocal = payments.reduce((acc, p) => acc + p.amount, 0);

    // Strict business rules for production safety:
    const isZeroTotal = finalTotal === 0 && subtotal > 0;
    const isDiscountValid = discountAmount >= 0 && discountAmount <= subtotal;
    const hasSufficientPayment = (collectionDue === 0 ? totalPaidLocal === 0 : payments.length > 0 && totalPaidLocal >= collectionDue);

    return depositReady && hasItems && isCustomerValid && isDiscountValid && (isZeroTotal || hasSufficientPayment);
  }, [currentInvoice, payments, isCustomerValid, finalTotal, subtotal, discountAmount, collectionDue, depositReady]);

  // Render helpers
  const selectedServicesIds = useMemo(() => currentInvoice?.items.map(i => i.service_id) || [], [currentInvoice?.items]);
  const activeCategory = useMemo(() => categories.find(c => c.id === activeCategoryId), [categories, activeCategoryId]);

  // Session-scoped selection: a service is visually "selected" only if an item
  // with matching service_id AND the current session's sessionTempId exists.
  // This ensures session 2 can re-select service A even if session 1 already has it.
  // NOTE: never affects API payloads — purely a local visual state derivation.
  const sessionSelectedServiceIds = useMemo(() => {
    const ids = new Set<number>();
    (currentInvoice?.items as SessionedInvoiceItem[] || []).forEach(item => {
      if (item.sessionTempId === currentSessionId) {
        ids.add(item.service_id);
      }
    });
    return ids;
  }, [currentInvoice?.items, currentSessionId]);

  const selectedBarber = presentBarbers.find(b => b.id === selectedBarberId);
  const selectedAssistant = presentAssistants.find(a => a.id === selectedAssistantId);

  console.log("[RENDER] Sidebar Items:", currentInvoice?.items);

  const studioEntryRef = useRef<() => void>(() => {});
  studioEntryRef.current = () => {
    if (!isActive || sidebarOpen || activeTab !== 'services' || !studioScope || studioCustomerBusyRef.current || document.visibilityState !== 'visible'
      || paymentPhaseRef.current !== 'IDLE' || handoffProcessingRef.current || handoffRequest || restoreRequest
      || draftCreating || isCommittingDraft || commitInFlightInvoiceIdRef.current !== null || isLoading || isApplyingPromo
      || pendingServiceIds.size || depositLoading || reconciliationRunningRef.current || readStoredPaymentAttempt()
      || showStaffOverlay || showReceipt || isDiscountOpen || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    if (!studioBoundary.enter()) return;
    try {
      const loaded = readPreferences(window.localStorage, studioScope);
      studioSavedRawRef.current = window.localStorage.getItem(studioScope);
      studioSessionScopeRef.current = studioScope;
      setStudioPreferences(loaded.preferences); setStudioInitial(loaded.preferences); setStudioDraft(structuredClone(loaded.preferences));
      setStudioWarning(loaded.warning); setStudioError(''); setStudioPhase('EDITING');
    } catch {
      studioSessionScopeRef.current = studioScope;
      setStudioInitial(studioPreferences); setStudioDraft(structuredClone(studioPreferences)); setStudioWarning('التخزين المحلي غير متاح. قد يتعذر حفظ التخصيص.');
      setStudioError(''); setStudioPhase('EDITING');
    }
  };
  useEffect(() => {
    if (!isActive || !studioScope) return;
    const shortcut = (event: KeyboardEvent) => {
      if (!isStudioShortcut(event)) return;
      studioEntryRef.current();
      if (studioBoundary.editing) event.preventDefault();
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [isActive, studioScope, studioBoundary]);
  const closeStudio = () => { studioBoundary.leave(); setStudioPhase('NORMAL'); };
  const saveStudio = (draft: Preferences) => {
    if (studioPhase !== 'EDITING') return;
    setStudioPhase('SAVING'); setStudioError('');
    try {
      const scope = studioSessionScopeRef.current;
      if (!scope || scope !== studioScopeRef.current) throw new Error('Device changed');
      if (window.localStorage.getItem(scope) !== studioSavedRawRef.current) throw new Error('Preferences changed in another tab');
      const saved = writePreferences(window.localStorage, scope, draft);
      setStudioPreferences(saved); closeStudio();
    } catch {
      setStudioError('تعذر حفظ التخصيص. تحقق من إتاحة التخزين أو من التعديل في تبويب آخر، ثم أعد المحاولة.');
      setStudioPhase('EDITING');
    }
  };

  const studioEditing = studioPhase !== 'NORMAL';
  const visiblePreferences = studioEditing ? studioDraft : studioPreferences;
  const orderedCategories = useMemo(() => orderedItems(categories, visiblePreferences.categoryOrder), [categories, visiblePreferences.categoryOrder]);
  const cancelStudio = () => {
    if (JSON.stringify(studioDraft) !== JSON.stringify(studioInitial) && !window.confirm('تجاهل التغييرات غير المحفوظة؟')) return;
    closeStudio();
  };
  const cancelStudioRef = useRef(cancelStudio); cancelStudioRef.current = cancelStudio;
  useEffect(() => {
    if (!studioEditing) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); cancelStudioRef.current(); } };
    window.addEventListener('keydown', escape);
    // The sidebar lives outside this component. Block only that operational region.
    const sidebar = document.querySelector<HTMLElement>('[data-omar-mini-sidebar-root]');
    const previous = sidebar?.inert;
    if (sidebar) sidebar.inert = true;
    return () => { window.removeEventListener('keydown', escape); if (sidebar) sidebar.inert = previous || false; };
  }, [studioEditing]);

  return (<>
    {studioEditing && <div className="omar-inline-toolbar" role="toolbar" aria-label="تعديل ترتيب البطاقات" dir="rtl">
      <span className="omar-inline-indicator">وضع التعديل</span>
      <button type="button" disabled={studioPhase === 'SAVING'} onClick={() => saveStudio(studioDraft)}>حفظ</button>
      <button type="button" disabled={studioPhase === 'SAVING'} onClick={cancelStudio}>إلغاء</button>
      <button type="button" disabled={studioPhase === 'SAVING'} onClick={() => setStudioDraft(emptyPreferences())}>إعادة تعيين</button>
      {(studioError || studioWarning || handoffRequest || restoreRequest) && <p role="status">{studioError || studioWarning || 'حجز وارد ينتظر إغلاق وضع التعديل؛ سيُعالج بعد الحفظ أو الإلغاء.'}</p>}
    </div>}
    <div className="flex h-full min-h-0 overflow-hidden font-['Cairo'] bg-[#0D0D0D] text-[#F5F5F5]" dir="rtl">

      {/* 1. Main Action Area */}
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col border-l border-white/5 bg-[#0D0D0D]">

        {/* A. Top Context Zone */}
        <header inert={studioEditing || undefined} className="min-h-[5rem] shrink-0 border-b border-white/5 bg-[#0D0D0D]/80 px-4 py-4 backdrop-blur-xl z-30">
          <div className="flex flex-wrap items-center justify-between gap-3 lg:gap-4">
            <div className="flex min-w-0 flex-wrap items-center gap-3 lg:gap-4 xl:gap-6">
              <div className="flex flex-col shrink-0">
                <h1 className="text-lg font-black text-white leading-tight">{isGroupMode ? 'فاتورة مجمعة' : 'نقطة البيع'}</h1>
                <span className="text-[10px] font-bold text-[#E53935] uppercase tracking-widest opacity-80">{cashier.branch_name}</span>
              </div>

              {/* Group Mode Toggle */}
              <div style={{ display: 'none' }} className="px-1.5 py-1.5 rounded-full border border-white/5 bg-white/[0.02] flex items-center gap-1">
                <button
                  onClick={() => setIsGroupMode(false)}
                  className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ${!isGroupMode ? 'bg-[#E53935] text-white shadow-lg' : 'text-white/40 hover:text-white/60'
                    }`}
                >
                  فردي
                </button>
                <button
                  onClick={() => setIsGroupMode(true)}
                  className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ${isGroupMode ? 'bg-[#E6D690] text-[#121212] shadow-lg' : 'text-white/40 hover:text-white/60'
                    }`}
                >
                  مجمع
                </button>
              </div>

              <button
                onClick={handleNewInvoice}
                disabled={isCommittingDraft || isPaymentLocked}
                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-white/70 text-xs font-bold uppercase tracking-widest transition-all hover:bg-white/10 hover:text-white hover:border-white/20 active:scale-95 flex items-center gap-2"
              >
                <Plus size={14} />
                فاتورة جديدة
              </button>

              <button
                onClick={handleAddCustomer}
                disabled={isPaymentLocked}
                title="إضافة عميل جديد داخل نفس الفاتورة"
                className="px-4 py-2 rounded-xl border border-[#E6D690]/20 bg-[#E6D690]/5 text-[#E6D690]/70 text-xs font-bold uppercase tracking-widest transition-all hover:bg-[#E6D690]/10 hover:text-[#E6D690] hover:border-[#E6D690]/40 active:scale-95 flex items-center gap-2"
              >
                <Users size={14} />
                إضافة عميل
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowStaffOverlay('barber')}
                  className={`flex items-center gap-4 px-2 pr-6 py-2 rounded-2xl border-2 transition-all duration-500 hover:scale-[1.03] active:scale-95 group relative overflow-hidden ${selectedBarber
                    ? 'bg-[#1A0D0D] border-[#E53935] shadow-[0_0_30px_rgba(229,57,53,0.2)]'
                    : 'bg-[#141414] border-[#E53935]/40 hover:border-[#E53935] hover:bg-[#1A0D0D]'
                    }`}
                >
                  <div className={`absolute top-0 right-0 px-3 py-0.5 rounded-bl-lg text-[8px] font-black uppercase tracking-tighter ${selectedBarber ? 'bg-[#E53935] text-white' : 'bg-white/10 text-white/40 group-hover:bg-[#E53935] group-hover:text-white'}`}>
                    {selectedBarber ? 'حلاق نشط' : 'اختر الحلاق'}
                  </div>

                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden transition-all duration-500 shadow-xl ${selectedBarber
                    ? 'ring-2 ring-white/30'
                    : 'bg-black/50 text-[#E6D690]/40 group-hover:text-[#E6D690]'
                    }`}>
                    {selectedBarber?.avatar && (selectedBarber.avatar.startsWith('http') || selectedBarber.avatar.startsWith('/')) ? (
                      <img src={selectedBarber.avatar} alt={selectedBarber.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                    ) : (
                      <span className="font-black text-lg transition-colors group-hover:text-[#E6D690]">{selectedBarber ? selectedBarber.avatar : <Scissors size={20} className={selectedBarber ? 'text-[#E6D690]' : 'text-[#E6D690]/40'} />}</span>
                    )}
                  </div>

                  <div className="flex flex-col items-start leading-tight">
                    <span className={`text-[14px] font-[900] tracking-tighter transition-colors ${selectedBarber ? 'text-[#E6D690]' : 'text-[#E6D690]/60 group-hover:text-[#E6D690]'}`}>
                      {selectedBarber?.name || 'اختر الحلاق'}
                    </span>
                    <span className="text-[9px] font-black uppercase tracking-[0.1em] mt-1.5 transition-colors text-[#E53935]">
                      {selectedBarber ? 'حلاق نشط' : 'اختيار مطلوب'}
                    </span>
                  </div>
                </button>

                {presentAssistants.length > 0 && (
                  <button
                    onClick={() => setShowStaffOverlay('assistant')}
                    className={`flex items-center gap-4 px-2 pr-6 py-2 rounded-2xl border-2 transition-all duration-500 hover:scale-[1.03] active:scale-95 group relative overflow-hidden ${selectedAssistant
                      ? 'bg-[#1A0D0D] border-[#E53935] shadow-[0_0_30px_rgba(229,57,53,0.15)]'
                      : 'bg-[#141414] border-white/10 hover:border-[#E53935]/60 hover:bg-[#1A0D0D] opacity-60 hover:opacity-100'
                      }`}
                  >
                    <div className={`absolute top-0 right-0 px-3 py-0.5 rounded-bl-lg text-[8px] font-black uppercase tracking-tighter ${selectedAssistant ? 'bg-[#E53935] text-white' : 'bg-white/10 text-white'}`}>
                      {selectedAssistant ? 'مساعد محدد' : 'إضافة مساعد'}
                    </div>

                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden transition-all duration-500 shadow-xl ${selectedAssistant
                      ? 'ring-2 ring-white/20'
                      : 'bg-black/50 text-[#E6D690]/40 group-hover:text-[#E6D690]'
                      }`}>
                      {selectedAssistant?.avatar && (selectedAssistant.avatar.startsWith('http') || selectedAssistant.avatar.startsWith('/')) ? (
                        <img src={selectedAssistant.avatar} alt={selectedAssistant.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                      ) : (
                        <Sparkles size={20} className={selectedAssistant ? 'fill-[#E6D690] text-[#E6D690]' : 'text-[#E6D690]/40 group-hover:text-[#E6D690]'} />
                      )}
                    </div>

                    <div className="flex flex-col items-start leading-tight">
                      <span className={`text-[14px] font-[900] tracking-tighter transition-colors ${selectedAssistant ? 'text-[#E6D690]' : 'text-[#E6D690]/60 group-hover:text-[#E6D690]'}`}>
                        {selectedAssistant?.name || 'مساعد اختيارى'}
                      </span>
                      <span className="text-[9px] font-black uppercase tracking-[0.1em] mt-1.5 transition-colors text-[#E53935]">
                        {selectedAssistant ? 'مساعد محدد' : 'دعم اختياري'}
                      </span>
                    </div>
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              {isLoading && <div className="flex items-center gap-2 px-3 py-1.5 bg-[#E53935]/10 rounded-lg"><span className="w-1.5 h-1.5 rounded-full bg-[#E53935] animate-pulse" /><span className="text-[11px] font-bold text-[#E53935]">جاري التحديث</span></div>}
              <div className="text-right border-r border-white/10 pr-4">
                <p className="text-xs font-black text-white leading-none">{cashier.name}</p>
                <p className="text-[9px] opacity-40 uppercase tracking-widest text-[#BDBDBD] mt-1">مسؤول الكاشير</p>
              </div>
            </div>
          </div>
        </header>

        {/* B. Services Zone */}
        <section className="mini-scroll-y custom-scrollbar p-4 lg:p-8 pb-32 space-y-12">

          <div className="w-full max-w-none space-y-8">
            <div inert={studioEditing || undefined} className="contents">
            <CustomerSection
              key={customerSectionKey}
              studioBusy={studioCustomerBusyRef}
              isGroupMode={isGroupMode}
              isLocked={isPaymentLocked}
              onCustomerDataChange={handleCustomerDataChange}
              prefill={customerPrefill}
            />
            </div>
            {activeBookingId && handoffNotice && <p className="text-xs text-[#E6D690]" role="status">{handoffNotice}</p>}
            {/* Services vs Products Tab Switcher */}
            <div inert={studioEditing || undefined} className="flex items-center gap-4 bg-[#141414] p-1.5 rounded-[1.5rem] border border-white/5 max-w-md">
              <button
                onClick={() => { setActiveTab('services'); setActiveCategoryId(null); }}
                className={`flex-1 py-3 px-6 rounded-2xl text-xs font-black tracking-wider uppercase transition-all duration-300 ${activeTab === 'services'
                  ? 'bg-[#E53935] text-white shadow-lg shadow-[#E53935]/25'
                  : 'text-[#BDBDBD] hover:text-white hover:bg-white/5'
                  }`}
              >
                الخدمات المتاحة
              </button>
              <button
                onClick={() => { setActiveTab('products'); }}
                className={`flex-1 py-3 px-6 rounded-2xl text-xs font-black tracking-wider uppercase transition-all duration-300 ${activeTab === 'products'
                  ? 'bg-[#E53935] text-white shadow-lg shadow-[#E53935]/25'
                  : 'text-[#BDBDBD] hover:text-white hover:bg-white/5'
                  }`}
              >
                المنتجات بالتجزئة
              </button>
            </div>

            {activeTab === 'services' && (
              <div className="space-y-6 pt-8 border-t border-white/5 animate-in fade-in duration-300">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-1.5 h-6 bg-[#E53935] rounded-full" />
                    <h3 className="text-lg font-black text-white uppercase tracking-tight">
                      {activeCategoryId ? 'الخدمات المتاحة' : 'قائمة التصنيفات'}
                    </h3>
                  </div>
                  {activeCategoryId && (
                    <button onClick={() => { serviceScrollRef.current = 0; setActiveCategoryId(null); }} className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-[#E53935] hover:bg-[#ff4a4a] text-white font-black text-sm shadow-[0_10px_30px_rgba(229,57,53,0.35)] transition-all duration-300 hover:scale-[1.03] active:scale-[0.97]">
                      <ArrowLeft size={18} className="rotate-180" /> العودة للتصنيفات
                    </button>
                  )}
                </div>

                {!activeCategoryId ? (
                  <InlineCards items={orderedCategories} editing={studioEditing}
                    className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6"
                    onOrder={categoryOrder => setStudioDraft(previous => ({ ...previous, categoryOrder }))}
                    renderItem={(cat) => (
                      <button
                        key={cat.id}
                        onClick={() => { serviceScrollRef.current = 0; setActiveCategoryId(cat.id); }}
                        className="relative group rounded-2xl p-6 min-h-[160px] flex flex-col items-center justify-center bg-gradient-to-br from-[#121212] to-[#1A1A1A] border border-[#E53935]/25 hover:border-[#E53935] shadow-[0_10px_40px_rgba(0,0,0,0.5)] hover:shadow-[0_15px_40px_rgba(229,57,53,0.2)] transition-all duration-300 hover:-translate-y-1 cursor-pointer"
                      >
                        <div className="absolute inset-0 rounded-[32px] bg-[#E53935]/5 opacity-0 group-hover:opacity-100 transition-all duration-300" />
                        <div className="absolute top-0 right-0 w-32 h-32 bg-[#E53935]/5 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2 transition-all group-hover:bg-[#E53935]/10" />
                        <div className="absolute -top-10 -right-10 w-32 h-32 bg-[#E53935]/10 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-all duration-500" />
                        <Tag size={22} className="text-[#E53935] mb-4 opacity-50 group-hover:scale-110 group-hover:opacity-100 transition-all duration-500" />
                        <span className="text-2xl font-extrabold tracking-tight text-white group-hover:text-[#ff4a4a] transition-colors">{cat.name}</span>
                        <span className="text-sm font-bold mt-2 text-[#E6D690]">{cat.services?.length || 0} خدمة</span>
                      </button>
                    )} />
                ) : activeCategory ? (
                  <div className="w-full flex-1" style={{ minHeight: '22rem', height: 'calc(var(--mini-shell-height) - 350px)' }}>
                    <AutoSizer renderProp={({ height, width }: any) => {
                      if (!width || !height) return null;
                      const orderedServices = orderedItems(defaultServices(activeCategory.services || []), visiblePreferences.serviceOrderByCategory[String(activeCategory.id)]);
                      const columnCount = width < 640 ? 1 : width < 1024 ? 2 : 3;
                      const rowCount = Math.ceil(orderedServices.length / columnCount);
                      const columnWidth = width / columnCount;
                      const rowHeight = 160;

                      return studioEditing ? (
                        <div key={activeCategory.id} className="omar-inline-scroll custom-scrollbar" style={{height, width}} onScroll={event => { serviceScrollRef.current = event.currentTarget.scrollTop; }}>
                          <InlineCards items={orderedServices} editing scrollPosition={serviceScrollRef}
                            className="omar-inline-service-grid" style={{gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`}}
                            onOrder={order => setStudioDraft(previous => ({...previous, serviceOrderByCategory: {...previous.serviceOrderByCategory, [activeCategory.id]: order}}))}
                            popular={id => appearanceFor(studioDraft, id).popular}
                            onPopular={id => setStudioDraft(previous => changeAppearance(previous, id, {popular: !appearanceFor(previous,id).popular}))}
                            renderItem={service => <MemoizedServiceCard key={service.id} service={service}
                              isInInvoice={sessionSelectedServiceIds.has(service.id)} isPending={pendingServiceIds.has(service.id)}
                              onClick={ignoreStudioClick} appearance={appearanceFor(studioDraft,service.id)} />} />
                        </div>
                      ) : (
                        <Grid
                          gridRef={restoreServiceScroll}
                          onScroll={event => { serviceScrollRef.current = event.currentTarget.scrollTop; }}
                          columnCount={columnCount}
                          columnWidth={columnWidth}
                          rowCount={rowCount}
                          rowHeight={rowHeight}
                          cellProps={{
                            services: orderedServices,
                            columnCount,
                            selectedServiceIds: sessionSelectedServiceIds,
                            pendingServiceIds,
                            handleServiceClick,
                            studioPreferences: visiblePreferences
                          }}
                          className="custom-scrollbar"
                          style={{ overflowX: 'hidden', height, width }}
                          cellComponent={ServiceCell as any}
                        />
                      );
                    }} />
                  </div>
                ) : null}
              </div>
            )}

            {activeTab === 'products' && (
              <div className="space-y-6 pt-8 border-t border-white/5 animate-in fade-in duration-300">
                <div className="flex flex-col sm:flex-row items-center w-full gap-4">
                  {/* Search Bar */}
                  {products.length > 0 && (
                    <div className="relative flex-1 group animate-in fade-in slide-in-from-bottom-2 duration-500 w-full">
                      <div className="absolute inset-0 bg-gradient-to-r from-[#E53935]/10 to-transparent rounded-2xl blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                      <div className="relative flex items-center bg-[#141414] border border-white/5 rounded-2xl overflow-hidden focus-within:border-[#E53935]/50 transition-all duration-300 shadow-lg group-hover:bg-[#1A1A1A]">
                        <div className="pl-4 pr-5 py-3">
                          <Search size={18} className={`transition-colors duration-300 ${productSearchQuery ? 'text-[#E53935]' : 'text-white/20 group-hover:text-white/40'}`} />
                        </div>
                        <input
                          type="text"
                          placeholder="ابحث عن منتج بالاسم أو الباركود..."
                          value={productSearchQuery}
                          onChange={(e) => setProductSearchQuery(e.target.value)}
                          className="flex-1 bg-transparent py-3 text-sm font-bold text-white placeholder:text-white/20 outline-none w-full"
                        />
                        {productSearchQuery && (
                          <button
                            onClick={() => setProductSearchQuery('')}
                            className="px-5 py-3 text-white/30 hover:text-white hover:bg-[#E53935]/10 hover:text-[#E53935] transition-all duration-300"
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => setShowStaffOverlay('product_employee')}
                    className={`flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-black text-white transition-all hover:-translate-y-1 active:translate-y-0 whitespace-nowrap w-full sm:w-auto ${
                      selectedProductEmployeeId
                        ? 'bg-[#E53935] hover:bg-[#ff4a4a] shadow-[0_8px_20px_rgba(229,57,53,0.3)]'
                        : 'bg-[#E53935] hover:bg-[#ff4a4a] shadow-[0_8px_20px_rgba(229,57,53,0.3)] animate-pulse hover:animate-none'
                    }`}
                  >
                    <User size={18} />
                    {selectedProductEmployeeId 
                      ? `مسؤول البيع: ${productEmployees.find(employee => employee.id === selectedProductEmployeeId)?.name}` 
                      : 'تحديد مسؤول البيع (إجباري)'}
                  </button>
                </div>

                {loadingProducts ? (
                  <div className="flex items-center justify-center py-20 text-[#BDBDBD] opacity-50">
                    <div className="w-6 h-6 border-2 border-[#E53935] border-t-transparent rounded-full animate-spin ml-2" />
                    <span>جاري تحميل المنتجات...</span>
                  </div>
                ) : products.length === 0 ? (
                  <div className="py-20 text-center text-[#BDBDBD] opacity-35">
                    <p className="font-bold text-sm">لا توجد منتجات بيع بالتجزئة متوفرة في هذا الفرع</p>
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div className="py-20 flex flex-col items-center justify-center text-[#BDBDBD] opacity-50 animate-in fade-in duration-300">
                    <div className="w-16 h-16 mb-4 rounded-full bg-white/5 flex items-center justify-center">
                      <Search size={28} className="text-[#E53935]/60" />
                    </div>
                    <p className="font-bold text-sm">لا توجد منتجات مطابقة للبحث</p>
                    <button onClick={() => setProductSearchQuery('')} className="mt-4 text-xs font-bold text-[#E53935] hover:text-white transition-colors px-4 py-2 bg-white/5 hover:bg-[#E53935] rounded-xl">إلغاء البحث</button>
                  </div>
                ) : (
                  <div
                    className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                    {filteredProducts.map((prod) => {
                      const existingItem = currentInvoice?.items.find(
                        item => item.product_id === prod.id && item.item_type === 'PRODUCT_ITEM'
                      );
                      const inCart = !!existingItem;
                      const inCartQty = existingItem?.quantity || 0;
                      const hasStock = prod.stock_quantity > 0;
                      const productImage = resolveProductImage(prod.image_url);

                      return (
                        <div
                          key={prod.id}
                          className={`group relative flex flex-col overflow-hidden rounded-[2rem] border bg-[#1A1A1A] p-4 transition-all duration-300 ${inCart
                              ? 'border-[#E53935]/35 ring-1 ring-[#E53935]/20 shadow-[0_18px_45px_rgba(229,57,53,0.12)]'
                              : 'border-white/5 text-[#BDBDBD] hover:border-white/15 hover:bg-[#202020] hover:shadow-[0_18px_45px_rgba(0,0,0,0.35)]'
                            }`}
                        >
                          <div className="mb-4 overflow-hidden rounded-[1.6rem] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(230,214,144,0.18),_transparent_65%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                            <div className="relative aspect-[4/3]">
                              {productImage ? (
                                <img src={productImage} alt={prod.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(230,214,144,0.12),_transparent_60%)]">
                                  <div className="flex h-16 w-16 items-center justify-center rounded-[1.4rem] border border-white/10 bg-white/[0.05] text-white/40">
                                    <ImageIcon size={26} />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="z-10 flex flex-1 flex-col">
                            <div className="mb-2 text-right">
                              <span className="mb-2 inline-flex rounded-full bg-white/[0.05] px-2.5 py-1 text-[9px] font-black tracking-[0.16em] text-[#E6D690]">
                                {prod.category}
                              </span>
                              <h4 className="line-clamp-2 min-h-[3rem] text-base font-black leading-6 text-[#F5F5F5] group-hover:text-white">
                                {prod.name}
                              </h4>
                            </div>

                            <div className="mb-4 text-right">
                              <span className="text-[1.9rem] font-black leading-none text-white transition-colors group-hover:text-[#E6D690]">
                                {prod.selling_price}
                              </span>
                              <span className="mr-1 text-[11px] font-black text-white/40">ج.م</span>
                            </div>

                            <div className="mb-4 text-right">
                              <span className="text-[11px] font-bold text-white/42">
                                المتاح: <span className="font-black text-white/75">{prod.stock_quantity}</span> {prod.unit}
                              </span>
                            </div>

                            <div className="mt-auto">
                              {inCart ? (
                                <div className="flex items-center justify-between rounded-[1.1rem] border border-[#E53935]/30 bg-[#E53935]/14 p-1.5">
                                  <button
                                    onClick={() => handleProductClick(prod, inCartQty - 1)}
                                    disabled={inCartQty <= 1}
                                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E53935]/18 font-black text-[#ff8a84] transition-all hover:bg-[#E53935] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                                  >
                                    -
                                  </button>
                                  <span className="min-w-[2.5rem] text-center text-sm font-black text-white">{inCartQty}</span>
                                  <button
                                    onClick={() => handleProductClick(prod, inCartQty + 1)}
                                    disabled={prod.stock_quantity <= inCartQty}
                                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E53935]/18 font-black text-[#ff8a84] transition-all hover:bg-[#E53935] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                                  >
                                    +
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleProductClick(prod, 1)}
                                  disabled={!hasStock}
                                  className={`flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-[1.1rem] px-4 py-3 text-sm font-black transition-all ${hasStock
                                      ? 'border border-[#E53935]/20 bg-[#E53935]/12 text-[#ff7d76] hover:bg-[#E53935] hover:text-white active:scale-[0.98]'
                                      : 'cursor-not-allowed border border-white/5 bg-white/5 text-white/20'
                                    }`}
                                >
                                  <Plus size={14} />
                                  {hasStock ? 'إضافة' : 'نفذت الكمية'}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

      </main>

      {/* 2. Invoice Sidebar */}
      <div inert={studioEditing || undefined} className="contents">
      <InvoiceSection
        onPendingInputChange={handlePendingInputChange}
        isInteractionLocked={handoffProcessing}
        currentInvoice={currentInvoice}
        subtotal={subtotal}
        discountAmount={discountAmount}
        finalTotal={collectionDue}
        invoiceNet={finalTotal}
        depositApplied={depositApplied}
        depositRemaining={Math.round(((selectedDepositBooking?.available_amount || 0) - depositApplied) * 100) / 100}
        depositBookings={activeBookingId ? depositBookings.filter(b => b.appointment_id === activeBookingId) : depositBookings}
        selectedBookingId={selectedBookingId}
        onBookingChange={setSelectedBookingId}
        depositNotice={depositAmbiguous || isGroupMode ? 'فاتورة متعددة العملاء: لا يتم تطبيق العربون تلقائيًا.' : depositError || (depositLoading ? 'جارٍ التحقق من العربون...' : '')}
        isDiscountOpen={isDiscountOpen}
        isLoading={isLoading}
        paymentPhase={paymentPhase}
        canRetryPaymentVerification={canRetryPaymentVerification}
        canConfirm={canConfirm}
        isCustomerValid={isCustomerValid}
        isGroupMode={isGroupMode}
        appliedDiscount={appliedDiscount}
        appliedPromo={appliedPromo}
        promoNotice={promoNotice}
        isApplyingPromo={isApplyingPromo}
        handleRemoveItem={handleRemoveItem}
        handleNewInvoice={handleNewInvoice}
        handleConfirm={handleConfirm}
        handleApplyPromo={handleApplyPromo}
        handleRemovePromo={handleRemovePromo}
        payments={payments}
        setPayments={handlePaymentsChange}
        setIsDiscountOpen={setIsDiscountOpen}
        setAppliedDiscount={setAppliedDiscount}
        setPromoNotice={setPromoNotice}
      />

      {/* 4. Staff Selection Overlay (Character Picker) */}
      </div>
      {showStaffOverlay && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-xl animate-in fade-in duration-300 p-6">
          <div className="w-full max-w-5xl bg-[#121212] border border-white/10 rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

            {/* Overlay Header */}
            <div className="px-10 py-8 border-b border-white/5 flex items-center justify-between bg-[#121212]">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-2xl ${showStaffOverlay === 'barber' ? 'bg-[#E6D690]/10 text-[#E6D690]' : showStaffOverlay === 'product_employee' ? 'bg-[#E53935]/10 text-[#E53935]' : 'bg-white/10 text-white'}`}>
                  {showStaffOverlay === 'barber' ? <Scissors size={24} /> : showStaffOverlay === 'product_employee' ? <Tag size={24} /> : <Sparkles size={24} />}
                </div>
                <div>
                  <h2 className="text-2xl font-black text-white">
                    {showStaffOverlay === 'barber' ? 'اختر الحلاق' : showStaffOverlay === 'product_employee' ? 'مسؤول بيع المنتج' : 'اختر المساعد'}
                  </h2>
                  <p className="text-xs text-[#BDBDBD] opacity-50 mt-1">طاقم العمل الحاضر اليوم</p>
                </div>
              </div>
              <button
                onClick={() => setShowStaffOverlay(null)}
                className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:bg-[#E53935] hover:text-white transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* Overlay Content (Grid) */}
            <div className="mini-scroll-y custom-scrollbar p-10">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                {(showStaffOverlay === 'barber' ? presentBarbers : showStaffOverlay === 'product_employee' ? productEmployees : presentAssistants).map((staffMember) => {
                  const isSelected = showStaffOverlay === 'barber' ? selectedBarberId === staffMember.id : showStaffOverlay === 'product_employee' ? selectedProductEmployeeId === staffMember.id : selectedAssistantId === staffMember.id;

                  return (
                    <button
                      key={staffMember.id}
                      onClick={() => {
                        if (showStaffOverlay === 'barber') handleBarberSelect(staffMember.id);
                        else if (showStaffOverlay === 'product_employee') {
                          setSelectedProductEmployeeId(staffMember.id);
                          setShowStaffOverlay(null);
                        }
                        else handleAssistantSelect(staffMember.id);
                      }}
                      className={`group relative aspect-[3/4] rounded-[2rem] overflow-hidden border-2 transition-all duration-500 hover:scale-[1.02] active:scale-95 ${isSelected
                        ? 'border-[#E53935] shadow-[0_0_30px_rgba(229,57,53,0.3)]'
                        : 'border-white/5 hover:border-white/20'
                        }`}
                    >
                      {/* Character Background & Image Placeholder */}
                      <div className={`absolute inset-0 transition-opacity duration-700 ${isSelected ? 'bg-gradient-to-t from-[#E53935]/40 via-transparent to-transparent opacity-100' : 'bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-100'
                        }`} />

                      <div className="absolute inset-0 flex items-center justify-center bg-[#1A1A1A]">
                        {staffMember.avatar && (staffMember.avatar.startsWith('http') || staffMember.avatar.startsWith('/')) ? (
                          <img src={staffMember.avatar} alt={staffMember.name} className={`w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 ${isSelected ? 'scale-105' : ''}`} />
                        ) : (
                          <div className={`text-7xl font-black transition-all duration-700 ${isSelected ? 'scale-110 opacity-100 text-[#E53935]' : 'opacity-20 text-white group-hover:scale-105 group-hover:opacity-40'
                            }`}>
                            {staffMember.avatar}
                          </div>
                        )}
                      </div>

                      {/* Info Overlay */}
                      <div className="absolute inset-x-0 bottom-0 p-6 flex flex-col items-center text-center">
                        <div className={`w-10 h-1 rounded-full mb-3 transition-all duration-500 ${isSelected ? 'bg-[#E53935] w-12' : 'bg-white/10 group-hover:bg-white/30'
                          }`} />
                        <h3 className={`text-sm font-black transition-colors ${isSelected ? 'text-white' : 'text-[#BDBDBD] group-hover:text-white'
                          }`}>
                          {staffMember.name}
                        </h3>
                        {isSelected && (
                          <div className="mt-2 flex items-center gap-1.5 px-3 py-1 bg-[#E53935] rounded-full">
                            <CheckCircle2 size={10} className="text-white" />
                            <span className="text-[9px] font-black text-white uppercase tracking-widest">مختار</span>
                          </div>
                        )}
                      </div>

                      {/* Glow Effect */}
                      <div className={`absolute -inset-1 bg-[#E53935] blur-2xl opacity-0 transition-opacity duration-500 ${isSelected ? 'opacity-10' : ''
                        }`} />
                    </button>
                  );
                })}

                {/* Optional: Empty State if no one is present */}
                {(showStaffOverlay === 'barber' ? presentBarbers : showStaffOverlay === 'product_employee' ? productEmployees : presentAssistants).length === 0 && (
                  <div className="col-span-full py-20 flex flex-col items-center text-center opacity-30">
                    <UserX size={48} className="mb-4" />
                    <p className="font-bold">لا يوجد {showStaffOverlay === 'barber' ? 'حلاقين' : showStaffOverlay === 'product_employee' ? 'موظفين' : 'مساعدين'} متاحين حالياً</p>
                    <span className="text-xs">يرجى تسجيل الحضور أولاً من صفحة الحضور والانصراف</span>
                  </div>
                )}
              </div>
            </div>

            {/* Overlay Footer */}
            <div className="px-10 py-6 bg-black/40 border-t border-white/5 flex items-center justify-center text-[10px] text-[#BDBDBD] font-bold uppercase tracking-[0.2em] opacity-30">
              Character Selection System • Nady El Regal Premium
            </div>
          </div>
        </div>
      )}



      {/* Legacy Receipt Component */}
      <ReceiptModal
        showReceipt={showReceipt}
        currentInvoice={currentInvoice}
        cashier={cashier}
        customerDataRef={customerDataRef}
        finalTotal={finalTotal}
        subtotal={subtotal}
        discountAmount={discountAmount}
        payments={currentInvoice?.payments || []}
        changeAmount={currentInvoice?.change_amount || 0}
        handleReceiptClose={handleReceiptClose}
      />

    </div>
  </>);
});

export default CashierScreen;
