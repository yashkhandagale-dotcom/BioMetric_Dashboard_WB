'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import RecordLeaveDrawer from './RecordLeaveDrawer';
import type { SubmitResult } from './RecordLeaveForm';
import type { HalfDayCandidate } from '@/lib/attendanceExceptions';

// "Possible Half Day / Missed Punch" accordion. Three actions per row:
//   - Mark Half Day: opens the same RecordLeaveDrawer/RecordLeaveForm used
//     everywhere else, preset to half-day + today's date. HR still picks
//     which leave type (Half Sick/Casual/Paid Leave = leaveTypeCode + the
//     existing is_half_day flag — no new leave types were invented, this
//     composes two fields the form already had).
//   - Mark Missed Punch: does NOT create leave. Writes to `missed_punch`
//     only, via /api/leave/attendance/resolve.
//   - Ignore: marks the exception reviewed with no other side effect.
export default function PossibleHalfDayAccordion({ date }: { date?: string }) {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<HalfDayCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerEmployeeId, setDrawerEmployeeId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = date ? `?date=${encodeURIComponent(date)}` : '';
      const res = await fetch(`/api/leave/attendance/exceptions${qs}`);
      const text = await res.text();
      const body = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setError(body.error || `Could not load candidates (${res.status}).`);
        return;
      }
      setRows(body.halfDayCandidates ?? []);
    } catch {
      setError('Could not reach the server to load candidates.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  const drawerRow = rows.find((r) => r.employeeId === drawerEmployeeId);
  const effectiveDate = date ?? new Date().toISOString().slice(0, 10);

  async function resolve(row: HalfDayCandidate, action: 'ignore' | 'missed_punch', note?: string) {
    setBusyId(row.employeeId);
    try {
      await fetch('/api/leave/attendance/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: row.employeeId,
          date: effectiveDate,
          action,
          note,
          first_punch: row.firstPunch,
          last_punch: row.lastPunch,
        }),
      });
      setRefreshSignal((s) => s + 1);
    } finally {
      setBusyId(null);
    }
  }

  async function handleHalfDayRecorded(result: SubmitResult) {
    if (!drawerRow) return;
    try {
      await fetch('/api/leave/attendance/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: drawerRow.employeeId,
          date: effectiveDate,
          action: 'half_day',
          leave_request_id: result.leave_request.id,
          first_punch: drawerRow.firstPunch,
          last_punch: drawerRow.lastPunch,
        }),
      });
    } finally {
      setRefreshSignal((s) => s + 1);
    }
  }

  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-white font-semibold text-sm">
          Possible Half Day / Missed Punch{' '}
          {!loading && <span className="text-slate-500 font-normal">({rows.length})</span>}
        </span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-slate-700">
          {error && (
            <div className="m-3 bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          {loading ? (
            <p className="px-4 py-6 text-center text-slate-500 text-sm">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-slate-500 text-sm">Nothing to review for this date.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs border-b border-slate-700">
                    <th className="text-left font-medium px-4 py-2">Employee</th>
                    <th className="text-left font-medium px-4 py-2">Working Hours</th>
                    <th className="text-left font-medium px-4 py-2">First Punch</th>
                    <th className="text-left font-medium px-4 py-2">Last Punch</th>
                    <th className="text-left font-medium px-4 py-2">Reason</th>
                    <th className="text-left font-medium px-4 py-2">Status</th>
                    <th className="text-left font-medium px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.employeeId} className="border-b border-slate-800 last:border-0">
                      <td className="px-4 py-2 text-white">
                        {r.employeeName}
                        <span className="text-slate-500"> · {r.employeeCode}</span>
                      </td>
                      <td className="px-4 py-2 text-slate-300">{r.workingHours}</td>
                      <td className="px-4 py-2 text-slate-300">{r.firstPunch ?? '--'}</td>
                      <td className="px-4 py-2 text-slate-300">{r.lastPunch ?? '--'}</td>
                      <td className="px-4 py-2 text-slate-400 text-xs">{r.reason}</td>
                      <td className="px-4 py-2">
                        <span className="border border-amber-500/30 bg-amber-900/30 text-amber-300 rounded-full px-2 py-0.5 text-xs">
                          {r.status || 'Review'}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            disabled={busyId === r.employeeId}
                            onClick={() => setDrawerEmployeeId(r.employeeId)}
                            className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium px-2 py-1 rounded-lg transition-colors"
                          >
                            Mark Half Day
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.employeeId}
                            onClick={() => resolve(r, 'missed_punch')}
                            className="text-xs border border-amber-500/40 hover:border-amber-400 text-amber-300 hover:text-amber-200 disabled:opacity-50 font-medium px-2 py-1 rounded-lg transition-colors"
                          >
                            Mark Missed Punch
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.employeeId}
                            onClick={() => resolve(r, 'ignore')}
                            className="text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 disabled:opacity-50 px-2 py-1 rounded-lg transition-colors"
                          >
                            Ignore
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {drawerRow && (
        <RecordLeaveDrawer
          employeeId={drawerRow.employeeId}
          employeeName={drawerRow.employeeName}
          title="Mark Half Day"
          presetDate={effectiveDate}
          presetIsHalfDay
          onClose={() => setDrawerEmployeeId(null)}
          onSuccess={handleHalfDayRecorded}
        />
      )}
    </div>
  );
}