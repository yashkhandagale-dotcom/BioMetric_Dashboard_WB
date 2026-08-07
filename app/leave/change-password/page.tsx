import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import ChangePasswordForm from '@/components/leave/ChangePasswordForm';

// Reachable by anyone logged in (role doesn't matter — every employee
// can change their own password). Also where app/leave/layout.tsx's
// must_change_password gate sends someone after HR resets their
// password — that case gets an explanatory banner and no "skip" link;
// a voluntary visit (from the "Change Password" link in MeNavbar / the
// admin nav) gets a plain form.
export default async function ChangePasswordPage() {
  const employee = await getCurrentEmployee();
  if (!employee) {
    redirect('/leave/login');
  }

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] flex items-center justify-center px-4 py-12">
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
  );
}
