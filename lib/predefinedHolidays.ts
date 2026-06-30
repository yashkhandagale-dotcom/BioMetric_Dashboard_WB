import { Holiday } from './types';

// ── Predefined office holiday calendars ──────────────────────────────────────
// These come straight from WonderBiz's official published holiday list for
// each office/year. They are baked into the app so HR never has to add them
// by hand — the dashboard picks them up automatically and flags those dates
// as holidays everywhere (charts, KPIs, employee timelines, etc).
//
// To add a new office or year, just add another entry below. HR can still
// add ad-hoc/regional holidays on top of this list from the Holidays panel —
// those are stored separately as "custom" holidays and merged in at runtime.

type PredefinedMap = Record<string, Record<number, Omit<Holiday, 'source'>[]>>;

export const PREDEFINED_HOLIDAYS: PredefinedMap = {
  MUM: {
    2026: [
      { date: '2026-01-01', name: 'New Year' },
      { date: '2026-01-26', name: 'Republic Day' },
      { date: '2026-03-03', name: 'Holi' },
      { date: '2026-05-01', name: 'Maharashtra Day' },
      { date: '2026-09-14', name: 'Ganesh Chaturthi' },
      { date: '2026-10-02', name: 'Gandhi Jayanti' },
      { date: '2026-10-21', name: 'Dussera' },
      { date: '2026-11-09', name: 'Diwali' },
      { date: '2026-11-10', name: 'Diwali' },
      { date: '2026-12-25', name: 'Christmas' },
    ],
  },
  HYD: {
    2026: [
      { date: '2026-01-01', name: 'New Year' },
      { date: '2026-01-14', name: 'Pongal' },
      { date: '2026-01-26', name: 'Republic Day' },
      { date: '2026-03-04', name: 'Holi' },
      { date: '2026-05-01', name: 'Labour Day' },
      { date: '2026-06-02', name: 'Telangana Formation Day' },
      { date: '2026-10-02', name: 'Gandhi Jayanti' },
      { date: '2026-10-21', name: 'Dussera' },
      { date: '2026-11-10', name: 'Diwali' },
      { date: '2026-12-25', name: 'Christmas' },
    ],
  },
};

export function getPredefinedHolidays(officeCode: string, year: string | number): Holiday[] {
  const y = typeof year === 'string' ? parseInt(year, 10) : year;
  const list = PREDEFINED_HOLIDAYS[officeCode]?.[y] || [];
  return list.map(h => ({ ...h, source: 'predefined' as const }));
}
