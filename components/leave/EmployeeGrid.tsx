'use client';

import { useMemo, useState } from 'react';
import EmployeeCard, { EmployeeWithBalances } from './EmployeeCard';

const STATUS_OPTIONS = [
  { value: 'probation', label: 'Probation' },
  { value: 'active', label: 'Active' },
  { value: 'notice_period', label: 'Notice period' },
  { value: 'exited', label: 'Exited' },
];

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
          className="flex-1 min-w-[220px] bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
        />
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select
          value={office}
          onChange={(e) => setOffice(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
        >
          <option value="">All offices</option>
          {offices.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
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
            className="text-xs text-slate-400 hover:text-white"
          >
            Clear filters
          </button>
        )}
      </div>

      <p className="text-xs text-slate-500">
        {filtered.length} of {employees.length} employees
      </p>

      {filtered.length === 0 ? (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl px-4 py-10 text-center text-slate-500 text-sm">
          {employees.length === 0 ? (
            <>No employees yet — add one above.</>
          ) : (
            <>No employees match your search/filters.</>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((e) => (
            <EmployeeCard key={e.id} employee={e} fyStartYear={fyStartYear} />
          ))}
        </div>
      )}
    </div>
  );
}