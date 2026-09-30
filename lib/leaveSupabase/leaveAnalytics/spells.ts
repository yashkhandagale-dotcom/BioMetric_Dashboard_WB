import {
  addDays,
  isWorkingDay,
  isNonWorkingDay,
  calendarDaysDiff,
  getNonWorkingRunBefore,
  getNonWorkingRunAfter,
  getUTCDayOfWeek,
} from './calendar';

export interface LeaveRequestInput {
  id: string;
  employee_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  total_days: number; // Stored working days
  is_half_day?: boolean;
  status: string; // 'approved', 'pending', etc.
  source?: string; // 'employee_apply', 'hr_manual', etc.
  is_lwp_override?: boolean;
  medical_certificate_url?: string | null;
  leave_type_code?: string;
  leave_types?: {
    code: string;
    display_name?: string;
  } | null;
  employees?: {
    id?: string;
    full_name: string;
    employee_code: string;
    department: string;
    office: string;
    employment_status: string;
    is_deleted?: boolean;
    date_of_joining?: string | null;
    date_of_exit?: string | null;
  } | null;
}

export interface WorkingDayLeaveEntry {
  date: string; // YYYY-MM-DD
  weight: number; // 0.5 or 1.0
  typeCode: string;
  requestId: string;
  source: string;
  isHalfDay: boolean;
  medicalCertUrl?: string | null;
}

export interface SpellAttachment {
  isAttached: boolean;
  beforeBreak: boolean;
  afterBreak: boolean;
  sandwich: boolean;
  holidayInvolved: boolean;
  runBeforeCount: number;
  runAfterCount: number;
  extendedBreakDays: number;
  leverage: number;
  involvedHolidayDates: string[];
}

export interface LeaveSpell {
  id: string; // unique spell identifier
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  office: string;
  startDate: string; // YYYY-MM-DD (first leave day)
  endDate: string; // YYYY-MM-DD (last leave day)
  calendarSpan: number; // calendarDaysDiff(startDate, endDate) + 1
  leaveDays: number; // sum of weighted leave days
  hasHalfDay: boolean;
  typeMix: Record<string, number>; // e.g. { SL: 1, CL: 1 }
  sources: string[];
  requestIds: string[];
  medicalCertUrls: string[];
  attachment: SpellAttachment;
  dayDetails: WorkingDayLeaveEntry[];
}

/**
 * Expands a single leave request into individual working day leave entries.
 * Skips non-working days (weekends & office holidays) within the request date span.
 */
export function expandRequestToWorkingDays(
  request: LeaveRequestInput,
  holidaySet?: Set<string>
): WorkingDayLeaveEntry[] {
  const entries: WorkingDayLeaveEntry[] = [];
  const typeCode = request.leave_type_code || request.leave_types?.code || 'UNKNOWN';
  const weight = request.is_half_day ? 0.5 : 1.0;
  const source = request.source || 'employee_apply';

  let cur = request.start_date;
  while (cur <= request.end_date) {
    if (isWorkingDay(cur, holidaySet)) {
      entries.push({
        date: cur,
        weight,
        typeCode,
        requestId: request.id,
        source,
        isHalfDay: !!request.is_half_day,
        medicalCertUrl: request.medical_certificate_url,
      });
    }
    cur = addDays(cur, 1);
  }

  return entries;
}

/**
 * Checks whether all calendar days strictly between dateA and dateB (exclusive)
 * are non-working days (weekends or office holidays).
 */
export function areOnlyNonWorkingDaysBetween(
  dateA: string,
  dateB: string,
  holidaySet?: Set<string>
): boolean {
  let cur = addDays(dateA, 1);
  while (cur < dateB) {
    if (isWorkingDay(cur, holidaySet)) {
      return false; // Found a working day with no leave
    }
    cur = addDays(cur, 1);
  }
  return true;
}

/**
 * Classifies attachment properties of a leave spell.
 */
export function classifySpellAttachment(
  startDate: string,
  endDate: string,
  leaveDays: number,
  holidaySet?: Set<string>
): SpellAttachment {
  const runBefore = getNonWorkingRunBefore(startDate, holidaySet);
  const runAfter = getNonWorkingRunAfter(endDate, holidaySet);
  const calendarSpan = calendarDaysDiff(startDate, endDate) + 1;

  const beforeBreak = runBefore.count > 0;
  const afterBreak = runAfter.count > 0;
  const isAttached = beforeBreak || afterBreak;

  // A spell is a sandwich if:
  // 1. It has an internal non-working gap of 1+ days (calendarSpan > leaveDays), OR
  // 2. It has non-working breaks on both boundaries (beforeBreak && afterBreak).
  const hasInternalGap = calendarSpan > Math.ceil(leaveDays);
  const sandwich = (beforeBreak && afterBreak) || hasInternalGap;

  // Check if any holiday is involved (in runBefore, runAfter, or internal gaps)
  const involvedHolidays: string[] = [];
  if (holidaySet) {
    for (const d of runBefore.dates) {
      if (holidaySet.has(d)) involvedHolidays.push(d);
    }
    for (const d of runAfter.dates) {
      if (holidaySet.has(d)) involvedHolidays.push(d);
    }
    // Check internal non-working days
    let cur = addDays(startDate, 1);
    while (cur < endDate) {
      if (holidaySet.has(cur)) involvedHolidays.push(cur);
      cur = addDays(cur, 1);
    }
  }

  const holidayInvolved = involvedHolidays.length > 0;
  const extendedBreakDays = runBefore.count + calendarSpan + runAfter.count;
  const leverage = leaveDays > 0 ? Math.round((extendedBreakDays / leaveDays) * 100) / 100 : 0;

  return {
    isAttached,
    beforeBreak,
    afterBreak,
    sandwich,
    holidayInvolved,
    runBeforeCount: runBefore.count,
    runAfterCount: runAfter.count,
    extendedBreakDays,
    leverage,
    involvedHolidayDates: Array.from(new Set(involvedHolidays)),
  };
}

