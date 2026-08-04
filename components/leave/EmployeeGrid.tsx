'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import EmployeeCard, { EmployeeWithBalances } from './EmployeeCard';

const STATUS_OPTIONS = [
  { value: 'probation', label: 'Probation' },
  { value: 'active', label: 'Active' },
  { value: 'notice_period', label: 'Notice period' },
  { value: 'exited', label: 'Exited' },
];

// Record Leave / View Profile no longer live here — leave recording and
// leave/attendance history are exclusively on the Leave Tracker page
// (/leave/admin/history: Absentees / Half Days / Leave History tabs).
// This grid is now purely a searchable, read-only balances/info view +
// Adjust (status/role/hierarchy), matching "no Record Leave button, no
// View Profile button" on the employee card.
export default function EmployeeGrid({
  employees,
  fyStartYear,
}: {
  employees: EmployeeWithBalances[];
  fyStartYear: number;
}) {
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [office, setOffice] = useState('');
  const [status, setStatus] = useState('');

  // D4: real per-employee violation counts for ViolationBadge.
  const [violationCounts, setViolationCounts] = useState<Record<string, number>>({});

  const loadViolationCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/leave/violations');
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) return;
      const counts: Record<string, number> = {};
      for (const v of data.violations ?? []) {
        counts[v.employeeId] = (counts[v.employeeId] || 0) + 1;
      }
      setViolationCounts(counts);
    } catch {
      // Non-critical — the badge just stays hidden if this fails.
    }
  }, []);

  useEffect(() => {
    loadViolationCounts();
  }, [loadViolationCounts]);

  // Filter options are derived from the data itself (departments/offices
  // are free text on the employees table, not a fixed enum) rather than
  // hardcoded, so a new department/office just works without a code change.
  const departments = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department))).sort(),
    [employees]
  );
  const offices = useMemo(
    () => Array.from(new Set(employees.map((e) => e.office))).sort(),
    [employees]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q) && !e.code.toLowerCase().includes(q)) return false;
      if (department && e.department !== department) return false;
      if (office && e.office !== office) return false;
      if (status && e.employmentStatus !== status) return false;
      return true;
    });
  }, [employees, search, department, office, status]);

  const hasActiveFilters = !!(search || department || office || status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or employee code…"
          className="flex-1 min-w-[220px] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-emerald-500"
        />
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select
          value={office}
          onChange={(e) => setOffice(e.target.value)}
          className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          <option value="">All offices</option>
          {offices.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setDepartment('');
              setOffice('');
              setStatus('');
            }}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Clear filters
          </button>
        )}
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        {filtered.length} of {employees.length} employees
      </p>

      {filtered.length === 0 ? (
        <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl px-4 py-10 text-center text-[var(--text-muted)] text-sm">
          {employees.length === 0 ? (
            <>No employees yet — they'll appear here automatically after the next biometric CSV upload.</>
          ) : (
            <>No employees match your search/filters.</>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((e) => (
            <EmployeeCard
              key={e.id}
              employee={e}
              fyStartYear={fyStartYear}
              violationCount={violationCounts[e.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}