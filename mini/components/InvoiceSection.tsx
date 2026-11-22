import React from 'react';
import { X, Scissors, Percent, Check, Wallet, CreditCard, Landmark, Plus, ArrowLeft, Users, Tag } from 'lucide-react';
import { Invoice } from '../src/types/models';
import { SessionedInvoiceItem } from '../src/types/session';
import { PromoPreviewResult } from '../src/types/promo';
import { PaymentPhase } from '../src/utils/paymentAttempt';

interface InvoiceSectionProps {
  onPendingInputChange?: (dirty: boolean) => void;
  isInteractionLocked?: boolean;
  currentInvoice: Invoice | null;
  subtotal: number;
  discountAmount: number;
  finalTotal: number;
  invoiceNet?: number;
  depositApplied?: number;
  depositBookings?: {appointment_id: number; date: string; time: string; available_amount: number}[];
  selectedBookingId?: number | null;
  onBookingChange?: (id: number | null) => void;
  depositNotice?: string;
  depositRemaining?: number;
  payments: { method: string; amount: number }[];
  isDiscountOpen: boolean;
  isLoading: boolean;
  paymentPhase: PaymentPhase;
  canRetryPaymentVerification: boolean;
  canConfirm: boolean;
  isCustomerValid: boolean;
  isGroupMode: boolean;
  appliedDiscount: { value: number; type: 'percentage' | 'fixed' } | null;
  appliedPromo?: PromoPreviewResult | null;
  promoNotice?: string | null;
  isApplyingPromo?: boolean;
  handleRemoveItem: (itemId: number) => void;
  handleNewInvoice: () => void;
  handleConfirm: () => void;
  handleApplyPromo?: (code: string) => Promise<void>;
  handleRemovePromo?: () => void;
  setPayments: (payments: { method: string; amount: number }[]) => void;
  setIsDiscountOpen: (isOpen: boolean) => void;
  setAppliedDiscount: (discount: { value: number; type: 'percentage' | 'fixed' } | null) => void;
  setPromoNotice?: (notice: string | null) => void;
}

const PaymentBtn = React.memo(({ icon, label, isActive, onClick, disabled }: any) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center justify-center gap-2 py-3 rounded-xl transition-all duration-300 ${isActive
      ? 'bg-[#E53935] text-white shadow-lg shadow-[#E53935]/20'
      : 'bg-white/5 text-[#BDBDBD] hover:bg-white/10'
      } ${disabled ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}
  >
    {icon}
    <span className="text-[10px] font-black">{label}</span>
  </button>
));

