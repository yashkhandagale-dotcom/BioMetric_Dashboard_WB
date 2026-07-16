'use client';
import { useState, useMemo } from 'react';
import { AttendanceRecord, Holiday, LeaveRecord } from '@/lib/types';
import { computeEmployeeKPIs, buildLeaveMap, ComparisonKPIs } from '@/lib/useDashboardData';
import { minutesToHHMM } from '@/lib/parseCSV';

interface TeamComparisonPanelProps {
  allRecords: AttendanceRecord[];
  departments: string[];
  // Same inputs every other KPI consumer uses — no private defaults here.
  holidays?: Holiday[];
  leaveRecords?: LeaveRecord[];
  graceMinutes: number;
  shiftStartMinutes: number;
  shiftEndMinutes: number;
}

// TeamKPIs is just the subset of ComparisonKPIs this panel displays — the
// underlying formulas (attendance/absenteeism/late/early/productivity) now
// come from the single shared engine (computeEmployeeKPIs) instead of a
// private copy that ignored leave, holidays, and configured shift/grace.
type TeamKPIs = Pick<ComparisonKPIs,
  'attendanceRate' | 'absenteeismRate' | 'avgHoursPerDay' | 'lateArrivalRate' | 'earlyExitRate' | 'productivityLost'>;

// Returns true if left value is "better" for this metric
function leftWins(metric: string, left: number, right: number): boolean {
  const higherIsBetter = metric === 'Attendance %' || metric === 'Avg Hours/Day';
  return higherIsBetter ? left > right : left < right;
}

function valueColor(metric: string, value: number): string {
  if (metric === 'Attendance %') {
    if (value >= 80) return 'text-emerald-400';
    if (value >= 70) return 'text-amber-400';
    return 'text-red-400';
  }
  if (metric === 'Absenteeism %' || metric === 'Late Arrival Rate' || metric === 'Early Exit Rate' || metric === 'Productivity Lost %') {
    if (value < 10) return 'text-emerald-400';
    if (value < 25) return 'text-amber-400';
    return 'text-red-400';
  }
  if (metric === 'Avg Hours/Day') {
    if (value >= 8.5) return 'text-emerald-400';
    if (value >= 7) return 'text-amber-400';
    return 'text-red-400';
  }
  return 'text-slate-300';
}

function formatValue(metric: string, value: number): string {
  if (metric === 'Avg Hours/Day') return minutesToHHMM(Math.round(value * 60));
  return `${value.toFixed(1)}%`;
}

