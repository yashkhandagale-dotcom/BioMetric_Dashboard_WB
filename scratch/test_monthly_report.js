const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf-8');
const envVars = {};
for (const line of env.split('\n')) {
  const idx = line.indexOf('=');
  if (idx > 0) {
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    envVars[k]  = v;
  }
}
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

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

async function testMonthlyReport(year, month, clampNewJoiners = false, excludeExited = true) {
  console.log(`\n=== Testing Monthly Report for ${year}-${month} ===`);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthStartISO = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEndISO = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const lwpStartDate = new Date(Date.UTC(year, month - 2, 25));
  const lwpWindowStart = lwpStartDate.toISOString().slice(0, 10);
  const lwpEndDate = new Date(Date.UTC(year, month - 1, 24));
  const lwpWindowEnd = lwpEndDate.toISOString().slice(0, 10);

  console.log({
    daysInMonth,
    monthStartISO,
    monthEndISO,
    lwpWindowStart,
    lwpWindowEnd,
    clampNewJoiners,
    excludeExited
  });

  const { data: employees } = await supabase
    .from('employees')
    .select('id, employee_code, full_name, department, office, employment_status, date_of_joining, date_of_exit, is_deleted')
    .eq('is_deleted', false);

  const eligible = (employees || []).filter(e => {
    if (excludeExited) {
      if (e.employment_status === 'exited') return false;
      if (e.date_of_exit && e.date_of_exit >= lwpWindowStart && e.date_of_exit <= monthEndISO) return false;
    }
    if (e.date_of_joining && e.date_of_joining > monthEndISO) return false;
    return true;
  });

  console.log(`Total non-deleted: ${employees.length}, Eligible active: ${eligible.length}`);

  // Query LWP requests
  const empIds = eligible.map(e => e.id);
  const { data: lwpRows } = await supabase
    .from('leave_requests')
    .select('employee_id, total_days, start_date, end_date, leave_types!inner(code)')
    .in('employee_id', empIds)
    .eq('leave_types.code', 'LWP')
    .in('status', ['approved', 'auto_lwp'])
    .lte('start_date', lwpWindowEnd)
    .gte('end_date', lwpWindowStart);

  const lwpMap = new Map();
  for (const r of lwpRows || []) {
    const days = countDaysInWindow(r.start_date, r.end_date, Number(r.total_days), lwpWindowStart, lwpWindowEnd);
    lwpMap.set(r.employee_id, (lwpMap.get(r.employee_id) || 0) + days);
  }

  let totalPayable = 0;
  let totalLwp = 0;
  const sampleRows = [];

  for (const emp of eligible) {
    let grossDays = daysInMonth;
    if (clampNewJoiners && emp.date_of_joining && emp.date_of_joining.startsWith(`${year}-${String(month).padStart(2, '0')}`)) {
      const dojDay = parseInt(emp.date_of_joining.slice(8, 10), 10);
      if (dojDay > 1) {
        grossDays = Math.max(0, daysInMonth - dojDay + 1);
      }
    }
    const lwp = lwpMap.get(emp.id) || 0;
    const payable = Math.max(0, grossDays - lwp);
    totalPayable += payable;
    totalLwp += lwp;

    if (lwp > 0 || sampleRows.length < 5) {
      sampleRows.push({
        code: emp.employee_code,
        name: emp.full_name,
        dept: emp.department,
        status: emp.employment_status,
        grossDays,
        lwp,
        payable
      });
    }
  }

  console.log('Summary:', {
    totalEmployees: eligible.length,
    totalGrossDays: eligible.length * daysInMonth,
    totalLwpDays: totalLwp,
    totalPayableDays: totalPayable
  });
  console.log('Sample rows (with LWP or first 5):', sampleRows.slice(0, 10));
}

async function main() {
  // Test August 2026 (where we know LWP rows exist!)
  await testMonthlyReport(2026, 8);
  // Test September 2026
  await testMonthlyReport(2026, 9);
}
main();
