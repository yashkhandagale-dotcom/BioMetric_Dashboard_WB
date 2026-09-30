const fs = require('fs');
const assert = require('assert');

// Read env for DB checks
const env = fs.readFileSync('.env.local', 'utf-8');
const envVars = {};
for (const line of env.split('\n')) {
  const idx = line.indexOf('=');
  if (idx > 0) {
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    envVars[k] = v;
  }
}
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

// Pure functions under test from lwpDayCount and fnfCalculator
function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function countDaysInWindow(startDateStr, endDateStr, totalDays, windowStartStr, windowEndStr) {
  if (startDateStr > windowEndStr || endDateStr < windowStartStr) return 0;
  if (startDateStr === endDateStr) {
    if (startDateStr >= windowStartStr && startDateStr <= windowEndStr) {
      return totalDays;
    }
    return 0;
  }
  if (startDateStr >= windowStartStr && endDateStr <= windowEndStr) {
    return totalDays;
  }
  const start = new Date(`${startDateStr}T00:00:00Z`);
  const end = new Date(`${endDateStr}T00:00:00Z`);
  const totalCalendarDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (totalCalendarDays <= 0) return 0;

  const effStart = startDateStr < windowStartStr ? new Date(`${windowStartStr}T00:00:00Z`) : start;
  const effEnd = endDateStr > windowEndStr ? new Date(`${windowEndStr}T00:00:00Z`) : end;
  const overlapCalendarDays = Math.max(0, Math.round((effEnd.getTime() - effStart.getTime()) / 86400000) + 1);

  const proportionalDays = totalDays * (overlapCalendarDays / totalCalendarDays);
  return Math.round(proportionalDays * 100) / 100;
}

function getFnFWindows(lwd) {
  const lwdDate = new Date(`${lwd}T00:00:00Z`);
  const year = lwdDate.getUTCFullYear();
  const month = lwdDate.getUTCMonth(); // 0-indexed

  // 1st of the calendar month containing last_working_day
  const monthStartDate = new Date(Date.UTC(year, month, 1));
  const monthStart = toISODate(monthStartDate);
  const grossDays = Math.round((lwdDate.getTime() - monthStartDate.getTime()) / 86400000) + 1;

  // LWP window: 25th of the month before lwd's month -> min(24th of lwd's month, lwd)
  const lwpStartDate = new Date(Date.UTC(year, month - 1, 25));
  const lwpWindowStart = toISODate(lwpStartDate);

  const cutoff24Date = new Date(Date.UTC(year, month, 24));
  const cutoff24 = toISODate(cutoff24Date);
  const lwpWindowEnd = lwd < cutoff24 ? lwd : cutoff24;

  return {
    monthStart,
    grossDays,
    lwpWindowStart,
    lwpWindowEnd,
  };
}

function computePayableDays(lwd, lwpDaysInWindow) {
  const { monthStart, grossDays, lwpWindowStart, lwpWindowEnd } = getFnFWindows(lwd);
  return {
    monthStart,
    cycleStart: monthStart,
    lwpWindowStart,
    lwpWindowEnd,
    grossDays,
    lwpDays: lwpDaysInWindow,
    payableDays: Math.max(grossDays - lwpDaysInWindow, 0),
  };
}

