import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '../api/adminFetch';
import { CatalogQuery } from '../utils/supplyCatalogNavigation';

export interface CatalogResponse<T> {
  items: T[]; page: number; per_page: number; total: number; total_pages: number; has_more: boolean;
}
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export default function useCatalogProducts<T>(query: CatalogQuery, refreshToken: number, onPageCorrection: (page: number) => void, location = 'All') {
  const [data, setData] = useState<CatalogResponse<T>>({ items: [], page: query.page, per_page: 25, total: 0, total_pages: 0, has_more: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const identity = JSON.stringify([query, location, refreshToken, version]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const correction = useRef(onPageCorrection);
  correction.current = onPageCorrection;
  const previousSearch = useRef(query.q);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const isCurrent = () => !cancelled && currentIdentity.current === identity;
    const delay = previousSearch.current === query.q ? 0 : 300;
    previousSearch.current = query.q;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ page: String(query.page), per_page: '25', status: query.status, sort: query.sort });
        if (query.q.trim()) params.set('q', query.q.trim());
        if (location.toLowerCase() !== 'all') params.set('location_id', location);
        const response = await adminFetch(`${API_BASE}/api/admin/products/catalog?${params}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
        const payload = await response.json();
        if (!isCurrent()) return;
        if (!response.ok) throw new Error(payload.error || 'فشل تحميل المنتجات');
        const canonicalPage = payload.total === 0 ? 1 : Number(payload.page || 1);
        setData({ ...payload, page: canonicalPage, items: Array.isArray(payload.items) ? payload.items : [] });
        if (canonicalPage !== query.page) correction.current(canonicalPage);
      } catch (failure) {
        if (isCurrent() && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'حدث خطأ غير متوقع');
      } finally {
        if (isCurrent()) setLoading(false);
      }
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [identity]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  return { data, loading, error, refresh };
}
