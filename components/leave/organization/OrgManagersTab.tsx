'use client';

import { ManagerRow, ReportingOption } from './orgTypes';
import { Avatar, Select } from './OrgUiPrimitives';

export interface OrgManagersTabProps {
  filteredManagers: ManagerRow[];
  managers: ManagerRow[];
  reportingTargetOptions: ReportingOption[];
  savingKey: string | null;
  onAssignReportingManager: (managerId: string, reportingManagerId: string | null) => void;
}

export default function OrgManagersTab({
  filteredManagers,
  managers,
  reportingTargetOptions,
  savingKey,
  onAssignReportingManager,
}: OrgManagersTabProps) {
  return (
    <section
      className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
    >
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
                    onChange={(e) => onAssignReportingManager(m.id, e.target.value || null)}
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
        Circular chains (A → B → A, or longer) are rejected server-side — the dropdown will show an error toast instead of silently applying.
      </p>
    </section>
  );
}
