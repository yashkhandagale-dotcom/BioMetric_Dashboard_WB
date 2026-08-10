'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type DepartmentRow = { department: string; managerId: string | null; managerName: string | null };
type ManagerRow = {
  id: string;
  employeeCode: string;
  fullName: string;
  managedDepartments: string[];
  reportingManagerId: string | null;
  reportingManagerName: string | null;
};
type LeadRow = { id: string; employeeCode: string; fullName: string; managedEmployeeCount: number };
type ManagerOption = { id: string; employee_code: string; full_name: string };
type ReportingOption = { id: string; employee_code: string; full_name: string; role: string };
type OrgTreeNode = {
  id: string;
  employeeCode: string;
  fullName: string;
  role: string;
  department: string | null;
  children: OrgTreeNode[];
};

type OrgTab = 'chart' | 'departments' | 'managers' | 'leads';

const ROLE_LABEL: Record<string, string> = {
  hr_super_admin: 'HR (Super Admin)',
  hr: 'HR',
  manager: 'Manager',
  lead: 'Lead',
  employee: 'Employee',
};

// Collapsed by default past the second level so a large org doesn't dump
// hundreds of rows on screen at once — this is the piece that was missing
// before: the two tables below show WHO can be assigned, this shows WHO
// ACTUALLY REPORTS TO WHOM, nested, in one glance.
function OrgTreeRow({ node, depth }: { node: OrgTreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 rounded-lg hover:bg-[var(--bg-elevated)]/60 cursor-pointer"
        style={{ paddingLeft: depth * 20 }}
        onClick={() => hasChildren && setOpen((o) => !o)}
      >
        <span className="w-4 text-[var(--text-muted)] text-xs">{hasChildren ? (open ? '▾' : '▸') : ''}</span>
        <span className="text-[var(--text-primary)] text-sm">{node.fullName}</span>
        <span className="text-[var(--text-muted)] text-xs">· {node.employeeCode}</span>
        <span className="text-xs border border-[var(--border)] rounded-full px-2 py-0.5 text-[var(--text-muted)]">
          {ROLE_LABEL[node.role] ?? node.role}
        </span>
        {node.department && <span className="text-xs text-[var(--text-muted)]">{node.department}</span>}
        {hasChildren && <span className="text-xs text-[var(--text-muted)] ml-auto pr-2">{node.children.length} direct</span>}
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map((c) => (
            <OrgTreeRow key={c.id} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// New, separate admin page — "Organization Management" — that moves
// department-manager / lead / reporting-manager assignment out of
// the per-employee AdjustBalanceButton modal into one department-first
// view, per the requirement. This does NOT replace AdjustBalanceButton
// (still the right place to edit a single employee's own fields) — it's
// an additional, bird's-eye view over the exact same data:
// department_managers + employees.reporting_lead_id /
// reporting_manager_id. No new hierarchy model, no `teams` table.
export default function OrganizationManagementPage() {
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [managers, setManagers] = useState<ManagerRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [managerOptions, setManagerOptions] = useState<ManagerOption[]>([]);
  const [reportingTargetOptions, setReportingTargetOptions] = useState<ReportingOption[]>([]);
  const [leadOptions, setLeadOptions] = useState<{ id: string; full_name: string }[]>([]);
  const [orgTree, setOrgTree] = useState<OrgTreeNode[]>([]);
  const [orgTreeUnassignedCount, setOrgTreeUnassignedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [tab, setTab] = useState<OrgTab>('chart');
  const [orgSearch, setOrgSearch] = useState('');

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
      setLeads(orgBody.leads ?? []);
      setManagerOptions(orgBody.managerOptions ?? []);
      setReportingTargetOptions(orgBody.reportingTargetOptions ?? []);
      setOrgTree(orgBody.orgTree ?? []);
      setOrgTreeUnassignedCount(orgBody.orgTreeUnassignedCount ?? 0);

      const empText = await empRes.text();
      const empBody = empText ? JSON.parse(empText) : {};
      if (empRes.ok) {
        // employees endpoint returns everyone — lead dropdown only
        // needs role=lead, but that role isn't in this list's
        // shape, so fall back to the leads summary we already have.
        setLeadOptions((orgBody.leads ?? []).map((t: LeadRow) => ({ id: t.id, full_name: t.fullName })));
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

  async function post(body: Record<string, unknown>, key: string) {    setSavingKey(key);
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

  // Search box shown next to the tab bar — filters whichever tab (or, on
  // the chart, prunes the tree) is currently active by name/code/
  // department, so a large org isn't a scroll-and-squint exercise
  // ("difficult to manage all over there").
  const q = orgSearch.trim().toLowerCase();
  const filteredDepartments = useMemo(
    () => departments.filter((d) => !q || d.department.toLowerCase().includes(q) || (d.managerName ?? '').toLowerCase().includes(q)),
    [departments, q]
  );
  const filteredManagers = useMemo(
    () =>
      managers.filter(
        (m) => !q || m.fullName.toLowerCase().includes(q) || m.employeeCode.toLowerCase().includes(q) || m.managedDepartments.some((d) => d.toLowerCase().includes(q))
      ),
    [managers, q]
  );
  const filteredLeads = useMemo(
    () => leads.filter((t) => !q || t.fullName.toLowerCase().includes(q) || t.employeeCode.toLowerCase().includes(q)),
    [leads, q]
  );

  function pruneTree(nodes: OrgTreeNode[]): OrgTreeNode[] {
    if (!q) return nodes;
    return nodes
      .map((n) => {
        const children = pruneTree(n.children);
        const selfMatch =
          n.fullName.toLowerCase().includes(q) || n.employeeCode.toLowerCase().includes(q) || (n.department ?? '').toLowerCase().includes(q);
        if (selfMatch || children.length > 0) return { ...n, children };
        return null;
      })
      .filter((n): n is OrgTreeNode => n !== null);
  }
  const filteredOrgTree = useMemo(() => pruneTree(orgTree), [orgTree, q]);

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/leave/admin" className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">← Back to Leave Management</Link>
          <h1 className="text-xl font-semibold mt-1">Organization Management</h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">
            Department managers, lead assignment, and the manager reporting hierarchy.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">{error}</div>
      )}
      {toast && (
        <div
          className={`text-xs rounded-lg px-3 py-2 border ${
            toast.kind === 'success'
              ? 'bg-emerald-900/30 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-900/30 border-red-500/30 text-red-700 dark:text-red-300'
          }`}
        >
          {toast.text}
        </div>
      )}

      {loading ? (
        <p className="text-[var(--text-muted)] text-sm">Loading…</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] flex-wrap">
            <div className="flex items-center gap-1">
            {(
              [
                { key: 'chart', label: 'Org Chart', badge: orgTreeUnassignedCount > 0 ? orgTreeUnassignedCount : undefined },
                { key: 'departments', label: 'Departments', badge: undefined },
                { key: 'managers', label: 'Managers', badge: undefined },
                { key: 'leads', label: 'Leads', badge: undefined },
              ] as { key: OrgTab; label: string; badge?: number }[]
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`relative px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t.key
                    ? 'border-[var(--accent)] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {t.label}
                {!!t.badge && (
                  <span className="ml-1.5 inline-flex items-center justify-center bg-amber-500 text-white text-[10px] font-bold rounded-full min-w-[1.1rem] h-[1.1rem] px-1 align-middle">
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
            </div>
            <input
              type="text"
              value={orgSearch}
              onChange={(e) => setOrgSearch(e.target.value)}
              placeholder="Search by name, code, or department…"
              className="mb-2 w-full sm:w-64 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* ── Org Chart: read-only nested view of who reports to whom ── */}
          {tab === 'chart' && (
          <section className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-[var(--text-primary)] font-semibold text-sm">Org Chart</h2>
              {orgTreeUnassignedCount > 0 && (
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  {orgTreeUnassignedCount} {orgTreeUnassignedCount === 1 ? 'person' : 'people'} not yet placed in the chain
                </span>
              )}
            </div>
            <p className="text-[var(--text-muted)] text-xs">
              Click a row to expand. This is read-only — use the tables below, or each employee's Adjust panel, to
              change who reports to whom.
            </p>
            <div className="max-h-[28rem] overflow-y-auto pr-1">
              {filteredOrgTree.map((n) => (
                <OrgTreeRow key={n.id} node={n} depth={0} />
              ))}
              {filteredOrgTree.length === 0 && (
                <p className="text-[var(--text-muted)] text-sm py-4 text-center">
                  {orgTree.length === 0 ? 'No employees yet.' : 'No match for that search.'}
                </p>
              )}
            </div>
          </section>
          )}

          {/* ── Departments: assign / change manager ─────────────────── */}
          {tab === 'departments' && (
          <section className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-3">
            <h2 className="text-[var(--text-primary)] font-semibold text-sm">Departments — Manager Assignment</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[var(--text-muted)] text-xs border-b border-[var(--border)]">
                    <th className="text-left font-medium px-3 py-2">Department</th>
                    <th className="text-left font-medium px-3 py-2">Current Manager</th>
                    <th className="text-left font-medium px-3 py-2">Assign Manager</th>
                    <th className="text-left font-medium px-3 py-2">Assign Lead (bulk)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDepartments.map((d) => (
                    <tr key={d.department} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-3 py-2 text-[var(--text-primary)]">{d.department}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{d.managerName ?? <span className="italic text-[var(--text-muted)]">unassigned</span>}</td>
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
                          className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)]"
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
                              { action: 'bulk_assign_lead', department: d.department, lead_id: e.target.value || null },
                              `dept-tl-${d.department}`
                            )
                          }
                          className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)]"
                        >
                          <option value="" disabled>Set lead for department…</option>
                          <option value="">Clear lead</option>
                          {leadOptions.map((t) => (
                            <option key={t.id} value={t.id}>{t.full_name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                  {departments.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-[var(--text-muted)]">No departments yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[var(--text-muted)] text-xs">
              "Assign Lead (bulk)" sets every current employee-role member of that department's Reporting
              Lead in one action — the same field AdjustBalanceButton edits per person, just applied to the whole
              department at once.
            </p>
          </section>
          )}

          {/* ── Managers: reporting hierarchy ─────────────────────────── */}
          {tab === 'managers' && (
          <section className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-3">
            <h2 className="text-[var(--text-primary)] font-semibold text-sm">Managers — Reporting Hierarchy</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[var(--text-muted)] text-xs border-b border-[var(--border)]">
                    <th className="text-left font-medium px-3 py-2">Manager</th>
                    <th className="text-left font-medium px-3 py-2">Manages</th>
                    <th className="text-left font-medium px-3 py-2">Reports To</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredManagers.map((m) => (
                    <tr key={m.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-3 py-2 text-[var(--text-primary)]">{m.fullName} <span className="text-[var(--text-muted)]">· {m.employeeCode}</span></td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">
                        {m.managedDepartments.length > 0 ? m.managedDepartments.join(', ') : <span className="italic text-[var(--text-muted)]">none</span>}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={m.reportingManagerId ?? ''}
                          disabled={savingKey === `mgr-report-${m.id}`}
                          onChange={(e) =>
                            post({ action: 'assign_manager_reporting', manager_id: m.id, reporting_manager_id: e.target.value || null }, `mgr-report-${m.id}`)
                          }
                          className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)]"
                        >
                          <option value="">No one (top-level)</option>
                          {reportingTargetOptions
                            .filter((opt) => opt.id !== m.id)
                            .map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {opt.full_name} — {opt.role}
                              </option>
                            ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                  {managers.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-[var(--text-muted)]">No managers yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[var(--text-muted)] text-xs">
              Circular chains (A → B → A, or longer) are rejected server-side — the dropdown will show an error toast
              instead of silently applying.
            </p>
          </section>
          )}

          {/* ── Leads: read-only summary ─────────────────────────── */}
          {tab === 'leads' && (
          <section className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-3">
            <h2 className="text-[var(--text-primary)] font-semibold text-sm">Leads</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[var(--text-muted)] text-xs border-b border-[var(--border)]">
                    <th className="text-left font-medium px-3 py-2">Lead</th>
                    <th className="text-left font-medium px-3 py-2">Employees Reporting</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.map((t) => (
                    <tr key={t.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-3 py-2 text-[var(--text-primary)]">{t.fullName} <span className="text-[var(--text-muted)]">· {t.employeeCode}</span></td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{t.managedEmployeeCount}</td>
                    </tr>
                  ))}
                  {leads.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-3 py-6 text-center text-[var(--text-muted)]">No leads yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[var(--text-muted)] text-xs">
              Per-employee lead assignment (one at a time) is still available from each employee's Adjust →
              Details tab — this page adds the bulk, department-level action above it, it doesn't replace it.
            </p>
          </section>
          )}
        </>
      )}
    </div>
  );
}