export default function TeamComparisonPanel({
  allRecords, departments, holidays = [], leaveRecords = [],
  graceMinutes, shiftStartMinutes, shiftEndMinutes,
}: TeamComparisonPanelProps) {
  const [leftTeam, setLeftTeam] = useState(departments[0] || '');
  const [rightTeam, setRightTeam] = useState(departments[1] || '');
  const leaveMap = useMemo(() => buildLeaveMap(leaveRecords), [leaveRecords]);

  // Keep rightTeam valid when leftTeam changes
  function handleLeftChange(val: string) {
    setLeftTeam(val);
    if (rightTeam === val) {
      const next = departments.find(d => d !== val);
      setRightTeam(next || '');
    }
  }

  function handleRightChange(val: string) {
    setRightTeam(val);
    if (leftTeam === val) {
      const next = departments.find(d => d !== val);
      setLeftTeam(next || '');
    }
  }

  const leftOptions = departments.filter(d => d !== rightTeam);
  const rightOptions = departments.filter(d => d !== leftTeam);

  const leftKPIs: TeamKPIs | null = useMemo(() => {
    if (!leftTeam) return null;
    return computeEmployeeKPIs(
      allRecords.filter(r => r.department === leftTeam),
      leaveMap, holidays, graceMinutes, shiftStartMinutes, shiftEndMinutes
    );
  }, [allRecords, leftTeam, leaveMap, holidays, graceMinutes, shiftStartMinutes, shiftEndMinutes]);

  const rightKPIs: TeamKPIs | null = useMemo(() => {
    if (!rightTeam) return null;
    return computeEmployeeKPIs(
      allRecords.filter(r => r.department === rightTeam),
      leaveMap, holidays, graceMinutes, shiftStartMinutes, shiftEndMinutes
    );
  }, [allRecords, rightTeam, leaveMap, holidays, graceMinutes, shiftStartMinutes, shiftEndMinutes]);

  const safeMetrics: { label: string; leftVal: number; rightVal: number }[] = useMemo(() => {
    if (!leftKPIs || !rightKPIs) return [];
    return [
      { label: 'Attendance %', leftVal: leftKPIs.attendanceRate, rightVal: rightKPIs.attendanceRate },
      { label: 'Absenteeism %', leftVal: leftKPIs.absenteeismRate, rightVal: rightKPIs.absenteeismRate },
      { label: 'Avg Hours/Day', leftVal: leftKPIs.avgHoursPerDay, rightVal: rightKPIs.avgHoursPerDay },
      { label: 'Late Arrival Rate', leftVal: leftKPIs.lateArrivalRate, rightVal: rightKPIs.lateArrivalRate },
      { label: 'Early Exit Rate', leftVal: leftKPIs.earlyExitRate, rightVal: rightKPIs.earlyExitRate },
      { label: 'Productivity Lost %', leftVal: leftKPIs.productivityLost, rightVal: rightKPIs.productivityLost },
    ];
  }, [leftKPIs, rightKPIs]);

  const leftWinsCount = safeMetrics.filter(m => leftWins(m.label, m.leftVal, m.rightVal)).length;
  const rightWinsCount = safeMetrics.length - leftWinsCount;

  if (departments.length < 2) return null;

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
      <div className="mb-4">
        <h3 className="text-white font-semibold text-sm">Team Comparison</h3>
        <p className="text-slate-500 text-xs mt-0.5">Select two departments to compare KPIs side by side</p>
      </div>

      {/* Dropdowns */}
      <div className="flex items-center gap-4 mb-5 flex-wrap">
        <select
          value={leftTeam}
          onChange={e => handleLeftChange(e.target.value)}
          className="flex-1 bg-slate-700 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500"
        >
          {leftOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="text-slate-500 text-sm font-medium">vs</span>
        <select
          value={rightTeam}
          onChange={e => handleRightChange(e.target.value)}
          className="flex-1 bg-slate-700 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500"
        >
          {rightOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Comparison grid */}
      {safeMetrics.length > 0 && (
        <>
          {/* Header row */}
          <div className="grid grid-cols-3 gap-2 mb-2 px-1">
            <p className="text-violet-400 text-xs font-semibold truncate">{leftTeam}</p>
            <p className="text-slate-500 text-xs text-center">Metric</p>
            <p className="text-violet-400 text-xs font-semibold text-right truncate">{rightTeam}</p>
          </div>

          <div className="space-y-1.5">
            {safeMetrics.map(({ label, leftVal, rightVal }) => {
              const lWins = leftWins(label, leftVal, rightVal);
              const rWins = leftWins(label, rightVal, leftVal);
              return (
                <div key={label} className="grid grid-cols-3 gap-2 items-center bg-slate-700/30 rounded-lg px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm font-bold ${valueColor(label, leftVal)}`}>
                      {formatValue(label, leftVal)}
                    </span>
                    {lWins && <span className="text-emerald-400 text-xs">✓</span>}
                  </div>
                  <p className="text-slate-400 text-xs text-center">{label}</p>
                  <div className="flex items-center justify-end gap-1.5">
                    {rWins && <span className="text-emerald-400 text-xs">✓</span>}
                    <span className={`text-sm font-bold ${valueColor(label, rightVal)}`}>
                      {formatValue(label, rightVal)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Winner badge */}
          <div className="mt-4 pt-4 border-t border-slate-700 flex items-center justify-center gap-3">
            {leftWinsCount !== rightWinsCount ? (
              <>
                <div className={`px-4 py-2 rounded-xl text-sm font-semibold ${
                  leftWinsCount > rightWinsCount
                    ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-700/50 border border-slate-600 text-slate-400'
                }`}>
                  {leftTeam}: {leftWinsCount} wins
                </div>
                <span className="text-slate-600 text-lg font-light">·</span>
                <div className={`px-4 py-2 rounded-xl text-sm font-semibold ${
                  rightWinsCount > leftWinsCount
                    ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-700/50 border border-slate-600 text-slate-400'
                }`}>
                  {rightTeam}: {rightWinsCount} wins
                </div>
                <span className="text-slate-400 text-xs ml-1">
                  🏆 {leftWinsCount > rightWinsCount ? leftTeam : rightTeam} wins overall
                </span>
              </>
            ) : (
              <p className="text-slate-400 text-sm">🤝 Tie — {leftWinsCount} metrics each</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}