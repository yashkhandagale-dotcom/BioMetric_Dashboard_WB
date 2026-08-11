'use client';

// Global duration selector — sits above every chart and decides which
// window of records flows into useDashboardData() (and therefore into every
// chart on the page). This doesn't replace the existing From/To date
// inputs in DashboardClient — it wraps them with one-click presets, and
// stays in sync with them: picking a preset sets dateFrom/dateTo exactly
// like typing dates manually would, and manually editing either date input
// should call `onManualEdit()` so the active preset clears back to "Custom"
// (handled by the caller, not this component, since it doesn't own the
// input markup).
export type DurationPreset = 'month' | '3m' | '6m' | '12m' | 'custom';

const PRESETS: { key: DurationPreset; label: string; days: number | null }[] = [
  { key: 'month', label: 'This Month', days: 30 },
  { key: '3m', label: '3 Months', days: 90 },
  { key: '6m', label: '6 Months', days: 180 },
  { key: '12m', label: '12 Months', days: 365 },
  { key: 'custom', label: 'Custom', days: null },
];

function shiftDateISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function DurationControl({
  minAvailableDate,
  maxAvailableDate,
  activePreset,
  onApplyPreset,
}: {
  minAvailableDate?: string;
  maxAvailableDate?: string;
  activePreset: DurationPreset;
  /** Called with (from, to) for a day/date preset, or (null, null) for Custom (leaves current From/To as-is). */
  onApplyPreset: (preset: DurationPreset, from: string | null, to: string | null) => void;
}) {
  if (!minAvailableDate || !maxAvailableDate) return null;

  function apply(preset: (typeof PRESETS)[number]) {
    if (preset.days === null) {
      onApplyPreset('custom', null, null);
      return;
    }
    const to = maxAvailableDate as string;
    const wanted = shiftDateISO(to, -(preset.days - 1));
    const from = wanted < (minAvailableDate as string) ? (minAvailableDate as string) : wanted;
    onApplyPreset(preset.key, from, to);
  }

  return (
    <div
      className="flex items-center gap-1 flex-wrap bg-[var(--bg-elevated)]/60 border border-[var(--border)] rounded-lg px-1.5 py-1.5"
      role="group"
      aria-label="Duration presets"
    >
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => apply(p)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            activePreset === p.key
              ? 'bg-blue-600 text-white'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
