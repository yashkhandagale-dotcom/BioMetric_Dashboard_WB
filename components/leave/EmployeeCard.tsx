'use client';

import FnFCalculatorButton from '@/app/leave/admin/FnFCalculatorButton';
import ViolationBadge from './ViolationBadge';

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
  authProvider?: 'password' | 'google';
  lastLoginAt?: string | null;
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

const STATUS_STYLES: Record<string, { badge: string; dot: string }> = {
  probation: {
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    dot: 'bg-amber-500',
  },
  active: {
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    dot: 'bg-emerald-500',
  },
  notice_period: {
    badge: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
    dot: 'bg-orange-500',
  },
  exited: {
    badge: 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border)]',
    dot: 'bg-slate-400',
  },
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U';
}

export default function EmployeeCard({
  employee,
  fyStartYear: _fyStartYear,
  violationCount,
}: {
  employee: EmployeeWithBalances;
  fyStartYear: number;
  violationCount?: number;
}) {
  const status = STATUS_STYLES[employee.employmentStatus] ?? STATUS_STYLES.active;

  return (
    <div
      className="rounded-2xl border border-[var(--border)] p-4 space-y-3.5 shadow-sm hover:shadow-lg hover:border-[var(--accent)]/40 hover:-translate-y-0.5 transition-all duration-200"
      style={{
        background: 'linear-gradient(160deg, var(--bg-card) 0%, var(--bg-elevated) 100%)',
      }}
    >
      {/* Header with Avatar and Violation Badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent)]/20 to-[var(--accent)]/5 text-[var(--accent)] border border-[var(--accent)]/25 text-xs font-bold shadow-sm">
            {initials(employee.name)}
          </div>
          <div className="min-w-0">
            <p className="text-[var(--text-primary)] font-bold text-sm truncate leading-tight">{employee.name}</p>
            <p className="text-[var(--text-muted)] text-xs truncate mt-0.5">
              {employee.code} · <span className="font-medium text-[var(--text-primary)]">{employee.department}</span> · {employee.office}
            </p>
          </div>
        </div>
        <ViolationBadge count={violationCount} />
      </div>

      {/* Status chips */}
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className={`inline-flex items-center gap-1.5 border rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${status.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
          {employee.employmentStatus.replace('_', ' ')}
        </span>
        {employee.employmentStatus === 'notice_period' && (
          <span className="text-[var(--text-muted)] text-[11px]">
            {employee.noticePeriodDays != null ? `${employee.noticePeriodDays}d notice` : 'Notice'}
          </span>
        )}
        <span className="text-[var(--text-muted)] text-[11px]">DOJ: {employee.dateOfJoining}</span>
      </div>

      {/* Login & Auth info */}
      <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] flex-wrap bg-[var(--bg-surface)]/60 rounded-lg px-2.5 py-1.5 border border-[var(--border-subtle)]">
        <span className={employee.hasLogin ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-amber-600 dark:text-amber-400 font-medium'}>
          {employee.hasLogin ? '● Registered' : '○ Login Pending'}
        </span>
        {employee.hasLogin && employee.authProvider === 'google' && (
          <span className="text-[var(--text-muted)]">· Google SSO</span>
        )}
        {employee.hasLogin && employee.lastLoginAt && (
          <span className="text-[var(--text-muted)]">· Active {new Date(employee.lastLoginAt).toLocaleDateString()}</span>
        )}
      </div>

      {/* Leave balance tiles */}
      <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
        <Balance label="SL" value={employee.SL} color="text-violet-600 dark:text-violet-300" bg="bg-violet-500/10 border-violet-500/20" />
        <Balance label="CL" value={employee.CL} color="text-cyan-600 dark:text-cyan-300" bg="bg-cyan-500/10 border-cyan-500/20" />
        <Balance label="PL" value={employee.PL} color="text-orange-600 dark:text-orange-300" bg="bg-orange-500/10 border-orange-500/20" />
        <Balance label="LWP" value={Math.abs(employee.LWP)} color="text-rose-600 dark:text-rose-300" bg="bg-rose-500/10 border-rose-500/20" />
      </div>

      <HierarchyLine employee={employee} />

      {/* Card Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[var(--border-subtle)]">
        <FnFCalculatorButton employeeId={employee.id} employeeName={employee.name} />
      </div>
    </div>
  );
}

function Balance({ label, value, color, bg }: { label: string; value: number; color?: string; bg?: string }) {
  return (
    <div className={`rounded-xl p-2 border ${bg ?? 'bg-[var(--bg-surface)] border-[var(--border)]'}`}>
      <p className={`font-bold tabular-nums text-sm ${color ?? 'text-[var(--text-primary)]'}`}>{value.toFixed(1)}</p>
      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}

function HierarchyLine({ employee }: { employee: EmployeeWithBalances }) {
  if (employee.role === 'manager') {
    const departments = employee.managedDepartments ?? [];
    return (
      <div className="text-xs text-[var(--text-muted)] space-y-0.5 bg-[var(--bg-surface)]/40 rounded-lg p-2 border border-[var(--border-subtle)]">
        <p className="truncate">
          <span className="font-semibold text-[var(--text-primary)]">Manages:</span> {departments.length > 0 ? departments.join(', ') : <span className="italic">no department assigned</span>}
        </p>
        {employee.reportingManagerName && <p className="truncate">Reports to {employee.reportingManagerName}</p>}
      </div>
    );
  }

  if (employee.role === 'employee' || employee.role === 'lead') {
    if (!employee.effectiveManagerName && !employee.leadName) return null;
    return (
      <div className="text-xs text-[var(--text-muted)] space-y-0.5 bg-[var(--bg-surface)]/40 rounded-lg p-2 border border-[var(--border-subtle)]">
        {employee.effectiveManagerName && <p className="truncate"><span className="font-semibold text-[var(--text-primary)]">Manager:</span> {employee.effectiveManagerName}</p>}
        {employee.role === 'employee' && employee.leadName && <p className="truncate"><span className="font-semibold text-[var(--text-primary)]">Lead:</span> {employee.leadName}</p>}
      </div>
    );
  }

  return null;
}