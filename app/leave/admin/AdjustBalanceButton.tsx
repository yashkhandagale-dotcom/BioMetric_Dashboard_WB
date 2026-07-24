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
type TeamOption = { id: string; name: string; managerId: string | null; managerName: string | null };

// Single "Adjust" entry point per employee, two tabs:
//  - Balance: unchanged from before (adjust SL/CL/PL with a reason, audited).
//  - Details: status / role / reporting tech lead / reporting manager — the
//    fields CSV upload can't supply (see lib/employeeStore.ts's
//    ensureEmployeesFromAttendance, which only ever sets employee_code,
//    full_name, department, office, and a default role on first creation).
//    This is what replaced the standalone "Manage Employees" / Add Employee
//    page — there's no separate onboarding form anymore, this modal is where
//    HR fills in the rest for a person CSV already created.
//  - Details also carries Team (employee/tech_lead) or Teams Managed
//    (manager) now — see supabase-leave/006_teams_and_hierarchy.sql.

// Inline "create on the fly" affordance — no separate Manage Teams screen
// by design. Typing a name and hitting Create adds the team immediately
// and selects it for whichever field is currently being edited.
function NewTeamInline({
  value,
  onChange,
  onCreate,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onCreate: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 mt-1.5">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="New team name…"
        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
      />
      <button
        type="button"
        onClick={onCreate}
        disabled={busy || !value.trim()}
        className="text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-2 py-1 rounded-lg transition-colors"
      >
        {busy ? 'Adding…' : '+ Add'}
      </button>
    </div>
  );
}

export default function AdjustBalanceButton({
  employeeId,
  employeeName,
  fyStartYear,
  currentRole,
  currentStatus,
  currentTeamId,
  currentTechLeadId,
  currentManagerId,
  currentManagedTeamIds,
}: {
  employeeId: string;
  employeeName: string;
  fyStartYear: number;
  currentRole?: string;
  currentStatus?: string;
  currentTeamId?: string | null;
  currentTechLeadId?: string | null;
  currentManagerId?: string | null;
  currentManagedTeamIds?: string[];
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
  const [teamId, setTeamId] = useState(currentTeamId ?? '');
  const [techLeadId, setTechLeadId] = useState(currentTechLeadId ?? '');
  const [managerId, setManagerId] = useState(currentManagerId ?? '');
  const [managedTeamIds, setManagedTeamIds] = useState<string[]>(currentManagedTeamIds ?? []);
  const [techLeads, setTechLeads] = useState<PersonOption[]>([]);
  const [managers, setManagers] = useState<PersonOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);

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
    async function loadTeams() {
      try {
        const res = await fetch('/api/leave/teams');
        if (!res.ok) return;
        const text = await res.text();
        if (!text) return;
        const data = JSON.parse(text);
        setTeams(data.teams ?? []);
      } catch {
        // Team dropdown just stays empty.
      }
    }
    loadOptions('tech_lead', setTechLeads);
    // Managers can only report to another manager (excluding themselves).
    loadOptions('manager', setManagers);
    loadTeams();
  }, [open, tab]);

  async function createTeam() {
    const name = newTeamName.trim();
    if (!name) return;
    setCreatingTeam(true);
    try {
      const res = await fetch('/api/leave/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setError(data.error || 'Could not create team.');
        return;
      }
      const team: TeamOption = data.team;
      setTeams((t) => (t.some((x) => x.id === team.id) ? t : [...t, team].sort((a, b) => a.name.localeCompare(b.name))));
      if (role === 'manager') {
        setManagedTeamIds((ids) => [...ids, team.id]);
      } else {
        setTeamId(team.id);
      }
      setNewTeamName('');
    } catch {
      setError('Could not reach the server — check your connection and try again.');
    } finally {
      setCreatingTeam(false);
    }
  }

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
    if ((role === 'employee' || role === 'tech_lead') && !teamId) {
      setError('Select a team for this employee.');
      return;
    }

    const payload: Record<string, unknown> = {
      role,
      employment_status: status,
    };
    if (role === 'employee') {
      payload.team_id = teamId;
      payload.reporting_tech_lead_id = techLeadId || null;
    } else if (role === 'tech_lead') {
      payload.team_id = teamId;
    } else if (role === 'manager') {
      payload.reporting_manager_id = managerId || null;
      payload.managed_team_ids = managedTeamIds;
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
                {(role === 'employee' || role === 'tech_lead') && (
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Team</label>
                    <select
                      value={teamId}
                      onChange={(e) => setTeamId(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                      required
                    >
                      <option value="">— Select a team —</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}{t.managerName ? ` — managed by ${t.managerName}` : ''}
                        </option>
                      ))}
                    </select>
                    <NewTeamInline value={newTeamName} onChange={setNewTeamName} onCreate={createTeam} busy={creatingTeam} />
                  </div>
                )}

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
                      <label className="block text-xs text-slate-400 mb-1">Teams Managed</label>
                      <div className="border border-slate-700 rounded-lg px-3 py-2 max-h-32 overflow-y-auto space-y-1 bg-slate-800">
                        {teams.length === 0 && <p className="text-slate-500 text-xs">No teams yet — add one below.</p>}
                        {teams.map((t) => {
                          const checked = managedTeamIds.includes(t.id);
                          const takenByOther = t.managerId && t.managerId !== employeeId;
                          return (
                            <label key={t.id} className="flex items-center gap-2 text-xs text-white cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setManagedTeamIds((ids) =>
                                    e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id)
                                  )
                                }
                              />
                              <span>
                                {t.name}
                                {takenByOther && !checked && (
                                  <span className="text-amber-400"> (currently: {t.managerName})</span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-slate-500 text-[11px] mt-1">
                        Checking a team already assigned to another manager reassigns it to this person — every
                        employee on that team will see their manager update automatically.
                      </p>
                      <NewTeamInline value={newTeamName} onChange={setNewTeamName} onCreate={createTeam} busy={creatingTeam} />
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