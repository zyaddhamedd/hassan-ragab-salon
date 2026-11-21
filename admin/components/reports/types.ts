export interface NamedOption {
  id: number;
  name: string;
}

export interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_more: boolean;
}

export interface MetricComparison {
  current: number;
  previous: number;
  absolute_change: number;
  percent_change: number | null;
}

export interface ReportInsight {
  code: string;
  text: string;
}

export interface AttentionSignal {
  code: string;
  entity_id?: number;
  label: string;
  detail: string;
  tone: 'neutral' | 'attention';
}

export interface ServiceRankRow {
  service_id: number;
  service_name: string;
  category_id: number;
  category_name: string;
  units: number;
  gross_value: number;
  average_price: number;
  contribution_percent: number;
  invoice_count: number;
  top_branch?: NamedOption | null;
  top_barber?: NamedOption | null;
}

export interface ServicesReportData {
  meta: {
    date_basis: string;
    date_from: string;
    date_to: string;
    previous_date_from: string;
    previous_date_to: string;
    currency: string;
    category_label_basis: string;
  };
  summary: {
    service_gross_value: number;
    service_units: number;
    average_realized_service_price: number;
    paid_invoice_count: number;
    period_change_percent: number | null;
    top_service: ServiceRankRow | null;
    top_category: ServiceCategoryRow | null;
  };
  comparison: {
    service_gross_value: MetricComparison;
    service_units: MetricComparison;
    paid_invoice_count: MetricComparison;
  };
  concentration: {
    top_one_service_share: number;
    top_three_services_share: number;
    top_category_share: number;
    top_branch_share: number;
  };
  insights: ReportInsight[];
  attention: AttentionSignal[];
  weak_services: Array<{
    service_id: number;
    service_name: string;
    category_id: number;
    category_name: string;
    current_units: number;
    current_gross_value: number;
    previous_units: number;
    previous_gross_value: number;
    percent_change: number | null;
    reason: 'ZERO_ACTIVITY' | 'LOW_ACTIVITY' | 'MATERIAL_DECLINE';
  }>;
  trend: Array<{ date: string; gross_value: number; units: number; paid_invoice_count: number }>;
  service_ranking: ServiceRankRow[];
  categories: ServiceCategoryRow[];
  branches: Array<{
    branch_id: number;
    branch_name: string;
    units: number;
    gross_value: number;
    contribution_percent: number;
  }>;
  barbers: Array<{
    barber_id: number;
    barber_name: string;
    units: number;
    gross_attributed_value: number;
    invoice_count: number;
    customer_count: number;
  }>;
  table: { items: ServiceRankRow[]; pagination: Pagination };
  filter_options: {
    categories: NamedOption[];
    services: Array<NamedOption & { category_id: number }>;
    barbers: NamedOption[];
    branches: NamedOption[];
  };
}

export interface ServiceCategoryRow {
  category_id: number;
  category_name: string;
  units: number;
  gross_value: number;
  contribution_percent: number;
}

export interface ServiceDrilldown {
  service: { id: number; name: string; category_name: string };
  summary: ServicesReportData['summary'];
  comparison: ServicesReportData['comparison'];
  analysis: {
    contribution_share: number;
    top_branch_share: number;
    top_barber_share: number;
    insights: ReportInsight[];
  };
  trend: ServicesReportData['trend'];
  branches: ServicesReportData['branches'];
  barbers: ServicesReportData['barbers'];
  recent_invoices: Array<{
    invoice_id: number;
    invoice_number: string | number;
    date: string | null;
    branch_name: string;
    barber_name: string | null;
    units: number;
    gross_value: number;
  }>;
}

export interface ProductReportRow {
  product_id: number;
  product_name: string;
  category: string | null;
  units_sold: number;
  gross_sales_value: number;
  average_selling_price: number;
  current_stock: number;
  stock_state: 'HEALTHY' | 'LOW' | 'OUT';
  min_stock_threshold: number;
  branches_carrying_stock: number;
  top_branch?: NamedOption | null;
  recent_activity_at?: string | null;
}

export interface ProductSalesRankRow {
  product_id: number;
  product_name: string;
  category: string | null;
  units_sold: number;
  gross_sales_value: number;
  average_selling_price: number;
  contribution_percent: number;
  invoice_count: number;
}

