import { AttendanceRecord, EmployeeSummary, Thresholds, Holiday } from './types';
import { durationToMinutes } from './parseCSV';
import {
  isWeeklyOff, isAbsent, isPresent, isMissedPunchOut,
  getLateMinutes, getEarlyMinutes, computeProductivityLostMinutes, SHIFT_MINUTES,
} from './useDashboardData';
import { isHoliday } from './holidays';

const COMPANY_NAME = 'WonderBiz Technologies';

// ────────────────────────────────────────────────────────────────────────────
// NOTE ON CORRECTNESS: this file used to keep its own copy of the
// present/absent/late/early logic, with a hardcoded 9:30–18:30 shift and NO
// grace period. That meant the PDF's numbers could silently drift from what
// the live dashboard shows, and per-employee "Avg Hours" was reading field
// names that don't exist on EmployeeSummary and always fell back to 0.00h.
// Every calculation below now reuses the exact same shared functions the
// dashboard uses (imported from useDashboardData.ts) so a manager never sees
// a number in the PDF that disagrees with what's on their screen.
// ────────────────────────────────────────────────────────────────────────────

function hhmmToHours(hhmm: string | undefined): number {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  if (isNaN(h) || isNaN(m)) return 0;
  return h + m / 60;
}

// ────────────────────────────────────────────────────────────────────────────
// Theme — clean corporate white / blue
// ────────────────────────────────────────────────────────────────────────────
type RGB = [number, number, number];

const NAVY: RGB = [15, 41, 89];
const BLUE: RGB = [37, 99, 235];
const PALE_BLUE: RGB = [239, 246, 255];
const WHITE: RGB = [255, 255, 255];
const INK: RGB = [15, 23, 42];
const SUBTLE: RGB = [100, 116, 139];
const BORDER: RGB = [226, 232, 240];
const CARD_BG: RGB = [248, 250, 252];
const GREEN: RGB = [22, 163, 74];
const GREEN_BG: RGB = [220, 252, 231];
const AMBER: RGB = [217, 119, 6];
const RED: RGB = [220, 38, 38];
const RED_BG: RGB = [254, 226, 226];

function statusColor(rate: number): RGB { return rate >= 80 ? GREEN : rate >= 70 ? AMBER : RED; }
function statusLabel(rate: number): 'Green' | 'Amber' | 'Red' { return rate >= 80 ? 'Green' : rate >= 70 ? 'Amber' : 'Red'; }
function kpiColor(kind: 'pct-good' | 'pct-bad' | 'hours', value: number): RGB {
  if (kind === 'hours') return value >= 8.5 ? GREEN : value >= 7 ? AMBER : RED;
  if (kind === 'pct-good') return value >= 80 ? GREEN : value >= 70 ? AMBER : RED;
  return value < 10 ? GREEN : value < 25 ? AMBER : RED;
}

// ────────────────────────────────────────────────────────────────────────────
// Normalized employee record — read straight from the real EmployeeSummary
// field names (previous version guessed at field names that don't exist).
// ────────────────────────────────────────────────────────────────────────────
interface NormalizedEmployee {
  code: string;
  name: string;
  department: string;
  presentDays: number;
  absentDays: number;
  lateCount: number;
  earlyCount: number;
  attendanceRate: number;
  avgHours: number;
}

