'use client';

import { useState } from 'react';

export default function SeedBalancesButton({ fyLabel }: { fyLabel: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function handleSeed() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/leave/admin/seed-balances', { method: 'POST' });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || `Failed (${res.status}).` });
      } else if (data.seeded_count === 0) {
        setMessage({ type: 'success', text: `No employees needed seeding — everyone already has a balance for ${fyLabel}.` });
        window.location.reload();
      } else {
        setMessage({ type: 'success', text: `Seeded ${data.seeded_count} employee(s) with opening balances (5 SL / 5 CL / 11 PL) for ${fyLabel}.` });
        window.location.reload();
      }
    } catch {
      setMessage({ type: 'error', text: 'Could not reach the server — check your connection and try again.' });
    }
    setLoading(false);
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={handleSeed}
        disabled={loading}
        className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        title="One-time: grants 5 SL / 5 CL / 11 PL to any employee missing a balance for this FY. Safe to click more than once."
      >
        {loading ? 'Seeding…' : 'Seed opening balances'}
      </button>
      {message && (
        <div className={`text-xs rounded-lg px-3 py-1.5 max-w-xs text-right ${message.type === 'error' ? 'bg-red-900/30 border border-red-500/30 text-red-300' : 'bg-emerald-900/30 border border-emerald-500/30 text-emerald-300'}`}>
          {message.text}
        </div>
      )}
    </div>
  );
}
