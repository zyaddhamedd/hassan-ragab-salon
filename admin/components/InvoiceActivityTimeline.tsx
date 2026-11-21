import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  CircleMinus,
  CirclePlus,
  FileClock,
  FilePlus2,
  PencilLine,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import adminApi from '../api/client';
import type {
  InvoiceAuditEvent,
  InvoiceAuditItemSnapshot,
  InvoiceAuditTimelineResponse,
} from '../types';
import { formatDateTime } from '../utils/dateFormatter';
import { useVisiblePolling } from '../hooks/useVisiblePolling';

interface InvoiceActivityTimelineProps {
  invoiceId: string | number;
  isDarkMode: boolean;
}

interface InvoiceActivityTimelineContentProps {
  timeline: InvoiceAuditTimelineResponse;
  isDarkMode: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  MINI: 'Mini',
  ADMIN: 'Admin',
  SYSTEM: 'System',
};

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'كاش',
  VISA: 'فيزا',
  INSTAPAY: 'إنستا باي',
};

const TIMELINE_POLL_INTERVAL_MS = 7_500;

const eventIcon = (eventType: string) => {
  const iconProps = { size: 10, strokeWidth: 2.4 };
  switch (eventType) {
    case 'DRAFT_CREATED': return <FilePlus2 {...iconProps} />;
    case 'ITEM_ADDED': return <CirclePlus {...iconProps} />;
    case 'ITEM_UPDATED': return <PencilLine {...iconProps} />;
    case 'ITEM_REMOVED': return <CircleMinus {...iconProps} />;
    case 'DRAFT_COMMITTED': return <FileClock {...iconProps} />;
    case 'INVOICE_PAID': return <BadgeCheck {...iconProps} />;
    case 'INVOICE_DELETED': return <Trash2 {...iconProps} />;
    default: return <Activity {...iconProps} />;
  }
};

const eventTone = (eventType: string) => {
  switch (eventType) {
    case 'ITEM_ADDED': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    case 'ITEM_REMOVED':
    case 'INVOICE_DELETED': return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
    case 'INVOICE_PAID': return 'text-[#E6D690] bg-[#E6D690]/10 border-[#E6D690]/30';
    case 'ITEM_UPDATED': return 'text-sky-400 bg-sky-500/10 border-sky-500/30';
    case 'DRAFT_COMMITTED': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    default: return 'text-gray-400 bg-white/5 border-white/10';
  }
};

export const getAuditItemSnapshot = (event: InvoiceAuditEvent): InvoiceAuditItemSnapshot => {
  if (event.event_type === 'ITEM_UPDATED') return event.payload.after || event.payload.before || {};
  return event.payload || {};
};

export const getInvoiceAuditEventTitle = (event: InvoiceAuditEvent): string => {
  const item = getAuditItemSnapshot(event);
  const isProduct = item.item_type === 'PRODUCT_ITEM';
  switch (event.event_type) {
    case 'DRAFT_CREATED': return 'تم بدء الفاتورة';
    case 'ITEM_ADDED': return isProduct ? 'تمت إضافة منتج' : 'تمت إضافة خدمة';
    case 'ITEM_UPDATED': return 'تم تعديل عنصر';
    case 'ITEM_REMOVED': return isProduct ? 'تم حذف منتج' : 'تم حذف خدمة';
    case 'DRAFT_COMMITTED': return 'تم ترك الفاتورة وبدء فاتورة جديدة';
    case 'INVOICE_PAID': return 'تم إتمام ودفع الفاتورة';
    case 'INVOICE_DELETED': return 'تم حذف الفاتورة';
    default: return 'نشاط على الفاتورة';
  }
};

export const formatAuditMoney = (value?: string | null): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return `${amount.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
};

const GrossChange: React.FC<{ event: InvoiceAuditEvent; isDarkMode: boolean }> = ({ event, isDarkMode }) => {
  const before = formatAuditMoney(event.gross_before);
  const after = formatAuditMoney(event.gross_after);
  if (!before || !after || event.gross_before === event.gross_after) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-mono shrink-0 ${
        isDarkMode ? 'border border-white/10 bg-white/[0.04] text-gray-300' : 'border border-black/5 bg-gray-100 text-gray-700'
      }`}
      dir="ltr"
    >
      <span className="text-[10px] font-sans font-bold text-gray-500">الإجمالي:</span>
      <span>{before} → {after}</span>
    </span>
  );
};

