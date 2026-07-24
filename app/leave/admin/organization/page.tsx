'use client';

import { useCallback, useEffect, useState } from 'react';

type DepartmentRow = { department: string; managerId: string | null; managerName: string | null };
type ManagerRow = {
  id: string;
  employeeCode: string;
  fullName: string;
  managedDepartments: string[];
  reportingManagerId: string | null;
  reportingManagerName: string | null;
};
type TechLeadRow = { id: string; employeeCode: string; fullName: string; managedEmployeeCount: number };
type ManagerOption = { id: string; employee_code: string; full_name: string };

// New, separate admin page — "Organization Management" — that moves
// department-manager / tech-lead / reporting-manager assignment out of
// the per-employee AdjustBalanceButton modal into one department-first
// view, per the requirement. This does NOT replace AdjustBalanceButton
// (still the right place to edit a single employee's own fields) — it's
// an additional, bird's-eye view over the exact same data:
// department_managers + employees.reporting_tech_lead_id /
// reporting_manager_id. No new hierarchy model, no `teams` table.
export default function OrganizationManagementPage() {
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [managers, setManagers] = useState<ManagerRow[]>([]);
  const [techLeads, setTechLeads] = useState<TechLeadRow[]>([]);
  const [managerOptions, setManagerOptions] = useState<ManagerOption[]>([]);
  const [techLeadOptions, setTechLeadOptions] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [orgRes, empRes] = await Promise.all([
        fetch('/api/leave/organization'),
        fetch('/api/leave/employees'),
      ]);
      const orgText = await orgRes.text();
      const orgBody = orgText ? JSON.parse(orgText) : {};
      if (!orgRes.ok) {
        setError(orgBody.error || `Could not load organization data (${orgRes.status}).`);
        return;
      }
      setDepartments(orgBody.departments ?? []);
      setManagers(orgBody.managers ?? []);
      setTechLeads(orgBody.techLeads ?? []);
      setManagerOptions(orgBody.managerOptions ?? []);

      const empText = await empRes.text();
      const empBody = empText ? JSON.parse(empText) : {};
      if (empRes.ok) {
        // employees endpoint returns everyone — tech-lead dropdown only
        // needs role=tech_lead, but that role isn't in this list's
        // shape, so fall back to the techLeads summary we already have.
        setTechLeadOptions((orgBody.techLeads ?? []).map((t: TechLeadRow) => ({ id: t.id, full_name: t.fullName })));
      }
    } catch {
      setError('Could not reach the server to load organization data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function post(body: Record<string, unknown>, key: string) {
    setSavingKey(key);
    setToast(null);
    try {
      const res = await fetch('/api/leave/organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setToast({ kind: 'error', text: data.error || 'Failed to save.' });
        return;
      }
      setToast({ kind: 'success', text: 'Saved.' });
      await load();
    } catch {
      setToast({ kind: 'error', text: 'Could not reach the server.' });
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <a href="/leave/admin" className="text-xs text-slate-400 hover:text-white">← Back to Leave Management</a>
          <h1 className="text-xl font-semibold mt-1">Organization Management</h1>
          <p className="text-slate-500 text-xs mt-1">
            Department managers, tech-lead assignment, and the manager reporting hierarchy.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">{error}</div>
      )}
      {toast && (
        <div
          className={`text-xs rounded-lg px-3 py-2 border ${
            toast.kind === 'success'
              ? 'bg-emerald-900/30 border-emerald-500/30 text-emerald-300'
              : 'bg-red-900/30 border-red-500/30 text-red-300'
          }`}
        >
          {toast.text}
        </div>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : (
        <>
          {/* ── Departments: assign / change manager ─────────────────── */}
          <section className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 space-y-3">
            <h2 className="text-white font-semibold text-sm">Departments — Manager Assignment</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs border-b border-slate-700">
                    <th className="text-left font-medium px-3 py-2">Department</th>
                    <th className="text-left font-medium px-3 py-2">Current Manager</th>
                    <th className="text-left font-medium px-3 py-2">Assign Manager</th>
                    <th className="text-left font-medium px-3 py-2">Assign Tech Lead (bulk)</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map((d) => (
                    <tr key={d.department} className="border-b border-slate-800 last:border-0">
                      <td className="px-3 py-2 text-white">{d.department}</td>
                      <td className="px-3 py-2 text-slate-300">{d.managerName ?? <span className="italic text-slate-500">unassigned</span>}</td>
                      <td className="px-3 py-2">
                        <select
                          value={d.managerId ?? ''}
                          disabled={savingKey === `dept-mgr-${d.department}`}
                          onChange={(e) =>
                            post(
                              { action: 'assign_department_manager', department: d.department, manager_id: e.target.value || null },
                              `dept-mgr-${d.department}`
                            )
                          }
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
                        >
                          <option value="">Unassigned</option>
                          {managerOptions.map((m) => (
                            <option key={m.id} value={m.id}>{m.full_name} ({m.employee_code})</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          defaultValue=""
                          disabled={savingKey === `dept-tl-${d.department}`}
                          onChange={(e) =>
                            post(
                              { action: 'bulk_assign_tech_lead', department: d.department, tech_lead_id: e.target.value || null },
                              `dept-tl-${d.department}`
                            )
                          }
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
                        >
                          <option value="" disabled>Set tech lead for department…</option>
                          <option value="">Clear tech lead</option>
                          {techLeadOptions.map((t) => (
                            <option key={t.id} value={t.id}>{t.full_name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                  {departments.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-slate-500">No departments yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-slate-500 text-xs">
              "Assign Tech Lead (bulk)" sets every current employee-role member of that department's Reporting Tech
              Lead in one action — the same field AdjustBalanceButton edits per person, just applied to the whole
              department at once.
            </p>
          </section>

          {/* ── Managers: reporting hierarchy ─────────────────────────── */}
          <section className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 space-y-3">
            <h2 className="text-white font-semibold text-sm">Managers — Reporting Hierarchy</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs border-b border-slate-700">
                    <th className="text-left font-medium px-3 py-2">Manager</th>
                    <th className="text-left font-medium px-3 py-2">Manages</th>
                    <th className="text-left font-medium px-3 py-2">Reports To</th>
                  </tr>
                </thead>
                <tbody>
                  {managers.map((m) => (
                    <tr key={m.id} className="border-b border-slate-800 last:border-0">
                      <td className="px-3 py-2 text-white">{m.fullName} <span className="text-slate-500">· {m.employeeCode}</span></td>
                      <td className="px-3 py-2 text-slate-300">
                        {m.managedDepartments.length > 0 ? m.managedDepartments.join(', ') : <span className="italic text-slate-500">none</span>}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={m.reportingManagerId ?? ''}
                          disabled={savingKey === `mgr-report-${m.id}`}
                          onChange={(e) =>
                            post({ action: 'assign_manager_reporting', manager_id: m.id, reporting_manager_id: e.target.value || null }, `mgr-report-${m.id}`)
                          }
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
                        >
                          <option value="">No one (top-level)</option>
                          {managerOptions
                            .filter((opt) => opt.id !== m.id)
                            .map((opt) => (
                              <option key={opt.id} value={opt.id}>{opt.full_name}</option>
                            ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                  {managers.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-slate-500">No managers yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-slate-500 text-xs">
              Circular chains (A → B → A, or longer) are rejected server-side — the dropdown will show an error toast
              instead of silently applying.
            </p>
          </section>

          {/* ── Tech Leads: read-only summary ─────────────────────────── */}
          <section className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 space-y-3">
            <h2 className="text-white font-semibold text-sm">Tech Leads</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs border-b border-slate-700">
                    <th className="text-left font-medium px-3 py-2">Tech Lead</th>
                    <th className="text-left font-medium px-3 py-2">Employees Reporting</th>
                  </tr>
                </thead>
                <tbody>
                  {techLeads.map((t) => (
                    <tr key={t.id} className="border-b border-slate-800 last:border-0">
                      <td className="px-3 py-2 text-white">{t.fullName} <span className="text-slate-500">· {t.employeeCode}</span></td>
                      <td className="px-3 py-2 text-slate-300">{t.managedEmployeeCount}</td>
                    </tr>
                  ))}
                  {techLeads.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-3 py-6 text-center text-slate-500">No tech leads yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-slate-500 text-xs">
              Per-employee tech lead assignment (one at a time) is still available from each employee's Adjust →
              Details tab — this page adds the bulk, department-level action above it, it doesn't replace it.
            </p>
          </section>
        </>
      )}
    </div>
  );
}