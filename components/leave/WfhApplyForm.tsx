'use client';

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { DATE_INPUT_MAX, sanitizeDateString } from '@/lib/dateFormat';

export type WfhSubmitResult = { id: string };

export type WfhApplyInitialValues = {
  startDate?: string;
  endDate?: string;
  reason?: string;
};

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

// Shared field styling — matches ApplyLeaveForm.tsx so every leave-related
// form in this app looks like it belongs to the same design system.
const FIELD_CLASS =
  'w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-shadow focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] disabled:opacity-50';

const LABEL_CLASS = 'block text-xs font-medium text-[var(--text-muted)] mb-1.5';

// Extracted from WfhPanel's old inline form so it can be driven from a
// slide-over drawer (WfhApplyDrawer) the same way ApplyLeaveForm is
// driven from ApplyLeaveDrawer — same submit/success contract, just no
// longer tied to being rendered inline inside the WFH list card.
//
// WFH is by definition planned ahead of time, so — same reasoning as
// Planned Leave — both date fields get a `min` of today; the calendar
// picker itself won't let you pick a day that's already passed.
//
// No half-day option: WFH is granted per full day only, so this form
// only ever collects a start/end date range and a reason.
export default function WfhApplyForm({
  onSuccess,
  initialValues,
}: {
  onSuccess?: (result: WfhSubmitResult) => void;
  initialValues?: WfhApplyInitialValues;
}) {
  const [startDate, setStartDate] = useState(initialValues?.startDate ?? '');
  const [endDate, setEndDate] = useState(initialValues?.endDate ?? '');
  const [reason, setReason] = useState(initialValues?.reason ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const min = todayYMD();

  async function handleApply(e: React.FormEvent) {
    e.preventDefault();
    if (!startDate || !endDate || !reason.trim()) {
      setFormError('Start date, end date, and reason are required.');
      return;
    }
    if (startDate < min || endDate < min) {
      setFormError('WFH is a planned request — it cannot be applied for a past date.');
      return;
    }
    if (endDate < startDate) {
      setFormError('End date cannot be before the start date.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch('/api/leave/wfh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, reason }),
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
    <form onSubmit={handleApply} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLASS}>Start date</label>
          <input
            type="date"
            value={startDate}
            min={min}
            max={DATE_INPUT_MAX}
            onChange={(e) => setStartDate(sanitizeDateString(e.target.value))}
            className={FIELD_CLASS}
            required
          />
        </div>
        <div>
          <label className={LABEL_CLASS}>End date</label>
          <input
            type="date"
            value={endDate}
            min={startDate || min}
            max={DATE_INPUT_MAX}
            onChange={(e) => setEndDate(sanitizeDateString(e.target.value))}
            className={FIELD_CLASS}
            required
          />
        </div>
      </div>

      <div>
        <label className={LABEL_CLASS}>Reason</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className={FIELD_CLASS}
          required
        />
      </div>

      {formError && (
        <div className="flex items-start gap-2 text-xs rounded-lg px-3 py-2.5 border bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <p>{formError}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        {submitting ? 'Submitting…' : 'Apply for WFH'}
      </button>
    </form>
  );
}