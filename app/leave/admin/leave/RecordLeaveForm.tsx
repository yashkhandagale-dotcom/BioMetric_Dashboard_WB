'use client';

import { useEffect, useMemo, useState } from 'react';

type EmployeeOption = { id: string; full_name: string; employee_code: string };

const LEAVE_TYPES: { code: 'SL' | 'CL' | 'PL' | 'LWP'; label: string }[] = [
  { code: 'SL', label: 'Sick Leave' },
  { code: 'CL', label: 'Casual Leave' },
  { code: 'PL', label: 'Planned Leave' },
  { code: 'LWP', label: 'Leave Without Pay' },
];

type SubmitResult = {
  leave_request: { id: string; total_days: number; sync_status: string; sync_error: string | null };
  policy_notes: string[];
  sync: { synced: boolean; error?: string };
};

export default function RecordLeaveForm() {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeeId, setEmployeeId] = useState<string>('');

  const [leaveTypeCode, setLeaveTypeCode] = useState<'SL' | 'CL' | 'PL' | 'LWP'>('SL');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState<'AM' | 'PM'>('AM');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/leave/admin/leave/employees');
        if (!res.ok) return;
        const text = await res.text();
        if (!text) return;
        const data = JSON.parse(text);
        setEmployees(data.employees ?? []);
      } catch {
        // Picker just stays empty — matches the fail-silent pattern used
        // for the reporting-hierarchy dropdowns elsewhere in this app.
      }
    }
    load();
  }, []);

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return employees.slice(0, 8);
    return employees
      .filter((e) => e.full_name.toLowerCase().includes(q) || e.employee_code.toLowerCase().includes(q))
      .slice(0, 8);
  }, [employees, employeeSearch]);

  const selectedEmployee = employees.find((e) => e.id === employeeId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!employeeId) {
      setError('Select an employee first.');
      return;
    }
    if (!startDate) {
      setError('Start date is required.');
      return;
    }
    if (!isHalfDay && !endDate) {
      setError('End date is required for a non-half-day leave.');
      return;
    }
    if (!reason.trim()) {
      setError('Reason is required.');
      return;
    }

    setLoading(true);
    let res: Response;
    let body: SubmitResult & { error?: string };
    try {
      res = await fetch('/api/leave/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          leave_type_code: leaveTypeCode,
          start_date: startDate,
          end_date: isHalfDay ? startDate : endDate,
          is_half_day: isHalfDay,
          half_day_session: isHalfDay ? halfDaySession : undefined,
          reason,
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

    setResult(body);
    setStartDate('');
    setEndDate('');
    setReason('');
  }

  async function handleRetrySync() {
    if (!result) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/leave/requests/${result.leave_request.id}/retry-sync`, { method: 'POST' });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      setResult((prev) =>
        prev
          ? {
              ...prev,
              leave_request: {
                ...prev.leave_request,
                sync_status: data.sync?.synced ? 'synced' : 'failed',
                sync_error: data.sync?.synced ? null : data.sync?.error ?? prev.leave_request.sync_error,
              },
              sync: data.sync ?? prev.sync,
            }
          : prev
      );
    } catch {
      // Leave the existing failed state visible; the button stays available to try again.
    }
    setRetrying(false);
  }

  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-6 space-y-4 max-w-2xl">
      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="bg-emerald-900/30 border border-emerald-500/30 text-emerald-300 text-xs rounded-lg px-3 py-2">
            Recorded — {result.leave_request.total_days} day(s) debited.
          </div>
          {result.policy_notes.length > 0 && (
            <ul className="bg-amber-900/30 border border-amber-500/30 text-amber-300 text-xs rounded-lg px-3 py-2 list-disc pl-4 space-y-1">
              {result.policy_notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          )}
          {result.leave_request.sync_status === 'failed' && (
            <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2 flex items-center justify-between gap-3">
              <span>
                Saved in the Leave Tracker, but sync to the attendance dashboard failed: {result.leave_request.sync_error}
              </span>
              <button
                type="button"
                onClick={handleRetrySync}
                disabled={retrying}
                className="shrink-0 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                {retrying ? 'Retrying…' : 'Retry sync'}
              </button>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <label className="block text-xs text-slate-400 mb-1">Employee</label>
          <input
            type="text"
            value={selectedEmployee ? `${selectedEmployee.full_name} (${selectedEmployee.employee_code})` : employeeSearch}
            onChange={(e) => {
              setEmployeeId('');
              setEmployeeSearch(e.target.value);
            }}
            placeholder="Search by name or employee code…"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            required
          />
          {!employeeId && employeeSearch && filteredEmployees.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg overflow-hidden shadow-lg">
              {filteredEmployees.map((e) => (
                <button
                  type="button"
                  key={e.id}
                  onClick={() => {
                    setEmployeeId(e.id);
                    setEmployeeSearch('');
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-white hover:bg-slate-800"
                >
                  {e.full_name} <span className="text-slate-500">({e.employee_code})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Leave Type</label>
            <select
              value={leaveTypeCode}
              onChange={(e) => setLeaveTypeCode(e.target.value as typeof leaveTypeCode)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              {LEAVE_TYPES.map((lt) => (
                <option key={lt.code} value={lt.code}>{lt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={isHalfDay} onChange={(e) => setIsHalfDay(e.target.checked)} />
              Half day
            </label>
          </div>
        </div>

        {isHalfDay ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Session</label>
              <select
                value={halfDaySession}
                onChange={(e) => setHalfDaySession(e.target.value as 'AM' | 'PM')}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
          </div>
        ) : (
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
        )}

        <div>
          <label className="block text-xs text-slate-400 mb-1">Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {loading ? 'Recording…' : 'Record Leave'}
        </button>
      </form>
    </div>
  );
}