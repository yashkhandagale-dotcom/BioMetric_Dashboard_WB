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

async function test() {
  const { data: emps, error } = await supabase.from('employees').select('id, employee_code, full_name, department, employment_status, date_of_joining, date_of_exit, is_deleted').limit(10);
  if (error) console.error(error);
  console.log('Sample employees:');
  console.log(emps);

  const { data: allEmps } = await supabase.from('employees').select('employment_status, is_deleted');
  const statusCounts = {};
  for (const e of allEmps || []) {
    const k = `${e.employment_status} (is_deleted: ${e.is_deleted})`;
    statusCounts[k] = (statusCounts[k] || 0) + 1;
  }
  console.log('Employee status counts:', statusCounts);
}
test();
