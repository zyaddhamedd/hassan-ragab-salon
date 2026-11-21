export interface Service {
    id: number;
    name: string;
    price: number;
    has_assistant: boolean;
    created_at?: string;
}

export interface Category {
    id: number;
    name: string;
    services: Service[];
}

export interface InvoiceItem {
    id: number;
    item_type?: 'SERVICE_ITEM' | 'PRODUCT_ITEM';
    service_id: number | null;
    service_name: string | null;
    product_id?: number | null;
    product_name?: string | null;
    barber_id: number | null;
    barber_name: string | null;
    assistant_id?: number | null;
    assistant_name?: string | null;
    assigned_employee_id?: number | null;
    assigned_employee_name?: string | null;
    price: number;
    quantity: number;
    total: number;
    sales_commission_percent?: number;
    sales_commission_amount?: number;
}

export interface Invoice {
    id: number;
    invoice_number: number | null;
    booking_appointment_id?: number | null;
    booking_multi_customer?: boolean;
    booking_draft_created?: boolean;
    customer_id?: number | null;
    customer_name?: string | null;
    customer_phone?: string | null;
    status: string;
    total_amount: number;
    discount_amount?: number;
    net_amount?: number;
    deposit_settlement?: {appointment_id: number | null; applied_amount: number; new_collection_amount: number; remaining_unpaid: number | null};
    payment_method?: string | null;
    // Split payment breakdown (empty for legacy invoices)
    payments?: {
        method: 'CASH' | 'VISA' | 'INSTAPAY';
        amount: number;
        entered_amount?: number;
    }[];
    // Customer change (overpayment - invoice total). 0 for exact/card payments.
    change_amount?: number;
    items: InvoiceItem[];
    promo?: {
        code: string;
        discount_type: 'PERCENTAGE' | 'FIXED';
        configured_value: string;
        eligible_subtotal: number;
        discount_amount: number;
        version: number;
    } | null;
}

export interface BranchInventoryProduct {
    product_id: number;
    name: string;
    image_url?: string | null;
    category: string;
    selling_price: number;
    unit: string;
    stock_quantity: number;
    min_stock_threshold: number;
    status: 'AVAILABLE' | 'LOW' | 'OUT' | 'UNKNOWN' | 'NOT_APPLICABLE';
    /** Nearest non-expired expiration date across all batches */
    nearest_expiration?: string | null;
    /** Days until nearest expiration (negative = already expired) */
    nearest_expiration_days?: number | null;
    /** Latest first_received_at across all active batches */
    latest_received_at?: string | null;
}

export interface InventoryBatchBreakdown {
    batch_id: number;
    batch_number: string;
    remaining_quantity: number;
    expiration_date?: string | null;
    /** ISO date string — when the batch was purchased */
    purchase_date?: string | null;
    /** ISO datetime string — when the batch arrived at the branch */
    received_at?: string | null;
    days_remaining?: number | null;
    status: 'HEALTHY' | 'EXPIRING_SOON' | 'EXPIRED' | 'NO_EXPIRY';
}

export interface BranchInventoryProductDetails {
    product: BranchInventoryProduct;
    total_stock: number;
    nearest_expiration?: string | null;
    nearest_expiration_days?: number | null;
    latest_received_at?: string | null;
    batches: InventoryBatchBreakdown[];
}

export interface BranchInventoryActivity {
    id: number;
    movement_type: string;
    product_id: number;
    product_name: string;
    image_url?: string | null;
    quantity: number;
    branch_id: number;
    branch_name: string;
    reason: string;
    created_at: string;
}

export interface BranchInventoryPayload {
    branch: {
        id: number;
        name: string;
    };
    products: BranchInventoryProduct[];
    recent_activity: BranchInventoryActivity[];
}

export interface BranchInventorySummaryPayload {
    active_supply_requests: number;
    pending_supply_requests: number;
    pending_returns: number;
}

export interface PaginatedListResponse<T> {
    items: T[];
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
    has_more: boolean;
}

export interface IncomingShipmentItem {
    product_id: number;
    product_name: string;
    image_url?: string | null;
    quantity: number;
}

