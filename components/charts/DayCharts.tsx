'use client';
import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, LabelList,
} from 'recharts';
import { ArrowLeft } from 'lucide-react';
import { DayDeptSnapshot, AttendanceRecord, LeaveRecord } from '@/lib/types';
import { isPresent, isWeeklyOff, getLateMinutes, getEarlyMinutes, computeProductivityLostMinutes } from '@/lib/useDashboardData';
import { minutesToHHMM } from '@/lib/parseCSV';
import { leaveLabelFor, UNMARKED_LEAVE_LABEL } from '@/lib/leaveLabels';
import InfoTooltip from '../InfoTooltip';
import { useThemeColors } from '@/lib/useThemeColors';
import { getDepartmentFromClick, DayNavProps } from './chartUtils';
import { DayNav } from './ChartShared';

function leaveKey(employeeCode: string, date: string): string {
  return `${employeeCode}__${date}`;
}

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
        <div className="scroll-thin space-y-1 max-h-[240px] overflow-y-auto">
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
            <div className="scroll-thin space-y-1 max-h-[240px] overflow-y-auto">
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
            <div className="scroll-thin space-y-1 max-h-[240px] overflow-y-auto">
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
              <CartesianGrid strokeDasharray="3 3" stroke={__tc.border} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: __tc.mutedText }} tickFormatter={(v: number) => minutesToHHMM(Math.round(v * 60))} />
              <YAxis type="category" dataKey="department" tick={{ fontSize: 10, fill: __tc.mutedText }} width={100} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const d: DayDeptSnapshot = payload[0]?.payload;
                return (
                  <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-xs shadow-xl">
                    <p className="text-[var(--text-primary)] font-semibold mb-1">{label}</p>
                    <p className="text-amber-600 dark:text-amber-400 font-medium">Hours Lost: <strong>{minutesToHHMM(Math.round(d.hoursLost * 60))}</strong></p>
                    <p className="text-[var(--text-muted)] text-[11px] mt-0.5">Late: {d.lateCount} · Early exit: {d.earlyCount}</p>
                    <p className="text-[var(--accent)] text-[10px] font-medium mt-1">Click to see employees →</p>
                  </div>
                );
              }} />
              <Bar dataKey="hoursLost" name="Hours Lost" radius={[0, 4, 4, 0]} cursor="pointer" isAnimationActive={false}>
                {sorted.map((entry, i) => (
                  <Cell key={i} fill={entry.hoursLost > 5 ? '#f87171' : entry.hoursLost > 2 ? '#fbbf24' : '#fb923c'} />
                ))}
                <LabelList dataKey="hoursLost" position="right" style={{ fontSize: 10, fill: __tc.mutedText }} formatter={(v: any) => minutesToHHMM(Math.round(Number(v) * 60))} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}
