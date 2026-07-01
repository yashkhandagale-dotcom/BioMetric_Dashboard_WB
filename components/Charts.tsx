'use client';
import { useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, Legend, LabelList, AreaChart, Area, ReferenceLine
} from 'recharts';
import { ArrowLeft } from 'lucide-react';
import { DailyTrend, DeptAttendance, HoursDistribution, AttendanceRecord, DayDeptSnapshot } from '@/lib/types';
import { durationToMinutes, minutesToHHMM } from '@/lib/parseCSV';
import { isPresent, isAbsent, isWeeklyOff, SHIFT_MINUTES, computeLateMinutes, computeEarlyMinutes, getLateMinutes, getEarlyMinutes } from '@/lib/useDashboardData';
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

// ── Daily Attendance Trend ────────────────────────────────────────────────────
export function DailyTrendChart({ data, selectedDepts, onDateClick, selectedDate }: {
  data: DailyTrend[];
  selectedDepts?: string[];
  onDateClick?: (date: string) => void;
  selectedDate?: string | null;
}) {
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
      <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl max-w-[220px]">
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
            {extra > 0 && <p className="text-slate-500 italic">+{extra} more</p>}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[280px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Daily Attendance Trend</h3>
          <ChartSubtitle selectedDepts={selectedDepts} />
        </div>
        <InfoTooltip title="Daily Attendance Trend" description="Daily attendance rate = present employees ÷ scheduled employees for that day. Holidays excluded." formula="Present ÷ (Scheduled - WeeklyOff - Holidays) × 100" position="bottom" />
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
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
              onClick={onDateClick ? (p: any) => { if (p?.activePayload?.[0]) onDateClick(p.activePayload[0].payload.rawDate ?? p.activePayload[0].payload.date); } : undefined}
              style={{ cursor: onDateClick ? 'pointer' : 'default' }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} unit="%" />
              <ReferenceLine y={80} stroke="#34d399" strokeDasharray="4 2" strokeOpacity={0.6} />
              <ReferenceLine y={70} stroke="#fbbf24" strokeDasharray="4 2" strokeOpacity={0.6} />
              {selectedDate && (
                <ReferenceLine x={selectedDate.slice(5)} stroke="#60a5fa" strokeWidth={2} strokeDasharray="4 2" label={{ value: '▼', fill: '#60a5fa', fontSize: 10 }} />
              )}
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone" dataKey="attendanceRate" name="Attendance %" stroke="#60a5fa" strokeWidth={2}
                dot={(props: any) => {
                  const rate = props.payload.attendanceRate;
                  const isSelected = selectedDate && props.payload.rawDate === selectedDate;
                  const color = props.payload.isHoliday ? '#a78bfa' : rateColor(rate);
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
  );
}

// ── Daily Absence Spikes ──────────────────────────────────────────────────────
export function AbsenceSpikeChart({ data, onDateClick, selectedDate }: {
  data: DailyTrend[];
  onDateClick?: (date: string) => void;
  selectedDate?: string | null;
}) {
  const avgAbsent = data.length > 0
    ? data.reduce((s, d) => s + (d.totalCount - d.presentCount), 0) / data.length
    : 0;
  const chartData = data.map(d => ({ ...d, absentCount: d.totalCount - d.presentCount }));

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[280px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Daily Absence Spikes</h3>
          <p className="text-slate-500 text-xs mt-0.5 mb-3">Avg: {avgAbsent.toFixed(1)} absent/day{onDateClick ? ' · click bar to filter' : ''}</p>
        </div>
        <InfoTooltip title="Absence Spikes" description="Number of employees absent per working day. Click a bar to filter the whole dashboard to that day." formula="Absent = Scheduled − Present" position="bottom" />
      </div>
      {data.length === 0
        ? <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No data</div>
        : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
              style={{ cursor: onDateClick ? 'pointer' : 'default' }}
              onClick={onDateClick ? (p: any) => { if (p?.activePayload?.[0]) onDateClick(p.activePayload[0].payload.rawDate ?? p.activePayload[0].payload.date); } : undefined}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
              <ReferenceLine y={avgAbsent} stroke="#64748b" strokeDasharray="4 2" />
              {selectedDate && (
                <ReferenceLine x={selectedDate.slice(5)} stroke="#60a5fa" strokeWidth={2} strokeDasharray="4 2" />
              )}
              <Tooltip
                content={({ active, payload, label }: any) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                      <p className="text-slate-300 font-medium">{label}</p>
                      <p className="text-red-400">Absent: <strong>{payload[0]?.value}</strong></p>
                      {onDateClick && <p className="text-slate-500 mt-1 text-[10px]">Click to filter to this day</p>}
                    </div>
                  );
                }}
              />
              <Bar dataKey="absentCount" cursor="pointer" radius={[3, 3, 0, 0]}>
                {chartData.map((entry, i) => {
                  const isSelected = selectedDate && entry.rawDate === selectedDate;
                  return (
                    <Cell key={i}
                      fill={isSelected ? '#60a5fa' : entry.absentCount > avgAbsent ? '#f87171' : '#475569'}
                      opacity={selectedDate && !isSelected ? 0.4 : 1}
                    />
                  );
                })}
                <LabelList dataKey="absentCount" position="top" style={{ fontSize: 9, fill: '#94a3b8' }} formatter={(v: any) => v > 0 ? v : ''} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}

// ── Productivity Lost Daily Area ──────────────────────────────────────────────
export function ProductivityLostChart({ data, selectedDate, onDateClick }: {
  data: DailyTrend[];
  selectedDate?: string | null;
  onDateClick?: (date: string) => void;
}) {
  const chartData = data.map(d => ({ date: d.date, rawDate: d.rawDate, hoursLost: +(d.hoursLost ?? 0).toFixed(2) }));
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[280px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Productivity Lost Daily</h3>
          <p className="text-slate-500 text-xs mt-0.5 mb-3">Person-hours lost to late/early{onDateClick ? ' · click to filter' : ''}</p>
        </div>
        <InfoTooltip title="Productivity Lost" description="Daily person-hours lost to late arrivals and early exits. Click a point to filter the whole dashboard to that day." formula="(Late + Early exit mins) ÷ 60" position="bottom" />
      </div>
      {data.length === 0
        ? <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No data</div>
        : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
              style={{ cursor: onDateClick ? 'pointer' : 'default' }}
              onClick={onDateClick ? (p: any) => { if (p?.activePayload?.[0]) onDateClick(p.activePayload[0].payload.rawDate ?? p.activePayload[0].payload.date); } : undefined}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} unit="h" />
              {selectedDate && (
                <ReferenceLine x={selectedDate.slice(5)} stroke="#60a5fa" strokeWidth={2} strokeDasharray="4 2" />
              )}
              <Tooltip
                content={({ active, payload, label }: any) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                      <p className="text-slate-300 font-medium">{label}</p>
                      <p className="text-amber-400">Hours Lost: <strong>{payload[0]?.value}h</strong></p>
                      {onDateClick && <p className="text-slate-500 mt-1 text-[10px]">Click to filter to this day</p>}
                    </div>
                  );
                }}
              />
              <Area type="monotone" dataKey="hoursLost" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.15} strokeWidth={2} />
            </AreaChart>
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
  onDeptClick?: (dept: string) => void;
}

