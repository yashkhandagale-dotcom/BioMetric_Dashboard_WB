import type { SupabaseClient } from '@supabase/supabase-js';
import { getPredefinedHolidays } from '@/lib/predefinedHolidays';
import { selectAllRows } from '@/lib/attendanceExceptions';
import { addDays } from './calendar';

export interface HolidayDetail {
  date: string;
  name: string;
  office: string;
  source: 'predefined' | 'custom';
}

export interface OfficeHolidayData {
  office: string;
  holidayDates: Set<string>;
  holidayNames: Map<string, string>; // date -> name
  holidaysList: HolidayDetail[];
  missingYears: number[];
}

export interface ResolvedHolidays {
  byOffice: Map<string, OfficeHolidayData>;
  missingWarnings: Array<{ office: string; year: number; message: string }>;
  allOffices: string[];
}

export interface CustomHolidayRow {
  office_code: string;
  date: string;
  name: string;
  year?: string | number;
}

/**
 * Pure builder that merges predefined holidays with custom holidays for a list of offices and years.
 * Testable without database access.
 */
export function buildOfficeHolidays(
  offices: string[],
  years: number[],
  customHolidays: CustomHolidayRow[]
): ResolvedHolidays {
  const byOffice = new Map<string, OfficeHolidayData>();
  const missingWarnings: Array<{ office: string; year: number; message: string }> = [];

  for (const office of offices) {
    const holidayDates = new Set<string>();
    const holidayNames = new Map<string, string>();
    const holidaysList: HolidayDetail[] = [];
    const missingYears: number[] = [];

    for (const year of years) {
      let countForYear = 0;

      // 1. Predefined holidays
      const predefined = getPredefinedHolidays(office, year);
      for (const h of predefined) {
        holidayDates.add(h.date);
        holidayNames.set(h.date, h.name);
        holidaysList.push({
          date: h.date,
          name: h.name,
          office,
          source: 'predefined',
        });
        countForYear++;
      }

      // 2. Custom holidays
      const customs = customHolidays.filter(
        (ch) =>
          ch.office_code.toUpperCase() === office.toUpperCase() &&
          (ch.date.startsWith(`${year}-`) || String(ch.year) === String(year))
      );
      for (const ch of customs) {
        holidayDates.add(ch.date);
        holidayNames.set(ch.date, ch.name);
        holidaysList.push({
          date: ch.date,
          name: ch.name,
          office,
          source: 'custom',
        });
        countForYear++;
      }

      // 3. Track years with 0 holidays
      if (countForYear === 0) {
        missingYears.push(year);
        missingWarnings.push({
          office,
          year,
          message: `Holiday data for ${year} is missing for ${office}; results may be incomplete.`,
        });
      }
    }

    // Sort list by date ascending
    holidaysList.sort((a, b) => a.date.localeCompare(b.date));

    byOffice.set(office, {
      office,
      holidayDates,
      holidayNames,
      holidaysList,
      missingYears,
    });
  }

  return {
    byOffice,
    missingWarnings,
    allOffices: offices,
  };
}

/**
 * Resolves holidays for the analysis window (startDate - 14 days to endDate + 14 days).
 * Fetches custom_holidays using selectAllRows and returns per-office holiday datasets.
 */
export async function resolveHolidaysForWindow(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string,
  specifiedOffices?: string[]
): Promise<ResolvedHolidays> {
  const windowStart = addDays(startDate, -14);
  const windowEnd = addDays(endDate, 14);

  const startYear = parseInt(windowStart.slice(0, 4), 10);
  const endYear = parseInt(windowEnd.slice(0, 4), 10);
  const years: number[] = [];
  for (let y = startYear; y <= endYear; y++) {
    years.push(y);
  }

  // Determine offices to include
  let officeCodes = specifiedOffices ? specifiedOffices.map((o) => o.toUpperCase()) : [];
  if (officeCodes.length === 0) {
    // Read from canonical offices / employees
    const { data: empOffices } = await supabase
      .from('employees')
      .select('office')
      .eq('is_deleted', false);
    if (empOffices && empOffices.length > 0) {
      officeCodes = Array.from(new Set(empOffices.map((e) => e.office?.toUpperCase()).filter(Boolean)));
    }
  }

  if (officeCodes.length === 0) {
    officeCodes = ['MUM', 'HYD'];
  }

  // Query custom_holidays for all years in window
  const yearStrings = years.map(String);
  const { data: customHolidays, error } = await selectAllRows<CustomHolidayRow>((from, to) =>
    supabase
      .from('custom_holidays')
      .select('office_code, date, name, year')
      .or(`year.in.(${yearStrings.join(',')}),date.gte.${windowStart},date.lte.${windowEnd}`)
      .range(from, to)
  );

  if (error) {
    console.error('Failed to load custom holidays:', error.message);
  }

  return buildOfficeHolidays(officeCodes, years, customHolidays ?? []);
}
