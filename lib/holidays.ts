import { Holiday } from './types';
import { getPredefinedHolidays } from './predefinedHolidays';
import { createClient } from './supabase/client';

export function getHolidayKey(officeCode: string, year: string | number): string {
  return `holidays_${officeCode}_${year}`;
}

// Custom holidays are the only thing actually persisted — extra dates HR
// adds on top of the predefined office calendar (e.g. an office-specific
// closure, a regional festival not in the master list). Predefined holidays
// are never written to the DB; they always come live from
// lib/predefinedHolidays.ts so updating the master list instantly applies to
// every saved month without any migration.
async function getCustomHolidays(officeCode: string, year: string | number): Promise<Holiday[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('custom_holidays')
    .select('date, name')
    .eq('office_code', officeCode)
    .eq('year', String(year));
  return (data ?? []).map((h) => ({ date: h.date, name: h.name, source: 'custom' as const }));
}

// Merged, de-duplicated (predefined wins on date clash), sorted list — this
// is what every chart/KPI/table in the dashboard should use.
export async function getHolidays(officeCode: string, year: string | number): Promise<Holiday[]> {
  const predefined = getPredefinedHolidays(officeCode, year);
  const predefinedDates = new Set(predefined.map((h) => h.date));
  const custom = (await getCustomHolidays(officeCode, year)).filter((h) => !predefinedDates.has(h.date));
  return [...predefined, ...custom].sort((a, b) => a.date.localeCompare(b.date));
}

// Only ever persists the custom (HR-added) holidays — predefined ones are
// never written to the DB since they're not "owned" by this workspace's data.
export async function saveHolidays(
  officeCode: string,
  year: string | number,
  holidays: Holiday[]
): Promise<void> {
  const supabase = createClient();
  const customOnly = holidays.filter((h) => h.source !== 'predefined');
  // Replace-all-for-office-year: simplest way to keep the DB in sync with
  // whatever the Holidays modal is showing (adds + removals in one save).
  await supabase
    .from('custom_holidays')
    .delete()
    .eq('office_code', officeCode)
    .eq('year', String(year));
  if (customOnly.length > 0) {
    await supabase.from('custom_holidays').insert(
      customOnly.map((h) => ({ office_code: officeCode, year: String(year), date: h.date, name: h.name }))
    );
  }
}

export function isHoliday(date: string, holidays: Holiday[]): boolean {
  return holidays.some((h) => h.date === date);
}

export function getHolidayName(date: string, holidays: Holiday[]): string | undefined {
  return holidays.find((h) => h.date === date)?.name;
}
