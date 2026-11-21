export type PromoDiscountType = 'PERCENTAGE' | 'FIXED';
export type PromoCategoryScope = 'ALL_SERVICE_CATEGORIES' | 'SELECTED_SERVICE_CATEGORIES';
export type PromoBranchScope = 'ALL_BRANCHES' | 'SELECTED_BRANCHES';

export interface PromoPreviewResult {
    promo_id: number;
    code: string;
    version: number;
    discount_type: PromoDiscountType;
    configured_value: string;
    eligible_subtotal: string;
    promo_discount: string;
    gross_subtotal: string;
    projected_total_discount: string;
    projected_net_total: string;
    category_scope: PromoCategoryScope;
    branch_scope: PromoBranchScope;
    discount_scope?: 'SERVICES_ONLY' | 'PRODUCTS_ONLY' | 'SERVICES_AND_PRODUCTS';
    quote_version: number;
    quote_id: string;
}

export interface PromoInvoiceData {
    code: string;
    discount_type: PromoDiscountType;
    configured_value: string;
    eligible_subtotal: number;
    discount_amount: number;
    version: number;
}
