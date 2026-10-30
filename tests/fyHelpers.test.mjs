import test from 'node:test';
import assert from 'node:assert/strict';
import { getFYStartYear, formatFYLabel } from '../lib/leaveSupabase/fyHelpers.ts';

test('getFYStartYear correctly partitions before and after March 25th', () => {
  // 24th March 2026 is the last day of FY 2025
  const endOfFY25 = new Date(2026, 2, 24); // Month 2 is March
  assert.equal(getFYStartYear(endOfFY25), 2025);

  // 25th March 2026 is the first day of FY 2026
  const startOfFY26 = new Date(2026, 2, 25);
  assert.equal(getFYStartYear(startOfFY26), 2026);

  // October 2026 is in FY 2026
  const oct2026 = new Date(2026, 9, 29);
  assert.equal(getFYStartYear(oct2026), 2026);

  // January 2026 is in FY 2025
  const jan2026 = new Date(2026, 0, 15);
  assert.equal(getFYStartYear(jan2026), 2025);
});

test('formatFYLabel correctly formats fiscal year string', () => {
  assert.equal(formatFYLabel(2025), 'FY 2025-26');
  assert.equal(formatFYLabel(2026), 'FY 2026-27');
  assert.equal(formatFYLabel(2029), 'FY 2029-30');
});

