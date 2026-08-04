import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';

// Sprint A scaffolding only. Sprint C adds the real queue: request cards
// with balance snapshot + violation badge, approve/reject wired through
// the single applyLeavePolicyAndMutateBalance() service function (plan
// section 5a/7) — not implemented here, this just proves the pending
// `leave_requests` query resolves for a real manager's reports.
export default async function LeaveApprovalsHome() {
  const employee = await getCurrentEmployee();
  const supabase = await createLeaveClient();

  const { data: pending } = await supabase
    .from('leave_requests')
    .select('id, employee_id, start_date, end_date, status, employees!inner(full_name, reporting_manager_id)')
    .eq('status', 'pending')
    .eq('employees.reporting_manager_id', employee?.id ?? '');

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <p className="text-[var(--text-muted)] text-xs mb-1">Leave Tracker</p>
        <h1 className="text-xl font-semibold mb-6">Pending Approvals</h1>
        <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-6 text-sm">
          {pending && pending.length > 0 ? (
            <p className="text-[var(--text-muted)]">{pending.length} request(s) pending your approval.</p>
          ) : (
            <p className="text-[var(--text-muted)]">No pending requests right now.</p>
          )}
        </div>
        <p className="text-[var(--text-muted)] text-xs mt-6">
          Approve/reject with violation flags lands in Sprint C.
        </p>
      </div>
    </div>
  );
}
