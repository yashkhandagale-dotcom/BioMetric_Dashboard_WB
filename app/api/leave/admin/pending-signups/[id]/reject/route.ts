import { NextRequest, NextResponse } from 'next/server';
import { createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';

// POST /api/leave/admin/pending-signups/[id]/reject — HR-only.
// Rejects a pending signup with an optional reason/note.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requester = await getCurrentEmployee();
  if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const rejectionReason =
    typeof body?.rejectionReason === 'string'
      ? body.rejectionReason.trim().slice(0, 500)
      : null;

  const service = createLeaveServiceClient();

  // Update the pending signup to mark it as rejected
  const { data, error } = await service
    .from('pending_employee_signups')
    .update({
      status: 'rejected',
      rejected_at: new Date().toISOString(),
      rejected_by: requester.id,
      rejection_reason: rejectionReason,
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
    message: 'Signup rejected successfully',
    signup: data,
  });
}
