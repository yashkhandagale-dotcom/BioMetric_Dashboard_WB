import { redirect } from 'next/navigation';
import { getCurrentEmployee, homeRouteForRole } from '@/lib/leaveSupabase/getCurrentEmployee';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import OnboardingForm from '@/components/leave/OnboardingForm';
import LeaveThemeSync from '@/components/leave/LeaveThemeSync';

// Section 5 of the task ("First Login"): after Google links an existing
// employee record to a fresh auth account, show what was fetched
// (name/email/photo from Google, HR-set fields from the employees row)
// and let them confirm — editing only what's genuinely theirs to edit
// (currently: phone). Everything HR-controlled is shown read-only.
//
// Standalone page outside LeaveShell, same reasoning as
// app/leave/change-password/page.tsx: this is a one-time auth-adjacent
// step, not a section of the app you'd want a persistent sidebar
// competing with. Every /leave/** layout guard (me/admin/team/
// approvals/attendance) redirects here first if profile_confirmed_at is
// still null — see each layout.tsx's own comment for the precedence
// (must_change_password first, then this).
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const employee = await getCurrentEmployee();

  if (!employee) {
    redirect('/leave/login');
  }
  if (employee.must_change_password) {
    redirect('/leave/change-password');
  }
  if (employee.profile_confirmed_at) {
    redirect(next || homeRouteForRole(employee.role));
  }

  const supabase = await createLeaveClient();
  const { data: full } = await supabase
    .from('employees')
    .select(
      'full_name, email, employee_code, role, department, office, date_of_joining, phone, job_title, avatar_url'
    )
    .eq('id', employee.id)
    .maybeSingle();

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] flex flex-col">
      <div className="flex items-center justify-end px-4 sm:px-6 py-4">
        <LeaveThemeSync />
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md space-y-4">
          <div>
            <h1 className="text-xl font-semibold">Welcome{full?.full_name ? `, ${full.full_name.split(' ')[0]}` : ''}</h1>
            <p className="text-[var(--text-muted)] text-xs mt-1">
              Quick check before you get started — confirm your details below. HR-managed fields (role, employee ID,
              date of joining, reporting lines) aren&apos;t editable here; contact HR if any of those need a change.
            </p>
          </div>
          <OnboardingForm
            next={next}
            fullName={full?.full_name ?? employee.full_name}
            email={full?.email ?? employee.email}
            employeeCode={full?.employee_code ?? employee.employee_code}
            role={employee.role}
            department={full?.department ?? employee.department}
            office={full?.office ?? employee.office}
            dateOfJoining={full?.date_of_joining ?? null}
            jobTitle={full?.job_title ?? null}
            avatarUrl={full?.avatar_url ?? employee.avatar_url}
            initialPhone={full?.phone ?? ''}
          />
        </div>
      </div>
    </div>
  );
}
