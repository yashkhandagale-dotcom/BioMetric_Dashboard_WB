'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DayNavProps } from './chartUtils';

// Small prev/next day control embedded in the header of the "today" charts.
// Lets a user step through individual days without leaving Single Day view.
export function DayNav({ date, onPrevDay, onNextDay, canGoPrev, canGoNext }: DayNavProps) {
  if (!date || (!onPrevDay && !onNextDay)) return null;
  const label = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return (
    <div className="flex items-center gap-0.5 ml-auto flex-shrink-0">
      <button
        onClick={onPrevDay}
        disabled={!canGoPrev}
        title="Previous day"
        className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      <span className="text-[var(--text-muted)] text-[11px] font-medium w-14 text-center">{label}</span>
      <button
        onClick={onNextDay}
        disabled={!canGoNext}
        title="Next day"
        className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function ChartSubtitle({ selectedDepts }: { selectedDepts?: string[] }) {
  if (!selectedDepts) return null;
  const label = selectedDepts.length === 0 ? 'All Departments' : selectedDepts.join(', ');
  return <p className="text-[var(--text-muted)] text-xs mt-0.5 mb-3"><span className="text-[var(--text-muted)]">{label}</span></p>;
}

export type TrendGranularityLocal = import('@/lib/chartLayout').TrendGranularity;

export function GranularityToggle({ value, onChange, active }: {
  value: import('@/lib/chartLayout').TrendGranularity | null;
  onChange: (v: import('@/lib/chartLayout').TrendGranularity | null) => void;
  active: import('@/lib/chartLayout').TrendGranularity;
}) {
  const options: { key: import('@/lib/chartLayout').TrendGranularity | null; label: string }[] = [
    { key: null, label: 'Auto' },
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
  ];
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {options.map(o => (
        <button
          key={o.label}
          onClick={() => onChange(o.key)}
          title={o.key === null ? `Auto (currently ${active})` : undefined}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
            value === o.key
              ? 'bg-[var(--accent)] text-white shadow-sm font-semibold'
              : 'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/40'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

import type { SortMode } from './chartUtils';

export function SortToggle({ mode, onChange }: { mode: SortMode; onChange: (m: SortMode) => void }) {
  const options: { key: SortMode; label: string }[] = [
    { key: 'default', label: 'Default' },
    { key: 'worst', label: 'Worst → Best' },
    { key: 'best', label: 'Best → Worst' },
    { key: 'az', label: 'A → Z' },
  ];
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
            mode === o.key
              ? 'bg-[var(--accent)] text-white shadow-sm font-semibold'
              : 'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/40'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
