import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CatalogQuery, SupplyNavigation, SupplyTab, catalogContextKey, changeCatalogQuery,
  readSupplyNavigation, supplyNavigationUrl,
} from '../utils/supplyCatalogNavigation';

interface CatalogPosition { key: string; y: number; anchor?: number; offset?: number }
interface NavigationEntry { id: string; appTab?: string; returnEntry?: string; position?: CatalogPosition }
const entry = (): NavigationEntry => window.history.state?.supplyCatalog || {};
const entryId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const writeEntry = (value: NavigationEntry) => window.history.replaceState({ ...window.history.state, supplyCatalog: value }, '');

export function rememberCatalogPosition(anchor?: number) {
  const state = readSupplyNavigation(window.location.href);
  if (!state.active || state.tab !== 'catalog' || state.productId) return;
  const card = anchor ? document.getElementById(`catalog-product-${anchor}`) : null;
  const current = entry();
  writeEntry({ ...current, id: current.id || entryId(), position: {
    key: catalogContextKey(state), y: window.scrollY,
    anchor, offset: card?.getBoundingClientRect().top,
  } });
}

// Called only after the current catalog response has rendered. Stop correcting
// image/font layout shifts immediately when the user starts navigating.
export function restoreCatalogPosition(container: HTMLElement): () => void {
  const state = readSupplyNavigation(window.location.href);
  const position = entry().position;
  if (!position || position.key !== catalogContextKey(state)) return () => {};
  let stopped = false;
  const restore = () => {
    if (stopped) return;
    const card = position.anchor ? document.getElementById(`catalog-product-${position.anchor}`) : null;
    window.scrollTo({ top: card ? window.scrollY + card.getBoundingClientRect().top - (position.offset || 0) : position.y, behavior: 'instant' });
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(restore);
  const stop = () => {
    stopped = true;
    observer?.disconnect();
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach((type) => window.removeEventListener(type, stop));
  };
  ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach((type) => window.addEventListener(type, stop, { passive: true }));
  observer?.observe(container);
  const frame = requestAnimationFrame(restore);
  const timeout = window.setTimeout(stop, 1500);
  void document.fonts?.ready.then(restore);
  return () => { stop(); cancelAnimationFrame(frame); clearTimeout(timeout); };
}

export default function useSupplyCatalogNavigation() {
  const [state, setState] = useState(() => readSupplyNavigation(window.location.href));
  const [outsideTab, setOutsideTab] = useState<string | null>(null);
  const activeRef = useRef(state.active);
  activeRef.current = state.active;
  useEffect(() => {
    const onPop = () => {
      const next = readSupplyNavigation(window.location.href);
      // Leave unrelated browser history alone unless crossing our boundary.
      if (!next.active && !activeRef.current && !entry().appTab) return;
      setState(next);
      setOutsideTab(next.active ? null : entry().appTab || 'dashboard');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (!state.active) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    let scrollTimer: number | undefined;
    const onScroll = () => {
      const href = window.location.href;
      window.clearTimeout(scrollTimer);
      // Avoid a history write on every animation frame. Explicit navigation and
      // pagehide still save immediately, and a delayed save cannot cross entries.
      scrollTimer = window.setTimeout(() => {
        if (window.location.href === href) rememberCatalogPosition();
      }, 150);
    };
    const onPageHide = () => rememberCatalogPosition();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.history.scrollRestoration = previous;
      window.clearTimeout(scrollTimer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [state.active]);

  const navigate = useCallback((next: SupplyNavigation, replace = false, metadata: Partial<NavigationEntry> = {}) => {
    const href = supplyNavigationUrl(window.location.href, next);
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const current = entry();
    if (href !== currentHref) {
      const value = replace ? { ...current, ...metadata, id: current.id || entryId() } : { id: entryId(), ...metadata };
      window.history[replace ? 'replaceState' : 'pushState']({ ...window.history.state, supplyCatalog: value }, '', href);
    }
    setState(next);
    setOutsideTab(null);
  }, []);

  const selectAppTab = (tab: string, previousTab: string, location = state.location) => {
    if (!state.active && tab !== 'inventory') { setOutsideTab(null); return; }
    if (!state.active) writeEntry({ ...entry(), id: entry().id || entryId(), appTab: previousTab });
    rememberCatalogPosition();
    navigate({ ...state, location, active: tab === 'inventory' }, false, { appTab: tab });
  };
  const selectTab = (tab: SupplyTab, location = state.location) => {
    if (!state.active) writeEntry({ ...entry(), id: entry().id || entryId(), appTab: 'inventory' });
    rememberCatalogPosition();
    navigate({ ...state, location, active: true, tab, productId: null });
  };
  const updateCatalog = (patch: Partial<CatalogQuery>, replace = false) => {
    rememberCatalogPosition();
    navigate({ ...state, active: true, tab: 'catalog', productId: null, catalog: changeCatalogQuery(state.catalog, patch) }, replace, { position: undefined });
  };
  const openProduct = (productId: number) => {
    rememberCatalogPosition(productId);
    navigate({ ...state, active: true, tab: 'catalog', productId }, false, { returnEntry: entry().id, position: entry().position });
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const closeProduct = () => {
    if (entry().returnEntry) window.history.back();
    else navigate({ ...state, active: true, tab: 'catalog', productId: null }, true);
  };
  const updateLocation = (location: string) => {
    if (state.active && location !== state.location) {
      rememberCatalogPosition();
      navigate({ ...state, location, catalog: { ...state.catalog, page: 1 } }, false, { position: undefined });
    }
  };
  return { state, outsideTab, selectAppTab, selectTab, updateCatalog, openProduct, closeProduct, updateLocation };
}
