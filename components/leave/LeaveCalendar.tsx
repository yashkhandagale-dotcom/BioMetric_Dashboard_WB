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
    <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={() => shift(-1)}
          aria-label="Previous month"
          className="p-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <h2 className="text-white font-semibold text-sm">{monthLabel(monthKey)}</h2>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label="Next month"
          className="p-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px bg-slate-800 rounded-lg overflow-hidden text-[11px] text-slate-500 mb-px">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="bg-slate-900 px-2 py-1.5 text-center font-medium">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px bg-slate-800 rounded-lg overflow-hidden">
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
              className={`bg-slate-900 min-h-[92px] p-1.5 text-left flex flex-col gap-1 transition-colors hover:bg-slate-800 ${
                inMonth ? '' : 'opacity-40'
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs ${
                    isToday
                      ? 'bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center font-semibold'
                      : 'text-slate-400'
                  }`}
                >
                  {Number(date.slice(8, 10))}
                </span>
                {holidayNames && holidayNames.length > 0 && (
                  <span
                    title={holidayNames.join(', ')}
                    className="text-[9px] text-slate-500 truncate max-w-[52px]"
                  >
                    {holidayNames[0]}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-1">
                {visible.map((entry) => (
                  <span
                    key={entry.employeeId}
                    title={`${entry.employeeName} — ${entry.label}${entry.status === 'pending' ? ' (pending)' : ''}`}
                    className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] leading-none ${entry.colorClass} ${
                      entry.status === 'pending' ? 'border border-dashed border-current' : ''
                    } ${entry.status === 'unrecorded' ? 'border border-dotted border-current' : ''}`}
                  >
                    {initials(entry.employeeName)}
                  </span>
                ))}
                {overflow > 0 && (
                  <span className="text-[9px] text-slate-500 self-center">+{overflow} more</span>
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
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-500">
      <LegendItem swatchClass="bg-blue-500/20 text-blue-400" label="Planned Leave" />
      <LegendItem swatchClass="bg-cyan-500/20 text-cyan-400" label="Casual Leave" />
      <LegendItem swatchClass="bg-violet-500/20 text-violet-400" label="Sick Leave" />
      <LegendItem swatchClass="bg-orange-500/20 text-orange-400" label="LWP" />
      <LegendItem swatchClass="bg-amber-500/20 text-amber-400" label="Half day / missed punch" />
      <LegendItem swatchClass="bg-red-500/20 text-red-400" label="Unrecorded absence" />
      <span className="flex items-center gap-1">
        <span className="w-3 h-3 rounded-full border border-dashed border-slate-400" /> Pending approval
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
