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
  CalendarDays,
  Coins,
  ArrowUpDown,
  RefreshCw,
} from 'lucide-react';
import LeavePageHeader from '@/components/leave/LeavePageHeader';
import { exportRowsAsExcel, exportRowsAsCSV } from '@/lib/exportData';

interface ReportEmployee {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string;
  office: string;
  employmentStatus: string;
  dateOfJoining: string | null;
  totalDaysInMonth: number;
  lwpDays: number;
  payableDays: number;
  notes?: string;
}

interface ReportData {
  year: number;
  month: number;
  monthLabel: string;
  daysInMonth: number;
  lwpWindow: {
    start: string;
    end: string;
  };
  options: {
    clampNewJoiners: boolean;
    excludeExited: boolean;
  };
  summary: {
    totalEmployees: number;
    totalGrossDays: number;
    totalPayableDays: number;
    totalLwpDays: number;
  };
  employees: ReportEmployee[];
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function PayableDaysReportPage() {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [clampNewJoiners, setClampNewJoiners] = useState<boolean>(false);
  const [excludeExited, setExcludeExited] = useState<boolean>(true);

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);

  // Filters for generated data
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<'employeeCode' | 'name' | 'payableDays' | 'lwpDays'>('employeeCode');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  async function fetchReport() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/leave/admin/reports/payable-days?year=${selectedYear}&month=${selectedMonth}&clampNewJoiners=${clampNewJoiners}&excludeExited=${excludeExited}`
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to fetch report (${res.status})`);
      }
      const data: ReportData = await res.json();
      setReportData(data);
    } catch (err: any) {
      setError(err.message || 'Error loading report');
    } finally {
      setLoading(false);
    }
  }




  const departments = useMemo(() => {
    if (!reportData) return [];
    const depts = new Set<string>();
    for (const emp of reportData.employees) {
      if (emp.department) depts.add(emp.department);
    }
    return Array.from(depts).sort();
  }, [reportData]);

  const filteredEmployees = useMemo(() => {
    if (!reportData) return [];
    return reportData.employees
      .filter((emp) => {
        if (deptFilter !== 'all' && emp.department !== deptFilter) return false;
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
          // Numeric sort if codes are numeric, else lexical
          const numA = parseInt(a.employeeCode, 10);
          const numB = parseInt(b.employeeCode, 10);
          diff = !isNaN(numA) && !isNaN(numB) ? numA - numB : a.employeeCode.localeCompare(b.employeeCode);
        } else if (sortField === 'name') {
          diff = a.name.localeCompare(b.name);
        } else if (sortField === 'payableDays') {
          diff = a.payableDays - b.payableDays;
        } else if (sortField === 'lwpDays') {
          diff = a.lwpDays - b.lwpDays;
        }
        return sortAsc ? diff : -diff;
      });
  }, [reportData, deptFilter, searchTerm, sortField, sortAsc]);

  function handleSort(field: 'employeeCode' | 'name' | 'payableDays' | 'lwpDays') {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  }

  function handleExportExcel() {
    if (!reportData || filteredEmployees.length === 0) return;
    const exportRows = filteredEmployees.map((emp) => ({
      'Employee Code': emp.employeeCode,
      'Name': emp.name,
      'Department': emp.department,
      'Employment Status': emp.employmentStatus,
      'Joining Date': emp.dateOfJoining ?? '—',
      'Total Days in Month': emp.totalDaysInMonth,
      'LWP Days': emp.lwpDays,
      'Payable Days': emp.payableDays,
      'Notes': emp.notes || '',
    }));
    const filename = `Payable_Days_${reportData.year}_${String(reportData.month).padStart(2, '0')}_${reportData.monthLabel.replace(/\s+/g, '_')}.xlsx`;
    exportRowsAsExcel(exportRows, filename, `Payable Days ${reportData.monthLabel}`);
  }

  function handleExportCSV() {
    if (!reportData || filteredEmployees.length === 0) return;
    const exportRows = filteredEmployees.map((emp) => ({
      'Employee Code': emp.employeeCode,
      'Name': emp.name,
      'Department': emp.department,
      'Employment Status': emp.employmentStatus,
      'Joining Date': emp.dateOfJoining ?? '',
      'Total Days in Month': emp.totalDaysInMonth,
      'LWP Days': emp.lwpDays,
      'Payable Days': emp.payableDays,
      'Notes': emp.notes || '',
    }));
    const filename = `Payable_Days_${reportData.year}_${String(reportData.month).padStart(2, '0')}.csv`;
    exportRowsAsCSV(exportRows, filename);
  }

  // Generate Year options
  const years = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <div className="space-y-6">
      <LeavePageHeader
        title="Monthly Payable-Days Export"
        description="Calculate calendar-month gross days netted against salary-cycle (25th to 24th) LWP leave for payroll."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={!reportData || filteredEmployees.length === 0}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download formatted Excel sheet"
            >
              <FileSpreadsheet size={15} />
              Export Excel
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={!reportData || filteredEmployees.length === 0}
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          {/* Month selector */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
              Select Month
            </label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx + 1}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {/* Year selector */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
              Select Year
            </label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Policy flags */}
          <div className="space-y-2 md:col-span-1">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={excludeExited}
                onChange={(e) => setExcludeExited(e.target.checked)}
                className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]/30"
              />
              <span>Exclude exited / F&amp;F employees</span>
            </label>
            <label
              className="flex items-center gap-2 cursor-pointer text-xs font-medium text-[var(--text-primary)]"
              title="If enabled, new joiners joining after the 1st have gross days clamped from their DOJ"
            >
              <input
                type="checkbox"
                checked={clampNewJoiners}
                onChange={(e) => setClampNewJoiners(e.target.checked)}
                className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]/30"
              />
              <span>Clamp new joiners to DOJ</span>
              <Info size={13} className="text-[var(--text-muted)]" />
            </label>
          </div>

          {/* Action button */}
          <div>
            <button
              type="button"
              onClick={fetchReport}
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] hover:opacity-95 text-white text-sm font-bold shadow-md shadow-[var(--accent)]/20 disabled:opacity-50 transition-all"
            >
              {loading ? (
                <>
                  <RefreshCw size={15} className="animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <CalendarDays size={15} />
                  Generate Report
                </>
              )}
            </button>
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
      {reportData && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-xs">
            <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
              <Users size={14} />
              <span className="text-[11px] font-semibold uppercase tracking-wider">Active Employees</span>
            </div>
            <p className="text-2xl font-black text-[var(--text-primary)]">
              {reportData.summary.totalEmployees}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{reportData.monthLabel}</p>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-xs">
            <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
              <Calendar size={14} />
              <span className="text-[11px] font-semibold uppercase tracking-wider">Calendar Days</span>
            </div>
            <p className="text-2xl font-black text-[var(--text-primary)]">
              {reportData.daysInMonth}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Month basis (1st–{reportData.daysInMonth}th)</p>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-xs">
            <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
              <CalendarDays size={14} />
              <span className="text-[11px] font-semibold uppercase tracking-wider">LWP Window</span>
            </div>
            <p className="text-sm font-bold text-[var(--text-primary)] mt-1 truncate">
              {reportData.lwpWindow.start.slice(5)} → {reportData.lwpWindow.end.slice(5)}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">25th M-1 to 24th M</p>
          </div>

          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 shadow-xs">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 mb-1">
              <AlertTriangle size={14} />
              <span className="text-[11px] font-bold uppercase tracking-wider">Total LWP Days</span>
            </div>
            <p className="text-2xl font-black text-amber-600 dark:text-amber-400">
              {reportData.summary.totalLwpDays}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Deducted from gross</p>
          </div>

          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 shadow-xs col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 mb-1">
              <Coins size={14} />
              <span className="text-[11px] font-bold uppercase tracking-wider">Net Payable Days</span>
            </div>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
              {reportData.summary.totalPayableDays}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Ready for payroll</p>
          </div>
        </div>
      )}

      {/* Filter & Search Bar */}
      {reportData && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by code, name, department…"
                className="w-full pl-9 pr-3 py-2 text-xs bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
              />
            </div>

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
            {reportData.employees.length} employees
          </div>
        </div>
      )}

      {/* Main Table */}
      {reportData && (
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
                  <th className="py-3.5 px-4">Status / DOJ</th>
                  <th className="py-3.5 px-4 text-center">Total Days (Month)</th>
                  <th
                    className="py-3.5 px-4 text-center cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                    onClick={() => handleSort('lwpDays')}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span>LWP Days</span>
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th
                    className="py-3.5 px-4 text-right cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                    onClick={() => handleSort('payableDays')}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Payable Days</span>
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-[var(--text-muted)]">
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
                        {emp.notes && (
                          <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">{emp.notes}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-[var(--text-muted)]">{emp.department}</td>
                      <td className="py-3 px-4 text-[var(--text-muted)]">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-block w-2 h-2 rounded-full ${
                              emp.employmentStatus === 'active'
                                ? 'bg-emerald-500'
                                : emp.employmentStatus === 'probation'
                                ? 'bg-blue-500'
                                : 'bg-amber-500'
                            }`}
                          />
                          <span className="capitalize">{emp.employmentStatus}</span>
                        </div>
                        {emp.dateOfJoining && (
                          <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                            DOJ: {emp.dateOfJoining}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center font-medium text-[var(--text-muted)]">
                        {emp.totalDaysInMonth}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {emp.lwpDays > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                            {emp.lwpDays}
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="inline-block font-mono text-sm font-black text-emerald-600 dark:text-emerald-400">
                          {emp.payableDays}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Advisory Callout on Snapshot Immutability */}
      <div className="flex items-start gap-3 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-2xl p-4 text-xs text-[var(--text-muted)] leading-relaxed">
        <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-[var(--text-primary)]">
            Audit Recommendation: Point-in-time Frozen Snapshot
          </p>
          <p>
            This export computes payable days dynamically from currently approved leave records.
            For finalized payroll runs, we recommend capturing a point-in-time snapshot so that any subsequent leave edits
            do not alter historical records acted upon by Accounts.
          </p>
        </div>
      </div>
    </div>
  );
}
