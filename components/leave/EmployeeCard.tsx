'use client';

import AdjustBalanceButton from '@/app/leave/admin/AdjustBalanceButton';
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
  dateOfJoining: string;
  // Derived from the department's manager, not stored per-employee — see
  // supabase-leave/schema.sql's 006_department_managers.sql.
  effectiveManagerName?: string | null;
  reportingTechLeadId: string | null;
  techLeadName?: string | null;
  reportingManagerId: string | null;
  reportingManagerName?: string | null;
  managedDepartments?: string[];
  SL: number;
  CL: number;
  PL: number;
  LWP: number;
};

const STATUS_STYLES: Record<string, string> = {
  probation: 'bg-amber-900/30 text-amber-300 border-amber-500/30',
  active: 'bg-emerald-900/30 text-emerald-300 border-emerald-500/30',
  notice_period: 'bg-orange-900/30 text-orange-300 border-orange-500/30',
  exited: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
};

export default function EmployeeCard({
  employee,
  fyStartYear,
  violationCount,
  onViewProfile,
  onRecordLeave,
}: {
  employee: EmployeeWithBalances;
  fyStartYear: number;
  violationCount?: number;
  onViewProfile: (employeeId: string) => void;
  onRecordLeave: (employeeId: string) => void;
}) {
  const statusStyle = STATUS_STYLES[employee.employmentStatus] ?? STATUS_STYLES.active;

  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm truncate">{employee.name}</p>
          <p className="text-slate-500 text-xs truncate">
            {employee.code} · {employee.department} · {employee.office}
          </p>
        </div>
        {/* D4: real count from EmployeeGrid's violations fetch */}
        <ViolationBadge count={violationCount} />
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className={`border rounded-full px-2 py-0.5 capitalize ${statusStyle}`}>
          {employee.employmentStatus.replace('_', ' ')}
        </span>
        <span className="text-slate-500">DOJ {employee.dateOfJoining}</span>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-xs bg-slate-900/50 rounded-lg py-2">
        <Balance label="SL" value={employee.SL} />
        <Balance label="CL" value={employee.CL} />
        <Balance label="PL" value={employee.PL} />
        <Balance label="LWP" value={Math.abs(employee.LWP)} amber />
      </div>

      <HierarchyLine employee={employee} />

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {/* D2-3: was a link to the now-removed /leave/admin/leave page —
            opens the RecordLeaveDrawer (state lives in EmployeeGrid) so
            HR never leaves the grid. */}
        <button
          type="button"
          onClick={() => onRecordLeave(employee.id)}
          className="text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium px-2.5 py-1.5 rounded-lg transition-colors"
        >
          Record Leave
        </button>
        {/* D2-1: was an inline expand/collapse panel — now opens the full
            tabbed EmployeeModal (Overview, Balances, Leave Timeline,
            Violations), exactly as the Day 1 placeholder text promised. */}
        <button
          type="button"
          onClick={() => onViewProfile(employee.id)}
          className="text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-lg px-2.5 py-1.5 transition-colors"
        >
          View Profile
        </button>
        {/* Reused as-is from app/leave/admin/AdjustBalanceButton.tsx — not
            duplicated, per the "reuse existing components" constraint. */}
        <AdjustBalanceButton
          employeeId={employee.id}
          employeeName={employee.name}
          fyStartYear={fyStartYear}
          currentRole={employee.role}
          currentStatus={employee.employmentStatus}
          currentTechLeadId={employee.reportingTechLeadId}
          currentManagerId={employee.reportingManagerId}
          currentManagedDepartments={employee.managedDepartments ?? []}
        />
      </div>
    </div>
  );
}

function Balance({ label, value, amber }: { label: string; value: number; amber?: boolean }) {
  return (
    <div>
      <p className={`font-semibold ${amber ? 'text-amber-400' : 'text-white'}`}>{value.toFixed(2)}</p>
      <p className="text-slate-500">{label}</p>
    </div>
  );
}

// Shows where this person sits in the org: (derived) manager for
// employees/tech leads — department itself is already shown in the card
// header above — or the departments they manage + who they report to
// for managers. Nothing here is editable — it's read-only, sourced from
// the Adjust → Details tab.
function HierarchyLine({ employee }: { employee: EmployeeWithBalances }) {
  if (employee.role === 'manager') {
    const departments = employee.managedDepartments ?? [];
    return (
      <div className="text-xs text-slate-500 space-y-0.5">
        <p>
          Manages: {departments.length > 0 ? departments.join(', ') : <span className="italic">no department assigned</span>}
        </p>
        {employee.reportingManagerName && <p>Reports to {employee.reportingManagerName}</p>}
      </div>
    );
  }

  if (employee.role === 'employee' || employee.role === 'tech_lead') {
    return (
      <div className="text-xs text-slate-500 space-y-0.5">
        {employee.effectiveManagerName && <p>Manager: {employee.effectiveManagerName}</p>}
        {employee.role === 'employee' && employee.techLeadName && <p>Tech Lead: {employee.techLeadName}</p>}
      </div>
    );
  }

  return null;
}