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
  const { data: d10, error } = await supabase.from('leave_requests').select('*').eq('start_date', '2026-08-10');
  console.log('Error:', error);
  console.log('Requests on 2026-08-10:', d10);
  if (d10 && d10.length > 0) {
    const empIds = d10.map(d => d.employee_id);
    const { data: emps } = await supabase.from('employees').select('id, employee_code, full_name').in('id', empIds);
    console.log('Employees:', emps);
  }
}
run();
