import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';

// Sprint A scaffolding only. Sprint E adds the real read-only team
// calendar (plan section 4) — this just proves the reporting_lead_id
// scoping query works end to end.
export default async function LeaveTeamHome() {
  const employee = await getCurrentEmployee();
  const supabase = await createLeaveClient();

  const { data: reports } = await supabase
    .from('employees')
    .select('id, full_name, employee_code, department')
    .eq('reporting_lead_id', employee?.id ?? '')
    .order('full_name');

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <p className="text-[var(--text-muted)] text-xs mb-1">Leave Tracker</p>
        <h1 className="text-xl font-semibold mb-6">My Team</h1>
        <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-6 text-sm">
          {reports && reports.length > 0 ? (
            <ul className="space-y-2">
              {reports.map((r) => (
                <li key={r.id} className="flex justify-between text-[var(--text-muted)]">
                  <span>{r.full_name}</span>
                  <span className="text-[var(--text-muted)]">{r.employee_code} · {r.department}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[var(--text-muted)]">No direct reports found for this lead yet.</p>
          )}
        </div>
        <p className="text-[var(--text-muted)] text-xs mt-6">
          Read-only calendar view of this list lands in Sprint E.
        </p>
      </div>
    </div>
  );
}
