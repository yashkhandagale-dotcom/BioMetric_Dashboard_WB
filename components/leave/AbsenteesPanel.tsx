'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AbsenteeCandidate } from '@/lib/attendanceExceptions';
import AttendanceTableSkeleton from './AttendanceTableSkeleton';

// Absentees panel — lives inside the "Absentees" tab of the Leave
// Tracker (app/leave/admin/history/page.tsx).
//
// Part C (MASTER_PLAN_CONSOLIDATED.md §C.4) removed HR's direct-
// resolution power here — there is no more "Record Leave" button.
// Resolving one of these days (missed punch / actual half day /
// regularise) is now exclusively the EMPLOYEE's own call, made from
// /leave/me (see components/leave/MyAttendanceExceptions.tsx). HR's
// only actions on an unresolved row are:
//   - Remind: nudges the employee to respond (Stage A of the §C.5
//     escalation — see lib/leaveSupabase/attendanceEscalation.ts).
//   - ACK → LWP: available once reminder_count reaches 3, converts the
//     day straight to Leave Without Pay.
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
  const [escalation, setEscalation] = useState<Map<string, { id: string; reminderCount: number }>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remindingKey, setRemindingKey] = useState<string | null>(null);
  const [ackingKey, setAckingKey] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  // Guards against a race between overlapping requests: if the user picks
  // a new date range before the previous fetch has come back (e.g. April
  // right after June), the June response can land AFTER April's and
  // silently overwrite it with stale data. Each fetch gets a ticket; a
  // response only gets applied if it's still the most recent one in flight.
  const requestIdRef = useRef(0);

  async function sendReminder(employeeId: string, forDate: string) {
    const key = `${employeeId}-${forDate}`;
    const target = escalation.get(`${employeeId}__${forDate}`);
    if (!target) return;
    setRemindingKey(key);
    try {
      const res = await fetch('/api/leave/attendance/remind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'attendance_exception_unmarked', targetId: target.id }),
      });
      if (res.ok) {
        const body = await res.json();
        setEscalation((prev) => {
          const next = new Map(prev);
          next.set(`${employeeId}__${forDate}`, { id: target.id, reminderCount: body.reminderCount ?? target.reminderCount + 1 });
          return next;
        });
      }
    } finally {
      setRemindingKey(null);
    }
  }

  async function ackToLwp(employeeId: string, forDate: string) {
    const key = `${employeeId}-${forDate}`;
    const target = escalation.get(`${employeeId}__${forDate}`);
    if (!target) return;
    setAckingKey(key);
    try {
      const res = await fetch('/api/leave/attendance/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'attendance_exception_unmarked', targetId: target.id }),
      });
      if (res.ok) setRefreshSignal((s) => s + 1);
    } finally {
      setAckingKey(null);
    }
  }

  const load = useCallback(async () => {
    const myRequestId = ++requestIdRef.current;
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
      // A newer request has since been fired (date/range changed again
      // before this one came back) — this response is stale, drop it
      // rather than let it clobber whatever the newer request already set.
      if (myRequestId !== requestIdRef.current) return;
      if (!res.ok) {
        setError(body.error || `Could not load absentees (${res.status}).`);
        return;
      }
      const absentees: AbsenteeCandidate[] = body.absentees ?? [];
      setRows(absentees);
      if (!isRange && !date && body.date) onResolvedDate(body.date);

      // Ensure every visible row has a stable attendance_exceptions row
      // to Remind/ACK against — see ensureAttendanceExceptionRows's
      // header comment for why this is safe to call every load.
      if (absentees.length > 0) {
        const ensureRes = await fetch('/api/leave/attendance/ensure-exceptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entries: absentees.map((a) => ({ employeeId: a.employeeId, date: a.date, kind: 'absent' })),
          }),
        });
        if (ensureRes.ok && myRequestId === requestIdRef.current) {
          const ensureBody = await ensureRes.json();
          setEscalation(new Map(Object.entries(ensureBody.targets ?? {})) as Map<string, { id: string; reminderCount: number }>);
        }
      } else {
        setEscalation(new Map());
      }
    } catch {
      if (myRequestId !== requestIdRef.current) return;
      setError('Could not reach the server to load absentees.');
    } finally {
      if (myRequestId === requestIdRef.current) setLoading(false);
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

  const periodLabel = !date ? 'all pending dates' : isRange ? `${date} → ${endDate}` : date;
  const columnCount = isMultiDate ? 6 : 5;

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
        {filtered.length} absentee record{filtered.length === 1 ? '' : 's'} for {periodLabel}
      </p>

      {filtered.length === 0 ? (
        <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl px-4 py-10 text-center text-[var(--text-muted)] text-sm">
          No absentees to review for this {isMultiDate ? 'period' : 'date'}
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
                <th className="text-left font-medium px-4 py-2">Working Hours</th>
                <th className="text-left font-medium px-4 py-2">Status</th>
                <th className="text-left font-medium px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const key = `${r.employeeId}-${r.date}`;
                const target = escalation.get(`${r.employeeId}__${r.date}`);
                const reminderCount = target?.reminderCount ?? 0;
                return (
                  <tr key={key} className="border-b border-[var(--border)] last:border-0">
                    {isMultiDate && <td className="px-4 py-2 text-[var(--text-muted)]">{r.date}</td>}
                    <td className="px-4 py-2 text-[var(--text-primary)]">
                      {r.employeeName}
                      <span className="text-[var(--text-muted)]"> · {r.employeeCode}</span>
                    </td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">{r.department}</td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">{r.office}</td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">{r.workingHours}</td>
                    <td className="px-4 py-2">
                      <span className="border border-red-500/30 bg-red-900/30 text-red-700 dark:text-red-300 rounded-full px-2 py-0.5 text-xs">
                        Unmarked
                      </span>
                      {reminderCount > 0 && (
                        <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">
                          {reminderCount} reminder{reminderCount === 1 ? '' : 's'} sent
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => sendReminder(r.employeeId, r.date)}
                          disabled={!target || remindingKey === key}
                          title="Nudge the employee to respond via My Leave"
                          className="text-xs border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50 font-medium px-2.5 py-1.5 rounded-lg transition-colors"
                        >
                          {remindingKey === key ? 'Sending…' : 'Remind'}
                        </button>
                        <button
                          type="button"
                          onClick={() => ackToLwp(r.employeeId, r.date)}
                          disabled={!target || reminderCount < 3 || ackingKey === key}
                          title={reminderCount < 3 ? `ACK is available after 3 reminders (currently ${reminderCount})` : 'Convert this day to Leave Without Pay'}
                          className="text-xs bg-red-600 hover:bg-red-700 disabled:bg-[var(--bg-elevated)] disabled:text-[var(--text-muted)] text-white font-medium px-2.5 py-1.5 rounded-lg transition-colors disabled:cursor-not-allowed"
                        >
                          {ackingKey === key ? 'Converting…' : 'ACK → LWP'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
