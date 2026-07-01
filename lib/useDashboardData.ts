import { useMemo } from 'react';
import {
  AttendanceRecord, KPIData, EmployeeSummary, DailyTrend, DeptAttendance,
  HoursDistribution, Holiday, OfficeAttendance, LeaveRecord, Thresholds, EffectiveStatus
} from './types';
import { durationToMinutes, minutesToHHMM } from './parseCSV';
import { isHoliday, getHolidayName } from './holidays';
import { DEFAULT_THRESHOLDS } from './settings';

// v4: 8 effective hours (9h shift minus 1h lunch)
export const SHIFT_MINUTES = 8 * 60;             // 480
export const SHIFT_START_MINUTES = 9 * 60 + 30;  // 570 — 09:30 AM
export const SHIFT_END_MINUTES = 18 * 60 + 30;   // 1110 — 18:30

export function isPresent(status: string): boolean {
  const s = status.toLowerCase();
  return s.includes('present') && !s.includes('absent');
}

export function isAbsent(status: string): boolean {
  const s = status.toLowerCase();
  return s.includes('absent') || s === 'absent (no outpunch)';
}

export function isWeeklyOff(status: string): boolean {
  return status.toLowerCase().includes('weeklyoff');
}

export function colorStatus(rate: number, greenThreshold: number, amberThreshold: number, reverse = false): 'green' | 'amber' | 'red' {
  if (!reverse) {
    if (rate >= greenThreshold) return 'green';
    if (rate >= amberThreshold) return 'amber';
    return 'red';
  } else {
    if (rate < greenThreshold) return 'green';
    if (rate < amberThreshold) return 'amber';
    return 'red';
  }
}

export function timeStringToMinutes(timeStr: string): number {
  if (!timeStr || timeStr === '--' || timeStr === '') return -1;
  const parts = timeStr.split(':');
  if (parts.length < 2) return -1;
  const hours = parseInt(parts[0], 10);
  const mins = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(mins)) return -1;
  return hours * 60 + mins;
}

// A4: grace period configurable, default 10 minutes. Shift start/end are also
// configurable now (Settings → Shift Window) — DO NOT assume 09:30–18:30, that
// was the source of wildly wrong Late/Early rates for offices on other shifts.
export function computeLateMinutes(
  inTime: string,
  graceMinutes: number = 10,
  shiftStart: number = SHIFT_START_MINUTES
): number {
  const inMins = timeStringToMinutes(inTime);
  if (inMins < 0) return 0;
  return Math.max(0, inMins - shiftStart - graceMinutes);
}

export function computeEarlyMinutes(
  outTime: string,
  graceMinutes: number = 10,
  shiftEnd: number = SHIFT_END_MINUTES
): number {
  const outMins = timeStringToMinutes(outTime);
  if (outMins <= 0) return 0;
  return Math.max(0, shiftEnd - graceMinutes - outMins);
}

// A5: prefer the CSV's own lateBy/earlyBy when present & valid; otherwise
// fall back to computing from raw punches using the configured grace period
// and the configured shift window.
export function getLateMinutes(
  r: AttendanceRecord,
  graceMinutes: number,
  shiftStart: number = SHIFT_START_MINUTES
): number {
  if (!r.lateIsEstimated && r.lateBy) {
    const m = durationToMinutes(r.lateBy);
    if (m >= 0) return m;
  }
  return computeLateMinutes(r.inTime, graceMinutes, shiftStart);
}

export function getEarlyMinutes(
  r: AttendanceRecord,
  graceMinutes: number,
  shiftEnd: number = SHIFT_END_MINUTES
): number {
  if (!r.earlyIsEstimated && r.earlyBy) {
    const m = durationToMinutes(r.earlyBy);
    if (m >= 0) return m;
  }
  return computeEarlyMinutes(r.outTime, graceMinutes, shiftEnd);
}

