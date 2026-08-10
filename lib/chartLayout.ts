// Shared layout/aggregation logic for trend charts (DailyTrendChart,
// ComparisonTrendChart) so they stay readable regardless of how many days
// are selected — a fixed-width ResponsiveContainer squeezes every point
// into the same pixel width, which is unreadable past ~1-2 months. This
// module fixes that with two mechanisms, combined:
//
//   1. Below the "daily" threshold, the chart still plots one point per
//      day, but the container grows (horizontal scroll) instead of
//      squeezing — same pattern already used by the attendance heatmap.
//   2. Past the threshold, points are aggregated into weekly, then
//      monthly, buckets so the chart stays readable even at a full year
//      of data instead of scrolling indefinitely.
//
// Any new trend chart should use `useTrendChartLayout` instead of wiring
// width/interval logic by hand, so this fix doesn't need to be
// re-discovered per chart.

import { useMemo, useState } from 'react';

export type TrendGranularity = 'daily' | 'weekly' | 'monthly';

// Approximate px needed per data point to keep labels legible at each
// granularity (wider buckets need more room for their label).
const DAILY_POINT_WIDTH = 34;
const WEEKLY_POINT_WIDTH = 70;
const MONTHLY_POINT_WIDTH = 90;
const MIN_CHART_WIDTH = 320;

// Past this many daily points, auto-switch to weekly buckets.
export const DAILY_TO_WEEKLY_THRESHOLD = 45; // ~1.5 months
// Past this many daily points, auto-switch to monthly buckets.
export const WEEKLY_TO_MONTHLY_THRESHOLD = 180; // ~6 months

export function pickGranularity(dailyPointCount: number): TrendGranularity {
  if (dailyPointCount > WEEKLY_TO_MONTHLY_THRESHOLD) return 'monthly';
  if (dailyPointCount > DAILY_TO_WEEKLY_THRESHOLD) return 'weekly';
  return 'daily';
}

export function chartMinWidth(pointCount: number, granularity: TrendGranularity): number {
  const pointWidth =
    granularity === 'monthly' ? MONTHLY_POINT_WIDTH :
    granularity === 'weekly' ? WEEKLY_POINT_WIDTH :
    DAILY_POINT_WIDTH;
  return Math.max(MIN_CHART_WIDTH, Math.round(pointCount * pointWidth));
}

function isoWeekKey(rawDate: string): string {
  const d = new Date(rawDate + 'T00:00:00');
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  target.setDate(target.getDate() - dayNr + 3); // Thursday of this ISO week
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstThursdayDayNr = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstThursdayDayNr + 3);
  const week = 1 + Math.round((target.valueOf() - firstThursday.valueOf()) / (7 * 86400000));
  return `${target.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function weekLabel(rawDate: string): string {
  const d = new Date(rawDate + 'T00:00:00');
  // Label with the Monday of that week, e.g. "Wk 12-May"
  const dayNr = (d.getDay() + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - dayNr);
  return `Wk ${monday.toLocaleDateString('en-US', { day: '2-digit', month: 'short' })}`;
}

function monthBucketKey(rawDate: string): string {
  return rawDate.slice(0, 7); // YYYY-MM
}

function monthLabel(rawDate: string): string {
  const d = new Date(rawDate + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

// Deliberately no index signature here — real row types like `DailyTrend`
// don't have one, and requiring it would force every caller to widen their
// type. Field access for aggregation happens through a `Record<string,
// unknown>` cast internally instead.
export interface AggregatableRow {
  rawDate?: string;
  date: string;
}

/**
 * Buckets rows by ISO week or calendar month (keyed off `rawDate`,
 * expected as YYYY-MM-DD). `averageKeys` are averaged per bucket (use for
 * rates/percentages); `sumKeys` are summed (use for counts). Any other
 * field is taken from the bucket's first row. Rows missing `rawDate` are
 * dropped when aggregating (daily passthrough is unaffected).
 */
export function aggregateTrend<T extends AggregatableRow>(
  rows: T[],
  granularity: TrendGranularity,
  averageKeys: string[],
  sumKeys: string[] = []
): T[] {
  if (granularity === 'daily') return rows;

  const keyFn = granularity === 'weekly' ? isoWeekKey : monthBucketKey;
  const labelFn = granularity === 'weekly' ? weekLabel : monthLabel;
  const buckets = new Map<string, T[]>();

  for (const row of rows) {
    if (!row.rawDate) continue;
    const key = keyFn(row.rawDate);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(row);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, bucketRows]) => {
      const asRecord = (r: T) => r as unknown as Record<string, unknown>;
      const merged: Record<string, unknown> = {
        ...asRecord(bucketRows[0]),
        date: labelFn(bucketRows[0].rawDate as string),
        rawDate: bucketRows[0].rawDate,
        // Aggregated points can't map back to a single day's absentee list.
        absentees: [],
        __bucketSize: bucketRows.length,
      };
      for (const k of averageKeys) {
        const vals = bucketRows.map(r => Number(asRecord(r)[k]) || 0);
        merged[k] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      }
      for (const k of sumKeys) {
        merged[k] = bucketRows.reduce((a, r) => a + (Number(asRecord(r)[k]) || 0), 0);
      }
      return merged as unknown as T;
    });
}

