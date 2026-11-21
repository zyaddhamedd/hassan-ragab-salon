import React, { useState, useCallback } from 'react';
import { X, Printer, Wallet, CreditCard, Landmark, CheckCircle2 } from 'lucide-react';
import { PaymentMethod } from '../src/types/payment';
import logo from '../src/assets/llooggo.svg';
import { formatDate, formatTime } from '../src/utils/dateFormatter';
import { normalizeEgyptianPhone, buildInvoiceWhatsAppMessage, openInvoiceInWhatsApp, resolveInvoiceGrossSubtotal } from '../src/utils/whatsappUtil';
import WhatsAppIcon from '../src/components/WhatsAppIcon';
import ReceiptPrintLayout from './ReceiptPrintLayout';
import { PromoInvoiceData } from '../src/types/promo';

export interface ReceiptServiceItem {
   name: string;
   price: number;
   itemType?: 'SERVICE_ITEM' | 'PRODUCT_ITEM';
   barberName?: string | null;
}

export interface ReceiptGroup {
   customerName?: string;
   services: ReceiptServiceItem[];
   barber: string;
   assistant?: string;
   subtotal: number;
}

interface ReceiptProps {
   invoiceId?: string | number;
   branchName?: string;
   payerName?: string;
   payerPhone?: string;
   groups: ReceiptGroup[];
   total: number;
   subtotal: number;
   discountAmount: number;
   depositApplied?: number;
   promo?: PromoInvoiceData | null;
   payments?: { method: string; amount: number; entered_amount?: number }[];
   changeAmount?: number;
   onClose: () => void;
}

const PaymentIcon = ({ method }: { method: PaymentMethod }) => {
   switch (method) {
      case 'Cash': return <Wallet size={10} />;
      case 'Visa': return <CreditCard size={10} />;
      case 'InstaPay': return <Landmark size={10} />;
   }
};

const PaymentLabel = ({ method }: { method: PaymentMethod }) => {
   switch (method) {
      case 'Cash': return 'نقدي';
      case 'Visa': return 'Visa';
      case 'InstaPay': return 'InstaPay';
   }
};

