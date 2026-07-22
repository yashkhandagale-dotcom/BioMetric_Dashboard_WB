'use client';

import { useState } from 'react';
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
}: {
  employee: EmployeeWithBalances;
  fyStartYear: number;
}) {
  const [showProfile, setShowProfile] = useState(false);
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
        {/* D1-4: real count wired up on Day 4 */}
        <ViolationBadge count={undefined} />
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

      {showProfile && (
        <div className="border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 space-y-1 bg-slate-900/40">
          <p><span className="text-slate-500">Role:</span> {employee.role}</p>
          <p><span className="text-slate-500">Employee code:</span> {employee.code}</p>
          <p><span className="text-slate-500">Department:</span> {employee.department}</p>
          <p><span className="text-slate-500">Office:</span> {employee.office}</p>
          <p><span className="text-slate-500">Date of joining:</span> {employee.dateOfJoining}</p>
          <p className="text-slate-500 italic pt-1">
            Full tabbed profile (balances, leave timeline, violations) opens from here starting Day 2.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <a
          href={`/leave/admin/leave?employee=${employee.id}`}
          className="text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium px-2.5 py-1.5 rounded-lg transition-colors"
        >
          Record Leave
        </a>
        <button
          type="button"
          onClick={() => setShowProfile((v) => !v)}
          className="text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-lg px-2.5 py-1.5 transition-colors"
        >
          {showProfile ? 'Hide Profile' : 'View Profile'}
        </button>
        {/* Reused as-is from app/leave/admin/AdjustBalanceButton.tsx — not
            duplicated, per the "reuse existing components" constraint. */}
        <AdjustBalanceButton employeeId={employee.id} employeeName={employee.name} fyStartYear={fyStartYear} />
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