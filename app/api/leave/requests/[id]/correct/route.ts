import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getFYStartYear } from '@/lib/leaveSupabase/fyHelpers';
import { notifyLeaveEvent } from '@/lib/leaveSupabase/notifyLeaveEvent';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sessionClient = await createLeaveClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: actingEmployee } = await sessionClient
    .from('employees')
    .select('id, role, full_name')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!actingEmployee) {
    return NextResponse.json({ error: 'No employee record linked to this account' }, { status: 403 });
  }

  const isHr = actingEmployee.role === 'hr' || actingEmployee.role === 'hr_super_admin';
  if (!isHr) {
    return NextResponse.json({ error: 'Only HR / HR Admin can correct or reverse leave records.' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    action = 'adjust', // 'adjust' | 'reverse'
    reason,
    newTotalDays,
    newStartDate,
    newEndDate,
    firstDayHalfDay = false,
    firstDaySession = null,
  } = body;

  if (!reason || !reason.trim()) {
    return NextResponse.json({ error: 'A reason is required to correct or reverse a leave record.' }, { status: 400 });
  }

  const service = createLeaveServiceClient();

  const { data: request, error: fetchErr } = await service
    .from('leave_requests')
    .select('*, leave_types ( id, code, display_name )')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !request) {
    return NextResponse.json({ error: 'Leave request not found.' }, { status: 404 });
  }

  if (request.status === 'cancelled' || request.status === 'rejected') {
    return NextResponse.json(
      { error: `Cannot correct a request that is already ${request.status}.` },
      { status: 400 }
    );
  }

  const prevTotalDays = Number(request.total_days);
  const nowIso = new Date().toISOString();
  const fyStartYear = getFYStartYear(new Date(request.start_date));
  const leaveTypeCode = request.leave_types?.code;
  const isBalanceBased = leaveTypeCode && leaveTypeCode !== 'LWP';

  // ───────────────────────────────────────────────────────────────────────────
  // MODE 1: Full Reversal (Cancel the leave entirely and refund all days)
  // ───────────────────────────────────────────────────────────────────────────
  if (action === 'reverse' || newTotalDays === 0) {
    if (isBalanceBased) {
      const { data: balance, error: balError } = await service
        .from('leave_balances')
        .select('id, used')
        .eq('employee_id', request.employee_id)
        .eq('leave_type_id', request.leave_type_id)
        .eq('fy_start_year', fyStartYear)
        .maybeSingle();

      if (balance) {
        await service
          .from('leave_balances')
          .update({ used: Math.max(0, balance.used - prevTotalDays), updated_at: nowIso })
          .eq('id', balance.id);

        await service.from('balance_transactions').insert({
          leave_balance_id: balance.id,
          delta: prevTotalDays,
          reason: 'leave_cancelled',
          reference_id: request.id,
          created_by: actingEmployee.id,
          note: `HR correction: reversed ${prevTotalDays} day(s) for ${request.start_date} to ${request.end_date}. Reason: ${reason.trim()}`,
        });
      }
    }

    const { error: updateError } = await service
      .from('leave_requests')
      .update({
        status: 'cancelled',
        corrected_by: actingEmployee.id,
        correction_reason: reason.trim(),
        corrected_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', request.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await notifyLeaveEvent(service, {
      type: 'corrected',
      requestId: request.id,
      employeeId: request.employee_id,
      source: 'hr_correction',
      leaveTypeCode: leaveTypeCode as 'SL' | 'CL' | 'PL' | 'LWP' | undefined,
      isHalfDay: !!request.is_half_day,
      startDate: request.start_date,
      endDate: request.end_date,
      correctionReason: reason.trim(),
    });

    return NextResponse.json({
      ok: true,
      mode: 'reverse',
      refundedDays: prevTotalDays,
      message: `Reversed leave record. Refunded ${prevTotalDays} day(s).`,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // MODE 2: Partial Adjustment (e.g. 4 days -> 3.5 days, or date range changes)
  // ───────────────────────────────────────────────────────────────────────────
  const targetDays = Number(newTotalDays);
  if (isNaN(targetDays) || targetDays <= 0) {
    return NextResponse.json(
      { error: 'New total days must be a positive number (e.g. 0.5, 1, 1.5, 3.5).' },
      { status: 400 }
    );
  }

  // Ensure steps of 0.5
  if ((targetDays * 2) % 1 !== 0) {
    return NextResponse.json(
      { error: 'Total days must be in increments of 0.5 (half-day or full-day).' },
      { status: 400 }
    );
  }

  // Delta calculation:
  // If prev was 4.0 and target is 3.5 -> delta = +0.5 (refund 0.5 to balance)
  // If prev was 2.0 and target is 3.0 -> delta = -1.0 (debit 1.0 from balance)
  const deltaDays = Number((prevTotalDays - targetDays).toFixed(1));

  if (isBalanceBased && deltaDays !== 0) {
    const { data: balance, error: balError } = await service
      .from('leave_balances')
      .select('id, used, closing_balance')
      .eq('employee_id', request.employee_id)
      .eq('leave_type_id', request.leave_type_id)
      .eq('fy_start_year', fyStartYear)
      .maybeSingle();

    if (balError || !balance) {
      return NextResponse.json(
        { error: `Could not find leave balance for ${leaveTypeCode} (FY${fyStartYear}).` },
        { status: 400 }
      );
    }

    // If increasing days (deltaDays < 0), ensure employee has sufficient remaining balance
    if (deltaDays < 0) {
      const extraNeeded = Math.abs(deltaDays);
      const remaining = balance.closing_balance - balance.used;
      if (remaining < extraNeeded) {
        return NextResponse.json(
          {
            error: `Insufficient ${leaveTypeCode} balance. Needs ${extraNeeded} more day(s), but only ${remaining.toFixed(
              1
            )} day(s) remain.`,
          },
          { status: 400 }
        );
      }
    }

    // Update leave_balances
    const newUsed = Math.max(0, balance.used - deltaDays);
    const { error: balUpdErr } = await service
      .from('leave_balances')
      .update({ used: newUsed, updated_at: nowIso })
      .eq('id', balance.id);

    if (balUpdErr) {
      return NextResponse.json({ error: balUpdErr.message }, { status: 500 });
    }

    // Insert transaction log
    await service.from('balance_transactions').insert({
      leave_balance_id: balance.id,
      delta: deltaDays,
      reason: 'leave_adjusted',
      reference_id: request.id,
      created_by: actingEmployee.id,
      note: `HR correction: adjusted from ${prevTotalDays} to ${targetDays} day(s) (${
        deltaDays > 0 ? `refunded ${deltaDays}` : `debited ${Math.abs(deltaDays)}`
      } day(s)). Reason: ${reason.trim()}`,
    });
  }

  // Update the leave_request
  const isSingleHalfDay = targetDays === 0.5;
  const updatePayload: Record<string, unknown> = {
    total_days: targetDays,
    start_date: newStartDate || request.start_date,
    end_date: newEndDate || request.end_date,
    is_half_day: isSingleHalfDay,
    half_day_session: isSingleHalfDay ? firstDaySession || 'AM' : null,
    corrected_by: actingEmployee.id,
    correction_reason: `${reason.trim()}${
      firstDayHalfDay && targetDays > 0.5 ? ` (Includes half-day adjustment${firstDaySession ? ` - ${firstDaySession}` : ''})` : ''
    }`,
    corrected_at: nowIso,
    updated_at: nowIso,
  };

  const { data: updatedReq, error: reqUpdateErr } = await service
    .from('leave_requests')
    .update(updatePayload)
    .eq('id', request.id)
    .select('*, leave_types(code, display_name)')
    .single();

  if (reqUpdateErr) {
    return NextResponse.json({ error: reqUpdateErr.message }, { status: 500 });
  }

  await notifyLeaveEvent(service, {
    type: 'corrected',
    requestId: request.id,
    employeeId: request.employee_id,
    source: 'hr_correction',
    leaveTypeCode: leaveTypeCode as 'SL' | 'CL' | 'PL' | 'LWP' | undefined,
    isHalfDay: !!updatedReq.is_half_day,
    startDate: updatedReq.start_date,
    endDate: updatedReq.end_date,
    correctionReason: `${reason.trim()} (Adjusted from ${prevTotalDays} to ${targetDays} days)`,
  });

  return NextResponse.json({
    ok: true,
    mode: 'adjust',
    previousTotalDays: prevTotalDays,
    newTotalDays: targetDays,
    deltaDays,
    leaveRequest: updatedReq,
    message: `Leave adjusted from ${prevTotalDays} to ${targetDays} days (${
      deltaDays > 0 ? `+${deltaDays} days credited back` : `${deltaDays} days debited`
    }).`,
  });
}
