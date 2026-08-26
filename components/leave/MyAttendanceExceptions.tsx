'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Clock, CalendarCheck, FileEdit, ChevronDown, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-react';

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

const CHOICES: { value: Choice; label: string; icon: typeof Clock }[] = [
  { value: 'missed_punch', label: 'Missed punch', icon: Clock },
  { value: 'half_day', label: 'Actual half day', icon: CalendarCheck },
  { value: 'regularise', label: 'Request regularisation', icon: FileEdit },
];

const PAGE_SIZE = 6;

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
    <div className="mt-3 space-y-4 border-t border-[var(--border)] pt-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {CHOICES.map((opt) => {
          const Icon = opt.icon;
          const active = choice === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setChoice(opt.value)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                active
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] ring-1 ring-[var(--accent)]/30'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]/40 hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {opt.label}
            </button>
          );
        })}
      </div>

      {choice === 'half_day' && (
        <div>
          <label className="text-xs text-[var(--text-muted)] block mb-1.5">
            Which leave type should this half day draw from?
          </label>
          <div className="flex flex-wrap gap-1.5">
            {LEAVE_TYPE_OPTIONS.map((o) => (
              <button
                key={o.code}
                type="button"
                onClick={() => setLeaveTypeCode(o.code)}
                className={`text-xs font-medium rounded-full px-3 py-1 border transition-colors ${
                  leaveTypeCode === o.code
                    ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                    : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
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
          className="w-full text-sm bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 outline-none transition-shadow focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]/70"
        />
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-red-500 text-xs">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-[var(--text-muted)] leading-snug">
          {choice === 'missed_punch'
            ? 'Resolves immediately — no approval needed.'
            : 'Sent to your manager for approval. Unresolved days eventually convert to Leave Without Pay.'}
        </p>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="shrink-0 px-4 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<UnmarkedException['kind'], string> = {
  absent: 'No punch recorded',
  possible_half_day: 'Partial punches recorded',
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return { weekday: '—', day: dateStr, full: dateStr };
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
    day: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    full: d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  };
}

function ExceptionCard({ row, open, onToggle, onSubmitted }: {
  row: UnmarkedException;
  open: boolean;
  onToggle: () => void;
  onSubmitted: () => void;
}) {
  const { weekday, day, full } = formatDate(row.date);

  return (
    <div
      className={`bg-[var(--bg-elevated)]/40 border rounded-xl px-4 py-3 transition-colors ${
        open ? 'border-[var(--accent)]/40' : 'border-[var(--border)]'
      }`}
    >
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-amber-500/10 px-1">
  <span className="text-[9px] font-semibold uppercase leading-none text-amber-600 dark:text-amber-400">
    {weekday}
  </span>
  <span className="text-[12px] font-semibold leading-none mt-1 text-[var(--text-primary)] whitespace-nowrap">
    {day}
  </span>
</div>
          <div className="min-w-0">
            <p className="text-[var(--text-primary)] font-medium text-sm truncate">{full}</p>
            <p className="text-[var(--text-muted)] text-xs mt-0.5 truncate">
              {row.kind === 'absent'
                ? KIND_LABEL.absent
                : `${KIND_LABEL.possible_half_day}${row.firstPunch ? ` · ${row.firstPunch}${row.lastPunch ? ` – ${row.lastPunch}` : ''}` : ''}`}
            </p>
          </div>
        </div>
        <span
          className={`flex items-center gap-1 text-xs font-medium shrink-0 rounded-lg px-3 py-1.5 border transition-colors ${
            open
              ? 'border-[var(--border)] text-[var(--text-muted)]'
              : 'bg-[var(--accent)] text-white border-[var(--accent)]'
          }`}
        >
          {open ? 'Close' : 'Respond'}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <ResponseForm exception={row} onSubmitted={onSubmitted} />}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl px-4 py-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-[var(--border)]" />
        <div className="space-y-2 flex-1">
          <div className="h-3.5 w-40 rounded bg-[var(--border)]" />
          <div className="h-3 w-56 rounded bg-[var(--border)]" />
        </div>
        <div className="h-7 w-20 rounded-lg bg-[var(--border)]" />
      </div>
    </div>
  );
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;

  // Compact page list: first, last, current ±1, with ellipses between gaps.
  const pages: (number | 'ellipsis')[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== 'ellipsis') {
      pages.push('ellipsis');
    }
  }

  return (
    <div className="flex items-center justify-center gap-1 pt-1">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        aria-label="Previous page"
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] disabled:opacity-40 hover:text-[var(--text-primary)] hover:border-[var(--text-muted)]/40 transition-colors"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>

      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <span key={`e-${i}`} className="w-7 text-center text-xs text-[var(--text-muted)]">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-medium transition-colors ${
              p === page
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/40'
            }`}
          >
            {p}
          </button>
        )
      )}

      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page === totalPages}
        aria-label="Next page"
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] disabled:opacity-40 hover:text-[var(--text-primary)] hover:border-[var(--text-muted)]/40 transition-colors"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function MyAttendanceExceptions() {
  const [rows, setRows] = useState<UnmarkedException[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

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

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  // Keep page in range if the list shrinks (e.g. after resolving the last item on a page).
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);

  function goToPage(p: number) {
    setOpenId(null); // avoid an orphaned open form on the page you're leaving
    setPage(p);
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-10 text-center space-y-2">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <p className="text-[var(--text-primary)] text-sm font-medium">All clear</p>
        <p className="text-[var(--text-muted)] text-xs">Every recent attendance day matches your usual pattern.</p>
      </div>
    );
  }

  const rangeStart = (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, rows.length);

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-muted)] px-1">
        Showing {rangeStart}–{rangeEnd} of {rows.length} day{rows.length === 1 ? '' : 's'} that need your input.
      </p>

      {pageRows.map((row) => (
        <ExceptionCard
          key={row.id}
          row={row}
          open={openId === row.id}
          onToggle={() => setOpenId(openId === row.id ? null : row.id)}
          onSubmitted={() => {
            setOpenId(null);
            load();
          }}
        />
      ))}

      <Pagination page={page} totalPages={totalPages} onChange={goToPage} />
    </div>
  );
}