'use client';

import { useState } from 'react';

// HR-only. Single "Calculate F&F" entry point per employee — same modal
// pattern as AdjustBalanceButton (backdrop click-to-close, rounded-2xl
// card, consistent button/input styling). Shows Payable Days / Payable
// Leaves with the full breakdown so HR can eyeball the math before
// forwarding it to Accounts, plus a copy-to-clipboard summary.

type FnFResult = {
  employeeId: string;
  lastWorkingDay: string;
  fyStartYear: number;
  days: { cycleStart: string; grossDays: number; lwpDays: number; payableDays: number };
  leaves: {
    monthsServed: number;
    monthlyRate: number;
    entitlement: number;
    leaveUsedThisFY: number;
    payableLeaves: number;
  };
};

export default function FnFCalculatorButton({
  employeeId,
  employeeName,
}: {
  employeeId: string;
  employeeName: string;
}) {
  const [open, setOpen] = useState(false);
  const [lwd, setLwd] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [result, setResult] = useState<FnFResult | null>(null);
  const [copied, setCopied] = useState(false);

  function close() {
    setOpen(false);
    setError(null);
    setWarning(null);
    setResult(null);
    setLwd('');
    setCopied(false);
  }

  async function calculate() {
    if (!lwd) {
      setError('Pick a Last Working Day.');
      return;
    }
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch('/api/leave/admin/fnf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, lastWorkingDay: lwd }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok && res.status !== 207) {
        setError(data.error ?? `Calculation failed (${res.status}).`);
        return;
      }
      setResult(data.result);
      if (data.warning) setWarning(data.warning); // non-fatal — audit save issue
    } catch {
      setError('Could not reach the server — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  function copySummary() {
    if (!result) return;
    const text = `F&F Calculation — ${employeeName}
Last Working Day: ${result.lastWorkingDay}
Payable Days: ${result.days.payableDays}  (cycle ${result.days.cycleStart} to ${result.lastWorkingDay}: ${result.days.grossDays} gross - ${result.days.lwpDays} LWP)
Payable Leaves: ${result.leaves.payableLeaves}  (${result.leaves.monthsServed} month(s) served x ${result.leaves.monthlyRate.toFixed(2)}/mo = ${result.leaves.entitlement} entitled - ${result.leaves.leaveUsedThisFY} used)`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--border)] rounded-lg px-2.5 py-1 transition-colors"
      >
        Calculate F&amp;F
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={close}>
          <div
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-[var(--text-primary)] font-semibold text-sm">F&amp;F Calculator — {employeeName}</h3>
              <p className="text-[var(--text-muted)] text-xs mt-1">
                Pick a Last Working Day to get Payable Days and Payable Leaves. Every calculation is logged.
              </p>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            {warning && !error && (
              <div className="bg-amber-900/30 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs rounded-lg px-3 py-2">
                {warning}
              </div>
            )}

            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Last Working Day</label>
              <input
                type="date"
                value={lwd}
                onChange={(e) => setLwd(e.target.value)}
                className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </div>

            {result && (
              <div className="space-y-3 border-t border-[var(--border)] pt-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[var(--bg-elevated)] rounded-lg px-3 py-2.5">
                    <p className="text-[var(--text-muted)] text-[11px] uppercase tracking-wide">Payable Days</p>
                    <p className="text-[var(--text-primary)] text-xl font-semibold leading-tight mt-0.5">
                      {result.days.payableDays}
                    </p>
                  </div>
                  <div className="bg-[var(--bg-elevated)] rounded-lg px-3 py-2.5">
                    <p className="text-[var(--text-muted)] text-[11px] uppercase tracking-wide">Payable Leaves</p>
                    <p className="text-[var(--text-primary)] text-xl font-semibold leading-tight mt-0.5">
                      {result.leaves.payableLeaves}
                    </p>
                  </div>
                </div>

                <div className="text-xs text-[var(--text-muted)] space-y-1.5 bg-[var(--bg-elevated)]/60 rounded-lg px-3 py-2.5">
                  <div className="flex justify-between gap-2">
                    <span>Cycle</span>
                    <span className="text-[var(--text-primary)]">
                      {result.days.cycleStart} → {result.lastWorkingDay}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Gross days − LWP</span>
                    <span className="text-[var(--text-primary)]">
                      {result.days.grossDays} − {result.days.lwpDays}
                    </span>
                  </div>
                  <div className="h-px bg-[var(--border)] my-1" />
                  <div className="flex justify-between gap-2">
                    <span>Months served × rate</span>
                    <span className="text-[var(--text-primary)]">
                      {result.leaves.monthsServed} × {result.leaves.monthlyRate.toFixed(2)}/mo
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Entitled − used</span>
                    <span className="text-[var(--text-primary)]">
                      {result.leaves.entitlement} − {result.leaves.leaveUsedThisFY}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={copySummary}
                  className="w-full text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border)] rounded-lg py-1.5 transition-colors"
                >
                  {copied ? 'Copied ✓' : 'Copy summary for Accounts'}
                </button>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={close}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm px-3 py-2"
              >
                Close
              </button>
              <button
                type="button"
                onClick={calculate}
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {loading ? 'Calculating…' : 'Calculate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
