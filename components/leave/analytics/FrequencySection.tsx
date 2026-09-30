'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Info,
  HeartPulse,
  Flame,
  Search,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';
import { AnalyticsFilterState, buildFilterQueryString } from './types';

interface FrequentEmployee {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  office: string;
  spellsIn90Days: number;
  shortSpellsIn90Days: number;
  totalDaysIn90Days: number;
  avgSpellLength90Days: number;
  spellsIn52Weeks: number;
  totalDaysIn52Weeks: number;
  bradfordScore: number;
  bradfordBand: {
    key: string;
    label: string;
    description: string;
  };
  isFrequent: boolean;
  lastLeaveDate: string | null;
  typeMix: Record<string, number>;
  monthlySparkline: Array<{ month: string; days: number }>;
}

interface NoRecentLeaveEmployee {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  office: string;
  dateOfJoining: string | null;
  tenureDays: number;
  lastLeaveDate: string | null;
  daysSinceLastLeave: number | null;
}

interface FrequencyData {
  fyStartYear: number;
  thresholds: {
    frequentSpells90D: number;
    shortSpellMaxDays: number;
    noRecentLeaveDays: number;
    bradfordBands: Record<string, { label: string; min: number; max: number }>;
  };
  summary: {
    totalEmployeesAnalyzed: number;
    employeesWithLeave: number;
    frequentLeaveEmployeesCount: number;
    highBradfordEmployeesCount: number;
    noRecentLeaveEmployeesCount: number;
  };
  employees: FrequentEmployee[];
  noRecentLeaveEmployees: NoRecentLeaveEmployee[];
  fairUseDisclaimer: string;
}

