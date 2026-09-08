const fs = require('fs');
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

function getEffectiveLeaveType(r, leave) {
  if (leave) return leave.leaveType;
  const s = (r.status || '').toLowerCase();
  if (s.includes('sick')) return 'sick';
  if (s.includes('planned')) return 'planned';
  if (s.includes('casual')) return 'casual';
  if (s.includes('lwp')) return 'lwp';
  if (s.includes('half_day') || s.includes('half day')) return 'half_day';
  return null;
}

function isWeeklyOff(status) {
  const s = (status || '').toLowerCase();
  return s.includes('weeklyoff') && !s.includes('present');
}

function isPresent(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('no outpunch') || s.includes('missed punch') || s.includes('no punch out')) return true;
  return s.includes('present') && !s.includes('absent');
}

function isAbsent(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('no outpunch') || s.includes('missed punch') || s.includes('no punch out')) return false;
  return (
    s.includes('absent') ||
    s.includes('sick') ||
    s.includes('planned') ||
    s.includes('casual') ||
    s.includes('lwp')
  );
}

async function testYashKPIs() {
  const empId = 'cc9ea415-0338-4d84-85e4-221f86541f78';
  const { data: reqs } = await supabase
    .from('leave_requests')
    .select('*, leave_types(*)')
    .eq('employee_id', empId)
    .gte('start_date', '2026-08-01')
    .lte('start_date', '2026-08-31');

  const { data: att } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('employee_code', '355')
    .gte('date', '2026-08-01')
    .lte('date', '2026-08-31')
    .order('date', { ascending: true });

  const leaveMap = new Map();
  for (const r of reqs) {
    let cur = new Date(r.start_date);
    const end = new Date(r.end_date);
    while (cur <= end) {
      const dStr = cur.toISOString().slice(0, 10);
      let mType = r.is_half_day ? 'half_day' : r.leave_types.code === 'SL' ? 'sick' : r.leave_types.code === 'CL' ? 'casual' : 'planned';
      leaveMap.set(`355__${dStr}`, {
        employeeCode: '355',
        date: dStr,
        leaveType: mType,
        halfDayLeaveType: r.is_half_day ? (r.leave_types.code === 'CL' ? 'casual' : 'sick') : undefined
      });
      cur.setDate(cur.getDate() + 1);
    }
  }

  const workRecords = att.filter(r => !isWeeklyOff(r.status));
  console.log('Work records count:', workRecords.length); // Should be 21

  const presentRecords = [];
  const halfDayRecords = [];
  let plannedLeaveCount = 0, casualLeaveCount = 0, sickLeaveCount = 0, lwpCount = 0, unexplainedAbsentCount = 0;

  for (const r of workRecords) {
    const leave = leaveMap.get(`355__${r.date}`);
    const effectiveLeaveType = getEffectiveLeaveType(r, leave);
    const isFullDayLeave = effectiveLeaveType && effectiveLeaveType !== 'half_day';

    if (isFullDayLeave) {
      if (effectiveLeaveType === 'planned') plannedLeaveCount++;
      else if (effectiveLeaveType === 'casual') casualLeaveCount++;
      else if (effectiveLeaveType === 'sick') sickLeaveCount++;
      else if (effectiveLeaveType === 'lwp') { lwpCount++; unexplainedAbsentCount++; }
    } else if (effectiveLeaveType === 'half_day') {
      halfDayRecords.push(r);
    } else if (r.is_short_day) {
      // short day
    } else if (isPresent(r.status)) {
      presentRecords.push(r);
    } else if (isAbsent(r.status)) {
      unexplainedAbsentCount++;
    }
  }

  const halfDayCount = halfDayRecords.length;
  const presentDays = presentRecords.length + (halfDayCount * 0.5);
  const approvedLeaveDays = plannedLeaveCount + casualLeaveCount + sickLeaveCount + (halfDayCount * 0.5);
  const scheduledDays = workRecords.length;
  const denom = scheduledDays - approvedLeaveDays;
  const attendanceRate = denom > 0 ? (presentDays / denom) * 100 : 0;

  console.log({
    scheduledDays,
    presentRecordsCount: presentRecords.length,
    halfDayCount,
    presentDays,
    approvedLeaveDays,
    unexplainedAbsentCount,
    plannedLeaveCount,
    casualLeaveCount,
    sickLeaveCount,
    denom,
    attendanceRate
  });
}
testYashKPIs();