const Receipt: React.FC<ReceiptProps> = React.memo(({
   invoiceId,
   branchName,
   payerName,
   payerPhone,
   groups,
   total,
   subtotal,
   discountAmount,
   promo = null,
   depositApplied = 0,
   payments = [],
   changeAmount = 0,
   onClose,
}) => {

   const today = new Date();
   const dateStr = formatDate(today);
   const timeStr = formatTime(today);

   const calculatedSubtotal = resolveInvoiceGrossSubtotal({ subtotal, groups });
   const calculatedDiscount = promo?.discount_amount ?? (typeof discountAmount === 'number' ? discountAmount : 0);
   const calculatedNet = Math.max(0, calculatedSubtotal - calculatedDiscount);
   const authoritativeTotal = typeof total === 'number' && (calculatedDiscount === 0 || total <= calculatedSubtotal - calculatedDiscount)
      ? total
      : calculatedNet;

   // Toast state for WhatsApp validation errors
   const [toastMessage, setToastMessage] = useState<string | null>(null);
   const [toastType, setToastType] = useState<'error' | 'success'>('error');

   // Auto-dismiss toast after 2600ms
   React.useEffect(() => {
      if (!toastMessage) return;
      const timeout = window.setTimeout(() => setToastMessage(null), 2600);
      return () => clearTimeout(timeout);
   }, [toastMessage]);

   const handlePrint = () => {
      // Yield to the React render cycle and browser paint before freezing the main thread with print dialog
      setTimeout(() => window.print(), 300);
   };

   const handleWhatsApp = useCallback(() => {
      // Validate phone
      if (!payerPhone || !payerPhone.trim()) {
         setToastType('error');
         setToastMessage('لا يوجد رقم هاتف مسجل لهذا العميل');
         return;
      }

      // Normalize phone
      const normalizedPhone = normalizeEgyptianPhone(payerPhone);
      if (!normalizedPhone) {
         setToastType('error');
         setToastMessage('رقم الهاتف غير صالح للإرسال عبر واتساب');
         return;
      }

      // Build message from invoice data
      const message = buildInvoiceWhatsAppMessage({
         invoiceId,
         payerName,
         branchName,
         groups,
         subtotal: calculatedSubtotal,
         total: authoritativeTotal,
         discountAmount: calculatedDiscount,
         promo,
         depositApplied,
         payments,
      });

      // Open WhatsApp Web with prefilled message
      try {
         openInvoiceInWhatsApp(normalizedPhone, message);
      } catch (error) {
         setToastType('error');
         setToastMessage('فشل فتح واتساب. تأكد من أن المتصفح لديه إذن لفتح نوافذ جديدة.');
         console.error('[WhatsApp] Error:', error);
      }
   }, [payerPhone, invoiceId, payerName, branchName, groups, calculatedSubtotal, authoritativeTotal, calculatedDiscount, promo, payments, depositApplied]);

   console.log("[RECEIPT] invoice:", invoiceId);
   console.log("[RECEIPT] items:", groups[0]?.services);

   return (
      <>
         {/*
          * ── SCREEN UI (modal overlay) ──────────────────────────────────────
          * Hidden during print via body * { visibility: hidden }
          */}
         <div className="no-print fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-xl p-4 font-['Cairo'] overflow-y-auto">

            {/* Toast Notification */}
            {toastMessage && (
               <div className="fixed left-6 bottom-6 z-[120] animate-fade-in-up">
                  <div className={`flex items-center gap-2.5 rounded-xl border px-4 py-3.5 text-xs font-semibold shadow-2xl backdrop-blur-md ${
                     toastType === 'error'
                        ? 'border-red-500/10 bg-[#161618] text-red-300'
                        : 'border-emerald-500/10 bg-[#161618] text-emerald-300'
                  }`}>
                     <CheckCircle2 size={14} className={toastType === 'error' ? 'text-red-400' : 'text-emerald-400'} />
                     <span>{toastMessage}</span>
                  </div>
               </div>
            )}

            {/* Controls */}
            <div className="max-w-[320px] w-full">
               <div className="flex justify-between items-center mb-3">
                  <button onClick={onClose} className="p-2 bg-white/10 rounded-full text-white hover:bg-red-600">
                     <X size={16} />
                  </button>
                  <div className="flex items-center gap-2">
                     <button onClick={handlePrint} className="px-4 py-2 bg-[#E6D690] rounded-full text-black text-xs font-bold flex items-center gap-2">
                        <Printer size={14} /> طباعة
                     </button>
                     <button onClick={handleWhatsApp} className="px-4 py-2 bg-[#25D366] rounded-full text-white text-xs font-bold flex items-center gap-2 hover:bg-[#1fb358]">
                        <WhatsAppIcon size={14} /> واتساب
                     </button>
                  </div>
               </div>

               {/* Screen preview of the receipt */}
               <div className="bg-white text-[#121212] rounded-2xl px-5 py-4 text-[12px] leading-tight" dir="rtl">
                  <ReceiptContent
                     invoiceId={invoiceId}
                     branchName={branchName}
                     payerName={payerName}
                     payerPhone={payerPhone}
                     groups={groups}
                     total={total}
                     subtotal={calculatedSubtotal}
                     discountAmount={discountAmount}
                     depositApplied={depositApplied}
                     promo={promo}
                     payments={payments}
                     changeAmount={changeAmount}
                     dateStr={dateStr}
                     timeStr={timeStr}
                  />
               </div>
            </div>
         </div>

         {/*
          * ── PRINT TARGET ──────────────────────────────────────────────────
          * Managed internally by ReceiptPrintLayout's strict HTML/CSS configuration.
          * The screen UI above has .no-print so it vanishes during printing.
          */}
         <ReceiptPrintLayout
            invoiceId={invoiceId}
            branchName={branchName}
            payerName={payerName}
            payerPhone={payerPhone}
            groups={groups}
            total={total}
            subtotal={calculatedSubtotal}
            discountAmount={discountAmount}
            depositApplied={depositApplied}
            promo={promo}
            payments={payments}
            changeAmount={changeAmount}
            dateStr={dateStr}
            timeStr={timeStr}
         />
      </>
   );
});

// ─── Shared receipt content (rendered twice: screen preview + print target) ───

export interface ContentProps {
   invoiceId?: string | number;
   branchName?: string;
   payerName?: string;
   payerPhone?: string;
   groups: ReceiptGroup[];
   total: number;
   subtotal: number;
   discountAmount: number;
   depositApplied?: number;
   promo?: PromoInvoiceData | null;
   payments?: { method: string; amount: number; entered_amount?: number }[];
   changeAmount?: number;
   dateStr: string;
   timeStr: string;
}

export type ReceiptContentProps = ContentProps;

