import React from 'react';
import { catalogPages } from '../../utils/supplyCatalogNavigation';
import { HistoryPagination } from './productHistoryTypes';
import { workspaceStyles } from './productWorkspaceStyles';

interface Props { pagination: HistoryPagination; count: number; label: string; isDarkMode: boolean; onPage: (page: number) => void; }
export default function ProductHistoryPagination({ pagination: p, count, label, isDarkMode, onPage }: Props) {
  const tone = workspaceStyles(isDarkMode);
  const start = count ? (p.page - 1) * p.per_page + 1 : 0;
  return <div className={`space-y-2 border-t pt-3 ${tone.divider}`}>
    <p role="status" className={`text-xs ${tone.muted}`}>عرض {start}–{count ? start + count - 1 : 0} من {p.total_items} سجل</p>
    <nav aria-label={label} className="flex flex-wrap gap-1">
      <button type="button" className={tone.button} disabled={!p.has_prev} onClick={() => onPage(p.page - 1)}>السابق</button>
      {catalogPages(p.page, p.total_pages).map((value, index) => value === 'ellipsis'
        ? <span key={`gap-${index}`} aria-hidden="true" className={`px-2 py-3 ${tone.muted}`}>…</span>
        : <button key={value} type="button" aria-label={`صفحة ${value}`} aria-current={value === p.page ? 'page' : undefined} className={`${tone.button} min-w-11 ${value === p.page ? '!border-[#E53935] bg-[#E53935]/10' : ''}`} onClick={() => onPage(value)}>{value}</button>)}
      <button type="button" className={tone.button} disabled={!p.has_next} onClick={() => onPage(p.page + 1)}>التالي</button>
    </nav>
  </div>;
}