export function DeptAttendanceChart({ data, allRecords, selectedDepts, onDeptClick }: DeptAttendanceChartProps) {
  const [manualDrill, setManualDrill] = useState<string | null>(null);
  const drillDept = selectedDepts?.length === 1 ? selectedDepts[0] : manualDrill;
  const isAutoDrill = selectedDepts?.length === 1;

  const avgRate = data.length > 0 ? data.reduce((s, d) => s + d.rate, 0) / data.length : 0;

  const drillData = useMemo(() => {
    if (!drillDept) return [];
    const map = new Map<string, { name: string; code: string; present: number; absent: number }>();
    for (const r of allRecords) {
      if (r.department !== drillDept || isWeeklyOff(r.status)) continue;
      if (!map.has(r.employeeCode)) map.set(r.employeeCode, { name: r.employeeName || r.employeeCode, code: r.employeeCode, present: 0, absent: 0 });
      const row = map.get(r.employeeCode)!;
      if (isPresent(r.status) && !r.isShortDay) row.present++;
      else if (isAbsent(r.status)) row.absent++;
    }
    return Array.from(map.values()).sort((a, b) => {
      const ra = a.present / (a.present + a.absent || 1);
      const rb = b.present / (b.present + b.absent || 1);
      return ra - rb;
    });
  }, [drillDept, allRecords]);

  if (drillDept) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => { setManualDrill(null); if (onDeptClick && selectedDepts?.length === 1) onDeptClick(selectedDepts[0]); }}
            className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-xs font-medium transition-colors shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <h3 className="text-white font-semibold text-sm">{drillDept} — Employee Attendance</h3>
        </div>
        <p className="text-slate-500 text-xs mb-4">{drillData.length} employees · sorted worst → best</p>
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
          <p className="text-slate-500 text-xs mt-0.5 mb-3">Click a bar to drill into that department · <span className="text-blue-400">Back</span> button appears inside</p>
        </div>
        <InfoTooltip title="Dept Attendance Ranking" description="Attendance rate per department for the selected period. Click a bar to filter the dashboard to that department." formula="Present ÷ Scheduled × 100" position="bottom" />
      </div>
      {data.length === 0
        ? <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No data</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(200, data.length * 40)}>
            <BarChart data={data} layout="vertical" margin={{ top: 5, right: 50, left: 4, bottom: 5 }}>
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
                  </div>
                );
              }} />
              <Bar dataKey="rate" cursor="pointer" radius={[0, 4, 4, 0]}
                onClick={(entry: any) => {
                  const dept = getDepartmentFromClick(entry);
                  if (dept) {
                    if (onDeptClick) onDeptClick(dept);
                    else setManualDrill(dept);
                  }
                }}>
                {data.map((entry, i) => <Cell key={i} fill={rateColor(entry.rate)} />)}
                <LabelList dataKey="rate" position="right" style={{ fontSize: 10, fill: '#94a3b8' }} formatter={(v: any) => `${v}%`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}

