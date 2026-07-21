'use client';
import { useState, useMemo, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { AttendanceRecord, EmployeeSummary, LeaveRecord, Holiday, EffectiveStatus } from '@/lib/types';
import { computeEmployeeKPIs, ComparisonKPIs, buildLeaveMap, getEffectiveStatus, leaveKey } from '@/lib/useDashboardData';
import { getEmployeeMonthHistory } from '@/lib/storage';
import { getLeaveRecords } from '@/lib/leaveTrackerRead';
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
  // Lower deviation = punches in/out around the same time every day, i.e.
  // more consistent — unlike avg in/out time itself, "lower is better" here
  // isn't a value judgment about work hours, just about predictability.
  { key: 'inTimeDeviation', label: 'In-Time Consistency (±min)', suffix: 'min', higherIsBetter: false },
  { key: 'outTimeDeviation', label: 'Out-Time Consistency (±min)', suffix: 'min', higherIsBetter: false },
];

// e.g. 582 -> "9:42 AM". Avg in/out time itself is shown as plain info
// (see AvgPunchRow below) rather than run through the red/green delta
// machinery below — "earlier" or "later" isn't inherently good or bad the
// way lower absenteeism or higher attendance is, so we don't color-code it.
function minsToClock(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

const LEAVE_BADGES: { key: keyof ComparisonKPIs; label: string; color: string }[] = [
  { key: 'plannedLeaveCount', label: 'Planned', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  { key: 'casualLeaveCount', label: 'Casual', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
  { key: 'sickLeaveCount', label: 'Sick', color: 'bg-pink-500/20 text-pink-300 border-pink-500/40' },
  { key: 'lwpCount', label: 'LWP', color: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  { key: 'halfDayCount', label: 'Half-day', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
];

function fmt(metric: typeof METRICS[number], value: number): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  if (metric.suffix === 'h') return `${value.toFixed(2)}h`;
  if (metric.suffix === '%') return `${value.toFixed(1)}%`;
  if (metric.suffix === 'min') return `±${Math.round(value)}m`;
  return `${Math.round(value)}`;
}

function valueColor(metric: typeof METRICS[number], value: number): string {
  if (value === undefined || Number.isNaN(value)) return 'text-slate-500';
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

// Small negligible-change threshold per metric unit, so noise doesn't get called out as a "trend".
function deltaThreshold(metric: typeof METRICS[number]): number {
  if (metric.suffix === 'h') return 0.1;
  if (metric.suffix === 'min') return 5; // 5-minute swings in consistency aren't worth flagging
  return 1;
}

function fmtDelta(metric: typeof METRICS[number], delta: number): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  const abs = Math.abs(delta);
  if (metric.suffix === 'min') return `${sign}${Math.round(abs)}m`;
  const body = metric.suffix === 'h' ? abs.toFixed(2) : abs.toFixed(1);
  return `${sign}${body}${metric.suffix}`;
}

// Hours move on a much smaller numeric scale than percentages (0-2 vs 0-100),
// and minute-deviations on a much larger one (0-60+) — weight both so
// "which metric moved the most" ranks fairly across units.
function normalizedMagnitude(metric: typeof METRICS[number], delta: number): number {
  if (Number.isNaN(delta)) return 0;
  if (metric.suffix === 'h') return Math.abs(delta) * 15;
  if (metric.suffix === 'min') return Math.abs(delta) / 3;
  return Math.abs(delta);
}

interface MetricMove {
  m: typeof METRICS[number];
  delta: number;
  improved: boolean;
}

function buildInsight(leftKPIs: ComparisonKPIs, rightKPIs: ComparisonKPIs, fromLabel: string, toLabel: string): string {
  const moves: MetricMove[] = METRICS
    .map((m) => {
      const delta = (rightKPIs[m.key] as number) - (leftKPIs[m.key] as number);
      const improved = m.higherIsBetter ? delta > 0 : delta < 0;
      return { m, delta, improved };
    })
    .filter((mv) => Math.abs(mv.delta) >= deltaThreshold(mv.m))
    .sort((a, b) => normalizedMagnitude(b.m, b.delta) - normalizedMagnitude(a.m, a.delta));

  if (moves.length === 0) {
    return `No meaningful change between ${fromLabel} and ${toLabel} — performance held steady.`;
  }

  const phrase = (mv: MetricMove) => {
    const verb = mv.improved
      ? 'improved'
      : mv.m.higherIsBetter ? 'dropped' : 'rose';
    return `${mv.m.label} ${verb} by ${fmtDelta(mv.m, mv.delta).replace(/^[+−]/, '')}${mv.m.suffix}`;
  };

  const top = moves.slice(0, 2);
  if (top.length === 1) return `${phrase(top[0])} from ${fromLabel} to ${toLabel}.`;

  const joiner = top[0].improved === top[1].improved ? ', and ' : ', but ';
  return `${phrase(top[0])}${joiner}${phrase(top[1]).charAt(0).toLowerCase() + phrase(top[1]).slice(1)} from ${fromLabel} to ${toLabel}.`;
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
  missed_punch_out: 'bg-orange-600',
  leave_planned: 'bg-blue-500',
  leave_casual: 'bg-cyan-500',
  leave_sick: 'bg-pink-500',
  leave_lwp: 'bg-orange-500',
  half_day: 'bg-amber-500',
  weeklyoff: 'bg-slate-600',
  holiday: 'bg-violet-500',
};

const STATUS_LABEL: Record<EffectiveStatus, string> = {
  present: 'Present', absent: 'Absent', missed_punch_out: 'Missed Punch Out',
  leave_planned: 'Planned Leave', leave_casual: 'Casual Leave', leave_sick: 'Sick Leave',
  leave_lwp: 'LWP', half_day: 'Half Day', weeklyoff: 'Weekly Off', holiday: 'Holiday',
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

interface TrendPoint {
  monthKey: string;
  label: string;
  value: number;
  isA: boolean;
  isB: boolean;
}

function TrendChart({
  metric, data, metricOptions, onMetricChange,
}: {
  metric: typeof METRICS[number];
  data: TrendPoint[];
  metricOptions: typeof METRICS;
  onMetricChange: (key: string) => void;
}) {
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload as TrendPoint;
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
        <p className="text-slate-300 font-medium mb-1">{p.label}</p>
        <p className="text-violet-300">{metric.label}: <strong>{fmt(metric, p.value)}</strong></p>
        {(p.isA || p.isB) && <p className="text-slate-500 text-[10px] mt-1">Selected for comparison above</p>}
      </div>
    );
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-700">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <p className="text-slate-500 text-[11px] uppercase tracking-wide">Trend across all uploaded months</p>
        <select
          value={metric.key}
          onChange={(e) => onMetricChange(e.target.value)}
          className="bg-slate-700 border border-slate-600 text-white text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-violet-500"
        >
          {metricOptions.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>
      {data.length < 2 ? (
        <p className="text-slate-500 text-xs text-center py-6">Need at least 2 uploaded months to show a trend.</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} unit={metric.suffix === '%' ? '%' : ''} />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="value"
              name={metric.label}
              stroke="#a78bfa"
              strokeWidth={2}
              dot={(props: any) => {
                const p = props.payload as TrendPoint;
                const highlighted = p.isA || p.isB;
                return (
                  <circle
                    key={props.index}
                    cx={props.cx}
                    cy={props.cy}
                    r={highlighted ? 5 : 3}
                    fill={p.isA ? '#60a5fa' : p.isB ? '#34d399' : '#a78bfa'}
                    stroke={highlighted ? '#fff' : 'none'}
                    strokeWidth={highlighted ? 2 : 0}
                  />
                );
              }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
      <div className="flex items-center gap-3 mt-1">
        <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Month A</span>
        <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Month B</span>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
  const rows = METRICS.map((m) => {
    const l = leftKPIs[m.key] as number;
    const r = rightKPIs[m.key] as number;
    const delta = r - l;
    const improved = m.higherIsBetter ? delta > 0 : delta < 0;
    const meaningful = Math.abs(delta) >= deltaThreshold(m);
    return { m, l, r, delta, improved, meaningful };
  });
  const lowSample = leftKPIs.presentSampleSize < 5 || rightKPIs.presentSampleSize < 5;
  const insight = buildInsight(leftKPIs, rightKPIs, leftLabel, rightLabel);

  return (
    <>
      <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 mb-4">
        <p className="text-violet-200 text-sm leading-snug">💡 {insight}</p>
      </div>

      <div className="grid grid-cols-3 gap-0 text-xs mb-4 bg-slate-800/40 rounded-lg py-2">
        <div className="text-right pr-3">
          <p className="text-slate-500 text-[10px]">Avg In / Out</p>
          <p className="text-slate-200 text-xs font-medium">
            {leftKPIs.avgInTime !== undefined ? minsToClock(leftKPIs.avgInTime) : '—'}
            {' / '}
            {leftKPIs.avgOutTime !== undefined ? minsToClock(leftKPIs.avgOutTime) : '—'}
          </p>
        </div>
        <div className="text-center text-slate-500 pt-2">Avg Punch Time</div>
        <div className="text-left pl-3">
          <p className="text-slate-500 text-[10px]">Avg In / Out</p>
          <p className="text-slate-200 text-xs font-medium">
            {rightKPIs.avgInTime !== undefined ? minsToClock(rightKPIs.avgInTime) : '—'}
            {' / '}
            {rightKPIs.avgOutTime !== undefined ? minsToClock(rightKPIs.avgOutTime) : '—'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-0 text-xs mb-2">
        <div className="text-slate-400 font-medium text-right pr-3 py-1 truncate">{leftLabel}</div>
        <div className="text-slate-500 text-center py-1">Metric</div>
        <div className="text-slate-400 font-medium text-left pl-3 py-1 truncate">{rightLabel}</div>
      </div>
      <div className="space-y-1">
        {rows.map(({ m, l, r, delta, improved, meaningful }) => (
          <div key={m.key} className="grid grid-cols-3 gap-0 items-center py-1.5 px-2 rounded-lg hover:bg-slate-700/30">
            <div className="text-right pr-3">
              <span className={`text-sm font-bold ${valueColor(m, l)}`}>{fmt(m, l)}</span>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500">{m.label}</div>
              {meaningful ? (
                <span className={`inline-block mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${improved ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                  {fmtDelta(m, delta)}
                </span>
              ) : (
                <span className="inline-block mt-0.5 text-[10px] text-slate-600">no change</span>
              )}
            </div>
            <div className="text-left pl-3">
              <span className={`text-sm font-bold ${valueColor(m, r)}`}>{fmt(m, r)}</span>
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

  const [history, setHistory] = useState<Awaited<ReturnType<typeof getEmployeeMonthHistory>>>([]);

  useEffect(() => {
    if (!histEmp) { setHistory([]); return; }
    let cancelled = false;
    getEmployeeMonthHistory(histEmp, histOfficeCode).then((h) => { if (!cancelled) setHistory(h); });
    return () => { cancelled = true; };
  }, [histEmp, histOfficeCode]);

  const [monthAKey, setMonthAKey] = useState('');
  const [monthBKey, setMonthBKey] = useState('');

  const monthA = history.find((h) => h.monthKey === monthAKey) || history[history.length - 2] || history[0];
  const monthB = history.find((h) => h.monthKey === monthBKey) || history[history.length - 1];

  // Per-month holidays + leave map, fetched once per monthKey and cached.
  // Fetches for every month in this employee's history (not just A/B) so the
  // trend chart below can plot their full trajectory, not just the two selected snapshots.
  const [monthExtras, setMonthExtras] = useState<Record<string, { holidays: Holiday[]; leaveMap: Map<string, LeaveRecord> }>>({});
  const [leaveLoadError, setLeaveLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    history.forEach((m) => {
      if (monthExtras[m.monthKey]) return;
      Promise.all([getHolidays(m.officeCode, m.year), getLeaveRecords(m.monthKey)])
        .then(([holidays, leaves]) => {
          if (cancelled) return;
          setMonthExtras((prev) => (prev[m.monthKey] ? prev : { ...prev, [m.monthKey]: { holidays, leaveMap: buildLeaveMap(leaves) } }));
        })
        .catch((err) => {
          if (cancelled) return;
          setLeaveLoadError(`Could not load leave data from the Leave Tracker: ${err instanceof Error ? err.message : 'Unknown error'}`);
        });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  function kpisForHistMonth(m: typeof history[number] | undefined): ComparisonKPIs | null {
    if (!m) return null;
    const extras = monthExtras[m.monthKey];
    if (!extras) return null;
    return computeEmployeeKPIs(m.records, extras.leaveMap, extras.holidays, graceMinutes, shiftStartMinutes, shiftEndMinutes);
  }

  const monthAKPIs = useMemo(() => kpisForHistMonth(monthA), [monthA, monthExtras, graceMinutes, shiftStartMinutes, shiftEndMinutes]);
  const monthBKPIs = useMemo(() => kpisForHistMonth(monthB), [monthB, monthExtras, graceMinutes, shiftStartMinutes, shiftEndMinutes]);

  // Trend across every uploaded month for this employee, so a manager can see
  // trajectory (steady slide vs. one-off dip) instead of just a two-point diff.
  const [trendMetricKey, setTrendMetricKey] = useState<keyof ComparisonKPIs>('attendanceRate');
  const trendMetric = METRICS.find((m) => m.key === trendMetricKey) || METRICS[0];

  const trendData: TrendPoint[] = useMemo(() => {
    return history
      .map((m) => {
        const k = kpisForHistMonth(m);
        if (!k) return null;
        return {
          monthKey: m.monthKey,
          label: m.label,
          value: k[trendMetricKey] as number,
          isA: m.monthKey === monthA?.monthKey,
          isB: m.monthKey === monthB?.monthKey,
        };
      })
      .filter((p): p is TrendPoint => p !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, monthExtras, trendMetricKey, graceMinutes, shiftStartMinutes, shiftEndMinutes, monthA?.monthKey, monthB?.monthKey]);

  const histEmpName = empOptions.find((e) => e.employeeCode === histEmp)?.employeeName || histEmp;

  if (employeeSummaries.length < 1) return null;

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
      <div className="mb-4">
        <h3 className="text-white font-semibold text-sm">Employee Month Comparison</h3>
        <p className="text-slate-500 text-xs mt-0.5">Track an employee's performance trend and compare any two of their uploaded months</p>
      </div>

      {leaveLoadError && (
        <div className="mb-4 bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
          {leaveLoadError}
        </div>
      )}

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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-700">
            <CalendarHeatmap
              label={`${histEmpName} · ${monthA.label}`}
              records={monthA.records}
              leaveMap={monthExtras[monthA.monthKey]?.leaveMap || new Map()}
              holidays={monthExtras[monthA.monthKey]?.holidays || []}
            />
            <CalendarHeatmap
              label={`${histEmpName} · ${monthB.label}`}
              records={monthB.records}
              leaveMap={monthExtras[monthB.monthKey]?.leaveMap || new Map()}
              holidays={monthExtras[monthB.monthKey]?.holidays || []}
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

      {history.length >= 2 && (
        <TrendChart
          metric={trendMetric}
          data={trendData}
          metricOptions={METRICS}
          onMetricChange={(key) => setTrendMetricKey(key as keyof ComparisonKPIs)}
        />
      )}
    </div>
  );
}