import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { getFYStartYear } from '@/lib/leaveSupabase/fyHelpers';

export async function POST(req: NextRequest) {
  try {
    const requester = await getCurrentEmployee();
    if (!requester || !['hr', 'hr_super_admin', 'manager'].includes(requester.role)) {
      return NextResponse.json({ error: 'Not authorized to award comp-off' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { employeeId, daysWorked, note, fyStartYear: inputFy } = body;

    if (!employeeId) {
      return NextResponse.json({ error: 'employeeId is required' }, { status: 400 });
    }

    const numDays = parseFloat(daysWorked);
    if (isNaN(numDays) || numDays <= 0) {
      return NextResponse.json({ error: 'daysWorked must be a positive number' }, { status: 400 });
    }

    const fyStartYear = inputFy ? parseInt(inputFy, 10) : getFYStartYear();
    const supabase = await createLeaveClient();

    const { error: rpcError } = await supabase.rpc('fn_credit_comp_off', {
      p_employee_id: employeeId,
      p_fy_start_year: fyStartYear,
      p_days_worked: numDays,
      p_approved_by: requester.id,
    });

    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Successfully credited comp-off for ${numDays} day(s) worked. (Credit: ${numDays * 0.5} PL days)`,
      creditAmount: numDays * 0.5,
      employeeId,
      note,
    });
  } catch (err: any) {
    console.error('Error awarding comp-off:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

