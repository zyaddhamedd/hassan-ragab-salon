import React, { useId, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import useSupplyOverviewRead from '../../hooks/useSupplyOverviewRead';
import { ComparisonProduct, ComparisonProductOptions, overviewControl } from './supplyOverviewTypes';

interface Props {
  query: string;
  version: number;
  isDarkMode: boolean;
  selected: ComparisonProduct | null;
  onSelect: (product: ComparisonProduct | null) => void;
}

const SearchResults: React.FC<{ path: string; version: number; isDarkMode: boolean; onSelect: Props['onSelect'] }> = ({ path, version, isDarkMode, onSelect }) => {
  const [retry, setRetry] = useState(0);
  const result = useSupplyOverviewRead<ComparisonProductOptions>(path, version + retry);
  if (result.loading) return <p role="status" className="p-3 text-xs opacity-60">جاري البحث عن المنتجات…</p>;
  if (result.error) return <div role="alert" className="p-3 text-xs">{result.error} <button type="button" className={overviewControl(isDarkMode)} onClick={() => setRetry(value => value + 1)}>إعادة البحث</button></div>;
  return <>
    {!result.data?.items.length && <p className="p-3 text-xs opacity-60">لا توجد منتجات مطابقة داخل النطاق المحدد.</p>}
    <ul className="max-h-56 overflow-y-auto py-1">
      {result.data?.items.map(product => <li key={product.id}>
        <button type="button" onClick={() => onSelect(product)} className={`w-full rounded-lg px-3 py-2 text-right text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 ${isDarkMode ? 'hover:bg-white/[0.05]' : 'hover:bg-gray-50'}`}>
          {product.name}<span className="mr-2 text-[10px] opacity-50">{product.unit || 'وحدة غير مسجلة'}</span>
        </button>
      </li>)}
    </ul>
    {result.data?.has_more && <p className="px-3 pb-2 text-[10px] opacity-60">توجد نتائج أخرى؛ اكتب اسمًا أدق لتضييق البحث.</p>}
  </>;
};

const ComparisonProductPicker: React.FC<Props> = ({ query, version, isDarkMode, selected, onSelect }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [term, setTerm] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const params = new URLSearchParams(query);
  params.set('view', 'selector'); params.set('q', term); params.set('limit', '12');
  const select = (product: ComparisonProduct | null) => {
    onSelect(product); setOpen(false); setDraft(''); setTerm(''); trigger.current?.focus();
  };
  return <div className="relative min-w-0 sm:max-w-sm" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className={`${overviewControl(isDarkMode)} w-full gap-2 !justify-between`} aria-label="اختيار المنتج للمقارنة" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      <span className="truncate">{selected ? selected.name : 'كل المنتجات'}</span>
      <ChevronDown size={13} aria-hidden="true" className="shrink-0 opacity-50" />
    </button>
    {open && <div id={panelId} role="region" aria-label="اختيار المنتج" className={`absolute right-0 z-20 mt-2 w-[min(360px,calc(100vw-3rem))] max-w-[calc(100vw-3rem)] rounded-2xl border p-2 shadow-xl ${isDarkMode ? 'border-white/10 bg-[#141519] text-white/90' : 'border-black/10 bg-white text-gray-900'}`}>
      <form className="flex gap-1 border-b border-current/10 pb-2" onSubmit={event => { event.preventDefault(); setTerm(draft.trim()); }}>
        <input autoFocus aria-label="اسم المنتج للمقارنة" maxLength={100} className={`${overviewControl(isDarkMode)} min-w-0 flex-1`} value={draft} onChange={event => setDraft(event.target.value)} placeholder="ابحث باسم المنتج" />
        <button type="submit" className={overviewControl(isDarkMode)} aria-label="بحث عن منتج"><Search size={14} aria-hidden="true" /></button>
      </form>
      <button type="button" aria-pressed={!selected} className={`mt-1 w-full rounded-lg px-3 py-2 text-right text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 ${isDarkMode ? 'text-[#E6D690] hover:bg-white/[0.05]' : 'text-amber-800 hover:bg-gray-50'}`} onClick={() => select(null)}>كل المنتجات</button>
      {term ? <SearchResults path={`branch-comparison?${params}`} version={version} isDarkMode={isDarkMode} onSelect={select} /> : <p className="px-3 py-2 text-[10px] opacity-50">اكتب الاسم واضغط بحث؛ لا يتم تحميل الكتالوج كاملًا.</p>}
    </div>}
  </div>;
};
export default ComparisonProductPicker;
