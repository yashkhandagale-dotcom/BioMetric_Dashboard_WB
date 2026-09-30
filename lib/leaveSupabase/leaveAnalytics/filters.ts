import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';

export const VALID_LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'auto_lwp'] as const;
export type ValidLeaveStatus = (typeof VALID_LEAVE_STATUSES)[number];

export const VALID_EMPLOYMENT_STATUSES = ['active', 'probation', 'notice_period', 'exited', 'suspended'] as const;
export type ValidEmploymentStatus = (typeof VALID_EMPLOYMENT_STATUSES)[number];

export interface AnalyticsFilters {
  fyStartYear: number;
  fyLabel: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  department?: string;
  office?: string;
  leaveTypes?: string[];
  statuses: ValidLeaveStatus[];
  employmentStatuses?: ValidEmploymentStatus[];
}

export type ParseFiltersResult =
  | { success: true; filters: AnalyticsFilters }
  | { success: false; error: string };

/**
 * Parses and validates query params shared across all analytics API endpoints.
 * Returns { success: true, filters } or { success: false, error }.
 */
export function parseAnalyticsFilters(searchParams: URLSearchParams): ParseFiltersResult {
  // 1. FY Start Year
  const fyParam = searchParams.get('fy_start_year');
  let fyStartYear: number;
  if (fyParam !== null) {
    fyStartYear = parseInt(fyParam, 10);
    if (isNaN(fyStartYear) || fyStartYear < 2000 || fyStartYear > 2100) {
      return { success: false, error: `Invalid fy_start_year '${fyParam}'. Must be a 4-digit year.` };
    }
  } else {
    fyStartYear = getFYStartYear();
  }

  // FY date bounds: 25-Mar to 24-Mar next year
  const startDate = `${fyStartYear}-03-25`;
  const endDate = `${fyStartYear + 1}-03-24`;
  const fyLabel = formatFYLabel(fyStartYear);

  // 2. Department
  const deptParam = searchParams.get('department')?.trim();
  const department = deptParam && deptParam !== 'all' ? deptParam : undefined;

  // 3. Office
  const officeParam = searchParams.get('office')?.trim();
  const office = officeParam && officeParam !== 'all' ? officeParam.toUpperCase() : undefined;

  // 4. Leave Types (comma-separated allowed, e.g. "SL,CL" or "SL")
  const typeParam = searchParams.get('leave_type') || searchParams.get('types');
  let leaveTypes: string[] | undefined = undefined;
  if (typeParam && typeParam.trim() && typeParam.trim() !== 'all') {
    leaveTypes = typeParam
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    if (leaveTypes.length === 0) leaveTypes = undefined;
  }

  // 5. Status (default ['approved'], comma-separated allowed)
  const statusParam = searchParams.get('status')?.trim();
  let statuses: ValidLeaveStatus[] = ['approved'];
  if (statusParam && statusParam !== 'all') {
    const rawStatuses = statusParam.split(',').map((s) => s.trim().toLowerCase());
    for (const s of rawStatuses) {
      if (!VALID_LEAVE_STATUSES.includes(s as ValidLeaveStatus)) {
        return {
          success: false,
          error: `Invalid status '${s}'. Allowed statuses: ${VALID_LEAVE_STATUSES.join(', ')}`,
        };
      }
    }
    statuses = rawStatuses as ValidLeaveStatus[];
  }

  // 6. Employment Status (optional, comma-separated allowed)
  const empStatusParam = searchParams.get('employment_status')?.trim();
  let employmentStatuses: ValidEmploymentStatus[] | undefined = undefined;
  if (empStatusParam && empStatusParam !== 'all') {
    const rawEmpStatuses = empStatusParam.split(',').map((s) => s.trim().toLowerCase());
    for (const es of rawEmpStatuses) {
      if (!VALID_EMPLOYMENT_STATUSES.includes(es as ValidEmploymentStatus)) {
        return {
          success: false,
          error: `Invalid employment_status '${es}'. Allowed: ${VALID_EMPLOYMENT_STATUSES.join(', ')}`,
        };
      }
    }
    employmentStatuses = rawEmpStatuses as ValidEmploymentStatus[];
  }

  return {
    success: true,
    filters: {
      fyStartYear,
      fyLabel,
      startDate,
      endDate,
      department,
      office,
      leaveTypes,
      statuses,
      employmentStatuses,
    },
  };
}