const InlineEventSummary: React.FC<{ event: InvoiceAuditEvent; isDarkMode: boolean }> = ({ event, isDarkMode }) => {
  const item = getAuditItemSnapshot(event);
  const isProduct = item.item_type === 'PRODUCT_ITEM';

  if (event.event_type === 'ITEM_ADDED' || event.event_type === 'ITEM_UPDATED' || event.event_type === 'ITEM_REMOVED') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 min-w-0">
        <span className={`font-semibold text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          {item.catalog_name || (isProduct ? 'منتج غير متاح' : 'خدمة غير متاحة')}
        </span>
        {formatAuditMoney(item.line_total) ? (
          <span className="font-mono text-xs text-gray-400">({formatAuditMoney(item.line_total)})</span>
        ) : null}
        {item.quantity && item.quantity > 1 ? (
          <span className="font-mono text-xs text-gray-400">× {item.quantity}</span>
        ) : null}
      </span>
    );
  }

  if (event.event_type === 'DRAFT_CREATED') {
    return <span className="text-sm text-gray-400">تم إنشاء مسودة جديدة وجاهزة لإضافة العناصر.</span>;
  }

  if (event.event_type === 'DRAFT_COMMITTED') {
    return (
      <span className="text-sm text-gray-400">
        تم حفظ {event.payload.item_count ?? 0} عنصر بقيمة {formatAuditMoney(event.payload.gross_amount) || '—'}.
      </span>
    );
  }

  if (event.event_type === 'INVOICE_PAID') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-gray-400">
        <span>الصافي: <strong className={isDarkMode ? 'text-white font-mono' : 'text-gray-900 font-mono'}>{formatAuditMoney(event.payload.net_total) || '—'}</strong></span>
        {event.payload.invoice_number ? <span>• رقم الفاتورة: <strong className="font-mono text-gray-300">{event.payload.invoice_number}</strong></span> : null}
      </span>
    );
  }

  if (event.event_type === 'INVOICE_DELETED') {
    return <span className="text-sm text-gray-400">تم حذف سجل الفاتورة مع الاحتفاظ بأثر الحركة.</span>;
  }

  return <span className="text-sm text-gray-400">تم تسجيل حركة على الفاتورة.</span>;
};

const ItemDetails: React.FC<{ label: string; item?: InvoiceAuditItemSnapshot; isDarkMode: boolean }> = ({ label, item, isDarkMode }) => {
  if (!item) return null;
  const isProduct = item.item_type === 'PRODUCT_ITEM';
  const employeeName = isProduct ? item.seller_name : item.barber_name;
  return (
    <div className={`rounded-lg border p-2.5 text-xs ${isDarkMode ? 'border-white/[0.06] bg-black/40' : 'border-black/5 bg-white'}`}>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={`font-bold ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
          {item.catalog_name || (isProduct ? 'منتج غير متاح' : 'خدمة غير متاحة')}
        </span>
        {formatAuditMoney(item.line_total) ? (
          <span className="font-mono font-medium text-gray-300">({formatAuditMoney(item.line_total)})</span>
        ) : null}
        {item.quantity && item.quantity > 1 ? (
          <span className="font-mono text-xs text-gray-400">× {item.quantity}</span>
        ) : null}
      </div>
      {formatAuditMoney(item.unit_price) ? (
        <p className="mt-0.5 text-xs font-mono text-gray-400">سعر الوحدة: {formatAuditMoney(item.unit_price)}</p>
      ) : null}
      {employeeName ? (
        <p className="mt-0.5 text-xs text-gray-400">
          {isProduct ? 'مسؤول البيع' : 'المصفف'}: <span className="font-medium text-gray-300">{employeeName}</span>
        </p>
      ) : null}
      {item.assistant_name ? (
        <p className="mt-0.5 text-xs text-gray-400">المساعد: <span className="font-medium text-gray-300">{item.assistant_name}</span></p>
      ) : null}
    </div>
  );
};

