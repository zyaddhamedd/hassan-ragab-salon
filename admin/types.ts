
// Add missing React import to resolve namespace errors for ReactNode
import React from 'react';

export interface Branch {
  id: number;
  name: string;
  city?: string;
  is_active?: boolean;
  is_main_warehouse?: boolean;
  authorized_device_id?: string | null;
  binding_ip?: string | null;
  binding_user_agent?: string | null;
  binding_timestamp?: string | null;
  device_security?: BranchDeviceSecuritySnapshot;
}

export interface RegisteredMiniDevice {
  id: number | null;
  device_id: string;
  device_label: string | null;
  device_type: 'DESKTOP' | 'MOBILE' | 'TABLET';
  access_mode: 'FULL_MINI' | 'INVENTORY_ONLY';
  is_active: boolean;
  last_seen_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  revoked_at?: string | null;
  last_seen_ip?: string | null;
  last_seen_user_agent?: string | null;
  device_summary?: string | null;
  credential_state: 'LEGACY' | 'PENDING_FINALIZATION' | 'CREDENTIAL_ENABLED' | 'REVOKED';
  proof_state: 'CREDENTIAL_ONLY' | 'PENDING_FINALIZATION' | 'PROOF_ENABLED' | 'REVOKED';
  proof_key_version?: number | null;
  proof_key_registered_at?: string | null;
  last_proof_verified_at?: string | null;
  repair_authorized_at?: string | null;
  repair_expires_at?: string | null;
}

export interface PendingMiniDeviceEnrollment {
  id: number;
  branch_id: number;
  device_id: string;
  status: 'PENDING' | 'APPROVED' | 'EXPIRED' | 'REJECTED';
  expires_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  requested_ip?: string | null;
  requested_user_agent?: string | null;
  device_summary?: string | null;
  suggested_device_type?: 'DESKTOP' | 'MOBILE' | 'TABLET';
}

export interface BranchDeviceSecuritySnapshot {
  active_device_count: number;
  max_active_devices: number;
  registered_devices: RegisteredMiniDevice[];
  pending_enrollments: PendingMiniDeviceEnrollment[];
  secure_device_count: number;
  proof_enabled_device_count: number;
  legacy_device_count: number;
  pending_finalization_count: number;
  revoked_device_count: number;
  legacy_fallback_device_count: number;
  security_available: boolean;
  migration_complete: boolean;
  legacy_compatibility_enabled: boolean;
}

export interface KPIData {
  label: string;
  value: string;
  change: string;
  isPositive: boolean;
}

export interface RevenueData {
  name: string;
  revenue: number;
}

export interface BranchPerformance {
  branch: string;
  sales: number;
  customers: number;
}

export interface Alert {
  id: string;
  title: string;
  description: string;
  type: 'warning' | 'critical';
  date: string;
}

export interface Insight {
  label: string;
  value: string;
  icon: React.ReactNode;
}

export interface Category {
  id: string;
  name: string;
  order: number;
  commissionType?: 'barber_only' | 'barber_and_assistant';
}

export interface Service {
  id: string;
  name: string;
  price: number;
  commission: number | null;
  barber_commission_percent: number | null;
  assistant_commission_percent?: number | null;
  category: string;
  category_name?: string;
  commission_type?: string;
  type?: 'فردية' | 'باقة' | 'VIP';
  is_active?: boolean;
}

export type EmployeeRole = 'BARBER' | 'ASSISTANT' | 'CASHIER' | 'ADMIN' | 'STAFF';

export const ROLE_LABELS: Record<EmployeeRole, string> = {
  BARBER: 'مصفف',
  ASSISTANT: 'مساعد',
  CASHIER: 'كاشير',
  ADMIN: 'إدارة',
  STAFF: 'موظف'
};
export type EmployeeStatus = 'نشط' | 'موقوف';

export interface TransferRecord {
  id: string;
  branch: string;
  startDate: string;
  endDate: string;
  operationsCount: number;
  totalEarnings: number;
}

export interface OperationLog {
  id: string;
  date: string;
  itemType?: 'SERVICE_ITEM' | 'PRODUCT_ITEM';
  serviceName: string;
  productName?: string | null;
  servicePercentage: number;
  invoiceNumber: string;
  branch: string;
  value: number;
  share: number;
  role?: 'BARBER' | 'ASSISTANT';
}

