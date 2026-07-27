'use client';

import { useEffect, useState } from 'react';
import { Info, X } from 'lucide-react';

type LeaveType = {
  code: string;
  display_name: string;
  annual_quota: number;
  max_consecutive_days: number | null;
  min_notice_days_tier: Record<string, number> | null;
  requires_certificate_after_days: number | null;
  is_directly_applicable: boolean;
};

// HR/Admin-only Info button + modal (section 11). Visibility: every route
// under /leave/admin/** is already gated to authenticated HR/Admin by
// LeaveAdminLayout — see that file's "v1 scope" comment — so there's no
// separate role check to add here; this button simply doesn't exist
// outside that subtree.
//
// Leave-type numbers (quota, notice tiers, certificate threshold) are
// fetched from /api/leave/policy — i.e. straight from leave_types — so
// this can't say something different from what
// /api/leave/employees/requests actually enforces.
export default function PolicyInfoButton() {
  const [open, setOpen] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || leaveTypes.length > 0) return;
    setLoading(true);
    fetch('/api/leave/policy')
      .then((r) => r.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else setLeaveTypes(body.leaveTypes ?? []);
      })
      .catch(() => setError('Could not load leave-type details.'))
      .finally(() => setLoading(false));
  }, [open, leaveTypes.length]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Leave & attendance policy"
        className="border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white p-2 rounded-lg transition-colors"
      >
        <Info size={16} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 sticky top-0 bg-slate-900">
              <h3 className="text-white font-semibold text-sm">Leave & Attendance Policy</h3>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-5 text-sm text-slate-300">
              <section>
                <h4 className="text-white font-medium mb-2">Leave Types & Balances</h4>
                {loading && <p className="text-slate-500 text-xs">Loading…</p>}
                {error && <p className="text-red-300 text-xs">{error}</p>}
                {leaveTypes.length > 0 && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-800">
                        <th className="text-left font-medium py-1">Type</th>
                        <th className="text-left font-medium py-1">Annual Quota</th>
                        <th className="text-left font-medium py-1">Max Consecutive</th>
                        <th className="text-left font-medium py-1">Certificate After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaveTypes.map((lt) => (
                        <tr key={lt.code} className="border-b border-slate-800/60 last:border-0">
                          <td className="py-1 text-white">{lt.display_name} ({lt.code})</td>
                          <td className="py-1">{lt.annual_quota} days/yr</td>
                          <td className="py-1">{lt.max_consecutive_days ?? '—'}</td>
                          <td className="py-1">{lt.requires_certificate_after_days ? `${lt.requires_certificate_after_days} days` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="text-xs text-slate-500 mt-2">
                  Closing balance = opening + accrued + manual adjustment − used, recalculated live per financial
                  year (see the FY selector on the Leave Balances page). Balances reset at the start of each new FY,
                  not monthly — accrual/opening figures for a new FY come from the prior year's closing balance via
                  the FY-rollover job.
                </p>
              </section>

              <section>
                <h4 className="text-white font-medium mb-2">Approval Flow</h4>
                <p className="text-xs">
                  Leave recorded here by HR is entered directly (source = HR manual entry) and does not go through a
                  separate approval queue — HR recording it IS the approval. Requests submitted by an employee's own
                  self-service (where enabled) follow the approval_steps chain instead.
                </p>
              </section>

              <section>
                <h4 className="text-white font-medium mb-2">Attendance Rules</h4>
                <ul className="text-xs list-disc pl-4 space-y-1">
                  <li><span className="text-white">Present</span> — normal punch-in/out for the day, worked minutes above the half-day threshold.</li>
                  <li><span className="text-white">Unmarked Leave</span> — no valid punch activity for the day, and no approved leave, WFH, holiday, or weekly-off covering it.</li>
                  <li><span className="text-white">Late Coming / Early Leaving</span> — in-time after or out-time before the office's standard shift window; tracked as an attendance note on the record, not a separate leave/half-day category by itself.</li>
                </ul>
              </section>

              <section>
                <h4 className="text-white font-medium mb-2">Half Day Rules</h4>
                <p className="text-xs">
                  If the gap between an employee's first and last punch for the day is 5 hours or less, the day is
                  <span className="text-white"> not</span> automatically left as unmarked leave — it surfaces under "Possible
                  Half Day / Missed Punch" for HR to review and, if appropriate, mark as a half-day leave (Half
                  Sick / Casual / Paid Leave — i.e. the normal leave type with the half-day flag set).
                </p>
              </section>

              <section>
                <h4 className="text-white font-medium mb-2">Missed Punch Rules</h4>
                <p className="text-xs">
                  A day with only one punch (in or out, not both) or an out-time that reads as unrecorded is flagged
                  the same way. Marking it "Missed Punch" records it for attendance/payroll review only — it does
                  <span className="text-white"> not</span> create a leave request and does not touch any leave
                  balance.
                </p>
              </section>

              <section>
                <h4 className="text-white font-medium mb-2">Working Hours & Exemptions</h4>
                <p className="text-xs">
                  A day is excluded from both the absentee and half-day lists entirely (not just re-labeled) when it
                  falls on a weekly off, a holiday for that employee's office, an already-approved leave, or a
                  logged Work From Home / Business Travel / office-shutdown event for that employee.
                </p>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}