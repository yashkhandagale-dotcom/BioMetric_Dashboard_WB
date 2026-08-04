'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import LeaveHistoryTable, { LeaveHistoryRow } from '@/components/leave/LeaveHistoryTable';
import AbsenteesPanel from '@/components/leave/AbsenteesPanel';
import HalfDayPanel from '@/components/leave/HalfDayPanel';
import RecordLeaveDrawer from '@/components/leave/RecordLeaveDrawer';
import LeaveCalendar from '@/components/leave/LeaveCalendar';
import CalendarDayDrawer from '@/components/leave/CalendarDayDrawer';
import { exportRowsAsCSV } from '@/lib/exportData';
import AttendanceTableSkeleton from '@/components/leave/AttendanceTableSkeleton';
import type { AbsenteeCandidate, HalfDayCandidate } from '@/lib/attendanceExceptions';
import { currentMonthKey, mergeCalendarDay, monthBounds } from '@/lib/leaveCalendar';
import type { CalendarDayEntry } from '@/lib/leaveCalendar';

type EmployeeOption = { id: string; full_name: string; employee_code: string; department: string; office: string };

const LEAVE_TYPES = [
  { code: 'SL', label: 'Sick Leave' },
  { code: 'CL', label: 'Casual Leave' },
  { code: 'PL', label: 'Planned Leave' },
  { code: 'LWP', label: 'Leave Without Pay' },
];

type View = 'calendar' | 'table';
type Tab = 'absentees' | 'half_days' | 'history';

