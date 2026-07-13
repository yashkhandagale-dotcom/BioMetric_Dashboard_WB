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
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { DailyTrend, DeptAttendance, HoursDistribution, AttendanceRecord, DayDeptSnapshot, Holiday, OfficeAttendance } from '@/lib/types';
import { durationToMinutes, minutesToHHMM } from '@/lib/parseCSV';
import { isPresent, isAbsent, isWeeklyOff, SHIFT_MINUTES, computeLateMinutes, computeEarlyMinutes, getLateMinutes, getEarlyMinutes, computeProductivityLostMinutes } from '@/lib/useDashboardData';
import { isHoliday } from '@/lib/holidays';
import InfoTooltip from './InfoTooltip';

function rateColor(rate: number): string {
  if (rate >= 80) return '#34d399';
  if (rate >= 70) return '#fbbf24';
  return '#f87171';
}

function ChartSubtitle({ selectedDepts }: { selectedDepts?: string[] }) {
  if (!selectedDepts) return null;
  const label = selectedDepts.length === 0 ? 'All Departments' : selectedDepts.join(', ');
  return <p className="text-slate-500 text-xs mt-0.5 mb-3"><span className="text-slate-400">{label}</span></p>;
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
          className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${mode === o.key ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
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
      <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl max-w-[240px]">
        <p className="text-slate-300 font-medium mb-1">{label}</p>
        <p style={{ color: rateColor(rate) }}>Rate: <strong>{rate}%</strong></p>
        <p className="text-blue-400">Present: {present} / {total}</p>
        {entry?.lateCount > 0 && <p className="text-amber-400">Late: {entry.lateCount}</p>}
        {entry?.shortDayCount > 0 && <p className="text-orange-400">Short Days: {entry.shortDayCount}</p>}
        {absentees.length > 0 && (
          <>
            <div className="border-t border-slate-700 my-1.5" />
            <p className="text-red-400 mb-1">Absent ({absentees.length}):</p>
            {shown.map((n, i) => <p key={i} className="text-slate-400 truncate">{n}</p>)}
            {extra > 0 && <p className="text-slate-500 text-[10px] mt-1">+{extra} more — double-click the point to see all</p>}
          </>
        )}
      </div>
    );
  };

 function handleChartClick(e: any) {
  console.log("CLICK", e);

  const index = Number(e?.activeTooltipIndex);

  if (Number.isNaN(index) || index < 0 || index >= data.length) {
    console.log("Invalid index");
    return;
  }

  const payload = data[index];

  console.log("Payload:", payload);

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

    console.log("Opening modal", absentees.length);

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
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[280px]">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-white font-semibold text-sm">Daily Attendance Trend</h3>
            <ChartSubtitle selectedDepts={selectedDepts} />
          </div>
          <InfoTooltip title="Daily Attendance Trend" description="Daily attendance rate = present employees ÷ scheduled employees for that day. Holidays excluded. Double-click a date point to see the full absentee list for that day." formula="Present ÷ (Scheduled - WeeklyOff - Holidays) × 100" />
        </div>
        {data.length === 0
          ? <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No data</div>
          : (
            <>
              {selectedDate && (
                <p className="text-blue-400 text-xs mb-2 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                  Showing: {selectedDate.slice(5)} · click another point to switch, click same to clear
                </p>
              )}
              <p className="text-slate-600 text-[10px] mb-1">Hover a point to see absentees · double-click to see the full absentee list</p>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={data}
                  margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
                  onClick={handleChartClick}
                  style={{ cursor: onDateClick ? 'pointer' : 'default' }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} unit="%" />
                  <ReferenceLine y={80} stroke="#34d399" strokeDasharray="4 2" strokeOpacity={0.6} />
                  <ReferenceLine y={70} stroke="#fbbf24" strokeDasharray="4 2" strokeOpacity={0.6} />
                  {selectedDate && (
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
                      const isSelected = selectedDate && props.payload.rawDate === selectedDate;
                      const color = rateColor(rate);
                      return <circle key={props.index} cx={props.cx} cy={props.cy}
                        r={isSelected ? 5 : 3} fill={color} stroke={isSelected ? '#fff' : 'none'} strokeWidth={isSelected ? 2 : 0} />;
                    }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
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
            className="bg-slate-800 border border-slate-600 rounded-xl p-5 max-w-md w-full max-h-[80vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-white font-semibold text-sm">Absent on {absentModal.date}</h3>
                <p className="text-slate-400 text-xs mt-0.5">{absentModal.names.length} employees absent</p>
              </div>
              <button
                onClick={() => setAbsentModal(null)}
                className="text-slate-400 hover:text-white text-lg leading-none transition-colors"
              >✕</button>
            </div>
            <div className="space-y-0.5">
              {[...absentModal.names].sort().map((name, i) => (
                <div key={i} className="flex items-center gap-2 py-2 border-b border-slate-700/40 last:border-0">
                  <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                  <span className="text-slate-300 text-sm">{name}</span>
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
  const depts = selectedDepts.slice(0, 5);

  const { chartData, dates } = useMemo(() => {
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
    return { chartData: data, dates: sortedDates };
  }, [records, depts, holidays]);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[280px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Daily Attendance Trend — Comparison</h3>
          <p className="text-slate-500 text-xs mt-0.5 mb-3">
            {depts.length < selectedDepts.length
              ? `Showing first ${depts.length} of ${selectedDepts.length} selected departments`
              : 'One line per selected department'}
          </p>
        </div>
        <InfoTooltip title="Daily Attendance Trend — Comparison" description="Daily attendance rate per department, so you can compare trends side by side. Holidays excluded." formula="Present ÷ (Scheduled - WeeklyOff - Holidays) × 100, per department" />
      </div>
      {chartData.length === 0 || dates.length === 0
        ? <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No data</div>
        : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} unit="%" />
              <Tooltip
                content={({ active, payload, label }: any) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                      <p className="text-slate-300 font-medium mb-1">{label}</p>
                      {payload.map((p: any) => (
                        <p key={p.dataKey} style={{ color: p.color }}>{p.dataKey}: <strong>{p.value}%</strong></p>
                      ))}
                    </div>
                  );
                }}
                wrapperStyle={{ pointerEvents: 'none', zIndex: 50 }}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={(v: string) => <span style={{ color: '#94a3b8' }}>{v}</span>} />
              {depts.map((dept, i) => (
                <Line key={dept} type="monotone" dataKey={dept} name={dept}
                  stroke={COMPARISON_LINE_COLORS[i % COMPARISON_LINE_COLORS.length]}
                  strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
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

  if (drillDept) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
        <div className="flex items-center flex-wrap gap-3 mb-1">
          <button onClick={handleBack} className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-xs font-medium transition-colors shrink-0">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <h3 className="text-white font-semibold text-sm">{drillDept} — Employee Attendance</h3>
        </div>
        <div className="mb-3">
          <SortToggle mode={sortMode} onChange={setSortMode} />
        </div>
        <p className="text-slate-500 text-xs mb-4">{drillData.length} employees</p>
        <ResponsiveContainer width="100%" height={Math.max(280, drillData.length * 36)}>
          <BarChart data={drillData} layout="vertical" margin={{ top: 4, right: 55, left: 4, bottom: 4 }} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={135} tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickFormatter={(v: string) => v.length > 19 ? v.slice(0, 18) + '…' : v} />
            <Tooltip content={({ active, payload, label }: any) => {
              if (!active || !payload?.length) return null;
              const present = payload.find((p: any) => p.dataKey === 'present')?.value ?? 0;
              const absent = payload.find((p: any) => p.dataKey === 'absent')?.value ?? 0;
              const total = present + absent;
              const rate = total > 0 ? ((present / total) * 100).toFixed(1) : '0';
              return (
                <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                  <p className="text-slate-300 font-semibold mb-1.5">{label}</p>
                  <p className="text-emerald-400">Present: <strong>{present}d</strong></p>
                  <p className="text-red-400">Absent: <strong>{absent}d</strong></p>
                  <p className="text-slate-400 mt-1 pt-1 border-t border-slate-700">Rate: <strong style={{ color: rateColor(parseFloat(rate)) }}>{rate}%</strong></p>
                </div>
              );
            }} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={(v: string) => <span style={{ color: '#94a3b8' }}>{v}</span>} />
            <Bar dataKey="present" name="Present" stackId="a" fill="#34d399">
              <LabelList dataKey="present" position="insideRight" style={{ fontSize: 9, fill: '#064e3b' }} formatter={(v: any) => v > 0 ? v : ''} />
            </Bar>
            <Bar dataKey="absent" name="Absent" stackId="a" fill="#f87171" radius={[0, 3, 3, 0]}>
              <LabelList dataKey="absent" position="right" style={{ fontSize: 9, fill: '#94a3b8' }} formatter={(v: any) => v > 0 ? v : ''} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Department Attendance Ranking</h3>
          <p className="text-slate-500 text-xs mt-0.5 mb-2">Click a bar to drill into that department's employees</p>
        </div>
        <InfoTooltip title="Dept Attendance Ranking" description="Attendance rate per department for the selected period. Click a bar to see employee-level breakdown." formula="Present ÷ Scheduled × 100" />
      </div>
      <div className="mb-3">
        <SortToggle mode={sortMode} onChange={setSortMode} />
      </div>
      {sortedData.length === 0
        ? <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No data</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(200, sortedData.length * 40)}>
            <BarChart data={sortedData} layout="vertical" margin={{ top: 5, right: 50, left: 4, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} unit="%" />
              <YAxis type="category" dataKey="department" width={110} tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <ReferenceLine x={avgRate} stroke="#64748b" strokeDasharray="4 2" />
              <Tooltip content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-slate-300 font-medium mb-1">{label}</p>
                    <p style={{ color: rateColor(payload[0]?.value) }}>Rate: <strong>{payload[0]?.value}%</strong></p>
                    <p className="text-slate-500 text-[10px] mt-1">Click to drill into employees</p>
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
                <LabelList dataKey="rate" position="right" style={{ fontSize: 10, fill: '#94a3b8' }}
                  formatter={(v: any) => `${v}%`}
                  content={(props: any) => {
                    const entry = sortedData[props.index];
                    const dimmed = highlightDepts && highlightDepts.length > 0 && entry && !highlightDepts.includes(entry.department);
                    return <text x={props.x + props.width + 4} y={props.y + (props.height ?? 0) / 2} dy={4}
                      fontSize={10} fill={dimmed ? '#475569' : '#94a3b8'}>{props.value}%</text>;
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
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Office-wise Attendance</h3>
          <p className="text-slate-500 text-xs mt-0.5 mb-2">Attendance rate comparison across offices</p>
        </div>
        <InfoTooltip title="Office-wise Attendance" description="Attendance rate per office for the selected period, so HR can compare performance across locations." formula="Present ÷ Scheduled × 100" />
      </div>
      <div className="mb-3">
        <SortToggle mode={sortMode} onChange={setSortMode} />
      </div>
      {sortedData.length === 0
        ? <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No data</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(200, sortedData.length * 44)}>
            <BarChart data={sortedData} layout="vertical" margin={{ top: 5, right: 50, left: 4, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} unit="%" />
              <YAxis type="category" dataKey="office" width={110} tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <ReferenceLine x={avgRate} stroke="#64748b" strokeDasharray="4 2" />
              <Tooltip content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const entry = payload[0]?.payload;
                return (
                  <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-slate-300 font-medium mb-1">{label}</p>
                    <p style={{ color: rateColor(entry?.rate) }}>Rate: <strong>{entry?.rate}%</strong></p>
                    <p className="text-slate-400 mt-1">{entry?.presentCount} present / {entry?.scheduledCount} scheduled</p>
                    {onOfficeClick && <p className="text-slate-500 text-[10px] mt-1">Click to filter by this office</p>}
                  </div>
                );
              }} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="rate" cursor={onOfficeClick ? 'pointer' : 'default'} radius={[0, 4, 4, 0]}
                onClick={(entry: any) => {
                  const office = entry?.office ?? entry?.payload?.office ?? entry?.activePayload?.[0]?.payload?.office;
                  if (office && onOfficeClick) onOfficeClick(office);
                }}>
                {sortedData.map((entry, i) => <Cell key={i} fill={rateColor(entry.rate)} />)}
                <LabelList dataKey="rate" position="right" style={{ fontSize: 10, fill: '#94a3b8' }} formatter={(v: any) => `${v}%`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}

// ── Productivity Lost by Dept ─────────────────────────────────────────────────
export function DeptProductivityChart({
  data, allRecords, selectedDepts, highlightDepts, externalDrillDept, onDrillBack, onDeptDrillChange, onDeptClick
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
}) {
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
    const map = new Map<string, { name: string; code: string; lostMins: number; presentDays: number; effectiveHours: number }>();
    for (const r of safeRecords) {
      if (r.department !== drillDept || isWeeklyOff(r.status) || !isPresent(r.status) || r.isShortDay) continue;
      if (!map.has(r.employeeCode)) map.set(r.employeeCode, { name: r.employeeName || r.employeeCode, code: r.employeeCode, lostMins: 0, presentDays: 0, effectiveHours: 0 });
      const e = map.get(r.employeeCode)!;
      e.presentDays++;
      e.lostMins += computeProductivityLostMinutes(r);
      const raw = durationToMinutes(r.duration);
      e.effectiveHours += raw > 60 ? (raw - 60) / 60 : 0;
    }
    const rows = Array.from(map.values()).map(e => ({
      ...e,
      daysLost: +(e.lostMins / SHIFT_MINUTES).toFixed(2),
      avgEffectiveHours: e.presentDays > 0 ? +(e.effectiveHours / e.presentDays).toFixed(2) : 0,
    }));
    if (sortMode === 'az') return rows.sort((a, b) => a.name.localeCompare(b.name));
    if (sortMode === 'best') return rows.sort((a, b) => a.daysLost - b.daysLost || a.name.localeCompare(b.name));
    return rows.sort((a, b) => b.daysLost - a.daysLost || a.name.localeCompare(b.name)); // 'worst' and default
  }, [drillDept, safeRecords, sortMode]);

  if (drillDept) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[280px]">
        <div className="flex items-center flex-wrap gap-3 mb-1">
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-xs font-medium transition-colors shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <h3 className="text-white font-semibold text-sm">{drillDept} — Productivity Lost per Employee</h3>
        </div>
        <div className="mb-3">
          <SortToggle mode={sortMode} onChange={setSortMode} />
        </div>
        <p className="text-slate-500 text-xs mb-4">{drillData.length} employees · based on hours short of 8h effective work</p>
        {drillData.length === 0
          ? <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No present-day records found for this department</div>
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
                      <p className="text-blue-400">Avg Effective Hrs: <strong>{e?.avgEffectiveHours}h</strong></p>
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
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[280px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Productivity Lost by Dept</h3>
          <p className="text-slate-500 text-xs mt-0.5 mb-2">Person-days short of 8h effective work · click a bar to see employees</p>
        </div>
        <InfoTooltip title="Dept Productivity Lost" description="Total person-days each department fell short of the 8h effective shift. Accounts for late arrivals AND early exits. Coming late but compensating with late exit = no loss." formula="Σ max(0, 8h - (duration - 1h lunch)) ÷ 480" />
      </div>
      <div className="mb-3">
        <SortToggle mode={sortMode} onChange={setSortMode} />
      </div>
      {chartData.length === 0
        ? <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No data</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 40)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 55, left: 4, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} unit="d" />
              <YAxis type="category" dataKey="department" width={110} tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-slate-300 font-medium mb-1">{label}</p>
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
                <LabelList dataKey="daysLost" position="right" style={{ fontSize: 10, fill: '#94a3b8' }} formatter={(v: any) => `${v}d`} />
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
  const [drillBin, setDrillBin] = useState<string | null>(null);

  const bins = useMemo(() => {
    const binMap = new Map<string, number>();
    for (let h = 0; h <= 12; h++) {
      for (const m of [0, 30]) {
        const label = `${h}:${m === 0 ? '00' : m}`;
        binMap.set(label, 0);
      }
    }
    for (const r of allRecords) {
      if (!isPresent(r.status) || r.isShortDay) continue;
      const raw = durationToMinutes(r.duration);
      if (raw <= 60) continue;
      const effective = raw - 60; // subtract lunch
      if (effective <= 0 || effective > 720) continue;
      const binH = Math.floor(effective / 30) * 30;
      const label = `${Math.floor(binH / 60)}:${binH % 60 === 0 ? '00' : '30'}`;
      binMap.set(label, (binMap.get(label) || 0) + 1);
    }
    return Array.from(binMap.entries())
      .map(([bin, count]) => ({ bin, count }))
      .filter(b => b.count > 0);
  }, [allRecords]);

  // Drill: employees in the clicked bin
  const drillEmployees = useMemo(() => {
    if (!drillBin) return [];
    const [hStr, mStr] = drillBin.split(':');
    const binStart = parseInt(hStr) * 60 + parseInt(mStr);
    const binEnd = binStart + 30;

    const map = new Map<string, { name: string; code: string; dept: string; effectiveMins: number; records: number }>();
    for (const r of allRecords) {
      if (!isPresent(r.status) || r.isShortDay) continue;
      const raw = durationToMinutes(r.duration);
      if (raw <= 60) continue;
      const effective = raw - 60;
      if (effective < binStart || effective >= binEnd) continue;
      if (!map.has(r.employeeCode)) map.set(r.employeeCode, { name: r.employeeName || r.employeeCode, code: r.employeeCode, dept: r.department || 'Unknown', effectiveMins: 0, records: 0 });
      const e = map.get(r.employeeCode)!;
      e.effectiveMins += effective;
      e.records++;
    }
    return Array.from(map.values())
      .map(e => ({ ...e, avgHours: e.records > 0 ? +(e.effectiveMins / e.records / 60).toFixed(2) : 0 }))
      .sort((a, b) => a.avgHours - b.avgHours);
  }, [drillBin, allRecords]);

  if (drillBin) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[280px]">
        <div className="flex items-center flex-wrap gap-3 mb-1">
          <button onClick={() => setDrillBin(null)} className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-xs font-medium transition-colors shrink-0">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <h3 className="text-white font-semibold text-sm">Employees: {drillBin}h–{drillBin.split(':')[0]}:{ parseInt(drillBin.split(':')[1]) === 0 ? '30' : '00'} effective work</h3>
        </div>
        <p className="text-slate-500 text-xs mb-4">{drillEmployees.length} employees in this range</p>
        {drillEmployees.length === 0
          ? <div className="h-40 flex items-center justify-center text-slate-500 text-sm">No data</div>
          : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {drillEmployees.map((e, i) => (
                <div key={e.code} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-700/30 hover:bg-slate-700/50">
                  <div>
                    <span className="text-white text-xs font-medium">{e.name}</span>
                    <span className="text-slate-500 text-xs ml-2">· {e.dept}</span>
                  </div>
                  <span className="text-blue-400 text-xs font-mono">{e.avgHours}h avg</span>
                </div>
              ))}
            </div>
          )}
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[280px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Working Hours Distribution</h3>
          <ChartSubtitle selectedDepts={selectedDepts} />
        </div>
        <InfoTooltip title="Hours Distribution" description="Distribution of daily effective working hours (total duration − 1h lunch) across all present employees. Click a bar to see which employees fall in that range." formula="Effective = Duration − 60 min lunch · Bin = 30 minutes" />
      </div>
      {bins.length === 0
        ? <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No data</div>
        : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={bins} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="bin" tick={{ fontSize: 10, fill: '#64748b' }} interval={1} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
              <ReferenceLine x="8:00" stroke="#34d399" strokeDasharray="4 2" />
              <Tooltip content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-slate-300 font-medium">{label}h effective range</p>
                    <p className="text-blue-400">Count: <strong>{payload[0]?.value} employee-days</strong></p>
                    <p className="text-slate-500 text-[10px] mt-1">Click to see employees</p>
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
export function PersonalHeatmap({ records }: { records: AttendanceRecord[] }) {
  const [tooltip, setTooltip] = useState<{ r: AttendanceRecord; x: number; y: number } | null>(null);
  const sorted = useMemo(() => [...records].sort((a, b) => a.date.localeCompare(b.date)), [records]);

  if (sorted.length === 0) return null;

  return (
    <div>
      <div className="flex flex-wrap gap-0.5">
        {sorted.map((r) => {
          const status = getCellStatus(r);
          const color = STATUS_COLORS_CELL[status] || '#334155';
          return (
            <div
              key={r.date}
              className="w-4 h-4 rounded-sm cursor-pointer hover:ring-1 hover:ring-white/40 transition-all"
              style={{ backgroundColor: color + '90' }}
              onMouseEnter={(e) => setTooltip({ r, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setTooltip(null)}
              title={`${r.date} — ${r.status}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-2">
        {Object.entries({ present: 'Present', late: 'Late', earlyexit: 'Early Exit', absent: 'Absent', shortday: 'Short Day', weeklyoff: 'Weekly Off', holiday: 'Holiday' }).map(([k, label]) => (
          <div key={k} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: STATUS_COLORS_CELL[k] + '90' }} />
            <span className="text-slate-500 text-[9px]">{label}</span>
          </div>
        ))}
      </div>
      {tooltip && (
        <div
          className="fixed z-50 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-2xl pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 20 }}
        >
          <p className="text-white font-medium">{tooltip.r.date}</p>
          <p className="text-slate-300">In: {tooltip.r.inTime || '—'} · Out: {tooltip.r.outTime || '—'}</p>
          <p className="text-slate-400">{tooltip.r.status}</p>
        </div>
      )}
    </div>
  );
}

export const STATUS_COLORS_CELL: Record<string, string> = {
  present: '#34d399',
  late: '#fbbf24',
  earlyexit: '#60a5fa',
  absent: '#f87171',
  missed_punch_out: '#d97706',
  weeklyoff: '#334155',
  shortday: '#f97316',
  holiday: '#a78bfa',
};

export function getCellStatus(r: AttendanceRecord): string {
  if (r.isShortDay) return 'shortday';
  const s = r.status.toLowerCase();
  if (s.includes('weeklyoff')) return 'weeklyoff';
  if (s.includes('absent')) return 'absent';
  if (s.includes('present')) {
    if (computeLateMinutes(r.inTime) > 0) return 'late';
    if (computeEarlyMinutes(r.outTime) > 0) return 'earlyexit';
    return 'present';
  }
  return 'absent';
}

export function AttendanceHeatmap({ records, onCellClick }: {
  records: AttendanceRecord[];
  onCellClick?: (emp: string, date: string) => void;
}) {
  const [tooltip, setTooltip] = useState<{ r: AttendanceRecord; x: number; y: number } | null>(null);
  const [expandedHeatmap, setExpandedHeatmap] = useState(false);

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

  if (records.length === 0) return null;

  const visibleDates = dates.slice(0, 31);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-white font-semibold text-sm">Attendance Heatmap</h3>
          <p className="text-slate-500 text-xs mt-0.5">{employees.length} employees · {visibleDates.length} days — click any cell for details</p>
        </div>
        <InfoTooltip title="Attendance Heatmap" description="Each cell = one employee on one day. Colors show attendance status. Click any cell to see details." />
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: visibleDates.length * 22 + 160 }}>
          <div className="flex gap-0.5 mb-1 ml-[152px]">
            {visibleDates.map(d => (
              <div key={d} className="w-5 text-[8px] text-slate-600 text-center flex-shrink-0">{d.slice(8)}</div>
            ))}
          </div>
          {(expandedHeatmap ? employees : employees.slice(0, 15)).map(emp => (
            <div key={emp.code} className="flex items-center gap-0.5 mb-0.5">
              <div className="w-36 text-[10px] text-slate-400 truncate flex-shrink-0 text-right pr-2" title={emp.name}>
                {emp.name.length > 16 ? emp.name.slice(0, 15) + '…' : emp.name}
              </div>
              {visibleDates.map(date => {
                const r = cellMap.get(`${emp.code}_${date}`);
                const status = r ? getCellStatus(r) : 'absent';
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

      {/* Expand/Collapse Button */}
{employees.length > 10 && (
  <div className="flex justify-center mt-3">
    <button
      onClick={() => setExpandedHeatmap(!expandedHeatmap)}
      className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors"
    >
      {expandedHeatmap ? (
        <>
          <ChevronUp className="w-4 h-4" />
          Collapse Heatmap
        </>
      ) : (
        <>
          <ChevronDown className="w-4 h-4" />
          Show Full Heatmap ({employees.length})
        </>
      )}
    </button>
  </div>
)}

      <div className="flex flex-wrap gap-3 mt-3">
        {Object.entries({ present: 'Present', late: 'Late', earlyexit: 'Early Exit', absent: 'Absent', shortday: 'Short Day', weeklyoff: 'Weekly Off', holiday: 'Holiday' }).map(([k, label]) => (
          <div key={k} className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: STATUS_COLORS_CELL[k] + '90' }} />
            <span className="text-slate-500 text-[10px]">{label}</span>
          </div>
        ))}
      </div>

      {tooltip && (
        <div
          className="fixed z-50 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-2xl pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 20 }}
        >
          <p className="text-white font-medium">{tooltip.r.employeeName}</p>
          <p className="text-slate-400">{tooltip.r.date}</p>
          <p className="text-slate-300">In: {tooltip.r.inTime || '—'} · Out: {tooltip.r.outTime || '—'}</p>
          <p className="text-slate-400">{tooltip.r.status}</p>
        </div>
      )}
    </div>
  );
}

// ── SINGLE DAY VIEW CHARTS ────────────────────────────────────────────────────

// Shared drill view for day dept charts — shows all employees in that dept for that day
function DayDeptEmployeeDrill({
  dept, records, onBack
}: { dept: string; records: AttendanceRecord[]; onBack: () => void }) {
  const deptRecords = records.filter(r => r.department === dept);
  const present = deptRecords.filter(r => isPresent(r.status) && !r.isShortDay);
  const absent = deptRecords.filter(r => !isPresent(r.status) && !isWeeklyOff(r.status));

  return (
    <div>
      <div className="flex items-center flex-wrap gap-2 mb-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-xs font-medium">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <h3 className="text-white font-semibold text-sm">{dept} · All Employees</h3>
      </div>
      <div className="space-y-1 max-h-60 overflow-y-auto">
        {present.map(r => (
          <div key={r.employeeCode} className="flex items-center justify-between flex-wrap gap-1 py-1.5 px-3 rounded bg-emerald-500/10">
            <span className="text-white text-xs truncate max-w-[140px]">{r.employeeName || r.employeeCode}</span>
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="text-slate-400">{r.inTime} → {r.outTime}</span>
              {getLateMinutes(r, 10) > 0 && <span className="text-amber-400">Late {getLateMinutes(r, 10)}m</span>}
              {getEarlyMinutes(r, 10) > 0 && <span className="text-blue-400">Early {getEarlyMinutes(r, 10)}m</span>}
              {computeProductivityLostMinutes(r) > 0 && <span className="text-red-400">-{(computeProductivityLostMinutes(r)/60).toFixed(1)}h</span>}
            </div>
          </div>
        ))}
        {absent.map(r => (
          <div key={r.employeeCode} className="flex items-center justify-between py-1.5 px-3 rounded bg-red-500/10">
            <span className="text-white text-xs">{r.employeeName || r.employeeCode}</span>
            <span className="text-red-400 text-xs">Absent</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Employee row used inside single-day team drill ───────────────────────────
function EmployeeAttendanceRow({ r }: { r: AttendanceRecord }) {
  const lateM = getLateMinutes(r, 10);
  const earlyM = getEarlyMinutes(r, 10);
  const lostM = computeProductivityLostMinutes(r);
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors">
      <span className="text-white text-xs font-medium truncate max-w-[140px]">{r.employeeName || r.employeeCode}</span>
      <div className="flex items-center gap-2 text-xs flex-shrink-0">
        <span className="text-slate-400 font-mono">{r.inTime || '—'} → {r.outTime || '—'}</span>
        {lateM > 0 && <span className="bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded text-[10px]">Late {lateM}m</span>}
        {earlyM > 0 && <span className="bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded text-[10px]">Early {earlyM}m</span>}
        {lostM > 0 && <span className="bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded text-[10px]">−{(lostM / 60).toFixed(1)}h</span>}
      </div>
    </div>
  );
}

// ── Attendance Today ──────────────────────────────────────────────────────────
export function DayDeptAttendanceChart({ data, onDeptClick, allRecords }: {
  data: DayDeptSnapshot[];
  onDeptClick?: (dept: string) => void;
  allRecords?: AttendanceRecord[];
}) {
  const [drillDept, setDrillDept] = useState<string | null>(null);

  // If only 1 dept in data (dept filter active), show employees directly
  const singleDept = data.length === 1 ? data[0].department : null;
  const activeDept = singleDept ?? drillDept;

  if (activeDept && allRecords) {
    const deptRecords = allRecords.filter(r => r.department === activeDept);
    const present = deptRecords.filter(r => isPresent(r.status) && !r.isShortDay);
    const absent = deptRecords.filter(r => !isPresent(r.status) && !isWeeklyOff(r.status) && !r.isShortDay);

    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[260px]">
        <div className="flex items-center flex-wrap gap-2 mb-3">
          {!singleDept && (
            <button onClick={() => setDrillDept(null)} className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs font-medium">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          )}
          <h3 className="text-white font-semibold text-sm">{activeDept} — Attendance</h3>
          <span className="text-slate-500 text-xs ml-auto">{present.length} present · {absent.length} absent</span>
        </div>
        <div className="space-y-1 max-h-[240px] overflow-y-auto">
          {present.map(r => <EmployeeAttendanceRow key={r.employeeCode} r={r} />)}
          {absent.map(r => (
            <div key={r.employeeCode} className="flex items-center justify-between py-2 px-3 rounded-lg bg-red-500/10">
              <span className="text-white text-xs font-medium">{r.employeeName || r.employeeCode}</span>
              <span className="text-red-400 text-xs">Absent</span>
            </div>
          ))}
          {present.length === 0 && absent.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-6">No records for this team today</p>
          )}
        </div>
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => b.presentCount - a.presentCount);
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[260px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Dept Attendance Today</h3>
          <p className="text-slate-500 text-xs mt-0.5 mb-3">Click a bar to see all employees in that team</p>
        </div>
        <InfoTooltip title="Dept Attendance Today" description="Present count per department today. Click any bar to see the full employee list with punch times." />
      </div>
      {sorted.length === 0
        ? <div className="h-40 flex items-center justify-center text-slate-500 text-sm">No data for this date</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 40)}>
            <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 36, left: 4, bottom: 4 }}
              onClick={(entry: any) => {
                const dept = getDepartmentFromClick(entry);
                if (dept) { setDrillDept(dept); onDeptClick?.(dept); }
              }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
              <YAxis type="category" dataKey="department" tick={{ fontSize: 10, fill: '#94a3b8' }} width={100} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const d: DayDeptSnapshot = payload[0]?.payload;
                return (
                  <div className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-white font-medium mb-1">{label}</p>
                    <p className="text-emerald-400">Present: <strong>{d.presentCount}</strong> / {d.scheduledCount}</p>
                    <p className="text-red-400">Absent: {d.absentCount}</p>
                    <p className="text-amber-400">Late: {d.lateCount}</p>
                    <p className="text-slate-500 text-[10px] mt-1">Click to see all employees →</p>
                  </div>
                );
              }} />
              <Bar dataKey="presentCount" name="Present" radius={[0, 4, 4, 0]} cursor="pointer" isAnimationActive={false}>
                {sorted.map((entry, i) => (
                  <Cell key={i} fill={entry.presentCount >= entry.scheduledCount * 0.8 ? '#34d399' : entry.presentCount >= entry.scheduledCount * 0.7 ? '#fbbf24' : '#f87171'} />
                ))}
                <LabelList dataKey="presentCount" position="right" style={{ fontSize: 10, fill: '#94a3b8' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}

// ── Late Arrivals Today ───────────────────────────────────────────────────────
export function DayDeptLateChart({ data, onDeptClick, allRecords }: {
  data: DayDeptSnapshot[];
  onDeptClick?: (dept: string) => void;
  allRecords?: AttendanceRecord[];
}) {
  const [drillDept, setDrillDept] = useState<string | null>(null);

  const singleDept = data.length === 1 ? data[0].department : null;
  const activeDept = singleDept ?? drillDept;

  if (activeDept && allRecords) {
    const lateRecords = allRecords.filter(r =>
      r.department === activeDept && isPresent(r.status) && !r.isShortDay && getLateMinutes(r, 10) > 0
    );
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[260px]">
        <div className="flex items-center flex-wrap gap-2 mb-3">
          {!singleDept && (
            <button onClick={() => setDrillDept(null)} className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs font-medium">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          )}
          <h3 className="text-white font-semibold text-sm">{activeDept} — Late Arrivals</h3>
          <span className="text-slate-500 text-xs ml-auto">{lateRecords.length} late</span>
        </div>
        {lateRecords.length === 0
          ? <div className="h-40 flex items-center justify-center text-slate-500 text-sm">No late arrivals in this team today 🎉</div>
          : (
            <div className="space-y-1 max-h-[240px] overflow-y-auto">
              {[...lateRecords].sort((a, b) => getLateMinutes(b, 10) - getLateMinutes(a, 10)).map(r => (
                <div key={r.employeeCode} className="flex items-center justify-between py-2 px-3 rounded-lg bg-amber-500/10">
                  <span className="text-white text-xs font-medium truncate max-w-[140px]">{r.employeeName || r.employeeCode}</span>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400 font-mono">{r.inTime}</span>
                    <span className="bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded text-[10px]">+{getLateMinutes(r, 10)}m late</span>
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
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[260px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Dept Late Arrivals Today</h3>
          <p className="text-slate-500 text-xs mt-0.5 mb-3">Click a bar to see late employees in that team</p>
        </div>
        <InfoTooltip title="Dept Late Arrivals Today" description="Count of employees per department who punched in after shift start + grace period today." />
      </div>
      {sorted.length === 0
        ? <div className="h-40 flex items-center justify-center text-slate-500 text-sm">No late arrivals today 🎉</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 40)}>
            <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 36, left: 4, bottom: 4 }}
              onClick={(entry: any) => {
                const dept = getDepartmentFromClick(entry);
                if (dept) { setDrillDept(dept); onDeptClick?.(dept); }
              }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
              <YAxis type="category" dataKey="department" tick={{ fontSize: 10, fill: '#94a3b8' }} width={100} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const d: DayDeptSnapshot = payload[0]?.payload;
                return (
                  <div className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-white font-medium mb-1">{label}</p>
                    <p className="text-amber-400">Late: <strong>{d.lateCount}</strong> of {d.presentCount} present</p>
                    <p className="text-slate-500 text-[10px] mt-1">Click to see who was late →</p>
                  </div>
                );
              }} />
              <Bar dataKey="lateCount" name="Late" radius={[0, 4, 4, 0]} fill="#fbbf24" cursor="pointer" isAnimationActive={false}>
                <LabelList dataKey="lateCount" position="right" style={{ fontSize: 10, fill: '#94a3b8' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}

// ── Productivity Lost Today ───────────────────────────────────────────────────
export function DayDeptProductivityChart({ data, onDeptClick, allRecords }: {
  data: DayDeptSnapshot[];
  onDeptClick?: (dept: string) => void;
  allRecords?: AttendanceRecord[];
}) {
  const [drillDept, setDrillDept] = useState<string | null>(null);

  const singleDept = data.length === 1 ? data[0].department : null;
  const activeDept = singleDept ?? drillDept;

  if (activeDept && allRecords) {
    const empData = allRecords
      .filter(r => r.department === activeDept && isPresent(r.status) && !r.isShortDay)
      .map(r => ({ r, lostM: computeProductivityLostMinutes(r) }))
      .sort((a, b) => b.lostM - a.lostM);

    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[260px]">
        <div className="flex items-center flex-wrap gap-2 mb-3">
          {!singleDept && (
            <button onClick={() => setDrillDept(null)} className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs font-medium">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          )}
          <h3 className="text-white font-semibold text-sm">{activeDept} — Productivity Lost</h3>
          <span className="text-slate-500 text-xs ml-auto">
            {(empData.reduce((s, e) => s + e.lostM, 0) / 60).toFixed(1)}h total lost
          </span>
        </div>
        {empData.length === 0
          ? <div className="h-40 flex items-center justify-center text-slate-500 text-sm">No productivity loss in this team today 🎉</div>
          : (
            <div className="space-y-1 max-h-[240px] overflow-y-auto">
              {empData.map(({ r, lostM }) => (
                <div key={r.employeeCode} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-700/40 hover:bg-slate-700/60 transition-colors">
                  <span className="text-white text-xs font-medium truncate max-w-[140px]">{r.employeeName || r.employeeCode}</span>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400 font-mono">{r.inTime} → {r.outTime}</span>
                    {lostM > 0
                      ? <span className={`px-1.5 py-0.5 rounded text-[10px] ${lostM > 120 ? 'bg-red-500/20 text-red-300' : lostM > 60 ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-600/50 text-slate-400'}`}>
                          −{(lostM / 60).toFixed(1)}h lost
                        </span>
                      : <span className="bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded text-[10px]">Full day ✓</span>
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
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[260px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Dept Productivity Lost Today</h3>
          <p className="text-slate-500 text-xs mt-0.5 mb-3">Hours short of 8h effective work · click to see employees</p>
        </div>
        <InfoTooltip title="Dept Productivity Lost Today" description="Total hours each department fell short of 8h effective work today. Coming late but staying to compensate = no loss." formula="Σ max(0, 8h − (duration − 1h lunch))" />
      </div>
      {sorted.length === 0
        ? <div className="h-40 flex items-center justify-center text-slate-500 text-sm">No productivity loss today 🎉</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 40)}>
            <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 50, left: 4, bottom: 4 }}
              onClick={(entry: any) => {
                const dept = getDepartmentFromClick(entry);
                if (dept) { setDrillDept(dept); onDeptClick?.(dept); }
              }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} unit="h" tickFormatter={(v: number) => v.toFixed(1)} />
              <YAxis type="category" dataKey="department" tick={{ fontSize: 10, fill: '#94a3b8' }} width={100} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const d: DayDeptSnapshot = payload[0]?.payload;
                return (
                  <div className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-white font-medium mb-1">{label}</p>
                    <p className="text-amber-400">Hours Lost: <strong>{d.hoursLost.toFixed(1)}h</strong></p>
                    <p className="text-slate-400">Late: {d.lateCount} · Early exit: {d.earlyCount}</p>
                    <p className="text-slate-500 text-[10px] mt-1">Click to see employees →</p>
                  </div>
                );
              }} />
              <Bar dataKey="hoursLost" name="Hours Lost" radius={[0, 4, 4, 0]} cursor="pointer" isAnimationActive={false}>
                {sorted.map((entry, i) => (
                  <Cell key={i} fill={entry.hoursLost > 5 ? '#f87171' : entry.hoursLost > 2 ? '#fbbf24' : '#fb923c'} />
                ))}
                <LabelList dataKey="hoursLost" position="right" style={{ fontSize: 10, fill: '#94a3b8' }} formatter={(v: any) => `${Number(v).toFixed(1)}h`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}