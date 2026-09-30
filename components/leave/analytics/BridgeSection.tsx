'use client';

import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  GitCommit,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Info,
  Calendar,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { AnalyticsFilterState, buildFilterQueryString } from './types';

interface Instance {
  startDate: string;
  endDate: string;
  leaveDays: number;
  extendedBreakDays: number;
  leverage: number;
  types: string;
  classification: string[];
}

interface EmployeeBridgeRecord {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  office: string;
  totalSpells: number;
  attachedSpells: number;
  attachedShare: number;
  officeBaselineShare: number;
  attachedRatioVsBaseline: number;
  flaggedForReview: boolean;
  instances: Instance[];
}

interface BridgeData {
  fyStartYear: number;
  selectedTypes: string[];
  summary: {
    totalSpells: number;
    attachedSpells: number;
    attachedShare: number;
    flaggedEmployeesCount: number;
    minSpellsThreshold: number;
  };
  officeBaselines: Array<{ office: string; attachedBaselinePercent: number }>;
  weekdayBreakdown: Array<{ day: string; days: number }>;
  holidayBreakdown: Array<{ holidayName: string; date: string; office: string; employeesCount: number }>;
  departmentSummaries: Array<{
    department: string;
    headcount: number;
    totalSpells: number;
    attachedSpells: number;
    attachedShare: number;
    flaggedCount: number;
  }>;
  employees: EmployeeBridgeRecord[];
  missingHolidaysWarnings: Array<{ office: string; year: number; message: string }>;
  terminologyNote: string;
}

