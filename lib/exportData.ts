import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { AttendanceRecord, EmployeeSummary, LeaveRecord, LeaveType } from './types';
import { durationToMinutes } from './parseCSV';

const LEAVE_LABELS: Record<LeaveType, string> = {
  planned: 'Planned Leave', casual: 'Casual Leave', sick: 'Sick Leave', lwp: 'LWP', half_day: 'Half Day',
};
function buildLeaveLookup(leaveRecords: LeaveRecord[] = []): Map<string, LeaveRecord> {
  const m = new Map<string, LeaveRecord>();
  for (const l of leaveRecords) m.set(`${l.employeeCode}__${l.date}`, l);
  return m;
}

const SHIFT_MINUTES = 480; // 8 effective hours (9h shift minus 1h lunch)             // 9h shift
const SHIFT_START_MINUTES = 9 * 60 + 30; // 09:30
const SHIFT_END_MINUTES = 18 * 60 + 30;  // 18:30

// We compute late/early from raw inTime/outTime rather than trusting the
// CSV's lateBy/earlyBy columns — the biometric system may use 9:00 as shift
// start and will under-report lateness for a 9:30 policy.
function timeStringToMinutes(t: string): number {
  if (!t || t === '--' || t === '') return -1;
  const p = t.split(':');
  if (p.length < 2) return -1;
  const h = parseInt(p[0], 10), m = parseInt(p[1], 10);
  return isNaN(h) || isNaN(m) ? -1 : h * 60 + m;
}
function computeLate(inTime: string, graceMinutes = 10): number {
  const m = timeStringToMinutes(inTime);
  return m < 0 ? 0 : Math.max(0, m - SHIFT_START_MINUTES - graceMinutes);
}
function computeEarly(outTime: string, graceMinutes = 10): number {
  const m = timeStringToMinutes(outTime);
  return m <= 0 ? 0 : Math.max(0, SHIFT_END_MINUTES - graceMinutes - m);
}
// A5: prefer CSV lateBy/earlyBy when present & valid
function lateMinsFor(r: AttendanceRecord, graceMinutes = 10): number {
  if (!r.lateIsEstimated && r.lateBy) { const m = durationToMinutes(r.lateBy); if (m >= 0) return m; }
  return computeLate(r.inTime, graceMinutes);
}
function earlyMinsFor(r: AttendanceRecord, graceMinutes = 10): number {
  if (!r.earlyIsEstimated && r.earlyBy) { const m = durationToMinutes(r.earlyBy); if (m >= 0) return m; }
  return computeEarly(r.outTime, graceMinutes);
}
function minsToHHMM(mins: number): string {
  if (mins <= 0) return '0:00';
  return `${Math.floor(mins / 60)}:${(mins % 60).toString().padStart(2, '0')}`;
}

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '0F1F3D' } },
  alignment: { horizontal: 'center' as const },
};

function applyHeaderStyle(ws: XLSX.WorkSheet) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let C = range.s.c; C <= range.e.c; C++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c: C });
    if (ws[addr]) ws[addr].s = HEADER_STYLE;
  }
}

function autoColWidths(ws: XLSX.WorkSheet, keys: string[]) {
  ws['!cols'] = keys.map(k => ({ wch: Math.max(k.length + 2, 14) }));
}

function isPresent(s: string) { return s.toLowerCase().includes('present') && !s.toLowerCase().includes('absent'); }
function isAbsent(s: string) { return s.toLowerCase().includes('absent'); }
function isWeeklyOff(s: string) { return s.toLowerCase().includes('weeklyoff'); }
function colorStatus(rate: number): string {
  if (rate >= 80) return 'Green';
  if (rate >= 70) return 'Amber';
  return 'Red';
}

