// Omar-only presentation hooks. No source files or runtime behavior are changed.
import path from 'node:path';

export const cashierHooks = {
  'mini/components/CashierScreen.tsx': [
    ['<main className="relative flex min-h-0 min-w-0 flex-1', '<main data-omar-mini-pos="cashier" className="relative flex min-h-0 min-w-0 flex-1'],
    ['<div className="fixed inset-0 z-[100] flex items-center justify-center', '<div data-omar-mini-pos="staff" className="fixed inset-0 z-[100] flex items-center justify-center'],
    ['<button\n      onClick={() => !isInInvoice', '<button data-omar-mini-service={isInInvoice ? "selected" : isPending ? "pending" : "idle"}\n      onClick={() => !isInInvoice'],
    ['key={cat.id}', 'data-omar-mini-category="card" key={cat.id}'],
    ['key={prod.id}', 'data-omar-mini-product={inCart ? "selected" : "idle"} key={prod.id}'],
    ['key={staffMember.id}', 'data-omar-mini-staff={isSelected ? "selected" : "idle"} key={staffMember.id}'],
    ["onClick={() => setShowStaffOverlay('barber')}", 'data-omar-mini-picker={selectedBarber ? "selected" : "idle"} onClick={() => setShowStaffOverlay(\'barber\')}'],
    ["onClick={() => setShowStaffOverlay('assistant')}", 'data-omar-mini-picker={selectedAssistant ? "selected" : "idle"} onClick={() => setShowStaffOverlay(\'assistant\')}'],
    ["onClick={() => { setActiveTab('services');", 'data-omar-mini-tab={activeTab === "services" ? "selected" : "idle"} onClick={() => { setActiveTab(\'services\');'],
    ["onClick={() => { setActiveTab('products');", 'data-omar-mini-tab={activeTab === "products" ? "selected" : "idle"} onClick={() => { setActiveTab(\'products\');'],
    ['<div className="absolute top-full right-0 left-0 mt-1', '<div data-omar-mini-lookup="results" className="absolute top-full right-0 left-0 mt-1'],
    // Preserve the existing 3px selected edge; only its paint comes from tokens.
    ["backgroundColor: 'rgba(255,255,255,0.08)', borderRight: '3px solid #E53935'", "backgroundColor: 'var(--omar-mini-lookup-active, rgba(255,255,255,0.08))', borderRight: '3px solid var(--omar-mini-accent, #E53935)'"],
  ],
  'mini/components/InvoiceSection.tsx': [
    ['<aside\n        className=', '<aside data-omar-mini-pos="invoice"\n        className='],
    ['<div key={item.id} className=', '<div data-omar-mini-invoice-item="row" key={item.id} className='],
    ['<div key={pm.id} className=', '<div data-omar-mini-tender={hasValue ? "selected" : "idle"} key={pm.id} className='],
    ['onClick={handleConfirm}', 'data-omar-mini-confirm="payment" onClick={handleConfirm}'],
    ['{localPromoError && (\n                  <p', '{localPromoError && (\n                  <p data-omar-mini-semantic="error"'],
    ['<span className="text-[10px] font-black text-[#E53935]/80 uppercase tracking-widest">متبقي', '<span data-omar-mini-semantic="error" className="text-[10px] font-black text-[#E53935]/80 uppercase tracking-widest">متبقي'],
    ['<span className="text-xs font-black text-[#E53935] tabular-nums">{(finalTotal - totalPaid)', '<span data-omar-mini-semantic="error" className="text-xs font-black text-[#E53935] tabular-nums">{(finalTotal - totalPaid)'],
  ],
};

export function cashierThemeSource(source, relative) {
  const hooks = cashierHooks[relative];
  if (!hooks) return null;
  let code = source;
  for (const [before, after] of hooks) {
    if (code.split(before).length !== 2 || code.includes(after)) {
      throw new Error('Omar cashier theme hook drift: ' + relative);
    }
    code = code.replace(before, after);
  }
  return code;
}

export function omarCashierTheme({workspace, app, mode}) {
  if (app !== 'mini' || !['hassan', 'omar'].includes(mode)) return null;
  return {
    name: 'omar-mini-cashier-theme', enforce: 'pre',
    transform(source, id) {
      const relative = path.relative(workspace, id.split('?')[0]).split(path.sep).join('/');
      const code = cashierThemeSource(source, relative);
      return code === null ? null : {code, map: null};
    },
  };
}
