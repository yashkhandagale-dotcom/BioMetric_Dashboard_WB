import { NextRequest, NextResponse } from 'next/server';
import { createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';

// POST /api/leave/admin/pending-signups/[id]/acknowledge — HR-only.
// Marks a pending signup as acknowledged. The actual employee record
// is still created in app/api/leave/employees/route.ts via AddEmployeeForm.
// This just tracks the HR acknowledgment timestamp and person.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requester = await getCurrentEmployee();
  if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const { id } = await params;

  const service = createLeaveServiceClient();

  // Update the pending signup to mark it as acknowledged
  const { data, error } = await service
    .from('pending_employee_signups')
    .update({
      status: 'acknowledged',
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: requester.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, email, full_name')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json(
      { error: 'Pending signup not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    message: 'Signup acknowledged',
    signup: data,
  });
}
