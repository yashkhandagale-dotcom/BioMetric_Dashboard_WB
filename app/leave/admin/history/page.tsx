'use client';

import { useEffect, useMemo, useState } from 'react';
import LeaveHistoryTable, { LeaveHistoryRow } from '@/components/leave/LeaveHistoryTable';
import AbsenteesPanel from '@/components/leave/AbsenteesPanel';
import HalfDayPanel from '@/components/leave/HalfDayPanel';
import RecordLeaveDrawer from '@/components/leave/RecordLeaveDrawer';
import { exportRowsAsCSV } from '@/lib/exportData';
import AttendanceTableSkeleton from '@/components/leave/AttendanceTableSkeleton';

type EmployeeOption = { id: string; full_name: string; employee_code: string; department: string; office: string };

const LEAVE_TYPES = [
  { code: 'SL', label: 'Sick Leave' },
  { code: 'CL', label: 'Casual Leave' },
  { code: 'PL', label: 'Planned Leave' },
  { code: 'LWP', label: 'Leave Without Pay' },
];

type Tab = 'absentees' | 'half_days' | 'history';

// Leave Tracker — formerly just "Leave History". Per feedback, this is
// now the single home for everything that isn't a balances view:
// Absentees, Half Days, and Leave History share one Department/Office/
// Search filter bar and one "+ Record Leave" entry point, instead of
// Absentees/Half Days living as accordions on the balances page and
// Leave History living separately. "Team" in the original ask maps to
// Department here — see lib/attendanceExceptions.ts's header comment
// for why there's no separate team table.
export default function LeaveTrackerPage() {
  const [tab, setTab] = useState<Tab>('absentees');

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeesError, setEmployeesError] = useState<string | null>(null);

  // Shared across all three tabs.
  const [department, setDepartment] = useState('');
  const [office, setOffice] = useState('');
  // Absentees/Half Days: free-text name/code match + one date. Leave
  // History keeps its own date range + exact employee/leave-type filters
  // below (different shape, server-side query — not worth forcing into
  // the same free-text box).
  const [attendanceSearch, setAttendanceSearch] = useState('');
  const [attendanceDate, setAttendanceDate] = useState('');
  // Defaults to the same value as attendanceDate (single-day mode). Once
  // the user picks a different end date, AbsenteesPanel/HalfDayPanel
  // switch to period mode and ask for the whole range in one request —
  // see lib/attendanceExceptions.ts's getAttendanceExceptionsRange.
  const [attendanceEndDate, setAttendanceEndDate] = useState('');

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeCode, setLeaveTypeCode] = useState('');

  const [rows, setRows] = useState<LeaveHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [recordLeaveOpen, setRecordLeaveOpen] = useState(false);

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

  useEffect(() => {
    if (tab === 'history') fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function handleClearHistoryFilters() {
    setStartDate('');
    setEndDate('');
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

  const historyHasActiveFilters = !!(startDate || endDate || employeeId || leaveTypeCode);

  const TABS: { key: Tab; label: string }[] = [
    { key: 'absentees', label: 'Absentees' },
    { key: 'half_days', label: 'Half Days' },
    { key: 'history', label: 'Leave History' },
  ];

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <a href="/leave/admin" className="text-xs text-slate-400 hover:text-white">← Back to balances</a>
          <h1 className="text-xl font-semibold mt-1">Leave Tracker</h1>
        </div>
        <div className="text-right">
          <button
            type="button"
            onClick={() => setRecordLeaveOpen(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Record Leave
          </button>
          {tab !== 'history' && (
            <p className="text-[11px] text-slate-500 mt-1 max-w-[220px]">
              For any employee. To act on a row already listed below, use that row's own "Record Leave" button instead.
            </p>
          )}
        </div>
      </div>

      {employeesError && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
          {employeesError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-700">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Shared Department/Office filter, used by all three tabs */}
      <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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

          {tab !== 'history' ? (
            <>
              <div>
                <label className="block text-xs text-slate-400 mb-1">From Date</label>
                <input
                  type="date"
                  value={attendanceDate}
                  onChange={(e) => setAttendanceDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">To Date</label>
                <input
                  type="date"
                  value={attendanceEndDate}
                  min={attendanceDate || undefined}
                  onChange={(e) => setAttendanceEndDate(e.target.value)}
                  placeholder="Same as From Date"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Employee Search</label>
                <input
                  type="text"
                  value={attendanceSearch}
                  onChange={(e) => setAttendanceSearch(e.target.value)}
                  placeholder="Search by name or employee code…"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
                />
              </div>
              {attendanceEndDate && attendanceEndDate !== attendanceDate && (
                <div className="sm:col-span-2 lg:col-span-6 -mt-1">
                  <button
                    type="button"
                    onClick={() => setAttendanceEndDate('')}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    ✕ Clear "To Date" (back to a single day)
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
        </div>

        {tab === 'history' && (
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={fetchHistory}
              disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {loading ? 'Loading…' : 'Apply Filters'}
            </button>
            {historyHasActiveFilters && (
              <button type="button" onClick={handleClearHistoryFilters} className="text-xs text-slate-400 hover:text-white">
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
        )}
      </div>

      {tab === 'absentees' && (
        <AbsenteesPanel
          date={attendanceDate}
          endDate={attendanceEndDate}
          department={department}
          office={office}
          search={attendanceSearch}
          onResolvedDate={setAttendanceDate}
        />
      )}

      {tab === 'half_days' && (
        <HalfDayPanel
          date={attendanceDate}
          endDate={attendanceEndDate}
          department={department}
          office={office}
          search={attendanceSearch}
          onResolvedDate={setAttendanceDate}
        />
      )}

      {tab === 'history' && (
        <>
          {error && (
            <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          {loading ? (
            <AttendanceTableSkeleton columns={7} />
          ) : (
            <>
              <p className="text-xs text-slate-500">{rows.length} record(s)</p>
              <LeaveHistoryTable rows={department || office ? rows.filter((r) => (!department || r.department === department) && (!office || r.office === office)) : rows} />
            </>
          )}
        </>
      )}

      {recordLeaveOpen && (
        <RecordLeaveDrawer
          onClose={() => setRecordLeaveOpen(false)}
          onSuccess={() => {
            setRecordLeaveOpen(false);
            if (tab === 'history') fetchHistory();
          }}
        />
      )}
    </div>
  );
}