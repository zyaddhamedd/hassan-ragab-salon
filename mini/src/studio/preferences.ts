export type Appearance = { popular: boolean };
export type Preferences = {
  version: 1;
  categoryOrder: number[];
  serviceOrderByCategory: Record<string, number[]>;
  serviceAppearance: Record<string, Appearance>;
};
export const emptyPreferences = (): Preferences => ({ version: 1, categoryOrder: [], serviceOrderByCategory: {}, serviceAppearance: {} });
export const classic: Appearance = Object.freeze({ popular: false });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (id: unknown): id is number => Number.isSafeInteger(id) && Number(id) >= 0;
const idKey = (id: string) => /^\d+$/.test(id) && validId(Number(id)) && String(Number(id)) === id;
const ids = (value: unknown): number[] => Array.isArray(value) ? [...new Set(value.filter(validId))].slice(0, 10000) : [];

// Only presentation fields survive validation. Missing catalog records never
// become records themselves; retain their metadata for temporary disablement.
export function validatePreferences(value: unknown): Preferences {
  const result = emptyPreferences();
  if (!record(value) || value.version !== 1) return result;
  result.categoryOrder = ids(value.categoryOrder);
  if (record(value.serviceOrderByCategory)) {
    for (const [id, order] of Object.entries(value.serviceOrderByCategory).slice(0, 10000)) {
      if (idKey(id)) result.serviceOrderByCategory[id] = ids(order);
    }
  }
  if (record(value.serviceAppearance)) {
    for (const [id, appearance] of Object.entries(value.serviceAppearance).slice(0, 10000)) {
      if (!idKey(id) || !record(appearance)) continue;
      // Read old v1 presets safely, retaining only the approved POPULAR flag.
      if (appearance.popular === true) result.serviceAppearance[id] = { popular: true };
    }
  }
  return result;
}

export function preferenceKey(branchId: number, deviceId: string): string {
  if (!Number.isSafeInteger(branchId) || branchId <= 0 || !deviceId) throw new Error('Invalid Studio scope');
  return `omar:cashier-studio:omar-fahim-standalone:v1:${branchId}:${encodeURIComponent(deviceId)}`;
}
export function readPreferences(storage: Pick<Storage, 'getItem'>, key: string): { preferences: Preferences; warning: string } {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { preferences: emptyPreferences(), warning: '' };
    if (raw.length > 1000000) throw new Error('Oversized preferences');
    const parsed: unknown = JSON.parse(raw);
    if (!record(parsed) || parsed.version !== 1) throw new Error('Unsupported preferences');
    return { preferences: validatePreferences(parsed), warning: '' };
  } catch {
    return { preferences: emptyPreferences(), warning: 'تعذر قراءة التخصيص المحفوظ. يمكنك حفظ تخصيص جديد أو الإلغاء.' };
  }
}
export function writePreferences(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, draft: Preferences): Preferences {
  const validated = validatePreferences(draft);
  const serialized = JSON.stringify(validated);
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error('Studio save verification failed');
  return validated;
}
export function appearanceFor(preferences: Preferences, serviceId: number): Appearance {
  return preferences.serviceAppearance[String(serviceId)] || classic;
}
export function changeAppearance(preferences: Preferences, serviceId: number, appearance: Appearance): Preferences {
  const next = { ...preferences, serviceAppearance: { ...preferences.serviceAppearance } };
  if (!appearance.popular) delete next.serviceAppearance[String(serviceId)];
  else next.serviceAppearance[String(serviceId)] = appearance;
  return next;
}

// Reconcile presentation IDs against live objects; never recreate missing records.
export function orderedItems<T extends { id: number }>(items: T[], order: number[] = []): T[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const result: T[] = [];
  for (const id of order) { const item = byId.get(id); if (item) { result.push(item); byId.delete(id); } }
  for (const item of items) if (byId.delete(item.id)) result.push(item);
  return result;
}
export function moveId(order: number[], id: number, target: number): number[] {
  if (!order.includes(id)) return order;
  const next = order.filter(value => value !== id);
  next.splice(Math.max(0, Math.min(next.length, target)), 0, id);
  return next;
}
export function defaultServices<T extends { id: number; created_at?: string }>(services: T[]): T[] {
  return [...services].sort((a,b) => a.created_at && b.created_at ? new Date(b.created_at).getTime()-new Date(a.created_at).getTime() : (b.id||0)-(a.id||0));
}
