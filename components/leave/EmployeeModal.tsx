'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import AdjustBalanceButton from '@/app/leave/admin/AdjustBalanceButton';

type Tab = 'overview' | 'balances' | 'timeline' | 'violations';

type ProfileResponse = {
  employee: {
    id: string;
    code: string;
    name: string;
    email: string;
    role: string;
    department: string;
    office: string;
    employmentStatus: string;
    dateOfJoining: string;
    noticePeriodDays: number | null;
  };
  balances: { SL: number; CL: number; PL: number; LWP: number };
  fyStartYear: number;
  fyLabel: string;
  recentRequests: {
    id: string;
    leaveTypeCode: string;
    leaveTypeLabel: string;
    startDate: string;
    endDate: string;
    isHalfDay: boolean;
    halfDaySession: string | null;
    totalDays: number;
    status: string;
    source: string;
    isLwpOverride: boolean;
    reason: string;
    appliedOn: string;
  }[];
};

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'balances', label: 'Balances' },
  { id: 'timeline', label: 'Leave Timeline' },
  { id: 'violations', label: 'Violations' },
];

// D2-1: full tabbed profile promised by the placeholder text left in
// EmployeeCard on Day 1. Opens over the grid (no navigation, no full page
// reload) and switches tabs purely client-side — the only network call is
// the single profile fetch below, refetched when `refreshSignal` changes
// (EmployeeGrid bumps this after a leave is recorded from the drawer, so
// the Balances / Leave Timeline tabs never show stale figures).
export default function EmployeeModal({
  employeeId,
  refreshSignal,
  onClose,
  onRecordLeave,
}: {
  employeeId: string;
  refreshSignal?: number;
  onClose: () => void;
  onRecordLeave: (employeeId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/leave/employees/${employeeId}/profile`);
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || `Could not load this employee's profile (${res.status}).`);
          setLoading(false);
          return;
        }
        setProfile(data);
      } catch {
        if (!cancelled) setError('Could not reach the server — check your connection and retry.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [employeeId, refreshSignal]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-700 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-white font-semibold text-sm truncate">
              {profile ? profile.employee.name : 'Employee profile'}
            </h3>
            {profile && (
              <p className="text-slate-500 text-xs mt-0.5 truncate">
                {profile.employee.code} · {profile.employee.department} · {profile.employee.office}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-5 pt-3 border-b border-slate-700 flex-shrink-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`text-xs font-medium px-3 py-2 rounded-t-lg border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? 'text-white border-emerald-500'
                  : 'text-slate-400 border-transparent hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && <p className="text-slate-500 text-sm">Loading…</p>}
          {error && (
            <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {!loading && !error && profile && (
            <>
              {tab === 'overview' && <OverviewTab profile={profile} />}
              {tab === 'balances' && <BalancesTab profile={profile} />}
              {tab === 'timeline' && <TimelineTab profile={profile} />}
              {tab === 'violations' && <ViolationsTab />}
            </>
          )}
        </div>

        {profile && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-700 flex-shrink-0">
            <button
              type="button"
              onClick={() => onRecordLeave(profile.employee.id)}
              className="text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium px-3 py-2 rounded-lg transition-colors"
            >
              Record Leave
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-slate-500 text-xs">{label}</p>
      <p className="text-white text-sm">{value || '—'}</p>
    </div>
  );
}

function OverviewTab({ profile }: { profile: ProfileResponse }) {
  const e = profile.employee;
  return (
    <div className="grid grid-cols-2 gap-4">
      <Field label="Employee code" value={e.code} />
      <Field label="Role" value={e.role} />
      <Field label="Department" value={e.department} />
      <Field label="Office" value={e.office} />
      <Field label="Employment status" value={e.employmentStatus.replace('_', ' ')} />
      <Field label="Date of joining" value={e.dateOfJoining} />
      <Field label="Email" value={e.email} />
      <Field label="Notice period (days)" value={e.noticePeriodDays != null ? String(e.noticePeriodDays) : '—'} />
    </div>
  );
}

function BalancesTab({ profile }: { profile: ProfileResponse }) {
  const b = profile.balances;
  return (
    <div className="space-y-4">
      <p className="text-slate-500 text-xs">{profile.fyLabel} — live balances, same figures shown on the grid and /leave/admin.</p>
      <div className="grid grid-cols-4 gap-2 text-center text-sm bg-slate-800/60 rounded-lg py-3">
        <BalanceCell label="SL" value={b.SL} />
        <BalanceCell label="CL" value={b.CL} />
        <BalanceCell label="PL" value={b.PL} />
        <BalanceCell label="LWP" value={Math.abs(b.LWP)} amber />
      </div>
      <AdjustBalanceButton employeeId={profile.employee.id} employeeName={profile.employee.name} fyStartYear={profile.fyStartYear} />
    </div>
  );
}

function BalanceCell({ label, value, amber }: { label: string; value: number; amber?: boolean }) {
  return (
    <div>
      <p className={`font-semibold text-base ${amber ? 'text-amber-400' : 'text-white'}`}>{value.toFixed(2)}</p>
      <p className="text-slate-500 text-xs">{label}</p>
    </div>
  );
}

function TimelineTab({ profile }: { profile: ProfileResponse }) {
  if (profile.recentRequests.length === 0) {
    return <p className="text-slate-500 text-sm">No leave recorded for this employee yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {profile.recentRequests.map((r) => (
        <li key={r.id} className="border border-slate-700 rounded-lg px-3 py-2 text-xs bg-slate-800/40">
          <div className="flex items-center justify-between gap-2">
            <span className="text-white font-medium">
              {r.leaveTypeLabel}
              {r.isHalfDay ? ` (half day${r.halfDaySession ? `, ${r.halfDaySession}` : ''})` : ''}
            </span>
            <span className="text-slate-400">{r.totalDays.toFixed(2)} day(s)</span>
          </div>
          <p className="text-slate-500 mt-1">
            {r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`} · applied{' '}
            {new Date(r.appliedOn).toLocaleDateString()}
          </p>
          {r.isLwpOverride && (
            <p className="text-amber-400 mt-1">Recorded as LWP — insufficient balance for the original type.</p>
          )}
          <p className="text-slate-500 mt-1 italic">{r.reason}</p>
        </li>
      ))}
    </ul>
  );
}

function ViolationsTab() {
  // D1-4 / D4: same placeholder convention as ViolationBadge — real
  // detection (notice-shortfall LWP conversions, missing medical
  // certificates, early probation leave, negative balances) lands Day 4
  // behind GET /api/leave/violations.
  return (
    <p className="text-slate-500 text-sm italic">
      Violation detection lands Day 4 — this tab will list this employee&apos;s open violations, each traceable to a
      real record, with a one-click Resolve action.
    </p>
  );
}
