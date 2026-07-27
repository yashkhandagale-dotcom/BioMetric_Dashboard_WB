'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import RecordLeaveDrawer from './RecordLeaveDrawer';
import type { SubmitResult } from './RecordLeaveForm';
import type { AbsenteeCandidate } from '@/lib/attendanceExceptions';
import AttendanceTableSkeleton from './AttendanceTableSkeleton';

// Absentees panel — lives inside the "Absentees" tab of the Leave
// Tracker (app/leave/admin/history/page.tsx).
//
// Date handling: this app's attendance_records come from batch CSV
// uploads, so there is no dependable "today". `date` is the single-day
// mode; when `endDate` is also passed (and differs from `date`), this
// switches to range mode and asks the API for the whole period in one
// request (see getAttendanceExceptionsRange) instead of one request per
// day — each row then shows which date it belongs to. When the parent
// hasn't picked a date yet at all (empty string), this fetches with no
// params, and the server returns every pending row across the WHOLE
// uploaded history (see getAttendanceExceptionsAllPending) — that's the
// "show me everything HR hasn't marked yet" default the Leave Tracker
// should open on, not just one day. onResolvedDate is now effectively
// unused in that state (the all-pending response has no single `date`
// to report back) — intentionally, so the date pickers stay blank
// instead of narrowing the view to one day behind the scenes.
//
// Note on "Team": there's no separate team concept in this codebase —
// Department is the grouping. See lib/attendanceExceptions.ts's header
// comment for why. The Department filter below is what "Team" maps to.
export default function AbsenteesPanel({
  date,
  endDate,
  department,
  office,
  search,
  onResolvedDate,
}: {
  date: string;
  endDate?: string;
  department: string;
  office: string;
  search: string;
  onResolvedDate: (date: string) => void;
}) {
  // `isRange` decides the query shape sent to the server (explicit
  // start_date/end_date). Empty `date` is a separate case — "HR hasn't
  // picked one yet" — which fetches with no params at all and gets back
  // every pending row across the whole uploaded history (see
  // getAttendanceExceptionsAllPending). Both cases can return rows
  // spanning many dates, so `isMultiDate` covers display concerns (the
  // per-row Date column, the period label) for either one.
  const isRange = !!date && !!endDate && endDate !== date;
  const isMultiDate = !date || isRange;

  const [rows, setRows] = useState<AbsenteeCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerEmployeeId, setDrawerEmployeeId] = useState<string | null>(null);
  const [drawerDate, setDrawerDate] = useState<string>('');
  const [refreshSignal, setRefreshSignal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = isRange
        ? `?start_date=${encodeURIComponent(date)}&end_date=${encodeURIComponent(endDate!)}`
        : date
          ? `?date=${encodeURIComponent(date)}`
          : '';
      const res = await fetch(`/api/leave/attendance/exceptions${qs}`);
      const text = await res.text();
      const body = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setError(body.error || `Could not load absentees (${res.status}).`);
        return;
      }
      setRows(body.absentees ?? []);
      if (!isRange && !date && body.date) onResolvedDate(body.date);
    } catch {
      setError('Could not reach the server to load absentees.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, endDate, isRange]);

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

  const drawerRow = filtered.find((r) => r.employeeId === drawerEmployeeId && r.date === drawerDate);

  async function handleRecorded(result: SubmitResult) {
    if (!drawerRow) return;
    try {
      await fetch('/api/leave/attendance/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: drawerRow.employeeId,
          date: drawerRow.date,
          action: 'leave_recorded',
          leave_request_id: result.leave_request.id,
        }),
      });
    } finally {
      setRefreshSignal((s) => s + 1);
    }
  }

  const periodLabel = !date ? 'all pending dates' : isRange ? `${date} → ${endDate}` : date;
  const columnCount = isMultiDate ? 6 : 5;

  if (loading) {
    return (
      <div>
        <p className="text-xs text-slate-500 mb-2">Loading…</p>
        <AttendanceTableSkeleton columns={columnCount} />
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-3 bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <p className="text-xs text-slate-500 mb-2">
        {filtered.length} absentee record{filtered.length === 1 ? '' : 's'} for {periodLabel}
      </p>

      {filtered.length === 0 ? (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl px-4 py-10 text-center text-slate-500 text-sm">
          No absentees to review for this {isMultiDate ? 'period' : 'date'}
          {department || office || search ? ' matching your filters' : ''}.
        </div>
      ) : (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-700">
                {isMultiDate && <th className="text-left font-medium px-4 py-2">Date</th>}
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
                <tr key={`${r.employeeId}-${r.date}`} className="border-b border-slate-800 last:border-0">
                  {isMultiDate && <td className="px-4 py-2 text-slate-300">{r.date}</td>}
                  <td className="px-4 py-2 text-white">
                    {r.employeeName}
                    <span className="text-slate-500"> · {r.employeeCode}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-300">{r.department}</td>
                  <td className="px-4 py-2 text-slate-300">{r.office}</td>
                  <td className="px-4 py-2 text-slate-300">{r.workingHours}</td>
                  <td className="px-4 py-2">
                    <span className="border border-red-500/30 bg-red-900/30 text-red-300 rounded-full px-2 py-0.5 text-xs">
                      Unmarked Leave
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDrawerEmployeeId(r.employeeId);
                        setDrawerDate(r.date);
                      }}
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
      )}

      {drawerRow && (
        <RecordLeaveDrawer
          employeeId={drawerRow.employeeId}
          employeeName={drawerRow.employeeName}
          presetDate={drawerRow.date}
          onClose={() => {
            setDrawerEmployeeId(null);
            setDrawerDate('');
          }}
          onSuccess={handleRecorded}
        />
      )}
    </div>
  );
}
