// ─────────────────────────────────────────────────────────────────────────────
// Central Date/Time Formatter  —  Africa/Cairo  —  English 12h default
//
// Default outputs:
//   formatTime(iso)     → "12:15 PM"
//   formatDate(iso)     → "Feb 26, 2026"
//   formatDateTime(iso) → "Feb 26, 2026 12:15 PM"
//
// Optional overrides (locale + options) are accepted for special cases
// (e.g. waiting ticket prints that use ar-EG).
// ─────────────────────────────────────────────────────────────────────────────

const CAIRO_TZ = 'Africa/Cairo';

function toDate(dateStr: string | Date | null | undefined): Date | null {
    if (!dateStr) return null;
    const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    return isNaN(d.getTime()) ? null : d;
}

/**
 * formatDateTime
 * Default: "Feb 26, 2026 12:15 PM"
 * Override example: formatDateTime(iso, {weekday:'long'}, 'ar-EG')
 */
export function formatDateTime(
    dateStr: string | Date | null | undefined,
    options?: Intl.DateTimeFormatOptions,
    locale: string = 'en-US'
): string {
    const d = toDate(dateStr);
    if (!d) return '---';
    try {
        const effectiveOptions: Intl.DateTimeFormatOptions = {
            timeZone: CAIRO_TZ,
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            ...options,
        };
        return new Intl.DateTimeFormat(locale, effectiveOptions).format(d);
    } catch {
        return '---';
    }
}

/**
 * formatDate
 * Default: "Feb 26, 2026"
 * Override example: formatDate(iso, {weekday:'long', month:'long'}, 'ar-EG')
 */
export function formatDate(
    dateStr: string | Date | null | undefined,
    options?: Intl.DateTimeFormatOptions,
    locale: string = 'en-US'
): string {
    const d = toDate(dateStr);
    if (!d) return '---';
    try {
        const effectiveOptions: Intl.DateTimeFormatOptions = {
            timeZone: CAIRO_TZ,
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            ...options,
        };
        return new Intl.DateTimeFormat(locale, effectiveOptions).format(d);
    } catch {
        return '---';
    }
}

/**
 * formatTime
 * Default: "12:15 PM"
 * Override example: formatTime(iso, {hour:'2-digit', minute:'2-digit'}, 'en-US')
 */
export function formatTime(
    dateStr: string | Date | null | undefined,
    options?: Intl.DateTimeFormatOptions,
    locale: string = 'en-US'
): string {
    const d = toDate(dateStr);
    if (!d) return '---';
    try {
        const effectiveOptions: Intl.DateTimeFormatOptions = {
            timeZone: CAIRO_TZ,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            ...options,
        };
        return new Intl.DateTimeFormat(locale, effectiveOptions).format(d);
    } catch {
        return '---';
    }
}

/**
 * getCairoNow — returns a Date whose .get*() methods reflect Cairo local time.
 * Uses formatToParts — no locale-string reparsing.
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
 * getTodayISO — Cairo calendar date as YYYY-MM-DD.
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
