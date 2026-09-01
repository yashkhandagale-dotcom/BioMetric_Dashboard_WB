'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Clock,
  CalendarCheck,
  FileEdit,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Clock3,
  XCircle,
  Inbox,
} from 'lucide-react';
import { formatOrdinalDate, formatOrdinalDateWithWeekday } from '@/lib/dateFormat';
import type { SubmittedAttendanceRequest } from '@/app/api/leave/me/attendance-exceptions/route';

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
  const [choice, setChoice] = useState<Choice>('regularise');
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
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all ${
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
          <label className="text-xs text-[var(--text-muted)] block mb-1.5 font-medium">
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
                    ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-xs'
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
          className="w-full text-sm bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-2 outline-none transition-shadow focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]/70"
        />
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-red-500 text-xs font-medium">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-[var(--text-muted)] leading-snug">
          {choice === 'missed_punch'
            ? 'Resolves immediately — no approval needed.'
            : 'Sent to manager & HR for approval. Stays visible in your Pending Requests list below.'}
        </p>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="shrink-0 px-4 py-1.5 rounded-xl text-xs font-bold bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white disabled:opacity-50 transition-colors shadow-sm"
        >
          {submitting ? 'Submitting…' : 'Submit Request'}
        </button>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<UnmarkedException['kind'], string> = {
  absent: 'No punch recorded',
  possible_half_day: 'Partial punches recorded',
};

function ExceptionCard({
  row,
  open,
  onToggle,
  onSubmitted,
}: {
  row: UnmarkedException;
  open: boolean;
  onToggle: () => void;
  onSubmitted: () => void;
}) {
  const dateFormatted = formatOrdinalDate(row.date);
  const d = new Date(`${row.date}T00:00:00Z`);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];

  return (
    <div
      className={`bg-[var(--bg-elevated)]/40 border rounded-2xl px-4 py-3.5 transition-all ${
        open ? 'border-[var(--accent)]/50 ring-1 ring-[var(--accent)]/20 shadow-sm' : 'border-[var(--border)] hover:border-[var(--border-strong)]'
      }`}
    >
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-11 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 px-1">
            <span className="text-[9px] font-bold uppercase leading-none text-amber-600 dark:text-amber-400">
              {weekday}
            </span>
            <span className="text-[12px] font-bold leading-none mt-1 text-[var(--text-primary)] whitespace-nowrap">
              {row.date.slice(8, 10)}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-[var(--text-primary)] font-bold text-sm truncate">{dateFormatted}</p>
            <p className="text-[var(--text-muted)] text-xs mt-0.5 truncate font-medium">
              {row.kind === 'absent'
                ? KIND_LABEL.absent
                : `${KIND_LABEL.possible_half_day}${row.firstPunch ? ` · ${row.firstPunch}${row.lastPunch ? ` – ${row.lastPunch}` : ''}` : ''}`}
            </p>
          </div>
        </div>
        <span
          className={`flex items-center gap-1 text-xs font-semibold shrink-0 rounded-xl px-3 py-1.5 border transition-all ${
            open
              ? 'border-[var(--border)] text-[var(--text-muted)] bg-[var(--bg-surface)]'
              : 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-xs'
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

function SubmittedRequestCard({ req }: { req: SubmittedAttendanceRequest }) {
  const dateFormatted = formatOrdinalDate(req.exceptionDate);
  const choiceLabel =
    req.employeeChoice === 'regularise'
      ? 'Regularisation Request'
      : req.employeeChoice === 'half_day'
        ? 'Half-Day Leave Request'
        : 'Missed Punch Note';

  const statusBadge = {
    pending: {
      label: 'Pending Approval',
      className: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
      icon: Clock3,
    },
    approved: {
      label: 'Approved',
      className: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
      icon: CheckCircle2,
    },
    resolved: {
      label: 'Resolved',
      className: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
      icon: CheckCircle2,
    },
    rejected: {
      label: 'Rejected',
      className: 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300',
      icon: XCircle,
    },
  }[req.status] ?? {
    label: req.status,
    className: 'bg-slate-500/10 border-slate-500/30 text-slate-700 dark:text-slate-300',
    icon: Clock3,
  };

  const StatusIcon = statusBadge.icon;

  return (
    <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-2xl p-4 space-y-2 shadow-xs">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-[var(--text-primary)]">{dateFormatted}</span>
          <span className="text-[11px] font-semibold text-[var(--accent)] bg-[var(--accent)]/10 px-2.5 py-0.5 rounded-full border border-[var(--accent)]/20">
            {choiceLabel}
          </span>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${statusBadge.className}`}
        >
          <StatusIcon size={13} />
          {statusBadge.label}
        </span>
      </div>
      {req.employeeNote && (
        <p className="text-xs text-[var(--text-muted)] italic bg-[var(--bg-surface)]/70 rounded-xl px-3 py-2 border border-[var(--border-subtle)]">
          &ldquo;{req.employeeNote}&rdquo;
        </p>
      )}
      <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] pt-1 border-t border-[var(--border-subtle)]">
        <span>Submitted: {formatOrdinalDate(req.submittedAt)}</span>
        <span>{req.exceptionType === 'absent' ? 'Absent Exception' : 'Partial Punch Exception'}</span>
      </div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

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
            className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-semibold transition-colors ${
              p === page
                ? 'bg-[var(--accent)] text-white shadow-xs'
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
  const [activeTab, setActiveTab] = useState<'needs_action' | 'submitted'>('needs_action');
  const [rows, setRows] = useState<UnmarkedException[]>([]);
  const [submittedRequests, setSubmittedRequests] = useState<SubmittedAttendanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leave/me/attendance-exceptions');
      const body = await res.json();
      setRows(body.exceptions ?? []);
      setSubmittedRequests(body.submittedRequests ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const currentListLength = activeTab === 'needs_action' ? rows.length : submittedRequests.length;
  const totalPages = Math.max(1, Math.ceil(currentListLength / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageExceptions = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);

  const pageSubmitted = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return submittedRequests.slice(start, start + PAGE_SIZE);
  }, [submittedRequests, page]);

  function switchTab(tab: 'needs_action' | 'submitted') {
    setActiveTab(tab);
    setOpenId(null);
    setPage(1);
  }

  const pendingCount = submittedRequests.filter((r) => r.status === 'pending').length;

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-16 rounded-2xl bg-[var(--bg-elevated)]/60 animate-pulse" />
        <div className="h-16 rounded-2xl bg-[var(--bg-elevated)]/60 animate-pulse" />
        <div className="h-16 rounded-2xl bg-[var(--bg-elevated)]/60 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2">
        <button
          type="button"
          onClick={() => switchTab('needs_action')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'needs_action'
              ? 'bg-[var(--accent)] text-white shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
          }`}
        >
          <span>Needs Action</span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] ${
              activeTab === 'needs_action'
                ? 'bg-white/20 text-white'
                : rows.length > 0
                  ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                  : 'bg-[var(--border)] text-[var(--text-muted)]'
            }`}
          >
            {rows.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => switchTab('submitted')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'submitted'
              ? 'bg-[var(--accent)] text-white shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
          }`}
        >
          <span>Submitted &amp; Pending Requests</span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] ${
              activeTab === 'submitted'
                ? 'bg-white/20 text-white'
                : pendingCount > 0
                  ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                  : 'bg-[var(--border)] text-[var(--text-muted)]'
            }`}
          >
            {submittedRequests.length}
          </span>
        </button>
      </div>

      {activeTab === 'needs_action' ? (
        rows.length === 0 ? (
          <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-2xl p-10 text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <p className="text-[var(--text-primary)] text-sm font-bold">All clear!</p>
            <p className="text-[var(--text-muted)] text-xs">
              Every recent attendance day matches your schedule or has already been submitted for review.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-[var(--text-muted)] px-1 font-medium">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, rows.length)} of {rows.length} day
              {rows.length === 1 ? '' : 's'} requiring your input.
            </p>

            {pageExceptions.map((row) => (
              <ExceptionCard
                key={row.id}
                row={row}
                open={openId === row.id}
                onToggle={() => setOpenId(openId === row.id ? null : row.id)}
                onSubmitted={() => {
                  setOpenId(null);
                  load();
                  setActiveTab('submitted');
                }}
              />
            ))}

            <Pagination page={page} totalPages={totalPages} onChange={(p) => setPage(p)} />
          </div>
        )
      ) : submittedRequests.length === 0 ? (
        <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-2xl p-10 text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]">
            <Inbox className="h-6 w-6" />
          </div>
          <p className="text-[var(--text-primary)] text-sm font-bold">No submitted requests</p>
          <p className="text-[var(--text-muted)] text-xs">
            Requests you submit for regularisations or half-days will stay tracked here until approved or regularised.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-muted)] px-1 font-medium">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, submittedRequests.length)} of{' '}
            {submittedRequests.length} request{submittedRequests.length === 1 ? '' : 's'}.
          </p>

          {pageSubmitted.map((req) => (
            <SubmittedRequestCard key={req.id} req={req} />
          ))}

          <Pagination page={page} totalPages={totalPages} onChange={(p) => setPage(p)} />
        </div>
      )}
    </div>
  );
}