import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { calculateFnF } from '@/lib/leaveSupabase/fnfCalculator';

// HR-only. POST { employeeId, lastWorkingDay } -> { result }.
// Persists an audit row to fnf_calculations (see
// supabase/migrations/0014_fnf_calculations.sql) so a number HR reads
// today can be reconstructed later if questioned.
export async function POST(req: NextRequest) {
  const requester = await getCurrentEmployee();
  if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const body = await req.json();
  const { employeeId, lastWorkingDay } = body;
  if (!employeeId || !lastWorkingDay) {
    return NextResponse.json({ error: 'employeeId and lastWorkingDay are required.' }, { status: 400 });
  }

  const supabase = await createLeaveClient();
  const { result, error } = await calculateFnF(supabase, employeeId, lastWorkingDay);
  if (error || !result) {
    return NextResponse.json({ error: error ?? 'Calculation failed.' }, { status: 400 });
  }

  const { error: insertErr } = await supabase.from('fnf_calculations').insert({
    employee_id: employeeId,
    last_working_day: lastWorkingDay,
    payable_days: result.days.payableDays,
    payable_leaves: result.leaves.payableLeaves,
    calculation_detail: result,
    calculated_by: requester.id,
  });
  // Same 207 pattern the employee-profile route uses for its department
  // sync step: don't block HR from seeing the numbers over an audit-log
  // write failure, just surface it.
  if (insertErr) {
    return NextResponse.json(
      { result, warning: `Calculated, but audit log failed to save: ${insertErr.message}` },
      { status: 207 }
    );
  }

  return NextResponse.json({ result });
}
