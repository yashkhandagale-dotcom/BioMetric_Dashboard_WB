'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ApplyLeaveDrawer from './ApplyLeaveDrawer';
import type { ApplySubmitResult } from './ApplyLeaveForm';
import LeavePageHeader from './LeavePageHeader';

// app/leave/me/page.tsx itself is a Server Component (fetches employee/
// balances/history live per request); this is the one client island on
// that page — it owns the "Apply for Leave" drawer's open/closed state
// and, on a successful submit, calls router.refresh() so the balance
// cards and history table (both server-rendered) immediately reflect
// the new pending request without a full page reload.
//
// This used to also carry a handful of role-conditional cross-links
// (Approve Team Leaves, Team Dashboard, Dashboard, Change Password) —
// all of that navigation now lives permanently in LeaveShell's sidebar/
// tab strip, so this component's only job is the page title and the one
// action that's actually specific to this page.
export default function MeNavbar({
  employeeName,
}: {
  employeeName: string;
  role?: 'employee' | 'lead' | 'manager' | 'hr' | 'hr_super_admin';
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function handleSuccess(_result: ApplySubmitResult) {
    router.refresh();
  }

  return (
    <>
      <LeavePageHeader
        title="My Leave"
        description={employeeName}
        actions={
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Apply for Leave
          </button>
        }
      />

      {open && <ApplyLeaveDrawer onClose={() => setOpen(false)} onSuccess={handleSuccess} />}
    </>
  );
}
