'use client';
import { useEffect, useState } from 'react';
import { X, Clock, LogOut, LogIn, TrendingUp, Zap, AlertTriangle, Info, Tag, Edit2, Trash2, RotateCcw } from 'lucide-react';
import { EmployeeSummary, Holiday, LeaveRecord } from '@/lib/types';
import { getLateMinutes, getEarlyMinutes } from '@/lib/useDashboardData';
import { DEFAULT_THRESHOLDS } from '@/lib/settings';
import { durationToMinutes, effectiveMinutes, minutesToHHMM } from '@/lib/parseCSV';
import { actualMinutes } from '@/lib/hoursCalc';
import { getHolidayName } from '@/lib/holidays';
import {
  setEmployeeDepartment,
  deleteEmployee, restoreEmployee, isEmployeeDeleted,
} from '@/lib/employeeStore';
import { PersonalHeatmap } from './Charts';
import { LEAVE_COLORS, leaveLabelFor, UNMARKED_LEAVE_LABEL } from '@/lib/leaveLabels';
import InfoTooltip from './InfoTooltip';

interface EmployeePanelProps {
  employee: EmployeeSummary | null;
  onClose: () => void;
  readOnly?: boolean;
  // Leave is now owned entirely by the Leave Tracker (see
  // lib/leaveTrackerRead.ts, which live-reads it) — this panel should
  // never write leave data itself.
  // Kept separate from `readOnly` so department editing / delete-restore
  // (unrelated to leave) still work normally.
  leaveReadOnly?: boolean;
  holidays?: Holiday[];
  graceMinutes?: number;
  shiftStartMinutes?: number;
  shiftEndMinutes?: number;
  monthKey?: string;
  leaveMap?: Map<string, LeaveRecord>; // employeeCode__date -> LeaveRecord, synced in from Leave Tracker
  // Surfaces department-change / delete / restore failures to the app's
  // existing toast UI (see PROGRESS.md Sprint 2). Omitted in the read-only
  // Manager view, which never calls the write paths below.
  onToast?: (type: 'success' | 'error', message: string) => void;
  allDepartments?: string[]; // list of all available departments
  onDepartmentChange?: () => void; // callback when department changes
}

