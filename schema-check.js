#!/usr/bin/env node
/**
 * schema-check.js
 *
 * Simple Node smoke-check for common FK relationship names used by the app.
 * Run in CI or locally before deploy. Exits 0 on success, non-zero on failure.
 *
 * Requires environment variables:
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *
 * Example:
 *  SUPABASE_URL=https://xyz.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node schema-check.js
 */

const { createClient } = require('@supabase/supabase-js');

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment');
    process.exit(3);
  }

  const svc = createClient(url, key, { auth: { persistSession: false } });

  const checks = [
    { name: 'leave_requests -> employees', table: 'leave_requests', sel: 'id, employees!leave_requests_employee_id_fkey(id)' },
    { name: 'leave_requests -> leave_types', table: 'leave_requests', sel: 'id, leave_types(id)' },
    { name: 'leave_balances -> employees', table: 'leave_balances', sel: 'id, employees!leave_balances_employee_id_fkey(id)' },
    { name: 'leave_balances -> leave_types', table: 'leave_balances', sel: 'id, leave_types(id)' },
    { name: 'balance_transactions -> leave_balances', table: 'balance_transactions', sel: 'id, leave_balances!balance_transactions_leave_balance_id_fkey(id)' },
    { name: 'balance_transactions -> employees (created_by)', table: 'balance_transactions', sel: 'id, employees!balance_transactions_created_by_fkey(id)' },
  ];

  const results = [];
  for (const c of checks) {
    try {
      const { error } = await svc.from(c.table).select(c.sel).limit(1);
      if (error) {
        results.push({ name: c.name, ok: false, error: error.message });
      } else {
        results.push({ name: c.name, ok: true });
      }
    } catch (err) {
      results.push({ name: c.name, ok: false, error: err && err.message ? err.message : String(err) });
    }
  }

  console.log(JSON.stringify({ ok: results.every(r => r.ok), results }, null, 2));

  if (results.every(r => r.ok)) {
    process.exit(0);
  } else {
    process.exit(2);
  }
}

run();