export interface ProductsReportData {
  meta: {
    sales_date_basis: string;
    movement_date_basis: string;
    inventory_basis: string;
    date_from: string;
    date_to: string;
    previous_date_from: string;
    previous_date_to: string;
    currency: string;
    category_label_basis: string;
  };
  comparison: {
    product_gross_sales_value: MetricComparison;
    product_units_sold: MetricComparison;
    paid_invoice_count: MetricComparison;
  };
  concentration: {
    top_one_product_share: number;
    top_three_products_share: number;
    top_branch_share: number;
  };
  insights: ReportInsight[];
  attention: AttentionSignal[];
  slow_movers: Array<ProductReportRow & { reason: 'LOW_MOVEMENT' }>;
  inventory_matrix: {
    sales_units_threshold: number;
    threshold_basis: string;
    quadrants: Array<{
      key: 'HIGH_SALES_LOW_STOCK' | 'HIGH_SALES_HEALTHY_STOCK' | 'LOW_SALES_HIGH_STOCK' | 'LOW_SALES_LOW_STOCK';
      label: string;
      count: number;
      items: Array<{
        product_id: number;
        product_name: string;
        units_sold: number;
        current_stock: number;
        stock_state: 'HEALTHY' | 'LOW' | 'OUT';
      }>;
    }>;
  };
  summary: {
    product_gross_sales_value: number;
    product_units_sold: number;
    paid_invoice_count: number;
    strongest_product: ProductSalesRankRow | null;
    low_stock_products: number;
    out_of_stock_products: number;
  };
  sales_trend: Array<{ date: string; gross_sales_value: number; units_sold: number }>;
  sales_ranking: ProductSalesRankRow[];
  branches: Array<{
    branch_id: number;
    branch_name: string;
    units_sold: number;
    gross_sales_value: number;
    contribution_percent: number;
  }>;
  inventory_health: {
    healthy: number;
    low: number;
    out: number;
    tracked_products: number;
    expired_units: number;
    expiring_within_30_days_units: number;
  };
  movements: Array<{ type: string; quantity: number }>;
  supply_context: {
    pending_supply_requests: number;
    in_transit_shipments: number;
    pending_returns: number;
  };
  table: { items: ProductReportRow[]; pagination: Pagination };
  filter_options: {
    categories: string[];
    products: Array<NamedOption & { category: string }>;
    branches: NamedOption[];
  };
}

export interface ProductDrilldown {
  product: { id: number; name: string; category: string; unit: string };
  summary: ProductsReportData['summary'];
  comparison: ProductsReportData['comparison'];
  stock_context: Pick<ProductReportRow, 'current_stock' | 'stock_state' | 'min_stock_threshold' | 'branches_carrying_stock'>;
  insights: ReportInsight[];
  attention: AttentionSignal[];
  sales_trend: ProductsReportData['sales_trend'];
  inventory_health: ProductsReportData['inventory_health'];
  movements_summary: ProductsReportData['movements'];
  supply_context: ProductsReportData['supply_context'];
  branch_stock: Array<{
    branch_id: number;
    branch_name: string;
    stock_quantity: number;
    is_available: boolean;
  }>;
  recent_movements: Array<{
    id: number;
    branch_name: string;
    type: string;
    quantity: number;
    created_at: string;
    invoice_id: number | null;
    notes: string | null;
  }>;
}

export type SalesPaymentMethod = 'CASH' | 'VISA' | 'INSTAPAY';

export interface SalesInvoiceRow {
  invoice_id: number;
  invoice_number: number | null;
  invoice_date: string | null;
  branch_name: string;
  customer_name: string;
  cashier_name: string;
  gross_sales: number;
  discount_amount: number;
  net_sales: number;
  payment_slices: Array<{ method: SalesPaymentMethod; amount: number }>;
  promo_code: string | null;
  is_fully_discounted: boolean;
  service_gross_value: number;
  product_gross_value: number;
  service_units: number;
  product_units: number;
}

export interface SalesReportData {
  meta: {
    date_basis: string;
    date_from: string;
    date_to: string;
    previous_date_from: string;
    previous_date_to: string;
    currency: string;
    item_mix_basis: string;
    payment_basis: string;
    cashier_basis: string;
  };
  summary: {
    gross_sales: number;
    discount_amount: number;
    net_sales: number;
    paid_invoice_count: number;
    average_ticket: number;
    discount_rate: number;
    discounted_invoice_count: number;
    fully_discounted_invoice_count: number;
    average_discount_per_discounted_invoice: number;
    identified_customer_invoice_count: number;
    anonymous_invoice_count: number;
  };
  comparison: {
    net_sales: MetricComparison;
    paid_invoice_count: MetricComparison;
    average_ticket: MetricComparison;
    discount_amount: MetricComparison;
  };
  drivers: {
    identity: string;
    invoice_count: MetricComparison;
    average_ticket: MetricComparison;
  };
  discounts: {
    total_discount_amount: number;
    discount_rate: number;
    previous_discount_rate: number;
    discount_rate_change_points: number;
    discounted_invoice_count: number;
    fully_discounted_invoice_count: number;
    average_discount_per_discounted_invoice: number;
  };
  trend: Array<{
    date: string;
    gross_sales: number;
    discount_amount: number;
    net_sales: number;
    paid_invoice_count: number;
    average_ticket: number;
  }>;
  branches: Array<{
    branch_id: number;
    branch_name: string;
    net_sales: number;
    paid_invoice_count: number;
    average_ticket: number;
    contribution_percent: number;
    comparison: MetricComparison;
  }>;
  payments: {
    methods: Array<{ method: SalesPaymentMethod; amount: number; share_percent: number }>;
    invoice_collections_total: number;
    split_payment_invoice_count: number;
    split_payment_rate: number;
    legacy_fallback_invoice_count: number;
    reconciliation_difference: number;
    basis: string;
  };
  mix: {
    basis: string;
    service_gross_value: number;
    product_gross_value: number;
    service_units: number;
    product_units: number;
    service_share_percent: number;
    product_share_percent: number;
  };
  promo: {
    paid_redemption_count: number;
    promo_discount_total: number;
    net_sales_on_redeemed_invoices: number;
    promo_invoice_share_percent: number;
    top_codes: Array<{ code: string; redemption_count: number; promo_discount_total: number; net_sales: number }>;
  };
  customers: {
    identified_invoice_count: number;
    anonymous_invoice_count: number;
    identified_invoice_share_percent: number;
    anonymous_invoice_share_percent: number;
    basis: string;
  };
  cashiers: Array<{
    cashier_id: number;
    cashier_name: string;
    net_sales_processed: number;
    paid_invoice_count: number;
    average_ticket: number;
  }>;
  top_service: { id: number; name: string; gross_value: number } | null;
  top_product: { id: number; name: string; gross_value: number } | null;
  concentration: {
    top_branch_share: number;
    top_three_branches_share: number;
    top_service_gross_share: number;
    top_product_gross_share: number;
    top_promo_redemption_share: number;
  };
  insights: ReportInsight[];
  attention: AttentionSignal[];
  table: { items: SalesInvoiceRow[]; pagination: Pagination };
  filter_options: {
    branches: NamedOption[];
    cashiers: NamedOption[];
    promo_codes: string[];
    payment_methods: SalesPaymentMethod[];
  };
}