export interface DeductionRecord {
  id: string;
  date: string;
  reason: string;
  amount: number;
  note?: string;
  notes?: string;
  approvedBy?: string;
}

export interface AdvanceRecord {
  id: string;
  date: string;
  amount: number;
  status: string;
  note: string;
  remainingBalance?: number;
}

export interface OvertimeRecord {
  id: string | number;
  employee_id?: number;
  amount: number;
  reason?: string | null;
  date: string;
  created_at: string;
}

export interface EmployeeDocument {
  id: string;
  name: string;
  type: 'بطاقة شخصية' | 'فيش وتشبيه' | 'مستندات إدارية أخرى';
  uploadDate: string;
  fileUrl: string;
  size?: string;
}

export interface Employee {
  id: string;
  internalId: string;
  name: string;
  phone: string;
  role: EmployeeRole;
  branch: string;
  status: EmployeeStatus;
  employmentDate: string;
  avatarColor?: string;
  photoUrl?: string;
  operationsLog?: OperationLog[];
  transferHistory?: TransferRecord[];
  deductions?: DeductionRecord[];
  advances?: AdvanceRecord[];
  overtimes?: OvertimeRecord[];
  documents?: EmployeeDocument[];
  baseSalary: number;
  commission_wallet_balance?: number;
  lastNetPaid: number;
  lastPayDate: string;
  currentNetBalance?: number;
  notes?: string;
  branch_id?: string;
  is_deleted?: boolean;
  createdAt?: string;
}

