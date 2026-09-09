'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Square, Users, Building2, Briefcase, Calendar, Clock, AlertCircle, CheckCircle2, X, RefreshCcw } from 'lucide-react';
import { DATE_INPUT_MIN, DATE_INPUT_MAX, sanitizeDateString } from '@/lib/dateFormat';

type EmployeeOption = {
  id: string;
  full_name: string;
  employee_code: string;
  department: string;
  office: string;
};

type Target = 'office' | 'department' | 'employees';

interface SkippedStats {
  total: number;
  weekly_off: number;
  holiday: number;
  approved_leave: number;
  existing_punch: number;
}

interface BulkResult {
  success: boolean;
  written: number;
  requested: number;
  employees_affected: number;
  days: number;
  skipped: SkippedStats;
  message: string;
}

export default function BulkMarkAttendanceModal({ onClose }: { onClose: () => void }) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeesError, setEmployeesError] = useState<string | null>(null);

  const [target, setTarget] = useState<Target>('department');
  const [selectedOffice, setSelectedOffice] = useState('');
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [employeeSearch, setEmployeeSearch] = useState('');

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [status, setStatus] = useState<'Present' | 'Absent'>('Present');
  const [dayType, setDayType] = useState<'full' | 'half'>('full');
  const [halfSession, setHalfSession] = useState<'first_half' | 'second_half'>('first_half');
  // Off by default so a routine bulk-mark never clobbers real biometric
  // data — HR has to consciously opt in when they specifically want to
  // replace whatever's already there (e.g. correcting bad/stale rows,
  // like an old "Absent" row with a phantom punch_count that would
  // otherwise silently block this action from ever fixing it).
  const [overwriteExisting, setOverwriteExisting] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  // Load employees list on mount
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/leave/employees');
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) {
          setEmployeesError(data.error || `Could not load employees (${res.status}).`);
          return;
        }
        const emps: EmployeeOption[] = data.employees ?? [];
        setEmployees(emps);
      } catch {
        setEmployeesError('Could not reach the server to load employees.');
      }
    }
    load();
  }, []);

  const offices = useMemo(
    () => Array.from(new Set(employees.map((e) => e.office).filter(Boolean))).sort(),
    [employees]
  );

  const departments = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))).sort(),
    [employees]
  );

  // Set default office & dept once loaded
  useEffect(() => {
    if (departments.length > 0 && !selectedDept) {
      setSelectedDept(departments[0]);
    }
    if (offices.length > 0 && !selectedOffice) {
      setSelectedOffice(offices[0]);
    }
  }, [departments, offices, selectedDept, selectedOffice]);

  // When target changes or selectedDept/selectedOffice changes, manage pre-checked list
  useEffect(() => {
    if (target === 'department' && selectedDept) {
      const deptEmployees = employees.filter((e) => e.department === selectedDept);
      setSelectedEmployeeIds(new Set(deptEmployees.map((e) => e.id)));
    } else if (target === 'office' && selectedOffice) {
      const officeEmployees = employees.filter((e) => e.office === selectedOffice);
      setSelectedEmployeeIds(new Set(officeEmployees.map((e) => e.id)));
    } else if (target === 'employees') {
      // Keep existing manual selection or clear
    }
  }, [target, selectedDept, selectedOffice, employees]);

  // Employees visible in the current checklist view
  const currentChecklistEmployees = useMemo(() => {
    if (target === 'department') {
      return employees.filter((e) => e.department === selectedDept);
    }
    if (target === 'office') {
      return employees.filter((e) => e.office === selectedOffice);
    }
    if (target === 'employees') {
      const term = employeeSearch.toLowerCase().trim();
      if (!term) return employees;
      return employees.filter(
        (e) =>
          e.full_name.toLowerCase().includes(term) ||
          e.employee_code.toLowerCase().includes(term) ||
          e.department.toLowerCase().includes(term) ||
          e.office.toLowerCase().includes(term)
      );
    }
    return [];
  }, [target, selectedDept, selectedOffice, employees, employeeSearch]);

  function toggleEmployee(id: string) {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllCurrent() {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev);
      currentChecklistEmployees.forEach((e) => next.add(e.id));
      return next;
    });
  }

  function deselectAllCurrent() {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev);
      currentChecklistEmployees.forEach((e) => next.delete(e.id));
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!startDate || !endDate) {
      setError('Start and end dates are required.');
      return;
    }
    if (endDate < startDate) {
      setError('End date cannot be before start date.');
      return;
    }
    if (selectedEmployeeIds.size === 0) {
      setError('Please ensure at least one employee is selected.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/leave/bulk-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_ids: Array.from(selectedEmployeeIds),
          start_date: startDate,
          end_date: endDate,
          status,
          day_type: status === 'Present' ? dayType : undefined,
          half_day_session: status === 'Present' && dayType === 'half' ? halfSession : undefined,
          overwrite_existing_punch: overwriteExisting,
        }),
      });

      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setError(data.error || `Something went wrong (${res.status}).`);
        return;
      }
      setResult(data);
    } catch {
      setError('Could not reach the server — check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="scroll-thin bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[var(--border)] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
                <Calendar className="w-5 h-5" />
              </span>
              <h3 className="text-[var(--text-primary)] font-semibold text-base">Bulk Mark Attendance</h3>
            </div>
            <p className="text-[var(--text-muted)] text-xs mt-1">
              Mark attendance for multiple employees over a date range. Weekends, holidays, approved leaves, and existing biometric records are automatically skipped.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Errors & Result Banners */}
        {employeesError && (
          <div className="flex items-center gap-2 bg-red-900/20 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-xl p-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{employeesError}</span>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 bg-red-900/20 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-xl p-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {result && (
          <div className="bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-emerald-300 text-sm">
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
              <span>Bulk Attendance Applied</span>
            </div>
            <p className="text-emerald-200/90 leading-relaxed">{result.message}</p>
            {result.skipped.total > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-emerald-500/20 text-[11px]">
                <div className="bg-black/20 p-2 rounded-lg">
                  <div className="text-emerald-400 font-bold">{result.skipped.weekly_off}</div>
                  <div className="text-emerald-200/70">Weekly-offs</div>
                </div>
                <div className="bg-black/20 p-2 rounded-lg">
                  <div className="text-emerald-400 font-bold">{result.skipped.holiday}</div>
                  <div className="text-emerald-200/70">Holidays</div>
                </div>
                <div className="bg-black/20 p-2 rounded-lg">
                  <div className="text-emerald-400 font-bold">{result.skipped.approved_leave}</div>
                  <div className="text-emerald-200/70">Approved Leaves</div>
                </div>
                <div className="bg-black/20 p-2 rounded-lg">
                  <div className="text-emerald-400 font-bold">{result.skipped.existing_punch}</div>
                  <div className="text-emerald-200/70">Existing Punches</div>
                </div>
              </div>
            )}
            {!overwriteExisting && result.skipped.existing_punch > 0 && (
              <p className="text-emerald-200/70 pt-1">
                {result.skipped.existing_punch} date(s) already had an attendance row and were left untouched. If any of those look wrong (e.g. a stale "Absent" row), re-run with "Overwrite existing records" checked below.
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Target selection */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider">
              1. Apply To
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTarget('department')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                  target === 'department'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Briefcase className="w-4 h-4" />
                <span>Department</span>
              </button>
              <button
                type="button"
                onClick={() => setTarget('office')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                  target === 'office'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Building2 className="w-4 h-4" />
                <span>Office</span>
              </button>
              <button
                type="button"
                onClick={() => setTarget('employees')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                  target === 'employees'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Specific</span>
              </button>
            </div>

            {/* Department dropdown */}
            {target === 'department' && (
              <div className="space-y-2">
                <label className="block text-xs text-[var(--text-muted)]">Select Department</label>
                <select
                  value={selectedDept}
                  onChange={(e) => setSelectedDept(e.target.value)}
                  className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
                >
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d} ({employees.filter((e) => e.department === d).length} employees)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Office dropdown */}
            {target === 'office' && (
              <div className="space-y-2">
                <label className="block text-xs text-[var(--text-muted)]">Select Office</label>
                <select
                  value={selectedOffice}
                  onChange={(e) => setSelectedOffice(e.target.value)}
                  className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
                >
                  {offices.map((o) => (
                    <option key={o} value={o}>
                      {o} ({employees.filter((e) => e.office === o).length} employees)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Specific search box */}
            {target === 'employees' && (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Search employees by name, code, or department…"
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
                />
              </div>
            )}

            {/* Checklist of employees */}
            <div className="border border-[var(--border)] rounded-xl bg-[var(--bg-elevated)]/30 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-elevated)]/60 text-xs">
                <span className="text-[var(--text-muted)] font-medium">
                  {selectedEmployeeIds.size} of {currentChecklistEmployees.length} selected
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={selectAllCurrent}
                    className="text-emerald-600 dark:text-emerald-400 hover:underline text-xs"
                  >
                    Select all
                  </button>
                  <span className="text-[var(--border)]">|</span>
                  <button
                    type="button"
                    onClick={deselectAllCurrent}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:underline text-xs"
                  >
                    Deselect all
                  </button>
                </div>
              </div>

              <div className="scroll-thin max-h-44 overflow-y-auto divide-y divide-[var(--border)]/50">
                {currentChecklistEmployees.map((e) => {
                  const isChecked = selectedEmployeeIds.has(e.id);
                  return (
                    <label
                      key={e.id}
                      className={`flex items-center gap-3 px-3 py-2 text-xs cursor-pointer select-none transition-colors ${
                        isChecked ? 'bg-emerald-500/5' : 'hover:bg-[var(--bg-elevated)]/80'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleEmployee(e.id)}
                        className="sr-only"
                      />
                      {isChecked ? (
                        <CheckSquare className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                      )}
                      <div className="flex items-center justify-between w-full">
                        <span className="font-medium text-[var(--text-primary)]">{e.full_name}</span>
                        <span className="text-[var(--text-muted)] text-[11px]">
                          {e.employee_code} · {e.department} ({e.office})
                        </span>
                      </div>
                    </label>
                  );
                })}
                {currentChecklistEmployees.length === 0 && (
                  <p className="px-3 py-4 text-center text-[var(--text-muted)] text-xs">
                    No employees match the current selection.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Date Range */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider">
              2. Date Range
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  min={DATE_INPUT_MIN}
                  max={DATE_INPUT_MAX}
                  onChange={(e) => setStartDate(sanitizeDateString(e.target.value))}
                  className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
                  required
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
                  className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>
            </div>
          </div>

          {/* Status & Timing Selection */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider">
              3. Attendance Status
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  status === 'Present'
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-[var(--border)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated)]/80'
                }`}
              >
                <input
                  type="radio"
                  name="status"
                  value="Present"
                  checked={status === 'Present'}
                  onChange={() => setStatus('Present')}
                  className="text-emerald-500 focus:ring-emerald-500"
                />
                <div>
                  <div className="text-xs font-semibold text-[var(--text-primary)]">Present</div>
                  <div className="text-[11px] text-[var(--text-muted)]">Full or Half day shift</div>
                </div>
              </label>

              <label
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  status === 'Absent'
                    ? 'border-rose-500 bg-rose-500/10'
                    : 'border-[var(--border)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated)]/80'
                }`}
              >
                <input
                  type="radio"
                  name="status"
                  value="Absent"
                  checked={status === 'Absent'}
                  onChange={() => setStatus('Absent')}
                  className="text-rose-500 focus:ring-rose-500"
                />
                <div>
                  <div className="text-xs font-semibold text-[var(--text-primary)]">Absent</div>
                  <div className="text-[11px] text-[var(--text-muted)]">Mark as absent (no timing)</div>
                </div>
              </label>
            </div>

            {/* Present Options: Full Day vs Half Day */}
            {status === 'Present' && (
              <div className="p-3 bg-[var(--bg-elevated)]/50 border border-[var(--border)] rounded-xl space-y-3">
                <div className="flex items-center gap-4 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="dayType"
                      checked={dayType === 'full'}
                      onChange={() => setDayType('full')}
                      className="text-emerald-500 focus:ring-emerald-500"
                    />
                    <span className="text-[var(--text-primary)] font-medium">Full Day</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="dayType"
                      checked={dayType === 'half'}
                      onChange={() => setDayType('half')}
                      className="text-emerald-500 focus:ring-emerald-500"
                    />
                    <span className="text-[var(--text-primary)] font-medium">Half Day</span>
                  </label>
                </div>

                {dayType === 'full' ? (
                  <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] bg-[var(--bg-surface)] p-2 rounded-lg border border-[var(--border)]">
                    <Clock className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>In Time: <strong className="text-[var(--text-primary)]">09:30</strong> &nbsp;|&nbsp; Out Time: <strong className="text-[var(--text-primary)]">18:30</strong> (Duration: 9h)</span>
                  </div>
                ) : (
                  <div className="space-y-2 pt-1">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <label
                        className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
                          halfSession === 'first_half'
                            ? 'border-emerald-500 bg-emerald-500/10'
                            : 'border-[var(--border)] bg-[var(--bg-surface)]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="halfSession"
                          checked={halfSession === 'first_half'}
                          onChange={() => setHalfSession('first_half')}
                          className="mt-0.5 text-emerald-500 focus:ring-emerald-500"
                        />
                        <div>
                          <div className="font-medium text-[var(--text-primary)]">First Half</div>
                          <div className="text-[11px] text-[var(--text-muted)]">09:30 – 13:00 (3h 30m)</div>
                        </div>
                      </label>
                      <label
                        className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
                          halfSession === 'second_half'
                            ? 'border-emerald-500 bg-emerald-500/10'
                            : 'border-[var(--border)] bg-[var(--bg-surface)]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="halfSession"
                          checked={halfSession === 'second_half'}
                          onChange={() => setHalfSession('second_half')}
                          className="mt-0.5 text-emerald-500 focus:ring-emerald-500"
                        />
                        <div>
                          <div className="font-medium text-[var(--text-primary)]">Second Half</div>
                          <div className="text-[11px] text-[var(--text-muted)]">14:00 – 18:30 (4h 30m)</div>
                        </div>
                      </label>
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Half days are stored with <code className="text-emerald-400">is_short_day: true</code> so downstream KPI calculations treat them accurately.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Overwrite existing records */}
            <label
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                overwriteExisting
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-[var(--border)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated)]/80'
              }`}
            >
              <input
                type="checkbox"
                checked={overwriteExisting}
                onChange={(e) => setOverwriteExisting(e.target.checked)}
                className="mt-0.5 text-amber-500 focus:ring-amber-500"
              />
              <div className="flex items-start gap-2">
                <RefreshCcw className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-[var(--text-primary)]">Overwrite existing records</div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    By default, a date that already has an attendance row (biometric or otherwise) is left alone. Check this to replace it — use this when correcting bad or stale data, not for routine marking.
                  </div>
                </div>
              </div>
            </label>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={loading || selectedEmployeeIds.size === 0 || !startDate || !endDate}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold px-5 py-2.5 rounded-lg shadow-sm transition-all flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Marking Attendance…</span>
                </>
              ) : (
                <span>Mark Attendance ({selectedEmployeeIds.size} employees)</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
