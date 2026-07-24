'use client';

import { useEffect, useState } from 'react';

const CODES = [
  { code: 'SL', label: 'Sick Leave' },
  { code: 'CL', label: 'Casual Leave' },
  { code: 'PL', label: 'Planned Leave' },
] as const;

const ROLES = [
  { value: 'employee', label: 'Employee' },
  { value: 'tech_lead', label: 'Tech Lead' },
  { value: 'manager', label: 'Manager' },
  { value: 'hr', label: 'HR' },
  { value: 'hr_super_admin', label: 'HR Super Admin' },
];

const STATUSES = [
  { value: 'probation', label: 'Probation' },
  { value: 'active', label: 'Active' },
  { value: 'notice_period', label: 'Notice period' },
  { value: 'exited', label: 'Exited' },
];

type PersonOption = { id: string; full_name: string; employee_code: string };
type DepartmentOption = { department: string; managerId: string | null; managerName: string | null };

// Single "Adjust" entry point per employee, two tabs:
//  - Balance: unchanged from before (adjust SL/CL/PL with a reason, audited).
//  - Details: status / role / reporting tech lead / reporting manager — the
//    fields CSV upload can't supply (see lib/employeeStore.ts's
//    ensureEmployeesFromAttendance, which only ever sets employee_code,
//    full_name, department, office, and a default role on first creation).
//    This is what replaced the standalone "Manage Employees" / Add Employee
//    page — there's no separate onboarding form anymore, this modal is where
//    HR fills in the rest for a person CSV already created.
//  - Details also carries "Departments Managed" for managers now — see
//    supabase-leave/schema.sql's 006_department_managers.sql. Department
//    itself is not editable here (it's CSV-owned), so employee/tech_lead
//    rows have nothing group-related to set in this tab.

