'use client';

import React from 'react';
import { Layers } from 'lucide-react';
import InfoTooltip from '@/components/InfoTooltip';
import { formatOrdinalDate, formatOrdinalDateRange } from '@/lib/dateFormat';
import {
  LeaveHistoryRow,
  initials,
  leaveTypeBadge,
  statusLabel,
  STATUS_STYLE,
  todayYMD,
} from './leaveHistoryTypes';

export interface LeaveHistoryRowItemProps {
  row: LeaveHistoryRow;
  isSingleEmployee: boolean;
  hasActionsColumn: boolean;
  showActions: boolean;
  allowHrCancel: boolean;
  hrCorrection: boolean;
  busyId: string | null;
  rowError: { id: string; message: string } | null;
  onCancel: (id: string) => void;
  onReapply: (row: LeaveHistoryRow) => void;
  onCorrect: (row: LeaveHistoryRow) => void;
}

export default function LeaveHistoryRowItem({
  row: r,
  isSingleEmployee,
  hasActionsColumn,
  showActions,
  allowHrCancel,
  hrCorrection,
  busyId,
  rowError,
  onCancel,
  onReapply,
  onCorrect,
}: LeaveHistoryRowItemProps) {
  const alreadyStarted = r.status !== 'pending' && r.startDate <= todayYMD();
  const showCancel =
    (showActions || allowHrCancel) &&
    (r.status === 'pending' || r.status === 'approved' || r.status === 'auto_lwp');
  const showReapply = showActions && r.status === 'rejected';
  const showCorrect = hrCorrection && (r.status === 'approved' || r.status === 'auto_lwp');

  return (
    <tr className="hover:bg-[var(--bg-surface)]/60 transition-colors group">
      {/* Date Range & Duration */}
      <td className="py-3 px-4 align-top">
        <div className="space-y-1">
          <p className="font-semibold text-[var(--text-primary)] text-xs">
            {formatOrdinalDateRange(r.startDate, r.endDate, r.isHalfDay, r.totalDays)}
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-[var(--accent)] text-xs tabular-nums">
              {r.totalDays.toFixed(1)} {r.totalDays === 1 ? 'day' : 'days'}
            </span>
            {r.isConsolidated && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/15 border border-emerald-500/20 rounded-md px-1.5 py-0.2">
                <Layers size={10} /> Continuous ({r.constituentCount ?? 2} spans)
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Employee Column */}
      {!isSingleEmployee && (
        <td className="py-3 px-4 align-top">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/15 text-[var(--accent)] text-[10px] font-bold">
              {initials(r.employeeName)}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-[var(--text-primary)] text-xs truncate max-w-[150px]">
                {r.employeeName}
              </p>
              <p className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
                {r.employeeCode} · <span className="font-medium text-[var(--text-primary)]">{r.department}</span>
              </p>
            </div>
          </div>
        </td>
      )}

      {/* Leave Type */}
      <td className="py-3 px-4 align-top">
        {leaveTypeBadge(r.leaveTypeCode, r.leaveTypeLabel)}
      </td>

      {/* Details & Attributes */}
      <td className="py-3 px-4 align-top">
        <div className="space-y-1">
          <div className="flex items-center gap-1 flex-wrap">
            {r.isHalfDay && (
              <span className="inline-flex items-center text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/15 border border-amber-500/25 rounded px-1.5 py-0.5">
                Half Day ({r.halfDaySession ?? 'Session'})
              </span>
            )}

            {r.isLwpOverride && (
              <span className="inline-flex items-center text-[10px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-500/15 border border-purple-500/25 rounded px-1.5 py-0.5">
                LWP Override
              </span>
            )}

            {!r.isHalfDay && !r.isLwpOverride && (
              <span className="text-[11px] text-[var(--text-muted)]">Standard full day</span>
            )}
          </div>

          <p className="text-[10px] text-[var(--text-muted)]">
            Applied {formatOrdinalDate(r.appliedOn)} · {r.recordedBy}
          </p>
        </div>
      </td>

      {/* Status */}
      <td className="py-3 px-4 align-top">
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[11px] font-bold rounded-full px-2.5 py-0.5 whitespace-nowrap ${
              STATUS_STYLE[r.status] ?? 'bg-[var(--text-muted)]/15 text-[var(--text-muted)]'
            }`}
          >
            {r.status === 'cancelled' && r.correctedByName ? 'Reversed by HR' : statusLabel(r.status)}
          </span>

          {r.status === 'cancelled' && r.correctedByName && (
            <InfoTooltip
              title="Reversed by HR"
              description={`${r.correctedByName} reversed this record.${
                r.correctionReason ? ` Reason: ${r.correctionReason}` : ''
              }`}
            />
          )}
        </div>
      </td>

      {/* Actions */}
      {hasActionsColumn && (
        <td className="py-3 px-4 align-top text-right">
          <div className="flex items-center justify-end gap-1.5 flex-wrap">
            {showCancel && (
              <button
                type="button"
                disabled={busyId === r.id || alreadyStarted}
                title={alreadyStarted ? 'This leave has already started — it can no longer be cancelled.' : undefined}
                onClick={() => onCancel(r.id)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {r.status === 'pending' ? 'Withdraw' : 'Cancel'}
              </button>
            )}

            {showReapply && (
              <button
                type="button"
                onClick={() => onReapply(r)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold text-[var(--accent)] bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 transition-colors"
              >
                Reapply
              </button>
            )}

            {showCorrect && (
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={() => onCorrect(r)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-40 transition-colors"
              >
                Correct / Reverse
              </button>
            )}
          </div>

          {rowError?.id === r.id && (
            <p className="text-red-500 text-[10px] mt-1 text-right font-medium">{rowError.message}</p>
          )}
        </td>
      )}
    </tr>
  );
}
