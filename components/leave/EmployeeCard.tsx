'use client';

// AdjustBalanceButton and EmployeeLoginButton imports removed — both
// buttons are hidden from this card per HR's request (see the commented
// -out JSX further down for exactly what to restore). FnFCalculatorButton
// and ViolationBadge are still used below, so those imports stay.
import FnFCalculatorButton from '@/app/leave/admin/FnFCalculatorButton';
import ViolationBadge from './ViolationBadge';

// One flattened shape the grid renders from — employees table fields +
// this FY's live SL/CL/PL/LWP balances (from getEmployeeBalancesByFY, the
// same helper app/leave/admin/page.tsx uses, so figures never diverge).
export type EmployeeWithBalances = {
  id: string;
  code: string;
  name: string;
  department: string;
  office: string;
  role: string;
  employmentStatus: string;
  noticePeriodDays?: number | null;
  dateOfJoining: string;
  hasLogin?: boolean;
  email?: string | null;
  // Section 10: Admin panel should show login status + how they log in.
  authProvider?: 'password' | 'google';
  lastLoginAt?: string | null;
  // Derived from the department's manager, not stored per-employee — see
  // supabase-leave/schema.sql's 006_department_managers.sql.
  effectiveManagerName?: string | null;
  reportingLeadId: string | null;
  leadName?: string | null;
  reportingManagerId: string | null;
  reportingManagerName?: string | null;
  managedDepartments?: string[];
  SL: number;
  CL: number;
  PL: number;
  LWP: number;
};

const STATUS_STYLES: Record<string, string> = {
  probation: 'bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-500/30',
  active: 'bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  notice_period: 'bg-orange-900/30 text-orange-300 border-orange-500/30',
  exited: 'bg-[var(--bg-elevated)]/40 text-[var(--text-muted)] border-[var(--border)]/40',
};

export default function EmployeeCard({
  employee,
  fyStartYear,
  violationCount,
}: {
  employee: EmployeeWithBalances;
  fyStartYear: number;
  violationCount?: number;
}) {
  const statusStyle = STATUS_STYLES[employee.employmentStatus] ?? STATUS_STYLES.active;

  return (
    <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[var(--text-primary)] font-semibold text-sm truncate">{employee.name}</p>
          <p className="text-[var(--text-muted)] text-xs truncate">
            {employee.code} · {employee.department} · {employee.office}
          </p>
        </div>
        {/* D4: real count from EmployeeGrid's violations fetch */}
        <ViolationBadge count={violationCount} />
      </div>

      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className={`border rounded-full px-2 py-0.5 capitalize ${statusStyle}`}>
          {employee.employmentStatus.replace('_', ' ')}
        </span>
        {employee.employmentStatus === 'notice_period' && (
          <span className="text-[var(--text-muted)]">
            {employee.noticePeriodDays != null ? `${employee.noticePeriodDays}-day notice` : 'Notice period'}
          </span>
        )}
        <span className="text-[var(--text-muted)]">DOJ {employee.dateOfJoining}</span>
      </div>

      {/* Section 3/10: an employee must be visible here with a clear
          "Pending Registration" vs "Registered" state, even before
          they've ever logged in — hasLogin already IS that signal
          (auth_user_id set or not, see app/leave/admin/page.tsx), this
          just surfaces it as text instead of only the button label
          below. Last login + how they authenticate (password vs
          Google) are the other two "Admin should be able to see"
          columns from section 10. */}
      <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] flex-wrap">
        <span className={employee.hasLogin ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
          {employee.hasLogin ? 'Registered' : 'Login: Pending Registration'}
        </span>
        {employee.hasLogin && employee.authProvider === 'google' && <span>· Google</span>}
        {employee.hasLogin && employee.lastLoginAt && (
          <span>· Last login {new Date(employee.lastLoginAt).toLocaleDateString()}</span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-xs bg-[var(--bg-surface)]/50 rounded-lg py-2">
        <Balance label="SL" value={employee.SL} />
        <Balance label="CL" value={employee.CL} />
        <Balance label="PL" value={employee.PL} />
        <Balance label="LWP" value={Math.abs(employee.LWP)} amber />
      </div>

      <HierarchyLine employee={employee} />

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {/* Record Leave / View Profile were removed from here — every
            leave action now happens from the Leave Tracker page
            (/leave/admin/history: Absentees / Half Days / Leave History
            tabs), so there's exactly one place HR records leave from,
            not one per card plus a second centralized page. Adjust
            (status/role/hierarchy) stays here since it's genuinely
            per-employee, one-off editing — not a leave action. */}
        {/* AdjustBalanceButton hidden per HR's request — component and
            its route are untouched, this only removes it from the card.
            To restore: re-add `import AdjustBalanceButton from
            '@/app/leave/admin/AdjustBalanceButton';` above, and
            un-comment the block below. */}
        {/* <AdjustBalanceButton
          employeeId={employee.id}
          employeeName={employee.name}
          fyStartYear={fyStartYear}
          currentRole={employee.role}
          currentStatus={employee.employmentStatus}
          currentNoticePeriodDays={employee.noticePeriodDays ?? undefined}
          currentLeadId={employee.reportingLeadId}
          currentManagerId={employee.reportingManagerId}
          currentManagedDepartments={employee.managedDepartments ?? []}
        /> */}
        <FnFCalculatorButton employeeId={employee.id} employeeName={employee.name} />
        {/* EmployeeLoginButton (Reset Password, since Create Login is
            already gated off via that component's own `if (!hasLogin)
            return null` — see EmployeeLoginButton.tsx) hidden per HR's
            request. Route (.../reset-password) still works if called
            directly. To restore: re-add `import EmployeeLoginButton
            from './EmployeeLoginButton';` above, and un-comment the
            block below. */}
        {/* <EmployeeLoginButton
          employeeId={employee.id}
          employeeName={employee.name}
          hasLogin={!!employee.hasLogin}
        /> */}
      </div>
    </div>
  );
}

function Balance({ label, value, amber }: { label: string; value: number; amber?: boolean }) {
  return (
    <div>
      <p className={`font-semibold ${amber ? 'text-amber-400' : 'text-[var(--text-primary)]'}`}>{value.toFixed(2)}</p>
      <p className="text-[var(--text-muted)]">{label}</p>
    </div>
  );
}

// Shows where this person sits in the org: (derived) manager for
// employees/leads — department itself is already shown in the card
// header above — or the departments they manage + who they report to
// for managers. Nothing here is editable — it's read-only, sourced from
// the Adjust → Details tab.
function HierarchyLine({ employee }: { employee: EmployeeWithBalances }) {
  if (employee.role === 'manager') {
    const departments = employee.managedDepartments ?? [];
    return (
      <div className="text-xs text-[var(--text-muted)] space-y-0.5">
        <p>
          Manages: {departments.length > 0 ? departments.join(', ') : <span className="italic">no department assigned</span>}
        </p>
        {employee.reportingManagerName && <p>Reports to {employee.reportingManagerName}</p>}
      </div>
    );
  }

  if (employee.role === 'employee' || employee.role === 'lead') {
    return (
      <div className="text-xs text-[var(--text-muted)] space-y-0.5">
        {employee.effectiveManagerName && <p>Manager: {employee.effectiveManagerName}</p>}
        {employee.role === 'employee' && employee.leadName && <p>Lead: {employee.leadName}</p>}
      </div>
    );
  }

  return null;
}