// Leave Tracker. The month calendar (below) is now the primary view —
// see the Leave Tracker Calendar brief. The original Absentees / Half
// Days / Leave History tabs are preserved as-is, reachable via the
// "Table view" toggle, since HR still needs the flat table for bulk
// actions/export (exportRowsAsCSV stays wired to History exactly as
// before). "Team" in the original ask maps to Department here — see
// lib/attendanceExceptions.ts's header comment for why there's no
// separate team table.
export default function LeaveTrackerPage() {
  const [view, setView] = useState<View>('calendar');
  const [tab, setTab] = useState<Tab>('absentees');

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeesError, setEmployeesError] = useState<string | null>(null);

  // Shared across all three table-view tabs.
  const [department, setDepartment] = useState('');
  const [office, setOffice] = useState('');
  const [attendanceSearch, setAttendanceSearch] = useState('');
  const [attendanceDate, setAttendanceDate] = useState('');
  const [attendanceEndDate, setAttendanceEndDate] = useState('');

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeCode, setLeaveTypeCode] = useState('');

  const [rows, setRows] = useState<LeaveHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [recordLeaveOpen, setRecordLeaveOpen] = useState(false);

  // ── Calendar-specific state ─────────────────────────────────────────
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [calendarDepartment, setCalendarDepartment] = useState('');
  const [calendarSearch, setCalendarSearch] = useState('');
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarRefreshSignal, setCalendarRefreshSignal] = useState(0);
  const [calendarAbsentees, setCalendarAbsentees] = useState<AbsenteeCandidate[]>([]);
  const [calendarHalfDays, setCalendarHalfDays] = useState<HalfDayCandidate[]>([]);
  const [calendarLeave, setCalendarLeave] = useState<LeaveHistoryRow[]>([]);
  const [calendarHolidays, setCalendarHolidays] = useState<Map<string, string[]>>(new Map());
  const [openDay, setOpenDay] = useState<string | null>(null);

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
    if (tab === 'history' && view === 'table') fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, view]);

  // ── Calendar data load: one request per data source per month, per
  // brief section 1.6 — NOT re-fetched on department/employee-search
  // changes, which filter the already-fetched month client-side (the
  // same convention AbsenteesPanel/HalfDayPanel already use for their
  // Department/Office/Search filters).
  const loadCalendarMonth = useCallback(async () => {
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      const { start, end } = monthBounds(monthKey);
      const [exceptionsRes, leaveRes, holidaysRes] = await Promise.all([
        fetch(`/api/leave/attendance/exceptions?start_date=${start}&end_date=${end}`),
        fetch(`/api/leave/history?start_date=${start}&end_date=${end}&range_mode=overlap`),
        fetch(`/api/leave/holidays?start_date=${start}&end_date=${end}`),
      ]);

      const [exceptionsBody, leaveBody, holidaysBody] = await Promise.all([
        exceptionsRes.json(),
        leaveRes.json(),
        holidaysRes.json(),
      ]);

      if (!exceptionsRes.ok) throw new Error(exceptionsBody.error || 'Could not load attendance exceptions.');
      if (!leaveRes.ok) throw new Error(leaveBody.error || 'Could not load leave requests.');
      if (!holidaysRes.ok) throw new Error(holidaysBody.error || 'Could not load holidays.');

      setCalendarAbsentees(exceptionsBody.absentees ?? []);
      setCalendarHalfDays(exceptionsBody.halfDayCandidates ?? []);
      setCalendarLeave(leaveBody.requests ?? []);

      const holidayMap = new Map<string, string[]>();
      for (const h of holidaysBody.holidays ?? []) {
        holidayMap.set(h.date, [h.name]);
      }
      setCalendarHolidays(holidayMap);
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : 'Could not reach the server to load the calendar.');
    } finally {
      setCalendarLoading(false);
    }
  }, [monthKey]);

  useEffect(() => {
    if (view === 'calendar') loadCalendarMonth();
  }, [view, loadCalendarMonth, calendarRefreshSignal]);

  const { start: monthStart, end: monthEnd } = monthBounds(monthKey);

  const mergedByDate = useMemo(
    () => mergeCalendarDay(monthStart, monthEnd, calendarLeave, calendarAbsentees, calendarHalfDays),
    [monthStart, monthEnd, calendarLeave, calendarAbsentees, calendarHalfDays]
  );

  const filteredDayMap = useMemo(() => {
    const q = calendarSearch.trim().toLowerCase();
    const out = new Map<string, CalendarDayEntry[]>();
    for (const [date, byEmployee] of mergedByDate) {
      const entries = Array.from(byEmployee.values()).filter((e) => {
        if (calendarDepartment && e.department !== calendarDepartment) return false;
        if (q && !e.employeeName.toLowerCase().includes(q) && !e.employeeCode.toLowerCase().includes(q)) return false;
        return true;
      });
      if (entries.length > 0) out.set(date, entries);
    }
    return out;
  }, [mergedByDate, calendarDepartment, calendarSearch]);

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

  // Used by the calendar's day drawer "View full record" action — jumps
  // to the Table view's History tab, pre-filtered to that one employee,
  // since there's no separate per-employee profile page in this app (see
  // brief section 1.4's note to reuse existing row-click behavior).
  function viewEmployeeInHistory(id: string) {
    setEmployeeId(id);
    setView('table');
    setTab('history');
  }

  const historyHasActiveFilters = !!(startDate || endDate || employeeId || leaveTypeCode);

  const TABS: { key: Tab; label: string }[] = [
    { key: 'absentees', label: 'Absentees' },
    { key: 'half_days', label: 'Half Days' },
    { key: 'history', label: 'Leave History' },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <a href="/leave/admin" className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">← Back to balances</a>
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
          {!(view === 'table' && tab === 'history') && (
            <p className="text-[11px] text-[var(--text-muted)] mt-1 max-w-[220px]">
              For any employee. To act on a row already listed below, use that row&apos;s own action instead.
            </p>
          )}
        </div>
      </div>

      {employeesError && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
          {employeesError}
        </div>
      )}

      {/* Calendar / Table view toggle */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        <button
          type="button"
          onClick={() => setView('calendar')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            view === 'calendar' ? 'border-emerald-500 text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          Calendar
        </button>
        <button
          type="button"
          onClick={() => setView('table')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            view === 'table' ? 'border-emerald-500 text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          Table view
        </button>
      </div>

      {view === 'calendar' && (
        <>
          <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Department (team)</label>
                <select
                  value={calendarDepartment}
                  onChange={(e) => setCalendarDepartment(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                >
                  <option value="">All departments</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs text-[var(--text-muted)] mb-1">Employee search</label>
                <input
                  type="text"
                  value={calendarSearch}
                  onChange={(e) => setCalendarSearch(e.target.value)}
                  placeholder="Search by name or employee code to narrow to one person's month…"
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                />
              </div>
            </div>
          </div>

          {calendarError && (
            <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
              {calendarError}
            </div>
          )}

          {calendarLoading ? (
            <AttendanceTableSkeleton columns={7} rows={5} />
          ) : filteredDayMap.size === 0 && (calendarDepartment || calendarSearch) ? (
            <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl px-4 py-10 text-center text-[var(--text-muted)] text-sm">
              No leave, half-day, or unrecorded-absence activity this month matching your filters.
            </div>
          ) : (
            <LeaveCalendar
              monthKey={monthKey}
              onMonthChange={setMonthKey}
              dayMap={filteredDayMap}
              holidaysByDate={calendarHolidays}
              onDayClick={setOpenDay}
            />
          )}

          {openDay && (
            <CalendarDayDrawer
              date={openDay}
              entries={filteredDayMap.get(openDay) ?? []}
              onClose={() => setOpenDay(null)}
              onResolved={() => {
                setOpenDay(null);
                setCalendarRefreshSignal((s) => s + 1);
              }}
              onViewInHistory={viewEmployeeInHistory}
            />
          )}
        </>
      )}

      {view === 'table' && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 border-b border-[var(--border)]">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t.key
                    ? 'border-emerald-500 text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Shared Department/Office filter, used by all three tabs */}
          <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Department</label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                >
                  <option value="">All</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Office</label>
                <select
                  value={office}
                  onChange={(e) => setOffice(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
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
                    <label className="block text-xs text-[var(--text-muted)] mb-1">From Date</label>
                    <input
                      type="date"
                      value={attendanceDate}
                      onChange={(e) => setAttendanceDate(e.target.value)}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">To Date</label>
                    <input
                      type="date"
                      value={attendanceEndDate}
                      min={attendanceDate || undefined}
                      onChange={(e) => setAttendanceEndDate(e.target.value)}
                      placeholder="Same as From Date"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                    />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-2">
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Employee Search</label>
                    <input
                      type="text"
                      value={attendanceSearch}
                      onChange={(e) => setAttendanceSearch(e.target.value)}
                      placeholder="Search by name or employee code…"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                    />
                  </div>
                  {attendanceEndDate && attendanceEndDate !== attendanceDate && (
                    <div className="sm:col-span-2 lg:col-span-6 -mt-1">
                      <button
                        type="button"
                        onClick={() => setAttendanceEndDate('')}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        ✕ Clear &quot;To Date&quot; (back to a single day)
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Start Date</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">End Date</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Employee</label>
                    <select
                      value={employeeId}
                      onChange={(e) => setEmployeeId(e.target.value)}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
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
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Leave Type</label>
                    <select
                      value={leaveTypeCode}
                      onChange={(e) => setLeaveTypeCode(e.target.value)}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
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
                  <button type="button" onClick={handleClearHistoryFilters} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                    Clear filters
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleExportCSV}
                  disabled={rows.length === 0}
                  className="ml-auto border border-[var(--border)] hover:border-[var(--border)] disabled:opacity-40 text-[var(--text-primary)] text-sm font-medium px-4 py-2 rounded-lg transition-colors"
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
                <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              {loading ? (
                <AttendanceTableSkeleton columns={7} />
              ) : (
                <>
                  <p className="text-xs text-[var(--text-muted)]">{rows.length} record(s)</p>
                  <LeaveHistoryTable rows={department || office ? rows.filter((r) => (!department || r.department === department) && (!office || r.office === office)) : rows} />
                </>
              )}
            </>
          )}
        </>
      )}

      {recordLeaveOpen && (
        <RecordLeaveDrawer
          onClose={() => setRecordLeaveOpen(false)}
          onSuccess={() => {
            setRecordLeaveOpen(false);
            if (view === 'table' && tab === 'history') fetchHistory();
            if (view === 'calendar') setCalendarRefreshSignal((s) => s + 1);
          }}
        />
      )}
    </div>
  );
}