export interface IncomingShipmentSummary {
    id: number;
    shipment_ref: string;
    status: 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
    created_at: string;
    source_branch_name: string;
    destination_branch_id: number;
    destination_branch_name: string;
    items_count: number;
    total_quantity: number;
    note?: string | null;
    items_preview: IncomingShipmentItem[];
}

export interface IncomingShipmentDetails {
    id: number;
    shipment_ref: string;
    status: 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
    created_at: string;
    received_at?: string | null;
    source_branch_name: string;
    destination_branch_id: number;
    destination_branch_name: string;
    received_by_name?: string | null;
    items_count: number;
    total_quantity: number;
    note?: string | null;
    items: IncomingShipmentItem[];
}

export interface ShipmentHistorySummary {
    id: number;
    shipment_ref: string;
    status: 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
    created_at: string;
    received_at: string | null;
    source_branch_name: string;
    destination_branch_name: string;
    received_by_name: string | null;
    items_count: number;
    total_quantity: number;
    note?: string | null;
    items_preview: IncomingShipmentItem[];
}

export interface ShipmentHistoryResponse {
    shipments: ShipmentHistorySummary[];
    pagination: {
        page: number;
        per_page: number;
        total: number;
        pages: number;
        has_next: boolean;
        has_prev: boolean;
    };
}

export interface SupplyRequestItem {
    id?: number;
    product_id: number;
    product_name: string;
    requested_quantity: number;
    final_quantity: number | null;
    image_url?: string | null;
    unit?: string;
}

export interface SupplyRequestSummary {
    id: number;
    request_ref: string;
    branch_id: number;
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
    items?: SupplyRequestItem[];
}

export type ReturnRequestStatus = 'PENDING' | 'RETURNED_TO_MAIN' | 'RETURNED_TO_SUPPLIER' | 'REJECTED';
export type ReturnRequestReason =
    | 'DAMAGED'
    | 'EXPIRED'
    | 'WRONG_SHIPMENT'
    | 'NOT_NEEDED'
    | 'MANUFACTURING_DEFECT'
    | 'OTHER';

export interface ReturnRequestSummary {
    id: number;
    return_ref: string;
    branch_id: number;
    product_id: number;
    product_name: string;
    product_unit: string;
    product_image_url?: string | null;
    requested_quantity: number;
    branch_stock_snapshot: number;
    reason: ReturnRequestReason;
    reason_label: string;
    notes?: string | null;
    status: ReturnRequestStatus;
    created_by_employee_id: number;
    created_by_employee_name: string | null;
    resolved_by_user_id?: number | null;
    resolved_by_user_name?: string | null;
    resolved_at?: string | null;
    resolution_note?: string | null;
    created_at: string;
    updated_at: string;
}

// ============================================================================
// Product Activity Log
// ============================================================================

export type ProductActivityType = 'PRODUCT_SALE' | 'INTERNAL_CONSUMPTION';

export interface ProductActivityItem {
    id: number;
    type: ProductActivityType;
    product_id: number;
    product_name: string;
    product_image_url?: string | null;
    product_unit: string;
    quantity: number;
    /** Present only for PRODUCT_SALE items */
    invoice_number?: number | null;
    /** Present only for INTERNAL_CONSUMPTION items */
    reason?: string | null;
    actor_name?: string | null;
    created_at: string;
}

export interface ProductActivitySummary {
    total_sales_qty: number;
    total_consumption_qty: number;
    total_movements: number;
}

export interface ProductActivityPagination {
    page: number;
    per_page: number;
    total: number;
    pages: number;
    has_next: boolean;
    has_prev: boolean;
}

export interface ProductActivityResponse {
    items: ProductActivityItem[];
    pagination: ProductActivityPagination;
    summary: ProductActivitySummary;
}

export interface BookingHandoffRequest { appointmentId: number; requestId: number }
export interface BookingHandoffContext {
    appointment: { id: number; branch_id: number; customer_id: number; status: string };
    customer: { id: number; full_name: string; phone: string; deposit_balance?: number };
    invoice: Invoice | null;
    eligible_deposit: { appointment_id: number; available_amount: number } | null;
    prefill_service?: Service | null;
    prefill_barber?: {id: number; name: string} | null;
    prefill_service_id: number | null;
    prefill_barber_id: number | null;
}
