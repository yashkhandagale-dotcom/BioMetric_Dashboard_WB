import { Holiday } from './types';

export function getHolidayKey(officeCode: string, year: string | number): string {
  return `holidays_${officeCode}_${year}`;
}

export function getHolidays(officeCode: string, year: string | number): Holiday[] {
  try {
    const key = getHolidayKey(officeCode, year);
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveHolidays(officeCode: string, year: string | number, holidays: Holiday[]): void {
  try {
    const key = getHolidayKey(officeCode, year);
    localStorage.setItem(key, JSON.stringify(holidays));
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
