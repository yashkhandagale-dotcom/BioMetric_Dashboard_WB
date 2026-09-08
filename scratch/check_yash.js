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

async function run() {
  const empId = 'cc9ea415-0338-4d84-85e4-221f86541f78';
  const { data: reqs } = await supabase
    .from('leave_requests')
    .select('*, leave_types(*)')
    .eq('employee_id', empId)
    .gte('start_date', '2026-08-01')
    .lte('start_date', '2026-08-31')
    .order('start_date', { ascending: true });
  console.log('Leave requests in Aug for Yash:', reqs.map(r => ({ date: r.start_date, type: r.leave_types.display_name, code: r.leave_types.code, half: r.is_half_day, status: r.status })));

  const { data: att } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('employee_code', '355')
    .gte('date', '2026-08-01')
    .lte('date', '2026-08-31')
    .order('date', { ascending: true });
  console.log('Attendance records in Aug for Yash:', att.map(a => ({ date: a.date, status: a.status, in: a.in_time, out: a.out_time, dur: a.duration })));
}
run();
