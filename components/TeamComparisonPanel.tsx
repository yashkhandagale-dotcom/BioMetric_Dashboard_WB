'use client';
import { useState, useMemo } from 'react';
import { AttendanceRecord } from '@/lib/types';
import { computeLateMinutes, computeEarlyMinutes, SHIFT_MINUTES } from '@/lib/useDashboardData';
import { durationToMinutes } from '@/lib/parseCSV';

interface TeamComparisonPanelProps {
  allRecords: AttendanceRecord[];
  departments: string[];
}

interface TeamKPIs {
  attendanceRate: number;
  absenteeismRate: number;
  avgHoursPerDay: number;
  lateArrivalRate: number;
  earlyExitRate: number;
  productivityLost: number;
}

function isPresent(s: string) { return s.toLowerCase().includes('present') && !s.toLowerCase().includes('absent'); }
function isAbsent(s: string) { return s.toLowerCase().includes('absent'); }
function isWeeklyOff(s: string) { return s.toLowerCase().includes('weeklyoff'); }

function computeTeamKPIs(records: AttendanceRecord[]): TeamKPIs {
  const workRecords = records.filter(r => !isWeeklyOff(r.status));
  const presentRecords = workRecords.filter(r => isPresent(r.status));
  const absentRecords = workRecords.filter(r => isAbsent(r.status));

  const scheduled = workRecords.length;
  const presentCount = presentRecords.length;
  const absentCount = absentRecords.length;

  const attendanceRate = scheduled > 0 ? (presentCount / scheduled) * 100 : 0;
  const absenteeismRate = scheduled > 0 ? (absentCount / scheduled) * 100 : 0;

  const presentWithDur = presentRecords.filter(r => durationToMinutes(r.duration) > 0);
  const totalMins = presentWithDur.reduce((s, r) => s + durationToMinutes(r.duration), 0);
  const avgHoursPerDay = presentWithDur.length > 0 ? totalMins / presentWithDur.length / 60 : 0;

  const lateCount = presentRecords.filter(r => computeLateMinutes(r.inTime) > 0).length;
  const earlyCount = presentRecords.filter(r => computeEarlyMinutes(r.outTime) > 0).length;
  const lateArrivalRate = presentCount > 0 ? (lateCount / presentCount) * 100 : 0;
  const earlyExitRate = presentCount > 0 ? (earlyCount / presentCount) * 100 : 0;

  const totalLostMins = presentRecords.reduce(
    (s, r) => s + computeLateMinutes(r.inTime) + computeEarlyMinutes(r.outTime), 0
  );
  const totalShiftMins = presentCount * SHIFT_MINUTES;
  const productivityLost = totalShiftMins > 0 ? (totalLostMins / totalShiftMins) * 100 : 0;

  return { attendanceRate, absenteeismRate, avgHoursPerDay, lateArrivalRate, earlyExitRate, productivityLost };
}

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
  if (metric === 'Avg Hours/Day') return `${value.toFixed(2)}h`;
  return `${value.toFixed(1)}%`;
}

export default function TeamComparisonPanel({ allRecords, departments }: TeamComparisonPanelProps) {
  const [leftTeam, setLeftTeam] = useState(departments[0] || '');
  const [rightTeam, setRightTeam] = useState(departments[1] || '');

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

  const leftKPIs = useMemo(() => {
    if (!leftTeam) return null;
    return computeTeamKPIs(allRecords.filter(r => r.department === leftTeam));
  }, [allRecords, leftTeam]);

  const rightKPIs = useMemo(() => {
    if (!rightTeam) return null;
    return computeTeamKPIs(allRecords.filter(r => r.department === rightTeam));
  }, [allRecords, rightTeam]);

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
