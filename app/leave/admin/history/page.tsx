'use client';

import { useEffect, useMemo, useState } from 'react';
import LeaveHistoryTable, { LeaveHistoryRow } from '@/components/leave/LeaveHistoryTable';
import { exportRowsAsCSV } from '@/lib/exportData';

type EmployeeOption = { id: string; full_name: string; employee_code: string; department: string; office: string };

const LEAVE_TYPES = [
  { code: 'SL', label: 'Sick Leave' },
  { code: 'CL', label: 'Casual Leave' },
  { code: 'PL', label: 'Planned Leave' },
  { code: 'LWP', label: 'Leave Without Pay' },
];

// D3-1/D3-3: filters compose (department + date range together, etc —
// each is just another query param on GET /api/leave/history) and CSV
// export uses exactly the rows already in state, so the download always
// matches what's on screen (Day 3 AC).
export default function LeaveHistoryPage() {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeesError, setEmployeesError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [department, setDepartment] = useState('');
  const [office, setOffice] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeCode, setLeaveTypeCode] = useState('');

  const [rows, setRows] = useState<LeaveHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadEmployees() {
      try {
        const res = await fetch('/api/leave/employees');
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) {
          setEmployeesError(data.error || `Could not load employees (${res.status}).`);
          return;
        }
        setEmployees(data.employees ?? []);
      } catch {
        setEmployeesError('Could not reach the server to load employees.');
      }
    }
    loadEmployees();
  }, []);

  const departments = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department))).sort(),
    [employees]
  );
  const offices = useMemo(() => Array.from(new Set(employees.map((e) => e.office))).sort(), [employees]);

  async function fetchHistory() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('start_date', startDate);
      if (endDate) params.set('end_date', endDate);
      if (department) params.set('department', department);
      if (office) params.set('office', office);
      if (employeeId) params.set('employee_id', employeeId);
      if (leaveTypeCode) params.set('leave_type_code', leaveTypeCode);

      const res = await fetch(`/api/leave/history?${params.toString()}`);
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setError(data.error || `Could not load leave history (${res.status}).`);
        setRows([]);
        return;
      }
      setRows(data.requests ?? []);
    } catch {
      setError('Could not reach the server — check your connection and retry.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  // Load the unfiltered history once on mount; further loads happen when
  // "Apply Filters" is clicked, so a half-typed filter combination never
  // fires a request the user didn't ask for.
  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClearFilters() {
    setStartDate('');
    setEndDate('');
    setDepartment('');
    setOffice('');
    setEmployeeId('');
    setLeaveTypeCode('');
  }

  function handleExportCSV() {
    const csvRows = rows.map((r) => ({
      Employee: r.employeeName,
      'Employee Code': r.employeeCode,
      Department: r.department,
      Office: r.office,
      'Leave Type': r.leaveTypeLabel,
      'Start Date': r.startDate,
      'End Date': r.endDate,
      'Total Days': r.totalDays,
      'Half Day': r.isHalfDay ? r.halfDaySession ?? 'Yes' : 'No',
      'LWP Override': r.isLwpOverride ? 'Yes' : 'No',
      'Applied On': r.appliedOn,
      'Recorded By': r.recordedBy,
    }));
    const parts = ['Leave_History'];
    if (startDate) parts.push(startDate);
    if (endDate) parts.push(endDate);
    exportRowsAsCSV(csvRows, `${parts.join('_')}.csv`);
  }

  const hasActiveFilters = !!(startDate || endDate || department || office || employeeId || leaveTypeCode);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Leave History</h1>
        <a href="/leave/admin" className="text-xs text-slate-400 hover:text-white">
          ← Back to balances
        </a>
      </div>

      {employeesError && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
          {employeesError}
        </div>
      )}

      <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Department</label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">All</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Office</label>
            <select
              value={office}
              onChange={(e) => setOffice(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">All</option>
              {offices.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Employee</label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">All</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name} ({e.employee_code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Leave Type</label>
            <select
              value={leaveTypeCode}
              onChange={(e) => setLeaveTypeCode(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">All</option>
              {LEAVE_TYPES.map((lt) => (
                <option key={lt.code} value={lt.code}>{lt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={fetchHistory}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {loading ? 'Loading…' : 'Apply Filters'}
          </button>
          {hasActiveFilters && (
            <button type="button" onClick={handleClearFilters} className="text-xs text-slate-400 hover:text-white">
              Clear filters
            </button>
          )}
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={rows.length === 0}
            className="ml-auto border border-slate-700 hover:border-slate-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <p className="text-xs text-slate-500">{rows.length} record(s)</p>

      <LeaveHistoryTable rows={rows} />
    </div>
  );
}