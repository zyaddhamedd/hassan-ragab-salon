import React from 'react';
import { workspaceStyles } from './productWorkspaceStyles';

export type LocationStockStatus = 'AVAILABLE' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'NOT_APPLICABLE' | 'UNKNOWN';
const labels: Record<LocationStockStatus, string> = {
  AVAILABLE: 'متوفر', LOW_STOCK: 'منخفض', OUT_OF_STOCK: 'نفد',
  NOT_APPLICABLE: 'غير مطبق', UNKNOWN: 'غير مؤكد',
};

export default function StockStatusBadge({ status, isDarkMode, children }: { status: LocationStockStatus; isDarkMode: boolean; children?: React.ReactNode }) {
  const tone = workspaceStyles(isDarkMode);
  const color = status === 'AVAILABLE' ? tone.healthy : status === 'LOW_STOCK' ? tone.low : status === 'OUT_OF_STOCK' ? tone.expired : tone.unavailable;
  return <span className={`rounded-md px-2 py-1 text-xs font-bold ${color}`}
    title={status === 'UNKNOWN' ? 'دليل التخصيص أو الرصيد التشغيلي غير كافٍ لتأكيد الحالة؛ لا يُحسب تنبيه نفاد.' : undefined}>
    {children || labels[status] || labels.UNKNOWN}
  </span>;
}

export function ProductStockAlerts({ low = 0, out = 0, status, isDarkMode }: { low?: number; out?: number; status?: LocationStockStatus; isDarkMode: boolean }) {
  return <>
    {low > 0 && <StockStatusBadge status="LOW_STOCK" isDarkMode={isDarkMode}>{low === 1 ? 'منخفض في موقع' : `منخفض في ${low} مواقع`}</StockStatusBadge>}
    {out > 0 && <StockStatusBadge status="OUT_OF_STOCK" isDarkMode={isDarkMode}>{out === 1 ? 'نفد في موقع' : `نفد في ${out} مواقع`}</StockStatusBadge>}
    {low === 0 && out === 0 && (status === 'UNKNOWN' || status === 'NOT_APPLICABLE') && <StockStatusBadge status={status} isDarkMode={isDarkMode} />}
  </>;
}
