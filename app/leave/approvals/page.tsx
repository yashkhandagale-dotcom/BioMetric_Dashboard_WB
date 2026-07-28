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
    <div className="min-h-screen bg-slate-900 text-white px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <p className="text-slate-500 text-xs mb-1">Leave Tracker</p>
        <h1 className="text-xl font-semibold mb-6">Pending Approvals</h1>
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-6 text-sm">
          {pending && pending.length > 0 ? (
            <p className="text-slate-300">{pending.length} request(s) pending your approval.</p>
          ) : (
            <p className="text-slate-500">No pending requests right now.</p>
          )}
        </div>
        <p className="text-slate-600 text-xs mt-6">
          Approve/reject with violation flags lands in Sprint C.
        </p>
      </div>
    </div>
  );
}
