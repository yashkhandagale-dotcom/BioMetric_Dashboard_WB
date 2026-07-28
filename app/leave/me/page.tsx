import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';

// Sprint A scaffolding only. Sprint B replaces this with the real
// Apply-for-Leave form + balance/history views (reusing the existing
// policy engine and RecordLeaveForm's validation logic, per the plan's
// section 5a/7).
export default async function LeaveMeHome() {
  const employee = await getCurrentEmployee();

  return (
    <div className="min-h-screen bg-slate-900 text-white px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <p className="text-slate-500 text-xs mb-1">Leave Tracker</p>
        <h1 className="text-xl font-semibold mb-6">My Leave</h1>
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-6 space-y-1 text-sm">
          <p className="text-slate-300">
            Signed in as <span className="text-white font-medium">{employee?.full_name}</span>
          </p>
          <p className="text-slate-500">
            {employee?.employee_code} · {employee?.department} · {employee?.office} · role: {employee?.role}
          </p>
        </div>
        <p className="text-slate-600 text-xs mt-6">
          Apply-for-leave form, balance summary, and personal history land in Sprint B.
        </p>
      </div>
    </div>
  );
}
