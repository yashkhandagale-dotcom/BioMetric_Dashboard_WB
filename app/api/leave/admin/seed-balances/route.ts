import { NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';

// There is no historical leave data for any employee (per the project
// brief), so this is a flat one-time grant of the full annual quota —
// not a pro-ration. Safe to call more than once: the underlying function
// only seeds employees who don't already have a leave_balances row for
// the FY (an employee who joined mid-year and was already prorated via
// fn_prorate_new_joiner is left untouched).
export async function POST() {
  const sessionClient = await createLeaveClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const fyStartYear = getFYStartYear();
  const service = createLeaveServiceClient();

  const { data, error } = await service.rpc('fn_seed_opening_balances_current_fy', {
    p_fy_start_year: fyStartYear,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    fy_start_year: fyStartYear,
    fy_label: formatFYLabel(fyStartYear),
    seeded_count: (data ?? []).length,
  });
}
