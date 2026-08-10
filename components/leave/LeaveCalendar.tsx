'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { WEEKDAY_LABELS, buildMonthGrid, monthLabel } from '@/lib/leaveCalendar';
import type { CalendarDayEntry } from '@/lib/leaveCalendar';

const MAX_VISIBLE_CHIPS = 3;

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
    <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-3xl p-4" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-[0.24em]">Leave Calendar</p>
          <h2 className="text-[var(--text-primary)] font-semibold text-lg">{monthLabel(monthKey)}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next month"
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0 border-t border-l border-[var(--border)] text-[11px] text-[var(--text-muted)]">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="border-b border-r border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-center font-semibold uppercase tracking-[0.12em]">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0 border-t border-l border-[var(--border)] rounded-3xl overflow-hidden">
        {cells.map(({ date, inMonth }) => {
          const entries = dayMap.get(date) ?? [];
          const holidayNames = holidaysByDate.get(date);
          const isToday = date === todayYMD;
          const visible = entries.slice(0, MAX_VISIBLE_CHIPS);
          const overflow = entries.length - visible.length;

          return (
            <button
              key={date}
              type="button"
              onClick={() => onDayClick(date)}
              className={`group border-b border-r border-[var(--border)] p-3 text-left transition-colors ${
                inMonth
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                  : 'bg-[var(--bg-elevated)]/30 text-[var(--text-muted)]/60 hover:bg-[var(--bg-elevated)]/50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-2xl font-semibold ${
                    isToday
                      ? 'bg-[var(--accent)] text-white shadow-sm ring-2 ring-[var(--accent)]/40 ring-offset-2 ring-offset-[var(--bg-surface)]'
                      : inMonth
                      ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                      : 'bg-transparent text-[var(--text-muted)]/50'
                  }`}
                >
                  {Number(date.slice(8, 10))}
                </span>
                {isToday && (
                  <span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                    Today
                  </span>
                )}
                {holidayNames && holidayNames.length > 0 && (
                  <span
                    title={holidayNames.join(', ')}
                    className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500"
                  >
                    {holidayNames[0]}
                  </span>
                )}
              </div>

              <div className="mt-3 space-y-2">
                {visible.map((entry) => (
                  <div
                    key={entry.employeeId}
                    title={`${entry.employeeName} — ${entry.label}${entry.status === 'pending' ? ' (pending)' : ''}`}
                    className={`flex items-center justify-between gap-3 rounded-2xl border px-2 py-1 text-[11px] ${
                      entry.status === 'pending'
                        ? 'border-dashed border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]'
                        : entry.status === 'unrecorded'
                        ? 'border-dotted border-amber-400/50 bg-amber-100/30 text-amber-700'
                        : 'border-[var(--border)] bg-[var(--bg-elevated)]'
                    }`}
                  >
                    <span className="font-semibold">{initials(entry.employeeName)}</span>
                    <span className="truncate text-[10px] text-[var(--text-muted)]">{entry.label}</span>
                  </div>
                ))}
                {overflow > 0 && (
                  <span className="inline-flex items-center rounded-full bg-[var(--bg-elevated)]/80 px-2 py-1 text-[11px] font-medium text-[var(--text-primary)]">
                    +{overflow} more
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

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 pt-3 border-t border-[var(--border)] text-[11px] text-[var(--text-muted)]">
      <LegendItem swatchClass="bg-[var(--accent)]/20 text-[var(--accent)]" label="Planned Leave" />
      <LegendItem swatchClass="bg-cyan-500/20 text-cyan-400" label="Casual Leave" />
      <LegendItem swatchClass="bg-violet-500/20 text-violet-400" label="Sick Leave" />
      <LegendItem swatchClass="bg-orange-500/20 text-orange-400" label="LWP" />
      <LegendItem swatchClass="bg-amber-500/20 text-amber-400" label="Half day / missed punch" />
      <LegendItem swatchClass="bg-red-500/20 text-red-400" label="Unrecorded absence" />
      <span className="flex items-center gap-1">
        <span className="w-3 h-3 rounded-full border border-dashed border-[var(--border)]" /> Pending approval
      </span>
    </div>
  );
}

function LegendItem({ swatchClass, label }: { swatchClass: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`w-3 h-3 rounded-full ${swatchClass}`} />
      {label}
    </span>
  );
}
