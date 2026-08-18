'use client';

import { useState } from 'react';

export type WfhSubmitResult = { id: string };

export type WfhApplyInitialValues = {
  startDate?: string;
  endDate?: string;
  isHalfDay?: boolean;
  halfDaySession?: 'AM' | 'PM';
  reason?: string;
};

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

// Extracted from WfhPanel's old inline form so it can be driven from a
// slide-over drawer (WfhApplyDrawer) the same way ApplyLeaveForm is
// driven from ApplyLeaveDrawer — same submit/success contract, just no
// longer tied to being rendered inline inside the WFH list card.
//
// WFH is by definition planned ahead of time, so — same reasoning as
// Planned Leave — both date fields get a `min` of today; the calendar
// picker itself won't let you pick a day that's already passed.
export default function WfhApplyForm({
  onSuccess,
  initialValues,
}: {
  onSuccess?: (result: WfhSubmitResult) => void;
  initialValues?: WfhApplyInitialValues;
}) {
  const [startDate, setStartDate] = useState(initialValues?.startDate ?? '');
  const [endDate, setEndDate] = useState(initialValues?.endDate ?? '');
  const [isHalfDay, setIsHalfDay] = useState(initialValues?.isHalfDay ?? false);
  const [halfDaySession, setHalfDaySession] = useState<'AM' | 'PM'>(initialValues?.halfDaySession ?? 'AM');
  const [reason, setReason] = useState(initialValues?.reason ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const min = todayYMD();

  async function handleApply(e: React.FormEvent) {
    e.preventDefault();
    if (!startDate || !reason.trim()) {
      setFormError('Start date and reason are required.');
      return;
    }
    if (startDate < min || (!isHalfDay && endDate && endDate < min)) {
      setFormError('WFH is a planned request — it cannot be applied for a past date.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch('/api/leave/wfh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate: isHalfDay ? startDate : endDate || startDate,
          isHalfDay,
          halfDaySession: isHalfDay ? halfDaySession : undefined,
          reason,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setFormError(body.error || 'Could not submit WFH request.');
        return;
      }
      onSuccess?.(body);
    } catch {
      setFormError('Could not reach the server — check your connection and retry.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleApply} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">Start date</label>
          <input
            type="date"
            value={startDate}
            min={min}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
            required
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">End date</label>
          <input
            type="date"
            value={isHalfDay ? startDate : endDate}
            min={startDate || min}
            disabled={isHalfDay}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] disabled:opacity-50"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <input type="checkbox" checked={isHalfDay} onChange={(e) => setIsHalfDay(e.target.checked)} />
        Half day
      </label>
      {isHalfDay && (
        <select
          value={halfDaySession}
          onChange={(e) => setHalfDaySession(e.target.value as 'AM' | 'PM')}
          className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      )}
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1">Reason</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
          required
        />
      </div>
      {formError && <p className="text-red-500 text-xs">{formError}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        {submitting ? 'Submitting…' : 'Apply for WFH'}
      </button>
    </form>
  );
}
