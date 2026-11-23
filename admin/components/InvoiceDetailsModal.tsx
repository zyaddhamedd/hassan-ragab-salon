import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  User,
  MapPin,
  Clock,
  Scissors,
  UserCheck,
  Printer,
  ShieldAlert,
  CreditCard,
  Receipt,
  Trash2,
  History,
  Calendar,
  ShoppingBag,
  AlertCircle,
  FileClock,
  CheckCircle2,
  ChevronDown,
  Percent,
  TrendingUp,
  Wallet
} from 'lucide-react';
import { Invoice, InvoiceItem, InvoiceParticipant, Service } from '../types';
import InvoiceActivityTimeline from './InvoiceActivityTimeline.tsx';
import { AuthenticReceiptViewer } from './invoices/AuthenticReceiptViewer.tsx';
import { InvoiceTableStaffEntry } from './InvoiceTable.tsx';
import adminApi from '../api/client';
import { formatDateTime } from '../utils/dateFormatter';

export interface InvoiceDetailsModalProps {
  invoice: Invoice;
  isDarkMode: boolean;
  onClose: () => void;
  viewMode?: 'modal' | 'full';
  staffMap?: Record<number, InvoiceTableStaffEntry>;
}

// Deterministic initial letter(s)
const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.trim().charAt(0) || 'ح';
};

// Deterministic avatar hue for staff fallback
const getStaffAvatarHue = (name: string, isDarkMode: boolean): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const huesDark = [
    'bg-[#E53935]/15 text-[#FF6B6B] border-[#E53935]/30',
    'bg-[#E6D690]/15 text-[#E6D690] border-[#E6D690]/30',
    'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    'bg-blue-500/15 text-blue-400 border-blue-500/30',
    'bg-purple-500/15 text-purple-400 border-purple-500/30',
    'bg-amber-500/15 text-amber-400 border-amber-500/30',
  ];
  const huesLight = [
    'bg-red-50 text-red-600 border-red-200',
    'bg-amber-50 text-amber-700 border-amber-200',
    'bg-emerald-50 text-emerald-700 border-emerald-200',
    'bg-blue-50 text-blue-700 border-blue-200',
    'bg-purple-50 text-purple-700 border-purple-200',
    'bg-orange-50 text-orange-700 border-orange-200',
  ];
  const palette = isDarkMode ? huesDark : huesLight;
  return palette[Math.abs(hash) % palette.length];
};

const StaffMicroAvatar: React.FC<{
  name: string;
  photoUrl?: string;
  isDarkMode: boolean;
}> = ({ name, photoUrl, isDarkMode }) => {
  const [imgError, setImgError] = useState(false);
  const colorClass = getStaffAvatarHue(name, isDarkMode);

  if (photoUrl && !imgError) {
    return (
      <img
        src={photoUrl}
        alt={name}
        onError={() => setImgError(true)}
        className="w-5 h-5 rounded-full object-cover border border-white/20 shrink-0 inline-block"
      />
    );
  }

  return (
    <span
      className={`w-5 h-5 rounded-full border flex items-center justify-center text-[9px] font-bold shrink-0 inline-flex ${colorClass}`}
    >
      {getInitials(name)}
    </span>
  );
};

