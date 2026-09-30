/**
 * Pure UTC-based calendar and working day calculations for HR Leave Analytics.
 * All date math is performed strictly in UTC with YYYY-MM-DD formatted strings.
 */

/**
 * Adds (or subtracts) days to a YYYY-MM-DD date in UTC.
 */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Returns the day of week in UTC (0 = Sunday, 1 = Monday, ..., 6 = Saturday).
 */
export function getUTCDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Checks if a date falls on a weekend (Saturday or Sunday).
 */
export function isWeekend(dateStr: string): boolean {
  const dow = getUTCDayOfWeek(dateStr);
  return dow === 0 || dow === 6;
}

/**
 * Checks if a date is a working day (neither weekend nor office holiday).
 */
export function isWorkingDay(dateStr: string, holidaySet?: Set<string>): boolean {
  if (isWeekend(dateStr)) return false;
  if (holidaySet && holidaySet.has(dateStr)) return false;
  return true;
}

/**
 * Checks if a date is a non-working day (weekend or office holiday).
 */
export function isNonWorkingDay(dateStr: string, holidaySet?: Set<string>): boolean {
  return !isWorkingDay(dateStr, holidaySet);
}

/**
 * Returns calendar day difference: (dateB - dateA) in days.
 */
export function calendarDaysDiff(dateA: string, dateB: string): number {
  const [yA, mA, dA] = dateA.split('-').map(Number);
  const [yB, mB, dB] = dateB.split('-').map(Number);
  const tA = Date.UTC(yA, mA - 1, dA);
  const tB = Date.UTC(yB, mB - 1, dB);
  return Math.round((tB - tA) / (24 * 60 * 60 * 1000));
}

/**
 * Computes the consecutive non-working run length immediately BEFORE a date.
 * E.g., for a Monday, returns 2 (Sunday, Saturday).
 */
export function getNonWorkingRunBefore(
  dateStr: string,
  holidaySet?: Set<string>,
  maxLookback: number = 30
): { count: number; dates: string[] } {
  const dates: string[] = [];
  let cur = addDays(dateStr, -1);
  let steps = 0;
  while (steps < maxLookback && isNonWorkingDay(cur, holidaySet)) {
    dates.unshift(cur);
    cur = addDays(cur, -1);
    steps++;
  }
  return { count: dates.length, dates };
}

/**
 * Computes the consecutive non-working run length immediately AFTER a date.
 * E.g., for a Friday, returns 2 (Saturday, Sunday).
 */
export function getNonWorkingRunAfter(
  dateStr: string,
  holidaySet?: Set<string>,
  maxLookahead: number = 30
): { count: number; dates: string[] } {
  const dates: string[] = [];
  let cur = addDays(dateStr, 1);
  let steps = 0;
  while (steps < maxLookahead && isNonWorkingDay(cur, holidaySet)) {
    dates.push(cur);
    cur = addDays(cur, 1);
    steps++;
  }
  return { count: dates.length, dates };
}

export interface AttachedBaseline {
  totalWorkingDays: number;
  attachedWorkingDays: number;
  attachedShare: number; // attachedWorkingDays / totalWorkingDays (0.0 to 1.0)
}

/**
 * Computes the per-office baseline "attached working-day share" across a date range.
 * A working day is "attached" if either the preceding day or the following day is a non-working day.
 * E.g., standard Mondays and Fridays are attached to the weekend; working days next to a holiday are attached.
 */
export function calculateAttachedBaselineShare(
  startDate: string,
  endDate: string,
  holidaySet?: Set<string>
): AttachedBaseline {
  let totalWorkingDays = 0;
  let attachedWorkingDays = 0;

  let cur = startDate;
  while (cur <= endDate) {
    if (isWorkingDay(cur, holidaySet)) {
      totalWorkingDays++;
      const prev = addDays(cur, -1);
      const next = addDays(cur, 1);
      if (isNonWorkingDay(prev, holidaySet) || isNonWorkingDay(next, holidaySet)) {
        attachedWorkingDays++;
      }
    }
    cur = addDays(cur, 1);
  }

  const attachedShare = totalWorkingDays > 0 ? attachedWorkingDays / totalWorkingDays : 0;

  return {
    totalWorkingDays,
    attachedWorkingDays,
    attachedShare: Math.round(attachedShare * 10000) / 10000,
  };
}

/**
 * Counts total working days between startDate and endDate inclusive, using the given holiday set.
 */
export function countWorkingDays(startDate: string, endDate: string, holidaySet?: Set<string>): number {
  if (startDate > endDate) return 0;
  let count = 0;
  let cur = startDate;
  while (cur <= endDate) {
    if (isWorkingDay(cur, holidaySet)) {
      count++;
    }
    cur = addDays(cur, 1);
  }
  return count;
}
