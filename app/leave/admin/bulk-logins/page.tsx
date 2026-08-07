import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import BulkLoginsForm from './BulkLoginsForm';

// HR-only page for the one-time "I already have a spreadsheet of
// employee_code/email/password" bulk provisioning case — see
// app/api/leave/admin/employees/bulk-create-logins/route.ts's header
// comment for why this is a separate path from the per-employee "Send
// Invite" button (that one emails a set-password link; this one sets the
// password directly and sends nothing).
export default async function BulkLoginsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/leave/login');
  if (employee.role !== 'hr' && employee.role !== 'hr_super_admin') redirect('/leave/me');

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <a href="/leave/admin" className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            ← Back to Employees
          </a>
          <h1 className="text-xl font-semibold mt-1">Bulk Create Logins</h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">
            Paste a CSV of employee_code, email, and password. Creates each login directly with that
            password — no invite email is sent, no set-password step needed. Matches rows to employees
            by employee_code exactly, so fix any typos in the CSV rather than here.
          </p>
        </div>
        <BulkLoginsForm />
      </div>
    </div>
  );
}
