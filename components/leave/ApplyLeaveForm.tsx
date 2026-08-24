'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info } from 'lucide-react';

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

// Shared field styling so every input/select/textarea in this form is
// visually identical — including a real focus ring, which the previous
// version had on none of them.
const FIELD_CLASS =
  'w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-shadow focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]';

const LABEL_CLASS = 'block text-xs font-medium text-[var(--text-muted)] mb-1.5';

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

function Banner({
  tone,
  title,
  children,
}: {
  tone: 'success' | 'warning' | 'danger' | 'info';
  title?: string;
  children: React.ReactNode;
}) {
  const styles = {
    success: {
      wrap: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
      icon: CheckCircle2,
    },
    warning: {
      wrap: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
      icon: AlertTriangle,
    },
    danger: {
      wrap: 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300',
      icon: AlertCircle,
    },
    info: {
      wrap: 'bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]',
      icon: Info,
    },
  }[tone];
  const Icon = styles.icon;

  return (
    <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2.5 border ${styles.wrap}`}>
      <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <div className="space-y-1 min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children}
      </div>
    </div>
  );
}

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
      {error && <Banner tone="danger">{error}</Banner>}

      {result && (
        <div className="space-y-2">
          <Banner tone="success">
            Submitted — {result.leave_request.total_days} day(s) requested. Sent for manager approval.
          </Banner>
          {result.converted_to_lwp && (
            <Banner tone="warning">This entry was auto-converted to Leave Without Pay (LWP) per policy.</Banner>
          )}
          {result.policy_notes.length > 0 && (
            <Banner tone="warning" title="This request violates policy — it will still be sent for approval:">
              <ul className="list-disc pl-4 space-y-1">
                {result.policy_notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </Banner>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLASS}>Leave Type</label>
            <select
              value={leaveTypeCode}
              onChange={(e) => setLeaveTypeCode(e.target.value as typeof leaveTypeCode)}
              className={FIELD_CLASS}
            >
              {LEAVE_TYPES.map((lt) => (
                <option key={lt.code} value={lt.code}>{lt.label}</option>
              ))}
            </select>
          </div>

          {/* Matched height + baseline to the select beside it: same
              label-then-control structure, so the two controls in this
              row line up exactly instead of the toggle floating at a
              different vertical position. */}
          <div>
            <label className={LABEL_CLASS}>Duration</label>
            <button
              type="button"
              role="switch"
              aria-checked={isHalfDay}
              onClick={() => setIsHalfDay((v) => !v)}
              className={`w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                isHalfDay
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
              }`}
            >
              <span>{isHalfDay ? 'Half day' : 'Full day(s)'}</span>
              <span
                className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                  isHalfDay ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                    isHalfDay ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </span>
            </button>
          </div>
        </div>

        {isHalfDay ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLASS}>Date</label>
              <input
                type="date"
                value={startDate}
                min={minDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={FIELD_CLASS}
                required
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Session</label>
              <select
                value={halfDaySession}
                onChange={(e) => setHalfDaySession(e.target.value as 'AM' | 'PM')}
                className={FIELD_CLASS}
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLASS}>Start Date</label>
              <input
                type="date"
                value={startDate}
                min={minDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={FIELD_CLASS}
                required
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>End Date</label>
              <input
                type="date"
                value={endDate}
                min={minDate ?? (startDate || undefined)}
                onChange={(e) => setEndDate(e.target.value)}
                className={FIELD_CLASS}
                required
              />
            </div>
          </div>
        )}

        <div>
          <label className={LABEL_CLASS}>Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className={FIELD_CLASS}
            required
          />
        </div>

        {leaveTypeCode === 'PL' && (
          <div>
            <label className={LABEL_CLASS}>Action Plan (required for Planned leave)</label>
            <textarea
              value={actionPlan}
              onChange={(e) => setActionPlan(e.target.value)}
              rows={2}
              placeholder="Who's covering your work while you're away, handover notes, etc."
              className={FIELD_CLASS}
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
          <div className="space-y-2">
            <p className="text-xs text-[var(--text-muted)]">
              {preview.totalDays} day(s) requested
              {preview.currentBalance !== null && ` · ${preview.currentBalance} day(s) of ${leaveTypeCode} remaining`}
            </p>
            {preview.notes.length > 0 && (
              <Banner
                tone={preview.wouldBeLwp ? 'danger' : 'warning'}
                title={preview.wouldBeLwp ? 'Heads up — this will be Leave Without Pay:' : 'Heads up, per the leave policy:'}
              >
                <ul className="list-disc pl-4 space-y-1">
                  {preview.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </Banner>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {loading ? 'Submitting…' : 'Apply for Leave'}
        </button>
      </form>
    </div>
  );
}