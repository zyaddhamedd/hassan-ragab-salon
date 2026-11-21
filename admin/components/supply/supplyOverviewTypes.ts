import { SupplyActivityRecord } from '../../types';

export interface OverviewBranch {
  id: number; name: string; is_active: boolean; is_main_warehouse: boolean;
  outstanding_shipments: number; received_today: number;
}
export interface SupplyOverviewData {
  meta: { as_of: string; date_from: string; date_to: string; date_timezone: string };
  current: {
    warehouse_visible: boolean; warehouse_name: string | null;
    warehouse_units: number | null; warehouse_value: string | null;
    known_cost_subtotal: string | null; missing_cost_products: number;
    zero_cost_products: number; negative_balance_rows: number;
    active_catalog_products: number; active_operational_branches: number;
    outstanding_shipments: number; received_today: number;
  };
  period: { dispatched_shipments: number; received_shipments: number; supply_receipts: number; resolved_return_events: number };
  branches: OverviewBranch[];
  activity: { items: SupplyActivityRecord[]; total_events: number; has_more: boolean; limit: number; stock_records_notice: string };
}
export interface ComparisonProduct { id: number; name: string; unit: string }
export interface BranchComparisonRow {
  branch_id: number; branch_name: string; branch_active: boolean;
  gross_sales_value: string;
  confirmed_consumption_operations: number;
  historical_unverified_movement_count: number;
  excluded_correction_count: number;
  // Present only for one selected product; never aggregate unrelated units.
  units_sold?: number;
  confirmed_consumption_units?: number;
}
export interface BranchComparisonData {
  mode: 'all_products' | 'selected_product';
  product: ComparisonProduct | null;
  rows: BranchComparisonRow[];
  meta: { has_recorded_activity: boolean };
}
export interface ComparisonProductOptions {
  items: ComparisonProduct[]; limit: number; has_more: boolean;
}
export const overviewPanel = (dark: boolean) => `rounded-[1.5rem] border p-4 sm:p-5 ${dark ? 'border-white/[0.04] bg-white/[0.015] text-white/90' : 'border-black/[0.06] bg-white text-gray-900'}`;
export const overviewControl = (dark: boolean) => `inline-flex min-h-9 items-center justify-center rounded-xl border px-3 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 disabled:opacity-40 ${dark ? 'border-white/[0.06] bg-white/[0.02] text-white/75 hover:bg-white/[0.05]' : 'border-black/[0.08] bg-white text-gray-700 hover:bg-gray-50'}`;
export const formatOverviewMoney = (value: string | null) => value === null ? 'غير مكتملة' : `${Number(value).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
