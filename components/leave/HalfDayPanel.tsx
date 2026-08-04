'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import RecordLeaveDrawer from './RecordLeaveDrawer';
import type { SubmitResult } from './RecordLeaveForm';
import type { HalfDayCandidate } from '@/lib/attendanceExceptions';
import AttendanceTableSkeleton from './AttendanceTableSkeleton';

// Half Day panel — lives inside the "Half Days" tab of the Leave Tracker
// (app/leave/admin/history/page.tsx). Mirrors AbsenteesPanel's shape but
// reads `halfDayCandidates` instead of `absentees`, and surfaces WHY each
// row was flagged (missed punch-out, only one punch recorded, or
// first-to-last punch under 5 hours) plus the actual first/last punch
// times — that detail is the whole point of this tab, since "possible
// half day" needs a human to look at the punches and decide, not just a
// yes/no like Absentees.
//
// Same date-range support as AbsenteesPanel: pass `endDate` (different
// from `date`) to switch to period mode, which asks the API for the
// whole range in one request and adds a Date column.
export default function HalfDayPanel({
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

  const [rows, setRows] = useState<HalfDayCandidate[]>([]);
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
        setError(body.error || `Could not load half-day candidates (${res.status}).`);
        return;
      }
      setRows(body.halfDayCandidates ?? []);
      if (!isRange && !date && body.date) onResolvedDate(body.date);
    } catch {
      setError('Could not reach the server to load half-day candidates.');
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
  const columnCount = isMultiDate ? 8 : 7;

  if (loading) {
    return (
      <div>
        <p className="text-xs text-[var(--text-muted)] mb-2">Loading…</p>
        <AttendanceTableSkeleton columns={columnCount} />
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-3 bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <p className="text-xs text-[var(--text-muted)] mb-2">
        {filtered.length} record{filtered.length === 1 ? '' : 's'} to review for {periodLabel}
      </p>

      {filtered.length === 0 ? (
        <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl px-4 py-10 text-center text-[var(--text-muted)] text-sm">
          No half-day or missed-punch candidates for this {isMultiDate ? 'period' : 'date'}
          {department || office || search ? ' matching your filters' : ''}.
        </div>
      ) : (
        <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--text-muted)] text-xs border-b border-[var(--border)]">
                {isMultiDate && <th className="text-left font-medium px-4 py-2">Date</th>}
                <th className="text-left font-medium px-4 py-2">Employee</th>
                <th className="text-left font-medium px-4 py-2">Department</th>
                <th className="text-left font-medium px-4 py-2">Office</th>
                <th className="text-left font-medium px-4 py-2">First Punch</th>
                <th className="text-left font-medium px-4 py-2">Last Punch</th>
                <th className="text-left font-medium px-4 py-2">Working Hours</th>
                <th className="text-left font-medium px-4 py-2">Reason</th>
                <th className="text-left font-medium px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={`${r.employeeId}-${r.date}`} className="border-b border-[var(--border)] last:border-0">
                  {isMultiDate && <td className="px-4 py-2 text-[var(--text-muted)]">{r.date}</td>}
                  <td className="px-4 py-2 text-[var(--text-primary)]">
                    {r.employeeName}
                    <span className="text-[var(--text-muted)]"> · {r.employeeCode}</span>
                  </td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">{r.department}</td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">{r.office}</td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">{r.firstPunch ?? '--'}</td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">{r.lastPunch ?? '--'}</td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">{r.workingHours}</td>
                  <td className="px-4 py-2">
                    <span className="border border-amber-500/30 bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full px-2 py-0.5 text-xs">
                      {r.reason}
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
          presetIsHalfDay
          lockHalfDay
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
