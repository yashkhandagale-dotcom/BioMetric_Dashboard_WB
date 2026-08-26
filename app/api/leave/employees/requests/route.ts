import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { TrackerLeaveTypeCode } from '@/lib/leaveSupabase/leaveTypeMap';
import { applyLeavePolicyAndMutateBalance } from '@/lib/leaveSupabase/applyLeavePolicyAndMutateBalance';

const VALID_CODES: TrackerLeaveTypeCode[] = ['SL', 'CL', 'PL', 'LWP'];

// This route is the one and only place a leave gets recorded by HR
// directly (source='hr_manual', status='approved' from the start — no
// approval_steps chain actually runs). D2-4: request/response contract
// is unchanged from Day 2.
//
// Refactor (see PROGRESS.md, "Consolidate the leave-balance write
// path"): every side effect this route used to run inline — policy
// checks (lib/leavePolicy.ts), the leave_requests insert, the balance
// debit (with its insufficient-balance -> LWP fallback), and the
// synthetic approval_steps audit row — now lives in
// lib/leaveSupabase/applyLeavePolicyAndMutateBalance.ts instead, so a
// future employee self-apply / manager-approval route can reuse the
// exact same write path (source: 'self_apply' / 'manager_approval')
// rather than re-deriving it. This route now only does request-shape
// validation and reshapes the shared function's result back into the
// exact JSON contract this route already had — no behavior change for
// HR's existing manual-entry flow (verified in PROGRESS.md with real
// before/after balance numbers).
//
// RecordLeaveForm.tsx needed no changes for this refactor: it only ever
// talks to this route's request/response contract, which is unchanged.
export async function POST(req: NextRequest) {
  const sessionClient = await createLeaveClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // hr_super_admin (HR Admin) is remind-only — same restriction already
  // enforced on the approvals queue (canApprove = !isHrSuperAdmin in
  // app/leave/approvals/page.tsx). Recording leave manually is an
  // action reserved for plain `hr` (and above); HR Admin nudges people
  // via reminders instead. This was previously unenforced here — any
  // authenticated employee row, including hr_super_admin, could record
  // leave on someone else's behalf.
  const { data: actingEmployee } = await sessionClient
    .from('employees')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (
  !actingEmployee ||
  !['hr', 'hr_super_admin'].includes(actingEmployee.role)
) {
  return NextResponse.json(
    { error: 'You do not have permission to record leave.' },
    { status: 403 }
  );
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
    action_plan,
  }: {
    employee_id?: string;
    leave_type_code?: string;
    start_date?: string;
    end_date?: string;
    is_half_day?: boolean;
    half_day_session?: 'AM' | 'PM';
    reason?: string;
    // Additive/optional — supabase-leave/schema.sql already has this
    // column, RecordLeaveForm.tsx just never sent it. Accepting it here
    // is backward compatible: omitted (as today) behaves identically to
    // before (stored as null).
    action_plan?: string;
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

  // Who is recording this (for the synthetic approval_steps audit row) —
  // resolved up front now, instead of at the very end as the pre-refactor
  // inline version did, since applyLeavePolicyAndMutateBalance needs it
  // as an input rather than something the route wires in after the fact.
  // Same lookup, same fallback (skip the audit row if unresolved) as
  // before — just earlier in the sequence, which has no effect on the
  // outcome.
  const service = createLeaveServiceClient();
  const { data: hrEmployee } = await service
    .from('employees')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  const hrEmployeeId: string | null = hrEmployee?.id ?? null;

  const result = await applyLeavePolicyAndMutateBalance({
    employeeId: employee_id,
    leaveTypeCode: leave_type_code as TrackerLeaveTypeCode,
    startDate: start_date,
    endDate: end_date ?? null,
    isHalfDay: !!is_half_day,
    halfDaySession: is_half_day ? half_day_session : undefined,
    reason,
    actionPlan: action_plan,
    source: 'hr_manual',
    actingEmployeeId: hrEmployeeId,
  });

  if (result.violation) {
    // 'debit_failed' is the one case the pre-refactor route surfaced
    // policy_notes alongside the error (so HR can see e.g. the notice-
    // period note even though the request that triggered it was rolled
    // back) — every other violation type keeps the plain `{ error }`
    // shape it always had.
    if (result.violation.type === 'debit_failed') {
      return NextResponse.json(
        { error: result.violation.reason, policy_notes: result.policyNotes },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: result.violation.reason }, { status: 400 });
  }

  // No write-through sync step: the main attendance dashboard now reads
  // leave data live from this project at render time (see
  // app/api/dashboard/leave-records/route.ts), so there is nothing to
  // push and nothing that can drift.
  return NextResponse.json(
    {
      leave_request: result.leaveRequest,
      converted_to_lwp: result.convertedToLwp,
      policy_notes: result.policyNotes,
    },
    { status: 201 }
  );
}
