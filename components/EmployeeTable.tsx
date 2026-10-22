'use client';
import { useState, useMemo, memo } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, Search, Zap, AlertTriangle, X, Users } from 'lucide-react';
import { EmployeeSummary } from '@/lib/types';
import { useDebounce } from '@/lib/useDebounce';

interface EmployeeTableProps {
  summaries: EmployeeSummary[];
  onEmployeeClick?: (emp: EmployeeSummary) => void;
  /** Total effective shift minutes (shift duration minus lunch break). Defaults to 480 = 8 h. */
  shiftTargetMins?: number;
  /** Percentage of shift minutes required for On Track status. Defaults to 85. */
  avgHoursPctGreen?: number;
  /** Percentage of shift minutes required for Needs Attention status. Defaults to 75. */
  avgHoursPctAmber?: number;
}

type SortKey = keyof EmployeeSummary;
type SortDir = 'asc' | 'desc';
const PAGE_SIZE = 50;

const STATUS_BADGE: Record<string, string> = {
  green: 'bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  amber: 'bg-amber-500/10 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30',
  red:   'bg-red-500/10 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
};
const STATUS_LABEL: Record<string, string> = { green: 'On Track', amber: 'Needs Attention', red: 'Critical' };

/** Converts a minute count to a compact "Xh Ym" string (e.g. 408 → "6h 48m"). */
function minsToHM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Builds status tooltip copy with actual computed time thresholds. */
function buildTooltip(
  shiftTargetMins: number,
  pctGreen: number,
  pctAmber: number,
): Record<string, { headline: string; detail: string; threshold: string }> {
  const greenMins  = Math.round((pctGreen  / 100) * shiftTargetMins);
  const amberMins  = Math.round((pctAmber  / 100) * shiftTargetMins);
  return {
    green: {
      headline:  `On Track — Avg ≥ ${pctGreen}% of shift hours`,
      detail:    'This employee works at or above the target hours on average.',
      threshold: `≥ ${minsToHM(greenMins)} / day`,
    },
    amber: {
      headline:  `Needs Attention — Avg ${pctAmber}–${pctGreen - 1}% of shift hours`,
      detail:    'Working hours are slightly below target. A check-in is recommended.',
      threshold: `${minsToHM(amberMins)} – ${minsToHM(greenMins - 1)} / day`,
    },
    red: {
      headline:  `Critical — Avg < ${pctAmber}% of shift hours`,
      detail:    'Significantly below expected working hours. HR or manager follow-up needed.',
      threshold: `< ${minsToHM(amberMins)} / day`,
    },
  };
}