export const ReceiptContent: React.FC<ContentProps> = React.memo(({
   invoiceId,
   branchName,
   payerName,
   payerPhone,
   groups,
   total,
   subtotal,
   discountAmount,
   promo = null,
   depositApplied = 0,
   payments = [],
   changeAmount = 0,
   dateStr,
   timeStr,
}) => {
   const safePayments = payments || [];
   const getDisplayedPaymentAmount = (payment: { amount: number; entered_amount?: number }) =>
      payment.entered_amount ?? payment.amount;
   const getPaymentLabel = (m: string) => {
      if (m?.toUpperCase() === 'CASH') return 'نقدي';
      if (m?.toUpperCase() === 'VISA') return 'Visa';
      if (m?.toUpperCase() === 'INSTAPAY') return 'InstaPay';
      return m;
   };

   let paymentDisplay = '---';
   if (safePayments.length === 1) {
      paymentDisplay = getPaymentLabel(safePayments[0].method);
   } else if (safePayments.length > 1) {
      paymentDisplay = 'متعدد (Split)';
   }

   const effectiveSubtotal = typeof subtotal === 'number' ? subtotal : 0;
   const effectiveDiscount = promo?.discount_amount ?? (typeof discountAmount === 'number' ? discountAmount : 0);
   const effectiveNet = typeof total === 'number' && (effectiveDiscount === 0 || total <= effectiveSubtotal - effectiveDiscount)
      ? total
      : Math.max(0, effectiveSubtotal - effectiveDiscount);

   return (
   <>
      {/* Logo */}
      <div className="flex flex-col items-center mb-3">
         <img src={logo} alt="logo" className="w-24 mb-1" />
         <div className="text-[11px] font-black">
            فاتورة رقم #{invoiceId || '---'}
         </div>
      </div>

      {/* Client Info */}
      <div className="border-t border-b py-2 text-[11px] space-y-1">
         <div className="flex justify-between">
            <span>العميل</span>
            <span className="font-bold">{payerName || 'ضيف'}</span>
         </div>
         {payerPhone && (
            <div className="flex justify-between">
               <span>رقم</span>
               <span>{payerPhone}</span>
            </div>
         )}
         <div className="flex justify-between">
            <span>الدفع</span>
            <div className="flex items-center gap-1 font-bold">
               <span>{paymentDisplay}</span>
            </div>
         </div>
      </div>

      {/* Services */}
      <div className="mt-3 space-y-2">
         {groups.map((group, gIdx) => (
            <div key={gIdx}>
               {group.services.map((service, sIdx) => (
                  <div key={sIdx} className="flex justify-between border-b border-dashed pb-1 mb-1">
                     <span className="text-[11px]">{service.name}</span>
                     <span className="font-bold">{service.price} ج</span>
                  </div>
               ))}
            </div>
         ))}
      </div>

      {/* Totals */}
      <div className="mt-3 pt-2 border-t space-y-1 text-[12px]">
         <div className="flex justify-between">
            <span>الإجمالي</span>
            <span>{effectiveSubtotal} ج</span>
         </div>

         {promo ? (
            <div className="flex justify-between text-[#E53935] font-bold">
               <span>كود الخصم ({promo.code})</span>
               <span>-{effectiveDiscount} ج</span>
            </div>
         ) : effectiveDiscount > 0 ? (
            <div className="flex justify-between text-emerald-600">
               <span>خصم</span>
               <span>-{effectiveDiscount} ج</span>
            </div>
         ) : null}

         <div className="flex justify-between text-[14px] font-black border-t pt-1 mt-1">
            <span>إجمالي الفاتورة</span>
            <span>{effectiveNet} ج</span>
         </div>

         {depositApplied > 0 && <div className="text-[12px] space-y-1">
            <div className="flex justify-between"><span>عربون مدفوع سابقًا</span><span>{depositApplied} ج</span></div>
            <div className="flex justify-between"><span>التحصيل الجديد</span><span>{Math.max(0, effectiveNet - depositApplied)} ج</span></div>
            <div className="flex justify-between"><span>المتبقي غير المدفوع</span><span>0 ج</span></div>
         </div>}
         {effectiveNet === 0 && effectiveSubtotal > 0 && (
            <div className="mt-2 py-1 px-2 bg-black text-white text-center rounded-lg font-black text-[9px] tracking-widest uppercase">
               FULLY DISCOUNTED / مجاني
            </div>
         )}
      </div>

      {safePayments.length > 0 && (
         <div className="mt-2 pt-2 border-t border-dashed space-y-1 text-[11px]">
            {safePayments.map((p, i) => (
               <div key={i} className="flex justify-between">
                  <span>مدفوع ({getPaymentLabel(p.method)})</span>
                  <span className="font-bold">{getDisplayedPaymentAmount(p)} ج</span>
               </div>
            ))}
            {changeAmount > 0 && (
               <div className="flex justify-between text-[#E53935]">
                  <span>الباقي للعميل</span>
                  <span className="font-bold">{changeAmount} ج</span>
               </div>
            )}
         </div>
      )}

      {/* QR Code */}
      <div className="receipt-qr mt-4 flex flex-col items-center gap-2">
         <div className="w-20 h-20 bg-[#fafafa] rounded-xl flex items-center justify-center p-1">
            <img
               src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent('https://example.invalid/omar-qr-unconfigured')}`}
               alt="QR"
               className="w-full h-full object-contain"
            />
         </div>
      </div>

      {/* Footer */}
      <div className="text-center mt-3 text-[10px]">
         <div>{dateStr} - {timeStr}</div>
         <div className="mt-1 font-bold">{branchName || ''}</div>
         <div className="mt-1">شكراً لزيارتكم 🤍</div>
      </div>
   </>
   );
});

export default Receipt;
