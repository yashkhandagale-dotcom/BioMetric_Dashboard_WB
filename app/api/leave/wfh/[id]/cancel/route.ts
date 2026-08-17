import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { cancelWfhRequest } from '@/lib/leaveSupabase/wfhRequests';

// Feedback item #12 (Cancellation/Withdrawal), applied to WFH too — an
// employee can withdraw their own pending or approved WFH request.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionClient = await createLeaveClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: actingEmployee } = await sessionClient
    .from('employees')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!actingEmployee) return NextResponse.json({ error: 'No employee record linked to this account' }, { status: 403 });

  const result = await cancelWfhRequest(sessionClient, id, actingEmployee.id);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ id: result.id });
}
