'use client';
import { X, Clock, LogOut, TrendingUp, TrendingDown } from 'lucide-react';
import { EmployeeSummary } from '@/lib/types';

interface EmployeeModalProps {
  employee: EmployeeSummary | null;
  onClose: () => void;
  readOnly?: boolean;
}

function minutesToHHMM(mins: number): string {
  if (mins <= 0) return '0:00';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

function minsToTimeStr(minsFromMidnight: number): string {
  if (minsFromMidnight < 0) return '—';
  const h = Math.floor(minsFromMidnight / 60);
  const m = minsFromMidnight % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export default function EmployeeModal({ employee, onClose, readOnly = false }: EmployeeModalProps) {
  if (!employee) return null;

  const total = employee.presentDays + employee.absentDays;
  const rate = total > 0 ? ((employee.presentDays / total) * 100).toFixed(1) : '0';
  const dayWise = employee.dayWiseLateEarly || [];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700 flex-shrink-0">
          <div>
            <h3 className="text-white font-semibold">{employee.employeeName}</h3>
            <p className="text-slate-400 text-sm">{employee.department} · {employee.officeCode}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Summary grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { label: 'Present Days', value: employee.presentDays, color: 'text-emerald-400' },
              { label: 'Absent Days', value: employee.absentDays, color: 'text-red-400' },
              { label: 'Attendance', value: `${rate}%`, color: 'text-white' },
              { label: 'Late Count', value: employee.lateCount, color: 'text-amber-400' },
              { label: 'Early Exits', value: employee.earlyExitCount, color: 'text-amber-400' },
              { label: 'Avg Hours/Day', value: employee.avgHoursWorked, color: 'text-blue-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-slate-700/50 rounded-xl p-3">
                <p className="text-slate-400 text-xs mb-1">{label}</p>
                <p className={`text-lg font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Drill-down insights */}
          <div className="bg-slate-700/30 rounded-xl border border-slate-600/40 p-4 space-y-3">
            <h4 className="text-slate-300 text-xs font-semibold uppercase tracking-wide">Punctuality Insights</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-slate-400 text-xs">Avg Late Arrival</p>
                  <p className="text-white text-sm font-semibold">
                    {(employee.avgLateMinutes ?? 0) > 0
                      ? `avg ${employee.avgLateMinutes} mins late`
                      : 'Never late'}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <LogOut className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-slate-400 text-xs">Avg Early Exit</p>
                  <p className="text-white text-sm font-semibold">
                    {(employee.avgEarlyExitMinutes ?? 0) > 0
                      ? `avg ${employee.avgEarlyExitMinutes} mins early`
                      : 'No early exits'}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <TrendingUp className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-slate-400 text-xs">Latest In-Time</p>
                  <p className="text-white text-sm font-semibold">
                    {minsToTimeStr(employee.latestInTime ?? -1)}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <TrendingDown className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-slate-400 text-xs">Earliest Out-Time</p>
                  <p className="text-white text-sm font-semibold">
                    {minsToTimeStr(employee.earliestOutTime ?? -1)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Day-wise late/early list */}
          {dayWise.length > 0 && (
            <div>
              <h4 className="text-slate-300 text-xs font-semibold uppercase tracking-wide mb-2">
                Day-wise Late / Early Records ({dayWise.length} days)
              </h4>
              <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                {dayWise.map((d) => (
                  <div key={d.date} className="flex items-center justify-between flex-wrap gap-1 bg-slate-700/30 rounded-lg px-3 py-2 text-xs">
                    <span className="text-slate-300 font-mono">{d.date}</span>
                    <span className="text-slate-400">{d.inTime || '—'} → {d.outTime || '—'}</span>
                    <div className="flex gap-2">
                      {d.lateMinutes > 0 && (
                        <span className="bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">+{d.lateMinutes}m late</span>
                      )}
                      {d.earlyMinutes > 0 && (
                        <span className="bg-orange-500/20 text-orange-300 px-1.5 py-0.5 rounded">-{d.earlyMinutes}m early</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dayWise.length === 0 && (
            <div className="text-center py-2">
              <p className="text-emerald-400 text-sm font-medium">✓ No late arrivals or early exits this month</p>
            </div>
          )}

          {readOnly && (
            <p className="text-slate-500 text-xs text-center">Read-only view — no edits allowed</p>
          )}
        </div>
      </div>
    </div>
  );
}
