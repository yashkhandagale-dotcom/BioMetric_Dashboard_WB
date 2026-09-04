'use client';

import { CheckCircle2, Clock, Info, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { formatOrdinalDate } from '@/lib/dateFormat';

export type PendingMissedPunchRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  exceptionDate: string;
  exceptionType: string;
  firstPunch: string | null;
  lastPunch: string | null;
  note: string;
  submittedAt: string;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U';
}

const FIELD_LABEL_CLASS =
  'text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]';

export default function MissedPunchApprovalCard({
  request,
  isHr,
}: {
  request: PendingMissedPunchRequest;
  isHr?: boolean;
}) {
  const isAbsent = request.exceptionType === 'absent';

  return (
    <div className="h-full flex flex-col bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-2xl p-4 transition-all hover:border-[var(--text-muted)]/30 hover:shadow-xs space-y-3.5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500/20 to-sky-500/5 text-sky-600 dark:text-sky-400 border border-sky-500/25 text-xs font-bold shadow-sm">
            {initials(request.employeeName)}
          </div>
          <div className="min-w-0">
            <p className="text-[var(--text-primary)] font-bold text-sm truncate">
              {request.employeeName}
            </p>
            <p className="text-[var(--text-muted)] text-xs mt-0.5 truncate">
              {request.employeeCode} · <span className="font-medium text-[var(--text-primary)]">{request.department}</span>
            </p>
          </div>
        </div>

        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide rounded-full px-2.5 py-0.5 bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/25 shrink-0">
          <CheckCircle2 className="h-3 w-3" />
          Auto-Resolved
        </span>
      </div>

      {/* Metric Tiles Grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-[var(--bg-surface)]/80 border border-[var(--border-subtle)] rounded-xl p-2.5">
          <p className={FIELD_LABEL_CLASS}>Exception Date</p>
          <p className="text-[var(--text-primary)] font-bold text-xs mt-1 truncate">
            {formatOrdinalDate(request.exceptionDate)}
          </p>
        </div>

        <div className="bg-[var(--bg-surface)]/80 border border-[var(--border-subtle)] rounded-xl p-2.5">
          <p className={FIELD_LABEL_CLASS}>Exception Type</p>
          <p className="text-[var(--text-primary)] font-semibold text-xs mt-1 truncate">
            {isAbsent ? 'No Punch Recorded' : 'Partial Punch'}
          </p>
        </div>

        <div className="bg-[var(--bg-surface)]/80 border border-[var(--border-subtle)] rounded-xl p-2.5">
          <p className={FIELD_LABEL_CLASS}>Punch Times</p>
          <p className="text-[var(--text-primary)] font-medium text-xs mt-1 truncate">
            {request.firstPunch || request.lastPunch
              ? `In: ${request.firstPunch || '—'} · Out: ${request.lastPunch || '—'}`
              : 'None recorded'}
          </p>
        </div>

        <div className="bg-[var(--bg-surface)]/80 border border-[var(--border-subtle)] rounded-xl p-2.5">
          <p className={FIELD_LABEL_CLASS}>Resolution</p>
          <p className="text-sky-600 dark:text-sky-400 font-bold text-xs mt-1 truncate">
            Missed Punch
          </p>
        </div>
      </div>

      {/* Note / Reason */}
      <div className="bg-[var(--bg-surface)]/40 rounded-xl p-3 border border-[var(--border-subtle)] space-y-1">
        <p className={FIELD_LABEL_CLASS}>Employee Note</p>
        <p className="text-[var(--text-primary)] text-xs italic leading-relaxed">
          &ldquo;{request.note}&rdquo;
        </p>
      </div>

      {/* Informational Callout & Footer */}
      <div className="mt-auto pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3 shrink-0" />
          Submitted {formatOrdinalDate(request.submittedAt)}
        </span>

        {/* {isHr && (
          <Link
            href={`/leave/admin/history?search=${encodeURIComponent(request.employeeCode)}`}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-600 dark:text-sky-400 hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
          </Link>
        )} */}
      </div>
    </div>
  );
}
