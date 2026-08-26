'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AddEmployeeForm from '@/app/leave/admin/employees/AddEmployeeForm';

// Wires the EXISTING AddEmployeeForm (and its existing backing route,
// POST /api/leave/employees — see that route's header comment) into the
// Admin panel header. The form and API already did everything needed;
// they just weren't reachable from any page since the CSV
// auto-onboarding flow (lib/employeeStore.ts's ensureEmployeesFromAttendance)
// became the day-to-day path (see app/leave/admin/employees/page.tsx's
// redirect comment).
//
// Task section 2: "If Google Workspace sync cannot be fully implemented,
// the existing Admin employee creation should still work" — this is
// that fallback, now actually clickable. It also directly satisfies
// section 3: HR can create the employee record here BEFORE that person
// ever logs in, and they'll show up in the grid immediately (Login:
// Pending Registration) via the existing hasLogin/auth_user_id check
// already in EmployeeCard.tsx.
export default function AddEmployeeButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        Add Employee
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm"
              >
                Close ✕
              </button>
            </div>
            <AddEmployeeForm
              onCreated={() => {
                setOpen(false);
                router.refresh();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
