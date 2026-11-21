import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '../api/adminFetch';
import { HistoryLocation } from '../components/supply/productHistoryTypes';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';

/** Read-only tab requests. A previous query can never replace a newer query. */
export function useProductInventoryHistory<T extends { locations: HistoryLocation[] }>(productId: number, kind: 'activity' | 'batches', query: string, enabled: boolean) {
  const key = `${productId}/${kind}?${query}`;
  const sequence = useRef(0);
  const locationCache = useRef<{ owner: string; rows: HistoryLocation[] }>({ owner: '', rows: [] });
  const [retryToken, setRetryToken] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: T; error?: string; loading: boolean }>({ key: '', loading: true });
  useEffect(() => {
    if (!enabled) return;
    const requestId = ++sequence.current;
    const controller = new AbortController();
    setResult({ key, loading: true });
    void (async () => {
      try {
        const response = await adminFetch(`${API_BASE}/api/admin/products/${productId}/${kind}?${query}`, {
          headers: { Accept: 'application/json' }, signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر تحميل السجلات.');
        if (!Array.isArray(data.items) || !data.pagination) throw new Error('تعذر قراءة السجلات.');
        if (requestId === sequence.current && !controller.signal.aborted) {
          locationCache.current = { owner: `${productId}/${kind}`, rows: Array.isArray(data.locations) ? data.locations : [] };
          setResult({ key, data, loading: false });
        }
      } catch (error: unknown) {
        if (requestId === sequence.current && !controller.signal.aborted) {
          setResult({ key, error: error instanceof Error ? error.message : 'تعذر تحميل السجلات.', loading: false });
        }
      }
    })();
    return () => { controller.abort(); ++sequence.current; };
  }, [productId, kind, query, key, retryToken, enabled]);
  const current = result.key === key ? result : undefined;
  return { data: current?.data, locations: locationCache.current.owner === `${productId}/${kind}` ? locationCache.current.rows : [], error: current?.error, loading: enabled && (!current || current.loading), retry: () => setRetryToken((value) => value + 1) };
}
