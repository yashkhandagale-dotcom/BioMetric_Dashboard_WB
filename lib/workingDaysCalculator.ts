import { getPredefinedHolidays } from './predefinedHolidays';

/**
 * Checks if a given date string (YYYY-MM-DD) is a weekend (Saturday or Sunday)
 */
export function isWeekend(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
}

/**
 * Returns a Set of holiday date strings for a given office and years span
 */
export function getHolidayDateSet(officeCode: string = 'MUM', years: number[] = [2025, 2026, 2027]): Set<string> {
  const set = new Set<string>();
  for (const yr of years) {
    const list = getPredefinedHolidays(officeCode, yr);
    for (const h of list) {
      set.add(h.date);
    }
  }
  return set;
}

/**
 * Checks if a date is a non-working day (Weekend or Holiday)
 */
export function isNonWorkingDay(dateStr: string, officeCode: string = 'MUM', holidaySet?: Set<string>): boolean {
  if (isWeekend(dateStr)) return true;
  const holidays = holidaySet ?? getHolidayDateSet(officeCode);
  return holidays.has(dateStr);
}

/**
 * Calculates working days between startDate and endDate (inclusive), excluding weekends and holidays.
 */
export function calculateWorkingDays(
  startDate: string,
  endDate: string,
  officeCode: string = 'MUM'
): number {
  if (!startDate || !endDate || startDate > endDate) return 0;

  const holidaySet = getHolidayDateSet(officeCode);
  let count = 0;
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  while (cursor <= end) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (!isNonWorkingDay(dateStr, officeCode, holidaySet)) {
      count += 1;
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return count;
}

/**
 * Given a startDate and a target number of working days, computes the endDate
 * by stepping forward and skipping weekends and holidays.
 */
export function calculateEndDateFromWorkingDays(
  startDate: string,
  targetDays: number,
  officeCode: string = 'MUM'
): string {
  if (!startDate || targetDays <= 0) return startDate;

  const holidaySet = getHolidayDateSet(officeCode);
  let remainingDays = Math.ceil(targetDays);
  let cursor = new Date(`${startDate}T00:00:00Z`);
  let lastWorkingDay = startDate;

  while (isNonWorkingDay(cursor.toISOString().slice(0, 10), officeCode, holidaySet)) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  while (remainingDays > 0) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (!isNonWorkingDay(dateStr, officeCode, holidaySet)) {
      lastWorkingDay = dateStr;
      remainingDays -= 1;
    }
    if (remainingDays > 0) {
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  return lastWorkingDay;
}

/**
 * Checks if two leave date ranges are continuous:
 * either contiguous (e.g. Fri -> Sat/Mon) or separated solely by weekends or holidays.
 */
export function areLeavesContinuous(
  earlierEnd: string,
  laterStart: string,
  officeCode: string = 'MUM'
): boolean {
  if (earlierEnd >= laterStart) return true;

  const nextDay = new Date(`${earlierEnd}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDayStr = nextDay.toISOString().slice(0, 10);
  if (nextDayStr >= laterStart) return true;

  let cursor = new Date(nextDay.getTime());
  const target = new Date(`${laterStart}T00:00:00Z`);
  const holidaySet = getHolidayDateSet(officeCode);

  while (cursor < target) {
    const dStr = cursor.toISOString().slice(0, 10);
    if (!isNonWorkingDay(dStr, officeCode, holidaySet)) {
      return false; // Found a regular working day between them
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return true;
}

/**
 * Consolidates continuous leave records for the same employee, leave type, and status
 * that are only separated by weekends or holidays into a single continuous leave block.
 */
export function consolidateLeaveRows<T extends {
  id: string;
  employeeId: string;
  leaveTypeCode: string;
  status: string;
  isLwpOverride?: boolean;
  isHalfDay?: boolean;
  startDate: string;
  endDate: string;
  totalDays: number;
  office?: string;
  appliedOn?: string;
}>(rows: T[]): T[] {
  if (rows.length <= 1) return rows;

  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.isHalfDay
      ? `half_${r.id}`
      : `${r.employeeId}_${r.leaveTypeCode}_${r.status}_${!!r.isLwpOverride}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const consolidated: T[] = [];

  for (const [key, groupRows] of groups) {
    if (key.startsWith('half_') || groupRows.length === 1) {
      consolidated.push(...groupRows);
      continue;
    }

    const sorted = [...groupRows].sort((a, b) => a.startDate.localeCompare(b.startDate));
    let current: T = {
      ...sorted[0],
      consolidatedIds: [sorted[0].id],
      constituentCount: 1,
    } as any;

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      const office = current.office || next.office || 'MUM';

      if (areLeavesContinuous(current.endDate, next.startDate, office)) {
        current.endDate = next.endDate > current.endDate ? next.endDate : current.endDate;
        current.totalDays = Number((current.totalDays + next.totalDays).toFixed(2));
        if (next.appliedOn && current.appliedOn && next.appliedOn > current.appliedOn) {
          current.appliedOn = next.appliedOn;
        }
        const ids: string[] = (current as any).consolidatedIds ?? [current.id];
        ids.push(next.id);
        (current as any).consolidatedIds = ids;
        (current as any).isConsolidated = true;
        (current as any).constituentCount = ids.length;
      } else {
        consolidated.push(current);
        current = {
          ...next,
          consolidatedIds: [next.id],
          constituentCount: 1,
        } as any;
      }
    }
    consolidated.push(current);
  }

  return consolidated.sort((a, b) => b.startDate.localeCompare(a.startDate));
}
