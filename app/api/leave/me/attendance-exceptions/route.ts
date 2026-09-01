import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getMyUnmarkedAttendanceExceptions } from '@/lib/leaveSupabase/attendanceEscalation';

export type SubmittedAttendanceRequest = {
  id: string;
  exceptionDate: string;
  exceptionType: string;
  employeeChoice: 'missed_punch' | 'half_day' | 'regularise';
  employeeNote: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'resolved';
  submittedAt: string;
  leaveRequestId?: string | null;
  regularisationId?: string | null;
};

// Part C, §C.2 — the employee's own unmarked attendance days + their submitted requests
export async function GET(_req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: actingEmployee } = await supabase.from('employees').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (!actingEmployee) return NextResponse.json({ error: 'Employee record not found for this account' }, { status: 403 });

  const service = createLeaveServiceClient();
  const { exceptions, error } = await getMyUnmarkedAttendanceExceptions(service, actingEmployee.id);
  if (error) return NextResponse.json({ error }, { status: 500 });

  // Fetch submitted requests from attendance_exceptions where employee_choice is set
  const { data: exceptionRows } = await service
    .from('attendance_exceptions')
    .select(`
      id, exception_date, exception_type, employee_choice, employee_note, updated_at,
      regularisation_id, leave_request_id,
      leave_regularisations:regularisation_id ( id, status ),
      leave_requests:leave_request_id ( id, status )
    `)
    .eq('employee_id', actingEmployee.id)
    .not('employee_choice', 'is', null)
    .order('exception_date', { ascending: false });

  type RawExceptionRow = {
    id: string;
    exception_date: string;
    exception_type: string;
    employee_choice: string;
    employee_note: string | null;
    updated_at: string;
    regularisation_id: string | null;
    leave_request_id: string | null;
    leave_regularisations: { id: string; status: string } | { id: string; status: string }[] | null;
    leave_requests: { id: string; status: string } | { id: string; status: string }[] | null;
  };

  const firstOf = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

  const submittedRequests: SubmittedAttendanceRequest[] = ((exceptionRows ?? []) as unknown as RawExceptionRow[]).map((r) => {
    let status: SubmittedAttendanceRequest['status'] = 'pending';
    if (r.employee_choice === 'missed_punch') {
      status = 'resolved';
    } else if (r.employee_choice === 'regularise') {
      const reg = firstOf(r.leave_regularisations);
      status = (reg?.status as SubmittedAttendanceRequest['status']) || 'pending';
    } else if (r.employee_choice === 'half_day') {
      const req = firstOf(r.leave_requests);
      status = (req?.status as SubmittedAttendanceRequest['status']) || 'pending';
    }

    return {
      id: r.id,
      exceptionDate: r.exception_date,
      exceptionType: r.exception_type,
      employeeChoice: r.employee_choice as SubmittedAttendanceRequest['employeeChoice'],
      employeeNote: r.employee_note,
      status,
      submittedAt: r.updated_at,
      leaveRequestId: r.leave_request_id,
      regularisationId: r.regularisation_id,
    };
  });

  return NextResponse.json({ exceptions, submittedRequests });
}

