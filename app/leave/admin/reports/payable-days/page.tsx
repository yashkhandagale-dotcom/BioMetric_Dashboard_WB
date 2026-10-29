'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
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
  ShieldAlert,
  Upload,
  Bell,
  Mail,
  X,
  Check,
  CalendarCheck,
} from 'lucide-react';
import LeavePageHeader from '@/components/leave/LeavePageHeader';
import { exportRowsAsExcel, exportRowsAsCSV } from '@/lib/exportData';
import RecordLeaveDrawer from '@/components/leave/RecordLeaveDrawer';

interface UnmarkedItem {
  date: string;
  kind: 'absent' | 'half_day';
  detail: string;
  firstPunch?: string | null;
  lastPunch?: string | null;
  dayCount: number;
}

interface GroupedUnmarkedEmployee {
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string;
  office: string;
  balances: {
    sl: number;
    cl: number;
    pl: number;
    totalPaid: number;
  };
  unmarkedItems: UnmarkedItem[];
  totalUnmarkedDays: number;
  canCoverWithPaidBalance: boolean;
}

interface UnmarkedReportResponse {
  success: boolean;
  year: number;
  month: number;
  monthLabel: string;
  fyLabel: string;
  lwpWindow: { start: string; end: string };
  summary: {
    totalStaffCount: number;
    totalUnmarkedDays: number;
    staffWithSufficientBalanceCount: number;
    staffWithZeroBalanceCount: number;
  };
  employees: GroupedUnmarkedEmployee[];
}

interface ReportEmployee {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string;
  office: string;
  category?: 'ONBOARD' | 'NOTICE' | 'FF_EXITED';
  employmentStatus: string;
  dateOfJoining: string | null;
  dateOfExit?: string | null;
  standardBaseDays?: number;
  totalDaysInMonth: number;
  lwpDays: number;
  unmarkedAbsentDays?: number;
  totalDeductedDays?: number;
  availableBalances?: {
    sl: number;
    cl: number;
    pl: number;
    totalPaid: number;
  };
  payableDays: number;
  notes?: string;
}

