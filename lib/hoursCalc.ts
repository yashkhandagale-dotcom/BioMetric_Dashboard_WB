// Single source of truth for turning a raw CSV punch duration into the two
// figures the dashboard displays wherever "hours worked" appears:
//
//   - Actual Hours    = the raw in/out punch duration, lunch included.
//   - Effective Hours = raw duration minus the portion of the 13:00–14:00
//     lunch window the employee was actually on-site for.
//
//     If an employee punched out before 13:00 they never overlapped with
//     lunch at all — no deduction.  If they left at 13:30 only 30 min is
//     deducted.  Only someone who stayed until 14:00 or later gets the full
//     60-min deduction.
//
// lib/useDashboardData.ts, components/Charts.tsx's HoursDistributionChart,
// and lib/exportData.ts's Executive Summary each used to keep their own
// inline copy of the "> 60 ? raw-60 : ..." rule. That duplication had
// already drifted once (lib/exportData.ts's Department Summary sheet ended
// up using plain raw duration with no lunch subtraction, silently
// disagreeing with the Executive Summary tab in the same export file). This
// module is now the only place that rule is allowed to live — every
// consumer should import effectiveMinutes()/actualMinutes() from here
// rather than re-deriving the subtraction itself.

// Lunch window constants (minutes from midnight)
const LUNCH_START = 13 * 60; // 13:00
const LUNCH_END   = 14 * 60; // 14:00

/**
 * Returns how many minutes of the lunch window [13:00–14:00] overlap with
 * the employee's actual punch window [inTimeMins, outTimeMins].
 *
 * Examples:
 *   In 09:30  Out 12:30 → 0 min   (left before lunch)
 *   In 09:30  Out 13:30 → 30 min  (left mid-lunch)
 *   In 09:30  Out 18:30 → 60 min  (full lunch deducted)
 *   In 13:15  Out 18:30 → 45 min  (arrived during lunch)
 */
export function lunchOverlapMinutes(inTimeMins: number, outTimeMins: number): number {
  const overlapStart = Math.max(inTimeMins,  LUNCH_START);
  const overlapEnd   = Math.min(outTimeMins, LUNCH_END);
  return Math.max(0, overlapEnd - overlapStart);
}

/**
 * Parses a "HH:MM" or "H:MM" time string to minutes from midnight.
 * Returns -1 if the string is absent or unparseable.
 */
export function timeToMins(t: string | undefined | null): number {
  if (!t) return -1;
  const parts = t.trim().split(':');
  if (parts.length < 2) return -1;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

/**
 * Effective minutes worked for a single day: raw duration minus the actual
 * overlap with the 13:00–14:00 lunch window.
 *
 * @param rawMinutes  Raw punch duration (outTime − inTime) in minutes.
 * @param outTime     Punch-out time string, e.g. "12:45" or "18:30".
 *                    When provided, the lunch deduction is based on real
 *                    overlap with [13:00, 14:00] — so if an employee left
 *                    before 1 PM, no lunch is deducted at all.
 * @param inTime      Punch-in time string. When omitted, derived as
 *                    (outTimeMins − rawMinutes).
 *
 * Returns `null` for records with no meaningful duration (rawMinutes ≤ 0).
 * Callers should exclude null results from averages rather than treating
 * them as 0 h worked.
 *
 * Legacy callers that pass only rawMinutes receive the old flat-60 rule
 * (subtract 60 if worked > 60) for backward compatibility.
 */
export function effectiveMinutes(
  rawMinutes: number,
  outTime?: string,
  inTime?: string,
): number | null {
  if (rawMinutes <= 0) return null;

  let lunchMins: number;

  const outMins = timeToMins(outTime);
  if (outMins >= 0) {
    // We have a real out-time — compute actual lunch overlap.
    const inMins =
      timeToMins(inTime) >= 0
        ? timeToMins(inTime)!
        : outMins - rawMinutes;
    lunchMins = lunchOverlapMinutes(inMins, outMins);
  } else {
    // Legacy flat rule: subtract 60 only if worked > 60 min.
    lunchMins = rawMinutes > 60 ? 60 : 0;
  }

  const effective = rawMinutes - lunchMins;
  return effective > 0 ? effective : null;
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

export function HalfdayMinutes(rawMinutes: number): number {
  if (rawMinutes < 300) {
    return rawMinutes - 300;
  }
  return rawMinutes;
}