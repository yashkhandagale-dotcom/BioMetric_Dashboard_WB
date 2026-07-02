'use client';
import { useState, useMemo } from 'react';
import { AttendanceRecord, EmployeeSummary, LeaveRecord, Holiday, EffectiveStatus } from '@/lib/types';
import { computeEmployeeKPIs, ComparisonKPIs, buildLeaveMap, getEffectiveStatus, leaveKey } from '@/lib/useDashboardData';
import { getEmployeeMonthHistory } from '@/lib/storage';
import { getLeaveRecords } from '@/lib/leaveStorage';
import { getHolidays } from '@/lib/holidays';

interface EmployeeComparisonPanelProps {
  allRecords: AttendanceRecord[];
  employeeSummaries: EmployeeSummary[];
  leaveRecords: LeaveRecord[];
  holidays: Holiday[];
  graceMinutes: number;
  shiftStartMinutes: number;
  shiftEndMinutes: number;
}

const METRICS: { key: keyof ComparisonKPIs; label: string; suffix: string; higherIsBetter: boolean }[] = [
  { key: 'attendanceRate', label: 'Attendance %', suffix: '%', higherIsBetter: true },
  { key: 'absenteeismRate', label: 'Absenteeism %', suffix: '%', higherIsBetter: false },
  { key: 'avgHoursPerDay', label: 'Avg Effective Hrs/Day', suffix: 'h', higherIsBetter: true },
  { key: 'lateArrivalRate', label: 'Late Arrival Rate', suffix: '%', higherIsBetter: false },
  { key: 'earlyExitRate', label: 'Early Exit Rate', suffix: '%', higherIsBetter: false },
  { key: 'productivityLost', label: 'Productivity Lost %', suffix: '%', higherIsBetter: false },
];