export function exportExcel(
  records: AttendanceRecord[],
  summaries: EmployeeSummary[],
  label: string,
  leaveRecords: LeaveRecord[] = []
): void {
  const leaveLookup = buildLeaveLookup(leaveRecords);
  const wb = XLSX.utils.book_new();
  const workRecords = records.filter(r => !isWeeklyOff(r.status));
  const presentRecords = workRecords.filter(r => isPresent(r.status));
  const absentRecords = workRecords.filter(r => isAbsent(r.status));
  const scheduled = workRecords.length;
  const presentCount = presentRecords.length;
  const absentCount = absentRecords.length;

  const lateRecords = presentRecords.filter(r => lateMinsFor(r) > 0);
  const earlyRecords = presentRecords.filter(r => earlyMinsFor(r) > 0);
  const totalLostMins = presentRecords.reduce((sum, r) => sum + lateMinsFor(r) + earlyMinsFor(r), 0);
  const totalShiftMins = presentCount * SHIFT_MINUTES;
  const productivityLost = totalShiftMins > 0 ? (totalLostMins / totalShiftMins) * 100 : 0;

  const presentWithDuration = presentRecords.filter(r => durationToMinutes(r.duration) > 0);
  const totalMins = presentWithDuration.reduce((sum, r) => sum + durationToMinutes(r.duration), 0);
  const avgWorkingHours = presentWithDuration.length > 0 ? totalMins / presentWithDuration.length / 60 : 0;

  const offices = [...new Set(records.map(r => r.officeCode))].filter(Boolean).join(', ');
  const uniqueEmps = new Set(records.map(r => r.employeeCode)).size;

  // ── Sheet 1: Executive Summary ────────────────────────────────────────────
  const execSummaryRows = [
    { Metric: 'Month / Period', Value: label },
    { Metric: 'Office(s)', Value: offices },
    { Metric: 'Total Employees', Value: uniqueEmps },
    { Metric: 'Total Scheduled Days', Value: scheduled },
    { Metric: 'Overall Attendance %', Value: scheduled > 0 ? `${((presentCount / scheduled) * 100).toFixed(1)}%` : '—' },
    { Metric: 'Absenteeism %', Value: scheduled > 0 ? `${((absentCount / scheduled) * 100).toFixed(1)}%` : '—' },
    { Metric: 'Avg Working Hours / Day', Value: `${avgWorkingHours.toFixed(2)}h` },
    { Metric: 'Late Arrival Rate', Value: presentCount > 0 ? `${((lateRecords.length / presentCount) * 100).toFixed(1)}%` : '—' },
    { Metric: 'Early Exit Rate', Value: presentCount > 0 ? `${((earlyRecords.length / presentCount) * 100).toFixed(1)}%` : '—' },
    { Metric: 'Productivity Lost %', Value: `${productivityLost.toFixed(1)}%` },
    { Metric: 'Shift Timing', Value: '09:30 – 18:30 (480 effective mins, excl. 1h lunch)' },
    { Metric: 'Total Late Arrivals', Value: lateRecords.length },
    { Metric: 'Total Early Exits', Value: earlyRecords.length },
    { Metric: 'Total Absent Days', Value: absentCount },
  ];
  const ws1 = XLSX.utils.json_to_sheet(execSummaryRows);
  applyHeaderStyle(ws1);
  ws1['!cols'] = [{ wch: 28 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Executive Summary');

  // ── Sheet 2: Discipline Issues ────────────────────────────────────────────
  const disciplineRows: any[] = [];
  for (const emp of summaries) {
    // Recompute counts from raw records so they match our shift policy
    const empPresentRecs = (emp.records || []).filter(r => isPresent(r.status));
    const lateCount = empPresentRecs.filter(r => lateMinsFor(r) > 0).length;
    const earlyCount = empPresentRecs.filter(r => earlyMinsFor(r) > 0).length;
    const absentDays = emp.absentDays;

    const flags: string[] = [];
    if (lateCount > 5) flags.push('Frequent Late Arrivals');
    if (earlyCount > 5) flags.push('Frequent Early Exits');
    if (absentDays > 4) flags.push('High Absenteeism');
    if ((lateCount + earlyCount) > 8) flags.push('Overall Discipline Concern');
    if (flags.length === 0) continue;

    disciplineRows.push({
      'Employee Name': emp.employeeName,
      'Employee Code': emp.employeeCode,
      Department: emp.department,
      Office: emp.officeCode,
      'Late Count': lateCount,
      'Early Exit Count': earlyCount,
      'Absent Days': absentDays,
      Flags: flags.join(', '),
    });
  }
  disciplineRows.sort((a, b) => b['Late Count'] + b['Early Exit Count'] - (a['Late Count'] + a['Early Exit Count']));
  const ws2 = disciplineRows.length > 0
    ? XLSX.utils.json_to_sheet(disciplineRows)
    : XLSX.utils.json_to_sheet([{ Note: 'No discipline issues found for this period.' }]);
  applyHeaderStyle(ws2);
  if (disciplineRows.length > 0) autoColWidths(ws2, Object.keys(disciplineRows[0]));
  XLSX.utils.book_append_sheet(wb, ws2, 'Discipline Issues');

  // ── Sheet 3: Department Summary ───────────────────────────────────────────
  const deptMap = new Map<string, { present: number; absent: number; lateCount: number; earlyCount: number; totalMins: number; presentCount: number; emps: Set<string> }>();
  for (const r of workRecords) {
    const d = r.department || 'Unknown';
    if (!deptMap.has(d)) deptMap.set(d, { present: 0, absent: 0, lateCount: 0, earlyCount: 0, totalMins: 0, presentCount: 0, emps: new Set() });
    const dept = deptMap.get(d)!;
    dept.emps.add(r.employeeCode);
    if (isPresent(r.status)) {
      dept.present++;
      const mins = durationToMinutes(r.duration);
      if (mins > 0) { dept.totalMins += mins; dept.presentCount++; }
      if (lateMinsFor(r) > 0) dept.lateCount++;
      if (earlyMinsFor(r) > 0) dept.earlyCount++;
    } else if (isAbsent(r.status)) {
      dept.absent++;
    }
  }
  const deptRows = Array.from(deptMap.entries()).map(([dept, v]) => {
    const total = v.present + v.absent;
    const rate = total > 0 ? parseFloat(((v.present / total) * 100).toFixed(1)) : 0;
    return {
      Department: dept,
      'Total Employees': v.emps.size,
      'Attendance %': `${rate}%`,
      'Avg Hours/Day': v.presentCount > 0 ? `${(v.totalMins / v.presentCount / 60).toFixed(2)}h` : '—',
      'Late Count': v.lateCount,
      'Early Exit Count': v.earlyCount,
      'Absent Days': v.absent,
      Status: colorStatus(rate),
    };
  }).sort((a, b) => parseFloat(a['Attendance %']) - parseFloat(b['Attendance %']));
  const ws3 = XLSX.utils.json_to_sheet(deptRows);
  applyHeaderStyle(ws3);
  autoColWidths(ws3, Object.keys(deptRows[0] || {}));
  XLSX.utils.book_append_sheet(wb, ws3, 'Department Summary');

  // ── Sheet 4: Employee Summary ─────────────────────────────────────────────
  const empSummaryRows = summaries.map(emp => {
    const total = emp.presentDays + emp.absentDays;
    const rate = total > 0 ? parseFloat(((emp.presentDays / total) * 100).toFixed(1)) : 0;
    // Use recomputed counts from the summary (already uses computeLate/computeEarly)
    return {
      'Employee Code': emp.employeeCode,
      'Employee Name': emp.employeeName,
      Department: emp.department,
      Office: emp.officeCode,
      'Present Days': emp.presentDays,
      'Absent Days': emp.absentDays,
      'Late Count': emp.lateCount,
      'Early Exit Count': emp.earlyExitCount,
      'Planned Leave': emp.plannedLeaveCount,
      'Casual Leave': emp.casualLeaveCount,
      'Sick Leave': emp.sickLeaveCount,
      LWP: emp.lwpCount,
      'Half Day': emp.halfDayCount,
      'Avg Hours/Day': emp.avgHoursWorked,
      'Attendance %': `${rate}%`,
      Status: colorStatus(rate),
    };
  }).sort((a, b) => parseFloat(a['Attendance %']) - parseFloat(b['Attendance %']));
  const ws4 = XLSX.utils.json_to_sheet(empSummaryRows);
  applyHeaderStyle(ws4);
  autoColWidths(ws4, Object.keys(empSummaryRows[0] || {}));
  XLSX.utils.book_append_sheet(wb, ws4, 'Employee Summary');

  // ── Sheet 5: Day-wise Detail with Flags ───────────────────────────────────
  const detailRows = records.map(r => {
    const lateMin = lateMinsFor(r);
    const earlyMin = earlyMinsFor(r);
    const flags: string[] = [];
    if (isAbsent(r.status)) flags.push('Absent');
    if (lateMin > 0) flags.push('Late Arrival');
    if (earlyMin > 0) flags.push('Early Exit');
    if ((!r.outTime || r.outTime === '--' || r.outTime === '') && isPresent(r.status)) flags.push('No Out-Punch');
    const leave = leaveLookup.get(`${r.employeeCode}__${r.date}`);
    const displayStatus = leave
      ? (leave.leaveType === 'half_day' && leave.halfDayLeaveType ? `Half Day — ${LEAVE_LABELS[leave.halfDayLeaveType]}` : LEAVE_LABELS[leave.leaveType])
      : r.status;
    return {
      Date: r.date,
      'Employee Code': r.employeeCode,
      'Employee Name': r.employeeName,
      Department: r.department,
      Office: r.officeCode,
      'In Time': r.inTime,
      'Out Time': r.outTime,
      Status: displayStatus,
      'Raw Status': r.status,
      // Show computed values so they reflect the 9:30 policy
      'Late By (computed)': lateMin > 0 ? minsToHHMM(lateMin) : '',
      'Early By (computed)': earlyMin > 0 ? minsToHHMM(earlyMin) : '',
      'Late By (CSV)': r.lateBy,
      'Early By (CSV)': r.earlyBy,
      Duration: r.duration,
      Flags: flags.join(', '),
    };
  });
  const ws5 = XLSX.utils.json_to_sheet(detailRows);
  applyHeaderStyle(ws5);
  autoColWidths(ws5, Object.keys(detailRows[0] || {}));
  XLSX.utils.book_append_sheet(wb, ws5, 'Day-wise Detail');

  const filename = `Attendance_Insights_${label}.xlsx`;
  XLSX.writeFile(wb, filename);
}

export function exportCSV(records: AttendanceRecord[], label: string, leaveRecords: LeaveRecord[] = []): void {
  const leaveLookup = buildLeaveLookup(leaveRecords);
  const rows = records.map(r => {
    const lateMin = lateMinsFor(r);
    const earlyMin = earlyMinsFor(r);
    const flags: string[] = [];
    if (lateMin > 0) flags.push('Late Arrival');
    if (earlyMin > 0) flags.push('Early Exit');
    if (isAbsent(r.status)) flags.push('Absent');
    if ((!r.outTime || r.outTime === '--') && isPresent(r.status)) flags.push('No Out-Punch');
    const leave = leaveLookup.get(`${r.employeeCode}__${r.date}`);
    return {
      Date: r.date,
      'Employee Code': r.employeeCode,
      'Employee Name': r.employeeName,
      Department: r.department,
      Office: r.officeCode,
      'In Time': r.inTime,
      'Out Time': r.outTime,
      Status: r.status,
      'Late By (computed)': lateMin > 0 ? minsToHHMM(lateMin) : '',
      'Early By (computed)': earlyMin > 0 ? minsToHHMM(earlyMin) : '',
      Duration: r.duration,
      leave_type: leave ? leave.leaveType : '',
      Flags: flags.join(', '),
    };
  });
  const csv = Papa.unparse(rows);
  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Attendance_Raw_${label}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
