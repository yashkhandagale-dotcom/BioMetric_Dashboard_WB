'use client';

import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from 'recharts';
import {
  CalendarDays,
  Users,
  Clock,
  UserCheck,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Info,
  Layers,
} from 'lucide-react';
import { AnalyticsFilterState, buildFilterQueryString } from './types';

interface OverviewData {
  fyStartYear: number;
  fyLabel: string;
  kpis: {
    approvedLeaveDays: number;
    approvedDaysDiff: number;
    approvedDaysPctChange: number | null;
    activeHeadcount: number;
    avgDaysPerEmployee: number;
    avgDaysDiff: number;
    pendingApprovals: {
      count: number;
      oldestAgeDays: number;
    };
    onLeaveTodayCount: number;
    lwpDays: number;
    lwpDiff: number;
    lwpPctChange: number | null;
  };
  leaveByType: Array<{
    code: string;
    name: string;
    totalDays: number;
    shareOfTotal: number;
    allocated: number | null;
    used: number | null;
    utilization: number | null;
  }>;
  monthlyTrend: Array<{
    month: string;
    label: string;
    total: number;
    priorTotal: number;
    SL: number;
    CL: number;
    PL: number;
    LWP: number;
  }>;
  departmentBreakdown: Array<{
    department: string;
    totalDays: number;
    headcount: number;
    daysPerEmployee: number;
  }>;
  footnotes: {
    attribution: string;
    lwpJudgmentCall: string;
  };
}

const TYPE_COLORS: Record<string, string> = {
  SL: '#f59e0b', // Amber
  CL: '#3b82f6', // Blue
  PL: '#10b981', // Emerald
  LWP: '#ef4444', // Red
};