const LEAVE_BADGES: { key: keyof ComparisonKPIs; label: string; color: string }[] = [
  { key: 'plannedLeaveCount', label: 'Planned', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  { key: 'casualLeaveCount', label: 'Casual', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
  { key: 'sickLeaveCount', label: 'Sick', color: 'bg-pink-500/20 text-pink-300 border-pink-500/40' },
  { key: 'lwpCount', label: 'LWP', color: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  { key: 'halfDayCount', label: 'Half-day', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
];

function fmt(metric: typeof METRICS[number], value: number): string {
  if (metric.suffix === 'h') return `${value.toFixed(2)}h`;
  if (metric.suffix === '%') return `${value.toFixed(1)}%`;
  return `${Math.round(value)}`;
}

function valueColor(metric: typeof METRICS[number], value: number): string {
  if (metric.key === 'attendanceRate') {
    if (value >= 90) return 'text-emerald-400';
    if (value >= 75) return 'text-amber-400';
    return 'text-red-400';
  }
  if (metric.key === 'absenteeismRate' || metric.key === 'lateArrivalRate' || metric.key === 'earlyExitRate' || metric.key === 'productivityLost') {
    if (value < 10) return 'text-emerald-400';
    if (value < 25) return 'text-amber-400';
    return 'text-red-400';
  }
  return 'text-slate-300';
}

function EmployeeSearchInput({
  options, value, onChange, placeholder,
}: {
  options: EmployeeSummary[];
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
}) {
  const listId = useMemo(() => `emp-list-${Math.random().toString(36).slice(2)}`, []);
  const current = options.find((e) => e.employeeCode === value);
  const [text, setText] = useState(current ? `${current.employeeName} (${current.employeeCode})` : '');

  function handleInput(v: string) {
    setText(v);
    const match = options.find((e) => `${e.employeeName} (${e.employeeCode})` === v);
    if (match) onChange(match.employeeCode);
  }

  return (
    <div className="flex-1">
      <input
        type="text"
        list={listId}
        value={text}
        placeholder={placeholder || 'Search employee…'}
        onChange={(e) => handleInput(e.target.value)}
        className="w-full bg-slate-700 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500"
      />
      <datalist id={listId}>
        {options.map((e) => (
          <option key={e.employeeCode} value={`${e.employeeName} (${e.employeeCode})`} />
        ))}
      </datalist>
    </div>
  );
}

const STATUS_COLOR: Record<EffectiveStatus, string> = {
  present: 'bg-emerald-500',
  absent: 'bg-red-500',
  leave_planned: 'bg-blue-500',
  leave_casual: 'bg-cyan-500',
  leave_sick: 'bg-pink-500',
  leave_lwp: 'bg-orange-500',
  half_day: 'bg-amber-500',
  weeklyoff: 'bg-slate-600',
  holiday: 'bg-violet-500',
};

const STATUS_LABEL: Record<EffectiveStatus, string> = {
  present: 'Present', absent: 'Absent', leave_planned: 'Planned Leave',
  leave_casual: 'Casual Leave', leave_sick: 'Sick Leave', leave_lwp: 'LWP',
  half_day: 'Half Day', weeklyoff: 'Weekly Off', holiday: 'Holiday',
};

function CalendarHeatmap({
  label, records, leaveMap, holidays,
}: { label: string; records: AttendanceRecord[]; leaveMap: Map<string, LeaveRecord>; holidays: Holiday[] }) {
  const days = useMemo(() => {
    return [...records]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => {
        const status = getEffectiveStatus(r, leaveMap.get(leaveKey(r.employeeCode, r.date)), holidays);
        return { date: r.date, day: r.date.slice(8, 10), status };
      });
  }, [records, leaveMap, holidays]);

  if (days.length === 0) {
    return <p className="text-slate-500 text-xs text-center py-3">No day-wise data</p>;
  }

  return (
    <div>
      <p className="text-slate-400 text-xs font-medium mb-2 truncate">{label}</p>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => (
          <div
            key={d.date}
            title={`${d.date} · ${STATUS_LABEL[d.status]}`}
            className={`aspect-square rounded ${STATUS_COLOR[d.status]} flex items-center justify-center text-[9px] text-white/80 font-medium`}
          >
            {parseInt(d.day, 10)}
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatmapLegend() {
  const items: EffectiveStatus[] = ['present', 'absent', 'leave_planned', 'leave_casual', 'leave_sick', 'leave_lwp', 'half_day', 'weeklyoff', 'holiday'];
  return (
    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-700/60">
      {items.map((s) => (
        <div key={s} className="flex items-center gap-1">
          <span className={`w-2.5 h-2.5 rounded-sm ${STATUS_COLOR[s]}`} />
          <span className="text-slate-500 text-[10px]">{STATUS_LABEL[s]}</span>
        </div>
      ))}
    </div>
  );
}

function LeaveBadgeRow({ leftLabel, rightLabel, left, right }: { leftLabel: string; rightLabel: string; left: ComparisonKPIs; right: ComparisonKPIs }) {
  return (
    <div className="mt-3">
      <p className="text-slate-500 text-[11px] uppercase tracking-wide mb-2">Leave Breakdown</p>
      <div className="grid grid-cols-2 gap-3">
        {[{ label: leftLabel, kpi: left }, { label: rightLabel, kpi: right }].map(({ label, kpi }) => (
          <div key={label} className="flex flex-wrap gap-1.5">
            {LEAVE_BADGES.map((b) => {
              const v = kpi[b.key] as number;
              if (!v) return null;
              return (
                <span key={b.key} className={`text-[10px] px-2 py-0.5 rounded-full border ${b.color}`}>
                  {b.label}: {v}
                </span>
              );
            })}
            {LEAVE_BADGES.every((b) => !(kpi[b.key] as number)) && (
              <span className="text-[10px] text-slate-500">No leave taken</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ComparisonGrid({
  leftLabel, rightLabel, leftKPIs, rightKPIs,
}: { leftLabel: string; rightLabel: string; leftKPIs: ComparisonKPIs; rightKPIs: ComparisonKPIs }) {
  let leftWinsCount = 0;
  const rows = METRICS.map((m) => {
    const l = leftKPIs[m.key] as number;
    const r = rightKPIs[m.key] as number;
    const lWins = m.higherIsBetter ? l > r : l < r;
    const rWins = m.higherIsBetter ? r > l : r < l;
    if (lWins) leftWinsCount++;
    return { m, l, r, lWins, rWins };
  });
  const rightWinsCount = rows.filter((row) => row.rWins).length;
  const lowSample = leftKPIs.presentSampleSize < 5 || rightKPIs.presentSampleSize < 5;

  return (
    <>
      <div className="grid grid-cols-3 gap-0 text-xs mb-2">
        <div className="text-slate-400 font-medium text-right pr-3 py-1 truncate">{leftLabel}</div>
        <div className="text-slate-500 text-center py-1">Metric</div>
        <div className="text-slate-400 font-medium text-left pl-3 py-1 truncate">{rightLabel}</div>
      </div>
      <div className="space-y-1">
        {rows.map(({ m, l, r, lWins, rWins }) => (
          <div key={m.key} className="grid grid-cols-3 gap-0 items-center py-1.5 px-2 rounded-lg hover:bg-slate-700/30">
            <div className={`text-right pr-3 flex items-center justify-end gap-1 ${lWins ? 'font-semibold' : ''}`}>
              {lWins && <span className="text-emerald-400 text-[9px]">▲</span>}
              <span className={`text-sm font-bold ${valueColor(m, l)}`}>{fmt(m, l)}</span>
            </div>
            <div className="text-center text-[10px] text-slate-500">{m.label}</div>
            <div className={`text-left pl-3 flex items-center gap-1 ${rWins ? 'font-semibold' : ''}`}>
              <span className={`text-sm font-bold ${valueColor(m, r)}`}>{fmt(m, r)}</span>
              {rWins && <span className="text-emerald-400 text-[9px]">▲</span>}
            </div>
          </div>
        ))}
      </div>

      {lowSample && (
        <p className="text-amber-400/80 text-[11px] mt-2 px-1">
          ⚠ Rates based on small sample ({leftLabel}: {leftKPIs.presentSampleSize}d, {rightLabel}: {rightKPIs.presentSampleSize}d) — may not be representative.
        </p>
      )}

      <LeaveBadgeRow leftLabel={leftLabel} rightLabel={rightLabel} left={leftKPIs} right={rightKPIs} />

      <div className="mt-4 pt-4 border-t border-slate-700 flex items-center justify-center gap-3 flex-wrap">
        {leftWinsCount !== rightWinsCount ? (
          <>
            <div className={`px-4 py-2 rounded-xl text-sm font-semibold ${leftWinsCount > rightWinsCount ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300' : 'bg-slate-700/50 border border-slate-600 text-slate-400'}`}>
              {leftLabel}: {leftWinsCount} wins
            </div>
            <span className="text-slate-600 text-lg font-light">·</span>
            <div className={`px-4 py-2 rounded-xl text-sm font-semibold ${rightWinsCount > leftWinsCount ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300' : 'bg-slate-700/50 border border-slate-600 text-slate-400'}`}>
              {rightLabel}: {rightWinsCount} wins
            </div>
          </>
        ) : (
          <p className="text-slate-400 text-sm">🤝 Tie — {leftWinsCount} metrics each</p>
        )}
      </div>
    </>
  );
}

export default function EmployeeComparisonPanel({
  allRecords, employeeSummaries, leaveRecords, holidays, graceMinutes, shiftStartMinutes, shiftEndMinutes,
}: EmployeeComparisonPanelProps) {
  const empOptions = useMemo(
    () => [...employeeSummaries].sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
    [employeeSummaries]
  );

  const currentLeaveMap = useMemo(() => buildLeaveMap(leaveRecords), [leaveRecords]);

  // Employee vs own previous month
  const [histEmp, setHistEmp] = useState(empOptions[0]?.employeeCode || '');
  const histOfficeCode = empOptions.find((e) => e.employeeCode === histEmp)?.officeCode || '';

  const history = useMemo(() => {
    if (!histEmp) return [];
    return getEmployeeMonthHistory(histEmp, histOfficeCode);
  }, [histEmp, histOfficeCode]);

  const [monthAKey, setMonthAKey] = useState('');
  const [monthBKey, setMonthBKey] = useState('');

  const monthA = history.find((h) => h.monthKey === monthAKey) || history[history.length - 2] || history[0];
  const monthB = history.find((h) => h.monthKey === monthBKey) || history[history.length - 1];

  function kpisForHistMonth(m: typeof history[number] | undefined): ComparisonKPIs | null {
    if (!m) return null;
    const monthHolidays = getHolidays(m.officeCode, m.year);
    const monthLeaves = buildLeaveMap(getLeaveRecords(m.monthKey));
    return computeEmployeeKPIs(m.records, monthLeaves, monthHolidays, graceMinutes, shiftStartMinutes, shiftEndMinutes);
  }

  const monthAKPIs = useMemo(() => kpisForHistMonth(monthA), [monthA, graceMinutes, shiftStartMinutes, shiftEndMinutes]);
  const monthBKPIs = useMemo(() => kpisForHistMonth(monthB), [monthB, graceMinutes, shiftStartMinutes, shiftEndMinutes]);

  const histEmpName = empOptions.find((e) => e.employeeCode === histEmp)?.employeeName || histEmp;

  if (employeeSummaries.length < 1) return null;

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
      <div className="mb-4">
        <h3 className="text-white font-semibold text-sm">Employee Month Comparison</h3>
        <p className="text-slate-500 text-xs mt-0.5">Compare an employee's performance across two of their uploaded months</p>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <EmployeeSearchInput
          options={empOptions}
          value={histEmp}
          onChange={(code) => { setHistEmp(code); setMonthAKey(''); setMonthBKey(''); }}
          placeholder="Search employee…"
        />
        <select
          value={monthA?.monthKey || ''}
          onChange={(e) => setMonthAKey(e.target.value)}
          className="flex-1 bg-slate-700 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500"
          disabled={history.length === 0}
        >
          {history.length === 0 && <option value="">No months available</option>}
          {history.map((h) => <option key={h.monthKey} value={h.monthKey}>{h.label}</option>)}
        </select>
        <span className="text-slate-500 text-sm font-medium">vs</span>
        <select
          value={monthB?.monthKey || ''}
          onChange={(e) => setMonthBKey(e.target.value)}
          className="flex-1 bg-slate-700 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500"
          disabled={history.length === 0}
        >
          {history.length === 0 && <option value="">No months available</option>}
          {history.map((h) => <option key={h.monthKey} value={h.monthKey}>{h.label}</option>)}
        </select>
      </div>

      {monthAKPIs && monthBKPIs && monthA && monthB && monthA.monthKey !== monthB.monthKey ? (
        <>
          <ComparisonGrid leftLabel={monthA.label} rightLabel={monthB.label} leftKPIs={monthAKPIs} rightKPIs={monthBKPIs} />
          <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-700">
            <CalendarHeatmap
              label={`${histEmpName} · ${monthA.label}`}
              records={monthA.records}
              leaveMap={buildLeaveMap(getLeaveRecords(monthA.monthKey))}
              holidays={getHolidays(monthA.officeCode, monthA.year)}
            />
            <CalendarHeatmap
              label={`${histEmpName} · ${monthB.label}`}
              records={monthB.records}
              leaveMap={buildLeaveMap(getLeaveRecords(monthB.monthKey))}
              holidays={getHolidays(monthB.officeCode, monthB.year)}
            />
          </div>
          <HeatmapLegend />
        </>
      ) : (
        <p className="text-slate-500 text-sm text-center py-6">
          {history.length < 2
            ? `Upload at least one more month for ${histEmpName} to enable comparison.`
            : 'Pick two different months above to compare.'}
        </p>
      )}
    </div>
  );
}
