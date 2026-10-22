'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import LeavePageHeader from '@/components/leave/LeavePageHeader';
import { useDebounce } from '@/lib/useDebounce';
import {
  DepartmentRow,
  ManagerRow,
  LeadRow,
  ManagerOption,
  ReportingOption,
  OrgTreeNode,
  OrgTab,
  countTree,
} from '@/components/leave/organization/orgTypes';
import { StatCard } from '@/components/leave/organization/OrgUiPrimitives';
import OrgChartTab from '@/components/leave/organization/OrgChartTab';
import OrgDepartmentsTab from '@/components/leave/organization/OrgDepartmentsTab';
import OrgManagersTab from '@/components/leave/organization/OrgManagersTab';
import OrgLeadsTab from '@/components/leave/organization/OrgLeadsTab';

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
  // Optimistic record of "what lead did I just assign to this department",
  // so the dropdown responds instantly. The saved value now comes back from
  // the API (department.leadId/leadName), so this is only an overlay that is
  // cleared once the refetch lands, or reverted if the save fails.
  const [localLeadByDept, setLocalLeadByDept] = useState<Record<string, { id: string; name: string } | null>>({});
  const [treeVersion, setTreeVersion] = useState(0);
  const [treeForceOpen, setTreeForceOpen] = useState<boolean | undefined>(undefined);

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
      if (empRes.ok) {
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

  function clearLeadOverlay(body: Record<string, unknown>) {
    if (body.action !== 'bulk_assign_lead' || typeof body.department !== 'string') return;
    const dept = body.department;
    setLocalLeadByDept((prev) => {
      const { [dept]: _removed, ...rest } = prev;
      return rest;
    });
  }
  // A failed save must not leave the dropdown showing a lead that was never
  // stored — same effect as clearing: fall back to what the server reports.
  const revertLeadOverlay = clearLeadOverlay;

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
        revertLeadOverlay(body);
        return;
      }
      setToast({ kind: 'success', text: data.message || 'Saved.' });
      await load(true);
      // The refetch now carries the persisted lead, so drop the overlay.
      clearLeadOverlay(body);
    } catch {
      setToast({ kind: 'error', text: 'Could not reach the server.' });
      revertLeadOverlay(body);
    } finally {
      setSavingKey(null);
    }
  }

  const q = useDebounce(orgSearch.trim().toLowerCase(), 150);

  const filteredDepartments = useMemo(() => {
    if (!q) return departments;
    return departments.filter(
      (d) =>
        d.department.toLowerCase().includes(q) ||
        (d.managerName && d.managerName.toLowerCase().includes(q))
    );
  }, [departments, q]);

  const filteredManagers = useMemo(() => {
    if (!q) return managers;
    return managers.filter(
      (m) =>
        m.fullName.toLowerCase().includes(q) ||
        m.employeeCode.toLowerCase().includes(q) ||
        m.managedDepartments.some((d) => d.toLowerCase().includes(q))
    );
  }, [managers, q]);

  const filteredLeads = useMemo(() => {
    if (!q) return leads;
    return leads.filter(
      (t) =>
        t.fullName.toLowerCase().includes(q) ||
        t.employeeCode.toLowerCase().includes(q)
    );
  }, [leads, q]);

  const hierarchyRoots = useMemo(
    () => orgTree.filter((n) => n.department !== 'UNPLACED'),
    [orgTree]
  );
  const unplacedRoots = useMemo(
    () => orgTree.filter((n) => n.department === 'UNPLACED'),
    [orgTree]
  );
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

          {/* ── Actionable alert ───────────────────────────────────── */}
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

          {/* ── Tab Panes ───────────────────────────────────────────── */}
          {tab === 'chart' && (
            <OrgChartTab
              hierarchyRoots={hierarchyRoots}
              unplacedRoots={unplacedRoots}
              orgTree={orgTree}
              searchQuery={q}
              treeVersion={treeVersion}
              treeForceOpen={treeForceOpen}
              unplacedOpen={unplacedOpen}
              onToggleUnplaced={() => setUnplacedOpen((o) => !o)}
              onExpandAll={expandAll}
              onCollapseAll={collapseAll}
            />
          )}

          {tab === 'departments' && (
            <OrgDepartmentsTab
              filteredDepartments={filteredDepartments}
              departments={departments}
              managerOptions={managerOptions}
              leadOptions={leadOptions}
              localLeadByDept={localLeadByDept}
              savingKey={savingKey}
              onAssignManager={(dept, managerId) =>
                post({ action: 'assign_department_manager', department: dept, manager_id: managerId }, `dept-mgr-${dept}`)
              }
              onAssignLead={(dept, leadId, leadName) => {
                setLocalLeadByDept((prev) => ({
                  ...prev,
                  [dept]: leadId ? { id: leadId, name: leadName || '' } : null,
                }));
                post({ action: 'bulk_assign_lead', department: dept, lead_id: leadId }, `dept-tl-${dept}`);
              }}
            />
          )}

          {tab === 'managers' && (
            <OrgManagersTab
              filteredManagers={filteredManagers}
              managers={managers}
              reportingTargetOptions={reportingTargetOptions}
              savingKey={savingKey}
              onAssignReportingManager={(managerId, reportingManagerId) =>
                post({ action: 'assign_manager_reporting', manager_id: managerId, reporting_manager_id: reportingManagerId }, `mgr-report-${managerId}`)
              }
            />
          )}

          {tab === 'leads' && (
            <OrgLeadsTab
              filteredLeads={filteredLeads}
              leads={leads}
              reportingTargetOptions={reportingTargetOptions}
              savingKey={savingKey}
              onAssignReportingManager={(leadId, reportingManagerId) =>
                post({ action: 'assign_manager_reporting', manager_id: leadId, reporting_manager_id: reportingManagerId }, `lead-report-${leadId}`)
              }
            />
          )}
        </>
      )}
    </div>
  );
}