const InvoiceDetailsModal: React.FC<InvoiceDetailsModalProps> = ({
  invoice,
  isDarkMode,
  onClose,
  viewMode = 'modal',
  staffMap = {}
}) => {
  const [currentInvoice, setCurrentInvoice] = useState<Invoice | null>(invoice);
  const [services, setServices] = useState<Service[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mobilePane, setMobilePane] = useState<'details' | 'receipt'>('details');

  // Fetch full details and services
  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [servicesRes, detailRes] = await Promise.all([
          adminApi.get('/services'),
          (!invoice.items || invoice.items.length === 0)
            ? adminApi.get(`/invoices/${invoice.id}`)
            : Promise.resolve({ data: invoice })
        ]);

        if (isMounted) {
          setServices(servicesRes.data);
          setCurrentInvoice(detailRes.data);
        }
      } catch (err) {
        console.error("Failed to fetch invoice details:", err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    fetchData();

    return () => {
      isMounted = false;
    };
  }, [invoice.id]);

  // Delete handler with safe broadcast
  const handleDelete = async () => {
    if (!currentInvoice) return;

    const confirmMsg = "هل أنت متأكد من حذف هذه الفاتورة نهائياً؟ لا يمكن التراجع عن هذا الإجراء.";
    if (!window.confirm(confirmMsg)) return;

    try {
      await adminApi.delete(`/invoices/${currentInvoice.id}`);
      alert("تم حذف الفاتورة بنجاح");

      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const channel = new BroadcastChannel('salon_data_sync');
        channel.postMessage({ type: 'REFETCH_DATA' });
        channel.close();
      }

      onClose();
    } catch (err: any) {
      console.error("Failed to delete invoice:", err);
      alert(err.response?.data?.error || "فشل في حذف الفاتورة");
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (!currentInvoice) return null;

  // Invoice state classification
  const isAuditOnly = currentInvoice.status === 'مسودة غير مكتملة' || currentInvoice.status_code === 'DRAFT_COMMITTED';
  const isEmptiedDraft = currentInvoice.draft_state === 'EMPTIED_DRAFT';
  const isPaid = currentInvoice.status === 'مدفوعة' || currentInvoice.status_code === 'PAID';
  const isDraft = !isPaid && !isEmptiedDraft;

  const serviceItems = (currentInvoice.items || []).filter(item => item.item_type !== 'PRODUCT_ITEM');
  const productItems = (currentInvoice.items || []).filter(item => item.item_type === 'PRODUCT_ITEM');

  const getPaymentLabel = (method: string) => {
    const m = (method || '').toUpperCase();
    if (m === 'نقدي' || m === 'CASH') return 'كاش';
    if (m === 'VISA_1') return 'فيزا 1';
    if (m === 'VISA_2') return 'فيزا 2';
    if (m === 'بطاقة مدى' || m === 'فيزا' || m === 'VISA') return 'فيزا';
    if (m === 'INSTAPAY' || method === 'InstaPay' || method === 'إنستا باي' || method === 'إنستاباي') return 'إنستاباي';
    if (m.startsWith('VISA_')) return `فيزا ${m.replace('VISA_', '')}`;
    return method || 'كاش';
  };

  // Only calculate commissions for PAID invoices
  const totalEmployeeEarnings = useMemo(() => {
    if (isAuditOnly || !isPaid) return 0;
    return serviceItems.reduce((acc, item) => {
      if (item.participants && item.participants.length > 0) {
        return acc + (item.participants || []).reduce((pAcc, p) => pAcc + (p.isPayable ? (p.share || 0) : 0), 0);
      }
      return acc + (item.share || 0);
    }, 0);
  }, [isAuditOnly, isPaid, serviceItems]);

  const grossAmount = Number(currentInvoice.amount || 0);
  const discountAmount = Number(currentInvoice.discountAmount || 0);
  const netCollected = Math.max(0, grossAmount - discountAmount);
  const salonNetMargin = isPaid ? Math.max(0, grossAmount - totalEmployeeEarnings - discountAmount) : 0;
  const depositApplied = Number(currentInvoice.deposit_settlement?.applied_amount || 0);
  const newCollection = Number(currentInvoice.deposit_settlement?.new_collection_amount || 0);

  // Shell content
  const workspaceBody = (
    <div
      className={`relative w-full h-full flex flex-col overflow-hidden ${
        viewMode === 'full'
          ? `rounded-none border-0 ${isDarkMode ? 'bg-[#0B0B0B]' : 'bg-[#F7F7F7]'}`
          : `max-h-[96vh] max-w-[96vw] rounded-2xl border ${isDarkMode ? 'bg-[#0F0F0F] border-white/10 shadow-2xl' : 'bg-white border-black/10 shadow-2xl'}`
      }`}
    >
      {/* 1) COMPACT REFINED HEADER BAR */}
      <header
        className={`h-14 sm:h-16 shrink-0 px-4 sm:px-6 border-b flex items-center justify-between gap-3 z-20 select-none ${
          isDarkMode ? 'bg-[#111111] border-white/[0.08] text-white' : 'bg-white border-gray-200 text-gray-900'
        }`}
      >
        {/* Left Info: Invoice #, Status, Day #, Branch, Timestamp */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded-lg font-mono text-xs font-black tracking-wider border ${
                isDarkMode
                  ? 'bg-white/5 border-white/10 text-white'
                  : 'bg-gray-100 border-gray-200 text-gray-900'
              }`}
            >
              #{currentInvoice.number || '---'}
            </span>

            {/* Status Pill */}
            <span
              className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold flex items-center gap-1.5 ${
                isPaid
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : isAuditOnly
                  ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                  : isEmptiedDraft
                  ? 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isPaid ? 'bg-emerald-400' : isDraft ? 'bg-amber-400' : 'bg-gray-400'
                }`}
              />
              {currentInvoice.status || (isPaid ? 'مدفوعة' : 'مسودة')}
            </span>

            {/* Business Day # if present */}
            {currentInvoice.business_day_id && (
              <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-gray-400 bg-white/5 border border-white/5">
                <Calendar size={10} />
                يومية #{currentInvoice.business_day_id}
              </span>
            )}
          </div>

          <div className="hidden xl:flex items-center gap-3 text-xs text-gray-400 mr-2 border-r border-white/10 pr-3">
            <span className="flex items-center gap-1 font-medium">
              <MapPin size={12} className="text-[#E53935]" />
              {currentInvoice.branch || invoice.branch || 'الفرع الرئيسي'}
            </span>
            <span className="w-1 h-1 rounded-full bg-gray-600"></span>
            <span className="flex items-center gap-1 font-mono text-[11px]">
              <Clock size={12} className="text-gray-500" />
              {formatDateTime(currentInvoice.date)}
            </span>
          </div>
        </div>

        {/* Center: Mobile Segmented Switch (< lg) */}
        <div className="flex lg:hidden items-center p-0.5 rounded-xl border border-white/10 bg-black/40 text-xs">
          <button
            type="button"
            onClick={() => setMobilePane('details')}
            className={`px-3 py-1 rounded-lg font-bold transition-all ${
              mobilePane === 'details'
                ? isDarkMode ? 'bg-white/10 text-white shadow' : 'bg-white text-black shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            تفاصيل الفاتورة
          </button>
          <button
            type="button"
            onClick={() => setMobilePane('receipt')}
            className={`px-3 py-1 rounded-lg font-bold transition-all ${
              mobilePane === 'receipt'
                ? isDarkMode ? 'bg-white/10 text-white shadow' : 'bg-white text-black shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            الإيصال الحراري
          </button>
        </div>

        {/* Right Actions: Print, Delete, Close */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={handlePrint}
            title="طباعة المستند"
            className={`h-9 px-3 sm:px-3.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all border ${
              isDarkMode
                ? 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10 hover:text-white'
                : 'bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Printer size={14} />
            <span className="hidden sm:inline">طباعة</span>
          </button>

          <button
            type="button"
            onClick={handleDelete}
            title="حذف الفاتورة"
            className={`h-9 w-9 rounded-xl flex items-center justify-center transition-all ${
              isDarkMode
                ? 'hover:bg-red-500/10 text-gray-400 hover:text-red-400'
                : 'hover:bg-red-500/5 text-gray-400 hover:text-red-600'
            }`}
          >
            <Trash2 size={16} />
          </button>

          <button
            type="button"
            onClick={onClose}
            title="إغلاق"
            className={`h-9 w-9 rounded-xl flex items-center justify-center transition-all ${
              isDarkMode
                ? 'hover:bg-white/10 text-gray-400 hover:text-white'
                : 'hover:bg-black/5 text-gray-400 hover:text-gray-900'
            }`}
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* 2) MAIN WORKSPACE SPLIT: PHYSICAL RIGHT (ADMIN) + PHYSICAL LEFT (RECEIPT) */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">

        {/* ========================================================================= */}
        {/* PHYSICAL RIGHT PANE (Child 1 in RTL DOM -> Lands on physical RIGHT)       */}
        {/* ========================================================================= */}
        <div
          className={`flex-1 min-w-0 overflow-y-auto custom-scrollbar p-4 sm:p-6 lg:p-8 space-y-6 overscroll-contain ${
            mobilePane === 'receipt' ? 'hidden lg:block' : 'block'
          }`}
        >
          {/* A) DRAFT NOTIFICATION BANNERS */}
          {isAuditOnly && (
            <div className="p-3.5 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-3">
              <ShieldAlert size={18} className="text-yellow-500 shrink-0" />
              <div className="text-xs">
                <span className={`font-bold ${isDarkMode ? 'text-yellow-400' : 'text-yellow-800'}`}>
                  فاتورة مسودة غير مكتملة – للمراجعة فقط
                </span>
                <p className={`mt-0.5 text-[11px] ${isDarkMode ? 'text-yellow-500/70' : 'text-yellow-700/80'}`}>
                  لم يتم تحصيل المبلغ، ولا يتم احتساب عمولات للموظفين أو التأثير على إيرادات الصالون.
                </p>
              </div>
            </div>
          )}

          {isEmptiedDraft && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
              <History size={18} className="text-amber-500 shrink-0" />
              <div className="text-xs">
                <span className={`font-bold ${isDarkMode ? 'text-amber-400' : 'text-amber-800'}`}>
                  تم حذف جميع عناصر هذه المسودة بعد إضافتها.
                </span>
                {currentInvoice.last_gross_before_emptying != null && (
                  <p className={`mt-0.5 text-[11px] font-mono ${isDarkMode ? 'text-amber-500/80' : 'text-amber-700/80'}`}>
                    آخر قيمة إجمالية قبل التفريغ: {currentInvoice.last_gross_before_emptying.toLocaleString()} ج.م
                  </p>
                )}
              </div>
            </div>
          )}

          {/* B) REFINED FINANCIAL PRESENTATION (Linear/Apple Hierarchical Ledger) */}
          <section
            aria-label="الملخص المالي التنفيذي"
            className={`rounded-2xl border p-5 sm:p-6 space-y-5 ${
              isDarkMode
                ? 'bg-[#121212]/90 border-white/[0.08] shadow-lg'
                : 'bg-white border-gray-200 shadow-sm'
            }`}
          >
            {/* Top Anchor: Dominant Financial Figure with Semantics */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isPaid
                        ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]'
                        : isEmptiedDraft
                        ? 'bg-gray-400'
                        : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                    }`}
                  />
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
                    {isPaid
                      ? 'الصافي النهائي المحصل'
                      : isEmptiedDraft
                      ? 'مسودة مفرغة (0 ج.م)'
                      : 'القيمة التقديرية للمسودة (بانتظار الدفع)'}
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl sm:text-4xl font-black font-mono tracking-tight ${
                    isPaid ? 'text-white' : isEmptiedDraft ? 'text-gray-400' : 'text-amber-300'
                  }`}>
                    {isEmptiedDraft ? '0' : netCollected.toLocaleString()}
                  </span>
                  <span className="text-sm font-bold text-gray-400">ج.م</span>
                </div>

                {/* Subtext clarifying deposit settlement or payment */}
                <div className="mt-2 text-xs text-gray-400 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {isPaid ? (
                    <>
                      <span className="flex items-center gap-1 text-emerald-400 font-medium">
                        <CheckCircle2 size={12} />
                        تم التحصيل الكامل
                      </span>
                      <span>•</span>
                      {currentInvoice.payments && currentInvoice.payments.length > 1 ? (
                        <span>طرق الدفع: <strong className="text-gray-200">{currentInvoice.payments.map(p => `${getPaymentLabel(p.method)}: ${p.amount} ج`).join(' + ')}</strong></span>
                      ) : (
                        <span>طريقة الدفع: <strong className="text-gray-200">{getPaymentLabel(currentInvoice.payments?.[0]?.method || currentInvoice.method)}</strong></span>
                      )}
                      {depositApplied > 0 && (
                        <>
                          <span>•</span>
                          <span>(عربون مسدد سابقًا: <strong className="text-emerald-400 font-mono">{depositApplied} ج.م</strong> + تحصيل جديد: <strong className="text-white font-mono">{newCollection} ج.م</strong>)</span>
                        </>
                      )}
                    </>
                  ) : isEmptiedDraft ? (
                    <span className="text-gray-400">
                      تم تفريغ العناصر • آخر قيمة مسجلة: {currentInvoice.last_gross_before_emptying?.toLocaleString()} ج.م
                    </span>
                  ) : (
                    <span className="text-amber-400/90 font-medium">
                      بانتظار التأكيد والدفع عند الكاشير • لم تؤثر هذه القيمة على الإيرادات الفعلية
                    </span>
                  )}
                </div>
              </div>

              {/* Secondary Promo / Deposit Pills */}
              <div className="flex sm:flex-col items-start sm:items-end gap-2 shrink-0">
                {currentInvoice.promo && (
                  <div className="px-3 py-1.5 rounded-xl bg-[#E53935]/10 border border-[#E53935]/20 text-xs flex items-center gap-2">
                    <span className="font-mono font-black text-white px-1.5 py-0.5 rounded bg-[#E53935] text-[10px]">
                      {currentInvoice.promo.code}
                    </span>
                    <span className="text-[#FF6B6B] font-mono font-bold">
                      -{currentInvoice.promo.discount_amount.toLocaleString()} ج.م
                    </span>
                  </div>
                )}

                {depositApplied > 0 && (
                  <div className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs flex items-center gap-2">
                    <Wallet size={13} className="text-emerald-400 shrink-0" />
                    <span className="text-emerald-300 font-medium">
                      عربون: <strong className="font-mono">{depositApplied} ج.م</strong>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Row: 4 Balanced Secondary Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
              {/* 1. Gross */}
              <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-gray-50 border-gray-100'}`}>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                  الإجمالي الأولي
                </span>
                <span className="text-sm sm:text-base font-bold font-mono text-gray-200">
                  {grossAmount.toLocaleString()} <span className="text-xs text-gray-400 font-sans">ج.م</span>
                </span>
              </div>

              {/* 2. Discounts */}
              <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-gray-50 border-gray-100'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    الخصم
                  </span>
                  {currentInvoice.promo && (
                    <span className="text-[9px] font-mono text-gray-400">
                      ({currentInvoice.promo.discount_type === 'PERCENTAGE' ? `${currentInvoice.promo.configured_value}%` : `${currentInvoice.promo.configured_value} ج.م`})
                    </span>
                  )}
                </div>
                <span className={`text-sm sm:text-base font-bold font-mono ${discountAmount > 0 ? 'text-[#FF6B6B]' : 'text-gray-400'}`}>
                  {discountAmount > 0 ? `-${discountAmount.toLocaleString()}` : '0'}{' '}
                  <span className="text-xs text-gray-400 font-sans">ج.م</span>
                </span>
              </div>

              {/* 3. Staff Commissions */}
              <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-gray-50 border-gray-100'}`}>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                  عمولات الكادر
                </span>
                <span className={`text-sm sm:text-base font-bold font-mono ${isPaid ? 'text-amber-400' : 'text-gray-500'}`}>
                  {isPaid ? totalEmployeeEarnings.toLocaleString() : '0'}{' '}
                  <span className="text-xs text-gray-400 font-sans">ج.م</span>
                </span>
                <span className="text-[9px] text-gray-500 block mt-0.5">
                  {isPaid ? 'مستحقة للمحفظة' : 'معلقة حتى الدفع'}
                </span>
              </div>

              {/* 4. Salon Margin */}
              <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-gray-50 border-gray-100'}`}>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                  هامش الصالون
                </span>
                <span className={`text-sm sm:text-base font-bold font-mono ${isPaid ? 'text-[#E6D690]' : 'text-gray-500'}`}>
                  {isPaid ? salonNetMargin.toLocaleString() : '0'}{' '}
                  <span className="text-xs text-gray-400 font-sans">ج.م</span>
                </span>
                <span className="text-[9px] text-gray-500 block mt-0.5">
                  {isPaid ? 'بعد خصم العمولات' : 'قيمة تقديرية'}
                </span>
              </div>
            </div>
          </section>

          {/* C) CUSTOMER & OPERATIONAL METADATA BAR */}
          <div
            className={`p-4 rounded-xl border grid grid-cols-2 md:grid-cols-4 gap-4 ${
              isDarkMode ? 'bg-[#121212]/80 border-white/[0.06]' : 'bg-gray-50/70 border-gray-200'
            }`}
          >
            {/* Customer */}
            <div className="space-y-0.5">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">العميل</span>
              <div className="flex items-center gap-1.5">
                <User size={13} className="text-[#E6D690] shrink-0" />
                <span className={`text-xs font-bold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`} title={currentInvoice.client || currentInvoice.customer_name || 'عميل مفاجئ'}>
                  {currentInvoice.client || currentInvoice.customer_name || 'عميل مفاجئ'}
                </span>
              </div>
              {currentInvoice.customer_phone && (
                <span className="text-[10px] font-mono text-gray-400 block mr-4">
                  {currentInvoice.customer_phone}
                </span>
              )}
            </div>

            {/* Cashier */}
            <div className="space-y-0.5">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">الكاشير</span>
              <div className="flex items-center gap-1.5">
                <UserCheck size={13} className="text-gray-400 shrink-0" />
                <span className={`text-xs font-bold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  {currentInvoice.cashier || 'غير محدد'}
                </span>
              </div>
            </div>

            {/* Payment Method */}
            <div className="space-y-0.5">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">طريقة الدفع</span>
              {currentInvoice.payments && currentInvoice.payments.length > 1 ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <CreditCard size={13} className="text-emerald-400 shrink-0" />
                    <span className={`text-xs font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      دفع متعدد ({currentInvoice.payments.length})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 text-[11px]">
                    {currentInvoice.payments.map((p, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-gray-300">
                        <span>{getPaymentLabel(p.method)}:</span>
                        <span className="font-bold text-white">{p.amount} ج.م</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <CreditCard size={13} className="text-[#A8906A] shrink-0" />
                  <span className={`text-xs font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {getPaymentLabel(currentInvoice.payments?.[0]?.method || currentInvoice.method)}
                  </span>
                </div>
              )}
            </div>

            {/* Branch & Time */}
            <div className="space-y-0.5">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">الفرع والتوقيت</span>
              <div className="text-xs font-bold truncate text-gray-300">
                {currentInvoice.branch || invoice.branch}
              </div>
              <span className="text-[10px] font-mono text-gray-400 block">
                {formatDateTime(currentInvoice.date)}
              </span>
            </div>

            {/* Preserved Codex Deposit Settlement Banner */}
            {depositApplied > 0 && (
              <div className="col-span-2 md:col-span-4 pt-2.5 mt-1 border-t border-white/5 flex flex-wrap items-center gap-4 text-xs font-bold">
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <span className="text-gray-400 font-normal">عربون مدفوع سابقًا:</span>
                  <span className="font-mono">{depositApplied} ج.م</span>
                </div>
                <div className="flex items-center gap-1.5 text-white">
                  <span className="text-gray-400 font-normal">التحصيل الجديد:</span>
                  <span className="font-mono">{newCollection} ج.م</span>
                </div>
              </div>
            )}
          </div>

          {/* D) SERVICES & COMMISSIONS OPERATIONAL TABLE */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scissors size={15} className="text-[#E6D690]" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">
                  الخدمات والعمولات ({serviceItems.length})
                </h4>
              </div>
            </div>

            {/* Desktop Table View */}
            <div
              className={`hidden md:block rounded-xl border overflow-hidden ${
                isDarkMode ? 'bg-[#121212] border-white/[0.07]' : 'bg-white border-gray-200'
              }`}
            >
              <table className="w-full text-right text-xs">
                <thead>
                  <tr
                    className={`text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b ${
                      isDarkMode ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <th className="px-4 py-3">الخدمة</th>
                    <th className="px-4 py-3">السعر</th>
                    <th className="px-4 py-3">المصفف</th>
                    <th className="px-4 py-3">المساعد</th>
                    {!isAuditOnly && (
                      <>
                        <th className="px-4 py-3">عمولة المصفف</th>
                        <th className="px-4 py-3 text-left">عمولة المساعد</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDarkMode ? 'divide-white/[0.04]' : 'divide-gray-100'}`}>
                  {serviceItems.map(item => {
                    const displayServiceName = item.serviceName || 'خدمة';
                    const displayPrice = Number(item.price || 0);
                    const barberCommission = (displayPrice * (item.barber_commission_percent || 0)) / 100;
                    const assistantCommission = (displayPrice * (item.assistant_commission_percent || 0)) / 100;
                    const assistant = item.participants?.find(p => p.role === 'ASSISTANT');
                    const assistantName = assistant?.employeeName;

                    // Resolve barber avatar if staffMap has entry
                    const barberEmpId = item.employee_id || item.employeeId;
                    const barberPhoto = barberEmpId ? staffMap[barberEmpId]?.photoUrl : undefined;

                    return (
                      <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3.5 font-bold text-white">
                          {displayServiceName}
                        </td>
                        <td className="px-4 py-3.5 font-mono font-medium text-gray-300">
                          {displayPrice.toLocaleString()} ج.م
                        </td>
                        <td className="px-4 py-3.5 font-medium text-gray-200">
                          <div className="flex items-center gap-2">
                            <StaffMicroAvatar
                              name={item.employeeName || 'مصفف'}
                              photoUrl={barberPhoto}
                              isDarkMode={isDarkMode}
                            />
                            <span className="truncate max-w-[140px]" title={item.employeeName || '---'}>
                              {item.employeeName || '---'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          {assistantName ? (
                            <div className="flex items-center gap-2 text-gray-300">
                              <StaffMicroAvatar
                                name={assistantName}
                                isDarkMode={isDarkMode}
                              />
                              <span className="truncate max-w-[120px]" title={assistantName}>
                                {assistantName}
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </td>
                        {!isAuditOnly && (
                          <>
                            <td className="px-4 py-3.5 font-mono">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-white/5 text-amber-300 border border-white/5">
                                {item.barber_commission_percent}%
                                <span className="text-gray-400">({barberCommission.toLocaleString()} ج.م)</span>
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-left font-mono">
                              {item.assistant_commission_percent && item.assistant_commission_percent > 0 ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-white/5 text-gray-300 border border-white/5">
                                  {item.assistant_commission_percent}%
                                  <span className="text-gray-400">({assistantCommission.toLocaleString()} ج.م)</span>
                                </span>
                              ) : (
                                <span className="text-gray-500">—</span>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                  {serviceItems.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                        لا توجد خدمات مضافة
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="md:hidden space-y-3">
              {serviceItems.map(item => {
                const participants = item.participants || [];
                return (
                  <div
                    key={item.id}
                    className={`p-3.5 rounded-xl border ${
                      isDarkMode ? 'bg-[#141414] border-white/5' : 'bg-gray-50 border-gray-100'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-bold text-xs text-white">{item.serviceName}</span>
                      <span className="font-mono text-xs font-bold text-[#E6D690]">
                        {Number(item.price || 0).toLocaleString()} ج.م
                      </span>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-white/5 text-[11px]">
                      <div className="flex justify-between text-gray-400">
                        <span>المصفف:</span>
                        <span className="text-[#E6D690] font-medium">{item.employeeName || '---'}</span>
                      </div>
                      {participants.find(p => p.role === 'ASSISTANT') && (
                        <div className="flex justify-between text-gray-400">
                          <span>المساعد:</span>
                          <span className="text-gray-300 font-medium">
                            {participants.find(p => p.role === 'ASSISTANT')?.employeeName}
                          </span>
                        </div>
                      )}
                      {!isAuditOnly && (item.barber_commission_percent || 0) > 0 && (
                        <div className="flex justify-between text-gray-400">
                          <span>عمولة المصفف:</span>
                          <span className="font-mono text-amber-400">
                            {item.barber_commission_percent}%
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* D.2) PRODUCT ITEMS TABLE (if any products exist) */}
          {productItems.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <ShoppingBag size={15} className="text-[#E53935]" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">
                  مبيعات المنتجات ({productItems.length})
                </h4>
              </div>

              <div
                className={`rounded-xl border overflow-hidden ${
                  isDarkMode ? 'bg-[#121212] border-white/[0.07]' : 'bg-white border-gray-200'
                }`}
              >
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr
                      className={`text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b ${
                        isDarkMode ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <th className="px-4 py-3">المنتج</th>
                      <th className="px-4 py-3">الكمية</th>
                      <th className="px-4 py-3">السعر</th>
                      <th className="px-4 py-3">المسؤول</th>
                      <th className="px-4 py-3">نسبة العمولة</th>
                      <th className="px-4 py-3 text-left">قيمة العمولة</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkMode ? 'divide-white/[0.04]' : 'divide-gray-100'}`}>
                    {productItems.map(item => (
                      <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3.5 font-bold text-white">
                          {item.product_name || item.serviceName || 'منتج'}
                        </td>
                        <td className="px-4 py-3.5 font-mono">{item.quantity}</td>
                        <td className="px-4 py-3.5 font-mono font-medium text-gray-300">
                          {Number(item.price || 0).toLocaleString()} ج.م
                        </td>
                        <td className="px-4 py-3.5 text-gray-200">
                          <div className="flex items-center gap-2">
                            <StaffMicroAvatar
                              name={item.assigned_employee_name || item.employeeName || 'موظف'}
                              isDarkMode={isDarkMode}
                            />
                            <span>{item.assigned_employee_name || item.employeeName || '---'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-gray-300">
                          {item.sales_commission_percent || 0}%
                        </td>
                        <td className="px-4 py-3.5 text-left font-mono text-amber-400">
                          {(item.sales_commission_amount || 0).toLocaleString()} ج.م
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* E) EMBEDDED ACTIVITY TIMELINE AREA */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2">
              <History size={15} className="text-[#E6D690]" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">
                سجل النشاط والتدقيق
              </h4>
            </div>

            <div
              className={`rounded-xl border p-4 ${
                isDarkMode ? 'bg-[#121212] border-white/[0.07]' : 'bg-white border-gray-200'
              }`}
            >
              <InvoiceActivityTimeline
                invoiceId={currentInvoice.id}
                isDarkMode={isDarkMode}
              />
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* PHYSICAL LEFT PANE: AUTHENTIC RECEIPT RAIL (Child 2 in RTL DOM)          */}
        {/* ========================================================================= */}
        <aside
          className={`w-full lg:w-[350px] xl:w-[360px] shrink-0 border-t lg:border-t-0 lg:border-r ${
            isDarkMode ? 'border-white/[0.08] bg-[#0E0E0E]' : 'border-black/5 bg-gray-50/50'
          } overflow-y-auto custom-scrollbar p-4 sm:p-5 flex flex-col items-center overscroll-contain ${
            mobilePane === 'details' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="w-full flex items-center justify-between mb-4 pb-2 border-b border-white/[0.06] px-1">
            <div className="flex items-center gap-2">
              <Receipt size={14} className="text-[#E6D690]" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                الإيصال الحراري المعتمد
              </span>
            </div>
            <span className="text-[9px] font-mono font-bold text-gray-500">80mm POS</span>
          </div>

          <div className="w-full flex justify-center">
            <AuthenticReceiptViewer
              invoice={currentInvoice}
              isDarkMode={isDarkMode}
              showPrintButton={true}
            />
          </div>
        </aside>

      </div>
    </div>
  );

  if (viewMode === 'full') {
    return (
      <div className="w-full h-full" dir="rtl">
        {workspaceBody}
      </div>
    );
  }

  return (
    <div className="admin-overlay-shell z-[110] print:p-0" dir="rtl">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-xl print:hidden" onClick={onClose}></div>
      {workspaceBody}
    </div>
  );
};

export default InvoiceDetailsModal;