// ── Productivity Lost by Dept ─────────────────────────────────────────────────
export function DeptProductivityChart({ data, allRecords }: { data: DeptAttendance[]; allRecords?: AttendanceRecord[] }) {
  const [drillDept, setDrillDept] = useState<string | null>(null);
  const safeRecords = allRecords ?? [];

  const chartData = [...data]
    .map(d => ({ department: d.department, daysLost: +(d.productivityLostDays ?? 0).toFixed(2) }))
    .sort((a, b) => b.daysLost - a.daysLost);

  function lostColor(days: number): string {
    if (days > 5) return '#f87171';
    if (days >= 2) return '#fbbf24';
    return '#34d399';
  }

  // Drill: compute per-employee productivity lost for the selected dept
  const drillData = useMemo(() => {
    if (!drillDept || safeRecords.length === 0) return [];
    const map = new Map<string, { name: string; code: string; lostMins: number; presentDays: number }>();
    for (const r of safeRecords) {
      if (r.department !== drillDept || isWeeklyOff(r.status) || !isPresent(r.status) || r.isShortDay) continue;
      if (!map.has(r.employeeCode)) map.set(r.employeeCode, { name: r.employeeName || r.employeeCode, code: r.employeeCode, lostMins: 0, presentDays: 0 });
      const e = map.get(r.employeeCode)!;
      e.presentDays++;
      e.lostMins += getLateMinutes(r, 10) + getEarlyMinutes(r, 10);
    }
    return Array.from(map.values())
      .map(e => ({ ...e, daysLost: +(e.lostMins / SHIFT_MINUTES).toFixed(2) }))
      .sort((a, b) => b.daysLost - a.daysLost || a.name.localeCompare(b.name));
  }, [drillDept, safeRecords]);

  if (drillDept) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[280px]">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => setDrillDept(null)} className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-xs font-medium transition-colors shrink-0">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <h3 className="text-white font-semibold text-sm">{drillDept} — Productivity Lost per Employee</h3>
        </div>
        <p className="text-slate-500 text-xs mb-4">{drillData.length} employees · sorted by productivity lost</p>
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
          <p className="text-slate-500 text-xs mt-0.5 mb-3">Person-days lost per department · <span className="text-blue-400">click a bar</span> to see employees</p>
        </div>
        <InfoTooltip title="Dept Productivity Lost" description="Total person-days lost per department = Σ(late+early minutes) ÷ 480 minutes." formula="Σ(late+early mins) ÷ 480" position="bottom" />
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
                onClick={(entry: any) => setDrillDept(entry.department)}>
                {chartData.map((entry, i) => <Cell key={i} fill={lostColor(entry.daysLost)} />)}
                <LabelList dataKey="daysLost" position="right" style={{ fontSize: 10, fill: '#94a3b8' }} formatter={(v: any) => `${v}d`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}

// ── Hours Distribution ────────────────────────────────────────────────────────
export function HoursDistributionChart({ data, allRecords, selectedDepts }: {
  data: HoursDistribution[];
  allRecords: AttendanceRecord[];
  selectedDepts?: string[];
}) {
  // Bin records into 30-min intervals
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
      const mins = durationToMinutes(r.duration);
      if (mins <= 0 || mins > 720) continue;
      const binH = Math.floor(mins / 30) * 30;
      const label = `${Math.floor(binH / 60)}:${binH % 60 === 0 ? '00' : '30'}`;
      binMap.set(label, (binMap.get(label) || 0) + 1);
    }
    return Array.from(binMap.entries())
      .map(([bin, count]) => ({ bin, count }))
      .filter(b => b.count > 0);
  }, [allRecords]);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[280px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Working Hours Distribution</h3>
          <ChartSubtitle selectedDepts={selectedDepts} />
        </div>
        <InfoTooltip title="Hours Distribution" description="Distribution of daily working hours across all present employees. Bimodal shape reveals two distinct groups." formula="Bin size = 30 minutes" position="bottom" />
      </div>
      {bins.length === 0
        ? <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No data</div>
        : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={bins} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="bin" tick={{ fontSize: 10, fill: '#64748b' }} interval={1} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
              <Tooltip content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-slate-300 font-medium">{label}h range</p>
                    <p className="text-blue-400">Count: <strong>{payload[0]?.value} employee-days</strong></p>
                  </div>
                );
              }} />
              <Bar dataKey="count" fill="#60a5fa" radius={[3, 3, 0, 0]}>
                <ReferenceLine x="8:00" stroke="#34d399" strokeDasharray="4 2" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}

