'use client';
import { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, Search, Zap, AlertTriangle } from 'lucide-react';
import { EmployeeSummary } from '@/lib/types';

interface EmployeeTableProps {
  summaries: EmployeeSummary[];
  onEmployeeClick?: (emp: EmployeeSummary) => void;
}

type SortKey = keyof EmployeeSummary;
type SortDir = 'asc' | 'desc';
const PAGE_SIZE = 50;

const STATUS_BADGE: Record<string, string> = {
  green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  red:   'bg-red-500/15 text-red-400 border-red-500/30',
};
const STATUS_LABEL: Record<string, string> = { green: 'Good', amber: 'At Risk', red: 'Poor' };

export default function EmployeeTable({ summaries, onEmployeeClick }: EmployeeTableProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('employeeName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return summaries.filter(e =>
      !q || e.employeeName.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q)
    );
  }, [summaries, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageData = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 text-slate-600" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-blue-400" />
      : <ChevronDown className="w-3 h-3 text-blue-400" />;
  }

  function TH({ col, label }: { col: SortKey; label: string }) {
    return (
      <th
        onClick={() => handleSort(col)}
        className="px-3 py-2.5 text-left text-xs font-medium text-slate-400 cursor-pointer hover:text-white transition-colors select-none whitespace-nowrap"
      >
        <span className="flex items-center gap-1">{label}<SortIcon col={col} /></span>
      </th>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by name or code…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <span className="text-xs text-slate-500">{filtered.length} employees</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 border-b border-slate-700">
            <tr>
              <TH col="employeeName" label="Name" />
              <TH col="department" label="Department" />
              <TH col="officeCode" label="Office" />
              <TH col="presentDays" label="Present" />
              <TH col="absentDays" label="Absent" />
              <TH col="lateCount" label="Late" />
              <TH col="earlyExitCount" label="Early Exit" />
              <th className="px-3 py-2.5 text-left text-xs font-medium text-slate-400 whitespace-nowrap">Flags</th>
              <TH col="avgHoursWorked" label="Avg Hours" />
              <TH col="worstStatus" label="Status" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {pageData.map((emp) => (
              <tr
                key={`${emp.employeeCode}_${emp.officeCode}`}
                className="hover:bg-slate-800/50 transition-colors cursor-pointer"
                onClick={() => onEmployeeClick?.(emp)}
              >
                <td className="px-3 py-2.5">
                  <div className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
                    {emp.employeeName}
                  </div>
                  <div className="text-slate-500 text-xs">
                    {emp.employeeCode}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-slate-300">{emp.department}</td>
                <td className="px-3 py-2.5">
                  <span className="bg-slate-700 px-2 py-0.5 rounded text-xs text-slate-300">{emp.officeCode}</span>
                </td>
                <td className="px-3 py-2.5 text-emerald-400 font-medium">{emp.presentDays}</td>
                <td className="px-3 py-2.5 text-red-400">{emp.absentDays}</td>
                <td className="px-3 py-2.5 text-amber-400">{emp.lateCount}</td>
                <td className="px-3 py-2.5 text-slate-300">{emp.earlyExitCount}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {emp.shortDayCount > 0 ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-500/15 text-orange-400 border border-orange-500/20">
                        <AlertTriangle className="w-3 h-3" />
                        Short Day{emp.shortDayCount > 1 ? ` (${emp.shortDayCount})` : ''}
                      </span>
                    ) : null}
                    {emp.frequentPunchDays > 0 ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
                        <Zap className="w-3 h-3" />
                        Frequent Punch{emp.frequentPunchDays > 1 ? ` (${emp.frequentPunchDays})` : ''}
                      </span>
                    ) : null}
                    {emp.shortDayCount === 0 && emp.frequentPunchDays === 0 && (
                      <span className="text-slate-600 text-xs">—</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-slate-300 font-mono">{emp.avgHoursWorked}</td>
                <td className="px-3 py-2.5">
                  <span className={`border px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[emp.worstStatus]}`}>
                    {STATUS_LABEL[emp.worstStatus]}
                  </span>
                </td>
              </tr>
            ))}
            {pageData.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-slate-500">No employees match the current filters</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <span className="text-slate-500 text-xs">Page {page} of {totalPages} · {sorted.length} total</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 disabled:opacity-40 hover:border-slate-500 transition-colors">
              Prev
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-3 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 disabled:opacity-40 hover:border-slate-500 transition-colors">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
