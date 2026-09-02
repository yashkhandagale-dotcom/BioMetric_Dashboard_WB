import { redirect } from 'next/navigation';
import { getCurrentEmployee, homeRouteForRole } from '@/lib/leaveSupabase/getCurrentEmployee';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import LeaveThemeSync from '@/components/leave/LeaveThemeSync';

// Simplified onboarding flow (see app/api/auth/callback/route.ts and
// 0017_pending_signups_and_probation.sql): a brand-new @wonderbiz.in
// Google sign-in with no employees row yet lands here instead of being
// rejected. Not gated behind LeaveShell/any of the /leave/**/layout.tsx
// guards — those all require a real employees row, which is exactly
// what this person doesn't have yet — so this is a standalone page,
// same reasoning as app/leave/onboarding/page.tsx and
// app/leave/change-password/page.tsx.
//
// If HR has since acknowledged them (a real employees row now exists),
// this just forwards on to wherever that role normally lands — so a
// stale bookmark/tab left open on this page self-heals instead of
// stranding them here forever.
export default async function PendingSignupPage() {
  const employee = await getCurrentEmployee();
  if (employee) {
    redirect(employee.must_change_password ? '/leave/change-password' : homeRouteForRole(employee.role));
  }

  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: pending } = await supabase
    .from('pending_employee_signups')
    .select('full_name, email, avatar_url, status, rejection_reason')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!pending) {
    // No pending row either — something odd (e.g. it was deleted without
    // being promoted, or this is a stray session). Don't strand them on
    // a blank page; the login page's own error messaging covers this.
    redirect('/login?error=no_employee_record');
  }

  // If the signup was rejected by HR, show rejection message
  if (pending.status === 'rejected') {
    const firstName = pending.full_name?.split(' ')[0] || 'there';
    return (
      <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] flex flex-col">
        <div className="flex items-center justify-end px-4 sm:px-6 py-4">
          <LeaveThemeSync />
        </div>

        <div className="flex-1 flex items-center justify-center px-4 pb-16">
          <div className="w-full max-w-md text-center space-y-5">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-600/30 flex items-center justify-center text-3xl mx-auto">
              ✕
            </div>

            <div>
              <h1 className="text-xl font-semibold text-red-600 dark:text-red-400">Registration Rejected</h1>
              <p className="text-[var(--text-muted)] text-sm mt-2 leading-relaxed">
                Your registration has been rejected by HR. Please contact your HR department for more information.
              </p>
            </div>

            {pending.rejection_reason && (
              <div className="bg-red-500/10 border border-red-600/30 rounded-xl p-4 text-left">
                <p className="text-xs text-red-700 dark:text-red-300 font-medium mb-1">Reason:</p>
                <p className="text-xs text-red-600 dark:text-red-400">{pending.rejection_reason}</p>
              </div>
            )}

            <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 text-left text-xs text-[var(--text-muted)]">
              <p>
                <span className="text-[var(--text-primary)] font-medium">Account:</span> {pending.email}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const firstName = pending.full_name?.split(' ')[0] || 'there';

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] flex flex-col">
      <div className="flex items-center justify-end px-4 sm:px-6 py-4">
        <LeaveThemeSync />
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md text-center space-y-5">
          {pending.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pending.avatar_url}
              alt=""
              className="w-16 h-16 rounded-full object-cover border border-[var(--border)] mx-auto"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center text-xl font-semibold text-[var(--text-muted)] mx-auto">
              {firstName[0]?.toUpperCase() ?? '?'}
            </div>
          )}

          <div>
            <h1 className="text-xl font-semibold">Welcome, {firstName}!</h1>
            <p className="text-[var(--text-muted)] text-sm mt-2 leading-relaxed">
              You&apos;re signed in — nice. HR still needs to set up your employee profile (team, role, joining
              date) before your dashboard and leave tracker have anything to show. Info will be added once HR
              acknowledges your profile — till then, stay tuned!
            </p>
          </div>

          <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 text-left text-xs text-[var(--text-muted)] space-y-1">
            <p>
              <span className="text-[var(--text-primary)] font-medium">Signed in as:</span> {pending.email}
            </p>
            <p>You don&apos;t need to do anything else — just check back, or you&apos;ll be redirected automatically next time you sign in once HR has set you up.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
