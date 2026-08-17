'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Feedback item #2 — Leave Regularisation. Small inline modal (not the
// full slide-over drawer pattern used for Apply/Record Leave — this is
// a two-field form, a drawer would be overkill) a manager opens from a
// specific team member's roster row to mark a day as regularised with a
// note, e.g. "left early for a client meeting, pre-approved".
export default function RegulariseButton({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit() {
    if (!reason.trim()) {
      setError('Please add a short note explaining the regularisation.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/leave/regularisations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, date, reason }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || 'Could not save this regularisation.');
        return;
      }
      setSuccess(true);
      router.refresh();
      setTimeout(() => {
        setOpen(false);
        setSuccess(false);
        setReason('');
      }, 1200);
    } catch {
      setError('Could not reach the server — check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[var(--accent)] hover:underline text-xs font-medium"
      >
        Regularise a day
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !loading && setOpen(false)}>
          <div
            className="w-full max-w-sm bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Regularise a day</h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">for {employeeName}</p>

            {success ? (
              <p className="text-emerald-500 text-sm py-4 text-center">Saved.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Reason / note</label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder="e.g. Left early for a client meeting — pre-approved."
                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </div>
                {error && <p className="text-red-500 text-xs">{error}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={loading}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={loading}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent)] text-white disabled:opacity-50"
                  >
                    {loading ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
