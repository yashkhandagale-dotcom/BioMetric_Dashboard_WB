'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import RecordLeaveDrawer from './RecordLeaveDrawer';
import type { SubmitResult } from './RecordLeaveForm';
import type { AbsenteeCandidate } from '@/lib/attendanceExceptions';

// Absentees panel — lives inside the "Absentees" tab of the Leave
// Tracker (app/leave/admin/history/page.tsx), not as a standalone
// accordion on the balances page anymore (moved per feedback: this
// belongs with the other attendance-review tabs, not next to the
// balance grid).
//
// Date handling: this app's attendance_records come from batch CSV
// uploads (see lib/attendanceExceptions.ts's resolveDefaultDate), so
// there is no dependable "today". `date` is controlled by the parent
// (Leave Tracker page) so it's shared with the Half Day tab and the
// filter bar above both. When the parent hasn't picked one yet (empty
// string), this fetches with no ?date param, lets the server resolve
// the latest uploaded date, and reports it back via onResolvedDate so
// the date picker fills in with a real value instead of staying blank.
//
// Note on "Team": there's no separate team concept in this codebase —
// Department is the grouping. See lib/attendanceExceptions.ts's header
// comment for why. The Department filter below is what "Team" maps to.
export default function AbsenteesPanel({
  date,
  department,
  office,
  search,
  onResolvedDate,
}: {
  date: string;
  department: string;
  office: string;
  search: string;
  onResolvedDate: (date: string) => void;
}) {
  const [rows, setRows] = useState<AbsenteeCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerEmployeeId, setDrawerEmployeeId] = useState<string | null>(null);
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
        setError(body.error || `Could not load absentees (${res.status}).`);
        return;
      }
      setRows(body.absentees ?? []);
      if (!date && body.date) onResolvedDate(body.date);
    } catch {
      setError('Could not reach the server to load absentees.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (department && r.department !== department) return false;
      if (office && r.office !== office) return false;
      if (q && !r.employeeName.toLowerCase().includes(q) && !r.employeeCode.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, department, office, search]);

  const drawerRow = filtered.find((r) => r.employeeId === drawerEmployeeId);

  async function handleRecorded(result: SubmitResult) {
    if (!drawerRow) return;
    try {
      await fetch('/api/leave/attendance/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: drawerRow.employeeId,
          date,
          action: 'leave_recorded',
          leave_request_id: result.leave_request.id,
        }),
      });
    } finally {
      setRefreshSignal((s) => s + 1);
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-3 bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <p className="text-xs text-slate-500 mb-2">
        {loading ? 'Loading…' : `${filtered.length} absentee(s) for ${date || '—'}`}
      </p>

      {!loading && filtered.length === 0 ? (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl px-4 py-10 text-center text-slate-500 text-sm">
          No absentees to review for this date{department || office || search ? ' matching your filters' : ''}.
        </div>
      ) : (
        !loading && (
          <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-slate-700">
                  <th className="text-left font-medium px-4 py-2">Employee</th>
                  <th className="text-left font-medium px-4 py-2">Department</th>
                  <th className="text-left font-medium px-4 py-2">Office</th>
                  <th className="text-left font-medium px-4 py-2">Working Hours</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                  <th className="text-left font-medium px-4 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.employeeId} className="border-b border-slate-800 last:border-0">
                    <td className="px-4 py-2 text-white">
                      {r.employeeName}
                      <span className="text-slate-500"> · {r.employeeCode}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-300">{r.department}</td>
                    <td className="px-4 py-2 text-slate-300">{r.office}</td>
                    <td className="px-4 py-2 text-slate-300">{r.workingHours}</td>
                    <td className="px-4 py-2">
                      <span className="border border-red-500/30 bg-red-900/30 text-red-300 rounded-full px-2 py-0.5 text-xs">
                        {r.status || 'Absent'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => setDrawerEmployeeId(r.employeeId)}
                        className="text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        Record Leave
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {drawerRow && (
        <RecordLeaveDrawer
          employeeId={drawerRow.employeeId}
          employeeName={drawerRow.employeeName}
          presetDate={date}
          onClose={() => setDrawerEmployeeId(null)}
          onSuccess={handleRecorded}
        />
      )}
    </div>
  );
}