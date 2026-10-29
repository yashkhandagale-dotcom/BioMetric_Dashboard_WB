'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Clock, User, Edit3, SlidersHorizontal, CheckCircle2 } from 'lucide-react';
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

import { formatOrdinalDate, formatOrdinalDateRange } from '@/lib/dateFormat';

function formatDate(dateStr: string) {
  return formatOrdinalDate(dateStr);
}

function formatDateRange(start: string, end: string) {
  return formatOrdinalDateRange(start, end);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U';
}

const FIELD_LABEL_CLASS =
  'text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]';

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
  const [editing, setEditing] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reminderSent, setReminderSent] = useState(false);

  // Manager discretion overrides
  const [overrideLeaveType, setOverrideLeaveType] = useState(request.leaveTypeCode);
  const [overrideStartDate, setOverrideStartDate] = useState(request.startDate);
  const [overrideEndDate, setOverrideEndDate] = useState(request.endDate);
  const [overrideDays, setOverrideDays] = useState(request.totalDays);
  const [managerNote, setManagerNote] = useState('');

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

  async function handleApproveWithOverrides() {
    if (editing && !managerNote.trim()) {
      setError('Please provide a reason / note for the manager override.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/leave/approvals/${request.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          overrideLeaveTypeCode: overrideLeaveType !== request.leaveTypeCode ? overrideLeaveType : undefined,
          overrideStartDate: overrideStartDate !== request.startDate ? overrideStartDate : undefined,
          overrideEndDate: overrideEndDate !== request.endDate ? overrideEndDate : undefined,
          overrideTotalDays: overrideDays !== request.totalDays ? Number(overrideDays) : undefined,
          managerNote: managerNote.trim() || undefined,
        }),
      });

      const text = await res.text();
      const body = text ? JSON.parse(text) : {};

      if (!res.ok) {
        setError(body.error || 'Could not approve this request with overrides.');
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
      setError('A reason is required when rejecting a request.');
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
          body: JSON.stringify({ comment: comment.trim() }),
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
    <div
      className="h-full flex flex-col border border-[var(--border)] rounded-2xl p-5 space-y-4 shadow-sm hover:shadow-lg hover:border-[var(--accent)]/40 transition-all duration-200"
      style={{
        background: 'linear-gradient(160deg, var(--bg-card) 0%, var(--bg-elevated) 100%)',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 text-amber-600 dark:text-amber-400 border border-amber-500/25 text-xs font-bold shadow-sm">
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

        {request.isLwpOverride && <ViolationBadge count={1} />}
      </div>

      {/* Metric Tiles Grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-[var(--bg-surface)]/80 border border-[var(--border-subtle)] rounded-xl p-2.5">
          <p className={FIELD_LABEL_CLASS}>Leave Type</p>
          <p className="text-[var(--text-primary)] font-bold text-sm mt-1 truncate">
            {request.leaveTypeLabel}
          </p>
        </div>

        <div className="bg-[var(--bg-surface)]/80 border border-[var(--border-subtle)] rounded-xl p-2.5">
          <p className={FIELD_LABEL_CLASS}>Dates</p>
          <p className="text-[var(--text-primary)] font-semibold text-xs mt-1 truncate">
            {formatDateRange(request.startDate, request.endDate)}
            {request.isHalfDay &&
              ` (${request.halfDaySession ?? 'half day'})`}
          </p>
        </div>

        <div className="bg-[var(--bg-surface)]/80 border border-[var(--border-subtle)] rounded-xl p-2.5">
          <p className={FIELD_LABEL_CLASS}>Days Requested</p>
          <p className="text-[var(--accent)] font-extrabold text-base mt-0.5 tabular-nums">
            {request.totalDays} <span className="text-[10px] font-normal text-[var(--text-muted)]">days</span>
          </p>
        </div>

        <div className="bg-[var(--bg-surface)]/80 border border-[var(--border-subtle)] rounded-xl p-2.5">
          <p className={FIELD_LABEL_CLASS}>
            Balance ({request.leaveTypeCode})
          </p>
          <p className="text-[var(--text-primary)] font-extrabold text-base mt-0.5 tabular-nums">
            {request.currentBalance !== null
              ? request.currentBalance.toFixed(1)
              : '—'}
          </p>
        </div>
      </div>

      {/* LWP Banner */}
      {request.isLwpOverride && request.lwpOverrideReason && (
        <p className="text-amber-700 dark:text-amber-300 text-xs bg-amber-500/15 border border-amber-500/30 rounded-xl px-3.5 py-2.5 leading-relaxed font-medium">
          {request.lwpOverrideReason}
        </p>
      )}

      {/* Reason */}
      <div className="bg-[var(--bg-surface)]/40 rounded-xl p-3 border border-[var(--border-subtle)]">
        <p className={FIELD_LABEL_CLASS}>Reason</p>
        <p className="text-[var(--text-primary)] text-xs mt-1 leading-relaxed italic">
          &ldquo;{request.reason}&rdquo;
        </p>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 dark:bg-red-500/15 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-xl px-3.5 py-2.5 font-medium">
          {error}
        </div>
      )}

      {/* Actions */}
      {rejecting ? (
        <div className="mt-auto pt-3.5 space-y-3 border-t border-[var(--border-subtle)]">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Reason for rejecting (required)…"
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-shadow focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]"
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmingReject(true)}
              disabled={loading}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-sm"
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
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs font-medium px-3 py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : editing ? (
        <div className="mt-auto pt-3.5 space-y-3 border-t border-indigo-500/30 bg-indigo-500/5 -mx-5 -mb-5 p-4 rounded-b-2xl">
          <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300">
            <SlidersHorizontal size={14} />
            <span>Manager Discretion Override</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label className={FIELD_LABEL_CLASS}>Leave Type</label>
              <select
                value={overrideLeaveType}
                onChange={(e) => setOverrideLeaveType(e.target.value)}
                className="w-full mt-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="SL">Sick Leave (SL)</option>
                <option value="CL">Casual Leave (CL)</option>
                <option value="PL">Privilege Leave (PL)</option>
                <option value="LWP">Leave Without Pay (LWP)</option>
              </select>
            </div>

            <div>
              <label className={FIELD_LABEL_CLASS}>Total Days</label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                value={overrideDays}
                onChange={(e) => setOverrideDays(Number(e.target.value))}
                className="w-full mt-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className={FIELD_LABEL_CLASS}>Start Date</label>
              <input
                type="date"
                value={overrideStartDate}
                onChange={(e) => setOverrideStartDate(e.target.value)}
                className="w-full mt-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className={FIELD_LABEL_CLASS}>End Date</label>
              <input
                type="date"
                value={overrideEndDate}
                onChange={(e) => setOverrideEndDate(e.target.value)}
                className="w-full mt-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className={FIELD_LABEL_CLASS}>Discretion Rationale / Note (Required)</label>
            <input
              type="text"
              value={managerNote}
              onChange={(e) => setManagerNote(e.target.value)}
              placeholder="e.g. Corrected to PL per notice policy / Biometric match"
              className="w-full mt-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleApproveWithOverrides}
              disabled={loading}
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-2 rounded-xl transition-all shadow-sm disabled:opacity-50"
            >
              <CheckCircle2 size={13} />
              {loading ? 'Approving…' : 'Approve with Changes'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="px-3 py-2 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-auto flex items-center gap-1.5 pt-3.5 border-t border-[var(--border-subtle)]">
          {canApprove && (
            <>
              <button
                type="button"
                onClick={() => setConfirmingApprove(true)}
                disabled={loading}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl transition-all shadow-sm"
              >
                {loading ? 'Approving…' : 'Approve'}
              </button>

              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={loading}
                className="inline-flex items-center gap-1 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 text-xs font-semibold px-2.5 py-2.5 rounded-xl transition-all"
                title="Override leave type, dates, or days using manager discretion"
              >
                <Edit3 size={13} />
                <span>Edit &amp; Approve</span>
              </button>

              <button
                type="button"
                onClick={() => setRejecting(true)}
                disabled={loading}
                className="border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 text-xs font-semibold px-3 py-2.5 rounded-xl transition-all"
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
              className="border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-50 text-xs font-semibold px-3 py-2.5 rounded-xl transition-all ml-auto"
            >
              {reminderSent ? '✓ Reminded' : 'Remind'}
            </button>
          )}
        </div>
      )}

      {/* Confirmation Dialogs */}
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