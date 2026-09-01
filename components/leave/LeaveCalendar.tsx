'use client';

import { Calendar, ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import { WEEKDAY_LABELS, buildMonthGrid, monthLabel } from '@/lib/leaveCalendar';
import type { CalendarDayEntry } from '@/lib/leaveCalendar';
import { formatOrdinalDate } from '@/lib/dateFormat';

const MAX_VISIBLE_BADGES = 3;

function getInitials(name: string): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return ((parts[0][0] || '') + (parts[parts.length - 1][0] || '')).toUpperCase();
}

export default function LeaveCalendar({
  monthKey,
  onMonthChange,
  dayMap,
  holidaysByDate,
  onDayClick,
}: {
  monthKey: string;
  onMonthChange: (nextMonthKey: string) => void;
  dayMap: Map<string, CalendarDayEntry[]>;
  holidaysByDate: Map<string, string[]>;
  onDayClick: (date: string) => void;
}) {
  const cells = buildMonthGrid(monthKey);
  const weekCount = cells.length / 7;
  const todayYMD = new Date().toISOString().slice(0, 10);
  const currentMonthKey = todayYMD.slice(0, 7);

  function shift(delta: number) {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    onMonthChange(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  function jumpToToday() {
    onMonthChange(currentMonthKey);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft') shift(-1);
    if (e.key === 'ArrowRight') shift(1);
  }

  return (
    <div
      className="flex flex-col h-[min(82dvh,760px)] border border-[var(--border)] rounded-3xl p-5 shadow-lg"
      style={{
        background: 'linear-gradient(170deg, var(--bg-card) 0%, var(--bg-elevated) 100%)',
      }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Calendar Header with navigation */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 shrink-0">
        <div>
          <p className="text-[var(--accent)] text-[11px] font-bold uppercase tracking-[0.2em] flex items-center gap-1.5">
            <Calendar size={13} />
            Leave Calendar
          </p>
          <h2 className="text-[var(--text-primary)] font-bold text-xl tracking-tight mt-0.5">{monthLabel(monthKey)}</h2>
        </div>
        <div className="flex items-center gap-2">
          {monthKey !== currentMonthKey && (
            <button
              type="button"
              onClick={jumpToToday}
              className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/40 transition-all"
            >
              Today
            </button>
          )}
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] shadow-sm transition-all"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next month"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] shadow-sm transition-all"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-0 border-t border-l border-[var(--border)] text-[10px] text-[var(--text-muted)] shrink-0 rounded-t-2xl overflow-hidden">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="border-b border-r border-[var(--border)] bg-[var(--bg-surface)]/80 px-2 py-2 text-center font-bold uppercase tracking-[0.14em]">
            {d}
          </div>
        ))}
      </div>

      {/* Grid of days */}
      <div
        className="grid grid-cols-7 gap-0 border-l border-[var(--border)] rounded-b-2xl overflow-hidden flex-1 min-h-0"
        style={{ gridTemplateRows: `repeat(${weekCount}, 1fr)` }}
      >
        {cells.map(({ date, inMonth }) => {
          const entries = dayMap.get(date) ?? [];
          const unresolved = entries.filter((e) => e.status === 'unrecorded');
          const resolved = entries.filter((e) => e.status !== 'unrecorded');
          const holidayNames = holidaysByDate.get(date);
          const isToday = date === todayYMD;

          // Ordered entries: unmarked first (red), then approved/resolved (green), then pending (amber)
          const allEntries = [
            ...unresolved,
            ...resolved.filter((e) => e.status === 'approved'),
            ...resolved.filter((e) => e.status === 'pending'),
          ];

          const visibleBadges = allEntries.slice(0, MAX_VISIBLE_BADGES);
          const overflowCount = allEntries.length - visibleBadges.length;

          const tooltipParts = [
            formatOrdinalDate(date),
            ...unresolved.map((e) => `• [UNMARKED] ${e.employeeName}`),
            ...resolved.map((e) => `• [${e.status === 'approved' ? 'MARKED / APPROVED' : 'PENDING'}] ${e.employeeName} (${e.label})`),
            ...(holidayNames ? holidayNames.map((h) => `• Holiday: ${h}`) : []),
          ];

          return (
            <button
              key={date}
              type="button"
              onClick={() => onDayClick(date)}
              title={tooltipParts.length > 0 ? tooltipParts.join('\n') : undefined}
              className={`relative flex flex-col justify-between p-1 sm:p-1.5 border-b border-r transition-all duration-150 text-left ${
                unresolved.length > 0
                  ? 'border-red-500/30 bg-red-500/[0.06] hover:bg-red-500/12'
                  : inMonth
                  ? 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                  : 'border-[var(--border)] bg-[var(--bg-elevated)]/25 text-[var(--text-muted)]/40 hover:bg-[var(--bg-elevated)]/50'
              }`}
            >
              {/* Top row: Date Number + Holiday flag */}
              <div className="flex items-center justify-between w-full">
                <span
                  className={`inline-flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-lg text-[11px] sm:text-xs font-bold transition-all ${
                    isToday
                      ? 'bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] text-white shadow-md ring-2 ring-[var(--accent)]/40'
                      : inMonth
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-muted)]/40'
                  }`}
                >
                  {Number(date.slice(8, 10))}
                </span>

                {/* Holiday marker */}
                {holidayNames && holidayNames.length > 0 && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-amber-500 ring-2 ring-amber-500/20"
                    title={`Holiday: ${holidayNames.join(', ')}`}
                    aria-hidden
                  />
                )}
              </div>

              {/* Employee Initials Badges list */}
              <div className="flex flex-wrap items-center gap-1 mt-1 min-h-[20px]">
                {visibleBadges.map((entry) => {
                  const initials = getInitials(entry.employeeName);
                  const isUnmarked = entry.status === 'unrecorded';
                  const isPending = entry.status === 'pending';

                  const badgeClass = isUnmarked
                    ? 'bg-red-500/15 border-red-500/35 text-red-700 dark:text-red-300'
                    : isPending
                    ? 'bg-amber-500/15 border-amber-500/35 text-amber-700 dark:text-amber-300'
                    : 'bg-emerald-500/15 border-emerald-500/35 text-emerald-700 dark:text-emerald-300';

                  return (
                    <span
                      key={`${entry.employeeId}-${entry.status}`}
                      title={`${entry.employeeName} (${isUnmarked ? 'Unmarked Leave' : entry.label})`}
                      className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-bold border shadow-2xs leading-none ${badgeClass}`}
                    >
                      {initials}
                    </span>
                  );
                })}

                {overflowCount > 0 && (
                  <span
                    title={`${overflowCount} more employees on leave`}
                    className="inline-flex items-center justify-center px-1 py-0.5 rounded-md text-[9px] font-bold bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-muted)] leading-none"
                  >
                    +{overflowCount}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-3 pt-2.5 border-t border-[var(--border)] text-[11px] text-[var(--text-muted)] shrink-0">
      <span className="flex items-center gap-1.5 font-semibold text-red-600 dark:text-red-400">
        <span className="w-2.5 h-2.5 rounded-md bg-red-500/20 border border-red-500/40 inline-flex items-center justify-center text-[8px] font-bold text-red-600">
          ●
        </span>
        Red Initials: Unmarked Leave
      </span>
      <span className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
        <span className="w-2.5 h-2.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 inline-flex items-center justify-center text-[8px] font-bold text-emerald-600">
          ●
        </span>
        Green Initials: Marked / Approved Leave
      </span>
      <span className="flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400">
        <span className="w-2.5 h-2.5 rounded-md bg-amber-500/20 border border-amber-500/40 inline-flex items-center justify-center text-[8px] font-bold text-amber-600">
          ●
        </span>
        Amber Initials: Pending Approval
      </span>
      <span className="flex items-center gap-1.5 font-medium">
        <span className="w-2 h-2 rounded-full bg-amber-500" /> Holiday
      </span>
    </div>
  );
}