'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ViolationBadge from './ViolationBadge';
import ConfirmDialog from '../ConfirmDialog';

export type PendingApprovalRequest = {
  id: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  leaveTypeCode: string;
  leaveTypeLabel: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  halfDaySession: string | null;
  totalDays: number;
  reason: string;
  isLwpOverride: boolean;
  lwpOverrideReason: string | null;
  currentBalance: number | null;
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;

  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateRange(start: string, end: string) {
  return start === end
    ? formatDate(start)
    : `${formatDate(start)} → ${formatDate(end)}`;
}

const FIELD_LABEL_CLASS =
  'text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]';

export default function ApprovalCard({
  request,
  canApprove,
  canRemind,
}: {
  request: PendingApprovalRequest;
  canApprove: boolean;
  canRemind: boolean;
}) {
  const router = useRouter();

  const [rejecting, setRejecting] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reminderSent, setReminderSent] = useState(false);

  async function handleRemind() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/leave/remind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leave_request_id: request.id }),
      });

      const text = await res.text();
      const body = text ? JSON.parse(text) : {};

      if (!res.ok) {
        setError(body.error || 'Could not send a reminder.');
        return;
      }

      setReminderSent(true);
    } catch {
      setError('Could not reach the server — check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    setConfirmingApprove(false);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/leave/approvals/${request.id}/approve`,
        { method: 'POST' }
      );

      const text = await res.text();
      const body = text ? JSON.parse(text) : {};

      if (!res.ok) {
        setError(body.error || 'Could not approve this request.');
        return;
      }

      router.refresh();
    } catch {
      setError('Could not reach the server — check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    setConfirmingReject(false);

    if (!comment.trim()) {
      setError('A short comment is required to reject.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/leave/approvals/${request.id}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment }),
        }
      );

      const text = await res.text();
      const body = text ? JSON.parse(text) : {};

      if (!res.ok) {
        setError(body.error || 'Could not reject this request.');
        return;
      }

      router.refresh();
    } catch {
      setError('Could not reach the server — check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 transition-colors hover:border-[var(--text-muted)]/30">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[var(--text-primary)] font-medium text-sm">
            {request.employeeName}
          </p>

          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            {request.employeeCode} · {request.department}
          </p>
        </div>

        {request.isLwpOverride && <ViolationBadge count={1} />}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 text-xs mt-3.5">
        <div>
          <p className={FIELD_LABEL_CLASS}>Leave Type</p>
          <p className="text-[var(--text-primary)] font-medium mt-1">
            {request.leaveTypeLabel}
          </p>
        </div>

        <div>
          <p className={FIELD_LABEL_CLASS}>Dates</p>
          <p className="text-[var(--text-primary)] font-medium mt-1">
            {formatDateRange(request.startDate, request.endDate)}
            {request.isHalfDay &&
              ` (${request.halfDaySession ?? 'half day'})`}
          </p>
        </div>

        <div>
          <p className={FIELD_LABEL_CLASS}>Days Requested</p>
          <p className="text-[var(--text-primary)] font-medium mt-1">
            {request.totalDays}
          </p>
        </div>

        <div>
          <p className={FIELD_LABEL_CLASS}>
            Balance ({request.leaveTypeCode})
          </p>

          <p className="text-[var(--text-primary)] font-medium mt-1">
            {request.currentBalance !== null
              ? request.currentBalance.toFixed(1)
              : '—'}
          </p>
        </div>
      </div>

      {/* LWP Banner */}
      {request.isLwpOverride && request.lwpOverrideReason && (
        <p className="mt-3.5 text-amber-700 dark:text-amber-300 text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 leading-relaxed">
          {request.lwpOverrideReason}
        </p>
      )}

      {/* Reason */}
      <div className="mt-3.5">
        <p className={FIELD_LABEL_CLASS}>Reason</p>

        <p className="text-[var(--text-primary)] text-sm mt-1 leading-relaxed">
          {request.reason}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-3.5 bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Actions */}
      {rejecting ? (
        <div className="mt-auto pt-3.5 space-y-2 border-t border-[var(--border)]">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Reason for rejecting (required)…"
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-shadow focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]"
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmingReject(true)}
              disabled={loading}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {loading ? 'Rejecting…' : 'Confirm Reject'}
            </button>

            <button
              type="button"
              onClick={() => {
                setRejecting(false);
                setComment('');
                setError(null);
              }}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm px-3 py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-auto flex gap-2 pt-3.5 border-t border-[var(--border)]">
          {canApprove && (
            <>
              <button
                type="button"
                onClick={() => setConfirmingApprove(true)}
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {loading ? 'Approving…' : 'Approve'}
              </button>

              <button
                type="button"
                onClick={() => setRejecting(true)}
                disabled={loading}
                className="border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-900/20 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Reject
              </button>
            </>
          )}

          {canRemind && (
            <button
              type="button"
              onClick={handleRemind}
              disabled={loading || reminderSent}
              title="Notifies both the employee and the approver that this request is still pending"
              className="border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors ml-auto"
            >
              {reminderSent ? 'Reminder sent' : 'Send Reminder'}
            </button>
          )}
        </div>
      )}

      {/* Approve Confirmation */}
      {confirmingApprove && (
        <ConfirmDialog
          title="Approve this leave request?"
          message={`Approve ${request.employeeName}'s ${request.leaveTypeLabel} request for ${formatDateRange(request.startDate, request.endDate)}?`}
          confirmLabel="Yes, approve"
          cancelLabel="Cancel"
          onConfirm={handleApprove}
          onCancel={() => setConfirmingApprove(false)}
        />
      )}

      {/* Reject Confirmation */}
      {confirmingReject && (
        <ConfirmDialog
          title="Reject this leave request?"
          message={`Reject ${request.employeeName}'s ${request.leaveTypeLabel} request? They'll be notified with your comment.`}
          confirmLabel="Yes, reject"
          cancelLabel="Cancel"
          onConfirm={handleReject}
          onCancel={() => setConfirmingReject(false)}
        />
      )}
    </div>
  );
}