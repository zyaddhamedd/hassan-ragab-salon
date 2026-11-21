export interface HistoryPagination {
  page: number; per_page: number; total_items: number; total_pages: number; has_next: boolean; has_prev: boolean;
}
export interface HistoryLocation { branch_id: number; branch_name: string; is_main_warehouse: boolean; }
export interface MovementBalance {
  status: 'RECORDED' | 'VERIFIED_HISTORICAL' | 'CONDITIONAL_RECONSTRUCTION' | 'UNAVAILABLE';
  before: number | null; delta: number | null; after: number | null;
  source: 'OPERATION_SNAPSHOT' | 'VERIFIED_RECOVERY' | 'CONDITIONAL_RECOVERY' | 'NONE';
  algorithm_version: string | null; assumptions: string[]; unavailable_reason: string | null;
  conditional_available: boolean;
}
export interface ProductMovementRecord {
  id: number; product_id: number; branch_id: number; branch_name: string | null;
  movement_type: string; quantity: number; direction: 'IN' | 'OUT' | 'NEUTRAL' | 'UNKNOWN';
  created_at: string; notes: string | null; reference_label: string;
  invoice_id: number | null; invoice_number: number | null;
  balance_before: number | null; quantity_delta: number | null; balance_after: number | null;
  snapshot_status: 'RECORDED' | 'UNAVAILABLE_LEGACY';
  balance?: MovementBalance;
}
export interface ProductActivityHistoryResponse {
  items: ProductMovementRecord[]; pagination: HistoryPagination; as_of_id: number;
  locations: HistoryLocation[]; date_timezone: 'Africa/Cairo';
}
export interface ProductBatchHistoryRecord {
  record_key: string; branch_record_id: number | null; batch_id: number; batch_number: string;
  branch_id: number | null; branch_name: string | null; is_main_warehouse: boolean;
  remaining_quantity: number | null; initial_quantity: number | null;
  batch_status: 'ACTIVE' | 'DEPLETED' | 'ARCHIVED'; location_status: 'ACTIVE' | 'DEPLETED' | 'ARCHIVED' | null;
  expiry_status: 'HEALTHY' | 'EXPIRING_SOON' | 'EXPIRED' | 'NO_EXPIRY'; days_remaining: number | null;
  expiration_date: string | null; purchase_date: string | null; received_at: string | null;
  created_at: string; last_moved_at: string | null; source_type: string; source_ref: string | null;
  is_legacy: boolean; origin_branch_name: string | null;
}
export interface ProductBatchHistoryResponse {
  items: ProductBatchHistoryRecord[]; pagination: HistoryPagination; locations: HistoryLocation[];
  view: 'current' | 'all'; quantity_basis: 'RECORDED_BATCH_REMAINDER_NOT_OPERATIONAL_BALANCE';
}
export { movementLabels } from './productMovementPresentation';
export const lifecycleLabels = { ACTIVE: 'نشطة', DEPLETED: 'مستنفدة', ARCHIVED: 'مؤرشفة' };
export const expiryLabels = { HEALTHY: 'جيدة الصلاحية', EXPIRING_SOON: 'قريبة الانتهاء', EXPIRED: 'منتهية الصلاحية', NO_EXPIRY: 'بدون صلاحية' };
export function historyDate(value: string | null, withTime = false) {
  if (!value) return 'غير متاح';
  if (!withTime) return value.split('T')[0];
  try { return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(value)); }
  catch { return value; }
}
