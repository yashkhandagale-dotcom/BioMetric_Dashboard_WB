'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Calculator, CheckCircle2, ClipboardCopy } from 'lucide-react';

// HR-only. Single "Calculate F&F" entry point per employee.
// Modal is portalled to document.body so it never causes the employee
// card grid to freeze/blink on open.

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
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [lwd, setLwd] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [result, setResult] = useState<FnFResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Mount guard for createPortal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);

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
      if (data.warning) setWarning(data.warning);
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

  const modal = open && mounted && (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-[var(--border)] shadow-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(160deg, var(--bg-card) 0%, var(--bg-elevated) 100%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)] bg-[var(--bg-surface)]/80">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 flex items-center justify-center shrink-0">
            <Calculator size={16} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-[var(--text-primary)] truncate">
              F&amp;F Calculator
            </h3>
            <p className="text-[11px] text-[var(--text-muted)] truncate">{employeeName}</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Description */}
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Pick a Last Working Day to get Payable Days &amp; Payable Leaves. Every calculation is logged.
          </p>

          {/* Error / Warning */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 dark:bg-red-500/15 border border-red-500/30 text-red-700 dark:text-red-300 text-xs font-medium rounded-xl p-3">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {warning && !error && (
            <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs font-medium rounded-xl p-3">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{warning}</span>
            </div>
          )}

          {/* LWD Picker */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
              Last Working Day
            </label>
            <input
              type="date"
              value={lwd}
              onChange={(e) => setLwd(e.target.value)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
            />
          </div>

          {/* Results */}
          {result && (
            <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl px-3 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    Payable Days
                  </p>
                  <p className="text-[var(--text-primary)] text-2xl font-black leading-tight mt-0.5">
                    {result.days.payableDays}
                  </p>
                </div>
                <div className="bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-2xl px-3 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                    Payable Leaves
                  </p>
                  <p className="text-[var(--text-primary)] text-2xl font-black leading-tight mt-0.5">
                    {result.leaves.payableLeaves}
                  </p>
                </div>
              </div>

              <div className="text-[11px] text-[var(--text-muted)] space-y-1.5 bg-[var(--bg-surface)] rounded-xl px-3.5 py-3 border border-[var(--border-subtle)]">
                <div className="flex justify-between gap-2">
                  <span>Cycle</span>
                  <span className="text-[var(--text-primary)] font-medium">
                    {result.days.cycleStart} → {result.lastWorkingDay}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Gross days − LWP</span>
                  <span className="text-[var(--text-primary)] font-medium">
                    {result.days.grossDays} − {result.days.lwpDays}
                  </span>
                </div>
                <div className="h-px bg-[var(--border-subtle)] my-1" />
                <div className="flex justify-between gap-2">
                  <span>Months served × rate</span>
                  <span className="text-[var(--text-primary)] font-medium">
                    {result.leaves.monthsServed} × {result.leaves.monthlyRate.toFixed(2)}/mo
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Entitled − used</span>
                  <span className="text-[var(--text-primary)] font-medium">
                    {result.leaves.entitlement} − {result.leaves.leaveUsedThisFY}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={copySummary}
                className={`w-full flex items-center justify-center gap-2 text-xs font-semibold rounded-xl border py-2 transition-all ${
                  copied
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {copied ? (
                  <>
                    <CheckCircle2 size={13} />
                    Copied!
                  </>
                ) : (
                  <>
                    <ClipboardCopy size={13} />
                    Copy summary for Accounts
                  </>
                )}
              </button>
            </div>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-end gap-2 pt-1 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={close}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={calculate}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:opacity-95 text-white text-xs font-bold shadow-md shadow-emerald-500/25 disabled:opacity-50 transition-all"
            >
              {loading ? 'Calculating…' : 'Calculate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-all shadow-xs"
        title="Calculate Full & Final settlement"
      >
        <Calculator size={13} />
        Calculate F&amp;F
      </button>

      {mounted && modal && createPortal(modal, document.body)}
    </>
  );
}
