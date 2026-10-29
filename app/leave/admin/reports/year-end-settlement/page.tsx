'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  FileSpreadsheet,
  Download,
  Calendar,
  Filter,
  Search,
  Users,
  CheckCircle2,
  AlertTriangle,
  Info,
  Coins,
  ArrowUpDown,
  RefreshCw,
  Award,
  Sparkles,
  Trash2,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import LeavePageHeader from '@/components/leave/LeavePageHeader';
import { exportRowsAsExcel, exportRowsAsCSV } from '@/lib/exportData';
import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';

interface SettlementEmployee {
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string;
  office: string;
  sl: number;
  cl: number;
  pl: number;
  totalPool: number;
  carryForward: number;
  encashment: number;
  lapsed: number;
  isEligibleForEncashment: boolean;
}

interface SettlementSummary {
  totalEmployees: number;
  totalPoolLeaves: number;
  totalCarryForward: number;
  totalEncashment: number;
  totalLapsed: number;
  encashmentEligibleCount: number;
}

interface SettlementResponse {
  success: boolean;
  fyStartYear: number;
  fyLabel: string;
  policyRule: string;
  summary: SettlementSummary;
  employees: SettlementEmployee[];
}

export default function YearEndSettlementPage() {
  const currentFyStart = getFYStartYear();
  const [selectedFyStart, setSelectedFyStart] = useState<number>(currentFyStart);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SettlementResponse | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'encashment' | 'carry_only' | 'lapsed'>('all');
  const [sortField, setSortField] = useState<'employeeCode' | 'name' | 'totalPool' | 'carryForward' | 'encashment' | 'lapsed'>('totalPool');
  const [sortAsc, setSortAsc] = useState(false);

  // Rollover execution modal
  const [showRolloverModal, setShowRolloverModal] = useState(false);
  const [executingRollover, setExecutingRollover] = useState(false);
  const [rolloverStatus, setRolloverStatus] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  async function fetchSettlement() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leave/admin/reports/year-end-settlement?fyStartYear=${selectedFyStart}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Failed to fetch report (${res.status})`);
      }
      const json: SettlementResponse = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Network error fetching year-end settlement data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSettlement();
  }, [selectedFyStart]);

  // Unique departments for filter dropdown
  const departments = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.employees.map((e) => e.department).filter(Boolean))).sort();
  }, [data]);

  // Filtered and sorted employees
  const filteredEmployees = useMemo(() => {
    if (!data) return [];
    return data.employees
      .filter((emp) => {
        if (deptFilter !== 'all' && emp.department !== deptFilter) return false;
        if (categoryFilter === 'encashment' && emp.encashment <= 0) return false;
        if (categoryFilter === 'carry_only' && (emp.carryForward <= 0 || emp.encashment > 0)) return false;
        if (categoryFilter === 'lapsed' && emp.lapsed <= 0) return false;

        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase();
          const matchName = emp.name.toLowerCase().includes(q);
          const matchCode = emp.employeeCode.toLowerCase().includes(q);
          const matchDept = emp.department.toLowerCase().includes(q);
          if (!matchName && !matchCode && !matchDept) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortField === 'employeeCode') {
          const numA = parseInt(a.employeeCode, 10);
          const numB = parseInt(b.employeeCode, 10);
          diff = !isNaN(numA) && !isNaN(numB) ? numA - numB : a.employeeCode.localeCompare(b.employeeCode);
        } else if (sortField === 'name') {
          diff = a.name.localeCompare(b.name);
        } else {
          diff = a[sortField] - b[sortField];
        }
        return sortAsc ? diff : -diff;
      });
  }, [data, deptFilter, categoryFilter, searchTerm, sortField, sortAsc]);

  function handleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false); // Default descending for leave quantities
    }
  }

  // Export full sheet
  async function handleExportFullExcel() {
    if (!data || filteredEmployees.length === 0) return;
    const exportRows = filteredEmployees.map((emp) => ({
      'Employee Code': emp.employeeCode,
      'Name': emp.name,
      'Department': emp.department,
      'Office': emp.office,
      'Unused SL': emp.sl,
      'Unused CL': emp.cl,
      'Unused PL': emp.pl,
      'Total Unused Pool': emp.totalPool,
      'Carry-Forward (Max 7d)': emp.carryForward,
      'Encashment Payout (Max 7d)': emp.encashment,
      'Lapsed to Trash (>14d)': emp.lapsed,
      'Eligible for Encashment': emp.isEligibleForEncashment ? 'YES' : 'NO',
    }));
    const filename = `Year_End_Leave_Settlement_FY_${data.fyLabel.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
    await exportRowsAsExcel(exportRows, filename, `FY ${data.fyLabel} Settlement`);
  }

  // Export payroll encashment payout sheet (only employees with encashment > 0)
  async function handleExportEncashmentPayroll() {
    if (!data) return;
    const encashmentList = data.employees.filter((emp) => emp.encashment > 0);
    if (encashmentList.length === 0) {
      alert('No employees have encashment days to pay out.');
      return;
    }
    const exportRows = encashmentList.map((emp) => ({
      'Employee Code': emp.employeeCode,
      'Name': emp.name,
      'Department': emp.department,
      'Total Unused Pool': emp.totalPool,
      'Encashment Days (To Pay)': emp.encashment,
      'Payment Status': 'Pending Accounts Disbursement',
    }));
    const filename = `Payroll_Encashment_Payout_FY_${data.fyLabel.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
    await exportRowsAsExcel(exportRows, filename, `Encashment Payout`);
  }

  function handleExportCSV() {
    if (!data || filteredEmployees.length === 0) return;
    const exportRows = filteredEmployees.map((emp) => ({
      'Employee Code': emp.employeeCode,
      'Name': emp.name,
      'Department': emp.department,
      'Unused SL': emp.sl,
      'Unused CL': emp.cl,
      'Unused PL': emp.pl,
      'Total Unused Pool': emp.totalPool,
      'Carry-Forward': emp.carryForward,
      'Encashment': emp.encashment,
      'Lapsed': emp.lapsed,
    }));
    const filename = `Year_End_Leave_Settlement_FY_${data.fyLabel.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
    exportRowsAsCSV(exportRows, filename);
  }

  // Execute rollover via API
  async function handleExecuteRollover() {
    setExecutingRollover(true);
    setRolloverStatus(null);
    try {
      const res = await fetch('/api/leave/admin/reports/year-end-settlement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fyStartYear: selectedFyStart }),
      });
      const resJson = await res.json();
      if (!res.ok) {
        throw new Error(resJson.error || 'Failed to execute rollover');
      }
      setRolloverStatus({
        type: 'success',
        message: resJson.message || 'Annual rollover executed successfully!',
      });
      fetchSettlement();
    } catch (err: any) {
      setRolloverStatus({
        type: 'error',
        message: err.message || 'Error executing rollover',
      });
    } finally {
      setExecutingRollover(false);
    }
  }

  const fyOptions = [currentFyStart - 1, currentFyStart, currentFyStart + 1];

  return (
    <div className="space-y-6">
      <LeavePageHeader
        title="Year-End Encashment & Carry-Forward Review"
        description="Comprehensive audit of all pooled unused leaves (SL + CL + PL combined) for annual rollover and payroll encashment payout."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportFullExcel}
              disabled={!data || filteredEmployees.length === 0}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download full settlement audit sheet"
            >
              <FileSpreadsheet size={15} />
              Export Full Sheet
            </button>
            <button
              type="button"
              onClick={handleExportEncashmentPayroll}
              disabled={!data || data.summary.encashmentEligibleCount === 0}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download only employees eligible for payroll encashment"
            >
              <Coins size={15} />
              Payroll Encashment Sheet ({data?.summary.encashmentEligibleCount ?? 0})
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={!data || filteredEmployees.length === 0}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] text-[var(--text-primary)] text-xs font-semibold shadow-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download CSV"
            >
              <Download size={15} />
              Export CSV
            </button>
          </div>
        }
      />

      {/* Control Card */}
      <div
        className="rounded-2xl border border-[var(--border)] p-5 shadow-sm"
        style={{
          background: 'linear-gradient(180deg, var(--bg-card) 0%, var(--bg-elevated) 100%)',
        }}
      >
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                Financial Year (25 Mar – 24 Mar)
              </label>
              <select
                value={selectedFyStart}
                onChange={(e) => setSelectedFyStart(Number(e.target.value))}
                className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 min-w-[200px]"
              >
                {fyOptions.map((year) => (
                  <option key={year} value={year}>
                    FY {formatFYLabel(year)}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={fetchSettlement}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-card)] text-xs font-semibold text-[var(--text-primary)] transition-all disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowRolloverModal(true)}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-purple-500/20 transition-all"
            >
              <Sparkles size={15} />
              Execute Annual Rollover Settlement
            </button>
          </div>
        </div>
      </div>

      {/* Policy Explanation Banner */}
      <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 text-xs space-y-2">
        <div className="flex items-center gap-2 font-bold text-indigo-700 dark:text-indigo-300">
          <Info size={16} className="shrink-0" />
          <span>Universal WonderBiz Year-End Leave Rollover Policy</span>
        </div>
        <p className="text-[var(--text-muted)] leading-relaxed">
          At the close of each Financial Year (24th March), all remaining leaves across all categories (<strong>SL + CL + PL</strong>) are pooled together into a single total unused figure.
          The combined balance is then settled systematically in three tiers:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
            <div className="font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5 mb-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              1. Carry Forward (Max 7 Days)
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              The first <strong>up to 7 days</strong> of pooled unused leaves carry forward into the new Financial Year as opening <strong>PL (Privileged Leave)</strong>.
            </p>
          </div>
          <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-3">
            <div className="font-bold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5 mb-1">
              <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
              2. Payroll Encashment (Next 7 Days)
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              The next <strong>up to 7 days</strong> (days 8 through 14) are eligible for monetary encashment paid out via payroll.
            </p>
          </div>
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3">
            <div className="font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1.5 mb-1">
              <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
              3. Lapsed / Trash (Remainder &gt; 14)
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              Any remaining leave days beyond 14 days lapse automatically and do not carry forward or pay out.
            </p>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-300 text-xs rounded-xl p-4">
          <AlertTriangle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary KPI Cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-xs">
            <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
              <Users size={14} />
              <span className="text-[11px] font-semibold uppercase tracking-wider">Staff Count</span>
            </div>
            <p className="text-2xl font-black text-[var(--text-primary)]">
              {data.summary.totalEmployees}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Employees audited</p>
          </div>

          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 shadow-xs">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-1">
              <Award size={14} />
              <span className="text-[11px] font-bold uppercase tracking-wider">Total Pooled Pool</span>
            </div>
            <p className="text-2xl font-black text-blue-600 dark:text-blue-400">
              {data.summary.totalPoolLeaves}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">SL + CL + PL unused</p>
          </div>

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 shadow-xs">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 mb-1">
              <CheckCircle2 size={14} />
              <span className="text-[11px] font-bold uppercase tracking-wider">Carry-Forward</span>
            </div>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
              {data.summary.totalCarryForward}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Rolling to next FY PL</p>
          </div>

          <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 shadow-xs">
            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 mb-1">
              <Coins size={14} />
              <span className="text-[11px] font-bold uppercase tracking-wider">Encashment Pool</span>
            </div>
            <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
              {data.summary.totalEncashment}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {data.summary.encashmentEligibleCount} staff eligible
            </p>
          </div>

          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 shadow-xs col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 mb-1">
              <Trash2 size={14} />
              <span className="text-[11px] font-bold uppercase tracking-wider">Lapsed (Trash)</span>
            </div>
            <p className="text-2xl font-black text-rose-600 dark:text-rose-400">
              {data.summary.totalLapsed}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Forfeited (&gt;14 days)</p>
          </div>
        </div>
      )}

      {/* Filter & Search Bar */}
      {data && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by code, name, department…"
                className="w-full pl-9 pr-3 py-2 text-xs bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as any)}
              className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-2.5 py-2 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
            >
              <option value="all">All Employees ({data.employees.length})</option>
              <option value="encashment">Eligible for Encashment ({data.summary.encashmentEligibleCount})</option>
              <option value="carry_only">Carry-Forward Only</option>
              <option value="lapsed">Had Lapsed Leaves</option>
            </select>

            {departments.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Filter size={13} className="text-[var(--text-muted)] shrink-0" />
                <select
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-2.5 py-2 text-xs font-medium text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                >
                  <option value="all">All Departments</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="text-xs text-[var(--text-muted)] self-center">
            Showing <strong className="text-[var(--text-primary)]">{filteredEmployees.length}</strong> of{' '}
            {data.employees.length} employees
          </div>
        </div>
      )}

      {/* Table */}
      {data && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-elevated)]/60 text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                  <th
                    className="py-3.5 px-4 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                    onClick={() => handleSort('employeeCode')}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Code</span>
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th
                    className="py-3.5 px-4 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                    onClick={() => handleSort('name')}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Employee Name</span>
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th className="py-3.5 px-4">Department</th>
                  <th className="py-3.5 px-4 text-center">Unused SL</th>
                  <th className="py-3.5 px-4 text-center">Unused CL</th>
                  <th className="py-3.5 px-4 text-center">Unused PL</th>
                  <th
                    className="py-3.5 px-4 text-center cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                    onClick={() => handleSort('totalPool')}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span>Total Pool</span>
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th
                    className="py-3.5 px-4 text-center cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                    onClick={() => handleSort('carryForward')}
                  >
                    <div className="flex items-center justify-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                      <span>Carry-Forward</span>
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th
                    className="py-3.5 px-4 text-center cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                    onClick={() => handleSort('encashment')}
                  >
                    <div className="flex items-center justify-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                      <span>Encashment</span>
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th
                    className="py-3.5 px-4 text-right cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                    onClick={() => handleSort('lapsed')}
                  >
                    <div className="flex items-center justify-end gap-1.5 text-rose-600 dark:text-rose-400">
                      <span>Lapsed (Trash)</span>
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-[var(--text-muted)]">
                      No employees match the selected criteria.
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((emp) => (
                    <tr
                      key={emp.employeeId}
                      className="hover:bg-[var(--bg-elevated)]/40 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-[var(--text-primary)]">
                        {emp.employeeCode}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-[var(--text-primary)]">{emp.name}</p>
                        <p className="text-[10px] text-[var(--text-muted)]">{emp.office}</p>
                      </td>
                      <td className="py-3 px-4 text-[var(--text-muted)]">{emp.department}</td>
                      <td className="py-3 px-4 text-center font-mono text-[var(--text-muted)]">
                        {emp.sl}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-[var(--text-muted)]">
                        {emp.cl}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-[var(--text-muted)]">
                        {emp.pl}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30">
                          {emp.totalPool}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                          {emp.carryForward}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {emp.encashment > 0 ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                            {emp.encashment}d payout
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {emp.lapsed > 0 ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                            {emp.lapsed}
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">0</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Annual Rollover */}
      {showRolloverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                <Sparkles size={20} />
              </div>
              <div>
                <h3 className="font-bold text-base text-[var(--text-primary)]">
                  Execute Annual Rollover for FY {data?.fyLabel}?
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Permanent update to employee leave balances
                </p>
              </div>
            </div>

            <div className="text-xs text-[var(--text-muted)] space-y-2 leading-relaxed bg-[var(--bg-elevated)] p-4 rounded-xl border border-[var(--border)]">
              <p>
                This operation will execute <strong>fn_annual_leave_reset</strong> for all active employees:
              </p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Total unused leaves (SL + CL + PL) will be pooled.</li>
                <li>Up to <strong>7 days</strong> carry-forward will be credited to next FY’s PL opening balance.</li>
                <li>Up to <strong>7 days</strong> will be logged for encashment payout.</li>
                <li>Any balance exceeding 14 days will be marked as lapsed in audit transactions.</li>
              </ul>
            </div>

            {rolloverStatus && (
              <div
                className={`text-xs p-3 rounded-xl border ${
                  rolloverStatus.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                }`}
              >
                {rolloverStatus.message}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowRolloverModal(false);
                  setRolloverStatus(null);
                }}
                disabled={executingRollover}
                className="px-4 py-2 rounded-xl border border-[var(--border)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleExecuteRollover}
                disabled={executingRollover}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md transition-all disabled:opacity-50"
              >
                {executingRollover ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" />
                    Executing Rollover…
                  </>
                ) : (
                  <>
                    <Sparkles size={13} />
                    Confirm &amp; Run Rollover
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
