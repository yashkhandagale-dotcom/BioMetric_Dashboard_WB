export type LeaveHistoryRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  office: string;
  leaveTypeCode: string;
  leaveTypeLabel: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  halfDaySession: string | null;
  totalDays: number;
  status: string;
  isLwpOverride: boolean;
  appliedOn: string;
  recordedBy: string;
};

function formatDateRange(start: string, end: string) {
  return start === end ? start : `${start} → ${end}`;
}

// D3-2: columns are exactly employee, type, dates, days, half-day flag,
// LWP-override, applied-on, recorded-by — the list from the Sprint
// Tracker's Acceptance Criteria for this file, nothing added.
export default function LeaveHistoryTable({ rows }: { rows: LeaveHistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="bg-slate-800/40 border border-slate-700 rounded-xl px-4 py-10 text-center text-slate-500 text-sm">
        No leave records match the current filters.
      </div>
    );
  }

  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-400 text-xs border-b border-slate-700">
            <th className="px-4 py-3">Employee</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Dates</th>
            <th className="px-4 py-3 text-right">Days</th>
            <th className="px-4 py-3">Half-day</th>
            <th className="px-4 py-3">LWP override</th>
            <th className="px-4 py-3">Applied On</th>
            <th className="px-4 py-3">Recorded By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-800 last:border-0">
              <td className="px-4 py-2.5">
                <p className="text-white">{r.employeeName}</p>
                <p className="text-slate-500 text-xs">
                  {r.employeeCode} · {r.department} · {r.office}
                </p>
              </td>
              <td className="px-4 py-2.5 text-slate-300">{r.leaveTypeLabel}</td>
              <td className="px-4 py-2.5 text-slate-400">{formatDateRange(r.startDate, r.endDate)}</td>
              <td className="px-4 py-2.5 text-right text-slate-300">{r.totalDays.toFixed(2)}</td>
              <td className="px-4 py-2.5 text-slate-400">
                {r.isHalfDay ? (r.halfDaySession ?? 'Yes') : '—'}
              </td>
              <td className="px-4 py-2.5">
                {r.isLwpOverride ? (
                  <span className="text-amber-400 text-xs">Yes</span>
                ) : (
                  <span className="text-slate-600 text-xs">—</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-slate-400">{new Date(r.appliedOn).toLocaleDateString()}</td>
              <td className="px-4 py-2.5 text-slate-400">{r.recordedBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