const InvoiceSection: React.FC<InvoiceSectionProps> = React.memo(({
  currentInvoice, onPendingInputChange, isInteractionLocked = false,
  subtotal,
  discountAmount,
  finalTotal, invoiceNet = finalTotal, depositApplied = 0, depositBookings = [], selectedBookingId = null, onBookingChange, depositNotice, depositRemaining = 0,
  payments,
  isDiscountOpen,
  isLoading,
  paymentPhase,
  canRetryPaymentVerification,
  canConfirm,
  isCustomerValid,
  isGroupMode,
  appliedDiscount,
  appliedPromo = null,
  promoNotice = null,
  isApplyingPromo = false,
  handleRemoveItem,
  handleNewInvoice,
  handleConfirm,
  handleApplyPromo,
  handleRemovePromo,
  setPayments,
  setIsDiscountOpen,
  setAppliedDiscount,
  setPromoNotice,
}) => {
  const paymentLocked = paymentPhase !== 'IDLE' || isInteractionLocked;
  // Local state for discount input solely bound to UI form logic
  const [discountInput, setDiscountInput] = React.useState('');
  const [discountType, setDiscountType] = React.useState<'percentage' | 'fixed'>('fixed');

  // Local state for promo code input
  const [isPromoOpen, setIsPromoOpen] = React.useState(false);
  const [promoInput, setPromoInput] = React.useState('');
  const [localPromoError, setLocalPromoError] = React.useState<string | null>(null);

  // Local raw string state for each payment field so the user can type freely
  const [cashInput, setCashInput]         = React.useState('');
  const [visa1Input, setVisa1Input]       = React.useState('');
  const [visa2Input, setVisa2Input]       = React.useState('');
  const [instaInput, setInstaInput]       = React.useState('');
  const tenderEdited = React.useRef(false);
  const hasAutomaticCash = React.useRef(false);
  React.useEffect(() => {
    onPendingInputChange?.(!!(cashInput.trim() || visa1Input.trim() || visa2Input.trim() || instaInput.trim() || discountInput.trim() || promoInput.trim()));
  }, [cashInput, visa1Input, visa2Input, instaInput, discountInput, promoInput, onPendingInputChange]);


  // Compute derived totals (numbers, not strings)
  const cashAmt   = parseFloat(cashInput)  || 0;
  const visa1Amt  = parseFloat(visa1Input) || 0;
  const visa2Amt  = parseFloat(visa2Input) || 0;
  const instaAmt  = parseFloat(instaInput) || 0;
  const totalPaid = cashAmt + visa1Amt + visa2Amt + instaAmt;
  const change    = totalPaid > finalTotal ? +(totalPaid - finalTotal).toFixed(2) : 0;

  // Keep parent state in sync whenever inputs change
  React.useEffect(() => {
    const updated: { method: string; amount: number }[] = [];
    if (cashAmt  > 0) updated.push({ method: 'CASH',     amount: cashAmt  });
    if (visa1Amt > 0) updated.push({ method: 'VISA_1',   amount: visa1Amt });
    if (visa2Amt > 0) updated.push({ method: 'VISA_2',   amount: visa2Amt });
    if (instaAmt > 0) updated.push({ method: 'INSTAPAY', amount: instaAmt });
    setPayments(updated);
  }, [cashInput, visa1Input, visa2Input, instaInput]);

  // Reset inputs automatically when switching to a new invoice or clearing
  React.useEffect(() => {
    tenderEdited.current = false;
    hasAutomaticCash.current = false;
    setCashInput('');
    setVisa1Input('');
    setVisa2Input('');
    setInstaInput('');
    setIsPromoOpen(false);
    setPromoInput('');
    setLocalPromoError(null);
  }, [currentInvoice?.id]);

  // Default only deposit checkouts; never replace a cashier's explicit tender.
  React.useEffect(() => {
    if (paymentLocked || tenderEdited.current) return;
    if (depositApplied > 0) {
      setCashInput(finalTotal > 0 ? String(finalTotal) : '');
      hasAutomaticCash.current = true;
    } else if (hasAutomaticCash.current) {
      setCashInput('');
      hasAutomaticCash.current = false;
    }
  }, [currentInvoice?.id, finalTotal, depositApplied, paymentLocked]);

  const handlePromoSubmit = async () => {
    const code = promoInput.trim();
    if (!code) {
      setLocalPromoError('أدخل كود الخصم أولاً');
      return;
    }
    if (!handleApplyPromo) return;
    setLocalPromoError(null);
    try {
      await handleApplyPromo(code);
      setIsPromoOpen(false);
      setPromoInput('');
    } catch (err: any) {
      setLocalPromoError(err.message || 'كود الخصم غير صالح');
    }
  };

  const invoiceRailWidth = 'clamp(18rem, 25vw, 24rem)';

  return (
    <>
      <aside
        className="relative z-40 flex h-full min-h-0 min-w-[18rem] shrink-0 flex-col border-r border-white/5 bg-[#0D0D0D] shadow-[-20px_0_50px_rgba(0,0,0,0.5)]"
        style={{ width: invoiceRailWidth }}
      >

        {/* Invoice Header */}
        <div className="p-8 pb-4 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-black text-white">الفاتورة</h2>
            <div className="px-3 py-1 bg-white/5 rounded-full border border-white/5">
              <span className="text-[10px] font-black tracking-widest text-[#BDBDBD] opacity-60"># {currentInvoice?.invoice_number || 'DRAFT'}</span>
            </div>
          </div>
          <div className="w-12 h-1.5 bg-[#E53935] rounded-full" />
        </div>

        {/* Selected Items Scrollable List */}
        <div className="mini-scroll-y custom-scrollbar px-6 pt-2 pb-2 space-y-3">
          {currentInvoice && currentInvoice.items.length > 0 ? (() => {
            // ── GROUP ITEMS BY SESSION ─────────────────────────────────────────
            // sessionTempId is a frontend-only field (never in API response).
            // Items without it (e.g. loaded from a restored draft) fall into
            // a single default group so nothing breaks.
            const sessionedItems = currentInvoice.items as SessionedInvoiceItem[];
            const sessionMap = new Map<string, SessionedInvoiceItem[]>();
            const sessionOrder: string[] = [];
            sessionedItems.forEach(item => {
              const sid = item.sessionTempId || '__default__';
              if (!sessionMap.has(sid)) {
                sessionMap.set(sid, []);
                sessionOrder.push(sid);
              }
              sessionMap.get(sid)!.push(item);
            });
            const sessions = sessionOrder.map(sid => ({ sid, items: sessionMap.get(sid)! }));
            const isMultiSession = sessions.length > 1;
            // ───────────────────────────────────────────────────────────────────
            return sessions.map((session, sIdx) => (
              <div key={session.sid}>
                {/* Session divider — only rendered when 2+ customer groups exist */}
                {isMultiSession && (
                  <div className="flex items-center gap-2 px-1 pt-3 pb-1">
                    <div className="flex-1 h-px bg-white/5" />
                    <span className="text-[9px] font-black text-[#E6D690]/50 uppercase tracking-widest whitespace-nowrap">
                      عميل {sIdx + 1}
                    </span>
                    <div className="flex-1 h-px bg-white/5" />
                  </div>
                )}
                {session.items.map(item => (
                  <div key={item.id} className="group relative flex items-center justify-between p-4 bg-[#1A1A1A] rounded-2xl border border-white/5 hover:border-[#E53935]/30 transition-all duration-300">
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-black text-white mb-1 group-hover:text-[#E53935] transition-colors">
                        {item.item_type === 'PRODUCT_ITEM' ? item.product_name : item.service_name}
                      </span>
                      {item.item_type === 'PRODUCT_ITEM' ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-white/40">الكمية: {item.quantity}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Users size={10} className="text-white/20" />
                          <span className="truncate text-[10px] font-bold text-white/40">{item.barber_name} {item.assistant_name ? `+ ${item.assistant_name}` : ''}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <div className="text-left">
                        <span className="text-sm font-black text-white">{item.total}</span>
                        <span className="text-[9px] font-bold text-white/20 ml-1">ج.م</span>
                      </div>
                      <button disabled={paymentLocked} onClick={() => handleRemoveItem(item.id)} className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-white/10 hover:bg-[#E53935]/10 hover:text-[#E53935] transition-all disabled:cursor-not-allowed disabled:opacity-30">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ));
          })() : (
            (console.log("[RENDER CHECKS] Sidebar empty state render. invoice:", currentInvoice, "items length:", currentInvoice?.items?.length) as unknown as null) ||
            <div className="h-full flex flex-col items-center justify-center text-center p-12 opacity-20 group">
              <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500">
                <Plus size={32} />
              </div>
              <p className="text-sm font-bold">لم يتم إضافة خدمات بعد</p>
              <p className="text-[10px] mt-2 opacity-60">اختر من القائمة للبدء</p>
            </div>
          )}
        
          {/* Subtotal & Fees (Moved to bottom of scrollable area to save space) */}
          <div className="pt-4 mt-4 border-t border-white/5 space-y-3">
            <div className="flex justify-between items-center px-1">
              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">المجموع الفرعي</span>
              <span className="text-xs font-black text-white/60">{subtotal} <span className="text-[9px]">ج.م</span></span>
            </div>

            {/* Discount Section moved to Sticky Footer */}
          </div>
        </div>

        {/* Payment Section (Sticky, Compact, Prioritized) */}
        <div 
          className="sticky bottom-0 bg-[#0B0B0B] z-20 flex flex-col pt-3 pb-4 px-4 border-t border-white/5 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]"
        >
          {/* Promo Invalidation / Stale Notice */}
          {promoNotice && (
            <div className="mb-2 px-2.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px] font-bold flex items-center justify-between gap-2 animate-in fade-in duration-200">
              <span className="truncate">{promoNotice}</span>
              <button onClick={() => setPromoNotice?.(null)} className="text-amber-300/50 hover:text-amber-300 shrink-0">
                <X size={12} />
              </button>
            </div>
          )}

          {/* Discount Section Restored Above Payment Row */}
          <div className={`mb-4 ${paymentLocked ? 'pointer-events-none opacity-50' : ''}`}>
            {appliedPromo ? (
              /* Case 1: Promo is applied */
              <div className="flex justify-between items-center group px-3 py-2 bg-[#E53935]/10 rounded-xl border border-[#E53935]/25">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#E53935] text-white text-[9px] font-black uppercase tracking-wider shrink-0">
                    <Check size={10} />
                    <span>{appliedPromo.code}</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-black text-[#E53935] flex items-center gap-1">
                      -{appliedPromo.promo_discount} <span className="text-[9px]">ج.م</span>
                      {appliedPromo.discount_type === 'PERCENTAGE' && (
                        <span className="text-[9px] text-[#E53935]/70 font-bold">({appliedPromo.configured_value}%)</span>
                      )}
                    </span>
                    {appliedPromo.discount_type === 'PERCENTAGE' && (
                      <span className="text-[9px] font-bold text-white/40 truncate">
                        وفرت {appliedPromo.promo_discount} ج.م
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={handleRemovePromo}
                  title="إزالة كود الخصم"
                  className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center text-white/40 hover:bg-[#E53935]/20 hover:text-[#E53935] transition-all shrink-0"
                >
                  <X size={12} />
                </button>
              </div>
            ) : appliedDiscount ? (
              /* Case 2: Manual Discount is applied */
              <div className="flex justify-between items-center group px-3 py-2 bg-black/20 rounded-xl border border-white/5">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-[#E53935]/10 text-[#E53935] text-[9px] font-black uppercase tracking-tighter">خصم خاص</span>
                  <span className="text-xs font-black text-[#E53935] flex items-center gap-1">
                    -{discountAmount} <span className="text-[9px]">ج.م</span>
                    {appliedDiscount.type === 'percentage' && <span className="text-[8px] opacity-40">({appliedDiscount.value}%)</span>}
                  </span>
                </div>
                <button
                  onClick={() => setAppliedDiscount(null)}
                  className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center text-white/30 opacity-0 group-hover:opacity-100 hover:bg-[#E53935]/10 hover:text-[#E53935] transition-all"
                >
                  <X size={10} />
                </button>
              </div>
            ) : isPromoOpen ? (
              /* Case 3: Promo Input Editor is open */
              <div className="flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-[36px] bg-black/40 rounded-xl overflow-hidden flex items-center border border-white/10 focus-within:border-[#E53935]/50 transition-all">
                    <input
                      type="text"
                      placeholder="أدخل كود الخصم"
                      value={promoInput}
                      onChange={(e) => {
                        setPromoInput(e.target.value.toUpperCase());
                        setLocalPromoError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handlePromoSubmit();
                      }}
                      autoFocus
                      disabled={isApplyingPromo || paymentLocked}
                      className="w-full bg-transparent border-none outline-none py-1 px-3 text-xs font-black text-white placeholder:text-white/20 uppercase tracking-wider"
                    />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={handlePromoSubmit}
                      disabled={isApplyingPromo || !promoInput.trim()}
                      className={`h-[36px] px-3 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                        !isApplyingPromo && promoInput.trim()
                          ? 'bg-[#E53935] text-white hover:bg-[#ff4040]'
                          : 'bg-white/5 text-white/30 cursor-not-allowed'
                      }`}
                    >
                      {isApplyingPromo ? (
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        'تطبيق'
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setIsPromoOpen(false);
                        setPromoInput('');
                        setLocalPromoError(null);
                      }}
                      disabled={isApplyingPromo}
                      className="w-[36px] h-[36px] rounded-xl bg-white/5 text-white/30 flex items-center justify-center hover:bg-white/10 hover:text-white transition-all"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                {localPromoError && (
                  <p className="text-[10px] font-bold text-[#E53935] px-1 animate-in fade-in duration-200">{localPromoError}</p>
                )}
              </div>
            ) : isDiscountOpen ? (
              /* Case 4: Manual Discount Editor is open */
              <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-300">
                <div className="flex-1 h-[36px] bg-black/40 rounded-xl overflow-hidden flex items-center border border-white/10 focus-within:border-[#E6D690]/50 transition-all">
                  <input
                    type="number"
                    disabled={paymentLocked}
                    placeholder="القيمة"
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    autoFocus
                    className="w-full bg-transparent border-none outline-none py-1 px-3 text-xs font-bold text-white placeholder:text-white/20"
                  />
                  <div className="flex p-0.5 gap-0.5">
                    <button
                      onClick={() => setDiscountType('percentage')}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${discountType === 'percentage' ? 'bg-[#E6D690] text-black shadow-lg shadow-[#E6D690]/20' : 'text-white/30 hover:bg-white/10'}`}
                    >
                      <Percent size={10} />
                    </button>
                    <button
                      onClick={() => setDiscountType('fixed')}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${discountType === 'fixed' ? 'bg-[#E6D690] text-black shadow-lg shadow-[#E6D690]/20' : 'text-white/30 hover:bg-white/10'}`}
                    >
                      <span className="text-[10px] font-black">ج.م</span>
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => {
                      const val = parseFloat(discountInput);
                      if (!isNaN(val) && val > 0) {
                        setAppliedDiscount({ value: val, type: discountType });
                        setIsDiscountOpen(false);
                        setDiscountInput('');
                      }
                    }}
                    className="w-[36px] h-[36px] rounded-xl bg-[#E6D690]/10 text-[#E6D690] flex items-center justify-center hover:bg-[#E6D690] hover:text-black transition-all"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={() => {
                      setIsDiscountOpen(false);
                      setDiscountInput('');
                    }}
                    className="w-[36px] h-[36px] rounded-xl bg-white/5 text-white/30 flex items-center justify-center hover:bg-white/10 hover:text-white transition-all"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : (
              /* Case 5: Default Dual Buttons */
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    if (appliedPromo) {
                      alert("يوجد كود خصم مطبق. احذفه أولاً لإضافة خصم يدوي.");
                      return;
                    }
                    setIsDiscountOpen(true);
                    setIsPromoOpen(false);
                    setLocalPromoError(null);
                  }}
                  className="text-[10px] font-bold text-[#E6D690]/60 hover:text-[#E6D690] transition-colors flex items-center gap-1.5"
                >
                  <Plus size={10} /> إضافة خصم
                </button>
                <span className="text-white/10 text-xs select-none">|</span>
                <button
                  onClick={() => {
                    if (appliedDiscount) {
                      alert("يوجد خصم يدوي مطبق. احذفه أولاً لاستخدام كود الخصم.");
                      return;
                    }
                    setIsPromoOpen(true);
                    setIsDiscountOpen(false);
                    setLocalPromoError(null);
                  }}
                  className="text-[10px] font-bold text-[#E53935]/80 hover:text-[#E53935] transition-colors flex items-center gap-1.5"
                >
                  <Tag size={10} /> كود خصم
                </button>
              </div>
            )}
          </div>

          {depositBookings.length > 1 && <label className="block text-xs mb-3">اختر الحجز صاحب العربون
            <select aria-label="الحجز صاحب العربون" className="w-full bg-[#202020] rounded-lg p-2 mt-1" disabled={paymentLocked}
              value={selectedBookingId ?? ''} onChange={event => onBookingChange?.(event.target.value ? Number(event.target.value) : null)}>
              <option value="">بدون تطبيق عربون — اختر الحجز</option>
              {depositBookings.map(booking => <option key={booking.appointment_id} value={booking.appointment_id}>#{booking.appointment_id} — {booking.date} {booking.time} — {booking.available_amount} ج</option>)}
            </select></label>}
          {depositNotice && <p role="status" className="text-xs text-amber-300 mb-2">{depositNotice}</p>}
          {depositApplied > 0 && <div className="text-xs space-y-2 mb-3">
            <div className="flex justify-between"><span>صافي الفاتورة بعد الخصومات</span><span>{invoiceNet} ج</span></div>
            <div className="flex justify-between text-emerald-400"><span>عربون مدفوع سابقًا</span><span>−{depositApplied} ج</span></div>
            {depositRemaining > 0 && <p className="text-white/50">يبقى للحجز بعد التسوية: {depositRemaining} ج</p>}
          </div>}
          {/* 1. Final Total */}
          <div className="flex justify-between items-end mb-3">
            <span className="text-xs font-black text-white/50 uppercase tracking-widest mb-1">{depositApplied > 0 ? "المتبقي للتحصيل" : "الإجمالي"}</span>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-black text-white tracking-tighter tabular-nums">{finalTotal}</span>
              <span className="text-xs font-black text-white/50">ج.م</span>
            </div>
          </div>

          {depositApplied > 0 && finalTotal === 0 && totalPaid > 0 && <p role="alert" className="text-xs text-amber-300 mb-2">الفاتورة مغطاة بالعربون؛ امسح مبالغ الدفع الجديدة.</p>}
          {/* 2. Structured Payment Inputs (Grid) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {([
              { id: 'cash',  method: 'CASH',   icon: <Wallet size={12} />,     label: 'كاش',   value: cashInput,  setter: setCashInput  },
              { id: 'visa1', method: 'VISA_1', icon: <CreditCard size={12} />, label: 'فيزا 1', value: visa1Input, setter: setVisa1Input },
              { id: 'visa2', method: 'VISA_2', icon: <CreditCard size={12} />, label: 'فيزا 2', value: visa2Input, setter: setVisa2Input },
              { id: 'insta', method: 'INSTAPAY', icon: <Landmark size={12} />,  label: 'إنستا', value: instaInput, setter: setInstaInput },
            ] as const).map((pm) => {
              const hasValue = parseFloat(pm.value) > 0;
              return (
                <div key={pm.id} className="flex flex-col gap-1.5 group">
                  {/* Label */}
                  <div className={`flex items-center justify-center gap-1.5 transition-colors duration-300 ${
                    hasValue ? 'text-[#E53935]' : 'text-[#F5F5F5] group-focus-within:text-[#E53935]'
                  }`}>
                    <div className={`${hasValue ? 'opacity-100 scale-110' : 'opacity-80 group-focus-within:opacity-100 group-focus-within:scale-110'} transition-all duration-300`}>
                      {pm.icon}
                    </div>
                    <span className="text-base xl:text-lg font-bold tracking-wider uppercase">{pm.label}</span>
                  </div>
                  
                  {/* Input Field */}
                  <div className={`relative h-[44px] rounded-xl flex items-center justify-center border transition-all duration-300 focus-within:border-[#E53935] focus-within:shadow-[0_0_12px_rgba(229,57,53,0.3)] ${
                    hasValue ? 'bg-[#E53935]/15 border-[#E53935]/50 shadow-[inset_0_0_15px_rgba(229,57,53,0.1)]' : 'bg-black/60 border-white/10 hover:border-white/20'
                  }`}>
                    <input
                      type="number"
                      disabled={paymentLocked}
                      min="0"
                      placeholder="0"
                      value={pm.value}
                      onChange={(e) => {
                        tenderEdited.current = true;
                        // Choosing a non-cash method replaces the untouched cash default.
                        if (pm.id !== 'cash' && hasAutomaticCash.current) setCashInput('');
                        hasAutomaticCash.current = false;
                        pm.setter(e.target.value);
                      }}
                      className="w-full h-full bg-transparent border-none outline-none text-center text-[13px] font-black text-white placeholder:text-white/15 transition-colors focus:text-white"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 3 & 4. Paid Amount Summary & Change Status */}
          <div className="px-2 space-y-1 mb-1">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">المبلغ المدفوع</span>
              <span className="text-xs font-black tabular-nums text-white/80">{totalPaid.toFixed(2)} ج.م</span>
            </div>
            
            {/* Feedback: Green for change, Red for remaining */}
            {totalPaid > 0 && totalPaid < finalTotal && (
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-[#E53935]/80 uppercase tracking-widest">متبقي</span>
                <span className="text-xs font-black text-[#E53935] tabular-nums">{(finalTotal - totalPaid).toFixed(2)} ج.م</span>
              </div>
            )}
            {change > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-green-400 uppercase tracking-widest">الباقي للعميل</span>
                <span className="text-sm font-black text-green-400 tabular-nums">{change.toFixed(2)} ج.م</span>
              </div>
            )}
          </div>

          {/* 5. Confirm Button */}
          <button
            onClick={handleConfirm}
            disabled={
              isInteractionLocked || isLoading
              || paymentPhase === 'SUBMITTING'
              || (paymentPhase === 'VERIFYING' && !canRetryPaymentVerification)
              || (paymentPhase === 'IDLE' && !canConfirm)
            }
            className={`w-full rounded-xl flex items-center justify-center gap-3 transition-all duration-300 relative group overflow-hidden ${
              ((paymentPhase === 'IDLE' && canConfirm) || (paymentPhase === 'VERIFYING' && canRetryPaymentVerification)) && !isLoading
                ? 'bg-[#E53935] hover:bg-[#ff4040] shadow-[0_5px_15px_rgba(229,57,53,0.3)]' 
                : 'bg-white/5 text-white/20 cursor-not-allowed grayscale'
            }`}
            style={{ height: '52px', marginTop: '12px' }}
          >
            {isLoading || paymentPhase === 'SUBMITTING' || (paymentPhase === 'VERIFYING' && !canRetryPaymentVerification) ? (
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span className="text-xs font-black">
                  {paymentPhase === 'VERIFYING' ? 'جاري التحقق من نتيجة الدفع...' : 'جاري المعالجة...'}
                </span>
              </div>
            ) : (
              <>
                <span className="text-sm font-black tracking-tight">
                  {paymentPhase === 'VERIFYING'
                    ? 'إعادة التحقق من الدفع'
                    : canConfirm
                    ? (invoiceNet === 0 && subtotal > 0
                        ? 'إكمال العملية (خصم كامل)' 
                        : (isGroupMode ? 'تأكيد الفاتورة المجمعة' : 'إكمال عملية الدفع'))
                    : 'في انتظار إكمال الدفع'
                  }
                </span>
                {(canConfirm || paymentPhase === 'VERIFYING') && <Check size={16} className="transition-transform group-hover:scale-110" />}
              </>
            )}
            <div className={`absolute inset-0 bg-white/10 translate-y-full transition-transform duration-300 group-hover:translate-y-0`} />
          </button>
        </div>
      </aside>
    </>
  );
});

export default InvoiceSection;
