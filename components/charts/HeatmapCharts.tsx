'use client';
import { useState, useMemo, useEffect } from 'react';
import { AttendanceRecord, LeaveRecord } from '@/lib/types';
import { computeLateMinutes, computeEarlyMinutes, getLateMinutes, getEarlyMinutes, computeProductivityLostMinutes } from '@/lib/useDashboardData';
import { minutesToHHMM } from '@/lib/parseCSV';
import { leaveLabelFor, UNMARKED_LEAVE_LABEL } from '@/lib/leaveLabels';
import InfoTooltip from '../InfoTooltip';
import { useEntityChartLayout } from '@/lib/chartLayout';
import ChartFilterBar from '../ChartFilterBar';
import { STATUS_COLORS_CELL, getCellStatus, monthlyAttendanceColor } from './chartUtils';

// ── Exported helpers used by DashboardClient / EmployeePanel ─────────────────
export { STATUS_COLORS_CELL, getCellStatus };

function leaveKey(employeeCode: string, date: string): string {
  return `${employeeCode}__${date}`;
}

// ── Per-Employee Heatmap ──────────────────────────────────────────────────────
export function PersonalHeatmap({
  records, graceMinutes = 10, shiftStartMinutes, shiftEndMinutes, leaveMap,
}: {
  records: AttendanceRecord[];
  graceMinutes?: number;
  shiftStartMinutes?: number;
  shiftEndMinutes?: number;
  leaveMap?: Map<string, LeaveRecord>;
}) {
  const [tooltip, setTooltip] = useState<{ r: AttendanceRecord; x: number; y: number } | null>(null);
  const sorted = useMemo(() => [...records].sort((a, b) => a.date.localeCompare(b.date)), [records]);

  if (sorted.length === 0) return null;

  return (
    <div>
      <div className="flex flex-wrap gap-0.5">
        {sorted.map((r) => {
          const leave = leaveMap?.get(leaveKey(r.employeeCode, r.date));
          const status = getCellStatus(r, graceMinutes, shiftStartMinutes, shiftEndMinutes, leave);
          const color = STATUS_COLORS_CELL[status] || '#334155';
          return (
            <div
              key={r.date}
              className="w-4 h-4 rounded-sm cursor-pointer hover:ring-1 hover:ring-white/40 transition-all"
              style={{ backgroundColor: color + '90' }}
              onMouseEnter={(e) => setTooltip({ r, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-2">
        {Object.entries({ present: 'Present', late: 'Late', earlyexit: 'Early Exit', on_leave: 'On Leave', absent: UNMARKED_LEAVE_LABEL, shortday: 'Short Day', weeklyoff: 'Weekly Off', holiday: 'Holiday' }).map(([k, label]) => (
          <div key={k} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: STATUS_COLORS_CELL[k] + '90' }} />
            <span className="text-[var(--text-muted)] text-[9px]">{label}</span>
          </div>
        ))}
      </div>
      {tooltip && (() => {
        const leave = leaveMap?.get(leaveKey(tooltip.r.employeeCode, tooltip.r.date));
        const statusLine = leave
          ? `On Leave — ${leaveLabelFor(leave.leaveType, leave.halfDayLeaveType)}`
          : tooltip.r.status.toLowerCase().includes('absent')
            ? UNMARKED_LEAVE_LABEL
            : tooltip.r.status;
        return (
          <div
            className="fixed z-50 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs shadow-2xl pointer-events-none"
            style={{ left: tooltip.x + 12, top: tooltip.y - 20 }}
          >
            <p className="text-[var(--text-primary)] font-medium">{tooltip.r.date}</p>
            <p className="text-[var(--text-muted)]">In: {tooltip.r.inTime || '—'} · Out: {tooltip.r.outTime || '—'}</p>
            <p className="text-[var(--text-muted)]">{statusLine}</p>
          </div>
        );
      })()}
    </div>
  );
}

// ── Full Attendance Heatmap (multi-employee) ──────────────────────────────────
export function AttendanceHeatmap({
  records, onCellClick, graceMinutes = 10, shiftStartMinutes, shiftEndMinutes, leaveMap,
}: {
  records: AttendanceRecord[];
  onCellClick?: (emp: string, date: string) => void;
  graceMinutes?: number;
  shiftStartMinutes?: number;
  shiftEndMinutes?: number;
  leaveMap?: Map<string, LeaveRecord>;
}) {
  const [tooltip, setTooltip] = useState<{ r: AttendanceRecord; x: number; y: number } | null>(null);
  const [heatmapSort, setHeatmapSort] = useState<'absences' | 'az'>('absences');

  const { employees, dates, cellMap } = useMemo(() => {
    const empSet = new Map<string, string>();
    const dateSet = new Set<string>();
    const cellMap = new Map<string, AttendanceRecord>();
    for (const r of records) {
      if (!empSet.has(r.employeeCode)) empSet.set(r.employeeCode, r.employeeName);
      dateSet.add(r.date);
      cellMap.set(`${r.employeeCode}_${r.date}`, r);
    }
    const dates = Array.from(dateSet).sort();
    const employees = Array.from(empSet.entries()).map(([code, name]) => ({ code, name }));
    return { employees, dates, cellMap };
  }, [records]);

  const monthGroups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const d of dates) {
      const key = d.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [dates]);

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  useEffect(() => {
    if (monthGroups.length === 0) return;
    if (!selectedMonth || !monthGroups.some(([key]) => key === selectedMonth)) {
      setSelectedMonth(monthGroups[monthGroups.length - 1][0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthGroups]);

  const isMultiMonth = monthGroups.length > 1;
  const [viewMode, setViewMode] = useState<'day' | 'month'>('day');

  useEffect(() => {
    setViewMode(isMultiMonth ? 'month' : 'day');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiMonth]);

  const monthlyStats = useMemo(() => {
    const map = new Map<string, { present: number; eligible: number }>();
    for (const r of records) {
      const monthKey = r.date.slice(0, 7);
      const leave = leaveMap?.get(leaveKey(r.employeeCode, r.date));
      const status = getCellStatus(r, graceMinutes, shiftStartMinutes, shiftEndMinutes, leave);
      if (status === 'weeklyoff' || status === 'holiday') continue;
      const key = `${r.employeeCode}_${monthKey}`;
      const entry = map.get(key) ?? { present: 0, eligible: 0 };
      entry.eligible += 1;
      if (status === 'present' || status === 'late' || status === 'earlyexit' || status === 'shortday') entry.present += 1;
      map.set(key, entry);
    }
    return map;
  }, [records, leaveMap, graceMinutes, shiftStartMinutes, shiftEndMinutes]);

  const monthPct = (code: string, monthKey: string): number | null => {
    const e = monthlyStats.get(`${code}_${monthKey}`);
    if (!e || e.eligible === 0) return null;
    return Math.round((e.present / e.eligible) * 100);
  };

  const visibleDates = isMultiMonth
    ? (monthGroups.find(([key]) => key === selectedMonth)?.[1] ?? monthGroups[monthGroups.length - 1][1])
    : dates;

  const monthLabel = (key: string) =>
    new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const monthLabelShort = (key: string) =>
    new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

  const sortedEmployees = useMemo(() => {
    if (viewMode === 'month') {
      const withAvg = employees.map(emp => {
        const pcts = monthGroups.map(([key]) => monthPct(emp.code, key)).filter((p): p is number => p !== null);
        const avgPct = pcts.length > 0 ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 100;
        return { ...emp, absences: 0, avgPct };
      });
      return heatmapSort === 'az'
        ? withAvg.sort((a, b) => a.name.localeCompare(b.name))
        : withAvg.sort((a, b) => a.avgPct - b.avgPct || a.name.localeCompare(b.name));
    }
    const withAbsences = employees.map(emp => {
      let absences = 0;
      for (const date of visibleDates) {
        const r = cellMap.get(`${emp.code}_${date}`);
        const leave = r ? leaveMap?.get(leaveKey(r.employeeCode, r.date)) : undefined;
        const status = r ? getCellStatus(r, graceMinutes, shiftStartMinutes, shiftEndMinutes, leave) : 'absent';
        if (status === 'absent') absences++;
      }
      return { ...emp, absences, avgPct: 0 };
    });
    return heatmapSort === 'az'
      ? withAbsences.sort((a, b) => a.name.localeCompare(b.name))
      : withAbsences.sort((a, b) => b.absences - a.absences || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, visibleDates, cellMap, leaveMap, graceMinutes, shiftStartMinutes, shiftEndMinutes, heatmapSort, viewMode, monthGroups, monthlyStats]);

  const heatmapLayout = useEntityChartLayout(sortedEmployees, { getLabel: (e) => e.name, rowHeight: viewMode === 'month' ? 32 : 22 });

  if (records.length === 0) return null;

  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">Attendance Heatmap</h3>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            {viewMode === 'month'
              ? <>{employees.length} employees · {monthGroups.length} months — colored by attendance % · click a month to see daily detail</>
              : <>{employees.length} employees · {visibleDates.length} days{isMultiMonth && selectedMonth ? ` in ${monthLabel(selectedMonth)}` : ''} — click any cell for details</>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isMultiMonth && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewMode('month')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${viewMode === 'month' ? 'bg-blue-600 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                Monthly Overview
              </button>
              <button
                onClick={() => setViewMode('day')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${viewMode === 'day' ? 'bg-blue-600 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                Daily Detail
              </button>
            </div>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setHeatmapSort('absences')}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${heatmapSort === 'absences' ? 'bg-blue-600 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              {viewMode === 'month' ? 'Lowest Attendance' : 'Most Absent'}
            </button>
            <button
              onClick={() => setHeatmapSort('az')}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${heatmapSort === 'az' ? 'bg-blue-600 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              A → Z
            </button>
          </div>
          {viewMode === 'day' && isMultiMonth && (
            <select
              value={selectedMonth ?? ''}
              onChange={e => setSelectedMonth(e.target.value)}
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-xs text-[var(--text-primary)] px-2 py-1.5 focus:outline-none focus:border-blue-500"
              title="Pick which month's days to view"
            >
              {monthGroups.map(([key]) => (
                <option key={key} value={key}>{monthLabel(key)}</option>
              ))}
            </select>
          )}
          <InfoTooltip
            title="Attendance Heatmap"
            description={viewMode === 'month'
              ? "Each cell = one employee's attendance % for that month (weekly-offs and holidays excluded from the calculation). Click a cell to jump into that month's daily detail. Sort/search the employee list when there are more than 15."
              : "Each cell = one employee on one day. Colors show attendance status. Click any cell to see details. When your selected range spans more than one month, switch to Monthly Overview for a summary, or use the month dropdown here to pick a single month's days. Sort/search the employee list when there are more than 15."}
          />
        </div>
      </div>

      <ChartFilterBar
        query={heatmapLayout.query}
        onQueryChange={heatmapLayout.setQuery}
        totalCount={heatmapLayout.totalCount}
        matchedCount={heatmapLayout.matchedCount}
        hiddenCount={heatmapLayout.hiddenCount}
        isExpanded={heatmapLayout.isExpanded}
        onToggleExpanded={heatmapLayout.toggleExpanded}
      />

      {heatmapLayout.visibleRows.length === 0
        ? <div className="h-32 flex items-center justify-center text-[var(--text-muted)] text-sm">No employees match &quot;{heatmapLayout.query}&quot;</div>
        : viewMode === 'month'
        ? (
          <div className="overflow-x-auto">
            <div
              style={{ minWidth: monthGroups.length * 52 + 160, maxHeight: heatmapLayout.maxWrapperHeight, overflowY: heatmapLayout.willScroll ? 'auto' : 'visible' }}
            >
              <div className="flex gap-1 mb-1 ml-[152px] sticky top-0 bg-[var(--bg-elevated)] z-10">
                {monthGroups.map(([key]) => (
                  <div key={key} className="w-12 text-[9px] text-[var(--text-muted)] text-center flex-shrink-0">{monthLabelShort(key)}</div>
                ))}
              </div>
              {heatmapLayout.visibleRows.map(emp => (
                <div key={emp.code} className="flex items-center gap-1 mb-1">
                  <div className="w-36 text-[10px] text-[var(--text-muted)] truncate flex-shrink-0 text-right pr-2" title={`${emp.name} · ${emp.avgPct}% avg attendance across ${monthGroups.length} months`}>
                    {emp.name.length > 16 ? emp.name.slice(0, 15) + '…' : emp.name}
                  </div>
                  {monthGroups.map(([key]) => {
                    const pct = monthPct(emp.code, key);
                    return (
                      <button
                        key={key}
                        onClick={() => { setSelectedMonth(key); setViewMode('day'); }}
                        title={`${emp.name} · ${monthLabel(key)} · ${pct === null ? 'no data' : pct + '% attendance'}`}
                        className="w-12 h-7 rounded-sm flex-shrink-0 flex items-center justify-center text-[9px] font-medium text-white/90 hover:ring-1 hover:ring-white/40 transition-all"
                        style={{ backgroundColor: pct === null ? '#33415560' : monthlyAttendanceColor(pct) }}
                      >
                        {pct === null ? '—' : `${pct}%`}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )
        : (
          <div className="overflow-x-auto">
            <div
              style={{ minWidth: visibleDates.length * 22 + 160, maxHeight: heatmapLayout.maxWrapperHeight, overflowY: heatmapLayout.willScroll ? 'auto' : 'visible' }}
            >
              <div className="flex gap-0.5 mb-1 ml-[152px] sticky top-0 bg-[var(--bg-elevated)] z-10">
                {visibleDates.map(d => (
                  <div key={d} className="w-5 text-[8px] text-[var(--text-muted)] text-center flex-shrink-0">{d.slice(8)}</div>
                ))}
              </div>
              {heatmapLayout.visibleRows.map(emp => (
                <div key={emp.code} className="flex items-center gap-0.5 mb-0.5">
                  <div className="w-36 text-[10px] text-[var(--text-muted)] truncate flex-shrink-0 text-right pr-2" title={`${emp.name} · ${emp.absences} absent day${emp.absences === 1 ? '' : 's'}`}>
                    {emp.name.length > 16 ? emp.name.slice(0, 15) + '…' : emp.name}
                  </div>
                  {visibleDates.map(date => {
                    const r = cellMap.get(`${emp.code}_${date}`);
                    const leave = r ? leaveMap?.get(leaveKey(r.employeeCode, r.date)) : undefined;
                    const status = r ? getCellStatus(r, graceMinutes, shiftStartMinutes, shiftEndMinutes, leave) : 'absent';
                    const color = STATUS_COLORS_CELL[status] || '#334155';
                    return (
                      <div
                        key={date}
                        className="w-5 h-5 rounded-sm cursor-pointer hover:ring-1 hover:ring-white/40 flex-shrink-0 transition-all"
                        style={{ backgroundColor: color + '90' }}
                        onMouseEnter={(e) => r && setTooltip({ r, x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setTooltip(null)}
                        onClick={() => r && onCellClick?.(emp.code, date)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

      <div className="flex flex-wrap gap-3 mt-3">
        {viewMode === 'month'
          ? [
              { pct: 90, label: '90%+' },
              { pct: 75, label: '75–89%' },
              { pct: 60, label: '60–74%' },
              { pct: 40, label: '40–59%' },
              { pct: 0, label: '<40%' },
            ].map(({ pct, label }) => (
              <div key={label} className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: monthlyAttendanceColor(pct) }} />
                <span className="text-[var(--text-muted)] text-[10px]">{label}</span>
              </div>
            ))
          : Object.entries({ present: 'Present', late: 'Late', earlyexit: 'Early Exit', on_leave: 'On Leave', absent: UNMARKED_LEAVE_LABEL, shortday: 'Short Day', weeklyoff: 'Weekly Off', holiday: 'Holiday' }).map(([k, label]) => (
              <div key={k} className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: STATUS_COLORS_CELL[k] + '90' }} />
                <span className="text-[var(--text-muted)] text-[10px]">{label}</span>
              </div>
            ))}
      </div>

      {viewMode === 'day' && tooltip && (() => {
        const leave = leaveMap?.get(leaveKey(tooltip.r.employeeCode, tooltip.r.date));
        const statusLine = leave
          ? `On Leave — ${leaveLabelFor(leave.leaveType, leave.halfDayLeaveType)}`
          : tooltip.r.status.toLowerCase().includes('absent')
            ? UNMARKED_LEAVE_LABEL
            : tooltip.r.status;
        return (
          <div
            className="fixed z-50 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs shadow-2xl pointer-events-none"
            style={{ left: tooltip.x + 12, top: tooltip.y - 20 }}
          >
            <p className="text-[var(--text-primary)] font-medium">{tooltip.r.employeeName}</p>
            <p className="text-[var(--text-muted)]">{tooltip.r.date}</p>
            <p className="text-[var(--text-muted)]">In: {tooltip.r.inTime || '—'} · Out: {tooltip.r.outTime || '—'}</p>
            <p className="text-[var(--text-muted)]">{statusLine}</p>
          </div>
        );
      })()}
    </div>
  );
}
