import React from 'react';
import { catalogPages } from '../../utils/supplyCatalogNavigation';

interface Props {
  page: number; totalPages: number; total: number; perPage: number; count: number;
  isDarkMode: boolean; onPage: (page: number) => void;
}

export default function CatalogPagination({ page, totalPages, total, perPage, count, isDarkMode, onPage }: Props) {
  const start = total && count ? (page - 1) * perPage + 1 : 0;
  const end = total && count ? Math.min(start + count - 1, total) : 0;
  const base = `min-h-11 min-w-11 rounded-xl border px-2 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E6D690] disabled:cursor-not-allowed disabled:opacity-35 ${isDarkMode ? 'border-white/10 text-white/75 hover:bg-white/10' : 'border-black/10 text-gray-700 hover:bg-gray-100'}`;
  return (
    <div dir="rtl" className="flex flex-col items-center gap-3 border-t border-white/5 pt-5 sm:items-stretch">
      <p className={`text-center text-xs sm:text-right ${isDarkMode ? 'text-white/50' : 'text-gray-600'}`} role="status">عرض {start}–{end} من {total} منتج</p>
      <nav aria-label="صفحات كتالوج المنتجات" className="flex max-w-full flex-wrap items-center justify-center gap-1 sm:justify-start sm:gap-2">
        <button type="button" className={base} disabled={page <= 1 || !totalPages} onClick={() => onPage(page - 1)}>السابق</button>
        {catalogPages(page, totalPages).map((value, index) => value === 'ellipsis'
          ? <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-gray-500">…</span>
          : <button key={value} type="button" aria-label={`صفحة ${value}`} aria-current={value === page ? 'page' : undefined} onClick={() => onPage(value)} className={`${base} ${value === page ? '!border-[#E53935] !bg-[#E53935] !text-white' : ''}`}>{value}</button>)}
        <button type="button" className={base} disabled={!totalPages || page >= totalPages} onClick={() => onPage(page + 1)}>التالي</button>
      </nav>
    </div>
  );
}
