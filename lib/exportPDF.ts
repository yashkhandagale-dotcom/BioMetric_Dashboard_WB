import { AttendanceRecord, EmployeeSummary } from './types';
import { durationToMinutes } from './parseCSV';

const SHIFT_MINUTES = 540;
const SHIFT_START_MINUTES = 9 * 60 + 30;
const SHIFT_END_MINUTES = 18 * 60 + 30;
const COMPANY_NAME = 'WonderBiz Technologies';

// ────────────────────────────────────────────────────────────────────────────
// Time / status utilities (preserved from original implementation)
// ────────────────────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────────────────────
// Theme — clean corporate white / blue
// ────────────────────────────────────────────────────────────────────────────
type RGB = [number, number, number];

const NAVY: RGB = [15, 41, 89];          // deep corporate blue (header bands)
const BLUE: RGB = [37, 99, 235];         // primary accent blue
const LIGHT_BLUE: RGB = [219, 234, 254]; // light blue tints (badge bg, chips)
const PALE_BLUE: RGB = [239, 246, 255];  // very light section backdrop
const WHITE: RGB = [255, 255, 255];
const INK: RGB = [15, 23, 42];           // near-black text
const SUBTLE: RGB = [100, 116, 139];     // secondary/gray text
const BORDER: RGB = [226, 232, 240];     // hairlines
const CARD_BG: RGB = [248, 250, 252];    // card background
const GREEN: RGB = [22, 163, 74];
const GREEN_BG: RGB = [220, 252, 231];
const AMBER: RGB = [217, 119, 6];
const AMBER_BG: RGB = [254, 243, 199];
const RED: RGB = [220, 38, 38];
const RED_BG: RGB = [254, 226, 226];

function statusColor(rate: number): RGB {
  return rate >= 80 ? GREEN : rate >= 70 ? AMBER : RED;
}
function statusBg(rate: number): RGB {
  return rate >= 80 ? GREEN_BG : rate >= 70 ? AMBER_BG : RED_BG;
}
function statusLabel(rate: number): 'Green' | 'Amber' | 'Red' {
  return rate >= 80 ? 'Green' : rate >= 70 ? 'Amber' : 'Red';
}
function kpiColor(kind: 'pct-good' | 'pct-bad' | 'hours', value: number): RGB {
  if (kind === 'hours') return value >= 8.5 ? GREEN : value >= 7 ? AMBER : RED;
  if (kind === 'pct-good') return value >= 80 ? GREEN : value >= 70 ? AMBER : RED;
  return value < 10 ? GREEN : value < 25 ? AMBER : RED; // pct-bad: lower is better
}

