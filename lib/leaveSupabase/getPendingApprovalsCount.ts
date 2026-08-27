import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';
import { getManagedEmployeeIds } from './organization';
import type { CurrentEmployee } from './getCurrentEmployee';

// The "Approvals" badge shows up in LeaveShell's sidebar/tab strip on
// every page an approver or HR visits, not just on /leave/approvals
// itself — so the count needs to be computed the same scoped way the
// approvals page's own query works (department for a manager, direct
// reports for a lead, everything for HR), from a single place, instead
// of each layout re-deriving its own slightly different version.
// PERF FIX: cache()'d — since createLeaveClient() and getCurrentEmployee()
// are both now cache()'d too, `supabase` and `employee` are the same object
// references on every call within one request, so this dedupes cleanly
// against any repeat calls in the same render (e.g. if a future page adds
// its own approvals-badge check alongside its layout's).
export const getPendingApprovalsCount = cache(async function getPendingApprovalsCount(
  supabase: SupabaseClient,
  employee: CurrentEmployee
): Promise<number> {
  const isHr = employee.role === 'hr' || employee.role === 'hr_super_admin';
  const isLead = employee.role === 'lead';
  const isManager = employee.role === 'manager';

  if (!isHr && !isLead && !isManager) return 0;

  if (isHr) {
    const { count } = await supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    return count ?? 0;
  }

  if (isLead) {
    const { count } = await supabase
      .from('leave_requests')
      .select('id, employees!leave_requests_employee_id_fkey!inner(reporting_lead_id)', { count: 'exact', head: true })
      .eq('status', 'pending')
      .eq('employees.reporting_lead_id', employee.id);
    return count ?? 0;
  }

  // Manager
  const { employeeIds } = await getManagedEmployeeIds(supabase, employee.id);
  if (employeeIds.length === 0) return 0;
  const { count } = await supabase
    .from('leave_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .in('employee_id', employeeIds);
  return count ?? 0;
});
