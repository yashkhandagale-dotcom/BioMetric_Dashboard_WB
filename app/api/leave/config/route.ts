import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import {
  getLeavePolicyConfig,
  getLeaveTypeConfigs,
  updateLeavePolicyConfig,
  updateLeaveTypeConfig,
  LeaveTypeConfigUpdate,
} from '@/lib/leaveSupabase/leaveConfig';

// Feedback item #3 — "Leave Configuration & Policy" HR page backend.
// HR-only (both roles — hr_super_admin included, since this is
// configuration, not an approval action).
async function requireHr(sessionClient: Awaited<ReturnType<typeof createLeaveClient>>) {
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return { employee: null, error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  const { data: employee } = await sessionClient
    .from('employees')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!employee || (employee.role !== 'hr' && employee.role !== 'hr_super_admin')) {
    return { employee: null, error: NextResponse.json({ error: 'HR role required' }, { status: 403 }) };
  }
  return { employee, error: null };
}

export async function GET() {
  const sessionClient = await createLeaveClient();
  const { employee, error } = await requireHr(sessionClient);
  if (error) return error;

  const [{ config, error: configError }, { types, error: typesError }] = await Promise.all([
    getLeavePolicyConfig(sessionClient),
    getLeaveTypeConfigs(sessionClient),
  ]);
  const firstError = configError || typesError;
  if (firstError) return NextResponse.json({ error: firstError }, { status: 500 });

  return NextResponse.json({ config, leaveTypes: types });
}

export async function PUT(req: NextRequest) {
  const sessionClient = await createLeaveClient();
  const { employee, error } = await requireHr(sessionClient);
  if (error) return error;

  const body = await req.json();
  const { policyConfig, leaveTypeUpdates } = body as {
    policyConfig?: { probationUnlockMonths?: number; noticePeriodDefaultDays?: number };
    leaveTypeUpdates?: LeaveTypeConfigUpdate[];
  };

  if (policyConfig) {
    const { error: updateError } = await updateLeavePolicyConfig(sessionClient, policyConfig, employee!.id);
    if (updateError) return NextResponse.json({ error: updateError }, { status: 500 });
  }

  if (Array.isArray(leaveTypeUpdates)) {
    for (const update of leaveTypeUpdates) {
      const { error: updateError } = await updateLeaveTypeConfig(sessionClient, update, employee!.id);
      if (updateError) return NextResponse.json({ error: updateError }, { status: 500 });
    }
  }

  const [{ config }, { types }] = await Promise.all([
    getLeavePolicyConfig(sessionClient),
    getLeaveTypeConfigs(sessionClient),
  ]);
  return NextResponse.json({ config, leaveTypes: types });
}