/**
 * Merges leave requests into continuous SPELLS per employee across all leave types.
 * Consecutive leave days separated ONLY by non-working days (weekends/holidays)
 * are merged into a single spell.
 */
export function buildSpellsFromRequests(
  requests: LeaveRequestInput[],
  holidayMapByOffice: Map<string, Set<string>>,
  options?: {
    allowedStatuses?: string[];
  }
): LeaveSpell[] {
  const allowedStatuses = options?.allowedStatuses ?? ['approved'];

  // Filter requests by status
  const validRequests = requests.filter((r) => allowedStatuses.includes(r.status));

  // Group requests by employee
  const byEmployee = new Map<string, LeaveRequestInput[]>();
  for (const r of validRequests) {
    const list = byEmployee.get(r.employee_id) || [];
    list.push(r);
    byEmployee.set(r.employee_id, list);
  }

  const allSpells: LeaveSpell[] = [];

  for (const [employeeId, empRequests] of byEmployee.entries()) {
    if (empRequests.length === 0) continue;

    const first = empRequests[0];
    const employeeName = first.employees?.full_name || 'Unknown Employee';
    const employeeCode = first.employees?.employee_code || '';
    const department = first.employees?.department || 'General';
    const office = (first.employees?.office || 'MUM').toUpperCase();
    const holidaySet = holidayMapByOffice.get(office) || new Map<string, Set<string>>().get(office);

    // Expand all requests for this employee into working-day entries
    const dayEntries: WorkingDayLeaveEntry[] = [];
    for (const req of empRequests) {
      const days = expandRequestToWorkingDays(req, holidaySet);
      dayEntries.push(...days);
    }

    if (dayEntries.length === 0) continue;

    // Deduplicate / aggregate by date (handle half-days on same day)
    const byDateMap = new Map<string, WorkingDayLeaveEntry>();
    for (const entry of dayEntries) {
      const existing = byDateMap.get(entry.date);
      if (existing) {
        existing.weight = Math.min(1.0, existing.weight + entry.weight);
        if (existing.weight >= 1.0) existing.isHalfDay = false;
        if (!existing.medicalCertUrl && entry.medicalCertUrl) {
          existing.medicalCertUrl = entry.medicalCertUrl;
        }
      } else {
        byDateMap.set(entry.date, { ...entry });
      }
    }

    // Sort distinct working leave days chronologically
    const sortedDays = Array.from(byDateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Merge into spells
    let currentSpellDays: WorkingDayLeaveEntry[] = [sortedDays[0]];

    for (let i = 1; i < sortedDays.length; i++) {
      const prevDay = sortedDays[i - 1];
      const nextDay = sortedDays[i];

      if (areOnlyNonWorkingDaysBetween(prevDay.date, nextDay.date, holidaySet)) {
        // Continuous: separated only by non-working days
        currentSpellDays.push(nextDay);
      } else {
        // Spell ended: finalize previous spell
        allSpells.push(finalizeSpell(employeeId, employeeName, employeeCode, department, office, currentSpellDays, holidaySet));
        currentSpellDays = [nextDay];
      }
    }

    // Finalize trailing spell
    if (currentSpellDays.length > 0) {
      allSpells.push(finalizeSpell(employeeId, employeeName, employeeCode, department, office, currentSpellDays, holidaySet));
    }
  }

  // Sort spells chronologically
  return allSpells.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function finalizeSpell(
  employeeId: string,
  employeeName: string,
  employeeCode: string,
  department: string,
  office: string,
  days: WorkingDayLeaveEntry[],
  holidaySet?: Set<string>
): LeaveSpell {
  const startDate = days[0].date;
  const endDate = days[days.length - 1].date;
  const calendarSpan = calendarDaysDiff(startDate, endDate) + 1;

  let leaveDays = 0;
  let hasHalfDay = false;
  const typeMix: Record<string, number> = {};
  const sourcesSet = new Set<string>();
  const requestIdsSet = new Set<string>();
  const certUrlsSet = new Set<string>();

  for (const d of days) {
    leaveDays += d.weight;
    if (d.isHalfDay) hasHalfDay = true;
    typeMix[d.typeCode] = Math.round(((typeMix[d.typeCode] || 0) + d.weight) * 100) / 100;
    sourcesSet.add(d.source);
    requestIdsSet.add(d.requestId);
    if (d.medicalCertUrl) certUrlsSet.add(d.medicalCertUrl);
  }

  leaveDays = Math.round(leaveDays * 100) / 100;

  const attachment = classifySpellAttachment(startDate, endDate, leaveDays, holidaySet);

  return {
    id: `${employeeId}_${startDate}_${endDate}`,
    employeeId,
    employeeName,
    employeeCode,
    department,
    office,
    startDate,
    endDate,
    calendarSpan,
    leaveDays,
    hasHalfDay,
    typeMix,
    sources: Array.from(sourcesSet),
    requestIds: Array.from(requestIdsSet),
    medicalCertUrls: Array.from(certUrlsSet),
    attachment,
    dayDetails: days,
  };
}
