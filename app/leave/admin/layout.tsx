import { redirect } from 'next/navigation';
import { createLeaveClient } from '@/lib/leaveSupabase/server';

// Protects everything under app/leave/admin/**. Deliberately a layout,
// not middleware.ts — this only runs for this route subtree, so it can
// never affect the existing dashboard routes or its auth flow.
//
// v1 scope: any authenticated user in the leave-tracker Supabase project
// IS the HR super admin (mirrors the existing dashboard's "single shared
// workspace" model, kept intentionally simple for this first phase).
// When we add tech_lead/manager/employee roles later, this is where a
// role check gets added — swap the `if (!user)` below for a role lookup
// against the `employees` table.
export default async function LeaveAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/leave/login');
  }

  return <>{children}</>;
}