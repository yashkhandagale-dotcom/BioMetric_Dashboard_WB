'use client';

import { DepartmentRow, ManagerOption, deptColor } from './orgTypes';
import { Select } from './OrgUiPrimitives';

export interface OrgDepartmentsTabProps {
  filteredDepartments: DepartmentRow[];
  departments: DepartmentRow[];
  managerOptions: ManagerOption[];
  leadOptions: { id: string; full_name: string }[];
  localLeadByDept: Record<string, { id: string; name: string } | null>;
  savingKey: string | null;
  onAssignManager: (department: string, managerId: string | null) => void;
  onAssignLead: (department: string, leadId: string | null, leadName?: string) => void;
}

export default function OrgDepartmentsTab({
  filteredDepartments,
  departments,
  managerOptions,
  leadOptions,
  localLeadByDept,
  savingKey,
  onAssignManager,
  onAssignLead,
}: OrgDepartmentsTabProps) {
  return (
    <section
      className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
    >
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
              const hasLocal = d.department in localLeadByDept;
              const savedLead = d.leadId ? { id: d.leadId, name: d.leadName ?? 'Unknown' } : null;
              const shownLead = hasLocal ? localLeadByDept[d.department] : savedLead;
              const showMixed = !hasLocal && d.leadMixed;
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
                      onChange={(e) => onAssignManager(d.department, e.target.value || null)}
                    >
                      <option value="">Unassigned</option>
                      {managerOptions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name} ({m.employee_code})
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--text-muted)' }}>
                    {showMixed ? (
                      <span className="italic" title="Members of this department have different leads, or some have none.">
                        mixed
                      </span>
                    ) : shownLead ? (
                      <span style={{ color: 'var(--text-primary)' }}>{shownLead.name}</span>
                    ) : (
                      <span className="italic">none</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <Select
                      value={showMixed ? '' : shownLead?.id ?? ''}
                      disabled={savingKey === `dept-tl-${d.department}`}
                      saving={savingKey === `dept-tl-${d.department}`}
                      onChange={(e) => {
                        const opt = e.target.selectedOptions[0];
                        const leadId = e.target.value;
                        onAssignLead(d.department, leadId || null, opt?.text);
                      }}
                    >
                      <option value="">{shownLead ? 'Clear lead' : 'Set lead for department…'}</option>
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
        &quot;Assign lead (bulk)&quot; sets every current employee-role member of that department&apos;s reporting lead in
        one action — the same field an employee&apos;s Adjust panel edits per person, just applied to the whole
        department at once. &quot;Current lead&quot; shows who is currently assigned across that department (or
        &quot;mixed&quot; if members have different leads).
      </p>
    </section>
  );
}
