export const formatCurrency = (value: number) =>
  `${new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(value || 0)} ج.م`;

export const formatNumber = (value: number) =>
  new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 1 }).format(value || 0);

const compactValue = (value: number, unit: string) => {
  const absolute = Math.abs(value || 0);
  if (absolute >= 1_000_000) return `${new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(value / 1_000_000)} مليون ${unit}`;
  if (absolute >= 1_000) return `${new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 1 }).format(value / 1_000)} ألف ${unit}`;
  return `${new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(value || 0)} ${unit}`;
};

export const formatCompactCurrency = (value: number) => compactValue(value, 'ج.م');
export const formatCompactUnits = (value: number) => compactValue(value, 'وحدة');

export const comparisonText = (comparison: { current: number; previous: number; percent_change: number | null }) => {
  if (comparison.percent_change === null) return comparison.current > 0 ? 'لا توجد قيمة سابقة صالحة للمقارنة' : 'بدون تغير ملحوظ';
  if (Math.abs(comparison.percent_change) < 2) return 'بدون تغير ملحوظ';
  return `${comparison.percent_change > 0 ? '↑' : '↓'} ${formatNumber(Math.abs(comparison.percent_change))}% عن الفترة السابقة`;
};

export const formatDate = (value?: string | null) => {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
};

export const formatShortDate = (value: string) =>
  new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`));

const cairoDateParts = (source = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(source);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

export const rangeForPreset = (preset: DatePreset) => {
  const today = cairoDateParts();
  if (preset === 'today') return { dateFrom: today, dateTo: today };
  if (preset === 'yesterday') {
    const yesterday = addDays(today, -1);
    return { dateFrom: yesterday, dateTo: yesterday };
  }
  if (preset === 'week') {
    const dayOfWeek = new Date(`${today}T12:00:00Z`).getUTCDay();
    const daysSinceSaturday = (dayOfWeek + 1) % 7;
    return { dateFrom: addDays(today, -daysSinceSaturday), dateTo: today };
  }
  if (preset === 'month') return { dateFrom: `${today.slice(0, 8)}01`, dateTo: today };
  return { dateFrom: `${today.slice(0, 8)}01`, dateTo: today };
};

export const movementLabel = (type: string) => ({
  PRODUCT_SALE: 'مبيعات منتجات',
  INTERNAL_CONSUMPTION: 'استهلاك داخلي',
  SUPPLY_IN: 'توريد وارد',
  TRANSFER_OUT: 'تحويل صادر',
  TRANSFER_IN: 'تحويل وارد',
  RETURN_TO_SUPPLIER: 'مرتجع للمورد',
  STOCK_ADJUSTMENT: 'تسوية مخزون',
}[type] || type);

export const errorMessage = (error: unknown) => {
  const candidate = error as { response?: { data?: { error?: string } } };
  return candidate.response?.data?.error || 'تعذر تحميل التقرير. حاول مرة أخرى.';
};
