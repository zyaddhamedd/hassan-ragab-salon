// ─────────────────────────────────────────────────────────────────────────────
// Central Date/Time Formatter  —  Africa/Cairo  —  English output
//
// ALL display functions use Intl.DateTimeFormat.format() directly.
// NO .toLocaleString() in components.
// NO re-parsing locale strings back into Date objects.
//
// Output examples:
//   formatTime("2026-02-26T10:15:00Z")    → "12:15 PM"
//   formatDate("2026-02-26T10:15:00Z")    → "Feb 26, 2026"
//   formatDateTime("2026-02-26T10:15:00Z")→ "Feb 26, 2026 12:15 PM"
// ─────────────────────────────────────────────────────────────────────────────

const CAIRO_TZ = 'Africa/Cairo';

/** Safely coerce to Date, returns null on bad input. */
function toDate(dateStr: string | Date | null | undefined): Date | null {
    if (!dateStr) return null;
    const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    return isNaN(d.getTime()) ? null : d;
}

/**
 * formatTime — Cairo time in 12-hour English format.
 * @example "12:15 PM"
 */
export function formatTime(dateStr: string | Date | null | undefined): string {
    const d = toDate(dateStr);
    if (!d) return '---';
    try {
        return new Intl.DateTimeFormat('en-US', {
            timeZone: CAIRO_TZ,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        }).format(d);
    } catch {
        return '---';
    }
}

/**
 * formatDate — Cairo calendar date in short English format.
 * @example "Feb 26, 2026"
 */
export function formatDate(dateStr: string | Date | null | undefined): string {
    const d = toDate(dateStr);
    if (!d) return '---';
    try {
        return new Intl.DateTimeFormat('en-US', {
            timeZone: CAIRO_TZ,
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        }).format(d);
    } catch {
        return '---';
    }
}

/**
 * formatDateTime — Cairo date + 12-hour time in English.
 * @example "Feb 26, 2026 12:15 PM"
 */
export function formatDateTime(dateStr: string | Date | null | undefined): string {
    const d = toDate(dateStr);
    if (!d) return '---';
    try {
        const datePart = new Intl.DateTimeFormat('en-US', {
            timeZone: CAIRO_TZ,
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        }).format(d);
        const timePart = new Intl.DateTimeFormat('en-US', {
            timeZone: CAIRO_TZ,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        }).format(d);
        return `${datePart} ${timePart}`;
    } catch {
        return '---';
    }
}

/**
 * getCairoNow — returns a Date whose .get*() methods reflect Cairo local time.
 * Uses Intl.DateTimeFormat.formatToParts — no locale-string reparsing.
 */
export function getCairoNow(): Date {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: CAIRO_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(now);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
    return new Date(
        `${get('year')}-${get('month')}-${get('day')}T${get('hour').replace('24', '00')}:${get('minute')}:${get('second')}`
    );
}

/**
 * getTodayISO — Cairo calendar date as YYYY-MM-DD (for API params / date inputs).
 * Uses en-CA locale which natively formats as YYYY-MM-DD.
 */
export function getTodayISO(): string {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: CAIRO_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')}`;
}
