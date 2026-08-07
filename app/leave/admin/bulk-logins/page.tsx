import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import LoginsPageClient from './LoginsPageClient';

// HR-only. See LoginsPageClient's header comment — this used to be a
// CSV-only bulk import page; the routine one-employee-at-a-time flow is
// now the default, with CSV import demoted to an "Advanced" toggle for
// one-time migrations.
export default async function BulkLoginsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/leave/login');
  if (employee.role !== 'hr' && employee.role !== 'hr_super_admin') redirect('/leave/me');

  return <LoginsPageClient />;
}
