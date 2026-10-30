import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDate, isPunchTimeValid } from '../lib/parseCSV.ts';

test('normalizeDate converts diverse date formats to strict YYYY-MM-DD', () => {
  // Already ISO
  assert.equal(normalizeDate('2026-10-25'), '2026-10-25');

  // ISO with timestamp
  assert.equal(normalizeDate('2026-10-25T14:30:00'), '2026-10-25');

  // Indian format DD/MM/YYYY
  assert.equal(normalizeDate('25/10/2026', 'DMY'), '2026-10-25');
  assert.equal(normalizeDate('05/03/2026', 'DMY'), '2026-03-05');

  // US format MM/DD/YYYY
  assert.equal(normalizeDate('10/25/2026', 'MDY'), '2026-10-25');
  assert.equal(normalizeDate('03/05/2026', 'MDY'), '2026-03-05');

  // Heuristic deduction without hint (25 cannot be a month)
  assert.equal(normalizeDate('25/08/2026'), '2026-08-25');
  assert.equal(normalizeDate('08/25/2026'), '2026-08-25');

  // Hyphenated date formats
  assert.equal(normalizeDate('25-10-2026', 'DMY'), '2026-10-25');
});

test('isPunchTimeValid distinguishes valid punches from empty/placeholder entries', () => {
  // Valid punch times
  assert.equal(isPunchTimeValid('09:30'), true);
  assert.equal(isPunchTimeValid('18:45'), true);
  assert.equal(isPunchTimeValid('9:05'), true);

  // Invalid / placeholder punch times
  assert.equal(isPunchTimeValid(''), false);
  assert.equal(isPunchTimeValid('0:00'), false);
  assert.equal(isPunchTimeValid('--'), false);
  assert.equal(isPunchTimeValid('-'), false);
  assert.equal(isPunchTimeValid('—'), false);
  assert.equal(isPunchTimeValid('   '), false);
});