export interface SalesDrilldown {
  invoice: {
    id: number;
    invoice_number: number | null;
    invoice_date: string | null;
    paid_at: string | null;
    business_day_id: number | null;
    branch_name: string;
    customer_name: string;
    customer_phone: string | null;
    cashier_name: string;
    gross_sales: number;
    discount_amount: number;
    net_sales: number;
    is_fully_discounted: boolean;
  };
  payments: {
    basis: string;
    slices: Array<{ method: SalesPaymentMethod; amount: number }>;
    total: number;
  };
  promo: { code: string; discount_amount: number; eligible_subtotal: number } | null;
  item_summary: Pick<SalesInvoiceRow, 'service_gross_value' | 'product_gross_value' | 'service_units' | 'product_units'>;
  items: Array<{
    id: number;
    item_type: 'SERVICE_ITEM' | 'PRODUCT_ITEM';
    name: string;
    quantity: number;
    unit_price: number;
    gross_value: number;
    barber_name: string | null;
  }>;
}

export type FinancePaymentMethod = 'CASH' | 'VISA' | 'INSTAPAY';

export interface FinanceBusinessDayRow {
  business_day_id: number;
  branch_id: number;
  branch_name: string;
  business_date: string;
  opened_at: string;
  closed_at: string | null;
  status: 'OPEN' | 'CLOSED';
  opening_balance: number;
  cash_invoice_collections: number;
  cash_deposit_collections: number;
  cash_out: number;
  recomputed_cash_out: number;
  theoretical_cash: number;
  recomputed_theoretical_cash: number;
  counted_cash: number | null;
  variance: number | null;
  calculation_basis: 'STORED_CLOSE_SNAPSHOT' | 'LIVE_RECOMPUTED';
  invoice_methods: Record<FinancePaymentMethod, number>;
  deposit_methods: Record<FinancePaymentMethod, number>;
}

export interface FinanceReportData {
  meta: {
    date_from: string;
    date_to: string;
    previous_date_from: string;
    previous_date_to: string;
    performance_date_basis: string;
    treasury_date_basis: string;
    currency: string;
  };
  summary: {
    gross_sales: number;
    discount_amount: number;
    net_sales: number;
    paid_invoice_count: number;
    operating_expenses: number;
    recorded_commission_cost: number;
    operating_contribution: number;
    operating_expense_ratio: number;
    contribution_ratio: number;
  };
  comparison: Record<'net_sales' | 'operating_expenses' | 'recorded_commission_cost' | 'operating_contribution' | 'invoice_collections' | 'deposit_collections', MetricComparison>;
  trend: Array<{ date: string; net_sales: number; operating_expenses: number }>;
  collections: {
    invoice_methods: Array<{ method: FinancePaymentMethod; amount: number; share_percent: number }>;
    deposit_methods: Array<{ method: FinancePaymentMethod; amount: number; share_percent: number }>;
    invoice_collections: number;
    deposit_collections: number;
    deposit_trend: Array<{ date: string; amount: number }>;
    total_collections: number;
    split_payment_invoice_count: number;
    split_payment_rate: number;
    legacy_fallback_invoice_count: number;
    invoice_reconciliation_difference: number;
    raw_tender: { visa: number; instapay: number; change_due: number; reconciliation_difference: number; basis: string };
    basis: string;
  };
  cash_out: {
    total: number;
    breakdown: Record<'operating' | 'advance' | 'commission_withdrawal' | 'overtime' | 'drawer_change' | 'other', number>;
    basis: string;
  };
  business_days: { items: FinanceBusinessDayRow[]; pagination: Pagination };
  insights: ReportInsight[];
  attention: AttentionSignal[];
  performance_table: {
    items: Array<{ date: string; branch_id: number; branch_name: string; net_sales: number; operating_expenses: number; recorded_commission_cost: number; operating_contribution: number }>;
    pagination: Pagination;
  };
  expenses_table: {
    items: Array<{ expense_id: number; date: string; branch_name: string; category_name: string; category_code: string; amount: number; is_business_expense: boolean; is_cash_event: boolean; business_day_id: number | null }>;
    pagination: Pagination;
  };
  deposits_table: {
    items: Array<{ transaction_id: number; date: string; created_at: string; branch_name: string; appointment_id: number; customer_name: string; method: FinancePaymentMethod; amount: number; business_day_id: number }>;
    pagination: Pagination;
  };
  filter_options: { expense_categories: NamedOption[]; business_day_statuses: Array<'OPEN' | 'CLOSED'> };
}