export interface TrendChartLayout<T> {
  data: T[];
  granularity: TrendGranularity;
  minWidth: number;
  /** True once the point count is large enough that per-point interactions
   * (click-to-drill-into-a-day) no longer make sense — each rendered point
   * represents a range of days, not one day. */
  isAggregated: boolean;
}

/**
 * Central layout hook for trend charts. `forceGranularity` lets a chart
 * offer a manual Daily/Weekly/Monthly toggle; when omitted, granularity is
 * picked automatically from the row count.
 */
export function useTrendChartLayout<T extends AggregatableRow>(
  rows: T[],
  opts: { averageKeys: string[]; sumKeys?: string[]; forceGranularity?: TrendGranularity | null }
): TrendChartLayout<T> {
  const { averageKeys, sumKeys, forceGranularity } = opts;
  return useMemo(() => {
    const granularity = forceGranularity ?? pickGranularity(rows.length);
    const data = aggregateTrend(rows, granularity, averageKeys, sumKeys ?? []);
    const minWidth = chartMinWidth(data.length, granularity);
    return { data, granularity, minWidth, isAggregated: granularity !== 'daily' };
  }, [rows, averageKeys, sumKeys, forceGranularity]);
}

/** Small Daily/Weekly/Monthly toggle. Pass `null` for "Auto". */
export function useGranularityOverride() {
  const [override, setOverride] = useState<TrendGranularity | null>(null);
  return { override, setOverride } as const;
}

// ═══════════════════════════════════════════════════════════════════════════
// Entity/ranking chart layout — for per-employee (or any per-entity) bar
// charts and lists whose row COUNT, not date range, is what can blow up
// (department drill-downs, the attendance heatmap's employee axis, etc).
// These previously sized their container as `rows.length * rowHeight` with
// no ceiling — fine for a 20-person department, unreadable and slow once an
// org/drilldown has hundreds of rows.
//
// Same two-mechanism approach as the trend-chart layout above, adapted for
// entities instead of dates:
//   1. Below ENTITY_DEFAULT_VISIBLE, show everything — no controls needed.
//   2. Past it, default to the top N (whatever order the caller already
//      sorted by — worst/best/A-Z), with a "Show all" expand. Once
//      expanded (or once a search narrows the set), the container's natural
//      height is used but the outer wrapper caps out at
//      ENTITY_MAX_WRAPPER_HEIGHT with internal scroll — bars stay a normal
//      thickness instead of being squeezed to fit, and the page itself
//      never grows to thousands of pixels tall.
// ═══════════════════════════════════════════════════════════════════════════

const ENTITY_DEFAULT_VISIBLE = 15;
const ENTITY_ROW_HEIGHT = 36; // px per row — matches the bar height already used by employee-level drilldowns
const ENTITY_MIN_HEIGHT = 200;
export const ENTITY_MAX_WRAPPER_HEIGHT = 640; // cap on the scrollable wrapper, not on the chart itself

export interface EntityChartLayout<T> {
  /** Rows to actually render this pass (already filtered + capped as needed). */
  visibleRows: T[];
  /** How many rows matched the current search but aren't shown (0 once expanded). */
  hiddenCount: number;
  /** Total rows before search filtering (for "N employees" labels). */
  totalCount: number;
  /** Total rows after search filtering. */
  matchedCount: number;
  isExpanded: boolean;
  toggleExpanded: () => void;
  query: string;
  setQuery: (q: string) => void;
  /** Full height the chart/list needs for `visibleRows.length` rows — pass to ResponsiveContainer/list height. */
  contentHeight: number;
  /** Cap for the *wrapping* scrollable div — always ENTITY_MAX_WRAPPER_HEIGHT, exported for convenience. */
  maxWrapperHeight: number;
  /** True once contentHeight exceeds maxWrapperHeight, i.e. the wrapper will actually scroll. */
  willScroll: boolean;
}

/**
 * `rows` should already be sorted the way the chart wants (worst-first,
 * A-Z, etc.) — this hook only decides how many to show and whether a
 * search query is active, it never re-sorts.
 */
export function useEntityChartLayout<T>(
  rows: T[],
  opts: { getLabel: (row: T) => string; defaultVisible?: number; rowHeight?: number }
): EntityChartLayout<T> {
  const { getLabel, defaultVisible = ENTITY_DEFAULT_VISIBLE, rowHeight = ENTITY_ROW_HEIGHT } = opts;
  const [isExpanded, setIsExpanded] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => getLabel(r).toLowerCase().includes(q));
  }, [rows, query, getLabel]);

  const isSearching = query.trim().length > 0;
  const visibleRows = isExpanded || isSearching ? filtered : filtered.slice(0, defaultVisible);
  const hiddenCount = Math.max(0, filtered.length - visibleRows.length);
  const contentHeight = Math.max(ENTITY_MIN_HEIGHT, visibleRows.length * rowHeight);

  return {
    visibleRows,
    hiddenCount,
    totalCount: rows.length,
    matchedCount: filtered.length,
    isExpanded,
    toggleExpanded: () => setIsExpanded((e) => !e),
    query,
    setQuery,
    contentHeight,
    maxWrapperHeight: ENTITY_MAX_WRAPPER_HEIGHT,
    willScroll: contentHeight > ENTITY_MAX_WRAPPER_HEIGHT,
  };
}
