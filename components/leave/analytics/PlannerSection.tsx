'use client';

import { useEffect, useState } from 'react';
import {
  Compass,
  AlertTriangle,
  Calendar,
  Clock,
  CheckCircle2,
  Users,
  Sparkles,
} from 'lucide-react';
import { AnalyticsFilterState, buildFilterQueryString } from './types';

interface PlannerOpportunity {
  id: string;
  title: string;
  type: 'long_weekend' | 'bridge_day' | 'multi_day_holiday';
  holidayName: string;
  holidayDates: string[];
  bridgeDates: string[];
  totalOpportunityDays: number;
  offices: string[];
  approvedEmployeesCount: number;
  pendingEmployeesCount: number;
  totalLeaveCount: number;
  departmentBreakdown: Array<{
    department: string;
    approved: number;
    pending: number;
  }>;
}

interface PlannerData {
  horizonDays: number;
  today: string;
  horizonEndDate: string;
  totalOpportunities: number;
  opportunities: PlannerOpportunity[];
}

export default function PlannerSection({ filters }: { filters: AnalyticsFilterState }) {
  const [data, setData] = useState<PlannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const qs = buildFilterQueryString(filters);
        const res = await fetch(`/api/leave/analytics/planner?${qs}`);
        const result = await res.json();

        if (cancelled) return;
        if (!res.ok) {
          setError(result.error || `Failed to fetch planner opportunities (${res.status}).`);
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
      <div className="space-y-4 animate-pulse">
        <div className="h-10 w-64 rounded-xl bg-[var(--bg-elevated)]" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-56 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-500 mb-2" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Planner Unavailable</h3>
        <p className="text-xs text-[var(--text-muted)] mt-1">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { opportunities, horizonDays, horizonEndDate, today } = data;

  return (
    <div className="space-y-6">
      {/* ── Section Title ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Compass size={20} className="text-blue-500" />
            Long Weekend &amp; Bridge Day Planner (Next {horizonDays} Days)
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-2xl leading-relaxed">
            Forward-looking capacity planning across {today} to {horizonEndDate}. Identifies potential bridge days and
            tracks approved vs. pending leave density across departments.
          </p>
        </div>

        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/30">
          {opportunities.length} Upcoming Opportunities
        </span>
      </div>

      {/* ── Opportunities Grid ────────────────────────────────────────────── */}
      {opportunities.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center text-xs text-[var(--text-muted)]">
          No official holidays or long weekends detected in the upcoming {horizonDays} days for the selected office.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {opportunities.map((opp) => (
            <div
              key={opp.id}
              className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-sm flex flex-col justify-between space-y-4 hover:border-[var(--accent)]/40 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                      opp.type === 'bridge_day'
                        ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                        : 'bg-blue-500/10 text-blue-500 border-blue-500/30'
                    }`}
                  >
                    {opp.type === 'bridge_day' ? 'Bridge Day Opportunity' : 'Long Weekend'}
                  </span>
                  <span className="text-[11px] font-semibold text-[var(--text-muted)]">
                    {opp.offices.join(', ')}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-[var(--text-primary)] leading-tight">{opp.title}</h3>
                <p className="text-xs text-[var(--accent)] font-medium mt-1">
                  {opp.holidayDates.join(', ')}
                </p>

                {opp.bridgeDates.length > 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                    Bridge working day(s): <strong>{opp.bridgeDates.join(', ')}</strong>
                  </p>
                )}
              </div>

              {/* Leave Status Metrics */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/60 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--text-muted)]">Workforce on Leave:</span>
                  <span className="font-bold text-[var(--text-primary)]">
                    {opp.totalLeaveCount} employees
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1 text-emerald-500">
                    <CheckCircle2 size={12} />
                    Approved: <strong>{opp.approvedEmployeesCount}</strong>
                  </span>
                  <span className="flex items-center gap-1 text-amber-500">
                    <Clock size={12} />
                    Pending: <strong>{opp.pendingEmployeesCount}</strong>
                  </span>
                </div>

                {/* Department load breakdown */}
                {opp.departmentBreakdown.length > 0 && (
                  <div className="pt-2 border-t border-[var(--border)] space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Department Impact:
                    </span>
                    <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                      {opp.departmentBreakdown.slice(0, 4).map((dept) => (
                        <div key={dept.department} className="flex items-center justify-between text-[11px]">
                          <span className="text-[var(--text-primary)] truncate max-w-[120px]">
                            {dept.department}
                          </span>
                          <span className="text-[var(--text-muted)] font-medium">
                            {dept.approved} appr {dept.pending > 0 && `(${dept.pending} pend)`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
