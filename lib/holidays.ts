import { Holiday } from './types';
import { getPredefinedHolidays } from './predefinedHolidays';

export function getHolidayKey(officeCode: string, year: string | number): string {
  return `holidays_${officeCode}_${year}`;
}

// Custom holidays are the only thing actually stored in localStorage —
// these are extra dates HR adds on top of the predefined office calendar
// (e.g. an office-specific closure, a regional festival not in the master
// list, etc). Predefined holidays are never written to storage; they always
// come live from lib/predefinedHolidays.ts so updating the master list
// instantly applies to every saved month without any migration.
function getCustomHolidays(officeCode: string, year: string | number): Holiday[] {
  try {
    const key = getHolidayKey(officeCode, year);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: Holiday[] = JSON.parse(raw);
    // Backward-compat: holidays saved before predefined lists existed have
    // no `source` field. Treat anything without it as custom.
    return parsed.filter(h => h.source !== 'predefined').map(h => ({ ...h, source: 'custom' as const }));
  } catch {
    return [];
  }
}

// Merged, de-duplicated (predefined wins on date clash), sorted list — this
// is what every chart/KPI/table in the dashboard should use.
export function getHolidays(officeCode: string, year: string | number): Holiday[] {
  const predefined = getPredefinedHolidays(officeCode, year);
  const predefinedDates = new Set(predefined.map(h => h.date));
  const custom = getCustomHolidays(officeCode, year).filter(h => !predefinedDates.has(h.date));
  return [...predefined, ...custom].sort((a, b) => a.date.localeCompare(b.date));
}

// Only ever persists the custom (HR-added) holidays — predefined ones are
// never written to storage since they're not "owned" by this browser's data.
export function saveHolidays(officeCode: string, year: string | number, holidays: Holiday[]): void {
  try {
    const key = getHolidayKey(officeCode, year);
    const customOnly = holidays.filter(h => h.source !== 'predefined');
    localStorage.setItem(key, JSON.stringify(customOnly));
  } catch {
    // ignore
  }
}

export function isHoliday(date: string, holidays: Holiday[]): boolean {
  return holidays.some(h => h.date === date);
}

export function getHolidayName(date: string, holidays: Holiday[]): string | undefined {
  return holidays.find(h => h.date === date)?.name;
}
