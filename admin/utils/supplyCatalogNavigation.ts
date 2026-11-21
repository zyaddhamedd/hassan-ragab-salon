export const CATALOG_STATUSES = ['ALL', 'SELLABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'NEAR_EXPIRY', 'ARCHIVED'] as const;
export const CATALOG_SORTS = ['name_asc', 'stock_desc', 'price_desc', 'updated_desc'] as const;
export const SUPPLY_TABS = ['overview', 'catalog', 'history', 'requests', 'returns'] as const;
export type SupplyTab = typeof SUPPLY_TABS[number];
export interface CatalogQuery {
  page: number;
  q: string;
  status: typeof CATALOG_STATUSES[number];
  sort: typeof CATALOG_SORTS[number];
}
export interface SupplyNavigation {
  active: boolean;
  tab: SupplyTab;
  productId: number | null;
  location: string;
  catalog: CatalogQuery;
}
export const DEFAULT_CATALOG: CatalogQuery = { page: 1, q: '', status: 'ALL', sort: 'name_asc' };
const KEYS = ['supply', 'supply_tab', 'product_id', 'catalog_page', 'catalog_q', 'catalog_status', 'catalog_sort', 'catalog_location'];
const positiveInteger = (value: string | null) => {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
};
const choice = <T extends string>(value: string | null, choices: readonly T[], fallback: T): T =>
  choices.includes(value as T) ? value as T : fallback;

export function readSupplyNavigation(href: string): SupplyNavigation {
  const params = new URL(href).searchParams;
  const active = params.get('supply') === '1';
  const productId = active ? positiveInteger(params.get('product_id')) : null;
  return {
    active,
    tab: productId ? 'catalog' : choice(params.get('supply_tab'), SUPPLY_TABS, 'overview'),
    productId,
    // Location scopes shortage indicators; quantities retain their scoped totals.
    location: positiveInteger(params.get('catalog_location'))?.toString() || 'All',
    catalog: {
      page: positiveInteger(params.get('catalog_page')) || 1,
      q: params.get('catalog_q') || '',
      status: choice(params.get('catalog_status'), CATALOG_STATUSES, 'ALL'),
      sort: choice(params.get('catalog_sort'), CATALOG_SORTS, 'name_asc'),
    },
  };
}

export function supplyNavigationUrl(href: string, state: SupplyNavigation): string {
  const url = new URL(href);
  KEYS.forEach((key) => url.searchParams.delete(key));
  if (state.active) {
    url.searchParams.set('supply', '1');
    url.searchParams.set('supply_tab', state.tab);
    url.searchParams.set('catalog_page', String(state.catalog.page));
    url.searchParams.set('catalog_status', state.catalog.status);
    url.searchParams.set('catalog_sort', state.catalog.sort);
    if (state.catalog.q) url.searchParams.set('catalog_q', state.catalog.q);
    if (state.location !== 'All') url.searchParams.set('catalog_location', state.location);
    if (state.productId) url.searchParams.set('product_id', String(state.productId));
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function changeCatalogQuery(current: CatalogQuery, patch: Partial<CatalogQuery>): CatalogQuery {
  const filtersChanged = (['q', 'status', 'sort'] as const).some((key) => patch[key] !== undefined && patch[key] !== current[key]);
  return { ...current, ...patch, page: filtersChanged ? 1 : patch.page ?? current.page };
}

export const catalogContextKey = (state: SupplyNavigation) => JSON.stringify([state.catalog, state.location]);

export function catalogPages(page: number, totalPages: number): Array<number | 'ellipsis'> {
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => pages.add(n));
  if (page >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach((n) => pages.add(n));
  const result: Array<number | 'ellipsis'> = [];
  [...pages].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b).forEach((n, index, list) => {
    const previous = list[index - 1];
    if (index && n - previous === 2) result.push(previous + 1);
    else if (index && n - previous > 2) result.push('ellipsis');
    result.push(n);
  });
  return result;
}
