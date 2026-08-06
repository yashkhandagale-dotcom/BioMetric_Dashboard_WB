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
export default function MeNavbar({ employeeName }: { employeeName: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function handleSuccess(_result: ApplySubmitResult) {
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[var(--text-muted)] text-xs mb-1">Leave Tracker</p>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">My Leave</h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">{employeeName}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Apply for Leave
        </button>
      </div>

      {open && <ApplyLeaveDrawer onClose={() => setOpen(false)} onSuccess={handleSuccess} />}
    </>
  );
}