function normalizeEmployee(s: EmployeeSummary): NormalizedEmployee {
  const presentDays = s.presentDays ?? 0;
  const absentDays = s.absentDays ?? 0;
  const scheduled = presentDays + absentDays;
  return {
    code: s.employeeCode ?? '',
    name: s.employeeName || s.employeeCode || 'Unknown',
    department: s.department || 'Unknown',
    presentDays,
    absentDays,
    lateCount: s.lateCount ?? 0,
    earlyCount: s.earlyExitCount ?? 0,
    attendanceRate: scheduled > 0 ? (presentDays / scheduled) * 100 : 0,
    avgHours: hhmmToHours(s.avgHoursWorked),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Drawing helpers
// ────────────────────────────────────────────────────────────────────────────
function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function drawPageBackground(doc: any, w: number, h: number) {
  doc.setFillColor(...WHITE);
  doc.rect(0, 0, w, h, 'F');
}

function drawHeaderBand(doc: any, w: number, title: string, subtitle: string, compact = false): number {
  const bandH = compact ? 20 : 26;
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, w, bandH, 'F');
  doc.setFillColor(...BLUE);
  doc.rect(0, bandH, w, 1.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(compact ? 12 : 15);
  doc.setTextColor(...WHITE);
  doc.text(title, 14, compact ? 12 : 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(191, 219, 254);
  doc.text(subtitle, 14, compact ? 17 : 21);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...WHITE);
  doc.text(COMPANY_NAME, w - 14, compact ? 12 : 14, { align: 'right' });
  return bandH + 8;
}

function drawSectionHeader(doc: any, title: string, x: number, y: number, sub?: string): number {
  doc.setFillColor(...BLUE);
  doc.rect(x, y - 3.6, 2.4, 5.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(title, x + 5, y);
  if (sub) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.6);
    doc.setTextColor(...SUBTLE);
    doc.text(sub, x + 5, y + 4.6);
  }
  return y;
}

function drawKPICard(doc: any, x: number, y: number, w: number, h: number, label: string, value: string, color: RGB, note?: string) {
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 2.2, 2.2, 'FD');
  doc.setFillColor(...color);
  doc.roundedRect(x, y, 2.6, h, 1.2, 1.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15.5);
  doc.setTextColor(...color);
  doc.text(value, x + 8, y + h * 0.46);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.6);
  doc.setTextColor(...SUBTLE);
  doc.text(label, x + 8, y + h - (note ? 12 : 6));
  if (note) {
    doc.setFontSize(6.6);
    doc.setTextColor(148, 163, 184);
    doc.text(note, x + 8, y + h - 5.5);
  }
}

function drawProgressBar(doc: any, x: number, y: number, w: number, h: number, percent: number, color: RGB) {
  const pct = Math.max(0, Math.min(100, percent));
  doc.setFillColor(...BORDER);
  doc.roundedRect(x, y, w, h, h / 2, h / 2, 'F');
  const fillW = Math.max(h, (pct / 100) * w);
  doc.setFillColor(...color);
  doc.roundedRect(x, y, fillW, h, h / 2, h / 2, 'F');
}

function drawFootersOnAllPages(doc: any, w: number, h: number, label: string, genDate: string) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.2);
    doc.line(14, h - 11, w - 14, h - 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...SUBTLE);
    doc.text(`${COMPANY_NAME} — Confidential`, 14, h - 6);
    doc.text(`Period: ${label}`, w / 2, h - 6, { align: 'center' });
    doc.text(`Page ${i} of ${total}  ·  Generated ${genDate}`, w - 14, h - 6, { align: 'right' });
  }
}