// ────────────────────────────────────────────────────────────────────────────
// Normalized employee record — defensively reads EmployeeSummary so this file
// stays robust to minor differences in the upstream summary shape.
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
  const raw = s as unknown as Record<string, any>;
  const presentDays = Number(raw.presentDays ?? raw.presentCount ?? raw.present ?? 0);
  const absentDays = Number(raw.absentDays ?? raw.absentCount ?? raw.absent ?? 0);
  const lateCount = Number(raw.lateCount ?? raw.lateDays ?? raw.late ?? 0);
  const earlyCount = Number(raw.earlyCount ?? raw.earlyExitCount ?? raw.earlyDays ?? 0);
  const scheduled = presentDays + absentDays;
  const attendanceRate = Number(
    raw.attendanceRate ?? raw.attendancePercent ?? raw.attendancePct ??
    (scheduled > 0 ? (presentDays / scheduled) * 100 : 0)
  );
  const avgHours = Number(raw.avgHours ?? raw.avgHoursPerDay ?? raw.averageHours ?? 0);
  return {
    code: String(raw.employeeCode ?? raw.code ?? raw.empCode ?? ''),
    name: String(raw.employeeName ?? raw.name ?? 'Unknown'),
    department: String(raw.department ?? raw.dept ?? 'Unknown'),
    presentDays,
    absentDays,
    lateCount,
    earlyCount,
    attendanceRate,
    avgHours,
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

function drawHeaderBand(
  doc: any, w: number, title: string, subtitle: string, compact = false
): number {
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

function drawSectionHeader(doc: any, title: string, x: number, y: number): number {
  doc.setFillColor(...BLUE);
  doc.rect(x, y - 3.6, 2.4, 5.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(title, x + 5, y);
  return y;
}

function drawKPICard(
  doc: any, x: number, y: number, w: number, h: number,
  label: string, value: string, color: RGB
) {
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 2.2, 2.2, 'FD');
  doc.setFillColor(...color);
  doc.roundedRect(x, y, 2.6, h, 1.2, 1.2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15.5);
  doc.setTextColor(...color);
  doc.text(value, x + 8, y + h * 0.52);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.6);
  doc.setTextColor(...SUBTLE);
  doc.text(label, x + 8, y + h - 6);
}

function drawProgressBar(
  doc: any, x: number, y: number, w: number, h: number, percent: number, color: RGB
) {
  const pct = Math.max(0, Math.min(100, percent));
  doc.setFillColor(...BORDER);
  doc.roundedRect(x, y, w, h, h / 2, h / 2, 'F');
  const fillW = Math.max(h, (pct / 100) * w);
  doc.setFillColor(...color);
  doc.roundedRect(x, y, fillW, h, h / 2, h / 2, 'F');
}

function drawStatusBadge(doc: any, x: number, y: number, label: 'Green' | 'Amber' | 'Red') {
  const color = label === 'Green' ? GREEN : label === 'Amber' ? AMBER : RED;
  const bg = label === 'Green' ? GREEN_BG : label === 'Amber' ? AMBER_BG : RED_BG;
  const text = label === 'Green' ? 'On Track' : label === 'Amber' ? 'Watch' : 'At Risk';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.6);
  const tw = doc.getTextWidth(text);
  const padX = 3.2;
  const pillW = tw + padX * 2;
  const pillH = 5.6;
  doc.setFillColor(...bg);
  doc.roundedRect(x, y - pillH + 1.6, pillW, pillH, 1.8, 1.8, 'F');
  doc.setTextColor(...color);
  doc.text(text, x + padX, y);
  return pillW;
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

function drawBarChart(
  doc: any, x: number, y: number, w: number, h: number,
  data: { label: string; value: number }[], maxValue: number,
  color: RGB, valueFmt: (v: number) => string
) {
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.line(x, y + h, x + w, y + h); // baseline
  doc.line(x, y, x, y + h); // axis

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
    const lbl = truncate(d.label, 12);
    doc.text(lbl, bx + barW / 2, y + h + 5, { align: 'center', maxWidth: barW + gap });
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

// ────────────────────────────────────────────────────────────────────────────
// Main export
// ────────────────────────────────────────────────────────────────────────────
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

  const genDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const offices = [...new Set(records.map(r => r.officeCode))].filter(Boolean).join(', ') || '—';

  // ── Company-wide KPIs ──────────────────────────────────────────────────
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

  const employees: NormalizedEmployee[] = summaries.map(normalizeEmployee);
  const totalEmployees = employees.length > 0
    ? employees.length
    : new Set(records.map(r => r.employeeCode)).size;

  // ── Department breakdown ────────────────────────────────────────────────
  const deptMap = new Map<string, {
    present: number; total: number; lateC: number; earlyC: number;
    totalMins: number; presCount: number; emps: Set<string>;
  }>();
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
    return { name, headcount: v.emps.size, rate, avgH, lR, eR, lateC: v.lateC, earlyC: v.earlyC, present: v.present, absent: v.total - v.present };
  }).sort((a, b) => b.rate - a.rate);

  const worstDept = [...deptRows].sort((a, b) => a.rate - b.rate)[0];
  const mostLate = [...employees].sort((a, b) => b.lateCount - a.lateCount)[0];
  const mostAbsent = [...employees].sort((a, b) => b.absentDays - a.absentDays)[0];

  // ══════════════════════════════════════════════════════════════════════
  // PAGE 1 — Cover & Executive Summary
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
  doc.text('Employee Attendance Insights Report', 14, 25);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(191, 219, 254);
  doc.text(`Reporting Period: ${label}   ·   Office(s): ${offices}   ·   Generated: ${genDate}`, 14, 33);

  let y = 50;
  y = drawSectionHeader(doc, 'Key Performance Indicators', 14, y);
  y += 6;

  const kpis: { label: string; value: string; color: RGB }[] = [
    { label: 'Total Employees', value: `${totalEmployees}`, color: BLUE },
    { label: 'Attendance %', value: `${attendanceRate.toFixed(1)}%`, color: kpiColor('pct-good', attendanceRate) },
    { label: 'Absenteeism %', value: `${absenteeismRate.toFixed(1)}%`, color: kpiColor('pct-bad', absenteeismRate) },
    { label: 'Avg Hours / Day', value: `${avgHours.toFixed(2)}h`, color: kpiColor('hours', avgHours) },
    { label: 'Late Arrival %', value: `${lateRate.toFixed(1)}%`, color: kpiColor('pct-bad', lateRate) },
    { label: 'Early Exit %', value: `${earlyRate.toFixed(1)}%`, color: kpiColor('pct-bad', earlyRate) },
    { label: 'Productivity Lost %', value: `${productivityLost.toFixed(1)}%`, color: kpiColor('pct-bad', productivityLost) },
  ];

  const cardCols = 4;
  const cardGap = 5;
  const cardW = (W - 28 - cardGap * (cardCols - 1)) / cardCols;
  const cardH = 26;
  kpis.forEach((k, i) => {
    const col = i % cardCols;
    const row = Math.floor(i / cardCols);
    const x = 14 + col * (cardW + cardGap);
    const cy = y + row * (cardH + cardGap);
    drawKPICard(doc, x, cy, cardW, cardH, k.label, k.value, k.color);
  });

  const kpiRows = Math.ceil(kpis.length / cardCols);
  y = y + kpiRows * (cardH + cardGap) + 6;

  // ── Key Insights ─────────────────────────────────────────────────────
  y = drawSectionHeader(doc, 'Key Insights', 14, y);
  y += 4;

  doc.setFillColor(...PALE_BLUE);
  doc.setDrawColor(...BORDER);
  const insightsBoxH = 46;
  doc.roundedRect(14, y, W - 28, insightsBoxH, 2.5, 2.5, 'FD');

  const insights: string[] = [];
  insights.push(
    attendanceRate >= 80
      ? `Overall attendance stood at ${attendanceRate.toFixed(1)}%, at or above the 80% benchmark for the period.`
      : `Overall attendance was ${attendanceRate.toFixed(1)}%, below the 80% benchmark and warrants management attention.`
  );
  if (worstDept) {
    insights.push(`${worstDept.name} recorded the lowest attendance rate at ${worstDept.rate.toFixed(1)}% and should be prioritized for follow-up.`);
  }
  if (mostLate && mostLate.lateCount > 0) {
    insights.push(`${mostLate.name} had the highest number of late arrivals (${mostLate.lateCount} day(s)) in this period.`);
  }
  if (mostAbsent && mostAbsent.absentDays > 0) {
    insights.push(`${mostAbsent.name} recorded the most absences (${mostAbsent.absentDays} day(s)) among all employees.`);
  }
  insights.push(
    productivityLost >= 10
      ? `Productivity loss from late arrivals and early exits reached ${productivityLost.toFixed(1)}% of scheduled shift time.`
      : `Productivity loss from late arrivals and early exits remained contained at ${productivityLost.toFixed(1)}% of scheduled shift time.`
  );

  let iy = y + 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.6);
  doc.setTextColor(...INK);
  insights.slice(0, 5).forEach(line => {
    doc.setFillColor(...BLUE);
    doc.circle(19, iy - 1.3, 0.9, 'F');
    const wrapped = doc.splitTextToSize(line, W - 28 - 14);
    doc.text(wrapped, 23, iy);
    iy += wrapped.length * 4.6 + 3.2;
  });

  // ══════════════════════════════════════════════════════════════════════
  // PAGE 2 — Department Performance
  // ══════════════════════════════════════════════════════════════════════
  doc.addPage();
  drawPageBackground(doc, W, H);
  let cursorY = drawHeaderBand(doc, W, 'Department Performance', `${label}  ·  ${offices}`);

  autoTable(doc, {
    startY: cursorY + 2,
    margin: { left: 14, right: 14 },
    head: [['Department', 'Headcount', 'Attendance %', 'Avg Hours', 'Late %', 'Early Exit %', 'Status']],
    body: deptRows.map(d => [
      d.name, String(d.headcount), `${d.rate.toFixed(1)}%`, `${d.avgH.toFixed(2)}h`,
      `${d.lR.toFixed(1)}%`, `${d.eR.toFixed(1)}%`, statusLabel(d.rate),
    ]),
    styles: {
      font: 'helvetica', fontSize: 8.6, cellPadding: 4.2,
      textColor: INK as unknown as [number, number, number],
      lineColor: BORDER as unknown as [number, number, number],
      lineWidth: 0.15, fillColor: WHITE as unknown as [number, number, number],
      minCellHeight: 10,
    },
    headStyles: { fillColor: NAVY as unknown as [number, number, number], textColor: WHITE as unknown as [number, number, number], fontStyle: 'bold', fontSize: 8.8 },
    alternateRowStyles: { fillColor: PALE_BLUE as unknown as [number, number, number] },
    columnStyles: { 2: { cellWidth: 46 }, 6: { cellWidth: 26 } },
    didDrawCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 2) {
        const rowData = deptRows[data.row.index];
        if (rowData) {
          const barX = data.cell.x + 2;
          const barY = data.cell.y + data.cell.height - 3.4;
          const barW = data.cell.width - 22;
          drawProgressBar(doc, barX, barY, barW, 2.2, rowData.rate, statusColor(rowData.rate));
        }
      }
      if (data.section === 'body' && data.column.index === 6) {
        const rowData = deptRows[data.row.index];
        if (rowData) {
          const lbl = statusLabel(rowData.rate);
          doc.setFillColor(0, 0, 0);
          data.cell.text = [];
          drawStatusBadge(doc, data.cell.x + 2, data.cell.y + data.cell.height / 2 + 2, lbl);
        }
      }
    },
  });

  // ══════════════════════════════════════════════════════════════════════
  // PAGE 3 — Employee Performance Summary (Top performers)
  // ══════════════════════════════════════════════════════════════════════
  doc.addPage();
  drawPageBackground(doc, W, H);
  cursorY = drawHeaderBand(doc, W, 'Employee Performance Summary', `Top performing employees  ·  ${label}`);

  const topPerformers = [...employees]
    .sort((a, b) => b.attendanceRate - a.attendanceRate || a.lateCount - b.lateCount)
    .slice(0, 15);

  autoTable(doc, {
    startY: cursorY + 2,
    margin: { left: 14, right: 14 },
    head: [['Employee Name', 'Department', 'Attendance %', 'Present Days', 'Absent Days', 'Late Count', 'Avg Hours', 'Status']],
    body: topPerformers.map(e => [
      e.name, e.department, `${e.attendanceRate.toFixed(1)}%`, String(e.presentDays),
      String(e.absentDays), String(e.lateCount), `${e.avgHours.toFixed(2)}h`, statusLabel(e.attendanceRate),
    ]),
    styles: {
      font: 'helvetica', fontSize: 8.6, cellPadding: 4.2,
      textColor: INK as unknown as [number, number, number],
      lineColor: BORDER as unknown as [number, number, number],
      lineWidth: 0.15, fillColor: WHITE as unknown as [number, number, number],
    },
    headStyles: { fillColor: NAVY as unknown as [number, number, number], textColor: WHITE as unknown as [number, number, number], fontStyle: 'bold', fontSize: 8.8 },
    alternateRowStyles: { fillColor: PALE_BLUE as unknown as [number, number, number] },
    didDrawCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 7) {
        const rowData = topPerformers[data.row.index];
        if (rowData) {
          data.cell.text = [];
          drawStatusBadge(doc, data.cell.x + 2, data.cell.y + data.cell.height / 2 + 2, statusLabel(rowData.attendanceRate));
        }
      }
    },
  });

  if (topPerformers.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...SUBTLE);
    doc.text('No employee summary data available for this period.', 14, cursorY + 12);
  }

  // ══════════════════════════════════════════════════════════════════════
  // PAGE 4 — Employees Requiring Attention
  // ══════════════════════════════════════════════════════════════════════
  doc.addPage();
  drawPageBackground(doc, W, H);
  cursorY = drawHeaderBand(doc, W, 'Employees Requiring Attention', `Attendance below 80%, absences ≥ 3, or late arrivals ≥ 5  ·  ${label}`);

  const atRisk = employees.filter(e => e.attendanceRate < 80 || e.absentDays >= 3 || e.lateCount >= 5);

  function reasonFor(e: NormalizedEmployee): string {
    const reasons: string[] = [];
    if (e.attendanceRate < 80) reasons.push('Low attendance');
    if (e.absentDays >= 3) reasons.push('Frequent absences');
    if (e.lateCount >= 5) reasons.push('Frequent late arrivals');
    return reasons.join(', ');
  }

  autoTable(doc, {
    startY: cursorY + 2,
    margin: { left: 14, right: 14 },
    head: [['Employee Name', 'Department', 'Attendance %', 'Absent Days', 'Late Count', 'Reason']],
    body: atRisk
      .sort((a, b) => a.attendanceRate - b.attendanceRate)
      .map(e => [e.name, e.department, `${e.attendanceRate.toFixed(1)}%`, String(e.absentDays), String(e.lateCount), reasonFor(e)]),
    styles: {
      font: 'helvetica', fontSize: 8.6, cellPadding: 4.2,
      textColor: INK as unknown as [number, number, number],
      lineColor: BORDER as unknown as [number, number, number],
      lineWidth: 0.15, fillColor: WHITE as unknown as [number, number, number],
    },
    headStyles: { fillColor: RED as unknown as [number, number, number], textColor: WHITE as unknown as [number, number, number], fontStyle: 'bold', fontSize: 8.8 },
    alternateRowStyles: { fillColor: RED_BG as unknown as [number, number, number] },
    columnStyles: { 2: { textColor: RED as unknown as [number, number, number], fontStyle: 'bold' } },
  });

  if (atRisk.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(...GREEN);
    doc.text('No employees currently meet the at-risk criteria for this period.', 14, cursorY + 12);
  }

  // ══════════════════════════════════════════════════════════════════════
  // PAGE 5 — Complete Employee Attendance Register (auto-paginated)
  // ══════════════════════════════════════════════════════════════════════
  doc.addPage();
  drawPageBackground(doc, W, H);
  drawHeaderBand(doc, W, 'Complete Employee Attendance Register', `All employees  ·  ${label}`);

  autoTable(doc, {
    startY: 34,
    margin: { left: 14, right: 14, top: 24, bottom: 16 },
    head: [['Emp. Code', 'Employee Name', 'Department', 'Present Days', 'Absent Days', 'Late Count', 'Early Exit Count', 'Attendance %', 'Avg Hours']],
    body: [...employees]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(e => [
        e.code, e.name, e.department, String(e.presentDays), String(e.absentDays),
        String(e.lateCount), String(e.earlyCount), `${e.attendanceRate.toFixed(1)}%`, `${e.avgHours.toFixed(2)}h`,
      ]),
    styles: {
      font: 'helvetica', fontSize: 8, cellPadding: 3.4,
      textColor: INK as unknown as [number, number, number],
      lineColor: BORDER as unknown as [number, number, number],
      lineWidth: 0.15, fillColor: WHITE as unknown as [number, number, number],
    },
    headStyles: { fillColor: NAVY as unknown as [number, number, number], textColor: WHITE as unknown as [number, number, number], fontStyle: 'bold', fontSize: 8.4 },
    alternateRowStyles: { fillColor: PALE_BLUE as unknown as [number, number, number] },
    showHead: 'everyPage',
    rowPageBreak: 'auto',
    didDrawPage: (data: any) => {
      if (data.pageNumber > 1 || data.pageCount > 1) {
        // Redraw a compact header band on every page this table spans.
        drawPageBackground(doc, W, H);
        drawHeaderBand(doc, W, 'Complete Employee Attendance Register (continued)', `All employees  ·  ${label}`, true);
      }
    },
  });

  if (employees.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...SUBTLE);
    doc.text('No employee summary data available for this period.', 14, 40);
  }

  // ══════════════════════════════════════════════════════════════════════
  // PAGE 6 — Visual Analytics
  // ══════════════════════════════════════════════════════════════════════
  doc.addPage();
  drawPageBackground(doc, W, H);
  cursorY = drawHeaderBand(doc, W, 'Visual Analytics', `Attendance trends at a glance  ·  ${label}`);

  const chartRowY = cursorY + 8;
  const chartH = 62;
  const colGap = 8;
  const colW = (W - 28 - colGap) / 2;

  // Chart 1 — Department attendance comparison
  drawSectionHeader(doc, 'Department Attendance Comparison', 14, chartRowY - 4);
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...BORDER);
  doc.roundedRect(14, chartRowY, colW, chartH, 2, 2, 'FD');
  drawBarChart(
    doc, 22, chartRowY + 8, colW - 16, chartH - 22,
    deptRows.slice(0, 8).map(d => ({ label: d.name, value: d.rate })),
    100, BLUE, v => `${v.toFixed(0)}%`
  );

  // Chart 2 — Late arrivals by department
  const col2X = 14 + colW + colGap;
  drawSectionHeader(doc, 'Late Arrivals by Department', col2X, chartRowY - 4);
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...BORDER);
  doc.roundedRect(col2X, chartRowY, colW, chartH, 2, 2, 'FD');
  const maxLate = Math.max(1, ...deptRows.map(d => d.lateC));
  drawBarChart(
    doc, col2X + 8, chartRowY + 8, colW - 16, chartH - 22,
    deptRows.slice(0, 8).map(d => ({ label: d.name, value: d.lateC })),
    maxLate, AMBER, v => `${v.toFixed(0)}`
  );

  // Chart 3 — Attendance vs Absence distribution (donut)
  const chart3Y = chartRowY + chartH + 14;
  drawSectionHeader(doc, 'Attendance vs Absence Distribution', 14, chart3Y - 4);
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...BORDER);
  const chart3H = H - chart3Y - 16;
  doc.roundedRect(14, chart3Y, W - 28, chart3H, 2, 2, 'FD');

  const cx = 14 + 46;
  const cy = chart3Y + chart3H / 2;
  const r = Math.min(24, chart3H / 2 - 8);
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
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(`${attendanceRate.toFixed(0)}%`, cx, cy + 1.5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(...SUBTLE);
  doc.text('Present', cx, cy + 5.5, { align: 'center' });

  const legendX = 14 + 46 + r + 16;
  const legendItems = [
    { label: `Present days`, value: presentCount, color: GREEN },
    { label: `Absent days`, value: absentCount, color: RED },
  ];
  legendItems.forEach((item, i) => {
    const ly = cy - 6 + i * 12;
    doc.setFillColor(...item.color);
    doc.roundedRect(legendX, ly - 4, 5, 5, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(`${item.value}`, legendX + 9, ly);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...SUBTLE);
    doc.text(item.label, legendX + 9, ly + 5);
  });

  const summaryX = legendX + 70;
  if (summaryX < W - 40) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...SUBTLE);
    const note = doc.splitTextToSize(
      `Out of ${scheduled} scheduled employee-days this period, ${presentCount} were marked present and ${absentCount} absent, ` +
      `yielding an overall attendance rate of ${attendanceRate.toFixed(1)}%.`,
      W - 28 - (summaryX - 14) - 10
    );
    doc.text(note, summaryX, cy - 8);
  }

  // ── Footers on every page ─────────────────────────────────────────────
  drawFootersOnAllPages(doc, W, H, label, genDate);

  doc.save(`Attendance_Report_${label}.pdf`);
}