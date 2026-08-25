'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const ROLES = ['employee', 'lead', 'manager', 'hr', 'hr_super_admin'];

type PersonOption = { id: string; full_name: string; employee_code: string };
type DepartmentOption = { department: string; managerId: string | null; managerName: string | null };

// Simplified onboarding flow — see IMPLEMENTATION_NOTES.md and
// 0017_pending_signups_and_probation.sql. `pendingSignup` is set when
// this form is opened from the "New sign-ins awaiting setup" panel
// (components/leave/NewJoinersPanel.tsx) to acknowledge someone who
// already signed in with Google, as opposed to a bare Add Employee.
export type PendingSignup = {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
};

export default function AddEmployeeForm({
  onCreated,
  pendingSignup,
}: {
  onCreated?: () => void;
  pendingSignup?: PendingSignup;
} = {}) {
  const router = useRouter();
  const [form, setForm] = useState({
    employee_code: '',
    full_name: pendingSignup?.fullName ?? '',
    email: pendingSignup?.email ?? '',
    role: 'employee',
    department: '',
    office: '',
    date_of_joining: '',
    reporting_lead_id: '',
    reporting_manager_id: '',
    probation_months: '',
  });
  const [managedDepartments, setManagedDepartments] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [leads, setLeads] = useState<PersonOption[]>([]);
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
    loadOptions('lead', setLeads);
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
        body: JSON.stringify({
          ...form,
          probation_months: form.probation_months ? Number(form.probation_months) : null,
          managed_departments: managedDepartments,
          pending_signup_id: pendingSignup?.id,
        }),
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
      employee_code: '', full_name: pendingSignup?.fullName ?? '', email: pendingSignup?.email ?? '', role: 'employee',
      department: '', office: '', date_of_joining: '',
      reporting_lead_id: '', reporting_manager_id: '', probation_months: '',
    });
    setManagedDepartments([]);
    router.refresh();
    // Only auto-close (when embedded in a modal — see
    // components/leave/AddEmployeeButton.tsx / NewJoinersPanel.tsx) on a
    // clean success. If there's a warning (e.g. no matching dashboard
    // employee_code yet), leave the modal open so HR actually sees it
    // instead of it flashing shut immediately.
    if (!body.warning) onCreated?.();
  }

  return (
    <form onSubmit={handleSubmit} className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl p-5 space-y-3 shadow-sm">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
        {pendingSignup ? 'Acknowledge & Set Up' : 'Add Employee'}
      </h2>

      {pendingSignup && (
        <div className="flex items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 mb-1">
          {pendingSignup.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pendingSignup.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center text-xs font-semibold text-[var(--text-muted)]">
              {pendingSignup.fullName[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-primary)] font-medium truncate">{pendingSignup.fullName}</p>
            <p className="text-[var(--text-muted)] text-[11px] truncate">{pendingSignup.email} · signed in with Google</p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {warning && (
        <div className="bg-amber-900/30 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs rounded-lg px-3 py-2">
          {warning}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Employee Code" value={form.employee_code} onChange={(v) => update('employee_code', v)} required />
        {/* Name/email are Google-verified truth once this is an Ack — not retyped, not editable here. See section 4's HR-vs-directory split. */}
        {pendingSignup ? (
          <>
            <ReadOnlyField label="Full Name" value={form.full_name} />
            <ReadOnlyField label="Email" value={form.email} />
          </>
        ) : (
          <>
            <Field label="Full Name" value={form.full_name} onChange={(v) => update('full_name', v)} required />
            <Field label="Email" value={form.email} onChange={(v) => update('email', v)} type="email" required />
          </>
        )}
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">Role</label>
          <select
            value={form.role}
            onChange={(e) => update('role', e.target.value)}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <Field label="Department" value={form.department} onChange={(v) => update('department', v)} required />
        <Field label="Office" value={form.office} onChange={(v) => update('office', v)} required />
        <Field
          label="Date of Joining"
          value={form.date_of_joining}
          onChange={(v) => update('date_of_joining', v)}
          type="date"
          required
        />
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">
            Probation length (months) <span className="text-[var(--text-muted)]/70">— optional</span>
          </label>
          <input
            type="number"
            min={0}
            max={24}
            value={form.probation_months}
            onChange={(e) => update('probation_months', e.target.value)}
            placeholder="Company default"
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
          />
          <p className="text-[10px] text-[var(--text-muted)] mt-1">
            Leave blank to use the company-wide default (Leave Configuration page). Drives when this person&apos;s leave
            unlocks from auto-LWP — same rule as everyone else, just a different length for this person.
          </p>
        </div>
        {form.role === 'employee' && (
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Reporting Lead</label>
            <select
              value={form.reporting_lead_id}
              onChange={(e) => update('reporting_lead_id', e.target.value)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="">— None —</option>
              {leads.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name} ({p.employee_code})</option>
              ))}
            </select>
          </div>
        )}
        {form.role === 'manager' && (
          <>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Departments Managed</label>
              <div className="scroll-thin border border-[var(--border)] rounded-lg px-3 py-2 max-h-32 overflow-y-auto space-y-1 bg-[var(--bg-surface)]">
                {departments.length === 0 && <p className="text-[var(--text-muted)] text-xs">No departments yet.</p>}
                {departments.map((d) => (
                  <label key={d.department} className="flex items-center gap-2 text-xs text-[var(--text-primary)] cursor-pointer">
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
              <label className="block text-xs text-[var(--text-muted)] mb-1">Reports To (Manager)</label>
              <select
                value={form.reporting_manager_id}
                onChange={(e) => update('reporting_manager_id', e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
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
        {loading ? (pendingSignup ? 'Setting up…' : 'Adding…') : pendingSignup ? 'Acknowledge & Set Up' : 'Add Employee'}
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
      <label className="block text-xs text-[var(--text-muted)] mb-1">{label}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
      />
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-xs text-[var(--text-muted)] mb-1">{label} <span className="text-[var(--text-muted)]/70">(from Google)</span></label>
      <div className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-muted)]">
        {value}
      </div>
    </div>
  );
}