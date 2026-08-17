'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import LeavePageHeader from '@/components/leave/LeavePageHeader';

type DepartmentRow = { department: string; managerId: string | null; managerName: string | null };
type ManagerRow = {
  id: string;
  employeeCode: string;
  fullName: string;
  managedDepartments: string[];
  reportingManagerId: string | null;
  reportingManagerName: string | null;
};
type LeadRow = {
  id: string;
  employeeCode: string;
  fullName: string;
  managedEmployeeCount: number;
  reportingManagerId: string | null;
  reportingManagerName: string | null;
};
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

// Colors are intentionally NOT theme tokens (--accent etc.) — these are
// role-identity colors, meant to stay constant so "blue = manager" is a
// learned convention across the whole page, independent of light/dark mode.
const ROLE_COLOR: Record<string, { text: string; bg: string }> = {
  hr_super_admin: { text: '#a78bfa', bg: 'rgba(167,139,250,0.14)' },
  hr: { text: '#a78bfa', bg: 'rgba(167,139,250,0.14)' },
  manager: { text: '#60a5fa', bg: 'rgba(96,165,250,0.14)' },
  lead: { text: '#2dd4bf', bg: 'rgba(45,212,191,0.14)' },
  employee: { text: '#94a3b8', bg: 'rgba(148,163,184,0.14)' },
};

function roleColor(role: string) {
  return ROLE_COLOR[role] ?? ROLE_COLOR.employee;
}

