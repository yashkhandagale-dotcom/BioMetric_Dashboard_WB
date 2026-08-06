'use client';

import { useState } from 'react';

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

// A5 — self-service version of RecordLeaveForm.tsx: same underlying
// validation/POST contract (minus employee-picker, since it's always
// "me"), plus action_plan (required for Planned, per schema) which
// RecordLeaveForm never collects. On submit, a policy violation is
// never submit-blocking — shown as a warning banner and the request
// still completes, exactly as A5 specifies.
export default function ApplyLeaveForm({ onSuccess }: { onSuccess?: (result: ApplySubmitResult) => void }) {
  const [leaveTypeCode, setLeaveTypeCode] = useState<'SL' | 'CL' | 'PL' | 'LWP'>('CL');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState<'AM' | 'PM'>('AM');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [actionPlan, setActionPlan] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplySubmitResult | null>(null);
  const [loading, setLoading] = useState(false);

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