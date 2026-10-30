import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths,
  getProbationLwpReason,
  getNoticePeriodLwpReason,
  getAutoLwpConversionReason,
} from '../lib/leavePolicy.ts';

test('addMonths correctly adds calendar months in UTC', () => {
  const d1 = addMonths('2026-01-15', 4);
  assert.equal(d1.toISOString().slice(0, 10), '2026-05-15');

  const d2 = addMonths('2026-10-01', 3);
  assert.equal(d2.toISOString().slice(0, 10), '2027-01-01');
});

test('getProbationLwpReason identifies probation window before unlock', () => {
  const doj = '2026-06-01'; // 4 months unlock date is 2026-10-01

  // Leave on 2026-09-15 is before unlock -> flagged
  const beforeUnlock = getProbationLwpReason(doj, '2026-09-15', 4);
  assert.notEqual(beforeUnlock, null);
  assert.match(beforeUnlock, /probation/i);

  // Leave on 2026-10-01 is exactly on unlock -> NOT probation LWP
  const onUnlock = getProbationLwpReason(doj, '2026-10-01', 4);
  assert.equal(onUnlock, null);

  // Leave on 2026-11-01 is past unlock -> NOT probation LWP
  const afterUnlock = getProbationLwpReason(doj, '2026-11-01', 4);
  assert.equal(afterUnlock, null);
});

test('getNoticePeriodLwpReason identifies notice period window', () => {
  // Employee in notice period with exit date 2026-11-30, 30 days notice window
  const status = 'notice_period';
  const exitDate = '2026-11-30';
  const noticeDays = 30; // window starts 2026-10-31

  // Leave on 2026-11-10 is within notice window -> flagged
  const inNotice = getNoticePeriodLwpReason(status, exitDate, noticeDays, '2026-11-10');
  assert.notEqual(inNotice, null);
  assert.match(inNotice, /notice period/i);

  // Leave on 2026-10-15 is before notice window -> not flagged
  const beforeNotice = getNoticePeriodLwpReason(status, exitDate, noticeDays, '2026-10-15');
  assert.equal(beforeNotice, null);

  // Employee with active status (not in notice period) -> never flagged
  const activeStatus = getNoticePeriodLwpReason('confirmed', exitDate, noticeDays, '2026-11-10');
  assert.equal(activeStatus, null);
});

test('getAutoLwpConversionReason enforces probation precedence', () => {
  // Employee in probation AND hypothetically in notice period
  const employee = {
    date_of_joining: '2026-09-01',
    employment_status: 'notice_period',
    date_of_exit: '2026-11-30',
    notice_period_days: 30,
  };

  // Leave on 2026-10-15: probation triggers first
  const reason = getAutoLwpConversionReason(employee, '2026-10-15', 4);
  assert.notEqual(reason, null);
  assert.match(reason, /probation/i);
});

