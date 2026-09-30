export interface AnalyticsFilterState {
  fyStartYear: number;
  department: string; // 'all' or specific
  office: string; // 'all' or 'MUM' or 'HYD'
  leaveType: string; // 'all', 'SL', 'CL', 'PL', 'LWP', or comma-separated
  status: string; // 'approved', 'all', 'pending', etc.
}

export function buildFilterQueryString(filters: AnalyticsFilterState): string {
  const params = new URLSearchParams();
  params.set('fy_start_year', String(filters.fyStartYear));
  if (filters.department && filters.department !== 'all') {
    params.set('department', filters.department);
  }
  if (filters.office && filters.office !== 'all') {
    params.set('office', filters.office);
  }
  if (filters.leaveType && filters.leaveType !== 'all') {
    params.set('leave_type', filters.leaveType);
  }
  if (filters.status && filters.status !== 'all') {
    params.set('status', filters.status);
  }
  return params.toString();
}