export interface PaginatedHistoryResponse<T> {
  items: T[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_more: boolean;
}

export interface EmployeeSummaryResponse {
  id: number;
  full_name: string;
  phone?: string | null;
  role: EmployeeRole;
  branch_id: number;
  branch_name: string;
  base_salary: number;
  commission_wallet_balance: number;
  is_active: boolean;
  status: string;
  is_deleted: boolean;
  created_at?: string | null;
  image_url?: string | null;
  documents: EmployeeDocument[];
  header_stats: {
    total_service_invoices: number;
  };
  branch_options: string[];
}

export interface EmployeeLedgerSummaryResponse {
  service_operations_count: number;
  total_service_value: number;
  total_service_share: number;
  product_sales_count: number;
  product_commission_total: number;
}

export interface EmployeeLedgerPageResponse extends PaginatedHistoryResponse<OperationLog> {
  summary: EmployeeLedgerSummaryResponse;
}

export interface EmployeeTransferPageResponse extends PaginatedHistoryResponse<TransferRecord> { }

export interface EmployeeAdvancePageResponse extends PaginatedHistoryResponse<AdvanceRecord> {
  summary: {
    total_amount: number;
  };
}

export interface EmployeeDeductionPageResponse extends PaginatedHistoryResponse<DeductionRecord> {
  summary: {
    total_amount: number;
  };
}

export interface EmployeeOvertimePageResponse extends PaginatedHistoryResponse<OvertimeRecord> {
  summary: {
    total_amount: number;
  };
}

export interface VisitRecord {
  id: string;
  date: string;
  branch: string;
  employeeName: string;
  services: string[];
  total: number;
}

export interface Client {
  id: string;
  name: string;
  photoUrl?: string;
  phone: string;
  starredBranches: string[];
  visits: number;
  totalSpend: number;
  lastVisit: string;
  primaryBranch: string;
  lastBarberName?: string | null;
  last_barber_name?: string | null;
  customerSince?: string | null;
  depositBalance?: number;
  avatarColor?: string;
  recentVisits?: VisitRecord[];
  notes?: string;
}

export interface InvoiceParticipant {
  id: string;
  employeeName: string;
  role: EmployeeRole;
  commission: number;
  share: number;
  isPayable: boolean;
}

export interface InvoiceItem {
  id: string;
  item_type?: 'SERVICE_ITEM' | 'PRODUCT_ITEM';
  service_id: string | null;
  category_id?: string;
  serviceName: string;
  product_id?: number | null;
  product_name?: string | null;
  price: number;
  employeeName?: string;
  assigned_employee_id?: number | null;
  assigned_employee_name?: string | null;
  barber_commission_percent?: number;
  assistant_commission_percent?: number;
  commission?: number;
  share?: number;
  sales_commission_percent?: number;
  sales_commission_amount?: number;
  participants?: InvoiceParticipant[];
}

export interface InvoiceBarberPreview {
  id: number;
  name: string;
}

export interface PromoInvoiceData {
  code: string;
  discount_type: 'PERCENTAGE' | 'FIXED_EGP';
  configured_value: string;
  eligible_subtotal: number;
  discount_amount: number;
  version: number;
}

export interface Invoice {
  id: string;
  number: string;
  business_day_id?: number | null;
  client: string;
  cashier: string;
  barber?: string | null;
  barbers?: InvoiceBarberPreview[];
  barber_count?: number;
  branch: string;
  method: string;
  status: 'مدفوعة' | 'معلقة' | 'مسودة غير مكتملة' | 'ملغاة';
  status_code?: 'DRAFT' | 'DRAFT_COMMITTED' | 'PAID' | 'CANCELED';
  draft_state?: 'ACTIVE_DRAFT' | 'EMPTIED_DRAFT' | null;
  last_gross_before_emptying?: number | null;
  type: 'عادية' | 'بخصم' | 'معلقة';
  amount: number;
  deposit_settlement?: { appointment_id: number | null; applied_amount: number; new_collection_amount: number; remaining_unpaid: number | null };
  discountAmount?: number;
  promo?: PromoInvoiceData | null;
  promo_code?: string | null;
  customer_name?: string;
  customer_phone?: string;
  date: string;
  items?: InvoiceItem[];
  payments?: { method: string; amount: number; entered_amount?: number }[];
}

export type InvoiceAuditEventType =
  | 'DRAFT_CREATED'
  | 'ITEM_ADDED'
  | 'ITEM_UPDATED'
  | 'ITEM_REMOVED'
  | 'DRAFT_COMMITTED'
  | 'INVOICE_PAID'
  | 'INVOICE_DELETED'
  | string;

export interface InvoiceAuditItemSnapshot {
  item_type?: 'SERVICE_ITEM' | 'PRODUCT_ITEM' | string | null;
  catalog_name?: string | null;
  quantity?: number | null;
  unit_price?: string | null;
  line_total?: string | null;
  barber_name?: string | null;
  assistant_name?: string | null;
  seller_name?: string | null;
}

export interface InvoiceAuditPaymentSnapshot {
  method?: string | null;
  amount?: string | null;
  entered_amount?: string | null;
}

export interface InvoiceAuditDiscountSnapshot {
  source?: string | null;
  type?: string | null;
  configured_value?: string | null;
  amount?: string | null;
  promo_code?: string | null;
}

export interface InvoiceAuditPayload extends InvoiceAuditItemSnapshot {
  before?: InvoiceAuditItemSnapshot;
  after?: InvoiceAuditItemSnapshot;
  status?: string | null;
  previous_status?: string | null;
  new_status?: string | null;
  item_count?: number | null;
  gross_amount?: string | null;
  invoice_number?: number | null;
  invoice_date?: string | null;
  gross_total?: string | null;
  discount?: InvoiceAuditDiscountSnapshot | null;
  net_total?: string | null;
  payments?: InvoiceAuditPaymentSnapshot[];
  business_day_id?: number | null;
  is_fully_discounted?: boolean | null;
}

export interface InvoiceAuditEvent {
  id: number;
  sequence_number: number;
  event_type: InvoiceAuditEventType;
  occurred_at: string | null;
  source: string;
  actor: {
    display_name: string;
    role?: string | null;
    is_invoice_owner: boolean;
  };
  invoice_owner: { display_name: string };
  gross_before?: string | null;
  gross_after?: string | null;
  payload: InvoiceAuditPayload;
}

export interface InvoiceAuditTimelineResponse {
  invoice_id: number;
  audit_history_available: boolean;
  events_truncated: boolean;
  events: InvoiceAuditEvent[];
}

export type InvoiceExportMode = 'invoice_summary';

export type InvoiceExportColumnKey =
  | 'invoice_number'
  | 'business_day_id'
  | 'invoice_date'
  | 'invoice_time'
  | 'created_at'
  | 'branch'
  | 'customer_name'
  | 'customer_phone'
  | 'cashier'
  | 'barbers'
  | 'barber_count'
  | 'type'
  | 'status'
  | 'payment_method'
  | 'subtotal'
  | 'discount_amount'
  | 'deposit_applied'
  | 'new_collection'
  | 'final_total'
  | 'cash_paid'
  | 'visa_paid'
  | 'instapay_paid'
  | 'net_collected'
  | 'promo_code'
  | 'promo_discount'
  | 'promo_type'
  | 'promo_eligible_subtotal';

export type InvoiceExportTypeFilter = 'جميع الفواتير' | 'عادية' | 'بخصم' | 'معلقة';
export type InvoiceExportStatusFilter = 'PAID' | 'DRAFT' | 'DRAFT_COMMITTED' | 'CANCELED';
export type InvoiceExportPaymentMethodFilter = 'CASH' | 'VISA' | 'VISA_1' | 'VISA_2' | 'INSTAPAY';
export type InvoiceExportColumnCategory = 'invoice' | 'people' | 'financial';

export interface InvoiceExportFiltersPayload {
  branch_id?: number;
  barber_id?: number;
  cashier_id?: number;
  business_day_id?: number;
  payment_method?: InvoiceExportPaymentMethodFilter;
  type?: InvoiceExportTypeFilter;
  status?: InvoiceExportStatusFilter;
  search?: string;
}

export interface InvoiceExportRequestPayload {
  date_from: string;
  date_to: string;
  filters?: InvoiceExportFiltersPayload;
  columns: InvoiceExportColumnKey[];
  mode: InvoiceExportMode;
}

export interface InvoiceExportErrorResponse {
  error: string;
  details?: string;
  max_rows?: number;
  matching_rows?: number;
}

export interface InvoiceExportColumnDefinition {
  key: InvoiceExportColumnKey;
  label: string;
  category: InvoiceExportColumnCategory;
  description?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  minLimit: number;
  category: string;
  status: 'جيد' | 'منخفض' | 'حرج';
}

export interface ProductWorkspaceProduct {
  id: number;
  name: string;
  category: string;
  unit: string;
  pieces_per_unit: number;
  supplier_name?: string | null;
  expiry_date?: string | null;
  selling_price: number;
  cost_price: number;
  sales_commission_percent: number;
  min_stock_threshold: number;
  is_active: boolean;
  image_url?: string | null;
  product_type: 'RETAIL' | 'INTERNAL';
}

export interface ProductWorkspaceSummary {
  total_stock: number;
  main_store_stock: number;
  carrying_branches_count: number;
  low_stock_branches_count: number;
  nearest_expiration?: string | null;
  nearest_expiration_days?: number | null;
}

export interface ProductWorkspaceBatch {
  batch_id: number;
  batch_number: string;
  remaining_quantity: number;
  expiration_date?: string | null;
  purchase_date?: string | null;
  received_at?: string | null;
  days_remaining?: number | null;
  status: 'HEALTHY' | 'EXPIRING_SOON' | 'EXPIRED' | 'NO_EXPIRY';
  branch_id?: number;
  branch_name?: string;
  is_main_warehouse?: boolean;
}

export interface ProductWorkspaceBranchStock {
  branch_id: number;
  branch_name: string;
  is_main_warehouse: boolean;
  stock_quantity: number;
  is_available: boolean;
  status: 'AVAILABLE' | 'LOW' | 'UNAVAILABLE';
  stock_status?: 'AVAILABLE' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'NOT_APPLICABLE' | 'UNKNOWN';
}

export interface ProductWorkspaceActivity {
  id: number;
  movement_type: string;
  direction: 'IN' | 'OUT' | 'NEUTRAL';
  signed_quantity: number;
  quantity: number;
  branch_id: number;
  branch_name: string;
  created_at: string;
  reference_label?: string | null;
  notes?: string | null;
}

export interface ProductWorkspacePayload {
  total_stock?: number;
  nearest_expiration?: string | null;
  nearest_expiration_days?: number | null;
  product: ProductWorkspaceProduct;
  summary: ProductWorkspaceSummary;
  branch_distribution: ProductWorkspaceBranchStock[];
  recent_activity: ProductWorkspaceActivity[];
  batches: ProductWorkspaceBatch[];
}

export interface BulkTransferProduct {
  id: number;
  name: string;
  category: string;
  unit: string;
  selling_price: number;
  image_url?: string | null;
  main_store_stock: number;
}

export interface BulkTransferCartItem {
  product_id: number;
  quantity: number;
  product: BulkTransferProduct;
}

export interface SupplyActivityProduct {
  product_id: number;
  product_name: string;
  quantity: number;
  image_url?: string | null;
  unit_cost_snapshot?: number;
  line_cost_total?: number;
}

export interface SupplyActivityRecord {
  activity_type: 'TRANSFER' | 'SHIPMENT' | 'INTERNAL_CONSUMPTION' | 'SUPPLY_IN' | 'RETURN' | 'STOCK_RECORD';
  event_kind?: string;
  record_basis?: 'UNLINKED_STOCK_RECORD';
  activity_key: string;
  shipment_id?: number | null;
  branch_id: number;
  branch_name: string;
  created_at: string;
  title: string;
  quantity: number;
  items_count: number;
  note?: string | null;
  transfer_ref?: string | null;
  shipment_ref?: string | null;
  shipment_status?: 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED' | null;
  return_ref?: string | null;
  return_status?: 'PENDING' | 'RETURNED_TO_MAIN' | 'RETURNED_TO_SUPPLIER' | 'DIRECT_TO_SUPPLIER' | 'REJECTED' | null;
  reason_label?: string | null;
  products: SupplyActivityProduct[];
}

export interface ShipmentDetailsBranch {
  id: number;
  name: string;
}

export interface ShipmentDetailsPayload {
  can_cancel?: boolean;
  cancelled_at?: string | null;
  cancelled_by_user_id?: number | null;
  cancelled_by_name?: string | null;
  cancellation_reason?: string | null;
  id: number;
  shipment_ref: string;
  shipment_type: 'OUTBOUND_TRANSFER' | 'INBOUND_SUPPLY';
  status: 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
  note?: string | null;
  supplier_name_snapshot?: string | null;
  created_at: string | null;
  received_at: string | null;
  source_branch: ShipmentDetailsBranch | null;
  destination_branch: ShipmentDetailsBranch;
  created_by?: {
    id: number;
    full_name: string | null;
  };
  received_by?: {
    id: number | null;
    name: string | null;
  } | null;
  products_count: number;
  pieces_count: number;
  total_cost_snapshot: number;
  items_count: number;
  total_quantity: number;
  total_cost_amount: number;
  items: SupplyActivityProduct[];
}

export type NotificationCategory = 'financial' | 'operational' | 'employees' | 'clients';
export type NotificationPriority = 'normal' | 'important' | 'critical';


export interface ExpenseCategory {
  id: string | number;
  name: string;
  code?: string;
  description?: string;
  is_active: boolean;
  created_at: string;
}

export interface ExpenseRecord {
  id: string | number;
  date: string;
  branch: string;
  type: string; // Linked to ExpenseCategory name
  amount: number;
  source: string; // e.g., 'Mini System'
  createdBy: string; // Cashier name
  notes?: string;
}

export interface ExpenseListResponse {
  items: ExpenseRecord[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_more: boolean;
}

export interface ExpenseSummaryResponse {
  total_amount: number;
  today_amount: number;
  count: number;
}

export interface AttendanceRecord {
  employee_id: number;
  employee_name: string;
  role: string;
  branch: string;
  check_in_at: string | null;
  check_out_at: string | null;
  duration_minutes: number;
  status: 'PRESENT' | 'LEFT' | 'ABSENT';
}

export interface AttendanceResponse {
  records: AttendanceRecord[];
  stats: {
    present: number;
    absent: number;
    total: number;
  };
}

export type AttendanceCheckoutSourceValue = 'MANUAL' | 'BUSINESS_DAY_CLOSE' | 'ADMIN_CORRECTION';
export type AdminAttendanceStatusValue = 'PRESENT' | 'LEFT' | 'ABSENT';
export type AdminAttendanceRowType = 'ATTENDANCE' | 'ABSENCE';

export interface AdminAttendanceBusinessDaySelectorItem {
  id: number;
  branch_id: number;
  branch_name: string;
  status: 'OPEN' | 'CLOSED';
  status_label?: string;
  opened_at: string | null;
  closed_at: string | null;
  opened_by: string | null;
  closed_by: string | null;
  business_date: string | null;
  day_label: string | null;
}

export interface AdminAttendanceWorkspaceBusinessDay {
  id: number;
  branch_id: number;
  branch_name: string;
  status: 'OPEN' | 'CLOSED';
  business_date: string | null;
  day_label: string | null;
  opened_at: string | null;
  closed_at: string | null;
  opened_by: string | null;
  closed_by: string | null;
}

export interface AdminAttendanceWorkspaceSummary {
  total_eligible: number;
  attended: number;
  absent: number;
  still_present: number;
  auto_checked_out: number;
  attendance_sessions: number;
}

interface AdminAttendanceWorkspaceBaseRow {
  attendance_id: number | null;
  employee_id: number;
  employee_name: string;
  employee_type: 'BARBER' | 'ASSISTANT';
  branch_id: number;
  branch_name: string;
  business_day_id: number;
  business_date: string | null;
  business_day_label: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  created_at?: string | null;
  is_manual_check_in?: boolean;
  recorded_by?: string | null;
  duration_minutes: number;
  checkout_source: AttendanceCheckoutSourceValue | null;
}

export interface AdminAttendanceWorkspaceAttendanceRow extends AdminAttendanceWorkspaceBaseRow {
  row_type: 'ATTENDANCE';
  attendance_id: number;
  attendance_status: 'PRESENT' | 'LEFT';
}

export interface AdminAttendanceWorkspaceAbsenceRow extends AdminAttendanceWorkspaceBaseRow {
  row_type: 'ABSENCE';
  attendance_id: null;
  attendance_status: 'ABSENT';
  check_in_time: null;
  check_out_time: null;
  checkout_source: null;
}

export type AdminAttendanceWorkspaceRow =
  | AdminAttendanceWorkspaceAttendanceRow
  | AdminAttendanceWorkspaceAbsenceRow;

export interface AdminAttendanceWorkspaceResponse {
  business_day: AdminAttendanceWorkspaceBusinessDay;
  summary: AdminAttendanceWorkspaceSummary;
  rows: AdminAttendanceWorkspaceRow[];
}

export interface AdminAttendanceLegacyRow {
  row_type: 'ATTENDANCE';
  attendance_id: number;
  employee_id: number;
  employee_name: string;
  employee_type: EmployeeRole;
  branch_id: number;
  branch_name: string;
  attendance_date: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  created_at?: string | null;
  is_manual_check_in?: boolean;
  recorded_by?: string | null;
  duration_minutes: number;
  attendance_status: 'PRESENT' | 'LEFT';
  checkout_source: AttendanceCheckoutSourceValue | null;
  business_day_id: null;
}

export interface AdminAttendanceLegacyResponse {
  metadata: {
    date: string;
    legacy_only: true;
  };
  rows: AdminAttendanceLegacyRow[];
}

export interface AdminSupplyRequestItem {
  product_id: number;
  product_name: string;
  image_url?: string | null;
  unit: string;
  requested_quantity: number;
  final_quantity?: number | null;
  main_store_stock: number;
  branch_stock: number;
  is_shortage: boolean;
}

export interface AdminSupplyRequest {
  id: number;
  request_ref: string;
  branch_id: number;
  branch_name: string;
  status: 'PENDING' | 'SENT' | 'RECEIVED';
  note?: string | null;
  created_by_employee_id: number;
  created_by_employee_name: string | null;
  shipment_id?: number | null;
  shipment_ref?: string | null;
  shipment_status?: 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED' | null;
  created_at: string;
  sent_at?: string | null;
  items_count?: number;
  total_requested_quantity?: number;
  items?: AdminSupplyRequestItem[];
}

export interface AdminSupplyRequestListResponse extends PaginatedHistoryResponse<AdminSupplyRequest> { }

export type AdminReturnRequestStatus = 'PENDING' | 'RETURNED_TO_MAIN' | 'RETURNED_TO_SUPPLIER' | 'REJECTED';

export type ReturnCostSource = 'RECORDED_AT_CREATION' | 'CURRENT_COST_ESTIMATE' | 'UNAVAILABLE';
export interface ReturnCostItem {
  product_id: number; product_name: string; item_key: string; quantity: number | null;
  unit_cost: string | null; line_cost_total: string | null;
  valuation_source: ReturnCostSource; snapshot_at: string | null;
}
export interface ReturnCostValuation {
  currency: 'EGP'; items: ReturnCostItem[]; return_cost_total: string | null;
  known_cost_subtotal: string; unavailable_items_count: number; is_complete: boolean;
  valuation_source: ReturnCostSource;
}
export interface AdminReturnRequest {
  id: number;
  return_ref: string;
  branch_id: number;
  branch_name: string;
  product_id: number;
  product_name: string;
  product_unit: string;
  product_image_url?: string | null;
  requested_quantity: number;
  branch_stock_snapshot: number;
  current_branch_stock?: number | null;
  reason: 'DAMAGED' | 'EXPIRED' | 'WRONG_SHIPMENT' | 'NOT_NEEDED' | 'MANUFACTURING_DEFECT' | 'OTHER';
  reason_label: string;
  notes?: string | null;
  status: AdminReturnRequestStatus;
  created_by_employee_id: number;
  created_by_employee_name: string | null;
  resolved_by_user_id?: number | null;
  resolved_by_user_name?: string | null;
  resolved_at?: string | null;
  resolution_note?: string | null;
  created_at: string;
  updated_at: string;
  cost_valuation?: ReturnCostValuation;
}

export interface AdminReturnRequestListResponse {
  requests: AdminReturnRequest[];
  counts: {
    all: number;
    pending: number;
    returned_to_main: number;
    returned_to_supplier: number;
    rejected: number;
  };
  pagination: {
    page: number;
    per_page: number;
    total: number;
    pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
}

export interface ShipmentHistoryItem {
  id: number;
  shipment_ref: string;
  shipment_type: 'OUTBOUND_TRANSFER' | 'INBOUND_SUPPLY';
  status: 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
  note?: string | null;
  supplier_name_snapshot?: string | null;
  created_at: string;
  received_at?: string | null;
  source_branch: {
    id: number;
    name: string;
  } | null;
  destination_branch: {
    id: number;
    name: string;
  };
  created_by: {
    id: number;
    full_name: string | null;
  };
  received_by?: {
    id: number;
    name: string | null;
  } | null;
  products_count: number;
  pieces_count: number;
  total_cost_snapshot: number;
  items_count: number;
  total_quantity: number;
  total_cost_amount: number;
  items_preview?: SupplyActivityProduct[];
  items?: SupplyActivityProduct[];
}

export interface ShipmentListResponse {
  shipments: ShipmentHistoryItem[];
  counts: {
    all: number;
    outbound_transfer: number;
    inbound_supply: number;
    in_transit: number;
    received: number;
    cancelled: number;
  };
  pagination: {
    page: number;
    per_page: number;
    total: number;
    pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
}

// Promo Codes — backend enum values and decimal-string amounts.
export type PromoDiscountScope = 'SERVICES_ONLY' | 'PRODUCTS_ONLY' | 'SERVICES_AND_PRODUCTS';
export type PromoDiscountType = 'PERCENTAGE' | 'FIXED';
export type PromoCategoryScope = 'ALL_SERVICE_CATEGORIES' | 'SELECTED_SERVICE_CATEGORIES';
export type PromoBranchScope = 'ALL_BRANCHES' | 'SELECTED_BRANCHES';
export interface PromoCode {
  discount_scope?: PromoDiscountScope;
  id: number;
  code: string;
  normalized_code: string;
  discount_type: PromoDiscountType;
  discount_value: string;
  category_scope: PromoCategoryScope;
  category_ids: number[];
  branch_scope: PromoBranchScope;
  branch_ids: number[];
  is_active: boolean;
  starts_at: string | null;
  expires_at: string | null;
  usage_limit: number | null;
  usage_count?: number; // Not supplied by the current API; never assume zero.
  version: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface PromoCodePayload {
  discount_scope: PromoDiscountScope;
  code?: string;
  discount_type: PromoDiscountType;
  discount_value: string;
  category_scope: PromoCategoryScope;
  category_ids: number[];
  branch_scope: PromoBranchScope;
  branch_ids: number[];
  is_active: boolean;
  starts_at?: string | null;
  expires_at?: string | null;
  usage_limit: number | null;
}
export interface PromoListResponse {
  items: PromoCode[];
  total: number;
  pages: number;
  current_page: number;
  per_page: number;
}
export interface PromoOption { id: number; name: string; }
