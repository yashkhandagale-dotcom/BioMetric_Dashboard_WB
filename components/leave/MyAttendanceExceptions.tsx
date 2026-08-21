'use client';

import { useEffect, useState, useCallback } from 'react';

// Part C, §C.2 — the employee's own resolution flow for a flagged
// attendance day, on /leave/me. Mirrors WfhPanel.tsx's shape (a
// self-contained, self-fetching client island) but adds an inline
// 3-option response form per card instead of just listing history —
// this is the ONE place these days get resolved now; HR only reminds
// and (eventually) ACKs, it never picks an outcome on the employee's
// behalf (see components/leave/AbsenteesPanel.tsx / HalfDayPanel.tsx's
// updated header comments).
type UnmarkedException = {
  id: string;
  date: string;
  kind: 'absent' | 'possible_half_day';
  firstPunch: string | null;
  lastPunch: string | null;
  reason: string | null;
};

type Choice = 'missed_punch' | 'half_day' | 'regularise';

const LEAVE_TYPE_OPTIONS: { code: 'SL' | 'CL' | 'PL'; label: string }[] = [
  { code: 'SL', label: 'Sick Leave' },
  { code: 'CL', label: 'Casual Leave' },
  { code: 'PL', label: 'Paid Leave' },
];

function ResponseForm({ exception, onSubmitted }: { exception: UnmarkedException; onSubmitted: () => void }) {
  const [choice, setChoice] = useState<Choice>('missed_punch');
  const [note, setNote] = useState('');
  const [leaveTypeCode, setLeaveTypeCode] = useState<'SL' | 'CL' | 'PL'>('SL');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!note.trim()) {
      setError('A note is required, whichever option you choose.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/leave/attendance/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exceptionId: exception.id,
          choice,
          note,
          leaveTypeCode: choice === 'half_day' ? leaveTypeCode : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Something went wrong — please try again.');
        return;
      }
      onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
      <div className="flex flex-wrap gap-2">
        {(
          [
            { value: 'missed_punch', label: 'It was a missed punch' },
            { value: 'half_day', label: 'It was an actual half day' },
            { value: 'regularise', label: 'Request regularisation' },
          ] as { value: Choice; label: string }[]
        ).map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setChoice(opt.value)}
            className={`text-xs font-medium rounded-full px-3 py-1.5 border transition-colors ${
              choice === opt.value
                ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {choice === 'half_day' && (
        <div>
          <label className="text-xs text-[var(--text-muted)] block mb-1">Which leave type should this half day draw from?</label>
          <select
            value={leaveTypeCode}
            onChange={(e) => setLeaveTypeCode(e.target.value as 'SL' | 'CL' | 'PL')}
            className="text-sm bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2 py-1.5"
          >
            {LEAVE_TYPE_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            choice === 'missed_punch'
              ? "e.g. 'Forgot to punch out, left around 6pm as usual.'"
              : choice === 'half_day'
                ? "e.g. 'Left after lunch for a personal appointment.'"
                : "e.g. 'Left early for a client visit, pre-approved by manager over chat.'"
          }
          rows={2}
          className="w-full text-sm bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5"
        />
      </div>

      {error && <p className="text-red-500 text-xs">{error}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent)] text-white disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>

      <p className="text-[10px] text-[var(--text-muted)]">
        {choice === 'missed_punch'
          ? 'This resolves immediately — no approval needed.'
          : 'This will be sent to your manager for approval. Unresolved requests convert to Leave Without Pay after repeated reminders.'}
      </p>
    </div>
  );
}

export default function MyAttendanceExceptions() {
  const [rows, setRows] = useState<UnmarkedException[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leave/me/attendance-exceptions');
      const body = await res.json();
      setRows(body.exceptions ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return null; // avoid a flash of an empty-state panel that immediately gets replaced
  if (rows.length === 0) return null; // nothing unmarked — no card at all, rather than an empty "all clear" panel taking up space every day

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Attendance days that need your input</h2>
        <p className="text-xs text-[var(--text-muted)]">
          These days don't match your usual attendance pattern. Let us know what happened — unresolved days eventually convert to
          Leave Without Pay.
        </p>
      </div>

      <ul className="divide-y divide-[var(--border)]">
        {rows.map((row) => (
          <li key={row.id} className="py-2.5 text-sm">
            <button type="button" onClick={() => setOpenId(openId === row.id ? null : row.id)} className="w-full flex items-center justify-between gap-3 text-left">
              <div>
                <p className="text-[var(--text-primary)] font-medium">{row.date}</p>
                <p className="text-[var(--text-muted)] text-xs">
                  {row.kind === 'absent'
                    ? 'No punch recorded for this day'
                    : `Partial punches recorded${row.firstPunch ? ` (${row.firstPunch}${row.lastPunch ? ` – ${row.lastPunch}` : ''})` : ''}`}
                </p>
              </div>
              <span className="text-xs text-[var(--accent)] flex-shrink-0">{openId === row.id ? 'Close' : 'Respond'}</span>
            </button>
            {openId === row.id && (
              <ResponseForm
                exception={row}
                onSubmitted={() => {
                  setOpenId(null);
                  load();
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
