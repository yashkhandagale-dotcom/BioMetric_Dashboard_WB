import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import ChangePasswordForm from '@/components/leave/ChangePasswordForm';
import LeaveThemeSync from '@/components/leave/LeaveThemeSync';

// Reachable by anyone logged in (role doesn't matter — every employee
// can change their own password). Also where the /leave/* layout guards'
// must_change_password check sends someone after HR resets their
// password — that case gets an explanatory banner and no way out until
// it's done; a voluntary visit (from the account menu in LeaveShell)
// gets a plain form with a way back.
//
// Deliberately outside LeaveShell (not part of the tab nav) — this is a
// single-purpose auth-style flow, same reasoning as a login screen, not
// a section of the feature you'd want a persistent sidebar competing
// with. It still gets the same theme toggle and a way back, so it never
// feels like a dead end the way it used to (zero navigation at all).
export default async function ChangePasswordPage() {
  const employee = await getCurrentEmployee();
  if (!employee) {
    redirect('/leave/login');
  }

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] flex flex-col">
      <div className="flex items-center justify-between px-4 sm:px-6 py-4">
        {employee.must_change_password ? (
          <span />
        ) : (
          <Link
            href="/leave/me"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ArrowLeft size={13} />
            Back
          </Link>
        )}
        <LeaveThemeSync />
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm space-y-4">
          <div>
            <h1 className="text-xl font-semibold">Change Password</h1>
            <p className="text-[var(--text-muted)] text-xs mt-1">
              {employee.must_change_password
                ? 'HR reset your password. Set a new one to continue — you\u2019ll need the temporary password HR gave you.'
                : 'Enter your current password and choose a new one.'}
            </p>
          </div>
          {employee.must_change_password && (
            <div className="bg-amber-900/20 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs rounded-lg px-3 py-2">
              You won&apos;t be able to use the rest of the app until this is done.
            </div>
          )}
          <ChangePasswordForm forced={employee.must_change_password} />
        </div>
      </div>
    </div>
  );
}
