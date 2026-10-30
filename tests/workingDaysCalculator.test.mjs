import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWeekend,
  isNonWorkingDay,
  calculateWorkingDays,
  calculateEndDateFromWorkingDays,
} from '../lib/workingDaysCalculator.ts';
import { formatOrdinalDateRange } from '../lib/dateFormat.ts';

test('isWeekend correctly identifies Saturdays and Sundays', () => {
  // 2026-10-24 is Saturday, 2026-10-25 is Sunday
  assert.equal(isWeekend('2026-10-24'), true);
  assert.equal(isWeekend('2026-10-25'), true);
  // 2026-10-26 is Monday, 2026-10-23 is Friday
  assert.equal(isWeekend('2026-10-26'), false);
  assert.equal(isWeekend('2026-10-23'), false);
});

test('calculateWorkingDays excludes weekends and predefined holidays', () => {
  // Mon 2026-11-16 to Fri 2026-11-20: 5 working days (no holidays in this week)
  const clearWeek = calculateWorkingDays('2026-11-16', '2026-11-20', 'MUM');
  assert.equal(clearWeek, 5);

  // Monday 2026-10-19 to Friday 2026-10-23 contains Dussera (2026-10-21) -> exactly 4 working days
  const dusseraWeek = calculateWorkingDays('2026-10-19', '2026-10-23', 'MUM');
  assert.equal(dusseraWeek, 4);

  // Friday 2026-11-20 to Monday 2026-11-23: 2 working days (Sat & Sun skipped)
  const spanWithWeekend = calculateWorkingDays('2026-11-20', '2026-11-23', 'MUM');
  assert.equal(spanWithWeekend, 2);

  // Invalid date range
  assert.equal(calculateWorkingDays('2026-10-26', '2026-10-20', 'MUM'), 0);
  assert.equal(calculateWorkingDays('', '2026-10-20', 'MUM'), 0);
});

test('calculateEndDateFromWorkingDays correctly projects future end dates', () => {
  // Starting Monday 2026-11-16 for 5 working days -> ends Friday 2026-11-20
  const fullWeekEnd = calculateEndDateFromWorkingDays('2026-11-16', 5, 'MUM');
  assert.equal(fullWeekEnd, '2026-11-20');

  // Starting Friday 2026-11-20 for 2 working days -> ends Monday 2026-11-23 (skips weekend)
  const weekendEnd = calculateEndDateFromWorkingDays('2026-11-20', 2, 'MUM');
  assert.equal(weekendEnd, '2026-11-23');

  // Starting Monday 2026-10-19 for 5 working days in MUM (Wednesday is Dussera holiday):
  // Day 1: Mon 10-19, Day 2: Tue 10-20, Wed 10-21 (Holiday), Day 3: Thu 10-22, Day 4: Fri 10-23, Weekend, Day 5: Mon 10-26
  const holidayEnd = calculateEndDateFromWorkingDays('2026-10-19', 5, 'MUM');
  assert.equal(holidayEnd, '2026-10-26');

  // Single day (1 working day) -> same day if working day
  assert.equal(calculateEndDateFromWorkingDays('2026-11-17', 1, 'MUM'), '2026-11-17');
});

test('formatOrdinalDateRange formats single and multi-day spans', () => {
  assert.equal(formatOrdinalDateRange('2026-10-21', '2026-10-21', false), '21st Oct 2026 (1 Day)');
  assert.equal(formatOrdinalDateRange('2026-10-21', '2026-10-21', true), '21st Oct 2026 (Half Day)');
  assert.equal(formatOrdinalDateRange('2026-10-23', '2026-10-26', false, 2), '23rd Oct 2026 – 26th Oct 2026 (2 Days)');
});
