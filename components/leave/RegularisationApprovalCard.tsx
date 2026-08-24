'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '../ConfirmDialog';

export type PendingRegularisationRequest = {
  id: string;
  employeeName: string;
  employeeCode: string;
  date: string;
  reason: string;
  createdAt: string;
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

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr);

  if (Number.isNaN(d.getTime())) return dateStr;

  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const FIELD_LABEL_CLASS =
  'text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]';

export default function RegularisationApprovalCard({
  request,
  canApprove,
}: {
  request: PendingRegularisationRequest;
  canApprove: boolean;
}) {
  const router = useRouter();

  const [rejecting, setRejecting] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body?: object) {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      const text = await res.text();
      const parsed = text ? JSON.parse(text) : {};

      if (!res.ok) {
        setError(parsed.error || 'Something went wrong.');
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
            {request.employeeCode}
          </p>
        </div>

        <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-1 bg-violet-500/15 text-violet-700 dark:text-violet-300">
          Regularise
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 text-xs mt-3.5">
        <div>
          <p className={FIELD_LABEL_CLASS}>Date</p>

          <p className="text-[var(--text-primary)] font-medium mt-1">
            {formatDate(request.date)}
          </p>
        </div>

        <div>
          <p className={FIELD_LABEL_CLASS}>Requested On</p>

          <p className="text-[var(--text-primary)] font-medium mt-1">
            {formatDateTime(request.createdAt)}
          </p>
        </div>
      </div>

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
              onClick={() =>
                comment.trim()
                  ? setConfirmingReject(true)
                  : setError('A short comment is required to reject.')
              }
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
        canApprove && (
          <div className="mt-auto flex gap-2 pt-3.5 border-t border-[var(--border)]">
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
          </div>
        )
      )}

      {/* Approve Confirmation */}
      {confirmingApprove && (
        <ConfirmDialog
          title="Approve this regularisation?"
          message={`Mark ${formatDate(request.date)} as regularised for ${request.employeeName}?`}
          confirmLabel="Yes, approve"
          cancelLabel="Cancel"
          onConfirm={() => {
            setConfirmingApprove(false);
            post(`/api/leave/regularisations/${request.id}/approve`);
          }}
          onCancel={() => setConfirmingApprove(false)}
        />
      )}

      {/* Reject Confirmation */}
      {confirmingReject && (
        <ConfirmDialog
          title="Reject this regularisation request?"
          message={`Reject ${request.employeeName}'s regularisation request for ${formatDate(request.date)}? If this originated from an attendance exception, it will automatically convert to Leave Without Pay.`}
          confirmLabel="Yes, reject"
          cancelLabel="Cancel"
          onConfirm={() => {
            setConfirmingReject(false);
            post(`/api/leave/regularisations/${request.id}/reject`, {
              comment,
            });
          }}
          onCancel={() => setConfirmingReject(false)}
        />
      )}
    </div>
  );
}