'use client';

import { useEffect, useState } from 'react';
import AdjustBalanceButton from '@/app/leave/admin/AdjustBalanceButton';
import { getFYStartYear } from '@/lib/leaveSupabase/fyHelpers';

type ViolationType = 'lwp_conversion' | 'missing_certificate' | 'early_probation_pl' | 'negative_balance';

type Violation = {
  id: string;
  type: ViolationType;
  severity: 'high' | 'medium';
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  summary: string;
  detail: string;
  occurredOn: string;
  leaveRequestId?: string;
  leaveBalanceId?: string;
  leaveTypeCode?: string;
};

const TYPE_LABELS: Record<ViolationType, string> = {
  lwp_conversion: 'LWP Conversions (notice/balance shortfall)',
  missing_certificate: 'Missing Medical Certificates',
  early_probation_pl: 'Probation-Period PL Taken Early',
  negative_balance: 'Negative / Over-Drawn Balances',
};

const CURRENT_FY_START_YEAR = getFYStartYear();

// D4-5: same-page Resolve. Each violation type's action is whatever
// actually changes the underlying condition (see the API route's
// comments) — not a generic "dismiss" — so a resolved item genuinely
// stops appearing on refetch instead of being hidden client-side.
export default function ViolationsPage() {
  const [violations, setViolations] = useState<Violation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [certDrafts, setCertDrafts] = useState<Record<string, string>>({});
  const [certSaving, setCertSaving] = useState<string | null>(null);
  const [certError, setCertError] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/leave/violations');
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setError(data.error || `Could not load violations (${res.status}).`);
        return;
      }
      setViolations(data.violations ?? []);
    } catch {
      setError('Could not reach the server — check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function resolveCertificate(v: Violation) {
    const url = (certDrafts[v.id] || '').trim();
    if (!url) {
      setCertError((s) => ({ ...s, [v.id]: 'Enter a certificate reference/filename first.' }));
      return;
    }
    setCertSaving(v.id);
    setCertError((s) => ({ ...s, [v.id]: '' }));
    try {
      const res = await fetch('/api/leave/violations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leave_request_id: v.leaveRequestId, medical_certificate_url: url }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setCertError((s) => ({ ...s, [v.id]: data.error || `Could not save (${res.status}).` }));
        return;
      }
      await load();
    } catch {
      setCertError((s) => ({ ...s, [v.id]: 'Could not reach the server — check your connection and retry.' }));
    } finally {
      setCertSaving(null);
    }
  }

  const grouped = (Object.keys(TYPE_LABELS) as ViolationType[]).map((type) => ({
    type,
    items: violations.filter((v) => v.type === type),
  }));

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Violations</h1>
        <a href="/leave/admin/employees" className="text-xs text-slate-400 hover:text-white">
          ← Back to employees
        </a>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : violations.length === 0 ? (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl px-4 py-10 text-center text-slate-500 text-sm">
          No open violations. 🎉
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(
            (group) =>
              group.items.length > 0 && (
                <div key={group.type} className="space-y-2">
                  <h2 className="text-sm font-semibold text-slate-300">
                    {TYPE_LABELS[group.type]} <span className="text-slate-500 font-normal">({group.items.length})</span>
                  </h2>
                  <div className="space-y-2">
                    {group.items.map((v) => (
                      <div
                        key={v.id}
                        className="bg-slate-800/40 border border-slate-700 rounded-xl px-4 py-3 flex items-start justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <p className="text-white text-sm font-medium">{v.summary}</p>
                          <p className="text-slate-500 text-xs mt-0.5">
                            {v.employeeName} ({v.employeeCode}) · {v.occurredOn}
                          </p>
                          <p className="text-slate-400 text-xs mt-1">{v.detail}</p>

                          {v.type === 'missing_certificate' && (
                            <div className="mt-2 flex items-center gap-2">
                              <input
                                type="text"
                                value={certDrafts[v.id] || ''}
                                onChange={(e) => setCertDrafts((s) => ({ ...s, [v.id]: e.target.value }))}
                                placeholder="Certificate reference / filename on file…"
                                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white w-64"
                              />
                              <button
                                type="button"
                                onClick={() => resolveCertificate(v)}
                                disabled={certSaving === v.id}
                                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                              >
                                {certSaving === v.id ? 'Saving…' : 'Mark Received'}
                              </button>
                            </div>
                          )}
                          {certError[v.id] && <p className="text-red-400 text-xs mt-1">{certError[v.id]}</p>}
                        </div>

                        <div className="flex-shrink-0">
                          {(v.type === 'negative_balance' || v.type === 'early_probation_pl') && (
                            <AdjustBalanceButton
                              employeeId={v.employeeId}
                              employeeName={v.employeeName}
                              fyStartYear={CURRENT_FY_START_YEAR}
                            />
                          )}
                          {v.type === 'lwp_conversion' && (
                            <span
                              title="Already correctly recorded as LWP — nothing further to fix, shown for review only."
                              className="text-slate-500 text-xs italic"
                            >
                              Auto-resolved
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
          )}
        </div>
      )}
    </div>
  );
}