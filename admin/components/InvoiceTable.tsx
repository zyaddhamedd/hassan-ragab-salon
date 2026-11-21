import React, { useMemo, useState } from 'react';
import { Invoice } from '../types';
import {
  Clock,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Banknote,
  CreditCard,
  Smartphone,
  Tag,
  Eye,
  User
} from 'lucide-react';
import { formatDate, formatTime } from '../utils/dateFormatter';

export interface InvoiceTableStaffEntry {
  photoUrl?: string;
  name: string;
}

interface InvoiceTableProps {
  invoices: Invoice[];
  isDarkMode: boolean;
  onRowClick?: (invoice: Invoice, event?: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => void;
  staffMap?: Record<number, InvoiceTableStaffEntry>;
}

const isDraftFamily = (invoice: Invoice) => (
  invoice.status_code === 'DRAFT'
  || invoice.status_code === 'DRAFT_COMMITTED'
  || (!invoice.status_code && (invoice.status === 'معلقة' || invoice.status === 'مسودة غير مكتملة'))
);

export const getInvoiceBadgeLabel = (invoice: Invoice) => {
  if (invoice.draft_state === 'EMPTIED_DRAFT') return 'مفرغة';
  if (invoice.status_code === 'DRAFT') return 'مسودة';
  if (invoice.status_code === 'DRAFT_COMMITTED') return 'معلقة';
  return invoice.type;
};

// Deterministic initial letter(s)
const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.trim().charAt(0) || 'ح';
};

