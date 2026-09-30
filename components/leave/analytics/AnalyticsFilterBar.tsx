'use client';

import { useEffect, useState } from 'react';
import { Filter, RotateCcw } from 'lucide-react';
import { formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';
import { AnalyticsFilterState } from './types';

interface AnalyticsFilterBarProps {
  filters: AnalyticsFilterState;
  onChange: (filters: AnalyticsFilterState) => void;
  availableYears?: number[];
}

export default function AnalyticsFilterBar({
  filters,
  onChange,
  availableYears = [2026, 2025, 2024],
}: AnalyticsFilterBarProps) {
  const [departments, setDepartments] = useState<string[]>([]);
  const [offices, setOffices] = useState<Array<{ code: string; name: string }>>([
    { code: 'MUM', name: 'Mumbai' },
    { code: 'HYD', name: 'Hyderabad' },
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadMeta() {
      try {
        const [deptRes, offRes] = await Promise.all([
          fetch('/api/leave/departments'),
          fetch('/api/leave/offices'),
        ]);

        if (!cancelled && deptRes.ok) {
          const dData = await deptRes.json();
          if (Array.isArray(dData.departments)) {
            const names = dData.departments.map((d: any) => d.department).filter(Boolean);
            setDepartments(Array.from(new Set(names)) as string[]);
          }
        }

        if (!cancelled && offRes.ok) {
          const oData = await offRes.json();
          if (Array.isArray(oData.offices) && oData.offices.length > 0) {
            setOffices(oData.offices);
          }
        }
      } catch (err) {
        console.warn('Could not load filter metadata:', err);
      }
    }

    loadMeta();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleReset() {
    onChange({
      fyStartYear: availableYears[0] || 2026,
      department: 'all',
      office: 'all',
      leaveType: 'all',
      status: 'approved',
    });
  }

  const isFiltered =
    filters.department !== 'all' ||
    filters.office !== 'all' ||
    filters.leaveType !== 'all' ||
    filters.status !== 'approved';

  return (
    <div className="sticky top-0 z-20 mb-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]/90 p-3.5 backdrop-blur-md shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] mr-1">
            <Filter size={14} className="text-[var(--accent)]" />
            <span>Filters:</span>
          </div>

          {/* FY Selector */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="fy-selector" className="text-xs text-[var(--text-muted)] font-medium">
              Cycle:
            </label>
            <select
              id="fy-selector"
              value={filters.fyStartYear}
              onChange={(e) => onChange({ ...filters, fyStartYear: Number(e.target.value) })}
              className="h-8 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 text-xs font-semibold text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none transition-colors"
            >
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  {formatFYLabel(yr)}
                </option>
              ))}
            </select>
          </div>

          {/* Office */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="office-selector" className="text-xs text-[var(--text-muted)] font-medium">
              Office:
            </label>
            <select
              id="office-selector"
              value={filters.office}
              onChange={(e) => onChange({ ...filters, office: e.target.value })}
              className="h-8 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none transition-colors"
            >
              <option value="all">All Offices</option>
              {offices.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name} ({o.code})
                </option>
              ))}
            </select>
          </div>

          {/* Department */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="dept-selector" className="text-xs text-[var(--text-muted)] font-medium">
              Dept:
            </label>
            <select
              id="dept-selector"
              value={filters.department}
              onChange={(e) => onChange({ ...filters, department: e.target.value })}
              className="h-8 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none transition-colors max-w-[140px]"
            >
              <option value="all">All Departments</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          {/* Leave Type */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="type-selector" className="text-xs text-[var(--text-muted)] font-medium">
              Type:
            </label>
            <select
              id="type-selector"
              value={filters.leaveType}
              onChange={(e) => onChange({ ...filters, leaveType: e.target.value })}
              className="h-8 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none transition-colors"
            >
              <option value="all">All Types</option>
              <option value="SL">Sick Leave (SL)</option>
              <option value="CL">Casual Leave (CL)</option>
              <option value="PL">Privilege Leave (PL)</option>
              <option value="LWP">Leave Without Pay (LWP)</option>
            </select>
          </div>

          {/* Status */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="status-selector" className="text-xs text-[var(--text-muted)] font-medium">
              Status:
            </label>
            <select
              id="status-selector"
              value={filters.status}
              onChange={(e) => onChange({ ...filters, status: e.target.value })}
              className="h-8 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none transition-colors"
            >
              <option value="approved">Approved only</option>
              <option value="pending">Pending only</option>
              <option value="auto_lwp">Auto LWP</option>
              <option value="all">All Statuses</option>
            </select>
          </div>
        </div>

        {/* Reset button */}
        {isFiltered && (
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] px-2 py-1.5 rounded-lg transition-colors ml-auto"
            title="Reset filters to default"
          >
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>
        )}
      </div>
    </div>
  );
}
