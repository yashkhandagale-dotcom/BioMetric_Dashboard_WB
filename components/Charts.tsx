'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, Legend, LabelList, AreaChart, Area, ReferenceLine
} from 'recharts';
import {
  ArrowLeft,
  ArrowUpDown,
  SortAsc,
  SortDesc,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { DailyTrend, DeptAttendance, HoursDistribution, AttendanceRecord, DayDeptSnapshot, Holiday, OfficeAttendance, LeaveRecord } from '@/lib/types';
import { durationToMinutes, minutesToHHMM, effectiveMinutes } from '@/lib/parseCSV';
import { isPresent, isAbsent, isWeeklyOff, SHIFT_MINUTES, computeLateMinutes, computeEarlyMinutes, getLateMinutes, getEarlyMinutes, computeProductivityLostMinutes, targetShiftMinutes } from '@/lib/useDashboardData';
import { isHoliday } from '@/lib/holidays';
import { leaveLabelFor, UNMARKED_LEAVE_LABEL } from '@/lib/leaveLabels';
import InfoTooltip from './InfoTooltip';
import { useTrendChartLayout, useGranularityOverride, TrendGranularity, useEntityChartLayout } from '@/lib/chartLayout';
import { useThemeColors } from '@/lib/useThemeColors';
import { effectiveMinutes } from '@/lib/hoursCalc';
import ChartFilterBar from './ChartFilterBar';

// Small prev/next day control embedded in the header of the "today" charts
// (DayDeptAttendanceChart/DayDeptLateChart/DayDeptProductivityChart) — lets
// a user step through individual days without leaving Single Day view or
// going back up to the main date picker. Purely presentational; the actual
// date state lives in DashboardClient and is passed down.
function DayNav({
  date, onPrevDay, onNextDay, canGoPrev, canGoNext,
}: {
  date?: string;
  onPrevDay?: () => void;
  onNextDay?: () => void;
  canGoPrev?: boolean;
  canGoNext?: boolean;
}) {
  if (!date || (!onPrevDay && !onNextDay)) return null;
  const label = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return (
    <div className="flex items-center gap-0.5 ml-auto flex-shrink-0">
      <button
        onClick={onPrevDay}
        disabled={!canGoPrev}
        title="Previous day"
        className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      <span className="text-[var(--text-muted)] text-[11px] font-medium w-14 text-center">{label}</span>
      <button
        onClick={onNextDay}
        disabled={!canGoNext}
        title="Next day"
        className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

type DayNavProps = {
  date?: string;
  onPrevDay?: () => void;
  onNextDay?: () => void;
  canGoPrev?: boolean;
  canGoNext?: boolean;
};

function rateColor(rate: number): string {
  if (rate >= 80) return '#34d399';
  if (rate >= 70) return '#fbbf24';
  return '#f87171';
}

// Wider 5-tier gradient for the monthly heatmap view (rateColor's 3 tiers
// are fine for a single tooltip line, but a grid of colored cells benefits
// from more visual separation between "70% attendance" and "95% attendance"
// than 2 buckets would give).
function monthlyAttendanceColor(pct: number): string {
  if (pct >= 90) return '#059669';
  if (pct >= 75) return '#34d399';
  if (pct >= 60) return '#fbbf24';
  if (pct >= 40) return '#f97316';
  return '#f87171';
}

function ChartSubtitle({ selectedDepts }: { selectedDepts?: string[] }) {
  if (!selectedDepts) return null;
  const label = selectedDepts.length === 0 ? 'All Departments' : selectedDepts.join(', ');
  return <p className="text-[var(--text-muted)] text-xs mt-0.5 mb-3"><span className="text-[var(--text-muted)]">{label}</span></p>;
}

function getDepartmentFromClick(entry: any): string | null {
  return entry?.department
    ?? entry?.payload?.department
    ?? entry?.data?.department
    ?? entry?.activePayload?.[0]?.payload?.department
    ?? entry?.activePayload?.[0]?.payload?.payload?.department
    ?? entry?.activePayload?.[0]?.payload?.name
    ?? entry?.activePayload?.[0]?.name
    ?? null;
}

// Sort toggle button
type SortMode = 'default' | 'az' | 'worst' | 'best';
function SortToggle({ mode, onChange }: { mode: SortMode; onChange: (m: SortMode) => void }) {
  const options: { key: SortMode; label: string }[] = [
    { key: 'default', label: 'Default' },
    { key: 'worst', label: 'Worst → Best' },
    { key: 'best', label: 'Best → Worst' },
    { key: 'az', label: 'A → Z' },
  ];
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${mode === o.key ? 'bg-blue-600 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Daily/Weekly/Monthly toggle for trend charts. `null` = Auto (granularity
// picked from point count by useTrendChartLayout). Auto is the default so
// nothing changes for short ranges; this just lets a user force a coarser
// view, or force Daily back on for a long range if they want to scroll
// instead of aggregate.
function GranularityToggle({ value, onChange, active }: {
  value: TrendGranularity | null;
  onChange: (v: TrendGranularity | null) => void;
  active: TrendGranularity;
}) {
  const options: { key: TrendGranularity | null; label: string }[] = [
    { key: null, label: 'Auto' },
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
  ];
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {options.map(o => (
        <button
          key={o.label}
          onClick={() => onChange(o.key)}
          title={o.key === null ? `Auto (currently ${active})` : undefined}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
            value === o.key ? 'bg-blue-600 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Daily Attendance Trend ────────────────────────────────────────────────────
export function DailyTrendChart({ data, selectedDepts, onDateClick, selectedDate }: {
  data: DailyTrend[];
  selectedDepts?: string[];
  onDateClick?: (date: string) => void;
  selectedDate?: string | null;
}) {
  const __tc = useThemeColors();
  const [absentModal, setAbsentModal] = useState<{ date: string; names: string[] } | null>(null);

  // Single click on a point drills into that day (onDateClick); double click
  // on the SAME point opens the full absentee list. We can't tell single vs
  // double apart until a short window has passed, so a single click is held
  // in a timeout and only fires if a second click doesn't arrive in time.
  // (The previous approach — a button inside the Recharts tooltip — was
  // unreliable because the tooltip wrapper sets pointer-events:none and
  // disappears as soon as the mouse leaves the dot.)
  const lastClickRef = useRef<{ date: string; time: number } | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current); };
  }, []);

  // Fixes the "chart becomes unreadable once many months are selected" bug:
  // past a threshold, points are aggregated to weekly/monthly buckets; below
  // it, the chart scrolls horizontally instead of squeezing every day into a
  // fixed width. See lib/chartLayout.ts for the thresholds/reasoning.
  const { override: granularityOverride, setOverride: setGranularityOverride } = useGranularityOverride();
  const { data: chartData, granularity, minWidth, isAggregated } = useTrendChartLayout(data, {
    averageKeys: ['attendanceRate'],
    sumKeys: ['presentCount', 'totalCount', 'lateCount', 'earlyExitCount', 'shortDayCount'],
    forceGranularity: granularityOverride,
  });

  // Custom tooltip — hover-only now; no interactive elements inside it.
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const entry = payload[0]?.payload;
    const rate = entry?.attendanceRate ?? 0;
    const present = entry?.presentCount ?? 0;
    const total = entry?.totalCount ?? 0;
    const absentees: string[] = entry?.absentees ?? [];
    const shown = absentees.slice(0, 5);
    const extra = absentees.length - 5;
    return (
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs shadow-xl max-w-[240px]">
        <p className="text-[var(--text-muted)] font-medium mb-1">{label}</p>
        <p style={{ color: rateColor(rate) }}>Rate: <strong>{rate}%</strong></p>
        <p className="text-blue-400">Present: {present} / {total}</p>
        {entry?.lateCount > 0 && <p className="text-amber-400">Late: {entry.lateCount}</p>}
        {entry?.shortDayCount > 0 && <p className="text-orange-400">Short Days: {entry.shortDayCount}</p>}
        {absentees.length > 0 && (
          <>
            <div className="border-t border-[var(--border)] my-1.5" />
            <p className="text-red-400 mb-1">Absent ({absentees.length}):</p>
            {shown.map((n, i) => <p key={i} className="text-[var(--text-muted)] truncate">{n}</p>)}
            {extra > 0 && <p className="text-[var(--text-muted)] text-[10px] mt-1">+{extra} more — double-click the point to see all</p>}
          </>
        )}
      </div>
    );
  };

 function handleChartClick(e: any) {
  // Aggregated (weekly/monthly) points represent a range of days, not one
  // day — drill-in and the absentee modal only make sense at daily
  // granularity, so this is a deliberate no-op rather than a bug.
  if (isAggregated) return;

  const index = Number(e?.activeTooltipIndex);

  if (Number.isNaN(index) || index < 0 || index >= chartData.length) {
    return;
  }

  const payload = chartData[index];

  const rawDate = payload.rawDate ?? payload.date;
  const absentees = payload.absentees ?? [];
  const now = Date.now();

  const isDoubleClick =
    !!lastClickRef.current &&
    lastClickRef.current.date === rawDate &&
    now - lastClickRef.current.time < 400;

  if (isDoubleClick) {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    lastClickRef.current = null;

    if (absentees.length) {
      setAbsentModal({
        date: payload.date,
        names: absentees,
      });
    }

    return;
  }

  lastClickRef.current = {
    date: rawDate,
    time: now,
  };

  if (clickTimerRef.current) clearTimeout(clickTimerRef.current);

  clickTimerRef.current = setTimeout(() => {
    onDateClick?.(rawDate);
    clickTimerRef.current = null;
    lastClickRef.current = null;
  }, 400);
}
  return (
    <>
      <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[280px]">
        <div className="flex items-start justify-between mb-1 flex-wrap gap-2">
          <div>
            <h3 className="text-[var(--text-primary)] font-semibold text-sm">Daily Attendance Trend</h3>
            <ChartSubtitle selectedDepts={selectedDepts} />
          </div>
          <div className="flex items-center gap-2">
            <GranularityToggle value={granularityOverride} onChange={setGranularityOverride} active={granularity} />
            <InfoTooltip title="Daily Attendance Trend" description="Daily attendance rate = present employees ÷ scheduled employees for that day. Holidays excluded. Past ~45 days the chart auto-switches to weekly averages, and past ~6 months to monthly, so it stays readable at any range — use the toggle to override. Double-click a date point to see the full absentee list for that day (daily view only)." formula="Present ÷ (Scheduled - WeeklyOff - Holidays) × 100" />
          </div>
        </div>
        {chartData.length === 0
          ? <div className="h-48 flex items-center justify-center text-[var(--text-muted)] text-sm">No data</div>
          : (
            <>
              {selectedDate && (
                <p className="text-blue-400 text-xs mb-2 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                  Showing: {selectedDate.slice(5)} · click another point to switch, click same to clear
                </p>
              )}
              <p className="text-[var(--text-muted)] text-[10px] mb-1">
                {isAggregated
                  ? `Showing ${granularity} averages across ${data.length} days · switch to Daily to drill into a single day`
                  : 'Hover a point to see absentees · double-click to see the full absentee list'}
              </p>
              <div className="overflow-x-auto">
                <div style={{ minWidth }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart
                      data={chartData}
                      margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
                      onClick={handleChartClick}
                      style={{ cursor: onDateClick && !isAggregated ? 'pointer' : 'default' }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={__tc.border} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: __tc.mutedText }} interval="preserveStart" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: __tc.mutedText }} unit="%" />
                      <ReferenceLine y={80} stroke="#34d399" strokeDasharray="4 2" strokeOpacity={0.6} />
                      <ReferenceLine y={70} stroke="#fbbf24" strokeDasharray="4 2" strokeOpacity={0.6} />
                      {selectedDate && !isAggregated && (
                        <ReferenceLine x={selectedDate.slice(5)} stroke="#60a5fa" strokeWidth={2} strokeDasharray="4 2" label={{ value: '▼', fill: '#60a5fa', fontSize: 10 }} />
                      )}
                      <Tooltip
                        content={<CustomTooltip />}
                        wrapperStyle={{ pointerEvents: 'auto', zIndex: 50 }}
                      />
                      <Line
                        type="monotone" dataKey="attendanceRate" name="Attendance %" stroke="#60a5fa" strokeWidth={2}
                        dot={(props: any) => {
                          const rate = props.payload.attendanceRate;
                          const isSelected = !isAggregated && selectedDate && props.payload.rawDate === selectedDate;
                          const color = rateColor(rate);
                          return <circle key={props.index} cx={props.cx} cy={props.cy}
                            r={isSelected ? 5 : 3} fill={color} stroke={isSelected ? '#fff' : 'none'} strokeWidth={isSelected ? 2 : 0} />;
                        }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
      </div>

      {/* Absent employees modal — rendered via portal so it's always on top */}
      {absentModal && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setAbsentModal(null)}
        >
          <div
            className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl p-5 max-w-md w-full max-h-[80vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold text-sm">Absent on {absentModal.date}</h3>
                <p className="text-[var(--text-muted)] text-xs mt-0.5">{absentModal.names.length} employees absent</p>
              </div>
              <button
                onClick={() => setAbsentModal(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-lg leading-none transition-colors"
              >✕</button>
            </div>
            <div className="space-y-0.5">
              {[...absentModal.names].sort().map((name, i) => (
                <div key={i} className="flex items-center gap-2 py-2 border-b border-[var(--border)]/40 last:border-0">
                  <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                  <span className="text-[var(--text-muted)] text-sm">{name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Multi-Department Daily Trend (comparison mode) ───────────────────────────
// One line per selected department, capped at 5 for readability. Used instead
// of DailyTrendChart when 2+ departments are selected (SRS Sec 12.5.1).
const COMPARISON_LINE_COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa'];

export function ComparisonTrendChart({ records, selectedDepts, holidays = [], graceMinutes = 10 }: {
  records: AttendanceRecord[];
  selectedDepts: string[];
  holidays?: Holiday[];
  graceMinutes?: number;
}) {
  const __tc = useThemeColors();
  const depts = selectedDepts.slice(0, 5);

  const { dailyRows, dates } = useMemo(() => {
    // date -> department -> { present, total }
    const byDate = new Map<string, Map<string, { present: number; total: number }>>();
    for (const r of records) {
      if (!depts.includes(r.department)) continue;
      if (isWeeklyOff(r.status)) continue;
      if (isHoliday(r.date, holidays) && !isPresent(r.status)) continue;
      if (!byDate.has(r.date)) byDate.set(r.date, new Map());
      const deptMap = byDate.get(r.date)!;
      if (!deptMap.has(r.department)) deptMap.set(r.department, { present: 0, total: 0 });
      const d = deptMap.get(r.department)!;
      if (!r.isShortDay) d.total++;
      if (isPresent(r.status) && !r.isShortDay) d.present++;
    }

    const sortedDates = Array.from(byDate.keys()).sort();
    const data = sortedDates.map(date => {
      const deptMap = byDate.get(date)!;
      const row: Record<string, string | number> = { date: date.slice(5), rawDate: date };
      for (const dept of depts) {
        const d = deptMap.get(dept);
        row[dept] = d && d.total > 0 ? Math.round((d.present / d.total) * 100) : 0;
      }
      return row;
    });
    return { dailyRows: data, dates: sortedDates };
  }, [records, depts, holidays]);

  // Same fix as DailyTrendChart: aggregate to weekly/monthly past a
  // threshold and scroll (instead of squeezing) below it, keyed off each
  // department's own percentage column since those are dynamic per selection.
  const { override: granularityOverride, setOverride: setGranularityOverride } = useGranularityOverride();
  const { data: chartData, granularity, minWidth, isAggregated } = useTrendChartLayout(dailyRows as any[], {
    averageKeys: depts,
    forceGranularity: granularityOverride,
  });

  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[280px]">
      <div className="flex items-start justify-between mb-1 flex-wrap gap-2">
        <div>
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">Daily Attendance Trend — Comparison</h3>
          <p className="text-[var(--text-muted)] text-xs mt-0.5 mb-3">
            {depts.length < selectedDepts.length
              ? `Showing first ${depts.length} of ${selectedDepts.length} selected departments`
              : 'One line per selected department'}
            {isAggregated ? ` · ${granularity} averages across ${dailyRows.length} days` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GranularityToggle value={granularityOverride} onChange={setGranularityOverride} active={granularity} />
          <InfoTooltip title="Daily Attendance Trend — Comparison" description="Daily attendance rate per department, so you can compare trends side by side. Holidays excluded. Past ~45 days this auto-switches to weekly averages, and past ~6 months to monthly, so it stays readable regardless of how many months are selected." formula="Present ÷ (Scheduled - WeeklyOff - Holidays) × 100, per department" />
        </div>
      </div>
      {chartData.length === 0 || dates.length === 0
        ? <div className="h-48 flex items-center justify-center text-[var(--text-muted)] text-sm">No data</div>
        : (
          <div className="overflow-x-auto">
            <div style={{ minWidth }}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={__tc.border} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: __tc.mutedText }} interval="preserveStart" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: __tc.mutedText }} unit="%" />
                  <Tooltip
                    content={({ active, payload, label }: any) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs shadow-xl">
                          <p className="text-[var(--text-muted)] font-medium mb-1">{label}</p>
                          {payload.map((p: any) => (
                            <p key={p.dataKey} style={{ color: p.color }}>{p.dataKey}: <strong>{p.value}%</strong></p>
                          ))}
                        </div>
                      );
                    }}
                    wrapperStyle={{ pointerEvents: 'none', zIndex: 50 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={(v: string) => <span style={{ color: __tc.mutedText }}>{v}</span>} />
                  {depts.map((dept, i) => (
                    <Line key={dept} type="monotone" dataKey={dept} name={dept}
                      stroke={COMPARISON_LINE_COLORS[i % COMPARISON_LINE_COLORS.length]}
                      strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
    </div>
  );
}

// ── Dept Attendance Ranking ───────────────────────────────────────────────────
interface DeptAttendanceChartProps {
  data: DeptAttendance[];
  allRecords: AttendanceRecord[];
  selectedDepts?: string[];
  // When set, bars for departments NOT in this list are dimmed — used in
  // comparison mode where `data` includes every department but only the
  // chosen ones should stand out.
  highlightDepts?: string[];
  onDeptClick?: (dept: string) => void;
  // When a dept is clicked here, we also want to sync the productivity chart
  onDeptDrillChange?: (dept: string | null) => void;
}

export function DeptAttendanceChart({ data, allRecords, selectedDepts, highlightDepts, onDeptClick, onDeptDrillChange }: DeptAttendanceChartProps) {
  const __tc = useThemeColors();
  const [manualDrill, setManualDrill] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('default');
  const drillDept = selectedDepts?.length === 1 ? selectedDepts[0] : manualDrill;

  const avgRate = data.length > 0 ? data.reduce((s, d) => s + d.rate, 0) / data.length : 0;

  const sortedData = useMemo(() => {
    const d = [...data];
    if (sortMode === 'az') return d.sort((a, b) => a.department.localeCompare(b.department));
    if (sortMode === 'worst') return d.sort((a, b) => a.rate - b.rate);
    if (sortMode === 'best') return d.sort((a, b) => b.rate - a.rate);
    return d.sort((a, b) => a.rate - b.rate); // default: worst first
  }, [data, sortMode]);

  const drillData = useMemo(() => {
    if (!drillDept) return [];
    const map = new Map<string, { name: string; code: string; present: number; absent: number }>();
    for (const r of allRecords) {
      if (r.department !== drillDept || isWeeklyOff(r.status)) continue;
      if (!map.has(r.employeeCode)) map.set(r.employeeCode, { name: r.employeeName || r.employeeCode, code: r.employeeCode, present: 0, absent: 0 });
      const row = map.get(r.employeeCode)!;
      if (isPresent(r.status)) row.present++;
      else if (isAbsent(r.status)) row.absent++;
    }
    const rows = Array.from(map.values());
    const rate = (e: { present: number; absent: number }) => e.present / (e.present + e.absent || 1);
    if (sortMode === 'az') return rows.sort((a, b) => a.name.localeCompare(b.name));
    if (sortMode === 'best') return rows.sort((a, b) => rate(b) - rate(a));
    return rows.sort((a, b) => rate(a) - rate(b)); // 'worst' and default
  }, [drillDept, allRecords, sortMode]);

  function handleDrillIn(dept: string) {
    setManualDrill(dept);
    onDeptDrillChange?.(dept);
    if (onDeptClick) onDeptClick(dept);
  }

  function handleBack() {
    setManualDrill(null);
    onDeptDrillChange?.(null);
    if (onDeptClick && selectedDepts?.length === 1) onDeptClick(selectedDepts[0]);
  }

  // Employee-level drilldowns can easily exceed a few hundred rows for a
  // large department — cap the default view to the top 15 (already sorted
  // by sortMode above), let a search narrow it, and let "Show all" expand
  // into a height-capped, internally-scrolling view instead of the page
  // growing to `rows * 36px` tall.
  const drillLayout = useEntityChartLayout(drillData, { getLabel: (r) => r.name });

  if (drillDept) {
    return (
      <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4">
        <div className="flex items-center flex-wrap gap-3 mb-1">
          <button onClick={handleBack} className="flex items-center gap-1.5 text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-xs font-medium transition-colors shrink-0">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">{drillDept} — Employee Attendance</h3>
        </div>
        <div className="mb-3">
          <SortToggle mode={sortMode} onChange={setSortMode} />
        </div>
        <ChartFilterBar
          query={drillLayout.query}
          onQueryChange={drillLayout.setQuery}
          totalCount={drillLayout.totalCount}
          matchedCount={drillLayout.matchedCount}
          hiddenCount={drillLayout.hiddenCount}
          isExpanded={drillLayout.isExpanded}
          onToggleExpanded={drillLayout.toggleExpanded}
        />
        {drillLayout.visibleRows.length === 0
          ? <div className="h-32 flex items-center justify-center text-[var(--text-muted)] text-sm">No employees match &quot;{drillLayout.query}&quot;</div>
          : (
            <div style={{ maxHeight: drillLayout.maxWrapperHeight, overflowY: drillLayout.willScroll ? 'auto' : 'visible' }}>
              <ResponsiveContainer width="100%" height={drillLayout.contentHeight}>
                <BarChart data={drillLayout.visibleRows} layout="vertical" margin={{ top: 4, right: 55, left: 4, bottom: 4 }} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke={__tc.border} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: __tc.mutedText }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={135} tick={{ fontSize: 10, fill: __tc.mutedText }}
                    tickFormatter={(v: string) => v.length > 19 ? v.slice(0, 18) + '…' : v} />
                  <Tooltip content={({ active, payload, label }: any) => {
                    if (!active || !payload?.length) return null;
                    const present = payload.find((p: any) => p.dataKey === 'present')?.value ?? 0;
                    const absent = payload.find((p: any) => p.dataKey === 'absent')?.value ?? 0;
                    const total = present + absent;
                    const rate = total > 0 ? ((present / total) * 100).toFixed(1) : '0';
                    return (
                      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs shadow-xl">
                        <p className="text-[var(--text-muted)] font-semibold mb-1.5">{label}</p>
                        <p className="text-emerald-400">Present: <strong>{present}d</strong></p>
                        <p className="text-red-400">On Leave: <strong>{absent}d</strong></p>
                        <p className="text-[var(--text-muted)] mt-1 pt-1 border-t border-[var(--border)]">Rate: <strong style={{ color: rateColor(parseFloat(rate)) }}>{rate}%</strong></p>
                      </div>
                    );
                  }} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={(v: string) => <span style={{ color: __tc.mutedText }}>{v}</span>} />
                  <Bar dataKey="present" name="Present" stackId="a" fill="#34d399">
                    <LabelList dataKey="present" position="insideRight" style={{ fontSize: 9, fill: '#064e3b' }} formatter={(v: any) => v > 0 ? v : ''} />
                  </Bar>
                  <Bar dataKey="absent" name="On Leave" stackId="a" fill="#f87171" radius={[0, 3, 3, 0]}>
                    <LabelList dataKey="absent" position="right" style={{ fontSize: 9, fill: __tc.mutedText }} formatter={(v: any) => v > 0 ? v : ''} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">Department Attendance Ranking</h3>
          <p className="text-[var(--text-muted)] text-xs mt-0.5 mb-2">Click a bar to drill into that department's employees</p>
        </div>
        <InfoTooltip title="Dept Attendance Ranking" description="Attendance rate per department for the selected period. Click a bar to see employee-level breakdown." formula="Present ÷ Scheduled × 100" />
      </div>
      <div className="mb-3">
        <SortToggle mode={sortMode} onChange={setSortMode} />
      </div>
      {sortedData.length === 0
        ? <div className="h-48 flex items-center justify-center text-[var(--text-muted)] text-sm">No data</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(200, sortedData.length * 40)}>
            <BarChart data={sortedData} layout="vertical" margin={{ top: 5, right: 50, left: 4, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={__tc.border} horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: __tc.mutedText }} unit="%" />
              <YAxis type="category" dataKey="department" width={110} tick={{ fontSize: 10, fill: __tc.mutedText }} />
              <ReferenceLine x={avgRate} stroke={__tc.mutedText} strokeDasharray="4 2" />
              <Tooltip content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-[var(--text-muted)] font-medium mb-1">{label}</p>
                    <p style={{ color: rateColor(payload[0]?.value) }}>Rate: <strong>{payload[0]?.value}%</strong></p>
                    <p className="text-[var(--text-muted)] text-[10px] mt-1">Click to drill into employees</p>
                  </div>
                );
              }} />
              <Bar dataKey="rate" cursor="pointer" radius={[0, 4, 4, 0]}
                onClick={(entry: any) => {
                  const dept = getDepartmentFromClick(entry);
                  if (dept) handleDrillIn(dept);
                }}>
                {sortedData.map((entry, i) => {
                  const dimmed = highlightDepts && highlightDepts.length > 0 && !highlightDepts.includes(entry.department);
                  return <Cell key={i} fill={rateColor(entry.rate)} fillOpacity={dimmed ? 0.25 : 1} />;
                })}
                <LabelList dataKey="rate" position="right" style={{ fontSize: 10, fill: __tc.mutedText }}
                  formatter={(v: any) => `${v}%`}
                  content={(props: any) => {
                    const entry = sortedData[props.index];
                    const dimmed = highlightDepts && highlightDepts.length > 0 && entry && !highlightDepts.includes(entry.department);
                    return <text x={props.x + props.width + 4} y={props.y + (props.height ?? 0) / 2} dy={4}
                      fontSize={10} fill={dimmed ? '#475569' : __tc.mutedText}>{props.value}%</text>;
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}

// ── Office-wise Attendance (FR-07 / Table 12) ────────────────────────────────
export function OfficeAttendanceChart({ data, onOfficeClick }: {
  data: OfficeAttendance[];
  onOfficeClick?: (office: string) => void;
}) {
  const __tc = useThemeColors();
  const [sortMode, setSortMode] = useState<SortMode>('default');

  const avgRate = data.length > 0 ? data.reduce((s, d) => s + d.rate, 0) / data.length : 0;

  const sortedData = useMemo(() => {
    const d = [...data];
    if (sortMode === 'az') return d.sort((a, b) => a.office.localeCompare(b.office));
    if (sortMode === 'worst') return d.sort((a, b) => a.rate - b.rate);
    if (sortMode === 'best') return d.sort((a, b) => b.rate - a.rate);
    return d.sort((a, b) => a.rate - b.rate); // default: worst first
  }, [data, sortMode]);

  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">Office-wise Attendance</h3>
          <p className="text-[var(--text-muted)] text-xs mt-0.5 mb-2">Attendance rate comparison across offices</p>
        </div>
        <InfoTooltip title="Office-wise Attendance" description="Attendance rate per office for the selected period, so HR can compare performance across locations." formula="Present ÷ Scheduled × 100" />
      </div>
      <div className="mb-3">
        <SortToggle mode={sortMode} onChange={setSortMode} />
      </div>
      {sortedData.length === 0
        ? <div className="h-48 flex items-center justify-center text-[var(--text-muted)] text-sm">No data</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(200, sortedData.length * 44)}>
            <BarChart data={sortedData} layout="vertical" margin={{ top: 5, right: 50, left: 4, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={__tc.border} horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: __tc.mutedText }} unit="%" />
              <YAxis type="category" dataKey="office" width={110} tick={{ fontSize: 10, fill: __tc.mutedText }} />
              <ReferenceLine x={avgRate} stroke={__tc.mutedText} strokeDasharray="4 2" />
              <Tooltip content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const entry = payload[0]?.payload;
                return (
                  <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-[var(--text-muted)] font-medium mb-1">{label}</p>
                    <p style={{ color: rateColor(entry?.rate) }}>Rate: <strong>{entry?.rate}%</strong></p>
                    <p className="text-[var(--text-muted)] mt-1">{entry?.presentCount} present / {entry?.scheduledCount} scheduled</p>
                    {onOfficeClick && <p className="text-[var(--text-muted)] text-[10px] mt-1">Click to filter by this office</p>}
                  </div>
                );
              }} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="rate" cursor={onOfficeClick ? 'pointer' : 'default'} radius={[0, 4, 4, 0]}
                onClick={(entry: any) => {
                  const office = entry?.office ?? entry?.payload?.office ?? entry?.activePayload?.[0]?.payload?.office;
                  if (office && onOfficeClick) onOfficeClick(office);
                }}>
                {sortedData.map((entry, i) => <Cell key={i} fill={rateColor(entry.rate)} />)}
                <LabelList dataKey="rate" position="right" style={{ fontSize: 10, fill: __tc.mutedText }} formatter={(v: any) => `${v}%`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}

// ── Productivity Lost by Dept ─────────────────────────────────────────────────
export function DeptProductivityChart({
  data, allRecords, selectedDepts, highlightDepts, externalDrillDept, onDrillBack, onDeptDrillChange, onDeptClick,
  shiftStartMinutes, shiftEndMinutes,
}: {
  data: DeptAttendance[];
  allRecords?: AttendanceRecord[];
  selectedDepts?: string[];
  // See DeptAttendanceChartProps.highlightDepts — same dimming behaviour here.
  highlightDepts?: string[];
  externalDrillDept?: string | null;
  onDrillBack?: () => void;
  onDeptDrillChange?: (dept: string | null) => void;
  onDeptClick?: (dept: string) => void; // clears selectedDepts on Back
  shiftStartMinutes?: number;
  shiftEndMinutes?: number;
}) {
  const __tc = useThemeColors();
  const [internalDrill, setInternalDrill] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('default');
  const safeRecords = allRecords ?? [];

  // Priority: top dept filter (selectedDepts) > a click on this chart's own bar
  // (internalDrill) > drill synced in from the linked DeptAttendanceChart.
  // Previously externalDrillDept was checked with `!== undefined`, which is
  // always true once the parent passes the prop (even as null), so clicking
  // a bar here never had any effect — internalDrill was always shadowed.
  const drillDept = selectedDepts?.length === 1
    ? selectedDepts[0]
    : internalDrill ?? (externalDrillDept ?? null);

  const chartData = useMemo(() => {
    const d = data.map(d => ({ department: d.department, daysLost: +(d.productivityLostDays ?? 0).toFixed(2) }));
    if (sortMode === 'az') return d.sort((a, b) => a.department.localeCompare(b.department));
    if (sortMode === 'worst') return d.sort((a, b) => b.daysLost - a.daysLost);
    if (sortMode === 'best') return d.sort((a, b) => a.daysLost - b.daysLost);
    return d.sort((a, b) => b.daysLost - a.daysLost); // default: worst first
  }, [data, sortMode]);

  function lostColor(days: number): string {
    if (days > 5) return '#f87171';
    if (days >= 2) return '#fbbf24';
    return '#34d399';
  }

  function handleDrillIn(dept: string) {
    setInternalDrill(dept);
    onDeptDrillChange?.(dept);
  }

  function handleBack() {
    setInternalDrill(null);
    onDeptDrillChange?.(null);
    onDrillBack?.();
    if (onDeptClick && selectedDepts?.length === 1) onDeptClick(selectedDepts[0]);
  }

  const drillData = useMemo(() => {
    if (!drillDept || safeRecords.length === 0) return [];
    const map = new Map<string, { name: string; code: string; lostMins: number; presentDays: number; daysWithDuration: number; effectiveMins: number }>();
    for (const r of safeRecords) {
      if (r.department !== drillDept || isWeeklyOff(r.status) || !isPresent(r.status) || r.isShortDay) continue;
      if (!map.has(r.employeeCode)) map.set(r.employeeCode, { name: r.employeeName || r.employeeCode, code: r.employeeCode, lostMins: 0, presentDays: 0, daysWithDuration: 0, effectiveMins: 0 });
      const e = map.get(r.employeeCode)!;
      e.presentDays++;
      e.lostMins += computeProductivityLostMinutes(r, shiftStartMinutes, shiftEndMinutes);
      const raw = durationToMinutes(r.duration);
      // Bug fix: a present-but-no-outpunch day (raw duration 0) was still
      // counted in the presentDays denominator below, so it diluted the
      // average as if the employee worked 0h that day instead of being
      // excluded as "no valid duration to measure" — same issue already
      // fixed for the Employee Table's Avg Hours and matching how the
      // Working Hours Distribution chart already averages. Track days with
      // an actual measured duration separately so "Present Days" (still all
      // present days, for that stat) and "Avg Effective Hrs" (only days we
      // can actually measure) don't share a denominator that means two
      // different things.
      if (raw > 60) {
        e.daysWithDuration++;
        e.effectiveMins += effectiveMinutes(raw);
      }
    }
    const target = targetShiftMinutes(shiftStartMinutes, shiftEndMinutes);
    const rows = Array.from(map.values()).map(e => ({
      ...e,
      daysLost: +(e.lostMins / target).toFixed(2),
      avgEffectiveMins: e.daysWithDuration > 0 ? Math.round(e.effectiveMins / e.daysWithDuration) : 0,
    }));
    if (sortMode === 'az') return rows.sort((a, b) => a.name.localeCompare(b.name));
    if (sortMode === 'best') return rows.sort((a, b) => a.daysLost - b.daysLost || a.name.localeCompare(b.name));
    return rows.sort((a, b) => b.daysLost - a.daysLost || a.name.localeCompare(b.name)); // 'worst' and default
  }, [drillDept, safeRecords, sortMode, shiftStartMinutes, shiftEndMinutes]);

  // Same unbounded-height issue as DeptAttendanceChart's drilldown — cap to
  // the top 15 by default (already sorted by sortMode), searchable, with a
  // "Show all" expand into a height-capped scrollable view.
  const drillLayout = useEntityChartLayout(drillData, { getLabel: (r) => r.name });

  if (drillDept) {
    return (
      <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[280px]">
        <div className="flex items-center flex-wrap gap-3 mb-1">
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-xs font-medium transition-colors shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">{drillDept} — Productivity Lost per Employee</h3>
        </div>
        <div className="mb-3">
          <SortToggle mode={sortMode} onChange={setSortMode} />
        </div>
        <p className="text-[var(--text-muted)] text-xs mb-1">based on hours short of 8h effective work</p>
        <ChartFilterBar
          query={drillLayout.query}
          onQueryChange={drillLayout.setQuery}
          totalCount={drillLayout.totalCount}
          matchedCount={drillLayout.matchedCount}
          hiddenCount={drillLayout.hiddenCount}
          isExpanded={drillLayout.isExpanded}
          onToggleExpanded={drillLayout.toggleExpanded}
        />
        {drillData.length === 0
          ? <div className="h-48 flex items-center justify-center text-[var(--text-muted)] text-sm">No present-day records found for this department</div>
          : drillLayout.visibleRows.length === 0
          ? <div className="h-32 flex items-center justify-center text-[var(--text-muted)] text-sm">No employees match &quot;{drillLayout.query}&quot;</div>
          : (
            <ResponsiveContainer width="100%" height={Math.max(280, drillData.length * 36)}>
              <BarChart data={drillData} layout="vertical" margin={{ top: 4, right: 65, left: 4, bottom: 4 }} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} unit="d" />
                <YAxis type="category" dataKey="name" width={135} tick={{ fontSize: 10, fill: '#94a3b8' }}
                  tickFormatter={(v: string) => v.length > 19 ? v.slice(0, 18) + '…' : v} />
                <Tooltip content={({ active, payload, label }: any) => {
                  if (!active || !payload?.length) return null;
                  const e = drillData.find(d => d.name === label);
                  return (
                    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                      <p className="text-slate-300 font-semibold mb-1.5">{label}</p>
                      <p className="text-amber-400">Days Lost: <strong>{payload[0]?.value}d</strong></p>
                      <p className="text-slate-400">Present Days: <strong>{e?.presentDays}</strong></p>
                      <p className="text-blue-400">Avg Working Hrs: <strong>{minutesToHHMM(e?.avgEffectiveMins ?? 0)}</strong></p>
                    </div>
                  );
                }} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="daysLost" radius={[0, 4, 4, 0]}>
                  {drillData.map((e, i) => <Cell key={i} fill={lostColor(e.daysLost)} />)}
                  <LabelList dataKey="daysLost" position="right" style={{ fontSize: 10, fill: '#94a3b8' }} formatter={(v: any) => `${v}d`} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[280px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">Productivity Lost by Dept</h3>
          <p className="text-[var(--text-muted)] text-xs mt-0.5 mb-2">Person-days short of 8h effective work · click a bar to see employees</p>
        </div>
        <InfoTooltip title="Dept Productivity Lost" description="Total person-days each department fell short of the 8h effective shift. Accounts for late arrivals AND early exits. Coming late but compensating with late exit = no loss." formula="Σ max(0, 8h - (duration - 1h lunch)) ÷ 480" />
      </div>
      <div className="mb-3">
        <SortToggle mode={sortMode} onChange={setSortMode} />
      </div>
      {chartData.length === 0
        ? <div className="h-48 flex items-center justify-center text-[var(--text-muted)] text-sm">No data</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 40)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 55, left: 4, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={__tc.border} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: __tc.mutedText }} unit="d" />
              <YAxis type="category" dataKey="department" width={110} tick={{ fontSize: 10, fill: __tc.mutedText }} />
              <Tooltip content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-[var(--text-muted)] font-medium mb-1">{label}</p>
                    <p className="text-amber-400">Days Lost: <strong>{payload[0]?.value}d</strong></p>
                    <p className="text-blue-400 mt-1">Click to see employees →</p>
                  </div>
                );
              }} />
              <Bar dataKey="daysLost" radius={[0, 4, 4, 0]} cursor="pointer"
                onClick={(entry: any) => handleDrillIn(entry.department)}>
                {chartData.map((entry, i) => {
                  const dimmed = highlightDepts && highlightDepts.length > 0 && !highlightDepts.includes(entry.department);
                  return <Cell key={i} fill={lostColor(entry.daysLost)} fillOpacity={dimmed ? 0.25 : 1} />;
                })}
                <LabelList dataKey="daysLost" position="right" style={{ fontSize: 10, fill: __tc.mutedText }} formatter={(v: any) => `${v}d`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}

// ── Hours Distribution (bins by 30-min intervals, drill to employees) ─────────
export function HoursDistributionChart({ data, allRecords, selectedDepts }: {
  data: HoursDistribution[];
  allRecords: AttendanceRecord[];
  selectedDepts?: string[];
}) {
  const __tc = useThemeColors();
  const [drillBin, setDrillBin] = useState<string | null>(null);

  // Bug fix: this used to bin every individual present day-record
  // independently, so an employee present 20 days with varying daily hours
  // would land in several different bars at once (and show up in more than
  // one bar's drill-down list). Aggregate to one avg-hours number PER
  // EMPLOYEE first — for the currently selected period/filters — then bin
  // employees (not day-records). Every employee now falls into exactly one
  // bar, and this same aggregation feeds both the chart and the drill-down
  // below so the two can never disagree.
  const employeeAverages = useMemo(() => {
    const map = new Map<string, { name: string; code: string; dept: string; effectiveMins: number; days: number }>();
    for (const r of allRecords) {
      if (!isPresent(r.status) || r.isShortDay) continue;
      const raw = durationToMinutes(r.duration);
      // subtract lunch — shared with useDashboardData.ts / exportData.ts (lib/hoursCalc.ts)
      const effective = effectiveMinutes(raw);
      if (effective === null) continue;
      if (effective <= 0 || effective > 720) continue;
      if (!map.has(r.employeeCode)) {
        map.set(r.employeeCode, { name: r.employeeName || r.employeeCode, code: r.employeeCode, dept: r.department || 'Unknown', effectiveMins: 0, days: 0 });
      }
      const e = map.get(r.employeeCode)!;
      e.effectiveMins += effective;
      e.days++;
    }
    return Array.from(map.values())
      .filter(e => e.days > 0)
      .map(e => ({ ...e, avgMins: e.effectiveMins / e.days, avgHours: +(e.effectiveMins / e.days / 60).toFixed(2) }));
  }, [allRecords]);

  const bins = useMemo(() => {
    const binMap = new Map<string, number>();
    for (let h = 0; h <= 12; h++) {
      for (const m of [0, 30]) {
        const label = `${h}:${m === 0 ? '00' : m}`;
        binMap.set(label, 0);
      }
    }
    for (const e of employeeAverages) {
      const binH = Math.floor(e.avgMins / 30) * 30;
      const label = `${Math.floor(binH / 60)}:${binH % 60 === 0 ? '00' : '30'}`;
      binMap.set(label, (binMap.get(label) || 0) + 1);
    }
    return Array.from(binMap.entries())
      .map(([bin, count]) => ({ bin, count }))
      .filter(b => b.count > 0);
  }, [employeeAverages]);

  // Drill: employees whose AVERAGE falls in the clicked bin (same employeeAverages
  // used to build the chart above, so the count on the bar and the list here always match).
  const drillEmployees = useMemo(() => {
    if (!drillBin) return [];
    const [hStr, mStr] = drillBin.split(':');
    const binStart = parseInt(hStr) * 60 + parseInt(mStr);
    const binEnd = binStart + 30;

    return employeeAverages
      .filter(e => e.avgMins >= binStart && e.avgMins < binEnd)
      .sort((a, b) => a.avgHours - b.avgHours);
  }, [drillBin, employeeAverages]);

  if (drillBin) {
    return (
      <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[280px]">
        <div className="flex items-center flex-wrap gap-3 mb-1">
          <button onClick={() => setDrillBin(null)} className="flex items-center gap-1.5 text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-xs font-medium transition-colors shrink-0">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <h3 className="text-white font-semibold text-sm">Employees: {drillBin}–{drillBin.split(':')[0]}:{ parseInt(drillBin.split(':')[1]) === 0 ? '30' : '00'} avg effective work</h3>
        </div>
        <p className="text-[var(--text-muted)] text-xs mb-4">{drillEmployees.length} employees average in this range</p>
        {drillEmployees.length === 0
          ? <div className="h-40 flex items-center justify-center text-[var(--text-muted)] text-sm">No data</div>
          : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {drillEmployees.map((e, i) => (
                <div key={e.code} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--bg-elevated)]/30 hover:bg-[var(--bg-elevated)]/50">
                  <div>
                    <span className="text-[var(--text-primary)] text-xs font-medium">{e.name}</span>
                    <span className="text-[var(--text-muted)] text-xs ml-2">· {e.dept}</span>
                  </div>
                  <span className="text-blue-400 text-xs font-mono">{minutesToHHMM(Math.round(e.avgMins))} avg</span>
                </div>
              ))}
            </div>
          )}
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[280px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">Working Hours Distribution</h3>
          <ChartSubtitle selectedDepts={selectedDepts} />
        </div>
        <InfoTooltip title="Hours Distribution" description="Each employee's own average working hours (total duration − 1h lunch, averaged across their present days in the selected period) — every employee falls into exactly one bar. Click a bar to see which employees fall in that range." formula="Working hours = Duration − 60 min lunch, averaged per employee · Bin = 30 minutes" />
      </div>
      {bins.length === 0
        ? <div className="h-48 flex items-center justify-center text-[var(--text-muted)] text-sm">No data</div>
        : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={bins} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={__tc.border} />
              <XAxis dataKey="bin" tick={{ fontSize: 10, fill: __tc.mutedText }} interval={1} />
              <YAxis tick={{ fontSize: 10, fill: __tc.mutedText }} allowDecimals={false} />
              <ReferenceLine x="8:00" stroke={__tc.mutedText} strokeDasharray="4 2" />
              <Tooltip content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-slate-300 font-medium">{label} avg effective range</p>
                    <p className="text-blue-400">Count: <strong>{payload[0]?.value} employees</strong></p>
                    <p className="text-[var(--text-muted)] text-[10px] mt-1">Click to see employees</p>
                  </div>
                );
              }} />
              <Bar dataKey="count" fill="#60a5fa" radius={[3, 3, 0, 0]} cursor="pointer"
                onClick={(entry: any) => setDrillBin(entry.bin)}>
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}

// ── Per-Employee Heatmap ──────────────────────────────────────────────────────
export function PersonalHeatmap({
  records, graceMinutes = 10, shiftStartMinutes, shiftEndMinutes, leaveMap,
}: {
  records: AttendanceRecord[];
  graceMinutes?: number;
  shiftStartMinutes?: number;
  shiftEndMinutes?: number;
  // employeeCode__date -> LeaveRecord, synced in from the Leave Tracker.
  // When present for a day, that day is "On Leave" (with its type); when
  // absent for a day with no leave record, it's "Unmarked Leave" — same
  // absent/present business logic as before, just labeled by whether HR
  // has actually recorded something for it yet.
  leaveMap?: Map<string, LeaveRecord>;
}) {
  const [tooltip, setTooltip] = useState<{ r: AttendanceRecord; x: number; y: number } | null>(null);
  const sorted = useMemo(() => [...records].sort((a, b) => a.date.localeCompare(b.date)), [records]);

  if (sorted.length === 0) return null;

  return (
    <div>
      <div className="flex flex-wrap gap-0.5">
        {sorted.map((r) => {
          const leave = leaveMap?.get(leaveKey(r.employeeCode, r.date));
          const status = getCellStatus(r, graceMinutes, shiftStartMinutes, shiftEndMinutes, leave);
          const color = STATUS_COLORS_CELL[status] || '#334155';
          return (
            <div
              key={r.date}
              className="w-4 h-4 rounded-sm cursor-pointer hover:ring-1 hover:ring-white/40 transition-all"
              style={{ backgroundColor: color + '90' }}
              onMouseEnter={(e) => setTooltip({ r, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-2">
        {Object.entries({ present: 'Present', late: 'Late', earlyexit: 'Early Exit', on_leave: 'On Leave', absent: UNMARKED_LEAVE_LABEL, shortday: 'Short Day', weeklyoff: 'Weekly Off', holiday: 'Holiday' }).map(([k, label]) => (
          <div key={k} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: STATUS_COLORS_CELL[k] + '90' }} />
            <span className="text-[var(--text-muted)] text-[9px]">{label}</span>
          </div>
        ))}
      </div>
      {tooltip && (() => {
        const leave = leaveMap?.get(leaveKey(tooltip.r.employeeCode, tooltip.r.date));
        const statusLine = leave
          ? `On Leave — ${leaveLabelFor(leave.leaveType, leave.halfDayLeaveType)}`
          : tooltip.r.status.toLowerCase().includes('absent')
            ? UNMARKED_LEAVE_LABEL
            : tooltip.r.status;
        return (
          <div
            className="fixed z-50 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs shadow-2xl pointer-events-none"
            style={{ left: tooltip.x + 12, top: tooltip.y - 20 }}
          >
            <p className="text-[var(--text-primary)] font-medium">{tooltip.r.date}</p>
            <p className="text-[var(--text-muted)]">In: {tooltip.r.inTime || '—'} · Out: {tooltip.r.outTime || '—'}</p>
            <p className="text-[var(--text-muted)]">{statusLine}</p>
          </div>
        );
      })()}
    </div>
  );
}

export const STATUS_COLORS_CELL: Record<string, string> = {
  present: '#34d399',
  late: '#fbbf24',
  earlyexit: '#60a5fa',
  // 'absent' here means "unmarked leave" — an absent day nobody has
  // recorded a leave for yet. Kept as the key 'absent' internally (so it
  // still falls back correctly wherever a leave record isn't looked up),
  // but always labeled "Unmarked Leave" to the user — see UNMARKED_LEAVE_LABEL.
  absent: '#f87171',
  // A day HR has marked a leave for — distinct color from unmarked so the
  // two are visually distinguishable at a glance.
  on_leave: '#38bdf8',
  missed_punch_out: '#d97706',
  weeklyoff: '#334155',
  shortday: '#f97316',
  holiday: '#a78bfa',
};

export function getCellStatus(
  r: AttendanceRecord,
  graceMinutes: number = 10,
  shiftStartMinutes?: number,
  shiftEndMinutes?: number,
  leave?: LeaveRecord
): string {
  // Leave takes priority over everything else, same as the day-wise
  // status badge in EmployeePanel.tsx — a marked leave is the most
  // specific, most authoritative thing known about that day.
  if (leave) return 'on_leave';
  if (r.isShortDay) return 'shortday';
  const s = r.status.toLowerCase();
  if (s.includes('weeklyoff')) return 'weeklyoff';
  if (s.includes('absent')) return 'absent';
  if (s.includes('present')) {
    if (computeLateMinutes(r.inTime, graceMinutes, shiftStartMinutes) > 0) return 'late';
    if (computeEarlyMinutes(r.outTime, graceMinutes, shiftEndMinutes) > 0) return 'earlyexit';
    return 'present';
  }
  return 'absent';
}

function leaveKey(employeeCode: string, date: string): string {
  return `${employeeCode}__${date}`;
}

export function AttendanceHeatmap({
  records, onCellClick, graceMinutes = 10, shiftStartMinutes, shiftEndMinutes, leaveMap,
}: {
  records: AttendanceRecord[];
  onCellClick?: (emp: string, date: string) => void;
  graceMinutes?: number;
  shiftStartMinutes?: number;
  shiftEndMinutes?: number;
  leaveMap?: Map<string, LeaveRecord>;
}) {
  const [tooltip, setTooltip] = useState<{ r: AttendanceRecord; x: number; y: number } | null>(null);
  const [heatmapSort, setHeatmapSort] = useState<'absences' | 'az'>('absences');

  const { employees, dates, cellMap } = useMemo(() => {
    const empSet = new Map<string, string>();
    const dateSet = new Set<string>();
    const cellMap = new Map<string, AttendanceRecord>();

    for (const r of records) {
      if (!empSet.has(r.employeeCode)) empSet.set(r.employeeCode, r.employeeName);
      dateSet.add(r.date);
      cellMap.set(`${r.employeeCode}_${r.date}`, r);
    }
    const dates = Array.from(dateSet).sort();
    const employees = Array.from(empSet.entries()).map(([code, name]) => ({ code, name }));

    return { employees, dates, cellMap };
  }, [records]);

  // Group the (already date-range-filtered) dates by calendar month. When the
  // selected range spans more than one month, rendering every date in a
  // single row gets unreadable and previously got silently truncated to the
  // first 31 entries — so instead we split into per-month chunks: Monthly
  // Overview (below) summarizes all of them at once, and Daily Detail lets
  // you pick one via dropdown to see individual days.
  const monthGroups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const d of dates) {
      const key = d.slice(0, 7); // "YYYY-MM"
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [dates]);

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  // Keep the selected month valid as the underlying date range changes
  // (e.g. user picks a new From/To range) — default to the most recent month.
  useEffect(() => {
    if (monthGroups.length === 0) return;
    if (!selectedMonth || !monthGroups.some(([key]) => key === selectedMonth)) {
      setSelectedMonth(monthGroups[monthGroups.length - 1][0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthGroups]);

  const isMultiMonth = monthGroups.length > 1;

  // Monthly Overview vs Daily Detail. A 12-month range showing one
  // day-grid at a time behind a dropdown means actually noticing a
  // consistently-low performer requires opening all 12 months one by
  // one — so once the range spans more than one month, default to one
  // column per month colored by that month's attendance %, and let a
  // click on any month cell jump straight into its daily detail.
  // Manually overridable via the toggle in the header either way.
  const [viewMode, setViewMode] = useState<'day' | 'month'>('day');
  useEffect(() => {
    setViewMode(isMultiMonth ? 'month' : 'day');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiMonth]);

  // Per employee, per month: how many eligible (non weekly-off, non
  // holiday) days were present vs total — weekly-offs/holidays are
  // excluded from the denominator so a month full of holidays doesn't
  // read as a bad attendance month.
  const monthlyStats = useMemo(() => {
    const map = new Map<string, { present: number; eligible: number }>();
    for (const r of records) {
      const monthKey = r.date.slice(0, 7);
      const leave = leaveMap?.get(leaveKey(r.employeeCode, r.date));
      const status = getCellStatus(r, graceMinutes, shiftStartMinutes, shiftEndMinutes, leave);
      if (status === 'weeklyoff' || status === 'holiday') continue;
      const key = `${r.employeeCode}_${monthKey}`;
      const entry = map.get(key) ?? { present: 0, eligible: 0 };
      entry.eligible += 1;
      if (status === 'present' || status === 'late' || status === 'earlyexit' || status === 'shortday') entry.present += 1;
      map.set(key, entry);
    }
    return map;
  }, [records, leaveMap, graceMinutes, shiftStartMinutes, shiftEndMinutes]);

  const monthPct = (code: string, monthKey: string): number | null => {
    const e = monthlyStats.get(`${code}_${monthKey}`);
    if (!e || e.eligible === 0) return null;
    return Math.round((e.present / e.eligible) * 100);
  };

  const visibleDates = isMultiMonth
    ? (monthGroups.find(([key]) => key === selectedMonth)?.[1] ?? monthGroups[monthGroups.length - 1][1])
    : dates;

  const monthLabel = (key: string) =>
    new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const monthLabelShort = (key: string) =>
    new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

  // Rank employees worst-first in both modes, just measured differently:
  // Daily Detail counts raw absent days within the one visible month;
  // Monthly Overview averages attendance % across every month in range,
  // so a consistently weak performer surfaces without having to open
  // each month individually to spot them.
  const sortedEmployees = useMemo(() => {
    if (viewMode === 'month') {
      const withAvg = employees.map(emp => {
        const pcts = monthGroups.map(([key]) => monthPct(emp.code, key)).filter((p): p is number => p !== null);
        const avgPct = pcts.length > 0 ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 100;
        return { ...emp, absences: 0, avgPct };
      });
      return heatmapSort === 'az'
        ? withAvg.sort((a, b) => a.name.localeCompare(b.name))
        : withAvg.sort((a, b) => a.avgPct - b.avgPct || a.name.localeCompare(b.name));
    }
    const withAbsences = employees.map(emp => {
      let absences = 0;
      for (const date of visibleDates) {
        const r = cellMap.get(`${emp.code}_${date}`);
        const leave = r ? leaveMap?.get(leaveKey(r.employeeCode, r.date)) : undefined;
        const status = r ? getCellStatus(r, graceMinutes, shiftStartMinutes, shiftEndMinutes, leave) : 'absent';
        if (status === 'absent') absences++;
      }
      return { ...emp, absences, avgPct: 0 };
    });
    return heatmapSort === 'az'
      ? withAbsences.sort((a, b) => a.name.localeCompare(b.name))
      : withAbsences.sort((a, b) => b.absences - a.absences || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, visibleDates, cellMap, leaveMap, graceMinutes, shiftStartMinutes, shiftEndMinutes, heatmapSort, viewMode, monthGroups, monthlyStats]);

  // Row height differs between the two grids — Monthly Overview's cells
  // carry a percentage label so they're taller than the plain day squares.
  const heatmapLayout = useEntityChartLayout(sortedEmployees, { getLabel: (e) => e.name, rowHeight: viewMode === 'month' ? 32 : 22 });

  if (records.length === 0) return null;

  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">Attendance Heatmap</h3>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            {viewMode === 'month'
              ? <>{employees.length} employees · {monthGroups.length} months — colored by attendance % · click a month to see daily detail</>
              : <>{employees.length} employees · {visibleDates.length} days{isMultiMonth && selectedMonth ? ` in ${monthLabel(selectedMonth)}` : ''} — click any cell for details</>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isMultiMonth && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewMode('month')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${viewMode === 'month' ? 'bg-blue-600 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                Monthly Overview
              </button>
              <button
                onClick={() => setViewMode('day')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${viewMode === 'day' ? 'bg-blue-600 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                Daily Detail
              </button>
            </div>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setHeatmapSort('absences')}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${heatmapSort === 'absences' ? 'bg-blue-600 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              {viewMode === 'month' ? 'Lowest Attendance' : 'Most Absent'}
            </button>
            <button
              onClick={() => setHeatmapSort('az')}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${heatmapSort === 'az' ? 'bg-blue-600 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              A → Z
            </button>
          </div>
          {viewMode === 'day' && isMultiMonth && (
            <select
              value={selectedMonth ?? ''}
              onChange={e => setSelectedMonth(e.target.value)}
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-xs text-[var(--text-primary)] px-2 py-1.5 focus:outline-none focus:border-blue-500"
              title="Pick which month's days to view"
            >
              {monthGroups.map(([key]) => (
                <option key={key} value={key}>{monthLabel(key)}</option>
              ))}
            </select>
          )}
          <InfoTooltip
            title="Attendance Heatmap"
            description={viewMode === 'month'
              ? "Each cell = one employee's attendance % for that month (weekly-offs and holidays excluded from the calculation). Click a cell to jump into that month's daily detail. Sort/search the employee list when there are more than 15."
              : "Each cell = one employee on one day. Colors show attendance status. Click any cell to see details. When your selected range spans more than one month, switch to Monthly Overview for a summary, or use the month dropdown here to pick a single month's days. Sort/search the employee list when there are more than 15."}
          />
        </div>
      </div>

      <ChartFilterBar
        query={heatmapLayout.query}
        onQueryChange={heatmapLayout.setQuery}
        totalCount={heatmapLayout.totalCount}
        matchedCount={heatmapLayout.matchedCount}
        hiddenCount={heatmapLayout.hiddenCount}
        isExpanded={heatmapLayout.isExpanded}
        onToggleExpanded={heatmapLayout.toggleExpanded}
      />

      {heatmapLayout.visibleRows.length === 0
        ? <div className="h-32 flex items-center justify-center text-[var(--text-muted)] text-sm">No employees match &quot;{heatmapLayout.query}&quot;</div>
        : viewMode === 'month'
        ? (
          <div className="overflow-x-auto">
            <div
              style={{ minWidth: monthGroups.length * 52 + 160, maxHeight: heatmapLayout.maxWrapperHeight, overflowY: heatmapLayout.willScroll ? 'auto' : 'visible' }}
            >
              <div className="flex gap-1 mb-1 ml-[152px] sticky top-0 bg-[var(--bg-elevated)] z-10">
                {monthGroups.map(([key]) => (
                  <div key={key} className="w-12 text-[9px] text-[var(--text-muted)] text-center flex-shrink-0">{monthLabelShort(key)}</div>
                ))}
              </div>
              {heatmapLayout.visibleRows.map(emp => (
                <div key={emp.code} className="flex items-center gap-1 mb-1">
                  <div className="w-36 text-[10px] text-[var(--text-muted)] truncate flex-shrink-0 text-right pr-2" title={`${emp.name} · ${emp.avgPct}% avg attendance across ${monthGroups.length} months`}>
                    {emp.name.length > 16 ? emp.name.slice(0, 15) + '…' : emp.name}
                  </div>
                  {monthGroups.map(([key]) => {
                    const pct = monthPct(emp.code, key);
                    return (
                      <button
                        key={key}
                        onClick={() => { setSelectedMonth(key); setViewMode('day'); }}
                        title={`${emp.name} · ${monthLabel(key)} · ${pct === null ? 'no data' : pct + '% attendance'}`}
                        className="w-12 h-7 rounded-sm flex-shrink-0 flex items-center justify-center text-[9px] font-medium text-white/90 hover:ring-1 hover:ring-white/40 transition-all"
                        style={{ backgroundColor: pct === null ? '#33415560' : monthlyAttendanceColor(pct) }}
                      >
                        {pct === null ? '—' : `${pct}%`}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )
        : (
          <div className="overflow-x-auto">
            <div
              style={{ minWidth: visibleDates.length * 22 + 160, maxHeight: heatmapLayout.maxWrapperHeight, overflowY: heatmapLayout.willScroll ? 'auto' : 'visible' }}
            >
              <div className="flex gap-0.5 mb-1 ml-[152px] sticky top-0 bg-[var(--bg-elevated)] z-10">
                {visibleDates.map(d => (
                  <div key={d} className="w-5 text-[8px] text-[var(--text-muted)] text-center flex-shrink-0">{d.slice(8)}</div>
                ))}
              </div>
              {heatmapLayout.visibleRows.map(emp => (
                <div key={emp.code} className="flex items-center gap-0.5 mb-0.5">
                  <div className="w-36 text-[10px] text-[var(--text-muted)] truncate flex-shrink-0 text-right pr-2" title={`${emp.name} · ${emp.absences} absent day${emp.absences === 1 ? '' : 's'}`}>
                    {emp.name.length > 16 ? emp.name.slice(0, 15) + '…' : emp.name}
                  </div>
                  {visibleDates.map(date => {
                    const r = cellMap.get(`${emp.code}_${date}`);
                    const leave = r ? leaveMap?.get(leaveKey(r.employeeCode, r.date)) : undefined;
                    const status = r ? getCellStatus(r, graceMinutes, shiftStartMinutes, shiftEndMinutes, leave) : 'absent';
                    const color = STATUS_COLORS_CELL[status] || '#334155';
                    return (
                      <div
                        key={date}
                        className="w-5 h-5 rounded-sm cursor-pointer hover:ring-1 hover:ring-white/40 flex-shrink-0 transition-all"
                        style={{ backgroundColor: color + '90' }}
                        onMouseEnter={(e) => r && setTooltip({ r, x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setTooltip(null)}
                        onClick={() => r && onCellClick?.(emp.code, date)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

      <div className="flex flex-wrap gap-3 mt-3">
        {viewMode === 'month'
          ? [
              { pct: 90, label: '90%+' },
              { pct: 75, label: '75–89%' },
              { pct: 60, label: '60–74%' },
              { pct: 40, label: '40–59%' },
              { pct: 0, label: '<40%' },
            ].map(({ pct, label }) => (
              <div key={label} className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: monthlyAttendanceColor(pct) }} />
                <span className="text-[var(--text-muted)] text-[10px]">{label}</span>
              </div>
            ))
          : Object.entries({ present: 'Present', late: 'Late', earlyexit: 'Early Exit', on_leave: 'On Leave', absent: UNMARKED_LEAVE_LABEL, shortday: 'Short Day', weeklyoff: 'Weekly Off', holiday: 'Holiday' }).map(([k, label]) => (
              <div key={k} className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: STATUS_COLORS_CELL[k] + '90' }} />
                <span className="text-[var(--text-muted)] text-[10px]">{label}</span>
              </div>
            ))}
      </div>

      {viewMode === 'day' && tooltip && (() => {
        const leave = leaveMap?.get(leaveKey(tooltip.r.employeeCode, tooltip.r.date));
        const statusLine = leave
          ? `On Leave — ${leaveLabelFor(leave.leaveType, leave.halfDayLeaveType)}`
          : tooltip.r.status.toLowerCase().includes('absent')
            ? UNMARKED_LEAVE_LABEL
            : tooltip.r.status;
        return (
          <div
            className="fixed z-50 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs shadow-2xl pointer-events-none"
            style={{ left: tooltip.x + 12, top: tooltip.y - 20 }}
          >
            <p className="text-[var(--text-primary)] font-medium">{tooltip.r.employeeName}</p>
            <p className="text-[var(--text-muted)]">{tooltip.r.date}</p>
            <p className="text-[var(--text-muted)]">In: {tooltip.r.inTime || '—'} · Out: {tooltip.r.outTime || '—'}</p>
            <p className="text-[var(--text-muted)]">{statusLine}</p>
          </div>
        );
      })()}
    </div>
  );
}

// ── SINGLE DAY VIEW CHARTS ────────────────────────────────────────────────────

// ── Employee row used inside single-day team drill ───────────────────────────
function EmployeeAttendanceRow({
  r, graceMinutes = 10, shiftStartMinutes, shiftEndMinutes,
}: {
  r: AttendanceRecord;
  graceMinutes?: number;
  shiftStartMinutes?: number;
  shiftEndMinutes?: number;
}) {
  const lateM = getLateMinutes(r, graceMinutes, shiftStartMinutes);
  const earlyM = getEarlyMinutes(r, graceMinutes, shiftEndMinutes);
  const lostM = computeProductivityLostMinutes(r, shiftStartMinutes, shiftEndMinutes);
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors">
      <span className="text-[var(--text-primary)] text-xs font-medium truncate max-w-[140px]">{r.employeeName || r.employeeCode}</span>
      <div className="flex items-center gap-2 text-xs flex-shrink-0">
        <span className="text-slate-400 font-mono">{r.inTime || '—'} → {r.outTime || '—'}</span>
        {lateM > 0 && <span className="bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded text-[10px]">Late {lateM}m</span>}
        {earlyM > 0 && <span className="bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded text-[10px]">Early {earlyM}m</span>}
        {lostM > 0 && <span className="bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded text-[10px]">−{minutesToHHMM(lostM)}</span>}
      </div>
    </div>
  );
}

// ── Attendance Today ──────────────────────────────────────────────────────────
export function DayDeptAttendanceChart({
  data, onDeptClick, allRecords, graceMinutes = 10, shiftStartMinutes, shiftEndMinutes, leaveMap,
  date, onPrevDay, onNextDay, canGoPrev, canGoNext,
}: {
  data: DayDeptSnapshot[];
  onDeptClick?: (dept: string) => void;
  allRecords?: AttendanceRecord[];
  graceMinutes?: number;
  shiftStartMinutes?: number;
  shiftEndMinutes?: number;
  leaveMap?: Map<string, LeaveRecord>;
} & DayNavProps) {
  const __tc = useThemeColors();
  const [drillDept, setDrillDept] = useState<string | null>(null);

  // If only 1 dept in data (dept filter active), show employees directly
  const singleDept = data.length === 1 ? data[0].department : null;
  const activeDept = singleDept ?? drillDept;

  if (activeDept && allRecords) {
    const deptRecords = allRecords.filter(r => r.department === activeDept);
    const present = deptRecords.filter(r => isPresent(r.status) && !r.isShortDay);
    const absent = deptRecords.filter(r => !isPresent(r.status) && !isWeeklyOff(r.status) && !r.isShortDay);

    return (
      <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[260px]">
        <div className="flex items-center flex-wrap gap-2 mb-3">
          {!singleDept && (
            <button onClick={() => setDrillDept(null)} className="flex items-center gap-1 text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-xs font-medium">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          )}
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">{activeDept} — Attendance</h3>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[var(--text-muted)] text-xs">{present.length} present · {absent.length} on leave</span>
            <DayNav date={date} onPrevDay={onPrevDay} onNextDay={onNextDay} canGoPrev={canGoPrev} canGoNext={canGoNext} />
          </div>
        </div>
        <div className="space-y-1 max-h-[240px] overflow-y-auto">
          {present.map(r => (
            <EmployeeAttendanceRow
              key={r.employeeCode} r={r}
              graceMinutes={graceMinutes} shiftStartMinutes={shiftStartMinutes} shiftEndMinutes={shiftEndMinutes}
            />
          ))}
          {absent.map(r => {
            const leave = leaveMap?.get(leaveKey(r.employeeCode, r.date));
            return (
              <div key={r.employeeCode} className="flex items-center justify-between py-2 px-3 rounded-lg bg-red-500/10">
                <span className="text-[var(--text-primary)] text-xs font-medium">{r.employeeName || r.employeeCode}</span>
                <span className="text-red-400 text-xs">
                  {leave ? `On Leave — ${leaveLabelFor(leave.leaveType, leave.halfDayLeaveType)}` : UNMARKED_LEAVE_LABEL}
                </span>
              </div>
            );
          })}
          {present.length === 0 && absent.length === 0 && (
            <p className="text-[var(--text-muted)] text-sm text-center py-6">No records for this team today</p>
          )}
        </div>
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => b.presentCount - a.presentCount);
  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[260px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">Dept Attendance Today</h3>
          <p className="text-[var(--text-muted)] text-xs mt-0.5 mb-3">Click a bar to see all employees in that team</p>
        </div>
        <DayNav date={date} onPrevDay={onPrevDay} onNextDay={onNextDay} canGoPrev={canGoPrev} canGoNext={canGoNext} />
        <InfoTooltip title="Dept Attendance Today" description="Present count per department today. Click any bar to see the full employee list with punch times." />
      </div>
      {sorted.length === 0
        ? <div className="h-40 flex items-center justify-center text-[var(--text-muted)] text-sm">No data for this date</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 40)}>
            <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 36, left: 4, bottom: 4 }}
              onClick={(entry: any) => {
                const dept = getDepartmentFromClick(entry);
                if (dept) { setDrillDept(dept); onDeptClick?.(dept); }
              }}>
              <CartesianGrid strokeDasharray="3 3" stroke={__tc.border} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: __tc.mutedText }} allowDecimals={false} />
              <YAxis type="category" dataKey="department" tick={{ fontSize: 10, fill: __tc.mutedText }} width={100} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const d: DayDeptSnapshot = payload[0]?.payload;
                return (
                  <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-[var(--text-primary)] font-medium mb-1">{label}</p>
                    <p className="text-emerald-400">Present: <strong>{d.presentCount}</strong> / {d.scheduledCount}</p>
                    <p className="text-red-400">Absent: {d.absentCount}</p>
                    <p className="text-amber-400">Late: {d.lateCount}</p>
                    <p className="text-[var(--text-muted)] text-[10px] mt-1">Click to see all employees →</p>
                  </div>
                );
              }} />
              <Bar dataKey="presentCount" name="Present" radius={[0, 4, 4, 0]} cursor="pointer" isAnimationActive={false}>
                {sorted.map((entry, i) => (
                  <Cell key={i} fill={entry.presentCount >= entry.scheduledCount * 0.8 ? '#34d399' : entry.presentCount >= entry.scheduledCount * 0.7 ? '#fbbf24' : '#f87171'} />
                ))}
                <LabelList dataKey="presentCount" position="right" style={{ fontSize: 10, fill: __tc.mutedText }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}

// ── Late Arrivals Today ───────────────────────────────────────────────────────
export function DayDeptLateChart({
  data, onDeptClick, allRecords, graceMinutes = 10, shiftStartMinutes, shiftEndMinutes,
  date, onPrevDay, onNextDay, canGoPrev, canGoNext,
}: {
  data: DayDeptSnapshot[];
  onDeptClick?: (dept: string) => void;
  allRecords?: AttendanceRecord[];
  graceMinutes?: number;
  shiftStartMinutes?: number;
  shiftEndMinutes?: number;
} & DayNavProps) {
  const __tc = useThemeColors();
  const [drillDept, setDrillDept] = useState<string | null>(null);

  const singleDept = data.length === 1 ? data[0].department : null;
  const activeDept = singleDept ?? drillDept;

  if (activeDept && allRecords) {
    const lateRecords = allRecords.filter(r =>
      r.department === activeDept && isPresent(r.status) && !r.isShortDay && getLateMinutes(r, graceMinutes, shiftStartMinutes) > 0
    );
    return (
      <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[260px]">
        <div className="flex items-center flex-wrap gap-2 mb-3">
          {!singleDept && (
            <button onClick={() => setDrillDept(null)} className="flex items-center gap-1 text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-xs font-medium">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          )}
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">{activeDept} — Late Arrivals</h3>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[var(--text-muted)] text-xs">{lateRecords.length} late</span>
            <DayNav date={date} onPrevDay={onPrevDay} onNextDay={onNextDay} canGoPrev={canGoPrev} canGoNext={canGoNext} />
          </div>
        </div>
        {lateRecords.length === 0
          ? <div className="h-40 flex items-center justify-center text-[var(--text-muted)] text-sm">No late arrivals in this team today 🎉</div>
          : (
            <div className="space-y-1 max-h-[240px] overflow-y-auto">
              {[...lateRecords].sort((a, b) => getLateMinutes(b, graceMinutes, shiftStartMinutes) - getLateMinutes(a, graceMinutes, shiftStartMinutes)).map(r => (
                <div key={r.employeeCode} className="flex items-center justify-between py-2 px-3 rounded-lg bg-amber-500/10">
                  <span className="text-[var(--text-primary)] text-xs font-medium truncate max-w-[140px]">{r.employeeName || r.employeeCode}</span>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--text-muted)] font-mono">{r.inTime}</span>
                    <span className="bg-amber-500/20 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded text-[10px]">+{getLateMinutes(r, graceMinutes, shiftStartMinutes)}m late</span>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    );
  }

  const sorted = [...data].filter(d => d.lateCount > 0).sort((a, b) => b.lateCount - a.lateCount);
  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[260px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">Dept Late Arrivals Today</h3>
          <p className="text-[var(--text-muted)] text-xs mt-0.5 mb-3">Click a bar to see late employees in that team</p>
        </div>
        <DayNav date={date} onPrevDay={onPrevDay} onNextDay={onNextDay} canGoPrev={canGoPrev} canGoNext={canGoNext} />
        <InfoTooltip title="Dept Late Arrivals Today" description="Count of employees per department who punched in after shift start + grace period today." />
      </div>
      {sorted.length === 0
        ? <div className="h-40 flex items-center justify-center text-[var(--text-muted)] text-sm">No late arrivals today 🎉</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 40)}>
            <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 36, left: 4, bottom: 4 }}
              onClick={(entry: any) => {
                const dept = getDepartmentFromClick(entry);
                if (dept) { setDrillDept(dept); onDeptClick?.(dept); }
              }}>
              <CartesianGrid strokeDasharray="3 3" stroke={__tc.border} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: __tc.mutedText }} allowDecimals={false} />
              <YAxis type="category" dataKey="department" tick={{ fontSize: 10, fill: __tc.mutedText }} width={100} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const d: DayDeptSnapshot = payload[0]?.payload;
                return (
                  <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-[var(--text-primary)] font-medium mb-1">{label}</p>
                    <p className="text-amber-400">Late: <strong>{d.lateCount}</strong> of {d.presentCount} present</p>
                    <p className="text-[var(--text-muted)] text-[10px] mt-1">Click to see who was late →</p>
                  </div>
                );
              }} />
              <Bar dataKey="lateCount" name="Late" radius={[0, 4, 4, 0]} fill="#fbbf24" cursor="pointer" isAnimationActive={false}>
                <LabelList dataKey="lateCount" position="right" style={{ fontSize: 10, fill: __tc.mutedText }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}

// ── Productivity Lost Today ───────────────────────────────────────────────────
export function DayDeptProductivityChart({
  data, onDeptClick, allRecords, shiftStartMinutes, shiftEndMinutes,
  date, onPrevDay, onNextDay, canGoPrev, canGoNext,
}: {
  data: DayDeptSnapshot[];
  onDeptClick?: (dept: string) => void;
  allRecords?: AttendanceRecord[];
  shiftStartMinutes?: number;
  shiftEndMinutes?: number;
} & DayNavProps) {
  const __tc = useThemeColors();
  const [drillDept, setDrillDept] = useState<string | null>(null);

  const singleDept = data.length === 1 ? data[0].department : null;
  const activeDept = singleDept ?? drillDept;

  if (activeDept && allRecords) {
    const empData = allRecords
      .filter(r => r.department === activeDept && isPresent(r.status) && !r.isShortDay)
      .map(r => ({ r, lostM: computeProductivityLostMinutes(r, shiftStartMinutes, shiftEndMinutes) }))
      .sort((a, b) => b.lostM - a.lostM);

    return (
      <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[260px]">
        <div className="flex items-center flex-wrap gap-2 mb-3">
          {!singleDept && (
            <button onClick={() => setDrillDept(null)} className="flex items-center gap-1 text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-xs font-medium">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          )}
          <h3 className="text-white font-semibold text-sm">{activeDept} — Productivity Lost</h3>
          <span className="text-slate-500 text-xs ml-auto">
            {minutesToHHMM(empData.reduce((s, e) => s + e.lostM, 0))} total lost
          </span>
        </div>
        {empData.length === 0
          ? <div className="h-40 flex items-center justify-center text-[var(--text-muted)] text-sm">No productivity loss in this team today 🎉</div>
          : (
            <div className="space-y-1 max-h-[240px] overflow-y-auto">
              {empData.map(({ r, lostM }) => (
                <div key={r.employeeCode} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--bg-elevated)]/40 hover:bg-[var(--bg-elevated)]/60 transition-colors">
                  <span className="text-[var(--text-primary)] text-xs font-medium truncate max-w-[140px]">{r.employeeName || r.employeeCode}</span>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--text-muted)] font-mono">{r.inTime} → {r.outTime}</span>
                    {lostM > 0
                      ? <span className={`px-1.5 py-0.5 rounded text-[10px] ${lostM > 120 ? 'bg-red-500/20 text-red-300' : lostM > 60 ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-600/50 text-slate-400'}`}>
                          −{minutesToHHMM(lostM)} lost
                        </span>
                      : <span className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded text-[10px]">Full day ✓</span>
                    }
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    );
  }

  const sorted = [...data].filter(d => d.hoursLost > 0).sort((a, b) => b.hoursLost - a.hoursLost);
  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[260px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">Dept Productivity Lost Today</h3>
          <p className="text-[var(--text-muted)] text-xs mt-0.5 mb-3">Hours short of 8h effective work · click to see employees</p>
        </div>
        <DayNav date={date} onPrevDay={onPrevDay} onNextDay={onNextDay} canGoPrev={canGoPrev} canGoNext={canGoNext} />
        <InfoTooltip title="Dept Productivity Lost Today" description="Total hours each department fell short of 8h effective work today. Coming late but staying to compensate = no loss." formula="Σ max(0, 8h − (duration − 1h lunch))" />
      </div>
      {sorted.length === 0
        ? <div className="h-40 flex items-center justify-center text-[var(--text-muted)] text-sm">No productivity loss today 🎉</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 40)}>
            <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 50, left: 4, bottom: 4 }}
              onClick={(entry: any) => {
                const dept = getDepartmentFromClick(entry);
                if (dept) { setDrillDept(dept); onDeptClick?.(dept); }
              }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(v: number) => minutesToHHMM(Math.round(v * 60))} />
              <YAxis type="category" dataKey="department" tick={{ fontSize: 10, fill: '#94a3b8' }} width={100} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const d: DayDeptSnapshot = payload[0]?.payload;
                return (
                  <div className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-white font-medium mb-1">{label}</p>
                    <p className="text-amber-400">Hours Lost: <strong>{minutesToHHMM(Math.round(d.hoursLost * 60))}</strong></p>
                    <p className="text-slate-400">Late: {d.lateCount} · Early exit: {d.earlyCount}</p>
                    <p className="text-slate-500 text-[10px] mt-1">Click to see employees →</p>
                  </div>
                );
              }} />
              <Bar dataKey="hoursLost" name="Hours Lost" radius={[0, 4, 4, 0]} cursor="pointer" isAnimationActive={false}>
                {sorted.map((entry, i) => (
                  <Cell key={i} fill={entry.hoursLost > 5 ? '#f87171' : entry.hoursLost > 2 ? '#fbbf24' : '#fb923c'} />
                ))}
                <LabelList dataKey="hoursLost" position="right" style={{ fontSize: 10, fill: '#94a3b8' }} formatter={(v: any) => minutesToHHMM(Math.round(Number(v) * 60))} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}