export interface FinanceBusinessDayDrilldown {
  business_day: FinanceBusinessDayRow;
  branch_name: string;
  cash_out_breakdown: FinanceReportData['cash_out']['breakdown'];
  invoices: Array<{ invoice_id: number; invoice_number: number | null; net_sales: number; change_due: number; payment_slices: Array<{ method: string; amount: number; entered_amount: number | null }>; basis: string }>;
  expenses: FinanceReportData['expenses_table']['items'];
  deposits: Array<{ transaction_id: number; appointment_id: number; customer_name: string; method: FinancePaymentMethod; amount: number }>;
  notes: string[];
}

export interface BranchPerformanceRow {
  branch_id: number;
  branch_name: string;
  is_active: boolean;
  gross_sales: number;
  discount_amount: number;
  net_sales: number;
  paid_invoice_count: number;
  average_ticket: number;
  operating_expenses: number;
  recorded_commission_cost: number;
  operating_contribution: number;
  expense_ratio: number | null;
  commission_ratio: number | null;
  contribution_ratio: number | null;
  scope_share_percent: number;
  low_base: boolean;
  ranking_eligible: Record<'average_ticket' | 'expense_ratio' | 'commission_ratio' | 'contribution_ratio' | 'growth', boolean>;
  comparison: Record<'net_sales' | 'paid_invoice_count' | 'average_ticket' | 'operating_expenses' | 'recorded_commission_cost' | 'operating_contribution', MetricComparison>;
  growth_driver: string;
  identified_customers: number;
  identified_invoice_count: number;
  mix: {
    service_gross_value: number;
    product_gross_value: number;
    service_units: number;
    product_units: number;
    service_share_percent: number;
    product_share_percent: number;
    top_services: BranchRankedEntity[];
    top_products: BranchRankedEntity[];
    top_barbers: Array<BranchRankedEntity & { paid_invoice_count: number; identified_customer_count: number }>;
    categories: Array<{ item_type: 'SERVICE' | 'PRODUCT'; name: string; gross_value: number; share_percent: number }>;
    top_service_share: number;
    top_three_service_share: number;
    top_product_share: number;
    top_three_product_share: number;
    top_barber_share: number;
  };
  payments: { methods: Record<FinancePaymentMethod, number>; split_payment_invoice_count: number; split_payment_rate: number };
  customers: { identified_invoice_share: number; anonymous_invoice_share: number; first_known: number; previously_known: number };
  attendance: { completed_sessions: number; recorded_hours: number; employees_with_attendance: number; checkout_sources: Record<string, number>; attributed_service_gross_per_recorded_hour: number | null };
  appointments: { scheduled: number; completed: number; cancelled: number; barber_linked: number; total: number; deposit_collections: number };
  treasury: { closed_days: number; open_overdue_days: number; material_variance_days: number; variance_frequency: number; variance_ranking_eligible: boolean; total_absolute_variance: number; largest_absolute_variance: number };
  inventory: { stock_units: number; low_stock_products: number; out_of_stock_products: number; expired_batch_units: number; near_expiry_batch_units: number; slow_moving_products: number; pending_supply_requests: number; inbound_transfers: number; outbound_transfers: number; pending_returns: number; top_selling_stock_risks: Array<{ product_id: number; name: string; current_stock: number; state: 'LOW' | 'OUT' }> };
}

export interface BranchRankedEntity {
  id: number;
  name: string;
  gross_value: number;
  units: number;
  share_percent: number;
}

export interface BranchReportData {
  meta: { date_from: string; date_to: string; previous_date_from: string; previous_date_to: string; date_basis: string; currency: string; low_base_invoice_threshold: number };
  summary: { branch_count: number; net_sales: number; paid_invoice_count: number; operating_expenses: number; recorded_commission_cost: number; operating_contribution: number };
  branches: BranchPerformanceRow[];
  daily_performance: Array<{ date: string; branch_id: number; branch_name: string; net_sales: number; paid_invoice_count: number; average_ticket: number; operating_expenses: number; recorded_commission_cost: number; operating_contribution: number }>;
  insights: ReportInsight[];
  attention: AttentionSignal[];
}

export type EmployeeReportMode = 'BARBER' | 'ASSISTANT' | 'CASHIER';

export interface EmployeeAttendanceContext {
  completed_sessions: number;
  recorded_workdays: number;
  recorded_hours: number;
  average_session_hours: number;
  incomplete_sessions: number;
  checkout_sources: Record<'MANUAL' | 'BUSINESS_DAY_CLOSE' | 'ADMIN_CORRECTION', number>;
  attendance_coverage: number;
}

export interface EmployeeFinancialActionsContext {
  ADVANCE: { amount: number; count: number };
  DEDUCTION: { amount: number; count: number };
  COMMISSION_WITHDRAWAL: { amount: number; count: number };
  OVERTIME: { amount: number; count: number };
  MANUAL_ADJUSTMENT: { amount: number; count: number };
}