export default function AdjustBalanceButton({
  employeeId,
  employeeName,
  fyStartYear,
  currentRole,
  currentStatus,
  currentTechLeadId,
  currentManagerId,
  currentManagedDepartments,
}: {
  employeeId: string;
  employeeName: string;
  fyStartYear: number;
  currentRole?: string;
  currentStatus?: string;
  currentTechLeadId?: string | null;
  currentManagerId?: string | null;
  currentManagedDepartments?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'balance' | 'details'>('balance');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  // ── Balance tab state ───────────────────────────────────────────────────
  const [leaveTypeCode, setLeaveTypeCode] = useState<(typeof CODES)[number]['code']>('PL');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');

  // ── Details tab state ───────────────────────────────────────────────────
  const [role, setRole] = useState(currentRole ?? 'employee');
  const [status, setStatus] = useState(currentStatus ?? 'active');
  const [techLeadId, setTechLeadId] = useState(currentTechLeadId ?? '');
  const [managerId, setManagerId] = useState(currentManagerId ?? '');
  const [managedDepartments, setManagedDepartments] = useState<string[]>(currentManagedDepartments ?? []);
  const [techLeads, setTechLeads] = useState<PersonOption[]>([]);
  const [managers, setManagers] = useState<PersonOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

  useEffect(() => {
    if (!open || tab !== 'details') return;
    async function loadOptions(role: string, setOptions: (v: PersonOption[]) => void) {
      try {
        const res = await fetch(`/api/leave/employees?role=${role}`);
        if (!res.ok) return;
        const text = await res.text();
        if (!text) return;
        const data = JSON.parse(text);
        setOptions(data.employees ?? []);
      } catch {
        // Dropdown just stays empty — reporting hierarchy is optional.
      }
    }
    async function loadDepartments() {
      try {
        const res = await fetch('/api/leave/departments');
        if (!res.ok) return;
        const text = await res.text();
        if (!text) return;
        const data = JSON.parse(text);
        setDepartments(data.departments ?? []);
      } catch {
        // Departments list just stays empty.
      }
    }
    loadOptions('tech_lead', setTechLeads);
    // Managers can only report to another manager (excluding themselves).
    loadOptions('manager', setManagers);
    loadDepartments();
  }, [open, tab]);

  function close() {
    setOpen(false);
    setTab('balance');
    setDelta('');
    setReason('');
    setError(null);
    setSuccess(null);
  }

  async function handleBalanceSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const deltaNum = parseFloat(delta);
    if (!delta || Number.isNaN(deltaNum) || deltaNum === 0) {
      setError('Enter a non-zero amount (positive to add, negative to subtract).');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/leave/employees/${employeeId}/adjust-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leave_type_code: leaveTypeCode, delta: deltaNum, reason }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setError(data.error || `Failed (${res.status}).`);
        setSaving(false);
        return;
      }
      window.location.reload();
    } catch {
      setError('Could not reach the server — check your connection and try again.');
      setSaving(false);
    }
  }

  async function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (techLeadId && techLeadId === employeeId) {
      setError('An employee cannot report to themself.');
      return;
    }
    if (managerId && managerId === employeeId) {
      setError('A manager cannot report to themself.');
      return;
    }
    const payload: Record<string, unknown> = {
      role,
      employment_status: status,
    };
    if (role === 'employee') {
      payload.reporting_tech_lead_id = techLeadId || null;
    } else if (role === 'manager') {
      payload.reporting_manager_id = managerId || null;
      payload.managed_departments = managedDepartments;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/leave/employees/${employeeId}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      setSaving(false);
      if (!res.ok) {
        setError(data.error || `Failed (${res.status}).`);
        return;
      }
      setSuccess('Saved.');
    } catch {
      setSaving(false);
      setError('Could not reach the server — check your connection and try again.');
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-lg px-2.5 py-1 transition-colors"
      >
        Adjust
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={close}>
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-white font-semibold text-sm">Adjust — {employeeName}</h3>
              <p className="text-slate-500 text-xs mt-1">
                {tab === 'balance'
                  ? `FY ${fyStartYear}-${String(fyStartYear + 1).slice(-2)}. Every adjustment is recorded with who, when, and why.`
                  : 'Status, role, and reporting hierarchy — the fields CSV upload can\'t fill in.'}
              </p>
            </div>

            <div className="flex gap-1 bg-slate-800/60 rounded-lg p-1">
              <button
                type="button"
                onClick={() => { setTab('balance'); setError(null); setSuccess(null); }}
                className={`flex-1 text-xs font-medium rounded-md py-1.5 transition-colors ${
                  tab === 'balance' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Balance
              </button>
              <button
                type="button"
                onClick={() => { setTab('details'); setError(null); setSuccess(null); }}
                className={`flex-1 text-xs font-medium rounded-md py-1.5 transition-colors ${
                  tab === 'details' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Details
              </button>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-emerald-900/30 border border-emerald-500/30 text-emerald-300 text-xs rounded-lg px-3 py-2">
                {success}
              </div>
            )}

            {tab === 'balance' ? (
              <form onSubmit={handleBalanceSubmit} className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Leave type</label>
                  <select
                    value={leaveTypeCode}
                    onChange={(e) => setLeaveTypeCode(e.target.value as typeof leaveTypeCode)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    {CODES.map((c) => (
                      <option key={c.code} value={c.code}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Amount (days) — negative to subtract</label>
                  <input
                    type="number"
                    step="0.5"
                    value={delta}
                    onChange={(e) => setDelta(e.target.value)}
                    placeholder="e.g. 2 or -1.5"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Reason (required)</label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="e.g. correcting mid-year joiner proration"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    required
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button type="button" onClick={close} className="text-slate-400 hover:text-white text-sm px-3 py-2">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {saving ? 'Saving…' : 'Save adjustment'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleDetailsSubmit} className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    {STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                {role === 'employee' && (
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Reporting Tech Lead</label>
                    <select
                      value={techLeadId}
                      onChange={(e) => setTechLeadId(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    >
                      <option value="">— None —</option>
                      {techLeads.map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name} ({p.employee_code})</option>
                      ))}
                    </select>
                  </div>
                )}

                {role === 'manager' && (
                  <>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Departments Managed</label>
                      <div className="border border-slate-700 rounded-lg px-3 py-2 max-h-32 overflow-y-auto space-y-1 bg-slate-800">
                        {departments.length === 0 && <p className="text-slate-500 text-xs">No departments yet.</p>}
                        {departments.map((d) => {
                          const checked = managedDepartments.includes(d.department);
                          const takenByOther = d.managerId && d.managerId !== employeeId;
                          return (
                            <label key={d.department} className="flex items-center gap-2 text-xs text-white cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setManagedDepartments((depts) =>
                                    e.target.checked ? [...depts, d.department] : depts.filter((x) => x !== d.department)
                                  )
                                }
                              />
                              <span>
                                {d.department}
                                {takenByOther && !checked && (
                                  <span className="text-amber-400"> (currently: {d.managerName})</span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-slate-500 text-[11px] mt-1">
                        Checking a department already assigned to another manager reassigns it to this person — every
                        employee in that department will see their manager update automatically.
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Reports To (Manager)</label>
                      <select
                        value={managerId}
                        onChange={(e) => setManagerId(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                      >
                        <option value="">— None —</option>
                        {managers
                          .filter((p) => p.id !== employeeId)
                          .map((p) => (
                            <option key={p.id} value={p.id}>{p.full_name} ({p.employee_code})</option>
                          ))}
                      </select>
                    </div>
                  </>
                )}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button type="button" onClick={close} className="text-slate-400 hover:text-white text-sm px-3 py-2">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {saving ? 'Saving…' : 'Save details'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}