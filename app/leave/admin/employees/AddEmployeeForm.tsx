'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ROLES = ['employee', 'tech_lead', 'manager', 'hr', 'hr_super_admin'];

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
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch('/api/leave/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json();
      setError(body.error || 'Something went wrong');
      return;
    }
    setForm({
      employee_code: '', full_name: '', email: '', role: 'employee',
      department: '', office: '', date_of_joining: '',
    });
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