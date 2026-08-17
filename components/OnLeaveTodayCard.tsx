'use client';

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';

// Feedback item #1 — a KPI card so HR (or a manager/lead viewing the
// read-only Dashboard) can see who's on pre-approved leave today
// without leaving the attendance dashboard. Self-fetching (own useEffect
// + /api/leave/kpis/on-leave-today) rather than a prop threaded through
// DashboardClient's two render paths (HRDashboard/ManagerView) — this
// keeps it a true drop-in next to <KPICards /> with zero changes to
// DashboardClient's existing prop plumbing or its CSV-derived KPIData
// pipeline, which this data (Supabase leave_requests, not attendance
// CSVs) doesn't belong in anyway.
type OnLeaveEmployee = {
  employeeName: string;
  employeeCode: string;
  department: string;
  leaveTypeLabel: string;
  isHalfDay: boolean;
  halfDaySession: string | null;
};

export default function OnLeaveTodayCard() {
  const [count, setCount] = useState<number | null>(null);
  const [employees, setEmployees] = useState<OnLeaveEmployee[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/leave/kpis/on-leave-today')
      .then((res) => (res.ok ? res.json() : { count: 0, employees: [] }))
      .then((body) => {
        if (cancelled) return;
        setCount(body.count ?? 0);
        setEmployees(body.employees ?? []);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={!count}
        className="w-full flex items-center justify-between text-left disabled:cursor-default"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500/15 flex items-center justify-center flex-shrink-0">
            <Users className="w-4 h-4 text-sky-500" />
          </div>
          <div>
            <p className="text-[var(--text-muted)] text-xs">On Pre-Approved Leave Today</p>
            <p className="text-[var(--text-primary)] text-lg font-semibold">{count === null ? '…' : count}</p>
          </div>
        </div>
        {!!count && (
          <span className="text-[var(--text-muted)] text-xs">{expanded ? 'Hide' : 'View'}</span>
        )}
      </button>

      {expanded && employees.length > 0 && (
        <ul className="mt-3 pt-3 border-t border-[var(--border)] divide-y divide-[var(--border)]">
          {employees.map((e) => (
            <li key={`${e.employeeCode}-${e.leaveTypeLabel}`} className="py-1.5 flex items-center justify-between text-xs">
              <span className="text-[var(--text-primary)]">{e.employeeName} <span className="text-[var(--text-muted)]">· {e.department}</span></span>
              <span className="text-[var(--text-muted)]">
                {e.leaveTypeLabel}{e.isHalfDay ? ` (${e.halfDaySession ?? 'half day'})` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
