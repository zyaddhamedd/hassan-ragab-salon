import { useEffect, useState } from 'react';
import { adminFetch } from '../api/adminFetch';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';

// Keyed state prevents an old result appearing under newly applied filters,
// even during the render before the old effect's cleanup. Abort plus identity
// checking also protects against transports that complete after cancellation.
export default function useSupplyOverviewRead<T>(path: string, version: number) {
  const key = `${path}|${version}`;
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>({ key: '' });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    adminFetch(`${API_BASE}/api/admin/inventory/${path}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || `تعذر تحميل البيانات (${response.status}).`);
        }
        return response.json() as Promise<T>;
      })
      .then(data => { if (active) setResult({ key, data }); })
      .catch(error => { if (active && error.name !== 'AbortError') setResult({ key, error: error.message }); });
    return () => { active = false; controller.abort(); };
  }, [key, path]);
  return result.key === key ? { ...result, loading: false } : { loading: true, data: undefined, error: undefined };
}
