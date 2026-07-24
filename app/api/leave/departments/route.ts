import { NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getDepartmentsWithManagers } from '@/lib/leaveSupabase/organization';

// Backs the "Departments Managed" checklist in AdjustBalanceButton's and
// AddEmployeeForm's Details tab. Replaces the old /api/leave/teams route,
// which queried a `teams` table that was never actually migrated (see
// supabase-leave/schema.sql's 006_department_managers.sql comment).
//
// Departments aren't a separate catalog here — they're whatever values
// exist in employees.department (set at CSV onboarding, per
// lib/employeeStore.ts). The join-with-manager logic now lives in
// lib/leaveSupabase/organization.ts (getDepartmentsWithManagers), shared
// with the new Organization Management page's /api/leave/organization
// route, so there's exactly one place that computes "which manager owns
// this department" instead of two copies that could drift.
// There is no POST here — a department can't be "created" independent
// of an employee row that already carries it.
export async function GET() {
  try {
    const supabase = await createLeaveClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { departments, error } = await getDepartmentsWithManagers(supabase);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    return NextResponse.json({ departments });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to load departments: ${message}`, departments: [] },
      { status: 500 }
    );
  }
}