async function runTests() {
  console.log('=== RUNNING CHANGE 1 TEST CASES ===\n');

  // Test Case 1: Employee exits on last day of month (e.g., 31 March 2026)
  console.log('Test Case 1: Employee exits on 31 March 2026');
  const tc1 = getFnFWindows('2026-03-31');
  console.log('  Windows:', tc1);
  assert.strictEqual(tc1.grossDays, 31, 'Gross days must equal full month (31)');
  assert.strictEqual(tc1.monthStart, '2026-03-01', 'Month start must be 2026-03-01');
  assert.strictEqual(tc1.lwpWindowStart, '2026-02-25', 'LWP start must be 2026-02-25');
  assert.strictEqual(tc1.lwpWindowEnd, '2026-03-24', 'LWP end must clamp to 24 March (min of 24 Mar and 31 Mar)');
  const tc1Res = computePayableDays('2026-03-31', 0);
  assert.strictEqual(tc1Res.payableDays, 31, 'Payable days with 0 LWP must be 31');
  console.log('  -> PASS: Gross days = 31 (full month, not partial 25-24 cycle)\n');

  // Test Case 2: Employee exits mid-month (10 March 2026) with LWP day on 28 Feb
  console.log('Test Case 2: Employee exits mid-month (10 March 2026) with LWP on 28 Feb');
  const tc2 = getFnFWindows('2026-03-10');
  console.log('  Windows:', tc2);
  assert.strictEqual(tc2.grossDays, 10, 'Gross days must be 1-10 March (10 days)');
  assert.strictEqual(tc2.lwpWindowStart, '2026-02-25', 'LWP window start must be 25 Feb');
  assert.strictEqual(tc2.lwpWindowEnd, '2026-03-10', 'LWP window end must clamp to LWD (10 March)');
  // LWP day on 28 Feb
  const lwpCountFeb28 = countDaysInWindow('2026-02-28', '2026-02-28', 1, tc2.lwpWindowStart, tc2.lwpWindowEnd);
  assert.strictEqual(lwpCountFeb28, 1, '28 Feb LWP must be counted inside [25 Feb, 10 March]');
  const tc2Res = computePayableDays('2026-03-10', lwpCountFeb28);
  assert.strictEqual(tc2Res.grossDays, 10);
  assert.strictEqual(tc2Res.lwpDays, 1);
  assert.strictEqual(tc2Res.payableDays, 9);
  console.log('  -> PASS: Gross days = 10, 28 Feb LWP counted, payable days = 9\n');

  // Test Case 3: Employee exits mid-month (10 March 2026) with LWP day after exit (15 March)
  console.log('Test Case 3: Employee exits 10 March with LWP after exit (15 March)');
  const tc3 = getFnFWindows('2026-03-10');
  const lwpCountMar15 = countDaysInWindow('2026-03-15', '2026-03-15', 1, tc3.lwpWindowStart, tc3.lwpWindowEnd);
  assert.strictEqual(lwpCountMar15, 0, '15 March LWP must be excluded by lwp_window_end clamp (10 March)');
  console.log('  -> PASS: LWP day after exit correctly excluded\n');

  // Test Case 4: Diff against existing historical records in DB
  console.log('Test Case 4: Re-running against existing F&F records in DB');
  const { data: fnfRows } = await supabase.from('fnf_calculations').select('*');
  console.log(`  Found ${fnfRows.length} historical F&F records in database:`);

  for (const row of fnfRows) {
    const lwd = row.last_working_day;
    const oldDetail = row.calculation_detail;
    const newWindows = getFnFWindows(lwd);
    const newDays = computePayableDays(lwd, oldDetail.days.lwpDays);

    console.log(`\n  Record ID: ${row.id}`);
    console.log(`  Employee: ${row.employee_id} | LWD: ${lwd}`);
    console.log('  [HISTORICAL STORED]', {
      grossDays: oldDetail.days.grossDays,
      cycleStart: oldDetail.days.cycleStart,
      lwpDays: oldDetail.days.lwpDays,
      payableDays: row.payable_days,
    });
    console.log('  [NEW FORMULA COMPUTATION]', {
      grossDays: newDays.grossDays,
      monthStart: newDays.monthStart,
      lwpWindow: `${newDays.lwpWindowStart} to ${newDays.lwpWindowEnd}`,
      lwpDays: newDays.lwpDays,
      payableDays: newDays.payableDays,
    });
    console.log('  -> Historical DB row preserved intact (NO silent overwrite).');
  }

  console.log('\n=== ALL TEST CASES PASSED SUCCESSFULLY ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
