import { NextResponse } from 'next/server';
import { getCurrentEmployee, CurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';

export type HrAuthResult =
  | { authorized: true; employee: CurrentEmployee }
  | { authorized: false; response: NextResponse };

/**
 * Shared HR authentication guard for leave analytics API routes.
 * Resolves current employee via getCurrentEmployee().
 * Returns:
 * - 401 Unauthorized if not logged in or unrecognized session.
 * - 403 Forbidden if user role is not 'hr' or 'hr_super_admin'.
 */
export async function requireHrAccess(): Promise<HrAuthResult> {
  const employee = await getCurrentEmployee();

  if (!employee) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 }),
    };
  }

  if (employee.role !== 'hr' && employee.role !== 'hr_super_admin') {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: 'Forbidden: HR access required. This endpoint is restricted to HR administrators.' },
        { status: 403 }
      ),
    };
  }

  return { authorized: true, employee };
}
