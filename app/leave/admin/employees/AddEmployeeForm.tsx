'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const ROLES = ['employee', 'tech_lead', 'manager', 'hr', 'hr_super_admin'];

type PersonOption = { id: string; full_name: string; employee_code: string };
type DepartmentOption = { department: string; managerId: string | null; managerName: string | null };

export default function AddEmployeeForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    employee_code: '',
    full_name: '',
    email: '',
    role: 'employee',
    department: '',
    office: '',
    date_of_joining: '',
    reporting_tech_lead_id: '',
    reporting_manager_id: '',
  });
  const [managedDepartments, setManagedDepartments] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [techLeads, setTechLeads] = useState<PersonOption[]>([]);
  const [managers, setManagers] = useState<PersonOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

  useEffect(() => {
    async function loadOptions(role: string, setOptions: (v: PersonOption[]) => void) {
      try {
        const res = await fetch(`/api/leave/employees?role=${role}`);
        if (!res.ok) return; // e.g. not authenticated yet — leave dropdown empty, not fatal
        const text = await res.text();
        if (!text) return; // empty body — nothing to parse
        const data = JSON.parse(text);
        setOptions(data.employees ?? []);
      } catch {
        // Network error or malformed response — dropdown just stays empty.
        // Reporting hierarchy is optional, so this must never block the form.
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
    loadOptions('manager', setManagers);
    loadDepartments();
  }, []);

  function update(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWarning(null);
    setLoading(true);
    let res: Response;
    let body: { error?: string; warning?: string } = {};
    try {
      res = await fetch('/api/leave/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, managed_departments: managedDepartments }),
      });
      const text = await res.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      setLoading(false);
      setError('Could not reach the server — check your connection and try again.');
      return;
    }
    setLoading(false);
    if (!res.ok) {
      setError(body.error || 'Something went wrong');
      return;
    }
    if (body.warning) {
      setWarning(body.warning);
    }
    setForm({
      employee_code: '', full_name: '', email: '', role: 'employee',
      department: '', office: '', date_of_joining: '',
      reporting_tech_lead_id: '', reporting_manager_id: '',
    });
    setManagedDepartments([]);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="bg-slate-800/40 border border-slate-700 rounded-xl p-5 space-y-3">
      <h2 className="text-sm font-semibold text-white mb-2">Add Employee</h2>
      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {warning && (
        <div className="bg-amber-900/30 border border-amber-500/30 text-amber-300 text-xs rounded-lg px-3 py-2">
          {warning}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Employee Code" value={form.employee_code} onChange={(v) => update('employee_code', v)} required />
        <Field label="Full Name" value={form.full_name} onChange={(v) => update('full_name', v)} required />
        <Field label="Email" value={form.email} onChange={(v) => update('email', v)} type="email" required />
        <div>
          <label className="block text-xs text-slate-400 mb-1">Role</label>
          <select
            value={form.role}
            onChange={(e) => update('role', e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
          >
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <Field label="Department" value={form.department} onChange={(v) => update('department', v)} required />
        <Field label="Office" value={form.office} onChange={(v) => update('office', v)} required />
        <Field label="Date of Joining" value={form.date_of_joining} onChange={(v) => update('date_of_joining', v)} type="date" required />
        {form.role === 'employee' && (
          <div>
            <label className="block text-xs text-slate-400 mb-1">Reporting Tech Lead</label>
            <select
              value={form.reporting_tech_lead_id}
              onChange={(e) => update('reporting_tech_lead_id', e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">— None —</option>
              {techLeads.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name} ({p.employee_code})</option>
              ))}
            </select>
          </div>
        )}
        {form.role === 'manager' && (
          <>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Departments Managed</label>
              <div className="border border-slate-700 rounded-lg px-3 py-2 max-h-32 overflow-y-auto space-y-1 bg-slate-900">
                {departments.length === 0 && <p className="text-slate-500 text-xs">No departments yet.</p>}
                {departments.map((d) => (
                  <label key={d.department} className="flex items-center gap-2 text-xs text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={managedDepartments.includes(d.department)}
                      onChange={(e) =>
                        setManagedDepartments((depts) =>
                          e.target.checked ? [...depts, d.department] : depts.filter((x) => x !== d.department)
                        )
                      }
                    />
                    <span>{d.department}{d.managerName ? ` (currently: ${d.managerName})` : ''}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Reports To (Manager)</label>
              <select
                value={form.reporting_manager_id}
                onChange={(e) => update('reporting_manager_id', e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="">— None —</option>
                {managers.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name} ({p.employee_code})</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
      <button
        type="submit"
        disabled={loading}
        className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        {loading ? 'Adding…' : 'Add Employee'}
      </button>
    </form>
  );
}

function Field({
  label, value, onChange, type = 'text', required = false,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
      />
    </div>
  );
}