export const InvoiceAuditEventDetails: React.FC<{ event: InvoiceAuditEvent; isDarkMode: boolean }> = ({ event, isDarkMode }) => {
  if (event.event_type === 'ITEM_UPDATED') {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ItemDetails label="قبل التعديل" item={event.payload.before} isDarkMode={isDarkMode} />
        <ItemDetails label="بعد التعديل" item={event.payload.after} isDarkMode={isDarkMode} />
      </div>
    );
  }
  if (event.event_type === 'ITEM_REMOVED') {
    return <ItemDetails label="العنصر المحذوف" item={event.payload} isDarkMode={isDarkMode} />;
  }
  if (event.event_type === 'INVOICE_PAID') {
    const discount = event.payload.discount;
    const depositAmount = event.payload.deposit_applied || event.payload.deposit_settlement?.applied_amount;
    return (
      <div className="space-y-2 text-xs">
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {(event.payload.payments || []).map((payment, index) => (
            <div key={`${payment.method || 'payment'}-${index}`} className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 ${isDarkMode ? 'border-white/[0.06] bg-black/40' : 'border-black/5 bg-white'}`}>
              <span className="text-gray-400">{PAYMENT_LABELS[payment.method || ''] || payment.method || 'دفع'}</span>
              <strong className="font-mono text-gray-200">{formatAuditMoney(payment.amount) || '—'}</strong>
            </div>
          ))}
        </div>
        {discount && discount.source !== 'NONE' ? (
          <div className={`rounded-lg border p-2 ${isDarkMode ? 'border-white/[0.06] bg-black/40' : 'border-black/5 bg-white'}`}>
            <p className="font-bold text-gray-200">الخصم: {formatAuditMoney(discount.amount) || '—'}</p>
            {discount.promo_code ? <p className="mt-0.5 text-gray-400 font-mono">كود الخصم: {discount.promo_code}</p> : null}
          </div>
        ) : null}
        {depositAmount ? (
          <div className={`rounded-lg border p-2 ${isDarkMode ? 'border-white/[0.06] bg-black/40' : 'border-black/5 bg-white'}`}>
            <p className="font-bold text-emerald-400">عربون مدفوع سابقًا: {formatAuditMoney(depositAmount)}</p>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 pt-0.5 font-mono">
          {event.payload.business_day_id ? <span>دفتر اليومية: {event.payload.business_day_id}</span> : null}
          {event.payload.invoice_date ? <span>تاريخ الفاتورة: {event.payload.invoice_date}</span> : null}
        </div>
      </div>
    );
  }
  return null;
};

const hasDetails = (event: InvoiceAuditEvent) => (
  event.event_type === 'ITEM_UPDATED'
  || event.event_type === 'ITEM_REMOVED'
  || event.event_type === 'INVOICE_PAID'
);

const TimelineEventRow: React.FC<{
  event: InvoiceAuditEvent;
  isDarkMode: boolean;
  expanded: boolean;
  onToggle: () => void;
}> = ({ event, isDarkMode, expanded, onToggle }) => {
  const detailsId = `invoice-audit-event-${event.id}`;
  const item = getAuditItemSnapshot(event);
  const isProduct = item.item_type === 'PRODUCT_ITEM';
  const employeeName = isProduct ? item.seller_name : item.barber_name;

  const handleRowClick = (e: React.MouseEvent) => {
    if (!hasDetails(event)) return;
    if ((e.target as HTMLElement).closest('button')) return;
    onToggle();
  };

  const handleRowKeyDown = (e: React.KeyboardEvent) => {
    if (!hasDetails(event)) return;
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <article className="relative py-2.5 border-b border-white/[0.05] last:border-b-0 group">
      {/* Semantic Rail Marker (18px) */}
      <div
        className={`absolute -right-[9px] top-2 flex h-[18px] w-[18px] items-center justify-center rounded-full border shadow-xs transition-transform duration-150 motion-reduce:transition-none group-hover:scale-105 ${eventTone(event.event_type)}`}
        aria-hidden="true"
      >
        {eventIcon(event.event_type)}
      </div>

      {/* Accessible Event Block (Title, Summary, Metadata, Timestamp in one RTL block) */}
      <div
        onClick={handleRowClick}
        onKeyDown={handleRowKeyDown}
        tabIndex={hasDetails(event) ? 0 : undefined}
        className={`transition-colors duration-150 motion-reduce:transition-none rounded-lg px-2.5 -mx-2.5 py-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E6D690]/40 ${
          hasDetails(event) ? 'cursor-pointer hover:bg-white/[0.02]' : ''
        }`}
      >
        {/* Line 1: Readable Primary Content (13–14px) */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h5 className={`text-sm font-semibold shrink-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            {getInvoiceAuditEventTitle(event)}
          </h5>
          <span className="text-gray-600 select-none">•</span>
          <InlineEventSummary event={event} isDarkMode={isDarkMode} />
          <GrossChange event={event} isDarkMode={isDarkMode} />
        </div>

        {/* Line 2: Compact Secondary Metadata & Aligned Timestamp (11–12px) */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-gray-400">
          {employeeName ? (
            <span>
              {isProduct ? 'مسؤول البيع' : 'المصفف'}: <strong className="font-medium text-gray-300">{employeeName}</strong>
            </span>
          ) : null}

          {item.assistant_name ? (
            <span>
              المساعد: <strong className="font-medium text-gray-300">{item.assistant_name}</strong>
            </span>
          ) : null}

          <span>
            بواسطة: <strong className="font-medium text-gray-300">{event.actor.display_name}</strong>{' '}
            <span className="font-mono text-[11px] text-gray-500">({SOURCE_LABELS[event.source] || event.source || 'System'})</span>
          </span>

          {!event.actor.is_invoice_owner && (
            <span>• صاحب الفاتورة: <strong className="font-medium text-gray-300">{event.invoice_owner.display_name}</strong></span>
          )}

          <span className="text-gray-600 select-none">•</span>

          <time className="font-mono text-[11px] text-gray-400" dateTime={event.occurred_at}>
            {formatDateTime(event.occurred_at)}
          </time>

          {hasDetails(event) ? (
            <>
              <span className="text-gray-600 select-none">•</span>
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-controls={detailsId}
                className={`inline-flex items-center gap-1 font-semibold text-xs transition-colors duration-150 motion-reduce:transition-none cursor-pointer ${
                  isDarkMode ? 'text-[#E6D690] hover:text-white' : 'text-amber-700 hover:text-amber-900'
                }`}
              >
                <span>{expanded ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}</span>
                {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Expanded Inline Details Drawer Directly Under Event */}
      {expanded && hasDetails(event) ? (
        <div
          id={detailsId}
          className={`mt-2 mb-1 rounded-lg border p-3 animate-fade-in motion-reduce:animate-none ${
            isDarkMode ? 'border-white/[0.08] bg-black/40' : 'border-black/5 bg-gray-50'
          }`}
        >
          <InvoiceAuditEventDetails event={event} isDarkMode={isDarkMode} />
        </div>
      ) : null}
    </article>
  );
};

export const InvoiceActivityTimelineContent: React.FC<InvoiceActivityTimelineContentProps> = ({ timeline, isDarkMode }) => {
  const [expandedSequences, setExpandedSequences] = useState<Set<number>>(() => new Set());
  const [showAllEvents, setShowAllEvents] = useState(false);

  if (!timeline.audit_history_available || timeline.events.length === 0) {
    return (
      <div className={`rounded-xl border border-dashed p-6 text-center max-w-xl ${isDarkMode ? 'border-white/10 bg-white/[0.015]' : 'border-black/10 bg-gray-50'}`}>
        <FileClock className="mx-auto mb-2 text-gray-500" size={22} />
        <h4 className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>لا يوجد سجل نشاط</h4>
        <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-gray-400">
          سجل الأحداث غير متاح لهذه الفاتورة لأنها أُنشئت قبل تفعيل سجل المراقبة.
        </p>
      </div>
    );
  }

  const totalCount = timeline.events.length;
  const isCollapsible = totalCount > 3;
  const visibleEvents = !isCollapsible || showAllEvents
    ? timeline.events
    : timeline.events.slice(-3);

  return (
    <div className="space-y-2">
      {/* Clean Activity Feed Header Strip (Un-nested) */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-white/[0.06] max-w-2xl">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            الأحداث المسجلة
          </span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-mono font-medium ${
            isDarkMode ? 'bg-white/5 border border-white/5 text-gray-400' : 'bg-gray-100 text-gray-600'
          }`}>
            {totalCount} حركة
          </span>
          {timeline.events_truncated ? (
            <span className="text-[11px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-md">
              تم عرض أول 500 حركة فقط
            </span>
          ) : null}
        </div>

        {isCollapsible && (
          <button
            type="button"
            onClick={() => setShowAllEvents(prev => !prev)}
            aria-expanded={showAllEvents}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold transition-colors duration-150 motion-reduce:transition-none cursor-pointer ${
              isDarkMode ? 'text-[#E6D690] hover:text-white' : 'text-amber-800 hover:text-amber-950'
            }`}
          >
            {showAllEvents ? (
              <>
                <ChevronUp size={13} />
                <span>عرض أحدث 3 حركات فقط</span>
              </>
            ) : (
              <>
                <ChevronDown size={13} />
                <span>عرض كامل السجل ({totalCount} أحداث)</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Linear-Style Activity Feed Rail with Natural Reading Width */}
      <div className="pt-1">
        <div className={`relative pr-5 mr-2.5 border-r max-w-2xl ${
          isDarkMode ? 'border-white/[0.08]' : 'border-black/10'
        }`}>
          {visibleEvents.map(event => {
            const expanded = expandedSequences.has(event.sequence_number);
            return (
              <TimelineEventRow
                key={event.id}
                event={event}
                isDarkMode={isDarkMode}
                expanded={expanded}
                onToggle={() => setExpandedSequences(previous => {
                  const next = new Set(previous);
                  if (next.has(event.sequence_number)) next.delete(event.sequence_number);
                  else next.add(event.sequence_number);
                  return next;
                })}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

const InvoiceActivityTimeline: React.FC<InvoiceActivityTimelineProps> = ({ invoiceId, isDarkMode }) => {
  const [timeline, setTimeline] = useState<InvoiceAuditTimelineResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const activeRequestRef = useRef<AbortController | null>(null);
  const hasTimelineRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      activeRequestRef.current?.abort();
    };
  }, []);

  const loadTimeline = useCallback(async (silent = false) => {
    if (activeRequestRef.current) {
      if (silent) return false;
      activeRequestRef.current.abort();
    }

    const controller = new AbortController();
    activeRequestRef.current = controller;
    if (!silent) {
      setIsLoading(true);
      setError(false);
    }
    try {
      const response = await adminApi.get<InvoiceAuditTimelineResponse>(`/invoices/${invoiceId}/events`, {
        signal: controller.signal,
      });
      if (!isMountedRef.current || controller.signal.aborted) return false;
      setTimeline(response.data);
      hasTimelineRef.current = true;
      setError(false);
      return true;
    } catch (requestError) {
      if (controller.signal.aborted) return false;
      if (!silent) console.error('Failed to fetch invoice audit timeline:', requestError);
      if (!silent && !hasTimelineRef.current) setError(true);
      return false;
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        if (isMountedRef.current && !silent) setIsLoading(false);
      }
    }
  }, [invoiceId]);

  useEffect(() => {
    hasTimelineRef.current = false;
    setTimeline(null);
    void loadTimeline(false);
  }, [loadTimeline]);

  const pollTimeline = useCallback(() => loadTimeline(true).then(() => undefined), [loadTimeline]);
  useVisiblePolling(pollTimeline, TIMELINE_POLL_INTERVAL_MS);

  if (isLoading) {
    return (
      <div className="space-y-2.5 max-w-2xl py-1" aria-label="جارٍ تحميل سجل نشاط الفاتورة">
        {[0, 1, 2].map(index => (
          <div key={index} className={`h-12 animate-pulse rounded-lg ${isDarkMode ? 'bg-white/5' : 'bg-gray-200/60'}`} />
        ))}
      </div>
    );
  }

  if (error || !timeline) {
    return (
      <div className={`rounded-xl border border-dashed p-6 text-center max-w-xl ${isDarkMode ? 'border-white/10 bg-white/[0.015]' : 'border-black/10 bg-gray-50'}`}>
        <Activity className="mx-auto mb-2 text-rose-500" size={22} />
        <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>تعذر تحميل سجل النشاط</p>
        <button
          type="button"
          onClick={() => void loadTimeline(false)}
          className="mx-auto mt-2.5 flex items-center gap-1.5 rounded-lg bg-[#E53935] px-3.5 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90 cursor-pointer"
        >
          <RefreshCw size={12} /> إعادة المحاولة
        </button>
      </div>
    );
  }

  return <InvoiceActivityTimelineContent timeline={timeline} isDarkMode={isDarkMode} />;
};

export default InvoiceActivityTimeline;
