'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, Users, X } from 'lucide-react';
import EmployeeCard, { EmployeeWithBalances } from './EmployeeCard';
import { useDebounce } from '@/lib/useDebounce';

const PAGE_SIZE_OPTIONS = [9, 18, 30, 60] as const;
const DEFAULT_PAGE_SIZE = 30;

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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const debouncedSearch = useDebounce(search, 200);

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
      // Non-critical — badge stays hidden if failed
    }
  }, []);

  useEffect(() => {
    loadViolationCounts();
  }, [loadViolationCounts]);

  const departments = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department))).sort(),
    [employees]
  );
  const offices = useMemo(
    () => Array.from(new Set(employees.map((e) => e.office))).sort(),
    [employees]
  );

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return employees.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q) && !e.code.toLowerCase().includes(q)) return false;
      if (department && e.department !== department) return false;
      if (office && e.office !== office) return false;
      if (status && e.employmentStatus !== status) return false;
      return true;
    });
  }, [employees, debouncedSearch, department, office, status]);

  const hasActiveFilters = !!(search || department || office || status);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, department, office, status, pageSize]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="space-y-5">
      {/* ── Executive Filter Bar ──────────────────────────────────── */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search box with icon */}
          <div className="relative flex-1 min-w-[240px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by employee name or ID…"
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl pl-9 pr-8 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] transition-all"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Department Filter */}
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm font-medium text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] transition-all"
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          {/* Office Filter */}
          <select
            value={office}
            onChange={(e) => setOffice(e.target.value)}
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm font-medium text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] transition-all"
          >
            <option value="">All Offices</option>
            {offices.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm font-medium text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] transition-all"
          >
            <option value="">All Statuses</option>
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
              className="text-xs font-semibold text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors px-2 py-1"
            >
              Reset All
            </button>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-[var(--text-muted)] pt-1 border-t border-[var(--border-subtle)]">
          <span className="flex items-center gap-1.5 font-medium">
            <SlidersHorizontal size={12} />
            Showing <strong className="text-[var(--text-primary)]">{filtered.length}</strong> of {employees.length} employees
          </span>
          {hasActiveFilters && (
            <span className="text-[11px] text-[var(--accent)] font-medium">Filters applied</span>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-12 text-center text-[var(--text-muted)] shadow-sm">
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)]">
              <Users size={24} />
            </div>
          </div>
          <p className="text-base font-semibold text-[var(--text-primary)]">No employees found</p>
          <p className="text-xs text-[var(--text-muted)] max-w-sm mx-auto mt-1">
            {employees.length === 0
              ? "Employees will appear here automatically after the next biometric CSV upload."
              : "No employees match your current filter criteria. Try resetting the filters."}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setDepartment('');
                setOffice('');
                setStatus('');
              }}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--accent)]/40 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((e) => (
              <EmployeeCard
                key={e.id}
                employee={e}
                fyStartYear={fyStartYear}
                violationCount={violationCounts[e.id]}
              />
            ))}
          </div>

          {/* ── Pagination Bar ────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 flex-wrap bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span className="font-medium">Cards per page:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)] focus:outline-none"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
              <span className="font-medium">
                {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  aria-label="Previous page"
                  className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={15} />
                </button>
                <span className="text-[var(--text-primary)] font-semibold px-2 py-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border)]">
                  {currentPage} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={currentPage === pageCount}
                  aria-label="Next page"
                  className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}