export interface ServiceEmployeeRow {
  employee_id: number;
  employee_name: string;
  current_role: string | null;
  current_branch_id: number;
  current_branch_name: string | null;
  current_status: string;
  is_active: boolean;
  is_deleted: boolean;
  gross_service_value: number;
  service_units: number;
  paid_invoice_count: number;
  identified_customer_count: number;
  average_gross_per_unit: number;
  average_gross_per_invoice: number;
  service_commission_accrued: number;
  current_wallet: number | null;
  current_base_salary: number | null;
  low_base: boolean;
  ranking_eligible: Record<'gross_service_value' | 'average_gross_per_unit' | 'average_gross_per_invoice' | 'identified_customer_count' | 'attendance_hours' | 'gross_per_recorded_hour' | 'growth', boolean>;
  comparison: Record<'gross_service_value' | 'service_units' | 'paid_invoice_count' | 'identified_customer_count' | 'service_commission_accrued', MetricComparison>;
  top_services: Array<{ service_id: number; service_name: string; category_id: number; category_name: string; gross_value: number; units: number; average_gross_per_unit: number; share_percent: number }>;
  categories: Array<{ category_id: number; category_name: string; gross_value: number; units: number; share_percent: number }>;
  top_service_share: number;
  top_three_service_share: number;
  customer_context: { repeat_identified_customers: number; previously_recorded_customers: number };
  transaction_branches: Array<{ branch_id: number; branch_name: string; gross_value: number; units: number }>;
  attendance: EmployeeAttendanceContext;
  gross_per_recorded_hour: number | null;
  products: { gross_product_value: number; product_units: number; product_commission_accrued: number; top_products: Array<{ product_id: number; product_name: string; gross_value: number; units: number; commission_accrued: number }> };
  appointments: { assigned: number; scheduled: number; completed: number; cancelled: number; future: number; with_deposit: number; service_mix: Array<{ name: string; count: number }> };
  financial_actions: EmployeeFinancialActionsContext;
}

export interface CashierEmployeeRow {
  employee_id: number;
  employee_name: string;
  current_role: string | null;
  current_branch_id: number;
  current_branch_name: string | null;
  current_status: string;
  is_active: boolean;
  is_deleted: boolean;
  paid_invoices_finalized: number;
  net_sales_finalized: number;
  average_ticket_finalized: number;
  current_wallet: number | null;
  current_base_salary: number | null;
  comparison: Record<'paid_invoices_finalized' | 'net_sales_finalized' | 'average_ticket_finalized', MetricComparison>;
  payments: { methods: Record<'CASH' | 'VISA' | 'INSTAPAY', number>; shares: Record<'CASH' | 'VISA' | 'INSTAPAY', number>; split_payment_invoice_count: number; split_payment_rate: number };
  operations: { promo_redemptions_confirmed: number; deposit_collections: number; deposit_collection_count: number; business_days_opened: number; business_days_closed: number; closed_day_variance: number; closed_day_absolute_variance: number; audit_event_count: number; audit_events: Record<string, number> };
  transaction_branches: Array<{ branch_id: number; branch_name: string; paid_invoice_count: number; net_sales_finalized: number }>;
  attendance: EmployeeAttendanceContext;
  financial_actions: EmployeeFinancialActionsContext;
}

export interface EmployeeReportData {
  meta: { mode: EmployeeReportMode; date_from: string; date_to: string; previous_date_from: string; previous_date_to: string; date_basis: string; currency: string; wallet_visible: boolean; commission_basis?: string; cashier_basis?: string };
  summary: Record<string, number>;
  comparison: Record<string, MetricComparison>;
  payments?: SalesReportData['payments'];
  trend: Array<Record<string, string | number>>;
  insights: ReportInsight[];
  attention: AttentionSignal[];
  table: { items: Array<ServiceEmployeeRow | CashierEmployeeRow>; pagination: Pagination };
  filter_options: { employees: NamedOption[]; services: Array<NamedOption & { category_id: number }>; categories: NamedOption[] };
}

export interface EmployeeDrilldown {
  meta: EmployeeReportData['meta'];
  employee: ServiceEmployeeRow | CashierEmployeeRow;
  trend: EmployeeReportData['trend'];
  insights: ReportInsight[];
  attention: AttentionSignal[];
}

export type CustomerCohort = 'FIRST_KNOWN' | 'PREVIOUSLY_KNOWN';
export type CustomerRecencyBucket = '0_30' | '31_60' | '61_90' | '91_PLUS';
export type CustomerRepeatFilter = 'BEHAVIORAL' | 'TRANSACTION' | 'NON_REPEAT';

export interface CustomerServicePreference {
  service_id: number;
  service_name: string;
  category_id: number;
  category_name: string;
  units: number;
  gross_value: number;
  invoice_count: number;
}

export interface CustomerProductPreference {
  product_id: number;
  product_name: string;
  units: number;
  gross_value: number;
  invoice_count: number;
}

export interface CustomerBarberAffinity {
  barber_id: number;
  barber_name: string;
  service_units: number;
  gross_service_value: number;
  service_invoice_count: number;
  affinity_share: number;
  eligible: boolean;
}

