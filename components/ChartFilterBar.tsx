'use client';

import { Search, ChevronDown, ChevronUp, X } from 'lucide-react';

// Local, per-chart filter row for entity-heavy charts (department drill-downs,
// the attendance heatmap's employee axis, etc). Pairs with
// `useEntityChartLayout` in lib/chartLayout.ts — this component is purely
// presentational, all the counting/capping logic lives in that hook so every
// chart that uses it behaves identically.
export default function ChartFilterBar({
  query,
  onQueryChange,
  totalCount,
  matchedCount,
  hiddenCount,
  isExpanded,
  onToggleExpanded,
  entityLabel = 'employees',
  placeholder,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  totalCount: number;
  matchedCount: number;
  hiddenCount: number;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  entityLabel?: string;
  placeholder?: string;
}) {
  const isSearching = query.trim().length > 0;
  const canCollapse = isExpanded && !isSearching && totalCount > 15;

  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      <div className="relative flex-1 min-w-[140px] max-w-[220px]">
        <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder ?? `Search ${entityLabel}…`}
          className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-xs text-[var(--text-primary)] pl-7 pr-6 py-1.5 focus:outline-none focus:border-blue-500 placeholder:text-[var(--text-muted)]"
        />
        {isSearching && (
          <button
            onClick={() => onQueryChange('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <span className="text-[var(--text-muted)] text-[11px] whitespace-nowrap">
        {isSearching
          ? `${matchedCount} of ${totalCount} match`
          : `${totalCount} ${entityLabel}`}
      </span>

      {(hiddenCount > 0 || canCollapse) && (
        <button
          onClick={onToggleExpanded}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors ml-auto"
        >
          {hiddenCount > 0 ? (
            <>Show all {matchedCount} <ChevronDown className="w-3 h-3" /></>
          ) : (
            <>Show top 15 <ChevronUp className="w-3 h-3" /></>
          )}
        </button>
      )}
    </div>
  );
}
