// Single source of truth for turning a raw CSV punch duration into the two
// figures the dashboard displays wherever "hours worked" appears:
//
//   - Actual Hours    = the raw in/out punch duration, lunch included.
//   - Effective Hours = raw duration minus a 60-minute lunch — but only
//     when the raw duration is > 60 minutes. Days at/under 60 minutes have
//     no meaningful "effective" figure and are excluded from effective-hours
//     averages entirely (they are NOT counted as 0h); this matches the
//     Executive Summary / dashboard KPI / Hours Distribution chart behavior
//     that existed before this file did.
//
// lib/useDashboardData.ts, components/Charts.tsx's HoursDistributionChart,
// and lib/exportData.ts's Executive Summary each used to keep their own
// inline copy of this ">60 ? raw-60 : ..." rule. That duplication had
// already drifted once (lib/exportData.ts's Department Summary sheet ended
// up using plain raw duration with no lunch subtraction, silently
// disagreeing with the Executive Summary tab in the same export file). This
// module is now the only place that rule is allowed to live — every
// consumer should import effectiveMinutes()/actualMinutes() from here
// rather than re-deriving the subtraction itself.

/**
 * Effective minutes worked for a single day: raw duration minus a 60-minute
 * lunch, or `null` when the raw duration is at or below 60 minutes (not
 * enough data to meaningfully subtract a lunch — the day should be excluded
 * from "effective hours" averages, not treated as 0 minutes worked).
 */
export function effectiveMinutes(rawMinutes: number): number | null {
  return rawMinutes > 60 ? rawMinutes - 60 : null;
}

/**
 * Actual minutes worked for a single day: the raw punch duration, lunch
 * included, unchanged. Exists mainly so call sites can pair it visually
 * and semantically with effectiveMinutes() rather than reaching for the
 * raw duration value directly.
 */
export function actualMinutes(rawMinutes: number): number {
  return rawMinutes;
}