export interface CustomerReportRow {
  customer_id: number;
  customer_name: string;
  phone: string;
  record_branch_id: number;
  record_branch_name: string;
  operational_status: 'ACTIVE' | 'INACTIVE';
  gross_spend: number;
  discount_amount: number;
  net_spend: number;
  paid_invoice_count: number;
  paid_date_count: number;
  average_ticket: number | null;
  low_base: boolean;
  cohort: CustomerCohort;
  transaction_repeat: boolean;
  behavioral_repeat: boolean;
  first_paid_date: string | null;
  last_paid_date: string | null;
  recency_days: number | null;
  recency_bucket: CustomerRecencyBucket | null;
  average_paid_day_interval: number | null;
  recorded_lifetime_net_spend: number;
  lifetime_paid_invoice_count: number;
  lifetime_paid_date_count: number;
  dormant: boolean;
  top_service: CustomerServicePreference | null;
  top_product: CustomerProductPreference | null;
  top_barber_affinity: CustomerBarberAffinity | null;
  service_preferences: CustomerServicePreference[];
  category_preferences: Array<{ category_id: number; category_name: string; units: number; gross_value: number }>;
  product_preferences: CustomerProductPreference[];
  barber_affinity: CustomerBarberAffinity[];
  appointments: { scheduled: number; completed: number; cancelled: number; future_scheduled: number; with_deposit: number };
  promo: { redemption_count: number; paid_promo_invoice_count: number; promo_discount_amount: number; net_sales_on_promo_invoices: number; invoice_share: number };
  deposits: { collection_count: number; collection_amount: number };
  recorded_current_deposit_balance: number;
}

export interface CustomerReportData {
  meta: {
    date_from: string;
    date_to: string;
    previous_date_from: string;
    previous_date_to: string;
    date_basis: string;
    currency: string;
    identity_basis: string;
    spend_basis: string;
    repeat_basis: string;
    lifetime_basis: string;
    dormancy_days: number;
  };
  summary: {
    identified_customers: number;
    identified_invoice_share: number;
    identified_net_spend: number;
    identified_net_sales_share: number;
    paid_invoice_count: number;
    average_ticket: number | null;
    first_known_customers: number;
    previously_known_customers: number;
    transaction_repeat_customers: number;
    repeat_paid_day_customers: number;
    repeat_share: number;
    distinct_paid_dates: number;
    average_paid_day_interval: number | null;
    known_as_of_customers: number;
    dormant_customers: number;
    anonymous_invoice_count: number;
    anonymous_invoice_share: number;
  };
  coverage: {
    paid_invoice_count: number;
    identified_invoice_count: number;
    anonymous_invoice_count: number;
    identified_invoice_share: number;
    anonymous_invoice_share: number;
    total_net_sales: number;
    identified_net_spend: number;
    identified_net_sales_share: number;
  };
  comparison: Record<string, MetricComparison>;
  cohorts: { first_known: number; previously_known: number };
  recency_distribution: Record<CustomerRecencyBucket, number>;
  frequency_distribution: Record<'1' | '2' | '3_5' | '6_PLUS', number>;
  concentration: { top_one_share: number; top_five_share: number; top_ten_share: number; denominator: string };
  rankings: {
    selected_period_net_spend: Array<Pick<CustomerReportRow, 'customer_id' | 'customer_name' | 'record_branch_name' | 'net_spend' | 'paid_invoice_count' | 'paid_date_count' | 'recency_days'>>;
    recorded_lifetime_net_spend: Array<Pick<CustomerReportRow, 'customer_id' | 'customer_name' | 'record_branch_name' | 'recorded_lifetime_net_spend' | 'lifetime_paid_invoice_count' | 'recency_days'>>;
  };
  dormancy: {
    threshold_days: number;
    known_as_of_count: number;
    dormant_count: number;
    customers: Array<Pick<CustomerReportRow, 'customer_id' | 'customer_name' | 'record_branch_name' | 'recorded_lifetime_net_spend' | 'lifetime_paid_invoice_count' | 'last_paid_date' | 'recency_days'>>;
  };
  preferences: {
    services: Array<{ service_id: number; service_name: string; units: number; gross_value: number; invoice_count: number }>;
    products: Array<{ product_id: number; product_name: string; units: number; gross_value: number; invoice_count: number }>;
    barbers: Array<{ barber_id: number; barber_name: string; service_units: number; gross_service_value: number; customer_count: number }>;
    product_active_customers: number;
    service_only_customers: number;
  };
  segments: Array<{ code: string; label: string; count: number; rule: string }>;
  insights: ReportInsight[];
  attention: AttentionSignal[];
  data_quality: { missing_invoice_date_count: number; branch_customer_mismatch_count: number; suspected_same_branch_phone_duplicate_groups: number; anonymous_paid_invoices: number };
  table: { items: CustomerReportRow[]; pagination: Pagination };
  filter_options: {
    services: Array<NamedOption & { category_id: number }>;
    categories: NamedOption[];
    barbers: NamedOption[];
    products: Array<NamedOption & { category: string }>;
    product_categories: string[];
    promo_codes: string[];
    dormancy_options: number[];
  };
}

export interface CustomerDrilldown {
  meta: CustomerReportData['meta'];
  customer: CustomerReportRow;
  paid_activity: Array<{ invoice_id: number; invoice_number: number | string; date: string; branch_name: string; gross: number; discount: number; net: number }>;
  lifetime_average_paid_day_interval: number | null;
  promo_codes: Array<{ code: string; redemption_count: number; discount_amount: number }>;
  deposit_methods: Array<{ method: string; collection_count: number; collection_amount: number }>;
}

