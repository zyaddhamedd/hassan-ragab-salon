// Treasury & Shift TypeScript Types

export interface ShiftStatus {
    has_active_shift: boolean;
    shift: {
        id: string;
        branch_id: number;
        branch_name: string;
        cashier_user_id: number;
        cashier_name: string;
        opened_at: string;
        opening_cash_balance: number;
        status: 'OPEN' | 'CLOSED';
        created_at: string;
    } | null;
}

export interface TreasuryBalance {
    branch_id: number;
    branch_name: string;
    balances: {
        CASH: number;
        VISA: number;
        INSTAPAY: number;
    };
    total: number;
    as_of: string;
}

export interface DaySummary {
    branch_name: string;
    date: string;
    opening_cash_balance: number;
    income: {
        cash: number;
        visa: number;
        instapay: number;
        total: number;
    };
    expenses: {
        advances: number;
        overtime: number;
        daily_percentages: number;
        other: number;
        total: number;
    };
    total_cash_in: number;
    total_cash_out: number;
    expected_cash_in_drawer: number;
    net_revenue: number;
    invoice_count: number;
    expense_count: number;
}

export interface ShiftReport extends DaySummary {
    shift_id: string;
    cashier_name: string;
    opened_at: string;
    closed_at: string | null;
    status: 'OPEN' | 'CLOSED';
    closing_cash_balance: number | null;
    total_transactions: number;
}

export interface DailyClosing {
    id: string;
    branch_id: number;
    closing_number: number;
    closed_by: number;
    closer_name?: string;
    closed_at: string;
    total_cash_income: number;
    total_cash_expenses: number;
    total_visa_income: number;
    total_instapay_income: number;
    total_expenses: number;
    expense_breakdown: {
        ADVANCE: number;
        OVERTIME: number;
        DAILY_PERCENTAGE: number;
        OTHER: number;
    };
    final_cash_in_drawer: number;
    notes?: string;
}