function drawBarChart(doc: any, x: number, y: number, w: number, h: number, data: { label: string; value: number }[], maxValue: number, color: RGB, valueFmt: (v: number) => string) {
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.line(x, y + h, x + w, y + h);
  doc.line(x, y, x, y + h);
  const n = Math.max(1, data.length);
  const gap = 4;
  const barW = Math.max(4, (w - gap * (n - 1)) / n);
  data.forEach((d, i) => {
    const bx = x + i * (barW + gap);
    const barH = maxValue > 0 ? (d.value / maxValue) * (h - 6) : 0;
    const by = y + h - barH;
    doc.setFillColor(...color);
    doc.roundedRect(bx, by, barW, Math.max(0.6, barH), 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.6);
    doc.setTextColor(...INK);
    doc.text(valueFmt(d.value), bx + barW / 2, by - 1.6, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(...SUBTLE);
    doc.text(truncate(d.label, 12), bx + barW / 2, y + h + 5, { align: 'center', maxWidth: barW + gap });
  });
}

function drawPieSlice(doc: any, cx: number, cy: number, r: number, startDeg: number, endDeg: number, color: RGB) {
  doc.setFillColor(...color);
  const steps = Math.max(1, Math.ceil((endDeg - startDeg) / 3));
  for (let i = 0; i < steps; i++) {
    const a1 = (startDeg + ((endDeg - startDeg) * i) / steps) * (Math.PI / 180);
    const a2 = (startDeg + ((endDeg - startDeg) * (i + 1)) / steps) * (Math.PI / 180);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    doc.triangle(cx, cy, x1, y1, x2, y2, 'F');
  }
}

// A compact "scorecard" for one team — replaces the old dense 7-column table
// with something a manager can read in two seconds: name, size, the one
// number that matters, and a plain-language note explaining it.
function drawTeamCard(doc: any, x: number, y: number, w: number, h: number, name: string, headcount: number, rate: number, note: string) {
  const color = statusColor(rate);
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 2.2, 2.2, 'FD');
  doc.setFillColor(...color);
  doc.roundedRect(x, y, w, 2.4, 1.2, 1.2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(truncate(name, 24), x + 6, y + 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...SUBTLE);
  doc.text(`${headcount} employee${headcount === 1 ? '' : 's'}`, x + 6, y + 16.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...color);
  doc.text(`${rate.toFixed(0)}%`, x + w - 8, y + 13.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.4);
  doc.setTextColor(...SUBTLE);
  doc.text('attendance', x + w - 8, y + 17.5, { align: 'right' });

  drawProgressBar(doc, x + 6, y + h - 13, w - 12, 2.2, rate, color);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...INK);
  const wrapped = doc.splitTextToSize(note, w - 12);
  doc.text(wrapped.slice(0, 2), x + 6, y + h - 6);
}

