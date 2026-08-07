'use client';

import { useEffect, useMemo, useState } from 'react';

type EmployeeOption = { id: string; full_name: string; employee_code: string; department: string; office: string };

// Still the three original signals as one-click suggestions, but the
// field itself is free text now (workforce_events.event_type is no
// longer a fixed 3-value check-constraint — see migration 0011) so HR
// can record something like "Client Visit" or "Team Offsite" without a
// code change. A <datalist> keeps the common ones one click away
// without limiting what can be typed.
const SUGGESTED_EVENT_TYPES = [
  { code: 'wfh', label: 'Work From Home' },
  { code: 'business_travel', label: 'Business Travel' },
  { code: 'office_shutdown', label: 'Office Shutdown' },
];

type Target = 'employees' | 'office';

export default function BulkEventsModal({ onClose }: { onClose: () => void }) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeesError, setEmployeesError] = useState<string | null>(null);

  const [target, setTarget] = useState<Target>('office');
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [office, setOffice] = useState('');
  const [eventType, setEventType] = useState('Work From Home');
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

    if (!eventType.trim()) {
      setError('Event type is required.');
      return;
    }
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
          event_type: eventType.trim(),
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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-[var(--text-primary)] font-semibold text-sm">Bulk Workforce Events</h3>
            <p className="text-[var(--text-muted)] text-xs mt-1 max-w-sm">
              WFH, travel, shutdowns, etc. — a workforce signal, not leave. Never touches SL/CL/PL/LWP balances.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {employeesError && (
          <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
            {employeesError}
          </div>
        )}
        {error && (
          <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">{error}</div>
        )}
        {result && (
          <div className="bg-emerald-900/30 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs rounded-lg px-3 py-2">
            Recorded {result.created} new event day(s) across {result.employees_affected} employee(s) over {result.days}{' '}
            day(s). ({result.requested - result.created} already existed and were skipped.)
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Event Type</label>
            <input
              type="text"
              list="bulk-event-type-suggestions"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              placeholder="e.g. Work From Home, Client Visit, Team Offsite…"
              className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
              required
            />
            <datalist id="bulk-event-type-suggestions">
              {SUGGESTED_EVENT_TYPES.map((t) => (
                <option key={t.code} value={t.label} />
              ))}
            </datalist>
            <p className="text-[var(--text-muted)] text-[11px] mt-1">Type any label — not limited to the suggestions.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-2">Apply To</label>
            <div className="flex items-center gap-4 mb-3">
              <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <input type="radio" checked={target === 'office'} onChange={() => setTarget('office')} />
                Entire office
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <input type="radio" checked={target === 'employees'} onChange={() => setTarget('employees')} />
                Specific employees
              </label>
            </div>

            {target === 'office' ? (
              <select
                value={office}
                onChange={(e) => setOffice(e.target.value)}
                className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
              >
                <option value="">Select an office…</option>
                {offices.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <div className="max-h-40 overflow-y-auto border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
                {employees.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]/60">
                    <input type="checkbox" checked={selectedEmployeeIds.has(e.id)} onChange={() => toggleEmployee(e.id)} />
                    {e.full_name} <span className="text-[var(--text-muted)] text-xs">({e.employee_code} · {e.department})</span>
                  </label>
                ))}
                {employees.length === 0 && <p className="px-3 py-2 text-[var(--text-muted)] text-xs">No employees yet.</p>}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm px-3 py-2">
              Close
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {loading ? 'Recording…' : 'Record Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
