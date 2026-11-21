import type { BranchInventoryProduct } from '../types/models';

export function statusLabel(status: BranchInventoryProduct['status']) {
  if (status === 'LOW') return 'منخفض';
  if (status === 'OUT') return 'نفد';
  if (status === 'UNKNOWN') return 'غير مؤكد';
  if (status === 'NOT_APPLICABLE') return 'غير مطبق';
  return 'متاح';
}

export function statusClass(status: BranchInventoryProduct['status']) {
  if (status === 'LOW') return 'border border-amber-500/20 bg-amber-500/10 text-amber-300';
  if (status === 'OUT') return 'border border-[#E53935]/20 bg-[#E53935]/10 text-[#ff9a96]';
  if (status === 'UNKNOWN' || status === 'NOT_APPLICABLE') return 'border border-white/10 bg-white/5 text-white/60';
  return 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300';
}

export function searchableInventoryStatus(entry: { stock_quantity: number; min_stock_threshold?: number; status?: BranchInventoryProduct['status'] }): BranchInventoryProduct['status'] {
  if (entry.status) return entry.status;
  // Older search responses cannot establish whether a zero is a depletion.
  if (entry.stock_quantity <= 0) return 'UNKNOWN';
  return entry.stock_quantity <= (entry.min_stock_threshold ?? 0) ? 'LOW' : 'AVAILABLE';
}
