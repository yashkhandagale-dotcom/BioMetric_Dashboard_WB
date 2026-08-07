'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ApplyLeaveDrawer from './ApplyLeaveDrawer';
import type { ApplySubmitResult } from './ApplyLeaveForm';

// A5/A6 — "Add an 'Apply for Leave' button in the navbar on /leave/me
// that opens this form (modal or drawer, match the existing
// RecordLeaveDrawer pattern)." app/leave/me/page.tsx itself is a Server
// Component (fetches employee/balances/history live per request); this
// is the one client island on that page — it owns the drawer's
// open/closed state and, on a successful submit, calls
// router.refresh() so the balance cards and history table (both
// server-rendered) immediately reflect the new pending request without
// a full page reload.
// Single-login pivot: `role` drives which extra nav buttons show up next
// to "Apply for Leave" — manager/lead land here first after login (see
// lib/leaveSupabase/getCurrentEmployee.ts's homeRouteForRole) and need a
// way out to their approval queue and their read-only, team-scoped
// dashboard view; hr/hr_super_admin get a plain link back to the main
// Dashboard for the rare case they end up on this page. Plain `employee`
// gets no extra buttons at all — this page (their own leave) is the only
// place they're allowed to be.
export default function MeNavbar({
  employeeName,
  role,
}: {
  employeeName: string;
  role?: 'employee' | 'lead' | 'manager' | 'hr' | 'hr_super_admin';
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function handleSuccess(_result: ApplySubmitResult) {
    router.refresh();
  }

  const isApprover = role === 'manager' || role === 'lead';
  const isHr = role === 'hr' || role === 'hr_super_admin';

  return (
    <>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-[var(--text-muted)] text-xs mb-1">Leave Tracker</p>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">My Leave</h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">{employeeName}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isApprover && (
            <>
              <a
                href="/leave/approvals"
                className="flex items-center gap-1.5 bg-amber-600/20 border border-amber-500/30 text-amber-500 dark:text-amber-400 px-3 py-2 rounded-lg text-sm font-medium hover:bg-amber-600/30 transition-colors"
              >
                Approve Team Leaves
              </a>
              <a
                href="/"
                className="flex items-center gap-1.5 bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-primary)] px-3 py-2 rounded-lg text-sm font-medium hover:bg-[var(--bg-elevated)]/70 transition-colors"
              >
                Team Dashboard
              </a>
            </>
          )}
          {isHr && (
            <a
              href="/"
              className="flex items-center gap-1.5 bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-primary)] px-3 py-2 rounded-lg text-sm font-medium hover:bg-[var(--bg-elevated)]/70 transition-colors"
            >
              Dashboard
            </a>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Apply for Leave
          </button>
        </div>
      </div>

      {open && <ApplyLeaveDrawer onClose={() => setOpen(false)} onSuccess={handleSuccess} />}
    </>
  );
}