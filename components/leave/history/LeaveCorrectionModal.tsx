'use client';

import React, { useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { formatOrdinalDateRange } from '@/lib/dateFormat';
import { LeaveHistoryRow } from './leaveHistoryTypes';

function Modal({
  onClose,
  title,
  description,
  children,
  footer,
}: {
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">{title}</h3>
          {description && <p className="text-[var(--text-muted)] text-xs mt-1 leading-relaxed">{description}</p>}
        </div>
        <div className="px-5 py-4">{children}</div>
        <div className="px-5 py-4 flex justify-end gap-2 border-t border-[var(--border)]">{footer}</div>
      </div>
    </div>
  );
}

export interface LeaveCorrectionModalProps {
  correctingRow: LeaveHistoryRow;
  onClose: () => void;
  onSuccess: () => void;
}

export default function LeaveCorrectionModal({
  correctingRow,
  onClose,
  onSuccess,
}: LeaveCorrectionModalProps) {
  const [correctMode, setCorrectMode] = useState<'adjust' | 'reverse'>('adjust');
  const [adjustedDays, setAdjustedDays] = useState<number>(correctingRow.totalDays);
  const [adjustedStartDate] = useState<string>(correctingRow.startDate);
  const [adjustedEndDate] = useState<string>(correctingRow.endDate);
  const [firstDayHalfDay, setFirstDayHalfDay] = useState<boolean>(correctingRow.isHalfDay);
  const [halfDaySession, setHalfDaySession] = useState<'AM' | 'PM'>((correctingRow.halfDaySession as 'AM' | 'PM') || 'AM');
  const [correctionReason, setCorrectionReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function applyFirstDayHalfDayShortcut() {
    const newDays = Math.max(0.5, Number((correctingRow.totalDays - 0.5).toFixed(1)));
    setAdjustedDays(newDays);
    setFirstDayHalfDay(true);
    if (!correctionReason.trim()) {
      setCorrectionReason('First day was a half day, employee attended in the afternoon.');
    }
  }

  function applyLastDayHalfDayShortcut() {
    const newDays = Math.max(0.5, Number((correctingRow.totalDays - 0.5).toFixed(1)));
    setAdjustedDays(newDays);
    if (!correctionReason.trim()) {
      setCorrectionReason('Last day was a half day, employee left early.');
    }
  }

  async function handleConfirmCorrect() {
    if (!correctionReason.trim()) {
      setErrorMessage('A reason is required to submit a correction.');
      return;
    }
    if (correctMode === 'adjust' && (adjustedDays <= 0 || (adjustedDays * 2) % 1 !== 0)) {
      setErrorMessage('Total days must be in increments of 0.5 (e.g. 0.5, 1.0, 3.5).');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/leave/requests/${correctingRow.id}/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: correctMode,
          reason: correctionReason.trim(),
          newTotalDays: correctMode === 'adjust' ? adjustedDays : 0,
          newStartDate: adjustedStartDate,
          newEndDate: adjustedEndDate,
          firstDayHalfDay,
          firstDaySession: halfDaySession,
        }),
      });
      const text = await res.text();
      const body = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setErrorMessage(body.error || 'Could not correct this request.');
        return;
      }
      onSuccess();
    } catch {
      setErrorMessage('Could not reach the server — check your connection and retry.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Correct or Reverse Leave Record"
      description={`Adjust leave days or reverse record for ${correctingRow.employeeName} (${correctingRow.employeeCode}).`}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated)]/80 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmCorrect}
            disabled={isSubmitting || !correctionReason.trim()}
            className={`px-4 py-2 rounded-xl text-xs font-bold text-white transition-colors shadow-2xs ${
              correctMode === 'reverse'
                ? 'bg-red-600 hover:bg-red-500 disabled:opacity-50'
                : 'bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50'
            }`}
          >
            {isSubmitting
              ? 'Saving…'
              : correctMode === 'reverse'
              ? 'Confirm Full Reversal'
              : 'Save Correction'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Record Overview */}
        <div className="bg-[var(--bg-elevated)]/60 border border-[var(--border)] rounded-xl p-3 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[var(--text-primary)]">{correctingRow.employeeName}</span>
            <span className="font-semibold text-[var(--accent)]">{correctingRow.leaveTypeLabel}</span>
          </div>
          <p className="text-[var(--text-muted)]">
            Current:{' '}
            <span className="font-semibold text-[var(--text-primary)]">
              {formatOrdinalDateRange(
                correctingRow.startDate,
                correctingRow.endDate,
                correctingRow.isHalfDay,
                correctingRow.totalDays
              )}
            </span>{' '}
            · <span className="font-bold">{correctingRow.totalDays.toFixed(1)} days</span>
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-1 bg-[var(--bg-elevated)] p-1 rounded-xl border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setCorrectMode('adjust')}
            className={`py-1.5 text-xs font-bold rounded-lg transition-colors ${
              correctMode === 'adjust'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-2xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            ✏️ Adjust Leave Days
          </button>
          <button
            type="button"
            onClick={() => setCorrectMode('reverse')}
            className={`py-1.5 text-xs font-bold rounded-lg transition-colors ${
              correctMode === 'reverse'
                ? 'bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/25 shadow-2xs'
                : 'text-[var(--text-muted)] hover:text-red-600'
            }`}
          >
            🔄 Full Reverse (0 days)
          </button>
        </div>

        {correctMode === 'adjust' ? (
          <div className="space-y-3.5">
            {/* Quick Shortcuts */}
            {correctingRow.totalDays > 0.5 && (
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Quick Half-Day Adjustments
                </label>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={applyFirstDayHalfDayShortcut}
                    className="inline-flex items-center gap-1 text-xs font-medium rounded-lg px-2.5 py-1 bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/20 transition-colors"
                  >
                    ⚡ First day is half-day (-0.5 day)
                  </button>
                  <button
                    type="button"
                    onClick={applyLastDayHalfDayShortcut}
                    className="inline-flex items-center gap-1 text-xs font-medium rounded-lg px-2.5 py-1 bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/20 transition-colors"
                  >
                    ⚡ Last day is half-day (-0.5 day)
                  </button>
                </div>
              </div>
            )}

            {/* Adjusted Days Field */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                Adjusted Total Working Days
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustedDays((d) => Math.max(0.5, Number((d - 0.5).toFixed(1))))}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-[var(--border)] text-sm font-bold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                >
                  −
                </button>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={adjustedDays}
                  onChange={(e) => setAdjustedDays(Number(e.target.value))}
                  className="w-24 text-center font-bold text-sm bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl py-1.5 text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={() => setAdjustedDays((d) => Number((d + 0.5).toFixed(1)))}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-[var(--border)] text-sm font-bold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                >
                  +
                </button>
                <span className="text-xs text-[var(--text-muted)] font-medium">days</span>
              </div>
            </div>

            {/* Live Balance Impact Preview */}
            {(() => {
              const delta = Number((correctingRow.totalDays - adjustedDays).toFixed(1));
              if (delta > 0) {
                return (
                  <div className="flex items-start gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs">
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Balance Refund: +{delta} day(s)</p>
                      <p className="text-[11px] opacity-85 mt-0.5">
                        {delta} day(s) will be credited back to {correctingRow.employeeName}&apos;s{' '}
                        {correctingRow.leaveTypeCode} balance.
                      </p>
                    </div>
                  </div>
                );
              }
              if (delta < 0) {
                return (
                  <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Additional Deduction: {Math.abs(delta)} day(s)</p>
                      <p className="text-[11px] opacity-85 mt-0.5">
                        {Math.abs(delta)} extra day(s) will be debited from {correctingRow.employeeName}&apos;s balance.
                      </p>
                    </div>
                  </div>
                );
              }
              return (
                <p className="text-[11px] text-[var(--text-muted)] italic">
                  No change in total days ({adjustedDays} days).
                </p>
              );
            })()}

            {/* Session selection if single half-day */}
            {adjustedDays === 0.5 && (
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Half-Day Session
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setHalfDaySession('AM')}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                      halfDaySession === 'AM'
                        ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                        : 'border-[var(--border)] text-[var(--text-muted)]'
                    }`}
                  >
                    First Half (AM)
                  </button>
                  <button
                    type="button"
                    onClick={() => setHalfDaySession('PM')}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                      halfDaySession === 'PM'
                        ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                        : 'border-[var(--border)] text-[var(--text-muted)]'
                    }`}
                  >
                    Second Half (PM)
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-300 text-xs space-y-1">
            <p className="font-bold">Full Reversal Warning</p>
            <p className="text-[11px] leading-relaxed">
              This will cancel the entire leave request and credit {correctingRow.totalDays.toFixed(1)} day(s)
              back to {correctingRow.employeeName}&apos;s balance.
            </p>
          </div>
        )}

        {/* Mandatory Reason Field */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
            Reason for correction <span className="text-red-500">*</span>
          </label>
          <textarea
            value={correctionReason}
            onChange={(e) => setCorrectionReason(e.target.value)}
            rows={2}
            placeholder={
              correctMode === 'adjust'
                ? "e.g. 'First day was a half day, employee attended in the afternoon.'"
                : "e.g. 'Employee actually attended that day — marked in error.'"
            }
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]"
          />
        </div>

        {errorMessage && (
          <p className="text-red-500 text-xs font-medium">{errorMessage}</p>
        )}
      </div>
    </Modal>
  );
}
