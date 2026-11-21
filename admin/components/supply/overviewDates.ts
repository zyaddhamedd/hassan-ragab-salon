import { SupplyWorkspaceState } from './supplyWorkspaceTypes';

// Resolve calendar presets in Cairo, regardless of the owner's device timezone.
// The API converts each Cairo midnight separately (including DST transitions).
export const overviewDates = (state: SupplyWorkspaceState, now = new Date()) => {
  if (state.datePreset === 'custom') return { dateFrom: state.dateFrom, dateTo: state.dateTo };
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: string) => Number(parts.find(p => p.type === name)?.value);
  const today = new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const start = new Date(today);
  let end = today;
  switch (state.datePreset) {
    case 'yesterday': start.setUTCDate(start.getUTCDate() - 1); end = start; break;
    case 'this_week': start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 1) % 7)); break;
    case 'this_month': start.setUTCDate(1); break;
    case 'last_30_days': start.setUTCDate(start.getUTCDate() - 29); break;
  }
  return { dateFrom: iso(start), dateTo: iso(end) };
};
