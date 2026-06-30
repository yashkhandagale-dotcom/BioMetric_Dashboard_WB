import { AttendanceRecord, EmployeeSummary } from './types';
import { durationToMinutes } from './parseCSV';

const SHIFT_MINUTES = 540;
const SHIFT_START_MINUTES = 9 * 60 + 30;
const SHIFT_END_MINUTES = 18 * 60 + 30;

function timeToMins(t: string): number {
  if (!t || t === '--' || t === '') return -1;
  const p = t.split(':');
  if (p.length < 2) return -1;
  const h = parseInt(p[0], 10), m = parseInt(p[1], 10);
  return isNaN(h) || isNaN(m) ? -1 : h * 60 + m;
}
function computeLate(inTime: string): number {
  const m = timeToMins(inTime);
  return m < 0 ? 0 : Math.max(0, m - SHIFT_START_MINUTES);
}
function computeEarly(outTime: string): number {
  const m = timeToMins(outTime);
  return m <= 0 ? 0 : Math.max(0, SHIFT_END_MINUTES - m);
}
function isPresent(s: string) { return s.toLowerCase().includes('present') && !s.toLowerCase().includes('absent'); }
function isAbsent(s: string) { return s.toLowerCase().includes('absent'); }
function isWeeklyOff(s: string) { return s.toLowerCase().includes('weeklyoff'); }

type RGB = [number, number, number];
const NAVY: RGB = [15, 31, 61];
const WHITE: RGB = [255, 255, 255];
const GREEN: RGB = [5, 150, 105];
const AMBER: RGB = [217, 119, 6];
const RED: RGB = [220, 38, 38];
const SLATE: RGB = [100, 116, 139];
const BG: RGB = [15, 23, 42];
const CARD: RGB = [30, 41, 59];

function kpiRGB(metric: string, value: number): RGB {
  if (metric === 'Attendance %' || metric === 'Avg Hours/Day') {
    const g = metric === 'Avg Hours/Day' ? 8.5 : 80;
    const a = metric === 'Avg Hours/Day' ? 7 : 70;
    return value >= g ? GREEN : value >= a ? AMBER : RED;
  }
  return value < 10 ? GREEN : value < 25 ? AMBER : RED;
}

function statusRGB(rate: number): RGB {
  return rate >= 80 ? GREEN : rate >= 70 ? AMBER : RED;
}

