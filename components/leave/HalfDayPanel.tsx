'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import type { HalfDayCandidate } from '@/lib/attendanceExceptions';

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
// whole range in one request and adds a Date badge per card.
//
// Cards + client-side pagination: the API still returns every candidate
// for the selected date/range/all-pending in one response (unchanged),
// but we no longer render all of them into one unbounded scroll — they're
// paged locally so the panel stays a fixed, scannable size.
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
  // per-card Date badge, the period label) for either one.
  const isRange = !!date && !!endDate && endDate !== date;
  const isMultiDate = !date || isRange;

  const [rows, setRows] = useState<HalfDayCandidate[]>([]);
  const [escalation, setEscalation] = useState<Map<string, { id: string; reminderCount: number }>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remindingKey, setRemindingKey] = useState<string | null>(null);
  const [ackingKey, setAckingKey] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(9);
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

  // Any change to the underlying data or filters can shrink the result
  // set below the current page — reset to page 1 rather than showing
  // an out-of-range empty page.
  useEffect(() => {
    setPage(1);
  }, [department, office, search, rows]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const periodLabel = !date ? 'all pending dates' : isRange ? `${date} → ${endDate}` : date;

  if (loading) {
    return (
      <div>
        <p className="text-xs text-[var(--text-muted)] mb-3">Loading…</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-3 bg-red-50 dark:bg-red-500/15 border border-red-500/40 text-red-700 dark:text-red-300 text-xs font-medium rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <p className="text-xs text-[var(--text-muted)] mb-3">
        {filtered.length} record{filtered.length === 1 ? '' : 's'} to review for {periodLabel}
      </p>

      {filtered.length === 0 ? (
        <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl px-4 py-14 flex flex-col items-center gap-2 text-center">
          <Inbox size={26} className="text-[var(--text-muted)]" />
          <p className="text-[var(--text-muted)] text-sm">
            No half-day or missed-punch candidates for this {isMultiDate ? 'period' : 'date'}
            {department || office || search ? ' matching your filters' : ''}.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch">
            {paged.map((r) => {
              const key = `${r.employeeId}-${r.date}`;
              const target = escalation.get(`${r.employeeId}__${r.date}`);
              const reminderCount = target?.reminderCount ?? 0;

              return (
                <div
                  key={key}
                  className="h-full flex flex-col gap-3 bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 hover:border-[var(--accent)]/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-xs font-semibold">
                        {initials(r.employeeName)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[var(--text-primary)] text-sm font-medium truncate">{r.employeeName}</p>
                        <p className="text-[var(--text-muted)] text-xs truncate mt-0.5">{r.employeeCode}</p>
                      </div>
                    </div>
                    {isMultiDate && (
                      <span className="shrink-0 text-[11px] text-[var(--text-muted)] bg-[var(--bg-surface)] border border-[var(--border)] rounded-full px-2 py-0.5">
                        {formatShortDate(r.date)}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[11px] text-[var(--text-muted)] bg-[var(--bg-surface)] border border-[var(--border)] rounded-full px-2 py-0.5">
                      {r.department}
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)] bg-[var(--bg-surface)] border border-[var(--border)] rounded-full px-2 py-0.5">
                      {r.office}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center bg-[var(--bg-surface)]/60 rounded-lg py-2">
                    <div>
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">First</p>
                      <p className="text-xs text-[var(--text-primary)] font-medium mt-0.5">{r.firstPunch ?? '--'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Last</p>
                      <p className="text-xs text-[var(--text-primary)] font-medium mt-0.5">{r.lastPunch ?? '--'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Hours</p>
                      <p className="text-xs text-[var(--text-primary)] font-medium mt-0.5">{r.workingHours}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 border border-amber-500/40 bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 rounded-full px-2 py-0.5 text-xs font-medium">
                      <AlertTriangle size={11} className="shrink-0" />
                      {r.reason}
                    </span>
                    {reminderCount > 0 && (
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {reminderCount} reminder{reminderCount === 1 ? '' : 's'} sent
                      </span>
                    )}
                  </div>

                  {/* mt-auto pins actions to the bottom of every card, so a
                     shorter reason/badge line on one card never leaves its
                     buttons sitting at a different height than its neighbors. */}
                  <div className="flex items-center gap-2 mt-auto pt-1">
                    <button
                      type="button"
                      onClick={() => sendReminder(r.employeeId, r.date)}
                      disabled={!target || remindingKey === key}
                      title="Nudge the employee to respond via My Leave"
                      className="flex-1 text-xs border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50 font-medium px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      {remindingKey === key ? 'Sending…' : 'Remind'}
                    </button>
                    <button
                      type="button"
                      onClick={() => ackToLwp(r.employeeId, r.date)}
                      disabled={!target || reminderCount < 3 || ackingKey === key}
                      title={reminderCount < 3 ? `ACK is available after 3 reminders (currently ${reminderCount})` : 'Convert this day to Leave Without Pay'}
                      className="flex-1 text-xs bg-red-600 hover:bg-red-700 disabled:bg-[var(--bg-elevated)] disabled:text-[var(--text-muted)] text-white font-medium px-2.5 py-1.5 rounded-lg transition-colors disabled:cursor-not-allowed"
                    >
                      {ackingKey === key ? 'Converting…' : 'ACK → LWP'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap mt-4">
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span>Cards per page</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)]"
              >
                <option value={9}>9</option>
                <option value={18}>18</option>
                <option value={36}>36</option>
              </select>
            </div>

            <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
              <span>
                {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  aria-label="Previous page"
                  className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-[var(--text-primary)] px-1">
                  {currentPage} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={currentPage === pageCount}
                  aria-label="Next page"
                  className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function formatShortDate(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function CardSkeleton() {
  return (
    <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 animate-pulse space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-[var(--border)]" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-2/3 rounded bg-[var(--border)]" />
          <div className="h-2.5 w-1/3 rounded bg-[var(--border)]" />
        </div>
      </div>
      <div className="h-14 rounded-lg bg-[var(--border)]/60" />
      <div className="h-6 w-1/2 rounded-full bg-[var(--border)]" />
      <div className="h-8 rounded-lg bg-[var(--border)]" />
    </div>
  );
}