export type OverviewDestination = 'sales' | 'finance' | 'branches' | 'customers' | 'services' | 'products' | 'employees' | 'operations';

export interface OverviewReportData {
  meta: {
    date_from: string;
    date_to: string;
    previous_date_from: string;
    previous_date_to: string;
    date_basis: string;
    timezone: string;
    currency: 'EGP';
    authorized_branch_ids: number[];
    branches: NamedOption[];
    branch_scope_mode: 'FIXED' | 'SELECTABLE';
    snapshot_as_of: string;
  };
  summary: {
    gross_sales: number;
    discount_amount: number;
    net_sales: number;
    paid_invoice_count: number;
    average_ticket: number;
    discount_rate: number;
    discounted_invoice_count: number;
    fully_discounted_invoice_count: number;
    average_discount_per_discounted_invoice: number;
    identified_customer_invoice_count: number;
    anonymous_invoice_count: number;
    operating_expenses: number;
    recorded_commission_cost: number;
    operating_contribution: number;
    operating_expense_ratio: number;
    contribution_ratio: number;
  };
  comparison: {
    net_sales: MetricComparison;
    paid_invoice_count: MetricComparison;
    average_ticket: MetricComparison;
    discount_amount: MetricComparison;
    operating_expenses: MetricComparison;
    recorded_commission_cost: MetricComparison;
    operating_contribution: MetricComparison;
  };
  drivers: {
    identity: string;
    text: string;
    invoice_count: MetricComparison;
    average_ticket: MetricComparison;
  };
  trend: Array<{
    period_index: number;
    date: string;
    previous_date: string;
    net_sales: number;
    previous_net_sales: number;
    gross_sales: number;
    discount_amount: number;
    paid_invoice_count: number;
    average_ticket: number;
  }>;
  branches: Array<{
    branch_id: number;
    branch_name: string;
    net_sales: number;
    paid_invoice_count: number;
    average_ticket: number;
    contribution_percent: number;
    comparison: MetricComparison;
  }>;
  branch_count: number;
  mix: {
    basis: string;
    service_gross_value: number;
    product_gross_value: number;
    service_units: number;
    product_units: number;
    service_share_percent: number;
    product_share_percent: number;
    top_service: { id: number; name: string; gross_value: number } | null;
    top_product: { id: number; name: string; gross_value: number } | null;
  };
  customers: {
    identified_customers: number;
    identified_invoice_coverage: number;
    repeat_paid_day_share: number;
    comparison: {
      identified_invoice_coverage: MetricComparison;
      repeat_paid_day_share: MetricComparison;
    };
    identity_basis: string;
    repeat_basis: string;
  };
  team: {
    attributed_barber_count: number;
    recorded_commission_cost: number;
    leading_barber: {
      employee_id: number;
      employee_name: string;
      gross_service_value: number;
      share_percent: number;
    } | null;
    narrative: string | null;
  };
  current_conditions: {
    as_of: string;
    business_days: { currently_open: number; old_open: number };
    appointments: { count: number; past_still_scheduled: number; status_basis: string };
    inventory: {
      low: number;
      out: number;
      negative: number;
      basis: 'CURRENT_SNAPSHOT';
      high_selling_stock_risks: OperationsInventoryRow[];
    };
  };
  insights: ReportInsight[];
  signals: Array<{
    code: string;
    level: 'ATTENTION' | 'REVIEW' | 'CONTEXT';
    category: 'COMMERCIAL' | 'FINANCIAL' | 'BRANCH' | 'CUSTOMER' | 'OPERATIONAL' | 'INVENTORY';
    title: string;
    detail: string;
    destination: OverviewDestination;
    entity_id?: number;
    snapshot?: boolean;
  }>;
  reconciliation: Record<string, number>;
}