export async function exportPDF(
  records: AttendanceRecord[],
  summaries: EmployeeSummary[],
  label: string
): Promise<void> {
  if (typeof window === 'undefined') return;

  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();   // 297
  const H = doc.internal.pageSize.getHeight();  // 210

  // ── Compute KPIs ─────────────────────────────────────────────────────────
  const workRecs = records.filter(r => !isWeeklyOff(r.status));
  const presentRecs = workRecs.filter(r => isPresent(r.status));
  const absentRecs = workRecs.filter(r => isAbsent(r.status));
  const scheduled = workRecs.length;
  const presentCount = presentRecs.length;
  const absentCount = absentRecs.length;
  const lateCount = presentRecs.filter(r => computeLate(r.inTime) > 0).length;
  const earlyCount = presentRecs.filter(r => computeEarly(r.outTime) > 0).length;
  const totalLost = presentRecs.reduce((s, r) => s + computeLate(r.inTime) + computeEarly(r.outTime), 0);
  const totalShift = presentCount * SHIFT_MINUTES;
  const presentWithDur = presentRecs.filter(r => durationToMinutes(r.duration) > 0);
  const totalMins = presentWithDur.reduce((s, r) => s + durationToMinutes(r.duration), 0);

  const attendanceRate = scheduled > 0 ? (presentCount / scheduled) * 100 : 0;
  const absenteeismRate = scheduled > 0 ? (absentCount / scheduled) * 100 : 0;
  const avgHours = presentWithDur.length > 0 ? totalMins / presentWithDur.length / 60 : 0;
  const lateRate = presentCount > 0 ? (lateCount / presentCount) * 100 : 0;
  const earlyRate = presentCount > 0 ? (earlyCount / presentCount) * 100 : 0;
  const productivityLost = totalShift > 0 ? (totalLost / totalShift) * 100 : 0;

  const offices = [...new Set(records.map(r => r.officeCode))].filter(Boolean).join(', ');
  const genDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  // ── Dept breakdown ────────────────────────────────────────────────────────
  const deptMap = new Map<string, { present: number; total: number; lateC: number; earlyC: number; totalMins: number; presCount: number; emps: Set<string> }>();
  for (const r of workRecs) {
    const d = r.department || 'Unknown';
    if (!deptMap.has(d)) deptMap.set(d, { present: 0, total: 0, lateC: 0, earlyC: 0, totalMins: 0, presCount: 0, emps: new Set() });
    const dept = deptMap.get(d)!;
    dept.total++;
    dept.emps.add(r.employeeCode);
    if (isPresent(r.status)) {
      dept.present++;
      if (computeLate(r.inTime) > 0) dept.lateC++;
      if (computeEarly(r.outTime) > 0) dept.earlyC++;
      const m = durationToMinutes(r.duration);
      if (m > 0) { dept.totalMins += m; dept.presCount++; }
    }
  }
  const deptRows = Array.from(deptMap.entries()).map(([name, v]) => {
    const rate = v.total > 0 ? (v.present / v.total) * 100 : 0;
    const avgH = v.presCount > 0 ? v.totalMins / v.presCount / 60 : 0;
    const lR = v.present > 0 ? (v.lateC / v.present) * 100 : 0;
    const eR = v.present > 0 ? (v.earlyC / v.present) * 100 : 0;
    return { name, headcount: v.emps.size, rate, avgH, lR, eR };
  }).sort((a, b) => b.rate - a.rate);

  // Top flags
  const worstDept = [...deptRows].sort((a, b) => a.rate - b.rate)[0];
  const mostLate = [...summaries].sort((a, b) => b.lateCount - a.lateCount)[0];
  const mostAbsent = [...summaries].sort((a, b) => b.absentDays - a.absentDays)[0];

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 1 — EXECUTIVE SUMMARY
  // ══════════════════════════════════════════════════════════════════════════
  doc.setFillColor(...BG);
  doc.rect(0, 0, W, H, 'F');

  // Header band
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 28, 'F');

  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Attendance Insights Report', 14, 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  doc.text(`Period: ${label}   ·   Office: ${offices}   ·   Generated: ${genDate}`, 14, 21);

  // ── KPI Cards 2×3 grid ───────────────────────────────────────────────────
  const kpis = [
    { label: 'Attendance %', value: `${attendanceRate.toFixed(1)}%`, metric: 'Attendance %', num: attendanceRate },
    { label: 'Absenteeism %', value: `${absenteeismRate.toFixed(1)}%`, metric: 'Absenteeism %', num: absenteeismRate },
    { label: 'Avg Hours / Day', value: `${avgHours.toFixed(2)}h`, metric: 'Avg Hours/Day', num: avgHours },
    { label: 'Late Arrival Rate', value: `${lateRate.toFixed(1)}%`, metric: 'Late Arrival Rate', num: lateRate },
    { label: 'Early Exit Rate', value: `${earlyRate.toFixed(1)}%`, metric: 'Early Exit Rate', num: earlyRate },
    { label: 'Productivity Lost', value: `${productivityLost.toFixed(1)}%`, metric: 'Productivity Lost %', num: productivityLost },
  ];

  const cardW = 84, cardH = 28, cardGapX = 5, cardGapY = 4;
  const startX = 14, startY = 33;

  kpis.forEach((k, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = startX + col * (cardW + cardGapX);
    const y = startY + row * (cardH + cardGapY);
    const color = kpiRGB(k.metric, k.num);

    doc.setFillColor(...CARD);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'F');
    // colored left accent bar
    doc.setFillColor(...color);
    doc.roundedRect(x, y, 3, cardH, 1, 1, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...color);
    doc.text(k.value, x + 9, y + 16);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(k.label, x + 9, y + 23);
  });

  // ── Dept attendance bars ──────────────────────────────────────────────────
  const barStartY = startY + 2 * (cardH + cardGapY) + 8;
  const barAreaX = 14;
  const barAreaW = W - 28;
  const labelW = 70;
  const maxBarW = barAreaW - labelW - 30;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...WHITE);
  doc.text('Department Attendance', barAreaX, barStartY - 3);

  deptRows.slice(0, 7).forEach((dept, i) => {
    const y = barStartY + i * 10;
    const filled = Math.round((dept.rate / 100) * 10); // out of 10 blocks
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
    const color = statusRGB(dept.rate);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    const dname = dept.name.length > 22 ? dept.name.slice(0, 21) + '…' : dept.name;
    doc.text(dname, barAreaX, y);

    doc.setTextColor(...color);
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.text(bar, barAreaX + labelW, y);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(`${dept.rate.toFixed(1)}%`, barAreaX + labelW + 52, y);
  });

  // ── Top 3 flags ──────────────────────────────────────────────────────────
  const flagY = barStartY;
  const flagX = W - 95;

  doc.setFillColor(...CARD);
  doc.roundedRect(flagX - 4, flagY - 8, 95, 55, 2, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...WHITE);
  doc.text('⚑  Attention Required', flagX, flagY - 1);

  const flags = [
    { icon: '📉', label: 'Worst Attendance', val: worstDept ? `${worstDept.name} (${worstDept.rate.toFixed(1)}%)` : '—' },
    { icon: '⏰', label: 'Most Late Arrivals', val: mostLate ? `${mostLate.employeeName} (${mostLate.lateCount}d)` : '—' },
    { icon: '🏃', label: 'Most Absences', val: mostAbsent ? `${mostAbsent.employeeName} (${mostAbsent.absentDays}d)` : '—' },
  ];

  flags.forEach((f, i) => {
    const y = flagY + 9 + i * 13;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(f.label, flagX, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...WHITE);
    const val = f.val.length > 28 ? f.val.slice(0, 27) + '…' : f.val;
    doc.text(`${f.icon} ${val}`, flagX, y + 6);
  });

  // Footer p1
  doc.setFontSize(7);
  doc.setTextColor(...SLATE);
  doc.text('Page 1 of 2', 14, H - 6);
  doc.text('WonderBiz Technologies — Confidential', W / 2, H - 6, { align: 'center' });
  doc.text(genDate, W - 14, H - 6, { align: 'right' });

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 2 — TEAM SNAPSHOT
  // ══════════════════════════════════════════════════════════════════════════
  doc.addPage();
  doc.setFillColor(...BG);
  doc.rect(0, 0, W, H, 'F');

  // Header
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 22, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...WHITE);
  doc.text('Team Snapshot', 14, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(`${label}  ·  ${genDate}`, 14, 19);

  autoTable(doc, {
    startY: 27,
    head: [['Department', 'Headcount', 'Attendance %', 'Avg Hours/Day', 'Late %', 'Early Exit %', 'Status']],
    body: deptRows.map(d => [
      d.name,
      d.headcount,
      `${d.rate.toFixed(1)}%`,
      `${d.avgH.toFixed(2)}h`,
      `${d.lR.toFixed(1)}%`,
      `${d.eR.toFixed(1)}%`,
      d.rate >= 80 ? 'Green' : d.rate >= 70 ? 'Amber' : 'Red',
    ]),
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 4,
      textColor: [226, 232, 240] as [number, number, number],
      fillColor: CARD,
      lineColor: [51, 65, 85] as [number, number, number],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: NAVY,
      textColor: WHITE,
      fontStyle: 'bold',
      fontSize: 9,
    },
    alternateRowStyles: { fillColor: [15, 23, 42] as [number, number, number] },
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 6) {
        const val = data.cell.raw as string;
        data.cell.styles.textColor = val === 'Green' ? GREEN : val === 'Amber' ? AMBER : RED;
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // Footer p2
  doc.setFontSize(7);
  doc.setTextColor(...SLATE);
  doc.text('Page 2 of 2', 14, H - 6);
  doc.text('WonderBiz Technologies — Confidential', W / 2, H - 6, { align: 'center' });
  doc.text(genDate, W - 14, H - 6, { align: 'right' });

  doc.save(`Attendance_Report_${label}.pdf`);
}
