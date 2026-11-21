import React from 'react';
import { Wallet, History } from 'lucide-react';

export const normalizeVisitCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

export default function CustomerInfoBadges({ depositBalance, visitCount }: {
  depositBalance: number | null;
  visitCount: number | null;
}) {
  const visits = normalizeVisitCount(visitCount);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] font-bold" dir="rtl" aria-label="معلومات العميل المسجل">
      <span className="inline-flex min-h-7 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-emerald-400/15 bg-emerald-400/5 px-2.5 py-1 text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" /><span className="min-w-0 break-words">عميل مسجل</span>
      </span>
      <span className="inline-flex min-h-7 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-[#E6D690]/15 bg-[#E6D690]/5 px-2.5 py-1 text-[#E6D690]">
        <Wallet size={12} className="shrink-0" />
        <span className="min-w-0 break-words">العربون المتاح: <bdi className="tabular-nums">{(depositBalance ?? 0).toLocaleString('en-US')}</bdi> ج.م</span>
      </span>
      <span className="inline-flex min-h-7 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-white/65"
        title={visits === null ? 'عدد الزيارات غير متاح حاليًا' : 'الزيارات المكتملة حسب سجل العميل'}>
        <History size={12} className="shrink-0" />
        <span className="min-w-0 break-words">الزيارات المكتملة: <bdi className="tabular-nums">{visits === null ? '—' : visits.toLocaleString('en-US')}</bdi></span>
      </span>
    </div>
  );
}
