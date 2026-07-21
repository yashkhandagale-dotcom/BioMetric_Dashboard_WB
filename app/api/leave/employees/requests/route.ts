import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { TrackerLeaveTypeCode } from '@/lib/leaveSupabase/leaveTypeMap';

const VALID_CODES: TrackerLeaveTypeCode[] = ['SL', 'CL', 'PL', 'LWP'];

function daysBetweenInclusive(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

// This route is the one and only place a leave gets recorded by HR
// directly (source='hr_manual', status='approved' from the start — no
// approval_steps chain actually runs). Every side effect it triggers —
// balance debit, audit row, cross-project sync — lives here so a future
// employee-initiated apply flow can reuse the pieces without inheriting
// the "already approved" assumption.
export async function POST(req: NextRequest) {
  const sessionClient = await createLeaveClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json();
  const {
    employee_id,
    leave_type_code,
    start_date,
    end_date,
    is_half_day,
    half_day_session,
    reason,
  }: {
    employee_id?: string;
    leave_type_code?: string;
    start_date?: string;
    end_date?: string;
    is_half_day?: boolean;
    half_day_session?: 'AM' | 'PM';
    reason?: string;
  } = body;

  if (!employee_id || !leave_type_code || !start_date || !reason) {
    return NextResponse.json(
      { error: 'Missing required fields: employee_id, leave_type_code, start_date, reason' },
      { status: 400 }
    );
  }
  if (!VALID_CODES.includes(leave_type_code as TrackerLeaveTypeCode)) {
    return NextResponse.json({ error: `leave_type_code must be one of ${VALID_CODES.join(', ')}` }, { status: 400 });
  }
  if (is_half_day && half_day_session !== 'AM' && half_day_session !== 'PM') {
    return NextResponse.json({ error: 'half_day_session (AM or PM) is required when is_half_day is true' }, { status: 400 });
  }

  // A half day is always a single date — end_date from the client is
  // ignored/overridden rather than trusted, so a stray multi-day range
  // can't sneak past the 0.5-day total below.
  const effectiveEndDate = is_half_day ? start_date : (end_date || start_date);
  if (new Date(effectiveEndDate) < new Date(start_date)) {
    return NextResponse.json({ error: 'end_date cannot be before start_date' }, { status: 400 });
  }

  const total_days = is_half_day ? 0.5 : daysBetweenInclusive(start_date, effectiveEndDate);

  const service = createLeaveServiceClient();

  const { data: employee, error: empError } = await service
    .from('employees')
    .select('id, employee_code, office, full_name')
    .eq('id', employee_id)
    .single();
  if (empError || !employee) {
    return NextResponse.json({ error: `Employee not found: ${empError?.message ?? employee_id}` }, { status: 400 });
  }

  const { data: leaveType, error: ltError } = await service
    .from('leave_types')
    .select('id, code, requires_certificate_after_days')
    .eq('code', leave_type_code)
    .single();
  if (ltError || !leaveType) {
    return NextResponse.json({ error: `Leave type not found: ${ltError?.message ?? leave_type_code}` }, { status: 400 });
  }

  // Relevant policy checks are applied and surfaced, but never block an
  // HR override — HR recording leave directly is frequently the
  // exception case (backdated entries, negotiated exceptions), so these
  // come back as advisory notes rather than errors.
  const policy_notes: string[] = [];
  if (
    leaveType.code === 'SL' &&
    !is_half_day &&
    leaveType.requires_certificate_after_days != null &&
    total_days > leaveType.requires_certificate_after_days
  ) {
    policy_notes.push(
      `Handbook normally requires a medical certificate for SL beyond ${leaveType.requires_certificate_after_days} consecutive days — not enforced for this HR entry.`
    );
  }
  if (leaveType.code === 'PL') {
    const { data: shortfall } = await service.rpc('fn_check_planned_leave_notice', {
      p_applied_on: new Date().toISOString().slice(0, 10),
      p_start_date: start_date,
      p_leave_length_days: total_days,
    });
    if (typeof shortfall === 'number' && shortfall > 0) {
      policy_notes.push(
        `Notice given falls short of the PL policy tier by an equivalent of ${shortfall} day(s) — not auto-converted to LWP for this HR entry.`
      );
    }
  }

  const { data: created, error: insertError } = await service
    .from('leave_requests')
    .insert({
      employee_id,
      leave_type_id: leaveType.id,
      start_date,
      end_date: effectiveEndDate,
      is_half_day: !!is_half_day,
      half_day_session: is_half_day ? half_day_session : null,
      total_days,
      reason,
      status: 'approved',
      source: 'hr_manual',
    })
    .select()
    .single();
  if (insertError || !created) {
    return NextResponse.json({ error: insertError?.message ?? 'Failed to create leave request' }, { status: 400 });
  }

  // S1-1: debit the balance atomically. fn_debit_leave_on_approval() raises
  // when the requested paid type (SL/CL/PL) doesn't have enough balance.
  // Per spec, that is never a hard rejection: the entry is auto-converted
  // to LWP (which draws from no pool, so it always succeeds) and HR is
  // told why. Only a genuine second failure (e.g. no LWP balance row
  // provisioned at all) falls back to rejecting and undoing the insert.
  let finalLeaveType = leaveType;
  let convertedToLwp = false;

  let { error: debitError } = await service.rpc('fn_debit_leave_on_approval', {
    p_leave_request_id: created.id,
  });

  if (debitError && leaveType.code !== 'LWP') {
    const { data: lwpType, error: lwpError } = await service
      .from('leave_types')
      .select('id, code, requires_certificate_after_days')
      .eq('code', 'LWP')
      .single();

    if (!lwpError && lwpType) {
      const { error: retypeError } = await service
        .from('leave_requests')
        .update({ leave_type_id: lwpType.id })
        .eq('id', created.id);

      if (!retypeError) {
        const retry = await service.rpc('fn_debit_leave_on_approval', {
          p_leave_request_id: created.id,
        });
        if (!retry.error) {
          finalLeaveType = lwpType;
          convertedToLwp = true;
          debitError = null;
          policy_notes.push(
            `Insufficient ${leaveType.code} balance — recorded as LWP instead.`
          );
        } else {
          debitError = retry.error;
        }
      }
    }
  }

  if (debitError) {
    await service.from('leave_requests').delete().eq('id', created.id);
    return NextResponse.json({ error: debitError.message, policy_notes }, { status: 400 });
  }

  // S1-3: synthetic approval_steps row so the audit trail reads
  // consistently even though no real tech-lead -> manager -> HR chain
  // ran for this hr_manual entry.
  let hrEmployeeId: string | null = null;
  const { data: hrEmployee } = await service
    .from('employees')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  hrEmployeeId = hrEmployee?.id ?? null;

  if (hrEmployeeId) {
    await service.from('approval_steps').insert({
      leave_request_id: created.id,
      approver_id: hrEmployeeId,
      approver_role: 'hr',
      sequence_order: 1,
      status: 'approved',
      comment: 'Recorded directly by HR (hr_manual) — no approval chain run.',
      acted_on: new Date().toISOString(),
    });
  }
  // If the signed-in auth user has no matching `employees` row (auth_user_id
  // unset), we skip the audit row rather than fail the whole request or
  // guess an approver — see the "single shared workspace" note in
  // app/leave/admin/layout.tsx for why that link can be missing today.

  // No write-through sync step: the main attendance dashboard now reads
  // leave data live from this project at render time (see
  // app/api/dashboard/leave-records/route.ts), so there is nothing to
  // push and nothing that can drift.
  return NextResponse.json(
    {
      leave_request: {
        ...created,
        leave_type_id: finalLeaveType.id,
      },
      converted_to_lwp: convertedToLwp,
      policy_notes,
    },
    { status: 201 }
  );
}