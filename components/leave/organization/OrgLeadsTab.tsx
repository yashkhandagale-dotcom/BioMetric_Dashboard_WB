'use client';

import { LeadRow, ReportingOption } from './orgTypes';
import { Avatar, Select } from './OrgUiPrimitives';

export interface OrgLeadsTabProps {
  filteredLeads: LeadRow[];
  leads: LeadRow[];
  reportingTargetOptions: ReportingOption[];
  savingKey: string | null;
  onAssignReportingManager: (leadId: string, reportingManagerId: string | null) => void;
}

export default function OrgLeadsTab({
  filteredLeads,
  leads,
  reportingTargetOptions,
  savingKey,
  onAssignReportingManager,
}: OrgLeadsTabProps) {
  return (
    <section
      className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
    >
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
                    onChange={(e) => onAssignReportingManager(t.id, e.target.value || null)}
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
  );
}
