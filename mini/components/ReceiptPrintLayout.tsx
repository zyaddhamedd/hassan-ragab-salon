import React from 'react';
import { PaymentMethod } from '../src/types/payment';
import logo from '../src/assets/llooggo.svg';
import { ReceiptGroup } from './Receipt';
import { User, Banknote } from 'lucide-react';
import { PromoInvoiceData } from '../src/types/promo';

export interface ReceiptPrintLayoutProps {
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

const ReceiptPrintLayout: React.FC<ReceiptPrintLayoutProps> = React.memo(({
   invoiceId,
   branchName,
   payerName,
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
      const upper = m?.toUpperCase();
      if (upper === 'CASH') return 'نقدي';
      if (upper === 'VISA_1') return 'فيزا 1';
      if (upper === 'VISA_2') return 'فيزا 2';
      if (upper === 'VISA') return 'Visa';
      if (upper === 'INSTAPAY') return 'InstaPay';
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
      <div id="print-area" className="receipt-print-wrapper" dir="rtl">
         <style type="text/css" dangerouslySetInnerHTML={{
            __html: `
            @media screen {
               #print-area { display: none !important; }
            }
            @media print {
               @page {
                  margin: 0 !important;
                  /* Do NOT define page size to avoid conflicts with printer drivers */
               }

               /* ── GLOBAL NORMALIZATION ── */
               html, body {
                  margin: 0 !important;
                  padding: 0 !important;
                  background: #fff !important;
                  width: 100% !important;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
               }
               body {
                  color: #000 !important;
                  font-family: Arial, sans-serif !important;
                  font-weight: 500 !important;
                  text-rendering: optimizeLegibility !important;
               }
               * {
                  color: #000 !important;
                  box-sizing: border-box;
               }

               /* ── LAYOUT DOM FLATTENER (THE MAGIC TRICK) ── */
               body * { visibility: hidden; }

               body *:not(#print-area):not(#print-area *) {
                  display: block !important;
                  position: static !important;
                  float: none !important;
                  clear: both !important;
                  margin: 0 !important;
                  padding: 0 !important;
                  border: none !important;
                  min-height: 0 !important;
                  max-height: 0 !important;
                  height: 0 !important;
                  font-size: 0 !important;
                  line-height: 0 !important;
                  overflow: visible !important;
                  transform: none !important;
               }

               /* ── RE-ENABLE RECEIPT ── */
               #print-area, #print-area * { visibility: visible !important; }

               #print-area {
                  display: block !important;
                  position: static !important;
                  width: 100% !important;
                  max-width: 270px !important;
                  margin: 0 auto !important;
                  padding: 0 8px !important; 
                  background: #fff !important;
                  overflow: hidden !important;
                  box-sizing: border-box !important;
                  font-size: 11px !important;
                  line-height: 1.3 !important;
               }

               #print-area::after {
                  content: "" !important;
                  display: block !important;
                  height: 40mm !important;
                  width: 100% !important;
               }

               .rp-divider {
                  border-top: 1px dashed #000 !important;
                  margin: 4px 0 !important;
                  width: 100% !important;
               }

               /* ── HEADER ── */
               .rp-header {
                  text-align: center !important;
                  margin-bottom: 2px !important;
               }
               .rp-logo {
                  display: block !important;
                  width: 100% !important;
                  max-width: 100% !important;
                  height: auto !important;
                  object-fit: contain !important;
                  margin: 0 auto 2px auto !important;
                  filter: grayscale(100%) contrast(120%) brightness(95%) !important;
               }
               .rp-branch {
                  font-size: 11px !important;
                  font-weight: 700 !important;
                  margin-bottom: 2px !important;
               }
               .rp-tagline {
                  font-size: 9px !important;
                  font-weight: 500 !important;
                  margin-bottom: 2px !important;
               }

               /* ── INVOICE NUMBER ── */
               .rp-invoice-inline {
                  font-size: 10px !important;
                  font-weight: 500 !important;
                  margin-top: 2px !important;
                  text-align: center !important;
               }

               /* ── CUSTOMER INFO ── */
               .rp-customer-info {
                  margin: 6px 0 !important;
               }
               .rp-info-table {
                  width: auto !important;
                  margin: 0 auto !important;
                  border-collapse: collapse !important;
               }
               .rp-info-table td {
                  padding: 1px 3px !important;
                  font-size: 10px !important;
                  vertical-align: middle !important;
               }
               .rp-info-table .rpi-icon {
                  width: 14px !important;
                  text-align: right !important;
               }
               .rp-info-table .rpi-icon svg {
                  width: 11px !important;
                  height: 11px !important;
                  display: block !important;
               }
               .rp-info-table .rpi-label {
                  font-weight: 700 !important;
                  text-align: right !important;
                  white-space: nowrap !important;
               }
               .rp-info-table .rpi-colon {
                  font-weight: 700 !important;
                  text-align: center !important;
               }
               .rp-info-table .rpi-value {
                  font-weight: 500 !important;
                  text-align: right !important;
                  white-space: nowrap !important;
               }

               /* ── ORDER DETAILS HEADER ── */
               .rp-order-header {
                  background: #000 !important;
                  color: #fff !important;
                  text-align: center !important;
                  font-size: 11px !important;
                  font-weight: 700 !important;
                  padding: 3px 0 !important;
                  margin: 6px 0 !important;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
               }

               /* ── ITEMS TABLE ── */
               .rp-table {
                  width: 100% !important;
                  border-collapse: collapse !important;
                  font-size: 11px !important;
                  margin-bottom: 4px !important;
                  table-layout: fixed !important;
               }
               .rp-table th {
                  font-weight: 700 !important;
                  padding-bottom: 4px !important;
                  border-bottom: 1px dashed #000 !important;
               }
               .rp-table td {
                  padding: 3px 0 !important;
                  font-weight: 600 !important;
               }
               .rp-table .rp-stylist {
                  padding: 0 0 3px !important;
                  font-size: 10px !important;
                  font-weight: 500 !important;
               }
               .rp-col-name { text-align: right !important; width: 45% !important; }
               .rp-col-qty { text-align: center !important; width: 20% !important; }
               .rp-col-price { text-align: left !important; width: 35% !important; }

               /* ── SUMMARY ── */
               .rp-summary-list {
                  width: 100% !important;
                  display: flex !important;
                  flex-direction: column !important;
                  gap: 3px !important;
                  margin-top: 6px !important;
               }
               .rp-summary-item {
                  display: flex !important;
                  justify-content: space-between !important;
                  font-size: 11px !important;
                  font-weight: 700 !important;
               }
               .rp-summary-net {
                  display: flex !important;
                  justify-content: space-between !important;
                  background: #000 !important;
                  color: #fff !important;
                  padding: 4px 6px !important;
                  margin-top: 3px !important;
                  font-weight: 700 !important;
                  font-size: 12px !important;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
               }
               .rp-summary-net * {
                  color: #fff !important;
               }

               /* ── QR SECTION ── */
               .qr-section {
                  text-align: center !important;
                  margin: 8px 0 !important;
                  display: block !important;
                  visibility: visible !important;
               }
               .qr-code {
                  display: block !important;
                  width: 85px !important;
                  max-width: 100% !important;
                  height: auto !important;
                  margin: 0 auto !important;
               }
               .qr-text {
                  font-size: 11px !important;
                  font-weight: 700 !important;
                  margin-top: 4px !important;
               }

               /* ── FOOTER ── */
               .rp-footer {
                  text-align: center !important;
                  font-size: 10px !important;
                  font-weight: 600 !important;
                  line-height: 1.5 !important;
                  margin-top: 6px !important;
               }
               .rp-divider-stars {
                  display: flex !important;
                  align-items: center !important;
                  justify-content: center !important;
                  gap: 6px !important;
                  margin-top: 8px !important;
                  font-size: 12px !important;
               }
               .rp-divider-stars::before,
               .rp-divider-stars::after {
                  content: "" !important;
                  flex: 1 !important;
                  border-top: 1px dashed #000 !important;
               }
               .no-print { display: none !important; }
            }
            `}} />

         {/* ── HEADER ── */}
         <div className="rp-header">
            <img src={logo} alt="logo" className="rp-logo" />
            <div className="rp-tagline">The Secret Men's Club Experience</div>
            <div className="rp-branch">{branchName || 'فرع المنصورة'}</div>
            <div className="rp-invoice-inline">Invoice #{invoiceId || '2'}</div>
         </div>

         <div className="rp-divider" />

         {/* ── CUSTOMER INFO ── */}
         <div className="rp-customer-info">
            <table className="rp-info-table">
               <tbody>
                  <tr>
                     <td className="rpi-icon"><User size={11} strokeWidth={2.5} /></td>
                     <td className="rpi-label">العميل</td>
                     <td className="rpi-colon">:</td>
                     <td className="rpi-value">{payerName || 'عميل غير مسمى'}</td>
                  </tr>
                  <tr>
                     <td className="rpi-icon"><Banknote size={11} strokeWidth={2.5} /></td>
                     <td className="rpi-label">الدفع</td>
                     <td className="rpi-colon">:</td>
                     <td className="rpi-value">{paymentDisplay}</td>
                  </tr>
               </tbody>
            </table>
         </div>

         {/* ── ORDER DETAILS HEADER ── */}
         <div className="rp-order-header">Experience Details</div>

         {/* ── ITEMS TABLE ── */}
         <table className="rp-table">
            <thead>
               <tr>
                  <th className="rp-col-name">الصنف</th>
                  <th className="rp-col-qty">الكمية</th>
                  <th className="rp-col-price">السعر</th>
               </tr>
            </thead>
            <tbody>
               {groups.map((group, gIdx) => (
                  <React.Fragment key={gIdx}>
                     {group.services.map((service, sIdx) => (
                        <React.Fragment key={`${gIdx}-${sIdx}`}>
                           <tr>
                              <td className="rp-col-name">{service.name}</td>
                              <td className="rp-col-qty">1</td>
                              <td className="rp-col-price">{service.price} ج</td>
                           </tr>
                           {service.itemType === 'SERVICE_ITEM' && service.barberName?.trim() && (
                              <tr>
                                 <td className="rp-stylist" colSpan={3}>المصفف: {service.barberName}</td>
                              </tr>
                           )}
                        </React.Fragment>
                     ))}
                  </React.Fragment>
               ))}
            </tbody>
         </table>

         <div className="rp-divider" />

         {/* ── SUMMARY ── */}
         <div className="rp-summary-list">
            <div className="rp-summary-item">
               <span>Subtotal</span>
               <span>{effectiveSubtotal} ج</span>
            </div>
            {promo ? (
               <>
                  <div className="rp-summary-item">
                     <span>كود الخصم ({promo.code})</span>
                     <span style={{ fontWeight: 600 }}>خصم {promo.discount_type === 'PERCENTAGE' ? `${promo.configured_value}%` : ''}</span>
                  </div>
                  <div className="rp-summary-item">
                     <span>خصم الكود</span>
                     <span>-{effectiveDiscount} ج</span>
                  </div>
               </>
            ) : effectiveDiscount > 0 ? (
               <div className="rp-summary-item">
                  <span>Discount</span>
                  <span>-{effectiveDiscount} ج</span>
               </div>
            ) : null}
            <div className="rp-summary-net">
               <span>TOTAL AMOUNT</span>
               <span>{effectiveNet} ج</span>
            </div>

            {depositApplied > 0 && <>
               <div className="rp-summary-item"><span>عربون مدفوع سابقًا</span><span>{depositApplied} ج</span></div>
               <div className="rp-summary-item"><span>التحصيل الجديد</span><span>{Math.max(0, effectiveNet - depositApplied)} ج</span></div>
               <div className="rp-summary-item"><span>المتبقي غير المدفوع</span><span>0 ج</span></div>
            </>}
            {/* Split Payment Breakdown */}
            {safePayments.length > 0 && (
               <div style={{ marginTop: '4px', borderTop: '1px dashed #000', paddingTop: '4px' }}>
                  {safePayments.map((p, i) => (
                     <div key={i} className="rp-summary-item" style={{ fontWeight: 500 }}>
                        <span>Paid ({getPaymentLabel(p.method)})</span>
                        <span>{getDisplayedPaymentAmount(p)} ج</span>
                     </div>
                  ))}
                  {changeAmount > 0 && (
                     <div className="rp-summary-item" style={{ fontWeight: 500 }}>
                        <span>Change Due</span>
                        <span>{changeAmount} ج</span>
                     </div>
                  )}
               </div>
            )}
         </div>

         {/* ── QR ── */}
         <div className="qr-section">
            <img
               className="qr-code"
               src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent('https://example.invalid/omar-qr-unconfigured')}`}
               alt="QR"
            />
            <div className="qr-text">Scan & unlock the full experience</div>
         </div>

         <div className="rp-divider" />

         {/* ── FOOTER ── */}
         <div className="rp-footer">
            <div>{dateStr} — {timeStr}</div>
            <div style={{ marginTop: '4px', fontWeight: 600 }}>✂️See you sharper next time ✂️</div>

            <div className="rp-divider-stars">
               <span>★</span>
               <span>★</span>
               <span>★</span>
               <span>★</span>
               <span>★</span>
            </div>
         </div>

      </div>
   );
});

export default ReceiptPrintLayout;
