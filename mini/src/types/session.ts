import { InvoiceItem } from './models';

/**
 * Frontend-only extension of InvoiceItem.
 * sessionTempId groups items into logical "customer sessions" inside one invoice.
 *
 * ⚠️ This field is NEVER sent to the backend.
 * It exists only in React component state to drive visual grouping in the sidebar.
 */
export interface SessionedInvoiceItem extends InvoiceItem {
    sessionTempId?: string;
}
