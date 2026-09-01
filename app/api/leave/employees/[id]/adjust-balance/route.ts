import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { getFYStartYear } from '@/lib/leaveSupabase/fyHelpers';

const ALLOWED_LEAVE_TYPES = ['SL', 'CL', 'PL'] as const;
type AllowedCode = (typeof ALLOWED_LEAVE_TYPES)[number];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: employeeId } = await params;

  // Verify authentication
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Verify HR / HR Super Admin role
  const requester = await getCurrentEmployee();
  if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
    return NextResponse.json({ error: 'Only HR administrators can adjust leave balances.' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { leave_type_code, delta, reason } = body;

  if (!leave_type_code || typeof leave_type_code !== 'string') {
    return NextResponse.json({ error: 'Leave type code is required.' }, { status: 400 });
  }

  const codeUpper = leave_type_code.toUpperCase() as AllowedCode;
  if (!ALLOWED_LEAVE_TYPES.includes(codeUpper)) {
    return NextResponse.json(
      { error: `Invalid leave type code "${leave_type_code}". Must be SL, CL, or PL (LWP cannot be adjusted).` },
      { status: 400 }
    );
  }

  const deltaNum = typeof delta === 'number' ? delta : parseFloat(delta);
  if (isNaN(deltaNum) || deltaNum === 0) {
    return NextResponse.json({ error: 'Delta must be a non-zero number (+ to add, - to deduct).' }, { status: 400 });
  }

  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return NextResponse.json({ error: 'A reason is required for balance adjustment.' }, { status: 400 });
  }

  const service = createLeaveServiceClient();

  // Verify employee exists
  const { data: employee, error: empErr } = await service
    .from('employees')
    .select('id, full_name, employee_code')
    .eq('id', employeeId)
    .maybeSingle();

  if (empErr) {
    return NextResponse.json({ error: `Failed to fetch employee: ${empErr.message}` }, { status: 400 });
  }
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  // Get leave type ID
  const { data: leaveType, error: ltErr } = await service
    .from('leave_types')
    .select('id, code, display_name')
    .eq('code', codeUpper)
    .single();

  if (ltErr || !leaveType) {
    return NextResponse.json({ error: `Leave type "${codeUpper}" not found.` }, { status: 404 });
  }

  const fyStartYear = getFYStartYear();

  // Try calling the stored procedure fn_adjust_balance_manual first
  const { error: rpcError } = await service.rpc('fn_adjust_balance_manual', {
    p_employee_id: employeeId,
    p_leave_type_code: codeUpper,
    p_fy_start_year: fyStartYear,
    p_delta: deltaNum,
    p_reason: reason.trim(),
    p_created_by: requester.id,
  });

  if (!rpcError) {
    return NextResponse.json({
      success: true,
      message: `Successfully adjusted ${codeUpper} balance by ${deltaNum > 0 ? `+${deltaNum}` : deltaNum} for ${employee.full_name}.`,
      employeeId,
      leaveTypeCode: codeUpper,
      delta: deltaNum,
      fyStartYear,
    });
  }

  // Fallback to direct table mutation if RPC is unavailable or returns an error
  // 1. Fetch or create leave_balances row
  let { data: balance, error: balFetchErr } = await service
    .from('leave_balances')
    .select('id, opening_balance, accrued, manual_adjustment, used, closing_balance')
    .eq('employee_id', employeeId)
    .eq('leave_type_id', leaveType.id)
    .eq('fy_start_year', fyStartYear)
    .maybeSingle();

  if (balFetchErr) {
    return NextResponse.json({ error: `Failed to fetch balance: ${balFetchErr.message}` }, { status: 400 });
  }

  if (!balance) {
    // Seed initial balance row if not present
    const { data: newBalance, error: insertErr } = await service
      .from('leave_balances')
      .insert({
        employee_id: employeeId,
        leave_type_id: leaveType.id,
        fy_start_year: fyStartYear,
        opening_balance: 0,
        accrued: 0,
        manual_adjustment: deltaNum,
        used: 0,
      })
      .select('id, opening_balance, accrued, manual_adjustment, used, closing_balance')
      .single();

    if (insertErr || !newBalance) {
      return NextResponse.json({ error: `Failed to create balance row: ${insertErr?.message}` }, { status: 400 });
    }
    balance = newBalance;
  } else {
    const updatedManual = (Number(balance.manual_adjustment) || 0) + deltaNum;

    const { data: updatedBal, error: updateErr } = await service
      .from('leave_balances')
      .update({
        manual_adjustment: updatedManual,
        updated_at: new Date().toISOString(),
      })
      .eq('id', balance.id)
      .select('id, opening_balance, accrued, manual_adjustment, used, closing_balance')
      .single();

    if (updateErr || !updatedBal) {
      return NextResponse.json({ error: `Failed to update balance: ${updateErr?.message}` }, { status: 400 });
    }
    balance = updatedBal;
  }

  // 2. Insert audit record into balance_transactions
  const { error: txErr } = await service.from('balance_transactions').insert({
    leave_balance_id: balance.id,
    delta: deltaNum,
    reason: 'hr_manual_adjustment',
    created_by: requester.id,
    note: reason.trim(),
  });

  if (txErr) {
    console.error('Failed to insert balance_transactions audit record:', txErr);
  }

  return NextResponse.json({
    success: true,
    message: `Successfully adjusted ${codeUpper} balance by ${deltaNum > 0 ? `+${deltaNum}` : deltaNum} for ${employee.full_name}.`,
    employeeId,
    leaveTypeCode: codeUpper,
    delta: deltaNum,
    fyStartYear,
    closingBalance: balance.closing_balance,
  });
}
