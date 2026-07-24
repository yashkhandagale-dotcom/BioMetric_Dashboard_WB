'use client';

import { useEffect, useMemo, useState } from 'react';

type EmployeeOption = { id: string; full_name: string; employee_code: string; department: string; office: string };

const EVENT_TYPES: { code: string; label: string }[] = [
  { code: 'wfh', label: 'Work From Home' },
  { code: 'business_travel', label: 'Business Travel' },
  { code: 'office_shutdown', label: 'Office Shutdown' },
];

type Target = 'employees' | 'office';

// D6-2: "pick employees or entire office" is a hard either/or in the UI
// (radio + the matching picker), matching how the D6-3 API treats them —
// both resolve to a plain employee_id set server-side, so this form never
// has to know how that set is expanded.
export default function BulkEventsPage() {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeesError, setEmployeesError] = useState<string | null>(null);

  const [target, setTarget] = useState<Target>('office');
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [office, setOffice] = useState('');
  const [eventType, setEventType] = useState('wfh');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; requested: number; employees_affected: number; days: number } | null>(
    null
  );

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/leave/employees');
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) {
          setEmployeesError(data.error || `Could not load employees (${res.status}).`);
          return;
        }
        setEmployees(data.employees ?? []);
      } catch {
        setEmployeesError('Could not reach the server to load employees.');
      }
    }
    load();
  }, []);

  const offices = useMemo(() => Array.from(new Set(employees.map((e) => e.office))).sort(), [employees]);

  function toggleEmployee(id: string) {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!startDate || !endDate) {
      setError('Start and end dates are required.');
      return;
    }
    if (target === 'office' && !office) {
      setError('Pick an office.');
      return;
    }
    if (target === 'employees' && selectedEmployeeIds.size === 0) {
      setError('Select at least one employee.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/leave/bulk-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: eventType,
          start_date: startDate,
          end_date: endDate,
          note: note || undefined,
          ...(target === 'office' ? { office } : { employee_ids: Array.from(selectedEmployeeIds) }),
        }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setError(data.error || `Something went wrong (${res.status}).`);
        return;
      }
      setResult(data);
    } catch {
      setError('Could not reach the server — check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Bulk Workforce Events</h1>
        <a href="/leave/admin" className="text-xs text-slate-400 hover:text-white">
          ← Back to balances
        </a>
      </div>

      <p className="text-slate-500 text-xs max-w-2xl">
        WFH, Business Travel, and Office Shutdown are workforce signals, not leave — recording one here never touches
        anyone&apos;s SL/CL/PL/LWP balance.
      </p>

      {employeesError && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
          {employeesError}
        </div>
      )}
      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">{error}</div>
      )}
      {result && (
        <div className="bg-emerald-900/30 border border-emerald-500/30 text-emerald-300 text-xs rounded-lg px-3 py-2">
          Recorded {result.created} new event day(s) across {result.employees_affected} employee(s) over {result.days}{' '}
          day(s). ({result.requested - result.created} already existed and were skipped.)
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 space-y-4 max-w-2xl">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Event Type</label>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
          >
            {EVENT_TYPES.map((t) => (
              <option key={t.code} value={t.code}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-2">Apply To</label>
          <div className="flex items-center gap-4 mb-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="radio" checked={target === 'office'} onChange={() => setTarget('office')} />
              Entire office
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="radio" checked={target === 'employees'} onChange={() => setTarget('employees')} />
              Specific employees
            </label>
          </div>

          {target === 'office' ? (
            <select
              value={office}
              onChange={(e) => setOffice(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">Select an office…</option>
              {offices.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : (
            <div className="max-h-48 overflow-y-auto border border-slate-700 rounded-lg divide-y divide-slate-800">
              {employees.map((e) => (
                <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/60">
                  <input type="checkbox" checked={selectedEmployeeIds.has(e.id)} onChange={() => toggleEmployee(e.id)} />
                  {e.full_name} <span className="text-slate-500 text-xs">({e.employee_code} · {e.department})</span>
                </label>
              ))}
              {employees.length === 0 && <p className="px-3 py-2 text-slate-500 text-xs">No employees yet.</p>}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Note (optional)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {loading ? 'Recording…' : 'Record Event'}
        </button>
      </form>
    </div>
  );
}