export default function BridgeSection({ filters }: { filters: AnalyticsFilterState }) {
  const [includePl, setIncludePl] = useState(false);
  const [data, setData] = useState<BridgeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedEmpId, setExpandedEmpId] = useState<string | null>(null);
  const [filterSearch, setFilterSearch] = useState('');
  const [filterOnlyFlagged, setFilterOnlyFlagged] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const qs = buildFilterQueryString(filters);
        const typesParam = includePl ? 'SL,CL,PL' : 'SL,CL';
        const res = await fetch(`/api/leave/analytics/bridge?${qs}&types=${typesParam}`);
        const result = await res.json();

        if (cancelled) return;
        if (!res.ok) {
          setError(result.error || `Failed to fetch bridge metrics (${res.status}).`);
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
  }, [filters, includePl]);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-72 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
          <div className="h-72 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
        </div>
        <div className="h-96 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-500 mb-2" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Bridge Pattern Analysis Unavailable</h3>
        <p className="text-xs text-[var(--text-muted)] mt-1">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const {
    summary,
    officeBaselines,
    weekdayBreakdown,
    holidayBreakdown,
    employees,
    missingHolidaysWarnings,
    terminologyNote,
  } = data;

  const filteredEmployees = employees.filter((emp) => {
    if (filterOnlyFlagged && !emp.flaggedForReview) return false;
    if (!filterSearch) return true;
    const q = filterSearch.toLowerCase();
    return (
      emp.employeeName.toLowerCase().includes(q) ||
      emp.employeeCode.toLowerCase().includes(q) ||
      emp.department.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* ── Section Title & PL Toggle ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <GitCommit size={20} className="text-[var(--accent)] rotate-90" />
            Leave Attached to Weekends & Holidays
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-2xl leading-relaxed">
            Identifies leave spells contiguous with non-working breaks. Compares individual attachment shares against
            office calendar baselines to surface patterns flagged for administrative review.
          </p>
        </div>

        {/* PL Toggle Control */}
        <label className="flex items-center gap-2 cursor-pointer rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 shadow-sm hover:border-[var(--accent)]/50 transition-colors">
          <input
            type="checkbox"
            checked={includePl}
            onChange={(e) => setIncludePl(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
          />
          <span className="text-xs font-semibold text-[var(--text-primary)]">
            Include Privilege Leave (PL)
          </span>
          <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded">
            Default: SL & CL only
          </span>
        </label>
      </div>

      {/* ── Holiday Missing Data Warnings ─────────────────────────────────── */}
      {missingHolidaysWarnings && missingHolidaysWarnings.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="text-xs text-[var(--text-primary)]">
            <strong className="font-semibold text-amber-600 dark:text-amber-400">Notice on Holiday Data:</strong>
            <ul className="list-disc list-inside mt-1 space-y-0.5 text-[var(--text-muted)]">
              {missingHolidaysWarnings.map((w, idx) => (
                <li key={idx}>{w.message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── Summary KPI Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Spells */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
          <span className="text-xs font-semibold text-[var(--text-muted)]">Total Spells ({data.selectedTypes.join(', ')})</span>
          <div className="text-2xl font-bold text-[var(--text-primary)] mt-1.5">{summary.totalSpells}</div>
          <span className="text-[11px] text-[var(--text-muted)]">Merged continuous absence blocks</span>
        </div>

        {/* Attached Spells */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
          <span className="text-xs font-semibold text-[var(--text-muted)]">Attached Spells</span>
          <div className="text-2xl font-bold text-[var(--text-primary)] mt-1.5">{summary.attachedSpells}</div>
          <span className="text-[11px] text-[var(--text-muted)]">
            Touching a weekend or holiday boundary
          </span>
        </div>

        {/* Attached Share % */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
          <span className="text-xs font-semibold text-[var(--text-muted)]">Attached Share (Org-wide)</span>
          <div className="text-2xl font-bold text-[var(--text-primary)] mt-1.5">{summary.attachedShare}%</div>
          <span className="text-[11px] text-[var(--text-muted)]">
            Baselines: {officeBaselines.map((b) => `${b.office}: ~${b.attachedBaselinePercent}%`).join(', ')}
          </span>
        </div>

        {/* Flagged for Review */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
          <span className="text-xs font-semibold text-[var(--text-muted)]">Flagged for Review</span>
          <div className="text-2xl font-bold text-amber-500 mt-1.5">{summary.flaggedEmployeesCount}</div>
          <span className="text-[11px] text-[var(--text-muted)]">
            Min {summary.minSpellsThreshold} spells &gt; office baseline
          </span>
        </div>
      </div>

      {/* ── Charts: Weekday Distribution & Top Holiday Attachments ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekday Breakdown */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-sm">
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2 mb-1">
            <Calendar size={16} className="text-[var(--accent)]" />
            Attached Leave Days by Weekday
          </h3>
          <p className="text-xs text-[var(--text-muted)] mb-4">
            Volume of attached leave days landing on each day of the working week
          </p>

          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekdayBreakdown} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
                <XAxis dataKey="day" stroke="var(--border)" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis stroke="var(--border)" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--border)',
                    borderRadius: 12,
                    fontSize: 12,
                    color: 'var(--text-primary)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  }}
                  formatter={(val: any) => [`${val} days`, 'Attached Leave Volume']}
                />
                <Bar dataKey="days" fill="var(--accent)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Holiday Attachments */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-sm">
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2 mb-1">
            <Sparkles size={16} className="text-amber-500" />
            Leave Attached to Holidays
          </h3>
          <p className="text-xs text-[var(--text-muted)] mb-4">
            Distinct employees taking adjacent or bridge leave next to official holidays
          </p>

          {holidayBreakdown.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-[var(--text-muted)]">
              No holiday-attached leave recorded for the selected criteria.
            </div>
          ) : (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={holidayBreakdown.slice(0, 6)}
                  layout="vertical"
                  margin={{ top: 5, right: 20, left: 60, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
                  <XAxis type="number" stroke="var(--border)" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <YAxis
                    dataKey="holidayName"
                    type="category"
                    stroke="var(--border)"
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    width={100}
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
                      `${val} employees took leave around ${item.payload.date} (${item.payload.office})`,
                      'Employees',
                    ]}
                  />
                  <Bar dataKey="employeesCount" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ── Employee Analysis Table ────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-sm overflow-hidden">
        {/* Table Header & Controls */}
        <div className="p-4 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">
              Employee Attachment Analysis ({filteredEmployees.length})
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Click any row to expand individual concrete spell instances and leverage details
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search employee or dept..."
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              className="h-8 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
            />
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={filterOnlyFlagged}
                onChange={(e) => setFilterOnlyFlagged(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-[var(--border)] text-[var(--accent)]"
              />
              <span>Flagged only</span>
            </label>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--bg-elevated)]/50 text-[var(--text-muted)] font-semibold border-b border-[var(--border)]">
              <tr>
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-3">Dept / Office</th>
                <th className="py-3 px-3 text-center">Total Spells</th>
                <th className="py-3 px-3 text-center">Attached Spells</th>
                <th className="py-3 px-3 text-center">Attached Share</th>
                <th className="py-3 px-3 text-center">vs Office Baseline</th>
                <th className="py-3 px-3 text-center">Review Status</th>
                <th className="py-3 px-3 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-xs text-[var(--text-muted)]">
                    No employees matching the current filters.
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => {
                  const isExpanded = expandedEmpId === emp.employeeId;
                  const ratioText = `${emp.attachedRatioVsBaseline}x`;

                  return (
                    <tbody key={emp.employeeId} className="group">
                      <tr
                        onClick={() => setExpandedEmpId(isExpanded ? null : emp.employeeId)}
                        className={`cursor-pointer hover:bg-[var(--bg-elevated)]/60 transition-colors ${
                          emp.flaggedForReview ? 'bg-amber-500/[0.03]' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-semibold text-[var(--text-primary)]">{emp.employeeName}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">{emp.employeeCode}</div>
                        </td>
                        <td className="py-3 px-3 text-[var(--text-muted)]">
                          {emp.department} <span className="text-[10px]">({emp.office})</span>
                        </td>
                        <td className="py-3 px-3 text-center font-medium text-[var(--text-primary)]">
                          {emp.totalSpells}
                        </td>
                        <td className="py-3 px-3 text-center font-medium text-[var(--text-primary)]">
                          {emp.attachedSpells}
                        </td>
                        <td className="py-3 px-3 text-center font-bold text-[var(--text-primary)]">
                          {Math.round(emp.attachedShare * 100)}%
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span
                            className={`font-semibold ${
                              emp.attachedRatioVsBaseline > 1.3 ? 'text-amber-500' : 'text-[var(--text-muted)]'
                            }`}
                            title={`Office baseline: ~${Math.round(emp.officeBaselineShare * 100)}% (approximate ratio)`}
                          >
                            {ratioText}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          {emp.flaggedForReview ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-500">
                              Flagged for review
                            </span>
                          ) : (
                            <span className="text-[10px] text-[var(--text-muted)]/60">Standard</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            className="p-1 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-muted)]"
                          >
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Concrete Instances */}
                      {isExpanded && (
                        <tr className="bg-[var(--bg-elevated)]/30">
                          <td colSpan={8} className="p-4">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-[var(--text-primary)]">
                                  Concrete Instances ({emp.instances.length} Spells)
                                </span>
                                <span className="text-[11px] text-[var(--text-muted)]">
                                  Leverage = Total Break Days off work ÷ Leave Days applied
                                </span>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                {emp.instances.map((inst, idx) => (
                                  <div
                                    key={idx}
                                    className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 text-xs space-y-1.5 shadow-sm"
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold text-[var(--text-primary)]">
                                        {inst.startDate} {inst.startDate !== inst.endDate && `→ ${inst.endDate}`}
                                      </span>
                                      <span className="text-[11px] font-semibold text-[var(--accent)]">
                                        {inst.types}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                                      <span>Leave: {inst.leaveDays}d</span>
                                      <span>Total Break: <strong>{inst.extendedBreakDays}d</strong></span>
                                      <span>Leverage: <strong className="text-[var(--text-primary)]">{inst.leverage}x</strong></span>
                                    </div>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {inst.classification.map((c, cIdx) => (
                                        <span
                                          key={cIdx}
                                          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                                            c === 'Holiday Involved'
                                              ? 'bg-amber-500/15 text-amber-500'
                                              : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                                          }`}
                                        >
                                          {c}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sensitive review note */}
      <div className="flex items-start gap-2 text-xs text-[var(--text-muted)]/80 italic">
        <Info size={14} className="shrink-0 mt-0.5" />
        <span>{terminologyNote}</span>
      </div>
    </div>
  );
}
