import React from 'react';
import { Landmark, Printer, Wallet, CreditCard, X } from 'lucide-react';

import type { AppointmentDepositTransactionReceipt } from '../App';
import logo from '../src/assets/llooggo.svg';
import { formatDate, formatTime } from '../src/utils/dateFormatter';


interface AppointmentDepositReceiptProps {
  receipt: AppointmentDepositTransactionReceipt;
  onClose: () => void;
}


const PaymentIcon = ({ method }: { method: AppointmentDepositTransactionReceipt['payment_method'] }) => {
  switch (method) {
    case 'CASH':
      return <Wallet size={12} />;
    case 'VISA':
      return <CreditCard size={12} />;
    case 'INSTAPAY':
      return <Landmark size={12} />;
  }
};


const InfoRow = ({ label, value }: { label: string; value?: string | number | null }) => (
  <div className="flex items-center justify-between gap-4 border-b border-dashed border-black/10 pb-2">
    <span className="text-[11px] text-black/60">{label}</span>
    <span className="text-[11px] font-black text-black text-left">{value || '---'}</span>
  </div>
);


const AppointmentDepositReceipt: React.FC<AppointmentDepositReceiptProps> = ({ receipt, onClose }) => {
  const handlePrint = () => {
    setTimeout(() => window.print(), 250);
  };

  const createdDate = formatDate(receipt.created_at, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }, 'ar-EG');
  const createdTime = formatTime(receipt.created_at, {
    hour: '2-digit',
    minute: '2-digit',
  }, 'ar-EG');

  return (
    <>
      <div className="no-print fixed inset-0 z-[110] flex items-center justify-center bg-black/95 backdrop-blur-xl p-4 font-['Cairo']">
        <div className="w-full max-w-[340px]">
          <div className="mb-3 flex items-center justify-between">
            <button onClick={onClose} className="rounded-full bg-white/10 p-2 text-white hover:bg-red-600">
              <X size={16} />
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 rounded-full bg-[#E6D690] px-4 py-2 text-xs font-black text-black"
            >
              <Printer size={14} />
              طباعة
            </button>
          </div>

          <div className="rounded-2xl bg-white px-5 py-4 text-[#121212]" dir="rtl">
            <ReceiptContent receipt={receipt} createdDate={createdDate} createdTime={createdTime} />
          </div>
        </div>
      </div>

      <div id="appointment-deposit-print" className="deposit-print hidden bg-white text-black font-['Cairo']" dir="rtl">
        <div className="mx-auto w-[80mm] px-[6mm] py-[4mm]">
          <ReceiptContent receipt={receipt} createdDate={createdDate} createdTime={createdTime} />
        </div>
      </div>

      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #appointment-deposit-print,
          #appointment-deposit-print * {
            visibility: visible !important;
          }
          #appointment-deposit-print {
            display: block !important;
            position: absolute;
            inset: 0;
            background: white;
          }
          .no-print {
            display: none !important;
          }
          @page {
            margin: 0;
          }
        }
      `}</style>
    </>
  );
};


const ReceiptContent = ({
  receipt,
  createdDate,
  createdTime,
}: {
  receipt: AppointmentDepositTransactionReceipt;
  createdDate: string;
  createdTime: string;
}) => (
  <div className="space-y-3">
    <div className="flex flex-col items-center">
      <img src={logo} alt="logo" className="mb-2 w-24" />
      <div className="text-[15px] font-black">إيصال عربون حجز</div>
      <div className="mt-1 text-[11px] font-bold text-black/70">#{receipt.receipt_number}</div>
    </div>

    <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2 text-center">
      <div className="text-[10px] text-black/50">المبلغ المحصل</div>
      <div className="mt-1 text-[22px] font-black">{receipt.amount} ج.م</div>
      <div className="mt-1 flex items-center justify-center gap-1 text-[11px] font-bold">
        <PaymentIcon method={receipt.payment_method} />
        <span>{receipt.payment_method_label}</span>
      </div>
    </div>

    <div className="space-y-2">
      <InfoRow label="العميل" value={receipt.customer_name} />
      <InfoRow label="الهاتف" value={receipt.customer_phone} />
      <InfoRow label="الفرع" value={receipt.branch_name} />
      <InfoRow label="الخدمة" value={receipt.service_name || 'غير محدد'} />
      <InfoRow label="الحلاق" value={receipt.barber_name || 'غير محدد'} />
      <InfoRow label="تاريخ الموعد" value={receipt.appointment_date || '---'} />
      <InfoRow label="وقت الموعد" value={receipt.appointment_time || '---'} />
      <InfoRow label="الكاشير" value={receipt.cashier_name} />
      <InfoRow label="تاريخ التحصيل" value={createdDate} />
      <InfoRow label="وقت التحصيل" value={createdTime} />
      <InfoRow label="رقم اليومية" value={receipt.business_day_id} />
    </div>

    <div className="border-t border-dashed border-black/20 pt-2 text-center text-[10px] text-black/60">
      <div>المعاملة محفوظة ماليًا برقم {receipt.receipt_number}</div>
      <div className="mt-1">{createdDate} - {createdTime}</div>
    </div>
  </div>
);


export default AppointmentDepositReceipt;
