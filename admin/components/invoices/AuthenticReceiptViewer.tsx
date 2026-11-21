import React, { useMemo, useState, useCallback } from 'react';
import { Printer, AlertCircle, FileClock, CheckCircle2 } from 'lucide-react';
import { Invoice } from '../../types';
import { formatDate, formatTime } from '../../utils/dateFormatter';
import { ReceiptContent, ReceiptGroup } from '../../../mini/components/Receipt';
import ReceiptPrintLayout from '../../../mini/components/ReceiptPrintLayout';

export interface AuthenticReceiptViewerProps {
  invoice: Invoice;
  isDarkMode?: boolean;
  showPrintButton?: boolean;
}

/**
 * AuthenticReceiptViewer
 * 
 * Thin Admin adapter that consumes the authentic Mini Cashier receipt renderer
 * without code duplication. Preserves single-source-of-truth receipt layout.
 */
export const AuthenticReceiptViewer: React.FC<AuthenticReceiptViewerProps> = ({
  invoice,
  isDarkMode = true,
  showPrintButton = true,
}) => {
  const [isThermalPrinting, setIsThermalPrinting] = useState(false);

  const isPaid = invoice.status_code === 'PAID' || invoice.status === 'مدفوعة';
  const isDraft = invoice.status_code === 'DRAFT' || invoice.status === 'معلقة' || invoice.status_code === 'DRAFT_COMMITTED' || invoice.status === 'مسودة غير مكتملة';
  const isEmptiedDraft = invoice.draft_state === 'EMPTIED_DRAFT';

  const dateStr = useMemo(() => formatDate(invoice.date), [invoice.date]);
  const timeStr = useMemo(() => formatTime(invoice.date), [invoice.date]);

  const receiptSubtotal = Number(invoice.amount ?? 0);
  const receiptDiscount = Number(invoice.discountAmount ?? 0);
  const receiptNet = typeof invoice.netAmount === 'number'
    ? Number(invoice.netAmount)
    : Math.max(0, receiptSubtotal - receiptDiscount);
  const depositApplied = Number(invoice.deposit_settlement?.applied_amount ?? 0);

  const receiptGroups = useMemo<ReceiptGroup[]>(() => {
    if (!invoice.items || invoice.items.length === 0) return [];
    return [{
      customerName: invoice.client || invoice.customer_name || 'ضيف',
      services: invoice.items.map((i: any) => ({
        name: i.item_type === 'PRODUCT_ITEM'
          ? (i.product_name || i.serviceName || 'منتج')
          : (i.serviceName || i.product_name || '---'),
        price: Number(i.price ?? 0),
        itemType: i.item_type,
        barberName: i.employeeName || i.assigned_employee_name || null,
      })),
      barber: invoice.items[0]?.employeeName || invoice.barber || '-',
      subtotal: receiptNet,
    }];
  }, [invoice, receiptNet]);

  const handleThermalPrint = useCallback(() => {
    setIsThermalPrinting(true);
    setTimeout(() => {
      window.print();
      // Reset thermal printing target after print dialog closes
      setTimeout(() => setIsThermalPrinting(false), 500);
    }, 200);
  }, []);

  if (isEmptiedDraft) {
    return (
      <div className={`p-6 rounded-2xl border text-center space-y-3 ${
        isDarkMode ? 'bg-[#141414] border-white/5 text-gray-400' : 'bg-gray-50 border-black/5 text-gray-600'
      }`}>
        <AlertCircle size={28} className="mx-auto text-amber-500 opacity-80" />
        <h4 className="text-sm font-bold text-amber-500">مسودة مفرغة</h4>
        <p className="text-xs max-w-xs mx-auto leading-relaxed">
          تم حذف جميع عناصر هذه المسودة، ولا يمكن إصدار إيصال حراري لعناصر فارغة.
        </p>
        {invoice.last_gross_before_emptying != null && (
          <span className="inline-block px-3 py-1 rounded-lg text-xs font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            آخر قيمة قبل التفريغ: {invoice.last_gross_before_emptying.toLocaleString()} ج.م
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      {/* Draft State Banner */}
      {isDraft && (
        <div className="w-full max-w-[320px] mb-3 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-2 text-amber-400 text-xs font-bold">
          <FileClock size={16} className="shrink-0" />
          <span>مسودة غير مدفوعة — معاينة تقديرية</span>
        </div>
      )}

      {/* Screen Presentation: Authentic 80mm thermal container */}
      <div
        className="w-full max-w-[320px] bg-white text-[#121212] rounded-2xl px-5 py-4 text-[12px] leading-tight shadow-xl border border-black/10 select-none font-['Cairo']"
        dir="rtl"
      >
        <ReceiptContent
          invoiceId={isDraft && (!invoice.number || invoice.number === '---') ? 'مسودة' : (invoice.number || invoice.invoice_number || '---')}
          branchName={invoice.branch || ''}
          payerName={invoice.client || invoice.customer_name || 'ضيف'}
          payerPhone={invoice.customer_phone || ''}
          groups={receiptGroups}
          total={receiptNet}
          subtotal={receiptSubtotal}
          discountAmount={receiptDiscount}
          depositApplied={depositApplied}
          promo={invoice.promo || null}
          payments={invoice.payments || []}
          changeAmount={Number(invoice.change_amount ?? 0)}
          dateStr={dateStr}
          timeStr={timeStr}
        />
      </div>

      {/* Action Controls */}
      {showPrintButton && isPaid && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={handleThermalPrint}
            className="px-5 py-2.5 bg-[#E6D690] hover:bg-[#ebdca0] active:scale-95 text-black text-xs font-bold rounded-xl flex items-center gap-2 transition-all shadow-md"
          >
            <Printer size={14} />
            <span>طباعة الإيصال الحراري (80mm)</span>
          </button>
        </div>
      )}

      {/* 
        Print Isolation:
        Only mount ReceiptPrintLayout when thermal printing is triggered,
        preventing global print CSS leakage into Admin workspace.
      */}
      {isThermalPrinting && (
        <ReceiptPrintLayout
          invoiceId={invoice.number || invoice.invoice_number || '---'}
          branchName={invoice.branch || ''}
          payerName={invoice.client || invoice.customer_name || 'ضيف'}
          payerPhone={invoice.customer_phone || ''}
          groups={receiptGroups}
          total={receiptNet}
          subtotal={receiptSubtotal}
          discountAmount={receiptDiscount}
          depositApplied={depositApplied}
          promo={invoice.promo || null}
          payments={invoice.payments || []}
          changeAmount={Number(invoice.change_amount ?? 0)}
          dateStr={dateStr}
          timeStr={timeStr}
        />
      )}
    </div>
  );
};

export default AuthenticReceiptViewer;
