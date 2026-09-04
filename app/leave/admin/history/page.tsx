'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CalendarDays, Download, SlidersHorizontal, Table2 } from 'lucide-react';
import LeaveHistoryTable, { LeaveHistoryRow } from '@/components/leave/LeaveHistoryTable';
import AbsenteesPanel from '@/components/leave/AbsenteesPanel';
import HalfDayPanel from '@/components/leave/HalfDayPanel';
import RecordLeaveDrawer from '@/components/leave/RecordLeaveDrawer';
import LeaveCalendar from '@/components/leave/LeaveCalendar';
import CalendarDayDrawer from '@/components/leave/CalendarDayDrawer';
import { exportRowsAsCSV } from '@/lib/exportData';
import AttendanceTableSkeleton from '@/components/leave/AttendanceTableSkeleton';
import LeavePageHeader from '@/components/leave/LeavePageHeader';
import type { AbsenteeCandidate, HalfDayCandidate } from '@/lib/attendanceExceptions';
import { currentMonthKey, mergeCalendarDay, monthBounds } from '@/lib/leaveCalendar';
import type { CalendarDayEntry } from '@/lib/leaveCalendar';
import { useDebounce } from '@/lib/useDebounce';
import { DATE_INPUT_MIN, DATE_INPUT_MAX, sanitizeDateString } from '@/lib/dateFormat';

type EmployeeOption = { id: string; full_name: string; employee_code: string; department: string; office: string };

const LEAVE_TYPES = [
  { code: 'SL', label: 'Sick Leave' },
  { code: 'CL', label: 'Casual Leave' },
  { code: 'PL', label: 'Planned Leave' },
  { code: 'LWP', label: 'Leave Without Pay' },
];

type View = 'calendar' | 'table';
type Tab = 'absentees' | 'half_days' | 'history';

// Absentees/Half Day default date window. Leaving both dates empty used
// to mean "scan the entire uploaded attendance history" — for any
// company with more than a couple months of biometric data, that's
// hundreds or thousands of rows fetched (paginated 1000 at a time, per
// table, sequentially — see selectAllRows in lib/attendanceExceptions.ts)
// EVERY time this page loads, by default, before anyone has touched a
// filter. That's what "have to choose dates to get data" was actually
// describing — not a bug in any one query, just an unbounded default.
// Defaulting to a 60-day window keeps the common case fast; "View full
// history" below is still available as an explicit, opt-in action for
// the rarer case of digging into older backlog.
const DEFAULT_ATTENDANCE_WINDOW_DAYS = 60;
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function defaultAttendanceFromDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - DEFAULT_ATTENDANCE_WINDOW_DAYS);
  return isoDate(d);
}
function defaultAttendanceToDate(): string {
  return isoDate(new Date());
}

// Small shared alert banner — used for every error state on this page
// (employees load failure, calendar load failure, history load
// failure). Pulled out so all three read as "the same kind of thing"
// instead of three separately-styled red boxes.
function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-300 text-xs rounded-xl px-4 py-3">
      <AlertCircle size={14} className="shrink-0 mt-0.5" />
      <span className="leading-relaxed">{children}</span>
    </div>
  );
}

// Section label used above every filter card, so "these controls narrow
// what you're looking at" reads the same way in both Calendar and Table
// view instead of the filter row just appearing with no framing.
function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <SlidersHorizontal size={13} className="text-[var(--text-muted)]" />
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{children}</h3>
    </div>
  );
}

