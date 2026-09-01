'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import type { HalfDayCandidate } from '@/lib/attendanceExceptions';
import RecordLeaveDrawer from './RecordLeaveDrawer';
import type { SubmitResult } from './RecordLeaveForm';
import { useDebounce } from '@/lib/useDebounce';

// Half Day panel — lives inside the "Half Days" tab of the Leave Tracker
// (app/leave/admin/history/page.tsx). Mirrors AbsenteesPanel's shape but
// reads `halfDayCandidates` instead of `absentees`, and surfaces WHY each
// row was flagged (missed punch-out, only one punch recorded, or
// first-to-last punch under 5 hours) plus the actual first/last punch
// times — that detail is the whole point of this tab, since "possible
// half day" needs a human to look at the punches and decide.
//
// See AbsenteesPanel.tsx's header comment, which applies identically:
// deciding what actually happened on a flagged day is normally the
// EMPLOYEE's call from /leave/me, not HR's. HR's actions here are the
// same Remind / Record Leave pair AbsenteesPanel has — Record Leave
// replaced the old "ACK -> auto-convert to LWP" action; see that file's
// header comment for the full rationale. Here it opens the drawer with
// the half-day toggle preset and locked on, matching what
// CalendarDayDrawer already does for its 'unresolved_half_day' rows.
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
  const [escalation, setEscalation] = useState<Map<string, { id: string; reminderCount: number; nextAllowedAt: string | null }>>(new Map());
  const [rowErrors, setRowErrors] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remindingKey, setRemindingKey] = useState<string | null>(null);
  const [remindingAll, setRemindingAll] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  // Which row's "Record Leave" drawer is currently open, if any.
  const [recordLeaveFor, setRecordLeaveFor] = useState<{ employeeId: string; employeeName: string; date: string } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(9);
  // See AbsenteesPanel's identical guard — prevents a slower, older
  // request (e.g. June) from landing after a newer one (April) and
  // silently overwriting it with stale data.
  const requestIdRef = useRef(0);
  // Ticks every 20s purely to re-render cooldown countdowns/re-enable
  // "Remind" buttons as their cooldown lapses — see AbsenteesPanel.tsx.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 20000);
    return () => clearInterval(id);
  }, []);

  async function sendReminder(employeeId: string, forDate: string) {
    const key = `${employeeId}-${forDate}`;
    const mapKey = `${employeeId}__${forDate}`;
    const target = escalation.get(mapKey);
    if (!target) return;
    setRemindingKey(key);
    setRowErrors((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    try {
      const res = await fetch('/api/leave/attendance/remind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'attendance_exception_unmarked', targetId: target.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setEscalation((prev) => {
          const next = new Map(prev);
          next.set(mapKey, { id: target.id, reminderCount: body.reminderCount ?? target.reminderCount + 1, nextAllowedAt: null });
          return next;
        });
      } else {
        setRowErrors((prev) => {
          const next = new Map(prev);
          next.set(key, body.error || `Could not send reminder (${res.status}).`);
          return next;
        });
        if (body.nextAllowedAt) {
          setEscalation((prev) => {
            const next = new Map(prev);
            next.set(mapKey, { id: target.id, reminderCount: body.reminderCount ?? target.reminderCount, nextAllowedAt: body.nextAllowedAt });
            return next;
          });
        }
      }
    } catch {
      setRowErrors((prev) => {
        const next = new Map(prev);
        next.set(key, 'Could not reach the server.');
        return next;
      });
    } finally {
      setRemindingKey(null);
    }
  }

  // "Remind All" — see AbsenteesPanel.tsx's identical function for the
  // full rationale (no separate bulk cooldown; skips anything already
  // in its per-target cooldown before even sending the request).
  async function remindAll() {
    const now = Date.now();
    const eligible = filtered
      .map((r) => {
        const mapKey = `${r.employeeId}__${r.date}`;
        const target = escalation.get(mapKey);
        if (!target) return null;
        if (target.nextAllowedAt && new Date(target.nextAllowedAt).getTime() > now) return null;
        return { targetType: 'attendance_exception_unmarked' as const, targetId: target.id, key: mapKey };
      })
      .filter((t): t is { targetType: 'attendance_exception_unmarked'; targetId: string; key: string } => t !== null);

    if (eligible.length === 0) {
      setBulkResult('Nothing to remind — every row is either resolved or still in its cooldown window.');
      return;
    }

    setRemindingAll(true);
    setBulkResult(null);
    try {
      const res = await fetch('/api/leave/attendance/remind-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: eligible }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBulkResult(body.error || `Could not send reminders (${res.status}).`);
        return;
      }
      setEscalation((prev) => {
        const next = new Map(prev);
        for (const r of body.results ?? []) {
          const existing = next.get(r.key);
          if (!existing) continue;
          next.set(r.key, {
            id: existing.id,
            reminderCount: r.sent ? r.reminderCount ?? existing.reminderCount + 1 : existing.reminderCount,
            nextAllowedAt: r.sent ? null : r.nextAllowedAt ?? existing.nextAllowedAt,
          });
        }
        return next;
      });
      const skippedCount = body.skippedCount ?? 0;
      setBulkResult(
        `Sent ${body.sentCount ?? 0} reminder${(body.sentCount ?? 0) === 1 ? '' : 's'}${
          skippedCount > 0 ? `, skipped ${skippedCount} (already reminded recently or no longer pending)` : ''
        }.`
      );
    } catch {
      setBulkResult('Could not reach the server.');
    } finally {
      setRemindingAll(false);
    }
  }

  // Called once RecordLeaveForm (inside the drawer) has successfully
  // created the leave_request — marks this attendance_exceptions row
  // resolved ('leave_recorded', attributed to the acting HR employee),
  // same as AbsenteesPanel's identical handler.
  async function handleLeaveRecorded(result: SubmitResult) {
    if (!recordLeaveFor) return;
    try {
      await fetch('/api/leave/attendance/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: recordLeaveFor.employeeId,
          date: recordLeaveFor.date,
          action: 'leave_recorded',
          leave_request_id: result.leave_request.id,
        }),
      });
    } finally {
      setRefreshSignal((s) => s + 1);
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
          setEscalation(new Map(Object.entries(ensureBody.targets ?? {})) as Map<string, { id: string; reminderCount: number; nextAllowedAt: string | null }>);
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

  const debouncedSearch = useDebounce(search, 200);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (department && r.department !== department) return false;
      if (office && r.office !== office) return false;
      if (q && !r.employeeName.toLowerCase().includes(q) && !r.employeeCode.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, department, office, debouncedSearch]);

  // Any change to the underlying data or filters can shrink the result
  // set below the current page — reset to page 1 rather than showing
  // an out-of-range empty page.
  useEffect(() => {
    setPage(1);
  }, [department, office, debouncedSearch, rows]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const periodLabel = !date ? 'all pending dates' : isRange ? `${date} → ${endDate}` : date;

  const remindableCount = filtered.filter((r) => {
    const target = escalation.get(`${r.employeeId}__${r.date}`);
    if (!target) return false;
    return !target.nextAllowedAt || new Date(target.nextAllowedAt).getTime() <= nowTick;
  }).length;

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
      <p className="text-xs text-[var(--text-muted)] mb-3 flex items-center justify-between flex-wrap gap-2">
        <span>
          {filtered.length} record{filtered.length === 1 ? '' : 's'} to review for {periodLabel}
        </span>
        {filtered.length > 0 && (
          <button
            type="button"
            onClick={remindAll}
            disabled={remindingAll || remindableCount === 0}
            title={remindableCount === 0 ? 'Every row is resolved or still in its reminder cooldown' : `Send a reminder to all ${remindableCount} eligible row(s) currently in view`}
            className="text-xs font-medium border border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-colors"
          >
            {remindingAll ? 'Sending reminders…' : `Remind All${remindableCount > 0 ? ` (${remindableCount})` : ''}`}
          </button>
        )}
      </p>
      {bulkResult && (
        <div className="mb-3 bg-[var(--bg-elevated)]/60 border border-[var(--border)] text-[var(--text-primary)] text-xs font-medium rounded-lg px-3 py-2">
          {bulkResult}
        </div>
      )}

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
              const inCooldown = !!target?.nextAllowedAt && new Date(target.nextAllowedAt).getTime() > nowTick;
              const rowError = rowErrors.get(key);

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
                      <span className="text-[10px] text-[var(--text-muted)]">Reminder sent</span>
                    )}
                  </div>

                  {rowError && (
                    <p className="text-[11px] text-red-600 dark:text-red-400 -mt-1">{rowError}</p>
                  )}

                  {/* mt-auto pins actions to the bottom of every card, so a
                     shorter reason/badge line on one card never leaves its
                     buttons sitting at a different height than its neighbors. */}
                  <div className="flex items-center gap-2 mt-auto pt-1">
                    <button
                      type="button"
                      onClick={() => sendReminder(r.employeeId, r.date)}
                      disabled={!target || remindingKey === key || inCooldown}
                      title={inCooldown && target?.nextAllowedAt ? `Available again in ${fmtCountdown(target.nextAllowedAt, nowTick)}` : 'Nudge the employee to respond via My Leave'}
                      className="flex-1 text-xs border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50 font-medium px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      {remindingKey === key
                        ? 'Sending…'
                        : inCooldown && target?.nextAllowedAt
                          ? `Available in ${fmtCountdown(target.nextAllowedAt, nowTick)}`
                          : 'Remind'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRecordLeaveFor({ employeeId: r.employeeId, employeeName: r.employeeName, date: r.date })}
                      title="Record the actual leave for this employee/day"
                      className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      Record Leave
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

      {recordLeaveFor && (
        <RecordLeaveDrawer
          employeeId={recordLeaveFor.employeeId}
          employeeName={recordLeaveFor.employeeName}
          presetDate={recordLeaveFor.date}
          presetIsHalfDay
          lockHalfDay
          onClose={() => setRecordLeaveFor(null)}
          onSuccess={handleLeaveRecorded}
        />
      )}
    </div>
  );
}

import { formatOrdinalDate } from '@/lib/dateFormat';

function formatShortDate(dateStr: string) {
  return formatOrdinalDate(dateStr);
}

// See AbsenteesPanel.tsx's identical helper.
function fmtCountdown(nextAllowedAtIso: string, nowMs: number): string {
  const remainingMs = new Date(nextAllowedAtIso).getTime() - nowMs;
  if (remainingMs <= 0) return '0m';
  const totalMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
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