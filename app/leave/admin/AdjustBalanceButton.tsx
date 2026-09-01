'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Layers,
  Settings2,
  SlidersHorizontal,
  UserCheck,
  X,
} from 'lucide-react';

const CODES = [
  { code: 'SL', label: 'Sick Leave', color: 'text-violet-500 border-violet-500/30 bg-violet-500/10' },
  { code: 'CL', label: 'Casual Leave', color: 'text-cyan-500 border-cyan-500/30 bg-cyan-500/10' },
  { code: 'PL', label: 'Planned Leave', color: 'text-orange-500 border-orange-500/30 bg-orange-500/10' },
] as const;

const ROLES = [
  { value: 'employee', label: 'Employee' },
  { value: 'lead', label: 'Lead' },
  { value: 'manager', label: 'Manager' },
  { value: 'hr', label: 'HR' },
  { value: 'hr_super_admin', label: 'HR Super Admin' },
];

const STATUSES = [
  { value: 'probation', label: 'Probation', dot: 'bg-amber-500', desc: 'New hire on review' },
  { value: 'active', label: 'Active', dot: 'bg-emerald-500', desc: 'Confirmed employee' },
  { value: 'notice_period', label: 'Notice Period', dot: 'bg-orange-500', desc: 'Serving notice period' },
  { value: 'exited', label: 'Exited', dot: 'bg-slate-400', desc: 'Former employee' },
];

type PersonOption = { id: string; full_name: string; employee_code: string };
type DepartmentOption = { department: string; managerId: string | null; managerName: string | null };

