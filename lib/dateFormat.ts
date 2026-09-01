/**
 * Universal Date Formatting Utility for Leave Tracker
 * Formats dates consistently across all views into readable format: e.g. "11th Aug 2026"
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Returns ordinal suffix for a day number (e.g. 1 -> "st", 2 -> "nd", 3 -> "rd", 4 -> "th", 11 -> "th", 21 -> "st", 22 -> "nd", 23 -> "rd", 31 -> "st")
 */
export function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/**
 * Formats a date string (YYYY-MM-DD or ISO) or Date object to "11th Aug 2026"
 */
export function formatOrdinalDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '—';
  
  let d: Date;
  if (typeof dateInput === 'string') {
    // If it's a simple YYYY-MM-DD string, parse parts manually to avoid UTC offset shift
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
      const [y, m, day] = dateInput.trim().split('-').map(Number);
      return `${day}${getOrdinalSuffix(day)} ${MONTHS[m - 1]} ${y}`;
    }
    d = new Date(dateInput);
  } else {
    d = dateInput;
  }

  if (isNaN(d.getTime())) return String(dateInput);

  const day = d.getDate();
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${day}${getOrdinalSuffix(day)} ${month} ${year}`;
}

/**
 * Formats a date with weekday: e.g. "Mon, 11th Aug 2026"
 */
export function formatOrdinalDateWithWeekday(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '—';

  let d: Date;
  if (typeof dateInput === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
      const [y, m, day] = dateInput.trim().split('-').map(Number);
      d = new Date(y, m - 1, day);
      const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return `${weekdays[d.getDay()]}, ${day}${getOrdinalSuffix(day)} ${MONTHS[m - 1]} ${y}`;
    }
    d = new Date(dateInput);
  } else {
    d = dateInput;
  }

  if (isNaN(d.getTime())) return String(dateInput);

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = d.getDate();
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${weekdays[d.getDay()]}, ${day}${getOrdinalSuffix(day)} ${month} ${year}`;
}

/**
 * Formats a date range cleanly:
 * - Single day: "11th Aug 2026 (1 Day)" or "11th Aug 2026 (Half Day)"
 * - Multi-day: "11th Aug 2026 – 21st Aug 2026 (7 Days)"
 */
export function formatOrdinalDateRange(
  startDate: string | Date | null | undefined,
  endDate?: string | Date | null | undefined,
  isHalfDay?: boolean,
  totalDays?: number
): string {
  if (!startDate) return '—';

  const startFormatted = formatOrdinalDate(startDate);
  const startStr = typeof startDate === 'string' ? startDate.slice(0, 10) : startDate.toISOString().slice(0, 10);
  const endStr = endDate ? (typeof endDate === 'string' ? endDate.slice(0, 10) : endDate.toISOString().slice(0, 10)) : startStr;

  if (isHalfDay || !endDate || startStr === endStr) {
    const dayLabel = isHalfDay ? 'Half Day' : `${totalDays ?? 1} Day${(totalDays ?? 1) > 1 ? 's' : ''}`;
    return `${startFormatted} (${dayLabel})`;
  }

  const endFormatted = formatOrdinalDate(endDate);
  const daysCount = totalDays ?? undefined;
  const daySuffix = daysCount !== undefined ? ` (${daysCount} Day${daysCount > 1 ? 's' : ''})` : '';

  return `${startFormatted} – ${endFormatted}${daySuffix}`;
}

export const DATE_INPUT_MIN = '2020-01-01';
export const DATE_INPUT_MAX = '2035-12-31';

/**
 * Sanitizes and bounds date strings (YYYY-MM-DD) typed or pasted into inputs
 * - Prevents year exceeding 4 digits (e.g. 20256 -> 2025)
 * - Restricts year to valid range (e.g. 2020 - 2035)
 */
export function sanitizeDateString(val: string): string {
  if (!val) return '';
  const trimmed = val.trim();
  const parts = trimmed.split('-');
  if (parts.length === 3) {
    let [year, month, day] = parts;
    if (year.length > 4) {
      year = year.slice(0, 4);
    }
    const yNum = parseInt(year, 10);
    if (!isNaN(yNum) && year.length === 4) {
      if (yNum > 2035) year = '2035';
      if (yNum < 1900) year = '1900';
    }
    return `${year}-${month}-${day}`;
  }
  return trimmed;
}