export default function OverviewSection({ filters }: { filters: AnalyticsFilterState }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const qs = buildFilterQueryString(filters);
        const res = await fetch(`/api/leave/analytics/overview?${qs}`);
        const result = await res.json();

        if (cancelled) return;
        if (!res.ok) {
          setError(result.error || `Failed to fetch overview metrics (${res.status}).`);
          return;
        }
        setData(result);
      } catch (err) {
        if (!cancelled) setError('Network error: Unable to connect to analytics service.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-80 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
          <div className="h-80 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
        </div>
        <div className="h-80 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-500 mb-2" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Overview Section Unavailable</h3>
        <p className="text-xs text-[var(--text-muted)] mt-1">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { kpis, leaveByType, monthlyTrend, departmentBreakdown, footnotes } = data;

  return (
    <div className="space-y-6">
      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Approved Leave Days */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-semibold">Approved Days</span>
            <CalendarDays size={16} className="text-[var(--accent)]" />
          </div>
          <div>
            <div className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              {kpis.approvedLeaveDays.toLocaleString()}
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px]">
              {kpis.approvedDaysDiff >= 0 ? (
                <span className="flex items-center text-amber-500 font-medium">
                  <TrendingUp size={12} className="mr-0.5" />
                  +{kpis.approvedDaysDiff.toLocaleString()} days
                  {kpis.approvedDaysPctChange !== null && ` (+${kpis.approvedDaysPctChange}%)`}
                </span>
              ) : (
                <span className="flex items-center text-emerald-500 font-medium">
                  <TrendingDown size={12} className="mr-0.5" />
                  {kpis.approvedDaysDiff.toLocaleString()} days
                  {kpis.approvedDaysPctChange !== null && ` (${kpis.approvedDaysPctChange}%)`}
                </span>
              )}
              <span className="text-[var(--text-muted)]/60 text-[10px]">vs prior FY</span>
            </div>
          </div>
        </div>

        {/* Average Days / Employee */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-semibold">Avg Days / Emp</span>
            <Users size={16} className="text-blue-500" />
          </div>
          <div>
            <div className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              {kpis.avgDaysPerEmployee}
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px]">
              {kpis.avgDaysDiff >= 0 ? (
                <span className="flex items-center text-amber-500 font-medium">
                  <TrendingUp size={12} className="mr-0.5" />
                  +{kpis.avgDaysDiff}
                </span>
              ) : (
                <span className="flex items-center text-emerald-500 font-medium">
                  <TrendingDown size={12} className="mr-0.5" />
                  {kpis.avgDaysDiff}
                </span>
              )}
              <span className="text-[var(--text-muted)]/60 text-[10px]">({kpis.activeHeadcount} active emps)</span>
            </div>
          </div>
        </div>

        {/* Pending Approvals */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-semibold">Pending Approvals</span>
            <Clock size={16} className="text-amber-500" />
          </div>
          <div>
            <div className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              {kpis.pendingApprovals.count}
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">
              {kpis.pendingApprovals.count > 0 ? (
                <span>Oldest request: <strong className="text-[var(--text-primary)]">{kpis.pendingApprovals.oldestAgeDays}d</strong> ago</span>
              ) : (
                <span className="text-emerald-500 font-medium">Queue is clear</span>
              )}
            </div>
          </div>
        </div>

        {/* On Leave Today */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-semibold">On Leave Today</span>
            <UserCheck size={16} className="text-emerald-500" />
          </div>
          <div>
            <div className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              {kpis.onLeaveTodayCount}
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">
              {kpis.activeHeadcount > 0 ? (
                <span>{Math.round((kpis.onLeaveTodayCount / kpis.activeHeadcount) * 100)}% of workforce</span>
              ) : (
                <span>Today</span>
              )}
            </div>
          </div>
        </div>

        {/* LWP Days */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-semibold">LWP Days</span>
            <AlertTriangle size={16} className="text-rose-500" />
          </div>
          <div>
            <div className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              {kpis.lwpDays.toLocaleString()}
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px]">
              {kpis.lwpDiff >= 0 ? (
                <span className="flex items-center text-rose-500 font-medium">
                  <TrendingUp size={12} className="mr-0.5" />
                  +{kpis.lwpDiff} days
                </span>
              ) : (
                <span className="flex items-center text-emerald-500 font-medium">
                  <TrendingDown size={12} className="mr-0.5" />
                  {kpis.lwpDiff} days
                </span>
              )}
              <span className="text-[var(--text-muted)]/60 text-[10px]">vs prior FY</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Charts Row 1: Leave by Type + Monthly Trend ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Leave By Type & Quota Utilization */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Layers size={16} className="text-[var(--accent)]" />
                Leave by Type & Quota Utilization
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Total days taken, share of volume, and quota consumption
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {leaveByType.map((item) => (
              <div key={item.code} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: TYPE_COLORS[item.code] || '#94a3b8' }}
                    />
                    <span className="font-semibold text-[var(--text-primary)]">{item.name} ({item.code})</span>
                    <span className="text-[var(--text-muted)]">({item.shareOfTotal}% of total)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-[var(--text-primary)]">{item.totalDays} days</span>
                    {item.utilization !== null ? (
                      <span className="text-[11px] font-semibold text-[var(--text-muted)]">
                        {item.utilization}% utilized
                      </span>
                    ) : (
                      <span className="text-[11px] text-[var(--text-muted)]/60 italic">No quota</span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden flex">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, item.shareOfTotal)}%`,
                      backgroundColor: TYPE_COLORS[item.code] || '#94a3b8',
                    }}
                  />
                </div>
                {item.allocated !== null && item.used !== null && (
                  <p className="text-[10px] text-[var(--text-muted)] text-right">
                    {item.used} of {item.allocated} total days allocated consumed
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Monthly Trend across 12 FY months */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <CalendarDays size={16} className="text-blue-500" />
                  Monthly Leave Trend (FY {data.fyLabel})
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  12-month FY cycle (Mar–Feb) stacked by type with prior FY comparison
                </p>
              </div>
            </div>

            <div className="h-[260px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
                  <XAxis
                    dataKey="label"
                    stroke="var(--border)"
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  />
                  <YAxis
                    stroke="var(--border)"
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-card)',
                      borderColor: 'var(--border)',
                      borderRadius: 12,
                      fontSize: 12,
                      color: 'var(--text-primary)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Bar dataKey="SL" name="Sick (SL)" stackId="a" fill={TYPE_COLORS.SL} />
                  <Bar dataKey="CL" name="Casual (CL)" stackId="a" fill={TYPE_COLORS.CL} />
                  <Bar dataKey="PL" name="Privilege (PL)" stackId="a" fill={TYPE_COLORS.PL} />
                  <Bar dataKey="LWP" name="LWP" stackId="a" fill={TYPE_COLORS.LWP} radius={[4, 4, 0, 0]} />
                  <Line
                    type="monotone"
                    dataKey="priorTotal"
                    name="Prior FY Total"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-1.5 text-[11px] text-[var(--text-muted)]/80 italic">
            <Info size={13} className="shrink-0 mt-0.5" />
            <span>{footnotes.attribution}</span>
          </div>
        </div>
      </div>

      {/* ── Department Breakdown ────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Users size={16} className="text-emerald-500" />
              Average Leave Days per Employee by Department
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Sorted by leave load per active headcount; hover to view team size and total days
            </p>
          </div>
        </div>

        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={departmentBreakdown} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
              <XAxis
                dataKey="department"
                stroke="var(--border)"
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                interval={0}
                angle={-15}
                textAnchor="end"
              />
              <YAxis
                stroke="var(--border)"
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border)',
                  borderRadius: 12,
                  fontSize: 12,
                  color: 'var(--text-primary)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                }}
                formatter={(val: any, name: any, item: any) => [
                  `${val} days/emp (${item.payload.totalDays} total days across ${item.payload.headcount} emps)`,
                  'Leave Load',
                ]}
              />
              <Bar dataKey="daysPerEmployee" name="Days / Employee" fill="var(--accent)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
