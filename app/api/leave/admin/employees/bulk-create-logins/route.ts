import { NextRequest, NextResponse } from 'next/server';
import { createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';

// POST /api/leave/admin/employees/bulk-create-logins
//
// Sibling to .../employees/[id]/invite, for a different situation: HR
// already has a full roster of email + password pairs generated
// elsewhere (a spreadsheet, a previous provisioning tool, whatever) and
// wants everyone able to log in immediately — NOT an email invite flow.
// The single-employee "Send Invite" button in the Details tab
// (.../invite) is for onboarding one new person going forward and
// deliberately emails them a set-password link; this route is for a
// one-time bulk backfill and deliberately does the opposite — creates
// the auth.users row with the given password already set and
// `email_confirm: true`, so no email is sent and no separate
// "set your password" step is needed. Same end state as .../invite
// (an auth.users row + employees.auth_user_id linked), different path
// to get there.
//
// Matches rows to employees by employee_code (exact string match —
// employee_code is `text`, so "009" and "9" are different rows on
// purpose, not normalized). Rows that don't match an existing employee,
// or whose employee already has an auth_user_id, are reported back
// per-row rather than failing the whole batch — a spreadsheet of 80+
// rows will always have a few that need a human to look at.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type InputRow = { employee_code: string; email: string; password: string };
type RowResult = {
  employee_code: string;
  email: string;
  status: 'created' | 'already_linked' | 'not_found' | 'invalid_email' | 'weak_password' | 'error';
  detail?: string;
};

export async function POST(req: NextRequest) {
  const requester = await getCurrentEmployee();
  if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const rows: InputRow[] = Array.isArray(body?.rows) ? body.rows : [];
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No rows provided.' }, { status: 400 });
  }
  if (rows.length > 500) {
    return NextResponse.json({ error: 'Too many rows in one batch (max 500) — split into smaller batches.' }, { status: 400 });
  }

  const service = createLeaveServiceClient();
  const results: RowResult[] = [];

  for (const row of rows) {
    const employee_code = String(row.employee_code ?? '').trim();
    const email = String(row.email ?? '').trim();
    const password = String(row.password ?? '');

    if (!employee_code) {
      results.push({ employee_code, email, status: 'error', detail: 'Missing employee_code.' });
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      results.push({ employee_code, email, status: 'invalid_email' });
      continue;
    }
    if (password.length < 6) {
      // Supabase Auth's own minimum — fail fast with a clear reason
      // instead of letting createUser reject it more cryptically.
      results.push({ employee_code, email, status: 'weak_password', detail: 'Password must be at least 6 characters.' });
      continue;
    }

    const { data: employee, error: findError } = await service
      .from('employees')
      .select('id, email, auth_user_id')
      .eq('employee_code', employee_code)
      .maybeSingle();

    if (findError) {
      results.push({ employee_code, email, status: 'error', detail: findError.message });
      continue;
    }
    if (!employee) {
      results.push({ employee_code, email, status: 'not_found', detail: 'No employee row with this employee_code.' });
      continue;
    }
    if (employee.auth_user_id) {
      results.push({ employee_code, email, status: 'already_linked' });
      continue;
    }

    // No invite email — this IS the account, fully set up and confirmed,
    // in one call. email_confirm: true skips Supabase's own "confirm your
    // email" gate too, so the password works immediately.
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) {
      const alreadyExists = /already been registered|already exists|already registered/i.test(createError.message);
      results.push({
        employee_code,
        email,
        status: 'error',
        detail: alreadyExists
          ? 'An Auth account for this email already exists — link it via "Link existing account" on this employee\u2019s Details tab instead.'
          : createError.message,
      });
      continue;
    }

    const updatePayload: Record<string, unknown> = {
      auth_user_id: created.user.id,
      updated_at: new Date().toISOString(),
    };
    if (!employee.email) updatePayload.email = email;

    const { error: linkError } = await service
      .from('employees')
      .update(updatePayload)
      .eq('id', employee.id);

    if (linkError) {
      results.push({
        employee_code,
        email,
        status: 'error',
        detail: `Account created (id: ${created.user.id}) but linking failed: ${linkError.message}. Link it manually via "Link existing account".`,
      });
      continue;
    }

    results.push({ employee_code, email, status: 'created' });
  }

  const summary = {
    created: results.filter((r) => r.status === 'created').length,
    already_linked: results.filter((r) => r.status === 'already_linked').length,
    failed: results.filter((r) => !['created', 'already_linked'].includes(r.status)).length,
  };

  return NextResponse.json({ summary, results });
}
