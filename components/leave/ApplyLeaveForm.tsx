'use client';

import { useEffect, useRef, useState } from 'react';

const LEAVE_TYPES: { code: 'SL' | 'CL' | 'PL' | 'LWP'; label: string }[] = [
  { code: 'SL', label: 'Sick Leave' },
  { code: 'CL', label: 'Casual Leave' },
  { code: 'PL', label: 'Planned Leave' },
  { code: 'LWP', label: 'Leave Without Pay' },
];

export type ApplySubmitResult = {
  leave_request: { id: string; total_days: number };
  converted_to_lwp: boolean;
  policy_notes: string[];
};

type PreviewState = {
  loading: boolean;
  totalDays: number | null;
  notes: string[];
  wouldBeLwp: boolean;
  currentBalance: number | null;
  error: string | null;
};

const EMPTY_PREVIEW: PreviewState = {
  loading: false, totalDays: null, notes: [], wouldBeLwp: false, currentBalance: null, error: null,
};

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

// A5 — self-service version of RecordLeaveForm.tsx: same underlying
// validation/POST contract (minus employee-picker, since it's always
// "me"), plus action_plan (required for Planned, per schema) which
// RecordLeaveForm never collects. On submit, a policy violation is
// never submit-blocking — shown as a warning banner and the request
// still completes, exactly as A5 specifies.
//
// Live preview: every time type/dates/half-day changes, a debounced call
// to /api/leave/me/requests/preview runs the exact same policy engine as
// a dry run and surfaces the same warnings inline, before the employee
// ever hits submit — so nobody finds out about a notice-period shortfall
// or an LWP conversion only after the fact.
// Feedback item #7 — "Reapply after rejection": prefills the form from
// a just-rejected request (dates/half-day/reason carried over, leave
// type deliberately NOT carried over — the whole point is picking a
// DIFFERENT applicable type) when opened via LeaveHistoryTable's
// "Apply for another leave type" action.
export type ApplyLeaveInitialValues = {
  startDate?: string;
  endDate?: string;
  isHalfDay?: boolean;
  halfDaySession?: 'AM' | 'PM';
  reason?: string;
};

