import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { sendEscalationReminder, type EscalationTargetType } from '@/lib/leaveSupabase/attendanceEscalation';

// "Remind All" — bulk version of /api/leave/attendance/remind for the
// Absentees/Half Day tabs, so HR isn't stuck clicking Remind one row at
// a time on a big list.
//
// Constraint decision: there is no separate "bulk cooldown" on this
// button itself — every target still goes through the exact same
// sendEscalationReminder('manual') gate as the single-row button, so a
// person reminded 2 hours ago is automatically skipped (not blocked
// with an error) rather than the whole batch being refused. That keeps
// this safe to click repeatedly (e.g. after filtering to a different
// department) without HR needing to think about timing — the per-target
// 24h/48h rules already do that job. Results are returned per-target so
// the UI can show "Sent 12, skipped 3 (already reminded recently)".
export async function POST(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: actingEmployee } = await supabase.from('employees').select('id, role').eq('auth_user_id', user.id).maybeSingle();
  if (!actingEmployee || !['manager', 'lead', 'hr', 'hr_super_admin'].includes(actingEmployee.role)) {
    return NextResponse.json({ error: 'Only a manager, lead, or HR can send reminders' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const targets = (body.targets ?? []) as { targetType: EscalationTargetType; targetId: string; key: string }[];
  if (!Array.isArray(targets) || targets.length === 0) {
    return NextResponse.json({ error: 'No targets provided' }, { status: 400 });
  }
  if (targets.length > 200) {
    return NextResponse.json({ error: 'Too many targets in one batch (max 200) — narrow your filters first.' }, { status: 400 });
  }
  for (const t of targets) {
    if (!['attendance_exception_unmarked', 'leave_request_pending', 'regularisation_pending'].includes(t.targetType) || !t.targetId || !t.key) {
      return NextResponse.json({ error: 'Invalid target in batch' }, { status: 400 });
    }
  }

  const service = createLeaveServiceClient();

  // Sequential, not parallel — these all read-then-write the same
  // leave_policy_config row and (for repeat targets) the same
  // escalation_reminders row; running them concurrently risks the same
  // kind of stale-read race that caused the reminder-count bug, so this
  // trades a little wall-clock time for correctness on a batch action
  // that isn't user-blocking-latency-sensitive the way a single click is.
  const results: { key: string; sent: boolean; reminderCount?: number; error?: string; nextAllowedAt?: string }[] = [];
  for (const t of targets) {
    const outcome = await sendEscalationReminder(service, t.targetType, t.targetId, 'manual');
    results.push({
      key: t.key,
      sent: outcome.ok,
      reminderCount: outcome.reminderCount,
      error: outcome.error,
      nextAllowedAt: outcome.nextAllowedAt,
    });
  }

  const sentCount = results.filter((r) => r.sent).length;
  return NextResponse.json({ results, sentCount, skippedCount: results.length - sentCount });
}