// Leave Tracker. The month calendar (below) is now the primary view —
// see the Leave Tracker Calendar brief. The original Absentees / Half
// Days / Leave History tabs are preserved as-is, reachable via the
// "Table view" toggle, since HR still needs the flat table for bulk
// actions/export (exportRowsAsCSV stays wired to History exactly as
// before). "Team" in the original ask maps to Department here — see
// lib/attendanceExceptions.ts's header comment for why there's no
// separate team table.
//
// UI pass: Calendar/Table is a MODE switch (which whole view you're in),
// while Absentees/Half Days/History is a TAB switch (which slice of
// Table view you're in) — those are two different levels of hierarchy,
// so they now use two different controls (segmented pill vs. underline
// tabs) instead of looking identical and forcing the user to infer the
// relationship. Filter cards are solid instead of translucent so they
// don't blend into the page background, and the 6-column filter grid is
// now capped at 4 columns so labels + selects stay legible instead of
// being squeezed.
export default function LeaveTrackerPage() {
  const [view, setView] = useState<View>('calendar');
  const [tab, setTab] = useState<Tab>('absentees');

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeesError, setEmployeesError] = useState<string | null>(null);

  // Shared across all three table-view tabs.
  const [department, setDepartment] = useState('');
  const [office, setOffice] = useState('');
  const [attendanceSearch, setAttendanceSearch] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(() => defaultAttendanceFromDate());
  const [attendanceEndDate, setAttendanceEndDate] = useState(() => defaultAttendanceToDate());

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeCode, setLeaveTypeCode] = useState('');

  const [rows, setRows] = useState<LeaveHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [recordLeaveOpen, setRecordLeaveOpen] = useState(false);
  // HR Admin (hr_super_admin) is remind-only — recording leave is a
  // plain-HR action (see the matching 403 in
  // app/api/leave/employees/requests/route.ts). This page is a client
  // component top-to-bottom, so it can't receive role as a
  // server-rendered prop the way most other /leave/** pages do; fetched
  // once here via the small /api/leave/me endpoint instead. Defaults to
  // false (button hidden) until the fetch resolves, rather than
  // flashing the button on for HR Admin for a moment.
  const [canRecordLeave, setCanRecordLeave] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/leave/me')
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setCanRecordLeave(body?.employee?.role === 'hr');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Guards against the same class of race the Absentees/Half Day panels
  // had: an older, slower request landing after a newer one and silently
  // overwriting fresher data with stale rows.
  const historyRequestIdRef = useRef(0);
  const calendarRequestIdRef = useRef(0);

  async function fetchHistory() {
    const myRequestId = ++historyRequestIdRef.current;
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
      if (myRequestId !== historyRequestIdRef.current) return;
      if (!res.ok) {
        setError(data.error || `Could not load leave history (${res.status}).`);
        setRows([]);
        return;
      }
      setRows(data.requests ?? []);
    } catch {
      if (myRequestId !== historyRequestIdRef.current) return;
      setError('Could not reach the server — check your connection and retry.');
      setRows([]);
    } finally {
      if (myRequestId === historyRequestIdRef.current) setLoading(false);
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
    const myRequestId = ++calendarRequestIdRef.current;
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

      if (myRequestId !== calendarRequestIdRef.current) return;
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
      if (myRequestId !== calendarRequestIdRef.current) return;
      setCalendarError(err instanceof Error ? err.message : 'Could not reach the server to load the calendar.');
    } finally {
      if (myRequestId === calendarRequestIdRef.current) setCalendarLoading(false);
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

  const debouncedCalendarSearch = useDebounce(calendarSearch, 200);

  const filteredDayMap = useMemo(() => {
    const q = debouncedCalendarSearch.trim().toLowerCase();
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
  }, [mergedByDate, calendarDepartment, debouncedCalendarSearch]);

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
    <div className="space-y-6">
      <LeavePageHeader
        title="Leave Tracker"
        actions={
          canRecordLeave ? (
            <div className="text-right">
              <button
                type="button"
                onClick={() => setRecordLeaveOpen(true)}
                className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                + Record Leave
              </button>
              {!(view === 'table' && tab === 'history') && (
                <p className="text-[11px] text-[var(--text-muted)] mt-1 max-w-[220px]">
                  For any employee. To act on a row already listed below, use that row&apos;s own action instead.
                </p>
              )}
            </div>
          ) : undefined
        }
      />

      {employeesError && <Banner>{employeesError}</Banner>}

      {/* Calendar / Table — a MODE switch (which whole view you're in).
          Segmented pill control so it reads as a different kind of
          control than the underline tabs below (which are a TAB switch
          one level down, inside Table view only). */}
      <div className="inline-flex items-center gap-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-full p-1">
        <button
          type="button"
          onClick={() => setView('calendar')}
          className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            view === 'calendar'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <CalendarDays size={14} />
          Calendar
        </button>
        <button
          type="button"
          onClick={() => setView('table')}
          className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            view === 'table'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Table2 size={14} />
          Table view
        </button>
      </div>

      {view === 'calendar' && (
        <>
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl p-4">
            <FilterLabel>Narrow the month</FilterLabel>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              <div className="sm:col-span-2">
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

          {calendarError && <Banner>{calendarError}</Banner>}

          {calendarLoading ? (
            <AttendanceTableSkeleton columns={7} rows={5} />
          ) : filteredDayMap.size === 0 && (calendarDepartment || calendarSearch) ? (
            <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-4 py-10 text-center text-[var(--text-muted)] text-sm">
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
              canRecordLeave={canRecordLeave}
            />
          )}
        </>
      )}

      {view === 'table' && (
        <>
          {/* Tabs — a slice switch WITHIN Table view, so it stays the
              familiar underline style, one level below the pill toggle
              above. */}
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
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl p-4 space-y-4">
            <FilterLabel>Filters</FilterLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                      min={DATE_INPUT_MIN}
                      max={DATE_INPUT_MAX}
                      onChange={(e) => setAttendanceDate(sanitizeDateString(e.target.value))}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">To Date</label>
                    <input
                      type="date"
                      value={attendanceEndDate}
                      min={attendanceDate || DATE_INPUT_MIN}
                      max={DATE_INPUT_MAX}
                      onChange={(e) => setAttendanceEndDate(sanitizeDateString(e.target.value))}
                      placeholder="Same as From Date"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                    />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-4">
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
                    <div className="sm:col-span-2 lg:col-span-4 -mt-2">
                      <button
                        type="button"
                        onClick={() => setAttendanceEndDate('')}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        ✕ Clear &quot;To Date&quot; (back to a single day)
                      </button>
                    </div>
                  )}
                  <div className="sm:col-span-2 lg:col-span-4 -mt-2">
                    {attendanceDate || attendanceEndDate ? (
                      <button
                        type="button"
                        onClick={() => {
                          setAttendanceDate('');
                          setAttendanceEndDate('');
                        }}
                        title="Scans every day since your first uploaded attendance record — can take noticeably longer to load than the default 60-day window"
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        View full history (may take longer to load)
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setAttendanceDate(defaultAttendanceFromDate());
                          setAttendanceEndDate(defaultAttendanceToDate());
                        }}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        ← Back to last {DEFAULT_ATTENDANCE_WINDOW_DAYS} days
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Start Date</label>
                    <input
                      type="date"
                      value={startDate}
                      min={DATE_INPUT_MIN}
                      max={DATE_INPUT_MAX}
                      onChange={(e) => setStartDate(sanitizeDateString(e.target.value))}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">End Date</label>
                    <input
                      type="date"
                      value={endDate}
                      min={startDate || DATE_INPUT_MIN}
                      max={DATE_INPUT_MAX}
                      onChange={(e) => setEndDate(sanitizeDateString(e.target.value))}
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
              <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-[var(--border)]">
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
                  className="ml-auto inline-flex items-center gap-1.5 border border-[var(--border)] hover:border-[var(--text-muted)] disabled:opacity-40 disabled:hover:border-[var(--border)] text-[var(--text-primary)] text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  <Download size={14} />
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
              {error && <Banner>{error}</Banner>}
              {loading ? (
                <AttendanceTableSkeleton columns={7} />
              ) : (
                <LeaveHistoryTable
                  rows={department || office ? rows.filter((r) => (!department || r.department === department) && (!office || r.office === office)) : rows}
                  hrCorrection
                  allowHrCancel
                  onChanged={fetchHistory}
                />
              )}
            </>
          )}
        </>
      )}

      {recordLeaveOpen && canRecordLeave && (
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