const BAND_BADGES: Record<string, { bg: string; text: string; border: string }> = {
  low: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/30' },
  moderate: { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/30' },
  high: { bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500/30' },
  critical: { bg: 'bg-rose-500/10', text: 'text-rose-500', border: 'border-rose-500/30' },
};

export default function FrequencySection({ filters }: { filters: AnalyticsFilterState }) {
  const [data, setData] = useState<FrequencyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'frequency' | 'noRecent'>('frequency');
  const [searchTerm, setSearchTerm] = useState('');
  const [onlyFrequentFilter, setOnlyFrequentFilter] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const qs = buildFilterQueryString(filters);
        const res = await fetch(`/api/leave/analytics/frequency?${qs}`);
        const result = await res.json();

        if (cancelled) return;
        if (!res.ok) {
          setError(result.error || `Failed to fetch frequency metrics (${res.status}).`);
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
          ))}
        </div>
        <div className="h-96 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-500 mb-2" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Leave Frequency Analysis Unavailable</h3>
        <p className="text-xs text-[var(--text-muted)] mt-1">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { summary, employees, noRecentLeaveEmployees, fairUseDisclaimer, thresholds } = data;

  const filteredFrequent = employees.filter((emp) => {
    if (onlyFrequentFilter && !emp.isFrequent) return false;
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      emp.employeeName.toLowerCase().includes(q) ||
      emp.employeeCode.toLowerCase().includes(q) ||
      emp.department.toLowerCase().includes(q)
    );
  });

  const filteredNoRecent = noRecentLeaveEmployees.filter((emp) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      emp.employeeName.toLowerCase().includes(q) ||
      emp.employeeCode.toLowerCase().includes(q) ||
      emp.department.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* ── Section Title ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Activity size={20} className="text-[var(--accent)]" />
            Frequent Leave & Disruption Patterns
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-2xl leading-relaxed">
            Evaluates short, recurring absence spells and 52-week disruption using Bradford Factor metrics. Surfaces both
            frequent leave review candidates and active staff with zero recent leave.
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab('frequency')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'frequency'
                ? 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] text-white shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Flame size={13} />
            <span>Frequent Leave ({summary.frequentLeaveEmployeesCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('noRecent')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'noRecent'
                ? 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] text-white shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <HeartPulse size={13} />
            <span>No Recent Leave ({summary.noRecentLeaveEmployeesCount})</span>
          </button>
        </div>
      </div>

      {/* ── Summary KPI Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Frequent Leave Spells */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-1">
            <span className="text-xs font-semibold">Frequent Spells (90D)</span>
            <Flame size={16} className="text-amber-500" />
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-500">
              {summary.frequentLeaveEmployeesCount}
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">
              Employees with &ge;{thresholds.frequentSpells90D} spells in trailing 90 days
            </div>
          </div>
        </div>

        {/* High / Critical Bradford Band */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-1">
            <span className="text-xs font-semibold">High Bradford Trigger</span>
            <Activity size={16} className="text-rose-500" />
          </div>
          <div>
            <div className="text-2xl font-bold text-rose-500">
              {summary.highBradfordEmployeesCount}
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">
              Bradford Factor &ge;125 over trailing 52 weeks (S&sup2; &times; D)
            </div>
          </div>
        </div>

        {/* No Recent Leave (Wellbeing Alert) */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-1">
            <span className="text-xs font-semibold">No Recent Leave</span>
            <HeartPulse size={16} className="text-blue-500" />
          </div>
          <div>
            <div className="text-2xl font-bold text-blue-500">
              {summary.noRecentLeaveEmployeesCount}
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">
              Active staff with &gt;180d tenure and 0 leave days taken
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab 1: Frequent Leave & Bradford Table ─────────────────────────── */}
      {activeTab === 'frequency' && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-sm overflow-hidden">
          <div className="p-4 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                Leave Frequency &amp; Disruption Index ({filteredFrequent.length})
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Ranked by 90-day spell frequency and trailing 52-week Bradford score
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
                <input
                  type="text"
                  placeholder="Search name, code, dept..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-8 pl-8 pr-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyFrequentFilter}
                  onChange={(e) => setOnlyFrequentFilter(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-[var(--border)] text-[var(--accent)]"
                />
                <span>&ge;{thresholds.frequentSpells90D} spells only</span>
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg-elevated)]/50 text-[var(--text-muted)] font-semibold border-b border-[var(--border)]">
                <tr>
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-3">Dept / Office</th>
                  <th className="py-3 px-3 text-center">Spells (90D)</th>
                  <th className="py-3 px-3 text-center">Short Spells (&le;2d)</th>
                  <th className="py-3 px-3 text-center">90D Days / Avg</th>
                  <th className="py-3 px-3 text-center">
                    <span className="inline-flex items-center gap-1">
                      Bradford Factor
                      <span title="Bradford Score = S² × D over trailing 52 weeks. S = spells, D = total days. Used as an objective review trigger.">
                        <HelpCircle size={12} className="text-[var(--text-muted)]/70" />
                      </span>
                    </span>
                  </th>
                  <th className="py-3 px-3 text-center">Trailing 6M Trend</th>
                  <th className="py-3 px-3 text-right">Last Leave</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredFrequent.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-xs text-[var(--text-muted)]">
                      No employees match the current frequency filter.
                    </td>
                  </tr>
                ) : (
                  filteredFrequent.map((emp) => {
                    const badge = BAND_BADGES[emp.bradfordBand.key] || BAND_BADGES.low;
                    const maxSpark = Math.max(1, ...emp.monthlySparkline.map((m) => m.days));

                    return (
                      <tr
                        key={emp.employeeId}
                        className={`hover:bg-[var(--bg-elevated)]/60 transition-colors ${
                          emp.isFrequent ? 'bg-amber-500/[0.03]' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
                            {emp.employeeName}
                            {emp.isFrequent && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/30">
                                Frequent
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)]">{emp.employeeCode}</div>
                        </td>
                        <td className="py-3 px-3 text-[var(--text-muted)]">
                          {emp.department} <span className="text-[10px]">({emp.office})</span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span
                            className={`font-bold ${
                              emp.spellsIn90Days >= thresholds.frequentSpells90D
                                ? 'text-amber-500 text-sm'
                                : 'text-[var(--text-primary)]'
                            }`}
                          >
                            {emp.spellsIn90Days}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center font-medium text-[var(--text-primary)]">
                          {emp.shortSpellsIn90Days}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <div className="font-semibold text-[var(--text-primary)]">{emp.totalDaysIn90Days}d</div>
                          <div className="text-[10px] text-[var(--text-muted)]">{emp.avgSpellLength90Days}d avg</div>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <div className="font-bold text-[var(--text-primary)] text-sm">{emp.bradfordScore}</div>
                          <span
                            className={`inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.2 rounded border ${badge.bg} ${badge.text} ${badge.border}`}
                            title={emp.bradfordBand.description}
                          >
                            {emp.bradfordBand.label}
                          </span>
                        </td>
                        {/* Sparkline */}
                        <td className="py-3 px-3 text-center">
                          <div className="flex items-end justify-center gap-1 h-6">
                            {emp.monthlySparkline.map((m, idx) => {
                              const heightPct = Math.max(12, Math.round((m.days / maxSpark) * 100));
                              return (
                                <div
                                  key={idx}
                                  className="w-1.5 rounded-t bg-[var(--accent)] hover:opacity-80 transition-opacity"
                                  style={{ height: `${heightPct}%` }}
                                  title={`${m.month}: ${m.days} days`}
                                />
                              );
                            })}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right text-[var(--text-muted)]">
                          {emp.lastLeaveDate ? (
                            <span>{emp.lastLeaveDate}</span>
                          ) : (
                            <span className="text-[10px] italic">None recorded</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab 2: No Recent Leave (Wellbeing Watch) ────────────────────────── */}
      {activeTab === 'noRecent' && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-sm overflow-hidden">
          <div className="p-4 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <HeartPulse size={16} className="text-blue-500" />
                Staff with No Recent Leave (&gt;{thresholds.noRecentLeaveDays} Days)
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Active employees with &gt;6 months tenure who have not taken approved leave in over 180 days. Use to
                proactively prevent burnout and encourage work-life balance.
              </p>
            </div>

            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Search name, code, dept..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 pl-8 pr-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg-elevated)]/50 text-[var(--text-muted)] font-semibold border-b border-[var(--border)]">
                <tr>
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-3">Dept / Office</th>
                  <th className="py-3 px-3 text-center">Joining Date</th>
                  <th className="py-3 px-3 text-center">Company Tenure</th>
                  <th className="py-3 px-3 text-center">Days Without Leave</th>
                  <th className="py-3 px-3 text-right">Recommendation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredNoRecent.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-[var(--text-muted)]">
                      All eligible employees have taken leave within the past {thresholds.noRecentLeaveDays} days.
                    </td>
                  </tr>
                ) : (
                  filteredNoRecent.map((emp) => {
                    const daysOff = emp.daysSinceLastLeave ?? emp.tenureDays;
                    const monthsOff = Math.round((daysOff / 30) * 10) / 10;

                    return (
                      <tr key={emp.employeeId} className="hover:bg-[var(--bg-elevated)]/60 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-[var(--text-primary)]">{emp.employeeName}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">{emp.employeeCode}</div>
                        </td>
                        <td className="py-3 px-3 text-[var(--text-muted)]">
                          {emp.department} <span className="text-[10px]">({emp.office})</span>
                        </td>
                        <td className="py-3 px-3 text-center text-[var(--text-muted)]">
                          {emp.dateOfJoining || 'Unknown'}
                        </td>
                        <td className="py-3 px-3 text-center font-medium text-[var(--text-primary)]">
                          {Math.round(emp.tenureDays / 30)} months ({emp.tenureDays}d)
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="font-bold text-blue-500 text-sm">{daysOff} days</span>
                          <span className="text-[10px] text-[var(--text-muted)] block">~{monthsOff} months</span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 size={12} />
                            Encourage rest / planning
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fair use advisory note */}
      <div className="flex items-start gap-2 text-xs text-[var(--text-muted)]/80 italic">
        <Info size={14} className="shrink-0 mt-0.5" />
        <span>{fairUseDisclaimer}</span>
      </div>
    </div>
  );
}