function EmployeeTable({
  summaries,
  onEmployeeClick,
  shiftTargetMins = 480,
  avgHoursPctGreen = 85,
  avgHoursPctAmber = 75,
}: EmployeeTableProps) {
  const STATUS_TOOLTIP = buildTooltip(shiftTargetMins, avgHoursPctGreen, avgHoursPctAmber);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 200);
  const [sortKey, setSortKey] = useState<SortKey>('employeeName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    return summaries.filter(e =>
      !q || e.employeeName.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q) || e.department.toLowerCase().includes(q)
    );
  }, [summaries, debouncedSearch]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av ?? '').localeCompare(String(bv ?? ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageData = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-50" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3.5 h-3.5 text-[var(--accent)] font-bold" />
      : <ChevronDown className="w-3.5 h-3.5 text-[var(--accent)] font-bold" />;
  }

  function TH({ col, label }: { col: SortKey; label: string }) {
    return (
      <th
        onClick={() => handleSort(col)}
        className="px-3.5 py-3 text-left text-xs font-semibold text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] transition-colors select-none whitespace-nowrap"
      >
        <span className="flex items-center gap-1.5">{label}<SortIcon col={col} /></span>
      </th>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name, code, or dept…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl pl-9 pr-8 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] transition-all"
          />
          {search && (
            <button
              onClick={() => { setSearch(''); setPage(1); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="text-xs font-medium text-[var(--text-muted)] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-1.5">
          Showing <span className="text-[var(--text-primary)] font-semibold">{filtered.length}</span> employees
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-sm scroll-thin">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-elevated)]/70 border-b border-[var(--border)]">
            <tr>
              <TH col="employeeName" label="Name" />
              <TH col="department" label="Department" />
              <TH col="officeCode" label="Office" />
              <TH col="presentDays" label="Present" />
              <TH col="absentDays" label="On Leave" />
              <TH col="lateCount" label="Late" />
              <TH col="earlyExitCount" label="Early Exit" />
              <th className="px-3.5 py-3 text-left text-xs font-semibold text-[var(--text-muted)] whitespace-nowrap">Flags</th>
              <TH col="avgHoursWorked" label="Avg Hours" />
              <TH col="worstStatus" label="Status" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {pageData.map((emp) => (
              <tr
                key={`${emp.employeeCode}_${emp.officeCode}`}
                className="hover:bg-[var(--bg-elevated)]/60 transition-colors cursor-pointer group"
                onClick={() => onEmployeeClick?.(emp)}
              >
                <td className="px-3.5 py-3">
                  <div className="text-[var(--primary)] group-hover:text-[var(--accent)] font-medium transition-colors">
                    {emp.employeeName}
                  </div>
                  <div className="text-[var(--text-muted)] text-xs font-mono">
                    {emp.employeeCode}
                  </div>
                </td>
                <td className="px-3.5 py-3 text-[var(--text-muted)] font-medium">{emp.department}</td>
                <td className="px-3.5 py-3">
                  <span className="bg-[var(--bg-elevated)] border border-[var(--border)] px-2 py-0.5 rounded-md text-xs font-medium text-[var(--text-muted)]">
                    {emp.officeCode}
                  </span>
                </td>
                <td className="px-3.5 py-3 text-emerald-700 dark:text-emerald-300 font-semibold">
                  {emp.presentDays}
                </td>
                <td className="px-3.5 py-3 text-red-700 dark:text-red-300 font-semibold">
                  <span title={`${emp.unmarkedAbsentDays ?? 0} unmarked · ${(emp.plannedLeaveCount ?? 0) + (emp.casualLeaveCount ?? 0) + (emp.sickLeaveCount ?? 0) + (emp.lwpCount ?? 0) + ((emp.halfDayCount ?? 0) * 0.5)} marked`}>
                    {emp.absentDays}
                  </span>
                </td>
                <td className="px-3.5 py-3 text-amber-800 dark:text-amber-300 font-semibold">{emp.lateCount}</td>
                <td className="px-3.5 py-3 text-[var(--text-muted)]">{emp.earlyExitCount}</td>
                <td className="px-3.5 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {emp.shortDayCount > 0 ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30">
                        <AlertTriangle className="w-3 h-3" />
                        Short Day{emp.shortDayCount > 1 ? ` (${emp.shortDayCount})` : ''}
                      </span>
                    ) : null}
                    {emp.frequentPunchDays > 0 ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                        <Zap className="w-3 h-3" />
                        Frequent Punch{emp.frequentPunchDays > 1 ? ` (${emp.frequentPunchDays})` : ''}
                      </span>
                    ) : null}
                    {emp.shortDayCount === 0 && emp.frequentPunchDays === 0 && (
                      <span className="text-[var(--text-muted)] text-xs">—</span>
                    )}
                  </div>
                </td>
                <td className="px-3.5 py-3 text-[var(--text-primary)] font-mono text-xs">{emp.avgHoursWorked}</td>
                <td className="px-3.5 py-3">
                  {/* Status badge with tooltip explaining the basis of the status */}
                  <div className="relative inline-flex group/status">
                    <span
                      className={`border px-2.5 py-0.5 rounded-full text-xs font-semibold cursor-help ${
                        STATUS_BADGE[emp.worstStatus] || 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border-[var(--border)]'
                      }`}
                      aria-describedby={`status-tip-${emp.employeeCode}`}
                    >
                      {STATUS_LABEL[emp.worstStatus] || emp.worstStatus}
                    </span>
                    {/* Tooltip */}
                    <div
                      id={`status-tip-${emp.employeeCode}`}
                      role="tooltip"
                      className="pointer-events-none absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl px-3.5 py-3 opacity-0 scale-95 group-hover/status:opacity-100 group-hover/status:scale-100 transition-all duration-150 origin-bottom"
                    >
                      {/* Arrow */}
                      <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-[var(--border)]" />
                      {/* Headline */}
                      <p className={`text-xs font-bold mb-1 ${
                        emp.worstStatus === 'green' ? 'text-emerald-600 dark:text-emerald-400'
                        : emp.worstStatus === 'amber' ? 'text-amber-700 dark:text-amber-400'
                        : 'text-red-600 dark:text-red-400'
                      }`}>
                        {STATUS_TOOLTIP[emp.worstStatus]?.headline}
                      </p>
                      {/* Detail explanation */}
                      <p className="text-[var(--text-muted)] text-[11px] leading-relaxed mb-1.5">
                        {STATUS_TOOLTIP[emp.worstStatus]?.detail}
                      </p>
                      {/* Threshold time range */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[var(--text-muted)] text-[10px] font-medium">Threshold</span>
                        <span className={`text-[10px] font-semibold font-mono ${
                          emp.worstStatus === 'green' ? 'text-emerald-600 dark:text-emerald-400'
                          : emp.worstStatus === 'amber' ? 'text-amber-700 dark:text-amber-400'
                          : 'text-red-600 dark:text-red-400'
                        }`}>
                          {STATUS_TOOLTIP[emp.worstStatus]?.threshold}
                        </span>
                      </div>
                      {/* Live working hours for this employee */}
                      <div className="border-t border-[var(--border)] pt-2 flex items-center justify-between">
                        <span className="text-[var(--text-muted)] text-[10px] font-medium">Avg hours/day</span>
                        <span className={`text-[11px] font-bold font-mono ${
                          emp.worstStatus === 'green' ? 'text-emerald-600 dark:text-emerald-400'
                          : emp.worstStatus === 'amber' ? 'text-amber-700 dark:text-amber-400'
                          : 'text-red-600 dark:text-red-400'
                        }`}>
                          {emp.avgHoursWorked || '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
            {pageData.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="w-8 h-8 text-[var(--text-muted)] opacity-40" />
                    <p className="text-[var(--text-muted)] text-sm font-medium">No employees match the current filters</p>
                    {search && (
                      <button
                        onClick={() => setSearch('')}
                        className="text-xs text-[var(--accent)] hover:underline font-medium mt-1"
                      >
                        Clear search
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 text-sm flex-wrap gap-2">
          <span className="text-[var(--text-muted)] text-xs">
            Page <span className="font-semibold text-[var(--text-primary)]">{currentPage}</span> of <span className="font-semibold text-[var(--text-primary)]">{totalPages}</span> · {sorted.length} total employees
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-primary)] disabled:opacity-40 hover:border-[var(--accent)] text-xs font-medium transition-colors"
            >
              Previous
            </button>
            <span className="text-xs font-mono text-[var(--text-muted)] px-1">{currentPage}/{totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-primary)] disabled:opacity-40 hover:border-[var(--accent)] text-xs font-medium transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(EmployeeTable);