interface ReportData {
  year: number;
  month: number;
  monthLabel: string;
  hasAttendance?: boolean;
  attendanceRecordsCount?: number;
  standardBaseDays?: number;
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
    onboardCount?: number;
    noticeCount?: number;
    ffExitedCount?: number;
    totalGrossDays: number;
    totalPayableDays: number;
    totalLwpDays: number;
    totalUnmarkedAbsentDays?: number;
    unmarkedAbsentEmployeeCount?: number;
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
  const [clampNewJoiners, setClampNewJoiners] = useState<boolean>(true);
  const [excludeExited, setExcludeExited] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);

  // Filters for generated data
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'ONBOARD' | 'NOTICE' | 'FF_EXITED'>('all');
  const [sortField, setSortField] = useState<'employeeCode' | 'name' | 'payableDays' | 'lwpDays'>('employeeCode');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  // Unmarked Absences Review Modal states
  const [showUnmarkedModal, setShowUnmarkedModal] = useState<boolean>(false);
  const [unmarkedLoading, setUnmarkedLoading] = useState<boolean>(false);
  const [unmarkedData, setUnmarkedData] = useState<UnmarkedReportResponse | null>(null);
  const [remindingAll, setRemindingAll] = useState<boolean>(false);
  const [remindedIds, setRemindedIds] = useState<Set<string>>(new Set());
  const [remindMessage, setRemindMessage] = useState<string | null>(null);
  const [recordLeaveFor, setRecordLeaveFor] = useState<{
    employeeId: string;
    employeeName: string;
    date: string;
    isHalfDay?: boolean;
  } | null>(null);

  async function fetchUnmarkedReport() {
    setUnmarkedLoading(true);
    setRemindMessage(null);
    try {
      const res = await fetch(`/api/leave/admin/reports/payable-days/unmarked?year=${selectedYear}&month=${selectedMonth}`);
      if (res.ok) {
        const json: UnmarkedReportResponse = await res.json();
        setUnmarkedData(json);
      }
    } catch (err) {
      console.warn('Could not load unmarked report:', err);
    } finally {
      setUnmarkedLoading(false);
    }
  }

  async function handleSendReminder(empId: string) {
    try {
      const res = await fetch('/api/leave/admin/reports/payable-days/unmarked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: selectedYear, month: selectedMonth, employeeId: empId }),
      });
      const json = await res.json();
      if (res.ok) {
        setRemindedIds((prev) => new Set(prev).add(empId));
        setRemindMessage(json.message);
      } else {
        alert(json.error || 'Failed to send reminder');
      }
    } catch {
      alert('Network error sending reminder');
    }
  }

  async function handleRemindAll() {
    setRemindingAll(true);
    setRemindMessage(null);
    try {
      const res = await fetch('/api/leave/admin/reports/payable-days/unmarked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: selectedYear, month: selectedMonth, remindAll: true }),
      });
      const json = await res.json();
      if (res.ok) {
        const allIds = (unmarkedData?.employees ?? []).map((e) => e.employeeId);
        setRemindedIds(new Set(allIds));
        setRemindMessage(json.message);
      } else {
        alert(json.error || 'Failed to send bulk reminders');
      }
    } catch {
      alert('Network error sending bulk reminders');
    } finally {
      setRemindingAll(false);
    }
  }

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
        if (categoryFilter !== 'all' && emp.category !== categoryFilter) return false;
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
  }, [reportData, deptFilter, categoryFilter, searchTerm, sortField, sortAsc]);

  function handleSort(field: 'employeeCode' | 'name' | 'payableDays' | 'lwpDays') {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  }

  async function handleExportExcel() {
    if (!reportData || filteredEmployees.length === 0) return;
    if (reportData.hasAttendance === false) {
      alert('Download Blocked: Biometric attendance has not been uploaded for this month. Please upload attendance first.');
      return;
    }
    const exportRows = filteredEmployees.map((emp) => ({
      'Employee Code': emp.employeeCode,
      'Name': emp.name,
      'Department': emp.department,
      'Category': emp.category === 'FF_EXITED' ? 'Full & Final (Exited)' : emp.category === 'NOTICE' ? 'Notice Period' : 'Onboard (Active)',
      'Employment Status': emp.employmentStatus,
      'Joining Date': emp.dateOfJoining ?? '—',
      'Exit Date': emp.dateOfExit ?? '—',
      'Standard Base Days': emp.standardBaseDays ?? 30,
      'Gross Days in Month': emp.totalDaysInMonth,
      'Approved LWP Days': emp.lwpDays,
      'Unmarked Absence Days': emp.unmarkedAbsentDays ?? 0,
      'Total Deductions': (emp.lwpDays ?? 0) + (emp.unmarkedAbsentDays ?? 0),
      'Net Payable Days': emp.payableDays,
      'Notes': emp.notes || '',
    }));
    const filename = `Payroll_Payable_Days_${reportData.year}_${String(reportData.month).padStart(2, '0')}_${reportData.monthLabel.replace(/\s+/g, '_')}.xlsx`;
    await exportRowsAsExcel(exportRows, filename, `Payable Days ${reportData.monthLabel}`);
  }

  function handleExportCSV() {
    if (!reportData || filteredEmployees.length === 0) return;
    if (reportData.hasAttendance === false) {
      alert('Download Blocked: Biometric attendance has not been uploaded for this month. Please upload attendance first.');
      return;
    }
    const exportRows = filteredEmployees.map((emp) => ({
      'Employee Code': emp.employeeCode,
      'Name': emp.name,
      'Department': emp.department,
      'Category': emp.category === 'FF_EXITED' ? 'Full & Final (Exited)' : emp.category === 'NOTICE' ? 'Notice Period' : 'Onboard (Active)',
      'Employment Status': emp.employmentStatus,
      'Joining Date': emp.dateOfJoining ?? '',
      'Exit Date': emp.dateOfExit ?? '',
      'Standard Base Days': emp.standardBaseDays ?? 30,
      'Gross Days in Month': emp.totalDaysInMonth,
      'Approved LWP Days': emp.lwpDays,
      'Unmarked Absence Days': emp.unmarkedAbsentDays ?? 0,
      'Total Deductions': (emp.lwpDays ?? 0) + (emp.unmarkedAbsentDays ?? 0),
      'Net Payable Days': emp.payableDays,
      'Notes': emp.notes || '',
    }));
    const filename = `Payroll_Payable_Days_${reportData.year}_${String(reportData.month).padStart(2, '0')}.csv`;
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
              onClick={() => {
                fetchUnmarkedReport();
                setShowUnmarkedModal(true);
              }}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-bold transition-all shadow-xs"
              title="Review all unmarked absences, balances, and send reminders to employees"
            >
              <Bell size={15} className="text-amber-600 dark:text-amber-400" />
              <span>Review Unmarked Leaves</span>
              {reportData?.summary.unmarkedAbsentEmployeeCount ? (
                <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white">
                  {reportData.summary.unmarkedAbsentEmployeeCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={!reportData || filteredEmployees.length === 0 || reportData.hasAttendance === false}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title={reportData?.hasAttendance === false ? 'Cannot download: Biometric attendance not uploaded for this month' : 'Download formatted Excel sheet'}
            >
              <FileSpreadsheet size={15} />
              Export Excel
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={!reportData || filteredEmployees.length === 0 || reportData.hasAttendance === false}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] text-[var(--text-primary)] text-xs font-semibold shadow-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title={reportData?.hasAttendance === false ? 'Cannot download: Biometric attendance not uploaded for this month' : 'Download CSV'}
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

      {/* Error / Attendance Blocked Banner */}
      {error && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-red-500/10 border-2 border-red-500/30 text-red-700 dark:text-red-300 rounded-2xl p-4 text-xs shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldAlert size={20} className="shrink-0 text-red-500 mt-0.5" />
            <div className="space-y-1">
              <strong className="block font-bold text-sm">Download Blocked: Biometric Attendance Missing</strong>
              <p className="leading-relaxed text-[var(--text-muted)]">{error}</p>
            </div>
          </div>
          <Link
            href="/"
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all shadow-sm"
          >
            <Upload size={14} />
            Upload Attendance File
          </Link>
        </div>
      )}

      {/* Unmarked Absences Action Required Banner */}
      {reportData && (reportData.summary.unmarkedAbsentEmployeeCount ?? 0) > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-amber-500/10 border-2 border-amber-500/30 text-amber-800 dark:text-amber-200 rounded-2xl p-4 text-xs shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="shrink-0 text-amber-500 mt-0.5" />
            <div className="space-y-1">
              <strong className="block font-bold text-sm">
                Action Required: {reportData.summary.unmarkedAbsentEmployeeCount} Employee(s) Have Unmarked Absences
              </strong>
              <p className="leading-relaxed text-[var(--text-muted)]">
                Biometric punch logs indicate absences that have not yet been marked in the leave portal.
                Please review and mark them as <strong>Paid Leave (PL, SL, CL)</strong> if balance is available, or as <strong>LWP</strong> to finalize payroll correctly.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                fetchUnmarkedReport();
                setShowUnmarkedModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-all shadow-sm"
            >
              <Bell size={14} />
              Review &amp; Remind Staff
            </button>
            <Link
              href="/leave/admin/history?tab=absentees"
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 text-xs font-semibold transition-all"
            >
              Absentees Tab &rarr;
            </Link>
          </div>
        </div>
      )}

      {/* Summary KPI Cards */}
      {reportData && (
        <div className="space-y-3">
          {/* Policy Banner */}
          <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 text-blue-800 dark:text-blue-300 px-4 py-2.5 rounded-xl text-xs font-medium">
            <Info size={15} className="text-blue-500 shrink-0" />
            <span>
              <strong>Universal 30-Day Payroll Standard:</strong> All calendar months use a fixed base of <strong>30 paid days</strong>. LWP is tracked within the <strong>25th to 24th</strong> leave cycle window.
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-xs">
              <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
                <Users size={14} />
                <span className="text-[11px] font-semibold uppercase tracking-wider">Total Staff</span>
              </div>
              <p className="text-2xl font-black text-[var(--text-primary)]">
                {reportData.summary.totalEmployees}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {reportData.summary.onboardCount ?? 0} Onboard • {reportData.summary.noticeCount ?? 0} Notice • {reportData.summary.ffExitedCount ?? 0} FF
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-xs">
              <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
                <Calendar size={14} />
                <span className="text-[11px] font-semibold uppercase tracking-wider">Payroll Base</span>
              </div>
              <p className="text-2xl font-black text-[var(--text-primary)]">
                {reportData.standardBaseDays ?? 30} <span className="text-xs font-normal text-[var(--text-muted)]">Days</span>
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Fixed standard denominator</p>
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
        </div>
      )}

      {/* Filter & Search Bar */}
      {reportData && (
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

            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as any)}
              className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-2.5 py-2 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
            >
              <option value="all">All Rosters ({reportData.employees.length})</option>
              <option value="ONBOARD">Onboard Active ({reportData.summary.onboardCount ?? 0})</option>
              <option value="NOTICE">Notice Period ({reportData.summary.noticeCount ?? 0})</option>
              <option value="FF_EXITED">Full &amp; Final ({reportData.summary.ffExitedCount ?? 0})</option>
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
                  <th className="py-3.5 px-4">Roster Category</th>
                  <th className="py-3.5 px-4">Status / DOJ</th>
                  <th className="py-3.5 px-4 text-center">Payroll Base</th>
                  <th
                    className="py-3.5 px-4 text-center cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                    onClick={() => handleSort('lwpDays')}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span>Approved LWP</span>
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th className="py-3.5 px-4 text-center">
                    <span className="text-rose-600 dark:text-rose-400">Unmarked Absences</span>
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
                    <td colSpan={9} className="py-12 text-center text-[var(--text-muted)]">
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
                      <td className="py-3 px-4">
                        {emp.category === 'ONBOARD' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                            Onboard (Active)
                          </span>
                        ) : emp.category === 'NOTICE' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                            Notice Period
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30">
                            Full &amp; Final
                          </span>
                        )}
                        {emp.dateOfExit && (
                          <span className="text-[10px] text-[var(--text-muted)] block mt-0.5 font-mono">
                            Exit: {emp.dateOfExit}
                          </span>
                        )}
                      </td>
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
                      <td className="py-3 px-4 text-center font-medium">
                        <span className="font-bold text-[var(--text-primary)]">
                          {emp.standardBaseDays ?? 30}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)] block">
                          Cal: {emp.totalDaysInMonth}d
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {emp.lwpDays > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                            {emp.lwpDays}d
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {(emp.unmarkedAbsentDays ?? 0) > 0 ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                              {emp.unmarkedAbsentDays}d
                            </span>
                            {emp.availableBalances && emp.availableBalances.totalPaid > 0 ? (
                              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block font-medium">
                                ({emp.availableBalances.totalPaid}d paid bal)
                              </span>
                            ) : (
                              <span className="text-[10px] text-rose-600 dark:text-rose-400 block font-medium">
                                (0 paid bal)
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                fetchUnmarkedReport();
                                setShowUnmarkedModal(true);
                              }}
                              className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline block font-semibold mx-auto cursor-pointer"
                            >
                              Review &amp; Mark &rarr;
                            </button>
                          </div>
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

      {/* Review Unmarked Leaves Modal */}
      {showUnmarkedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-4xl max-h-[90vh] bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--bg-elevated)]/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25">
                  <Bell size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-base text-[var(--text-primary)]">
                    Review Unmarked Leaves &amp; Send Reminders
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Payroll Cycle: {unmarkedData?.lwpWindow ? `${unmarkedData.lwpWindow.start} to ${unmarkedData.lwpWindow.end}` : '25th M-1 to 24th M'} • FY {unmarkedData?.fyLabel ?? ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowUnmarkedModal(false)}
                className="p-1.5 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Quick Metrics Bar */}
            {unmarkedData && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-3.5 border-b border-[var(--border)] bg-[var(--bg-surface)]/40 text-xs">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-2.5">
                  <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider block">Staff with Absences</span>
                  <span className="text-lg font-black text-[var(--text-primary)]">{unmarkedData.summary.totalStaffCount}</span>
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5">
                  <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider block">Total Unmarked Days</span>
                  <span className="text-lg font-black text-amber-600 dark:text-amber-400">{unmarkedData.summary.totalUnmarkedDays}d</span>
                </div>
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5">
                  <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">Has Paid Balance</span>
                  <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">{unmarkedData.summary.staffWithSufficientBalanceCount} staff</span>
                </div>
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-2.5">
                  <span className="text-[10px] font-semibold text-rose-600 dark:text-rose-400 uppercase tracking-wider block">Zero Paid Balance (LWP)</span>
                  <span className="text-lg font-black text-rose-600 dark:text-rose-400">{unmarkedData.summary.staffWithZeroBalanceCount} staff</span>
                </div>
              </div>
            )}

            {/* Remind All Action Header */}
            <div className="px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-elevated)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <p className="text-[var(--text-muted)] max-w-xl">
                Notify employees in-app &amp; via email of their exact unmarked dates and live balances (SL, CL, PL) before the 24th payroll cutoff.
              </p>
              <button
                type="button"
                onClick={handleRemindAll}
                disabled={remindingAll || unmarkedLoading || !unmarkedData || unmarkedData.employees.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-sm shrink-0 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {remindingAll ? <RefreshCw size={14} className="animate-spin" /> : <Mail size={14} />}
                <span>Remind All Staff ({unmarkedData?.employees.length ?? 0})</span>
              </button>
            </div>

            {/* Feedback banner */}
            {remindMessage && (
              <div className="mx-6 mt-3 px-4 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center gap-2">
                <Check size={15} className="shrink-0 text-emerald-500" />
                <span>{remindMessage}</span>
              </div>
            )}

            {/* Body Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {unmarkedLoading ? (
                <div className="py-16 text-center text-[var(--text-muted)] flex flex-col items-center justify-center gap-2">
                  <RefreshCw size={24} className="animate-spin text-[var(--accent)]" />
                  <span className="text-xs font-medium">Scanning biometric punches and leave balances…</span>
                </div>
              ) : !unmarkedData || unmarkedData.employees.length === 0 ? (
                <div className="py-16 text-center space-y-2">
                  <CheckCircle2 size={36} className="text-emerald-500 mx-auto" />
                  <h4 className="font-bold text-sm text-[var(--text-primary)]">All Clear! No Unmarked Absences</h4>
                  <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto">
                    Every employee with missing punches in this payroll cycle already has a corresponding approved leave or regularisation request.
                  </p>
                </div>
              ) : (
                unmarkedData.employees.map((emp) => {
                  const isReminded = remindedIds.has(emp.employeeId);
                  return (
                    <div
                      key={emp.employeeId}
                      className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)]/40 p-4 space-y-3 hover:border-[var(--border-strong)] transition-all"
                    >
                      {/* Top Row: Name, Dept, Balances, Reminder Action */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-[var(--text-muted)]">{emp.employeeCode}</span>
                            <span className="font-bold text-sm text-[var(--text-primary)]">{emp.name}</span>
                            <span className="text-[10px] text-[var(--text-muted)]">({emp.department})</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px]">
                            <span className="font-semibold text-[var(--text-muted)]">Available Balances:</span>
                            <span className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] font-medium">
                              SL: <strong className="text-[var(--text-primary)]">{emp.balances.sl}</strong>
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] font-medium">
                              CL: <strong className="text-[var(--text-primary)]">{emp.balances.cl}</strong>
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] font-medium">
                              PL: <strong className="text-[var(--text-primary)]">{emp.balances.pl}</strong>
                            </span>
                            <span className={`px-2 py-0.5 rounded-full font-bold ${
                              emp.balances.totalPaid >= emp.totalUnmarkedDays
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                            }`}>
                              Total Paid: {emp.balances.totalPaid}d
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-start sm:self-center">
                          <button
                            type="button"
                            onClick={() => handleSendReminder(emp.employeeId)}
                            disabled={isReminded}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer ${
                              isReminded
                                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 cursor-default'
                                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                            }`}
                          >
                            {isReminded ? (
                              <>
                                <Check size={13} />
                                <span>Reminded</span>
                              </>
                            ) : (
                              <>
                                <Mail size={13} />
                                <span>Send Reminder</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Unmarked Dates List */}
                      <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl bg-[var(--bg-card)] overflow-hidden">
                        {emp.unmarkedItems.map((item, idx) => (
                          <div
                            key={`${emp.employeeId}-${item.date}-${idx}`}
                            className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 text-xs gap-2 hover:bg-[var(--bg-elevated)]/50 transition-colors"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                item.kind === 'absent'
                                  ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                                  : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                              }`}>
                                {item.kind === 'absent' ? 'Full Day (1.0d)' : 'Half Day (0.5d)'}
                              </span>
                              <span className="font-semibold text-[var(--text-primary)]">{item.date}</span>
                              <span className="text-[11px] text-[var(--text-muted)]">{item.detail}</span>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setRecordLeaveFor({
                                  employeeId: emp.employeeId,
                                  employeeName: emp.name,
                                  date: item.date,
                                  isHalfDay: item.kind === 'half_day',
                                });
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--accent)]/40 hover:bg-[var(--accent)]/10 text-[var(--accent)] text-[11px] font-bold transition-all shrink-0 self-end sm:self-center cursor-pointer"
                            >
                              <CalendarCheck size={12} />
                              <span>Record Leave</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--border)] bg-[var(--bg-elevated)]/60 text-xs">
              <span className="text-[var(--text-muted)]">
                Unmarked leaves without approved leave are automatically treated as LWP in Payable Days export.
              </span>
              <button
                type="button"
                onClick={() => setShowUnmarkedModal(false)}
                className="px-4 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-surface)] text-[var(--text-primary)] font-semibold transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Leave Drawer for quick one-click marking */}
      {recordLeaveFor && (
        <RecordLeaveDrawer
          employeeId={recordLeaveFor.employeeId}
          employeeName={recordLeaveFor.employeeName}
          presetDate={recordLeaveFor.date}
          presetIsHalfDay={recordLeaveFor.isHalfDay}
          lockHalfDay={recordLeaveFor.isHalfDay}
          onClose={() => setRecordLeaveFor(null)}
          onSuccess={() => {
            setRecordLeaveFor(null);
            fetchUnmarkedReport();
            fetchReport();
          }}
        />
      )}
    </div>
  );
}
