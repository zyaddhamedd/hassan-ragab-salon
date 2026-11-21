import React, { useEffect, useId, useState } from 'react';
import { adminFetch } from '../../api/adminFetch';
import { ReturnCostValuation } from '../../types';
import ReturnCostSummary from './ReturnCostSummary';
import { workspaceStyles } from './productWorkspaceStyles';

interface SupplierReturn {
  id: number; return_ref: string; branch_name: string; product_name: string;
  quantity: number; product_unit: string; cost_valuation: ReturnCostValuation;
}
interface Response { items: SupplierReturn[]; pagination: { page: number; pages: number; has_next: boolean; has_prev: boolean } }
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export default function SupplierReturnCosts({ filters, isDarkMode, refreshToken }: { filters: string; isDarkMode: boolean; refreshToken: number }) {
  const [open, setOpen] = useState(false);
  const [paging, setPaging] = useState({ filters, page: 1 });
  const page = paging.filters === filters ? paging.page : 1;
  const identity = `${filters}|${page}|${refreshToken}`;
  const [result, setResult] = useState<{ identity: string; data?: Response; error?: string }>({ identity: '' });
  const id = useId(); const tone = workspaceStyles(isDarkMode);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let active = true;
    const params = new URLSearchParams(filters); params.set('page', String(page)); params.set('per_page', '6');
    adminFetch(`${API_BASE}/api/admin/supplier-returns?${params}`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر تحميل مرتجعات المورد.');
      if (active) setResult({ identity, data });
    }).catch((error) => { if (active) setResult({ identity, error: error.message }); });
    return () => { active = false; controller.abort(); };
  }, [open, identity]);
  const current = result.identity === identity ? result : null;
  return <section dir="rtl" className={`space-y-3 rounded-2xl border p-4 ${tone.divider}`}>
    <button type="button" aria-expanded={open} aria-controls={`${id}-supplier-costs`} className={tone.button} onClick={() => setOpen((value) => !value)}>مرتجعات المورد المباشرة والمسجلة</button>
    <div id={`${id}-supplier-costs`} hidden={!open}>
      {open && (!current ? <p role="status" className={tone.muted}>جارٍ تحميل المرتجعات…</p> : current.error ? <p role="alert">{current.error}</p> : <div className="space-y-3">
        {current.data?.items.length === 0 && <p className={tone.muted}>لا توجد مرتجعات مورد مطابقة.</p>}
        {current.data?.items.map((item) => <article key={item.id} className="space-y-2">
          <p className={`text-xs font-bold ${tone.muted}`}>{item.return_ref} · {item.branch_name}</p>
          <ReturnCostSummary valuation={item.cost_valuation} isDarkMode={isDarkMode} />
        </article>)}
        {current.data && current.data.pagination.pages > 1 && <nav aria-label="صفحات مرتجعات المورد" className="flex items-center gap-2 pt-2">
          <button type="button" className={tone.button} disabled={!current.data.pagination.has_prev} onClick={() => setPaging({ filters, page: page - 1 })}>السابق</button>
          <span className={tone.muted}>{page} / {current.data.pagination.pages}</span>
          <button type="button" className={tone.button} disabled={!current.data.pagination.has_next} onClick={() => setPaging({ filters, page: page + 1 })}>التالي</button>
        </nav>}
      </div>)}
    </div>
  </section>;
}
