'use client';
import { useEffect, useState } from 'react';
import { X, Clock, LogOut, LogIn, TrendingUp, Zap, AlertTriangle, Info, Tag, Edit2, Trash2, RotateCcw } from 'lucide-react';
import { EmployeeSummary, Holiday, LeaveType, LeaveRecord } from '@/lib/types';
import { getLateMinutes, getEarlyMinutes } from '@/lib/useDashboardData';
import { DEFAULT_THRESHOLDS } from '@/lib/settings';
import { durationToMinutes, effectiveMinutes, minutesToHHMM } from '@/lib/parseCSV';
import { getHolidayName } from '@/lib/holidays';
import { upsertLeaveRecord, deleteLeaveRecord } from '@/lib/leaveStorage';
import {
  setEmployeeDepartment, clearEmployeeDepartmentOverride, getEmployeeDepartmentOverride,
  deleteEmployee, restoreEmployee, isEmployeeDeleted,
} from '@/lib/employeeStore';
import { PersonalHeatmap } from './Charts';

interface EmployeePanelProps {
  employee: EmployeeSummary | null;
  onClose: () => void;
  readOnly?: boolean;
  holidays?: Holiday[];
  graceMinutes?: number;
  shiftStartMinutes?: number;
  shiftEndMinutes?: number;
  monthKey?: string; // needed to persist leave marks (B7.2)
  leaveMap?: Map<string, LeaveRecord>; // employeeCode__date -> LeaveRecord
  onLeaveChange?: () => void;
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

const LEAVE_LABELS: Record<LeaveType, string> = {
  planned: 'Planned Leave',
  casual: 'Casual Leave',
  sick: 'Sick Leave',
  lwp: 'LWP',
  half_day: 'Half Day',
};

const LEAVE_COLORS: Record<LeaveType, string> = {
  planned: 'bg-blue-500/20 text-blue-400',
  casual: 'bg-cyan-500/20 text-cyan-400',
  sick: 'bg-violet-500/20 text-violet-400',
  lwp: 'bg-orange-500/20 text-orange-400',
  half_day: 'bg-amber-500/20 text-amber-400',
};

function getStatusBadge(status: string, isShortDay: boolean | undefined, lateMin: number, earlyMin: number, leave?: LeaveRecord) {
  if (leave) {
    const label = leave.leaveType === 'half_day' && leave.halfDayLeaveType
      ? `Half Day — ${LEAVE_LABELS[leave.halfDayLeaveType]}`
      : LEAVE_LABELS[leave.leaveType];
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
  if (s.includes('absent')) return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400">Absent</span>;
  if (s.includes('weeklyoff')) return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-600/50 text-slate-400">Weekly Off</span>;
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-700 text-slate-300">{status}</span>;
}

export default function EmployeePanel({
  employee, onClose, readOnly, holidays = [], graceMinutes = DEFAULT_THRESHOLDS.graceMinutes,
  monthKey, leaveMap, onLeaveChange, allDepartments = [], onDepartmentChange,
}: EmployeePanelProps) {
  const [leavePopoverFor, setLeavePopoverFor] = useState<string | null>(null);
  const [showDeptEditor, setShowDeptEditor] = useState(false);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [, forceRerender] = useState(0);

  useEffect(() => {
    if (!employee) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setLeavePopoverFor(null); onClose(); } };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [employee, onClose]);

  if (!employee) return null;

  const records = (employee.records || []).sort((a, b) => a.date.localeCompare(b.date));

  async function markLeave(date: string, employeeCode: string, officeCode: string, leaveType: LeaveType, halfDayLeaveType?: LeaveType) {
    if (!monthKey) return;
    const record: LeaveRecord = {
      employeeCode, officeCode, date, leaveType, halfDayLeaveType,
      markedAt: new Date().toISOString(),
    };
    setLeavePopoverFor(null);
    await upsertLeaveRecord(monthKey, record);
    onLeaveChange?.();
    forceRerender(v => v + 1);
  }

  async function clearLeave(date: string, employeeCode: string) {
    if (!monthKey) return;
    setLeavePopoverFor(null);
    await deleteLeaveRecord(monthKey, employeeCode, date);
    onLeaveChange?.();
    forceRerender(v => v + 1);
  }

  async function changeDepartment(newDept: string) {
    if (!employee) return;
    setShowDeptEditor(false);
    if (newDept === employee.department) {
      await clearEmployeeDepartmentOverride(employee.employeeCode, employee.officeCode);
    } else {
      await setEmployeeDepartment(employee.employeeCode, employee.officeCode, newDept, employee.employeeName);
    }
    onDepartmentChange?.();
    forceRerender(v => v + 1);
  }

  async function handleDelete() {
    if (!employee) return;
    if (!window.confirm(`Delete ${employee.employeeName}? They'll be hidden from every chart, table, and export — even if they still appear in future CSV uploads. You can restore them from Settings → Employees.`)) return;
    await deleteEmployee(employee.employeeCode, employee.officeCode, employee.employeeName);
    onDepartmentChange?.();
    onClose(); // nothing left to show — they're excluded from every list now
  }

  async function handleRestore() {
    if (!employee) return;
    await restoreEmployee(employee.employeeCode, employee.officeCode);
    onDepartmentChange?.();
    forceRerender(v => v + 1);
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full md:w-[480px] bg-slate-900 border-l border-slate-700 z-50 flex flex-col shadow-2xl transition-transform duration-200 ease-out">
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <div className="flex-1">
            <h3 className="text-white font-semibold text-base">{employee.employeeName}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {!showDeptEditor ? (
                <>
                  <span className="text-slate-400 text-xs">{employee.department}</span>
                  {!readOnly && (
                    <button
                      onClick={() => {
                        setShowDeptEditor(true);
                        setSelectedDept(getEmployeeDepartmentOverride(employee.employeeCode, employee.officeCode) || employee.department);
                      }}
                      className="text-slate-500 hover:text-blue-400 transition-colors"
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
                  onKeyDown={e => {
                    if (e.key === 'Enter') changeDepartment(selectedDept || employee.department);
                    if (e.key === 'Escape') setShowDeptEditor(false);
                  }}
                  className="bg-slate-700 border border-blue-500 text-white text-xs px-2 py-0.5 rounded focus:outline-none"
                >
                  {allDepartments.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              )}
              <span className="text-slate-600">·</span>
              <span className="bg-blue-600/20 text-blue-400 text-[10px] font-medium px-1.5 py-0.5 rounded">{employee.officeCode}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 mt-0.5 flex-shrink-0">
            {!readOnly && (
              isEmployeeDeleted(employee.employeeCode, employee.officeCode) ? (
                <button onClick={handleRestore} className="text-emerald-400 hover:text-emerald-300 transition-colors p-1" title="Restore employee">
                  <RotateCcw className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={handleDelete} className="text-red-400/70 hover:text-red-400 transition-colors p-1" title="Delete employee">
                  <Trash2 className="w-4 h-4" />
                </button>
              )
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Present', value: employee.presentDays, color: 'text-emerald-400' },
              { label: 'Absent', value: employee.absentDays, color: 'text-red-400' },
              { label: 'Late', value: employee.lateCount, color: 'text-amber-400' },
              { label: 'Early Exit', value: employee.earlyExitCount, color: 'text-amber-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-slate-800 rounded-xl p-3 text-center">
                <p className={`text-xl font-bold ${color}`}>{value}</p>
                <p className="text-slate-500 text-[10px] mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {(employee.shortDayCount > 0 || employee.frequentPunchDays > 0 || (employee.missedPunchOutCount ?? 0) > 0 || employee.plannedLeaveCount > 0 || employee.casualLeaveCount > 0 || employee.sickLeaveCount > 0 || employee.lwpCount > 0 || employee.halfDayCount > 0) && (
            <div className="px-5 pb-3 flex flex-wrap gap-2">
              {employee.shortDayCount > 0 && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-500/15 text-orange-400 border border-orange-500/20">
                  <AlertTriangle className="w-3 h-3" />
                  {employee.shortDayCount} Short Day{employee.shortDayCount > 1 ? 's' : ''}
                </span>
              )}
              {(employee.missedPunchOutCount ?? 0) > 0 && (
                <span
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-500/15 text-orange-400 border border-orange-500/20"
                  title="Counted as present — out-punch wasn't captured by the machine, worth a manual check"
                >
                  <AlertTriangle className="w-3 h-3" />
                  {employee.missedPunchOutCount} Missed Punch Out{(employee.missedPunchOutCount ?? 0) > 1 ? 's' : ''}
                </span>
              )}
              {employee.frequentPunchDays > 0 && (
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
          )}

          <div className="px-5 pb-4">
            <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-2">Attendance Pattern</h4>
            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-3">
              <PersonalHeatmap records={records} />
            </div>
          </div>

          <div className="px-5 pb-4">
            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="flex items-start gap-2">
                <Clock className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-slate-500 text-[10px]">Avg Late</p>
                  <p className="text-white text-xs font-medium">{(employee.avgLateMinutes ?? 0) > 0 ? `${employee.avgLateMinutes} min` : 'Never'}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <LogOut className="w-3.5 h-3.5 text-orange-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-slate-500 text-[10px]">Avg Early Exit</p>
                  <p className="text-white text-xs font-medium">{(employee.avgEarlyExitMinutes ?? 0) > 0 ? `${employee.avgEarlyExitMinutes} min` : 'None'}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-slate-500 text-[10px]">Latest In-Time</p>
                  <p className="text-white text-xs font-medium">{minsToTimeStr(employee.latestInTime ?? -1)}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-blue-400 mt-0.5 flex-shrink-0 rotate-180" />
                <div>
                  <p className="text-slate-500 text-[10px]">Earliest Out</p>
                  <p className="text-white text-xs font-medium">{minsToTimeStr(employee.earliestOutTime ?? -1)}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <LogIn className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-slate-500 text-[10px]">Avg In-Time</p>
                  <p className="text-white text-xs font-medium">
                    {employee.avgInTime !== undefined ? minsToTimeStr(employee.avgInTime) : '—'}
                    {employee.inTimeDeviation !== undefined && (
                      <span className="text-slate-500 font-normal"> ± {Math.round(employee.inTimeDeviation)}m</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <LogOut className="w-3.5 h-3.5 text-cyan-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-slate-500 text-[10px]">Avg Out-Time</p>
                  <p className="text-white text-xs font-medium">
                    {employee.avgOutTime !== undefined ? minsToTimeStr(employee.avgOutTime) : '—'}
                    {employee.outTimeDeviation !== undefined && (
                      <span className="text-slate-500 font-normal"> ± {Math.round(employee.outTimeDeviation)}m</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="px-5 pb-6">
            <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-2">Day-wise Records</h4>
            <div className="rounded-xl border border-slate-700/50 overflow-x-auto">
              <table className="w-full text-xs min-w-[480px]">
                <thead>
                  <tr className="bg-slate-800 text-slate-500">
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-2 py-2 text-left font-medium">Status</th>
                    <th className="px-2 py-2 text-left font-medium">In</th>
                    <th className="px-2 py-2 text-left font-medium">Out</th>
                    <th className="px-2 py-2 text-left font-medium">Hrs</th>
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
                    const canMarkLeave = !readOnly && monthKey && (r.isShortDay || r.status.toLowerCase().includes('absent'));
                    const rowKey = `${r.employeeCode}__${r.date}`;

                    if (holidayName) {
                      return (
                        <tr key={i} className="border-t border-slate-800/50 bg-purple-900/10">
                          <td className="px-3 py-2 text-slate-500 font-mono">{r.date.slice(5)}</td>
                          <td colSpan={5} className="px-2 py-2 text-purple-400 text-[10px]">🗓 {holidayName}</td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={i} className={`border-t border-slate-800/50 hover:bg-slate-800/30 ${r.isShortDay ? 'bg-orange-900/10' : ''}`}>
                        <td className="px-3 py-2 text-slate-400 font-mono">{r.date.slice(5)}</td>
                        <td className="px-2 py-2">{getStatusBadge(r.status, r.isShortDay, lateMin, earlyMin, leave)}</td>
                        <td className="px-2 py-2 text-slate-300">{r.inTime || '—'}</td>
                        <td className={`px-2 py-2 ${missingOut ? 'bg-orange-500/10 border border-orange-500/20 text-orange-400' : 'text-slate-300'}`}>
                          {missingOut ? <span title="Missing out-punch — duration may be inaccurate">⚠ —</span> : (r.outTime || '—')}
                        </td>
                        <td className="px-2 py-2 text-slate-400">{dur > 0 ? minutesToHHMM(effectiveMinutes(dur)) : '—'}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1 relative">
                            {lateMin > 0 && (
                              <span className="text-amber-400 flex items-center" title={`${lateMin}m late${r.lateIsEstimated ? ' (estimated — no Late By value in source data)' : ' (from machine)'}`}>
                                🕐{r.lateIsEstimated && <Info className="w-2.5 h-2.5 ml-0.5 text-slate-500" />}
                              </span>
                            )}
                            {earlyMin > 0 && (
                              <span className="text-blue-400 flex items-center" title={`${earlyMin}m early${r.earlyIsEstimated ? ' (estimated — no Early By value in source data)' : ' (from machine)'}`}>
                                ⬅{r.earlyIsEstimated && <Info className="w-2.5 h-2.5 ml-0.5 text-slate-500" />}
                              </span>
                            )}
                            {(r.punchCount ?? 1) >= 3 && <span className="text-amber-400" title="Frequent punch">⚡</span>}
                            {canMarkLeave && (
                              <button
                                onClick={() => setLeavePopoverFor(leavePopoverFor === rowKey ? null : rowKey)}
                                className="text-slate-500 hover:text-blue-400 transition-colors ml-1"
                                title="Mark Leave"
                              >
                                <Tag className="w-3 h-3" />
                              </button>
                            )}
                            {leavePopoverFor === rowKey && (
                              <LeavePicker
                                isShortDay={!!r.isShortDay}
                                onPick={(type, half) => markLeave(r.date, r.employeeCode, r.officeCode, type, half)}
                                onClear={leave ? () => clearLeave(r.date, r.employeeCode) : undefined}
                                onDismiss={() => setLeavePopoverFor(null)}
                              />
                            )}
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

function LeavePicker({ isShortDay, onPick, onClear, onDismiss }: {
  isShortDay: boolean;
  onPick: (type: LeaveType, halfDayLeaveType?: LeaveType) => void;
  onClear?: () => void;
  onDismiss: () => void;
}) {
  const [halfDaySub, setHalfDaySub] = useState(false);

  return (
    <div className="absolute right-0 top-6 z-50 bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-2 w-48 text-xs" onClick={(e) => e.stopPropagation()}>
      {!halfDaySub ? (
        <div className="space-y-0.5">
          {(['planned', 'casual', 'sick', 'lwp'] as LeaveType[]).map((t) => (
            <button key={t} onClick={() => onPick(t)} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200">
              {LEAVE_LABELS[t]}
            </button>
          ))}
          {isShortDay && (
            <button onClick={() => setHalfDaySub(true)} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200">
              Half Day →
            </button>
          )}
          {onClear && (
            <button onClick={onClear} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-red-500/10 text-red-400 border-t border-slate-800 mt-1 pt-1.5">
              Clear marking
            </button>
          )}
          <button onClick={onDismiss} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-800 text-slate-500">
            Dismiss
          </button>
        </div>
      ) : (
        <div className="space-y-0.5">
          <p className="text-slate-500 text-[10px] px-2 pb-1">Half Day — covering leave type:</p>
          {(['planned', 'casual', 'sick', 'lwp'] as LeaveType[]).map((t) => (
            <button key={t} onClick={() => onPick('half_day', t)} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200">
              {LEAVE_LABELS[t]}
            </button>
          ))}
          <button onClick={() => setHalfDaySub(false)} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-800 text-slate-500 border-t border-slate-800 mt-1 pt-1.5">
            ← Back
          </button>
        </div>
      )}
    </div>
  );
}