// Deterministic subtle avatar background hue for fallbacks
const getAvatarHue = (name: string, isDarkMode: boolean): string => {
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

interface BarberItem {
  id?: number;
  name: string;
}

const BarberAvatar: React.FC<{
  barber: BarberItem;
  staffMap?: Record<number, InvoiceTableStaffEntry>;
  size?: number;
  isDarkMode: boolean;
}> = ({ barber, staffMap, size = 24, isDarkMode }) => {
  const [imgError, setImgError] = useState(false);
  const employeeInfo = barber.id != null ? staffMap?.[barber.id] : undefined;
  const photoUrl = !imgError && employeeInfo?.photoUrl ? employeeInfo.photoUrl : undefined;
  const displayName = barber.name || employeeInfo?.name || 'مصفف';
  const colorClass = getAvatarHue(displayName, isDarkMode);

  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full overflow-hidden border shrink-0 transition-transform hover:scale-105 ${colorClass}`}
      style={{ width: `${size}px`, height: `${size}px` }}
      title={displayName}
      aria-label={displayName}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={displayName}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="text-[9px] font-bold select-none leading-none">
          {getInitials(displayName)}
        </span>
      )}
    </div>
  );
};

const BarberGroup: React.FC<{
  invoice: Invoice;
  staffMap?: Record<number, InvoiceTableStaffEntry>;
  isDarkMode: boolean;
}> = ({ invoice, staffMap, isDarkMode }) => {
  const barbers: BarberItem[] = useMemo(() => {
    if (invoice.barbers && invoice.barbers.length > 0) {
      return invoice.barbers.map(b => ({ id: b.id, name: b.name }));
    }
    if (invoice.barber) {
      return [{ id: undefined, name: invoice.barber }];
    }
    return [{ id: undefined, name: invoice.cashier || 'كاشير' }];
  }, [invoice]);

  const allNames = barbers.map(b => b.name).join('، ');

  if (barbers.length === 1) {
    return (
      <div className="flex items-center gap-1.5 max-w-[125px] xl:max-w-[145px]" title={allNames}>
        <BarberAvatar barber={barbers[0]} staffMap={staffMap} size={22} isDarkMode={isDarkMode} />
        <span className={`text-xs font-semibold truncate ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          {barbers[0].name}
        </span>
      </div>
    );
  }

  // Multiple barbers: render stacked avatars + count badge
  const visibleBarbers = barbers.slice(0, 2);
  const extraCount = barbers.length - visibleBarbers.length;

  return (
    <div className="flex items-center gap-1.5 max-w-[135px] xl:max-w-[155px]" title={`طاقم الخدمة: ${allNames}`}>
      <div className="flex items-center -space-x-1.5 space-x-reverse shrink-0">
        {visibleBarbers.map((b, idx) => (
          <div key={b.id ?? idx} className={`rounded-full ring-1.5 ${isDarkMode ? 'ring-[#121212]' : 'ring-white'} z-[2]`}>
            <BarberAvatar barber={b} staffMap={staffMap} size={22} isDarkMode={isDarkMode} />
          </div>
        ))}
        {extraCount > 0 && (
          <div className={`w-[22px] h-[22px] rounded-full border flex items-center justify-center text-[9px] font-bold ring-1.5 ${
            isDarkMode
              ? 'bg-[#1E1E1E] border-white/10 text-gray-300 ring-[#121212]'
              : 'bg-gray-100 border-gray-300 text-gray-700 ring-white'
          } z-[3]`}>
            +{extraCount}
          </div>
        )}
      </div>
      <div className="flex flex-col min-w-0">
        <span className={`text-xs font-semibold truncate ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          {visibleBarbers[0].name}
        </span>
        <span className="text-[9px] text-gray-500 truncate">
          +{barbers.length - 1} آخرين
        </span>
      </div>
    </div>
  );
};

const InvoiceTable: React.FC<InvoiceTableProps> = ({ invoices, isDarkMode, onRowClick, staffMap }) => {
  const getHistoricalAmount = (invoice: Invoice) => (
    invoice.draft_state === 'EMPTIED_DRAFT'
    && invoice.last_gross_before_emptying != null
      ? invoice.last_gross_before_emptying
      : null
  );

  const getStatusBadge = (invoice: Invoice) => {
    const code = invoice.status_code || invoice.status;
    const label = getInvoiceBadgeLabel(invoice);

    if (invoice.draft_state === 'EMPTIED_DRAFT') {
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${
          isDarkMode
            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}>
          <AlertCircle size={10} className="text-amber-500 shrink-0" />
          <span>مفرغة</span>
        </span>
      );
    }

    if (code === 'PAID' || invoice.status === 'مدفوعة') {
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${
          isDarkMode
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
        }`}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
          <span>مدفوعة</span>
        </span>
      );
    }

    if (code === 'DRAFT' || invoice.status === 'معلقة') {
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${
          isDarkMode
            ? 'bg-gray-500/10 text-gray-300 border-gray-500/20'
            : 'bg-gray-100 text-gray-700 border-gray-200'
        }`}>
          <Clock size={10} className="text-gray-400 shrink-0" />
          <span>مسودة</span>
        </span>
      );
    }

    if (code === 'DRAFT_COMMITTED' || invoice.status === 'مسودة غير مكتملة') {
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${
          isDarkMode
            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}>
          <Clock size={10} className="text-amber-500 shrink-0" />
          <span>معلقة</span>
        </span>
      );
    }

    if (code === 'CANCELED' || invoice.status === 'ملغاة') {
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${
          isDarkMode
            ? 'bg-red-500/10 text-red-400 border-red-500/20'
            : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          <AlertCircle size={10} className="text-red-500 shrink-0" />
          <span>ملغاة</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border border-white/10 text-gray-400 whitespace-nowrap">
        {label}
      </span>
    );
  };

  const getPaymentBadge = (method: string) => {
    const m = (method || '').toUpperCase();
    if (m === 'CASH' || method === 'كاش') {
      return {
        label: 'كاش',
        icon: <Banknote size={11} className="shrink-0" />,
        cls: isDarkMode
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          : 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    }
    if (m === 'VISA' || method === 'فيزا') {
      return {
        label: 'فيزا',
        icon: <CreditCard size={11} className="shrink-0" />,
        cls: isDarkMode
          ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
          : 'bg-blue-50 text-blue-700 border-blue-200',
      };
    }
    if (m === 'INSTAPAY' || method === 'إنستا باي' || method === 'إنستاباي') {
      return {
        label: 'إنستاباي',
        icon: <Smartphone size={11} className="shrink-0" />,
        cls: isDarkMode
          ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
          : 'bg-purple-50 text-purple-700 border-purple-200',
      };
    }
    return {
      label: method || 'غير محدد',
      icon: null,
      cls: isDarkMode
        ? 'bg-gray-500/10 text-gray-400 border-gray-500/20'
        : 'bg-gray-100 text-gray-600 border-gray-200',
    };
  };

  return (
    <div className="space-y-4">
      {/* Desktop Ledger Table */}
      <div className={`hidden lg:block rounded-2xl border overflow-hidden transition-all ${
        isDarkMode
          ? 'bg-[#121212] border-white/5 shadow-2xl'
          : 'bg-white border-black/5 shadow-sm'
      }`}>
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse table-auto">
            <thead>
              <tr className={`border-b text-[10px] font-bold uppercase tracking-wider ${
                isDarkMode
                  ? 'bg-[#161616] border-white/5 text-gray-400'
                  : 'bg-gray-50 border-black/5 text-gray-500'
              }`}>
                <th className="px-3 py-2.5 text-right w-[115px]">المرجع / اليومية</th>
                <th className="px-3 py-2.5 text-right w-[95px]">التاريخ والوقت</th>
                <th className="px-3 py-2.5 text-right w-[145px] xl:w-[170px]">العميل</th>
                <th className="px-3 py-2.5 text-right w-[135px] xl:w-[150px]">طاقم الخدمة</th>
                <th className="px-2.5 py-2.5 text-right w-[85px]">الفرع</th>
                <th className="px-3 py-2.5 text-right w-[115px]">الحالة والنوع</th>
                <th className="px-2.5 py-2.5 text-right w-[85px]">الدفع</th>
                <th className="px-3 py-2.5 text-left w-[110px]">الإجمالي الصافي</th>
                <th className="px-2 py-2.5 text-center w-9">
                  <span className="sr-only">معاينة</span>
                </th>
              </tr>
            </thead>
            <tbody className={`divide-y text-xs transition-colors ${
              isDarkMode ? 'divide-white/[0.04]' : 'divide-black/[0.04]'
            }`}>
              {invoices.map((inv) => {
                const payBadge = getPaymentBadge(inv.method);
                const isPromo = Boolean(inv.promo?.code || inv.promo_code);
                const promoLabel = inv.promo?.code || inv.promo_code;
                const depositApplied = inv.deposit_settlement?.applied_amount || 0;

                return (
                  <tr
                    key={inv.id}
                    onClick={(e) => onRowClick?.(inv, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onRowClick?.(inv, e);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`عرض تفاصيل الفاتورة #${inv.number}`}
                    className={`group cursor-pointer transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E6D690] ${
                      isDarkMode
                        ? 'hover:bg-white/[0.03]'
                        : 'hover:bg-black/[0.02]'
                    } ${inv.type === 'بخصم' && isDarkMode ? 'bg-[#E6D690]/[0.012]' : ''}`}
                  >
                    {/* 1. Reference: Invoice Number & Daily Journal # */}
                    <td className="px-3 py-2.5 font-mono">
                      <div className="flex flex-col gap-0.5">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded font-mono text-xs font-bold w-fit transition-colors ${
                          isDarkMode
                            ? 'bg-white/5 text-gray-200 group-hover:text-[#E53935] group-hover:bg-[#E53935]/10'
                            : 'bg-gray-100 text-gray-800 group-hover:text-[#E53935] group-hover:bg-red-50'
                        }`}>
                          #{inv.number}
                        </span>
                        {inv.business_day_id ? (
                          <span
                            title={`رقم اليومية الخزينة: #${inv.business_day_id}`}
                            className="text-[10px] font-mono text-gray-400 dark:text-gray-500 truncate"
                          >
                            يومية #{inv.business_day_id}
                          </span>
                        ) : null}
                      </div>
                    </td>

                    {/* 2. Date & Time */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex flex-col font-mono leading-tight">
                        <span className={`text-xs font-semibold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {formatDate(inv.date)}
                        </span>
                        <span className="text-[10px] text-gray-500 mt-0.5">
                          {formatTime(inv.date)}
                        </span>
                      </div>
                    </td>

                    {/* 3. Client & Deposit Indicator */}
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-0.5 min-w-0 max-w-[145px] xl:max-w-[170px]" title={inv.client || 'عميل'}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                            isDarkMode ? 'bg-white/5 text-gray-400' : 'bg-gray-100 text-gray-500'
                          }`}>
                            <User size={11} />
                          </div>
                          <span className={`text-xs font-bold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {inv.client}
                          </span>
                        </div>
                        {depositApplied > 0 && (
                          <div
                            title={`تم تطبيق عربون بقيمة ${depositApplied.toLocaleString()} ج.م من الحجز المسبق`}
                            className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 w-fit shrink-0 mt-0.5"
                          >
                            <span>عربون: {depositApplied.toLocaleString()} ج.م</span>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* 4. Barber / Staff with compact avatars */}
                    <td className="px-3 py-2.5">
                      <BarberGroup invoice={inv} staffMap={staffMap} isDarkMode={isDarkMode} />
                    </td>

                    {/* 5. Branch */}
                    <td className="px-2.5 py-2.5 whitespace-nowrap">
                      <span
                        title={inv.branch}
                        className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border max-w-[85px] truncate block ${
                          isDarkMode
                            ? 'bg-white/[0.02] border-white/5 text-gray-400'
                            : 'bg-gray-50 border-gray-200 text-gray-600'
                        }`}
                      >
                        {inv.branch.replace('فرع ', '')}
                      </span>
                    </td>

                    {/* 6. Status & Promo */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {getStatusBadge(inv)}
                        {isPromo && (
                          <span
                            title={`كود الخصم: ${promoLabel}`}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-[#E53935]/10 border border-[#E53935]/20 text-[#E53935]"
                          >
                            <Tag size={9} />
                            <span className="max-w-[55px] truncate">{promoLabel}</span>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 7. Payment Method */}
                    <td className="px-2.5 py-2.5 whitespace-nowrap">
                      <div
                        title={`طريقة الدفع: ${payBadge.label}`}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold ${payBadge.cls}`}
                      >
                        {payBadge.icon}
                        <span>{payBadge.label}</span>
                      </div>
                    </td>

                    {/* 8. Net Total Amount (Left-aligned for financial readability) */}
                    <td className="px-3 py-2.5 text-left whitespace-nowrap font-mono">
                      {inv.draft_state === 'EMPTIED_DRAFT' ? (
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="text-xs font-bold text-gray-400">
                            {inv.amount.toLocaleString()} <span className="text-[10px] font-normal opacity-70">ج.م</span>
                          </span>
                          {getHistoricalAmount(inv) != null && (
                            <span
                              title={`آخر قيمة قبل التفريغ: ${getHistoricalAmount(inv)!.toLocaleString()} ج.م`}
                              className="text-[9px] font-medium text-amber-500 whitespace-nowrap truncate max-w-[110px]"
                            >
                              قبل التفريغ: {getHistoricalAmount(inv)!.toLocaleString()}
                            </span>
                          )}
                        </div>
                      ) : inv.discountAmount && inv.discountAmount > 0 ? (
                        <div className="flex flex-col items-start leading-tight">
                          <span className="text-xs font-bold text-[#E6D690]">
                            {(inv.amount - inv.discountAmount).toLocaleString()} <span className="text-[10px] font-normal opacity-70">ج.م</span>
                          </span>
                          <span className="text-[10px] text-gray-500 line-through">
                            {inv.amount.toLocaleString()}
                          </span>
                        </div>
                      ) : (
                        <span className={`text-xs font-bold ${
                          isDraftFamily(inv)
                            ? 'text-gray-400'
                            : isDarkMode ? 'text-gray-100' : 'text-gray-900'
                        }`}>
                          {inv.amount.toLocaleString()} <span className="text-[10px] font-normal opacity-70">ج.م</span>
                        </span>
                      )}
                    </td>

                    {/* 9. Action / Preview */}
                    <td className="px-2 py-2.5 text-center whitespace-nowrap w-9">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRowClick?.(inv, e);
                        }}
                        aria-label="معاينة تفاصيل الفاتورة"
                        className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                          isDarkMode
                            ? 'border-white/5 text-gray-500 group-hover:text-white group-hover:border-white/20 group-hover:bg-white/5'
                            : 'border-black/5 text-gray-400 group-hover:text-gray-900 group-hover:bg-gray-100'
                        }`}
                      >
                        <Eye size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card Presentation (< lg) */}
      <div className="lg:hidden space-y-2.5">
        {invoices.map((inv) => {
          const payBadge = getPaymentBadge(inv.method);
          const isPromo = Boolean(inv.promo?.code || inv.promo_code);
          const promoLabel = inv.promo?.code || inv.promo_code;
          const depositApplied = inv.deposit_settlement?.applied_amount || 0;

          return (
            <div
              key={inv.id}
              onClick={(e) => onRowClick?.(inv, e)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRowClick?.(inv, e);
                }
              }}
              tabIndex={0}
              role="button"
              aria-label={`عرض تفاصيل الفاتورة #${inv.number}`}
              className={`p-3.5 rounded-xl border transition-all active:scale-[0.99] cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E6D690] ${
                isDarkMode
                  ? 'bg-[#121212] border-white/5 hover:border-white/10 shadow-lg'
                  : 'bg-white border-black/5 hover:border-black/10 shadow-sm'
              }`}
            >
              {/* Card Top Row: Invoice # + Badges */}
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/[0.05]">
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded-md ${
                    isDarkMode ? 'bg-white/5 text-white' : 'bg-gray-100 text-gray-900'
                  }`}>
                    #{inv.number}
                  </span>
                  {inv.business_day_id && (
                    <span className="text-[10px] font-mono text-gray-400 px-1.5 py-0.5 rounded bg-white/[0.03]">
                      يومية: #{inv.business_day_id}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {isPromo && (
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-[#E53935]/10 text-[#E53935] border border-[#E53935]/20">
                      {promoLabel}
                    </span>
                  )}
                  {getStatusBadge(inv)}
                </div>
              </div>

              {/* Card Middle: Client & Barber + Deposit Indicator */}
              <div className="flex items-center justify-between gap-3 py-2">
                <div className="flex flex-col min-w-0">
                  <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">العميل</span>
                  <span className={`text-xs font-bold truncate mt-0.5 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {inv.client}
                  </span>
                  {depositApplied > 0 && (
                    <span className="text-[9px] font-bold text-emerald-400 mt-0.5 block">
                      عربون مطبق: {depositApplied.toLocaleString()} ج.م
                    </span>
                  )}
                </div>

                <div className="flex flex-col items-end shrink-0">
                  <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-1">طاقم الخدمة</span>
                  <BarberGroup invoice={inv} staffMap={staffMap} isDarkMode={isDarkMode} />
                </div>
              </div>

              {/* Card Bottom: Date, Branch, Payment, Amount */}
              <div className="flex items-center justify-between pt-2 border-t border-white/[0.05] text-[10px]">
                <div className="flex items-center gap-2 text-gray-400">
                  <span className="font-mono font-medium">{formatDate(inv.date)}</span>
                  <span>•</span>
                  <span className="px-1.5 py-0.5 rounded bg-white/[0.03] text-gray-300">
                    {inv.branch.replace('فرع ', '')}
                  </span>
                  <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${payBadge.cls}`}>
                    {payBadge.icon}
                    <span>{payBadge.label}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 font-mono">
                  {inv.draft_state === 'EMPTIED_DRAFT' ? (
                    <div className="flex flex-col items-end">
                      <span className="text-xs font-bold text-gray-400">
                        {inv.amount.toLocaleString()} ج.م
                      </span>
                      {getHistoricalAmount(inv) != null && (
                        <span className="text-[9px] font-medium text-amber-500 whitespace-nowrap">
                          آخر قيمة: {getHistoricalAmount(inv)!.toLocaleString()}
                        </span>
                      )}
                    </div>
                  ) : inv.discountAmount && inv.discountAmount > 0 ? (
                    <div className="flex flex-col items-end">
                      <span className="text-xs font-bold text-[#E6D690]">
                        {(inv.amount - inv.discountAmount).toLocaleString()} ج.م
                      </span>
                      <span className="text-[9px] text-gray-500 line-through">
                        {inv.amount.toLocaleString()}
                      </span>
                    </div>
                  ) : (
                    <span className={`text-xs font-bold ${
                      isDraftFamily(inv) ? 'text-gray-400' : isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>
                      {inv.amount.toLocaleString()} ج.م
                    </span>
                  )}
                  <ChevronLeft size={13} className="text-gray-500" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default InvoiceTable;
