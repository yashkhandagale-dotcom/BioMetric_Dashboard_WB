'use client';
import { useState, useMemo, memo } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, Search, Zap, AlertTriangle, X, Users, Info } from 'lucide-react';
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

function EmployeeTable({
  summaries,
  onEmployeeClick,
  shiftTargetMins = 480,
  avgHoursPctGreen = 85,
  avgHoursPctAmber = 75,
}: EmployeeTableProps) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 200);
  const [sortKey, setSortKey] = useState<SortKey>('employeeName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);

  const greenMins = Math.round((avgHoursPctGreen / 100) * shiftTargetMins);
  const amberMins = Math.round((avgHoursPctAmber / 100) * shiftTargetMins);

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
  const pageData = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }, [sorted, currentPage]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />;
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
              <th className="px-3.5 py-3 text-left text-xs font-semibold text-[var(--text-muted)] select-none whitespace-nowrap relative group/statushdr">
                <div className="flex items-center gap-1.5">
                  <span
                    onClick={() => handleSort('worstStatus')}
                    className="flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  >
                    Status
                    <SortIcon col="worstStatus" />
                  </span>
                  <span
                    className="inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-help p-0.5 rounded-full hover:bg-[var(--bg-surface)] transition-colors"
                    title="View status calculation criteria"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </span>
                </div>

                {/* Status criteria tooltip card */}
                <div
                  role="tooltip"
                  className="pointer-events-none absolute z-50 top-full right-0 mt-2 w-80 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl p-4 opacity-0 scale-95 group-hover/statushdr:opacity-100 group-hover/statushdr:scale-100 transition-all duration-150 origin-top-right text-left font-normal normal-case"
                >
                  {/* Arrow pointing up */}
                  <div className="absolute right-6 bottom-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-[var(--border)]" />

                  <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-[var(--border)]">
                    <span className="text-xs font-bold text-[var(--text-primary)]">Status Breakdown</span>
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">Target: {minsToHM(shiftTargetMins)}/day</span>
                  </div>

                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed mb-3">
                    Evaluated from each employee&apos;s average effective working hours per present day against the expected shift duration:
                  </p>

                  <div className="space-y-2.5">
                    {/* On Track */}
                    <div className="flex items-start gap-2.5">
                      <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shrink-0">
                        On Track
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-semibold text-[var(--text-primary)]">≥ {avgHoursPctGreen}% of shift</span>
                          <span className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400">≥ {minsToHM(greenMins)}/day</span>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)] leading-tight mt-0.5">
                          Consistently meets or exceeds target working hours.
                        </p>
                      </div>
                    </div>

                    {/* Needs Attention */}
                    <div className="flex items-start gap-2.5">
                      <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 shrink-0">
                        Needs Attention
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-semibold text-[var(--text-primary)]">{avgHoursPctAmber}%–{avgHoursPctGreen - 1}% of shift</span>
                          <span className="text-[10px] font-mono font-bold text-amber-600 dark:text-amber-400">{minsToHM(amberMins)}–{minsToHM(greenMins - 1)}</span>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)] leading-tight mt-0.5">
                          Borderline below expected hours. A check-in is recommended.
                        </p>
                      </div>
                    </div>

                    {/* Critical */}
                    <div className="flex items-start gap-2.5">
                      <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 dark:bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30 shrink-0">
                        Critical
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-semibold text-[var(--text-primary)]">&lt; {avgHoursPctAmber}% of shift</span>
                          <span className="text-[10px] font-mono font-bold text-red-600 dark:text-red-400">&lt; {minsToHM(amberMins)}/day</span>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)] leading-tight mt-0.5">
                          Significantly below expected hours. Follow-up needed from HR/manager.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </th>
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
                  <span title={`${emp.unmarkedAbsentDays ?? 0} unmarked A • ${(emp.plannedLeaveCount ?? 0) + (emp.casualLeaveCount ?? 0) + (emp.sickLeaveCount ?? 0) + (emp.lwpCount ?? 0) + ((emp.halfDayCount ?? 0) * 0.5)} marked`}>
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
                  <span
                    className={`border px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      STATUS_BADGE[emp.worstStatus] || 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border-[var(--border)]'
                    }`}
                  >
                    {STATUS_LABEL[emp.worstStatus] || emp.worstStatus}
                  </span>
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
