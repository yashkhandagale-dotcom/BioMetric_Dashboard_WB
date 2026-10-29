'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, Calendar } from 'lucide-react';
import { formatOrdinalDate, formatOrdinalDateRange, DATE_INPUT_MAX, DATE_INPUT_MIN, sanitizeDateString } from '@/lib/dateFormat';
import { calculateEndDateFromWorkingDays, calculateWorkingDays } from '@/lib/workingDaysCalculator';

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
  loading: false,
  totalDays: null,
  notes: [],
  wouldBeLwp: false,
  currentBalance: null,
  error: null,
};

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

const FIELD_CLASS =
  'w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-shadow focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]';

const LABEL_CLASS = 'block text-xs font-semibold text-[var(--text-muted)] mb-1.5 uppercase tracking-wider';

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
    <div className={`flex items-start gap-2 text-xs rounded-xl px-3.5 py-2.5 border ${styles.wrap}`}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="space-y-1 min-w-0">
        {title && <p className="font-bold">{title}</p>}
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
  const [numDays, setNumDays] = useState<number>(1);
  const [reason, setReason] = useState(initialValues?.reason ?? '');
  const [actionPlan, setActionPlan] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplySubmitResult | null>(null);
  const [loading, setLoading] = useState(false);

  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW);
  const previewSeq = useRef(0);

  const isPlanned = leaveTypeCode === 'PL';
  const minDate = isPlanned ? todayYMD() : undefined;

  // Handle start date change: auto-calculate end date based on numDays
  function handleStartDateChange(rawStartDate: string) {
    const newStartDate = sanitizeDateString(rawStartDate);
    setStartDate(newStartDate);
    if (newStartDate && newStartDate.length === 10 && !isHalfDay) {
      const calculatedEnd = calculateEndDateFromWorkingDays(newStartDate, numDays);
      setEndDate(calculatedEnd);
    }
  }

  // Handle number of days change: auto-calculate end date
  function handleNumDaysChange(daysVal: number) {
    const validDays = Math.max(1, daysVal);
    setNumDays(validDays);
    if (startDate && startDate.length === 10 && !isHalfDay) {
      const calculatedEnd = calculateEndDateFromWorkingDays(startDate, validDays);
      setEndDate(calculatedEnd);
    }
  }

  // Handle end date change: recalculate working days
  function handleEndDateChange(rawEndDate: string) {
    const newEndDate = sanitizeDateString(rawEndDate);
    setEndDate(newEndDate);
    if (startDate && newEndDate && newEndDate.length === 10 && newEndDate >= startDate) {
      const calculatedWorkingDays = calculateWorkingDays(startDate, newEndDate);
      setNumDays(Math.max(1, calculatedWorkingDays));
    }
  }

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
            total_days: isHalfDay ? 0.5 : numDays,
          }),
        });
        const text = await res.text();
        const body = text ? JSON.parse(text) : {};
        if (seq !== previewSeq.current) return;
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
        setPreview({
          ...EMPTY_PREVIEW,
          error: 'Could not reach the server to check policy — will still check on submit.',
        });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [leaveTypeCode, startDate, endDate, isHalfDay, numDays]);

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
          total_days: isHalfDay ? 0.5 : numDays,
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
    setNumDays(1);
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
            Submitted — {result.leave_request.total_days} day(s) requested. Sent for manager &amp; HR approval.
          </Banner>
          {result.converted_to_lwp && (
            <Banner tone="warning">This entry was auto-converted to Leave Without Pay (LWP) per policy.</Banner>
          )}
          {result.policy_notes.length > 0 && (
            <Banner tone="warning" title="Policy advisory notes:">
              <ul className="list-disc pl-4 space-y-1">
                {result.policy_notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </Banner>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Leave Type and Duration Selector */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label className={LABEL_CLASS}>Select Leave Type</label>
            <div className="inline-flex items-center p-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl self-start sm:self-auto">
              <button
                type="button"
                onClick={() => {
                  setIsHalfDay(false);
                  if (startDate) {
                    setEndDate(calculateEndDateFromWorkingDays(startDate, numDays));
                  }
                }}
                className={`py-1.5 px-3.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  !isHalfDay
                    ? 'bg-[var(--accent)] text-white shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Full Day(s)
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsHalfDay(true);
                  setEndDate(startDate);
                }}
                className={`py-1.5 px-3.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  isHalfDay
                    ? 'bg-[var(--accent)] text-white shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Half Day (0.5d)
              </button>
            </div>
          </div>

          {/* Interactive Leave Type Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {LEAVE_TYPES.map((lt) => {
              const selected = leaveTypeCode === lt.code;
              return (
                <button
                  key={lt.code}
                  type="button"
                  onClick={() => setLeaveTypeCode(lt.code)}
                  className={`flex flex-col items-center justify-center p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                    selected
                      ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--text-primary)] font-bold shadow-xs ring-2 ring-[var(--accent)]/30'
                      : 'border-[var(--border)] bg-[var(--bg-elevated)]/40 hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span className="text-base font-black tracking-wide">{lt.code}</span>
                  <span className="text-[11px] font-medium mt-0.5">{lt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {isHalfDay ? (
          <div className="bg-[var(--bg-elevated)]/30 border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLASS}>Leave Date</label>
                <input
                  type="date"
                  value={startDate}
                  min={minDate ?? DATE_INPUT_MIN}
                  max={DATE_INPUT_MAX}
                  onChange={(e) => {
                    const v = sanitizeDateString(e.target.value);
                    setStartDate(v);
                    setEndDate(v);
                  }}
                  className={FIELD_CLASS}
                  required
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Session Time</label>
                <select
                  value={halfDaySession}
                  onChange={(e) => setHalfDaySession(e.target.value as 'AM' | 'PM')}
                  className={FIELD_CLASS}
                >
                  <option value="AM">Morning (AM) — First Half (9:30 AM – 1:30 PM)</option>
                  <option value="PM">Afternoon (PM) — Second Half (2:00 PM – 6:30 PM)</option>
                </select>
              </div>
            </div>
            <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5 pt-1">
              <Info size={13} className="text-[var(--accent)] shrink-0" />
              <span>Half-day requests are debited as 0.5 days of {leaveTypeCode}.</span>
            </div>
          </div>
        ) : (
          <div className="bg-[var(--bg-elevated)]/30 border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLASS}>Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  min={minDate ?? DATE_INPUT_MIN}
                  max={DATE_INPUT_MAX}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className={FIELD_CLASS}
                  required
                />
              </div>

              <div>
                <label className={LABEL_CLASS}>Number of Working Days</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleNumDaysChange(Math.max(1, numDays - 1))}
                    disabled={numDays <= 1}
                    className="w-10 h-10 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-card)] text-[var(--text-primary)] font-bold text-lg flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0 cursor-pointer"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    step={1}
                    value={numDays}
                    onChange={(e) => handleNumDaysChange(parseInt(e.target.value, 10) || 1)}
                    className={`${FIELD_CLASS} text-center font-bold text-base h-10`}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => handleNumDaysChange(numDays + 1)}
                    className="w-10 h-10 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-card)] text-[var(--text-primary)] font-bold text-lg flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className={LABEL_CLASS}>Calculated End Date</label>
              <input
                type="date"
                value={endDate}
                min={startDate || minDate || DATE_INPUT_MIN}
                max={DATE_INPUT_MAX}
                onChange={(e) => handleEndDateChange(e.target.value)}
                className={FIELD_CLASS}
                required
              />
              <span className="text-[11px] text-[var(--text-muted)] mt-1.5 block">
                Auto-calculated based on working days. Official holidays and weekends are not deducted.
              </span>
            </div>

            {startDate && endDate && (
              <div className="flex items-start gap-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-3.5 text-xs">
                <Calendar size={16} className="text-[var(--accent)] shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold text-[var(--text-primary)] block">
                    Continuous Span: {formatOrdinalDateRange(startDate, endDate, false, numDays)}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Total debited: <strong className="text-[var(--accent)]">{numDays} paid day{numDays > 1 ? 's' : ''}</strong>
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <label className={LABEL_CLASS}>Reason for Leave</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className={FIELD_CLASS}
            placeholder="Please provide the reason for your leave request…"
            required
          />
        </div>

        {leaveTypeCode === 'PL' && (
          <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-4 sm:p-5 space-y-2.5">
            <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 font-bold text-xs uppercase tracking-wider">
              <Info size={14} className="shrink-0" />
              <span>Handover &amp; Action Plan (Mandatory for Planned Leave)</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Per WonderBiz policy, Planned Leave requires an action plan covering delegate contacts and handover tasks.
            </p>
            <textarea
              value={actionPlan}
              onChange={(e) => setActionPlan(e.target.value)}
              rows={3}
              placeholder="Delegate who will cover your responsibilities, handover status, emergency contact info…"
              className={FIELD_CLASS}
              required
            />
          </div>
        )}

        {/* Live policy check & balance comparison */}
        {preview.loading && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-[var(--bg-elevated)]/40 border border-[var(--border)] text-xs text-[var(--text-muted)] animate-pulse font-medium">
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-ping" />
            <span>Validating requested dates against leave policy and live balance…</span>
          </div>
        )}
        {!preview.loading && preview.error && (
          <Banner tone="danger">{preview.error}</Banner>
        )}
        {!preview.loading && !preview.error && preview.totalDays !== null && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block">
                  Total Requested
                </span>
                <span className="text-xl font-black text-[var(--accent)] mt-1 block">
                  {preview.totalDays} day{preview.totalDays > 1 ? 's' : ''}
                </span>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block">
                  Available {leaveTypeCode} Balance
                </span>
                <span className="text-xl font-black text-[var(--text-primary)] mt-1 block">
                  {preview.currentBalance !== null ? `${preview.currentBalance} days` : 'Unlimited'}
                </span>
              </div>
            </div>

            {preview.notes.length > 0 && (
              <Banner
                tone={preview.wouldBeLwp ? 'danger' : 'warning'}
                title={preview.wouldBeLwp ? 'Policy Alert: Automatic LWP Conversion' : 'Policy Advisory Notes:'}
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
          className="w-full bg-[var(--accent)] hover:opacity-95 disabled:opacity-50 text-white text-sm font-bold px-5 py-3 rounded-xl transition-all shadow-md cursor-pointer flex items-center justify-center gap-2"
        >
          {loading ? 'Submitting Leave Request…' : 'Submit Leave Request'}
        </button>
      </form>
    </div>
  );
}