// Deterministic color per department name so the same department always
// gets the same dot color across sessions, without hardcoding a palette
// that would break the moment someone adds a new department.
function deptColor(name: string | null) {
  if (!name) return '#64748b';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 62%)`;
}

function initials(name: string) {
  if (/^\d+$/.test(name)) return '#' + name.slice(-2);
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function Avatar({ name, role }: { name: string; role: string }) {
  const c = roleColor(role);
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-[10px] font-bold shrink-0"
      style={{ background: c.bg, color: c.text }}
    >
      {initials(name)}
    </span>
  );
}

function RoleChip({ role }: { role: string }) {
  const c = roleColor(role);
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 whitespace-nowrap"
      style={{ background: c.bg, color: c.text }}
    >
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

// Native <select> elements render the OS's own arrow/box and ignore the
// app's theme entirely — that's what was reading as "ugly" in dark mode.
// This wraps a real <select> (kept for accessibility + native keyboard/
// mobile behavior) but hides its default arrow and draws a themed one on
// top, so it actually matches the rest of the page.
function Select({
  value,
  onChange,
  disabled,
  saving,
  children,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  saving?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative w-full min-w-[9rem]">
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="appearance-none w-full rounded-lg pl-3 pr-8 py-2 text-xs font-medium cursor-pointer transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-wait truncate"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          colorScheme: 'dark',
        }}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3"
        viewBox="0 0 12 12"
        fill="none"
      >
        <path d="M2.5 4.5L6 8l3.5-3.5" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {saving && (
        <span
          className="absolute -right-1 -top-1 w-2 h-2 rounded-full animate-pulse"
          style={{ background: 'var(--accent)' }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{
        borderColor: warn ? 'rgba(251,146,60,0.35)' : 'var(--border)',
        background: warn ? 'rgba(251,146,60,0.08)' : 'var(--bg-elevated)',
      }}
    >
      <div className="text-xl font-extrabold tabular-nums" style={{ color: warn ? 'var(--accent)' : 'var(--text-primary)' }}>
        {value}
      </div>
      <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
    </div>
  );
}

// A row inside the "reporting hierarchy" tree — for people who actually
// have someone reporting to them, rendered with a connecting rail so depth
// reads at a glance instead of via indentation alone.
function OrgTreeRow({
  node,
  depth,
  forceOpen,
}: {
  node: OrgTreeNode;
  depth: number;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => (forceOpen !== undefined ? forceOpen : depth < 2));
  const hasChildren = node.children.length > 0;

  return (
    <div className="relative">
      <div
        className="flex items-center gap-2.5 py-2 pr-3 rounded-lg cursor-pointer transition-colors hover:bg-[var(--bg-surface)]"
        style={{ paddingLeft: 12 + depth * 22 }}
        onClick={() => hasChildren && setOpen((o) => !o)}
      >
        {depth > 0 && (
          <span
            className="absolute border-l"
            style={{ borderColor: 'var(--border)', left: 12 + (depth - 1) * 22 + 10, top: 0, bottom: hasChildren && open ? 0 : '50%' }}
          />
        )}
        <span className="w-3.5 text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>
          {hasChildren ? (open ? '▾' : '▸') : ''}
        </span>
        <Avatar name={node.fullName} role={node.role} />
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {node.fullName}
        </span>
        <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
          #{node.employeeCode}
        </span>
        <RoleChip role={node.role} />
        {node.department && (
          <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span className="w-1.5 h-1.5 rounded-sm" style={{ background: deptColor(node.department) }} />
            {node.department}
          </span>
        )}
        {hasChildren && (
          <span className="ml-auto text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
            {node.children.length} direct report{node.children.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map((c) => (
            <OrgTreeRow key={c.id} node={c} depth={depth + 1} forceOpen={forceOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

// Flat row used for the "not yet placed" bucket — no chevron, no children,
// just a compact scan list, since there is nothing to expand.
function UnplacedRow({ node }: { node: OrgTreeNode }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 px-3 rounded-lg hover:bg-[var(--bg-surface)]">
      <Avatar name={node.fullName} role={node.role} />
      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {node.fullName}
      </span>
      <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
        #{node.employeeCode}
      </span>
      <RoleChip role={node.role} />
      {node.department && (
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {node.department}
        </span>
      )}
      <span className="ml-auto text-xs" style={{ color: 'var(--accent)' }}>
        no manager set
      </span>
    </div>
  );
}

function countTree(nodes: OrgTreeNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countTree(n.children), 0);
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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [tab, setTab] = useState<OrgTab>('chart');
  const [orgSearch, setOrgSearch] = useState('');
  const [unplacedOpen, setUnplacedOpen] = useState(false);
  // Session-only optimistic record of "what lead did I just assign to this
  // department" — see the long comment above the Departments table for why
  // this exists instead of reading it from the API response.
  const [localLeadByDept, setLocalLeadByDept] = useState<Record<string, { id: string; name: string } | null>>({});
  const [treeVersion, setTreeVersion] = useState(0);
  const [treeForceOpen, setTreeForceOpen] = useState<boolean | undefined>(undefined);

  // `background = true` is used for every refetch AFTER the first one
  // (i.e. after a save) — it must NOT touch `loading`, because `loading`
  // controls whether the entire page content unmounts and gets replaced
  // with "Loading…". That was the cause of the "whole page reloads on
  // every change" issue: every post() called load() called setLoading(true),
  // which tore down and remounted the whole tab/table UI on every single
  // dropdown change. Now only the very first mount uses the full-page
  // loading state; subsequent refreshes use a small non-blocking indicator.
  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
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
      if (background) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      await load(true);
    } catch {
      setToast({ kind: 'error', text: 'Could not reach the server.' });
    } finally {
      setSavingKey(null);
    }
  }

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

  // Split roots into two buckets: people who actually have direct reports
  // (a real hierarchy worth drawing as a tree) vs. everyone else, who has
  // no manager AND no one reporting to them — visually indistinguishable
  // from noise if left mixed into the tree above.
  const hierarchyRoots = useMemo(() => filteredOrgTree.filter((n) => n.children.length > 0), [filteredOrgTree]);
  const unplacedRoots = useMemo(() => filteredOrgTree.filter((n) => n.children.length === 0), [filteredOrgTree]);
  const totalPeople = useMemo(() => countTree(orgTree), [orgTree]);

  function expandAll() {
    setTreeForceOpen(true);
    setTreeVersion((v) => v + 1);
  }
  function collapseAll() {
    setTreeForceOpen(false);
    setTreeVersion((v) => v + 1);
  }

  function jumpToUnplaced() {
    setTab('chart');
    setOrgSearch('');
    setUnplacedOpen(true);
    requestAnimationFrame(() => {
      document.getElementById('unplaced-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const TABS: { key: OrgTab; label: string; count: number }[] = [
    { key: 'chart', label: 'Org Chart', count: totalPeople },
    { key: 'departments', label: 'Departments', count: departments.length },
    { key: 'managers', label: 'Managers', count: managers.length },
    { key: 'leads', label: 'Leads', count: leads.length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <LeavePageHeader
          title="Organization Management"
          description="Who reports to whom, and who runs each department — set it here, see it reflected everywhere."
        />
        {/* Small, non-blocking — replaces the old behavior where every save
            re-triggered the full "Loading…" screen and tore down the page. */}
        {refreshing && (
          <span className="flex items-center gap-1.5 text-xs pt-1 shrink-0" style={{ color: 'var(--text-muted)' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
            Refreshing…
          </span>
        )}
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
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading…
        </p>
      ) : (
        <>
          {/* ── Stat strip ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Total people" value={totalPeople} />
            <StatCard label="Departments" value={departments.length} />
            <StatCard label="Managers" value={managers.length} />
            <StatCard label="Leads" value={leads.length} />
            <StatCard label="Unassigned" value={orgTreeUnassignedCount} warn={orgTreeUnassignedCount > 0} />
          </div>

          {/* ── Actionable alert instead of a buried footnote ─────────── */}
          {orgTreeUnassignedCount > 0 && (
            <div
              className="flex items-center gap-3 rounded-xl border px-4 py-3"
              style={{ borderColor: 'rgba(251,146,60,0.35)', background: 'rgba(251,146,60,0.08)' }}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--accent)' }} />
              <p className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>
                <b style={{ color: 'var(--accent)' }}>{orgTreeUnassignedCount}</b>{' '}
                {orgTreeUnassignedCount === 1 ? 'person is' : 'people are'} not yet placed in the reporting chain — no
                manager, no one reporting to them.
              </p>
              <button
                type="button"
                onClick={jumpToUnplaced}
                className="text-xs font-bold rounded-lg px-3 py-1.5 shrink-0 transition-opacity hover:opacity-90"
                style={{ background: 'var(--accent)', color: '#1a0d03' }}
              >
                Review now →
              </button>
            </div>
          )}

          {/* ── Tabs + search ──────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 border-b flex-wrap" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className="relative px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5"
                  style={{
                    borderColor: tab === t.key ? 'var(--accent)' : 'transparent',
                    color: tab === t.key ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  {t.label}
                  <span
                    className="text-[10px] font-bold rounded-full px-1.5 py-0.5"
                    style={{
                      background: tab === t.key ? 'rgba(251,146,60,0.16)' : 'var(--bg-elevated)',
                      color: tab === t.key ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    {t.count}
                  </span>
                </button>
              ))}
            </div>
            <input
              type="text"
              value={orgSearch}
              onChange={(e) => setOrgSearch(e.target.value)}
              placeholder="Search by name, code, or department…"
              className="mb-2 w-full sm:w-72 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          {/* ── Org Chart ──────────────────────────────────────────── */}
          {tab === 'chart' && (
            <div className="space-y-4">
              <section className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
                <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                  <div>
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Reporting hierarchy
                    </h2>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Read-only — use the tables below, or an employee's Adjust panel, to change who reports to whom.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={expandAll}
                      className="text-xs rounded-lg px-2.5 py-1.5 border transition-colors"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                    >
                      Expand all
                    </button>
                    <button
                      type="button"
                      onClick={collapseAll}
                      className="text-xs rounded-lg px-2.5 py-1.5 border transition-colors"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                    >
                      Collapse all
                    </button>
                  </div>
                </div>
                <div className="scroll-thin max-h-[26rem] overflow-y-auto p-2" key={treeVersion}>
                  {hierarchyRoots.map((n) => (
                    <OrgTreeRow key={n.id} node={n} depth={0} forceOpen={treeForceOpen} />
                  ))}
                  {hierarchyRoots.length === 0 && (
                    <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                      {orgTree.length === 0
                        ? 'No employees yet.'
                        : q
                        ? 'No match for that search.'
                        : 'Nobody has direct reports yet — assign a manager below to start building the chart.'}
                    </p>
                  )}
                </div>
              </section>

              {/* ── Unplaced people — separated out instead of mixed flat into the tree ── */}
              {unplacedRoots.length > 0 && (
                <section
                  id="unplaced-section"
                  className="rounded-xl border"
                  style={{ borderColor: 'rgba(251,146,60,0.3)', background: 'var(--bg-elevated)' }}
                >
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer"
                    onClick={() => setUnplacedOpen((o) => !o)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {unplacedOpen ? '▾' : '▸'}
                      </span>
                      <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Not yet placed in the chain
                      </h2>
                      <span
                        className="text-[10px] font-bold rounded-full px-1.5 py-0.5"
                        style={{ background: 'rgba(251,146,60,0.16)', color: 'var(--accent)' }}
                      >
                        {unplacedRoots.length}
                      </span>
                    </div>
                  </div>
                  {unplacedOpen && (
                    <div className="scroll-thin max-h-96 overflow-y-auto px-2 pb-2 border-t" style={{ borderColor: 'var(--border)' }}>
                      {unplacedRoots.map((n) => (
                        <UnplacedRow key={n.id} node={n} />
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}

          {/* ── Departments: assign / change manager ─────────────────── */}
          {tab === 'departments' && (
            <section className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
              <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                Departments — manager assignment
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs border-b" style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
                      <th className="text-left font-medium px-3 py-2">Department</th>
                      <th className="text-left font-medium px-3 py-2">Current manager</th>
                      <th className="text-left font-medium px-3 py-2">Assign manager</th>
                      <th className="text-left font-medium px-3 py-2">Current lead</th>
                      <th className="text-left font-medium px-3 py-2">Assign lead (bulk)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDepartments.map((d) => {
                      const localLead = localLeadByDept[d.department];
                      const leadKnown = d.department in localLeadByDept;
                      return (
                        <tr key={d.department} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                          <td className="px-3 py-2.5">
                            <span className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: deptColor(d.department) }} />
                              {d.department}
                            </span>
                          </td>
                          <td className="px-3 py-2.5" style={{ color: 'var(--text-muted)' }}>
                            {d.managerName ?? <span className="italic">unassigned</span>}
                          </td>
                          <td className="px-3 py-2.5">
                            <Select
                              value={d.managerId ?? ''}
                              disabled={savingKey === `dept-mgr-${d.department}`}
                              saving={savingKey === `dept-mgr-${d.department}`}
                              onChange={(e) =>
                                post(
                                  { action: 'assign_department_manager', department: d.department, manager_id: e.target.value || null },
                                  `dept-mgr-${d.department}`
                                )
                              }
                            >
                              <option value="">Unassigned</option>
                              {managerOptions.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.full_name} ({m.employee_code})
                                </option>
                              ))}
                            </Select>
                          </td>
                          {/* The API has no per-department "current lead" field — bulk-assign
                              fans reporting_lead_id out to every employee individually, so
                              there's no single stored value to read back. This shows the last
                              value YOU set, for this session, so the dropdown stops looking
                              like it silently failed. It resets on a hard page refresh until
                              the API is extended to compute and return it. */}
                          <td className="px-3 py-2.5" style={{ color: 'var(--text-muted)' }}>
                            {leadKnown ? (
                              localLead ? (
                                <span style={{ color: 'var(--text-primary)' }}>{localLead.name}</span>
                              ) : (
                                <span className="italic">cleared</span>
                              )
                            ) : (
                              <span className="italic" title="Not tracked by the API per-department — set below to see it here.">
                                not tracked
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <Select
                              value={localLead?.id ?? ''}
                              disabled={savingKey === `dept-tl-${d.department}`}
                              saving={savingKey === `dept-tl-${d.department}`}
                              onChange={(e) => {
                                const opt = e.target.selectedOptions[0];
                                const leadId = e.target.value;
                                setLocalLeadByDept((prev) => ({
                                  ...prev,
                                  [d.department]: leadId ? { id: leadId, name: opt.text } : null,
                                }));
                                post({ action: 'bulk_assign_lead', department: d.department, lead_id: leadId || null }, `dept-tl-${d.department}`);
                              }}
                            >
                              <option value="">{leadKnown ? 'Clear lead' : 'Set lead for department…'}</option>
                              {leadOptions.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.full_name}
                                </option>
                              ))}
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                    {departments.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center" style={{ color: 'var(--text-muted)' }}>
                          No departments yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                "Assign lead (bulk)" sets every current employee-role member of that department's reporting lead in
                one action — the same field an employee's Adjust panel edits per person, just applied to the whole
                department at once. "Current lead" reflects your latest change for this browser session — ask me to
                wire up the API if you want it to persist and reload correctly across visits.
              </p>
            </section>
          )}

          {/* ── Managers: reporting hierarchy ─────────────────────────── */}
          {tab === 'managers' && (
            <section className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
              <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                Managers — reporting hierarchy
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs border-b" style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
                      <th className="text-left font-medium px-3 py-2">Manager</th>
                      <th className="text-left font-medium px-3 py-2">Manages</th>
                      <th className="text-left font-medium px-3 py-2">Reports to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredManagers.map((m) => (
                      <tr key={m.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2">
                            <Avatar name={m.fullName} role="manager" />
                            <span style={{ color: 'var(--text-primary)' }}>{m.fullName}</span>
                            <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                              #{m.employeeCode}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5" style={{ color: 'var(--text-muted)' }}>
                          {m.managedDepartments.length > 0 ? m.managedDepartments.join(', ') : <span className="italic">none</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <Select
                            value={m.reportingManagerId ?? ''}
                            disabled={savingKey === `mgr-report-${m.id}`}
                            saving={savingKey === `mgr-report-${m.id}`}
                            onChange={(e) =>
                              post({ action: 'assign_manager_reporting', manager_id: m.id, reporting_manager_id: e.target.value || null }, `mgr-report-${m.id}`)
                            }
                          >
                            <option value="">No one (top-level)</option>
                            {reportingTargetOptions
                              .filter((opt) => opt.id !== m.id)
                              .map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.full_name} — {opt.role}
                                </option>
                              ))}
                          </Select>
                        </td>
                      </tr>
                    ))}
                    {managers.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center" style={{ color: 'var(--text-muted)' }}>
                          No managers yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Circular chains (A → B → A, or longer) are rejected server-side — the dropdown will show an error
                toast instead of silently applying.
              </p>
            </section>
          )}

          {/* ── Leads: reporting hierarchy, same pattern as Managers ──── */}
          {tab === 'leads' && (
            <section className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
              <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                Leads
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs border-b" style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
                      <th className="text-left font-medium px-3 py-2">Lead</th>
                      <th className="text-left font-medium px-3 py-2">Employees reporting</th>
                      <th className="text-left font-medium px-3 py-2">Reports to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeads.map((t) => (
                      <tr key={t.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2">
                            <Avatar name={t.fullName} role="lead" />
                            <span style={{ color: 'var(--text-primary)' }}>{t.fullName}</span>
                            <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                              #{t.employeeCode}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5" style={{ color: 'var(--text-muted)' }}>
                          {t.managedEmployeeCount}
                        </td>
                        <td className="px-3 py-2.5">
                          <Select
                            value={t.reportingManagerId ?? ''}
                            disabled={savingKey === `lead-report-${t.id}`}
                            saving={savingKey === `lead-report-${t.id}`}
                            onChange={(e) =>
                              // Same action the Managers tab uses — the API
                              // never restricted `manager_id` to role='manager',
                              // it just means "whose reporting_manager_id to
                              // write." Works identically for a lead's id.
                              post(
                                { action: 'assign_manager_reporting', manager_id: t.id, reporting_manager_id: e.target.value || null },
                                `lead-report-${t.id}`
                              )
                            }
                          >
                            <option value="">No one (top-level)</option>
                            {reportingTargetOptions
                              .filter((opt) => opt.id !== t.id)
                              .map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.full_name} — {opt.role}
                                </option>
                              ))}
                          </Select>
                        </td>
                      </tr>
                    ))}
                    {leads.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center" style={{ color: 'var(--text-muted)' }}>
                          No leads yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Per-employee lead assignment (one at a time) is still available from each employee's Adjust → Details
                tab — this page adds the bulk, department-level action above it, it doesn't replace it. "Reports to"
                now persists correctly and will show up in the Org Chart above.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