// ────────────────────────────────────────────────────────────────────────────
// Main export
// ────────────────────────────────────────────────────────────────────────────
export async function exportPDF(
  records: AttendanceRecord[],
  summaries: EmployeeSummary[],
  label: string,
  thresholds?: Thresholds,
  holidays: Holiday[] = []
): Promise<void> {
  if (typeof window === 'undefined') return;

  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  const genDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const offices = [...new Set(records.map(r => r.officeCode))].filter(Boolean).join(', ') || '—';
  const grace = thresholds?.graceMinutes ?? 10;

  const employees: NormalizedEmployee[] = summaries.map(normalizeEmployee);
  const totalEmployees = employees.length > 0 ? employees.length : new Set(records.map(r => r.employeeCode)).size;
  const employeesByAttendance = [...employees].sort((a, b) => a.attendanceRate - b.attendanceRate);
  const bottomEmployees = employeesByAttendance.slice(0, Math.min(8, employeesByAttendance.length));
  const topEmployees = [...employeesByAttendance].slice(Math.max(0, employeesByAttendance.length - 8)).reverse();

  // ── Company-wide KPIs — computed the SAME way the live dashboard does ───
  const workRecs = records.filter(r => {
    if (isWeeklyOff(r.status)) return false;
    if (isHoliday(r.date, holidays) && !isPresent(r.status)) return false;
    return true;
  });
  const presentRecs = workRecs.filter(r => isPresent(r.status) && !r.isShortDay);
  const absentRecs = workRecs.filter(r => isAbsent(r.status));
  const missedPunchRecs = workRecs.filter(r => isMissedPunchOut(r.status));

  const scopedDepartments = Array.from(new Set(workRecs.map(r => r.department || 'Unknown')));
  const isTeamScope = scopedDepartments.length === 1;
  const scopeName = isTeamScope ? scopedDepartments[0] : 'Company-wide';
  const scopeLabel = isTeamScope ? 'Team' : 'Company-wide';

  const scheduled = workRecs.length;
  const presentCount = presentRecs.length;
  const absentCount = absentRecs.length;
  const attendanceRate = scheduled > 0 ? (presentCount / scheduled) * 100 : 0;
  const absenteeismRate = scheduled > 0 ? (absentCount / scheduled) * 100 : 0;

  const lateCount = presentRecs.filter(r => getLateMinutes(r, grace) > 0).length;
  const earlyCount = presentRecs.filter(r => getEarlyMinutes(r, grace) > 0).length;
  const lateRate = presentCount > 0 ? (lateCount / presentCount) * 100 : 0;
  const earlyRate = presentCount > 0 ? (earlyCount / presentCount) * 100 : 0;

  const totalLostMins = presentRecs.reduce((s, r) => s + computeProductivityLostMinutes(r), 0);
  const totalShiftMins = presentRecs.length * SHIFT_MINUTES;
  const productivityLost = totalShiftMins > 0 ? (totalLostMins / totalShiftMins) * 100 : 0;

  const presentWithDur = presentRecs.filter(r => durationToMinutes(r.duration) > 60);
  const totalEffMins = presentWithDur.reduce((s, r) => s + (durationToMinutes(r.duration) - 60), 0);
  const avgHours = presentWithDur.length > 0 ? totalEffMins / presentWithDur.length / 60 : 0;

  // ── Department roll-up ───────────────────────────────────────────────
  const deptMap = new Map<string, { present: number; total: number; emps: Set<string> }>();
  for (const r of workRecs) {
    const d = r.department || 'Unknown';
    if (!deptMap.has(d)) deptMap.set(d, { present: 0, total: 0, emps: new Set() });
    const dept = deptMap.get(d)!;
    dept.total++;
    dept.emps.add(r.employeeCode);
    if (isPresent(r.status) && !r.isShortDay) dept.present++;
  }
  const deptRows = Array.from(deptMap.entries())
    .map(([name, v]) => ({ name, headcount: v.emps.size, rate: v.total > 0 ? (v.present / v.total) * 100 : 0 }))
    .sort((a, b) => a.rate - b.rate);
  const isSingleTeam = deptRows.length <= 1;

  const bestDept = [...deptRows].sort((a, b) => b.rate - a.rate)[0];
  const worstDept = deptRows[0];
  const mostLate = [...employees].sort((a, b) => b.lateCount - a.lateCount)[0];
  const mostAbsent = [...employees].sort((a, b) => b.absentDays - a.absentDays)[0];

  // ══════════════════════════════════════════════════════════════════════
  // PAGE 1 — Executive Summary
  // ══════════════════════════════════════════════════════════════════════
  drawPageBackground(doc, W, H);
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 40, 'F');
  doc.setFillColor(...BLUE);
  doc.rect(0, 40, W, 1.4, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...WHITE);
  doc.text(COMPANY_NAME, 14, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(191, 219, 254);
  doc.text(isSingleTeam && deptRows[0] ? `${deptRows[0].name} — Team Attendance Report` : 'Attendance Insights Report', 14, 25);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(191, 219, 254);
  doc.text(`Reporting Period: ${label}   ·   Scope: ${scopeName}   ·   Office(s): ${offices}`, 14, 33);
  doc.text(`Generated: ${genDate}`, 14, 38);

  let y = 50;
  y = drawSectionHeader(doc, 'The Headline Numbers', 14, y);
  y += 6;

  const kpis: { label: string; value: string; color: RGB; note?: string }[] = [
    { label: 'People', value: `${totalEmployees}`, color: BLUE },
    { label: 'Attendance', value: `${attendanceRate.toFixed(1)}%`, color: kpiColor('pct-good', attendanceRate), note: 'target 80%+' },
    { label: 'Absenteeism', value: `${absenteeismRate.toFixed(1)}%`, color: kpiColor('pct-bad', absenteeismRate) },
    { label: 'Avg Hours / Day', value: `${avgHours.toFixed(1)}h`, color: kpiColor('hours', avgHours), note: 'target 8h+' },
    { label: 'Time Lost to Late/Early', value: `${(totalLostMins / 60).toFixed(0)}h`, color: kpiColor('pct-bad', productivityLost), note: `${productivityLost.toFixed(0)}% of shift time` },
  ];
  const cardCols = 5;
  const cardGap = 5;
  const cardW = (W - 28 - cardGap * (cardCols - 1)) / cardCols;
  const cardH = 27;
  kpis.forEach((k, i) => {
    const x = 14 + i * (cardW + cardGap);
    drawKPICard(doc, x, y, cardW, cardH, k.label, k.value, k.color, k.note);
  });
  y += cardH + 8;

  // ── Key Insights — plain-language, comparative, actionable ────────────
  y = drawSectionHeader(doc, 'What This Means', 14, y);
  y += 4;

  doc.setFillColor(...PALE_BLUE);
  doc.setDrawColor(...BORDER);
  const insightsBoxH = 48;
  doc.roundedRect(14, y, W - 28, insightsBoxH, 2.5, 2.5, 'FD');

  const insights: string[] = [];
  insights.push(
    attendanceRate >= 80
      ? `Attendance was healthy at ${attendanceRate.toFixed(1)}%, at or above the 80% benchmark.`
      : `Attendance came in at ${attendanceRate.toFixed(1)}%, below the 80% benchmark — worth a closer look.`
  );
  if (isTeamScope) {
    const top = topEmployees[0];
    const bottom = bottomEmployees[0];
    if (top) insights.push(`Top performing employee: ${top.name} with ${top.attendanceRate.toFixed(0)}% attendance.`);
    if (bottom && bottom.name !== top?.name) insights.push(`Most concerning attendance: ${bottom.name} at ${bottom.attendanceRate.toFixed(0)}% attendance.`);
  } else if (worstDept && bestDept && worstDept.name !== bestDept.name) {
    insights.push(`${bestDept.name} led the way at ${bestDept.rate.toFixed(0)}% attendance, while ${worstDept.name} trailed at ${worstDept.rate.toFixed(0)}%.`);
  }
  if (mostAbsent && mostAbsent.absentDays > 0) {
    insights.push(`${mostAbsent.name} had the most absences this period (${mostAbsent.absentDays} day${mostAbsent.absentDays === 1 ? '' : 's'}) — worth a check-in.`);
  }
  if (mostLate && mostLate.lateCount > 0) {
    insights.push(`${mostLate.name} had the most late arrivals (${mostLate.lateCount} day${mostLate.lateCount === 1 ? '' : 's'}).`);
  }
  insights.push(
    totalLostMins > 0
      ? `Late arrivals and early exits cost roughly ${(totalLostMins / 60).toFixed(0)} working hours this period (${productivityLost.toFixed(0)}% of scheduled shift time).`
      : `No meaningful time was lost to late arrivals or early exits this period.`
  );
  if (missedPunchRecs.length > 0) {
    insights.push(`${missedPunchRecs.length} day-record${missedPunchRecs.length === 1 ? '' : 's'} were flagged as a missed punch (a swipe in or out wasn't captured). Worth a quick manual check before treating these as absences.`);
  }

  let iy = y + 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.6);
  doc.setTextColor(...INK);
  insights.slice(0, 6).forEach(line => {
    doc.setFillColor(...BLUE);
    doc.circle(19, iy - 1.3, 0.9, 'F');
    const wrapped = doc.splitTextToSize(line, W - 28 - 14);
    doc.text(wrapped, 23, iy);
    iy += wrapped.length * 4.6 + 3;
  });
  y += insightsBoxH + 10;

  // ── Present vs Absent, at a glance ─────────────────────────────────────
  y = drawSectionHeader(doc, 'Attendance at a Glance', 14, y);
  y += 4;
  const glanceH = H - y - 16;
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...BORDER);
  doc.roundedRect(14, y, W - 28, glanceH, 2, 2, 'FD');

  const cx = 14 + 40;
  const cy = y + glanceH / 2;
  const r = Math.min(20, glanceH / 2 - 8);
  const totalForPie = presentCount + absentCount;
  const presentDeg = totalForPie > 0 ? (presentCount / totalForPie) * 360 : 0;
  if (totalForPie > 0) {
    drawPieSlice(doc, cx, cy, r, -90, -90 + presentDeg, GREEN);
    drawPieSlice(doc, cx, cy, r, -90 + presentDeg, 270, RED);
  } else {
    doc.setDrawColor(...BORDER);
    doc.circle(cx, cy, r, 'S');
  }
  doc.setFillColor(...WHITE);
  doc.circle(cx, cy, r * 0.55, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(`${attendanceRate.toFixed(0)}%`, cx, cy + 1.3, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.6);
  doc.setTextColor(...SUBTLE);
  doc.text('Present', cx, cy + 5, { align: 'center' });

  const legendX = 14 + 40 + r + 14;
  [{ label: 'Present days', value: presentCount, color: GREEN }, { label: 'Absent days', value: absentCount, color: RED }]
    .forEach((item, i) => {
      const ly = cy - 5 + i * 11;
      doc.setFillColor(...item.color);
      doc.roundedRect(legendX, ly - 3.6, 4.4, 4.4, 1, 1, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.4);
      doc.setTextColor(...INK);
      doc.text(`${item.value}`, legendX + 7.5, ly);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(...SUBTLE);
      doc.text(item.label, legendX + 7.5, ly + 4.4);
    });

  const summaryX = legendX + 60;
  if (summaryX < W - 45) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.6);
    doc.setTextColor(...SUBTLE);
    const note = doc.splitTextToSize(
      `Out of ${scheduled} scheduled employee-days, ${presentCount} were present and ${absentCount} absent — ${attendanceRate.toFixed(1)}% overall attendance.`,
      W - 28 - (summaryX - 14) - 10
    );
    doc.text(note, summaryX, cy - 4);
  }

  // ══════════════════════════════════════════════════════════════════════
  // PAGE 2 — Team Performance / Team Drilldown
  // ══════════════════════════════════════════════════════════════════════
  if (deptRows.length > 0) {
    doc.addPage();
    drawPageBackground(doc, W, H);
    const title = isSingleTeam ? 'Team Drilldown' : 'Team Performance';
    const subtitle = isSingleTeam ? `${scopeName} · ${label}` : `${label}  ·  ${offices}`;
    let cy2 = drawHeaderBand(doc, W, title, subtitle);

    if (isSingleTeam) {
      cy2 = drawSectionHeader(doc, 'Employee Attendance', 14, cy2 + 2, 'Ranked by attendance rate — focus on lowest performers first');
      cy2 += 8;
      drawBarChart(doc, 22, cy2, W - 44, 50, bottomEmployees.map(e => ({ label: truncate(e.name, 18), value: e.attendanceRate })), 100, RED, v => `${v.toFixed(0)}%`);

      cy2 += 58;
      cy2 = drawSectionHeader(doc, 'Actionable Team Insights', 14, cy2, 'Employee-level areas to recognize and address');
      autoTable(doc, {
        startY: cy2 + 6,
        margin: { left: 14, right: 14 },
        head: [['Employee', 'Attendance', 'Avg Hours', 'Late', 'Absent']],
        body: bottomEmployees.map((e) => [
          truncate(e.name, 20),
          `${e.attendanceRate.toFixed(0)}%`,
          `${e.avgHours.toFixed(1)}h`,
          `${e.lateCount}`,
          `${e.absentDays}`,
        ]),
        styles: { font: 'helvetica', fontSize: 7.4, cellPadding: 3.4, textColor: INK as unknown as RGB, lineColor: BORDER as unknown as RGB, lineWidth: 0.15, fillColor: WHITE as unknown as RGB },
        headStyles: { fillColor: RED as unknown as RGB, textColor: WHITE as unknown as RGB, fontStyle: 'bold', fontSize: 8 },
      });
      // Full employee summary table for the selected team (one row per employee)
      const teamDept = scopeName;
      const teamSummaries = summaries.filter(s => (s.department || 'Unknown') === teamDept);
      if (teamSummaries.length > 0) {
        const startYTeam = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 8 : cy2 + 20;
        drawSectionHeader(doc, 'Employee Summary', 14, startYTeam, `One row per employee — averages over the selected period`);
        autoTable(doc, {
          startY: startYTeam + 6,
          margin: { left: 14, right: 14 },
          head: [['Employee', 'Avg hrs', 'Avg Late (min)', 'Missed', 'Avg Early Exit (min)', 'Latest In-Time', 'Earliest Out-Time', 'Attendance %', 'Present', 'Absent']],
          body: teamSummaries.map(s => {
            const n = normalizeEmployee(s);
            const recs = (s.records || []);
            const missed = recs.filter(r => isMissedPunchOut(r.status)).length;
            const avgLate = s.avgLateMinutes ?? 0;
            const avgEarly = s.avgEarlyExitMinutes ?? 0;
            const latestIn = s.latestInTime ? `${Math.floor((s.latestInTime/60))}:${(s.latestInTime%60).toString().padStart(2,'0')}` : '—';
            const earliestOut = s.earliestOutTime ? `${Math.floor((s.earliestOutTime/60))}:${(s.earliestOutTime%60).toString().padStart(2,'0')}` : '—';
            return [
              truncate(n.name, 24),
              `${n.avgHours.toFixed(1)}`,
              `${avgLate}`,
              `${missed}`,
              `${avgEarly}`,
              latestIn,
              earliestOut,
              `${n.attendanceRate.toFixed(0)}%`,
              `${n.presentDays}`,
              `${n.absentDays}`,
            ];
          }),
          styles: { font: 'helvetica', fontSize: 7.4, cellPadding: 3.2, textColor: INK as unknown as RGB, lineColor: BORDER as unknown as RGB, lineWidth: 0.12, fillColor: WHITE as unknown as RGB },
          headStyles: { fillColor: BLUE as unknown as RGB, textColor: WHITE as unknown as RGB, fontStyle: 'bold', fontSize: 8 },
        });
      }
    } else {
      cy2 = drawSectionHeader(doc, 'How Each Team Is Doing', 14, cy2 + 2, 'Ranked by attendance rate — teams in red need the most support');
      cy2 += 8;

      const cols = 4;
      const gap = 6;
      const cardW2 = (W - 28 - gap * (cols - 1)) / cols;
      const cardH2 = 30;
      const ranked = [...deptRows].sort((a, b) => a.rate - b.rate);
      const avgRate = deptRows.reduce((s, d) => s + d.rate, 0) / deptRows.length;

      ranked.forEach((d, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = 14 + col * (cardW2 + gap);
        const cardY = cy2 + row * (cardH2 + gap);
        const diff = d.rate - avgRate;
        const note = i === 0
          ? 'Lowest attendance — prioritize follow-up'
          : i === ranked.length - 1
            ? 'Highest attendance across all teams'
            : `${Math.abs(diff).toFixed(0)} pts ${diff >= 0 ? 'above' : 'below'} the company average`;
        drawTeamCard(doc, x, cardY, cardW2, cardH2, d.name, d.headcount, d.rate, note);
      });

      const chartY = cy2 + Math.ceil(ranked.length / cols) * (cardH2 + gap) + 10;
      if (chartY + 60 < H - 16) {
        drawSectionHeader(doc, 'Side-by-Side Comparison', 14, chartY - 4);
        doc.setFillColor(...CARD_BG);
        doc.setDrawColor(...BORDER);
        const chartBoxH = H - chartY - 16;
        doc.roundedRect(14, chartY, W - 28, chartBoxH, 2, 2, 'FD');
        drawBarChart(doc, 22, chartY + 8, W - 44, chartBoxH - 20, deptRows.slice(0, 10).map(d => ({ label: d.name, value: d.rate })), 100, BLUE, v => `${v.toFixed(0)}%`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // PAGE — People: Recognition & Needs Attention
  // (replaces the old separate "Top Performers" table + full raw register
  // — those were numbers without a story; this keeps only the two lists a
  // manager can actually act on.)
  // ══════════════════════════════════════════════════════════════════════
  doc.addPage();
  drawPageBackground(doc, W, H);
  let cy3 = drawHeaderBand(doc, W, 'People', `Recognition and follow-ups  ·  ${label}`);

  function reasonFor(e: NormalizedEmployee): string {
    const reasons: string[] = [];
    if (e.attendanceRate < 80) reasons.push(`Low attendance (${e.attendanceRate.toFixed(0)}%)`);
    if (e.absentDays >= 3) reasons.push(`${e.absentDays} absences`);
    if (e.lateCount >= 5) reasons.push(`${e.lateCount} late arrivals`);
    return reasons.join(', ') || '—';
  }
  function highlightFor(e: NormalizedEmployee): string {
    const bits: string[] = [`${e.attendanceRate.toFixed(0)}% attendance`];
    if (e.lateCount === 0) bits.push('no late arrivals');
    if (e.avgHours > 0) bits.push(`${e.avgHours.toFixed(1)}h avg/day`);
    return bits.join(', ');
  }

  const atRisk = employees.filter(e => e.attendanceRate < 80 || e.absentDays >= 3 || e.lateCount >= 5)
    .sort((a, b) => a.attendanceRate - b.attendanceRate);
  const recognize = [...employees]
    .filter(e => e.presentDays > 0)
    .sort((a, b) => b.attendanceRate - a.attendanceRate || a.lateCount - b.lateCount)
    .slice(0, 8);

  cy3 = drawSectionHeader(doc, `Worth Recognizing (${recognize.length})`, 14, cy3 + 2);
  autoTable(doc, {
    startY: cy3 + 3,
    margin: { left: 14, right: 14 },
    head: [isSingleTeam ? ['Employee', 'Highlight'] : ['Employee', 'Team', 'Highlight']],
    body: recognize.map(e => isSingleTeam ? [e.name, highlightFor(e)] : [e.name, e.department, highlightFor(e)]),
    styles: { font: 'helvetica', fontSize: 8.4, cellPadding: 3.6, textColor: INK as unknown as RGB, lineColor: BORDER as unknown as RGB, lineWidth: 0.15, fillColor: WHITE as unknown as RGB },
    headStyles: { fillColor: GREEN as unknown as RGB, textColor: WHITE as unknown as RGB, fontStyle: 'bold', fontSize: 8.6 },
    alternateRowStyles: { fillColor: GREEN_BG as unknown as RGB },
  });
  if (recognize.length === 0) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...SUBTLE);
    doc.text('No attendance data available for this period.', 14, cy3 + 12);
  }

  let cy4 = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 12 : cy3 + 40;
  cy4 = drawSectionHeader(doc, `Needs a Check-in (${atRisk.length})`, 14, cy4, 'Attendance under 80%, 3+ absences, or 5+ late arrivals');
  autoTable(doc, {
    startY: cy4 + 5,
    margin: { left: 14, right: 14 },
    head: [isSingleTeam ? ['Employee', 'What\'s Happening'] : ['Employee', 'Team', 'What\'s Happening']],
    body: atRisk.map(e => isSingleTeam ? [e.name, reasonFor(e)] : [e.name, e.department, reasonFor(e)]),
    styles: { font: 'helvetica', fontSize: 8.4, cellPadding: 3.6, textColor: INK as unknown as RGB, lineColor: BORDER as unknown as RGB, lineWidth: 0.15, fillColor: WHITE as unknown as RGB },
    headStyles: { fillColor: RED as unknown as RGB, textColor: WHITE as unknown as RGB, fontStyle: 'bold', fontSize: 8.6 },
    alternateRowStyles: { fillColor: RED_BG as unknown as RGB },
    didDrawPage: () => {
      drawPageBackground(doc, W, H);
      drawHeaderBand(doc, W, 'People (continued)', `Recognition and follow-ups  ·  ${label}`, true);
    },
  });
  if (atRisk.length === 0) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9.5); doc.setTextColor(...GREEN);
    doc.text('Nobody currently meets the at-risk criteria — nice work.', 14, cy4 + 12);
  }


  // ── Footers ──────────────────────────────────────────────────────────
  drawFootersOnAllPages(doc, W, H, label, genDate);

  doc.save(`Attendance_Report_${label}.pdf`);
}
