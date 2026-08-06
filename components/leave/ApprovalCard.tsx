'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ViolationBadge from './ViolationBadge';

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
  // Current balance for this specific leave type, so the manager sees
  // the number this approval would draw down — reuses
  // getEmployeeBalancesByFY's pivot, no new balance math (B1).
  currentBalance: number | null;
};

function formatDateRange(start: string, end: string) {
  return start === end ? start : `${start} → ${end}`;
}

// B1/B2 — one card per pending request. Approve/Reject POST to the
// dedicated routes (which delegate to applyLeavePolicyAndMutateBalance
// with source: 'manager_approval' / 'manager_reject') and then
// router.refresh() so the queue re-fetches server-side and the acted-on
// card disappears.
export default function ApprovalCard({ request }: { request: PendingApprovalRequest }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leave/approvals/${request.id}/approve`, { method: 'POST' });
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
    if (!comment.trim()) {
      setError('A short comment is required to reject.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leave/approvals/${request.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      });
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
    <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[var(--text-primary)] font-medium text-sm">{request.employeeName}</p>
          <p className="text-[var(--text-muted)] text-xs">{request.employeeCode} · {request.department}</p>
        </div>
        {request.isLwpOverride && <ViolationBadge count={1} />}
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-[var(--text-muted)]">Leave Type</p>
          <p className="text-[var(--text-primary)] font-medium">{request.leaveTypeLabel}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Dates</p>
          <p className="text-[var(--text-primary)] font-medium">
            {formatDateRange(request.startDate, request.endDate)}
            {request.isHalfDay && ` (${request.halfDaySession ?? 'half day'})`}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Days Requested</p>
          <p className="text-[var(--text-primary)] font-medium">{request.totalDays}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Current Balance ({request.leaveTypeCode})</p>
          <p className="text-[var(--text-primary)] font-medium">
            {request.currentBalance !== null ? request.currentBalance.toFixed(1) : '—'}
          </p>
        </div>
      </div>

      {request.isLwpOverride && request.lwpOverrideReason && (
        <p className="text-amber-700 dark:text-amber-300 text-xs bg-amber-900/20 border border-amber-500/30 rounded-lg px-3 py-2">
          {request.lwpOverrideReason}
        </p>
      )}

      <div>
        <p className="text-[var(--text-muted)] text-xs">Reason</p>
        <p className="text-[var(--text-primary)] text-sm">{request.reason}</p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {rejecting ? (
        <div className="space-y-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Reason for rejecting (required)…"
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleReject}
              disabled={loading}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {loading ? 'Rejecting…' : 'Confirm Reject'}
            </button>
            <button
              type="button"
              onClick={() => { setRejecting(false); setComment(''); setError(null); }}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm px-3 py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleApprove}
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
      )}
    </div>
  );
}