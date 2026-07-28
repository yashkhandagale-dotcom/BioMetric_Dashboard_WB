import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';

// Protects app/leave/me/** — employee self-service: apply, own balance,
// own history, personal calendar (Sprint B/E build the actual pages).
//
// Every role is allowed in here, including lead/manager/hr — everyone is
// also "an employee" with their own leave to apply for and track (see
// plan section 2: Lead/Manager/HR dashboards all include "own data").
// The only requirement is a linked employees row at all.
export default async function LeaveMeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const employee = await getCurrentEmployee();

  if (!employee) {
    redirect('/leave/login');
  }

  return <>{children}</>;
}
