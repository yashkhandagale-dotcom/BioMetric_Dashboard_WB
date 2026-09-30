'use client';

import { useEffect, useState } from 'react';
import {
  Wallet,
  AlertTriangle,
  Info,
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  FileSpreadsheet,
} from 'lucide-react';
import { AnalyticsFilterState, buildFilterQueryString } from './types';

interface BalanceByTypeAndDept {
  leaveTypeCode: string;
  leaveTypeName: string;
  department: string;
  allocatedDays: number;
  usedDays: number;
  unusedDays: number;
  utilizationPercent: number;
  employeeCount: number;
}

interface RankedBalanceRecord {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  office: string;
  leaveTypeCode: string;
  closingBalance: number;
  allocatedDays: number;
  usedDays: number;
}

interface LedgerReasonSummary {
  reason: string;
  label: string;
  transactionCount: number;
  totalDeltaDays: number;
}

interface BalancesData {
  fyStartYear: number;
  byTypeAndDepartment: BalanceByTypeAndDept[];
  top10Highest: RankedBalanceRecord[];
  top10Lowest: RankedBalanceRecord[];
  ledgerSummary: LedgerReasonSummary[];
  liabilityNotice: string;
}

export default function BalancesSection({ filters }: { filters: AnalyticsFilterState }) {
  const [data, setData] = useState<BalancesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'utilization' | 'outliers' | 'ledger'>('utilization');
  const [deptFilter, setDeptFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const qs = buildFilterQueryString(filters);
        const res = await fetch(`/api/leave/analytics/balances?${qs}`);
        const result = await res.json();

        if (cancelled) return;
        if (!res.ok) {
          setError(result.error || `Failed to fetch balance metrics (${res.status}).`);
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
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Balances Section Unavailable</h3>
        <p className="text-xs text-[var(--text-muted)] mt-1">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { byTypeAndDepartment, top10Highest, top10Lowest, ledgerSummary, liabilityNotice } = data;

  const uniqueDepts = Array.from(new Set(byTypeAndDepartment.map((b) => b.department))).sort();
  const filteredDeptBalances = byTypeAndDepartment.filter(
    (b) => deptFilter === 'all' || b.department === deptFilter
  );

  return (
    <div className="space-y-6">
      {/* ── Section Title ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Wallet size={20} className="text-emerald-500" />
            Balances &amp; Quota Utilization
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-2xl leading-relaxed">
            Department-level quota consumption, outlier balances, and balance transaction audit summaries.
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab('utilization')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'utilization'
                ? 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] text-white shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            Quota Utilization
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('outliers')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'outliers'
                ? 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] text-white shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            Outlier Balances
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ledger')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'ledger'
                ? 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] text-white shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            Ledger Summary
          </button>
        </div>
      </div>

      {/* ── Tab 1: Department Quota Utilization ────────────────────────────── */}
      {activeTab === 'utilization' && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-sm overflow-hidden">
          <div className="p-4 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">
              Quota Allocation vs. Consumption by Department
            </h3>

            <div className="flex items-center gap-2">
              <label htmlFor="dept-filter-select" className="text-xs text-[var(--text-muted)]">Department:</label>
              <select
                id="dept-filter-select"
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="h-8 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 text-xs text-[var(--text-primary)] focus:outline-none"
              >
                <option value="all">All Departments</option>
                {uniqueDepts.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg-elevated)]/50 text-[var(--text-muted)] font-semibold border-b border-[var(--border)]">
                <tr>
                  <th className="py-3 px-4">Leave Type</th>
                  <th className="py-3 px-3">Department</th>
                  <th className="py-3 px-3 text-center">Staff Count</th>
                  <th className="py-3 px-3 text-center">Allocated Days</th>
                  <th className="py-3 px-3 text-center">Used Days</th>
                  <th className="py-3 px-3 text-center">Unused (Closing)</th>
                  <th className="py-3 px-4 text-right">Utilization %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredDeptBalances.map((row, idx) => (
                  <tr key={idx} className="hover:bg-[var(--bg-elevated)]/60 transition-colors">
                    <td className="py-3 px-4 font-bold text-[var(--text-primary)]">
                      {row.leaveTypeName} ({row.leaveTypeCode})
                    </td>
                    <td className="py-3 px-3 text-[var(--text-primary)]">{row.department}</td>
                    <td className="py-3 px-3 text-center text-[var(--text-muted)]">{row.employeeCount}</td>
                    <td className="py-3 px-3 text-center font-medium text-[var(--text-primary)]">
                      {row.allocatedDays}d
                    </td>
                    <td className="py-3 px-3 text-center font-medium text-[var(--text-primary)]">
                      {row.usedDays}d
                    </td>
                    <td className="py-3 px-3 text-center font-bold text-[var(--text-primary)]">
                      {row.unusedDays}d
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="font-semibold text-[var(--text-primary)]">
                          {row.utilizationPercent}%
                        </span>
                        <div className="w-16 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[var(--accent)]"
                            style={{ width: `${Math.min(100, row.utilizationPercent)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab 2: Outlier Balances (Top 10 Highest & Lowest) ──────────────── */}
      {activeTab === 'outliers' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top 10 Highest Balances */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-sm overflow-hidden">
            <div className="p-4 border-b border-[var(--border)]">
              <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <TrendingUp size={16} className="text-emerald-500" />
                Top 10 Highest Closing Balances
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Staff with the largest accumulated leave reserves
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--bg-elevated)]/50 text-[var(--text-muted)] font-semibold border-b border-[var(--border)]">
                  <tr>
                    <th className="py-2.5 px-3">Employee</th>
                    <th className="py-2.5 px-2">Type</th>
                    <th className="py-2.5 px-2 text-center">Allocated</th>
                    <th className="py-2.5 px-2 text-center">Used</th>
                    <th className="py-2.5 px-3 text-right">Closing Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {top10Highest.map((r, i) => (
                    <tr key={i} className="hover:bg-[var(--bg-elevated)]/60">
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-[var(--text-primary)]">{r.employeeName}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">{r.department}</div>
                      </td>
                      <td className="py-2.5 px-2 font-semibold text-[var(--accent)]">{r.leaveTypeCode}</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text-muted)]">{r.allocatedDays}d</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text-muted)]">{r.usedDays}d</td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-500">{r.closingBalance} days</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top 10 Lowest Balances */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-sm overflow-hidden">
            <div className="p-4 border-b border-[var(--border)]">
              <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <TrendingDown size={16} className="text-rose-500" />
                Top 10 Lowest Closing Balances
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Staff with depleted quotas approaching unpaid leave (LWP) thresholds
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--bg-elevated)]/50 text-[var(--text-muted)] font-semibold border-b border-[var(--border)]">
                  <tr>
                    <th className="py-2.5 px-3">Employee</th>
                    <th className="py-2.5 px-2">Type</th>
                    <th className="py-2.5 px-2 text-center">Allocated</th>
                    <th className="py-2.5 px-2 text-center">Used</th>
                    <th className="py-2.5 px-3 text-right">Closing Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {top10Lowest.map((r, i) => (
                    <tr key={i} className="hover:bg-[var(--bg-elevated)]/60">
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-[var(--text-primary)]">{r.employeeName}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">{r.department}</div>
                      </td>
                      <td className="py-2.5 px-2 font-semibold text-[var(--accent)]">{r.leaveTypeCode}</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text-muted)]">{r.allocatedDays}d</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text-muted)]">{r.usedDays}d</td>
                      <td className="py-2.5 px-3 text-right font-bold text-rose-500">{r.closingBalance} days</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 3: Ledger Summary ─────────────────────────────────────────── */}
      {activeTab === 'ledger' && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-sm overflow-hidden">
          <div className="p-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-[var(--accent)]" />
              Balance Transactions Ledger Audit (FY {data.fyStartYear})
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Net balance adjustments, encashments, lapses, and carry-forwards recorded in the transaction ledger
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg-elevated)]/50 text-[var(--text-muted)] font-semibold border-b border-[var(--border)]">
                <tr>
                  <th className="py-3 px-4">Transaction Reason</th>
                  <th className="py-3 px-3">Reason Code</th>
                  <th className="py-3 px-3 text-center">Transactions Count</th>
                  <th className="py-3 px-4 text-right">Net Days Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {ledgerSummary.map((item) => (
                  <tr key={item.reason} className="hover:bg-[var(--bg-elevated)]/60">
                    <td className="py-3 px-4 font-semibold text-[var(--text-primary)]">{item.label}</td>
                    <td className="py-3 px-3 font-mono text-[11px] text-[var(--text-muted)]">{item.reason}</td>
                    <td className="py-3 px-3 text-center font-bold text-[var(--text-primary)]">
                      {item.transactionCount}
                    </td>
                    <td className="py-3 px-4 text-right font-bold">
                      <span
                        className={
                          item.totalDeltaDays > 0
                            ? 'text-emerald-500'
                            : item.totalDeltaDays < 0
                            ? 'text-rose-500'
                            : 'text-[var(--text-muted)]'
                        }
                      >
                        {item.totalDeltaDays > 0 && '+'}
                        {item.totalDeltaDays} days
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Liability boundary notice */}
      <div className="flex items-start gap-2 text-xs text-[var(--text-muted)]/80 italic">
        <Info size={14} className="shrink-0 mt-0.5" />
        <span>{liabilityNotice}</span>
      </div>
    </div>
  );
}
