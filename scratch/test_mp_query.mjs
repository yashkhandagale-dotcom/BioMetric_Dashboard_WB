import { createClient } from '../node_modules/@supabase/supabase-js/dist/index.mjs';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value.trim();
  }
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase
    .from('attendance_exceptions')
    .select('id, employee_id, exception_date, exception_type, first_punch, last_punch, employee_choice, employee_note, updated_at, employees!attendance_exceptions_employee_id_fkey!inner(full_name, employee_code, department, reporting_lead_id)')
    .eq('employee_choice', 'missed_punch');
  console.log('Error:', error);
  console.log('Count:', data?.length);
  console.log('Data:', JSON.stringify(data, null, 2));
}
run();
