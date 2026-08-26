'use client';

import { ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import { WEEKDAY_LABELS, buildMonthGrid, monthLabel } from '@/lib/leaveCalendar';
import type { CalendarDayEntry } from '@/lib/leaveCalendar';

const MAX_VISIBLE_DOTS = 4;

// Turns a LEAVE_COLORS entry like "bg-red-500/20 text-red-400" into a
// solid dot color ("bg-red-500/70") — same palette as before, just
// pulled out of the "bg-x/20 text-x" pair used for the old chip
// background/text combo, since dots only need the bg half.
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

  function shift(delta: number) {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    onMonthChange(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft') shift(-1);
    if (e.key === 'ArrowRight') shift(1);
  }

  return (
    <div
      // Capped to the viewport instead of growing with content — a
      // month never scrolls out of view. min() keeps it from getting
      // absurdly tall on very large monitors; dvh (not vh) so mobile
      // browser chrome doesn't cause a sliver of scroll on load.
      className="flex flex-col h-[min(78dvh,720px)] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-3xl p-4"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3 shrink-0">
        <div>
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-[0.24em]">Leave Calendar</p>
          <h2 className="text-[var(--text-primary)] font-semibold text-lg">{monthLabel(monthKey)}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next month"
            className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0 border-t border-l border-[var(--border)] text-[10px] text-[var(--text-muted)] shrink-0">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="border-b border-r border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-center font-semibold uppercase tracking-[0.12em]">
            {d}
          </div>
        ))}
      </div>

      {/* flex-1 + min-h-0 is what lets this grid actually fill the
          remaining space instead of pushing the card taller — the
          classic flex-child-with-scrolling-content trap. Row count is
          dynamic (a month is 5 or 6 weeks) so row height is set inline
          rather than assuming 6. */}
      <div
        className="grid grid-cols-7 gap-0 border-t border-l border-[var(--border)] rounded-b-3xl overflow-hidden flex-1 min-h-0"
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

          // Full detail stays available on hover (desktop) via the
          // native title tooltip, even though the cell itself only
          // shows a flag — nothing is lost, just deferred to intent.
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
              className={`relative flex flex-col items-center justify-between gap-1 border-b border-r p-1.5 transition-colors ${
                unresolved.length > 0
                  ? 'border-red-500/30 bg-red-500/[0.06] hover:bg-red-500/10 text-[var(--text-primary)]'
                  : inMonth
                  ? 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                  : 'border-[var(--border)] bg-[var(--bg-elevated)]/30 text-[var(--text-muted)]/60 hover:bg-[var(--bg-elevated)]/50'
              }`}
            >
              {/* Unmarked-leave flag — the one signal this redesign is
                  built around. A small count badge appears only when
                  more than one person on that day is unresolved, so a
                  single flag stays a flag rather than always showing "1". */}
              {unresolved.length > 0 && (
                <span className="absolute top-1 right-1 flex items-center gap-0.5 text-red-500">
                  <Flag size={11} className="fill-red-500/20" />
                  {unresolved.length > 1 && (
                    <span className="text-[9px] font-bold leading-none">{unresolved.length}</span>
                  )}
                </span>
              )}

              {holidayNames && holidayNames.length > 0 && (
                <span
                  className="absolute top-1 left-1 w-1.5 h-1.5 rounded-full bg-amber-500"
                  aria-hidden
                />
              )}

              <span
                className={`inline-flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-xl text-xs sm:text-sm font-semibold ${
                  isToday
                    ? 'bg-[var(--accent)] text-white shadow-sm ring-2 ring-[var(--accent)]/40 ring-offset-1 ring-offset-[var(--bg-surface)]'
                    : inMonth
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                    : 'bg-transparent text-[var(--text-muted)]/50'
                }`}
              >
                {Number(date.slice(8, 10))}
              </span>

              {/* Resolved leave for the day — quiet colored dots, no
                  names, no labels. Detail is one click (or a hover) away
                  via the drawer / tooltip, not printed into the cell. */}
              {visibleDots.length > 0 && (
                <span className="flex items-center gap-0.5">
                  {visibleDots.map((entry) => (
                    <span key={entry.employeeId} className={`w-1.5 h-1.5 rounded-full ${dotClass(entry.colorClass)}`} />
                  ))}
                  {dotOverflow > 0 && (
                    <span className="text-[8px] leading-none text-[var(--text-muted)] font-medium">+{dotOverflow}</span>
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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-2 border-t border-[var(--border)] text-[10px] text-[var(--text-muted)] shrink-0">
      <span className="flex items-center gap-1 font-medium text-red-500">
        <Flag size={10} className="fill-red-500/20" />
        Unmarked leave — resolve it and the flag clears
      </span>
      <span className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Holiday
      </span>
      <span className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]/70" /> Leave (see legend on click)
      </span>
    </div>
  );
}