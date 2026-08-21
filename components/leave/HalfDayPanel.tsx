'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HalfDayCandidate } from '@/lib/attendanceExceptions';
import AttendanceTableSkeleton from './AttendanceTableSkeleton';

// Half Day panel — lives inside the "Half Days" tab of the Leave Tracker
// (app/leave/admin/history/page.tsx). Mirrors AbsenteesPanel's shape but
// reads `halfDayCandidates` instead of `absentees`, and surfaces WHY each
// row was flagged (missed punch-out, only one punch recorded, or
// first-to-last punch under 5 hours) plus the actual first/last punch
// times — that detail is the whole point of this tab, since "possible
// half day" needs a human to look at the punches and decide.
//
// Part C (MASTER_PLAN_CONSOLIDATED.md §C.4) removed HR's direct-
// resolution power here too — see AbsenteesPanel.tsx's header comment,
// which applies identically: deciding what actually happened on a
// flagged day is now the EMPLOYEE's call from /leave/me, not HR's.
// HR's actions here are the same Remind / ACK → LWP pair.
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
  const [escalation, setEscalation] = useState<Map<string, { id: string; reminderCount: number }>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remindingKey, setRemindingKey] = useState<string | null>(null);
  const [ackingKey, setAckingKey] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  // See AbsenteesPanel's identical guard — prevents a slower, older
  // request (e.g. June) from landing after a newer one (April) and
  // silently overwriting it with stale data.
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
      if (myRequestId !== requestIdRef.current) return;
      if (!res.ok) {
        setError(body.error || `Could not load half-day candidates (${res.status}).`);
        return;
      }
      const halfDayCandidates: HalfDayCandidate[] = body.halfDayCandidates ?? [];
      setRows(halfDayCandidates);
      if (!isRange && !date && body.date) onResolvedDate(body.date);

      if (halfDayCandidates.length > 0) {
        const ensureRes = await fetch('/api/leave/attendance/ensure-exceptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entries: halfDayCandidates.map((h) => ({
              employeeId: h.employeeId,
              date: h.date,
              kind: 'possible_half_day',
              firstPunch: h.firstPunch,
              lastPunch: h.lastPunch,
            })),
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
      setError('Could not reach the server to load half-day candidates.');
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
                    <td className="px-4 py-2 text-[var(--text-muted)]">{r.firstPunch ?? '--'}</td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">{r.lastPunch ?? '--'}</td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">{r.workingHours}</td>
                    <td className="px-4 py-2">
                      <span className="border border-amber-500/30 bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full px-2 py-0.5 text-xs">
                        {r.reason}
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