// B7.3: join an AttendanceRecord with any LeaveRecord for that employee+date
export function getEffectiveStatus(
  r: AttendanceRecord,
  leave: LeaveRecord | undefined,
  holidays: Holiday[]
): EffectiveStatus {
  if (isWeeklyOff(r.status)) return 'weeklyoff';
  if (isHoliday(r.date, holidays) && !isPresent(r.status)) return 'holiday';
  if (leave) {
    if (leave.leaveType === 'half_day') return 'half_day';
    if (leave.leaveType === 'planned') return 'leave_planned';
    if (leave.leaveType === 'casual') return 'leave_casual';
    if (leave.leaveType === 'sick') return 'leave_sick';
    if (leave.leaveType === 'lwp') return 'leave_lwp';
  }
  if (isPresent(r.status)) return 'present';
  return 'absent';
}

export function leaveKey(employeeCode: string, date: string): string {
  return `${employeeCode}__${date}`;
}

export function buildLeaveMap(leaveRecords: LeaveRecord[]): Map<string, LeaveRecord> {
  const m = new Map<string, LeaveRecord>();
  for (const l of leaveRecords) m.set(leaveKey(l.employeeCode, l.date), l);
  return m;
}

// ── B8: shared leave-aware KPI calculator, used for employee-vs-employee and
// employee-vs-own-history comparisons (TeamComparisonPanel / EmployeeComparisonPanel) ──
export interface ComparisonKPIs {
  attendanceRate: number;
  absenteeismRate: number;
  avgHoursPerDay: number;
  lateArrivalRate: number;
  earlyExitRate: number;
  productivityLost: number;
  presentDays: number;
  absentDays: number;
  plannedLeaveCount: number;
  casualLeaveCount: number;
  sickLeaveCount: number;
  lwpCount: number;
  halfDayCount: number;
  scheduledDays: number;
  // sample sizes the rates above were computed over, so the UI can flag
  // "rate computed from only N days" instead of looking like a bug
  presentSampleSize: number;
}

export function computeEmployeeKPIs(
  records: AttendanceRecord[],
  leaveMap: Map<string, LeaveRecord>,
  holidays: Holiday[] = [],
  grace: number = 10,
  shiftStart: number = SHIFT_START_MINUTES,
  shiftEnd: number = SHIFT_END_MINUTES
): ComparisonKPIs {
  const workRecords = records.filter((r) => {
    if (isWeeklyOff(r.status)) return false;
    if (isHoliday(r.date, holidays) && !isPresent(r.status)) return false;
    return true;
  });

  const presentRecords = workRecords.filter((r) => isPresent(r.status) && !r.isShortDay);
  const absentRecordsAll = workRecords.filter((r) => isAbsent(r.status));
  const halfDayRecords = workRecords.filter(
    (r) => r.isShortDay && leaveMap.get(leaveKey(r.employeeCode, r.date))?.leaveType === 'half_day'
  );

  let plannedLeaveCount = 0, unexplainedAbsentCount = 0, casualLeaveCount = 0, sickLeaveCount = 0, lwpCount = 0;
  for (const r of absentRecordsAll) {
    const leave = leaveMap.get(leaveKey(r.employeeCode, r.date));
    if (!leave) { unexplainedAbsentCount++; continue; }
    if (leave.leaveType === 'planned') plannedLeaveCount++;
    else if (leave.leaveType === 'casual') casualLeaveCount++;
    else if (leave.leaveType === 'sick') sickLeaveCount++;
    else if (leave.leaveType === 'lwp') { lwpCount++; unexplainedAbsentCount++; }
    else unexplainedAbsentCount++;
  }
  const halfDayCount = halfDayRecords.length;

  const scheduledDays = workRecords.length;
  const absentDays = unexplainedAbsentCount;
  const presentDays = presentRecords.length + halfDayCount * 0.5;

  // Planned/casual/sick leave is "explained" and doesn't count against attendance rate,
  // matching how the main KPI cards treat the org-wide rate.
  const explainedLeave = plannedLeaveCount + casualLeaveCount + sickLeaveCount;
  const denom = scheduledDays - explainedLeave;
  const attendanceRate = denom > 0 ? (presentDays / denom) * 100 : 0;
  const absenteeismRate = scheduledDays > 0 ? (absentDays / scheduledDays) * 100 : 0;

  const presentWithDuration = presentRecords.filter((r) => durationToMinutes(r.duration) > 0);
  const totalMins = presentWithDuration.reduce((sum, r) => sum + durationToMinutes(r.duration), 0);
  const avgHoursPerDay = presentWithDuration.length > 0 ? totalMins / presentWithDuration.length / 60 : 0;

  const lateRecords = presentRecords.filter((r) => getLateMinutes(r, grace, shiftStart) > 0);
  const earlyRecords = presentRecords.filter((r) => getEarlyMinutes(r, grace, shiftEnd) > 0);
  const lateArrivalRate = presentRecords.length > 0 ? (lateRecords.length / presentRecords.length) * 100 : 0;
  const earlyExitRate = presentRecords.length > 0 ? (earlyRecords.length / presentRecords.length) * 100 : 0;

  const totalLostMins = presentRecords.reduce(
    (sum, r) => sum + getLateMinutes(r, grace, shiftStart) + getEarlyMinutes(r, grace, shiftEnd), 0
  );
  const totalShiftMins = presentRecords.length * SHIFT_MINUTES;
  const productivityLost = totalShiftMins > 0 ? (totalLostMins / totalShiftMins) * 100 : 0;

  return {
    attendanceRate, absenteeismRate, avgHoursPerDay, lateArrivalRate, earlyExitRate,
    productivityLost, presentDays, absentDays, plannedLeaveCount, casualLeaveCount,
    sickLeaveCount, lwpCount, halfDayCount, scheduledDays,
    presentSampleSize: presentRecords.length,
  };
}

