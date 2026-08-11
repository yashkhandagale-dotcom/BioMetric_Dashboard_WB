// The WonderBiz leave cycle runs 25-Mar to 24-Mar next year, NOT a
// calendar year and NOT 1-Apr. Every place that needs "which FY are we
// in" (balance lookups, pro-ration, annual reset) must use this — do not
// re-derive it inline, that's how the 25th-vs-1st mismatch bugs happen.

/** Returns the FY key (the year the cycle STARTS) for a given date. */
export function getFYStartYear(date: Date = new Date()): number {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12
  const day = date.getDate();

  const isBeforeCycleStart = month < 3 || (month === 3 && day < 25);
  return isBeforeCycleStart ? year - 1 : year;
}

/** Human label, e.g. "FY 2025-26" for fy_start_year = 2025. */
export function formatFYLabel(fyStartYear: number): string {
  return `FY ${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;
}