export default function ApplyLeaveForm({
  onSuccess,
  initialValues,
}: {
  onSuccess?: (result: ApplySubmitResult) => void;
  initialValues?: ApplyLeaveInitialValues;
}) {
  const [leaveTypeCode, setLeaveTypeCode] = useState<'SL' | 'CL' | 'PL' | 'LWP'>('CL');
  const [isHalfDay, setIsHalfDay] = useState(initialValues?.isHalfDay ?? false);
  const [halfDaySession, setHalfDaySession] = useState<'AM' | 'PM'>(initialValues?.halfDaySession ?? 'AM');
  const [startDate, setStartDate] = useState(initialValues?.startDate ?? '');
  const [endDate, setEndDate] = useState(initialValues?.endDate ?? '');
  const [reason, setReason] = useState(initialValues?.reason ?? '');
  const [actionPlan, setActionPlan] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplySubmitResult | null>(null);
  const [loading, setLoading] = useState(false);

  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW);
  const previewSeq = useRef(0);

  // Planned Leave is, by definition, planned ahead of time — unlike
  // Sick/Casual/LWP, which are routinely applied for after the fact
  // (e.g. you were out sick yesterday and are only applying today), so
  // the past-date restriction is scoped to PL only.
  const isPlanned = leaveTypeCode === 'PL';
  const minDate = isPlanned ? todayYMD() : undefined;

  useEffect(() => {
    const hasDates = isHalfDay ? !!startDate : !!startDate && !!endDate;
    if (!hasDates) {
      setPreview(EMPTY_PREVIEW);
      return;
    }
    const seq = ++previewSeq.current;
    const timer = setTimeout(async () => {
      setPreview((p) => ({ ...p, loading: true, error: null }));
      try {
        const res = await fetch('/api/leave/me/requests/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leave_type_code: leaveTypeCode,
            start_date: startDate,
            end_date: isHalfDay ? startDate : endDate,
            is_half_day: isHalfDay,
          }),
        });
        const text = await res.text();
        const body = text ? JSON.parse(text) : {};
        if (seq !== previewSeq.current) return; // a newer request superseded this one
        if (!res.ok) {
          setPreview({ ...EMPTY_PREVIEW, error: body.error || 'Could not check policy for these dates.' });
          return;
        }
        setPreview({
          loading: false,
          totalDays: body.total_days,
          notes: body.notes ?? [],
          wouldBeLwp: !!body.would_be_lwp,
          currentBalance: body.current_balance,
          error: null,
        });
      } catch {
        if (seq !== previewSeq.current) return;
        setPreview({ ...EMPTY_PREVIEW, error: 'Could not reach the server to check policy — will still check on submit.' });
      }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaveTypeCode, startDate, endDate, isHalfDay]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!startDate) {
      setError('Start date is required.');
      return;
    }
    if (!isHalfDay && !endDate) {
      setError('End date is required for a non-half-day leave.');
      return;
    }
    if (!reason.trim()) {
      setError('Reason is required.');
      return;
    }
    if (leaveTypeCode === 'PL' && !actionPlan.trim()) {
      setError('An action plan is required for Planned leave.');
      return;
    }
    if (isPlanned && minDate && (startDate < minDate || (!isHalfDay && endDate < minDate))) {
      setError('Planned leave cannot be applied for a past date.');
      return;
    }

    setLoading(true);
    let res: Response;
    let body: ApplySubmitResult & { error?: string };
    try {
      res = await fetch('/api/leave/me/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leave_type_code: leaveTypeCode,
          start_date: startDate,
          end_date: isHalfDay ? startDate : endDate,
          is_half_day: isHalfDay,
          half_day_session: isHalfDay ? halfDaySession : undefined,
          reason,
          action_plan: leaveTypeCode === 'PL' ? actionPlan : undefined,
        }),
      });
      const text = await res.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      setLoading(false);
      setError('Could not reach the server — check your connection and try again.');
      return;
    }
    setLoading(false);

    if (!res.ok) {
      setError(body.error || 'Something went wrong');
      return;
    }

    setResult(body);
    setStartDate('');
    setEndDate('');
    setReason('');
    setActionPlan('');
    setPreview(EMPTY_PREVIEW);
    onSuccess?.(body);
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="bg-emerald-900/30 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs rounded-lg px-3 py-2">
            Submitted — {result.leave_request.total_days} day(s) requested. Sent for manager approval.
          </div>
          {result.converted_to_lwp && (
            <div className="bg-amber-900/30 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs rounded-lg px-3 py-2">
              This entry was auto-converted to Leave Without Pay (LWP) per policy.
            </div>
          )}
          {result.policy_notes.length > 0 && (
            <div className="bg-amber-900/30 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs rounded-lg px-3 py-2">
              <p className="font-medium mb-1">This request violates policy — it will still be sent for approval:</p>
              <ul className="list-disc pl-4 space-y-1">
                {result.policy_notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Leave Type</label>
            <select
              value={leaveTypeCode}
              onChange={(e) => setLeaveTypeCode(e.target.value as typeof leaveTypeCode)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              {LEAVE_TYPES.map((lt) => (
                <option key={lt.code} value={lt.code}>{lt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <input type="checkbox" checked={isHalfDay} onChange={(e) => setIsHalfDay(e.target.checked)} />
              Half day
            </label>
          </div>
        </div>

        {isHalfDay ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Date</label>
              <input
                type="date"
                value={startDate}
                min={minDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Session</label>
              <select
                value={halfDaySession}
                onChange={(e) => setHalfDaySession(e.target.value as 'AM' | 'PM')}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                min={minDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                min={minDate ?? (startDate || undefined)}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                required
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
            required
          />
        </div>

        {leaveTypeCode === 'PL' && (
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Action Plan (required for Planned leave)</label>
            <textarea
              value={actionPlan}
              onChange={(e) => setActionPlan(e.target.value)}
              rows={2}
              placeholder="Who's covering your work while you're away, handover notes, etc."
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
              required
            />
          </div>
        )}

        {/* Live policy check — same engine as the real submit, run as a
            dry run so the employee sees any warning (notice shortfall,
            insufficient balance, probation/notice-period LWP, medical
            certificate requirement, combining-leave adjacency) before
            they submit, not only in the after-the-fact banner above. */}
        {preview.loading && (
          <p className="text-xs text-[var(--text-muted)]">Checking against leave policy…</p>
        )}
        {!preview.loading && preview.error && (
          <p className="text-xs text-[var(--text-muted)]">{preview.error}</p>
        )}
        {!preview.loading && !preview.error && preview.totalDays !== null && (
          <div className="space-y-1.5">
            <p className="text-xs text-[var(--text-muted)]">
              {preview.totalDays} day(s) requested
              {preview.currentBalance !== null && ` · ${preview.currentBalance} day(s) of ${leaveTypeCode} remaining`}
            </p>
            {preview.notes.length > 0 && (
              <div
                className={`text-xs rounded-lg px-3 py-2 border ${
                  preview.wouldBeLwp
                    ? 'bg-red-900/20 border-red-500/30 text-red-700 dark:text-red-300'
                    : 'bg-amber-900/20 border-amber-500/30 text-amber-700 dark:text-amber-300'
                }`}
              >
                <p className="font-medium mb-1">
                  {preview.wouldBeLwp ? 'Heads up — this will be Leave Without Pay:' : 'Heads up, per the leave policy:'}
                </p>
                <ul className="list-disc pl-4 space-y-1">
                  {preview.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {loading ? 'Submitting…' : 'Apply for Leave'}
        </button>
      </form>
    </div>
  );
}