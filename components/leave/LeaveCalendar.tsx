'use client';

import { Calendar, ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import { WEEKDAY_LABELS, buildMonthGrid, monthLabel } from '@/lib/leaveCalendar';
import type { CalendarDayEntry } from '@/lib/leaveCalendar';

const MAX_VISIBLE_DOTS = 4;

function dotClass(colorClass: string): string {
  const bgPart = colorClass.split(' ')[0] ?? 'bg-[var(--text-muted)]';
  return bgPart.replace('/20', '/70');
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
      className="flex flex-col h-[min(78dvh,720px)] border border-[var(--border)] rounded-3xl p-5 shadow-lg"
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
          const visibleDots = resolved.slice(0, MAX_VISIBLE_DOTS);
          const dotOverflow = resolved.length - visibleDots.length;

          const tooltipParts = [
            ...unresolved.map((e) => `${e.employeeName} — unmarked leave`),
            ...resolved.map((e) => `${e.employeeName} — ${e.label}`),
            ...(holidayNames ?? []),
          ];

          return (
            <button
              key={date}
              type="button"
              onClick={() => onDayClick(date)}
              title={tooltipParts.length > 0 ? tooltipParts.join('\n') : undefined}
              className={`relative flex flex-col items-center justify-between gap-1 border-b border-r p-1.5 transition-all duration-150 ${
                unresolved.length > 0
                  ? 'border-red-500/30 bg-red-500/[0.08] hover:bg-red-500/15 text-[var(--text-primary)]'
                  : inMonth
                  ? 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                  : 'border-[var(--border)] bg-[var(--bg-elevated)]/25 text-[var(--text-muted)]/40 hover:bg-[var(--bg-elevated)]/50'
              }`}
            >
              {/* Unmarked leave flag */}
              {unresolved.length > 0 && (
                <span className="absolute top-1.5 right-1.5 flex items-center gap-0.5 text-red-500">
                  <Flag size={11} className="fill-red-500/30 animate-pulse" />
                  {unresolved.length > 1 && (
                    <span className="text-[9px] font-black leading-none">{unresolved.length}</span>
                  )}
                </span>
              )}

              {holidayNames && holidayNames.length > 0 && (
                <span
                  className="absolute top-1.5 left-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 ring-2 ring-amber-500/20"
                  aria-hidden
                />
              )}

              <span
                className={`inline-flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-xl text-xs sm:text-sm font-bold transition-all ${
                  isToday
                    ? 'bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] text-white shadow-md shadow-[var(--accent)]/30 ring-2 ring-[var(--accent)]/40 ring-offset-2 ring-offset-[var(--bg-surface)]'
                    : inMonth
                    ? 'bg-[var(--bg-elevated)]/70 text-[var(--text-primary)]'
                    : 'bg-transparent text-[var(--text-muted)]/40'
                }`}
              >
                {Number(date.slice(8, 10))}
              </span>

              {/* Resolved leave dots */}
              {visibleDots.length > 0 && (
                <span className="flex items-center gap-1">
                  {visibleDots.map((entry) => (
                    <span key={entry.employeeId} className={`w-1.5 h-1.5 rounded-full shadow-sm ${dotClass(entry.colorClass)}`} />
                  ))}
                  {dotOverflow > 0 && (
                    <span className="text-[8px] leading-none text-[var(--text-muted)] font-bold">+{dotOverflow}</span>
                  )}
                </span>
              )}
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
      <span className="flex items-center gap-1.5 font-medium text-red-500 dark:text-red-400">
        <Flag size={11} className="fill-red-500/30" />
        Unmarked leave
      </span>
      <span className="flex items-center gap-1.5 font-medium">
        <span className="w-2 h-2 rounded-full bg-amber-500" /> Holiday
      </span>
      <span className="flex items-center gap-1.5 font-medium">
        <span className="w-2 h-2 rounded-full bg-[var(--accent)]" /> Leave (click date for details)
      </span>
    </div>
  );
}