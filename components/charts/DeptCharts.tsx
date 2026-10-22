'use client';
import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, LabelList, Legend, ReferenceLine,
} from 'recharts';
import { ArrowLeft } from 'lucide-react';
import { DeptAttendance, AttendanceRecord, OfficeAttendance } from '@/lib/types';
import { isPresent, isAbsent, isWeeklyOff, computeProductivityLostMinutes, targetShiftMinutes } from '@/lib/useDashboardData';
import { durationToMinutes, minutesToHHMM } from '@/lib/parseCSV';
import { effectiveMinutes } from '@/lib/hoursCalc';
import InfoTooltip from '../InfoTooltip';
import { useEntityChartLayout } from '@/lib/chartLayout';
import { useThemeColors } from '@/lib/useThemeColors';
import ChartFilterBar from '../ChartFilterBar';
import { rateColor, SortMode, getDepartmentFromClick } from './chartUtils';
import { SortToggle } from './ChartShared';

// ── Dept Attendance Ranking ───────────────────────────────────────────────────
interface DeptAttendanceChartProps {
  data: DeptAttendance[];
  allRecords: AttendanceRecord[];
  selectedDepts?: string[];
  highlightDepts?: string[];
  onDeptClick?: (dept: string) => void;
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
    return d.sort((a, b) => a.rate - b.rate);
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
    return rows.sort((a, b) => rate(a) - rate(b));
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

// ── Office-wise Attendance ────────────────────────────────────────────────────
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
    return d.sort((a, b) => a.rate - b.rate);
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
  highlightDepts?: string[];
  externalDrillDept?: string | null;
  onDrillBack?: () => void;
  onDeptDrillChange?: (dept: string | null) => void;
  onDeptClick?: (dept: string) => void;
  shiftStartMinutes?: number;
  shiftEndMinutes?: number;
}) {
  const __tc = useThemeColors();
  const [internalDrill, setInternalDrill] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('default');
  const safeRecords = allRecords ?? [];

  const drillDept = selectedDepts?.length === 1
    ? selectedDepts[0]
    : internalDrill ?? (externalDrillDept ?? null);

  const chartData = useMemo(() => {
    const d = data.map(d => ({ department: d.department, daysLost: +(d.productivityLostDays ?? 0).toFixed(2) }));
    if (sortMode === 'az') return d.sort((a, b) => a.department.localeCompare(b.department));
    if (sortMode === 'worst') return d.sort((a, b) => b.daysLost - a.daysLost);
    if (sortMode === 'best') return d.sort((a, b) => a.daysLost - b.daysLost);
    return d.sort((a, b) => b.daysLost - a.daysLost);
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
      if (raw > 60) {
        e.daysWithDuration++;
        const eff = effectiveMinutes(raw);
        if (eff !== null) e.effectiveMins += eff;
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
    return rows.sort((a, b) => b.daysLost - a.daysLost || a.name.localeCompare(b.name));
  }, [drillDept, safeRecords, sortMode, shiftStartMinutes, shiftEndMinutes]);

  const drillLayout = useEntityChartLayout(drillData, { getLabel: (r) => r.name });

  if (drillDept) {
    return (
      <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[280px]">
        <div className="flex items-center flex-wrap gap-3 mb-1">
          <button onClick={handleBack} className="flex items-center gap-1.5 text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-xs font-medium transition-colors shrink-0">
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
