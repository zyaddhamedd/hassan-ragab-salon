/**
 * Secret Settlement Studio Types
 * -------------------------------------------------------------
 * Authoritative types mirroring backend Phase 1 calculation engine
 * and Phase 2 settlement ledger contracts.
 */

export type SettlementStatusType =
  | 'DRAFT'
  | 'APPROVED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED';

export interface SettlementAdjustmentInput {
  id?: string | number;
  category: 'BONUS' | 'PENALTY' | 'ABSENCE' | 'OTHER_ADDITION' | 'OTHER_DEDUCTION';
  is_addition: boolean;
  amount: number;
  reason: string;
}

export interface PayrollPreviewMeta {
  version: string;
  employee_id: number;
  employee_name: string;
  employee_type: string;
  home_branch: string;
  date_from: string;
  date_to: string;
  days_in_period: number;
  generated_at?: string;
  reference_wallet_balance: number;
  absorbed_settlement_id: number | null;
  absorbed_settlement_ids: number[];
  absorbed_settlements?: Array<{
    id: number;
    settlement_number: string;
    remaining_balance: number;
  }>;
  already_settled_items_excluded_count: number;
  disclaimer: string;
}

export interface PayrollPreviewSummary {
  gross_commissions: number;
  service_commissions: number;
  barber_commissions: number;
  assistant_commissions: number;
  product_commissions: number;
  overtime: number;
  total_earnings: number;
  advances: number;
  commission_withdrawals: number;
  money_already_received: number;
  administrative_deductions: number;
  total_deductions: number;
  carried_balance_applied: number;
  net_payable: number;
  net_payable_with_suggested_salary: number;
  is_negative_balance: boolean;
}

export interface FixedSalaryInfo {
  configured_base_salary: number;
  days_in_period: number;
  days_in_month: number;
  suggested_prorated_base_salary: number;
  is_included_in_net: boolean;
  note: string;
}

export interface BranchAttribution {
  branch_id: number;
  branch_name: string;
  operations_count: number;
  service_commissions: number;
  product_commissions: number;
  total_commissions: number;
}

export interface LineItemCommission {
  source_id: string;
  item_id: number;
  invoice_id: number;
  invoice_number: string;
  earning_role: 'BARBER' | 'ASSISTANT' | 'PRODUCT_SALES';
  item_type: string;
  title: string;
  gross_price: number;
  commission_percent: number;
  commission_amount: number;
  branch_id: number;
  branch_name: string;
  date: string;
}

export interface LineItemFinancialAction {
  source_id: string;
  action_id: number;
  amount: number;
  created_at: string;
  created_by?: number;
  notes?: string;
}

export interface LineItemOvertime {
  source_id: string;
  amount: number;
  hours?: number;
  rate?: number;
  date: string;
  origin?: string;
}

export interface LineItemCarriedBalance {
  source_id: string;
  settlement_id: number;
  settlement_number: string;
  amount: number;
}

export interface PayrollPreviewLineItems {
  commissions: LineItemCommission[];
  advances: LineItemFinancialAction[];
  commission_withdrawals: LineItemFinancialAction[];
  deductions: LineItemFinancialAction[];
  overtimes: LineItemOvertime[];
  carried_balances?: LineItemCarriedBalance[];
}

export interface PayrollPreviewResponse {
  meta: PayrollPreviewMeta;
  summary: PayrollPreviewSummary;
  fixed_salary_info: FixedSalaryInfo;
  branch_attribution: BranchAttribution[];
  line_items: PayrollPreviewLineItems;
  ambiguities: string[];
}

export interface SettlementAllocatedItemRecord {
  id: number;
  settlement_id: number;
  item_type: string;
  source_item_id: number;
  earning_role: string | null;
  allocated_amount: number;
  source_reference: string;
  created_at: string;
}

export interface SettlementAdjustmentRecord {
  id: number;
  settlement_id: number;
  category: string;
  is_addition: boolean;
  amount: number;
  reason: string;
  created_by: number;
  created_at: string;
}

export interface SettlementRecord {
  id: number;
  settlement_number: string;
  employee_id: number;
  employee_name: string;
  branch_id: number;
  branch_name: string;
  date_from: string;
  date_to: string;
  status: SettlementStatusType;
  summary: {
    total_barber_commission: number;
    total_assistant_commission: number;
    total_product_commission: number;
    total_commissions_earned: number;
    total_overtime: number;
    base_salary_allocated: number;
    total_gross_earnings: number;
    total_advances: number;
    total_commission_withdrawals: number;
    total_money_already_received: number;
    total_administrative_deductions: number;
    total_manual_deductions: number;
    total_manual_additions: number;
    total_deductions: number;
    carried_balance_applied: number;
    net_payable: number;
    total_paid: number;
    remaining_balance: number;
    effective_remaining_balance: number;
    is_absorbed: boolean;
    absorbed_by_settlement_id: number | null;
    absorbed_by_settlement_number: string | null;
    is_negative_balance: boolean;
  };
  absorbed_settlement_id: number | null;
  absorbed_settlement_ids?: number[];
  absorbed_by_settlement_id: number | null;
  absorbed_by_settlement_number: string | null;
  is_absorbed: boolean;
  notes: string | null;
  created_by: number;
  approved_by: number | null;
  cancelled_by: number | null;
  cancellation_reason: string | null;
  created_at: string;
  approved_at: string | null;
  cancelled_at: string | null;
  allocated_items_count: number;
  adjustments_count: number;
  payments_count: number;
  allocated_items?: SettlementAllocatedItemRecord[];
  adjustments?: SettlementAdjustmentRecord[];
}

export interface SettlementListResponse {
  employee_id: number;
  employee_name: string;
  count: number;
  settlements: SettlementRecord[];
}
