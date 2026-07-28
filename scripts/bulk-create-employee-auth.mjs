// scripts/bulk-create-employee-auth.mjs
//
// One-time bulk onboarding: for every employees row with auth_user_id
// still null, creates a Supabase Auth account and links it.
//
// Login email:  firstname.lastname@wonderbiz.in  (derived from full_name,
//               not from employees.email — those may be inconsistent
//               from CSV import). Collisions (two "Rahul Sharma") get
//               the employee_code appended so every login stays unique.
// Password:     Firstname@123 (first name, capitalized, +"@123").
//
// Run from the project root:
//   $env:NEXT_PUBLIC_SUPABASE_URL="https://<your-project>.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="<service role key>"
//   node scripts/bulk-create-employee-auth.mjs
//
// Writes employee-credentials.csv (plaintext passwords) next to this
// script — for HR to distribute securely, then delete. Do not commit it.

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function nameParts(fullName) {
  return fullName
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, '') // strip anything that isn't a letter or space
    .trim()
    .split(/\s+/);
}

function loginEmailFor(fullName, employeeCode, usedEmails) {
  const parts = nameParts(fullName);
  const first = parts[0] || 'employee';
  const last = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  let email = `${first}.${last}@wonderbiz.in`;
  if (usedEmails.has(email)) {
    email = `${first}.${last}.${employeeCode.toLowerCase()}@wonderbiz.in`;
  }
  usedEmails.add(email);
  return email;
}

function passwordFor(fullName) {
  const parts = nameParts(fullName);
  const first = parts[0] || 'employee';
  const capitalized = first.charAt(0).toUpperCase() + first.slice(1);
  return `${capitalized}@123`;
}

async function main() {
  const { data: employees, error } = await supabase
    .from('employees')
    .select('id, employee_code, full_name, email, auth_user_id')
    .is('auth_user_id', null)
    .order('full_name');

  if (error) {
    console.error('Failed to fetch employees:', error.message);
    process.exit(1);
  }

  console.log(`${employees.length} employee(s) with no linked auth account. Creating...\n`);

  const usedEmails = new Set();
  const results = [];

  for (const emp of employees) {
    const loginEmail = loginEmailFor(emp.full_name, emp.employee_code, usedEmails);
    const password = passwordFor(emp.full_name);

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: loginEmail,
      password,
      email_confirm: true, // no confirmation email — HR distributes creds directly
    });

    if (createError) {
      console.error(`FAILED  ${emp.employee_code}  ${emp.full_name}: ${createError.message}`);
      results.push({
        employee_code: emp.employee_code,
        full_name: emp.full_name,
        login_email: loginEmail,
        password,
        status: `FAILED: ${createError.message}`,
      });
      continue;
    }

    const { error: linkError } = await supabase
      .from('employees')
      .update({ auth_user_id: created.user.id, updated_at: new Date().toISOString() })
      .eq('id', emp.id);

    if (linkError) {
      console.error(
        `ORPHAN  ${emp.employee_code}  ${emp.full_name}: auth user created (${created.user.id}) but link failed: ${linkError.message}`
      );
      results.push({
        employee_code: emp.employee_code,
        full_name: emp.full_name,
        login_email: loginEmail,
        password,
        status: `ORPHAN (auth user ${created.user.id} exists, not linked): ${linkError.message}`,
      });
      continue;
    }

    console.log(`OK      ${emp.employee_code}  ${emp.full_name}  ->  ${loginEmail}`);
    results.push({
      employee_code: emp.employee_code,
      full_name: emp.full_name,
      login_email: loginEmail,
      password,
      status: 'OK',
    });
  }

  const csvLines = ['employee_code,full_name,login_email,password,status'];
  for (const r of results) {
    csvLines.push(`${r.employee_code},"${r.full_name}",${r.login_email},${r.password},"${r.status}"`);
  }
  writeFileSync('employee-credentials.csv', csvLines.join('\n'));

  const okCount = results.filter((r) => r.status === 'OK').length;
  console.log(
    `\nDone. ${okCount}/${results.length} succeeded. Credentials written to employee-credentials.csv — distribute securely, then delete the file. Do not commit it.`
  );
}

main();
