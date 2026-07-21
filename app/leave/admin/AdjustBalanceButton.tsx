'use client';

import { useState } from 'react';

const CODES = [
  { code: 'SL', label: 'Sick Leave' },
  { code: 'CL', label: 'Casual Leave' },
  { code: 'PL', label: 'Planned Leave' },
] as const;

export default function AdjustBalanceButton({
  employeeId,
  employeeName,
  fyStartYear,
}: {
  employeeId: string;
  employeeName: string;
  fyStartYear: number;
}) {
  const [open, setOpen] = useState(false);
  const [leaveTypeCode, setLeaveTypeCode] = useState<(typeof CODES)[number]['code']>('PL');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function close() {
    setOpen(false);
    setDelta('');
    setReason('');
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const deltaNum = parseFloat(delta);
    if (!delta || Number.isNaN(deltaNum) || deltaNum === 0) {
      setError('Enter a non-zero amount (positive to add, negative to subtract).');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/leave/employees/${employeeId}/adjust-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leave_type_code: leaveTypeCode, delta: deltaNum, reason }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setError(data.error || `Failed (${res.status}).`);
        setSaving(false);
        return;
      }
      window.location.reload();
    } catch {
      setError('Could not reach the server — check your connection and try again.');
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-lg px-2.5 py-1 transition-colors"
      >
        Adjust
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={close}>
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-white font-semibold text-sm">Adjust balance — {employeeName}</h3>
              <p className="text-slate-500 text-xs mt-1">FY {fyStartYear}-{String(fyStartYear + 1).slice(-2)}. Every adjustment is recorded with who, when, and why.</p>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Leave type</label>
                <select
                  value={leaveTypeCode}
                  onChange={(e) => setLeaveTypeCode(e.target.value as typeof leaveTypeCode)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  {CODES.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Amount (days) — negative to subtract</label>
                <input
                  type="number"
                  step="0.5"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  placeholder="e.g. 2 or -1.5"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Reason (required)</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="e.g. correcting mid-year joiner proration"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  required
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={close} className="text-slate-400 hover:text-white text-sm px-3 py-2">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {saving ? 'Saving…' : 'Save adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