// ── Office-wise Attendance Comparison (A7) ────────────────────────────────────


// ── Per-Employee Heatmap (B6) — relocated into EmployeePanel ─────────────────
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

// ── Attendance Heatmap (full roster — kept for reuse, no longer rendered by default) ──
export const STATUS_COLORS_CELL: Record<string, string> = {
  present: '#34d399',
  late: '#fbbf24',
  earlyexit: '#60a5fa',
  absent: '#f87171',
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
        <InfoTooltip title="Attendance Heatmap" description="Each cell = one employee on one day. Colors show attendance status. Click any cell to see details." position="bottom" />
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: visibleDates.length * 22 + 160 }}>
          {/* Date headers */}
          <div className="flex gap-0.5 mb-1 ml-[152px]">
            {visibleDates.map(d => (
              <div key={d} className="w-5 text-[8px] text-slate-600 text-center flex-shrink-0">
                {d.slice(8)}
              </div>
            ))}
          </div>
          {/* Rows */}
          {employees.slice(0, 80).map(emp => (
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

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3">
        {Object.entries({ present: 'Present', late: 'Late', earlyexit: 'Early Exit', absent: 'Absent', shortday: 'Short Day', weeklyoff: 'Weekly Off', holiday: 'Holiday' }).map(([k, label]) => (
          <div key={k} className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: STATUS_COLORS_CELL[k] + '90' }} />
            <span className="text-slate-500 text-[10px]">{label}</span>
          </div>
        ))}
      </div>

      {/* Tooltip */}
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
// ─────────────────────────────────────────────────────────────────────────────
// SINGLE DAY VIEW CHARTS  (SRS §12.6.2)
// ─────────────────────────────────────────────────────────────────────────────

// Chart 1: Dept Attendance Today — horizontal bar, present count per dept
export function DayDeptAttendanceChart({ data, onDeptClick }: { data: DayDeptSnapshot[]; onDeptClick?: (dept: string) => void }) {
  const sorted = [...data].sort((a, b) => b.presentCount - a.presentCount);
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[260px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Dept Attendance Today</h3>
          <p className="text-slate-500 text-xs mt-0.5 mb-3">Present headcount per department</p>
        </div>
        <InfoTooltip title="Dept Attendance Today" description="Raw count of present employees per department for this day. On a single day, percentages can be misleading for small departments — raw counts are more actionable." position="bottom" />
      </div>
      {sorted.length === 0
        ? <div className="h-40 flex items-center justify-center text-slate-500 text-sm">No data for this date</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 32)}>
            <BarChart
              data={sorted}
              layout="vertical"
              margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
              onClick={(entry: any) => {
                const dept = getDepartmentFromClick(entry);
                if (dept) onDeptClick?.(dept);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
              <YAxis type="category" dataKey="department" tick={{ fontSize: 10, fill: '#94a3b8' }} width={90} />
              <Tooltip
                content={({ active, payload, label }: any) => {
                  if (!active || !payload?.length) return null;
                  const d: DayDeptSnapshot = payload[0]?.payload;
                  return (
                    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                      <p className="text-white font-medium mb-1">{label}</p>
                      <p className="text-emerald-400">Present: <strong>{d.presentCount}</strong> / {d.scheduledCount}</p>
                      <p className="text-red-400">Absent: {d.absentCount}</p>
                      <p className="text-amber-400">Late: {d.lateCount}</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="presentCount" name="Present" radius={[0, 4, 4, 0]} cursor="pointer">
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

// Chart 2: Dept Late Arrivals Today — horizontal bar, late count per dept
export function DayDeptLateChart({ data, onDeptClick }: { data: DayDeptSnapshot[]; onDeptClick?: (dept: string) => void }) {
  const sorted = [...data].filter(d => d.lateCount > 0).sort((a, b) => b.lateCount - a.lateCount);
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[260px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Dept Late Arrivals Today</h3>
          <p className="text-slate-500 text-xs mt-0.5 mb-3">Which department had the most late arrivals?</p>
        </div>
        <InfoTooltip title="Dept Late Arrivals Today" description="Count of employees per department who punched in after shift start + grace period today. Sorted descending so the worst is immediately visible." position="bottom" />
      </div>
      {sorted.length === 0
        ? <div className="h-40 flex items-center justify-center text-slate-500 text-sm">No late arrivals today 🎉</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 36)}>
            <BarChart
              data={sorted}
              layout="vertical"
              margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
              onClick={(entry: any) => {
                const dept = getDepartmentFromClick(entry);
                if (dept) onDeptClick?.(dept);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
              <YAxis type="category" dataKey="department" tick={{ fontSize: 10, fill: '#94a3b8' }} width={90} />
              <Tooltip
                content={({ active, payload, label }: any) => {
                  if (!active || !payload?.length) return null;
                  const d: DayDeptSnapshot = payload[0]?.payload;
                  return (
                    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                      <p className="text-white font-medium mb-1">{label}</p>
                      <p className="text-amber-400">Late: <strong>{d.lateCount}</strong></p>
                      <p className="text-slate-400">of {d.presentCount} present</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="lateCount" name="Late" radius={[0, 4, 4, 0]} fill="#fbbf24" cursor="pointer">
                <LabelList dataKey="lateCount" position="right" style={{ fontSize: 10, fill: '#94a3b8' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}

// Chart 3: Dept Productivity Lost Today — horizontal bar, hours lost per dept
export function DayDeptProductivityChart({ data, onDeptClick }: { data: DayDeptSnapshot[]; onDeptClick?: (dept: string) => void }) {
  const sorted = [...data].filter(d => d.hoursLost > 0).sort((a, b) => b.hoursLost - a.hoursLost);
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 min-h-[260px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Dept Productivity Lost Today</h3>
          <p className="text-slate-500 text-xs mt-0.5 mb-3">Hours lost to late/early per department</p>
        </div>
        <InfoTooltip title="Dept Productivity Lost Today" description="Total person-hours lost to late arrivals and early exits per department today. Shows cost per department for shift supervisor accountability." formula="Σ(late_mins + early_mins) ÷ 60" position="bottom" />
      </div>
      {sorted.length === 0
        ? <div className="h-40 flex items-center justify-center text-slate-500 text-sm">No productivity loss today 🎉</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 36)}>
            <BarChart
              data={sorted}
              layout="vertical"
              margin={{ top: 0, right: 40, left: 0, bottom: 0 }}
              onClick={(entry: any) => {
                const dept = getDepartmentFromClick(entry);
                if (dept) onDeptClick?.(dept);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} unit="h" />
              <YAxis type="category" dataKey="department" tick={{ fontSize: 10, fill: '#94a3b8' }} width={90} />
              <Tooltip
                content={({ active, payload, label }: any) => {
                  if (!active || !payload?.length) return null;
                  const d: DayDeptSnapshot = payload[0]?.payload;
                  return (
                    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                      <p className="text-white font-medium mb-1">{label}</p>
                      <p className="text-amber-400">Hours Lost: <strong>{d.hoursLost.toFixed(1)}h</strong></p>
                      <p className="text-slate-400">Late: {d.lateCount} · Early: {d.earlyCount}</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="hoursLost" name="Hours Lost" radius={[0, 4, 4, 0]} cursor="pointer">
                {sorted.map((entry, i) => (
                  <Cell key={i} fill={entry.hoursLost > 5 ? '#f87171' : entry.hoursLost > 2 ? '#fbbf24' : '#94a3b8'} />
                ))}
                <LabelList dataKey="hoursLost" position="right" style={{ fontSize: 10, fill: '#94a3b8' }} formatter={(v: any) => `${Number(v).toFixed(1)}h`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}
