'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Info,
  Search,
} from 'lucide-react';
import { AnalyticsFilterState, buildFilterQueryString } from './types';

interface AttentionFlag {
  id: string;
  category: 'attached_share' | 'frequent_leave' | 'bradford' | 'low_balance' | 'high_unused' | 'missing_cert';
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
}

interface AttentionEmployee {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  office: string;
  flagCount: number;
  criticalCount: number;
  flags: AttentionFlag[];
}

interface AttentionData {
  fyStartYear: number;
  totalFlaggedEmployees: number;
  employees: AttentionEmployee[];
  historyNavigationLimitation: string;
}

export default function AttentionSection({ filters }: { filters: AnalyticsFilterState }) {
  const [data, setData] = useState<AttentionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedEmpId, setExpandedEmpId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'critical'>('all');

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const qs = buildFilterQueryString(filters);
        const res = await fetch(`/api/leave/analytics/attention?${qs}`);
        const result = await res.json();

        if (cancelled) return;
        if (!res.ok) {
          setError(result.error || `Failed to fetch attention list (${res.status}).`);
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
        <div className="h-80 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-500 mb-2" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Attention List Unavailable</h3>
        <p className="text-xs text-[var(--text-muted)] mt-1">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { employees, historyNavigationLimitation } = data;

  const filtered = employees.filter((emp) => {
    if (filterSeverity === 'critical' && emp.criticalCount === 0) return false;
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
            <ShieldAlert size={20} className="text-amber-500" />
            HR Attention List
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-2xl leading-relaxed">
            Consolidated multi-signal review queue combining attachment patterns, frequency anomalies, critical Bradford
            scores, depleted or forfeiture-risk balances, and missing medical certificates.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
            {employees.length} Staff Requiring Review
          </span>
        </div>
      </div>

      {/* ── Table Card ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-sm overflow-hidden">
        {/* Controls Bar */}
        <div className="p-4 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
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

            <div className="flex items-center rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] p-0.5">
              <button
                type="button"
                onClick={() => setFilterSeverity('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  filterSeverity === 'all'
                    ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                All Flags ({employees.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterSeverity('critical')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  filterSeverity === 'critical'
                    ? 'bg-[var(--bg-card)] text-rose-500 shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-rose-500'
                }`}
              >
                Critical Only ({employees.filter((e) => e.criticalCount > 0).length})
              </button>
            </div>
          </div>

          <span className="text-[11px] text-[var(--text-muted)]">
            Sorted by flag density and critical severity
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--bg-elevated)]/50 text-[var(--text-muted)] font-semibold border-b border-[var(--border)]">
              <tr>
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-3">Dept / Office</th>
                <th className="py-3 px-3 text-center">Active Flags</th>
                <th className="py-3 px-3">Signals Detected</th>
                <th className="py-3 px-3 text-center">Severity</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-[var(--text-muted)]">
                    No employees currently triggered for administrative attention.
                  </td>
                </tr>
              ) : (
                filtered.map((emp) => {
                  const isExpanded = expandedEmpId === emp.employeeId;

                  return (
                    <tbody key={emp.employeeId} className="group">
                      <tr
                        onClick={() => setExpandedEmpId(isExpanded ? null : emp.employeeId)}
                        className={`cursor-pointer hover:bg-[var(--bg-elevated)]/60 transition-colors ${
                          emp.criticalCount > 0 ? 'bg-rose-500/[0.03]' : 'bg-amber-500/[0.02]'
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-semibold text-[var(--text-primary)]">{emp.employeeName}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">{emp.employeeCode}</div>
                        </td>
                        <td className="py-3 px-3 text-[var(--text-muted)]">
                          {emp.department} <span className="text-[10px]">({emp.office})</span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border)] font-bold text-[var(--text-primary)]">
                            {emp.flagCount}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-wrap gap-1">
                            {emp.flags.map((f) => (
                              <span
                                key={f.id}
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                  f.severity === 'critical'
                                    ? 'bg-rose-500/10 text-rose-500 border-rose-500/30'
                                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                }`}
                              >
                                {f.title}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center">
                          {emp.criticalCount > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-500">
                              <AlertCircle size={12} />
                              Critical ({emp.criticalCount})
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium text-amber-500">
                              Advisory
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href="/leave/admin/history"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline"
                              title="Navigate to Leave Tracker History. Note: The History page manages employee selection via its in-memory controls."
                            >
                              <span>View History</span>
                              <ExternalLink size={11} />
                            </Link>
                            <button
                              type="button"
                              className="p-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"
                            >
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Flag Diagnostics */}
                      {isExpanded && (
                        <tr className="bg-[var(--bg-elevated)]/40">
                          <td colSpan={6} className="p-4">
                            <div className="space-y-2.5">
                              <div className="text-xs font-semibold text-[var(--text-primary)]">
                                Signal Diagnostics for {emp.employeeName}:
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                {emp.flags.map((flag) => (
                                  <div
                                    key={flag.id}
                                    className={`rounded-xl border p-3 text-xs space-y-1 ${
                                      flag.severity === 'critical'
                                        ? 'border-rose-500/30 bg-rose-500/5'
                                        : 'border-[var(--border)] bg-[var(--bg-card)]'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between font-bold">
                                      <span
                                        className={
                                          flag.severity === 'critical'
                                            ? 'text-rose-500'
                                            : 'text-[var(--text-primary)]'
                                        }
                                      >
                                        {flag.title}
                                      </span>
                                      <span
                                        className={`text-[9px] font-bold uppercase px-1.5 py-0.2 rounded ${
                                          flag.severity === 'critical'
                                            ? 'bg-rose-500/20 text-rose-500'
                                            : 'bg-amber-500/20 text-amber-500'
                                        }`}
                                      >
                                        {flag.severity}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                                      {flag.detail}
                                    </p>
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

      {/* Nav Limitation Note */}
      <div className="flex items-start gap-2 text-xs text-[var(--text-muted)]/80 italic">
        <Info size={14} className="shrink-0 mt-0.5" />
        <span>{historyNavigationLimitation}</span>
      </div>
    </div>
  );
}