export interface OperationsReportData {
  meta: {
    date_from: string;
    date_to: string;
    previous_date_from: string;
    previous_date_to: string;
    attendance_date_basis: string;
    appointment_date_basis: string;
    timestamp_timezone: string;
    inventory_basis: 'CURRENT_SNAPSHOT';
    appointment_status_basis: 'CURRENT_STORED_STATUS';
    deposit_basis: 'COLLECTION_ONLY';
  };
  summary: {
    completed_sessions: number;
    recorded_hours: number;
    appointment_count: number;
    appointment_completion_share: number;
    deposit_collection_count: number;
    deposit_collection_amount: number;
    old_open_business_days: number;
    current_low_stock_products: number;
    current_out_of_stock_products: number;
  };
  comparison: Record<string, MetricComparison>;
  attendance: {
    completed_sessions: number;
    incomplete_sessions: number;
    recorded_hours: number;
    average_session_hours: number;
    recorded_workdays: number;
    linked_workdays: number;
    legacy_workdays: number;
    present_now: number;
    checkout_sources: Record<string, number>;
    controls: {
      present_on_closed_day: number;
      overlapping_sessions: number;
      invalid_duration_sessions: number;
      missing_business_day_link: number;
      repeated_corrections: Array<{ employee_id: number; employee_name: string; completed_sessions: number; admin_corrections: number; correction_share: number }>;
    };
  };
  business_days: {
    opened: number;
    closed: number;
    currently_open: number;
    old_open: number;
    average_closed_duration_hours: number;
    days_with_admin_corrections: number;
    open_days_with_active_attendance: number;
    continuity: Record<string, number>;
    items: Array<{ business_day_id: number; branch_id: number; branch_name: string; status: string; business_date: string; opened_at: string; closed_at: string | null; duration_hours: number; opened_by: string; closed_by: string | null; attendance_sessions: number; auto_checkouts: number; admin_corrections: number; active_attendance: number; variance: number | null; old_open: boolean }>;
    pagination: OperationsPagination;
  };
  appointments: {
    count: number;
    scheduled: number;
    completed: number;
    cancelled: number;
    scheduled_share: number;
    completed_share: number;
    cancelled_share: number;
    future_scheduled: number;
    past_still_scheduled: number;
    assigned_count: number;
    status_basis: string;
    by_barber: Array<{ barber_id: number; barber_name: string; appointments: number; scheduled: number; completed: number; cancelled: number; future_scheduled: number }>;
    items: Array<{ appointment_id: number; date: string; time: string; branch_name: string; customer_name: string; barber_name: string | null; service_name: string | null; status: string; deposit_amount: number; deposit_collection_count: number }>;
    pagination: OperationsPagination;
  };
  deposits: { collection_count: number; collection_amount: number; lifecycle_basis: string; methods: Array<{ method: string; count: number; amount: number }>; trend: Array<{ date: string; count: number; amount: number }> };
  promo: { redemption_count: number; promo_invoice_share: number; discount_amount: number; net_sales: number; codes: Array<{ code: string; redemptions: number; discount_amount: number; net_sales: number }>; branches: Array<{ branch_id: number; branch_name: string; redemptions: number; discount_amount: number }>; customer_context: { first_known: number; previously_known: number; anonymous: number }; eligible_categories: Array<{ category_name: string; eligible_units: number; eligible_value: number }>; anomalies: Record<string, number> };
  inventory: {
    current_stock_units: number;
    tracked_rows: number;
    healthy: number;
    low: number;
    out: number;
    negative: number;
    unavailable: number;
    slow_moving: number;
    batch_mismatch_count: number;
    high_selling_cutoff_units: number;
    slow_moving_max_units: number;
    reconciliation: Record<string, number>;
    high_selling_stock_risks: OperationsInventoryRow[];
    items: OperationsInventoryRow[];
    pagination: OperationsPagination;
  };
  movements: { types: Array<{ type: string; events: number; absolute_quantity: number }>; internal_consumption_units: number; adjustment_events: number; adjustment_absolute_quantity: number; adjustment_direction_available: boolean; items: Array<{ movement_id: number; date: string; branch_name: string; product_name: string; type: string; quantity: number; actor_name: string | null; invoice_id: number | null; notes: string | null }>; pagination: OperationsPagination };
  supply: { created: number; current_pending: number; sent: number; received: number; requested_units: number; final_units: number; average_created_to_sent_hours: number | null; average_sent_to_received_hours: number | null; average_created_to_received_hours: number | null; oldest_pending: { request_id: number; request_ref: string; created_at: string } | null; items: Array<{ request_id: number; request_ref: string; branch_name: string; status: string; creator_name: string; created_at: string; sent_at: string | null; shipment_id: number | null; shipment_ref: string | null; requested_units: number; final_units: number }>; pagination: OperationsPagination };
  shipments: { outbound_created: number; outbound_units: number; inbound_created: number; inbound_units: number; received: number; received_units: number; current_in_transit: number; average_receipt_duration_hours: number | null; in_transit: Array<{ shipment_id: number; shipment_ref: string; source_name: string | null; destination_name: string; units: number; created_at: string; age_days: number }>; items: Array<{ shipment_id: number; shipment_ref: string; shipment_type: string; status: string; source_name: string | null; destination_name: string; units: number; created_at: string; received_at: string | null; duration_hours: number | null }>; pagination: OperationsPagination };
  returns: { current_pending: number; returned_to_main: number; returned_to_supplier: number; rejected: number; returned_units: number; average_resolution_hours: number | null; reason_mix: Array<{ reason: string; requests: number; units: number }>; items: Array<{ return_id: number; return_ref: string; branch_name: string; product_name: string; quantity: number; reason: string; status: string; creator_name: string; resolver_name: string | null; created_at: string; resolved_at: string | null; duration_hours: number | null }>; pagination: OperationsPagination };
  attention: AttentionSignal[];
}

export interface OperationsPagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_more: boolean;
}

export interface OperationsInventoryRow {
  stock_id: number;
  branch_id: number;
  branch_name: string;
  product_id: number;
  product_name: string;
  category: string | null;
  current_stock: number;
  min_stock_threshold: number;
  state: 'HEALTHY' | 'LOW' | 'OUT' | 'NEGATIVE';
  is_available: boolean;
  units_sold: number;
  slow_moving: boolean;
  high_selling_stock_risk: boolean;
  tracked_batch_quantity: number;
  batch_mismatch: boolean;
}

export type OperationsDrilldown = Record<string, unknown>;

export interface ReportDateRange {
  dateFrom: string;
  dateTo: string;
}