export default function AdjustBalanceButton({
  employeeId,
  employeeName,
  fyStartYear,
  currentRole,
  currentStatus,
  currentDepartment,
  currentNoticePeriodDays,
  currentLeadId,
  currentManagerId,
  currentManagedDepartments,
}: {
  employeeId: string;
  employeeName: string;
  fyStartYear: number;
  currentRole?: string;
  currentStatus?: string;
  currentDepartment?: string;
  currentNoticePeriodDays?: number;
  currentLeadId?: string | null;
  currentManagerId?: string | null;
  currentManagedDepartments?: string[];
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'details' | 'balance'>('details');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  // Balance tab state
  const [leaveTypeCode, setLeaveTypeCode] = useState<(typeof CODES)[number]['code']>('PL');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');

  // Details tab state
  const [role, setRole] = useState(currentRole ?? 'employee');
  const [status, setStatus] = useState(currentStatus ?? 'active');
  const [department, setDepartment] = useState(currentDepartment ?? '');
  const [noticePeriodDays, setNoticePeriodDays] = useState(String(currentNoticePeriodDays ?? 30));
  const [leadId, setLeadId] = useState(currentLeadId ?? '');
  const [managerId, setManagerId] = useState(currentManagerId ?? '');
  const [managedDepartments, setManagedDepartments] = useState<string[]>(currentManagedDepartments ?? []);
  const [leads, setLeads] = useState<PersonOption[]>([]);
  const [managers, setManagers] = useState<PersonOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync props when opening
  useEffect(() => {
    if (open) {
      setRole(currentRole ?? 'employee');
      setStatus(currentStatus ?? 'active');
      setDepartment(currentDepartment ?? '');
      setNoticePeriodDays(String(currentNoticePeriodDays ?? 30));
      setLeadId(currentLeadId ?? '');
      setManagerId(currentManagerId ?? '');
      setManagedDepartments(currentManagedDepartments ?? []);
      setError(null);
      setSuccess(null);
    }
  }, [open, currentRole, currentStatus, currentDepartment, currentNoticePeriodDays, currentLeadId, currentManagerId, currentManagedDepartments]);

  useEffect(() => {
    if (!open || tab !== 'details') return;
    let cancelled = false;

    async function loadData() {
      try {
        const [leadRes, mgrRes, deptRes] = await Promise.all([
          fetch('/api/leave/employees?role=lead'),
          fetch('/api/leave/employees?role=manager'),
          fetch('/api/leave/departments'),
        ]);

        if (cancelled) return;

        if (leadRes.ok) {
          const d = await leadRes.json().catch(() => ({}));
          if (!cancelled) setLeads(d.employees ?? []);
        }
        if (mgrRes.ok) {
          const d = await mgrRes.json().catch(() => ({}));
          if (!cancelled) setManagers(d.employees ?? []);
        }
        if (deptRes.ok) {
          const d = await deptRes.json().catch(() => ({}));
          if (!cancelled) setDepartments(d.departments ?? []);
        }
      } catch {
        // Dropdown stays empty gracefully
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [open, tab]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);

  function close() {
    setOpen(false);
    setError(null);
    setSuccess(null);
  }

  async function handleBalanceSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const deltaNum = parseFloat(delta);
    if (!delta || Number.isNaN(deltaNum) || deltaNum === 0) {
      setError('Enter a valid non-zero amount (+ to add, - to deduct).');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required for balance adjustment.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/leave/employees/${employeeId}/adjust-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leave_type_code: leaveTypeCode, delta: deltaNum, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to adjust balance.');
        setSaving(false);
        return;
      }
      setSaving(false);
      setSuccess('Balance adjustment saved!');
      router.refresh();
      setTimeout(close, 700);
    } catch {
      setError('Could not reach server.');
      setSaving(false);
    }
  }

  async function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (leadId && leadId === employeeId) {
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
      department: department || null,
    };
    if (status === 'notice_period') {
      const days = parseInt(noticePeriodDays, 10);
      if (!noticePeriodDays || Number.isNaN(days) || days <= 0) {
        setError('Enter a valid number of notice period days.');
        return;
      }
      payload.notice_period_days = days;
    }
    if (role === 'employee') {
      payload.reporting_lead_id = leadId || null;
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
      const data = await res.json().catch(() => ({}));
      setSaving(false);
      if (!res.ok) {
        setError(data.error || 'Failed to update employee details.');
        return;
      }
      setSuccess('Employee details updated!');
      router.refresh();
      setTimeout(close, 700);
    } catch {
      setSaving(false);
      setError('Could not reach server.');
    }
  }

  const modal = open && mounted && (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{
          background: 'linear-gradient(170deg, var(--bg-card) 0%, var(--bg-elevated) 100%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--bg-surface)]/80">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[var(--accent)]/20 to-[var(--accent)]/5 border border-[var(--accent)]/30 text-[var(--accent)] flex items-center justify-center shadow-xs shrink-0">
              <Settings2 size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-[var(--text-primary)] truncate">Adjust — {employeeName}</h3>
              <p className="text-xs text-[var(--text-muted)] truncate">
                Status, role &amp; balance configuration
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab selector */}
        <div className="px-6 pt-3 pb-1 shrink-0">
          <div className="flex gap-1 bg-[var(--bg-surface)] p-1 rounded-2xl border border-[var(--border)]">
            <button
              type="button"
              onClick={() => { setTab('details'); setError(null); setSuccess(null); }}
              className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-bold rounded-xl py-2 transition-all ${
                tab === 'details'
                  ? 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] text-white shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <UserCheck size={14} />
              Status &amp; Role
            </button>
            <button
              type="button"
              onClick={() => { setTab('balance'); setError(null); setSuccess(null); }}
              className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-bold rounded-xl py-2 transition-all ${
                tab === 'balance'
                  ? 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] text-white shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Layers size={14} />
              Leave Balances
            </button>
          </div>
        </div>

        {/* Feedback Messages */}
        <div className="px-6 pt-2">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 dark:bg-red-500/15 border border-red-500/30 text-red-700 dark:text-red-300 text-xs font-medium rounded-xl p-3">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold rounded-xl p-3">
              <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
              <span>{success}</span>
            </div>
          )}
        </div>

        {/* Form Content */}
        <div className="p-6 overflow-y-auto scroll-thin flex-1 space-y-4">
          {tab === 'details' ? (
            <form onSubmit={handleDetailsSubmit} className="space-y-4">
              {/* Status selection pills */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                  Employment Status
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {STATUSES.map((s) => {
                    const isSelected = status === s.value;
                    return (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setStatus(s.value)}
                        className={`flex flex-col items-start p-3 rounded-2xl border text-left transition-all ${
                          isSelected
                            ? 'bg-[var(--accent)]/10 border-[var(--accent)] ring-1 ring-[var(--accent)] shadow-xs'
                            : 'bg-[var(--bg-surface)] border-[var(--border)] hover:border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]'
                        }`}
                      >
                        <span className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)]">
                          <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                          {s.label}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)] mt-0.5">{s.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notice period days */}
              {status === 'notice_period' && (
                <div className="bg-orange-500/10 border border-orange-500/25 rounded-2xl p-3.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Clock size={15} className="text-orange-500" />
                    <label className="text-xs font-bold text-orange-700 dark:text-orange-300">
                      Notice Period (Days)
                    </label>
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={noticePeriodDays}
                    onChange={(e) => setNoticePeriodDays(e.target.value)}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3.5 py-2 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                  />
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Enables Full &amp; Final settlement calculator for this employee.
                  </p>
                </div>
              )}

              {/* Role Selector */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                  System Role
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]"
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              {/* Department Selector */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                  Department
                </label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]"
                >
                  <option value="">— Select Department —</option>
                  {departments.map((d) => (
                    <option key={d.department} value={d.department}>{d.department}</option>
                  ))}
                </select>
              </div>

              {/* Reporting Lead for employees */}
              {role === 'employee' && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                    Reporting Lead
                  </label>
                  <select
                    value={leadId}
                    onChange={(e) => setLeadId(e.target.value)}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]"
                  >
                    <option value="">— None —</option>
                    {leads.map((p) => (
                      <option key={p.id} value={p.id}>{p.full_name} ({p.employee_code})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Manager fields */}
              {role === 'manager' && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                      Departments Managed
                    </label>
                    <div className="border border-[var(--border)] rounded-2xl p-2.5 max-h-36 overflow-y-auto scroll-thin space-y-1.5 bg-[var(--bg-surface)]">
                      {departments.length === 0 && <p className="text-[var(--text-muted)] text-xs p-1">No departments configured.</p>}
                      {departments.map((d) => {
                        const checked = managedDepartments.includes(d.department);
                        const takenByOther = d.managerId && d.managerId !== employeeId;
                        return (
                          <label key={d.department} className="flex items-center gap-2.5 text-xs text-[var(--text-primary)] font-medium p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] cursor-pointer transition-colors">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setManagedDepartments((depts) =>
                                  e.target.checked ? [...depts, d.department] : depts.filter((x) => x !== d.department)
                                )
                              }
                              className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]/30"
                            />
                            <span>
                              {d.department}
                              {takenByOther && !checked && (
                                <span className="text-amber-500 text-[10px] ml-1">({d.managerName})</span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                      Reports To (Manager)
                    </label>
                    <select
                      value={managerId}
                      onChange={(e) => setManagerId(e.target.value)}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]"
                    >
                      <option value="">— None —</option>
                      {managers
                        .filter((p) => p.id !== employeeId)
                        .map((p) => (
                          <option key={p.id} value={p.id}>{p.full_name} ({p.employee_code})</option>
                        ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button type="button" onClick={close} className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] hover:opacity-95 text-white text-xs font-bold shadow-md shadow-[var(--accent)]/25 disabled:opacity-50 transition-all"
                >
                  {saving ? 'Saving…' : 'Save Details'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleBalanceSubmit} className="space-y-4">
              <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-3">
                <p className="text-xs font-semibold text-[var(--text-primary)]">FY {fyStartYear}–{String(fyStartYear + 1).slice(-2)}</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Adjust leave balance with audited reasoning.</p>
              </div>

              {/* Leave type pills */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                  Leave Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {CODES.map((c) => {
                    const isSelected = leaveTypeCode === c.code;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => setLeaveTypeCode(c.code)}
                        className={`py-2.5 px-3 rounded-2xl border text-xs font-bold transition-all ${
                          isSelected
                            ? `${c.color} ring-1 shadow-sm`
                            : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {c.code} · {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                  Adjustment Days (+ to add, - to deduct)
                </label>
                <input
                  type="number"
                  step="0.5"
                  required
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  placeholder="e.g. 2 or -1.5"
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-sm font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]"
                />
              </div>

              {/* Reason */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                  Reason / Note (Required)
                </label>
                <textarea
                  required
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Correcting proration / bonus leave credit"
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button type="button" onClick={close} className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] hover:opacity-95 text-white text-xs font-bold shadow-md shadow-[var(--accent)]/25 disabled:opacity-50 transition-all"
                >
                  {saving ? 'Saving…' : 'Save Adjustment'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/50 hover:bg-[var(--bg-elevated)] transition-all shadow-xs"
        title="Adjust employee status, role, hierarchy or balance"
      >
        <SlidersHorizontal size={13} className="text-[var(--accent)]" />
        Adjust
      </button>

      {mounted && modal && createPortal(modal, document.body)}
    </>
  );
}