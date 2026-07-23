'use client';

import { useEffect, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

type AnalyticsResponse = {
  fyStartYear: number;
  fyLabel: string;
  byType: { code: string; label: string; totalDays: number; count: number }[];
  byMonth: { month: string; totalDays: number }[];
  byDepartment: { department: string; totalDays: number; count: number }[];
};

const TYPE_COLORS: Record<string, string> = {
  SL: '#fbbf24',
  CL: '#60a5fa',
  PL: '#34d399',
  LWP: '#f87171',
};

const TOOLTIP_STYLE = {
  backgroundColor: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  fontSize: 12,
  color: '#e2e8f0',
};

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  const d = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, 1));
  return d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

// D5-1..D5-3: reuses this repo's existing Recharts patterns (see
// components/Charts.tsx / EmployeeComparisonPanel.tsx — ResponsiveContainer,
// dark tooltip, CartesianGrid) rather than introducing a second charting
// convention. All three charts share the one D5-4 API response, so this
// only ever makes a single network call per FY.
export default function LeaveAnalytics({ fyStartYear }: { fyStartYear: number }) {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/leave/analytics?fy_start_year=${fyStartYear}`);
        const text = await res.text();
        const body = text ? JSON.parse(text) : {};
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error || `Could not load analytics (${res.status}).`);
          return;
        }
        setData(body);
      } catch {
        if (!cancelled) setError('Could not reach the server — check your connection and retry.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [fyStartYear]);

  if (loading) return <p className="text-slate-500 text-sm">Loading analytics…</p>;
  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">{error}</div>
    );
  }
  if (!data) return null;

  const hasAnyData = data.byType.length > 0;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-slate-300">Leave Analytics — {data.fyLabel}</h2>

      {!hasAnyData ? (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl px-4 py-10 text-center text-slate-500 text-sm">
          No leave recorded yet this FY — charts will populate as leave is recorded.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* D5-1: leave-type distribution */}
          <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-400 mb-2">Leave-Type Distribution (days)</p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={data.byType}
                  dataKey="totalDays"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={(entry: any) => `${entry.code}: ${entry.totalDays}`}
                >
                  {data.byType.map((d) => (
                    <Cell key={d.code} fill={TYPE_COLORS[d.code] || '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* D5-2: monthly leave trend */}
          <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-400 mb-2">Monthly Trend (total days)</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.byMonth.map((m) => ({ ...m, label: monthLabel(m.month) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Line type="monotone" dataKey="totalDays" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* D5-3: department-wise leave load */}
          <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-400 mb-2">Department-Wise Load (total days)</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.byDepartment}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="department" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="totalDays" fill="#60a5fa" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}