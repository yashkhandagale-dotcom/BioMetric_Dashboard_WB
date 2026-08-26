'use client';

import LeavePageHeader from './LeavePageHeader';

// app/leave/me/page.tsx itself is a Server Component (fetches employee/
// balances/history live per request); this used to be the one client
// island on that page, owning the "Apply for Leave" drawer's open/
// closed state. That action (and "Apply for WFH") now lives in
// LeaveShell's sidebar instead — available from every /leave/** page,
// not just this one, and opened as a popup from there — so this
// component's only remaining job is the page title.
export default function MeNavbar({
  employeeName,
}: {
  employeeName: string;
  role?: 'employee' | 'lead' | 'manager' | 'hr' | 'hr_super_admin';
}) {
  return <LeavePageHeader title="My Leave" description={employeeName} />;
}