function minsToTimeStr(minsFromMidnight: number): string {
  if (minsFromMidnight < 0) return '—';
  const h = Math.floor(minsFromMidnight / 60);
  const m = minsFromMidnight % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function getStatusBadge(status: string, isShortDay: boolean | undefined, lateMin: number, earlyMin: number, leave?: LeaveRecord) {
  if (leave) {
    const label = leaveLabelFor(leave.leaveType, leave.halfDayLeaveType);
    return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${LEAVE_COLORS[leave.leaveType]}`}>{label}</span>;
  }
  if (isShortDay) return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-500/20 text-orange-400">Short Day</span>;
  const s = status.toLowerCase();
  const isMissedPunchOut = s.includes('missed punch') || s.includes('no outpunch') || s.includes('no punch out');
  if (isMissedPunchOut) {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-400 border border-orange-400/50" title="Punched in, no out-punch recorded — counted as present">Present ⚠</span>;
  }
  if (s.includes('present') && !s.includes('absent')) {
    if (lateMin > 0 && earlyMin > 0) {
      return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-400 border-2 border-red-500/60">Late + Early Exit</span>;
    }
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-400">Present</span>;
  }
  if (s.includes('absent')) return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400">{UNMARKED_LEAVE_LABEL}</span>;
  if (s.includes('weeklyoff')) return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--bg-elevated)]/50 text-[var(--text-muted)]">Weekly Off</span>;
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--bg-elevated)] text-[var(--text-muted)]">{status}</span>;
}

export default function EmployeePanel({
employee, onClose, readOnly, leaveReadOnly, holidays = [], graceMinutes = DEFAULT_THRESHOLDS.graceMinutes,  leaveMap, allDepartments = [], onDepartmentChange, onToast,
}: EmployeePanelProps) {
  const [showDeptEditor, setShowDeptEditor] = useState(false);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [, forceRerender] = useState(0);

  useEffect(() => {
    if (!employee) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); } };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [employee, onClose]);

  if (!employee) return null;

  const records = (employee.records || []).sort((a, b) => a.date.localeCompare(b.date));

  async function changeDepartment(newDept: string) {
    if (!employee) return;
    setShowDeptEditor(false);
    if (newDept === employee.department) return; // no actual change
    const result = await setEmployeeDepartment(employee.employeeCode, employee.officeCode, newDept, employee.employeeName);
    if (!result.success) {
      onToast?.('error', result.error ?? 'Could not save the department change.');
      return; // directory was not updated locally — nothing else to refresh
    }
    onDepartmentChange?.();
    forceRerender(v => v + 1);
  }

  async function handleDelete() {
    if (!employee) return;
    if (!window.confirm(`Delete ${employee.employeeName}? They'll be hidden from every chart, table, and export — even if they still appear in future CSV uploads. You can restore them from Settings → Employees.`)) return;
    const result = await deleteEmployee(employee.employeeCode, employee.officeCode, employee.employeeName);
    if (!result.success) {
      onToast?.('error', result.error ?? 'Could not delete employee.');
      return; // keep the panel open — the employee was not actually removed
    }
    onDepartmentChange?.();
    onClose(); // nothing left to show — they're excluded from every list now
  }

  async function handleRestore() {
    if (!employee) return;
    const result = await restoreEmployee(employee.employeeCode, employee.officeCode);
    if (!result.success) {
      onToast?.('error', result.error ?? 'Could not restore employee.');
      return;
    }
    onDepartmentChange?.();
    forceRerender(v => v + 1);
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full md:w-[480px] bg-[var(--bg-surface)] border-l border-[var(--border)] z-50 flex flex-col shadow-2xl transition-transform duration-200 ease-out">
        <div className="flex items-start justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div className="flex-1">
            <h3 className="text-[var(--text-primary)] font-semibold text-base">{employee.employeeName}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {!showDeptEditor ? (
                <>
                  <span className="text-[var(--text-muted)] text-xs">{employee.department}</span>
                  {!readOnly && (
                    <button
                      onClick={() => {
                        setShowDeptEditor(true);
                        setSelectedDept(employee.department);
                      }}
                      className="text-[var(--text-muted)] hover:text-blue-400 transition-colors"
                      title="Change department"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                  )}
                </>
              ) : (
                <select
                  autoFocus
                  value={selectedDept || ''}
                  onChange={e => setSelectedDept(e.target.value)}
                  onBlur={() => changeDepartment(selectedDept || employee.department)}
                  className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-2 py-0.5 text-xs text-[var(--text-primary)]"
                >
                  {allDepartments.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              {isEmployeeDeleted(employee.employeeCode, employee.officeCode) && (
                <span className="text-red-400 text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20">Deleted</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {!readOnly && (
              isEmployeeDeleted(employee.employeeCode, employee.officeCode) ? (
                <button onClick={handleRestore} className="text-[var(--text-muted)] hover:text-emerald-400 transition-colors p-1" title="Restore employee">
                  <RotateCcw className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={handleDelete} className="text-[var(--text-muted)] hover:text-red-400 transition-colors p-1" title="Delete employee">
                  <Trash2 className="w-4 h-4" />
                </button>
              )
            )}
            <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto">
          {(employee.frequentPunchDays || employee.plannedLeaveCount || employee.casualLeaveCount || employee.sickLeaveCount || employee.lwpCount || employee.halfDayCount) ? (
            <div className="px-5 pt-4 pb-2 flex flex-wrap gap-2">
              {!!employee.frequentPunchDays && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
                  <Zap className="w-3 h-3" />
                  ⚡ Frequent Punch ({employee.frequentPunchDays}d)
                </span>
              )}
              {([
                ['plannedLeaveCount', 'Planned'], ['casualLeaveCount', 'Casual'], ['sickLeaveCount', 'Sick'],
                ['lwpCount', 'LWP'], ['halfDayCount', 'Half Day'],
              ] as const).map(([key, label]) => {
                const v = employee[key];
                if (!v) return null;
                return (
                  <span key={key} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/15 text-blue-400 border border-blue-500/20">
                    <Tag className="w-3 h-3" /> {v} {label}
                  </span>
                );
              })}
            </div>
          ) : null}

          <div className="px-5 pb-4">
            <h4 className="text-[var(--text-muted)] text-xs font-semibold uppercase tracking-wide mb-2">Attendance Pattern</h4>
            <div className="bg-[var(--bg-elevated)]/50 rounded-xl border border-[var(--border)]/50 p-3">
              <PersonalHeatmap records={records} leaveMap={leaveMap} />
            </div>
          </div>

          <div className="px-5 pb-4">
            <div className="bg-[var(--bg-elevated)]/50 rounded-xl border border-[var(--border)]/50 p-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="flex items-start gap-2">
                <Clock className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[var(--text-muted)] text-[10px]">Avg Late</p>
                  <p className="text-[var(--text-primary)] text-xs font-medium">{(employee.avgLateMinutes ?? 0) > 0 ? `${employee.avgLateMinutes} min` : 'Never'}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <LogOut className="w-3.5 h-3.5 text-orange-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[var(--text-muted)] text-[10px]">Avg Early Exit</p>
                  <p className="text-[var(--text-primary)] text-xs font-medium">{(employee.avgEarlyExitMinutes ?? 0) > 0 ? `${employee.avgEarlyExitMinutes} min` : 'None'}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[var(--text-muted)] text-[10px]">Latest In-Time</p>
                  <p className="text-[var(--text-primary)] text-xs font-medium">{minsToTimeStr(employee.latestInTime ?? -1)}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-blue-400 mt-0.5 flex-shrink-0 rotate-180" />
                <div>
                  <p className="text-[var(--text-muted)] text-[10px]">Earliest Out</p>
                  <p className="text-[var(--text-primary)] text-xs font-medium">{minsToTimeStr(employee.earliestOutTime ?? -1)}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <LogIn className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[var(--text-muted)] text-[10px]">Avg In-Time</p>
                  <p className="text-[var(--text-primary)] text-xs font-medium">
                    {employee.avgInTime !== undefined ? minsToTimeStr(employee.avgInTime) : '—'}
                    {employee.inTimeDeviation !== undefined && (
                      <span className="text-[var(--text-muted)] font-normal"> ± {Math.round(employee.inTimeDeviation)}m</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <LogOut className="w-3.5 h-3.5 text-cyan-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[var(--text-muted)] text-[10px]">Avg Out-Time</p>
                  <p className="text-[var(--text-primary)] text-xs font-medium">
                    {employee.avgOutTime !== undefined ? minsToTimeStr(employee.avgOutTime) : '—'}
                    {employee.outTimeDeviation !== undefined && (
                      <span className="text-[var(--text-muted)] font-normal"> ± {Math.round(employee.outTimeDeviation)}m</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="px-5 pb-6">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[var(--text-muted)] text-xs font-semibold uppercase tracking-wide">Day-wise Records</h4>
              <span className="text-[var(--text-muted)] text-[10px]">Leave shown here is recorded in Leave Tracker</span>
            </div>
            <div className="rounded-xl border border-[var(--border)]/50 overflow-x-auto">
              <table className="w-full text-xs min-w-[480px]">
                <thead>
                  <tr className="bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-2 py-2 text-left font-medium">Status</th>
                    <th className="px-2 py-2 text-left font-medium">In</th>
                    <th className="px-2 py-2 text-left font-medium">Out</th>
                    <th className="px-2 py-2 text-left font-medium">
                      <span className="inline-flex items-center gap-0.5">
                        Actual
                        <InfoTooltip
                          title="Actual Hours"
                          description="Raw punch duration for the day, lunch included — the out-punch minus the in-punch, unchanged."
                          position="bottom"
                        />
                      </span>
                    </th>
                    <th className="px-2 py-2 text-left font-medium">
                      <span className="inline-flex items-center gap-0.5">
                        Effective
                        <InfoTooltip
                          title="Effective Hours"
                          description="Actual hours minus a 60-minute lunch. Shown as — on days with 60 minutes or less of raw duration, since there isn't enough time recorded to meaningfully subtract a lunch."
                          formula="Effective = Actual − 60 min lunch (only when Actual > 60 min)"
                          position="bottom"
                        />
                      </span>
                    </th>
                    <th className="px-2 py-2 text-left font-medium">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => {
                    const holidayName = getHolidayName(r.date, holidays);
                    const lateMin = getLateMinutes(r, graceMinutes);
                    const earlyMin = getEarlyMinutes(r, graceMinutes);
                    const missingOut = (!r.outTime || r.outTime === '--' || r.outTime === '') &&
                      (r.status.toLowerCase().includes('present') || r.status.toLowerCase().includes('missed punch'));
                    const dur = durationToMinutes(r.duration);
                    const leave = leaveMap?.get(`${r.employeeCode}__${r.date}`);

                    if (holidayName) {
                      return (
                        <tr key={i} className="border-t border-[var(--border)]/50 bg-purple-900/10">
                          <td className="px-3 py-2 text-[var(--text-muted)] font-mono">{r.date.slice(5)}</td>
                          <td colSpan={6} className="px-2 py-2 text-purple-400 text-[10px]">🗓 {holidayName}</td>
                        </tr>
                      );
                    }

                    // Actual = raw duration, lunch included. Effective = lunch
                    // subtracted (null when there isn't enough duration to
                    // subtract from). Shared with the rest of the app via
                    // lib/hoursCalc.ts so this never drifts from the
                    // Executive/Department Summary export numbers again.
                    const actualMins = actualMinutes(dur);
                    const effMins = effectiveMinutes(dur);

                    return (
                      <tr key={i} className={`border-t border-[var(--border)]/50 hover:bg-[var(--bg-elevated)]/30 ${r.isShortDay ? 'bg-orange-900/10' : ''}`}>
                        <td className="px-3 py-2 text-[var(--text-muted)] font-mono">{r.date.slice(5)}</td>
                        <td className="px-2 py-2">{getStatusBadge(r.status, r.isShortDay, lateMin, earlyMin, leave)}</td>
                        <td className="px-2 py-2 text-[var(--text-muted)]">{r.inTime || '—'}</td>
                        <td className={`px-2 py-2 ${missingOut ? 'bg-orange-500/10 border border-orange-500/20 text-orange-400' : 'text-[var(--text-muted)]'}`}>
                          {missingOut ? <span title="Missing out-punch — duration may be inaccurate">⚠ —</span> : (r.outTime || '—')}
                        </td>
                        <td className="px-2 py-2 text-slate-400">{dur > 0 ? minutesToHHMM(effectiveMinutes(dur)) : '—'}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1 relative">
                            {lateMin > 0 && (
                              <span className="text-amber-400 flex items-center" title={`${lateMin}m late${r.lateIsEstimated ? ' (estimated — no Late By value in source data)' : ' (from machine)'}`}>
                                🕐{r.lateIsEstimated && <Info className="w-2.5 h-2.5 ml-0.5 text-[var(--text-muted)]" />}
                              </span>
                            )}
                            {earlyMin > 0 && (
                              <span className="text-blue-400 flex items-center" title={`${earlyMin}m early${r.earlyIsEstimated ? ' (estimated — no Early By value in source data)' : ' (from machine)'}`}>
                                ⬅{r.earlyIsEstimated && <Info className="w-2.5 h-2.5 ml-0.5 text-[var(--text-muted)]" />}
                              </span>
                            )}
                            {(r.punchCount ?? 1) >= 3 && <span className="text-amber-400" title="Frequent punch">⚡</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}