export function useDashboardData(
  records: AttendanceRecord[],
  selectedOffice: string,
  selectedDepartments: string[],
  selectedEmployees: string[] = [],
  holidays: Holiday[] = [],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
  leaveRecords: LeaveRecord[] = [],
  allOfficeRecords: AttendanceRecord[] = [],
  dateFrom: string | null = null,  // YYYY-MM-DD inclusive start (null = no filter)
  dateTo: string | null = null     // YYYY-MM-DD inclusive end   (null = no filter)
) {
  // Derive view mode per SRS §12.1
  const isSingleDay = !!(dateFrom && dateTo && dateFrom === dateTo);
  const isDateRange = !!(dateFrom && dateTo && dateFrom !== dateTo);
  const viewMode: import('./types').ViewMode =
    selectedDepartments.length >= 2 ? 'comparison'
    : isSingleDay ? 'single_day'
    : 'monthly';

  const grace = thresholds.graceMinutes;
  const leaveMap = useMemo(() => buildLeaveMap(leaveRecords), [leaveRecords]);

  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (selectedOffice !== 'ALL' && r.officeCode !== selectedOffice) return false;
      if (selectedDepartments.length > 0 && !selectedDepartments.includes(r.department)) return false;
      if (selectedEmployees.length > 0 && !selectedEmployees.includes(r.employeeCode)) return false;
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo && r.date > dateTo) return false;
      return true;
    });
  }, [records, selectedOffice, selectedDepartments, selectedEmployees, dateFrom, dateTo]);

  const kpi: KPIData = useMemo(() => {
    const workRecords = filtered.filter((r) => {
      if (isWeeklyOff(r.status)) return false;
      if (isHoliday(r.date, holidays) && !isPresent(r.status)) return false;
      return true;
    });

    const shortDayRecordsAll = workRecords.filter(r => r.isShortDay);
    const halfDayRecords = shortDayRecordsAll.filter(r => leaveMap.get(leaveKey(r.employeeCode, r.date))?.leaveType === 'half_day');
    const shortDayRecords = shortDayRecordsAll.filter(r => !halfDayRecords.includes(r));
    const shortDayCount = shortDayRecords.length;

    const presentRecords = workRecords.filter((r) => isPresent(r.status) && !r.isShortDay);
    const absentRecordsAll = workRecords.filter((r) => isAbsent(r.status));

    let plannedLeaveCount = 0, casualLeaveCount = 0, sickLeaveCount = 0, lwpCount = 0, unexplainedAbsentCount = 0;
    for (const r of absentRecordsAll) {
      const leave = leaveMap.get(leaveKey(r.employeeCode, r.date));
      if (!leave) { unexplainedAbsentCount++; continue; }
      if (leave.leaveType === 'planned') plannedLeaveCount++;
      else if (leave.leaveType === 'casual') casualLeaveCount++;
      else if (leave.leaveType === 'sick') sickLeaveCount++;
      else if (leave.leaveType === 'lwp') { lwpCount++; }
      else unexplainedAbsentCount++;
    }
    const halfDayCount = halfDayRecords.length;

    const absentCount = unexplainedAbsentCount + lwpCount;
    const scheduledCount = workRecords.length;
    const presentCount = presentRecords.length + halfDayCount * 0.5;

    const attendanceRate = scheduledCount > 0 ? (presentCount / scheduledCount) * 100 : 0;
    const absenteeismRate = scheduledCount > 0 ? (absentCount / scheduledCount) * 100 : 0;

    const presentWithDuration = presentRecords.filter((r) => durationToMinutes(r.duration) > 0);
    const totalMins = presentWithDuration.reduce((sum, r) => sum + durationToMinutes(r.duration), 0);
    const avgWorkingHours = presentWithDuration.length > 0 ? totalMins / presentWithDuration.length / 60 : 0;

    const lateRecords = presentRecords.filter((r) => getLateMinutes(r, grace) > 0);
    const earlyRecords = presentRecords.filter((r) => getEarlyMinutes(r, grace) > 0);
    const lateArrivalRate = presentRecords.length > 0 ? (lateRecords.length / presentRecords.length) * 100 : 0;
    const earlyExitRate = presentRecords.length > 0 ? (earlyRecords.length / presentRecords.length) * 100 : 0;

    const totalLostMins = presentRecords.reduce(
      (sum, r) => sum + getLateMinutes(r, grace) + getEarlyMinutes(r, grace),
      0
    );
    const totalShiftMins = presentRecords.length * SHIFT_MINUTES;
    const productivityLost = totalShiftMins > 0 ? (totalLostMins / totalShiftMins) * 100 : 0;

    const empPunchMap = new Map<string, number>();
    for (const r of filtered) {
      if ((r.punchCount ?? 1) >= thresholds.frequentPunchCount) {
        empPunchMap.set(r.employeeCode, (empPunchMap.get(r.employeeCode) || 0) + 1);
      }
    }
    const frequentPuncherCount = empPunchMap.size;

    return {
      attendanceRate, absenteeismRate, avgWorkingHours,
      lateArrivalRate, earlyExitRate, productivityLost,
      shortDayCount, frequentPuncherCount,
      presentCount, absentCount, lateCount: lateRecords.length,
      earlyExitCount: earlyRecords.length, scheduledCount,
      unexplainedAbsentCount, plannedLeaveCount, casualLeaveCount, sickLeaveCount, lwpCount, halfDayCount,
      productivityLostHours: totalLostMins / 60,
    };
  }, [filtered, holidays, grace, thresholds.frequentPunchCount, leaveMap]);

  const employeeSummaries: EmployeeSummary[] = useMemo(() => {
    const map = new Map<string, EmployeeSummary>();

    for (const r of filtered) {
      const key = `${r.employeeCode}_${r.officeCode}`;
      if (!map.has(key)) {
        map.set(key, {
          employeeCode: r.employeeCode,
          employeeName: r.employeeName,
          department: r.department,
          officeCode: r.officeCode,
          presentDays: 0,
          absentDays: 0,
          lateCount: 0,
          earlyExitCount: 0,
          avgHoursWorked: '0:00',
          totalMinutes: 0,
          worstStatus: 'green',
          shortDayCount: 0,
          frequentPunchDays: 0,
          records: [],
          plannedLeaveCount: 0, casualLeaveCount: 0, sickLeaveCount: 0, lwpCount: 0, halfDayCount: 0,
        });
      }

      const emp = map.get(key)!;
      emp.records!.push(r);

      const leave = leaveMap.get(leaveKey(r.employeeCode, r.date));

      if (r.isShortDay && leave?.leaveType === 'half_day') {
        emp.halfDayCount++;
        emp.presentDays += 0.5;
      } else if (r.isShortDay) {
        emp.shortDayCount++;
      } else if (isPresent(r.status)) {
        emp.presentDays++;
        const mins = durationToMinutes(r.duration);
        emp.totalMinutes += mins;
        if (getLateMinutes(r, grace) > 0) emp.lateCount++;
        if (getEarlyMinutes(r, grace) > 0) emp.earlyExitCount++;
      } else if (isAbsent(r.status)) {
        if (leave?.leaveType === 'planned') emp.plannedLeaveCount++;
        else if (leave?.leaveType === 'casual') emp.casualLeaveCount++;
        else if (leave?.leaveType === 'sick') emp.sickLeaveCount++;
        else if (leave?.leaveType === 'lwp') { emp.lwpCount++; emp.absentDays++; }
        else emp.absentDays++;
      }

      if ((r.punchCount ?? 1) >= thresholds.frequentPunchCount) {
        emp.frequentPunchDays++;
      }
    }

    return Array.from(map.values()).map((emp) => {
      const avgMins = emp.presentDays > 0 ? Math.round(emp.totalMinutes / emp.presentDays) : 0;
      emp.avgHoursWorked = minutesToHHMM(avgMins);

      const total = emp.presentDays + emp.absentDays;
      const rate = total > 0 ? (emp.presentDays / total) * 100 : 0;
      emp.worstStatus = colorStatus(rate, thresholds.attendanceRateGreen, thresholds.attendanceRateAmber);

      const presentRecs = (emp.records || []).filter(r => isPresent(r.status) && !r.isShortDay);

      const lateMinsArr = presentRecs.map(r => getLateMinutes(r, grace)).filter(m => m > 0);
      emp.avgLateMinutes = lateMinsArr.length > 0
        ? Math.round(lateMinsArr.reduce((a, b) => a + b, 0) / lateMinsArr.length) : 0;

      const earlyMinsArr = presentRecs.map(r => getEarlyMinutes(r, grace)).filter(m => m > 0);
      emp.avgEarlyExitMinutes = earlyMinsArr.length > 0
        ? Math.round(earlyMinsArr.reduce((a, b) => a + b, 0) / earlyMinsArr.length) : 0;

      const inTimes = presentRecs.map(r => timeStringToMinutes(r.inTime)).filter(m => m >= 0);
      const outTimes = presentRecs.map(r => timeStringToMinutes(r.outTime)).filter(m => m > 0);
      emp.latestInTime = inTimes.length > 0 ? Math.max(...inTimes) : -1;
      emp.earliestOutTime = outTimes.length > 0 ? Math.min(...outTimes) : -1;

      emp.dayWiseLateEarly = presentRecs
        .map(r => ({
          date: r.date,
          inTime: r.inTime,
          outTime: r.outTime,
          lateMinutes: getLateMinutes(r, grace),
          earlyMinutes: getEarlyMinutes(r, grace),
        }))
        .filter(d => d.lateMinutes > 0 || d.earlyMinutes > 0)
        .sort((a, b) => a.date.localeCompare(b.date));

      return emp;
    });
  }, [filtered, grace, thresholds.frequentPunchCount, thresholds.attendanceRateGreen, thresholds.attendanceRateAmber, leaveMap]);

  const dailyTrend: DailyTrend[] = useMemo(() => {
    const byDate = new Map<string, {
      present: number; total: number; absentees: string[];
      late: number; earlyExit: number; lostMins: number; shortDay: number;
    }>();

    for (const r of filtered) {
      if (isWeeklyOff(r.status)) continue;
      if (isHoliday(r.date, holidays) && !isPresent(r.status)) continue;
      if (!byDate.has(r.date)) byDate.set(r.date, { present: 0, total: 0, absentees: [], late: 0, earlyExit: 0, lostMins: 0, shortDay: 0 });
      const d = byDate.get(r.date)!;
      d.total++;
      if (r.isShortDay) {
        d.shortDay++;
      } else if (isPresent(r.status)) {
        d.present++;
        if (getLateMinutes(r, grace) > 0) { d.late++; d.lostMins += getLateMinutes(r, grace); }
        if (getEarlyMinutes(r, grace) > 0) { d.earlyExit++; d.lostMins += getEarlyMinutes(r, grace); }
      } else if (isAbsent(r.status)) {
        d.absentees.push(r.employeeName || r.employeeCode);
      }
    }

    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { present, total, absentees, late, earlyExit, lostMins, shortDay }]) => ({
        date: date.slice(5),
        rawDate: date,           // YYYY-MM-DD — used by date-click handlers in Charts
        attendanceRate: total > 0 ? Math.round((present / total) * 100) : 0,
        presentCount: present,
        totalCount: total,
        absentees,
        lateCount: late,
        earlyExitCount: earlyExit,
        hoursLost: lostMins / 60,
        shortDayCount: shortDay,
      }));
  }, [filtered, holidays, grace]);

  const deptAttendance: DeptAttendance[] = useMemo(() => {
    const byDept = new Map<string, { present: number; total: number; lostMins: number }>();

    for (const r of filtered) {
      if (isWeeklyOff(r.status) || !r.department || r.department === 'Unknown') continue;
      if (isHoliday(r.date, holidays) && !isPresent(r.status)) continue;
      if (!byDept.has(r.department)) byDept.set(r.department, { present: 0, total: 0, lostMins: 0 });
      const d = byDept.get(r.department)!;
      if (!r.isShortDay) d.total++;
      if (isPresent(r.status) && !r.isShortDay) {
        d.present++;
        d.lostMins += getLateMinutes(r, grace) + getEarlyMinutes(r, grace);
      }
    }

    return Array.from(byDept.entries())
      .map(([dept, { present, total, lostMins }]) => {
        const rate = total > 0 ? Math.round((present / total) * 100) : 0;
        return {
          department: dept,
          rate,
          status: colorStatus(rate, thresholds.attendanceRateGreen, thresholds.attendanceRateAmber),
          productivityLostDays: lostMins / SHIFT_MINUTES,
        };
      })
      .sort((a, b) => a.rate - b.rate);
  }, [filtered, holidays, grace, thresholds.attendanceRateGreen, thresholds.attendanceRateAmber]);

  // A7: office-wise attendance, computed from ALL offices regardless of the
  // currently active office filter (cross-office comparison is its whole point)
  const officeAttendance: OfficeAttendance[] = useMemo(() => {
    const source = allOfficeRecords.length > 0 ? allOfficeRecords : records;
    const byOffice = new Map<string, { present: number; total: number }>();
    for (const r of source) {
      if (selectedDepartments.length > 0 && !selectedDepartments.includes(r.department)) continue;
      if (isWeeklyOff(r.status)) continue;
      if (isHoliday(r.date, holidays) && !isPresent(r.status)) continue;
      if (!byOffice.has(r.officeCode)) byOffice.set(r.officeCode, { present: 0, total: 0 });
      const d = byOffice.get(r.officeCode)!;
      if (!r.isShortDay) d.total++;
      if (isPresent(r.status) && !r.isShortDay) d.present++;
    }
    return Array.from(byOffice.entries())
      .map(([office, { present, total }]) => ({
        office, presentCount: present, scheduledCount: total,
        rate: total > 0 ? Math.round((present / total) * 100) : 0,
      }))
      .sort((a, b) => a.office.localeCompare(b.office));
  }, [allOfficeRecords, records, selectedDepartments, holidays]);

  const hoursDistribution: HoursDistribution[] = useMemo(() => {
    const deptMap = new Map<string, { totalMins: number; count: number }>();

    for (const r of filtered) {
      if (!isPresent(r.status) || r.isShortDay) continue;
      const mins = durationToMinutes(r.duration);
      if (mins <= 0) continue;
      const dept = r.department || 'Unknown';
      if (!deptMap.has(dept)) deptMap.set(dept, { totalMins: 0, count: 0 });
      const d = deptMap.get(dept)!;
      d.totalMins += mins;
      d.count++;
    }

    return Array.from(deptMap.entries()).map(([dept, { totalMins, count }]) => {
      const avgHours = count > 0 ? totalMins / count / 60 : 0;
      return { bin: dept, count, minHours: avgHours, avgHours, department: dept };
    }).sort((a, b) => (a.avgHours ?? 0) - (b.avgHours ?? 0));
  }, [filtered]);

  const departments = useMemo(() => {
    const set = new Set(filtered.map((r) => r.department).filter(Boolean));
    return Array.from(set).sort();
  }, [filtered]);

  const offices = useMemo(() => {
    const set = new Set(filtered.map((r) => r.officeCode).filter(Boolean));
    return Array.from(set).sort();
  }, [filtered]);

  // Single-day dept snapshot (SRS §12.6.2) — dept bars for the selected day
  const dayDeptSnapshots = useMemo((): import('./types').DayDeptSnapshot[] => {
    if (!isSingleDay) return [];
    const byDept = new Map<string, { present: number; absent: number; late: number; early: number; lostMins: number; total: number }>();
    for (const r of filtered) {
      if (isWeeklyOff(r.status) || !r.department || r.department === 'Unknown') continue;
      if (!byDept.has(r.department)) byDept.set(r.department, { present: 0, absent: 0, late: 0, early: 0, lostMins: 0, total: 0 });
      const d = byDept.get(r.department)!;
      d.total++;
      if (isPresent(r.status) && !r.isShortDay) {
        d.present++;
        const lm = getLateMinutes(r, grace);
        const em = getEarlyMinutes(r, grace);
        if (lm > 0) { d.late++; d.lostMins += lm; }
        if (em > 0) { d.early++; d.lostMins += em; }
      } else if (isAbsent(r.status)) {
        d.absent++;
      }
    }
    return Array.from(byDept.entries())
      .map(([department, { present, absent, late, early, lostMins, total }]) => ({
        department, presentCount: present, absentCount: absent,
        lateCount: late, earlyCount: early,
        hoursLost: lostMins / 60, scheduledCount: total,
      }))
      .sort((a, b) => b.presentCount - a.presentCount);
  }, [filtered, isSingleDay, grace]);

  const availableDates = useMemo(() => {
    const base = records.filter((r) => {
      if (selectedOffice !== 'ALL' && r.officeCode !== selectedOffice) return false;
      if (selectedDepartments.length > 0 && !selectedDepartments.includes(r.department)) return false;
      return true;
    });
    const set = new Set(base.map(r => r.date));
    return Array.from(set).sort();
  }, [records, selectedOffice, selectedDepartments]);

  return {
    kpi, employeeSummaries, dailyTrend, deptAttendance, hoursDistribution, officeAttendance,
    departments, offices, filteredCount: filtered.length, filteredRecords: filtered,
    availableDates, viewMode, dayDeptSnapshots,
  };
}